import 'dotenv/config';

import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 configuration: database connection is managed via adapter
// The adapter is passed to PrismaClient at runtime in PrismaService

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node -r tsconfig-paths/register prisma/seed.ts',
  },
   datasource: {
    url: env('DATABASE_URL'),
  },
});
