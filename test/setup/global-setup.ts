import { execSync } from 'child_process';
import { Client } from 'pg';
import Redis from 'ioredis';

/**
 * Once per e2e run: refuse anything that does not look like a test database,
 * apply migrations, wipe data, seed reference data, flush the test Redis.
 */
export default async function globalSetup(): Promise<void> {
  const db = process.env.TEST_DATABASE_URL;
  const redisUrl = process.env.TEST_REDIS_URL;
  if (!db || !redisUrl) {
    throw new Error(
      'Set TEST_DATABASE_URL and TEST_REDIS_URL (or run `npm run test:e2e:docker`).',
    );
  }
  const dbName = new URL(db).pathname.replace('/', '');
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run e2e tests against "${dbName}": the database name must contain "test".`,
    );
  }

  const env = { ...process.env, DATABASE_URL: db };
  execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });

  const client = new Client({ connectionString: db });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length) {
    await client.query(
      `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  }
  await client.end();

  execSync('npx prisma db seed', { env, stdio: 'pipe' });

  const redis = new Redis(redisUrl);
  await redis.flushdb();
  await redis.quit();
}
