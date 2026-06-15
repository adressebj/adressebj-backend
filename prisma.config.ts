import 'dotenv/config';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

/**
 * Configuration Prisma 7. L'URL de connexion (Migrate / introspection) vit ici,
 * plus dans schema.prisma (changement cassant Prisma 7 — voir docs/DECISIONS.md).
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
