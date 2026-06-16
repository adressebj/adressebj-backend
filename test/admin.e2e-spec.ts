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

describe('Admin (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let habToken: string;
  let habId: string;
  let createdQuartierId: string; // quartier créé via l'endpoint admin
  let moderatorId: string;
  let apiKeyId: string;
  let apiKeyValue: string;
  let addressCode: string;

  const adminEmail = 'admin.e2e@example.com';
  const habPhone = '+22993002001';
  const habEmail = 'admin.hab.e2e@example.com';
  const modEmail = 'admin.mod.e2e@example.com';
  const password = 'motdepasse123';
  const prefix = 'TADM';
  const prefix2 = 'TAD2';
  const gps = { gpsLat: 6.4401, gpsLng: 2.4401 };

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function cleanup() {
    await prisma.apiRequestLog.deleteMany({
      where: { apiKey: { label: { startsWith: 'E2E admin' } } },
    });
    await prisma.apiKey.deleteMany({
      where: { label: { startsWith: 'E2E admin' } },
    });
    await prisma.addressRevision.deleteMany({
      where: { address: { user: { phone: habPhone } } },
    });
    await prisma.address.deleteMany({ where: { user: { phone: habPhone } } });
    await prisma.localisation.deleteMany({
      where: { quartier: { prefix: { in: [prefix, prefix2] } } },
    });
    await prisma.otpCode.deleteMany({ where: { phone: habPhone } });
    await prisma.user.deleteMany({ where: { phone: habPhone } });
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, modEmail, habEmail] } },
    });
    await prisma.quartier.deleteMany({
      where: { prefix: { in: [prefix, prefix2] } },
    });
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
        name: 'Test Admin',
        prefix,
        centerLat: gps.gpsLat,
        centerLng: gps.gpsLng,
      },
    });

    await prisma.user.create({
      data: {
        email: adminEmail,
        password: await bcrypt.hash(password, 4),
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    adminToken = (
      await http().post('/api/auth/login').send({ email: adminEmail, password })
    ).body.data.token;

    await http().post('/api/auth/request-otp').send({ phone: habPhone });
    const otp = await prisma.otpCode.findFirst({
      where: { phone: habPhone, used: false },
      orderBy: { createdAt: 'desc' },
    });
    const reg = await http()
      .post('/api/auth/register')
      .send({ phone: habPhone, code: otp!.code, email: habEmail, password });
    habToken = reg.body.data.token;
    habId = reg.body.data.user.id;

    addressCode = (
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
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('RBAC : un habitant sur une route admin → 403 INSUFFICIENT_ROLE', async () => {
    const res = await http()
      .get('/api/admin/addresses')
      .set(auth(habToken))
      .expect(403);
    expect(res.body.code).toBe('INSUFFICIENT_ROLE');
  });

  describe('quartiers', () => {
    it('POST /admin/quartiers → 201', async () => {
      const res = await http()
        .post('/api/admin/quartiers')
        .set(auth(adminToken))
        .send({ name: 'Nouveau', prefix: prefix2 })
        .expect(201);
      expect(res.body.data.prefix).toBe(prefix2);
      createdQuartierId = res.body.data.id;
    });

    it('préfixe déjà pris → 409 QUARTIER_PREFIX_TAKEN', async () => {
      const res = await http()
        .post('/api/admin/quartiers')
        .set(auth(adminToken))
        .send({ name: 'Doublon', prefix: prefix2 })
        .expect(409);
      expect(res.body.code).toBe('QUARTIER_PREFIX_TAKEN');
    });

    it('PATCH /admin/quartiers/:id → désactive', async () => {
      const res = await http()
        .patch(`/api/admin/quartiers/${createdQuartierId}`)
        .set(auth(adminToken))
        .send({ isActive: false, name: 'Renommé' })
        .expect(200);
      expect(res.body.data.isActive).toBe(false);
      expect(res.body.data.name).toBe('Renommé');
    });
  });

  describe('modérateurs', () => {
    let modToken: string;

    it('POST /admin/moderators → 201 et le compte peut se connecter', async () => {
      const res = await http()
        .post('/api/admin/moderators')
        .set(auth(adminToken))
        .send({ email: modEmail, password })
        .expect(201);
      expect(res.body.data).toMatchObject({
        role: 'MODERATEUR',
        status: 'ACTIVE',
      });
      expect(res.body.data).not.toHaveProperty('password');
      moderatorId = res.body.data.id;

      modToken = (
        await http().post('/api/auth/login').send({ email: modEmail, password })
      ).body.data.token;
      expect(modToken).toBeTruthy();
    });

    it('email déjà pris → 409', async () => {
      const res = await http()
        .post('/api/admin/moderators')
        .set(auth(adminToken))
        .send({ email: modEmail, password })
        .expect(409);
      expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('le modérateur peut publier la révision n°1 de l’habitant', async () => {
      const rev = await prisma.addressRevision.findFirst({
        where: {
          address: { code: addressCode },
          status: 'EN_ATTENTE_VALIDATION',
        },
      });
      await http()
        .patch(`/api/moderation/revisions/${rev!.id}/approve`)
        .set(auth(modToken))
        .expect(200);
    });

    it('désactiver → le modérateur ne peut plus se connecter (403)', async () => {
      await http()
        .patch(`/api/admin/moderators/${moderatorId}`)
        .set(auth(adminToken))
        .send({ action: 'deactivate' })
        .expect(200);
      const res = await http()
        .post('/api/auth/login')
        .send({ email: modEmail, password })
        .expect(403);
      expect(res.body.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('réactiver + réinitialiser le mot de passe → connexion avec le nouveau', async () => {
      await http()
        .patch(`/api/admin/moderators/${moderatorId}`)
        .set(auth(adminToken))
        .send({ action: 'reactivate' })
        .expect(200);
      await http()
        .patch(`/api/admin/moderators/${moderatorId}`)
        .set(auth(adminToken))
        .send({ action: 'reset', password: 'nouveaupass1' })
        .expect(200);
      const res = await http()
        .post('/api/auth/login')
        .send({ email: modEmail, password: 'nouveaupass1' })
        .expect(200);
      expect(res.body.data.token).toBeTruthy();
    });

    it('reset sans mot de passe → 400 PASSWORD_REQUIRED', async () => {
      const res = await http()
        .patch(`/api/admin/moderators/${moderatorId}`)
        .set(auth(adminToken))
        .send({ action: 'reset' })
        .expect(400);
      expect(res.body.code).toBe('PASSWORD_REQUIRED');
    });
  });

  describe('supervision référentiel', () => {
    it('GET /admin/addresses filtre par code et renvoie une page', async () => {
      const res = await http()
        .get('/api/admin/addresses?code=' + prefix + '&page=1&limit=10')
        .set(auth(adminToken))
        .expect(200);
      expect(res.body.data).toMatchObject({ page: 1, limit: 10 });
      expect(res.body.data.total).toBeGreaterThanOrEqual(1);
      const row = res.body.data.items.find((i: any) => i.code === addressCode);
      expect(row).toMatchObject({ published: true, quartier: { prefix } });
    });
  });

  describe('suspension d’habitant', () => {
    it('suspend → l’habitant ne peut plus agir (401 ACCOUNT_NOT_ACTIVE)', async () => {
      const res = await http()
        .patch(`/api/admin/users/${habId}/suspend`)
        .set(auth(adminToken))
        .send({ reason: 'abus' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        status: 'SUSPENDED',
        suspendedReason: 'abus',
      });

      const blocked = await http()
        .get('/api/addresses/mine')
        .set(auth(habToken))
        .expect(401);
      expect(blocked.body.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('unsuspend → l’habitant peut de nouveau agir', async () => {
      const res = await http()
        .patch(`/api/admin/users/${habId}/unsuspend`)
        .set(auth(adminToken))
        .expect(200);
      expect(res.body.data).toMatchObject({
        status: 'ACTIVE',
        suspendedReason: null,
      });

      await http().get('/api/addresses/mine').set(auth(habToken)).expect(200);
    });

    it('suspendre un non-habitant (le modérateur) → 404 USER_NOT_FOUND', async () => {
      const res = await http()
        .patch(`/api/admin/users/${moderatorId}/suspend`)
        .set(auth(adminToken))
        .send({})
        .expect(404);
      expect(res.body.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('clés API', () => {
    it('POST /admin/api-keys → 201, clé bj_live_ exploitable', async () => {
      const res = await http()
        .post('/api/admin/api-keys')
        .set(auth(adminToken))
        .send({ label: 'E2E admin key' })
        .expect(201);
      expect(res.body.data.key).toMatch(/^bj_live_.{16}$/);
      apiKeyId = res.body.data.id;
      apiKeyValue = res.body.data.key;

      // La clé fonctionne sur un endpoint intégrateur.
      await http()
        .get(`/api/addresses/${addressCode}/resolve`)
        .set(auth(apiKeyValue))
        .expect(200);
    });

    it('DELETE /admin/api-keys/:id → révoquée, puis 401 API_KEY_REVOKED', async () => {
      const res = await http()
        .delete(`/api/admin/api-keys/${apiKeyId}`)
        .set(auth(adminToken))
        .expect(200);
      expect(res.body.data.status).toBe('REVOKED');

      const blocked = await http()
        .get(`/api/addresses/${addressCode}/resolve`)
        .set(auth(apiKeyValue))
        .expect(401);
      expect(blocked.body.code).toBe('API_KEY_REVOKED');
    });

    it('révoquer une clé inconnue → 404 API_KEY_NOT_FOUND', async () => {
      const res = await http()
        .delete('/api/admin/api-keys/inexistante')
        .set(auth(adminToken))
        .expect(404);
      expect(res.body.code).toBe('API_KEY_NOT_FOUND');
    });
  });
});
