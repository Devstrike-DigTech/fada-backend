import { Promotion } from '@prisma/client';
import { PromotionsService } from './promotions.service';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';

const now = Date.now();
const promo = (over: Partial<Promotion>): Promotion =>
  ({
    id: 'p1',
    code: 'XMAS25',
    name: 'Xmas',
    description: null,
    discountType: 'percentage',
    discountValue: 25 as never,
    maxDiscountNgn: null,
    appliesTo: 'both',
    planIds: [],
    billingIntervals: [],
    startsAt: new Date(now - 86400000),
    endsAt: new Date(now + 86400000),
    autoApply: false,
    maxRedemptions: null,
    maxRedemptionsPerPharmacy: 1,
    redemptionsCount: 0,
    isActive: true,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as Promotion;

function service(opts: {
  byCode?: Promotion | null;
  auto?: Promotion[];
  used?: number;
}) {
  const prisma = {
    promotion: {
      findUnique: jest.fn().mockResolvedValue(opts.byCode ?? null),
      findMany: jest.fn().mockResolvedValue(opts.auto ?? []),
    },
    promotionRedemption: { count: jest.fn().mockResolvedValue(opts.used ?? 0) },
  } as unknown as PrismaService;
  return new PromotionsService(prisma, {
    emit: jest.fn(),
  } as unknown as EventBusService);
}

const base = {
  target: 'subscriptions' as const,
  pharmacyId: 'ph1',
  amountNgn: 10000,
  planId: 'plan-zuko',
  billingInterval: 'monthly' as const,
};

describe('PromotionsService.quote', () => {
  it('applies a percentage code', async () => {
    const q = await service({ byCode: promo({}) }).quote({
      ...base,
      code: 'xmas25',
    });
    expect(q).toMatchObject({ discountNgn: 2500, finalAmountNgn: 7500 });
  });

  it('caps a percentage discount', async () => {
    const q = await service({
      byCode: promo({ maxDiscountNgn: 1000 as never }),
    }).quote({ ...base, code: 'XMAS25' });
    expect(q.discountNgn).toBe(1000);
  });

  it('never discounts below zero', async () => {
    const q = await service({
      byCode: promo({
        discountType: 'fixed_amount',
        discountValue: 50000 as never,
      }),
    }).quote({
      ...base,
      code: 'XMAS25',
    });
    expect(q.finalAmountNgn).toBe(0);
  });

  it('explains why a code does not apply and charges list price', async () => {
    const cases: [Partial<Promotion>, number, RegExp][] = [
      [{ planIds: ['plan-aang'] }, 0, /plan/],
      [{ billingIntervals: ['annually'] }, 0, /interval/],
      [{ appliesTo: 'ads' }, 0, /does not apply/],
      [{ endsAt: new Date(now - 1000) }, 0, /ended/],
      [{ startsAt: new Date(now + 86400000) }, 0, /not started/],
      [{ isActive: false }, 0, /no longer active/],
      [{ maxRedemptions: 3, redemptionsCount: 3 }, 0, /fully redeemed/],
      [{}, 1, /already used/],
    ];
    for (const [over, used, reason] of cases) {
      const q = await service({ byCode: promo(over), used }).quote({
        ...base,
        code: 'XMAS25',
      });
      expect(q.discountNgn).toBe(0);
      expect(q.finalAmountNgn).toBe(10000);
      expect(q.rejectionReason).toMatch(reason);
    }
  });

  it('reports unknown codes', async () => {
    const q = await service({ byCode: null }).quote({ ...base, code: 'NOPE' });
    expect(q.rejectionReason).toBe('Unknown promo code');
  });

  it('picks the biggest eligible seasonal promotion without a code', async () => {
    const q = await service({
      auto: [
        promo({
          id: 'a',
          code: 'TEN',
          autoApply: true,
          discountValue: 10 as never,
        }),
        promo({
          id: 'b',
          code: 'FIXED',
          autoApply: true,
          discountType: 'fixed_amount',
          discountValue: 3000 as never,
        }),
        promo({
          id: 'c',
          code: 'BIG',
          autoApply: true,
          discountValue: 50 as never,
          planIds: ['plan-aang'],
        }),
      ],
    }).quote(base);
    expect(q.promotion?.code).toBe('FIXED');
    expect(q.discountNgn).toBe(3000);
  });
});
