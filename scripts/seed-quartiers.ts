/**
 * Seed des quartiers (référentiel minimal de Cotonou).
 * Usage : npm run seed:quartiers
 *
 * Note : import Overpass/OSM complet à venir (cf. CdC §12). Ici, un noyau de
 * quartiers avec préfixe + centre suffit au rattachement et aux tests.
 * Les polygones sont absents (polygon = null) → repli « quartier le plus proche ».
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const QUARTIERS: { name: string; prefix: string; centerLat: number; centerLng: number }[] = [
  { name: 'Akpakpa', prefix: 'AKP', centerLat: 6.3655, centerLng: 2.4442 },
  { name: 'Cadjèhoun', prefix: 'CAD', centerLat: 6.3662, centerLng: 2.3912 },
  { name: 'Fidjrossè', prefix: 'FID', centerLat: 6.3582, centerLng: 2.3662 },
  { name: 'Ganhi', prefix: 'GAN', centerLat: 6.3585, centerLng: 2.4302 },
  { name: 'Godomey', prefix: 'GOD', centerLat: 6.3831, centerLng: 2.3331 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquant.');
  const prisma = new PrismaClient({ adapter: new PrismaPg(url) });

  try {
    for (const q of QUARTIERS) {
      await prisma.quartier.upsert({
        where: { prefix: q.prefix },
        update: { name: q.name, centerLat: q.centerLat, centerLng: q.centerLng },
        create: { ...q, isActive: true },
      });
      console.log(`✔ ${q.prefix} — ${q.name}`);
    }
    const total = await prisma.quartier.count();
    console.log(`Seed terminé : ${total} quartiers en base.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
