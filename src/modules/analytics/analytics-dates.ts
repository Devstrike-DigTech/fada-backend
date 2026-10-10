/**
 * Analytics buckets by Nigerian calendar day (Africa/Lagos, UTC+1, no DST).
 * Days are carried around as 'YYYY-MM-DD' strings to avoid timezone drift.
 */

const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_PERIOD_DAYS = 366;

export type PeriodPreset = '7d' | '30d' | '90d' | '365d';
export const PERIOD_PRESETS: Record<PeriodPreset, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '365d': 365,
};

/** Lagos calendar day for an instant. */
export function lagosDay(at: Date = new Date()): string {
  return new Date(at.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC instants bounding a Lagos day: [start, end). */
export function dayRange(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00+01:00`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** Value to store in a Postgres DATE column via Prisma (UTC midnight). */
export function dayToDbDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function dbDateToDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(dayToDbDate(day).getTime() + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Inclusive list of days from → to. */
export function daysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface Period {
  from: string;
  to: string;
  days: string[];
}

/**
 * Resolves `?period=30d` or `?from=&to=` into an inclusive day range ending
 * no later than today (Lagos). Defaults to the last 30 days.
 */
export function resolvePeriod(
  q: { period?: PeriodPreset; from?: string; to?: string },
  today: string = lagosDay(),
): Period {
  let to = q.to ? q.to.slice(0, 10) : today;
  if (to > today) to = today;
  let from: string;
  if (q.from) {
    from = q.from.slice(0, 10);
  } else {
    const n = PERIOD_PRESETS[q.period ?? '30d'];
    from = addDays(to, -(n - 1));
  }
  if (from > to) throw new RangeError('from must be on or before to');
  const days = daysInRange(from, to);
  if (days.length > MAX_PERIOD_DAYS) {
    throw new RangeError(`Period cannot exceed ${MAX_PERIOD_DAYS} days`);
  }
  return { from, to, days };
}

/** The equally long period immediately before `p` (for % change). */
export function previousPeriod(p: Period): Period {
  const to = addDays(p.from, -1);
  const from = addDays(to, -(p.days.length - 1));
  return { from, to, days: daysInRange(from, to) };
}

/** Percentage change, null when there is no baseline. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function ratio(
  numerator: number,
  denominator: number,
  scale = 100,
): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * scale * 10) / 10;
}
