import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import { RedisService } from '../../src/infrastructure/redis/redis.service';
import { RedisIoAdapter } from '../../src/infrastructure/sockets/redis-io.adapter';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  prisma: PrismaService;
  redis: RedisService;
  jwt: JwtService;
  /** Base URL when started with `listen: true` (for socket clients) */
  url?: string;
  close: () => Promise<void>;
}

/** Boots the real AppModule with production HTTP configuration. */
export async function createTestApp(
  opts: { listen?: boolean } = {},
): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({
    rawBody: true,
    logger: ['error'],
  });
  configureApp(app);

  let adapter: RedisIoAdapter | undefined;
  let url: string | undefined;
  if (opts.listen) {
    adapter = new RedisIoAdapter(app, '*');
    await adapter.connectToRedis(process.env.REDIS_URL!);
    app.useWebSocketAdapter(adapter);
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    url = url.replace('[::1]', '127.0.0.1');
  } else {
    await app.init();
  }

  return {
    app,
    http: request(app.getHttpServer()),
    prisma: app.get(PrismaService),
    redis: app.get(RedisService),
    jwt: app.get(JwtService),
    url,
    close: async () => {
      await app.close();
      await adapter?.close();
    },
  };
}

export const api = (path: string) => `/api/v1${path}`;

/** Polls until `fn` returns a truthy value (queues and listeners are async). */
export async function eventually<T>(
  fn: () => Promise<T>,
  timeoutMs = 8000,
  everyMs = 100,
): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: T = await fn();
  while (!last && Date.now() < end) {
    await new Promise((r) => setTimeout(r, everyMs));
    last = await fn();
  }
  return last;
}
