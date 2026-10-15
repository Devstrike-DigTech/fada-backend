import { api, createTestApp, eventually, TestApp } from '../helpers/app';
import {
  bearer,
  createAdmin,
  createCustomer,
  tokenFor,
} from '../helpers/fixtures';
import { fakeNetwork } from '../helpers/network';

const PASSWORD = 'Str0ng!Pass';

/**
 * The core journey: a pharmacist signs up and is verified (PCN + CAC through
 * the real event flow), stocks a drug, a customer finds it and reserves it,
 * the pharmacist fulfils it. Points, notifications and plan limits follow.
 */
describe('Marketplace: onboarding → verification → search → reservation', () => {
  let t: TestApp;
  let undoPcn: () => void;
  const unique = `Paracetamol${Date.now()}`;

  const s: {
    ownerId?: string;
    ownerToken?: string;
    pharmacyId?: string;
    branchId?: string;
    drugId?: string;
    reservationId?: string;
    customer?: { id: string; token: string };
  } = {};

  beforeAll(async () => {
    // The PCN registry is a public website; here it never finds the licence,
    // so verification has to come from an admin override.
    undoPcn = fakeNetwork('https://pcncore.azurewebsites.net', () => ({
      status: 200,
      json: [],
    }));
    t = await createTestApp();
  });
  afterAll(async () => {
    undoPcn();
    await t.close();
  });

  it('onboards a pharmacist and creates a pharmacy (CAC checked automatically)', async () => {
    const email = `owner.${Date.now()}@test.ng`;
    await t.http
      .post(api('/auth/register/pharmacist'))
      .send({
        firstName: 'Ifeoma',
        lastName: 'Agu',
        email,
        phone: `081${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        password: PASSWORD,
        licenseType: 'PHARMACIST',
        licenseNumber: `PCN-${Date.now()}`,
      })
      .expect(201);
    const otp = await t.redis.get(`auth:otp:${email}`);
    const verified = await t.http
      .post(api('/auth/verify-email'))
      .send({ email, otp })
      .expect(200);
    s.ownerId = verified.body.data.user.id;
    s.ownerToken = verified.body.data.tokens.accessToken;

    const created = await t.http
      .post(api('/pharmacy'))
      .set('Authorization', `Bearer ${s.ownerToken}`)
      .send({
        name: 'Ogui Road Pharmacy',
        cacNumber: `RC${Date.now() % 1_000_000}`,
        state: 'Enugu',
        city: 'Enugu',
        address: '12 Ogui Road',
        phone: '08031234567',
        latitude: 6.4402,
        longitude: 7.4943,
      })
      .expect(201);
    s.pharmacyId = created.body.data.id;
    s.branchId = created.body.data.branches[0].id;

    // CAC lookup runs in the queue (mock registry in tests) → cacVerified
    const p = await eventually(() =>
      t.prisma.pharmacy.findFirst({
        where: { id: s.pharmacyId, cacVerified: true },
      }),
    );
    expect(p?.cacVerified).toBe(true);
  });

  it('keeps an unverified pharmacy out of search and reservations', async () => {
    const p = await t.prisma.pharmacy.findUniqueOrThrow({
      where: { id: s.pharmacyId },
    });
    expect(p.isVerified).toBe(false); // PCN not verified yet

    // The owner sees what is still outstanding
    const mine = await t.http
      .get(api('/pharmacy/me/verification'))
      .set('Authorization', `Bearer ${s.ownerToken}`)
      .expect(200);
    expect(mine.body.data).toMatchObject({
      isVerified: false,
      missing: ['owner_pcn_licence'],
      pcn: { verified: false, licenseType: 'PHARMACIST' },
      cac: { verified: true },
    });
  });

  it('becomes verified when an admin confirms the PCN licence, and the owner is told', async () => {
    const admin = await createAdmin(t);
    // The faked registry has no match, so an automatic retry finds nothing
    const retry = await t.http
      .post(api(`/admin/pharmacists/${s.ownerId}/retry-pcn`))
      .set(bearer(admin))
      .expect(200);
    expect(retry.body.data.found).toBe(false);
    const retried = await t.prisma.adminAuditLog.findFirst({
      where: {
        action: 'pharmacist.pcn.retried',
        adminUserId: admin.id,
        targetId: s.ownerId,
      },
    });
    expect(retried?.details).toEqual({ found: false });

    await t.http
      .post(api(`/admin/pharmacists/${s.ownerId}/verify-pcn`))
      .set(bearer(admin))
      .send({ note: 'Licence checked by phone with PCN Enugu office' })
      .expect(200);
    const verified = await t.prisma.adminAuditLog.findFirst({
      where: {
        action: 'pharmacist.pcn.verified',
        adminUserId: admin.id,
        targetId: s.ownerId,
      },
    });
    expect(verified?.details).toEqual({
      source: 'manual',
      note: 'Licence checked by phone with PCN Enugu office',
    });

    const p = await eventually(() =>
      t.prisma.pharmacy.findFirst({
        where: { id: s.pharmacyId, isVerified: true },
      }),
    );
    expect(p?.isVerified).toBe(true);
    const note = await eventually(() =>
      t.prisma.notificationRecord.findFirst({
        where: {
          recipientId: s.ownerId,
          type: 'in_app',
          title: 'Your pharmacy is verified',
        },
      }),
    );
    expect(note).toBeTruthy();

    const status = await t.http
      .get(api(`/admin/pharmacies/${s.pharmacyId}/verification`))
      .set(bearer(admin))
      .expect(200);
    expect(status.body.data).toMatchObject({ isVerified: true, missing: [] });
    const mine = await t.http
      .get(api('/pharmacy/me/verification'))
      .set('Authorization', `Bearer ${s.ownerToken}`)
      .expect(200);
    expect(mine.body.data).toMatchObject({
      isVerified: true,
      missing: [],
      pcn: { verified: true },
    });
  });

  it('lets the pharmacist stock a drug (and earn +5 points)', async () => {
    const res = await t.http
      .post(api(`/inventory/branch/${s.branchId}/drugs`))
      .set('Authorization', `Bearer ${s.ownerToken}`)
      .send({ name: unique, drugType: 'oral', price: 800, stockAmount: 30 })
      .expect(201);
    s.drugId = res.body.data.id;
    const tx = await eventually(() =>
      t.prisma.pointsTransaction.findFirst({
        where: { reason: 'drug_added', referenceId: s.drugId },
      }),
    );
    expect(tx?.delta).toBe(5);
  });

  it('enforces the free plan’s single branch', async () => {
    await t.http
      .post(api(`/pharmacy/${s.pharmacyId}/branches`))
      .set('Authorization', `Bearer ${s.ownerToken}`)
      .send({ name: 'Second branch' })
      .expect(403);
  });

  it('lets a customer find the drug by name', async () => {
    const c = await createCustomer(t);
    s.customer = { id: c.id, token: c.token };
    const res = await t.http
      .get(api(`/search/drugs?q=${encodeURIComponent(unique.toLowerCase())}`))
      .set(bearer(c))
      .expect(200);
    const hit = res.body.data.find(
      (d: { drug: { id: string } }) => d.drug.id === s.drugId,
    );
    expect(hit?.pharmacy.id).toBe(s.pharmacyId);

    // the mobile apps always search with coordinates (geo SQL path)
    const near = await t.http
      .get(
        api(
          `/search/drugs?q=${encodeURIComponent(unique)}&latitude=6.44&longitude=7.49&radiusKm=5`,
        ),
      )
      .set(bearer(c))
      .expect(200);
    expect(near.body.data[0]?.pharmacy.id).toBe(s.pharmacyId);
    expect(near.body.data[0]?.branch.distanceKm).toBeLessThan(5);

    // search history + analytics counters are written by event listeners
    expect(
      await eventually(() =>
        t.prisma.customerSearchHistory.findFirst({
          where: { customerId: c.id },
        }),
      ),
    ).toBeTruthy();
  });

  it('reserves, and the pharmacy confirms → ready → serves', async () => {
    const created = await t.http
      .post(api('/reservations'))
      .set('Authorization', `Bearer ${s.customer!.token}`)
      .send({
        branchId: s.branchId,
        items: [{ drugId: s.drugId, quantity: 2 }],
      })
      .expect(201);
    s.reservationId = created.body.data.id;
    expect(created.body.data.status).toBe('pending');
    expect(created.body.data.alphanumericCode).toMatch(/^RSV/);

    const owner = { token: s.ownerToken! };
    for (const [step, status] of [
      ['confirm', 'confirmed'],
      ['ready', 'ready'],
      ['serve', 'served'],
    ] as const) {
      const r = await t.http
        .patch(api(`/reservations/${s.reservationId}/${step}`))
        .set(bearer(owner))
        .send({})
        .expect(200);
      expect(r.body.data.status).toBe(status);
    }

    const drug = await t.prisma.drug.findUniqueOrThrow({
      where: { id: s.drugId },
    });
    expect(drug.stockAmount).toBe(28);
  });

  it('rewards both sides and notifies the customer at each step', async () => {
    const custTx = await eventually(() =>
      t.prisma.pointsTransaction.findFirst({
        where: {
          reason: 'reservation_completed',
          referenceId: s.reservationId,
          ledger: { userId: s.customer!.id },
        },
      }),
    );
    expect(custTx?.delta).toBe(10);
    const phTx = await eventually(() =>
      t.prisma.pointsTransaction.findFirst({
        where: {
          reason: 'reservation_completed',
          referenceId: s.reservationId,
          ledger: { pharmacyId: s.pharmacyId },
        },
      }),
    );
    expect(phTx?.delta).toBe(20);

    const titles = await eventually(async () => {
      const rows = await t.prisma.notificationRecord.findMany({
        where: {
          recipientId: s.customer!.id,
          type: 'in_app',
          category: 'reservation',
        },
        select: { title: true },
      });
      return rows.length >= 3 ? rows.map((r) => r.title) : null;
    });
    expect(titles).toEqual(
      expect.arrayContaining([
        'Reservation confirmed',
        'Ready for pickup',
        'Reservation collected',
      ]),
    );
  });

  it('stops other pharmacies and other customers from touching the reservation', async () => {
    const stranger = await createCustomer(t);
    await t.http
      .get(api(`/reservations/${s.reservationId}`))
      .set(bearer(stranger))
      .expect((r) => expect([403, 404]).toContain(r.status));
    const otherOwner = await t.prisma.user.create({
      data: {
        fadaId: `PHMX${Date.now()}`.slice(0, 20),
        email: `x.${Date.now()}@test.ng`,
        role: 'pharmacist',
        isActive: true,
      },
    });
    await t.http
      .patch(api(`/reservations/${s.reservationId}/cancel-pharmacy`))
      .set('Authorization', `Bearer ${tokenFor(t, otherOwner)}`)
      .send({ reason: 'nope' })
      .expect((r) => expect([403, 404]).toContain(r.status));
  });

  it('keeps store analytics behind the Zuko / Aang plans', async () => {
    const access = await t.http
      .get(api(`/analytics/pharmacy/${s.pharmacyId}/access`))
      .set('Authorization', `Bearer ${s.ownerToken}`)
      .expect(200);
    expect(access.body.data.hasAnalytics).toBe(false);
    await t.http
      .get(api(`/analytics/pharmacy/${s.pharmacyId}/overview`))
      .set('Authorization', `Bearer ${s.ownerToken}`)
      .expect(403);
  });
});
