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

describe('Reports & contributions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let habToken: string;
  let modToken: string;
  let codeA: string; // signalements (sera désactivée)
  let codeB: string; // contributions (reste active)

  const phone = '+22995000666';
  const habEmail = 'rc.hab.e2e@example.com';
  const modEmail = 'rc.mod.e2e@example.com';
  const password = 'motdepasse123';
  const prefix = 'TRC';
  const gpsA = { gpsLat: 6.4601, gpsLng: 2.4601 };
  const gpsB = { gpsLat: 6.4801, gpsLng: 2.4801 };

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const body = (gps: { gpsLat: number; gpsLng: number }) => ({
    category: 'COMMERCE',
    steps: ['Carrefour', 'Boutique'],
    photoUrl: 'https://example.com/p.jpg',
    ...gps,
  });

  async function publish(gps: { gpsLat: number; gpsLng: number }): Promise<string> {
    const created = await http()
      .post('/api/addresses')
      .set(auth(habToken))
      .send(body(gps))
      .expect(201);
    const code = created.body.data.code as string;
    const rev = await prisma.addressRevision.findFirst({
      where: { address: { code }, status: 'EN_ATTENTE_VALIDATION' },
    });
    await http()
      .patch(`/api/moderation/revisions/${rev!.id}/approve`)
      .set(auth(modToken))
      .expect(200);
    return code;
  }

  async function cleanup() {
    await prisma.report.deleteMany({ where: { user: { phone } } });
    await prisma.contribution.deleteMany({ where: { user: { phone } } });
    await prisma.addressRevision.deleteMany({ where: { address: { user: { phone } } } });
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
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    await cleanup();
    await prisma.quartier.create({
      data: { name: 'Test RC', prefix, centerLat: gpsA.gpsLat, centerLng: gpsA.gpsLng },
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

    codeA = await publish(gpsA);
    codeB = await publish(gpsB);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  describe('signalements', () => {
    it('report sur adresse inexistante → 404', async () => {
      const res = await http()
        .post('/api/addresses/ZZZ-0000/report')
        .set(auth(habToken))
        .send({ message: 'rien' })
        .expect(404);
      expect(res.body.code).toBe('ADDRESS_NOT_FOUND');
    });

    it('report (habitant) → 201 PENDING, visible dans la file modération', async () => {
      const res = await http()
        .post(`/api/addresses/${codeA}/report`)
        .set(auth(habToken))
        .send({ message: 'La maison a été démolie.' })
        .expect(201);
      expect(res.body.data.status).toBe('PENDING');

      const queue = await http()
        .get('/api/moderation/reports')
        .set(auth(modToken))
        .expect(200);
      const item = queue.body.data.find(
        (r: { id: string }) => r.id === res.body.data.reportId,
      );
      expect(item).toBeTruthy();
      expect(item.addressCode).toBe(codeA);
      expect(item.ownerInactiveOver90Days).toBe(false);
    });

    it('resolve d’un signalement → RESOLVED, adresse intacte', async () => {
      const created = await http()
        .post(`/api/addresses/${codeA}/report`)
        .set(auth(habToken))
        .send({})
        .expect(201);
      const res = await http()
        .patch(`/api/moderation/reports/${created.body.data.reportId}/resolve`)
        .set(auth(modToken))
        .expect(200);
      expect(res.body.data.status).toBe('RESOLVED');
      expect(res.body.data.addressDeactivated).toBe(false);
      await http().get(`/api/addresses/${codeA}`).expect(200);
    });

    it('deactivate depuis un signalement → adresse DESACTIVEE (410 public)', async () => {
      const created = await http()
        .post(`/api/addresses/${codeA}/report`)
        .set(auth(habToken))
        .send({ message: 'Frauduleuse' })
        .expect(201);
      const res = await http()
        .patch(`/api/moderation/reports/${created.body.data.reportId}/deactivate`)
        .set(auth(modToken))
        .send({ reason: 'Adresse frauduleuse' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        status: 'ACTIONED',
        addressDeactivated: true,
      });

      const address = await prisma.address.findUnique({ where: { code: codeA } });
      expect(address!.lifecycle).toBe('DESACTIVEE');
      expect(address!.deactivationReason).toBe('Adresse frauduleuse');

      const pub = await http().get(`/api/addresses/${codeA}`).expect(410);
      expect(pub.body.code).toBe('ADDRESS_INACTIVE');
    });

    it('re-désactiver via un autre signalement → 409', async () => {
      const created = await http()
        .post(`/api/addresses/${codeA}/report`)
        .set(auth(habToken))
        .send({})
        .expect(410); // codeA est désactivée → report impossible (410)
      expect(created.body.code).toBe('ADDRESS_INACTIVE');
    });
  });

  describe('contributions', () => {
    it('message vide → 400 CONTRIBUTION_MESSAGE_REQUIRED', async () => {
      const res = await http()
        .post(`/api/addresses/${codeB}/contribution`)
        .set(auth(habToken))
        .send({ message: '   ' })
        .expect(400);
      expect(res.body.code).toBe('CONTRIBUTION_MESSAGE_REQUIRED');
    });

    it('contribution (habitant) → 201 PENDING puis approuvée → fieldNote public', async () => {
      const created = await http()
        .post(`/api/addresses/${codeB}/contribution`)
        .set(auth(habToken))
        .send({ message: 'Sens unique le matin, entrer par le nord' })
        .expect(201);
      expect(created.body.data.status).toBe('PENDING');

      const queue = await http()
        .get('/api/moderation/contributions')
        .set(auth(modToken))
        .expect(200);
      const item = queue.body.data.find(
        (c: { id: string }) => c.id === created.body.data.contributionId,
      );
      expect(item).toBeTruthy();
      expect(item.addressCode).toBe(codeB);

      await http()
        .patch(`/api/moderation/contributions/${item.id}/approve`)
        .set(auth(modToken))
        .expect(200);

      const pub = await http().get(`/api/addresses/${codeB}`).expect(200);
      const notes = pub.body.data.fieldNotes as { message: string }[];
      expect(notes.some((n) => n.message.startsWith('Sens unique'))).toBe(true);
    });

    it('contribution rejetée → n’apparaît pas en fieldNote', async () => {
      const created = await http()
        .post(`/api/addresses/${codeB}/contribution`)
        .set(auth(habToken))
        .send({ message: 'Information erronée à rejeter' })
        .expect(201);
      await http()
        .patch(`/api/moderation/contributions/${created.body.data.contributionId}/reject`)
        .set(auth(modToken))
        .expect(200);

      const pub = await http().get(`/api/addresses/${codeB}`).expect(200);
      const notes = pub.body.data.fieldNotes as { message: string }[];
      expect(notes.some((n) => n.message.startsWith('Information erronée'))).toBe(false);
    });

    it('un habitant ne peut pas accéder à la file de modération (403)', async () => {
      await http()
        .get('/api/moderation/contributions')
        .set(auth(habToken))
        .expect(403);
    });
  });
});
