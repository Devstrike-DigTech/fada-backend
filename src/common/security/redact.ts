/**
 * Log scrubbing. Anything that looks like a credential, code, token or payment
 * detail is replaced before it reaches the logs.
 */

const SENSITIVE_KEY =
  /pass(word)?|secret|token|otp|^code$|pin|authorization|cookie|card|cvv|cvc|bvn|nin|signature|api[-_]?key|private|refresh|session|accesscode|access_code/i;

const SENSITIVE_QUERY =
  /^(token|otp|code|access_token|refresh_token|signature|key|secret|password)$/i;

/** Path segments that carry secrets, e.g. /pharmacy/staff/accept-invite/<token> */
const SECRET_PATH = /(\/accept-invite\/)[^/?#]+/gi;

export const REDACTED = '[REDACTED]';

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[…]';
  if (Array.isArray(value))
    return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500)
    return `${value.slice(0, 500)}…`;
  return value;
}

export function redactUrl(url: string): string {
  if (!url) return url;
  const [path, query] = url.split('?', 2);
  const safePath = path.replace(SECRET_PATH, `$1${REDACTED}`);
  if (!query) return safePath;
  const params = new URLSearchParams(query);
  for (const key of [...params.keys()]) {
    if (SENSITIVE_QUERY.test(key)) params.set(key, REDACTED);
  }
  return `${safePath}?${params.toString()}`;
}

export function redactHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] =
      /authorization|cookie|x-paystack-signature|verif-hash|x-guest-token/i.test(
        k,
      )
        ? REDACTED
        : v;
  }
  return out;
}
