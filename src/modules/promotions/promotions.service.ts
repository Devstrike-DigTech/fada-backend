import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingInterval,
  Prisma,
  Promotion,
  PromotionScope,
} from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import {
  EVENTS,
  PromotionPayload,
  PromotionRedeemedPayload,
} from '@common/types/events.types';
import {
  CreatePromotionDto,
  PromotionQueryDto,
  UpdatePromotionDto,
} from './dto/promotion.dto';

export type PromotionTarget = 'subscriptions' | 'ads';

export interface PromotionQuoteInput {
  target: PromotionTarget;
  pharmacyId: string;
  /** List price in ₦ before any discount */
  amountNgn: number;
  /** Code typed by the pharmacy; omitted = only auto-apply promos are considered */
  code?: string;
  planId?: string;
  billingInterval?: BillingInterval;
}

export interface PromotionQuote {
  promotion: Promotion | null;
  listAmountNgn: number;
  discountNgn: number;
  finalAmountNgn: number;
  /** Set when a code was supplied but could not be applied */
  rejectionReason?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Seasonal discounts and promo codes managed from the back office.
 *
 * `quote()` is pure (no writes) so checkouts can preview the price;
 * `redeem()` records the redemption once the matching payment succeeds.
 */
@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  // ─── Back-office CRUD ────────────────────────────────────────────────────────

  async list(query: PromotionQueryDto) {
    const now = new Date();
    const where: Prisma.PromotionWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.appliesTo
        ? { appliesTo: { in: [query.appliesTo, 'both'] } }
        : {}),
      ...(query.live
        ? {
            isActive: true,
            startsAt: { lte: now },
            OR: [{ endsAt: null }, { endsAt: { gte: now } }],
          }
        : {}),
    };
    const items = await this.prisma.promotion.findMany({
      where,
      orderBy: [{ startsAt: 'desc' }],
      include: { _count: { select: { redemptions: true } } },
    });
    return items.map((p) => this.present(p, now));
  }

  async get(id: string) {
    const promo = await this.prisma.promotion.findUnique({
      where: { id },
      include: {
        _count: { select: { redemptions: true } },
        redemptions: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!promo) throw new NotFoundException('Promotion not found');
    return {
      ...this.present(promo, new Date()),
      recentRedemptions: promo.redemptions,
    };
  }

  async create(dto: CreatePromotionDto, adminUserId: string) {
    this.validateDates(dto.startsAt, dto.endsAt);
    this.validateDiscount(dto.discountType, dto.discountValue);
    const planIds = await this.resolvePlanIds(dto.plans);

    const existing = await this.prisma.promotion.findUnique({
      where: { code: dto.code },
    });
    if (existing)
      throw new ConflictException(`Promotion code ${dto.code} already exists`);

    const promo = await this.prisma.promotion.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxDiscountNgn: dto.maxDiscountNgn,
        appliesTo: dto.appliesTo ?? 'both',
        planIds,
        billingIntervals: dto.billingIntervals ?? [],
        startsAt: new Date(dto.startsAt),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        autoApply: dto.autoApply ?? false,
        maxRedemptions: dto.maxRedemptions,
        maxRedemptionsPerPharmacy: dto.maxRedemptionsPerPharmacy ?? 1,
        isActive: dto.isActive ?? true,
        createdById: adminUserId,
      },
      include: { _count: { select: { redemptions: true } } },
    });

    const payload: PromotionPayload = {
      promotionId: promo.id,
      code: promo.code,
      name: promo.name,
      adminUserId,
      occurredAt: new Date(),
    };
    this.eventBus.emit(EVENTS.PROMOTION.CREATED, payload);
    this.logger.log(`Promotion ${promo.code} created by admin ${adminUserId}`);
    return this.present(promo, new Date());
  }

  async update(id: string, dto: UpdatePromotionDto, adminUserId: string) {
    const existing = await this.prisma.promotion.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Promotion not found');

    const startsAt = dto.startsAt ?? existing.startsAt.toISOString();
    const endsAt =
      dto.endsAt === undefined ? existing.endsAt?.toISOString() : dto.endsAt;
    this.validateDates(startsAt, endsAt ?? undefined);
    if (dto.discountType || dto.discountValue !== undefined) {
      this.validateDiscount(
        dto.discountType ?? existing.discountType,
        dto.discountValue ?? Number(existing.discountValue),
      );
    }
    if (dto.code && dto.code !== existing.code) {
      const clash = await this.prisma.promotion.findUnique({
        where: { code: dto.code },
      });
      if (clash)
        throw new ConflictException(
          `Promotion code ${dto.code} already exists`,
        );
    }
    const planIds =
      dto.plans !== undefined
        ? await this.resolvePlanIds(dto.plans)
        : undefined;

    const promo = await this.prisma.promotion.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxDiscountNgn: dto.maxDiscountNgn,
        appliesTo: dto.appliesTo,
        planIds,
        billingIntervals: dto.billingIntervals,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt:
          dto.endsAt === undefined
            ? undefined
            : dto.endsAt
              ? new Date(dto.endsAt)
              : null,
        autoApply: dto.autoApply,
        maxRedemptions: dto.maxRedemptions,
        maxRedemptionsPerPharmacy: dto.maxRedemptionsPerPharmacy,
        isActive: dto.isActive,
      },
      include: { _count: { select: { redemptions: true } } },
    });

    const payload: PromotionPayload = {
      promotionId: promo.id,
      code: promo.code,
      name: promo.name,
      adminUserId,
      occurredAt: new Date(),
    };
    this.eventBus.emit(EVENTS.PROMOTION.UPDATED, payload);
    return this.present(promo, new Date());
  }

  async deactivate(id: string, adminUserId: string) {
    return this.update(id, { isActive: false }, adminUserId);
  }

  // ─── Quoting & redemption ────────────────────────────────────────────────────

  /**
   * Finds the best applicable promotion (explicit code first, then the best
   * auto-apply seasonal promo) and returns the discounted price. Never writes.
   */
  async quote(input: PromotionQuoteInput): Promise<PromotionQuote> {
    const base: PromotionQuote = {
      promotion: null,
      listAmountNgn: round2(input.amountNgn),
      discountNgn: 0,
      finalAmountNgn: round2(input.amountNgn),
    };
    if (input.amountNgn <= 0) return base;

    const now = new Date();

    // 1. Explicit code
    if (input.code) {
      const promo = await this.prisma.promotion.findUnique({
        where: { code: input.code.trim().toUpperCase() },
      });
      const reason = promo
        ? await this.whyNotApplicable(promo, input, now)
        : 'Unknown promo code';
      if (promo && !reason) return this.buildQuote(promo, input.amountNgn);
      // A bad code is reported but does not block checkout at list price
      return {
        ...base,
        rejectionReason: reason ?? 'Promo code not applicable',
      };
    }

    // 2. Auto-apply seasonal promos — pick the largest discount
    const candidates = await this.prisma.promotion.findMany({
      where: {
        isActive: true,
        autoApply: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
        appliesTo: { in: [input.target, 'both'] },
      },
    });

    let best: PromotionQuote = base;
    for (const promo of candidates) {
      if (await this.whyNotApplicable(promo, input, now)) continue;
      const q = this.buildQuote(promo, input.amountNgn);
      if (q.discountNgn > best.discountNgn) best = q;
    }
    return best;
  }

  /** Records a redemption after payment succeeds (or after a free activation). Idempotent per billing record. */
  async redeem(args: {
    promotionId: string;
    pharmacyId: string;
    discountNgn: number;
    billingRecordId?: string;
    adCampaignId?: string;
  }): Promise<void> {
    if (args.billingRecordId) {
      const dup = await this.prisma.promotionRedemption.findFirst({
        where: { billingRecordId: args.billingRecordId },
      });
      if (dup) return;
    }

    const [promo] = await this.prisma.$transaction([
      this.prisma.promotion.update({
        where: { id: args.promotionId },
        data: { redemptionsCount: { increment: 1 } },
      }),
      this.prisma.promotionRedemption.create({
        data: {
          promotionId: args.promotionId,
          pharmacyId: args.pharmacyId,
          billingRecordId: args.billingRecordId,
          adCampaignId: args.adCampaignId,
          discountNgn: args.discountNgn,
        },
      }),
    ]);

    const payload: PromotionRedeemedPayload = {
      promotionId: promo.id,
      code: promo.code,
      pharmacyId: args.pharmacyId,
      discountNgn: args.discountNgn,
      billingRecordId: args.billingRecordId,
      adCampaignId: args.adCampaignId,
      occurredAt: new Date(),
    };
    this.eventBus.emit(EVENTS.PROMOTION.REDEEMED, payload);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private buildQuote(promo: Promotion, amountNgn: number): PromotionQuote {
    const value = Number(promo.discountValue);
    let discount =
      promo.discountType === 'percentage' ? (amountNgn * value) / 100 : value;
    if (promo.maxDiscountNgn !== null) {
      discount = Math.min(discount, Number(promo.maxDiscountNgn));
    }
    discount = Math.min(round2(discount), round2(amountNgn));
    return {
      promotion: promo,
      listAmountNgn: round2(amountNgn),
      discountNgn: discount,
      finalAmountNgn: round2(amountNgn - discount),
    };
  }

  /** Returns a human reason when the promo cannot be applied, or null when it can. */
  private async whyNotApplicable(
    promo: Promotion,
    input: PromotionQuoteInput,
    now: Date,
  ): Promise<string | null> {
    if (!promo.isActive) return 'This promotion is no longer active';
    if (promo.startsAt > now) return 'This promotion has not started yet';
    if (promo.endsAt && promo.endsAt < now) return 'This promotion has ended';
    if (!this.scopeMatches(promo.appliesTo, input.target)) {
      return `This promotion does not apply to ${input.target}`;
    }
    if (
      promo.planIds.length &&
      (!input.planId || !promo.planIds.includes(input.planId))
    ) {
      return 'This promotion does not apply to the selected plan';
    }
    if (
      promo.billingIntervals.length &&
      (!input.billingInterval ||
        !promo.billingIntervals.includes(input.billingInterval))
    ) {
      return 'This promotion does not apply to the selected billing interval';
    }
    if (
      promo.maxRedemptions !== null &&
      promo.redemptionsCount >= promo.maxRedemptions
    ) {
      return 'This promotion has been fully redeemed';
    }
    const used = await this.prisma.promotionRedemption.count({
      where: { promotionId: promo.id, pharmacyId: input.pharmacyId },
    });
    if (used >= promo.maxRedemptionsPerPharmacy) {
      return 'Your pharmacy has already used this promotion';
    }
    return null;
  }

  private scopeMatches(
    scope: PromotionScope,
    target: PromotionTarget,
  ): boolean {
    return scope === 'both' || scope === target;
  }

  private validateDates(startsAt: string, endsAt?: string): void {
    if (endsAt && new Date(endsAt) <= new Date(startsAt)) {
      throw new BadRequestException('endsAt must be after startsAt');
    }
  }

  private validateDiscount(type: string, value: number): void {
    if (type === 'percentage' && (value <= 0 || value > 100)) {
      throw new BadRequestException(
        'Percentage discounts must be between 0 and 100',
      );
    }
    if (type === 'fixed_amount' && value <= 0) {
      throw new BadRequestException('Fixed discounts must be greater than 0');
    }
  }

  private async resolvePlanIds(plans?: string[]): Promise<string[]> {
    if (!plans || plans.length === 0) return [];
    const rows = await this.prisma.subscriptionPlan.findMany({
      where: {
        OR: [
          { id: { in: plans } },
          { slug: { in: plans.map((p) => p.toLowerCase()) } },
        ],
      },
      select: { id: true },
    });
    if (rows.length !== plans.length) {
      throw new BadRequestException('One or more plans were not found');
    }
    return rows.map((r) => r.id);
  }

  private present(
    p: Promotion & { _count?: { redemptions: number } },
    now: Date,
  ) {
    const live =
      p.isActive && p.startsAt <= now && (p.endsAt === null || p.endsAt >= now);
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      discountType: p.discountType,
      discountValue: Number(p.discountValue),
      maxDiscountNgn:
        p.maxDiscountNgn === null ? null : Number(p.maxDiscountNgn),
      appliesTo: p.appliesTo,
      planIds: p.planIds,
      billingIntervals: p.billingIntervals,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      autoApply: p.autoApply,
      maxRedemptions: p.maxRedemptions,
      maxRedemptionsPerPharmacy: p.maxRedemptionsPerPharmacy,
      redemptionsCount: p._count?.redemptions ?? p.redemptionsCount,
      isActive: p.isActive,
      isLive: live,
      createdById: p.createdById,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
