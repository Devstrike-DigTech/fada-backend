/**
 * Provider-agnostic payment contracts.
 *
 * Both Paystack (primary) and Flutterwave (fallback) implement IPaymentProvider.
 * The SubscriptionModule only ever talks to this interface so a provider can be
 * swapped per request (`provider` on the subscribe DTO) or globally
 * (`PAYMENT_DEFAULT_PROVIDER`).
 */

export type PaymentProviderName = 'paystack' | 'flutterwave';

export type ProviderBillingInterval = 'monthly' | 'quarterly' | 'annually';

export interface InitializePaymentDto {
  email: string;
  /** Amount in kobo (NGN × 100) */
  amountKobo: number;
  /** Our own unique reference — always supplied so webhooks can be matched to a BillingRecord */
  reference: string;
  metadata?: Record<string, unknown>;
  callbackUrl?: string;
  /**
   * Provider-side recurring plan code. When present the first successful
   * charge also creates a recurring subscription on the provider.
   */
  planCode?: string;
  customerName?: string;
}

export interface InitializePaymentResult {
  authorizationUrl: string;
  reference: string;
  accessCode?: string;
}

export interface VerifyPaymentResult {
  status: 'success' | 'failed' | 'pending';
  reference: string;
  amountKobo: number;
  currency: string;
  paidAt?: Date;
  metadata?: Record<string, unknown>;
  customerCode?: string;
  customerEmail?: string;
  /** Reusable authorization (card token) for charging the same card again */
  authorizationCode?: string;
  /** Present when the charge was made against a recurring plan */
  planCode?: string;
  raw?: unknown;
}

export interface CreateRecurringPlanDto {
  name: string;
  amountKobo: number;
  interval: ProviderBillingInterval;
  description?: string;
}

export interface CreateRecurringPlanResult {
  planCode: string;
}

export interface CreateRecurringSubscriptionDto {
  customerCode: string;
  planCode: string;
  authorizationCode: string;
  /** First charge date — used to start a new plan when the paid period ends */
  startDate?: Date;
}

export interface CreateRecurringSubscriptionResult {
  subscriptionCode: string;
  emailToken?: string;
  nextPaymentDate?: Date;
}

export type NormalizedWebhookEventType =
  | 'charge.success'
  | 'charge.failed'
  | 'subscription.create'
  | 'subscription.disable'
  | 'invoice.payment_failed'
  | 'invoice.paid'
  | 'ignored';

/**
 * A provider webhook reduced to the fields the subscription engine needs.
 * Everything optional: not every provider sends every field for every event.
 */
export interface NormalizedWebhookEvent {
  provider: PaymentProviderName;
  type: NormalizedWebhookEventType;
  rawType: string;
  reference?: string;
  amountKobo?: number;
  currency?: string;
  paidAt?: Date;
  status?: string;
  customerCode?: string;
  customerEmail?: string;
  authorizationCode?: string;
  subscriptionCode?: string;
  emailToken?: string;
  planCode?: string;
  nextPaymentDate?: Date;
  metadata?: Record<string, unknown>;
  failureReason?: string;
  raw: unknown;
}

export interface IPaymentProvider {
  readonly name: PaymentProviderName;
  /** True when the provider can bill the stored card automatically each period */
  readonly supportsRecurring: boolean;
  /** False when no API key is configured — callers must not attempt live calls */
  readonly isConfigured: boolean;

  initializePayment(
    dto: InitializePaymentDto,
  ): Promise<InitializePaymentResult>;
  verifyPayment(reference: string): Promise<VerifyPaymentResult>;

  createRecurringPlan(
    dto: CreateRecurringPlanDto,
  ): Promise<CreateRecurringPlanResult>;
  createRecurringSubscription(
    dto: CreateRecurringSubscriptionDto,
  ): Promise<CreateRecurringSubscriptionResult>;
  cancelSubscription(subscriptionCode: string): Promise<void>;

  verifyWebhookSignature(
    rawBody: Buffer | string | undefined,
    signature: string | undefined,
  ): boolean;
  parseWebhookEvent(body: unknown): NormalizedWebhookEvent;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
export const PAYMENT_PROVIDERS = 'PAYMENT_PROVIDERS';

export class PaymentProviderError extends Error {
  constructor(
    public readonly provider: PaymentProviderName,
    message: string,
    public readonly details?: unknown,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'PaymentProviderError';
  }
}
