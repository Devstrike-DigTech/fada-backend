import {
  addDays,
  dayRange,
  daysInRange,
  lagosDay,
  pctChange,
  previousPeriod,
  ratio,
  resolvePeriod,
} from './analytics-dates';

describe('analytics-dates', () => {
  it('maps instants to the Lagos calendar day (UTC+1)', () => {
    expect(lagosDay(new Date('2026-10-09T22:59:59Z'))).toBe('2026-10-09');
    expect(lagosDay(new Date('2026-10-09T23:00:00Z'))).toBe('2026-10-10');
  });

  it('bounds a Lagos day in UTC', () => {
    const r = dayRange('2026-10-10');
    expect(r.start.toISOString()).toBe('2026-10-09T23:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-10T23:00:00.000Z');
  });

  it('walks days across month ends', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(daysInRange('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  it('resolves presets ending today', () => {
    const p = resolvePeriod({ period: '7d' }, '2026-10-10');
    expect(p.from).toBe('2026-10-04');
    expect(p.to).toBe('2026-10-10');
    expect(p.days).toHaveLength(7);
  });

  it('clamps future end dates and rejects oversized ranges', () => {
    expect(
      resolvePeriod({ from: '2026-10-01', to: '2027-01-01' }, '2026-10-10').to,
    ).toBe('2026-10-10');
    expect(() => resolvePeriod({ from: '2024-01-01' }, '2026-10-10')).toThrow(
      RangeError,
    );
    expect(() =>
      resolvePeriod({ from: '2026-10-11', to: '2026-10-10' }, '2026-10-12'),
    ).toThrow(RangeError);
  });

  it('builds the previous period of equal length', () => {
    const prev = previousPeriod(resolvePeriod({ period: '30d' }, '2026-10-10'));
    expect(prev.to).toBe('2026-09-10');
    expect(prev.days).toHaveLength(30);
  });

  it('computes change and ratios without dividing by zero', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(5, 0)).toBeNull();
    expect(ratio(1, 3)).toBe(33.3);
    expect(ratio(1, 0)).toBeNull();
  });
});
