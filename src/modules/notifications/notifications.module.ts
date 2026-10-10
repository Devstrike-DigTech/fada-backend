import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { NotificationsProcessor } from '@jobs/notifications/notifications.processor';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationRecipientsService } from './notification-recipients.service';
import { NotificationTriggersListener } from './listeners/notification-triggers.listener';
import { TransactionalListener } from './listeners/transactional.listener';

/**
 * Notification centre: in-app history, push / SMS / email dispatch through
 * the `notifications` queue, device tokens, preferences, and the event
 * triggers that decide who hears about what. Providers come from the global
 * NotificationProvidersModule.
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATIONS })],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationRecipientsService,
    NotificationTriggersListener,
    TransactionalListener,
    NotificationsProcessor,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
