// Base de test isolée — défini AVANT le chargement d'AppModule/ConfigModule.
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

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const phone = '+22997123456';
  const email = 'habitant.e2e@example.com';
  const password = 'motdepasse123';

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
    await prisma.otpCode.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { email } });
  });

  afterAll(async () => {
    await prisma.otpCode.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('parcours complet : request-otp → register → login', async () => {
    await http().post('/api/auth/request-otp').send({ phone }).expect(200);

    const otp = await prisma.otpCode.findFirst({
      where: { phone, used: false },
      orderBy: { createdAt: 'desc' },
    });
    expect(otp).toBeTruthy();

    const reg = await http()
      .post('/api/auth/register')
      .send({ phone, code: otp!.code, email, password, firstName: 'Test' })
      .expect(201);
    expect(reg.body.data.token).toBeDefined();
    expect(reg.body.data.user.role).toBe('HABITANT');

    const login = await http()
      .post('/api/auth/login')
      .send({ phone, password })
      .expect(200);
    expect(login.body.data.token).toBeDefined();
  });

  it('register échoue avec un OTP invalide (401)', async () => {
    const res = await http()
      .post('/api/auth/register')
      .send({
        phone: '+22998000000',
        code: '000000',
        email: 'nobody@example.com',
        password,
      })
      .expect(401);
    expect(res.body.code).toBe('OTP_INVALID');
  });

  it('login refuse un mauvais mot de passe (401)', async () => {
    const res = await http()
      .post('/api/auth/login')
      .send({ phone, password: 'mauvais-mdp' })
      .expect(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('login refuse un compte suspendu (403)', async () => {
    await prisma.user.update({
      where: { phone },
      data: { status: 'SUSPENDED' },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ phone, password })
      .expect(403);
    expect(res.body.code).toBe('ACCOUNT_NOT_ACTIVE');
    await prisma.user.update({ where: { phone }, data: { status: 'ACTIVE' } });
  });

  it('refuse un champ inconnu (whitelist, 400)', async () => {
    await http()
      .post('/api/auth/request-otp')
      .send({ phone, hacker: true })
      .expect(400);
  });
});
