import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { FcmService } from './fcm.service';
import { TermiiService } from './termii.service';

/**
 * Delivery providers only: Resend email, Firebase push, Termii SMS.
 * Routing, preferences, history and retries live in the feature-level
 * NotificationsModule (src/modules/notifications).
 */
@Global()
@Module({
  providers: [EmailService, FcmService, TermiiService],
  exports: [EmailService, FcmService, TermiiService],
})
export class NotificationProvidersModule {}
