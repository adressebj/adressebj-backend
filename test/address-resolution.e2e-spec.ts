process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://postgres:postgres@localhost:5432/adressebj_test?schema=public';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Address resolution & public page (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let habToken: string;
  let modToken: string;
  let code: string;

  const phone = '+22993000333';
  const habEmail = 'res.hab.e2e@example.com';
  const modEmail = 'res.mod.e2e@example.com';
  const password = 'motdepasse123';
  const prefix = 'TRES';
  const apiKeyValue = 'bj_live_e2eresolvekey01';
  const gps = { gpsLat: 6.4001, gpsLng: 2.4001 };
  const payload = {
    category: 'COMMERCE',
    steps: ['Partir du carrefour', 'Boutique verte'],
    photoUrl: 'https://example.com/p.jpg',
    ...gps,
  };

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function cleanup() {
    await prisma.apiRequestLog.deleteMany({
      where: { apiKey: { key: apiKeyValue } },
    });
    await prisma.apiKey.deleteMany({ where: { key: apiKeyValue } });
    await prisma.addressRevision.deleteMany({
      where: { address: { user: { phone } } },
    });
    await prisma.contribution.deleteMany({
      where: { address: { user: { phone } } },
    });
    await prisma.rating.deleteMany({ where: { address: { user: { phone } } } });
    await prisma.address.deleteMany({ where: { user: { phone } } });
    await prisma.localisation.deleteMany({ where: { quartier: { prefix } } });
    await prisma.otpCode.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { email: modEmail } });
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
        name: 'Test Res',
        prefix,
        centerLat: gps.gpsLat,
        centerLng: gps.gpsLng,
      },
    });
    await prisma.apiKey.create({
      data: { key: apiKeyValue, label: 'E2E resolve', status: 'ACTIVE' },
    });

    // Habitant
    await http().post('/api/auth/request-otp').send({ phone });
    const otp = await prisma.otpCode.findFirst({
      where: { phone, used: false },
      orderBy: { createdAt: 'desc' },
    });
    const reg = await http()
      .post('/api/auth/register')
      .send({ phone, code: otp!.code, email: habEmail, password });
    habToken = reg.body.data.token;

    // Modérateur
    await prisma.user.create({
      data: {
        email: modEmail,
        password: await bcrypt.hash(password, 4),
        role: 'MODERATEUR',
        status: 'ACTIVE',
      },
    });
    const modLogin = await http()
      .post('/api/auth/login')
      .send({ email: modEmail, password });
    modToken = modLogin.body.data.token;

    // Crée une adresse
    const created = await http()
      .post('/api/addresses')
      .set(auth(habToken))
      .send(payload)
      .expect(201);
    code = created.body.data.code;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('avant publication : resolve → 404 (existence non exposée)', async () => {
    const res = await http()
      .get(`/api/addresses/${code}/resolve`)
      .set(auth(apiKeyValue))
      .expect(404);
    expect(res.body.code).toBe('ADDRESS_NOT_FOUND');
  });

  it('avant publication : page publique → 404', async () => {
    const res = await http().get(`/api/addresses/${code}`).expect(404);
    expect(res.body.code).toBe('ADDRESS_NOT_FOUND');
  });

  it('resolve sans clé API → 401 API_KEY_MISSING', async () => {
    const res = await http().get(`/api/addresses/${code}/resolve`).expect(401);
    expect(res.body.code).toBe('API_KEY_MISSING');
  });

  it('resolve avec une clé inconnue → 401 API_KEY_INVALID', async () => {
    const res = await http()
      .get(`/api/addresses/${code}/resolve`)
      .set({ Authorization: 'Bearer bj_live_doesnotexist00' })
      .expect(401);
    expect(res.body.code).toBe('API_KEY_INVALID');
  });

  describe('après publication', () => {
    beforeAll(async () => {
      const rev = await prisma.addressRevision.findFirst({
        where: { address: { code }, status: 'EN_ATTENTE_VALIDATION' },
      });
      await http()
        .patch(`/api/moderation/revisions/${rev!.id}/approve`)
        .set(auth(modToken))
        .expect(200);
    });

    it('resolve → 200, contenu publié + GPS Localisation + métering', async () => {
      const res = await http()
        .get(`/api/addresses/${code}/resolve`)
        .set(auth(apiKeyValue))
        .expect(200);
      expect(res.body.data).toMatchObject({
        code,
        category: 'COMMERCE',
        quartier: { prefix },
        gps: { lat: gps.gpsLat, lng: gps.gpsLng },
        assembledText: 'Partir du carrefour. Boutique verte.',
      });

      const logged = await prisma.apiRequestLog.count({
        where: { apiKey: { key: apiKeyValue }, endpoint: 'RESOLVE' },
      });
      expect(logged).toBeGreaterThanOrEqual(1);
    });

    it('page publique → 200, averageRating null sans évaluation', async () => {
      const res = await http().get(`/api/addresses/${code}`).expect(200);
      expect(res.body.data).toMatchObject({
        code,
        category: 'COMMERCE',
        quartier: { prefix },
        averageRating: null,
        ratingCount: 0,
      });
      expect(res.body.data.fieldNotes).toEqual([]);
    });

    it('clé révoquée → 401 API_KEY_REVOKED', async () => {
      await prisma.apiKey.update({
        where: { key: apiKeyValue },
        data: { status: 'REVOKED' },
      });
      const res = await http()
        .get(`/api/addresses/${code}/resolve`)
        .set(auth(apiKeyValue))
        .expect(401);
      expect(res.body.code).toBe('API_KEY_REVOKED');
      await prisma.apiKey.update({
        where: { key: apiKeyValue },
        data: { status: 'ACTIVE' },
      });
    });

    it('désactivée → resolve 410 ADDRESS_INACTIVE', async () => {
      await prisma.address.update({
        where: { code },
        data: { lifecycle: 'DESACTIVEE', deactivatedAt: new Date() },
      });
      const res = await http()
        .get(`/api/addresses/${code}/resolve`)
        .set(auth(apiKeyValue))
        .expect(410);
      expect(res.body.code).toBe('ADDRESS_INACTIVE');
      expect(res.body.address_code).toBe(code);
      expect(res.body.deactivated_at).toBeTruthy();
    });

    it('désactivée → page publique 410 ADDRESS_INACTIVE', async () => {
      const res = await http().get(`/api/addresses/${code}`).expect(410);
      expect(res.body.code).toBe('ADDRESS_INACTIVE');
    });
  });
});
