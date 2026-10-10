import { NotificationCategory, NotificationType } from '@prisma/client';

export type Channel = NotificationType; // 'in_app' | 'push' | 'sms' | 'email'

/** Categories that bypass the user's mute list (transactional / legal). */
export const ALWAYS_DELIVER: ReadonlySet<NotificationCategory> = new Set([
  'account',
  'billing',
]);

export const ALL_CATEGORIES: readonly NotificationCategory[] = [
  'reservation',
  'inventory',
  'billing',
  'ads',
  'points',
  'account',
  'system',
  'marketing',
];

export interface EmailContent {
  subject: string;
  heading?: string;
  /** Plain text; blank lines become paragraphs. Escaped by the template. */
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
}

/** What a trigger wants to say, independent of who receives it. */
export interface NotificationContent {
  title: string;
  body: string;
  /** App route appended to the deep-link scheme, e.g. `reservations/<id>` */
  link?: string;
  data?: Record<string, string | number | boolean | null | undefined>;
  email?: EmailContent;
  /** Short SMS text; defaults to `title: body` trimmed to 160 chars */
  sms?: string;
}

export interface NotifyRequest extends NotificationContent {
  recipientIds: string[];
  category: NotificationCategory;
  channels: Channel[];
  /** Event-derived key so a redelivered event does not notify twice */
  dedupeKey?: string;
}

export interface NotifyResult {
  recipients: number;
  inApp: number;
  queued: number;
  skipped: number;
}

/** Shape stored in NotificationRecord.channelPayload for queued channels. */
export interface ChannelPayload {
  email?: {
    subject: string;
    templateId: string;
    templateData: Record<string, unknown>;
  };
  sms?: { text: string; to?: string | null };
  push?: { imageUrl?: string };
}

export interface DeliverJob {
  recordId: string;
}

export interface BroadcastJob {
  broadcastId: string;
  adminUserId: string;
  audience: 'customers' | 'pharmacists' | 'all' | 'users';
  userIds?: string[];
  title: string;
  body: string;
  category: NotificationCategory;
  channels: Channel[];
  link?: string;
}
