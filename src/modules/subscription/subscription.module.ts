import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { PromotionsModule } from '@modules/promotions/promotions.module';
import { SubscriptionBillingProcessor } from '@jobs/subscription/subscription-billing.processor';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionWebhookController } from './webhook.controller';
import { SubscriptionService } from './subscription.service';
import { SubscriptionEntitlementsService } from './subscription-entitlements.service';
import { SubscriptionListeners } from './listeners/subscription.listeners';

@Module({
  imports: [
    // Registered globally by QueueModule; referenced here so @InjectQueue resolves.
    BullModule.registerQueue({ name: QUEUE_NAMES.SUBSCRIPTION_BILLING }),
    PromotionsModule,
  ],
  controllers: [SubscriptionController, SubscriptionWebhookController],
  providers: [
    SubscriptionService,
    SubscriptionEntitlementsService,
    SubscriptionListeners,
    SubscriptionBillingProcessor,
  ],
  // Other modules only need the entitlements surface to enforce plan limits.
  exports: [SubscriptionEntitlementsService, SubscriptionService],
})
export class SubscriptionModule {}
