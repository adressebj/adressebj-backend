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

describe('Address edit lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let intruderToken: string;
  let modToken: string;
  let code: string;

  const phone = '+22996000777';
  const phone2 = '+22996000888';
  const ownerEmail = 'edit.owner.e2e@example.com';
  const intruderEmail = 'edit.intruder.e2e@example.com';
  const modEmail = 'edit.mod.e2e@example.com';
  const password = 'motdepasse123';
  const prefix = 'TEDT';
  const gps = { gpsLat: 6.5001, gpsLng: 2.5001 };

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const createBody = {
    category: 'COMMERCE',
    steps: ['Carrefour', 'Boutique'],
    photoUrl: 'https://example.com/p.jpg',
    ...gps,
  };
  const editBody = {
    category: 'COMMERCE',
    steps: ['Nouveau repère', 'Portail vert'],
    photoUrl: 'https://example.com/new.jpg',
  };

  async function approvePending(): Promise<void> {
    const rev = await prisma.addressRevision.findFirst({
      where: { address: { code }, status: 'EN_ATTENTE_VALIDATION' },
    });
    await http()
      .patch(`/api/moderation/revisions/${rev!.id}/approve`)
      .set(auth(modToken))
      .expect(200);
  }

  async function registerHabitant(p: string, email: string): Promise<string> {
    await http().post('/api/auth/request-otp').send({ phone: p });
    const otp = await prisma.otpCode.findFirst({
      where: { phone: p, used: false },
      orderBy: { createdAt: 'desc' },
    });
    return (
      await http()
        .post('/api/auth/register')
        .send({ phone: p, code: otp!.code, email, password })
    ).body.data.token;
  }

  async function cleanup() {
    const phones = [phone, phone2];
    await prisma.addressRevision.deleteMany({ where: { address: { user: { phone: { in: phones } } } } });
    await prisma.address.deleteMany({ where: { user: { phone: { in: phones } } } });
    await prisma.localisation.deleteMany({ where: { quartier: { prefix } } });
    await prisma.otpCode.deleteMany({ where: { phone: { in: phones } } });
    await prisma.user.deleteMany({ where: { phone: { in: phones } } });
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
      data: { name: 'Test Edit', prefix, centerLat: gps.gpsLat, centerLng: gps.gpsLng },
    });

    ownerToken = await registerHabitant(phone, ownerEmail);
    intruderToken = await registerHabitant(phone2, intruderEmail);

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
      await http().post('/api/addresses').set(auth(ownerToken)).send(createBody).expect(201)
    ).body.data.code;
    await approvePending(); // publie la révision n°1
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('modification → nouvelle révision EN_ATTENTE, public garde l’ancienne version', async () => {
    const res = await http()
      .patch(`/api/addresses/${code}`)
      .set(auth(ownerToken))
      .send(editBody)
      .expect(200);
    expect(res.body.data).toMatchObject({
      code,
      revisionStatus: 'EN_ATTENTE_VALIDATION',
      published: true,
    });

    const pub = await http().get(`/api/addresses/${code}`).expect(200);
    expect(pub.body.data.assembledText).toBe('Carrefour. Boutique.');
  });

  it('2ᵉ modification tant qu’une révision est en attente → 409', async () => {
    const res = await http()
      .patch(`/api/addresses/${code}`)
      .set(auth(ownerToken))
      .send(editBody)
      .expect(409);
    expect(res.body.code).toBe('REVISION_ALREADY_PENDING');
  });

  it('après validation, le public voit la nouvelle version', async () => {
    await approvePending();
    const pub = await http().get(`/api/addresses/${code}`).expect(200);
    expect(pub.body.data.assembledText).toBe('Nouveau repère. Portail vert.');
  });

  it('un non-propriétaire ne peut pas modifier (403)', async () => {
    const res = await http()
      .patch(`/api/addresses/${code}`)
      .set(auth(intruderToken))
      .send(editBody)
      .expect(403);
    expect(res.body.code).toBe('NOT_ADDRESS_OWNER');
  });

  it('modifier une adresse inexistante → 404', async () => {
    await http()
      .patch('/api/addresses/ZZZ-0000')
      .set(auth(ownerToken))
      .send(editBody)
      .expect(404);
  });

  it('toggle discoverable (propriétaire) → reflété dans /mine', async () => {
    const res = await http()
      .patch(`/api/addresses/${code}/discoverable`)
      .set(auth(ownerToken))
      .send({ discoverable: false })
      .expect(200);
    expect(res.body.data).toEqual({ code, mapDiscoverable: false });

    const mine = await http().get('/api/addresses/mine').set(auth(ownerToken)).expect(200);
    expect(mine.body.data.find((a: { code: string }) => a.code === code).mapDiscoverable).toBe(false);
  });

  it('toggle discoverable par un non-propriétaire → 403', async () => {
    await http()
      .patch(`/api/addresses/${code}/discoverable`)
      .set(auth(intruderToken))
      .send({ discoverable: true })
      .expect(403);
  });

  it('désactivation par le propriétaire → DESACTIVEE, public 410', async () => {
    const res = await http()
      .delete(`/api/addresses/${code}`)
      .set(auth(ownerToken))
      .expect(200);
    expect(res.body.data).toEqual({ code, lifecycle: 'DESACTIVEE' });

    const pub = await http().get(`/api/addresses/${code}`).expect(410);
    expect(pub.body.code).toBe('ADDRESS_INACTIVE');
  });

  it('re-désactivation → 409, et modification impossible → 409', async () => {
    const del = await http().delete(`/api/addresses/${code}`).set(auth(ownerToken)).expect(409);
    expect(del.body.code).toBe('ADDRESS_ALREADY_DEACTIVATED');

    const upd = await http()
      .patch(`/api/addresses/${code}`)
      .set(auth(ownerToken))
      .send(editBody)
      .expect(409);
    expect(upd.body.code).toBe('ADDRESS_ALREADY_DEACTIVATED');
  });
});
