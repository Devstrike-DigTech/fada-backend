import { BillingInterval } from '@prisma/client';

/** Slug of the free entry plan every pharmacy falls back to */
export const FREE_PLAN_SLUG = 'sokka';

/** Entitlements used when the free plan row has not been seeded yet */
export const FREE_PLAN_FALLBACK = {
  name: 'Sokka',
  slug: FREE_PLAN_SLUG,
  inventorySlotLimit: 20,
  branchLimit: 1,
  hasAnalytics: false,
  hasAds: false,
  adDiscountPct: 0,
} as const;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Minimal plan shape the pricing helpers need (works with Prisma rows and seed data) */
export interface PlanPricing {
  monthlyPrice: number | string | { toString(): string };
  quarterlyPrice?: number | string | { toString(): string } | null;
  annualPrice?: number | string | { toString(): string } | null;
}

export function toNaira(
  value: PlanPricing['monthlyPrice'] | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}

export function intervalMonths(interval: BillingInterval): number {
  switch (interval) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'annually':
      return 12;
  }
}

/**
 * Price (₦) of a plan for a billing interval, or null when the plan does
 * not offer that interval.
 */
export function priceForInterval(
  plan: PlanPricing,
  interval: BillingInterval,
): number | null {
  switch (interval) {
    case 'monthly':
      return toNaira(plan.monthlyPrice);
    case 'quarterly':
      return toNaira(plan.quarterlyPrice);
    case 'annually':
      return toNaira(plan.annualPrice);
  }
}

export function isFreePlan(plan: PlanPricing): boolean {
  return (toNaira(plan.monthlyPrice) ?? 0) <= 0;
}

/**
 * Adds a billing interval to a date using calendar months, clamping the day
 * so Jan 31 + 1 month = Feb 28/29 rather than Mar 3.
 */
export function addInterval(from: Date, interval: BillingInterval): Date {
  const months = intervalMonths(interval);
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / MS_PER_DAY);
}

export interface ProrationInput {
  /** ₦ the pharmacy paid for the current period */
  currentPeriodPrice: number;
  /** ₦ the new plan costs for the same interval */
  newPeriodPrice: number;
  periodStart: Date;
  periodEnd: Date;
  now?: Date;
}

export interface ProrationResult {
  /** 0..1 share of the current period still unused */
  remainingFraction: number;
  /** ₦ credit for the unused part of the current plan */
  unusedCredit: number;
  /** ₦ cost of the new plan for the remaining part of the period */
  remainingNewCost: number;
  /** ₦ to charge now (never negative) */
  amountDue: number;
  amountDueKobo: number;
  daysRemaining: number;
}

/**
 * Pro-rates an immediate plan change over the unused part of the current period.
 * Downgrades never produce a refund here: amountDue is clamped at 0.
 */
export function prorateChange(input: ProrationInput): ProrationResult {
  const now = input.now ?? new Date();
  const periodDays = daysBetween(input.periodStart, input.periodEnd);
  const daysRemaining = Math.min(periodDays, daysBetween(now, input.periodEnd));
  const remainingFraction = periodDays > 0 ? daysRemaining / periodDays : 0;

  const unusedCredit = round2(input.currentPeriodPrice * remainingFraction);
  const remainingNewCost = round2(input.newPeriodPrice * remainingFraction);
  const amountDue = Math.max(0, round2(remainingNewCost - unusedCredit));

  return {
    remainingFraction,
    unusedCredit,
    remainingNewCost,
    amountDue,
    amountDueKobo: nairaToKobo(amountDue),
    daysRemaining,
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
