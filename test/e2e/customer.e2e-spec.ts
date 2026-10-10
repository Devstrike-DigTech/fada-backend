import { api, createTestApp, eventually, TestApp } from '../helpers/app';
import {
  Actor,
  bearer,
  createCustomer,
  createDrug,
  createPharmacy,
  PharmacyFixture,
} from '../helpers/fixtures';

/** Customer features: profile, addresses, saves, named lists, list reservation, history. */
describe('Customer features', () => {
  let t: TestApp;
  let c: Actor;
  let ph: PharmacyFixture;
  let ph2: PharmacyFixture;
  const drugs: { id: string; name: string }[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    c = await createCustomer(t);
    ph = await createPharmacy(t, { name: 'Coal City Pharmacy' });
    ph2 = await createPharmacy(t, { name: 'Abakpa Pharmacy' });
    for (const n of ['Amoxil', 'Flagyl', 'Vitamin C'])
      drugs.push(
        await createDrug(t, ph.branchId, {
          name: `${n} ${Date.now()}`,
          price: 1000,
        }),
      );
    drugs.push(
      await createDrug(t, ph2.branchId, {
        name: `Ventolin ${Date.now()}`,
        price: 3000,
      }),
    );
  });
  afterAll(() => t.close());

  it('profile + details', async () => {
    const p = await t.http
      .get(api('/customer/profile'))
      .set(bearer(c))
      .expect(200);
    expect(p.body.data).toMatchObject({
      firstName: 'Ada',
      completion: { isComplete: false },
    });
    await t.http
      .put(api('/customer/profile'))
      .set(bearer(c))
      .send({})
      .expect(400);
    const d = await t.http
      .get(api('/customer/profile/details'))
      .set(bearer(c))
      .expect(200);
    expect(d.body.data.stats).toMatchObject({ savedDrugs: 0, reservations: 0 });
  });

  it('addresses: first is default, max enforced, default moves on delete', async () => {
    const a1 = await t.http
      .post(api('/customer/addresses'))
      .set(bearer(c))
      .send({
        label: 'Home',
        addressLine: '1 Zik Ave',
        city: 'Enugu',
        state: 'Enugu',
      })
      .expect(201);
    expect(a1.body.data.isDefault).toBe(true);
    const a2 = await t.http
      .post(api('/customer/addresses'))
      .set(bearer(c))
      .send({ label: 'Work', addressLine: '9 Okpara Ave', isDefault: true })
      .expect(201);
    expect(a2.body.data.isDefault).toBe(true);
    const list = await t.http
      .get(api('/customer/addresses'))
      .set(bearer(c))
      .expect(200);
    expect(list.body.data.map((a: { label: string }) => a.label)).toEqual([
      'Work',
      'Home',
    ]);
    await t.http
      .put(api(`/customer/addresses/${a1.body.data.id}`))
      .set(bearer(c))
      .send({ city: 'Nsukka' })
      .expect(200);
    await t.http
      .delete(api(`/customer/addresses/${a2.body.data.id}`))
      .set(bearer(c))
      .expect(200);
    const after = await t.http
      .get(api('/customer/addresses'))
      .set(bearer(c))
      .expect(200);
    expect(after.body.data[0]).toMatchObject({
      label: 'Home',
      isDefault: true,
      city: 'Nsukka',
    });
    await t.http
      .delete(api('/customer/addresses/00000000-0000-4000-8000-000000000000'))
      .set(bearer(c))
      .expect(404);
  });

  it('saves drugs and pharmacies idempotently, with heart status and distance', async () => {
    const first = await t.http
      .post(api(`/saves/drugs/${drugs[0].id}`))
      .set(bearer(c))
      .expect(200);
    expect(first.body.data.alreadySaved).toBe(false);
    const again = await t.http
      .post(api(`/saves/drugs/${drugs[0].id}`))
      .set(bearer(c))
      .expect(200);
    expect(again.body.data.alreadySaved).toBe(true);
    await t.http
      .post(api(`/saves/pharmacies/${ph.pharmacyId}`))
      .set(bearer(c))
      .expect(200);
    await t.http
      .post(api('/saves/drugs/00000000-0000-4000-8000-000000000000'))
      .set(bearer(c))
      .expect(404);

    const saved = await t.http
      .get(api('/saves/drugs?latitude=6.45&longitude=7.51'))
      .set(bearer(c))
      .expect(200);
    expect(saved.body.data.items[0]).toMatchObject({
      drugId: drugs[0].id,
      isAvailable: true,
    });
    expect(saved.body.data.items[0].distanceKm).toBeLessThan(5);
    const phs = await t.http
      .get(api('/saves/pharmacies'))
      .set(bearer(c))
      .expect(200);
    expect(phs.body.data.items[0].pharmacyId).toBe(ph.pharmacyId);

    const status = await t.http
      .get(
        api(
          `/saves/status?drugIds=${drugs[0].id},${drugs[1].id}&pharmacyIds=${ph.pharmacyId}`,
        ),
      )
      .set(bearer(c))
      .expect(200);
    expect(status.body.data).toEqual({
      drugs: { [drugs[0].id]: true, [drugs[1].id]: false },
      pharmacies: { [ph.pharmacyId]: true },
    });

    await t.http
      .delete(api(`/saves/drugs/${drugs[0].id}`))
      .set(bearer(c))
      .expect(200);
    await t.http
      .delete(api(`/saves/pharmacies/${ph.pharmacyId}`))
      .set(bearer(c))
      .expect(200);
    const empty = await t.http
      .get(api('/saves/drugs'))
      .set(bearer(c))
      .expect(200);
    expect(empty.body.data.items).toHaveLength(0);
  });

  it('named lists: create, rename, items, branch grouping, reserve the list', async () => {
    const list = await t.http
      .post(api('/saves/lists'))
      .set(bearer(c))
      .send({ name: 'Mum’s meds' })
      .expect(201);
    const id = list.body.data.id;
    await t.http
      .post(api('/saves/lists'))
      .set(bearer(c))
      .send({ name: 'mum’s MEDS' })
      .expect(409);
    await t.http
      .put(api(`/saves/lists/${id}`))
      .set(bearer(c))
      .send({ name: 'Monthly meds' })
      .expect(200);

    for (const d of drugs)
      await t.http
        .post(api(`/saves/lists/${id}/drugs`))
        .set(bearer(c))
        .send({ drugId: d.id, quantity: 1 })
        .expect(200);
    await t.http
      .post(api(`/saves/lists/${id}/drugs`))
      .set(bearer(c))
      .send({ drugId: drugs[0].id, quantity: 2 })
      .expect(200);
    await t.http
      .patch(api(`/saves/lists/${id}/drugs/${drugs[1].id}`))
      .set(bearer(c))
      .send({ quantity: 4 })
      .expect(200);

    const detail = await t.http
      .get(api(`/saves/lists/${id}`))
      .set(bearer(c))
      .expect(200);
    expect(detail.body.data).toMatchObject({
      itemCount: 4,
      canReserveInOneTrip: false,
    });
    expect(detail.body.data.totalPrice).toBe(3 * 1000 + 4 * 1000 + 1000 + 3000);
    expect(detail.body.data.branches).toHaveLength(2);

    const all = await t.http
      .get(api('/saves/lists'))
      .set(bearer(c))
      .expect(200);
    expect(all.body.data[0]).toMatchObject({
      name: 'Monthly meds',
      itemCount: 4,
    });

    await t.http
      .post(api(`/saves/lists/${id}/reserve`))
      .set(bearer(c))
      .send({})
      .expect(400); // spans two branches
    const reserved = await t.http
      .post(api(`/saves/lists/${id}/reserve`))
      .set(bearer(c))
      .send({ branchId: ph.branchId })
      .expect(201);
    expect(reserved.body.data.reservedCount).toBe(3);
    expect(reserved.body.data.skipped).toHaveLength(1);
    expect(reserved.body.data.reservation.items).toHaveLength(3);

    await t.http
      .delete(api(`/saves/lists/${id}/drugs/${drugs[3].id}`))
      .set(bearer(c))
      .expect(200);
    await t.http
      .delete(api(`/saves/lists/${id}`))
      .set(bearer(c))
      .expect(200);
    await t.http
      .get(api(`/saves/lists/${id}`))
      .set(bearer(c))
      .expect(404);
  });

  it('search history: recorded, listed, repeated, removed, cleared', async () => {
    await t.http
      .get(api(`/search/drugs?q=${encodeURIComponent(drugs[2].name)}`))
      .set(bearer(c))
      .expect(200);
    await t.http
      .get(api('/search/pharmacies?q=Coal'))
      .set(bearer(c))
      .expect(200);
    await t.http
      .get(api('/search/ailments?q=malaria'))
      .set(bearer(c))
      .expect(200);
    const hist = await eventually(async () => {
      const r = await t.http
        .get(api('/customer/history/searches'))
        .set(bearer(c));
      return r.body.data?.items?.length >= 3 ? r.body.data.items : null;
    });
    expect(
      hist.map((h: { searchType: string }) => h.searchType).sort(),
    ).toEqual(['ailment', 'drug', 'pharmacy']);

    const drugEntry = hist.find(
      (h: { searchType: string }) => h.searchType === 'drug',
    );
    const repeat = await t.http
      .post(api(`/customer/history/searches/${drugEntry.id}/repeat`))
      .set(bearer(c))
      .send({ latitude: 6.45, longitude: 7.51 })
      .expect(200);
    expect(repeat.body.data.result.data.length).toBeGreaterThanOrEqual(1);
    const phEntry = hist.find(
      (h: { searchType: string }) => h.searchType === 'pharmacy',
    );
    await t.http
      .post(api(`/customer/history/searches/${phEntry.id}/repeat`))
      .set(bearer(c))
      .send({})
      .expect(200);

    await t.http
      .delete(api(`/customer/history/searches/${drugEntry.id}`))
      .set(bearer(c))
      .expect(200);
    const cleared = await t.http
      .delete(api('/customer/history/searches'))
      .set(bearer(c))
      .expect(200);
    expect(cleared.body.data.deleted).toBeGreaterThanOrEqual(2);
  });

  it('reservation history and cancellation by the customer', async () => {
    const r = await t.http
      .post(api('/reservations'))
      .set(bearer(c))
      .send({
        branchId: ph.branchId,
        items: [{ drugId: drugs[2].id, quantity: 1 }],
      })
      .expect(201);
    await t.http
      .patch(api(`/reservations/${r.body.data.id}/cancel`))
      .set(bearer(c))
      .send({ reason: 'Found it closer' })
      .expect(200);
    const mine = await t.http
      .get(api('/customer/history/reservations?status=cancelled'))
      .set(bearer(c))
      .expect(200);
    expect(
      mine.body.data.some((x: { id: string }) => x.id === r.body.data.id),
    ).toBe(true);
  });

  it('points summary, levels, rules and leaderboard', async () => {
    const levels = await t.http.get(api('/points/levels')).expect(200);
    expect(levels.body.data).toHaveLength(7);
    const rules = await t.http
      .get(api('/points/rules?owner=customer'))
      .expect(200);
    expect(
      rules.body.data.every((r: { owner: string }) => r.owner === 'customer'),
    ).toBe(true);
    const me = await t.http
      .get(api(`/points/customer/${c.id}`))
      .set(bearer(c))
      .expect(200);
    expect(me.body.data).toMatchObject({ level: 1, badge: 'LVL 1' });
    await t.http
      .get(api(`/points/customer/${c.id}/history`))
      .set(bearer(c))
      .expect(200);
    const other = await createCustomer(t);
    await t.http
      .get(api(`/points/customer/${c.id}`))
      .set(bearer(other))
      .expect(403);
    const pub = await t.http
      .get(api(`/points/pharmacy/${ph.pharmacyId}`))
      .expect(200);
    expect(pub.body.data.balance).toBeUndefined();
    await t.http
      .get(api('/points/leaderboard/pharmacies?state=Enugu'))
      .expect(200);
  });
});
