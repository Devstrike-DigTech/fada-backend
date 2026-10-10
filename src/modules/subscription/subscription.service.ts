import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  BillingInterval,
  BillingPurpose,
  PaymentProvider,
  Prisma,
  SubscriptionPlan,
  PharmacySubscription,
} from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import {
  IPaymentProvider,
  NormalizedWebhookEvent,
  PAYMENT_PROVIDERS,
  PaymentProviderError,
  PaymentProviderName,
  VerifyPaymentResult,
} from '@infra/payments/payment.interface';
import {
  EVENTS,
  SubscriptionActivatedPayload,
  SubscriptionCancelledPayload,
  SubscriptionExpiredPayload,
  SubscriptionGracePeriodPayload,
  SubscriptionPaymentFailedPayload,
  SubscriptionPaymentInitializedPayload,
  SubscriptionPaymentSuccessfulPayload,
  SubscriptionPlanChangedPayload,
  SubscriptionRenewedPayload,
} from '@common/types/events.types';
import { SubscribeDto } from './dto/subscribe.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { BillingHistoryQueryDto } from './dto/billing-history-query.dto';
import { SubscriptionEntitlementsService } from './subscription-entitlements.service';
import { PromotionsService } from '@modules/promotions/promotions.service';
import {
  AdPaymentSuccessfulPayload,
  AdminActionPayload,
} from '@common/types/events.types';
import {
  FREE_PLAN_SLUG,
  MS_PER_DAY,
  addInterval,
  daysBetween,
  isFreePlan,
  nairaToKobo,
  priceForInterval,
  prorateChange,
  toNaira,
  ProrationResult,
} from './subscription.pricing';

const referenceId = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 12);

type SubscriptionWithPlan = PharmacySubscription & {
  plan: SubscriptionPlan;
  pendingPlan: SubscriptionPlan | null;
};

type ProviderPlanCodes = Partial<
  Record<PaymentProviderName, Partial<Record<BillingInterval, string>>>
>;

const SUBSCRIPTION_INCLUDE = { plan: true, pendingPlan: true } as const;

/** Result of subscribe / changePlan: either done now, or a checkout to complete. */
export interface PlanActionResult {
  requiresPayment: boolean;
  /** For plan changes: applied now (true) or scheduled for the next renewal (false) */
  effectiveImmediately?: boolean;
  effectiveAt?: Date;
  proration?: ProrationResult;
  subscription?: PresentedSubscription;
  // Checkout fields (requiresPayment = true)
  provider?: PaymentProviderName;
  reference?: string;
  amount?: number;
  currency?: string;
  checkoutUrl?: string;
  accessCode?: string;
  plan?: PresentedPlan;
  billingInterval?: BillingInterval;
  purpose?: BillingPurpose;
  description?: string;
  listAmount?: number;
  discount?: number;
  promotion?: { id: string; code: string; name: string } | null;
  /** Set when a promo code was supplied but could not be applied */
  promoRejected?: string;
}

/** Everything needed to open a hosted checkout for any purpose (subscription or ad). */
export interface CheckoutRequest {
  pharmacyId: string;
  purpose: BillingPurpose;
  /** List price in ₦ before promotions */
  amountNaira: number;
  description: string;
  providerName?: PaymentProviderName;
  promoCode?: string;
  /** Subscription purposes only */
  plan?: SubscriptionPlan;
  interval?: BillingInterval;
  recurring?: boolean;
  /** Ad purpose only */
  adCampaignId?: string;
}

/**
 * Subscription lifecycle for pharmacies.
 *
 *  subscribe → hosted checkout → webhook/verify → activate
 *  changePlan → pro-rated checkout (upgrade) or scheduled change (downgrade / late upgrade)
 *  cancel → auto-renew off, access to period end, sweep downgrades to the free plan
 *  sweep (hourly) → renewals, grace periods, pending changes, stale checkouts
 */
@Injectable()
export class SubscriptionService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionService.name);

  private readonly gracePeriodDays: number;
  private readonly planChangeCooldownDays: number;
  private readonly immediateChangeThresholdDays: number;
  private readonly pendingPaymentTtlHours: number;
  private readonly callbackUrl: string;
  private readonly defaultProvider: PaymentProviderName;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly config: ConfigService,
    private readonly entitlements: SubscriptionEntitlementsService,
    private readonly promotions: PromotionsService,
    @Inject(PAYMENT_PROVIDERS)
    private readonly providers: Record<PaymentProviderName, IPaymentProvider>,
    @InjectQueue(QUEUE_NAMES.SUBSCRIPTION_BILLING)
    private readonly billingQueue: Queue,
  ) {
    this.gracePeriodDays =
      this.config.get<number>('payments.subscription.gracePeriodDays') ?? 7;
    this.planChangeCooldownDays =
      this.config.get<number>('payments.subscription.planChangeCooldownDays') ??
      30;
    this.immediateChangeThresholdDays =
      this.config.get<number>(
        'payments.subscription.immediateChangeThresholdDays',
      ) ?? 10;
    this.pendingPaymentTtlHours =
      this.config.get<number>('payments.subscription.pendingPaymentTtlHours') ??
      24;
    this.callbackUrl = this.config.get<string>('payments.callbackUrl') ?? '';
    this.defaultProvider =
      this.config.get<PaymentProviderName>('payments.defaultProvider') ??
      'paystack';
  }

  // ─── Module Init: hourly billing sweep ───────────────────────────────────────

  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.billingQueue.getRepeatableJobs();
      await Promise.all(
        existing.map((j) => this.billingQueue.removeRepeatableByKey(j.key)),
      );
      await this.billingQueue.add(
        'sweep',
        {},
        {
          repeat: { cron: '0 * * * *' },
          removeOnComplete: 24,
          removeOnFail: 24,
        },
      );
      this.logger.log('Subscription billing sweep scheduled (hourly)');
    } catch (err) {
      this.logger.error('Failed to schedule subscription billing sweep', err);
    }
  }

  // ─── Plans ───────────────────────────────────────────────────────────────────

  async listPlans() {
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return plans.map((p) => this.presentPlan(p));
  }

  presentPlan(p: SubscriptionPlan) {
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      color: p.color,
      description: p.description,
      isFree: isFreePlan(p),
      pricing: {
        monthly: toNaira(p.monthlyPrice),
        quarterly: toNaira(p.quarterlyPrice),
        annually: toNaira(p.annualPrice),
      },
      features: {
        inventorySlotLimit: p.inventorySlotLimit,
        branchLimit: p.branchLimit,
        hasAnalytics: p.hasAnalytics,
        hasAds: p.hasAds,
        adDiscountPct: p.adDiscountPct,
      },
      sortOrder: p.sortOrder,
    };
  }

  // ─── Current subscription ────────────────────────────────────────────────────

  async getCurrentSubscription(requesterUserId: string, pharmacyId: string) {
    await this.assertOwnerOrOperator(requesterUserId, pharmacyId);
    const sub = await this.ensureSubscription(pharmacyId);
    const [entitlements, usage] = await Promise.all([
      this.entitlements.getEntitlements(pharmacyId),
      this.entitlements.getUsage(pharmacyId),
    ]);
    return { ...this.presentSubscription(sub), entitlements, usage };
  }

  presentSubscription(sub: SubscriptionWithPlan) {
    const now = new Date();
    return {
      id: sub.id,
      pharmacyId: sub.pharmacyId,
      status: sub.status,
      plan: this.presentPlan(sub.plan),
      billingInterval: sub.billingInterval,
      paymentProvider: sub.paymentProvider,
      autoRenew:
        sub.cancelledAt === null &&
        !isFreePlan(sub.plan) &&
        !!(sub.paystackSubscriptionCode || sub.flutterwavePlanId),

      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      daysRemaining: Math.ceil(daysBetween(now, sub.currentPeriodEnd)),
      cancelledAt: sub.cancelledAt,
      graceUntil: sub.graceUntil,
      pendingChange: sub.pendingPlan
        ? {
            plan: this.presentPlan(sub.pendingPlan),
            billingInterval: sub.pendingBillingInterval ?? sub.billingInterval,
            effectiveAt: sub.currentPeriodEnd,
          }
        : null,
      lastPlanChangeAt: sub.lastPlanChangeAt,
    };
  }

  /**
   * Every pharmacy gets a free-plan subscription row so entitlement checks,
   * billing history, and plan changes always have something to work from.
   */
  async ensureSubscription(pharmacyId: string): Promise<SubscriptionWithPlan> {
    const existing = await this.prisma.pharmacySubscription.findUnique({
      where: { pharmacyId },
      include: SUBSCRIPTION_INCLUDE,
    });
    if (existing) return existing;

    const freePlan = await this.getFreePlan();
    const now = new Date();
    try {
      const created = await this.prisma.pharmacySubscription.create({
        data: {
          pharmacyId,
          planId: freePlan.id,
          billingInterval: 'monthly',
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: addInterval(now, 'monthly'),
        },
        include: SUBSCRIPTION_INCLUDE,
      });
      this.logger.log(`Free plan assigned to pharmacy ${pharmacyId}`);
      return created;
    } catch (err) {
      // Race: another request created it first
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.prisma.pharmacySubscription.findUniqueOrThrow({
          where: { pharmacyId },
          include: SUBSCRIPTION_INCLUDE,
        });
      }
      throw err;
    }
  }

  // ─── Subscribe ───────────────────────────────────────────────────────────────

  async subscribe(
    requesterUserId: string,
    pharmacyId: string,
    dto: SubscribeDto,
  ): Promise<PlanActionResult> {
    await this.assertOwnership(requesterUserId, pharmacyId);
    const interval: BillingInterval = dto.billingInterval ?? 'monthly';
    const plan = await this.resolvePlan(dto.plan);
    const sub = await this.ensureSubscription(pharmacyId);

    // Already on a paid, live plan → this is a plan change, not a fresh subscription
    if (this.isLivePaid(sub)) {
      if (sub.planId === plan.id && sub.billingInterval === interval) {
        throw new ConflictException(
          'Pharmacy is already subscribed to this plan',
        );
      }
      return this.changePlan(requesterUserId, pharmacyId, {
        plan: plan.id,
        billingInterval: interval,
        provider: dto.provider,
        promoCode: dto.promoCode,
      });
    }

    // Free plan: no payment, activate right away
    if (isFreePlan(plan)) {
      const updated = await this.activatePlan(sub, plan, interval, {
        purpose: 'new_subscription',
        resetProvider: true,
      });
      return {
        requiresPayment: false,
        subscription: this.presentSubscription(updated),
      };
    }

    return this.startCheckout({
      pharmacyId,
      plan,
      interval,
      providerName: dto.provider ?? this.defaultProvider,
      purpose: 'new_subscription',
      amountNaira: this.requirePrice(plan, interval),
      recurring: true,
      description: `${plan.name} plan — ${interval}`,
      promoCode: dto.promoCode,
    });
  }

  // ─── Change plan (upgrade / downgrade) ───────────────────────────────────────

  async changePlan(
    requesterUserId: string,
    pharmacyId: string,
    dto: ChangePlanDto,
  ): Promise<PlanActionResult> {
    await this.assertOwnership(requesterUserId, pharmacyId);
    const sub = await this.ensureSubscription(pharmacyId);
    const newPlan = await this.resolvePlan(dto.plan);
    const newInterval: BillingInterval =
      dto.billingInterval ?? sub.billingInterval;
    const now = new Date();

    if (
      sub.planId === newPlan.id &&
      sub.billingInterval === newInterval &&
      !sub.pendingPlanId
    ) {
      throw new BadRequestException(
        'Pharmacy is already on this plan and interval',
      );
    }

    if (!isFreePlan(newPlan)) this.requirePrice(newPlan, newInterval);

    // Not currently on a live paid plan → a plain subscribe
    if (!this.isLivePaid(sub)) {
      return this.subscribe(requesterUserId, pharmacyId, {
        plan: newPlan.id,
        billingInterval: newInterval,
        provider: dto.provider,
        promoCode: dto.promoCode,
      });
    }

    this.assertPlanChangeCooldown(sub, now);

    const isUpgrade = newPlan.sortOrder > sub.plan.sortOrder;
    const daysRemaining = daysBetween(now, sub.currentPeriodEnd);

    // ── Downgrade (incl. to free): always at the next renewal ──
    if (!isUpgrade) {
      const updated = await this.schedulePendingChange(
        sub,
        newPlan,
        newInterval,
        now,
      );
      if (isFreePlan(newPlan)) {
        await this.cancelProviderSubscription(updated); // stop auto-renew on the old plan
      }
      return {
        requiresPayment: false,
        effectiveImmediately: false,
        effectiveAt: sub.currentPeriodEnd,
        subscription: this.presentSubscription(await this.reload(sub.id)),
      };
    }

    // ── Upgrade close to renewal: schedule, no charge ──
    if (daysRemaining <= this.immediateChangeThresholdDays) {
      await this.schedulePendingChange(sub, newPlan, newInterval, now);
      return {
        requiresPayment: false,
        effectiveImmediately: false,
        effectiveAt: sub.currentPeriodEnd,
        subscription: this.presentSubscription(await this.reload(sub.id)),
      };
    }

    // ── Upgrade with time left: pro-rate and charge now ──
    const proration = prorateChange({
      currentPeriodPrice: this.requirePrice(sub.plan, sub.billingInterval),
      newPeriodPrice: this.requirePrice(newPlan, sub.billingInterval),
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      now,
    });

    if (proration.amountDue <= 0) {
      const updated = await this.applyImmediatePlanChange(
        sub,
        newPlan,
        newInterval,
        now,
      );
      return {
        requiresPayment: false,
        effectiveImmediately: true,
        effectiveAt: now,
        subscription: this.presentSubscription(updated),
      };
    }

    const checkout = await this.startCheckout({
      pharmacyId,
      plan: newPlan,
      interval: newInterval,
      providerName: dto.provider ?? sub.paymentProvider ?? this.defaultProvider,
      purpose: 'plan_change',
      amountNaira: proration.amountDue,
      recurring: false,
      description:
        `Upgrade to ${newPlan.name} — pro-rated for ${Math.ceil(proration.daysRemaining)} remaining day(s) ` +
        `(credit ₦${proration.unusedCredit.toLocaleString()})`,
      promoCode: dto.promoCode,
    });

    return { effectiveImmediately: true, proration, ...checkout };
  }

  // ─── Cancel ──────────────────────────────────────────────────────────────────

  async cancel(
    requesterUserId: string,
    pharmacyId: string,
    dto: CancelSubscriptionDto,
  ) {
    await this.assertOwnership(requesterUserId, pharmacyId);
    const sub = await this.ensureSubscription(pharmacyId);

    if (isFreePlan(sub.plan)) {
      throw new BadRequestException('The free plan cannot be cancelled');
    }
    if (sub.cancelledAt) {
      throw new ConflictException('Subscription is already cancelled');
    }

    const now = new Date();
    await this.prisma.pharmacySubscription.update({
      where: { id: sub.id },
      data: {
        cancelledAt: now,
        pendingPlanId: null,
        pendingBillingInterval: null,
      },
    });
    await this.cancelProviderSubscription(sub);

    const payload: SubscriptionCancelledPayload = {
      pharmacyId,
      subscriptionId: sub.id,
      planName: sub.plan.name,
      cancelledAt: now,
      accessUntil: sub.currentPeriodEnd,
    };
    this.eventBus.emit(EVENTS.SUBSCRIPTION.CANCELLED, payload);
    this.logger.log(
      `Subscription ${sub.id} cancelled (pharmacy ${pharmacyId})${dto.reason ? `: ${dto.reason}` : ''}`,
    );

    return {
      accessUntil: sub.currentPeriodEnd,
      subscription: this.presentSubscription(await this.reload(sub.id)),
    };
  }

  // ─── Billing history ─────────────────────────────────────────────────────────

  async getBillingHistory(
    requesterUserId: string,
    pharmacyId: string,
    query: BillingHistoryQueryDto,
  ) {
    await this.assertOwnerOrOperator(requesterUserId, pharmacyId);
    const sub = await this.ensureSubscription(pharmacyId);
    const where: Prisma.BillingRecordWhereInput = {
      subscriptionId: sub.id,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.billingRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.billingRecord.count({ where }),
    ]);

    const planIds = [
      ...new Set(items.map((i) => i.planId).filter((x): x is string => !!x)),
    ];
    const plans = planIds.length
      ? await this.prisma.subscriptionPlan.findMany({
          where: { id: { in: planIds } },
        })
      : [];
    const planName = new Map(plans.map((p) => [p.id, p.name]));

    return {
      items: items.map((r) => ({
        id: r.id,
        amount: toNaira(r.amount),
        currency: r.currency,
        status: r.status,
        purpose: r.purpose,
        planName: r.planId ? (planName.get(r.planId) ?? null) : null,
        billingInterval: r.billingInterval,
        provider: r.paymentProvider,
        reference: r.providerReference,
        description: r.description,
        failureReason: r.failureReason,
        paidAt: r.paidAt,
        createdAt: r.createdAt,
      })),
      meta: {
        page: query.page ?? 1,
        limit: query.take,
        total,
        totalPages: Math.ceil(total / query.take),
      },
    };
  }

  // ─── Payment verification (callback / client poll) ───────────────────────────

  async verifyPaymentReference(reference: string) {
    const record = await this.prisma.billingRecord.findUnique({
      where: { providerReference: reference },
      include: { subscription: { include: SUBSCRIPTION_INCLUDE } },
    });
    if (!record) throw new NotFoundException('Unknown payment reference');

    if (record.status === 'paid') {
      return {
        status: 'paid' as const,
        subscription: this.presentSubscription(record.subscription),
      };
    }

    const provider = this.getProvider(record.paymentProvider);
    let result: VerifyPaymentResult;
    try {
      result = await provider.verifyPayment(reference);
    } catch (err) {
      this.logger.warn(
        `Verify ${reference} failed on ${provider.name}: ${(err as Error).message}`,
      );
      return {
        status: record.status,
        subscription: this.presentSubscription(record.subscription),
      };
    }

    if (result.status === 'success') {
      await this.applySuccessfulPayment(reference, result, provider.name);
    } else if (result.status === 'failed') {
      await this.markBillingFailed(record.id, 'Payment failed at provider');
    }

    const fresh = await this.prisma.billingRecord.findUniqueOrThrow({
      where: { id: record.id },
      include: { subscription: { include: SUBSCRIPTION_INCLUDE } },
    });
    return {
      status: fresh.status,
      subscription: this.presentSubscription(fresh.subscription),
    };
  }

  // ─── Webhooks ────────────────────────────────────────────────────────────────

  async handleWebhook(
    providerName: PaymentProviderName,
    rawBody: Buffer | string | undefined,
    signature: string | undefined,
    body: unknown,
  ): Promise<{ received: true; handled: string }> {
    const provider = this.getProvider(providerName);

    if (!provider.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn(`Rejected ${providerName} webhook: bad signature`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = provider.parseWebhookEvent(body);
    this.logger.log(
      `${providerName} webhook: ${event.rawType} → ${event.type}`,
    );

    try {
      switch (event.type) {
        case 'charge.success':
          await this.onChargeSuccess(event);
          break;
        case 'invoice.paid':
          await this.onInvoicePaid(event);
          break;
        case 'subscription.create':
          await this.onSubscriptionCreate(event);
          break;
        case 'subscription.disable':
          await this.onSubscriptionDisable(event);
          break;
        case 'invoice.payment_failed':
        case 'charge.failed':
          await this.onPaymentFailed(event);
          break;
        default:
          break;
      }
    } catch (err) {
      // Never surface internal errors to the provider as a 5xx retry storm for
      // business-rule rejections; genuine failures are logged for ops.
      this.logger.error(
        `Error handling ${providerName} ${event.rawType}`,
        err as Error,
      );
      if (
        !(
          err instanceof BadRequestException || err instanceof NotFoundException
        )
      ) {
        throw err;
      }
    }

    return { received: true, handled: event.type };
  }

  private async onChargeSuccess(event: NormalizedWebhookEvent): Promise<void> {
    if (!event.reference) return;

    const record = await this.prisma.billingRecord.findUnique({
      where: { providerReference: event.reference },
    });

    if (record) {
      await this.applySuccessfulPayment(
        event.reference,
        {
          status: 'success',
          reference: event.reference,
          amountKobo: event.amountKobo ?? 0,
          currency: event.currency ?? 'NGN',
          paidAt: event.paidAt,
          customerCode: event.customerCode,
          customerEmail: event.customerEmail,
          authorizationCode: event.authorizationCode,
          planCode: event.planCode,
          metadata: event.metadata,
          raw: event.raw,
        },
        event.provider,
      );
      return;
    }

    // No record → a provider-initiated renewal charge
    const sub = await this.findSubscriptionForEvent(event);
    if (!sub) {
      this.logger.warn(
        `charge.success ${event.reference}: no matching subscription`,
      );
      return;
    }
    await this.applyRenewal(sub, event);
  }

  private async onInvoicePaid(event: NormalizedWebhookEvent): Promise<void> {
    // Paystack also sends charge.success for the same transaction; the unique
    // providerReference makes a second application a no-op.
    if (!event.reference) return;
    const exists = await this.prisma.billingRecord.findUnique({
      where: { providerReference: event.reference },
    });
    if (exists) return;
    const sub = await this.findSubscriptionForEvent(event);
    if (sub) await this.applyRenewal(sub, event);
  }

  private async onSubscriptionCreate(
    event: NormalizedWebhookEvent,
  ): Promise<void> {
    const sub = await this.findSubscriptionForEvent(event);
    if (!sub) {
      this.logger.warn(
        `subscription.create ${event.subscriptionCode}: no matching subscription`,
      );
      return;
    }
    await this.prisma.pharmacySubscription.update({
      where: { id: sub.id },
      data: {
        paystackSubscriptionCode:
          event.provider === 'paystack'
            ? event.subscriptionCode
            : sub.paystackSubscriptionCode,
        flutterwavePlanId:
          event.provider === 'flutterwave'
            ? event.subscriptionCode
            : sub.flutterwavePlanId,
        paystackCustomerCode: event.customerCode ?? sub.paystackCustomerCode,
        paystackAuthorizationCode:
          event.authorizationCode ?? sub.paystackAuthorizationCode,
        paymentProvider: event.provider,
      },
    });
    this.logger.log(
      `Recurring subscription linked: ${event.subscriptionCode} → ${sub.id}`,
    );
  }

  private async onSubscriptionDisable(
    event: NormalizedWebhookEvent,
  ): Promise<void> {
    const sub = await this.findSubscriptionForEvent(event);
    if (!sub || sub.cancelledAt) return;
    const now = new Date();
    await this.prisma.pharmacySubscription.update({
      where: { id: sub.id },
      data: { cancelledAt: now },
    });
    const payload: SubscriptionCancelledPayload = {
      pharmacyId: sub.pharmacyId,
      subscriptionId: sub.id,
      planName: sub.plan.name,
      cancelledAt: now,
      accessUntil: sub.currentPeriodEnd,
    };
    this.eventBus.emit(EVENTS.SUBSCRIPTION.CANCELLED, payload);
  }

  private async onPaymentFailed(event: NormalizedWebhookEvent): Promise<void> {
    if (event.reference) {
      const record = await this.prisma.billingRecord.findUnique({
        where: { providerReference: event.reference },
      });
      if (record && record.status === 'pending') {
        await this.markBillingFailed(
          record.id,
          event.failureReason ?? 'Payment failed',
        );
      }
    }

    const sub = await this.findSubscriptionForEvent(event);
    if (!sub || isFreePlan(sub.plan)) return;

    await this.startGracePeriod(sub, {
      reference: event.reference,
      amountKobo: event.amountKobo,
      provider: event.provider,
      reason: event.failureReason,
    });
  }

  // ─── Core transitions ────────────────────────────────────────────────────────

  /**
   * Idempotently marks a BillingRecord paid and applies its purpose
   * (new subscription, pro-rated plan change, or renewal).
   */
  async applySuccessfulPayment(
    reference: string,
    result: VerifyPaymentResult,
    providerName: PaymentProviderName,
  ): Promise<void> {
    const record = await this.prisma.billingRecord.findUnique({
      where: { providerReference: reference },
      include: { subscription: { include: SUBSCRIPTION_INCLUDE } },
    });
    if (!record)
      throw new NotFoundException(`No billing record for ${reference}`);
    if (record.status === 'paid') return; // webhook redelivery / double verify

    const expectedKobo = nairaToKobo(toNaira(record.amount) ?? 0);
    if (result.amountKobo < expectedKobo) {
      await this.markBillingFailed(
        record.id,
        `Underpaid: expected ${expectedKobo} kobo, got ${result.amountKobo}`,
      );
      throw new BadRequestException(
        'Payment amount does not match the invoice',
      );
    }

    const paidAt = result.paidAt ?? new Date();
    const sub = record.subscription;
    const plan = record.planId
      ? await this.prisma.subscriptionPlan.findUniqueOrThrow({
          where: { id: record.planId },
        })
      : sub.plan;
    const interval = record.billingInterval ?? sub.billingInterval;

    await this.prisma.billingRecord.update({
      where: { id: record.id },
      data: {
        status: 'paid',
        paidAt,
        providerMetadata: (result.raw ?? null) as Prisma.InputJsonValue,
      },
    });

    const providerFields = {
      paymentProvider: providerName as PaymentProvider,
      paystackCustomerCode: result.customerCode ?? sub.paystackCustomerCode,
      paystackAuthorizationCode:
        result.authorizationCode ?? sub.paystackAuthorizationCode,
    };

    // Promotion redemption is tied to the paid record (idempotent per record)
    if (record.promotionId) {
      await this.promotions.redeem({
        promotionId: record.promotionId,
        pharmacyId: sub.pharmacyId,
        discountNgn: toNaira(record.discountNgn) ?? 0,
        billingRecordId: record.id,
        adCampaignId: record.adCampaignId ?? undefined,
      });
    }

    // Ad campaign payments do not touch the subscription — hand off to AdsModule
    if (record.purpose === 'ad_campaign') {
      const adPayload: AdPaymentSuccessfulPayload = {
        campaignId: record.adCampaignId ?? '',
        pharmacyId: sub.pharmacyId,
        billingRecordId: record.id,
        amountKobo: result.amountKobo,
        reference,
        provider: providerName,
        paidAt,
      };
      this.eventBus.emit(EVENTS.ADS.PAYMENT_SUCCESSFUL, adPayload);
      return;
    }

    let updated: SubscriptionWithPlan;
    switch (record.purpose) {
      case 'new_subscription':
        updated = await this.activatePlan(sub, plan, interval, {
          purpose: 'new_subscription',
          resetProvider: false,
          extra: providerFields,
        });
        break;
      case 'plan_change':
        updated = await this.applyImmediatePlanChange(
          sub,
          plan,
          interval,
          paidAt,
          providerFields,
        );
        break;
      case 'renewal':
        updated = await this.extendPeriod(sub, interval, providerFields);
        break;
      default:
        return;
    }

    const payload: SubscriptionPaymentSuccessfulPayload = {
      pharmacyId: sub.pharmacyId,
      subscriptionId: sub.id,
      planId: plan.id,
      planName: plan.name,
      amountKobo: result.amountKobo,
      reference,
      provider: providerName,
      paidAt,
      expiresAt: updated.currentPeriodEnd,
    };
    this.eventBus.emit(EVENTS.SUBSCRIPTION.PAYMENT_SUCCESSFUL, payload);
  }

  /** Puts the pharmacy on `plan` for a fresh period starting now. */
  private async activatePlan(
    sub: SubscriptionWithPlan,
    plan: SubscriptionPlan,
    interval: BillingInterval,
    opts: {
      purpose: BillingPurpose;
      resetProvider: boolean;
      extra?: Partial<Prisma.PharmacySubscriptionUncheckedUpdateInput>;
    },
  ): Promise<SubscriptionWithPlan> {
    const now = new Date();
    const periodEnd = addInterval(now, interval);

    // Moving off a paid plan with a live provider subscription → stop it
    if (opts.resetProvider && sub.paystackSubscriptionCode) {
      await this.cancelProviderSubscription(sub);
    }

    const updated = await this.prisma.pharmacySubscription.update({
      where: { id: sub.id },
      data: {
        planId: plan.id,
        billingInterval: interval,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelledAt: null,
        graceUntil: null,
        pendingPlanId: null,
        pendingBillingInterval: null,
        lastPlanChangeAt: sub.planId === plan.id ? sub.lastPlanChangeAt : now,
        ...(opts.resetProvider
          ? {
              paymentProvider: null,
              paystackSubscriptionCode: null,
              paystackCustomerCode: null,
              paystackAuthorizationCode: null,
              flutterwavePlanId: null,
            }
          : {}),
        ...(opts.extra ?? {}),
      },
      include: SUBSCRIPTION_INCLUDE,
    });

    const payload: SubscriptionActivatedPayload = {
      pharmacyId: sub.pharmacyId,
      subscriptionId: sub.id,
      planId: plan.id,
      planName: plan.name,
      billingInterval: interval,
      activatedAt: now,
      expiresAt: periodEnd,
    };
    this.eventBus.emit(EVENTS.SUBSCRIPTION.ACTIVATED, payload);
    this.logger.log(
      `Pharmacy ${sub.pharmacyId} → ${plan.name} (${interval}) until ${periodEnd.toISOString()}`,
    );
    return updated;
  }

  /** Switches plan now, keeping the current period end. Re-points recurring billing at the new plan. */
  private async applyImmediatePlanChange(
    sub: SubscriptionWithPlan,
    newPlan: SubscriptionPlan,
    newInterval: BillingInterval,
    at: Date,
    providerFields?: Partial<Prisma.PharmacySubscriptionUncheckedUpdateInput>,
  ): Promise<SubscriptionWithPlan> {
    const intervalChanges = newInterval !== sub.billingInterval;

    const updated = await this.prisma.pharmacySubscription.update({
      where: { id: sub.id },
      data: {
        planId: newPlan.id,
        status: 'active',
        graceUntil: null,
        lastPlanChangeAt: at,
        // A new interval starts at the next renewal
        pendingPlanId: intervalChanges ? newPlan.id : null,
        pendingBillingInterval: intervalChanges ? newInterval : null,
        ...(providerFields ?? {}),
      },
      include: SUBSCRIPTION_INCLUDE,
    });

    await this.repointRecurringBilling(
      updated,
      newPlan,
      sub.billingInterval,
      sub.currentPeriodEnd,
    );

    const payload: SubscriptionPlanChangedPayload = {
      pharmacyId: sub.pharmacyId,
      subscriptionId: sub.id,
      previousPlanId: sub.plan.id,
      previousPlanName: sub.plan.name,
      newPlanId: newPlan.id,
      newPlanName: newPlan.name,
      billingInterval: newInterval,
      effectiveImmediately: true,
      effectiveAt: at,
    };
    this.eventBus.emit(
      newPlan.sortOrder > sub.plan.sortOrder
        ? EVENTS.SUBSCRIPTION.UPGRADED
        : EVENTS.SUBSCRIPTION.DOWNGRADED,
      payload,
    );
    return this.reload(sub.id);
  }

  private async schedulePendingChange(
    sub: SubscriptionWithPlan,
    newPlan: SubscriptionPlan,
    newInterval: BillingInterval,
    at: Date,
  ): Promise<SubscriptionWithPlan> {
    const updated = await this.prisma.pharmacySubscription.update({
      where: { id: sub.id },
      data: {
        pendingPlanId: newPlan.id,
        pendingBillingInterval: newInterval,
        lastPlanChangeAt: at,
      },
      include: SUBSCRIPTION_INCLUDE,
    });

    const payload: SubscriptionPlanChangedPayload = {
      pharmacyId: sub.pharmacyId,
      subscriptionId: sub.id,
      previousPlanId: sub.plan.id,
      previousPlanName: sub.plan.name,
      newPlanId: newPlan.id,
      newPlanName: newPlan.name,
      billingInterval: newInterval,
      effectiveImmediately: false,
      effectiveAt: sub.currentPeriodEnd,
    };
    this.eventBus.emit(
      newPlan.sortOrder > sub.plan.sortOrder
        ? EVENTS.SUBSCRIPTION.UPGRADED
        : EVENTS.SUBSCRIPTION.DOWNGRADED,
      payload,
    );
    this.logger.log(
      `Pharmacy ${sub.pharmacyId}: ${sub.plan.name} → ${newPlan.name} scheduled for ${sub.currentPeriodEnd.toISOString()}`,
    );
    return updated;
  }

  /** Provider-initiated renewal: records the charge and extends the period. */
  private async applyRenewal(
    sub: SubscriptionWithPlan,
    event: NormalizedWebhookEvent,
  ) {
    const amountNaira = (event.amountKobo ?? 0) / 100;
    try {
      await this.prisma.billingRecord.create({
        data: {
          subscriptionId: sub.id,
          amount: amountNaira,
          currency: event.currency ?? 'NGN',
          paymentProvider: event.provider,
          providerReference: event.reference,
          status: 'paid',
          purpose: 'renewal',
          planId: sub.planId,
          billingInterval: sub.billingInterval,
          description: `${sub.plan.name} plan renewal`,
          paidAt: event.paidAt ?? new Date(),
          providerMetadata: (event.raw ?? null) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return; // already recorded
      }
      throw err;
    }

    const updated = await this.extendPeriod(sub, sub.billingInterval, {
      paymentProvider: event.provider,
      paystackCustomerCode: event.customerCode ?? sub.paystackCustomerCode,
      paystackAuthorizationCode:
        event.authorizationCode ?? sub.paystackAuthorizationCode,
    });

    const payload: SubscriptionPaymentSuccessfulPayload = {
      pharmacyId: sub.pharmacyId,
      subscriptionId: sub.id,
      planId: sub.planId,
      planName: sub.plan.name,
      amountKobo: event.amountKobo ?? 0,
      reference: event.reference ?? '',
      provider: event.provider,
      paidAt: event.paidAt ?? new Date(),
      expiresAt: updated.currentPeriodEnd,
    };
    this.eventBus.emit(EVENTS.SUBSCRIPTION.PAYMENT_SUCCESSFUL, payload);
  }

  /** Moves the period forward one interval from its end (or from now if it already lapsed). */
  private async extendPeriod(
    sub: SubscriptionWithPlan,
    interval: BillingInterval,
    extra?: Partial<Prisma.PharmacySubscriptionUncheckedUpdateInput>,
  ): Promise<SubscriptionWithPlan> {
    const now = new Date();
    const from = sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
    const periodEnd = addInterval(from, interval);

    const updated = await this.prisma.pharmacySubscription.update({
      where: { id: sub.id },
      data: {
        status: 'active',
        billingInterval: interval,
        currentPeriodStart: from,
        currentPeriodEnd: periodEnd,
        graceUntil: null,
        ...(extra ?? {}),
      },
      include: SUBSCRIPTION_INCLUDE,
    });

    const payload: SubscriptionRenewedPayload = {
      pharmacyId: sub.pharmacyId,
      subscriptionId: sub.id,
      planName: updated.plan.name,
      renewedAt: now,
      expiresAt: periodEnd,
    };
    this.eventBus.emit(EVENTS.SUBSCRIPTION.RENEWED, payload);
    return updated;
  }

  private async startGracePeriod(
    sub: SubscriptionWithPlan,
    failure: {
      reference?: string;
      amountKobo?: number;
      provider: string;
      reason?: string;
    },
  ): Promise<void> {
    const now = new Date();
    const alreadyInGrace =
      sub.status === 'past_due' && sub.graceUntil && sub.graceUntil > now;
    const graceUntil = alreadyInGrace
      ? sub.graceUntil!
      : new Date(now.getTime() + this.gracePeriodDays * MS_PER_DAY);

    if (!alreadyInGrace) {
      await this.prisma.pharmacySubscription.update({
        where: { id: sub.id },
        data: { status: 'past_due', graceUntil },
      });
      const gracePayload: SubscriptionGracePeriodPayload = {
        pharmacyId: sub.pharmacyId,
        subscriptionId: sub.id,
        planName: sub.plan.name,
        graceUntil,
      };
      this.eventBus.emit(
        EVENTS.SUBSCRIPTION.GRACE_PERIOD_STARTED,
        gracePayload,
      );
    }

    const failed: SubscriptionPaymentFailedPayload = {
      pharmacyId: sub.pharmacyId,
      subscriptionId: sub.id,
      planName: sub.plan.name,
      amountKobo: failure.amountKobo,
      reference: failure.reference,
      provider: failure.provider,
      reason: failure.reason,
      graceUntil,
      failedAt: now,
    };
    this.eventBus.emit(EVENTS.SUBSCRIPTION.PAYMENT_FAILED, failed);
    this.logger.warn(
      `Pharmacy ${sub.pharmacyId} renewal failed; grace until ${graceUntil.toISOString()}`,
    );
  }

  /** Drops a lapsed paid subscription to the free plan. */
  private async expireToFreePlan(
    sub: SubscriptionWithPlan,
    reason: string,
  ): Promise<void> {
    const freePlan = await this.getFreePlan();
    const now = new Date();

    await this.cancelProviderSubscription(sub);

    await this.prisma.pharmacySubscription.update({
      where: { id: sub.id },
      data: {
        planId: freePlan.id,
        billingInterval: 'monthly',
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: addInterval(now, 'monthly'),
        cancelledAt: null,
        graceUntil: null,
        pendingPlanId: null,
        pendingBillingInterval: null,
        paymentProvider: null,
        paystackSubscriptionCode: null,
        flutterwavePlanId: null,
      },
    });

    const payload: SubscriptionExpiredPayload = {
      pharmacyId: sub.pharmacyId,
      subscriptionId: sub.id,
      planName: sub.plan.name,
      downgradedToPlanName: freePlan.name,
      expiredAt: now,
    };
    this.eventBus.emit(EVENTS.SUBSCRIPTION.GRACE_PERIOD_EXPIRED, payload);
    this.eventBus.emit(EVENTS.PHARMACY.SUBSCRIPTION_EXPIRED, payload);
    this.logger.warn(
      `Pharmacy ${sub.pharmacyId}: ${sub.plan.name} expired (${reason}) → ${freePlan.name}`,
    );
  }

  // ─── Billing sweep (hourly) ──────────────────────────────────────────────────

  async runBillingSweep(): Promise<{
    staleCheckouts: number;
    renewedFree: number;
    pendingApplied: number;
    graceStarted: number;
    expired: number;
  }> {
    const now = new Date();
    const stats = {
      staleCheckouts: 0,
      renewedFree: 0,
      pendingApplied: 0,
      graceStarted: 0,
      expired: 0,
    };

    // 1. Abandoned checkouts
    const staleBefore = new Date(
      now.getTime() - this.pendingPaymentTtlHours * 60 * 60 * 1000,
    );
    const stale = await this.prisma.billingRecord.updateMany({
      where: { status: 'pending', createdAt: { lt: staleBefore } },
      data: {
        status: 'failed',
        failureReason: 'Checkout expired without payment',
      },
    });
    stats.staleCheckouts = stale.count;

    // 2. Grace periods that ran out
    const lapsed = await this.prisma.pharmacySubscription.findMany({
      where: { status: 'past_due', graceUntil: { lt: now } },
      include: SUBSCRIPTION_INCLUDE,
    });
    for (const sub of lapsed) {
      await this.safely(
        () => this.expireToFreePlan(sub, 'grace period ended'),
        sub.id,
      );
      stats.expired++;
    }

    // 3. Periods that ended
    const ended = await this.prisma.pharmacySubscription.findMany({
      where: {
        status: { in: ['active', 'trialing'] },
        currentPeriodEnd: { lt: now },
      },
      include: SUBSCRIPTION_INCLUDE,
    });

    for (const sub of ended) {
      await this.safely(async () => {
        // 3a. Scheduled plan change
        if (sub.pendingPlan) {
          const newInterval = sub.pendingBillingInterval ?? sub.billingInterval;
          if (isFreePlan(sub.pendingPlan)) {
            await this.activatePlan(sub, sub.pendingPlan, 'monthly', {
              purpose: 'plan_change',
              resetProvider: true,
            });
          } else {
            await this.startPendingPaidPlan(sub, sub.pendingPlan, newInterval);
          }
          stats.pendingApplied++;
          return;
        }

        // 3b. Cancelled → free
        if (sub.cancelledAt) {
          await this.expireToFreePlan(sub, 'cancelled');
          stats.expired++;
          return;
        }

        // 3c. Free plan → just roll the period
        if (isFreePlan(sub.plan)) {
          await this.prisma.pharmacySubscription.update({
            where: { id: sub.id },
            data: {
              currentPeriodStart: now,
              currentPeriodEnd: addInterval(now, 'monthly'),
            },
          });
          stats.renewedFree++;
          return;
        }

        // 3d. Paid plan whose renewal charge has not arrived → grace period
        await this.startGracePeriod(sub, {
          provider: sub.paymentProvider ?? this.defaultProvider,
          reason: 'Renewal payment not received by period end',
        });
        stats.graceStarted++;
      }, sub.id);
    }

    this.logger.log(
      `Billing sweep: stale=${stats.staleCheckouts} freeRenewed=${stats.renewedFree} ` +
        `pending=${stats.pendingApplied} grace=${stats.graceStarted} expired=${stats.expired}`,
    );
    return stats;
  }

  /**
   * A scheduled move to a (different) paid plan at renewal: switch the plan,
   * then try to bill the stored card through a new provider subscription.
   * Until the charge webhook lands the pharmacy sits in a grace window.
   */
  private async startPendingPaidPlan(
    sub: SubscriptionWithPlan,
    newPlan: SubscriptionPlan,
    interval: BillingInterval,
  ): Promise<void> {
    const now = new Date();
    await this.cancelProviderSubscription(sub);

    const switched = await this.prisma.pharmacySubscription.update({
      where: { id: sub.id },
      data: {
        planId: newPlan.id,
        billingInterval: interval,
        pendingPlanId: null,
        pendingBillingInterval: null,
        paystackSubscriptionCode: null,
        lastPlanChangeAt: now,
      },
      include: SUBSCRIPTION_INCLUDE,
    });

    const payload: SubscriptionPlanChangedPayload = {
      pharmacyId: sub.pharmacyId,
      subscriptionId: sub.id,
      previousPlanId: sub.plan.id,
      previousPlanName: sub.plan.name,
      newPlanId: newPlan.id,
      newPlanName: newPlan.name,
      billingInterval: interval,
      effectiveImmediately: true,
      effectiveAt: now,
    };
    this.eventBus.emit(
      newPlan.sortOrder > sub.plan.sortOrder
        ? EVENTS.SUBSCRIPTION.UPGRADED
        : EVENTS.SUBSCRIPTION.DOWNGRADED,
      payload,
    );

    const billed = await this.repointRecurringBilling(
      switched,
      newPlan,
      interval,
      now,
    );
    await this.startGracePeriod(switched, {
      provider: switched.paymentProvider ?? this.defaultProvider,
      reason: billed
        ? 'Awaiting first charge on the new plan'
        : 'Could not start billing on the new plan automatically — please pay manually',
    });
  }

  /**
   * Cancels the provider subscription tied to the old plan and, where the
   * provider supports it, starts one on the new plan from `startDate`.
   * Returns true when a new recurring subscription was created.
   */
  private async repointRecurringBilling(
    sub: SubscriptionWithPlan,
    newPlan: SubscriptionPlan,
    interval: BillingInterval,
    startDate: Date,
  ): Promise<boolean> {
    const providerName = sub.paymentProvider ?? this.defaultProvider;
    const provider = this.providers[providerName];

    if (sub.paystackSubscriptionCode) {
      await this.cancelProviderSubscription(sub);
    }

    if (
      !provider?.isConfigured ||
      !provider.supportsRecurring ||
      !sub.paystackCustomerCode ||
      !sub.paystackAuthorizationCode ||
      isFreePlan(newPlan)
    ) {
      return false;
    }

    try {
      const planCode = await this.resolveProviderPlanCode(
        provider,
        newPlan,
        interval,
      );
      const created = await provider.createRecurringSubscription({
        customerCode: sub.paystackCustomerCode,
        planCode,
        authorizationCode: sub.paystackAuthorizationCode,
        startDate,
      });
      await this.prisma.pharmacySubscription.update({
        where: { id: sub.id },
        data: {
          paystackSubscriptionCode: created.subscriptionCode,
          paymentProvider: providerName,
        },
      });
      this.logger.log(
        `Recurring billing re-pointed to ${newPlan.name} (${created.subscriptionCode})`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `Could not create recurring subscription for ${sub.id}`,
        err as Error,
      );
      return false;
    }
  }

  // ─── Checkout helpers ────────────────────────────────────────────────────────

  /**
   * Opens a hosted checkout for any billable purpose. Applies promotions
   * (explicit code or auto-apply seasonal promos). When the discounted amount
   * is ₦0 the purpose is completed immediately without a provider round-trip.
   *
   * Used by subscribe / changePlan here and by AdsService for campaign payments.
   */
  async startCheckout(req: CheckoutRequest): Promise<PlanActionResult> {
    const providerName = req.providerName ?? this.defaultProvider;
    const provider = this.getProvider(providerName);
    const sub = await this.ensureSubscription(req.pharmacyId);
    const isSubscriptionPurpose = req.purpose !== 'ad_campaign';

    if (isSubscriptionPurpose && (!req.plan || !req.interval)) {
      throw new BadRequestException(
        'plan and interval are required for subscription checkouts',
      );
    }
    if (!isSubscriptionPurpose && !req.adCampaignId) {
      throw new BadRequestException(
        'adCampaignId is required for ad checkouts',
      );
    }

    // ── Promotions ──
    const quote = await this.promotions.quote({
      target: isSubscriptionPurpose ? 'subscriptions' : 'ads',
      pharmacyId: req.pharmacyId,
      amountNgn: req.amountNaira,
      code: req.promoCode,
      planId: req.plan?.id,
      billingInterval: req.interval,
    });
    const finalAmount = quote.finalAmountNgn;
    const promoSummary = quote.promotion
      ? {
          id: quote.promotion.id,
          code: quote.promotion.code,
          name: quote.promotion.name,
        }
      : null;

    const pharmacy = await this.prisma.pharmacy.findUniqueOrThrow({
      where: { id: req.pharmacyId },
      select: { id: true, name: true, ownerId: true },
    });
    const ownerUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: pharmacy.ownerId },
      select: { email: true, firstName: true, lastName: true },
    });

    const reference = `FADA-${isSubscriptionPurpose ? 'SUB' : 'AD'}-${referenceId()}`;
    const record = await this.prisma.billingRecord.create({
      data: {
        subscriptionId: sub.id,
        amount: finalAmount,
        listAmount: quote.listAmountNgn,
        discountNgn: quote.discountNgn,
        promotionId: quote.promotion?.id,
        currency: 'NGN',
        paymentProvider: providerName,
        providerReference: reference,
        status: 'pending',
        purpose: req.purpose,
        planId: req.plan?.id,
        billingInterval: req.interval,
        adCampaignId: req.adCampaignId,
        description: quote.promotion
          ? `${req.description} (promo ${quote.promotion.code}: −₦${quote.discountNgn.toLocaleString()})`
          : req.description,
      },
    });

    const common = {
      provider: providerName,
      reference,
      amount: finalAmount,
      listAmount: quote.listAmountNgn,
      discount: quote.discountNgn,
      promotion: promoSummary,
      promoRejected: quote.rejectionReason,
      currency: 'NGN',
      plan: req.plan ? this.presentPlan(req.plan) : undefined,
      billingInterval: req.interval,
      purpose: req.purpose,
      description: record.description ?? req.description,
    };

    // ── Fully discounted: complete without the provider ──
    if (finalAmount <= 0) {
      await this.applySuccessfulPayment(
        reference,
        {
          status: 'success',
          reference,
          amountKobo: 0,
          currency: 'NGN',
          paidAt: new Date(),
        },
        providerName,
      );
      return {
        requiresPayment: false,
        ...common,
        subscription: this.presentSubscription(await this.reload(sub.id)),
      };
    }

    if (!provider.isConfigured) {
      await this.markBillingFailed(
        record.id,
        `${providerName} is not configured`,
      );
      throw new BadRequestException(
        `${providerName} is not configured on this server. Contact support or try another provider.`,
      );
    }

    let planCode: string | undefined;
    if (
      isSubscriptionPurpose &&
      req.recurring &&
      provider.supportsRecurring &&
      !quote.promotion
    ) {
      // A recurring plan code bills the list price every period, so it is only
      // attached when no discount applies to this first charge.
      try {
        planCode = await this.resolveProviderPlanCode(
          provider,
          req.plan!,
          req.interval!,
        );
      } catch (err) {
        this.logger.warn(
          `No recurring plan code for ${req.plan!.slug}/${req.interval}: ${(err as Error).message}`,
        );
      }
    }

    try {
      const init = await provider.initializePayment({
        email: ownerUser.email,
        customerName:
          [ownerUser.firstName, ownerUser.lastName].filter(Boolean).join(' ') ||
          pharmacy.name,
        amountKobo: nairaToKobo(finalAmount),
        reference,
        callbackUrl: this.callbackUrl,
        planCode,
        metadata: {
          pharmacyId: pharmacy.id,
          pharmacyName: pharmacy.name,
          subscriptionId: sub.id,
          billingRecordId: record.id,
          purpose: req.purpose,
          planId: req.plan?.id,
          planSlug: req.plan?.slug,
          billingInterval: req.interval,
          adCampaignId: req.adCampaignId,
          promotionCode: quote.promotion?.code,
        },
      });

      if (isSubscriptionPurpose) {
        const payload: SubscriptionPaymentInitializedPayload = {
          pharmacyId: pharmacy.id,
          subscriptionId: sub.id,
          billingRecordId: record.id,
          planId: req.plan!.id,
          planName: req.plan!.name,
          billingInterval: req.interval!,
          amountKobo: nairaToKobo(finalAmount),
          reference,
          provider: providerName,
          initializedAt: new Date(),
        };
        this.eventBus.emit(EVENTS.SUBSCRIPTION.PAYMENT_INITIALIZED, payload);
      }

      return {
        requiresPayment: true,
        ...common,
        checkoutUrl: init.authorizationUrl,
        accessCode: init.accessCode,
      };
    } catch (err) {
      await this.markBillingFailed(
        record.id,
        `Checkout initialisation failed: ${(err as Error).message}`,
      );
      if (err instanceof PaymentProviderError) {
        throw new BadRequestException(`Payment provider error: ${err.message}`);
      }
      throw err;
    }
  }

  // ─── Back-office (admin) operations ──────────────────────────────────────────

  async adminListSubscriptions(query: {
    status?: string;
    plan?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where: Prisma.PharmacySubscriptionWhereInput = {
      ...(query.status
        ? { status: query.status as SubscriptionWithPlan['status'] }
        : {}),
      ...(query.plan
        ? { plan: { OR: [{ id: query.plan }, { slug: query.plan }] } }
        : {}),
      ...(query.search
        ? {
            pharmacy: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { fadaId: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.pharmacySubscription.findMany({
        where,
        include: {
          ...SUBSCRIPTION_INCLUDE,
          pharmacy: {
            select: {
              id: true,
              name: true,
              fadaId: true,
              email: true,
              state: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pharmacySubscription.count({ where }),
    ]);
    return {
      items: items.map((s) => ({
        pharmacy: s.pharmacy,
        ...this.presentSubscription(s),
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async adminGetSubscription(pharmacyId: string) {
    const sub = await this.ensureSubscription(pharmacyId);
    const [pharmacy, entitlements, usage, billing] = await Promise.all([
      this.prisma.pharmacy.findUniqueOrThrow({
        where: { id: pharmacyId },
        select: {
          id: true,
          name: true,
          fadaId: true,
          email: true,
          phone: true,
          state: true,
          city: true,
        },
      }),
      this.entitlements.getEntitlements(pharmacyId),
      this.entitlements.getUsage(pharmacyId),
      this.prisma.billingRecord.findMany({
        where: { subscriptionId: sub.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      pharmacy,
      ...this.presentSubscription(sub),
      entitlements,
      usage,
      recentBilling: billing.map((r) => ({
        id: r.id,
        amount: toNaira(r.amount),
        listAmount: toNaira(r.listAmount),
        discount: toNaira(r.discountNgn),
        status: r.status,
        purpose: r.purpose,
        provider: r.paymentProvider,
        reference: r.providerReference,
        description: r.description,
        paidAt: r.paidAt,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * Back office puts a pharmacy on a plan without payment (comp, waiting-list
   * batch perks, dispute resolution). Records a ₦0 billing line for the trail.
   */
  async adminAssignPlan(
    pharmacyId: string,
    args: {
      plan: string;
      billingInterval?: BillingInterval;
      periodEnd?: Date;
      reason: string;
    },
    adminUserId: string,
  ) {
    const sub = await this.ensureSubscription(pharmacyId);
    const plan = await this.resolvePlan(args.plan);
    const interval = args.billingInterval ?? 'monthly';
    const now = new Date();
    const purpose: BillingPurpose =
      sub.planId === plan.id ? 'renewal' : 'plan_change';

    if (args.periodEnd && args.periodEnd <= now) {
      throw new BadRequestException('periodEnd must be in the future');
    }

    const updated = await this.activatePlan(sub, plan, interval, {
      purpose,
      resetProvider: true,
    });

    if (args.periodEnd) {
      await this.prisma.pharmacySubscription.update({
        where: { id: sub.id },
        data: { currentPeriodEnd: args.periodEnd },
      });
    }

    const listPrice = priceForInterval(plan, interval) ?? 0;
    await this.prisma.billingRecord.create({
      data: {
        subscriptionId: sub.id,
        amount: 0,
        listAmount: listPrice,
        discountNgn: listPrice,
        currency: 'NGN',
        paymentProvider: this.defaultProvider,
        providerReference: `FADA-ADMIN-${referenceId()}`,
        status: 'paid',
        purpose,
        planId: plan.id,
        billingInterval: interval,
        description: `Admin override: ${args.reason}`,
        paidAt: now,
        providerMetadata: {
          adminUserId,
          reason: args.reason,
        } as Prisma.InputJsonValue,
      },
    });

    const payload: AdminActionPayload = {
      adminUserId,
      action: 'subscription.assign_plan',
      targetType: 'pharmacy',
      targetId: pharmacyId,
      details: {
        planId: plan.id,
        planName: plan.name,
        interval,
        periodEnd: args.periodEnd,
        reason: args.reason,
      },
      occurredAt: now,
    };
    this.eventBus.emit(EVENTS.ADMIN.SUBSCRIPTION_OVERRIDDEN, payload);
    this.logger.warn(
      `Admin ${adminUserId} set pharmacy ${pharmacyId} to ${plan.name}: ${args.reason}`,
    );
    return this.presentSubscription(await this.reload(updated.id));
  }

  async adminExtendPeriod(
    pharmacyId: string,
    days: number,
    reason: string,
    adminUserId: string,
  ) {
    if (days <= 0 || days > 730) {
      throw new BadRequestException('days must be between 1 and 730');
    }
    const sub = await this.ensureSubscription(pharmacyId);
    const base =
      sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
    const newEnd = new Date(base.getTime() + days * MS_PER_DAY);

    await this.prisma.pharmacySubscription.update({
      where: { id: sub.id },
      data: {
        currentPeriodEnd: newEnd,
        ...(sub.status === 'past_due' || sub.status === 'expired'
          ? { status: 'active', graceUntil: null }
          : {}),
      },
    });

    const payload: AdminActionPayload = {
      adminUserId,
      action: 'subscription.extend',
      targetType: 'pharmacy',
      targetId: pharmacyId,
      details: { days, newEnd, reason },
      occurredAt: new Date(),
    };
    this.eventBus.emit(EVENTS.ADMIN.SUBSCRIPTION_OVERRIDDEN, payload);
    return this.presentSubscription(await this.reload(sub.id));
  }

  async adminCancel(
    pharmacyId: string,
    args: { reason: string; immediate?: boolean },
    adminUserId: string,
  ) {
    const sub = await this.ensureSubscription(pharmacyId);
    if (isFreePlan(sub.plan)) {
      throw new BadRequestException('Pharmacy is already on the free plan');
    }

    if (args.immediate) {
      await this.expireToFreePlan(sub, `admin: ${args.reason}`);
    } else if (!sub.cancelledAt) {
      await this.prisma.pharmacySubscription.update({
        where: { id: sub.id },
        data: {
          cancelledAt: new Date(),
          pendingPlanId: null,
          pendingBillingInterval: null,
        },
      });
      await this.cancelProviderSubscription(sub);
    }

    const payload: AdminActionPayload = {
      adminUserId,
      action: args.immediate
        ? 'subscription.cancel_immediate'
        : 'subscription.cancel',
      targetType: 'pharmacy',
      targetId: pharmacyId,
      details: { reason: args.reason },
      occurredAt: new Date(),
    };
    this.eventBus.emit(EVENTS.ADMIN.SUBSCRIPTION_OVERRIDDEN, payload);
    return this.presentSubscription(await this.reload(sub.id));
  }

  /** Revenue snapshot for the back-office dashboard. */
  async adminRevenueOverview() {
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * MS_PER_DAY);

    const [subs, plans, paid30, pendingCount, failed30] = await Promise.all([
      this.prisma.pharmacySubscription.groupBy({
        by: ['planId', 'status'],
        _count: { _all: true },
      }),
      this.prisma.subscriptionPlan.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.billingRecord.groupBy({
        by: ['purpose'],
        where: { status: 'paid', paidAt: { gte: since30 } },
        _sum: { amount: true, discountNgn: true },
        _count: { _all: true },
      }),
      this.prisma.billingRecord.count({ where: { status: 'pending' } }),
      this.prisma.billingRecord.count({
        where: { status: 'failed', createdAt: { gte: since30 } },
      }),
    ]);

    const planById = new Map(plans.map((p) => [p.id, p]));
    const byPlan: Record<
      string,
      {
        name: string;
        active: number;
        pastDue: number;
        cancelled: number;
        other: number;
      }
    > = {};
    let mrr = 0;
    for (const row of subs) {
      const plan = planById.get(row.planId);
      if (!plan) continue;
      const bucket = (byPlan[plan.slug] ??= {
        name: plan.name,
        active: 0,
        pastDue: 0,
        cancelled: 0,
        other: 0,
      });
      const n = row._count._all;
      if (row.status === 'active' || row.status === 'trialing') {
        bucket.active += n;
        mrr += (toNaira(plan.monthlyPrice) ?? 0) * n;
      } else if (row.status === 'past_due') bucket.pastDue += n;
      else if (row.status === 'cancelled' || row.status === 'expired')
        bucket.cancelled += n;
      else bucket.other += n;
    }

    const revenue30 = Object.fromEntries(
      paid30.map((r) => [
        r.purpose,
        {
          amount: toNaira(r._sum.amount) ?? 0,
          discounts: toNaira(r._sum.discountNgn) ?? 0,
          count: r._count._all,
        },
      ]),
    );

    return {
      asOf: now,
      estimatedMrrNgn: mrr,
      subscriptionsByPlan: byPlan,
      last30Days: {
        revenueByPurpose: revenue30,
        totalRevenueNgn: paid30.reduce(
          (acc, r) => acc + (toNaira(r._sum.amount) ?? 0),
          0,
        ),
        failedPayments: failed30,
      },
      pendingCheckouts: pendingCount,
    };
  }

  /** Finds (or lazily creates and stores) the provider's recurring plan code for plan × interval. */
  private async resolveProviderPlanCode(
    provider: IPaymentProvider,
    plan: SubscriptionPlan,
    interval: BillingInterval,
  ): Promise<string> {
    const codes = ((plan.providerPlanCodes ?? {}) as ProviderPlanCodes) ?? {};
    const existing = codes[provider.name]?.[interval];
    if (existing) return existing;

    const price = this.requirePrice(plan, interval);
    const created = await provider.createRecurringPlan({
      name: `FADA ${plan.name} (${interval})`,
      amountKobo: nairaToKobo(price),
      interval,
      description: plan.description ?? undefined,
    });

    const merged: ProviderPlanCodes = {
      ...codes,
      [provider.name]: {
        ...(codes[provider.name] ?? {}),
        [interval]: created.planCode,
      },
    };
    await this.prisma.subscriptionPlan.update({
      where: { id: plan.id },
      data: { providerPlanCodes: merged as Prisma.InputJsonValue },
    });
    this.logger.log(
      `Created ${provider.name} plan ${created.planCode} for ${plan.slug}/${interval}`,
    );
    return created.planCode;
  }

  private async cancelProviderSubscription(
    sub: PharmacySubscription,
  ): Promise<void> {
    const code = sub.paystackSubscriptionCode ?? sub.flutterwavePlanId;
    const providerName =
      sub.paymentProvider ?? (sub.paystackSubscriptionCode ? 'paystack' : null);
    if (!code || !providerName) return;
    const provider = this.providers[providerName];
    if (!provider?.isConfigured) return;
    try {
      await provider.cancelSubscription(code);
      this.logger.log(
        `Provider subscription ${code} disabled on ${providerName}`,
      );
    } catch (err) {
      // Best effort — the sweep will still stop access at period end
      this.logger.error(
        `Failed to disable provider subscription ${code}`,
        err as Error,
      );
    }
  }

  // ─── Lookups & guards ────────────────────────────────────────────────────────

  private async findSubscriptionForEvent(
    event: NormalizedWebhookEvent,
  ): Promise<SubscriptionWithPlan | null> {
    if (event.subscriptionCode) {
      const bySub = await this.prisma.pharmacySubscription.findFirst({
        where:
          event.provider === 'paystack'
            ? { paystackSubscriptionCode: event.subscriptionCode }
            : { flutterwavePlanId: event.subscriptionCode },
        include: SUBSCRIPTION_INCLUDE,
      });
      if (bySub) return bySub;
    }
    if (event.customerCode) {
      const byCustomer = await this.prisma.pharmacySubscription.findFirst({
        where: { paystackCustomerCode: event.customerCode },
        include: SUBSCRIPTION_INCLUDE,
      });
      if (byCustomer) return byCustomer;
    }
    const pharmacyId = event.metadata?.pharmacyId;
    if (typeof pharmacyId === 'string') {
      const byMeta = await this.prisma.pharmacySubscription.findUnique({
        where: { pharmacyId },
        include: SUBSCRIPTION_INCLUDE,
      });
      if (byMeta) return byMeta;
    }
    if (event.customerEmail) {
      const owner = await this.prisma.user.findUnique({
        where: { email: event.customerEmail.toLowerCase() },
        select: { id: true },
      });
      if (owner) {
        return this.prisma.pharmacySubscription.findFirst({
          where: { pharmacy: { ownerId: owner.id } },
          include: SUBSCRIPTION_INCLUDE,
        });
      }
    }
    return null;
  }

  private async resolvePlan(idOrSlug: string): Promise<SubscriptionPlan> {
    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: {
        isActive: true,
        OR: [{ id: idOrSlug }, { slug: idOrSlug.toLowerCase() }],
      },
    });
    if (!plan) throw new NotFoundException(`Plan "${idOrSlug}" not found`);
    return plan;
  }

  private async getFreePlan(): Promise<SubscriptionPlan> {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { slug: FREE_PLAN_SLUG },
    });
    if (!plan) {
      throw new NotFoundException(
        `Free plan "${FREE_PLAN_SLUG}" is not seeded. Run \`npx prisma db seed\`.`,
      );
    }
    return plan;
  }

  private getProvider(
    name: PaymentProviderName | PaymentProvider,
  ): IPaymentProvider {
    const provider = this.providers[name as PaymentProviderName];
    if (!provider)
      throw new BadRequestException(`Unknown payment provider "${name}"`);
    return provider;
  }

  private requirePrice(
    plan: SubscriptionPlan,
    interval: BillingInterval,
  ): number {
    const price = priceForInterval(plan, interval);
    if (price === null) {
      throw new BadRequestException(
        `${plan.name} is not offered on a ${interval} basis`,
      );
    }
    return price;
  }

  private isLivePaid(sub: SubscriptionWithPlan): boolean {
    if (isFreePlan(sub.plan)) return false;
    const now = new Date();
    return (
      sub.status === 'active' ||
      sub.status === 'trialing' ||
      (sub.status === 'past_due' && !!sub.graceUntil && sub.graceUntil > now)
    );
  }

  private assertPlanChangeCooldown(sub: PharmacySubscription, now: Date): void {
    if (!sub.lastPlanChangeAt || this.planChangeCooldownDays <= 0) return;
    const nextAllowed = new Date(
      sub.lastPlanChangeAt.getTime() + this.planChangeCooldownDays * MS_PER_DAY,
    );
    if (nextAllowed > now) {
      throw new ConflictException(
        `Plan can only be changed once every ${this.planChangeCooldownDays} days. Next change allowed on ${nextAllowed.toDateString()}.`,
      );
    }
  }

  private async markBillingFailed(id: string, reason: string): Promise<void> {
    await this.prisma.billingRecord.update({
      where: { id },
      data: { status: 'failed', failureReason: reason.slice(0, 500) },
    });
  }

  private async reload(id: string): Promise<SubscriptionWithPlan> {
    return this.prisma.pharmacySubscription.findUniqueOrThrow({
      where: { id },
      include: SUBSCRIPTION_INCLUDE,
    });
  }

  private async safely(
    fn: () => Promise<void>,
    subscriptionId: string,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(
        `Billing sweep failed for subscription ${subscriptionId}`,
        err as Error,
      );
    }
  }

  private async assertOwnership(
    userId: string,
    pharmacyId: string,
  ): Promise<void> {
    const profile = await this.prisma.pharmacistProfile.findFirst({
      where: { userId, pharmacyId, roleInPharmacy: 'owner' },
    });
    if (!profile) {
      throw new ForbiddenException(
        'Only the pharmacy owner can manage the subscription',
      );
    }
  }

  private async assertOwnerOrOperator(
    userId: string,
    pharmacyId: string,
  ): Promise<void> {
    const profile = await this.prisma.pharmacistProfile.findFirst({
      where: {
        userId,
        pharmacyId,
        roleInPharmacy: { in: ['owner', 'operator'] },
      },
    });
    if (!profile) {
      throw new ForbiddenException(
        'Only the pharmacy owner or operator can view the subscription',
      );
    }
  }
}

export type PresentedPlan = ReturnType<SubscriptionService['presentPlan']>;
export type PresentedSubscription = ReturnType<
  SubscriptionService['presentSubscription']
>;
