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

describe('Moderation revisions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let habToken: string;
  let modToken: string;

  const phone = '+22992000222';
  const habEmail = 'mod.hab.e2e@example.com';
  const modEmail = 'mod.e2e@example.com';
  const password = 'motdepasse123';
  const prefixes = ['TMA', 'TMB'];
  const gpsA = { gpsLat: 6.5001, gpsLng: 2.5001 };
  const gpsB = { gpsLat: 7.2002, gpsLng: 2.9002 };

  const http = () => request(app.getHttpServer());
  const body = (gps: { gpsLat: number; gpsLng: number }) => ({
    category: 'DOMICILE',
    steps: ['Étape 1'],
    photoUrl: 'https://example.com/p.jpg',
    ...gps,
  });

  async function cleanup() {
    await prisma.addressRevision.deleteMany({
      where: { address: { user: { phone } } },
    });
    await prisma.address.deleteMany({ where: { user: { phone } } });
    await prisma.localisation.deleteMany({
      where: { quartier: { prefix: { in: prefixes } } },
    });
    await prisma.otpCode.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { email: modEmail } });
    await prisma.quartier.deleteMany({ where: { prefix: { in: prefixes } } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    await cleanup();
    await prisma.quartier.createMany({
      data: [
        { name: 'Mod A', prefix: prefixes[0], centerLat: gpsA.gpsLat, centerLng: gpsA.gpsLng },
        { name: 'Mod B', prefix: prefixes[1], centerLat: gpsB.gpsLat, centerLng: gpsB.gpsLng },
      ],
    });

    // Habitant
    await http().post('/api/auth/request-otp').send({ phone });
    const otp = await prisma.otpCode.findFirst({
      where: { phone, used: false },
      orderBy: { createdAt: 'desc' },
    });
    const reg = await http()
      .post('/api/auth/register')
      .send({ phone, code: otp!.code, email: habEmail, password });
    habToken = reg.body.data.token;

    // Modérateur (créé directement en base)
    await prisma.user.create({
      data: {
        email: modEmail,
        password: await bcrypt.hash(password, 4),
        role: 'MODERATEUR',
        status: 'ACTIVE',
      },
    });
    const modLogin = await http()
      .post('/api/auth/login')
      .send({ email: modEmail, password });
    modToken = modLogin.body.data.token;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('la file de modération est interdite à un habitant (403)', async () => {
    await http().get('/api/moderation/revisions').set(auth(habToken)).expect(403);
  });

  it('approbation : révision n°1 → PUBLIEE et pointeur basculé', async () => {
    const created = await http()
      .post('/api/addresses')
      .set(auth(habToken))
      .send(body(gpsA))
      .expect(201);
    const code = created.body.data.code;

    const queue = await http()
      .get('/api/moderation/revisions')
      .set(auth(modToken))
      .expect(200);
    const item = queue.body.data.find((r: { addressCode: string }) => r.addressCode === code);
    expect(item).toBeTruthy();
    expect(item.isFirstPublication).toBe(true);

    const approved = await http()
      .patch(`/api/moderation/revisions/${item.id}/approve`)
      .set(auth(modToken))
      .expect(200);
    expect(approved.body.data.status).toBe('PUBLIEE');

    const address = await prisma.address.findUnique({ where: { code } });
    expect(address!.publishedRevisionId).toBe(item.id);
  });

  it('rejet : révision → REJETEE, pointeur inchangé (null)', async () => {
    const created = await http()
      .post('/api/addresses')
      .set(auth(habToken))
      .send(body(gpsB))
      .expect(201);
    const code = created.body.data.code;
    const rev = await prisma.addressRevision.findFirst({
      where: { address: { code } },
    });

    const rejected = await http()
      .patch(`/api/moderation/revisions/${rev!.id}/reject`)
      .set(auth(modToken))
      .send({ reason: 'Photo illisible' })
      .expect(200);
    expect(rejected.body.data.status).toBe('REJETEE');

    const address = await prisma.address.findUnique({ where: { code } });
    expect(address!.publishedRevisionId).toBeNull();
  });

  it('rejet sans motif → 400', async () => {
    const rev = await prisma.addressRevision.findFirst({
      where: { address: { user: { phone } }, status: 'EN_ATTENTE_VALIDATION' },
    });
    // s'il n'y a plus de révision en attente, on en recrée une via une 2e adresse n'est pas nécessaire :
    // on teste la validation du DTO indépendamment de l'état.
    const targetId = rev?.id ?? 'whatever';
    await http()
      .patch(`/api/moderation/revisions/${targetId}/reject`)
      .set(auth(modToken))
      .send({ reason: '' })
      .expect(400);
  });
});
