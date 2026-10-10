import { getQueueToken } from '@nestjs/bull';
import { Queue } from 'bull';
import { api, createTestApp, eventually, TestApp } from '../helpers/app';
import {
  bearer,
  createAdmin,
  createCustomer,
  createPharmacy,
  PharmacyFixture,
} from '../helpers/fixtures';
import { fakeNetwork } from '../helpers/network';

/** Pharmacy operations: profile, hours, staff, inventory, stock events, CSV upload. */
describe('Pharmacy operations and inventory', () => {
  let t: TestApp;
  let ph: PharmacyFixture;
  let undoFile: () => void;
  const csv =
    'name,price,stock_amount,drug_type,expiry_date\n' +
    `Ciprotab ${Date.now()},1200,40,oral,2027-01-31\n` +
    'Missing Price,,10,oral,\n' +
    `Ampiclox ${Date.now()},900,0,oral,\n`;

  beforeAll(async () => {
    undoFile = fakeNetwork('https://files.test/', () => ({
      status: 404,
      json: { message: 'not found' },
    }));
    // Serve the CSV as text, not JSON
    (globalThis as unknown as { __fakeNetwork: unknown[] }).__fakeNetwork.push({
      match: (u: string) => u === 'https://files.test/drugs.csv',
      respond: () =>
        new Response(csv, {
          status: 200,
          headers: { 'Content-Type': 'text/csv' },
        }),
    });
    t = await createTestApp();
    ph = await createPharmacy(t, { name: 'New Haven Pharmacy' });
  });
  afterAll(async () => {
    undoFile();
    await t.close();
  });

  it('updates profile and working hours; profile completion pays +30 once complete', async () => {
    await t.http
      .patch(api(`/pharmacy/${ph.pharmacyId}`))
      .set(bearer(ph.owner))
      .send({
        description: 'Open late, cold chain for insulin',
        email: 'hello@newhaven.ng',
        phone: '08030000000',
        address: '4 Chime Ave',
      })
      .expect(200);
    await t.http
      .post(api(`/pharmacy/${ph.pharmacyId}/branches/${ph.branchId}/hours`))
      .set(bearer(ph.owner))
      .send({
        hours: [
          {
            dayOfWeek: 'monday',
            isClosed: false,
            openTime: '08:00',
            closeTime: '21:00',
          },
          { dayOfWeek: 'sunday', isClosed: true },
        ],
      })
      .expect((r) => expect([200, 201]).toContain(r.status));
    await t.prisma.pharmacyImage.create({
      data: {
        pharmacyId: ph.pharmacyId,
        url: 'https://img/p.png',
        isPrimary: true,
      },
    });
    await t.http
      .patch(api(`/pharmacy/${ph.pharmacyId}`))
      .set(bearer(ph.owner))
      .send({ landmark: 'Opposite the stadium' })
      .expect(200);
    const tx = await eventually(() =>
      t.prisma.pointsTransaction.findFirst({
        where: {
          reason: 'profile_completed',
          ledger: { pharmacyId: ph.pharmacyId },
        },
      }),
    );
    expect(tx?.delta).toBe(30);

    const pub = await t.http.get(api(`/pharmacy/${ph.pharmacyId}`)).expect(200);
    expect(pub.body.data.name).toBe('New Haven Pharmacy');
    const me = await t.http
      .get(api('/pharmacy/me'))
      .set(bearer(ph.owner))
      .expect(200);
    expect(me.body.data.id).toBe(ph.pharmacyId);
  });

  it('invites staff and lists pending invites', async () => {
    const inv = await t.http
      .post(api(`/pharmacy/${ph.pharmacyId}/staff/invite`))
      .set(bearer(ph.owner))
      .send({
        firstName: 'Kelechi',
        lastName: 'Ani',
        email: `staff.${Date.now()}@test.ng`,
        role: 'staff',
        branchId: ph.branchId,
      })
      .expect(200);
    expect(inv.body.data).toBeTruthy();
    const pending = await t.http
      .get(api(`/pharmacy/${ph.pharmacyId}/staff/invites`))
      .set(bearer(ph.owner))
      .expect(200);
    expect(pending.body.data.length).toBeGreaterThanOrEqual(1);
    await t.http
      .get(api(`/pharmacy/${ph.pharmacyId}/staff`))
      .set(bearer(ph.owner))
      .expect(200);
    const stranger = await createCustomer(t);
    await t.http
      .get(api(`/pharmacy/${ph.pharmacyId}/staff`))
      .set(bearer(stranger))
      .expect(403);
  });

  it('manages drugs: add with NAFDAC enrichment, update, stock, alternatives, delete', async () => {
    const cats = await t.http.get(api('/inventory/categories')).expect(200);
    const primary = cats.body.data.primary.find(
      (x: { type: string }) => x.type === 'primary',
    );

    const nafdac = await t.http
      .get(api('/inventory/nafdac?nafdacNumber=A4-100019'))
      .set(bearer(ph.owner));
    expect([200, 404]).toContain(nafdac.status);

    const a = await t.http
      .post(api(`/inventory/branch/${ph.branchId}/drugs`))
      .set(bearer(ph.owner))
      .send({
        name: `Panadol Extra ${Date.now()}`,
        drugType: 'oral',
        price: 500,
        stockAmount: 12,
        lowStockThreshold: 5,
        primaryCategoryIds: primary ? [primary.id] : [],
        indications: ['headache'],
      })
      .expect(201);
    const b = await t.http
      .post(api(`/inventory/branch/${ph.branchId}/drugs`))
      .set(bearer(ph.owner))
      .send({
        name: `Emzor Paracetamol ${Date.now()}`,
        drugType: 'oral',
        price: 300,
        stockAmount: 8,
      })
      .expect(201);

    await t.http
      .patch(api(`/inventory/drugs/${a.body.data.id}`))
      .set(bearer(ph.owner))
      .send({ price: 550 })
      .expect(200);
    await t.http
      .post(api(`/inventory/drugs/${a.body.data.id}/alternatives`))
      .set(bearer(ph.owner))
      .send({ alternativeDrugId: b.body.data.id })
      .expect((r) => expect([200, 201]).toContain(r.status));
    const detail = await t.http
      .get(api(`/inventory/drugs/${a.body.data.id}`))
      .set(bearer(ph.owner))
      .expect(200);
    expect(Number(detail.body.data.price)).toBe(550);

    const list = await t.http
      .get(api(`/inventory/branch/${ph.branchId}?page=1&limit=10`))
      .set(bearer(ph.owner))
      .expect(200);
    expect(list.body.meta.total).toBeGreaterThanOrEqual(2);
    await t.http
      .get(api(`/inventory/branch/${ph.branchId}/summary`))
      .set(bearer(ph.owner))
      .expect(200);
    await t.http
      .get(api(`/inventory/branch/${ph.branchId}/public`))
      .expect(200);

    // A pending reservation for drug A is auto-cancelled when it runs out
    const c = await createCustomer(t);
    const r = await t.http
      .post(api('/reservations'))
      .set(bearer(c))
      .send({
        branchId: ph.branchId,
        items: [{ drugId: a.body.data.id, quantity: 1 }],
      })
      .expect(201);
    await t.http
      .patch(api(`/inventory/drugs/${a.body.data.id}/stock`))
      .set(bearer(ph.owner))
      .send({ mode: 'subtract', quantity: 8, reason: 'damaged' })
      .expect(200);
    const low = await eventually(() =>
      t.prisma.notificationRecord.findFirst({
        where: { recipientId: ph.owner.id, title: { startsWith: 'Low stock' } },
      }),
    );
    expect(low).toBeTruthy();
    await t.http
      .patch(api(`/inventory/drugs/${a.body.data.id}/stock`))
      .set(bearer(ph.owner))
      .send({ mode: 'set', quantity: 0 })
      .expect(200);
    const cancelled = await eventually(() =>
      t.prisma.reservation.findFirst({
        where: { id: r.body.data.id, status: 'cancelled' },
      }),
    );
    expect(cancelled).toBeTruthy();
    await t.http
      .patch(api(`/inventory/drugs/${a.body.data.id}/stock`))
      .set(bearer(ph.owner))
      .send({ mode: 'add', quantity: 20 })
      .expect(200);

    await t.http
      .delete(
        api(
          `/inventory/drugs/${a.body.data.id}/alternatives/${b.body.data.id}`,
        ),
      )
      .set(bearer(ph.owner))
      .expect((x) => expect([200, 204]).toContain(x.status));
    await t.http
      .delete(api(`/inventory/drugs/${b.body.data.id}`))
      .set(bearer(ph.owner))
      .expect((x) => expect([200, 204]).toContain(x.status));
  });

  it('processes a CSV upload through the queue: rows, errors, progress, plan limit', async () => {
    const job = await t.prisma.batchUploadJob.create({
      data: {
        branchId: ph.branchId,
        fileUrl: 'https://files.test/drugs.csv',
        status: 'pending',
      },
    });
    const queue = t.app.get<Queue>(getQueueToken('inventory.batch-upload'));
    await queue.add('process', {
      jobId: job.id,
      pharmacyId: ph.pharmacyId,
      branchId: ph.branchId,
      fileUrl: job.fileUrl,
      totalRows: 0,
      startedAt: new Date(),
    });

    const done = await eventually(
      () =>
        t.prisma.batchUploadJob.findFirst({
          where: {
            id: job.id,
            status: { in: ['completed', 'completed_with_errors', 'failed'] },
          },
        }),
      15000,
    );
    expect(done).toMatchObject({
      status: 'completed_with_errors',
      totalRows: 3,
      addedCount: 2,
      errorCount: 1,
    });
    expect(JSON.stringify(done?.errorRows)).toContain('price');

    // The free plan has 20 slots; a pharmacy already at the limit cannot bulk-add
    const full = await createPharmacy(t);
    await t.prisma.drug.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        branchId: full.branchId,
        name: `Filler ${i}`,
        price: 1,
        stockAmount: 1,
      })),
    });
    const job2 = await t.prisma.batchUploadJob.create({
      data: {
        branchId: full.branchId,
        fileUrl: 'https://files.test/drugs.csv',
        status: 'pending',
      },
    });
    await queue.add('process', {
      jobId: job2.id,
      pharmacyId: full.pharmacyId,
      branchId: full.branchId,
      fileUrl: job2.fileUrl,
      totalRows: 0,
      startedAt: new Date(),
    });
    const blocked = await eventually(
      () =>
        t.prisma.batchUploadJob.findFirst({
          where: {
            id: job2.id,
            status: { in: ['completed', 'completed_with_errors', 'failed'] },
          },
        }),
      15000,
    );
    expect(blocked).toMatchObject({ status: 'failed', addedCount: 0 });
    expect(JSON.stringify(blocked?.errorRows)).toContain(
      'Inventory limit reached',
    );
  });

  it('reports an unreadable file as failed', async () => {
    const job = await t.prisma.batchUploadJob.create({
      data: {
        branchId: ph.branchId,
        fileUrl: 'https://files.test/missing.csv',
        status: 'pending',
      },
    });
    const queue = t.app.get<Queue>(getQueueToken('inventory.batch-upload'));
    await queue.add('process', {
      jobId: job.id,
      pharmacyId: ph.pharmacyId,
      branchId: ph.branchId,
      fileUrl: job.fileUrl,
      totalRows: 0,
      startedAt: new Date(),
    });
    const failed = await eventually(
      () =>
        t.prisma.batchUploadJob.findFirst({
          where: { id: job.id, status: 'failed' },
        }),
      15000,
    );
    expect(failed).toBeTruthy();
  });

  it('lets an admin withdraw and restore verification', async () => {
    const admin = await createAdmin(t);
    await t.http
      .post(api(`/admin/pharmacies/${ph.pharmacyId}/unverify`))
      .set(bearer(admin))
      .send({ note: 'Licence expired' })
      .expect(200);
    expect(
      (
        await t.prisma.pharmacy.findUniqueOrThrow({
          where: { id: ph.pharmacyId },
        })
      ).isVerified,
    ).toBe(false);
    await t.http
      .post(api(`/admin/pharmacies/${ph.pharmacyId}/verify`))
      .set(bearer(admin))
      .send({ note: 'Renewed' })
      .expect(200);
    expect(
      (
        await t.prisma.pharmacy.findUniqueOrThrow({
          where: { id: ph.pharmacyId },
        })
      ).isVerified,
    ).toBe(true);
  });
});
