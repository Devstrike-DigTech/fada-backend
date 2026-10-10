import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  CreateRecurringPlanDto,
  CreateRecurringPlanResult,
  CreateRecurringSubscriptionDto,
  CreateRecurringSubscriptionResult,
  IPaymentProvider,
  InitializePaymentDto,
  InitializePaymentResult,
  NormalizedWebhookEvent,
  NormalizedWebhookEventType,
  PaymentProviderError,
  VerifyPaymentResult,
} from './payment.interface';

// ─── Paystack response shapes (only the fields we read) ───────────────────────

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

interface PaystackCustomer {
  customer_code?: string;
  email?: string;
}

interface PaystackAuthorization {
  authorization_code?: string;
  reusable?: boolean;
}

interface PaystackPlanRef {
  plan_code?: string;
}

interface PaystackTransaction {
  reference: string;
  amount: number;
  currency: string;
  status: string;
  paid_at?: string | null;
  gateway_response?: string;
  metadata?: Record<string, unknown> | string | null;
  customer?: PaystackCustomer;
  authorization?: PaystackAuthorization;
  plan?: PaystackPlanRef | string | null;
}

interface PaystackSubscription {
  subscription_code: string;
  email_token?: string;
  status?: string;
  next_payment_date?: string | null;
  customer?: PaystackCustomer;
  authorization?: PaystackAuthorization;
  plan?: PaystackPlanRef;
}

interface PaystackInvoice {
  amount?: number;
  currency?: string;
  status?: string;
  paid?: boolean;
  paid_at?: string | null;
  description?: string;
  subscription?: { subscription_code?: string; status?: string };
  transaction?: { reference?: string; status?: string };
  customer?: PaystackCustomer;
  authorization?: PaystackAuthorization;
}

interface PaystackWebhookBody {
  event: string;
  data: PaystackTransaction | PaystackSubscription | PaystackInvoice;
}

/**
 * Paystack — primary payment provider.
 *
 * Recurring billing model:
 *   1. `createRecurringPlan` registers a Paystack Plan (one per FADA plan × interval).
 *   2. `initializePayment` with `planCode` opens a hosted checkout; on success Paystack
 *      creates the recurring subscription itself and emits `subscription.create`.
 *   3. Each renewal arrives as `charge.success` / `invoice.*` webhooks.
 *   4. `cancelSubscription` disables the Paystack subscription (needs the email token).
 */
@Injectable()
export class PaystackService implements IPaymentProvider {
  readonly name = 'paystack' as const;
  readonly supportsRecurring = true;

  private readonly logger = new Logger(PaystackService.name);
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.secretKey =
      this.configService.get<string>('payments.paystack.secretKey') ?? '';
    this.baseUrl =
      this.configService.get<string>('payments.paystack.baseUrl') ??
      'https://api.paystack.co';

    if (!this.isConfigured) {
      this.logger.warn(
        'PAYSTACK_SECRET_KEY not set — Paystack calls will be rejected.',
      );
    }
  }

  get isConfigured(): boolean {
    return this.secretKey.length > 0;
  }

  // ─── Checkout ────────────────────────────────────────────────────────────────

  async initializePayment(
    dto: InitializePaymentDto,
  ): Promise<InitializePaymentResult> {
    const data = await this.request<{
      authorization_url: string;
      reference: string;
      access_code: string;
    }>('POST', '/transaction/initialize', {
      email: dto.email,
      amount: dto.amountKobo,
      reference: dto.reference,
      currency: 'NGN',
      metadata: dto.metadata,
      callback_url: dto.callbackUrl,
      plan: dto.planCode,
      channels: ['card'], // recurring billing needs a card authorization
    });

    return {
      authorizationUrl: data.authorization_url,
      reference: data.reference,
      accessCode: data.access_code,
    };
  }

  async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
    const tx = await this.request<PaystackTransaction>(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    return this.mapTransaction(tx);
  }

  // ─── Recurring plans & subscriptions ─────────────────────────────────────────

  async createRecurringPlan(
    dto: CreateRecurringPlanDto,
  ): Promise<CreateRecurringPlanResult> {
    const data = await this.request<{ plan_code: string }>('POST', '/plan', {
      name: dto.name,
      amount: dto.amountKobo,
      interval: dto.interval, // Paystack accepts monthly | quarterly | annually
      currency: 'NGN',
      description: dto.description,
      send_invoices: true,
      send_sms: false,
    });
    return { planCode: data.plan_code };
  }

  async createRecurringSubscription(
    dto: CreateRecurringSubscriptionDto,
  ): Promise<CreateRecurringSubscriptionResult> {
    const data = await this.request<PaystackSubscription>(
      'POST',
      '/subscription',
      {
        customer: dto.customerCode,
        plan: dto.planCode,
        authorization: dto.authorizationCode,
        start_date: dto.startDate?.toISOString(),
      },
    );
    return {
      subscriptionCode: data.subscription_code,
      emailToken: data.email_token,
      nextPaymentDate: data.next_payment_date
        ? new Date(data.next_payment_date)
        : undefined,
    };
  }

  async cancelSubscription(subscriptionCode: string): Promise<void> {
    // Paystack needs the subscription's email_token to disable it
    const sub = await this.request<PaystackSubscription>(
      'GET',
      `/subscription/${encodeURIComponent(subscriptionCode)}`,
    );
    if (!sub.email_token) {
      throw new PaymentProviderError(
        this.name,
        'Subscription has no email token; cannot disable',
      );
    }
    await this.request('POST', '/subscription/disable', {
      code: subscriptionCode,
      token: sub.email_token,
    });
  }

  // ─── Webhooks ────────────────────────────────────────────────────────────────

  verifyWebhookSignature(
    rawBody: Buffer | string | undefined,
    signature: string | undefined,
  ): boolean {
    if (!rawBody || !signature || !this.isConfigured) return false;
    const expected = crypto
      .createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhookEvent(body: unknown): NormalizedWebhookEvent {
    const { event, data } = (body ?? {}) as Partial<PaystackWebhookBody>;
    const rawType = event ?? 'unknown';
    const base = { provider: this.name, rawType, raw: body } as const;

    switch (rawType) {
      case 'charge.success': {
        const tx = this.mapTransaction(data as PaystackTransaction);
        return {
          ...base,
          type: 'charge.success',
          reference: tx.reference,
          amountKobo: tx.amountKobo,
          currency: tx.currency,
          paidAt: tx.paidAt,
          status: tx.status,
          customerCode: tx.customerCode,
          customerEmail: tx.customerEmail,
          authorizationCode: tx.authorizationCode,
          planCode: tx.planCode,
          metadata: tx.metadata,
        };
      }
      case 'subscription.create': {
        const s = data as PaystackSubscription;
        return {
          ...base,
          type: 'subscription.create',
          subscriptionCode: s.subscription_code,
          emailToken: s.email_token,
          customerCode: s.customer?.customer_code,
          customerEmail: s.customer?.email,
          authorizationCode: s.authorization?.authorization_code,
          planCode: s.plan?.plan_code,
          nextPaymentDate: s.next_payment_date
            ? new Date(s.next_payment_date)
            : undefined,
          status: s.status,
        };
      }
      case 'subscription.disable':
      case 'subscription.not_renew': {
        const s = data as PaystackSubscription;
        return {
          ...base,
          type: 'subscription.disable',
          subscriptionCode: s.subscription_code,
          customerCode: s.customer?.customer_code,
          planCode: s.plan?.plan_code,
          status: s.status,
        };
      }
      case 'invoice.payment_failed': {
        const inv = data as PaystackInvoice;
        return {
          ...base,
          type: 'invoice.payment_failed',
          subscriptionCode: inv.subscription?.subscription_code,
          reference: inv.transaction?.reference,
          amountKobo: inv.amount,
          currency: inv.currency,
          customerCode: inv.customer?.customer_code,
          customerEmail: inv.customer?.email,
          failureReason: inv.description ?? inv.transaction?.status,
          status: inv.status,
        };
      }
      case 'invoice.update':
      case 'invoice.create': {
        const inv = data as PaystackInvoice;
        const type: NormalizedWebhookEventType = inv.paid
          ? 'invoice.paid'
          : 'ignored';
        return {
          ...base,
          type,
          subscriptionCode: inv.subscription?.subscription_code,
          reference: inv.transaction?.reference,
          amountKobo: inv.amount,
          currency: inv.currency,
          paidAt: inv.paid_at ? new Date(inv.paid_at) : undefined,
          customerCode: inv.customer?.customer_code,
          customerEmail: inv.customer?.email,
          authorizationCode: inv.authorization?.authorization_code,
          status: inv.status,
        };
      }
      default:
        return { ...base, type: 'ignored' };
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private mapTransaction(tx: PaystackTransaction): VerifyPaymentResult {
    const planCode =
      typeof tx.plan === 'string' ? tx.plan : (tx.plan?.plan_code ?? undefined);
    const metadata =
      typeof tx.metadata === 'string'
        ? this.safeJson(tx.metadata)
        : (tx.metadata ?? undefined);

    return {
      status:
        tx.status === 'success'
          ? 'success'
          : tx.status === 'pending'
            ? 'pending'
            : 'failed',
      reference: tx.reference,
      amountKobo: tx.amount,
      currency: tx.currency,
      paidAt: tx.paid_at ? new Date(tx.paid_at) : undefined,
      metadata,
      customerCode: tx.customer?.customer_code,
      customerEmail: tx.customer?.email,
      authorizationCode: tx.authorization?.authorization_code,
      planCode,
      raw: tx,
    };
  }

  private safeJson(value: string): Record<string, unknown> | undefined {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.isConfigured) {
      throw new PaymentProviderError(
        this.name,
        'Paystack is not configured (PAYSTACK_SECRET_KEY)',
      );
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new PaymentProviderError(
        this.name,
        `Network error calling ${path}`,
        err,
      );
    }

    const json = (await response
      .json()
      .catch(() => null)) as PaystackEnvelope<T> | null;

    if (!response.ok || !json || json.status !== true) {
      const message = json?.message ?? `HTTP ${response.status}`;
      this.logger.error(`Paystack ${method} ${path} failed: ${message}`);
      throw new PaymentProviderError(this.name, message, json);
    }
    return json.data;
  }
}
