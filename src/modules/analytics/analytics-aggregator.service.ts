import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Prisma, SearchType } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { SearchTrackingService, QueryCount } from './search-tracking.service';
import { addDays, dayRange, dayToDbDate, lagosDay } from './analytics-dates';

export interface PharmacyDayRow {
  pharmacyId: string;
  date: string;
  reservationsCreated: number;
  reservationsServed: number;
  reservationsCancelled: number;
  reservationsExpired: number;
  servedValueNgn: number;
  uniqueCustomers: number;
  searchAppearances: number;
  adImpressions: number;
  adClicks: number;
  drugsAdded: number;
  newSaves: number;
  topQueries: QueryCount[];
}

export interface PlatformDayRow {
  date: string;
  newCustomers: number;
  newPharmacies: number;
  activePharmacies: number;
  reservationsCreated: number;
  reservationsServed: number;
  reservationsCancelled: number;
  reservationsExpired: number;
  servedValueNgn: number;
  searches: number;
  zeroResultSearches: number;
  adImpressions: number;
  adClicks: number;
  subscriptionRevenueNgn: number;
  adRevenueNgn: number;
}

const emptyRow = (pharmacyId: string, date: string): PharmacyDayRow => ({
  pharmacyId,
  date,
  reservationsCreated: 0,
  reservationsServed: 0,
  reservationsCancelled: 0,
  reservationsExpired: 0,
  servedValueNgn: 0,
  uniqueCustomers: 0,
  searchAppearances: 0,
  adImpressions: 0,
  adClicks: 0,
  drugsAdded: 0,
  newSaves: 0,
  topQueries: [],
});

const SEARCH_TYPES: SearchType[] = ['drug', 'ailment', 'pharmacy'];
const TRENDS_PER_TYPE = 500;
const BACKFILL_DAYS = 7;

/**
 * Computes one Lagos day of analytics from the source tables (+ Redis search
 * counters) and persists it. The same computation serves "today" live, so
 * snapshots and live numbers can never disagree on definitions.
 */
@Injectable()
export class AnalyticsAggregatorService implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsAggregatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracking: SearchTrackingService,
    @InjectQueue(QUEUE_NAMES.ANALYTICS_SNAPSHOT) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.queue.getRepeatableJobs();
      await Promise.all(
        existing.map((j) => this.queue.removeRepeatableByKey(j.key)),
      );
      await this.queue.add(
        'daily',
        {},
        {
          repeat: { cron: '20 0 * * *', tz: 'Africa/Lagos' },
          removeOnComplete: 30,
          removeOnFail: 30,
        },
      );
      this.logger.log('Analytics snapshot scheduled (00:20 Africa/Lagos)');
    } catch (err) {
      this.logger.error('Failed to schedule analytics snapshot', err as Error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Compute
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Activity per pharmacy for one day. With `pharmacyId`, only that pharmacy
   * (used for live "today" numbers). Pharmacies with no activity are omitted.
   */
  async computePharmacyDay(
    day: string,
    pharmacyId?: string,
  ): Promise<Map<string, PharmacyDayRow>> {
    const { start, end } = dayRange(day);
    const pid = pharmacyId ?? null;

    const [created, served, cancelled, expired, ads, drugs, saves] =
      await Promise.all([
        this.prisma.$queryRaw<{ pid: string; n: number; customers: number }[]>`
        SELECT b.pharmacy_id AS pid, COUNT(*)::int AS n, COUNT(DISTINCT r.customer_id)::int AS customers
        FROM reservations r JOIN branches b ON b.id = r.branch_id
        WHERE r.created_at >= ${start} AND r.created_at < ${end}
          AND (${pid}::text IS NULL OR b.pharmacy_id = ${pid})
        GROUP BY b.pharmacy_id`,
        this.prisma.$queryRaw<{ pid: string; n: number; value: number }[]>`
        SELECT b.pharmacy_id AS pid, COUNT(*)::int AS n, COALESCE(SUM(r.total_amount), 0)::float8 AS value
        FROM reservations r JOIN branches b ON b.id = r.branch_id
        WHERE r.status = 'served' AND r.served_at >= ${start} AND r.served_at < ${end}
          AND (${pid}::text IS NULL OR b.pharmacy_id = ${pid})
        GROUP BY b.pharmacy_id`,
        this.prisma.$queryRaw<{ pid: string; n: number }[]>`
        SELECT b.pharmacy_id AS pid, COUNT(*)::int AS n
        FROM reservations r JOIN branches b ON b.id = r.branch_id
        WHERE r.status = 'cancelled' AND r.cancelled_at >= ${start} AND r.cancelled_at < ${end}
          AND (${pid}::text IS NULL OR b.pharmacy_id = ${pid})
        GROUP BY b.pharmacy_id`,
        this.prisma.$queryRaw<{ pid: string; n: number }[]>`
        SELECT b.pharmacy_id AS pid, COUNT(DISTINCT h.reservation_id)::int AS n
        FROM reservation_status_history h
        JOIN reservations r ON r.id = h.reservation_id
        JOIN branches b ON b.id = r.branch_id
        WHERE h.to_status = 'expired' AND h.changed_at >= ${start} AND h.changed_at < ${end}
          AND (${pid}::text IS NULL OR b.pharmacy_id = ${pid})
        GROUP BY b.pharmacy_id`,
        this.prisma.$queryRaw<
          { pid: string; impressions: number; clicks: number }[]
        >`
        SELECT c.pharmacy_id AS pid,
               COUNT(*) FILTER (WHERE e.type = 'impression')::int AS impressions,
               COUNT(*) FILTER (WHERE e.type = 'click')::int AS clicks
        FROM ad_events e JOIN ad_campaigns c ON c.id = e.campaign_id
        WHERE e.created_at >= ${start} AND e.created_at < ${end}
          AND (${pid}::text IS NULL OR c.pharmacy_id = ${pid})
        GROUP BY c.pharmacy_id`,
        this.prisma.$queryRaw<{ pid: string; n: number }[]>`
        SELECT b.pharmacy_id AS pid, COUNT(*)::int AS n
        FROM drugs d JOIN branches b ON b.id = d.branch_id
        WHERE d.created_at >= ${start} AND d.created_at < ${end}
          AND (${pid}::text IS NULL OR b.pharmacy_id = ${pid})
        GROUP BY b.pharmacy_id`,
        this.prisma.$queryRaw<{ pid: string; n: number }[]>`
        SELECT s.pid, COUNT(*)::int AS n FROM (
          SELECT sp.pharmacy_id AS pid FROM customer_saved_pharmacies sp
          WHERE sp.created_at >= ${start} AND sp.created_at < ${end}
          UNION ALL
          SELECT b.pharmacy_id AS pid FROM customer_saved_drugs sd
          JOIN drugs d ON d.id = sd.drug_id JOIN branches b ON b.id = d.branch_id
          WHERE sd.created_at >= ${start} AND sd.created_at < ${end}
        ) s
        WHERE (${pid}::text IS NULL OR s.pid = ${pid})
        GROUP BY s.pid`,
      ]);

    const rows = new Map<string, PharmacyDayRow>();
    const row = (id: string) => {
      let r = rows.get(id);
      if (!r) rows.set(id, (r = emptyRow(id, day)));
      return r;
    };
    created.forEach((x) =>
      Object.assign(row(x.pid), {
        reservationsCreated: x.n,
        uniqueCustomers: x.customers,
      }),
    );
    served.forEach((x) =>
      Object.assign(row(x.pid), {
        reservationsServed: x.n,
        servedValueNgn: Number(x.value),
      }),
    );
    cancelled.forEach((x) => (row(x.pid).reservationsCancelled = x.n));
    expired.forEach((x) => (row(x.pid).reservationsExpired = x.n));
    ads.forEach((x) =>
      Object.assign(row(x.pid), {
        adImpressions: x.impressions,
        adClicks: x.clicks,
      }),
    );
    drugs.forEach((x) => (row(x.pid).drugsAdded = x.n));
    saves.forEach((x) => (row(x.pid).newSaves = x.n));

    // Search appearances + per-pharmacy top queries from Redis
    try {
      if (pharmacyId) {
        const n = await this.tracking.appearancesFor(day, pharmacyId);
        if (n > 0) {
          row(pharmacyId).searchAppearances = n;
          row(pharmacyId).topQueries = await this.tracking.topQueriesFor(
            day,
            pharmacyId,
            10,
          );
        }
      } else {
        const appear = await this.tracking.appearances(day);
        for (const [id, n] of Object.entries(appear)) {
          row(id).searchAppearances = n;
          row(id).topQueries = await this.tracking.topQueriesFor(day, id, 10);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Search counters unavailable for ${day}: ${(err as Error).message}`,
      );
    }

    // Drop rows for pharmacies that no longer exist (deleted mid-day)
    if (!pharmacyId && rows.size) {
      const existing = await this.prisma.pharmacy.findMany({
        where: { id: { in: [...rows.keys()] } },
        select: { id: true },
      });
      const keep = new Set(existing.map((p) => p.id));
      for (const id of rows.keys()) if (!keep.has(id)) rows.delete(id);
    }
    return rows;
  }

  async computePlatformDay(
    day: string,
    pharmacyRows?: Map<string, PharmacyDayRow>,
  ): Promise<PlatformDayRow> {
    const { start, end } = dayRange(day);
    const rows = pharmacyRows ?? (await this.computePharmacyDay(day));

    const [newCustomers, newPharmacies, revenue, search] = await Promise.all([
      this.prisma.user.count({
        where: { role: 'customer', createdAt: { gte: start, lt: end } },
      }),
      this.prisma.pharmacy.count({
        where: { createdAt: { gte: start, lt: end } },
      }),
      this.prisma.billingRecord.groupBy({
        by: ['purpose'],
        where: { status: 'paid', paidAt: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      this.tracking
        .searchTotals(day)
        .catch(() => ({ searches: 0, zeroResult: 0, byType: {} })),
    ]);

    const sum = (f: (r: PharmacyDayRow) => number) =>
      [...rows.values()].reduce((a, r) => a + f(r), 0);
    let subscriptionRevenueNgn = 0;
    let adRevenueNgn = 0;
    for (const r of revenue) {
      const amount = Number(r._sum.amount ?? 0);
      if (r.purpose === 'ad_campaign') adRevenueNgn += amount;
      else subscriptionRevenueNgn += amount;
    }

    return {
      date: day,
      newCustomers,
      newPharmacies,
      activePharmacies: [...rows.values()].filter(
        (r) => r.reservationsCreated > 0,
      ).length,
      reservationsCreated: sum((r) => r.reservationsCreated),
      reservationsServed: sum((r) => r.reservationsServed),
      reservationsCancelled: sum((r) => r.reservationsCancelled),
      reservationsExpired: sum((r) => r.reservationsExpired),
      servedValueNgn: Math.round(sum((r) => r.servedValueNgn) * 100) / 100,
      searches: search.searches,
      zeroResultSearches: search.zeroResult,
      adImpressions: sum((r) => r.adImpressions),
      adClicks: sum((r) => r.adClicks),
      subscriptionRevenueNgn,
      adRevenueNgn,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Persist
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Writes (or rewrites) one day. Safe to re-run. When Redis no longer has the
   * day's search counters, previously stored search numbers are kept.
   */
  async snapshotDay(
    day: string,
  ): Promise<{ day: string; pharmacies: number; searchDataFresh: boolean }> {
    const date = dayToDbDate(day);
    const searchDataFresh = await this.tracking.hasData(day).catch(() => false);
    const rows = await this.computePharmacyDay(day);

    if (!searchDataFresh) {
      const previous = await this.prisma.pharmacyDailyStat.findMany({
        where: { date },
        select: { pharmacyId: true, searchAppearances: true, topQueries: true },
      });
      for (const p of previous) {
        const r = rows.get(p.pharmacyId) ?? emptyRow(p.pharmacyId, day);
        r.searchAppearances = p.searchAppearances;
        r.topQueries = (p.topQueries as unknown as QueryCount[] | null) ?? [];
        rows.set(p.pharmacyId, r);
      }
    }

    const platform = await this.computePlatformDay(day, rows);
    if (!searchDataFresh) {
      const prev = await this.prisma.platformDailyStat.findUnique({
        where: { date },
      });
      if (prev) {
        platform.searches = prev.searches;
        platform.zeroResultSearches = prev.zeroResultSearches;
      }
    }

    const trends = searchDataFresh ? await this.collectTrends(day) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.pharmacyDailyStat.deleteMany({ where: { date } });
      if (rows.size) {
        await tx.pharmacyDailyStat.createMany({
          data: [...rows.values()].map((r) => ({
            pharmacyId: r.pharmacyId,
            date,
            reservationsCreated: r.reservationsCreated,
            reservationsServed: r.reservationsServed,
            reservationsCancelled: r.reservationsCancelled,
            reservationsExpired: r.reservationsExpired,
            servedValueNgn: r.servedValueNgn,
            uniqueCustomers: r.uniqueCustomers,
            searchAppearances: r.searchAppearances,
            adImpressions: r.adImpressions,
            adClicks: r.adClicks,
            drugsAdded: r.drugsAdded,
            newSaves: r.newSaves,
            topQueries: r.topQueries as unknown as Prisma.InputJsonValue,
          })),
        });
      }

      const platformData: Omit<PlatformDayRow, 'date'> & { date?: string } = {
        ...platform,
      };
      delete platformData.date;
      await tx.platformDailyStat.upsert({
        where: { date },
        create: { date, ...platformData },
        update: platformData,
      });

      if (trends) {
        await tx.searchTrendDaily.deleteMany({ where: { date } });
        if (trends.length)
          await tx.searchTrendDaily.createMany({
            data: trends.map((t) => ({ ...t, date })),
          });
      }
    });

    this.logger.log(
      `Analytics snapshot ${day}: ${rows.size} pharmacies, ${platform.reservationsCreated} reservations, ` +
        `${platform.searches} searches${searchDataFresh ? '' : ' (search counters expired; kept previous)'}`,
    );
    return { day, pharmacies: rows.size, searchDataFresh };
  }

  /** Nightly: snapshot yesterday, then fill any gap in the previous week. */
  async runDaily(): Promise<string[]> {
    const yesterday = addDays(lagosDay(), -1);
    const done = [yesterday];
    await this.snapshotDay(yesterday);

    const since = dayToDbDate(addDays(yesterday, -BACKFILL_DAYS));
    const have = await this.prisma.platformDailyStat.findMany({
      where: { date: { gte: since } },
      select: { date: true },
    });
    const haveSet = new Set(have.map((h) => h.date.toISOString().slice(0, 10)));
    for (let i = 1; i <= BACKFILL_DAYS; i++) {
      const d = addDays(yesterday, -i);
      if (!haveSet.has(d)) {
        await this.snapshotDay(d);
        done.push(d);
      }
    }
    return done;
  }

  async enqueueRebuild(days: string[]): Promise<number> {
    for (const day of days) {
      await this.queue.add(
        'rebuild',
        { day },
        { jobId: `rebuild:${day}:${Date.now()}`, removeOnComplete: 100 },
      );
    }
    return days.length;
  }

  private async collectTrends(day: string) {
    const out: {
      query: string;
      searchType: SearchType;
      searches: number;
      zeroResultSearches: number;
    }[] = [];
    for (const type of SEARCH_TYPES) {
      const [top, zero] = await Promise.all([
        this.tracking.topQueries(day, type, TRENDS_PER_TYPE),
        this.tracking.zeroResultQueries(day, type, TRENDS_PER_TYPE),
      ]);
      const merged = new Map<string, { searches: number; zero: number }>();
      top.forEach((q) => merged.set(q.query, { searches: q.count, zero: 0 }));
      zero.forEach((q) => {
        const m = merged.get(q.query) ?? { searches: q.count, zero: 0 };
        m.zero = q.count;
        merged.set(q.query, m);
      });
      for (const [query, v] of merged) {
        out.push({
          query,
          searchType: type,
          searches: v.searches,
          zeroResultSearches: v.zero,
        });
      }
    }
    return out;
  }
}
