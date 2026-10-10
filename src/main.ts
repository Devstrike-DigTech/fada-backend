import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { RedisIoAdapter } from './infrastructure/sockets/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const production = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: production
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
    // Keep the raw request body so payment webhooks can verify HMAC signatures
    rawBody: true,
  });

  const config = app.get(ConfigService);
  const { apiPrefix, nodeEnv } = configureApp(app);

  // ── WebSockets (Socket.IO + Redis adapter for multi-instance rooms) ─────────
  const ioAdapter = new RedisIoAdapter(
    app,
    config.get<string>('app.allowedOrigins') ?? '*',
  );
  await ioAdapter.connectToRedis(
    config.get<string>('redis.url') ?? 'redis://localhost:6379',
  );
  app.useWebSocketAdapter(ioAdapter);

  const port = config.get<number>('app.port') ?? 3000;
  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(
    `FADA backend (${nodeEnv}) listening on :${port} — API /${apiPrefix}/v1, health /${apiPrefix}/v1/health/ready` +
      (nodeEnv === 'production' ? '' : `, docs /docs`),
  );
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
