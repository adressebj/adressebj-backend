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
import { RoutingService } from '../src/common/routing/routing.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('ETA (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let habToken: string;
  let modToken: string;
  let code: string;

  const phone = '+22993000444';
  const habEmail = 'eta.hab.e2e@example.com';
  const modEmail = 'eta.mod.e2e@example.com';
  const password = 'motdepasse123';
  const prefix = 'TETA';
  const apiKeyValue = 'bj_live_e2eetakey000001';
  const gps = { gpsLat: 6.4101, gpsLng: 2.4101 };
  const payload = {
    category: 'COMMERCE',
    steps: ['Partir du carrefour', 'Boutique verte'],
    photoUrl: 'https://example.com/p.jpg',
    ...gps,
  };

  // RoutingService surchargé : pas d'appel réseau OSRM, réponse déterministe.
  const routingMock = {
    getEta: jest.fn().mockResolvedValue({
      etaMinutes: 12,
      distanceMeters: 5000,
      source: 'OSRM',
    }),
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
    })
      .overrideProvider(RoutingService)
      .useValue(routingMock)
      .compile();
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
        name: 'Test Eta',
        prefix,
        centerLat: gps.gpsLat,
        centerLng: gps.gpsLng,
      },
    });
    await prisma.apiKey.create({
      data: { key: apiKeyValue, label: 'E2E eta', status: 'ACTIVE' },
    });

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

    code = (
      await http()
        .post('/api/addresses')
        .set(auth(habToken))
        .send(payload)
        .expect(201)
    ).body.data.code;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('avant publication : eta → 404 (existence non exposée)', async () => {
    const res = await http()
      .get(`/api/addresses/${code}/eta?fromLat=6.40&fromLng=2.40`)
      .set(auth(apiKeyValue))
      .expect(404);
    expect(res.body.code).toBe('ADDRESS_NOT_FOUND');
  });

  it('eta sans clé API → 401 API_KEY_MISSING', async () => {
    const res = await http()
      .get(`/api/addresses/${code}/eta?fromLat=6.40&fromLng=2.40`)
      .expect(401);
    expect(res.body.code).toBe('API_KEY_MISSING');
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

    it('eta → 200, ETA + destination = GPS Localisation + métering ETA', async () => {
      const res = await http()
        .get(`/api/addresses/${code}/eta?fromLat=6.40&fromLng=2.40`)
        .set(auth(apiKeyValue))
        .expect(200);
      expect(res.body.data).toMatchObject({
        code,
        origin: { lat: 6.4, lng: 2.4 },
        destination: { lat: gps.gpsLat, lng: gps.gpsLng },
        etaMinutes: 12,
        distanceMeters: 5000,
        source: 'OSRM',
      });

      const logged = await prisma.apiRequestLog.count({
        where: { apiKey: { key: apiKeyValue }, endpoint: 'ETA' },
      });
      expect(logged).toBeGreaterThanOrEqual(1);
    });

    it('origine hors bornes → 400 (validation)', async () => {
      await http()
        .get(`/api/addresses/${code}/eta?fromLat=200&fromLng=2.40`)
        .set(auth(apiKeyValue))
        .expect(400);
    });

    it('origine manquante → 400 (validation)', async () => {
      await http()
        .get(`/api/addresses/${code}/eta?fromLat=6.40`)
        .set(auth(apiKeyValue))
        .expect(400);
    });

    it('désactivée → eta 410 ADDRESS_INACTIVE', async () => {
      await prisma.address.update({
        where: { code },
        data: { lifecycle: 'DESACTIVEE', deactivatedAt: new Date() },
      });
      const res = await http()
        .get(`/api/addresses/${code}/eta?fromLat=6.40&fromLng=2.40`)
        .set(auth(apiKeyValue))
        .expect(410);
      expect(res.body.code).toBe('ADDRESS_INACTIVE');
    });
  });
});
