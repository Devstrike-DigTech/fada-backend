import { parseRoom, rooms } from './socket-rooms';

const id = '3f6c1e2a-9b7d-4c1e-8a2b-1234567890ab';

describe('socket-rooms', () => {
  it('round-trips every builder through the parser', () => {
    const cases: [string, string][] = [
      [rooms.user(id), 'user'],
      [rooms.customerReservations(id), 'customer_reservations'],
      [rooms.reservation(id), 'reservation'],
      [rooms.pharmacyReservations(id), 'pharmacy_reservations'],
      [rooms.branchReservations(id), 'branch_reservations'],
      [rooms.pharmacyBilling(id), 'pharmacy_billing'],
      [rooms.batchUpload(id), 'batch_upload'],
    ];
    for (const [name, kind] of cases) {
      expect(parseRoom(name)).toEqual({ kind, id, name });
    }
    expect(parseRoom(rooms.adminFeed())).toEqual({
      kind: 'admin_feed',
      id: null,
      name: 'admin:feed',
    });
  });

  it('rejects anything outside the contract', () => {
    for (const bad of [
      '',
      'pharmacy:*:reservations',
      `pharmacy:${id}`,
      `reservation:${id}:extra`,
      `user:${id};drop`,
      'admin:feed:x',
      `PHARMACY:${id}:reservations`,
      'x'.repeat(200),
      42,
      null,
    ]) {
      expect(parseRoom(bad)).toBeNull();
    }
  });
});
