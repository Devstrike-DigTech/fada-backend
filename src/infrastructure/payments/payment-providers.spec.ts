import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PaystackService } from './paystack.service';
import { FlutterwaveService } from './flutterwave.service';

const config = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] }) as unknown as ConfigService;

describe('PaystackService webhooks', () => {
  const secret = 'sk_test_abc123';
  const svc = new PaystackService(
    config({ 'payments.paystack.secretKey': secret }),
  );
  const body = JSON.stringify({
    event: 'charge.success',
    data: { reference: 'R1' },
  });
  const sign = (b: string, key = secret) =>
    crypto.createHmac('sha512', key).update(b).digest('hex');

  it('accepts a correct HMAC-SHA512 signature over the raw body', () => {
    expect(svc.verifyWebhookSignature(Buffer.from(body), sign(body))).toBe(
      true,
    );
  });

  it('rejects wrong, missing, or differently-keyed signatures', () => {
    expect(
      svc.verifyWebhookSignature(Buffer.from(body), sign(body, 'other')),
    ).toBe(false);
    expect(svc.verifyWebhookSignature(Buffer.from(body), undefined)).toBe(
      false,
    );
    expect(svc.verifyWebhookSignature(undefined, sign(body))).toBe(false);
    expect(svc.verifyWebhookSignature(Buffer.from(body), 'short')).toBe(false);
    expect(
      svc.verifyWebhookSignature(Buffer.from(body + ' '), sign(body)),
    ).toBe(false);
  });

  it('never verifies when no secret is configured', () => {
    const unset = new PaystackService(config({}));
    expect(
      unset.verifyWebhookSignature(Buffer.from(body), sign(body, '')),
    ).toBe(false);
  });

  it('normalises charge.success', () => {
    const e = svc.parseWebhookEvent({
      event: 'charge.success',
      data: {
        reference: 'FADA-SUB-X',
        amount: 500000,
        currency: 'NGN',
        status: 'success',
        paid_at: '2026-10-10T10:00:00Z',
        customer: { customer_code: 'CUS_1', email: 'o@p.ng' },
        authorization: { authorization_code: 'AUTH_1' },
        plan: { plan_code: 'PLN_1' },
        metadata: '{"pharmacyId":"ph1"}',
      },
    });
    expect(e).toMatchObject({
      type: 'charge.success',
      reference: 'FADA-SUB-X',
      amountKobo: 500000,
      customerCode: 'CUS_1',
      authorizationCode: 'AUTH_1',
      planCode: 'PLN_1',
      metadata: { pharmacyId: 'ph1' },
    });
  });

  it('maps subscription and invoice events', () => {
    expect(
      svc.parseWebhookEvent({
        event: 'subscription.create',
        data: { subscription_code: 'SUB_1', email_token: 't' },
      }).type,
    ).toBe('subscription.create');
    expect(
      svc.parseWebhookEvent({
        event: 'subscription.not_renew',
        data: { subscription_code: 'S' },
      }).type,
    ).toBe('subscription.disable');
    expect(
      svc.parseWebhookEvent({
        event: 'invoice.payment_failed',
        data: { subscription: { subscription_code: 'S' } },
      }).subscriptionCode,
    ).toBe('S');
    expect(
      svc.parseWebhookEvent({ event: 'invoice.update', data: { paid: true } })
        .type,
    ).toBe('invoice.paid');
    expect(
      svc.parseWebhookEvent({ event: 'invoice.update', data: { paid: false } })
        .type,
    ).toBe('ignored');
    expect(
      svc.parseWebhookEvent({ event: 'transfer.success', data: {} }).type,
    ).toBe('ignored');
  });
});

describe('FlutterwaveService webhooks', () => {
  const svc = new FlutterwaveService(
    config({
      'payments.flutterwave.secretKey': 'FLWSECK_TEST',
      'payments.flutterwave.hash': 'my-hash',
    }),
  );

  it('checks the verif-hash header in constant time', () => {
    expect(svc.verifyWebhookSignature(undefined, 'my-hash')).toBe(true);
    expect(svc.verifyWebhookSignature(undefined, 'my-hasH')).toBe(false);
    expect(svc.verifyWebhookSignature(undefined, undefined)).toBe(false);
  });

  it('converts naira to kobo and maps success / failure', () => {
    const ok = svc.parseWebhookEvent({
      event: 'charge.completed',
      data: {
        tx_ref: 'R',
        amount: 2500,
        currency: 'NGN',
        status: 'successful',
        card: { token: 'tok' },
      },
    });
    expect(ok).toMatchObject({
      type: 'charge.success',
      amountKobo: 250000,
      authorizationCode: 'tok',
    });
    const bad = svc.parseWebhookEvent({
      event: 'charge.completed',
      data: {
        tx_ref: 'R',
        amount: 2500,
        currency: 'NGN',
        status: 'failed',
        processor_response: 'Declined',
      },
    });
    expect(bad).toMatchObject({
      type: 'charge.failed',
      failureReason: 'Declined',
    });
  });
});
