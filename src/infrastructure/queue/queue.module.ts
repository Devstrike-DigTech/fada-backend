import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from './queue.constants';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: configService.get<string>('redis.url', 'redis://localhost:6379'),
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.NOTIFICATIONS },
      { name: QUEUE_NAMES.INVENTORY_BATCH_UPLOAD },
      { name: QUEUE_NAMES.RESERVATION_EXPIRY },
      { name: QUEUE_NAMES.NAFDAC_CACHE_REFRESH },
      { name: QUEUE_NAMES.ANALYTICS_SNAPSHOT },
      { name: QUEUE_NAMES.VERIFICATION_PCN },
      { name: QUEUE_NAMES.VERIFICATION_CAC },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
