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

describe('Quartier analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let habToken: string;
  let modToken: string;
  let quartierId: string;
  let apiKeyId: string;
  let addressId: string;

  const phone = '+22993000555';
  const habEmail = 'ana.hab.e2e@example.com';
  const modEmail = 'ana.mod.e2e@example.com';
  const password = 'motdepasse123';
  const prefix = 'TANA';
  const apiKeyValue = 'bj_live_e2eanalyticskey1';
  const gps = { gpsLat: 6.4201, gpsLng: 2.4201 };

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function cleanup() {
    await prisma.apiRequestLog.deleteMany({
      where: { apiKey: { key: apiKeyValue } },
    });
    await prisma.visit.deleteMany({ where: { address: { user: { phone } } } });
    await prisma.apiKey.deleteMany({ where: { key: apiKeyValue } });
    await prisma.addressRevision.deleteMany({
      where: { address: { user: { phone } } },
    });
    await prisma.address.deleteMany({ where: { user: { phone } } });
    await prisma.localisation.deleteMany({ where: { quartier: { prefix } } });
    await prisma.otpCode.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { email: modEmail } });
    await prisma.quartier.deleteMany({ where: { prefix } });
  }

  function visitRow(
    departHourUtc: number,
    durationMin: number | null,
    price: number | null,
  ) {
    const departAt = new Date(Date.UTC(2026, 5, 1, departHourUtc, 0, 0));
    const arrivedAt =
      durationMin === null
        ? null
        : new Date(departAt.getTime() + durationMin * 60000);
    return { addressId, departAt, arrivedAt, finalPrice: price, apiKeyId };
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
    const quartier = await prisma.quartier.create({
      data: {
        name: 'Test Analytics',
        prefix,
        centerLat: gps.gpsLat,
        centerLng: gps.gpsLng,
      },
    });
    quartierId = quartier.id;
    const apiKey = await prisma.apiKey.create({
      data: { key: apiKeyValue, label: 'E2E analytics', status: 'ACTIVE' },
    });
    apiKeyId = apiKey.id;

    await http().post('/api/auth/request-otp').send({ phone });
    const otp = await prisma.otpCode.findFirst({
      where: { phone, used: false },
      orderBy: { createdAt: 'desc' },
    });
    habToken = (
      await http()
        .post('/api/auth/register')
        .send({ phone, code: otp!.code, email: habEmail, password })
    ).body.data.token;

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

    const code = (
      await http()
        .post('/api/addresses')
        .set(auth(habToken))
        .send({
          category: 'COMMERCE',
          steps: ['Carrefour', 'Boutique'],
          photoUrl: 'https://example.com/p.jpg',
          ...gps,
        })
        .expect(201)
    ).body.data.code;
    const rev = await prisma.addressRevision.findFirst({
      where: { address: { code }, status: 'EN_ATTENTE_VALIDATION' },
    });
    await http()
      .patch(`/api/moderation/revisions/${rev!.id}/approve`)
      .set(auth(modToken))
      .expect(200);
    addressId = (await prisma.address.findUniqueOrThrow({ where: { code } }))
      .id;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('sans clé API → 401 API_KEY_MISSING', async () => {
    const res = await http()
      .get(`/api/quartiers/${quartierId}/analytics`)
      .expect(401);
    expect(res.body.code).toBe('API_KEY_MISSING');
  });

  it('aucune remontée (dénominateur nul) → 200 autorisé (cf. #F)', async () => {
    // Aucun ApiRequestLog encore : resolves = 0 ⇒ accès autorisé, pas de 403.
    const res = await http()
      .get(`/api/quartiers/${quartierId}/analytics`)
      .set(auth(apiKeyValue))
      .expect(200);
    expect(res.body.data.quartierId).toBe(quartierId);
  });

  it('quota insuffisant (ratio bas) → 403 ANALYTICS_QUOTA_INSUFFICIENT', async () => {
    // 10 RESOLVE, 2 CONFIRM ⇒ 20% < 80%.
    await prisma.apiRequestLog.createMany({
      data: [
        ...Array.from({ length: 10 }, () => ({
          apiKeyId,
          endpoint: 'RESOLVE' as const,
        })),
        ...Array.from({ length: 2 }, () => ({
          apiKeyId,
          endpoint: 'CONFIRM' as const,
        })),
      ],
    });
    const res = await http()
      .get(`/api/quartiers/${quartierId}/analytics`)
      .set(auth(apiKeyValue))
      .expect(403);
    expect(res.body.code).toBe('ANALYTICS_QUOTA_INSUFFICIENT');
    expect(res.body.message).toContain('20%');
    // Remet à zéro le journal pour les phases suivantes.
    await prisma.apiRequestLog.deleteMany({ where: { apiKeyId } });
  });

  it('quartier inconnu → 404 QUARTIER_NOT_FOUND', async () => {
    const res = await http()
      .get('/api/quartiers/inexistant/analytics')
      .set(auth(apiKeyValue))
      .expect(404);
    expect(res.body.code).toBe('QUARTIER_NOT_FOUND');
  });

  describe('quota satisfait', () => {
    beforeAll(async () => {
      // Ratio CONFIRM/RESOLVE = 9/10 = 90% ≥ 80% (journal repart propre).
      await prisma.apiRequestLog.deleteMany({ where: { apiKeyId } });
      await prisma.apiRequestLog.createMany({
        data: [
          ...Array.from({ length: 10 }, () => ({
            apiKeyId,
            endpoint: 'RESOLVE' as const,
          })),
          ...Array.from({ length: 9 }, () => ({
            apiKeyId,
            endpoint: 'CONFIRM' as const,
          })),
        ],
      });
      // 5 visites dans le quartier : 4 confirmées (durées 10,12,8,30 min), 1 non confirmée.
      await prisma.visit.createMany({
        data: [
          visitRow(8, 10, 1000),
          visitRow(8, 12, 1200),
          visitRow(8, 8, 1400),
          visitRow(17, 30, 2000),
          visitRow(17, null, null),
        ],
      });
    });

    it('→ 200, agrégats corrects + métering ANALYTICS', async () => {
      const res = await http()
        .get(`/api/quartiers/${quartierId}/analytics`)
        .set(auth(apiKeyValue))
        .expect(200);

      expect(res.body.data).toMatchObject({
        quartierId,
        quartierName: 'Test Analytics',
        totalVisits: 5,
        medianEtaMinutes: 11,
        medianPriceFCFA: 1300,
        peakHours: ['08:00-09:00', '17:00-18:00'],
        successRate: 0.8,
        period: 'last_30_days',
      });

      const logged = await prisma.apiRequestLog.count({
        where: { apiKey: { key: apiKeyValue }, endpoint: 'ANALYTICS' },
      });
      expect(logged).toBeGreaterThanOrEqual(1);
    });

    it('clé révoquée → 401 API_KEY_REVOKED', async () => {
      await prisma.apiKey.update({
        where: { key: apiKeyValue },
        data: { status: 'REVOKED' },
      });
      const res = await http()
        .get(`/api/quartiers/${quartierId}/analytics`)
        .set(auth(apiKeyValue))
        .expect(401);
      expect(res.body.code).toBe('API_KEY_REVOKED');
      await prisma.apiKey.update({
        where: { key: apiKeyValue },
        data: { status: 'ACTIVE' },
      });
    });
  });
});
