import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
  Type,
  mixin,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type OAuthProvider = 'google' | 'apple';

const REQUIRED_KEYS: Record<OAuthProvider, readonly string[]> = {
  google: ['clientId', 'clientSecret'],
  apple: ['clientId', 'teamId', 'keyId', 'privateKey'],
};

/** Placeholder so a Passport strategy can be constructed without credentials. */
export const OAUTH_UNCONFIGURED = 'unconfigured';

export function isOAuthConfigured(
  config: ConfigService,
  provider: OAuthProvider,
): boolean {
  return REQUIRED_KEYS[provider].every(
    (key) => !!config.get<string>(`auth.${provider}.${key}`),
  );
}

/**
 * Runs before the Passport guard. A provider without credentials answers 503
 * instead of redirecting users to a broken sign-in page — and, because the
 * strategies fall back to placeholders, it never stops the app from booting.
 */
export function OAuthConfiguredGuard(
  provider: OAuthProvider,
): Type<CanActivate> {
  @Injectable()
  class ProviderConfiguredGuard implements CanActivate {
    constructor(private readonly config: ConfigService) {}

    canActivate(): boolean {
      if (!isOAuthConfigured(this.config, provider)) {
        throw new ServiceUnavailableException(
          `${provider}_sign_in_not_configured`,
        );
      }
      return true;
    }
  }
  return mixin(ProviderConfiguredGuard);
}
