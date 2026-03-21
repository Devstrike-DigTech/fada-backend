import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

// Config
import appConfig from '@config/app.config';
import databaseConfig from '@config/database.config';
import redisConfig from '@config/redis.config';
import jwtConfig from '@config/jwt.config';
import storageConfig from '@config/storage.config';
import paymentsConfig from '@config/payments.config';
import notificationsConfig from '@config/notifications.config';
import { envValidationSchema } from '@config/env.validation';

// Infrastructure Modules
import { DatabaseModule } from '@infra/database/database.module';
import { RedisModule } from '@infra/redis/redis.module';
import { EventBusModule } from '@infra/events/event-bus.module';
import { QueueModule } from '@infra/queue/queue.module';
import { StorageModule } from '@infra/storage/storage.module';
import { PaymentsModule } from '@infra/payments/payments.module';
import { SocketModule } from '@infra/sockets/socket.module';

// Common
import { HttpExceptionFilter } from '@common/filters/http-exception.filter';
import { ResponseTransformInterceptor } from '@common/interceptors/response-transform.interceptor';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';

// Health
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // ── Config ──────────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        jwtConfig,
        storageConfig,
        paymentsConfig,
        notificationsConfig,
      ],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),

    // ── Event Emitter ────────────────────────────────────────────────────────
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 20,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),

    // ── Rate Limiting ────────────────────────────────────────────────────────
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 10,
      },
      {
        name: 'medium',
        ttl: 60_000,
        limit: 100,
      },
      {
        name: 'long',
        ttl: 3_600_000,
        limit: 1000,
      },
    ]),

    // ── Infrastructure ───────────────────────────────────────────────────────
    DatabaseModule,
    RedisModule,
    EventBusModule,
    QueueModule,
    StorageModule,
    PaymentsModule,
    SocketModule,

    // ── Health ───────────────────────────────────────────────────────────────
    HealthModule,

    // ── Feature Modules (added phase by phase) ───────────────────────────────
    // AuthModule,           <- Phase 2
    // PharmacyModule,       <- Phase 3
    // InventoryModule,      <- Phase 4
    // SearchModule,         <- Phase 5
    // ReservationModule,    <- Phase 6
    // SubscriptionModule,   <- Phase 7
    // AdsModule,            <- Phase 8
    // CustomerModule,       <- Phase 9
    // PointsModule,         <- Phase 10
    // NotificationModule,   <- Phase 11
    // SupportModule,        <- Phase 12
    // AnalyticsModule,      <- Phase 13
  ],
  providers: [
    // ── Global Exception Filter ──────────────────────────────────────────────
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },

    // ── Global Response Transform ────────────────────────────────────────────
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseTransformInterceptor,
    },

    // ── Global JWT Guard (bypass with @Public() decorator) ───────────────────
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },

    // ── Global Roles Guard ───────────────────────────────────────────────────
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
