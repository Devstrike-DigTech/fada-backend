import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { AdsLifecycleProcessor } from '@jobs/ads/ads-lifecycle.processor';
import { SubscriptionModule } from '@modules/subscription/subscription.module';
import { PromotionsModule } from '@modules/promotions/promotions.module';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';
import { AdsListeners } from './listeners/ads.listeners';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.ADS_LIFECYCLE }),
    MulterModule.register({ storage: memoryStorage() }),
    SubscriptionModule, // tier gating, ad discount, shared checkout
    PromotionsModule,
  ],
  controllers: [AdsController],
  providers: [AdsService, AdsListeners, AdsLifecycleProcessor],
  exports: [AdsService],
})
export class AdsModule {}
