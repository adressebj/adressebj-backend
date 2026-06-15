process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://postgres:postgres@localhost:5432/adressebj_test?schema=public';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Quartiers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = 'TST';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.quartier.upsert({
      where: { prefix },
      update: { isActive: true },
      create: {
        name: 'Quartier Test',
        prefix,
        centerLat: 6.37,
        centerLng: 2.42,
      },
    });
  });

  afterAll(async () => {
    await prisma.quartier.deleteMany({ where: { prefix } });
    await app.close();
  });

  it('GET /api/quartiers → liste les quartiers actifs (enveloppe data)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/quartiers')
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find(
      (q: { prefix: string }) => q.prefix === prefix,
    );
    expect(found).toMatchObject({ name: 'Quartier Test', prefix });
  });
});
