import { Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { AnalyticsAggregatorService } from '@modules/analytics/analytics-aggregator.service';

/**
 * daily   → 00:20 Africa/Lagos: snapshot yesterday and backfill gaps in the past week
 * rebuild → back-office request to recompute one day
 */
@Processor(QUEUE_NAMES.ANALYTICS_SNAPSHOT)
export class AnalyticsSnapshotProcessor {
  private readonly logger = new Logger(AnalyticsSnapshotProcessor.name);

  constructor(private readonly aggregator: AnalyticsAggregatorService) {}

  @Process('daily')
  async daily(): Promise<void> {
    const days = await this.aggregator.runDaily();
    this.logger.log(`Daily analytics snapshot done for ${days.join(', ')}`);
  }

  @Process('rebuild')
  async rebuild(job: Job<{ day: string }>): Promise<void> {
    await this.aggregator.snapshotDay(job.data.day);
  }
}
