import { JwtService } from '@nestjs/jwt';

/**
 * Secret rotation: tokens are always signed with the current secret but are
 * accepted if they verify against the current OR the previous secret. Set
 * JWT_*_SECRET_PREVIOUS to the old value when rotating, keep it for the token
 * lifetime (15 min access / 30 days refresh), then remove it.
 */
export function activeSecrets(current?: string, previous?: string): string[] {
  return [current, previous].filter((s): s is string => !!s && s.length > 0);
}

/** Verifies with each secret in turn; throws the last error if none match. */
export function verifyWithRotation<T extends object>(
  jwt: JwtService,
  token: string,
  secrets: string[],
): T {
  let lastError: unknown = new Error('No JWT secret configured');
  for (const secret of secrets) {
    try {
      return jwt.verify<T>(token, { secret });
    } catch (err) {
      lastError = err;
      // A valid signature that has expired must not fall through to the next secret
      if ((err as Error)?.name === 'TokenExpiredError') throw err;
    }
  }
  throw lastError;
}

/**
 * For passport-jwt's secretOrKeyProvider: returns the secret whose signature
 * matches so passport can finish verification (including expiry) itself.
 */
export function pickVerifyingSecret(
  jwt: JwtService,
  token: string,
  secrets: string[],
): string {
  for (const secret of secrets) {
    try {
      jwt.verify(token, { secret, ignoreExpiration: true });
      return secret;
    } catch {
      /* try the next one */
    }
  }
  return secrets[0] ?? '';
}
