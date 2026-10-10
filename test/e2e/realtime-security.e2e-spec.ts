import * as crypto from 'crypto';
import { io, Socket } from 'socket.io-client';
import { api, createTestApp, TestApp } from '../helpers/app';
import {
  bearer,
  createCustomer,
  createDrug,
  createPharmacy,
  PharmacyFixture,
} from '../helpers/fixtures';

type Conn = {
  s: Socket;
  events: { ev: string; data: Record<string, unknown> }[];
  ready?: { rooms: string[] };
  error?: string;
};

describe('Realtime (Socket.IO) and rate limiting', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ listen: true });
  });
  afterAll(() => t.close());

  const connect = (token?: string) =>
    new Promise<Conn>((resolve) => {
      const s = io(t.url, {
        auth: token ? { token } : {},
        transports: ['websocket'],
        reconnection: false,
      });
      const c: Conn = { s, events: [] };
      s.onAny((ev, data) => c.events.push({ ev, data }));
      s.on('ready', (d) => resolve({ ...c, ready: d }));
      s.on('connect_error', (e) => resolve({ ...c, error: e.message }));
    });
  const sub = (c: Conn, room: string) =>
    c.s.timeout(4000).emitWithAck('subscribe', { room }) as Promise<{
      ok: boolean;
      error?: string;
    }>;
  const waitFor = async (
    c: Conn,
    pred: (e: Conn['events'][0]) => boolean,
    ms = 5000,
  ) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = c.events.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };

  describe('sockets', () => {
    let ph: PharmacyFixture;
    let other: PharmacyFixture;
    const open: Conn[] = [];
    afterAll(() => open.forEach((c) => c.s.close()));

    beforeAll(async () => {
      ph = await createPharmacy(t);
      other = await createPharmacy(t);
    });

    it('refuses missing and invalid tokens at the handshake', async () => {
      const a = await connect();
      const b = await connect('nope');
      open.push(a, b);
      expect(a.error).toBe('missing_token');
      expect(b.error).toBe('invalid_token');
    });

    it('authorizes rooms and streams a reservation lifecycle once per socket', async () => {
      const cust = await createCustomer(t);
      const c = await connect(cust.token);
      const owner = await connect(ph.owner.token);
      const outsider = await connect(other.owner.token);
      open.push(c, owner, outsider);
      expect(c.ready?.rooms).toContain(`customer:${cust.id}:reservations`);

      expect(
        (await sub(owner, `pharmacy:${ph.pharmacyId}:reservations`)).ok,
      ).toBe(true);
      expect(
        (await sub(outsider, `pharmacy:${ph.pharmacyId}:reservations`)).error,
      ).toBe('forbidden');
      expect((await sub(c, `pharmacy:${ph.pharmacyId}:billing`)).error).toBe(
        'forbidden',
      );
      expect((await sub(c, 'admin:feed')).error).toBe('forbidden');
      expect((await sub(c, 'everything')).error).toBe('unknown_room');

      const drug = await createDrug(t, ph.branchId);
      const r = await t.http
        .post(api('/reservations'))
        .set(bearer(cust))
        .send({
          branchId: ph.branchId,
          items: [{ drugId: drug.id, quantity: 1 }],
        })
        .expect(201);
      const id = r.body.data.id as string;
      expect(
        await waitFor(
          owner,
          (e) => e.ev === 'reservation.created' && e.data.reservationId === id,
        ),
      ).toBeTruthy();
      expect((await sub(c, `reservation:${id}`)).ok).toBe(true);

      await t.http
        .patch(api(`/reservations/${id}/confirm`))
        .set(bearer(ph.owner))
        .send({})
        .expect(200);
      expect(
        await waitFor(
          c,
          (e) =>
            e.ev === 'reservation.updated' && e.data.status === 'confirmed',
        ),
      ).toBeTruthy();
      await new Promise((res) => setTimeout(res, 300));
      expect(
        c.events.filter(
          (e) =>
            e.ev === 'reservation.updated' && e.data.status === 'confirmed',
        ),
      ).toHaveLength(1);
      expect(outsider.events.some((e) => e.ev.startsWith('reservation.'))).toBe(
        false,
      );
      expect(await waitFor(c, (e) => e.ev === 'notification')).toBeTruthy();
    });
  });

  describe('rate limiting (enabled for this block)', () => {
    beforeAll(() => {
      process.env.RATE_LIMIT_ENABLED = 'true';
    });
    afterAll(() => {
      process.env.RATE_LIMIT_ENABLED = 'false';
    });

    it('limits login attempts per client IP', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 22; i++) {
        const r = await t.http
          .post(api('/auth/login'))
          .send({ email: 'nobody@test.ng', password: 'Wr0ng!Pass' });
        statuses.push(r.status);
        if (r.status === 429) {
          expect(
            Object.keys(r.headers).some((h) => h.startsWith('retry-after')),
          ).toBe(true);
          break;
        }
      }
      expect(statuses.at(-1)).toBe(429);
      expect(statuses.filter((s) => s === 401).length).toBeGreaterThanOrEqual(
        20,
      );
    });

    it('never throttles signed payment webhooks', async () => {
      const raw = JSON.stringify({ event: 'noop', data: {} });
      const sig = crypto
        .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
        .update(raw)
        .digest('hex');
      for (let i = 0; i < 30; i++) {
        await t.http
          .post(api('/subscriptions/webhook/paystack'))
          .set('Content-Type', 'application/json')
          .set('x-paystack-signature', sig)
          .send(raw)
          .expect(200);
      }
    });
  });
});
