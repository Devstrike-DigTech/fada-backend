import { msg } from './notification-messages';

describe('notification-messages', () => {
  it('summarises multi-item reservations for the pharmacy', () => {
    const m = msg.reservationCreated({
      reservationId: 'r1',
      code: 'RSV3AB9XY2',
      items: [
        { drugName: 'Panadol Extra', quantity: 2 },
        { drugName: 'Amoxil', quantity: 1 },
        { drugName: 'Vitamin C', quantity: 1 },
      ],
    });
    expect(m.title).toBe('New reservation RSV3AB9XY2');
    expect(m.body).toContain('Panadol Extra and 2 more');
    expect(m.link).toBe('pharmacy/reservations/r1');
  });

  it('hides the generic actor reason but shows a real one', () => {
    expect(
      msg.reservationCancelledByPharmacy({
        reservationId: 'r',
        code: 'C',
        pharmacyName: 'P',
        reason: 'by pharmacy',
      }).body,
    ).not.toContain('Reason');
    expect(
      msg.reservationCancelledByPharmacy({
        reservationId: 'r',
        code: 'C',
        pharmacyName: 'P',
        reason: 'Drug recalled',
      }).body,
    ).toContain('Reason: Drug recalled.');
  });

  it('includes email and SMS copy for failed payments', () => {
    const m = msg.paymentFailed({
      planName: 'Zuko',
      amountKobo: 750000,
      graceUntil: new Date('2026-11-01T12:00:00Z'),
    });
    expect(m.body).toContain('₦7,500');
    expect(m.body).toContain('1 Nov 2026');
    expect(m.email?.tone).toBe('warning');
    expect(m.sms).toMatch(/^FADA: /);
    expect(m.sms!.length).toBeLessThanOrEqual(160);
  });

  it('keeps the stock-out SMS within one segment for typical names', () => {
    const m = msg.stockOut({
      drugId: 'd',
      drugName: 'Coartem 80/480',
      branchName: 'Ikeja Branch',
    });
    expect(m.sms!.length).toBeLessThanOrEqual(160);
  });

  it('words level-ups differently for pharmacies', () => {
    expect(
      msg.levelUp({ toLevel: 3, levelName: 'Trusted', forPharmacy: true }).body,
    ).toContain('badge');
    expect(
      msg.levelUp({ toLevel: 3, levelName: 'Trusted', forPharmacy: false })
        .link,
    ).toBe('points');
  });
});
