import { Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { PrismaService } from '@infra/database/prisma.service';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { EmailService } from '@infra/notifications/email.service';
import { FcmService } from '@infra/notifications/fcm.service';
import { TermiiService } from '@infra/notifications/termii.service';
import { EmailNotificationRequestedPayload } from '@common/types/events.types';
import { NotificationsService } from '@modules/notifications/notifications.service';
import {
  BroadcastJob,
  ChannelPayload,
  DeliverJob,
} from '@modules/notifications/notification.types';

/** Errors that will never succeed on retry */
class PermanentError extends Error {}

/**
 * Notifications queue worker.
 *  deliver    → one push / sms / email NotificationRecord (retried with backoff)
 *  raw-email  → transactional email requested by other modules (OTP, invites, verification)
 *  raw-sms    → transactional SMS requested by other modules
 *  broadcast  → back-office fan-out
 *  cleanup    → daily retention sweep
 */
@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationsProcessor {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly fcm: FcmService,
    private readonly termii: TermiiService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Per-record delivery ─────────────────────────────────────────────────────

  @Process({ name: 'deliver', concurrency: 10 })
  async deliver(job: Job<DeliverJob>): Promise<void> {
    const record = await this.prisma.notificationRecord.findUnique({
      where: { id: job.data.recordId },
      include: {
        recipient: { select: { id: true, email: true, phone: true } },
      },
    });
    if (!record || record.status === 'sent' || record.status === 'skipped')
      return;

    await this.prisma.notificationRecord.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });

    const payload = (record.channelPayload ?? {}) as ChannelPayload;
    const data = (record.data ?? {}) as Record<string, string>;

    try {
      let outcome: {
        status: 'sent' | 'skipped';
        error?: string;
        meta?: Record<string, unknown>;
      };

      switch (record.type) {
        case 'push':
          outcome = await this.sendPush(
            record.recipientId,
            record.title,
            record.body,
            data,
            payload,
          );
          break;
        case 'sms':
          outcome = await this.sendSms(
            payload.sms?.to ?? record.recipient.phone,
            payload.sms?.text ?? record.body,
          );
          break;
        case 'email':
          outcome = await this.sendEmail(record.recipient.email, payload);
          break;
        default:
          outcome = {
            status: 'skipped',
            error: `unsupported_type:${record.type}`,
          };
      }

      await this.prisma.notificationRecord.update({
        where: { id: record.id },
        data: {
          status: outcome.status,
          error: outcome.error ?? null,
          sentAt: outcome.status === 'sent' ? new Date() : null,
          ...(outcome.meta
            ? {
                channelPayload: {
                  ...payload,
                  delivery: outcome.meta,
                } as object,
              }
            : {}),
        },
      });
    } catch (err) {
      const message = (err as Error).message?.slice(0, 500) ?? 'unknown_error';
      const permanent = err instanceof PermanentError;
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

      if (permanent || finalAttempt) {
        await this.prisma.notificationRecord.update({
          where: { id: record.id },
          data: { status: permanent ? 'skipped' : 'failed', error: message },
        });
        this.logger.warn(
          `Notification ${record.id} (${record.type}) ${permanent ? 'skipped' : 'failed'}: ${message}`,
        );
        if (permanent) return;
      } else {
        await this.prisma.notificationRecord.update({
          where: { id: record.id },
          data: { error: message },
        });
      }
      throw err; // let Bull retry with backoff
    }
  }

  private async sendPush(
    userId: string,
    title: string,
    body: string,
    data: Record<string, string>,
    payload: ChannelPayload,
  ) {
    if (!this.fcm.isConfigured)
      return { status: 'skipped' as const, error: 'fcm_not_configured' };

    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      select: { token: true },
    });
    if (tokens.length === 0)
      return { status: 'skipped' as const, error: 'no_device' };

    const res = await this.fcm.sendToTokens(
      tokens.map((t) => t.token),
      { title, body, data, imageUrl: payload.push?.imageUrl },
    );

    if (res.invalidTokens.length) {
      await this.prisma.deviceToken.updateMany({
        where: { token: { in: res.invalidTokens } },
        data: { isActive: false },
      });
    }
    if (res.sent > 0) {
      return {
        status: 'sent' as const,
        meta: { devices: res.sent, failedDevices: res.failed },
      };
    }
    if (res.error) throw new Error(`fcm:${res.error}`);
    return { status: 'skipped' as const, error: 'no_valid_device' };
  }

  private async sendSms(to: string | null | undefined, text: string) {
    if (!this.termii.isConfigured)
      return { status: 'skipped' as const, error: 'termii_not_configured' };
    if (!to || !this.termii.normalisePhone(to))
      throw new PermanentError(`invalid_phone`);
    const res = await this.termii.send(to, text);
    return { status: 'sent' as const, meta: { messageId: res.messageId } };
  }

  private async sendEmail(
    to: string | null | undefined,
    payload: ChannelPayload,
  ) {
    if (!this.email.isConfigured)
      return { status: 'skipped' as const, error: 'resend_not_configured' };
    if (!to) throw new PermanentError('no_email');
    if (!payload.email) throw new PermanentError('missing_email_payload');
    const html = this.email.renderTemplate(
      payload.email.templateId,
      payload.email.templateData,
    );
    await this.email.send({ to, subject: payload.email.subject, html });
    return { status: 'sent' as const };
  }

  // ─── Transactional pass-through ──────────────────────────────────────────────

  @Process('raw-email')
  async rawEmail(job: Job<EmailNotificationRequestedPayload>): Promise<void> {
    const p = job.data;
    if (!this.email.isConfigured) {
      this.logger.warn(
        `Email "${p.subject}" to ${p.to} not sent: RESEND_API_KEY not configured`,
      );
      return;
    }
    const html =
      p.html ??
      (p.templateId
        ? this.email.renderTemplate(p.templateId, p.templateData ?? {})
        : '');
    if (!html) {
      this.logger.warn(
        `Email to ${p.to} skipped: no html or templateId provided`,
      );
      return;
    }
    await this.email.send({ to: p.to, subject: p.subject, html }); // throws → Bull retries
  }

  @Process('raw-sms')
  async rawSms(job: Job<{ to: string; message: string }>): Promise<void> {
    if (!this.termii.isConfigured) {
      this.logger.warn(
        `SMS to ${job.data.to} not sent: TERMII_API_KEY not configured`,
      );
      return;
    }
    if (!this.termii.normalisePhone(job.data.to)) {
      this.logger.warn(`SMS skipped: invalid phone ${job.data.to}`);
      return;
    }
    await this.termii.send(job.data.to, job.data.message);
  }

  // ─── Back office ─────────────────────────────────────────────────────────────

  @Process('broadcast')
  async broadcast(job: Job<BroadcastJob>): Promise<void> {
    await this.notifications.runBroadcast(job.data);
  }

  // ─── Retention ───────────────────────────────────────────────────────────────

  @Process('cleanup')
  async cleanup(): Promise<void> {
    const day = 24 * 60 * 60 * 1000;
    const [readInApp, deliveries] = await Promise.all([
      this.prisma.notificationRecord.deleteMany({
        where: {
          type: 'in_app',
          isRead: true,
          createdAt: { lt: new Date(Date.now() - 180 * day) },
        },
      }),
      this.prisma.notificationRecord.deleteMany({
        where: {
          type: { in: ['push', 'sms', 'email'] },
          createdAt: { lt: new Date(Date.now() - 90 * day) },
        },
      }),
    ]);
    this.logger.log(
      `Notification cleanup: ${readInApp.count} old read in-app, ${deliveries.count} old delivery rows removed`,
    );
  }
}
