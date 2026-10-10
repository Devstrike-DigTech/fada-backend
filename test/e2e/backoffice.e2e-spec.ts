import { api, createTestApp, eventually, TestApp } from '../helpers/app';
import {
  Actor,
  bearer,
  createAdmin,
  createCustomer,
  createDrug,
  createPharmacy,
  PharmacyFixture,
} from '../helpers/fixtures';
import { fakeNetwork } from '../helpers/network';
import { SubscriptionService } from '../../src/modules/subscription/subscription.service';
import { AnalyticsAggregatorService } from '../../src/modules/analytics/analytics-aggregator.service';
import { AdsService } from '../../src/modules/ads/ads.service';

/** Back office, content, analytics, and the billing / ads lifecycle sweeps. */
describe('Back office, content, analytics and lifecycle jobs', () => {
  let t: TestApp;
  let admin: Actor;
  let ph: PharmacyFixture;
  let undo: () => void;

  beforeAll(async () => {
    undo = fakeNetwork('https://api.paystack.co', (url, body) => {
      const b = body as Record<string, unknown>;
      if (url.endsWith('/transaction/initialize'))
        return {
          json: {
            status: true,
            data: {
              authorization_url: 'https://checkout.paystack.com/x',
              reference: b.reference,
            },
          },
        };
      if (url.endsWith('/plan'))
        return { json: { status: true, data: { plan_code: 'PLN_1' } } };
      if (url.endsWith('/subscription'))
        return {
          json: {
            status: true,
            data: { subscription_code: 'SUB_new', email_token: 't' },
          },
        };
      return {
        json: {
          status: true,
          data: { subscription_code: 'SUB_x', email_token: 't' },
        },
      };
    });
    t = await createTestApp();
    admin = await createAdmin(t);
    ph = await createPharmacy(t, { name: 'Analytics Pharmacy' });
  });
  afterAll(async () => {
    undo();
    await t.close();
  });

  it('content pages: public read, admin edit with versioning and validation, reset', async () => {
    const idx = await t.http.get(api('/content')).expect(200);
    expect(idx.body.data).toHaveLength(7);
    for (const slug of [
      'app-info',
      'disclaimer',
      'privacy-policy',
      'credits',
      'future-features',
    ]) {
      await t.http.get(api(`/content/${slug}`)).expect(200);
    }
    await t.http.get(api('/content/pages/contact')).expect(200);
    await t.http.get(api('/support/contact')).expect(200);
    await t.http.get(api('/content/pages/nope')).expect(404);

    const pages = await t.http
      .get(api('/admin/content/pages'))
      .set(bearer(admin))
      .expect(200);
    expect(
      pages.body.data.find((p: { key: string }) => p.key === 'disclaimer')
        .source,
    ).toBe('database');

    await t.http
      .put(api('/admin/content/pages/disclaimer'))
      .set(bearer(admin))
      .send({ content: '{not json', format: 'json' })
      .expect(400);
    const edited = await t.http
      .put(api('/admin/content/pages/disclaimer'))
      .set(bearer(admin))
      .send({
        title: 'Disclaimers',
        content: {
          sections: [
            { title: 'Updated', body: 'New text for testing purposes only.' },
          ],
        },
      })
      .expect(200);
    expect(edited.body.data.version).toBe(2);
    const pub = await t.http.get(api('/content/disclaimer')).expect(200);
    expect(pub.body.data.content.sections[0].title).toBe('Updated'); // cache was invalidated

    await t.http
      .put(api('/admin/content/pages/credits'))
      .set(bearer(admin))
      .send({ format: 'markdown', content: '# Credits\nThanks!' })
      .expect(200);
    const md = await t.http
      .get(api('/admin/content/pages/credits'))
      .set(bearer(admin))
      .expect(200);
    expect(md.body.data.format).toBe('markdown');
    const reset = await t.http
      .post(api('/admin/content/pages/disclaimer/reset'))
      .set(bearer(admin))
      .expect(200);
    expect(reset.body.data.content.sections).toHaveLength(6);
  });

  it('good cause: projects and testimonials with computed stats', async () => {
    const p = await t.http
      .post(api('/admin/content/good-cause/projects'))
      .set(bearer(admin))
      .send({
        title: 'Malaria Free Nsukka',
        description: 'Free testing and treatment.',
        targetAmountNgn: 2000000,
        raisedAmountNgn: 1300000,
        beneficiaries: 420,
        states: ['Enugu', 'Anambra'],
      })
      .expect(201);
    expect(p.body.data.fundedPercent).toBe(65);
    await t.http
      .post(api('/admin/content/good-cause/projects'))
      .set(bearer(admin))
      .send({
        title: 'Bad dates',
        description: 'x',
        startDate: '2026-02-01',
        endDate: '2026-01-01',
      })
      .expect(400);
    const tm = await t.http
      .post(api('/admin/content/good-cause/testimonials'))
      .set(bearer(admin))
      .send({
        authorName: 'Ngozi O.',
        authorLocation: 'Nsukka',
        content: 'My son was treated within an hour.',
        projectId: p.body.data.id,
      })
      .expect(201);

    const overview = await t.http.get(api('/content/good-cause')).expect(200);
    expect(overview.body.data.stats).toMatchObject({
      patientsHelped: 420,
      donatedNgn: 1300000,
      statesReached: 2,
    });
    await t.http
      .get(api(`/content/good-cause/projects/${p.body.data.id}`))
      .expect(200);
    await t.http
      .get(api(`/content/good-cause/testimonials?projectId=${p.body.data.id}`))
      .expect(200);

    await t.http
      .patch(api(`/admin/content/good-cause/projects/${p.body.data.id}`))
      .set(bearer(admin))
      .send({ raisedAmountNgn: 2000000, status: 'completed' })
      .expect(200);
    await t.http
      .patch(api(`/admin/content/good-cause/testimonials/${tm.body.data.id}`))
      .set(bearer(admin))
      .send({ isActive: false })
      .expect(200);
    await t.http
      .get(api('/admin/content/good-cause/projects'))
      .set(bearer(admin))
      .expect(200);
    await t.http
      .get(api('/admin/content/good-cause/testimonials'))
      .set(bearer(admin))
      .expect(200);
    await t.http
      .delete(api(`/admin/content/good-cause/testimonials/${tm.body.data.id}`))
      .set(bearer(admin))
      .expect(200);
    await t.http
      .delete(api(`/admin/content/good-cause/projects/${p.body.data.id}`))
      .set(bearer(admin))
      .expect(200);
  });

  it('back office: dashboard, categories, pharmacists queue, subscriptions, points, broadcast, audit', async () => {
    const dash = await t.http
      .get(api('/admin/dashboard/overview'))
      .set(bearer(admin))
      .expect(200);
    expect(dash.body.data).toHaveProperty('support.openTickets');

    const cat = await t.http
      .post(api('/admin/categories'))
      .set(bearer(admin))
      .send({
        type: 'primary',
        name: 'Travel Health',
        slug: `travel-${Date.now()}`,
      })
      .expect(201);
    await t.http
      .patch(api(`/admin/categories/${cat.body.data.id}`))
      .set(bearer(admin))
      .send({ sortOrder: 99 })
      .expect(200);
    await t.http
      .get(api('/admin/categories?type=primary'))
      .set(bearer(admin))
      .expect(200);
    await t.http
      .delete(api(`/admin/categories/${cat.body.data.id}`))
      .set(bearer(admin))
      .expect(200);
    await t.http
      .get(api('/admin/pharmacists/unverified'))
      .set(bearer(admin))
      .expect(200);

    // subscription rows are created lazily (on registration in real life)
    await t.http
      .get(api(`/admin/subscriptions/${ph.pharmacyId}`))
      .set(bearer(admin))
      .expect(200);
    const subs = await t.http
      .get(api('/admin/subscriptions?search=Analytics'))
      .set(bearer(admin))
      .expect(200);
    expect(subs.body.data.items.length).toBeGreaterThanOrEqual(1);
    await t.http
      .get(api(`/admin/subscriptions/${ph.pharmacyId}`))
      .set(bearer(admin))
      .expect(200);
    await t.http
      .get(api('/admin/subscriptions/revenue'))
      .set(bearer(admin))
      .expect(200);
    await t.http
      .post(api(`/admin/subscriptions/${ph.pharmacyId}/assign-plan`))
      .set(bearer(admin))
      .send({ plan: 'zuko', reason: 'Analytics pilot' })
      .expect(200);
    await t.http
      .post(api(`/admin/subscriptions/${ph.pharmacyId}/extend`))
      .set(bearer(admin))
      .send({ days: 14, reason: 'Outage goodwill' })
      .expect(200);

    const adj = await t.http
      .post(api('/admin/points/adjust'))
      .set(bearer(admin))
      .send({ pharmacyId: ph.pharmacyId, delta: 250, note: 'Launch bonus' })
      .expect(200);
    expect(adj.body.data).toMatchObject({ awarded: true, level: 2 });
    await t.http
      .post(api('/admin/points/adjust'))
      .set(bearer(admin))
      .send({ pharmacyId: ph.pharmacyId, delta: -100000, note: 'too much' })
      .expect(400);

    const c = await createCustomer(t);
    const bc = await t.http
      .post(api('/admin/notifications/broadcast'))
      .set(bearer(admin))
      .send({
        audience: 'users',
        userIds: [c.id],
        title: 'Welcome to FADA',
        body: 'Search any drug near you.',
      })
      .expect(202);
    expect(bc.body.data.estimatedRecipients).toBe(1);
    expect(
      await eventually(() =>
        t.prisma.notificationRecord.findFirst({
          where: { recipientId: c.id, title: 'Welcome to FADA' },
        }),
      ),
    ).toBeTruthy();
    await t.http
      .get(api('/admin/notifications/stats?days=7'))
      .set(bearer(admin))
      .expect(200);

    const audit = await t.http
      .get(api('/admin/dashboard/audit-logs?action=subscription.'))
      .set(bearer(admin))
      .expect(200);
    expect(audit.body.data.items.length).toBeGreaterThanOrEqual(2);
    const customer = await createCustomer(t);
    await t.http
      .get(api('/admin/dashboard/overview'))
      .set(bearer(customer))
      .expect(403);
  });

  it('store analytics for a Zuko pharmacy, snapshots, platform views', async () => {
    const c = await createCustomer(t);
    const drug = await createDrug(t, ph.branchId, {
      name: `Augmentin ${Date.now()}`,
    });
    await t.http
      .get(api(`/search/drugs?q=${encodeURIComponent(drug.name)}`))
      .set(bearer(c))
      .expect(200);
    const r = await t.http
      .post(api('/reservations'))
      .set(bearer(c))
      .send({
        branchId: ph.branchId,
        items: [{ drugId: drug.id, quantity: 1 }],
      })
      .expect(201);
    for (const step of ['confirm', 'ready', 'serve'])
      await t.http
        .patch(api(`/reservations/${r.body.data.id}/${step}`))
        .set(bearer(ph.owner))
        .send({})
        .expect(200);

    const access = await t.http
      .get(api(`/analytics/pharmacy/${ph.pharmacyId}/access`))
      .set(bearer(ph.owner))
      .expect(200);
    expect(access.body.data.hasAnalytics).toBe(true);
    const ov = await t.http
      .get(api(`/analytics/pharmacy/${ph.pharmacyId}/overview?period=7d`))
      .set(bearer(ph.owner))
      .expect(200);
    expect(ov.body.data.totals.reservationsServed).toBeGreaterThanOrEqual(1);
    for (const view of [
      'reservations',
      'inventory',
      'search-appearances',
      'ads',
    ]) {
      await t.http
        .get(api(`/analytics/pharmacy/${ph.pharmacyId}/${view}?period=30d`))
        .set(bearer(ph.owner))
        .expect(200);
    }
    await t.http
      .get(
        api(
          `/analytics/pharmacy/${ph.pharmacyId}/overview?from=2026-10-10&to=2026-01-01`,
        ),
      )
      .set(bearer(ph.owner))
      .expect(400);

    const agg = t.app.get(AnalyticsAggregatorService);
    const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const snap = await agg.snapshotDay(today);
    expect(snap.pharmacies).toBeGreaterThanOrEqual(1);
    await agg.runDaily();

    await t.http
      .get(api('/admin/analytics/platform?period=7d'))
      .set(bearer(admin))
      .expect(200);
    await t.http
      .get(api('/admin/analytics/search-trends?period=7d&searchType=drug'))
      .set(bearer(admin))
      .expect(200);
    const lb = await t.http
      .get(
        api(
          '/admin/analytics/pharmacies/leaderboard?period=7d&metric=reservationsServed',
        ),
      )
      .set(bearer(admin))
      .expect(200);
    expect(lb.body.data.items.length).toBeGreaterThanOrEqual(1);
    await t.http
      .post(api('/admin/analytics/snapshots/rebuild'))
      .set(bearer(admin))
      .send({ from: '2026-10-01', to: '2026-10-03' })
      .expect(202);
  });

  it('billing sweep: ended period → grace → expiry to the free plan; pending downgrade applies', async () => {
    const svc = t.app.get(SubscriptionService);
    const a = await createPharmacy(t);
    await t.http
      .post(api(`/admin/subscriptions/${a.pharmacyId}/assign-plan`))
      .set(bearer(admin))
      .send({ plan: 'katara', reason: 'sweep test' })
      .expect(200);
    const past = new Date(Date.now() - 2 * 86400000);
    await t.prisma.pharmacySubscription.update({
      where: { pharmacyId: a.pharmacyId },
      data: { currentPeriodEnd: past },
    });
    await svc.runBillingSweep();
    let sub = await t.prisma.pharmacySubscription.findUniqueOrThrow({
      where: { pharmacyId: a.pharmacyId },
      include: { plan: true },
    });
    expect(sub.status).toBe('past_due');
    expect(sub.graceUntil).toBeTruthy();

    await t.prisma.pharmacySubscription.update({
      where: { pharmacyId: a.pharmacyId },
      data: { graceUntil: past },
    });
    await svc.runBillingSweep();
    sub = await t.prisma.pharmacySubscription.findUniqueOrThrow({
      where: { pharmacyId: a.pharmacyId },
      include: { plan: true },
    });
    expect(sub.plan.slug).toBe('sokka');
    expect(
      await eventually(() =>
        t.prisma.notificationRecord.findFirst({
          where: { recipientId: a.owner.id, title: { contains: 'has ended' } },
        }),
      ),
    ).toBeTruthy();

    // Downgrade is scheduled, then applied at period end
    const b = await createPharmacy(t);
    await t.http
      .post(api(`/admin/subscriptions/${b.pharmacyId}/assign-plan`))
      .set(bearer(admin))
      .send({ plan: 'zuko', reason: 'x' })
      .expect(200);
    await t.prisma.pharmacySubscription.update({
      where: { pharmacyId: b.pharmacyId },
      data: { lastPlanChangeAt: new Date(Date.now() - 40 * 86400000) },
    });
    const down = await t.http
      .post(api(`/subscriptions/pharmacy/${b.pharmacyId}/upgrade`))
      .set(bearer(b.owner))
      .send({ plan: 'toph' })
      .expect(200);
    expect(down.body.data).toMatchObject({
      requiresPayment: false,
      effectiveImmediately: false,
    });
    await t.prisma.pharmacySubscription.update({
      where: { pharmacyId: b.pharmacyId },
      data: { currentPeriodEnd: past },
    });
    await svc.runBillingSweep();
    const bs = await t.prisma.pharmacySubscription.findUniqueOrThrow({
      where: { pharmacyId: b.pharmacyId },
      include: { plan: true },
    });
    expect(bs.plan.slug).toBe('toph');

    // Plan changes are rate-limited to one per 30 days
    await t.http
      .post(api(`/subscriptions/pharmacy/${b.pharmacyId}/upgrade`))
      .set(bearer(b.owner))
      .send({ plan: 'aang' })
      .expect(409);
  });

  it('ads lifecycle: reject, edit back to review, pause/resume, rating, expiry sweep', async () => {
    const z = await createPharmacy(t);
    await t.http
      .post(api(`/admin/subscriptions/${z.pharmacyId}/assign-plan`))
      .set(bearer(admin))
      .send({ plan: 'aang', reason: 'ads' })
      .expect(200);
    const created = await t.http
      .post(api(`/ads/pharmacy/${z.pharmacyId}/campaigns`))
      .set(bearer(z.owner))
      .send({
        title: 'Free BP check',
        startAt: new Date().toISOString(),
        dailyFrequency: 1,
        weeklyDays: 7,
        durationWeeks: 1,
        promoCode: 'NOPE',
      })
      .expect(201);
    expect(created.body.data.promoRejected).toBe('Unknown promo code');
    const id = created.body.data.id;

    await t.http
      .post(api(`/admin/ads/campaigns/${id}/review`))
      .set(bearer(admin))
      .send({ decision: 'reject' })
      .expect(400); // reason required
    await t.http
      .post(api(`/admin/ads/campaigns/${id}/review`))
      .set(bearer(admin))
      .send({ decision: 'reject', reason: 'Medical claim not allowed' })
      .expect(200);
    await t.http
      .put(api(`/ads/pharmacy/${z.pharmacyId}/campaigns/${id}`))
      .set(bearer(z.owner))
      .send({ title: 'Blood pressure check' })
      .expect(200);
    const back = await t.prisma.adCampaign.findUniqueOrThrow({ where: { id } });
    expect(back.reviewStatus).toBe('pending');

    // mark paid + approve → live, then pause / resume
    await t.prisma.adCampaign.update({
      where: { id },
      data: { paidAt: new Date() },
    });
    await t.http
      .post(api(`/admin/ads/campaigns/${id}/review`))
      .set(bearer(admin))
      .send({ decision: 'approve' })
      .expect(200);
    await t.http
      .patch(api(`/ads/pharmacy/${z.pharmacyId}/campaigns/${id}/status`))
      .set(bearer(z.owner))
      .send({ action: 'pause' })
      .expect(200);
    await t.http
      .patch(api(`/ads/pharmacy/${z.pharmacyId}/campaigns/${id}/status`))
      .set(bearer(z.owner))
      .send({ action: 'resume' })
      .expect(200);
    await t.http.get(api(`/ads/${id}`)).expect(200);

    const c = await createCustomer(t);
    const rate = await t.http
      .post(api(`/ads/${id}/ratings`))
      .set(bearer(c))
      .send({ stars: 4 })
      .expect(200);
    expect(rate.body.data).toMatchObject({ averageRating: 4, ratingCount: 1 });
    await t.http
      .get(api(`/ads/pharmacy/${z.pharmacyId}/campaigns/${id}/analytics`))
      .set(bearer(z.owner))
      .expect(200);
    await t.http
      .get(api(`/ads/pharmacy/${z.pharmacyId}/campaigns`))
      .set(bearer(z.owner))
      .expect(200);
    await t.http.get(api('/admin/ads/overview')).set(bearer(admin)).expect(200);
    await t.http
      .get(api(`/admin/ads/campaigns/${id}`))
      .set(bearer(admin))
      .expect(200);
    await t.http
      .get(api('/admin/ads/campaigns?reviewStatus=approved'))
      .set(bearer(admin))
      .expect(200);

    await t.prisma.adCampaign.update({
      where: { id },
      data: { timeslotEnd: new Date(Date.now() - 1000) },
    });
    await t.app.get(AdsService).runLifecycleSweep();
    expect(
      (await t.prisma.adCampaign.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('expired');

    // an unpaid draft can be deleted outright
    const draft = await t.http
      .post(api(`/ads/pharmacy/${z.pharmacyId}/campaigns`))
      .set(bearer(z.owner))
      .send({
        title: 'Draft',
        startAt: new Date().toISOString(),
        dailyFrequency: 1,
        weeklyDays: 5,
        durationWeeks: 2,
      })
      .expect(201);
    const del = await t.http
      .delete(
        api(`/ads/pharmacy/${z.pharmacyId}/campaigns/${draft.body.data.id}`),
      )
      .set(bearer(z.owner))
      .expect(200);
    expect(del.body.data.deleted).toBe(true);
  });
});
