import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  IPaymentProvider,
  InitializePaymentDto,
  InitializePaymentResult,
  VerifyPaymentResult,
} from './payment.interface';

@Injectable()
export class PaystackService implements IPaymentProvider {
  private readonly logger = new Logger(PaystackService.name);
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.paystack.co';

  constructor(private readonly configService: ConfigService) {
    this.secretKey =
      this.configService.get<string>('payments.paystack.secretKey') ?? '';
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  async initializePayment(
    dto: InitializePaymentDto,
  ): Promise<InitializePaymentResult> {
    const response = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        email: dto.email,
        amount: dto.amountKobo,
        reference: dto.reference,
        metadata: dto.metadata,
        callback_url: dto.callbackUrl,
      }),
    });

    const data = (await response.json()) as {
      status: boolean;
      data: {
        authorization_url: string;
        reference: string;
        access_code: string;
      };
    };

    if (!data.status) {
      throw new Error('Paystack payment initialization failed');
    }

    return {
      authorizationUrl: data.data.authorization_url,
      reference: data.data.reference,
      accessCode: data.data.access_code,
    };
  }

  async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
    const response = await fetch(
      `${this.baseUrl}/transaction/verify/${reference}`,
      { headers: this.headers },
    );

    const data = (await response.json()) as {
      status: boolean;
      data: {
        status: string;
        reference: string;
        amount: number;
        currency: string;
        paid_at: string;
        metadata: Record<string, unknown>;
      };
    };

    return {
      status:
        data.data.status === 'success'
          ? 'success'
          : data.data.status === 'pending'
            ? 'pending'
            : 'failed',
      reference: data.data.reference,
      amountKobo: data.data.amount,
      currency: data.data.currency,
      paidAt: data.data.paid_at ? new Date(data.data.paid_at) : undefined,
      metadata: data.data.metadata,
    };
  }

  async cancelSubscription(subscriptionCode: string): Promise<void> {
    await fetch(`${this.baseUrl}/subscription/disable`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ code: subscriptionCode, token: '' }),
    });
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const hash = crypto
      .createHmac('sha512', this.secretKey)
      .update(payload)
      .digest('hex');
    return hash === signature;
  }
}
