import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import {
  OAUTH_UNCONFIGURED,
  isOAuthConfigured,
} from '../guards/oauth-configured.guard';

export interface GoogleOAuthUser {
  googleId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  accessToken: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    // Placeholders keep boot working without credentials; the guard answers 503
    super({
      clientID:
        configService.get<string>('auth.google.clientId') || OAUTH_UNCONFIGURED,
      clientSecret:
        configService.get<string>('auth.google.clientSecret') ||
        OAUTH_UNCONFIGURED,
      callbackURL:
        configService.get<string>('auth.google.callbackUrl') ||
        'http://localhost:3000/api/v1/auth/google/callback',
      scope: ['email', 'profile'],
    });
    if (!isOAuthConfigured(configService, 'google')) {
      new Logger(GoogleStrategy.name).warn(
        'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google sign-in is disabled.',
      );
    }
  }

  validate(
    accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const { id, name, emails, photos } = profile;

    const user: GoogleOAuthUser = {
      googleId: id,
      email: emails?.[0]?.value ?? '',
      firstName: name?.givenName ?? '',
      lastName: name?.familyName ?? '',
      avatarUrl: photos?.[0]?.value,
      accessToken,
    };

    done(null, user);
  }
}
