import { Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { SubscriptionService } from '@modules/subscription/subscription.service';

/**
 * Hourly subscription sweep (scheduled by SubscriptionService on boot):
 *   - fails abandoned checkouts
 *   - downgrades subscriptions whose grace period ran out
 *   - applies scheduled plan changes at period end
 *   - rolls free-plan periods, starts grace windows for unpaid renewals
 */
@Processor(QUEUE_NAMES.SUBSCRIPTION_BILLING)
export class SubscriptionBillingProcessor {
  private readonly logger = new Logger(SubscriptionBillingProcessor.name);

  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Process('sweep')
  async handleSweep(job: Job): Promise<void> {
    this.logger.debug(`Subscription billing sweep started (jobId: ${job.id})`);
    await this.subscriptionService.runBillingSweep();
  }
}
