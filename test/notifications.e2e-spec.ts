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

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let habToken: string;
  let habId: string;

  const habPhone = '+22993008001';
  const habEmail = 'notif.hab.e2e@example.com';
  const password = 'motdepasse123';
  const endpoint = 'https://fcm.googleapis.com/fcm/send/e2e-abc';

  const http = () => request(app.getHttpServer());

  async function cleanup() {
    const user = await prisma.user.findUnique({ where: { phone: habPhone } });
    if (user) {
      await prisma.pushSubscription.deleteMany({ where: { userId: user.id } });
      await prisma.notification.deleteMany({ where: { userId: user.id } });
    }
    await prisma.otpCode.deleteMany({ where: { phone: habPhone } });
    await prisma.user.deleteMany({ where: { phone: habPhone } });
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
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('POST /notifications/subscribe (JWT) → 201, abonnement persisté', async () => {
    const res = await http()
      .post('/api/notifications/subscribe')
      .set('Authorization', `Bearer ${habToken}`)
      .send({ endpoint, keys: { p256dh: 'p256-key', auth: 'auth-key' } })
      .expect(201);

    expect(res.body.data).toEqual({ subscribed: true });
    const sub = await prisma.pushSubscription.findUnique({
      where: { endpoint },
    });
    expect(sub?.userId).toBe(habId);
  });

  it('POST /notifications/subscribe — ré-abonnement idempotent (upsert)', async () => {
    await http()
      .post('/api/notifications/subscribe')
      .set('Authorization', `Bearer ${habToken}`)
      .send({ endpoint, keys: { p256dh: 'p256-key-2', auth: 'auth-key-2' } })
      .expect(201);

    const count = await prisma.pushSubscription.count({ where: { endpoint } });
    expect(count).toBe(1);
  });

  it('GET /notifications (JWT) → 200, liste (vide au départ)', async () => {
    const res = await http()
      .get('/api/notifications')
      .set('Authorization', `Bearer ${habToken}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it('GET /notifications reflète une notification persistée', async () => {
    await prisma.notification.create({
      data: {
        userId: habId,
        type: 'ADDRESS_VALIDATED',
        message: 'Votre adresse a été validée.',
      },
    });
    const res = await http()
      .get('/api/notifications')
      .set('Authorization', `Bearer ${habToken}`)
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      type: 'ADDRESS_VALIDATED',
      addressCode: null,
    });
  });

  it('DELETE /notifications/unsubscribe (JWT) → 200, abonnement supprimé', async () => {
    const res = await http()
      .delete('/api/notifications/unsubscribe')
      .set('Authorization', `Bearer ${habToken}`)
      .send({ endpoint })
      .expect(200);
    expect(res.body.data).toEqual({ unsubscribed: true });
    const sub = await prisma.pushSubscription.findUnique({
      where: { endpoint },
    });
    expect(sub).toBeNull();
  });

  it('sans JWT → 401', async () => {
    await http().get('/api/notifications').expect(401);
    await http()
      .post('/api/notifications/subscribe')
      .send({ endpoint, keys: { p256dh: 'x', auth: 'y' } })
      .expect(401);
  });
});
