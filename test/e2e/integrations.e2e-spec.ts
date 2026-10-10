import * as crypto from 'crypto';
import { api, createTestApp, eventually, TestApp } from '../helpers/app';
import {
  bearer,
  createAdmin,
  createCustomer,
  createDrug,
  createPharmacy,
} from '../helpers/fixtures';
import { fakeNetwork } from '../helpers/network';

/**
 * Event-bus integration: one module acts, others react (notifications, points,
 * analytics, ads activation). Each test asserts the downstream side effects.
 */
describe('Integrations across modules (event listeners)', () => {
  let t: TestApp;
  let undo: () => void;

  beforeAll(async () => {
    undo = fakeNetwork('https://api.paystack.co', (url, body) => {
      const b = body as Record<string, unknown>;
      if (url.endsWith('/transaction/initialize')) {
        return {
          json: {
            status: true,
            data: {
              authorization_url: 'https://checkout.paystack.com/x',
              reference: b.reference,
              access_code: 'AC',
            },
          },
        };
      }
      if (url.endsWith('/plan'))
        return { json: { status: true, data: { plan_code: 'PLN_x' } } };
      return { status: 404, json: { status: false } };
    });
    t = await createTestApp();
  });
  afterAll(async () => {
    undo();
    await t.close();
  });

  it('support: ticket receipt, staff reply, resolution email through the queue', async () => {
    const c = await createCustomer(t);
    const admin = await createAdmin(t);
    const created = await t.http
      .post(api('/support/complaints'))
      .set(bearer(c))
      .send({
        category: 'wrong_drug_dispensed',
        subject: 'Got the wrong strength',
        description: 'I asked for 500mg and got 250mg at the counter today.',
      })
      .expect(201);
    const ticket = created.body.data;
    expect(ticket).toMatchObject({ priority: 'urgent', status: 'pending' });
    expect(ticket.ticketNumber).toMatch(/^TKT-[A-Z0-9]{6}$/);

    expect(
      await eventually(() =>
        t.prisma.notificationRecord.findFirst({
          where: {
            recipientId: c.id,
            title: { startsWith: 'We got your message' },
          },
        }),
      ),
    ).toBeTruthy();

    await t.http
      .post(api(`/admin/support/tickets/${ticket.id}/messages`))
      .set(bearer(admin))
      .send({ body: 'Internal: call the pharmacy', internal: true })
      .expect(201);
    await t.http
      .post(api(`/admin/support/tickets/${ticket.id}/messages`))
      .set(bearer(admin))
      .send({ body: 'We have contacted the pharmacy.' })
      .expect(201);
    const mine = await t.http
      .get(api(`/support/complaints/${ticket.id}`))
      .set(bearer(c))
      .expect(200);
    expect(mine.body.data.messages).toHaveLength(1); // internal note hidden
    expect(mine.body.data.status).toBe('in_review');

    await t.http
      .patch(api(`/admin/support/tickets/${ticket.id}`))
      .set(bearer(admin))
      .send({
        status: 'resolved',
        resolutionNote: 'Pharmacy exchanged the drug.',
      })
      .expect(200);
    // email channel is queued, then skipped by the worker because Resend is not configured in tests
    const email = await eventually(() =>
      t.prisma.notificationRecord.findFirst({
        where: {
          recipientId: c.id,
          type: 'email',
          status: { in: ['skipped', 'sent'] },
        },
      }),
    );
    expect(email).toMatchObject({
      status: 'skipped',
      error: 'resend_not_configured',
    });

    // a follow-up reopens it
    const reply = await t.http
      .post(api(`/support/complaints/${ticket.id}/messages`))
      .set(bearer(c))
      .send({ body: 'Still the wrong one.' })
      .expect(201);
    expect(reply.body.data).toMatchObject({
      reopened: true,
      status: 'pending',
    });
  });

  it('customer profile completion awards +20 points once', async () => {
    const c = await createCustomer(t);
    await t.prisma.user.update({
      where: { id: c.id },
      data: { avatarUrl: 'https://img/x.png', phone: `070${Date.now() % 1e8}` },
    });
    const res = await t.http
      .put(api('/customer/profile'))
      .set(bearer(c))
      .send({ gender: 'female', dateOfBirth: '1994-05-01' })
      .expect(200);
    expect(res.body.data.completion.isComplete).toBe(true);
    await t.http
      .put(api('/customer/profile'))
      .set(bearer(c))
      .send({ firstName: 'Ada' })
      .expect(200);
    const tx = await eventually(() =>
      t.prisma.pointsTransaction
        .findMany({
          where: { reason: 'profile_completed', ledger: { userId: c.id } },
        })
        .then((r) => (r.length ? r : null)),
    );
    expect(tx).toHaveLength(1);
    expect(tx![0].delta).toBe(20);
  });

  it('rejects under-18 dates of birth (terms §3)', async () => {
    const c = await createCustomer(t);
    const young = new Date(Date.now() - 16 * 365.25 * 86400000)
      .toISOString()
      .slice(0, 10);
    await t.http
      .put(api('/customer/profile'))
      .set(bearer(c))
      .send({ dateOfBirth: young })
      .expect(400);
  });

  it('notification preferences: muted categories skip push but keep in-app history', async () => {
    const c = await createCustomer(t);
    await t.http
      .put(api('/notifications/preferences'))
      .set(bearer(c))
      .send({ mutedCategories: ['reservation'] })
      .expect(200);
    await t.http
      .put(api('/notifications/preferences'))
      .set(bearer(c))
      .send({ mutedCategories: ['billing'] })
      .expect(400);

    const ph = await createPharmacy(t);
    const drug = await createDrug(t, ph.branchId);
    const r = await t.http
      .post(api('/reservations'))
      .set(bearer(c))
      .send({
        branchId: ph.branchId,
        items: [{ drugId: drug.id, quantity: 1 }],
      })
      .expect(201);
    await t.http
      .patch(api(`/reservations/${r.body.data.id}/confirm`))
      .set(bearer(ph.owner))
      .send({})
      .expect(200);

    const push = await eventually(() =>
      t.prisma.notificationRecord.findFirst({
        where: { recipientId: c.id, type: 'push' },
      }),
    );
    expect(push).toMatchObject({ status: 'skipped', error: 'category_muted' });
    const inApp = await t.prisma.notificationRecord.findFirst({
      where: { recipientId: c.id, type: 'in_app' },
    });
    expect(inApp?.title).toBe('Reservation confirmed');
    const count = await t.http
      .get(api('/notifications/unread-count'))
      .set(bearer(c))
      .expect(200);
    expect(count.body.data.unreadCount).toBeGreaterThanOrEqual(1);
  });

  it('ads: Zuko pharmacy creates, pays, gets approved, goes live, is served and rewarded', async () => {
    const ph = await createPharmacy(t);
    const admin = await createAdmin(t);
    await t.http
      .post(api(`/admin/subscriptions/${ph.pharmacyId}/assign-plan`))
      .set(bearer(admin))
      .send({ plan: 'zuko', reason: 'ads test' })
      .expect(200);
    const drug = await createDrug(t, ph.branchId, {
      name: `Amatem${Date.now()}`,
    });

    const quote = await t.http
      .post(api(`/ads/pharmacy/${ph.pharmacyId}/campaigns/quote`))
      .set(bearer(ph.owner))
      .send({ dailyFrequency: 2, weeklyDays: 7, durationWeeks: 1 })
      .expect(200);
    expect(quote.body.data.breakdown).toMatchObject({
      listPriceNgn: 3500,
      planDiscountPct: 30,
      finalPriceNgn: 2450,
    });

    const created = await t.http
      .post(api(`/ads/pharmacy/${ph.pharmacyId}/campaigns`))
      .set(bearer(ph.owner))
      .send({
        title: 'Malaria season offer',
        drugId: drug.id,
        startAt: new Date().toISOString(),
        dailyFrequency: 2,
        weeklyDays: 7,
        durationWeeks: 1,
        targetRadiusKm: 20,
      })
      .expect(201);
    const campaignId = created.body.data.id;

    const checkout = await t.http
      .post(
        api(`/ads/pharmacy/${ph.pharmacyId}/campaigns/${campaignId}/checkout`),
      )
      .set(bearer(ph.owner))
      .send({})
      .expect(200);
    const raw = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: checkout.body.data.reference,
        amount: 245000,
        currency: 'NGN',
        status: 'success',
        paid_at: new Date().toISOString(),
      },
    });
    const sig = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(raw)
      .digest('hex');
    await t.http
      .post(api('/subscriptions/webhook/paystack'))
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sig)
      .send(raw)
      .expect(200);
    expect(
      await eventually(() =>
        t.prisma.adCampaign.findFirst({
          where: { id: campaignId, paidAt: { not: null } },
        }),
      ),
    ).toBeTruthy();

    await t.http
      .post(api(`/admin/ads/campaigns/${campaignId}/review`))
      .set(bearer(admin))
      .send({ decision: 'approve' })
      .expect(200);
    const live = await eventually(() =>
      t.prisma.adCampaign.findFirst({
        where: { id: campaignId, status: 'active' },
      }),
    );
    expect(live).toBeTruthy();

    const viewer = await createCustomer(t);
    const feed = await t.http
      .get(api('/ads/feed?latitude=6.45&longitude=7.51'))
      .set(bearer(viewer))
      .expect(200);
    expect(feed.body.data.items.map((i: { id: string }) => i.id)).toContain(
      campaignId,
    );

    await t.http
      .post(api('/ads/impressions'))
      .set(bearer(viewer))
      .send({ campaignIds: [campaignId] })
      .expect(200);
    await t.http
      .post(api('/ads/clicks'))
      .set(bearer(viewer))
      .send({ campaignId })
      .expect(200);
    const after = await t.prisma.adCampaign.findUniqueOrThrow({
      where: { id: campaignId },
    });
    expect([after.impressionsCount, after.clicksCount]).toEqual([1, 1]);

    const pts = await eventually(() =>
      t.prisma.pointsTransaction.findFirst({
        where: { reason: 'ad_launched', referenceId: campaignId },
      }),
    );
    expect(pts?.delta).toBe(15);
  });

  it('analytics: searches are counted for appearances and trends', async () => {
    const ph = await createPharmacy(t);
    const name = `Lonart${Date.now()}`;
    await createDrug(t, ph.branchId, { name });
    const c = await createCustomer(t);
    await t.http
      .get(api(`/search/drugs?q=${name}`))
      .set(bearer(c))
      .expect(200);
    await t.http
      .get(api(`/search/drugs?q=zzznotadrug${Date.now()}`))
      .set(bearer(c))
      .expect(200);

    const day = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const appear = await eventually(() =>
      t.redis.hget(`an:appear:${day}`, ph.pharmacyId),
    );
    expect(Number(appear)).toBe(1);

    const admin = await createAdmin(t);
    const trends = await t.http
      .get(api('/admin/analytics/search-trends?period=7d'))
      .set(bearer(admin))
      .expect(200);
    expect(
      trends.body.data.zeroResultSearches.some((q: { query: string }) =>
        q.query.startsWith('zzznotadrug'),
      ),
    ).toBe(true);
  });
});
