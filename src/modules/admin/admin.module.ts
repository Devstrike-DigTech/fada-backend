import { Module } from '@nestjs/common';
import { SubscriptionModule } from '@modules/subscription/subscription.module';
import { AdsModule } from '@modules/ads/ads.module';
import { PromotionsModule } from '@modules/promotions/promotions.module';
import { PointsModule } from '@modules/points/points.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { SupportModule } from '@modules/support/support.module';
import { ContentModule } from '@modules/content/content.module';
import { AnalyticsModule } from '@modules/analytics/analytics.module';
import { VerificationModule } from '@modules/verification/verification.module';
import { MarketingModule } from '@modules/marketing/marketing.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminSubscriptionsController } from './admin-subscriptions.controller';
import { AdminAdsController } from './admin-ads.controller';
import { AdminPromotionsController } from './admin-promotions.controller';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminPointsController } from './admin-points.controller';
import { AdminNotificationsController } from './admin-notifications.controller';
import { AdminSupportController } from './admin-support.controller';
import { AdminContentController } from './admin-content.controller';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminMarketingController } from './admin-marketing.controller';

/**
 * Back office. Admins monitor the platform (dashboard, audit trail) and
 * influence it (plan overrides, campaign review, seasonal promotions,
 * broadcasts, support queue, editable content).
 */
@Module({
  imports: [
    SubscriptionModule,
    AdsModule,
    PromotionsModule,
    PointsModule,
    NotificationsModule,
    SupportModule,
    ContentModule,
    AnalyticsModule,
    VerificationModule,
    MarketingModule,
  ],
  controllers: [
    AdminController,
    AdminSubscriptionsController,
    AdminAdsController,
    AdminPromotionsController,
    AdminDashboardController,
    AdminPointsController,
    AdminNotificationsController,
    AdminSupportController,
    AdminContentController,
    AdminAnalyticsController,
    AdminMarketingController,
  ],
  providers: [AdminService, AdminAuditService, AdminDashboardService],
  exports: [AdminAuditService],
})
export class AdminModule {}
