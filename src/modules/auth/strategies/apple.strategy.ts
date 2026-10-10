import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, AuthenticateOptions } from 'passport-apple';
import {
  OAUTH_UNCONFIGURED,
  isOAuthConfigured,
} from '../guards/oauth-configured.guard';

export interface AppleOAuthUser {
  appleId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

// Apple only returns name on the first sign-in, email is returned in the JWT
interface AppleProfile {
  id: string;
  email?: string;
  name?: {
    firstName?: string;
    lastName?: string;
  };
}

type AppleDoneCallback = (
  err: Error | null,
  user?: AppleOAuthUser | false,
) => void;

@Injectable()
export class AppleStrategy extends PassportStrategy(Strategy, 'apple') {
  constructor(configService: ConfigService) {
    // Missing credentials must not stop the API from booting: the strategy is
    // built with placeholders and OAuthConfiguredGuard answers 503 instead.
    const get = (key: string): string =>
      configService.get<string>(`auth.apple.${key}`) || OAUTH_UNCONFIGURED;
    const opts: ConstructorParameters<typeof Strategy>[0] = {
      clientID: get('clientId'),
      teamID: get('teamId'),
      keyID: get('keyId'),
      privateKeyString: get('privateKey'),
      callbackURL:
        configService.get<string>('auth.apple.callbackUrl') ||
        'http://localhost:3000/api/v1/auth/apple/callback',
      scope: ['name', 'email'],
      passReqToCallback: false,
    } as AuthenticateOptions;

    super(opts);
    if (!isOAuthConfigured(configService, 'apple')) {
      new Logger(AppleStrategy.name).warn(
        'APPLE_* credentials not set — Apple Sign-In is disabled.',
      );
    }
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    idToken: string,
    profile: AppleProfile,
    done: AppleDoneCallback,
  ): void {
    // Apple sends user info in the id_token on first login
    // We derive what we can from the profile object
    const user: AppleOAuthUser = {
      appleId: profile.id,
      email: profile.email,
      firstName: profile.name?.firstName,
      lastName: profile.name?.lastName,
    };

    done(null, user);
  }
}
