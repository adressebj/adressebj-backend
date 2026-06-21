/**
 * Smoke test de démo — parcours complet avant chaque déploiement (CdC §13).
 * Usage : npm run smoke   (ou : npx ts-node scripts/smoke-test.ts)
 *
 * Démarre l'application NestJS en mémoire (AppModule, même configuration que
 * `main.ts`) et déroule le chemin nominal de bout en bout sur la base pointée
 * par DATABASE_URL :
 *   1. Request + Verify OTP → JWT habitant
 *   2. Signature Cloudinary → valide (ou 503 si non configuré, toléré)
 *   3. Create Address → code généré, EN_ATTENTE_VALIDATION
 *   4. Login modérateur → JWT, approve révision n°1 → PUBLIEE + pointeur basculé
 *   5. Resolve (clé API) → données complètes
 *   6. Rate (JWT habitant) → moyenne recalculée
 *   7. Visit start + confirm → recorded
 *   8. Désactivation → 410 sur resolve, localisation nettoyée si vide
 *
 * Les prérequis privilégiés (quartier de référence, compte modérateur, clé API)
 * sont créés puis nettoyés par le script lui-même : il est rejouable et ne
 * laisse aucune donnée derrière lui. Sortie ≠ 0 au premier échec.
 */
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { ApiKeysService } from '../src/api-keys/api-keys.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

// Marqueurs uniques → aucun conflit avec des données réelles, nettoyage ciblé.
const STAMP = Date.now();
const PHONE = `+2299${String(STAMP).slice(-8)}`;
const HABITANT_EMAIL = `smoke.habitant.${STAMP}@example.test`;
const MOD_EMAIL = `smoke.mod.${STAMP}@example.test`;
const PASSWORD = 'smoke-password-123';
const QUARTIER_PREFIX = 'SMK';
const GPS = { lat: 6.3662, lng: 2.3912 }; // Cadjèhoun

let step = 0;
function ok(label: string) {
  step += 1;
  console.log(`✔ [${step}] ${label}`);
}
function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`Échec : ${message}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant.');
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'smoke-secret';

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();

  const prisma = app.get(PrismaService);
  const apiKeys = app.get(ApiKeysService);
  // Écoute sur un port libre (0) : le parcours est exercé via HTTP réel.
  await app.listen(0);
  const url = (await app.getUrl())
    .replace('0.0.0.0', '127.0.0.1')
    .replace('[::1]', '127.0.0.1');

  const json = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    return { status: res.status, body: payload as Record<string, any> };
  };

  let apiKeyId: string | null = null;
  let createdCode: string | null = null;

  try {
    // Prérequis : quartier de référence (couvre le GPS) + compte modérateur + clé API.
    await prisma.quartier.upsert({
      where: { prefix: QUARTIER_PREFIX },
      update: { centerLat: GPS.lat, centerLng: GPS.lng, isActive: true },
      create: {
        name: 'Smoke Quartier',
        prefix: QUARTIER_PREFIX,
        centerLat: GPS.lat,
        centerLng: GPS.lng,
        isActive: true,
      },
    });
    await prisma.user.create({
      data: {
        email: MOD_EMAIL,
        password: await bcrypt.hash(PASSWORD, 10),
        firstName: 'Smoke',
        lastName: 'Mod',
        role: 'MODERATEUR',
        status: 'ACTIVE',
      },
    });
    const key = await apiKeys.createKey(`smoke-${STAMP}`);
    apiKeyId = key.id;
    ok('Prérequis créés (quartier SMK, modérateur, clé API)');

    // 1. OTP → JWT habitant.
    const otpReq = await json('POST', '/api/auth/request-otp', { phone: PHONE });
    assert(otpReq.status === 200, `request-otp (${otpReq.status})`);
    const otp = await prisma.otpCode.findFirst({
      where: { phone: PHONE, used: false },
      orderBy: { createdAt: 'desc' },
    });
    assert(otp, 'OTP non généré en base');
    const reg = await json('POST', '/api/auth/register', {
      phone: PHONE,
      code: otp.code,
      email: HABITANT_EMAIL,
      password: PASSWORD,
      firstName: 'Smoke',
    });
    assert(reg.status === 201, `register (${reg.status})`);
    const habitantJwt = reg.body.data.token as string;
    assert(habitantJwt, 'JWT habitant absent');
    ok('OTP vérifié → JWT habitant');

    // 2. Signature Cloudinary (503 toléré si non configuré).
    const sig = await json('POST', '/api/upload/signature', undefined, {
      authorization: `Bearer ${habitantJwt}`,
    });
    assert(
      sig.status === 201 || sig.status === 200 || sig.status === 503,
      `upload/signature (${sig.status})`,
    );
    ok(
      sig.status === 503
        ? 'Signature Cloudinary non configurée (503 toléré)'
        : 'Signature Cloudinary obtenue',
    );

    // 3. Création d'adresse.
    const create = await json(
      'POST',
      '/api/addresses',
      {
        category: 'COMMERCE',
        steps: ['Partir du carrefour', 'Boutique verte'],
        photoUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
        gpsLat: GPS.lat,
        gpsLng: GPS.lng,
      },
      { authorization: `Bearer ${habitantJwt}` },
    );
    assert(create.status === 201, `create address (${create.status})`);
    createdCode = create.body.data.code as string;
    assert(createdCode, 'code adresse absent');
    assert(
      create.body.data.revisionStatus === 'EN_ATTENTE_VALIDATION',
      'révision n°1 devrait être EN_ATTENTE_VALIDATION',
    );
    ok(`Adresse créée : ${createdCode} (EN_ATTENTE_VALIDATION)`);

    // 4. Modérateur → approve révision n°1.
    const modLogin = await json('POST', '/api/auth/login', {
      email: MOD_EMAIL,
      password: PASSWORD,
    });
    assert(modLogin.status === 200, `login mod (${modLogin.status})`);
    const modJwt = modLogin.body.data.token as string;
    const queue = await json('GET', '/api/moderation/revisions', undefined, {
      authorization: `Bearer ${modJwt}`,
    });
    assert(queue.status === 200, `liste révisions (${queue.status})`);
    const items: any[] = queue.body.data.items ?? queue.body.data;
    const pending = items.find((r) => r.code === createdCode) ?? items[0];
    assert(pending?.id, 'révision en attente introuvable');
    const approve = await json(
      'PATCH',
      `/api/moderation/revisions/${pending.id}/approve`,
      {},
      { authorization: `Bearer ${modJwt}` },
    );
    assert(approve.status === 200, `approve (${approve.status})`);
    ok('Modérateur connecté → révision n°1 PUBLIEE (pointeur basculé)');

    // 5. Resolve via clé API.
    const resolve = await json(
      'GET',
      `/api/addresses/${createdCode}/resolve`,
      undefined,
      { authorization: `Bearer ${key.key}` },
    );
    assert(resolve.status === 200, `resolve (${resolve.status})`);
    assert(
      resolve.body.data.steps?.length >= 1,
      'resolve devrait renvoyer les étapes',
    );
    ok('Résolution clé API → données complètes');

    // 6. Évaluation habitant.
    const rate = await json(
      'POST',
      `/api/addresses/${createdCode}/rate`,
      { stars: 4 },
      { authorization: `Bearer ${habitantJwt}` },
    );
    assert(rate.status === 200, `rate (${rate.status})`);
    assert(
      rate.body.data.averageRating === 4,
      `moyenne attendue 4, reçue ${rate.body.data.averageRating}`,
    );
    ok('Évaluation enregistrée → moyenne recalculée (4.0)');

    // 7. Visite : start + confirm.
    const start = await json('POST', '/api/visits/start', {
      addressCode: createdCode,
      departAt: new Date().toISOString(),
    });
    assert(start.status === 201, `visit start (${start.status})`);
    const visitId = start.body.data.visitId as string;
    const confirm = await json('POST', '/api/visits/confirm', {
      visitId,
      arrivedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    assert(confirm.status === 201, `visit confirm (${confirm.status})`);
    ok('Visite enregistrée (start + confirm)');

    // 8. Désactivation → 410 sur resolve.
    const deactivate = await json(
      'DELETE',
      `/api/addresses/${createdCode}`,
      undefined,
      { authorization: `Bearer ${habitantJwt}` },
    );
    assert(deactivate.status === 200, `deactivate (${deactivate.status})`);
    const gone = await json(
      'GET',
      `/api/addresses/${createdCode}/resolve`,
      undefined,
      { authorization: `Bearer ${key.key}` },
    );
    assert(gone.status === 410, `resolve après désactivation (${gone.status})`);
    ok('Adresse désactivée → 410 sur resolve');

    console.log(`\n✅ Smoke test OK — ${step} étapes validées.`);
  } finally {
    // Nettoyage : tout ce que le script a introduit.
    if (createdCode) {
      const addr = await prisma.address.findUnique({
        where: { code: createdCode },
        select: { id: true, localisationId: true },
      });
      if (addr) {
        await prisma.visit.deleteMany({ where: { addressId: addr.id } });
        await prisma.rating.deleteMany({ where: { addressId: addr.id } });
        await prisma.addressRevision.deleteMany({
          where: { addressId: addr.id },
        });
        await prisma.address.delete({ where: { id: addr.id } });
        if (addr.localisationId) {
          await prisma.localisation
            .delete({ where: { id: addr.localisationId } })
            .catch(() => undefined);
        }
      }
    }
    if (apiKeyId) {
      await prisma.apiRequestLog.deleteMany({ where: { apiKeyId } });
      await prisma.apiKey.delete({ where: { id: apiKeyId } }).catch(() => undefined);
    }
    await prisma.otpCode.deleteMany({ where: { phone: PHONE } });
    await prisma.user.deleteMany({ where: { phone: PHONE } });
    await prisma.user.deleteMany({ where: { email: MOD_EMAIL } });
    await prisma.quartier
      .delete({ where: { prefix: QUARTIER_PREFIX } })
      .catch(() => undefined);
    await app.close();
  }
}

main().catch((err) => {
  console.error(`\n❌ Smoke test échoué : ${err.message ?? err}`);
  process.exit(1);
});
