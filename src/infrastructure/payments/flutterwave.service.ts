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
  PaymentProviderError,
  VerifyPaymentResult,
} from './payment.interface';

interface FlwEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T;
}

interface FlwTransaction {
  id?: number;
  tx_ref: string;
  flw_ref?: string;
  amount: number; // NGN, not kobo
  currency: string;
  status: string; // successful | failed | pending
  created_at?: string;
  processor_response?: string;
  customer?: { email?: string; name?: string; id?: number };
  card?: { token?: string };
  meta?: Record<string, unknown> | null;
  payment_plan?: number | string | null;
}

interface FlwWebhookBody {
  event: string;
  data: FlwTransaction;
}

/**
 * Flutterwave — fallback payment provider.
 *
 * Implements the same interface as Paystack. Recurring billing uses
 * Flutterwave "payment plans"; a checkout initialised with `planCode`
 * (the numeric plan id) auto-enrols the card.
 */
@Injectable()
export class FlutterwaveService implements IPaymentProvider {
  readonly name = 'flutterwave' as const;
  readonly supportsRecurring = true;

  private readonly logger = new Logger(FlutterwaveService.name);
  private readonly secretKey: string;
  private readonly webhookHash: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.secretKey =
      this.configService.get<string>('payments.flutterwave.secretKey') ?? '';
    this.webhookHash =
      this.configService.get<string>('payments.flutterwave.hash') ?? '';
    this.baseUrl =
      this.configService.get<string>('payments.flutterwave.baseUrl') ??
      'https://api.flutterwave.com/v3';

    if (!this.isConfigured) {
      this.logger.warn(
        'FLUTTERWAVE_SECRET_KEY not set — Flutterwave calls will be rejected.',
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
    const data = await this.request<{ link: string }>('POST', '/payments', {
      tx_ref: dto.reference,
      amount: dto.amountKobo / 100,
      currency: 'NGN',
      redirect_url: dto.callbackUrl,
      payment_options: 'card',
      payment_plan: dto.planCode,
      customer: { email: dto.email, name: dto.customerName },
      meta: dto.metadata,
      customizations: { title: 'FADA Subscription' },
    });

    return { authorizationUrl: data.link, reference: dto.reference };
  }

  async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
    const tx = await this.request<FlwTransaction>(
      'GET',
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
    );
    return this.mapTransaction(tx);
  }

  // ─── Recurring plans & subscriptions ─────────────────────────────────────────

  async createRecurringPlan(
    dto: CreateRecurringPlanDto,
  ): Promise<CreateRecurringPlanResult> {
    const intervalMap: Record<CreateRecurringPlanDto['interval'], string> = {
      monthly: 'monthly',
      quarterly: 'quarterly',
      annually: 'yearly',
    };
    const data = await this.request<{ id: number }>('POST', '/payment-plans', {
      name: dto.name,
      amount: dto.amountKobo / 100,
      interval: intervalMap[dto.interval],
      currency: 'NGN',
    });
    return { planCode: String(data.id) };
  }

  createRecurringSubscription(
    dto: CreateRecurringSubscriptionDto,
  ): Promise<CreateRecurringSubscriptionResult> {
    // Flutterwave enrols the card into the plan during checkout; there is no
    // standalone "create subscription from token" call comparable to Paystack's.
    this.logger.warn(
      `createRecurringSubscription not supported on Flutterwave (plan ${dto.planCode})`,
    );
    return Promise.reject(
      new PaymentProviderError(
        this.name,
        'Flutterwave subscriptions are created at checkout; re-run a checkout with planCode instead',
      ),
    );
  }

  async cancelSubscription(subscriptionCode: string): Promise<void> {
    await this.request(
      'PUT',
      `/subscriptions/${encodeURIComponent(subscriptionCode)}/cancel`,
    );
  }

  // ─── Webhooks ────────────────────────────────────────────────────────────────

  verifyWebhookSignature(
    _rawBody: Buffer | string | undefined,
    signature: string | undefined,
  ): boolean {
    // Flutterwave sends the configured secret hash verbatim in `verif-hash`
    if (!signature || !this.webhookHash) return false;
    const a = Buffer.from(this.webhookHash, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhookEvent(body: unknown): NormalizedWebhookEvent {
    const { event, data } = (body ?? {}) as Partial<FlwWebhookBody>;
    const rawType = event ?? 'unknown';
    const base = { provider: this.name, rawType, raw: body } as const;

    if (rawType === 'charge.completed' && data) {
      const tx = this.mapTransaction(data);
      return {
        ...base,
        type: tx.status === 'success' ? 'charge.success' : 'charge.failed',
        reference: tx.reference,
        amountKobo: tx.amountKobo,
        currency: tx.currency,
        paidAt: tx.paidAt,
        status: tx.status,
        customerEmail: tx.customerEmail,
        authorizationCode: tx.authorizationCode,
        planCode: tx.planCode,
        metadata: tx.metadata,
        failureReason:
          tx.status === 'success' ? undefined : data.processor_response,
      };
    }

    if (rawType === 'subscription.cancelled' && data) {
      return {
        ...base,
        type: 'subscription.disable',
        subscriptionCode: data.id ? String(data.id) : undefined,
      };
    }

    return { ...base, type: 'ignored' };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private mapTransaction(tx: FlwTransaction): VerifyPaymentResult {
    return {
      status:
        tx.status === 'successful'
          ? 'success'
          : tx.status === 'pending'
            ? 'pending'
            : 'failed',
      reference: tx.tx_ref,
      amountKobo: Math.round(Number(tx.amount) * 100),
      currency: tx.currency,
      paidAt: tx.created_at ? new Date(tx.created_at) : undefined,
      metadata: tx.meta ?? undefined,
      customerCode: tx.customer?.id ? String(tx.customer.id) : undefined,
      customerEmail: tx.customer?.email,
      authorizationCode: tx.card?.token,
      planCode: tx.payment_plan ? String(tx.payment_plan) : undefined,
      raw: tx,
    };
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.isConfigured) {
      throw new PaymentProviderError(
        this.name,
        'Flutterwave is not configured (FLUTTERWAVE_SECRET_KEY)',
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
      .catch(() => null)) as FlwEnvelope<T> | null;

    if (!response.ok || !json || json.status !== 'success') {
      const message = json?.message ?? `HTTP ${response.status}`;
      this.logger.error(`Flutterwave ${method} ${path} failed: ${message}`);
      throw new PaymentProviderError(this.name, message, json);
    }
    return json.data;
  }
}
