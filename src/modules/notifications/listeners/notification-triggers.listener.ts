import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@infra/database/prisma.service';
import {
  AdCampaignPayload,
  BatchUploadCompletedPayload,
  EVENTS,
  FeatureSuggestionPayload,
  PharmacyVerifiedPayload,
  PointsLevelUpgradedPayload,
  ReservationCreatedPayload,
  ReservationExpiredPayload,
  ReservationStatusChangedPayload,
  StockLowPayload,
  StockOutPayload,
  SubscriptionActivatedPayload,
  SubscriptionCancelledPayload,
  SubscriptionExpiredPayload,
  SubscriptionPaymentFailedPayload,
  SubscriptionPlanChangedPayload,
  SupportTicketPayload,
} from '@common/types/events.types';
import { NotificationsService } from '../notifications.service';
import { NotificationRecipientsService } from '../notification-recipients.service';
import { msg } from '../notification-messages';
import { NotifyRequest } from '../notification.types';

/**
 * Domain events → notifications. Each handler decides recipients and
 * channels; copy lives in notification-messages.ts. Handlers never throw
 * back into the emitting module.
 *
 * Every request carries a dedupe key derived from the event so a redelivered
 * event cannot notify the same person twice on the same channel.
 */
@Injectable()
export class NotificationTriggersListener {
  private readonly logger = new Logger(NotificationTriggersListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly recipients: NotificationRecipientsService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Reservations ────────────────────────────────────────────────────────────

  @OnEvent(EVENTS.RESERVATION.CREATED, { async: true })
  async onReservationCreated(p: ReservationCreatedPayload): Promise<void> {
    await this.run('reservation.created', async () => {
      const to = await this.recipients.pharmacyBranchTeam(
        p.pharmacyId,
        p.branchId,
      );
      return {
        ...msg.reservationCreated({
          reservationId: p.reservationId,
          code: p.reservationCode,
          items: p.items,
        }),
        recipientIds: to,
        category: 'reservation',
        channels: ['in_app', 'push'],
        dedupeKey: `reservation.created:${p.reservationId}`,
      };
    });
  }

  @OnEvent(EVENTS.RESERVATION.CONFIRMED, { async: true })
  async onReservationConfirmed(
    p: ReservationStatusChangedPayload,
  ): Promise<void> {
    await this.run('reservation.confirmed', async () => ({
      ...msg.reservationConfirmed({
        reservationId: p.reservationId,
        code: p.reservationCode,
        pharmacyName: await this.pharmacyName(p.pharmacyId),
      }),
      recipientIds: [p.customerId],
      category: 'reservation',
      channels: ['in_app', 'push'],
      dedupeKey: `reservation.confirmed:${p.reservationId}`,
    }));
  }

  @OnEvent(EVENTS.RESERVATION.READY, { async: true })
  async onReservationReady(p: ReservationStatusChangedPayload): Promise<void> {
    await this.run('reservation.ready', async () => ({
      ...msg.reservationReady({
        reservationId: p.reservationId,
        code: p.reservationCode,
        pharmacyName: await this.pharmacyName(p.pharmacyId),
      }),
      recipientIds: [p.customerId],
      category: 'reservation',
      channels: ['in_app', 'push'],
      dedupeKey: `reservation.ready:${p.reservationId}`,
    }));
  }

  @OnEvent(EVENTS.RESERVATION.SERVED, { async: true })
  async onReservationServed(p: ReservationStatusChangedPayload): Promise<void> {
    await this.run('reservation.served', async () => ({
      ...msg.reservationServed({
        reservationId: p.reservationId,
        code: p.reservationCode,
        pharmacyName: await this.pharmacyName(p.pharmacyId),
      }),
      recipientIds: [p.customerId],
      category: 'reservation',
      channels: ['in_app', 'push'],
      dedupeKey: `reservation.served:${p.reservationId}`,
    }));
  }

  @OnEvent(EVENTS.RESERVATION.CANCELLED_BY_PHARMACY, { async: true })
  async onCancelledByPharmacy(
    p: ReservationStatusChangedPayload,
  ): Promise<void> {
    await this.run('reservation.cancelled.pharmacy', async () => ({
      ...msg.reservationCancelledByPharmacy({
        reservationId: p.reservationId,
        code: p.reservationCode,
        pharmacyName: await this.pharmacyName(p.pharmacyId),
        reason: p.reason,
      }),
      recipientIds: [p.customerId],
      category: 'reservation',
      channels: ['in_app', 'push'],
      dedupeKey: `reservation.cancelled:${p.reservationId}`,
    }));
  }

  @OnEvent(EVENTS.RESERVATION.CANCELLED_BY_CUSTOMER, { async: true })
  async onCancelledByCustomer(
    p: ReservationStatusChangedPayload,
  ): Promise<void> {
    await this.run('reservation.cancelled.customer', async () => {
      const branchId = await this.reservationBranch(p.reservationId);
      return {
        ...msg.reservationCancelledByCustomer({
          reservationId: p.reservationId,
          code: p.reservationCode,
          reason: p.reason,
        }),
        recipientIds: await this.recipients.pharmacyBranchTeam(
          p.pharmacyId,
          branchId,
        ),
        category: 'reservation',
        channels: ['in_app', 'push'],
        dedupeKey: `reservation.cancelled:${p.reservationId}`,
      };
    });
  }

  @OnEvent(EVENTS.RESERVATION.STOCK_OUT_CANCELLED, { async: true })
  async onStockOutCancelled(p: ReservationStatusChangedPayload): Promise<void> {
    await this.run('reservation.cancelled.stock_out', async () => ({
      ...msg.reservationStockOut({
        reservationId: p.reservationId,
        code: p.reservationCode,
        pharmacyName: await this.pharmacyName(p.pharmacyId),
      }),
      recipientIds: [p.customerId],
      category: 'reservation',
      channels: ['in_app', 'push'],
      dedupeKey: `reservation.cancelled:${p.reservationId}`,
    }));
  }

  @OnEvent(EVENTS.RESERVATION.EXPIRED, { async: true })
  async onReservationExpired(p: ReservationExpiredPayload): Promise<void> {
    await this.run('reservation.expired', () =>
      Promise.resolve({
        ...msg.reservationExpired({
          reservationId: p.reservationId,
          code: p.reservationCode,
        }),
        recipientIds: [p.customerId],
        category: 'reservation' as const,
        channels: ['in_app', 'push'] as NotifyRequest['channels'],
        dedupeKey: `reservation.expired:${p.reservationId}`,
      }),
    );
  }

  // ─── Inventory ───────────────────────────────────────────────────────────────

  @OnEvent(EVENTS.INVENTORY.STOCK_LOW, { async: true })
  async onStockLow(p: StockLowPayload): Promise<void> {
    await this.run('inventory.stock.low', async () => {
      const { drugName, branchName } = await this.drugAndBranch(
        p.drugId,
        p.branchId,
      );
      return {
        ...msg.stockLow({
          drugId: p.drugId,
          drugName,
          branchName,
          quantity: p.currentQuantity,
        }),
        recipientIds: await this.recipients.pharmacyBranchTeam(
          p.pharmacyId,
          p.branchId,
        ),
        category: 'inventory',
        channels: ['in_app', 'push'],
        // One low-stock alert per drug per day
        dedupeKey: `inventory.stock.low:${p.drugId}:${this.today()}`,
      };
    });
  }

  @OnEvent(EVENTS.INVENTORY.STOCK_OUT, { async: true })
  async onStockOut(p: StockOutPayload): Promise<void> {
    await this.run('inventory.stock.out', async () => {
      const { drugName, branchName } = await this.drugAndBranch(
        p.drugId,
        p.branchId,
      );
      const content = msg.stockOut({ drugId: p.drugId, drugName, branchName });
      const key = `inventory.stock.out:${p.drugId}:${this.today()}`;

      // Team gets push + in-app; only the owner gets the SMS
      await this.notifications.notify({
        ...content,
        recipientIds: await this.recipients.pharmacyBranchTeam(
          p.pharmacyId,
          p.branchId,
        ),
        category: 'inventory',
        channels: ['in_app', 'push'],
        dedupeKey: key,
      });
      return {
        ...content,
        recipientIds: await this.recipients.pharmacyOwner(p.pharmacyId),
        category: 'inventory',
        channels: ['sms'],
        dedupeKey: key,
      };
    });
  }

  @OnEvent(EVENTS.INVENTORY.BATCH_UPLOAD_COMPLETED, { async: true })
  async onBatchUploadCompleted(p: BatchUploadCompletedPayload): Promise<void> {
    await this.run('inventory.batch_upload.completed', async () => ({
      ...msg.batchUploadDone({
        jobId: p.jobId,
        success: p.successCount,
        failed: p.failureCount,
      }),
      recipientIds: await this.recipients.pharmacyManagers(p.pharmacyId),
      category: 'inventory',
      channels: ['in_app', 'push'],
      dedupeKey: `inventory.batch_upload:${p.jobId}`,
    }));
  }

  // ─── Billing ─────────────────────────────────────────────────────────────────

  @OnEvent(EVENTS.SUBSCRIPTION.ACTIVATED, { async: true })
  async onSubscriptionActivated(
    p: SubscriptionActivatedPayload,
  ): Promise<void> {
    if (await this.isFreePlan(p.planId)) return; // nothing to celebrate for Sokka
    await this.run('subscription.activated', async () => ({
      ...msg.subscriptionActivated({
        planName: p.planName,
        expiresAt: p.expiresAt,
        interval: p.billingInterval,
      }),
      recipientIds: await this.recipients.pharmacyOwner(p.pharmacyId),
      category: 'billing',
      channels: ['in_app', 'push', 'email'],
      dedupeKey: `subscription.activated:${p.subscriptionId}:${new Date(p.activatedAt).toISOString()}`,
    }));
  }

  @OnEvent(EVENTS.SUBSCRIPTION.PAYMENT_FAILED, { async: true })
  async onPaymentFailed(p: SubscriptionPaymentFailedPayload): Promise<void> {
    await this.run('subscription.payment.failed', async () => ({
      ...msg.paymentFailed({
        planName: p.planName,
        amountKobo: p.amountKobo,
        graceUntil: p.graceUntil,
        reason: p.reason,
      }),
      recipientIds: await this.recipients.pharmacyOwner(p.pharmacyId),
      category: 'billing',
      channels: ['in_app', 'push', 'email', 'sms'],
      // At most one failure alert per subscription per grace window
      dedupeKey: `subscription.payment.failed:${p.subscriptionId}:${p.graceUntil ? new Date(p.graceUntil).toISOString().slice(0, 10) : this.today()}`,
    }));
  }

  @OnEvent(EVENTS.SUBSCRIPTION.GRACE_PERIOD_EXPIRED, { async: true })
  async onPlanExpired(p: SubscriptionExpiredPayload): Promise<void> {
    await this.run('subscription.expired', async () => ({
      ...msg.planExpired({
        planName: p.planName,
        downgradedTo: p.downgradedToPlanName,
      }),
      recipientIds: await this.recipients.pharmacyOwner(p.pharmacyId),
      category: 'billing',
      channels: ['in_app', 'push', 'email'],
      dedupeKey: `subscription.expired:${p.subscriptionId}:${new Date(p.expiredAt).toISOString().slice(0, 10)}`,
    }));
  }

  @OnEvent(EVENTS.SUBSCRIPTION.CANCELLED, { async: true })
  async onSubscriptionCancelled(
    p: SubscriptionCancelledPayload,
  ): Promise<void> {
    await this.run('subscription.cancelled', async () => ({
      ...msg.subscriptionCancelled({
        planName: p.planName,
        accessUntil: p.accessUntil,
      }),
      recipientIds: await this.recipients.pharmacyOwner(p.pharmacyId),
      category: 'billing',
      channels: ['in_app', 'email'],
      dedupeKey: `subscription.cancelled:${p.subscriptionId}:${new Date(p.cancelledAt).toISOString()}`,
    }));
  }

  @OnEvent(EVENTS.SUBSCRIPTION.UPGRADED, { async: true })
  @OnEvent(EVENTS.SUBSCRIPTION.DOWNGRADED, { async: true })
  async onPlanChanged(p: SubscriptionPlanChangedPayload): Promise<void> {
    await this.run('subscription.plan_changed', async () => ({
      ...msg.planChanged({
        previousPlanName: p.previousPlanName,
        newPlanName: p.newPlanName,
        effectiveImmediately: p.effectiveImmediately,
        effectiveAt: p.effectiveAt,
      }),
      recipientIds: await this.recipients.pharmacyManagers(p.pharmacyId),
      category: 'billing',
      channels: ['in_app'],
      dedupeKey: `subscription.plan_changed:${p.subscriptionId}:${p.newPlanId}:${new Date(p.effectiveAt).toISOString()}`,
    }));
  }

  // ─── Ads ─────────────────────────────────────────────────────────────────────

  @OnEvent(EVENTS.ADS.CAMPAIGN_APPROVED, { async: true })
  async onAdApproved(p: AdCampaignPayload): Promise<void> {
    await this.adNotice(
      p,
      'approved',
      msg.adApproved({ campaignId: p.campaignId, title: p.title }),
    );
  }

  @OnEvent(EVENTS.ADS.CAMPAIGN_REJECTED, { async: true })
  async onAdRejected(p: AdCampaignPayload): Promise<void> {
    await this.adNotice(
      p,
      `rejected:${new Date(p.occurredAt).toISOString()}`,
      msg.adRejected({
        campaignId: p.campaignId,
        title: p.title,
        reason: p.reason,
      }),
    );
  }

  @OnEvent(EVENTS.ADS.CAMPAIGN_ACTIVATED, { async: true })
  async onAdActivated(p: AdCampaignPayload): Promise<void> {
    await this.adNotice(
      p,
      'activated',
      msg.adActivated({ campaignId: p.campaignId, title: p.title }),
    );
  }

  @OnEvent(EVENTS.ADS.CAMPAIGN_EXPIRED, { async: true })
  async onAdExpired(p: AdCampaignPayload): Promise<void> {
    await this.adNotice(
      p,
      'expired',
      msg.adExpired({ campaignId: p.campaignId, title: p.title }),
    );
  }

  private async adNotice(
    p: AdCampaignPayload,
    stage: string,
    content: ReturnType<typeof msg.adApproved>,
  ) {
    await this.run(`ads.${stage}`, async () => ({
      ...content,
      recipientIds: await this.recipients.pharmacyManagers(p.pharmacyId),
      category: 'ads',
      channels: ['in_app', 'push'],
      dedupeKey: `ads.${stage}:${p.campaignId}`,
    }));
  }

  // ─── Points ──────────────────────────────────────────────────────────────────

  @OnEvent(EVENTS.POINTS.LEVEL_UPGRADED, { async: true })
  async onLevelUp(p: PointsLevelUpgradedPayload): Promise<void> {
    await this.run('points.level.upgraded', async () => {
      const forPharmacy = !!p.pharmacyId;
      return {
        ...msg.levelUp({
          toLevel: p.toLevel,
          levelName: p.levelName,
          forPharmacy,
        }),
        recipientIds: forPharmacy
          ? await this.recipients.pharmacyManagers(p.pharmacyId!)
          : [p.userId!].filter(Boolean),
        category: 'points',
        channels: ['in_app', 'push'],
        dedupeKey: `points.level:${p.ledgerId}:${p.toLevel}`,
      };
    });
  }

  // ─── Pharmacy verification ───────────────────────────────────────────────────

  @OnEvent(EVENTS.PHARMACY.VERIFIED, { async: true })
  async onPharmacyVerified(p: PharmacyVerifiedPayload): Promise<void> {
    await this.run('pharmacy.verified', async () => ({
      ...msg.pharmacyVerified(),
      recipientIds: await this.recipients.pharmacyManagers(p.pharmacyId),
      category: 'account',
      channels: ['in_app', 'push', 'email'],
      dedupeKey: `pharmacy.verified:${p.pharmacyId}:${new Date(p.verifiedAt).toISOString().slice(0, 10)}`,
    }));
  }

  // ─── Support ─────────────────────────────────────────────────────────────────
  // Category `account`: support conversations are never muted.

  @OnEvent(EVENTS.SUPPORT.TICKET_CREATED, { async: true })
  async onTicketCreated(p: SupportTicketPayload): Promise<void> {
    if (!p.submitterId) return;
    await this.run('support.ticket.created', () =>
      Promise.resolve({
        ...msg.ticketReceived({
          ticketId: p.ticketId,
          ticketNumber: p.ticketNumber,
          subject: p.subject,
        }),
        recipientIds: [p.submitterId!],
        category: 'account' as const,
        channels: ['in_app'] as NotifyRequest['channels'],
        dedupeKey: `support.ticket.created:${p.ticketId}`,
      }),
    );
  }

  @OnEvent(EVENTS.SUPPORT.TICKET_STAFF_REPLIED, { async: true })
  async onTicketReply(p: SupportTicketPayload): Promise<void> {
    if (!p.submitterId) return;
    await this.run('support.ticket.replied', () =>
      Promise.resolve({
        ...msg.ticketReply({
          ticketId: p.ticketId,
          ticketNumber: p.ticketNumber,
          preview: p.messagePreview,
        }),
        recipientIds: [p.submitterId!],
        category: 'account' as const,
        channels: ['in_app', 'push'] as NotifyRequest['channels'],
        // Every reply is new; no dedupe across replies
        dedupeKey: `support.ticket.reply:${p.ticketId}:${new Date(p.occurredAt).toISOString()}`,
      }),
    );
  }

  @OnEvent(EVENTS.SUPPORT.TICKET_STATUS_CHANGED, { async: true })
  async onTicketStatus(p: SupportTicketPayload): Promise<void> {
    if (!p.submitterId) return;
    const done = p.status === 'resolved' || p.status === 'closed';
    await this.run('support.ticket.status', () =>
      Promise.resolve({
        ...msg.ticketStatus({
          ticketId: p.ticketId,
          ticketNumber: p.ticketNumber,
          subject: p.subject,
          status: p.status,
          note: p.resolutionNote,
        }),
        recipientIds: [p.submitterId!],
        category: 'account' as const,
        channels: (done
          ? ['in_app', 'push', 'email']
          : ['in_app', 'push']) as NotifyRequest['channels'],
        dedupeKey: `support.ticket.status:${p.ticketId}:${p.status}:${new Date(p.occurredAt).toISOString()}`,
      }),
    );
  }

  @OnEvent(EVENTS.SUPPORT.SUGGESTION_STATUS_CHANGED, { async: true })
  async onSuggestionStatus(p: FeatureSuggestionPayload): Promise<void> {
    if (!p.submitterId) return;
    await this.run('support.suggestion.status', () =>
      Promise.resolve({
        ...msg.suggestionStatus({
          title: p.title,
          status: p.status,
          note: p.adminNote,
        }),
        recipientIds: [p.submitterId!],
        category: 'system' as const,
        channels: ['in_app', 'push'] as NotifyRequest['channels'],
        dedupeKey: `support.suggestion:${p.suggestionId}:${p.status}`,
      }),
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async run(
    label: string,
    build: () => Promise<NotifyRequest>,
  ): Promise<void> {
    try {
      const req = await build();
      if (req.recipientIds.length === 0) return;
      await this.notifications.notify(req);
    } catch (err) {
      this.logger.error(`Notification trigger ${label} failed`, err as Error);
    }
  }

  private async pharmacyName(pharmacyId: string): Promise<string> {
    const p = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { name: true },
    });
    return p?.name ?? 'The pharmacy';
  }

  private async reservationBranch(
    reservationId: string,
  ): Promise<string | undefined> {
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { branchId: true },
    });
    return r?.branchId;
  }

  private async drugAndBranch(drugId: string, branchId: string) {
    const [drug, branch] = await Promise.all([
      this.prisma.drug.findUnique({
        where: { id: drugId },
        select: { name: true },
      }),
      this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { name: true },
      }),
    ]);
    return {
      drugName: drug?.name ?? 'A drug',
      branchName: branch?.name ?? 'your branch',
    };
  }

  private async isFreePlan(planId: string): Promise<boolean> {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
      select: { monthlyPrice: true },
    });
    return !plan || Number(plan.monthlyPrice) <= 0;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
