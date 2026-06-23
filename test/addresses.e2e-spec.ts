process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://postgres:postgres@localhost:5432/adressebj_test?schema=public';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Addresses creation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  const phone = '+22991000111';
  const email = 'addr.e2e@example.com';
  const password = 'motdepasse123';
  const prefix = 'TADR';
  const gps = { gpsLat: 6.3662, gpsLng: 2.3912 };
  const payload = {
    category: 'DOMICILE',
    steps: ['Tourner à gauche', 'Maison bleue'],
    photoUrl: 'https://example.com/p.jpg',
    ...gps,
  };

  const http = () => request(app.getHttpServer());

  async function cleanup() {
    await prisma.addressRevision.deleteMany({
      where: { address: { user: { phone } } },
    });
    await prisma.address.deleteMany({ where: { user: { phone } } });
    await prisma.localisation.deleteMany({ where: { quartier: { prefix } } });
    await prisma.otpCode.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { phone } });
    await prisma.quartier.deleteMany({ where: { prefix } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    await cleanup();
    await prisma.quartier.create({
      data: {
        name: 'Test Addr',
        prefix,
        centerLat: gps.gpsLat,
        centerLng: gps.gpsLng,
      },
    });

    // Inscription habitant → JWT
    await http().post('/api/auth/request-otp').send({ phone });
    const otp = await prisma.otpCode.findFirst({
      where: { phone, used: false },
      orderBy: { createdAt: 'desc' },
    });
    const reg = await http()
      .post('/api/auth/register')
      .send({ phone, code: otp!.code, email, password });
    token = reg.body.data.token;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('POST /api/addresses → 201, code généré, EN_ATTENTE_VALIDATION', async () => {
    const res = await http()
      .post('/api/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(201);
    expect(res.body.data.code).toMatch(new RegExp(`^${prefix}-`));
    expect(res.body.data.revisionStatus).toBe('EN_ATTENTE_VALIDATION');
  });

  it('GET /api/addresses/mine → contient l’adresse, non publiée', async () => {
    const res = await http()
      .get('/api/addresses/mine')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].published).toBe(false);
    expect(res.body.data[0].currentRevisionStatus).toBe(
      'EN_ATTENTE_VALIDATION',
    );
    // Champs enrichis pour la carte « Mes adresses » (photo + quartier + GPS).
    expect(res.body.data[0].photoUrl).toBe(payload.photoUrl);
    expect(typeof res.body.data[0].quartierName).toBe('string');
    expect(res.body.data[0].gps).toMatchObject({
      lat: expect.any(Number),
      lng: expect.any(Number),
    });
  });

  it('refuse une 2ᵉ adresse au même emplacement (409)', async () => {
    const res = await http()
      .post('/api/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(409);
    expect(res.body.code).toBe('ADDRESS_ALREADY_EXISTS_AT_LOCATION');
  });

  it('refuse sans JWT (401)', async () => {
    await http().post('/api/addresses').send(payload).expect(401);
  });

  it('refuse un localisationId injecté par le client (whitelist, 400)', async () => {
    await http()
      .post('/api/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...payload, localisationId: 'hack' })
      .expect(400);
  });
});
