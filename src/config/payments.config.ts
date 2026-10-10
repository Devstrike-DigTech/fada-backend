import { registerAs } from '@nestjs/config';

export type DefaultPaymentProvider = 'paystack' | 'flutterwave';

export default registerAs('payments', () => ({
  /** Provider used when a subscribe request does not name one */
  defaultProvider: (process.env.PAYMENT_DEFAULT_PROVIDER ??
    'paystack') as DefaultPaymentProvider,

  /** Where the hosted checkout page sends the user after payment */
  callbackUrl:
    process.env.PAYMENT_CALLBACK_URL ||
    `${process.env.APP_URL ?? 'http://localhost:3000'}/api/v1/subscriptions/payments/callback`,

  /** Optional deep link / web URL the callback redirects to (reference + status appended) */
  successRedirectUrl: process.env.PAYMENT_SUCCESS_REDIRECT_URL || undefined,

  subscription: {
    /** Days after a failed renewal before the pharmacy drops to the free plan */
    gracePeriodDays: parseInt(
      process.env.SUBSCRIPTION_GRACE_PERIOD_DAYS ?? '7',
      10,
    ),
    /** Minimum days between two plan changes for one pharmacy */
    planChangeCooldownDays: parseInt(
      process.env.SUBSCRIPTION_PLAN_CHANGE_COOLDOWN_DAYS ?? '30',
      10,
    ),
    /** Upgrades with more than this many days left are charged (pro-rated) now; otherwise applied at renewal */
    immediateChangeThresholdDays: parseInt(
      process.env.SUBSCRIPTION_IMMEDIATE_CHANGE_THRESHOLD_DAYS ?? '10',
      10,
    ),
    /** Hours a pending checkout stays valid before it is marked failed */
    pendingPaymentTtlHours: parseInt(
      process.env.SUBSCRIPTION_PENDING_PAYMENT_TTL_HOURS ?? '24',
      10,
    ),
  },

  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    publicKey: process.env.PAYSTACK_PUBLIC_KEY,
    baseUrl: process.env.PAYSTACK_BASE_URL ?? 'https://api.paystack.co',
  },
  flutterwave: {
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY,
    publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY,
    /** Shared secret echoed by Flutterwave in the `verif-hash` webhook header */
    hash: process.env.FLUTTERWAVE_HASH,
    baseUrl:
      process.env.FLUTTERWAVE_BASE_URL ?? 'https://api.flutterwave.com/v3',
  },
}));
