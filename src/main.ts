import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3000;
  const nodeEnv = configService.get<string>('app.nodeEnv') ?? 'development';
  const apiPrefix = configService.get<string>('app.apiPrefix') ?? 'api';

  // ── Security ────────────────────────────────────────────────────────────────
  app.use(helmet.default());

  // ── CORS ────────────────────────────────────────────────────────────────────
  const allowedOrigins = configService.get<string>('app.allowedOrigins') ?? '*';
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
    credentials: true,
  });

  // ── API Prefix & Versioning ─────────────────────────────────────────────────
  app.setGlobalPrefix(apiPrefix);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // ── Global Validation Pipe ──────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
      stopAtFirstError: false,
    }),
  );

  // ── Swagger (non-production only) ────────────────────────────────────────────
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
      .addTag('Health', 'Service health checks')
      .addTag('Auth', 'Authentication & authorization')
      .addTag('Pharmacy', 'Pharmacy registration & management')
      .addTag('Inventory', 'Drug inventory management')
      .addTag('Search', 'Drug & pharmacy search')
      .addTag('Reservation', 'Drug reservation flow')
      .addTag('Subscription', 'Pharmacy subscription plans')
      .addTag('Ads', 'Advertisement campaigns')
      .addTag('Customer', 'Customer profile & features')
      .addTag('Points', 'Points & rewards system')
      .addTag('Notification', 'Push, SMS & email notifications')
      .addTag('Support', 'Support tickets & feature requests')
      .addTag('Analytics', 'Usage analytics & reporting')
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

  await app.listen(port);

  console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║            FADA Backend  •  ${nodeEnv.toUpperCase().padEnd(12)}          ║
  ╠══════════════════════════════════════════════════════╣
  ║  API       → http://localhost:${port}/${apiPrefix}/v1          ║
  ║  Docs      → http://localhost:${port}/docs               ║
  ║  Health    → http://localhost:${port}/${apiPrefix}/v1/health   ║
  ╚══════════════════════════════════════════════════════╝
  `);
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
