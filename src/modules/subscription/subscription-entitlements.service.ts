import { ForbiddenException, Injectable } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { FREE_PLAN_FALLBACK, FREE_PLAN_SLUG } from './subscription.pricing';

export interface PharmacyEntitlements {
  planId: string | null;
  planName: string;
  planSlug: string;
  status: SubscriptionStatus | 'none';
  /** True when the pharmacy currently enjoys the plan's limits (active, trialing, or within grace) */
  isEntitled: boolean;
  inventorySlotLimit: number;
  branchLimit: number;
  hasAnalytics: boolean;
  hasAds: boolean;
  adDiscountPct: number;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
}

/**
 * Read-side helper other modules use to enforce plan limits.
 *
 * Kept separate from SubscriptionService so PharmacyModule / InventoryModule
 * depend on a tiny surface with no payment-provider wiring behind it.
 */
@Injectable()
export class SubscriptionEntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async getEntitlements(pharmacyId: string): Promise<PharmacyEntitlements> {
    const sub = await this.prisma.pharmacySubscription.findUnique({
      where: { pharmacyId },
      include: { plan: true },
    });

    const now = new Date();
    const withinGrace =
      sub?.status === 'past_due' &&
      sub.graceUntil !== null &&
      sub.graceUntil > now;
    const isEntitled =
      !!sub &&
      (sub.status === 'active' || sub.status === 'trialing' || withinGrace);

    if (sub && isEntitled) {
      return {
        planId: sub.plan.id,
        planName: sub.plan.name,
        planSlug: sub.plan.slug,
        status: sub.status,
        isEntitled: true,
        inventorySlotLimit: sub.plan.inventorySlotLimit,
        branchLimit: sub.plan.branchLimit,
        hasAnalytics: sub.plan.hasAnalytics,
        hasAds: sub.plan.hasAds,
        adDiscountPct: sub.plan.adDiscountPct,
        currentPeriodEnd: sub.currentPeriodEnd,
        graceUntil: sub.graceUntil,
      };
    }

    // No subscription, or a lapsed one → free-plan limits
    const free = await this.prisma.subscriptionPlan.findUnique({
      where: { slug: FREE_PLAN_SLUG },
    });

    return {
      planId: free?.id ?? null,
      planName: free?.name ?? FREE_PLAN_FALLBACK.name,
      planSlug: free?.slug ?? FREE_PLAN_FALLBACK.slug,
      status: sub?.status ?? 'none',
      isEntitled: false,
      inventorySlotLimit:
        free?.inventorySlotLimit ?? FREE_PLAN_FALLBACK.inventorySlotLimit,
      branchLimit: free?.branchLimit ?? FREE_PLAN_FALLBACK.branchLimit,
      hasAnalytics: free?.hasAnalytics ?? FREE_PLAN_FALLBACK.hasAnalytics,
      hasAds: free?.hasAds ?? FREE_PLAN_FALLBACK.hasAds,
      adDiscountPct: free?.adDiscountPct ?? FREE_PLAN_FALLBACK.adDiscountPct,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      graceUntil: sub?.graceUntil ?? null,
    };
  }

  /** Throws 403 when the pharmacy has used every branch slot its plan allows. */
  async assertCanAddBranch(pharmacyId: string): Promise<PharmacyEntitlements> {
    const ent = await this.getEntitlements(pharmacyId);
    const used = await this.prisma.branch.count({
      where: { pharmacyId, isActive: true },
    });
    if (used >= ent.branchLimit) {
      throw new ForbiddenException(
        `Your ${ent.planName} plan allows ${ent.branchLimit} branch${ent.branchLimit === 1 ? '' : 'es'}. Upgrade to add more.`,
      );
    }
    return ent;
  }

  /** Throws 403 when the pharmacy has used every inventory slot its plan allows. */
  async assertCanAddDrug(
    pharmacyId: string,
    additional = 1,
  ): Promise<PharmacyEntitlements> {
    const ent = await this.getEntitlements(pharmacyId);
    const used = await this.prisma.drug.count({
      where: { branch: { pharmacyId } },
    });
    if (used + additional > ent.inventorySlotLimit) {
      throw new ForbiddenException(
        `Your ${ent.planName} plan allows ${ent.inventorySlotLimit} inventory slots (${used} used). Upgrade to add more drugs.`,
      );
    }
    return ent;
  }

  async getUsage(pharmacyId: string) {
    const [branches, drugs] = await Promise.all([
      this.prisma.branch.count({ where: { pharmacyId, isActive: true } }),
      this.prisma.drug.count({ where: { branch: { pharmacyId } } }),
    ]);
    return { branchesUsed: branches, inventorySlotsUsed: drugs };
  }
}
