import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Prisma, ReservationStatus } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import {
  EVENTS,
  ReservationCreatedPayload,
  ReservationExpiredPayload,
  ReservationStatusChangedPayload,
} from '@common/types/events.types';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationQueryDto } from './dto/reservation-query.dto';
import { CancelReservationDto } from './dto/cancel-reservation.dto';
import { ServeReservationDto } from './dto/serve-reservation.dto';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Hours before an uncollected reservation is automatically expired */
const RESERVATION_EXPIRY_HOURS = 2;

/** Characters used in the human-readable code — no ambiguous chars (0/O, 1/I) */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Allowed status transitions.
 * key = current status, value = list of valid next statuses.
 */
const VALID_TRANSITIONS: Partial<
  Record<ReservationStatus, ReservationStatus[]>
> = {
  pending: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['ready', 'cancelled', 'expired'],
  ready: ['served', 'cancelled', 'expired'],
};

// ─── Prisma include shape used throughout the service ─────────────────────────

const RESERVATION_INCLUDE = {
  items: {
    include: {
      drug: {
        select: {
          id: true,
          name: true,
          genericName: true,
          price: true,
          stockStatus: true,
          images: { where: { sortOrder: 0 }, take: 1 },
        },
      },
    },
  },
  branch: {
    select: {
      id: true,
      name: true,
      address: true,
      pharmacy: { select: { id: true, name: true, phone: true } },
    },
  },
  customer: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      // Customers keep their name on the profile, not the user row
      customerProfile: { select: { firstName: true, lastName: true } },
    },
  },
} as const;

type ReservationWithIncludes = Prisma.ReservationGetPayload<{
  include: typeof RESERVATION_INCLUDE;
}>;

@Injectable()
export class ReservationService implements OnModuleInit {
  private readonly logger = new Logger(ReservationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    @InjectQueue(QUEUE_NAMES.RESERVATION_EXPIRY)
    private readonly expiryQueue: Queue,
  ) {}

  // ─── Module Init ─────────────────────────────────────────────────────────────

  /**
   * Registers the repeatable expiry-sweep job on startup.
   * Clears any stale repeatable jobs first to prevent duplicates on restart.
   */
  async onModuleInit() {
    try {
      const existing = await this.expiryQueue.getRepeatableJobs();
      await Promise.all(
        existing.map((j) => this.expiryQueue.removeRepeatableByKey(j.key)),
      );

      await this.expiryQueue.add(
        'expire',
        {},
        {
          repeat: { cron: '*/5 * * * *' },
          removeOnComplete: 20,
          removeOnFail: 20,
        },
      );
      this.logger.log('Reservation expiry cron scheduled (*/5 * * * *)');
    } catch (err) {
      this.logger.error('Failed to schedule reservation expiry cron', err);
    }
  }

  // ─── Create Reservation ──────────────────────────────────────────────────────

  async createReservation(customerId: string, dto: CreateReservationDto) {
    // Validate branch + pharmacy
    const branch = await this.prisma.branch.findUnique({
      where: { id: dto.branchId },
      include: {
        pharmacy: {
          select: { id: true, name: true, isActive: true, isVerified: true },
        },
      },
    });

    if (!branch || !branch.isActive) {
      throw new NotFoundException('Branch not found or inactive');
    }
    if (!branch.pharmacy.isActive || !branch.pharmacy.isVerified) {
      throw new BadRequestException('Pharmacy is not active or verified');
    }

    // Validate drugs belong to this branch and have enough stock
    const drugIds = dto.items.map((i) => i.drugId);
    const drugs = await this.prisma.drug.findMany({
      where: { id: { in: drugIds }, branchId: dto.branchId },
    });

    if (drugs.length !== drugIds.length) {
      const foundIds = new Set(drugs.map((d) => d.id));
      const missing = drugIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(
        `The following drugs are not available at this branch: ${missing.join(', ')}`,
      );
    }

    const drugMap = new Map(drugs.map((d) => [d.id, d]));

    for (const item of dto.items) {
      const drug = drugMap.get(item.drugId)!;
      if (drug.stockStatus === 'out_of_stock' || drug.stockAmount <= 0) {
        throw new BadRequestException(
          `"${drug.name}" is currently out of stock`,
        );
      }
      if (drug.stockAmount < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for "${drug.name}": ` +
            `requested ${item.quantity}, available ${drug.stockAmount}`,
        );
      }
    }

    // Compute totals
    let totalAmount = new Prisma.Decimal(0);
    const itemsData = dto.items.map((item) => {
      const drug = drugMap.get(item.drugId)!;
      const unitPrice = drug.price;
      const subtotal = new Prisma.Decimal(unitPrice).mul(item.quantity);
      totalAmount = totalAmount.add(subtotal);
      return {
        drugId: item.drugId,
        quantity: item.quantity,
        unitPrice,
        subtotal,
        status: 'available' as const,
      };
    });

    const reservationCode = this.generateReservationCode();
    const qrCodeUrl = this.buildQrCodeUrl(reservationCode);
    const expiresAt = new Date(
      Date.now() + RESERVATION_EXPIRY_HOURS * 60 * 60 * 1000,
    );

    // Atomic creation
    const reservation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.reservation.create({
        data: {
          customerId,
          branchId: dto.branchId,
          alphanumericCode: reservationCode,
          qrCodeUrl,
          status: 'pending',
          notes: dto.notes,
          totalAmount,
          expiresAt,
          items: { create: itemsData },
        },
        include: RESERVATION_INCLUDE,
      });

      await tx.reservationStatusHistory.create({
        data: {
          reservationId: created.id,
          fromStatus: 'pending',
          toStatus: 'pending',
          changedBy: customerId,
          note: 'Reservation created',
        },
      });

      return created;
    });

    this.eventBus.emit(EVENTS.RESERVATION.CREATED, {
      reservationId: reservation.id,
      reservationCode,
      customerId,
      branchId: dto.branchId,
      pharmacyId: branch.pharmacy.id,
      items: reservation.items.map((i) => ({
        drugId: i.drugId,
        drugName: i.drug.name,
        quantity: i.quantity,
      })),
      expiresAt,
      createdAt: reservation.createdAt,
    } satisfies ReservationCreatedPayload);

    this.logger.log(
      `Reservation created: ${reservationCode} (customer: ${customerId})`,
    );
    return reservation;
  }

  // ─── Get by ID ───────────────────────────────────────────────────────────────

  async getReservationById(
    reservationId: string,
    requestingUserId: string,
    userRole: string,
  ): Promise<ReservationWithIncludes> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: RESERVATION_INCLUDE,
    });
    if (!reservation) throw new NotFoundException('Reservation not found');

    if (userRole === 'customer') {
      if (reservation.customerId !== requestingUserId) {
        throw new ForbiddenException('You can only view your own reservations');
      }
    } else if (userRole === 'pharmacist' || userRole === 'staff') {
      await this.assertBranchAccess(requestingUserId, reservation.branchId);
    }

    return reservation;
  }

  // ─── Customer: list own reservations ─────────────────────────────────────────

  async listCustomerReservations(
    customerId: string,
    query: ReservationQueryDto,
  ) {
    const where = this.buildWhereClause({ customerId }, query);
    return this.paginatedQuery(where, query);
  }

  // ─── Pharmacist: list branch reservations ────────────────────────────────────

  async listBranchReservations(
    userId: string,
    branchId: string,
    query: ReservationQueryDto,
  ) {
    await this.assertBranchAccess(userId, branchId);
    const where = this.buildWhereClause({ branchId }, query);
    return this.paginatedQuery(where, query);
  }

  // ─── Verify by Code (QR scan / manual entry) ─────────────────────────────────

  async verifyByCode(
    code: string,
    pharmacistUserId: string,
  ): Promise<ReservationWithIncludes> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { alphanumericCode: code.trim().toUpperCase() },
      include: RESERVATION_INCLUDE,
    });
    if (!reservation) throw new NotFoundException('Reservation code not found');

    await this.assertBranchAccess(pharmacistUserId, reservation.branchId);
    return reservation;
  }

  // ─── Confirm (pharmacy acknowledges — drugs are set aside) ───────────────────

  async confirmReservation(
    pharmacistUserId: string,
    reservationId: string,
  ): Promise<ReservationWithIncludes> {
    const reservation = await this.findOrFail(reservationId);
    await this.assertBranchAccess(pharmacistUserId, reservation.branchId);
    this.assertTransition(reservation.status, 'confirmed');

    const updated = await this.performTransition(
      reservation.id,
      reservation.status,
      'confirmed',
      pharmacistUserId,
      'Reservation confirmed by pharmacy',
    );

    this.eventBus.emit(
      EVENTS.RESERVATION.CONFIRMED,
      this.buildStatusPayload(
        updated,
        reservation.status,
        'confirmed',
        pharmacistUserId,
      ),
    );

    return updated;
  }

  // ─── Mark Ready (drugs physically prepared, awaiting pickup) ─────────────────

  async markReady(
    pharmacistUserId: string,
    reservationId: string,
  ): Promise<ReservationWithIncludes> {
    const reservation = await this.findOrFail(reservationId);
    await this.assertBranchAccess(pharmacistUserId, reservation.branchId);
    this.assertTransition(reservation.status, 'ready');

    const updated = await this.performTransition(
      reservation.id,
      reservation.status,
      'ready',
      pharmacistUserId,
      'Drugs prepared and ready for pickup',
    );

    this.eventBus.emit(
      EVENTS.RESERVATION.READY,
      this.buildStatusPayload(
        updated,
        reservation.status,
        'ready',
        pharmacistUserId,
      ),
    );

    return updated;
  }

  // ─── Serve (customer collected — stock is deducted) ──────────────────────────

  async serveReservation(
    pharmacistUserId: string,
    reservationId: string,
    dto: ServeReservationDto,
  ): Promise<ReservationWithIncludes> {
    const reservation = await this.findOrFail(reservationId);
    await this.assertBranchAccess(pharmacistUserId, reservation.branchId);
    this.assertTransition(reservation.status, 'served');

    const prevStatus = reservation.status;

    const updated = await this.prisma.$transaction(async (tx) => {
      const served = await tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: 'served',
          servedBy: pharmacistUserId,
          servedAt: new Date(),
        },
        include: RESERVATION_INCLUDE,
      });

      await tx.reservationStatusHistory.create({
        data: {
          reservationId,
          fromStatus: prevStatus,
          toStatus: 'served',
          changedBy: pharmacistUserId,
          note: dto.note ?? 'Reservation served',
        },
      });

      // Deduct stock for every item
      for (const item of reservation.items) {
        const drug = await tx.drug.findUnique({
          where: { id: item.drugId },
          select: { stockAmount: true, lowStockThreshold: true },
        });
        if (!drug) continue;

        const newQty = Math.max(0, drug.stockAmount - item.quantity);
        const newStatus =
          newQty === 0
            ? 'out_of_stock'
            : newQty <= drug.lowStockThreshold
              ? 'low_stock'
              : 'in_stock';

        await tx.drug.update({
          where: { id: item.drugId },
          data: { stockAmount: newQty, stockStatus: newStatus },
        });
      }

      return served;
    });

    this.eventBus.emit(
      EVENTS.RESERVATION.SERVED,
      this.buildStatusPayload(updated, prevStatus, 'served', pharmacistUserId),
    );

    this.logger.log(
      `Reservation ${updated.alphanumericCode} served by ${pharmacistUserId}`,
    );
    return updated;
  }

  // ─── Cancel by Customer ───────────────────────────────────────────────────────

  async cancelByCustomer(
    customerId: string,
    reservationId: string,
    dto: CancelReservationDto,
  ): Promise<ReservationWithIncludes> {
    const reservation = await this.findOrFail(reservationId);

    if (reservation.customerId !== customerId) {
      throw new ForbiddenException('You can only cancel your own reservations');
    }
    this.assertTransition(reservation.status, 'cancelled');

    const prevStatus = reservation.status;

    const updated = await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: 'cancelled',
          cancelledBy: customerId,
          cancelledAt: new Date(),
        },
        include: RESERVATION_INCLUDE,
      });
      await tx.reservationStatusHistory.create({
        data: {
          reservationId,
          fromStatus: prevStatus,
          toStatus: 'cancelled',
          changedBy: customerId,
          note: dto.reason ?? 'Cancelled by customer',
        },
      });
      return cancelled;
    });

    this.eventBus.emit(
      EVENTS.RESERVATION.CANCELLED_BY_CUSTOMER,
      this.buildStatusPayload(
        updated,
        prevStatus,
        'cancelled',
        customerId,
        dto.reason,
      ),
    );

    return updated;
  }

  // ─── Cancel by Pharmacy ───────────────────────────────────────────────────────

  async cancelByPharmacy(
    pharmacistUserId: string,
    reservationId: string,
    dto: CancelReservationDto,
  ): Promise<ReservationWithIncludes> {
    const reservation = await this.findOrFail(reservationId);
    await this.assertBranchAccess(pharmacistUserId, reservation.branchId);
    this.assertTransition(reservation.status, 'cancelled');

    const prevStatus = reservation.status;

    const updated = await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: 'cancelled',
          cancelledBy: pharmacistUserId,
          cancelledAt: new Date(),
        },
        include: RESERVATION_INCLUDE,
      });
      await tx.reservationStatusHistory.create({
        data: {
          reservationId,
          fromStatus: prevStatus,
          toStatus: 'cancelled',
          changedBy: pharmacistUserId,
          note: dto.reason ?? 'Cancelled by pharmacy',
        },
      });
      return cancelled;
    });

    this.eventBus.emit(
      EVENTS.RESERVATION.CANCELLED_BY_PHARMACY,
      this.buildStatusPayload(
        updated,
        prevStatus,
        'cancelled',
        pharmacistUserId,
        dto.reason,
      ),
    );

    return updated;
  }

  // ─── Expire a single reservation (called by the expiry processor) ─────────────

  async expireReservation(reservationId: string): Promise<void> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { branch: { select: { pharmacyId: true } } },
    });
    if (!reservation) return;
    if (
      !(['pending', 'confirmed', 'ready'] as ReservationStatus[]).includes(
        reservation.status,
      )
    ) {
      return; // already in a terminal state
    }

    const prevStatus = reservation.status;

    await this.prisma.$transaction(async (tx) => {
      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'expired' },
      });
      await tx.reservationStatusHistory.create({
        data: {
          reservationId,
          fromStatus: prevStatus,
          toStatus: 'expired',
          note: 'Reservation automatically expired',
        },
      });
    });

    this.eventBus.emit(EVENTS.RESERVATION.EXPIRED, {
      reservationId,
      reservationCode: reservation.alphanumericCode,
      customerId: reservation.customerId,
      pharmacyId: reservation.branch.pharmacyId,
      branchId: reservation.branchId,
      expiredAt: new Date(),
    } satisfies ReservationExpiredPayload);
  }

  // ─── Cancel all active reservations for a drug (stock-out event) ─────────────

  async cancelReservationsForDrug(
    drugId: string,
    triggeredById?: string,
  ): Promise<void> {
    const active = await this.prisma.reservation.findMany({
      where: {
        status: { in: ['pending', 'confirmed', 'ready'] },
        items: { some: { drugId } },
      },
      include: { branch: { select: { pharmacyId: true } } },
    });

    if (active.length === 0) return;

    await Promise.all(
      active.map(async (r) => {
        const prevStatus = r.status;

        await this.prisma.$transaction(async (tx) => {
          await tx.reservation.update({
            where: { id: r.id },
            data: {
              status: 'cancelled',
              cancelledBy: triggeredById,
              cancelledAt: new Date(),
            },
          });
          await tx.reservationStatusHistory.create({
            data: {
              reservationId: r.id,
              fromStatus: prevStatus,
              toStatus: 'cancelled',
              note: `Auto-cancelled: drug ${drugId} went out of stock`,
            },
          });
        });

        this.eventBus.emit(EVENTS.RESERVATION.STOCK_OUT_CANCELLED, {
          reservationId: r.id,
          reservationCode: r.alphanumericCode,
          customerId: r.customerId,
          pharmacistId: triggeredById,
          pharmacyId: r.branch.pharmacyId,
          previousStatus: prevStatus,
          newStatus: 'cancelled',
          changedAt: new Date(),
          reason: 'Drug went out of stock',
        } satisfies ReservationStatusChangedPayload);

        this.logger.warn(
          `Reservation ${r.alphanumericCode} auto-cancelled: stock-out on drug ${drugId}`,
        );
      }),
    );
  }

  // ─── Return IDs of reservations that have passed their expiry time ────────────

  async findExpiredReservationIds(): Promise<string[]> {
    const rows = await this.prisma.reservation.findMany({
      where: {
        status: { in: ['pending', 'confirmed', 'ready'] },
        expiresAt: { lt: new Date() },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // ─── Branch access guard ─────────────────────────────────────────────────────

  async assertBranchAccess(userId: string, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { pharmacyId: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const pharmacyId = branch.pharmacyId;

    const profile = await this.prisma.pharmacistProfile.findFirst({
      where: {
        userId,
        pharmacyId,
        roleInPharmacy: { in: ['owner', 'operator'] },
      },
    });
    if (profile) return;

    const staff = await this.prisma.pharmacyStaff.findFirst({
      where: {
        userId,
        pharmacyId,
        isActive: true,
        OR: [{ branchId }, { branchId: null }],
      },
    });
    if (staff) return;

    throw new ForbiddenException('You do not have access to this branch');
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async findOrFail(id: string): Promise<ReservationWithIncludes> {
    const r = await this.prisma.reservation.findUnique({
      where: { id },
      include: RESERVATION_INCLUDE,
    });
    if (!r) throw new NotFoundException('Reservation not found');
    return r;
  }

  private assertTransition(
    current: ReservationStatus,
    target: ReservationStatus,
  ): void {
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed?.includes(target)) {
      throw new BadRequestException(
        `Cannot transition reservation from "${current}" to "${target}"`,
      );
    }
  }

  private async performTransition(
    reservationId: string,
    fromStatus: ReservationStatus,
    toStatus: ReservationStatus,
    changedBy: string,
    note: string,
  ): Promise<ReservationWithIncludes> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.reservation.update({
        where: { id: reservationId },
        data: { status: toStatus },
        include: RESERVATION_INCLUDE,
      });
      await tx.reservationStatusHistory.create({
        data: { reservationId, fromStatus, toStatus, changedBy, note },
      });
      return updated;
    });
  }

  private buildWhereClause(
    base: Prisma.ReservationWhereInput,
    query: ReservationQueryDto,
  ): Prisma.ReservationWhereInput {
    const groups: Record<string, ReservationStatus[]> = {
      active: ['pending', 'confirmed', 'ready'],
      served: ['served'],
      closed: ['expired', 'cancelled'],
    };
    return {
      ...base,
      ...(query.status && { status: query.status as ReservationStatus }),
      ...(query.group && { status: { in: groups[query.group] } }),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from && { gte: new Date(query.from) }),
              ...(query.to && { lte: new Date(query.to) }),
            },
          }
        : {}),
    };
  }

  private async paginatedQuery(
    where: Prisma.ReservationWhereInput,
    query: ReservationQueryDto,
  ) {
    const [total, reservations] = await Promise.all([
      this.prisma.reservation.count({ where }),
      this.prisma.reservation.findMany({
        where,
        include: RESERVATION_INCLUDE,
        // Open ones by what expires first; the rest by latest activity
        orderBy:
          query.group === 'active'
            ? [{ expiresAt: 'asc' }]
            : query.group === 'served'
              ? [{ servedAt: 'desc' }]
              : query.group === 'closed'
                ? [{ updatedAt: 'desc' }]
                : [{ createdAt: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
    ]);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return {
      data: reservations,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  private buildStatusPayload(
    reservation: ReservationWithIncludes,
    previousStatus: string,
    newStatus: string,
    pharmacistId?: string,
    reason?: string,
  ): ReservationStatusChangedPayload {
    return {
      reservationId: reservation.id,
      reservationCode: reservation.alphanumericCode,
      customerId: reservation.customerId,
      pharmacistId,
      pharmacyId: reservation.branch.pharmacy.id,
      branchId: reservation.branchId,
      previousStatus,
      newStatus,
      changedAt: new Date(),
      reason,
    };
  }

  private generateReservationCode(): string {
    const suffix = Array.from(
      { length: 7 },
      () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
    ).join('');
    return `RSV${suffix}`;
  }

  /**
   * Generates a QR-code image URL via the free qrserver.com API.
   * No extra npm dependencies required — the client embeds the URL directly.
   * Encoding: M (15% error correction) — good balance of size vs robustness.
   */
  private buildQrCodeUrl(code: string): string {
    const data = encodeURIComponent(code);
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${data}&format=png&ecc=M`;
  }
}
