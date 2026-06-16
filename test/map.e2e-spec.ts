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

describe('Map browsable layer (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let habToken: string;
  let modToken: string;
  let commerceCode: string;
  let domicileCode: string;
  let hiddenCode: string;
  let unpublishedCode: string;
  let outsideCode: string;

  const phone = '+22997000999';
  const habEmail = 'map.hab.e2e@example.com';
  const modEmail = 'map.mod.e2e@example.com';
  const password = 'motdepasse123';
  const prefix = 'TMAP';

  // Bounding box du test
  const bbox = { north: 6.41, south: 6.4, east: 2.41, west: 2.4 };
  const insideCommerce = { gpsLat: 6.405, gpsLng: 2.405 };
  const insideDomicile = { gpsLat: 6.4065, gpsLng: 2.4065 };
  const insideHidden = { gpsLat: 6.408, gpsLng: 2.408 };
  const insideUnpub = { gpsLat: 6.4045, gpsLng: 2.402 };
  const outside = { gpsLat: 6.3, gpsLng: 2.3 };

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function createAddress(
    gps: { gpsLat: number; gpsLng: number },
    category: string,
  ): Promise<string> {
    const res = await http()
      .post('/api/addresses')
      .set(auth(habToken))
      .send({
        category,
        steps: ['Repère'],
        photoUrl: 'https://example.com/p.jpg',
        ...gps,
      })
      .expect(201);
    return res.body.data.code as string;
  }

  async function approve(code: string): Promise<void> {
    const rev = await prisma.addressRevision.findFirst({
      where: { address: { code }, status: 'EN_ATTENTE_VALIDATION' },
    });
    await http()
      .patch(`/api/moderation/revisions/${rev!.id}/approve`)
      .set(auth(modToken))
      .expect(200);
  }

  async function cleanup() {
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
      data: { name: 'Test Map', prefix, centerLat: 6.405, centerLng: 2.405 },
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

    commerceCode = await createAddress(insideCommerce, 'COMMERCE');
    domicileCode = await createAddress(insideDomicile, 'DOMICILE');
    hiddenCode = await createAddress(insideHidden, 'COMMERCE');
    unpublishedCode = await createAddress(insideUnpub, 'COMMERCE');
    outsideCode = await createAddress(outside, 'COMMERCE');

    await approve(commerceCode);
    await approve(domicileCode);
    await approve(hiddenCode);
    await approve(outsideCode);
    // unpublishedCode reste EN_ATTENTE (non validée)

    // hiddenCode retiré de la carte
    await http()
      .patch(`/api/addresses/${hiddenCode}/discoverable`)
      .set(auth(habToken))
      .send({ discoverable: false })
      .expect(200);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const mapUrl = (extra = '') =>
    `/api/map/addresses?north=${bbox.north}&south=${bbox.south}&east=${bbox.east}&west=${bbox.west}${extra}`;

  it('retourne les adresses publiées + découvrables de la bbox avec la matrice de visibilité', async () => {
    const res = await http().get(mapUrl()).expect(200);
    const markers = res.body.data as Array<{
      code: string;
      muted: boolean;
      preview: unknown;
    }>;
    const byCode = (c: string) => markers.find((m) => m.code === c);

    // commerce : visible, preview rempli
    expect(byCode(commerceCode)).toMatchObject({
      muted: false,
      preview: { code: commerceCode },
    });
    // domicile : muet, sans preview
    expect(byCode(domicileCode)).toMatchObject({ muted: true, preview: null });

    // exclusions
    expect(byCode(hiddenCode)).toBeUndefined(); // mapDiscoverable=false
    expect(byCode(unpublishedCode)).toBeUndefined(); // jamais publiée
    expect(byCode(outsideCode)).toBeUndefined(); // hors bbox
  });

  it('filtre par catégorie', async () => {
    const res = await http().get(mapUrl('&category=DOMICILE')).expect(200);
    const codes = (res.body.data as Array<{ code: string }>).map((m) => m.code);
    expect(codes).toContain(domicileCode);
    expect(codes).not.toContain(commerceCode);
  });

  it('bounding box invalide → 400 INVALID_BOUNDING_BOX', async () => {
    const res = await http()
      .get('/api/map/addresses?north=6.3&south=6.4&east=2.41&west=2.4')
      .expect(400);
    expect(res.body.code).toBe('INVALID_BOUNDING_BOX');
  });

  it('paramètres manquants → 400 (validation)', async () => {
    await http().get('/api/map/addresses?north=6.41&south=6.4').expect(400);
  });

  it('accessible sans authentification', async () => {
    await http().get(mapUrl()).expect(200);
  });
});
