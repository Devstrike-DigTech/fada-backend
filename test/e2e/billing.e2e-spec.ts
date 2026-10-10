import * as crypto from 'crypto';
import { api, createTestApp, eventually, TestApp } from '../helpers/app';
import {
  bearer,
  createAdmin,
  createPharmacy,
  PharmacyFixture,
} from '../helpers/fixtures';
import { fakeNetwork } from '../helpers/network';

const PAYSTACK = 'https://api.paystack.co';

/**
 * Subscription + payment flow with Paystack faked at the network edge. The
 * webhook path is real: signed raw bodies, idempotent activation, replays.
 */
describe('Billing: subscribe → pay (webhook) → limits, promotions, cancel', () => {
  let t: TestApp;
  let undo: () => void;
  const initialized: { amount: number; reference: string; plan?: string }[] =
    [];
  const disabled: string[] = [];

  beforeAll(async () => {
    undo = fakeNetwork(PAYSTACK, (url, body) => {
      const b = body as Record<string, unknown>;
      if (url.endsWith('/plan'))
        return {
          json: {
            status: true,
            data: { plan_code: `PLN_${b.interval}_${b.amount}` },
          },
        };
      if (url.endsWith('/transaction/initialize')) {
        initialized.push({
          amount: Number(b.amount),
          reference: String(b.reference),
          plan: b.plan as string | undefined,
        });
        return {
          json: {
            status: true,
            data: {
              authorization_url: `https://checkout.paystack.com/${b.reference}`,
              reference: b.reference,
              access_code: 'AC_1',
            },
          },
        };
      }
      const verify = /\/transaction\/verify\/(.+)$/.exec(url);
      if (verify) {
        const ref = decodeURIComponent(verify[1]);
        const init = initialized.find((i) => i.reference === ref);
        return {
          json: {
            status: true,
            data: {
              reference: ref,
              amount: init?.amount ?? 0,
              currency: 'NGN',
              status: 'success',
              paid_at: new Date().toISOString(),
              customer: { customer_code: 'CUS_verify' },
            },
          },
        };
      }
      const sub = /\/subscription\/([^/]+)$/.exec(url);
      if (sub && !url.endsWith('/disable'))
        return {
          json: {
            status: true,
            data: { subscription_code: sub[1], email_token: 'tok' },
          },
        };
      if (url.endsWith('/subscription/disable')) {
        disabled.push(String(b.code));
        return { json: { status: true, data: {} } };
      }
      return {
        status: 404,
        json: { status: false, message: 'unhandled fake' },
      };
    });
    t = await createTestApp();
  });
  afterAll(async () => {
    undo();
    await t.close();
  });

  const webhook = (
    event: unknown,
    secret = process.env.PAYSTACK_SECRET_KEY!,
  ) => {
    const raw = JSON.stringify(event);
    const sig = crypto.createHmac('sha512', secret).update(raw).digest('hex');
    return t.http
      .post(api('/subscriptions/webhook/paystack'))
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sig)
      .send(raw);
  };
  const chargeSuccess = (reference: string, amountKobo: number) => ({
    event: 'charge.success',
    data: {
      reference,
      amount: amountKobo,
      currency: 'NGN',
      status: 'success',
      paid_at: new Date().toISOString(),
      customer: { customer_code: 'CUS_e2e', email: 'owner@test.ng' },
      authorization: { authorization_code: 'AUTH_e2e', reusable: true },
    },
  });

  describe('paid subscription', () => {
    let ph: PharmacyFixture;
    let reference: string;

    beforeAll(async () => {
      ph = await createPharmacy(t);
    });

    it('starts on the free plan', async () => {
      const res = await t.http
        .get(api(`/subscriptions/pharmacy/${ph.pharmacyId}`))
        .set(bearer(ph.owner))
        .expect(200);
      expect(res.body.data.plan.slug).toBe('sokka');
      expect(res.body.data.entitlements.branchLimit).toBe(1);
    });

    it('opens a Paystack checkout for Katara', async () => {
      const res = await t.http
        .post(api(`/subscriptions/pharmacy/${ph.pharmacyId}/subscribe`))
        .set(bearer(ph.owner))
        .send({ plan: 'katara', billingInterval: 'monthly' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        requiresPayment: true,
        amount: 5000,
        provider: 'paystack',
      });
      expect(res.body.data.checkoutUrl).toContain('checkout.paystack.com');
      reference = res.body.data.reference;
      expect(initialized.find((i) => i.reference === reference)).toMatchObject({
        amount: 500000,
        plan: 'PLN_monthly_500000',
      });
    });

    it('rejects webhooks with a bad signature', async () => {
      await webhook(chargeSuccess(reference, 500000), 'not-the-secret').expect(
        401,
      );
      const sub = await t.prisma.pharmacySubscription.findUniqueOrThrow({
        where: { pharmacyId: ph.pharmacyId },
        include: { plan: true },
      });
      expect(sub.plan.slug).toBe('sokka');
    });

    it('activates on a signed charge.success and lifts plan limits', async () => {
      await webhook(chargeSuccess(reference, 500000)).expect(200);
      const sub = await t.prisma.pharmacySubscription.findUniqueOrThrow({
        where: { pharmacyId: ph.pharmacyId },
        include: { plan: true },
      });
      expect(sub.plan.slug).toBe('katara');
      expect(sub.status).toBe('active');
      expect(sub.paystackAuthorizationCode).toBe('AUTH_e2e');

      await t.http
        .post(api(`/pharmacy/${ph.pharmacyId}/branches`))
        .set(bearer(ph.owner))
        .send({ name: 'Independence Layout' })
        .expect(201);
    });

    it('ignores a replayed webhook (idempotent)', async () => {
      const before = await t.prisma.pharmacySubscription.findUniqueOrThrow({
        where: { pharmacyId: ph.pharmacyId },
      });
      await webhook(chargeSuccess(reference, 500000)).expect(200);
      const after = await t.prisma.pharmacySubscription.findUniqueOrThrow({
        where: { pharmacyId: ph.pharmacyId },
      });
      expect(after.currentPeriodEnd.toISOString()).toBe(
        before.currentPeriodEnd.toISOString(),
      );
      expect(
        await t.prisma.billingRecord.count({
          where: { providerReference: reference, status: 'paid' },
        }),
      ).toBe(1);
    });

    it('links the recurring Paystack subscription', async () => {
      await webhook({
        event: 'subscription.create',
        data: {
          subscription_code: 'SUB_e2e',
          email_token: 'tok',
          customer: { customer_code: 'CUS_e2e' },
        },
      }).expect(200);
      const sub = await t.prisma.pharmacySubscription.findUniqueOrThrow({
        where: { pharmacyId: ph.pharmacyId },
      });
      expect(sub.paystackSubscriptionCode).toBe('SUB_e2e');
    });

    it('shows the payment in billing history and notified the owner', async () => {
      const res = await t.http
        .get(api(`/subscriptions/pharmacy/${ph.pharmacyId}/billing-history`))
        .set(bearer(ph.owner))
        .expect(200);
      expect(res.body.data.items[0]).toMatchObject({
        status: 'paid',
        amount: 5000,
        planName: 'Katara',
      });
      const note = await eventually(() =>
        t.prisma.notificationRecord.findFirst({
          where: {
            recipientId: ph.owner.id,
            type: 'in_app',
            category: 'billing',
          },
        }),
      );
      expect(note?.title).toContain('Katara');
    });

    it('cancels auto-renewal but keeps access until period end', async () => {
      const res = await t.http
        .post(api(`/subscriptions/pharmacy/${ph.pharmacyId}/cancel`))
        .set(bearer(ph.owner))
        .send({ reason: 'Testing' })
        .expect(200);
      expect(res.body.data.subscription.autoRenew).toBe(false);
      expect(res.body.data.subscription.plan.slug).toBe('katara');
      expect(disabled).toContain('SUB_e2e');
    });
  });

  describe('promotions from the back office', () => {
    let admin: { token: string };
    beforeAll(async () => {
      admin = await createAdmin(t);
    });

    it('a 100% code activates a plan without touching Paystack', async () => {
      const code = `FREE${Date.now() % 100000}`;
      await t.http
        .post(api('/admin/promotions'))
        .set(bearer(admin))
        .send({
          code,
          name: 'Launch partners',
          discountType: 'percentage',
          discountValue: 100,
          appliesTo: 'subscriptions',
          startsAt: new Date(Date.now() - 60_000).toISOString(),
        })
        .expect(201);
      const ph = await createPharmacy(t);
      const calls = initialized.length;
      const res = await t.http
        .post(api(`/subscriptions/pharmacy/${ph.pharmacyId}/subscribe`))
        .set(bearer(ph.owner))
        .send({ plan: 'zuko', promoCode: code.toLowerCase() })
        .expect(200);
      expect(res.body.data).toMatchObject({
        requiresPayment: false,
        amount: 0,
        discount: 7500,
      });
      expect(initialized.length).toBe(calls);
      const sub = await t.prisma.pharmacySubscription.findUniqueOrThrow({
        where: { pharmacyId: ph.pharmacyId },
        include: { plan: true },
      });
      expect(sub.plan.slug).toBe('zuko');
      expect(
        await t.prisma.promotionRedemption.count({
          where: { pharmacyId: ph.pharmacyId },
        }),
      ).toBe(1);

      // the code is single-use per pharmacy
      const again = await createPharmacy(t);
      const other = await t.http
        .post(api(`/subscriptions/pharmacy/${again.pharmacyId}/subscribe`))
        .set(bearer(again.owner))
        .send({ plan: 'zuko', promoCode: code })
        .expect(200);
      expect(other.body.data.requiresPayment).toBe(false);
    });

    it('a seasonal promotion discounts checkouts automatically', async () => {
      const res = await t.http
        .post(api('/admin/promotions'))
        .set(bearer(admin))
        .send({
          code: `SEASON${Date.now() % 100000}`,
          name: 'Harmattan 20%',
          discountType: 'percentage',
          discountValue: 20,
          appliesTo: 'subscriptions',
          plans: ['toph'],
          autoApply: true,
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .expect(201);
      const ph = await createPharmacy(t);
      const sub = await t.http
        .post(api(`/subscriptions/pharmacy/${ph.pharmacyId}/subscribe`))
        .set(bearer(ph.owner))
        .send({ plan: 'toph' })
        .expect(200);
      expect(sub.body.data).toMatchObject({
        requiresPayment: true,
        listAmount: 2500,
        discount: 500,
        amount: 2000,
      });
      expect(initialized.at(-1)?.amount).toBe(200000);
      // a discounted first charge must not attach the full-price recurring plan
      expect(initialized.at(-1)?.plan).toBeUndefined();

      await t.http
        .delete(api(`/admin/promotions/${res.body.data.id}`))
        .set(bearer(admin))
        .expect(200);
    });

    it('lets the back office comp a plan, with an audit trail', async () => {
      const ph = await createPharmacy(t);
      const adm = await createAdmin(t);
      const res = await t.http
        .post(api(`/admin/subscriptions/${ph.pharmacyId}/assign-plan`))
        .set(bearer(adm))
        .send({ plan: 'aang', reason: 'A-list waiting-list perk' })
        .expect(200);
      expect(res.body.data.plan.slug).toBe('aang');
      const audit = await eventually(() =>
        t.prisma.adminAuditLog.findFirst({
          where: { adminUserId: adm.id, action: 'subscription.assign_plan' },
        }),
      );
      expect(audit?.targetId).toBe(ph.pharmacyId);
    });
  });

  it('verifies a returning checkout via the callback URL', async () => {
    const ph = await createPharmacy(t);
    const start = await t.http
      .post(api(`/subscriptions/pharmacy/${ph.pharmacyId}/subscribe`))
      .set(bearer(ph.owner))
      .send({ plan: 'toph' })
      .expect(200);
    const res = await t.http
      .get(
        api(
          `/subscriptions/payments/callback?reference=${start.body.data.reference}`,
        ),
      )
      .expect(200);
    expect(res.body.status).toBe('paid');
    expect(res.body.subscription.plan.slug).toBe('toph');
  });
});
