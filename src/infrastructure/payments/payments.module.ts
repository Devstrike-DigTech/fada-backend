import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaystackService } from './paystack.service';
import { FlutterwaveService } from './flutterwave.service';
import {
  IPaymentProvider,
  PAYMENT_PROVIDER,
  PAYMENT_PROVIDERS,
  PaymentProviderName,
} from './payment.interface';

/**
 * Registers both payment providers.
 *
 *  - `PAYMENT_PROVIDER`  → the default provider (PAYMENT_DEFAULT_PROVIDER env)
 *  - `PAYMENT_PROVIDERS` → map of every provider by name, for per-request overrides
 */
@Global()
@Module({
  providers: [
    PaystackService,
    FlutterwaveService,
    {
      provide: PAYMENT_PROVIDERS,
      inject: [PaystackService, FlutterwaveService],
      useFactory: (
        paystack: PaystackService,
        flutterwave: FlutterwaveService,
      ): Record<PaymentProviderName, IPaymentProvider> => ({
        paystack,
        flutterwave,
      }),
    },
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, PAYMENT_PROVIDERS],
      useFactory: (
        config: ConfigService,
        providers: Record<PaymentProviderName, IPaymentProvider>,
      ): IPaymentProvider => {
        const name =
          config.get<PaymentProviderName>('payments.defaultProvider') ??
          'paystack';
        return providers[name] ?? providers.paystack;
      },
    },
  ],
  exports: [
    PaystackService,
    FlutterwaveService,
    PAYMENT_PROVIDER,
    PAYMENT_PROVIDERS,
  ],
})
export class PaymentsModule {}
