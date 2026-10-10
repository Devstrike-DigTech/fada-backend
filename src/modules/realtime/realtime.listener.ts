import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@infra/database/prisma.service';
import { SocketGateway } from '@infra/sockets/socket.gateway';
import { SOCKET_EVENTS, rooms } from '@infra/sockets/socket-rooms';
import {
  AdPaymentSuccessfulPayload,
  BatchUploadProgressPayload,
  EVENTS,
  ReservationCreatedPayload,
  ReservationExpiredPayload,
  ReservationStatusChangedPayload,
  SubscriptionActivatedPayload,
  SubscriptionCancelledPayload,
  SubscriptionExpiredPayload,
  SubscriptionPaymentFailedPayload,
  SubscriptionPaymentSuccessfulPayload,
  SubscriptionPlanChangedPayload,
  SubscriptionRenewedPayload,
  SupportTicketPayload,
} from '@common/types/events.types';

/**
 * Domain events → WebSocket rooms. Payloads are deliberately small (ids,
 * status, timestamps): clients refetch details over HTTP, so nothing a room
 * member should not see travels over the socket.
 */
@Injectable()
export class RealtimeListener {
  private readonly logger = new Logger(RealtimeListener.name);

  constructor(
    private readonly socket: SocketGateway,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Reservations ────────────────────────────────────────────────────────────

  @OnEvent(EVENTS.RESERVATION.CREATED, { async: true })
  onReservationCreated(p: ReservationCreatedPayload): void {
    this.safe('reservation.created', () => {
      const payload = {
        reservationId: p.reservationId,
        code: p.reservationCode,
        status: 'pending',
        pharmacyId: p.pharmacyId,
        branchId: p.branchId,
        itemCount: p.items.length,
        expiresAt: p.expiresAt,
        createdAt: p.createdAt,
      };
      this.socket.emitToRooms(
        [
          rooms.pharmacyReservations(p.pharmacyId),
          rooms.branchReservations(p.branchId),
          rooms.customerReservations(p.customerId),
        ],
        SOCKET_EVENTS.RESERVATION_CREATED,
        payload,
      );
      this.socket.emitToRoom(rooms.adminFeed(), SOCKET_EVENTS.ADMIN_ACTIVITY, {
        type: 'reservation.created',
        ...payload,
      });
    });
  }

  @OnEvent(EVENTS.RESERVATION.CONFIRMED, { async: true })
  @OnEvent(EVENTS.RESERVATION.READY, { async: true })
  @OnEvent(EVENTS.RESERVATION.SERVED, { async: true })
  @OnEvent(EVENTS.RESERVATION.CANCELLED_BY_CUSTOMER, { async: true })
  @OnEvent(EVENTS.RESERVATION.CANCELLED_BY_PHARMACY, { async: true })
  @OnEvent(EVENTS.RESERVATION.STOCK_OUT_CANCELLED, { async: true })
  async onReservationStatus(p: ReservationStatusChangedPayload): Promise<void> {
    await this.safeAsync('reservation.status', async () => {
      const branchId = p.branchId ?? (await this.branchOf(p.reservationId));
      this.emitReservationUpdate({
        reservationId: p.reservationId,
        code: p.reservationCode,
        customerId: p.customerId,
        pharmacyId: p.pharmacyId,
        branchId,
        status: p.newStatus,
        previousStatus: p.previousStatus,
        reason: p.reason,
        changedAt: p.changedAt,
      });
    });
  }

  @OnEvent(EVENTS.RESERVATION.EXPIRED, { async: true })
  async onReservationExpired(p: ReservationExpiredPayload): Promise<void> {
    await this.safeAsync('reservation.expired', async () => {
      const branchId = p.branchId ?? (await this.branchOf(p.reservationId));
      this.emitReservationUpdate({
        reservationId: p.reservationId,
        code: p.reservationCode,
        customerId: p.customerId,
        pharmacyId: p.pharmacyId,
        branchId,
        status: 'expired',
        changedAt: p.expiredAt,
      });
    });
  }

  private emitReservationUpdate(u: {
    reservationId: string;
    code: string;
    customerId: string;
    pharmacyId: string;
    branchId?: string;
    status: string;
    previousStatus?: string;
    reason?: string;
    changedAt: Date;
  }): void {
    const target = [
      rooms.reservation(u.reservationId),
      rooms.customerReservations(u.customerId),
      rooms.pharmacyReservations(u.pharmacyId),
      ...(u.branchId ? [rooms.branchReservations(u.branchId)] : []),
    ];
    this.socket.emitToRooms(target, SOCKET_EVENTS.RESERVATION_UPDATED, {
      reservationId: u.reservationId,
      code: u.code,
      status: u.status,
      previousStatus: u.previousStatus ?? null,
      reason: u.reason ?? null,
      pharmacyId: u.pharmacyId,
      branchId: u.branchId ?? null,
      changedAt: u.changedAt,
    });
  }

  // ─── Inventory uploads ───────────────────────────────────────────────────────

  @OnEvent(EVENTS.INVENTORY.BATCH_UPLOAD_PROGRESS, { async: true })
  onBatchProgress(p: BatchUploadProgressPayload): void {
    this.safe('batch_upload.progress', () =>
      this.socket.emitToRoom(
        rooms.batchUpload(p.jobId),
        SOCKET_EVENTS.BATCH_UPLOAD_PROGRESS,
        {
          jobId: p.jobId,
          branchId: p.branchId,
          status: p.status,
          processed: p.processed,
          total: p.total,
          added: p.added,
          errors: p.errors,
          percent: p.percent,
          message: p.message ?? null,
          done: p.status !== 'processing',
        },
      ),
    );
  }

  // ─── Billing (owner / operators) ─────────────────────────────────────────────

  @OnEvent(EVENTS.SUBSCRIPTION.ACTIVATED, { async: true })
  onActivated(p: SubscriptionActivatedPayload): void {
    this.billing(p.pharmacyId, {
      type: 'activated',
      planName: p.planName,
      interval: p.billingInterval,
      expiresAt: p.expiresAt,
    });
  }

  @OnEvent(EVENTS.SUBSCRIPTION.PAYMENT_SUCCESSFUL, { async: true })
  onPaid(p: SubscriptionPaymentSuccessfulPayload): void {
    this.billing(p.pharmacyId, {
      type: 'payment_successful',
      reference: p.reference,
      planName: p.planName,
      amountKobo: p.amountKobo,
      expiresAt: p.expiresAt,
    });
  }

  @OnEvent(EVENTS.SUBSCRIPTION.PAYMENT_FAILED, { async: true })
  onPaymentFailed(p: SubscriptionPaymentFailedPayload): void {
    this.billing(p.pharmacyId, {
      type: 'payment_failed',
      reference: p.reference ?? null,
      planName: p.planName,
      graceUntil: p.graceUntil ?? null,
    });
  }

  @OnEvent(EVENTS.SUBSCRIPTION.RENEWED, { async: true })
  onRenewed(p: SubscriptionRenewedPayload): void {
    this.billing(p.pharmacyId, {
      type: 'renewed',
      planName: p.planName,
      expiresAt: p.expiresAt,
    });
  }

  @OnEvent(EVENTS.SUBSCRIPTION.CANCELLED, { async: true })
  onCancelled(p: SubscriptionCancelledPayload): void {
    this.billing(p.pharmacyId, {
      type: 'cancelled',
      planName: p.planName,
      accessUntil: p.accessUntil,
    });
  }

  @OnEvent(EVENTS.SUBSCRIPTION.UPGRADED, { async: true })
  @OnEvent(EVENTS.SUBSCRIPTION.DOWNGRADED, { async: true })
  onPlanChanged(p: SubscriptionPlanChangedPayload): void {
    this.billing(p.pharmacyId, {
      type: 'plan_changed',
      planName: p.newPlanName,
      previousPlanName: p.previousPlanName,
      effectiveImmediately: p.effectiveImmediately,
      effectiveAt: p.effectiveAt,
    });
  }

  @OnEvent(EVENTS.SUBSCRIPTION.GRACE_PERIOD_EXPIRED, { async: true })
  onExpired(p: SubscriptionExpiredPayload): void {
    this.billing(p.pharmacyId, {
      type: 'expired',
      planName: p.planName,
      downgradedTo: p.downgradedToPlanName ?? null,
    });
  }

  @OnEvent(EVENTS.ADS.PAYMENT_SUCCESSFUL, { async: true })
  onAdPaid(p: AdPaymentSuccessfulPayload): void {
    this.safe('ads.payment', () =>
      this.socket.emitToRoom(
        rooms.pharmacyBilling(p.pharmacyId),
        SOCKET_EVENTS.AD_PAYMENT_UPDATED,
        {
          campaignId: p.campaignId,
          reference: p.reference,
          amountKobo: p.amountKobo,
          paidAt: p.paidAt,
          status: 'paid',
        },
      ),
    );
  }

  private billing(pharmacyId: string, data: Record<string, unknown>): void {
    this.safe('subscription', () =>
      this.socket.emitToRoom(
        rooms.pharmacyBilling(pharmacyId),
        SOCKET_EVENTS.SUBSCRIPTION_UPDATED,
        {
          pharmacyId,
          ...data,
          at: new Date(),
        },
      ),
    );
  }

  // ─── Support (live ticket thread) ────────────────────────────────────────────

  @OnEvent(EVENTS.SUPPORT.TICKET_STAFF_REPLIED, { async: true })
  @OnEvent(EVENTS.SUPPORT.TICKET_STATUS_CHANGED, { async: true })
  onTicketUpdate(p: SupportTicketPayload): void {
    if (!p.submitterId) return;
    this.safe('support.ticket', () =>
      this.socket.emitToUser(
        p.submitterId!,
        SOCKET_EVENTS.SUPPORT_TICKET_UPDATED,
        {
          ticketId: p.ticketId,
          ticketNumber: p.ticketNumber,
          status: p.status,
          hasNewReply: !!p.messagePreview,
          at: p.occurredAt,
        },
      ),
    );
  }

  @OnEvent(EVENTS.SUPPORT.TICKET_CREATED, { async: true })
  @OnEvent(EVENTS.SUPPORT.TICKET_USER_REPLIED, { async: true })
  onTicketForAdmins(p: SupportTicketPayload): void {
    this.safe('support.admin', () =>
      this.socket.emitToRoom(rooms.adminFeed(), SOCKET_EVENTS.ADMIN_ACTIVITY, {
        type: p.messagePreview
          ? 'support.ticket.user_replied'
          : 'support.ticket.created',
        ticketId: p.ticketId,
        ticketNumber: p.ticketNumber,
        category: p.category,
        status: p.status,
        at: p.occurredAt,
      }),
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async branchOf(reservationId: string): Promise<string | undefined> {
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { branchId: true },
    });
    return r?.branchId;
  }

  private safe(label: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.logger.warn(
        `Realtime ${label} emit failed: ${(err as Error).message}`,
      );
    }
  }

  private async safeAsync(
    label: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        `Realtime ${label} emit failed: ${(err as Error).message}`,
      );
    }
  }
}
