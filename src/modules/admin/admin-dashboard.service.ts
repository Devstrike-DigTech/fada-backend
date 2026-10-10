import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/database/prisma.service';
import { SubscriptionService } from '@modules/subscription/subscription.service';
import { AdsService } from '@modules/ads/ads.service';
import { SupportService } from '@modules/support/support.service';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Platform-wide numbers for the back-office home screen. Each block is a
 * cheap aggregate; heavier analytics belong to Phase 13.
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly ads: AdsService,
    private readonly support: SupportService,
  ) {}

  async overview() {
    const now = new Date();
    const since24h = new Date(now.getTime() - DAY);
    const since7d = new Date(now.getTime() - 7 * DAY);
    const since30d = new Date(now.getTime() - 30 * DAY);

    const [
      customers,
      pharmacists,
      pharmacies,
      verifiedPharmacies,
      unverifiedPcn,
      branches,
      drugs,
      drugsInStock,
      reservations24h,
      reservations7d,
      reservationsByStatus30d,
      searches7d,
      newPharmacies30d,
      newCustomers30d,
      revenue,
      adsOverview,
      livePromotions,
      supportSummary,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: 'customer' } }),
      this.prisma.user.count({ where: { role: 'pharmacist' } }),
      this.prisma.pharmacy.count({ where: { isActive: true } }),
      this.prisma.pharmacy.count({
        where: { isActive: true, isVerified: true },
      }),
      this.prisma.pharmacistProfile.count({ where: { pcnVerified: false } }),
      this.prisma.branch.count({ where: { isActive: true } }),
      this.prisma.drug.count(),
      this.prisma.drug.count({
        where: { stockStatus: { not: 'out_of_stock' } },
      }),
      this.prisma.reservation.count({
        where: { createdAt: { gte: since24h } },
      }),
      this.prisma.reservation.count({ where: { createdAt: { gte: since7d } } }),
      this.prisma.reservation.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since30d } },
        _count: { _all: true },
      }),
      this.prisma.customerSearchHistory
        .count({ where: { createdAt: { gte: since7d } } })
        .catch(() => 0),
      this.prisma.pharmacy.count({ where: { createdAt: { gte: since30d } } }),
      this.prisma.user.count({
        where: { role: 'customer', createdAt: { gte: since30d } },
      }),
      this.subscriptions.adminRevenueOverview(),
      this.ads.adminOverview(),
      this.prisma.promotion.count({
        where: {
          isActive: true,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gte: now } }],
        },
      }),
      this.support.adminSummary(),
    ]);

    return {
      asOf: now,
      users: { customers, pharmacists, newCustomers30d },
      pharmacies: {
        total: pharmacies,
        verified: verifiedPharmacies,
        pendingPcnVerification: unverifiedPcn,
        branches,
        new30d: newPharmacies30d,
      },
      inventory: { drugs, inStock: drugsInStock },
      reservations: {
        last24h: reservations24h,
        last7d: reservations7d,
        byStatus30d: Object.fromEntries(
          reservationsByStatus30d.map((r) => [r.status, r._count._all]),
        ),
      },
      searches: { last7d: searches7d },
      revenue,
      ads: adsOverview,
      promotions: { live: livePromotions },
      support: supportSummary,
    };
  }
}
