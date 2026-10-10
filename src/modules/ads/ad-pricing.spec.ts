import { averageRating, campaignEnd, computeAdPrice } from './ad-pricing';

describe('ad-pricing', () => {
  it('applies the ₦250 × frequency × days × weeks formula', () => {
    const p = computeAdPrice({
      dailyFrequency: 2,
      weeklyDays: 5,
      durationWeeks: 3,
    });
    expect(p.listPriceNgn).toBe(250 * 2 * 5 * 3);
    expect(p.finalPriceNgn).toBe(7500);
  });

  it('applies the plan discount before the promotion', () => {
    const p = computeAdPrice({
      dailyFrequency: 1,
      weeklyDays: 7,
      durationWeeks: 4,
      planDiscountPct: 50,
      promotionDiscountNgn: 1000,
    });
    expect(p.listPriceNgn).toBe(7000);
    expect(p.planDiscountNgn).toBe(3500);
    expect(p.priceAfterPlanDiscountNgn).toBe(3500);
    expect(p.promotionDiscountNgn).toBe(1000);
    expect(p.finalPriceNgn).toBe(2500);
  });

  it('never goes below zero', () => {
    const p = computeAdPrice({
      dailyFrequency: 1,
      weeklyDays: 1,
      durationWeeks: 1,
      promotionDiscountNgn: 9999,
    });
    expect(p.finalPriceNgn).toBe(0);
  });

  it('computes the campaign end from weeks', () => {
    expect(campaignEnd(new Date('2026-01-01T00:00:00Z'), 2).toISOString()).toBe(
      '2026-01-15T00:00:00.000Z',
    );
  });

  it('averages ratings to two decimals', () => {
    expect(averageRating(0, 0)).toBeNull();
    expect(averageRating(13, 3)).toBe(4.33);
  });
});
