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

describe('Ratings & verify (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let habToken: string;
  let hab2Token: string;
  let modToken: string;
  let code: string;

  const phone = '+22994000444';
  const phone2 = '+22994000555';
  const habEmail = 'rate.hab.e2e@example.com';
  const hab2Email = 'rate.hab2.e2e@example.com';
  const modEmail = 'rate.mod.e2e@example.com';
  const password = 'motdepasse123';
  const prefix = 'TRAT';
  const apiKeyValue = 'bj_live_e2eratekey000001';
  const gps = { gpsLat: 6.4501, gpsLng: 2.4501 };
  const payload = {
    category: 'COMMERCE',
    steps: ['Carrefour', 'Boutique'],
    photoUrl: 'https://example.com/p.jpg',
    ...gps,
  };

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function registerHabitant(p: string, email: string): Promise<string> {
    await http().post('/api/auth/request-otp').send({ phone: p });
    const otp = await prisma.otpCode.findFirst({
      where: { phone: p, used: false },
      orderBy: { createdAt: 'desc' },
    });
    const reg = await http()
      .post('/api/auth/register')
      .send({ phone: p, code: otp!.code, email, password });
    return reg.body.data.token as string;
  }

  async function cleanup() {
    const phones = [phone, phone2];
    await prisma.apiRequestLog.deleteMany({
      where: { apiKey: { key: apiKeyValue } },
    });
    await prisma.apiKey.deleteMany({ where: { key: apiKeyValue } });
    await prisma.rating.deleteMany({
      where: { user: { phone: { in: phones } } },
    });
    await prisma.addressRevision.deleteMany({
      where: { address: { user: { phone: { in: phones } } } },
    });
    await prisma.address.deleteMany({
      where: { user: { phone: { in: phones } } },
    });
    await prisma.localisation.deleteMany({ where: { quartier: { prefix } } });
    await prisma.otpCode.deleteMany({ where: { phone: { in: phones } } });
    await prisma.user.deleteMany({ where: { phone: { in: phones } } });
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
        name: 'Test Rate',
        prefix,
        centerLat: gps.gpsLat,
        centerLng: gps.gpsLng,
      },
    });
    await prisma.apiKey.create({
      data: { key: apiKeyValue, label: 'E2E rate', status: 'ACTIVE' },
    });

    habToken = await registerHabitant(phone, habEmail);
    hab2Token = await registerHabitant(phone2, hab2Email);

    await prisma.user.create({
      data: {
        email: modEmail,
        password: await bcrypt.hash(password, 4),
        role: 'MODERATEUR',
        status: 'ACTIVE',
      },
    });
    modToken = (
      await http().post('/api/auth/login').send({ email: modEmail, password })
    ).body.data.token;

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

  it('avant publication : rate → 404 ADDRESS_NOT_FOUND', async () => {
    const res = await http()
      .post(`/api/addresses/${code}/rate`)
      .set(auth(habToken))
      .send({ stars: 4 })
      .expect(404);
    expect(res.body.code).toBe('ADDRESS_NOT_FOUND');
  });

  it('avant publication : verify → 404', async () => {
    const res = await http()
      .get(`/api/addresses/${code}/verify`)
      .set(auth(apiKeyValue))
      .expect(404);
    expect(res.body.code).toBe('ADDRESS_NOT_FOUND');
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

    it('rate (habitant) → 200, moyenne recalculée', async () => {
      const res = await http()
        .post(`/api/addresses/${code}/rate`)
        .set(auth(habToken))
        .send({ stars: 4 })
        .expect(200);
      expect(res.body.data).toEqual({
        recorded: true,
        averageRating: 4,
        ratingCount: 1,
      });
    });

    it('re-rate du même habitant → upsert (remplace, count inchangé)', async () => {
      const res = await http()
        .post(`/api/addresses/${code}/rate`)
        .set(auth(habToken))
        .send({ stars: 2 })
        .expect(200);
      expect(res.body.data).toEqual({
        recorded: true,
        averageRating: 2,
        ratingCount: 1,
      });
    });

    it('2ᵉ habitant → la moyenne combine les deux notes', async () => {
      const res = await http()
        .post(`/api/addresses/${code}/rate`)
        .set(auth(hab2Token))
        .send({ stars: 4 })
        .expect(200);
      // notes 2 et 4 → moyenne 3.0, 2 évaluations
      expect(res.body.data).toEqual({
        recorded: true,
        averageRating: 3,
        ratingCount: 2,
      });
    });

    it('note hors bornes → 400 INVALID_RATING', async () => {
      const res = await http()
        .post(`/api/addresses/${code}/rate`)
        .set(auth(habToken))
        .send({ stars: 6 })
        .expect(400);
      expect(res.body.code).toBe('INVALID_RATING');
    });

    it('rate sans JWT → 401', async () => {
      await http()
        .post(`/api/addresses/${code}/rate`)
        .send({ stars: 3 })
        .expect(401);
    });

    it('verify (clé API) → 200, moyenne + published + métering VERIFY', async () => {
      const res = await http()
        .get(`/api/addresses/${code}/verify`)
        .set(auth(apiKeyValue))
        .expect(200);
      expect(res.body.data).toEqual({
        code,
        published: true,
        averageRating: 3,
        ratingCount: 2,
      });
      const logged = await prisma.apiRequestLog.count({
        where: { apiKey: { key: apiKeyValue }, endpoint: 'VERIFY' },
      });
      expect(logged).toBeGreaterThanOrEqual(1);
    });

    it('verify sans clé API → 401 API_KEY_MISSING', async () => {
      const res = await http().get(`/api/addresses/${code}/verify`).expect(401);
      expect(res.body.code).toBe('API_KEY_MISSING');
    });
  });
});
