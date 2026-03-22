import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { NotificationListenerService } from './notification-listener.service';

@Module({
  providers: [EmailService, NotificationListenerService],
  exports: [EmailService],
})
export class NotificationsModule {}
