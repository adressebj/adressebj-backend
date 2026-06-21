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

describe('Account (profile / phone / deletion) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let habToken: string;
  let userId: string;
  let addressId: string;

  const phone1 = '+22993001001';
  const phone2 = '+22993001002';
  const habEmail = 'acc.hab.e2e@example.com';
  const modEmail = 'acc.mod.e2e@example.com';
  const password = 'motdepasse123';
  const prefix = 'TACC';
  const gps = { gpsLat: 6.4301, gpsLng: 2.4301 };

  // Numéro courant du compte (évolue avec le changement de numéro).
  let currentPhone = phone1;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function latestOtp(phone: string): Promise<string> {
    const otp = await prisma.otpCode.findFirst({
      where: { phone, used: false },
      orderBy: { createdAt: 'desc' },
    });
    return otp!.code;
  }

  async function cleanup() {
    const phones = [phone1, phone2];
    await prisma.visit.deleteMany({
      where: { address: { user: { id: userId } } },
    });
    await prisma.rating.deleteMany({ where: { userId } });
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.pushSubscription.deleteMany({ where: { userId } });
    await prisma.addressRevision.deleteMany({
      where: { address: { userId } },
    });
    await prisma.address.deleteMany({ where: { userId } });
    await prisma.localisation.deleteMany({ where: { quartier: { prefix } } });
    await prisma.otpCode.deleteMany({ where: { phone: { in: phones } } });
    await prisma.user.deleteMany({ where: { phone: { in: phones } } });
    await prisma.user.deleteMany({
      where: { email: { in: [habEmail, modEmail] } },
    });
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

    userId = ''; // évite un cleanup sur undefined au tout premier appel
    await prisma.quartier.deleteMany({ where: { prefix } });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { phone: { in: [phone1, phone2] } },
          { email: { in: [habEmail, modEmail] } },
        ],
      },
    });

    await prisma.quartier.create({
      data: {
        name: 'Test Account',
        prefix,
        centerLat: gps.gpsLat,
        centerLng: gps.gpsLng,
      },
    });

    // Modérateur (fournit un email "déjà pris" pour le test de conflit).
    await prisma.user.create({
      data: {
        email: modEmail,
        password: await bcrypt.hash(password, 4),
        role: 'MODERATEUR',
        status: 'ACTIVE',
      },
    });
    const modToken = (
      await http().post('/api/auth/login').send({ email: modEmail, password })
    ).body.data.token;

    // Habitant + adresse publiée.
    await http().post('/api/auth/request-otp').send({ phone: phone1 });
    const reg = await http()
      .post('/api/auth/register')
      .send({
        phone: phone1,
        code: await latestOtp(phone1),
        email: habEmail,
        password,
        firstName: 'Awa',
      });
    habToken = reg.body.data.token;
    userId = reg.body.data.user.id;

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

  describe('PATCH /auth/profile', () => {
    it('sans JWT → 401', async () => {
      await http()
        .patch('/api/auth/profile')
        .send({ firstName: 'X' })
        .expect(401);
    });

    it('met à jour prénom + email → 200', async () => {
      const res = await http()
        .patch('/api/auth/profile')
        .set(auth(habToken))
        .send({ firstName: 'Awa2', email: 'acc.hab2.e2e@example.com' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        firstName: 'Awa2',
        email: 'acc.hab2.e2e@example.com',
      });
      expect(res.body.data).not.toHaveProperty('password');
    });

    it('email déjà pris par un autre compte → 409', async () => {
      const res = await http()
        .patch('/api/auth/profile')
        .set(auth(habToken))
        .send({ email: modEmail })
        .expect(409);
      expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    });
  });

  describe('PATCH /auth/phone', () => {
    it('OTP invalide → 401', async () => {
      const res = await http()
        .patch('/api/auth/phone')
        .set(auth(habToken))
        .send({ phone: phone2, code: '000000' })
        .expect(401);
      expect(res.body.code).toBe('OTP_INVALID');
    });

    it('change le numéro avec OTP valide → 200', async () => {
      await http().post('/api/auth/request-otp').send({ phone: phone2 });
      const res = await http()
        .patch('/api/auth/phone')
        .set(auth(habToken))
        .send({ phone: phone2, code: await latestOtp(phone2) })
        .expect(200);
      expect(res.body.data.phone).toBe(phone2);
      currentPhone = phone2;

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(user.phone).toBe(phone2);
    });
  });

  describe('DELETE /auth/account', () => {
    beforeAll(async () => {
      // Données personnelles + une évaluation (à conserver) à vérifier après anonymisation.
      await prisma.pushSubscription.create({
        data: {
          userId,
          endpoint: 'https://push.example/acc-e2e',
          p256dh: 'k',
          auth: 'a',
        },
      });
      await prisma.notification.create({
        data: { userId, type: 'ADDRESS_VALIDATED', message: 'ok' },
      });
      await prisma.rating.create({
        data: { userId, addressId, stars: 5 },
      });
    });

    it('téléphone non correspondant → 400 PHONE_MISMATCH', async () => {
      const res = await http()
        .delete('/api/auth/account')
        .set(auth(habToken))
        .send({ phone: '+22900000000' })
        .expect(400);
      expect(res.body.code).toBe('PHONE_MISMATCH');
    });

    it('anonymise le compte (tombstone) et nettoie en cascade', async () => {
      const res = await http()
        .delete('/api/auth/account')
        .set(auth(habToken))
        .send({ phone: currentPhone })
        .expect(200);
      expect(res.body.data).toMatchObject({ deleted: true });
      expect(res.body.data.anonymizedAt).toEqual(expect.any(String));

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(user.phone).toBeNull();
      expect(user.email).toBeNull();
      expect(user.password).toBeNull();
      expect(user.firstName).toBeNull();
      expect(user.lastName).toBeNull();
      expect(user.deletedAt).not.toBeNull();

      // Adresse désactivée, localisation purgée.
      const address = await prisma.address.findUniqueOrThrow({
        where: { id: addressId },
      });
      expect(address.lifecycle).toBe('DESACTIVEE');
      const locCount = await prisma.localisation.count({
        where: { quartier: { prefix } },
      });
      expect(locCount).toBe(0);

      // Données perso purgées.
      expect(await prisma.pushSubscription.count({ where: { userId } })).toBe(
        0,
      );
      expect(await prisma.notification.count({ where: { userId } })).toBe(0);
      expect(
        await prisma.otpCode.count({ where: { phone: currentPhone } }),
      ).toBe(0);

      // Évaluation conservée (intégrité référentielle vers la tombstone).
      expect(await prisma.rating.count({ where: { userId } })).toBe(1);
    });

    it('le JWT de la tombstone est désormais invalide → 401', async () => {
      await http()
        .patch('/api/auth/profile')
        .set(auth(habToken))
        .send({ firstName: 'Z' })
        .expect(401);
    });
  });
});
