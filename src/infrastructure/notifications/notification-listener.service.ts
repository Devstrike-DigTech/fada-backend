import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailService } from './email.service';
import {
  EVENTS,
  EmailNotificationRequestedPayload,
} from '@common/types/events.types';

@Injectable()
export class NotificationListenerService {
  private readonly logger = new Logger(NotificationListenerService.name);

  constructor(private readonly emailService: EmailService) {}

  @OnEvent(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, { async: true })
  async handleEmailSendRequested(payload: EmailNotificationRequestedPayload): Promise<void> {
    try {
      const html = payload.html
        ?? (payload.templateId
          ? this.emailService.renderTemplate(payload.templateId, payload.templateData ?? {})
          : '');

      if (!html) {
        this.logger.warn(`Email to ${payload.to} skipped: no html or templateId provided`);
        return;
      }

      await this.emailService.send({ to: payload.to, subject: payload.subject, html });
    } catch (err) {
      this.logger.error(`Email delivery failed for ${payload.to}: ${(err as Error).message}`);
    }
  }
}
