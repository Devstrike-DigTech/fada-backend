import { REDACTED, redact, redactHeaders, redactUrl } from './redact';

describe('redact', () => {
  it('masks credentials at any depth', () => {
    const out = redact({
      email: 'a@b.ng',
      password: 'hunter2',
      newPassword: 'x',
      otp: '123456',
      code: '999',
      nested: { refreshToken: 't', card: { number: '4111' }, keep: 'ok' },
      list: [{ apiKey: 'k' }],
    }) as {
      email: string;
      password: string;
      newPassword: string;
      otp: string;
      code: string;
      nested: { refreshToken: string; card: unknown; keep: string };
      list: { apiKey: string }[];
    };
    expect(out.email).toBe('a@b.ng');
    expect(out.password).toBe(REDACTED);
    expect(out.newPassword).toBe(REDACTED);
    expect(out.otp).toBe(REDACTED);
    expect(out.code).toBe(REDACTED);
    expect(out.nested.refreshToken).toBe(REDACTED);
    expect(out.nested.card).toBe(REDACTED);
    expect(out.nested.keep).toBe('ok');
    expect(out.list[0].apiKey).toBe(REDACTED);
  });

  it('does not mask look-alike harmless keys', () => {
    const out = redact({
      reservationCode: 'RSV1',
      ticketNumber: 'TKT-1',
      category: 'x',
    }) as Record<string, unknown>;
    expect(out.reservationCode).toBe('RSV1');
    expect(out.ticketNumber).toBe('TKT-1');
  });

  it('scrubs secrets from URLs', () => {
    expect(redactUrl('/api/v1/pharmacy/staff/accept-invite/abc123def')).toBe(
      `/api/v1/pharmacy/staff/accept-invite/${REDACTED}`,
    );
    const u = redactUrl('/socket?token=eyJ.x.y&room=a');
    expect(u).toContain('room=a');
    expect(u).not.toContain('eyJ');
    expect(redactUrl('/api/v1/search/drugs?q=panadol')).toBe(
      '/api/v1/search/drugs?q=panadol',
    );
  });

  it('scrubs auth headers', () => {
    const h = redactHeaders({
      authorization: 'Bearer x',
      'x-paystack-signature': 's',
      accept: 'json',
    });
    expect(h.authorization).toBe(REDACTED);
    expect(h['x-paystack-signature']).toBe(REDACTED);
    expect(h.accept).toBe('json');
  });
});
