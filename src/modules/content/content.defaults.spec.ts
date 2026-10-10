import {
  CONTENT_DEFAULTS,
  CONTENT_KEYS,
  SLUG_TO_KEY,
} from './content.defaults';
import {
  COMPLAINT_CATEGORIES,
  SUGGESTION_AREAS,
} from '../support/support.constants';
import { msg } from '../notifications/notification-messages';

type Sectioned = { sections: { title: string; body: string }[] };

describe('content defaults', () => {
  it('has a default for every key and a slug for every key', () => {
    for (const key of CONTENT_KEYS) {
      expect(CONTENT_DEFAULTS[key]).toBeDefined();
      expect(Object.values(SLUG_TO_KEY)).toContain(key);
    }
  });

  it('carries the app’s legal sections with non-empty bodies', () => {
    const counts = {
      disclaimer: 6,
      terms_of_service: 9,
      privacy_policy: 10,
    } as const;
    for (const [key, n] of Object.entries(counts)) {
      const c = CONTENT_DEFAULTS[key as keyof typeof counts]
        .content as Sectioned;
      expect(c.sections).toHaveLength(n);
      c.sections.forEach((s) => {
        expect(s.title.length).toBeGreaterThan(2);
        expect(s.body.length).toBeGreaterThan(40);
      });
    }
  });

  it('round-trips through JSON (as stored in app_content)', () => {
    for (const key of CONTENT_KEYS) {
      const d = CONTENT_DEFAULTS[key];
      expect(JSON.parse(JSON.stringify(d.content))).toEqual(d.content);
    }
  });
});

describe('support reference data', () => {
  it('uses unique slugs', () => {
    expect(new Set(COMPLAINT_CATEGORIES.map((c) => c.key)).size).toBe(
      COMPLAINT_CATEGORIES.length,
    );
    expect(new Set(SUGGESTION_AREAS.map((a) => a.key)).size).toBe(
      SUGGESTION_AREAS.length,
    );
  });

  it('only emails the user when a ticket is finished', () => {
    const base = {
      ticketId: 't',
      ticketNumber: 'TKT-ABC123',
      subject: 'Wrong drug',
    };
    expect(
      msg.ticketStatus({ ...base, status: 'in_review' }).email,
    ).toBeUndefined();
    const resolved = msg.ticketStatus({
      ...base,
      status: 'resolved',
      note: 'Refund issued by the pharmacy.',
    });
    expect(resolved.email?.subject).toBe('[TKT-ABC123] Wrong drug: resolved');
    expect(resolved.body).toBe('Refund issued by the pharmacy.');
  });
});
