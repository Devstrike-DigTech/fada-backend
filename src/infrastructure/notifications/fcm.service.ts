import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

export interface PushMessage {
  title: string;
  body: string;
  /** String-only map, as FCM requires */
  data?: Record<string, string>;
  imageUrl?: string;
}

export interface PushResult {
  sent: number;
  failed: number;
  /** Tokens FCM reported as unregistered / invalid — callers should prune them */
  invalidTokens: string[];
  /** Set when every attempt failed for a reason other than a bad token */
  error?: string;
}

/**
 * Firebase Cloud Messaging. Initialised lazily from the service-account env
 * vars; when they are absent `isConfigured` is false and sends are skipped
 * with a warning instead of crashing boot.
 */
@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private app: admin.app.App | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const projectId = this.config.get<string>(
      'notifications.firebase.projectId',
    );
    const clientEmail = this.config.get<string>(
      'notifications.firebase.clientEmail',
    );
    const privateKey = this.config.get<string>(
      'notifications.firebase.privateKey',
    );

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn('FIREBASE_* not set — push notifications are disabled.');
      return;
    }
    try {
      this.app =
        admin.apps.length > 0
          ? admin.app()
          : admin.initializeApp({
              credential: admin.credential.cert({
                projectId,
                clientEmail,
                privateKey,
              }),
            });
      this.logger.log(`FCM initialised for project ${projectId}`);
    } catch (err) {
      this.logger.error('FCM initialisation failed', err as Error);
    }
  }

  get isConfigured(): boolean {
    return this.app !== null;
  }

  async sendToTokens(
    tokens: string[],
    message: PushMessage,
  ): Promise<PushResult> {
    if (!this.app)
      return {
        sent: 0,
        failed: tokens.length,
        invalidTokens: [],
        error: 'fcm_not_configured',
      };
    if (tokens.length === 0) return { sent: 0, failed: 0, invalidTokens: [] };

    const response = await admin.messaging(this.app).sendEachForMulticast({
      tokens,
      notification: {
        title: message.title,
        body: message.body,
        imageUrl: message.imageUrl,
      },
      data: message.data,
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'fada_default' },
      },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    });

    const invalidTokens: string[] = [];
    let otherError: string | undefined;
    response.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error?.code ?? '';
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        invalidTokens.push(tokens[i]);
      } else {
        otherError = r.error?.message ?? code;
      }
    });

    return {
      sent: response.successCount,
      failed: response.failureCount,
      invalidTokens,
      error: response.successCount === 0 && otherError ? otherError : undefined,
    };
  }
}
