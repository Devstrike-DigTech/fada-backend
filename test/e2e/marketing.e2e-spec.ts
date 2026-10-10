import { api, createTestApp, eventually, TestApp } from '../helpers/app';
import { bearer, createAdmin, createPharmacy } from '../helpers/fixtures';
import { EventBusService } from '../../src/infrastructure/events/event-bus.service';
import { EVENTS } from '../../src/common/types/events.types';

/**
 * Field marketing: an admin onboards a marketer, the marketer works a prospect
 * through call → visit, duplicates are caught, the back office sees the funnel,
 * and a prospect that registers on FADA is marked converted automatically.
 */
describe('Marketing: marketer accounts and the prospect pipeline', () => {
  let t: TestApp;
  let admin: Awaited<ReturnType<typeof createAdmin>>;
  let marketerToken: string;
  let marketerId: string;
  let routeId: string;
  let prospectId: string;
  const email = `marketer.${Date.now().toString(36)}@test.ng`;
  const auth = () => ({ Authorization: `Bearer ${marketerToken}` });

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createAdmin(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it('admin creates a marketer who must change the temporary password first', async () => {
    const created = await t.http
      .post(api('/admin/marketing/marketers'))
      .set(bearer(admin))
      .send({
        email,
        firstName: 'Ada',
        lastName: 'Okafor',
        phone: '08021110000',
      })
      .expect(201);
    const { temporaryPassword, id, fadaId } = created.body.data;
    marketerId = id;
    expect(fadaId).toMatch(/^MKT\d{7}$/);
    expect(temporaryPassword).toHaveLength(12);

    // a marketer cannot be created twice with the same email
    await t.http
      .post(api('/admin/marketing/marketers'))
      .set(bearer(admin))
      .send({ email, firstName: 'Ada', lastName: 'Okafor' })
      .expect(409);

    const login = await t.http
      .post(api('/auth/login'))
      .send({ email, password: temporaryPassword })
      .expect(200);
    expect(login.body.data.user).toMatchObject({
      role: 'marketer',
      firstName: 'Ada',
      mustChangePassword: true,
    });
    const firstToken = login.body.data.tokens.accessToken;

    await t.http
      .post(api('/auth/change-password'))
      .set('Authorization', `Bearer ${firstToken}`)
      .send({ currentPassword: temporaryPassword, newPassword: 'Field!Work1' })
      .expect(200);

    const again = await t.http
      .post(api('/auth/login'))
      .send({ email, password: 'Field!Work1' })
      .expect(200);
    expect(again.body.data.user.mustChangePassword).toBe(false);
    marketerToken = again.body.data.tokens.accessToken;

    // marketers see the field app, not the back office
    await t.http.get(api('/admin/marketing/summary')).set(auth()).expect(403);
    const audit = await t.prisma.adminAuditLog.findFirst({
      where: { action: 'marketing.marketer.created', targetId: marketerId },
    });
    expect(audit).not.toBeNull();
  });

  it('seeded Enugu routes are listed; admins can add and retire routes', async () => {
    const routes = await t.http
      .get(api('/marketing/routes'))
      .set(auth())
      .expect(200);
    expect(routes.body.data.length).toBeGreaterThanOrEqual(8);
    expect(routes.body.data.map((r: { name: string }) => r.name)).toContain(
      'Holy Ghost to GRA',
    );
    routeId = routes.body.data[0].id;

    const created = await t.http
      .post(api('/admin/marketing/routes'))
      .set(bearer(admin))
      .send({ name: `Trans Ekulu loop ${Date.now()}` })
      .expect(201);
    await t.http
      .patch(api(`/admin/marketing/routes/${created.body.data.id}`))
      .set(bearer(admin))
      .send({ isActive: false })
      .expect(200);
    const active = await t.http
      .get(api('/marketing/routes'))
      .set(auth())
      .expect(200);
    expect(active.body.data.map((r: { id: string }) => r.id)).not.toContain(
      created.body.data.id,
    );
    // a retired route cannot take new prospects
    await t.http
      .post(api('/marketing/prospects'))
      .set(auth())
      .send({
        name: 'Nowhere Pharmacy',
        phone: '08099990000',
        address: 'Trans Ekulu',
        routeId: created.body.data.id,
      })
      .expect(400);
  });

  it('adds a prospect, blocks a duplicate phone, and edits it', async () => {
    const created = await t.http
      .post(api('/marketing/prospects'))
      .set(auth())
      .send({
        name: 'HealthPlus Ogui',
        phone: '0803 555 0101',
        email: 'Info@HealthPlus.ng',
        address: '12 Ogui Road, Enugu',
        routeId,
        storeType: 'medium',
        latitude: 6.4413,
        longitude: 7.4988,
      })
      .expect(201);
    prospectId = created.body.data.id;
    expect(created.body.data).toMatchObject({
      stage: 'to_call',
      email: 'info@healthplus.ng',
      addedBy: { name: 'Ada Okafor' },
      callCount: 0,
    });

    // same number written differently → 409 pointing at the existing prospect
    const dup = await t.http
      .post(api('/marketing/prospects'))
      .set(auth())
      .send({
        name: 'HealthPlus (again)',
        phone: '+2348035550101',
        address: 'Ogui Road',
        routeId,
      })
      .expect(409);
    expect(dup.body.details).toMatchObject({ existingProspectId: prospectId });

    await t.http
      .post(api('/marketing/prospects'))
      .set(auth())
      .send({ name: 'x', phone: 'abc', address: 'y', routeId })
      .expect(400);

    const edited = await t.http
      .patch(api(`/marketing/prospects/${prospectId}`))
      .set(auth())
      .send({ storeType: 'large', email: '' })
      .expect(200);
    expect(edited.body.data).toMatchObject({ storeType: 'large', email: null });
  });

  it('a logged call moves the prospect to "to visit", a visit to "visited", with history', async () => {
    const toCall = await t.http
      .get(api('/marketing/prospects?stage=to_call&mine=true'))
      .set(auth())
      .expect(200);
    expect(toCall.body.data.items.map((p: { id: string }) => p.id)).toContain(
      prospectId,
    );

    await t.http
      .post(api(`/marketing/prospects/${prospectId}/calls`))
      .set(auth())
      .send({
        response: 'positive',
        comment: 'Owner wants a demo on Thursday.',
      })
      .expect(201);
    const afterCall = await t.http
      .get(api(`/marketing/prospects/${prospectId}`))
      .set(auth())
      .expect(200);
    expect(afterCall.body.data).toMatchObject({
      stage: 'to_visit',
      callCount: 1,
      lastCall: { response: 'positive' },
    });

    // a call cannot be logged in the future
    await t.http
      .post(api(`/marketing/prospects/${prospectId}/calls`))
      .set(auth())
      .send({
        response: 'neutral',
        comment: 'time travel',
        occurredAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(400);

    await t.http
      .post(api(`/marketing/prospects/${prospectId}/visits`))
      .set(auth())
      .send({
        response: 'neutral',
        comment: 'Showed the app; they will discuss with the partner.',
        latitude: 6.4414,
        longitude: 7.4989,
      })
      .expect(201);
    const visited = await t.http
      .get(api(`/marketing/prospects/${prospectId}`))
      .set(auth())
      .expect(200);
    expect(visited.body.data).toMatchObject({
      stage: 'visited',
      visitCount: 1,
      lastVisit: { response: 'neutral' },
    });
    expect(visited.body.data.interactions).toHaveLength(2);
    expect(visited.body.data.interactions[0]).toMatchObject({
      type: 'visit',
      marketer: { name: 'Ada Okafor' },
    });

    const summary = await t.http
      .get(api('/marketing/summary'))
      .set(auth())
      .expect(200);
    expect(summary.body.data.mine).toMatchObject({
      added: 1,
      callsToday: 1,
      visitsToday: 1,
    });
    expect(summary.body.data.pipeline.visited).toBeGreaterThanOrEqual(1);
  });

  it('a prospect that registers on FADA is marked converted by the listener', async () => {
    const pharmacy = await createPharmacy(t, { name: 'HealthPlus Ogui' });
    await t.prisma.pharmacy.update({
      where: { id: pharmacy.pharmacyId },
      data: { phone: '+234 803 555 0101' },
    });
    t.app.get(EventBusService).emit(EVENTS.PHARMACY.REGISTERED, {
      pharmacyId: pharmacy.pharmacyId,
      pharmacistId: pharmacy.owner.id,
      pharmacyName: 'HealthPlus Ogui',
      registeredAt: new Date(),
    });
    const converted = await eventually(() =>
      t.prisma.pharmacyProspect.findFirst({
        where: { id: prospectId, convertedPharmacyId: pharmacy.pharmacyId },
      }),
    );
    expect(converted?.convertedAt).not.toBeNull();

    const adminView = await t.http
      .get(api('/admin/marketing/prospects?converted=true'))
      .set(bearer(admin))
      .expect(200);
    expect(adminView.body.data.items[0]).toMatchObject({
      id: prospectId,
      convertedPharmacy: { id: pharmacy.pharmacyId },
    });
  });

  it('back office: funnel summary, remove/restore, deactivation locks the marketer out', async () => {
    const summary = await t.http
      .get(api('/admin/marketing/summary'))
      .set(bearer(admin))
      .expect(200);
    expect(summary.body.data.activity).toMatchObject({
      prospectsAdded: 1,
      calls: 1,
      visits: 1,
      conversions: 1,
      callResponses: { positive: 1, neutral: 0, negative: 0 },
    });
    const me = summary.body.data.byMarketer.find(
      (m: { marketer: { id: string } }) => m.marketer.id === marketerId,
    );
    expect(me).toMatchObject({ added: 1, calls: 1, visits: 1, conversions: 1 });
    const route = summary.body.data.byRoute.find(
      (r: { route: { id: string } }) => r.route.id === routeId,
    );
    expect(route.visited).toBeGreaterThanOrEqual(1);

    await t.http
      .delete(api(`/marketing/prospects/${prospectId}`))
      .set(auth())
      .expect(200);
    await t.http
      .get(api(`/marketing/prospects/${prospectId}`))
      .set(auth())
      .expect(404);
    // the number is free again while removed
    const re = await t.http
      .post(api('/marketing/prospects'))
      .set(auth())
      .send({
        name: 'HealthPlus v2',
        phone: '08035550101',
        address: 'Ogui',
        routeId,
      })
      .expect(201);
    // …so restoring the original is refused until the clash is resolved
    await t.http
      .post(api(`/admin/marketing/prospects/${prospectId}/restore`))
      .set(bearer(admin))
      .expect(409);
    await t.http
      .delete(api(`/marketing/prospects/${re.body.data.id}`))
      .set(auth());
    const restored = await t.http
      .post(api(`/admin/marketing/prospects/${prospectId}/restore`))
      .set(bearer(admin))
      .expect(201);
    expect(restored.body.data.deletedAt).toBeNull();

    const list = await t.http
      .get(api('/admin/marketing/marketers'))
      .set(bearer(admin))
      .expect(200);
    expect(
      list.body.data.items.find((m: { id: string }) => m.id === marketerId),
    ).toMatchObject({ prospectsAdded: 1, isActive: true });

    await t.http
      .post(api(`/admin/marketing/marketers/${marketerId}/deactivate`))
      .set(bearer(admin))
      .expect(201);
    await t.http.get(api('/marketing/summary')).set(auth()).expect(401);
    await t.http
      .post(api('/auth/login'))
      .send({ email, password: 'Field!Work1' })
      .expect(403);

    await t.http
      .post(api(`/admin/marketing/marketers/${marketerId}/activate`))
      .set(bearer(admin))
      .expect(201);
    const reset = await t.http
      .post(api(`/admin/marketing/marketers/${marketerId}/reset-password`))
      .set(bearer(admin))
      .expect(201);
    const relogin = await t.http
      .post(api('/auth/login'))
      .send({ email, password: reset.body.data.temporaryPassword })
      .expect(200);
    expect(relogin.body.data.user.mustChangePassword).toBe(true);
  });
});
