import {
  addInterval,
  isFreePlan,
  nairaToKobo,
  priceForInterval,
  prorateChange,
} from './subscription.pricing';

describe('subscription.pricing', () => {
  describe('priceForInterval', () => {
    const plan = {
      monthlyPrice: '5000.00',
      quarterlyPrice: '13500.00',
      annualPrice: null,
    };

    it('returns the price for each interval', () => {
      expect(priceForInterval(plan, 'monthly')).toBe(5000);
      expect(priceForInterval(plan, 'quarterly')).toBe(13500);
    });

    it('returns null when the interval is not offered', () => {
      expect(priceForInterval(plan, 'annually')).toBeNull();
    });
  });

  it('isFreePlan treats 0 as free', () => {
    expect(isFreePlan({ monthlyPrice: 0 })).toBe(true);
    expect(isFreePlan({ monthlyPrice: '0.00' })).toBe(true);
    expect(isFreePlan({ monthlyPrice: '2500' })).toBe(false);
  });

  it('nairaToKobo rounds to whole kobo', () => {
    expect(nairaToKobo(2500)).toBe(250000);
    expect(nairaToKobo(12.345)).toBe(1235);
  });

  describe('addInterval', () => {
    it('adds calendar months', () => {
      expect(
        addInterval(new Date('2026-01-15T00:00:00Z'), 'monthly').toISOString(),
      ).toBe('2026-02-15T00:00:00.000Z');
      expect(
        addInterval(
          new Date('2026-01-15T00:00:00Z'),
          'quarterly',
        ).toISOString(),
      ).toBe('2026-04-15T00:00:00.000Z');
      expect(
        addInterval(new Date('2026-01-15T00:00:00Z'), 'annually').toISOString(),
      ).toBe('2027-01-15T00:00:00.000Z');
    });

    it('clamps the day at month end', () => {
      expect(
        addInterval(new Date('2026-01-31T10:00:00Z'), 'monthly').toISOString(),
      ).toBe('2026-02-28T10:00:00.000Z');
    });
  });

  describe('prorateChange', () => {
    const periodStart = new Date('2026-03-01T00:00:00Z');
    const periodEnd = new Date('2026-03-31T00:00:00Z'); // 30 days

    it('charges the difference for the unused half of the period', () => {
      const r = prorateChange({
        currentPeriodPrice: 2500,
        newPeriodPrice: 5000,
        periodStart,
        periodEnd,
        now: new Date('2026-03-16T00:00:00Z'),
      });
      expect(r.remainingFraction).toBeCloseTo(0.5);
      expect(r.unusedCredit).toBe(1250);
      expect(r.remainingNewCost).toBe(2500);
      expect(r.amountDue).toBe(1250);
      expect(r.amountDueKobo).toBe(125000);
      expect(r.daysRemaining).toBe(15);
    });

    it('never refunds on a downgrade', () => {
      const r = prorateChange({
        currentPeriodPrice: 10000,
        newPeriodPrice: 2500,
        periodStart,
        periodEnd,
        now: new Date('2026-03-10T00:00:00Z'),
      });
      expect(r.amountDue).toBe(0);
    });

    it('charges nothing once the period is over', () => {
      const r = prorateChange({
        currentPeriodPrice: 2500,
        newPeriodPrice: 5000,
        periodStart,
        periodEnd,
        now: new Date('2026-04-05T00:00:00Z'),
      });
      expect(r.amountDue).toBe(0);
      expect(r.daysRemaining).toBe(0);
    });
  });
});
