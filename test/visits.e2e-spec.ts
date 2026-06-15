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

describe('Visits (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let habToken: string;
  let modToken: string;
  let code: string;

  const phone = '+22998001100';
  const habEmail = 'visit.hab.e2e@example.com';
  const modEmail = 'visit.mod.e2e@example.com';
  const password = 'motdepasse123';
  const prefix = 'TVIS';
  const apiKeyValue = 'bj_live_e2evisitkey00001';
  const gps = { gpsLat: 6.5201, gpsLng: 2.5201 };
  const depart = '2026-05-17T09:00:00.000Z';
  const arrive = '2026-05-17T09:14:00.000Z';

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
        name: 'Test Visit',
        prefix,
        centerLat: gps.gpsLat,
        centerLng: gps.gpsLng,
      },
    });
    await prisma.apiKey.create({
      data: { key: apiKeyValue, label: 'E2E visit', status: 'ACTIVE' },
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
        .send({
          category: 'COMMERCE',
          steps: ['Carrefour'],
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
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('start (public) → 201 visitId', async () => {
    const res = await http()
      .post('/api/visits/start')
      .send({ addressCode: code, departAt: depart })
      .expect(201);
    expect(res.body.data.visitId).toBeTruthy();
  });

  it('start sur adresse inexistante → 404', async () => {
    const res = await http()
      .post('/api/visits/start')
      .send({ addressCode: 'ZZZ-0000', departAt: depart })
      .expect(404);
    expect(res.body.code).toBe('ADDRESS_NOT_FOUND');
  });

  it('confirm web → 201 recorded, arrivedAt posé, apiKeyId null', async () => {
    const started = await http()
      .post('/api/visits/start')
      .send({ addressCode: code, departAt: depart })
      .expect(201);
    const visitId = started.body.data.visitId;

    const res = await http()
      .post('/api/visits/confirm')
      .send({ visitId, arrivedAt: arrive })
      .expect(201);
    expect(res.body.data).toEqual({ visitId, recorded: true });

    const visit = await prisma.visit.findUnique({ where: { id: visitId } });
    expect(visit!.arrivedAt?.toISOString()).toBe(arrive);
    expect(visit!.apiKeyId).toBeNull();
  });

  it('confirm web avec arrivée avant départ → 400 INVALID_VISIT_TIMESTAMPS', async () => {
    const started = await http()
      .post('/api/visits/start')
      .send({ addressCode: code, departAt: depart })
      .expect(201);
    const res = await http()
      .post('/api/visits/confirm')
      .send({
        visitId: started.body.data.visitId,
        arrivedAt: '2026-05-17T08:00:00.000Z',
      })
      .expect(400);
    expect(res.body.code).toBe('INVALID_VISIT_TIMESTAMPS');
  });

  it('confirm web visite introuvable → 404', async () => {
    const res = await http()
      .post('/api/visits/confirm')
      .send({ visitId: 'inexistant', arrivedAt: arrive })
      .expect(404);
    expect(res.body.code).toBe('VISIT_NOT_FOUND');
  });

  it('confirm API (clé) → 201, visite avec apiKeyId + finalPrice, métering CONFIRM', async () => {
    const res = await http()
      .post('/api/visits/confirm')
      .set(auth(apiKeyValue))
      .send({
        addressCode: code,
        departAt: depart,
        arrivedAt: arrive,
        finalPrice: 1500,
      })
      .expect(201);
    expect(res.body.data.recorded).toBe(true);

    const visit = await prisma.visit.findUnique({
      where: { id: res.body.data.visitId },
    });
    expect(visit!.finalPrice).toBe(1500);
    expect(visit!.apiKeyId).toBeTruthy();

    const logged = await prisma.apiRequestLog.count({
      where: { apiKey: { key: apiKeyValue }, endpoint: 'CONFIRM' },
    });
    expect(logged).toBeGreaterThanOrEqual(1);
  });

  it('confirm API avec clé invalide → 401', async () => {
    const res = await http()
      .post('/api/visits/confirm')
      .set({ Authorization: 'Bearer bj_live_doesnotexist00' })
      .send({ addressCode: code, departAt: depart, arrivedAt: arrive })
      .expect(401);
    expect(res.body.code).toBe('API_KEY_INVALID');
  });
});
