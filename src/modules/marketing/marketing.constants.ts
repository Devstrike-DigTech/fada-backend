/**
 * Field-marketing reference data. The routes are the Enugu sales territories
 * the field team already works (carried over from the original Android app);
 * admins can rename, reorder, add or retire them in the back office.
 */
export const DEFAULT_SALES_ROUTES: readonly string[] = [
  'Open Heaven (Polo Mall and Environs) to Abakiliki Road (Down to Abakpa Junction)',
  'Abakiliki Road (Down to Abakpa Junction) to New Haven Junction (Naira Triangle)',
  'New Haven Junction (Naira Triangle) to New Haven (Juhel Filling Station)',
  'New Haven (Juhel Filling Station) to Independence Layout (Presidential Road)',
  'Independence Layout (Presidential Road) to Maryland',
  'Maryland to Agbani Road',
  'Agbani Road to Holy Ghost',
  'Holy Ghost to GRA',
];

/** Marketers may log a call or visit slightly ahead of the server clock. */
export const INTERACTION_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Digits only; Nigerian numbers become 234XXXXXXXXXX so 0803… and +234803… match. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('234')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) {
    return `234${digits.slice(1)}`;
  }
  if (digits.length === 10) return `234${digits}`;
  return digits;
}
