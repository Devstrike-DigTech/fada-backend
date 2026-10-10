import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { AnalyticsSnapshotProcessor } from '@jobs/analytics/analytics-snapshot.processor';
import { SubscriptionModule } from '@modules/subscription/subscription.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsAggregatorService } from './analytics-aggregator.service';
import { SearchTrackingService } from './search-tracking.service';
import { SearchAnalyticsListener } from './listeners/search-analytics.listener';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.ANALYTICS_SNAPSHOT }),
    SubscriptionModule, // plan gating (hasAnalytics) and slot limits
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsAggregatorService,
    SearchTrackingService,
    SearchAnalyticsListener,
    AnalyticsSnapshotProcessor,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
