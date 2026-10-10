import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { NotificationCategory, NotificationType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '@infra/database/prisma.service';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { SocketGateway } from '@infra/sockets/socket.gateway';
import {
  ALL_CATEGORIES,
  ALWAYS_DELIVER,
  BroadcastJob,
  Channel,
  ChannelPayload,
  DeliverJob,
  NotifyRequest,
  NotifyResult,
} from './notification.types';
import {
  BroadcastDto,
  NotificationHistoryQueryDto,
  RegisterDeviceTokenDto,
  UpdatePreferencesDto,
} from './dto/notifications.dto';

const MAX_ACTIVE_TOKENS_PER_USER = 10;
const DELIVER_JOB_OPTS = {
  attempts: 4,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 500,
  removeOnFail: 1000,
} as const;

type RecipientRow = Prisma.UserGetPayload<{
  select: {
    id: true;
    email: true;
    phone: true;
    isActive: true;
    firstName: true;
    customerProfile: { select: { firstName: true } };
    pharmacistProfile: { select: { firstName: true } };
    notificationPreference: true;
  };
}>;

/**
 * Notification centre.
 *
 *  notify() → one in-app record per recipient (written now, pushed over the
 *  socket) + one queued record per other channel. The queue worker delivers
 *  push / SMS / email with retries and records the outcome on the row.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly deepLinkScheme: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly socket: SocketGateway,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly queue: Queue,
  ) {
    this.deepLinkScheme =
      this.config.get<string>('notifications.deepLinkScheme') ?? 'fada://';
  }

  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.queue.getRepeatableJobs();
      await Promise.all(
        existing
          .filter((j) => j.name === 'cleanup')
          .map((j) => this.queue.removeRepeatableByKey(j.key)),
      );
      await this.queue.add(
        'cleanup',
        {},
        { repeat: { cron: '30 3 * * *' }, removeOnComplete: 7 },
      );
      this.logger.log('Notification cleanup scheduled (daily 03:30)');
    } catch (err) {
      this.logger.error(
        'Failed to schedule notification cleanup',
        err as Error,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Dispatch
  // ═══════════════════════════════════════════════════════════════════════════

  async notify(req: NotifyRequest): Promise<NotifyResult> {
    const result: NotifyResult = {
      recipients: 0,
      inApp: 0,
      queued: 0,
      skipped: 0,
    };
    const ids = [...new Set(req.recipientIds.filter(Boolean))];
    if (ids.length === 0 || req.channels.length === 0) return result;

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: {
        id: true,
        email: true,
        phone: true,
        isActive: true,
        firstName: true,
        customerProfile: { select: { firstName: true } },
        pharmacistProfile: { select: { firstName: true } },
        notificationPreference: true,
      },
    });

    const data = this.buildData(req);

    for (const user of users) {
      result.recipients++;
      for (const channel of req.channels) {
        const outcome = await this.createForChannel(user, channel, req, data);
        if (outcome === 'in_app') result.inApp++;
        else if (outcome === 'queued') result.queued++;
        else if (outcome === 'skipped') result.skipped++;
      }
    }
    return result;
  }

  private async createForChannel(
    user: RecipientRow,
    channel: Channel,
    req: NotifyRequest,
    data: Record<string, string>,
  ): Promise<'in_app' | 'queued' | 'skipped' | 'duplicate'> {
    const prefs = user.notificationPreference;
    const forced = ALWAYS_DELIVER.has(req.category);
    const muted = !forced && !!prefs?.mutedCategories.includes(req.category);

    // In-app history is always kept; mutes only silence interruptions
    if (channel === 'in_app') {
      const record = await this.insert(user.id, 'in_app', req, data, {
        status: 'sent',
        sentAt: new Date(),
      });
      if (!record) return 'duplicate';
      this.pushToSocket(user.id, record);
      return 'in_app';
    }

    let skipReason: string | null = null;
    if (muted) skipReason = 'category_muted';
    else if (channel === 'push' && prefs && !prefs.pushEnabled)
      skipReason = 'push_disabled';
    else if (channel === 'sms' && prefs && !prefs.smsEnabled && !forced)
      skipReason = 'sms_disabled';
    else if (channel === 'email' && prefs && !prefs.emailEnabled && !forced)
      skipReason = 'email_disabled';
    else if (channel === 'sms' && !user.phone) skipReason = 'no_phone';
    else if (channel === 'email' && !user.email) skipReason = 'no_email';

    const firstName =
      user.customerProfile?.firstName ??
      user.pharmacistProfile?.firstName ??
      user.firstName ??
      undefined;
    const channelPayload: ChannelPayload = {};
    if (channel === 'email') {
      const e = req.email;
      channelPayload.email = {
        subject: e?.subject ?? req.title,
        templateId: 'notification',
        templateData: {
          firstName,
          heading: e?.heading ?? req.title,
          body: e?.body ?? req.body,
          ctaLabel: e?.ctaLabel,
          ctaUrl: e?.ctaUrl,
          tone: e?.tone ?? 'info',
        },
      };
    }
    if (channel === 'sms') {
      channelPayload.sms = {
        text: (req.sms ?? `FADA: ${req.title}. ${req.body}`).slice(0, 320),
        to: user.phone,
      };
    }

    const record = await this.insert(user.id, channel, req, data, {
      status: skipReason ? 'skipped' : 'queued',
      error: skipReason ?? undefined,
      channelPayload,
    });
    if (!record) return 'duplicate';
    if (skipReason) return 'skipped';

    await this.queue.add(
      'deliver',
      { recordId: record.id } satisfies DeliverJob,
      {
        ...DELIVER_JOB_OPTS,
        jobId: record.id,
      },
    );
    return 'queued';
  }

  /** Inserts a record; returns null when the dedupe key says it was already sent. */
  private async insert(
    recipientId: string,
    type: NotificationType,
    req: NotifyRequest,
    data: Record<string, string>,
    extra: {
      status: 'queued' | 'sent' | 'skipped';
      sentAt?: Date;
      error?: string;
      channelPayload?: ChannelPayload;
    },
  ) {
    try {
      return await this.prisma.notificationRecord.create({
        data: {
          recipientId,
          type,
          category: req.category,
          title: req.title,
          body: req.body,
          data,
          dedupeKey: req.dedupeKey,
          status: extra.status,
          sentAt: extra.sentAt,
          error: extra.error,
          channelPayload: (extra.channelPayload ??
            null) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        return null;
      throw err;
    }
  }

  private buildData(req: NotifyRequest): Record<string, string> {
    const out: Record<string, string> = { category: req.category };
    for (const [k, v] of Object.entries(req.data ?? {})) {
      if (v !== undefined && v !== null) out[k] = String(v);
    }
    if (req.link) {
      out.link = req.link;
      out.deepLink = `${this.deepLinkScheme}${req.link}`;
    }
    return out;
  }

  private pushToSocket(
    userId: string,
    record: {
      id: string;
      title: string;
      body: string;
      category: NotificationCategory;
      data: Prisma.JsonValue;
      createdAt: Date;
    },
  ): void {
    void this.unreadCount(userId)
      .then((unread) => {
        this.socket.emitToUser(userId, 'notification', {
          id: record.id,
          title: record.title,
          body: record.body,
          category: record.category,
          data: record.data,
          createdAt: record.createdAt,
          unreadCount: unread,
        });
      })
      .catch(() => undefined); // socket server not up (tests, CLI) → ignore
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // History & read state
  // ═══════════════════════════════════════════════════════════════════════════

  async history(userId: string, query: NotificationHistoryQueryDto) {
    const where: Prisma.NotificationRecordWhereInput = {
      recipientId: userId,
      type: 'in_app',
      ...(query.unreadOnly ? { isRead: false } : {}),
      ...(query.category ? { category: query.category } : {}),
    };
    const [items, total, unread] = await Promise.all([
      this.prisma.notificationRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
        select: {
          id: true,
          category: true,
          title: true,
          body: true,
          data: true,
          isRead: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.notificationRecord.count({ where }),
      this.unreadCount(userId),
    ]);
    return {
      items,
      meta: {
        page: query.page ?? 1,
        limit: query.take,
        total,
        totalPages: Math.ceil(total / query.take),
        unreadCount: unread,
      },
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notificationRecord.count({
      where: { recipientId: userId, type: 'in_app', isRead: false },
    });
  }

  async markRead(userId: string, id: string) {
    const res = await this.prisma.notificationRecord.updateMany({
      where: { id, recipientId: userId, type: 'in_app', isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    if (res.count === 0) {
      const exists = await this.prisma.notificationRecord.findFirst({
        where: { id, recipientId: userId, type: 'in_app' },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Notification not found');
    }
    return { read: true, unreadCount: await this.unreadCount(userId) };
  }

  async markAllRead(userId: string, category?: NotificationCategory) {
    const res = await this.prisma.notificationRecord.updateMany({
      where: {
        recipientId: userId,
        type: 'in_app',
        isRead: false,
        ...(category ? { category } : {}),
      },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: res.count, unreadCount: await this.unreadCount(userId) };
  }

  async remove(userId: string, id: string) {
    const res = await this.prisma.notificationRecord.deleteMany({
      where: { id, recipientId: userId, type: 'in_app' },
    });
    if (res.count === 0) throw new NotFoundException('Notification not found');
    return { deleted: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Device tokens
  // ═══════════════════════════════════════════════════════════════════════════

  async registerToken(userId: string, dto: RegisterDeviceTokenDto) {
    const now = new Date();
    // A token belongs to one device; if another account used it, move it here
    const token = await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: {
        userId,
        token: dto.token,
        platform: dto.platform,
        deviceName: dto.deviceName,
        appVersion: dto.appVersion,
        isActive: true,
        lastUsedAt: now,
      },
      update: {
        userId,
        platform: dto.platform,
        deviceName: dto.deviceName,
        appVersion: dto.appVersion,
        isActive: true,
        lastUsedAt: now,
      },
    });

    const active = await this.prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true },
    });
    if (active.length > MAX_ACTIVE_TOKENS_PER_USER) {
      await this.prisma.deviceToken.updateMany({
        where: {
          id: { in: active.slice(MAX_ACTIVE_TOKENS_PER_USER).map((t) => t.id) },
        },
        data: { isActive: false },
      });
    }
    return { id: token.id, platform: token.platform, registered: true };
  }

  async removeToken(userId: string, token: string) {
    const res = await this.prisma.deviceToken.deleteMany({
      where: { userId, token },
    });
    return { removed: res.count > 0 };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Preferences
  // ═══════════════════════════════════════════════════════════════════════════

  async getPreferences(userId: string) {
    const prefs = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    return this.presentPrefs(prefs);
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    const forcedMuted = (dto.mutedCategories ?? []).filter((c) =>
      ALWAYS_DELIVER.has(c),
    );
    if (forcedMuted.length) {
      throw new BadRequestException(
        `${forcedMuted.join(', ')} notifications cannot be muted (account and billing alerts are always delivered)`,
      );
    }
    const prefs = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        pushEnabled: dto.pushEnabled ?? true,
        smsEnabled: dto.smsEnabled ?? true,
        emailEnabled: dto.emailEnabled ?? true,
        mutedCategories: dto.mutedCategories ?? [],
      },
      update: {
        pushEnabled: dto.pushEnabled,
        smsEnabled: dto.smsEnabled,
        emailEnabled: dto.emailEnabled,
        mutedCategories: dto.mutedCategories,
      },
    });
    return this.presentPrefs(prefs);
  }

  private presentPrefs(
    prefs: {
      pushEnabled: boolean;
      smsEnabled: boolean;
      emailEnabled: boolean;
      mutedCategories: NotificationCategory[];
    } | null,
  ) {
    const muted = new Set(prefs?.mutedCategories ?? []);
    return {
      channels: {
        push: prefs?.pushEnabled ?? true,
        sms: prefs?.smsEnabled ?? true,
        email: prefs?.emailEnabled ?? true,
        inApp: true,
      },
      categories: ALL_CATEGORIES.map((c) => ({
        category: c,
        enabled: !muted.has(c),
        canMute: !ALWAYS_DELIVER.has(c),
      })),
      mutedCategories: [...muted],
      note: 'Account and billing alerts are always delivered, and their emails ignore the email toggle.',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Back office
  // ═══════════════════════════════════════════════════════════════════════════

  async enqueueBroadcast(dto: BroadcastDto, adminUserId: string) {
    if (dto.audience === 'users' && !dto.userIds?.length) {
      throw new BadRequestException(
        'userIds is required when audience is "users"',
      );
    }
    const broadcastId = randomUUID();
    const job: BroadcastJob = {
      broadcastId,
      adminUserId,
      audience: dto.audience,
      userIds: dto.userIds,
      title: dto.title,
      body: dto.body,
      category: dto.category ?? 'system',
      channels: dto.channels ?? ['in_app', 'push'],
      link: dto.link,
    };
    await this.queue.add('broadcast', job, {
      attempts: 1,
      removeOnComplete: 50,
    });
    const estimated = await this.audienceCount(dto.audience, dto.userIds);
    return { broadcastId, queued: true, estimatedRecipients: estimated };
  }

  /** Fan-out used by the queue worker, 200 users at a time. */
  async runBroadcast(job: BroadcastJob): Promise<NotifyResult> {
    const totals: NotifyResult = {
      recipients: 0,
      inApp: 0,
      queued: 0,
      skipped: 0,
    };
    const pageSize = 200;
    let cursor: string | undefined;

    for (;;) {
      const users = await this.prisma.user.findMany({
        where: this.audienceWhere(job.audience, job.userIds),
        select: { id: true },
        orderBy: { id: 'asc' },
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (users.length === 0) break;

      const r = await this.notify({
        recipientIds: users.map((u) => u.id),
        category: job.category,
        channels: job.channels,
        title: job.title,
        body: job.body,
        link: job.link,
        data: { broadcastId: job.broadcastId },
        dedupeKey: `broadcast:${job.broadcastId}`,
      });
      totals.recipients += r.recipients;
      totals.inApp += r.inApp;
      totals.queued += r.queued;
      totals.skipped += r.skipped;

      cursor = users[users.length - 1].id;
      if (users.length < pageSize) break;
    }
    this.logger.log(
      `Broadcast ${job.broadcastId} done: ${JSON.stringify(totals)}`,
    );
    return totals;
  }

  async deliveryStats(days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.notificationRecord.groupBy({
      by: ['type', 'status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const byChannel: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      (byChannel[r.type] ??= {})[r.status] = r._count._all;
    }
    const recentFailures = await this.prisma.notificationRecord.findMany({
      where: { status: 'failed', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        type: true,
        category: true,
        title: true,
        error: true,
        attempts: true,
        createdAt: true,
        recipientId: true,
      },
    });
    return { since, byChannel, recentFailures };
  }

  private audienceWhere(
    audience: BroadcastJob['audience'],
    userIds?: string[],
  ): Prisma.UserWhereInput {
    switch (audience) {
      case 'customers':
        return { role: 'customer', isActive: true };
      case 'pharmacists':
        return { role: { in: ['pharmacist', 'staff'] }, isActive: true };
      case 'all':
        return {
          role: { in: ['customer', 'pharmacist', 'staff'] },
          isActive: true,
        };
      case 'users':
        return { id: { in: userIds ?? [] }, isActive: true };
    }
  }

  private audienceCount(
    audience: BroadcastJob['audience'],
    userIds?: string[],
  ): Promise<number> {
    return this.prisma.user.count({
      where: this.audienceWhere(audience, userIds),
    });
  }
}
