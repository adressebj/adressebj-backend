process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://postgres:postgres@localhost:5432/adressebj_test?schema=public';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = '999888777';
process.env.CLOUDINARY_API_SECRET = 'e2e-secret';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let habToken: string;

  const habPhone = '+22993007001';
  const habEmail = 'upload.hab.e2e@example.com';
  const password = 'motdepasse123';

  const http = () => request(app.getHttpServer());

  async function cleanup() {
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
    habToken = (
      await http()
        .post('/api/auth/register')
        .send({ phone: habPhone, code: otp!.code, email: habEmail, password })
    ).body.data.token;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('POST /upload/signature (JWT) → 200, charge utile signée', async () => {
    const res = await http()
      .post('/api/upload/signature')
      .set('Authorization', `Bearer ${habToken}`)
      .expect(200);

    expect(res.body.data).toMatchObject({
      apiKey: '999888777',
      cloudName: 'test-cloud',
      folder: 'adressebj/portals',
      transformation: 'q_auto,f_auto',
    });
    expect(res.body.data.signature).toBeTruthy();

    // La signature doit correspondre au sha1 Cloudinary des paramètres signés.
    const { folder, transformation, timestamp, signature } = res.body.data;
    const toSign = `folder=${folder}&timestamp=${timestamp}&transformation=${transformation}`;
    const expected = createHash('sha1')
      .update(toSign + 'e2e-secret')
      .digest('hex');
    expect(signature).toBe(expected);
  });

  it('sans JWT → 401', async () => {
    await http().post('/api/upload/signature').expect(401);
  });
});
