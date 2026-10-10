import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@infra/database/prisma.service';
import { SubscriptionEntitlementsService } from '@modules/subscription/subscription-entitlements.service';
import {
  AnalyticsAggregatorService,
  PharmacyDayRow,
  PlatformDayRow,
} from './analytics-aggregator.service';
import { QueryCount, SearchTrackingService } from './search-tracking.service';
import {
  Period,
  addDays,
  dayRange,
  dayToDbDate,
  dbDateToDay,
  lagosDay,
  pctChange,
  previousPeriod,
  ratio,
  resolvePeriod,
} from './analytics-dates';
import {
  LeaderboardQueryDto,
  PeriodQueryDto,
  TrendsQueryDto,
} from './dto/analytics.dto';

/** Past days missing a snapshot are computed live only this far back. */
const LIVE_FALLBACK_DAYS = 7;

type Totals = Omit<PharmacyDayRow, 'pharmacyId' | 'date' | 'topQueries'>;
const TOTAL_KEYS: (keyof Totals)[] = [
  'reservationsCreated',
  'reservationsServed',
  'reservationsCancelled',
  'reservationsExpired',
  'servedValueNgn',
  'uniqueCustomers',
  'searchAppearances',
  'adImpressions',
  'adClicks',
  'drugsAdded',
  'newSaves',
];

interface Requester {
  sub: string;
  role: string;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aggregator: AnalyticsAggregatorService,
    private readonly tracking: SearchTrackingService,
    private readonly entitlements: SubscriptionEntitlementsService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Access
  // ═══════════════════════════════════════════════════════════════════════════

  /** Lets the app decide between the dashboard and an upgrade prompt. */
  async access(user: Requester, pharmacyId: string) {
    await this.assertMember(user, pharmacyId);
    const ent = await this.entitlements.getEntitlements(pharmacyId);
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { hasAnalytics: true, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { name: true, slug: true, monthlyPrice: true },
    });
    return {
      hasAnalytics: user.role === 'admin' || ent.hasAnalytics,
      planName: ent.planName,
      plansWithAnalytics: plans.map((p) => ({
        name: p.name,
        slug: p.slug,
        monthlyPrice: Number(p.monthlyPrice),
      })),
    };
  }

  private async assertAccess(
    user: Requester,
    pharmacyId: string,
  ): Promise<void> {
    await this.assertMember(user, pharmacyId);
    if (user.role === 'admin') return;
    const ent = await this.entitlements.getEntitlements(pharmacyId);
    if (!ent.hasAnalytics) {
      throw new ForbiddenException(
        `Store analytics are included in the Zuko and Aang plans. Your pharmacy is on ${ent.planName}.`,
      );
    }
  }

  private async assertMember(
    user: Requester,
    pharmacyId: string,
  ): Promise<void> {
    const exists = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Pharmacy not found');
    if (user.role === 'admin') return;
    const [profile, staff] = await Promise.all([
      this.prisma.pharmacistProfile.findFirst({
        where: {
          userId: user.sub,
          pharmacyId,
          roleInPharmacy: { in: ['owner', 'operator'] },
        },
        select: { id: true },
      }),
      this.prisma.pharmacyStaff.findFirst({
        where: {
          userId: user.sub,
          pharmacyId,
          isActive: true,
          role: 'operator',
        },
        select: { id: true },
      }),
    ]);
    if (!profile && !staff) {
      throw new ForbiddenException(
        'Only the pharmacy owner or an operator can view analytics',
      );
    }
  }

  private period(q: PeriodQueryDto): Period {
    try {
      return resolvePeriod(q);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Pharmacy dashboard
  // ═══════════════════════════════════════════════════════════════════════════

  async overview(user: Requester, pharmacyId: string, q: PeriodQueryDto) {
    await this.assertAccess(user, pharmacyId);
    const period = this.period(q);
    const prev = previousPeriod(period);

    const [series, prevSeries, pharmacy, savedBy, activeDrugs] =
      await Promise.all([
        this.pharmacySeries(pharmacyId, period),
        this.pharmacySeries(pharmacyId, prev),
        this.prisma.pharmacy.findUniqueOrThrow({
          where: { id: pharmacyId },
          select: { name: true, reputationLevel: true, reputationPoints: true },
        }),
        this.prisma.customerSavedPharmacy.count({ where: { pharmacyId } }),
        this.prisma.drug.count({
          where: {
            branch: { pharmacyId },
            stockStatus: { not: 'out_of_stock' },
          },
        }),
      ]);

    const cur = this.sum(series);
    const old = this.sum(prevSeries);
    const closed =
      cur.reservationsServed +
      cur.reservationsCancelled +
      cur.reservationsExpired;

    return {
      pharmacy: { id: pharmacyId, name: pharmacy.name },
      period,
      totals: cur,
      change: Object.fromEntries(
        TOTAL_KEYS.map((k) => [k, pctChange(cur[k], old[k])]),
      ),
      kpis: {
        fulfilmentRate: ratio(cur.reservationsServed, closed),
        reservationsPer100Appearances: ratio(
          cur.reservationsCreated,
          cur.searchAppearances,
        ),
        adCtr: ratio(cur.adClicks, cur.adImpressions),
        averageServedValueNgn:
          cur.reservationsServed > 0
            ? Math.round((cur.servedValueNgn / cur.reservationsServed) * 100) /
              100
            : null,
      },
      current: {
        reputationLevel: pharmacy.reputationLevel,
        reputationPoints: pharmacy.reputationPoints,
        savedByCustomers: savedBy,
        drugsAvailable: activeDrugs,
      },
      series: series.map((r) => ({
        date: r.date,
        reservationsCreated: r.reservationsCreated,
        reservationsServed: r.reservationsServed,
        searchAppearances: r.searchAppearances,
        adClicks: r.adClicks,
      })),
    };
  }

  async reservations(user: Requester, pharmacyId: string, q: PeriodQueryDto) {
    await this.assertAccess(user, pharmacyId);
    const period = this.period(q);
    const start = dayRange(period.from).start;
    const end = dayRange(period.to).end;

    const [series, byStatus, byBranch, byHour, byWeekday, timing, cancelledBy] =
      await Promise.all([
        this.pharmacySeries(pharmacyId, period),
        this.prisma.$queryRaw<{ status: string; n: number }[]>`
        SELECT r.status::text AS status, COUNT(*)::int AS n
        FROM reservations r JOIN branches b ON b.id = r.branch_id
        WHERE b.pharmacy_id = ${pharmacyId} AND r.created_at >= ${start} AND r.created_at < ${end}
        GROUP BY r.status`,
        this.prisma.$queryRaw<
          { branch_id: string; name: string; created: number; served: number }[]
        >`
        SELECT b.id AS branch_id, b.name,
               COUNT(r.id)::int AS created,
               COUNT(r.id) FILTER (WHERE r.status = 'served')::int AS served
        FROM branches b
        LEFT JOIN reservations r ON r.branch_id = b.id AND r.created_at >= ${start} AND r.created_at < ${end}
        WHERE b.pharmacy_id = ${pharmacyId}
        GROUP BY b.id, b.name
        ORDER BY created DESC`,
        this.prisma.$queryRaw<{ hour: number; n: number }[]>`
        SELECT EXTRACT(HOUR FROM (r.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos')::int AS hour, COUNT(*)::int AS n
        FROM reservations r JOIN branches b ON b.id = r.branch_id
        WHERE b.pharmacy_id = ${pharmacyId} AND r.created_at >= ${start} AND r.created_at < ${end}
        GROUP BY 1 ORDER BY 1`,
        this.prisma.$queryRaw<{ dow: number; n: number }[]>`
        SELECT EXTRACT(ISODOW FROM (r.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos')::int AS dow, COUNT(*)::int AS n
        FROM reservations r JOIN branches b ON b.id = r.branch_id
        WHERE b.pharmacy_id = ${pharmacyId} AND r.created_at >= ${start} AND r.created_at < ${end}
        GROUP BY 1 ORDER BY 1`,
        this.prisma.$queryRaw<
          { avg_confirm_min: number | null; avg_serve_min: number | null }[]
        >`
        SELECT
          AVG(EXTRACT(EPOCH FROM (c.first_confirm - r.created_at)) / 60)::float8 AS avg_confirm_min,
          AVG(EXTRACT(EPOCH FROM (r.served_at - r.created_at)) / 60)
            FILTER (WHERE r.served_at IS NOT NULL)::float8 AS avg_serve_min
        FROM reservations r
        JOIN branches b ON b.id = r.branch_id
        LEFT JOIN LATERAL (
          SELECT MIN(h.changed_at) AS first_confirm FROM reservation_status_history h
          WHERE h.reservation_id = r.id AND h.to_status = 'confirmed'
        ) c ON true
        WHERE b.pharmacy_id = ${pharmacyId} AND r.created_at >= ${start} AND r.created_at < ${end}`,
        this.prisma.$queryRaw<{ actor: string; n: number }[]>`
        SELECT CASE
                 WHEN r.cancelled_by IS NULL THEN 'system'
                 WHEN r.cancelled_by = r.customer_id THEN 'customer'
                 ELSE 'pharmacy'
               END AS actor,
               COUNT(*)::int AS n
        FROM reservations r JOIN branches b ON b.id = r.branch_id
        WHERE b.pharmacy_id = ${pharmacyId} AND r.status = 'cancelled'
          AND r.cancelled_at >= ${start} AND r.cancelled_at < ${end}
        GROUP BY 1`,
      ]);

    const totals = this.sum(series);
    const weekday = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const hours = new Map(byHour.map((h) => [h.hour, h.n]));
    return {
      period,
      totals: {
        created: totals.reservationsCreated,
        served: totals.reservationsServed,
        cancelled: totals.reservationsCancelled,
        expired: totals.reservationsExpired,
        servedValueNgn: totals.servedValueNgn,
        uniqueCustomers: totals.uniqueCustomers,
        fulfilmentRate: ratio(
          totals.reservationsServed,
          totals.reservationsServed +
            totals.reservationsCancelled +
            totals.reservationsExpired,
        ),
      },
      currentStatusOfPeriodReservations: Object.fromEntries(
        byStatus.map((s) => [s.status, s.n]),
      ),
      cancellationsBy: Object.fromEntries(
        cancelledBy.map((c) => [c.actor, c.n]),
      ),
      timing: {
        avgMinutesToConfirm: this.minutes(timing[0]?.avg_confirm_min),
        avgMinutesToServe: this.minutes(timing[0]?.avg_serve_min),
      },
      byBranch: byBranch.map((b) => ({
        branchId: b.branch_id,
        name: b.name,
        created: b.created,
        served: b.served,
      })),
      byHourOfDay: Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        reservations: hours.get(h) ?? 0,
      })),
      byWeekday: byWeekday.map((d) => ({
        day: weekday[d.dow],
        reservations: d.n,
      })),
      series: series.map((r) => ({
        date: r.date,
        created: r.reservationsCreated,
        served: r.reservationsServed,
        cancelled: r.reservationsCancelled,
        expired: r.reservationsExpired,
      })),
    };
  }

  async inventory(user: Requester, pharmacyId: string, q: PeriodQueryDto) {
    await this.assertAccess(user, pharmacyId);
    const period = this.period(q);
    const start = dayRange(period.from).start;
    const end = dayRange(period.to).end;
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [
      ent,
      byStock,
      mostReserved,
      mostSaved,
      lowStock,
      expiringSoon,
      neverReserved,
      addedInPeriod,
    ] = await Promise.all([
      this.entitlements.getEntitlements(pharmacyId),
      this.prisma.drug.groupBy({
        by: ['stockStatus'],
        where: { branch: { pharmacyId } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<
        {
          drug_id: string;
          name: string;
          quantity: number;
          reservations: number;
        }[]
      >`
          SELECT d.id AS drug_id, d.name, SUM(ri.quantity)::int AS quantity, COUNT(DISTINCT r.id)::int AS reservations
          FROM reservation_items ri
          JOIN reservations r ON r.id = ri.reservation_id
          JOIN drugs d ON d.id = ri.drug_id
          JOIN branches b ON b.id = d.branch_id
          WHERE b.pharmacy_id = ${pharmacyId} AND r.created_at >= ${start} AND r.created_at < ${end}
          GROUP BY d.id, d.name
          ORDER BY quantity DESC
          LIMIT 10`,
      this.prisma.$queryRaw<{ drug_id: string; name: string; saves: number }[]>`
          SELECT d.id AS drug_id, d.name, COUNT(*)::int AS saves
          FROM customer_saved_drugs sd
          JOIN drugs d ON d.id = sd.drug_id JOIN branches b ON b.id = d.branch_id
          WHERE b.pharmacy_id = ${pharmacyId}
          GROUP BY d.id, d.name
          ORDER BY saves DESC
          LIMIT 10`,
      this.prisma.drug.findMany({
        where: {
          branch: { pharmacyId },
          stockStatus: { in: ['low_stock', 'out_of_stock'] },
        },
        orderBy: [{ stockAmount: 'asc' }, { name: 'asc' }],
        take: 20,
        select: {
          id: true,
          name: true,
          stockAmount: true,
          stockStatus: true,
          lowStockThreshold: true,
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.drug.findMany({
        where: {
          branch: { pharmacyId },
          expiryDate: { not: null, lte: in30Days },
        },
        orderBy: { expiryDate: 'asc' },
        take: 20,
        select: {
          id: true,
          name: true,
          expiryDate: true,
          stockAmount: true,
          branch: { select: { name: true } },
        },
      }),
      this.prisma.drug.count({
        where: { branch: { pharmacyId }, reservationItems: { none: {} } },
      }),
      this.prisma.drug.count({
        where: { branch: { pharmacyId }, createdAt: { gte: start, lt: end } },
      }),
    ]);

    const totalDrugs = byStock.reduce((a, s) => a + s._count._all, 0);
    return {
      period,
      slots: {
        used: totalDrugs,
        limit: ent.inventorySlotLimit,
        percentUsed: ratio(totalDrugs, ent.inventorySlotLimit),
      },
      stock: Object.fromEntries(
        byStock.map((s) => [s.stockStatus, s._count._all]),
      ),
      drugsAddedInPeriod: addedInPeriod,
      neverReserved: neverReserved,
      mostReserved: mostReserved.map((m) => ({
        drugId: m.drug_id,
        name: m.name,
        quantity: m.quantity,
        reservations: m.reservations,
      })),
      mostSaved: mostSaved.map((m) => ({
        drugId: m.drug_id,
        name: m.name,
        saves: m.saves,
      })),
      needsRestock: lowStock.map((d) => ({
        drugId: d.id,
        name: d.name,
        stockAmount: d.stockAmount,
        stockStatus: d.stockStatus,
        threshold: d.lowStockThreshold,
        branch: d.branch,
      })),
      expiringWithin30Days: expiringSoon.map((d) => ({
        drugId: d.id,
        name: d.name,
        expiryDate: d.expiryDate,
        stockAmount: d.stockAmount,
        branchName: d.branch.name,
        expired: !!d.expiryDate && d.expiryDate < new Date(),
      })),
    };
  }

  async searchAppearances(
    user: Requester,
    pharmacyId: string,
    q: PeriodQueryDto,
  ) {
    await this.assertAccess(user, pharmacyId);
    const period = this.period(q);
    const prev = previousPeriod(period);
    const [series, prevSeries, trends] = await Promise.all([
      this.pharmacySeries(pharmacyId, period),
      this.pharmacySeries(pharmacyId, prev),
      this.trendsForPeriod(period, undefined, 15),
    ]);
    const cur = this.sum(series);
    const old = this.sum(prevSeries);

    const queries = new Map<string, number>();
    for (const r of series)
      for (const tq of r.topQueries)
        queries.set(tq.query, (queries.get(tq.query) ?? 0) + tq.count);

    return {
      period,
      totalAppearances: cur.searchAppearances,
      change: pctChange(cur.searchAppearances, old.searchAppearances),
      reservationsPer100Appearances: ratio(
        cur.reservationsCreated,
        cur.searchAppearances,
      ),
      topQueries: [...queries.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([query, count]) => ({ query, count })),
      /** Searches across FADA that found nothing: stock these to win new customers */
      unmetDemand: trends.zeroResult,
      trendingSearches: trends.top,
      series: series.map((r) => ({
        date: r.date,
        appearances: r.searchAppearances,
      })),
    };
  }

  async ads(user: Requester, pharmacyId: string, q: PeriodQueryDto) {
    await this.assertAccess(user, pharmacyId);
    const period = this.period(q);
    const start = dayRange(period.from).start;
    const end = dayRange(period.to).end;

    const [series, perCampaign, spend] = await Promise.all([
      this.pharmacySeries(pharmacyId, period),
      this.prisma.$queryRaw<
        {
          id: string;
          title: string;
          status: string;
          price: number;
          impressions: number;
          clicks: number;
        }[]
      >`
        SELECT c.id, c.title, c.status::text AS status, c.price_ngn::float8 AS price,
               COUNT(e.id) FILTER (WHERE e.type = 'impression')::int AS impressions,
               COUNT(e.id) FILTER (WHERE e.type = 'click')::int AS clicks
        FROM ad_campaigns c
        LEFT JOIN ad_events e ON e.campaign_id = c.id AND e.created_at >= ${start} AND e.created_at < ${end}
        WHERE c.pharmacy_id = ${pharmacyId}
          AND (c.timeslot_end >= ${start} AND c.timeslot_start < ${end})
        GROUP BY c.id
        ORDER BY impressions DESC`,
      this.prisma.billingRecord.aggregate({
        where: {
          purpose: 'ad_campaign',
          status: 'paid',
          paidAt: { gte: start, lt: end },
          subscription: { pharmacyId },
        },
        _sum: { amount: true },
      }),
    ]);

    const totals = this.sum(series);
    const spendNgn = Number(spend._sum.amount ?? 0);
    return {
      period,
      totals: {
        impressions: totals.adImpressions,
        clicks: totals.adClicks,
        ctr: ratio(totals.adClicks, totals.adImpressions),
        spendNgn,
        costPerClickNgn:
          totals.adClicks > 0
            ? Math.round((spendNgn / totals.adClicks) * 100) / 100
            : null,
      },
      campaigns: perCampaign.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        priceNgn: Number(c.price),
        impressions: c.impressions,
        clicks: c.clicks,
        ctr: ratio(c.clicks, c.impressions),
      })),
      series: series.map((r) => ({
        date: r.date,
        impressions: r.adImpressions,
        clicks: r.adClicks,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Back office
  // ═══════════════════════════════════════════════════════════════════════════

  async platform(q: PeriodQueryDto) {
    const period = this.period(q);
    const prev = previousPeriod(period);
    const [series, prevSeries] = await Promise.all([
      this.platformSeries(period),
      this.platformSeries(prev),
    ]);
    const keys = Object.keys(series[0] ?? {}).filter(
      (k) => k !== 'date',
    ) as (keyof Omit<PlatformDayRow, 'date'>)[];
    const total = (rows: PlatformDayRow[]) =>
      Object.fromEntries(
        keys.map((k) => [k, rows.reduce((a, r) => a + Number(r[k]), 0)]),
      ) as Record<string, number>;
    const cur = total(series);
    const old = total(prevSeries);
    return {
      period,
      totals: cur,
      change: Object.fromEntries(
        keys.map((k) => [k, pctChange(cur[k], old[k])]),
      ),
      kpis: {
        fulfilmentRate: ratio(
          cur.reservationsServed,
          cur.reservationsServed +
            cur.reservationsCancelled +
            cur.reservationsExpired,
        ),
        zeroResultRate: ratio(cur.zeroResultSearches, cur.searches),
        searchToReservation: ratio(cur.reservationsCreated, cur.searches),
        adCtr: ratio(cur.adClicks, cur.adImpressions),
      },
      series,
    };
  }

  async searchTrends(q: TrendsQueryDto) {
    const period = this.period(q);
    const t = await this.trendsForPeriod(period, q.searchType, q.limit ?? 25);
    return {
      period,
      searchType: q.searchType ?? 'all',
      topSearches: t.top,
      zeroResultSearches: t.zeroResult,
    };
  }

  async leaderboard(q: LeaderboardQueryDto) {
    const period = this.period(q);
    const metric = q.metric ?? 'reservationsServed';
    const limit = q.limit ?? 20;
    const grouped = await this.prisma.pharmacyDailyStat.groupBy({
      by: ['pharmacyId'],
      where: {
        date: { gte: dayToDbDate(period.from), lte: dayToDbDate(period.to) },
      },
      _sum: {
        reservationsServed: true,
        reservationsCreated: true,
        servedValueNgn: true,
        searchAppearances: true,
        adClicks: true,
        newSaves: true,
      },
      orderBy: { _sum: { [metric]: 'desc' } },
      take: limit,
    });
    const pharmacies = await this.prisma.pharmacy.findMany({
      where: { id: { in: grouped.map((g) => g.pharmacyId) } },
      select: {
        id: true,
        name: true,
        fadaId: true,
        state: true,
        city: true,
        reputationLevel: true,
      },
    });
    const byId = new Map(pharmacies.map((p) => [p.id, p]));
    return {
      period,
      metric,
      note: 'Completed days only (from nightly snapshots).',
      items: grouped.map((g, i) => ({
        rank: i + 1,
        pharmacy: byId.get(g.pharmacyId) ?? { id: g.pharmacyId },
        value: Number(g._sum[metric] ?? 0),
        totals: Object.fromEntries(
          Object.entries(g._sum).map(([k, v]) => [k, Number(v ?? 0)]),
        ),
      })),
    };
  }

  async rebuild(from: string, to: string) {
    let p: Period;
    try {
      p = resolvePeriod({ from, to });
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const today = lagosDay();
    const days = p.days.filter((d) => d < today);
    if (days.length > 90)
      throw new BadRequestException('Rebuild at most 90 days at a time');
    const queued = await this.aggregator.enqueueRebuild(days);
    return { queued, from: days[0] ?? null, to: days[days.length - 1] ?? null };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Series assembly: snapshots for past days, live for today
  // ═══════════════════════════════════════════════════════════════════════════

  private async pharmacySeries(
    pharmacyId: string,
    period: Period,
  ): Promise<PharmacyDayRow[]> {
    const stored = await this.prisma.pharmacyDailyStat.findMany({
      where: {
        pharmacyId,
        date: { gte: dayToDbDate(period.from), lte: dayToDbDate(period.to) },
      },
    });
    const byDay = new Map(
      stored.map((s) => [
        dbDateToDay(s.date),
        {
          pharmacyId,
          date: dbDateToDay(s.date),
          reservationsCreated: s.reservationsCreated,
          reservationsServed: s.reservationsServed,
          reservationsCancelled: s.reservationsCancelled,
          reservationsExpired: s.reservationsExpired,
          servedValueNgn: Number(s.servedValueNgn),
          uniqueCustomers: s.uniqueCustomers,
          searchAppearances: s.searchAppearances,
          adImpressions: s.adImpressions,
          adClicks: s.adClicks,
          drugsAdded: s.drugsAdded,
          newSaves: s.newSaves,
          topQueries: (s.topQueries as unknown as QueryCount[] | null) ?? [],
        } satisfies PharmacyDayRow,
      ]),
    );

    const today = lagosDay();
    const liveFrom = addDays(today, -LIVE_FALLBACK_DAYS);
    const out: PharmacyDayRow[] = [];
    for (const day of period.days) {
      const have = byDay.get(day);
      if (have && day !== today) {
        out.push(have);
      } else if (day === today || day >= liveFrom) {
        const live = await this.aggregator.computePharmacyDay(day, pharmacyId);
        out.push(live.get(pharmacyId) ?? this.empty(pharmacyId, day));
      } else {
        out.push(this.empty(pharmacyId, day));
      }
    }
    return out;
  }

  private async platformSeries(period: Period): Promise<PlatformDayRow[]> {
    const stored = await this.prisma.platformDailyStat.findMany({
      where: {
        date: { gte: dayToDbDate(period.from), lte: dayToDbDate(period.to) },
      },
    });
    const byDay = new Map(stored.map((s) => [dbDateToDay(s.date), s]));
    const today = lagosDay();
    const out: PlatformDayRow[] = [];
    for (const day of period.days) {
      const s = byDay.get(day);
      if (s && day !== today) {
        out.push({
          date: day,
          newCustomers: s.newCustomers,
          newPharmacies: s.newPharmacies,
          activePharmacies: s.activePharmacies,
          reservationsCreated: s.reservationsCreated,
          reservationsServed: s.reservationsServed,
          reservationsCancelled: s.reservationsCancelled,
          reservationsExpired: s.reservationsExpired,
          servedValueNgn: Number(s.servedValueNgn),
          searches: s.searches,
          zeroResultSearches: s.zeroResultSearches,
          adImpressions: s.adImpressions,
          adClicks: s.adClicks,
          subscriptionRevenueNgn: Number(s.subscriptionRevenueNgn),
          adRevenueNgn: Number(s.adRevenueNgn),
        });
      } else if (day === today) {
        out.push(await this.aggregator.computePlatformDay(day));
      } else {
        out.push({ ...this.emptyPlatform(day) });
      }
    }
    return out;
  }

  /** Top and zero-result queries over a period (snapshots + today's live counters). */
  private async trendsForPeriod(
    period: Period,
    searchType: 'drug' | 'ailment' | 'pharmacy' | undefined,
    limit: number,
  ) {
    const rows = await this.prisma.searchTrendDaily.groupBy({
      by: ['query'],
      where: {
        date: { gte: dayToDbDate(period.from), lte: dayToDbDate(period.to) },
        ...(searchType ? { searchType } : {}),
      },
      _sum: { searches: true, zeroResultSearches: true },
    });
    const top = new Map<string, number>();
    const zero = new Map<string, number>();
    rows.forEach((r) => {
      top.set(r.query, r._sum.searches ?? 0);
      if (r._sum.zeroResultSearches)
        zero.set(r.query, r._sum.zeroResultSearches);
    });

    const today = lagosDay();
    if (period.to === today) {
      const types = searchType
        ? [searchType]
        : (['drug', 'ailment', 'pharmacy'] as const);
      for (const t of types) {
        const [lt, lz] = await Promise.all([
          this.tracking.topQueries(today, t, 200).catch(() => []),
          this.tracking.zeroResultQueries(today, t, 200).catch(() => []),
        ]);
        lt.forEach((x) => top.set(x.query, (top.get(x.query) ?? 0) + x.count));
        lz.forEach((x) =>
          zero.set(x.query, (zero.get(x.query) ?? 0) + x.count),
        );
      }
    }
    const rank = (m: Map<string, number>) =>
      [...m.entries()]
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([query, count]) => ({ query, count }));
    return { top: rank(top), zeroResult: rank(zero) };
  }

  /** null/undefined/NaN → null, otherwise whole minutes */
  private minutes(v: number | null | undefined): number | null {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  private sum(rows: PharmacyDayRow[]): Totals {
    const t = Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0])) as Totals;
    for (const r of rows) for (const k of TOTAL_KEYS) t[k] += r[k];
    t.servedValueNgn = Math.round(t.servedValueNgn * 100) / 100;
    return t;
  }

  private empty(pharmacyId: string, date: string): PharmacyDayRow {
    return {
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
    };
  }

  private emptyPlatform(date: string): PlatformDayRow {
    return {
      date,
      newCustomers: 0,
      newPharmacies: 0,
      activePharmacies: 0,
      reservationsCreated: 0,
      reservationsServed: 0,
      reservationsCancelled: 0,
      reservationsExpired: 0,
      servedValueNgn: 0,
      searches: 0,
      zeroResultSearches: 0,
      adImpressions: 0,
      adClicks: 0,
      subscriptionRevenueNgn: 0,
      adRevenueNgn: 0,
    };
  }
}
