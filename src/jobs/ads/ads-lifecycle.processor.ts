import { Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { AdsService } from '@modules/ads/ads.service';

/**
 * Hourly ad lifecycle sweep (scheduled by AdsService on boot):
 * activates paid + approved campaigns whose slot has started, expires
 * campaigns past their slot, and cancels unpaid drafts whose slot has passed.
 */
@Processor(QUEUE_NAMES.ADS_LIFECYCLE)
export class AdsLifecycleProcessor {
  private readonly logger = new Logger(AdsLifecycleProcessor.name);

  constructor(private readonly adsService: AdsService) {}

  @Process('sweep')
  async handleSweep(job: Job): Promise<void> {
    this.logger.debug(`Ad lifecycle sweep started (jobId: ${job.id})`);
    await this.adsService.runLifecycleSweep();
  }
}
