import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PointsLedger, PointsReason, Prisma } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import {
  AdminActionPayload,
  EVENTS,
  PointsEarnedPayload,
  PointsLevelUpgradedPayload,
} from '@common/types/events.types';
import {
  EARNING_RULES,
  EarningRule,
  LedgerOwnerKind,
  REPUTATION_LEVELS,
  levelFor,
  levelProgress,
  ruleByKey,
} from './points.levels';
import {
  AdminAdjustPointsDto,
  LeaderboardQueryDto,
  PointsHistoryQueryDto,
} from './dto/points.dto';

type Owner =
  | { kind: 'customer'; userId: string }
  | { kind: 'pharmacy'; pharmacyId: string };

export interface AwardResult {
  awarded: boolean;
  /** Why nothing was awarded (duplicate, capped, …) */
  skipped?: 'duplicate' | 'daily_cap' | 'owner_missing';
  delta: number;
  balance: number;
  lifetimeEarned: number;
  level: number;
  leveledUp: boolean;
}

/**
 * Points ledger for customers and pharmacies.
 *
 * Awards are idempotent per (ledger, reason, referenceId): listeners can be
 * replayed safely. Levels are derived from lifetime points and never drop;
 * pharmacy levels are mirrored onto `pharmacies.reputation_*` so search
 * results and public profiles stay fast.
 */
@Injectable()
export class PointsService {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Awarding (used by listeners)
  // ═══════════════════════════════════════════════════════════════════════════

  async awardByRule(
    ruleKey: string,
    owner: Owner,
    referenceId: string,
    extra?: { note?: string; metadata?: Record<string, unknown> },
  ): Promise<AwardResult> {
    const rule = ruleByKey(ruleKey);
    if (rule.owner !== owner.kind) {
      throw new Error(
        `Rule ${ruleKey} targets ${rule.owner} ledgers, got ${owner.kind}`,
      );
    }
    return this.credit(owner, {
      delta: rule.points,
      reason: rule.reason,
      referenceId,
      note: extra?.note ?? rule.description,
      metadata: { ruleKey, ...(extra?.metadata ?? {}) },
      dailyCap: rule.dailyCap,
      ruleKey,
    });
  }

  /** Core credit/debit. Returns the post-state; never throws for business no-ops. */
  async credit(
    owner: Owner,
    tx: {
      delta: number;
      reason: PointsReason;
      referenceId?: string;
      note?: string;
      metadata?: Record<string, unknown>;
      createdById?: string;
      dailyCap?: number;
      ruleKey?: string;
    },
  ): Promise<AwardResult> {
    const ledger = await this.ensureLedger(owner);
    if (!ledger) {
      return {
        awarded: false,
        skipped: 'owner_missing',
        delta: 0,
        balance: 0,
        lifetimeEarned: 0,
        level: 1,
        leveledUp: false,
      };
    }

    // Daily cap (per rule reason, UTC day)
    if (tx.dailyCap !== undefined && tx.delta > 0) {
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const todays = await this.prisma.pointsTransaction.count({
        where: {
          ledgerId: ledger.id,
          reason: tx.reason,
          createdAt: { gte: dayStart },
          delta: { gt: 0 },
        },
      });
      if (todays >= tx.dailyCap) {
        return this.noop(ledger, 'daily_cap');
      }
    }

    const previousLevel = ledger.level;

    // Insert-first with skipDuplicates: a redelivered event inserts nothing and
    // the balance is never touched, without raising inside the transaction
    // (an error mid-transaction can leave a pooled connection unusable).
    const updated = await this.prisma.$transaction(async (db) => {
      const inserted = await db.pointsTransaction.createMany({
        data: [
          {
            ledgerId: ledger.id,
            delta: tx.delta,
            balanceAfter: 0,
            reason: tx.reason,
            referenceId: tx.referenceId,
            note: tx.note,
            metadata: (tx.metadata ?? null) as Prisma.InputJsonValue,
            createdById: tx.createdById,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return null;

      const fresh = await db.pointsLedger.update({
        where: { id: ledger.id },
        data: {
          balance: { increment: tx.delta },
          lifetimeEarned: tx.delta > 0 ? { increment: tx.delta } : undefined,
        },
      });
      const newLevel = levelFor(fresh.lifetimeEarned).level;
      const withLevel =
        newLevel !== fresh.level
          ? await db.pointsLedger.update({
              where: { id: fresh.id },
              data: { level: newLevel },
            })
          : fresh;

      // Record the post-transaction balance on the row just inserted
      await db.pointsTransaction.updateMany({
        where: tx.referenceId
          ? {
              ledgerId: ledger.id,
              reason: tx.reason,
              referenceId: tx.referenceId,
            }
          : {
              ledgerId: ledger.id,
              reason: tx.reason,
              referenceId: null,
              balanceAfter: 0,
            },
        data: { balanceAfter: withLevel.balance },
      });

      if (owner.kind === 'pharmacy') {
        await db.pharmacy.update({
          where: { id: owner.pharmacyId },
          data: {
            reputationPoints: withLevel.balance,
            reputationLevel: withLevel.level,
          },
        });
      }
      return withLevel;
    });

    if (!updated) return this.noop(ledger, 'duplicate');

    const leveledUp = updated.level > previousLevel;
    const ids =
      owner.kind === 'customer'
        ? { userId: owner.userId }
        : { pharmacyId: owner.pharmacyId };

    const earned: PointsEarnedPayload = {
      ...ids,
      ledgerId: ledger.id,
      points: tx.delta,
      newBalance: updated.balance,
      lifetimeEarned: updated.lifetimeEarned,
      reason: tx.reason,
      ruleKey: tx.ruleKey,
      referenceId: tx.referenceId,
      earnedAt: new Date(),
    };
    this.eventBus.emit(
      tx.delta >= 0 ? EVENTS.POINTS.EARNED : EVENTS.POINTS.REDEEMED,
      earned,
    );

    if (leveledUp) {
      const payload: PointsLevelUpgradedPayload = {
        ...ids,
        ledgerId: ledger.id,
        fromLevel: previousLevel,
        toLevel: updated.level,
        levelName: levelFor(updated.lifetimeEarned).name,
        lifetimeEarned: updated.lifetimeEarned,
        upgradedAt: new Date(),
      };
      this.eventBus.emit(EVENTS.POINTS.LEVEL_UPGRADED, payload);
      this.logger.log(
        `${owner.kind} ${JSON.stringify(ids)} reached LVL ${updated.level}`,
      );
    }

    return {
      awarded: true,
      delta: tx.delta,
      balance: updated.balance,
      lifetimeEarned: updated.lifetimeEarned,
      level: updated.level,
      leveledUp,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Read side
  // ═══════════════════════════════════════════════════════════════════════════

  async getCustomerSummary(
    requester: { sub: string; role: string },
    customerId: string,
  ) {
    this.assertSelfOrAdmin(requester, customerId);
    const user = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: { id: true, role: true, fadaId: true },
    });
    if (!user || user.role !== 'customer')
      throw new NotFoundException('Customer not found');
    const ledger = await this.ensureLedger({
      kind: 'customer',
      userId: customerId,
    });
    return this.presentLedger(ledger!, {
      kind: 'customer',
      userId: customerId,
      fadaId: user.fadaId,
    });
  }

  async getCustomerHistory(
    requester: { sub: string; role: string },
    customerId: string,
    query: PointsHistoryQueryDto,
  ) {
    this.assertSelfOrAdmin(requester, customerId);
    const ledger = await this.ensureLedger({
      kind: 'customer',
      userId: customerId,
    });
    if (!ledger) throw new NotFoundException('Customer not found');
    return this.history(ledger.id, query);
  }

  /** Public: level + badge for profiles and search cards. Members also see balance. */
  async getPharmacySummary(
    requester: { sub: string; role: string } | undefined,
    pharmacyId: string,
  ) {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { id: true, name: true, fadaId: true },
    });
    if (!pharmacy) throw new NotFoundException('Pharmacy not found');
    const ledger = await this.ensureLedger({ kind: 'pharmacy', pharmacyId });
    const isMember = requester
      ? await this.isPharmacyMemberOrAdmin(requester, pharmacyId)
      : false;

    const full = this.presentLedger(ledger!, {
      kind: 'pharmacy',
      pharmacyId,
      fadaId: pharmacy.fadaId,
      name: pharmacy.name,
    });
    if (isMember) return full;
    // Public view: hide spendable balance, keep reputation
    const publicView: Omit<typeof full, 'balance'> & { balance?: number } = {
      ...full,
    };
    delete publicView.balance;
    return publicView;
  }

  async getPharmacyHistory(
    requester: { sub: string; role: string },
    pharmacyId: string,
    query: PointsHistoryQueryDto,
  ) {
    if (!(await this.isPharmacyMemberOrAdmin(requester, pharmacyId))) {
      throw new ForbiddenException(
        'Only pharmacy members can view the points history',
      );
    }
    const ledger = await this.ensureLedger({ kind: 'pharmacy', pharmacyId });
    if (!ledger) throw new NotFoundException('Pharmacy not found');
    return this.history(ledger.id, query);
  }

  listLevels() {
    return REPUTATION_LEVELS.map((l) => ({ ...l, badge: `LVL ${l.level}` }));
  }

  listRules(owner?: LedgerOwnerKind) {
    return EARNING_RULES.filter((r) => !owner || r.owner === owner).map(
      (r: EarningRule) => ({
        key: r.key,
        owner: r.owner,
        points: r.points,
        description: r.description,
        reason: r.reason,
        dailyCap: r.dailyCap ?? null,
      }),
    );
  }

  async pharmacyLeaderboard(query: LeaderboardQueryDto) {
    const limit = query.limit ?? 20;
    const rows = await this.prisma.pointsLedger.findMany({
      where: {
        pharmacyId: { not: null },
        pharmacy: {
          isActive: true,
          ...(query.state
            ? { state: { equals: query.state, mode: 'insensitive' } }
            : {}),
        },
      },
      include: {
        pharmacy: {
          select: {
            id: true,
            name: true,
            fadaId: true,
            state: true,
            city: true,
            isVerified: true,
            images: {
              where: { isPrimary: true },
              take: 1,
              select: { url: true },
            },
          },
        },
      },
      orderBy: [{ lifetimeEarned: 'desc' }, { updatedAt: 'asc' }],
      take: limit,
    });
    return rows.map((r, i) => ({
      rank: i + 1,
      pharmacy: {
        id: r.pharmacy!.id,
        name: r.pharmacy!.name,
        fadaId: r.pharmacy!.fadaId,
        location: [r.pharmacy!.city, r.pharmacy!.state]
          .filter(Boolean)
          .join(', '),
        isVerified: r.pharmacy!.isVerified,
        logoUrl: r.pharmacy!.images[0]?.url ?? null,
      },
      ...levelProgress(r.lifetimeEarned),
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Back office
  // ═══════════════════════════════════════════════════════════════════════════

  async adminAdjust(dto: AdminAdjustPointsDto, adminUserId: string) {
    if (!!dto.userId === !!dto.pharmacyId) {
      throw new BadRequestException(
        'Provide exactly one of userId or pharmacyId',
      );
    }
    if (dto.delta === 0) throw new BadRequestException('delta cannot be 0');

    const owner: Owner = dto.userId
      ? { kind: 'customer', userId: dto.userId }
      : { kind: 'pharmacy', pharmacyId: dto.pharmacyId! };

    const ledger = await this.ensureLedger(owner);
    if (!ledger) throw new NotFoundException('Ledger owner not found');
    if (dto.delta < 0 && ledger.balance + dto.delta < 0) {
      throw new BadRequestException(
        `Balance is ${ledger.balance}; cannot debit ${-dto.delta}`,
      );
    }

    const result = await this.credit(owner, {
      delta: dto.delta,
      reason: 'admin_adjustment',
      referenceId: `admin-${Date.now()}-${adminUserId.slice(0, 8)}`,
      note: dto.note,
      metadata: { adminUserId },
      createdById: adminUserId,
    });

    const payload: AdminActionPayload = {
      adminUserId,
      action: 'points.adjust',
      targetType: owner.kind === 'customer' ? 'user' : 'pharmacy',
      targetId: owner.kind === 'customer' ? owner.userId : owner.pharmacyId,
      details: { delta: dto.delta, note: dto.note, balance: result.balance },
      occurredAt: new Date(),
    };
    this.eventBus.emit(EVENTS.ADMIN.ACTION_PERFORMED, payload);
    this.eventBus.emit(EVENTS.POINTS.ADJUSTED, payload);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Internals
  // ═══════════════════════════════════════════════════════════════════════════

  /** Finds or creates the owner's ledger. Returns null when the owner does not exist. */
  async ensureLedger(owner: Owner): Promise<PointsLedger | null> {
    const where =
      owner.kind === 'customer'
        ? { userId: owner.userId }
        : { pharmacyId: owner.pharmacyId };
    const existing = await this.prisma.pointsLedger.findUnique({ where });
    if (existing) return existing;

    if (owner.kind === 'customer') {
      const user = await this.prisma.user.findUnique({
        where: { id: owner.userId },
        select: { id: true, role: true },
      });
      if (!user || user.role !== 'customer') return null;
    } else {
      const pharmacy = await this.prisma.pharmacy.findUnique({
        where: { id: owner.pharmacyId },
        select: { id: true },
      });
      if (!pharmacy) return null;
    }

    try {
      return await this.prisma.pointsLedger.create({ data: where });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.prisma.pointsLedger.findUniqueOrThrow({ where });
      }
      throw err;
    }
  }

  private async history(ledgerId: string, query: PointsHistoryQueryDto) {
    const where: Prisma.PointsTransactionWhereInput = {
      ledgerId,
      ...(query.reason ? { reason: query.reason } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.pointsTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.pointsTransaction.count({ where }),
    ]);
    return {
      items: items.map((t) => ({
        id: t.id,
        delta: t.delta,
        balanceAfter: t.balanceAfter,
        reason: t.reason,
        note: t.note,
        referenceId: t.referenceId,
        createdAt: t.createdAt,
      })),
      meta: {
        page: query.page ?? 1,
        limit: query.take,
        total,
        totalPages: Math.ceil(total / query.take),
      },
    };
  }

  private presentLedger(
    ledger: PointsLedger,
    owner: {
      kind: LedgerOwnerKind;
      userId?: string;
      pharmacyId?: string;
      fadaId: string;
      name?: string;
    },
  ) {
    return {
      owner,
      ledgerId: ledger.id,
      balance: ledger.balance,
      lifetimeEarned: ledger.lifetimeEarned,
      ...levelProgress(ledger.lifetimeEarned),
      updatedAt: ledger.updatedAt,
    };
  }

  private noop(
    ledger: PointsLedger,
    skipped: AwardResult['skipped'],
  ): AwardResult {
    return {
      awarded: false,
      skipped,
      delta: 0,
      balance: ledger.balance,
      lifetimeEarned: ledger.lifetimeEarned,
      level: ledger.level,
      leveledUp: false,
    };
  }

  private assertSelfOrAdmin(
    requester: { sub: string; role: string },
    customerId: string,
  ): void {
    if (requester.sub !== customerId && requester.role !== 'admin') {
      throw new ForbiddenException('You can only view your own points');
    }
  }

  private async isPharmacyMemberOrAdmin(
    requester: { sub: string; role: string },
    pharmacyId: string,
  ): Promise<boolean> {
    if (requester.role === 'admin') return true;
    const profile = await this.prisma.pharmacistProfile.findFirst({
      where: { userId: requester.sub, pharmacyId },
      select: { id: true },
    });
    if (profile) return true;
    const staff = await this.prisma.pharmacyStaff.findFirst({
      where: { userId: requester.sub, pharmacyId },
      select: { id: true },
    });
    return !!staff;
  }
}
