/**
 * Ad campaign pricing.
 *
 *   list price = base rate × daily frequency × weekly days × duration (weeks)
 *   plan discount = list × planDiscountPct   (Zuko / Aang perk)
 *   promotion discount = applied to the post-plan price (seasonal / code)
 */

export const AD_BASE_RATE_NGN = 250;
export const AD_LIMITS = {
  dailyFrequency: { min: 1, max: 24 },
  weeklyDays: { min: 1, max: 7 },
  durationWeeks: { min: 1, max: 52 },
  targetRadiusKm: { min: 1, max: 100 },
} as const;

export interface AdPriceInput {
  dailyFrequency: number;
  weeklyDays: number;
  durationWeeks: number;
  baseRateNgn?: number;
  planDiscountPct?: number;
  promotionDiscountNgn?: number;
}

export interface AdPriceBreakdown {
  baseRateNgn: number;
  dailyFrequency: number;
  weeklyDays: number;
  durationWeeks: number;
  listPriceNgn: number;
  planDiscountPct: number;
  planDiscountNgn: number;
  priceAfterPlanDiscountNgn: number;
  promotionDiscountNgn: number;
  finalPriceNgn: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeAdPrice(input: AdPriceInput): AdPriceBreakdown {
  const baseRateNgn = input.baseRateNgn ?? AD_BASE_RATE_NGN;
  const listPriceNgn = round2(
    baseRateNgn * input.dailyFrequency * input.weeklyDays * input.durationWeeks,
  );
  const planDiscountPct = Math.min(
    100,
    Math.max(0, input.planDiscountPct ?? 0),
  );
  const planDiscountNgn = round2((listPriceNgn * planDiscountPct) / 100);
  const priceAfterPlanDiscountNgn = round2(listPriceNgn - planDiscountNgn);
  const promotionDiscountNgn = Math.min(
    priceAfterPlanDiscountNgn,
    round2(Math.max(0, input.promotionDiscountNgn ?? 0)),
  );
  const finalPriceNgn = round2(
    priceAfterPlanDiscountNgn - promotionDiscountNgn,
  );

  return {
    baseRateNgn,
    dailyFrequency: input.dailyFrequency,
    weeklyDays: input.weeklyDays,
    durationWeeks: input.durationWeeks,
    listPriceNgn,
    planDiscountPct,
    planDiscountNgn,
    priceAfterPlanDiscountNgn,
    promotionDiscountNgn,
    finalPriceNgn,
  };
}

/** End of a campaign given its start and duration in weeks. */
export function campaignEnd(start: Date, durationWeeks: number): Date {
  return new Date(start.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);
}

export function averageRating(sum: number, count: number): number | null {
  return count > 0 ? round2(sum / count) : null;
}
