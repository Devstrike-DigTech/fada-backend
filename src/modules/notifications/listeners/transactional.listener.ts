import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import {
  EVENTS,
  EmailNotificationRequestedPayload,
  PushNotificationRequestedPayload,
  SmsNotificationRequestedPayload,
} from '@common/types/events.types';
import { NotificationsService } from '../notifications.service';

/**
 * Generic send requests emitted by other modules (OTP emails, staff invites,
 * PCN / CAC results). Previously sent inline; now queued so a Resend or
 * Termii outage is retried instead of silently dropped.
 */
@Injectable()
export class TransactionalListener {
  private readonly logger = new Logger(TransactionalListener.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly queue: Queue,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, { async: true })
  async onEmail(payload: EmailNotificationRequestedPayload): Promise<void> {
    try {
      await this.queue.add('raw-email', payload, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      });
    } catch (err) {
      this.logger.error(`Could not queue email to ${payload.to}`, err as Error);
    }
  }

  @OnEvent(EVENTS.NOTIFICATION.SMS_SEND_REQUESTED, { async: true })
  async onSms(payload: SmsNotificationRequestedPayload): Promise<void> {
    try {
      await this.queue.add(
        'raw-sms',
        { to: payload.to, message: payload.message },
        {
          attempts: 4,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 200,
        },
      );
    } catch (err) {
      this.logger.error(`Could not queue SMS to ${payload.to}`, err as Error);
    }
  }

  @OnEvent(EVENTS.NOTIFICATION.PUSH_SEND_REQUESTED, { async: true })
  async onPush(payload: PushNotificationRequestedPayload): Promise<void> {
    try {
      await this.notifications.notify({
        recipientIds: [payload.userId],
        category: 'system',
        channels: ['push'],
        title: payload.title,
        body: payload.body,
        data: payload.data,
      });
    } catch (err) {
      this.logger.error(
        `Could not queue push to ${payload.userId}`,
        err as Error,
      );
    }
  }
}
