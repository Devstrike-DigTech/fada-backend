import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as helmet from 'helmet';
import { requestContext } from '@common/middleware/request-context.middleware';

/**
 * Everything that shapes HTTP behaviour, shared by main.ts and the e2e tests
 * so tests exercise exactly what production runs.
 */
export function configureApp(app: INestApplication): {
  apiPrefix: string;
  nodeEnv: string;
} {
  const express = app as NestExpressApplication;
  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('app.env') ?? 'development';
  const apiPrefix = config.get<string>('app.apiPrefix') ?? 'api';

  // ── Proxy awareness (Railway / load balancer) so req.ip is the real client ──
  const trustProxy = config.get<number>('app.trustProxy') ?? 0;
  if (trustProxy > 0) express.set('trust proxy', trustProxy);
  express.disable('x-powered-by');

  // ── Request size limits (raw body is kept for webhook signatures) ──────────
  const bodyLimit = config.get<string>('app.bodyLimit') ?? '1mb';
  express.useBodyParser('json', { limit: bodyLimit });
  express.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

  // ── Request id + scrubbed access log ───────────────────────────────────────
  app.use(
    requestContext({ log: config.get<boolean>('app.requestLogging') ?? true }),
  );

  // ── Security headers ───────────────────────────────────────────────────────
  app.use(helmet.default());

  // ── CORS ───────────────────────────────────────────────────────────────────
  const allowedOrigins = config.get<string>('app.allowedOrigins') ?? '*';
  app.enableCors({
    origin:
      allowedOrigins === '*'
        ? true
        : allowedOrigins.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-guest-token',
      'x-request-id',
    ],
    exposedHeaders: ['x-request-id', 'retry-after-short', 'retry-after-medium'],
    credentials: true,
  });

  // ── Prefix, versioning, validation ─────────────────────────────────────────
  app.setGlobalPrefix(apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );

  // ── Graceful shutdown (closes DB pool, Redis, queues on SIGTERM) ──────────
  app.enableShutdownHooks();

  // ── Swagger (never in production) ──────────────────────────────────────────
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('FADA API')
      .setDescription(
        'Find Any Drug Anywhere — Backend API for the FADA healthcare marketplace.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'Authorization',
          description: 'Enter your JWT access token',
          in: 'header',
        },
        'access-token',
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'x-guest-token',
          in: 'header',
          description: 'Guest token for unauthenticated access',
        },
        'guest-token',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  return { apiPrefix, nodeEnv };
}
