import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, AuthenticateOptions } from 'passport-apple';

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
    const opts: ConstructorParameters<typeof Strategy>[0] = {
      clientID: configService.get<string>('auth.apple.clientId') ?? '',
      teamID: configService.get<string>('auth.apple.teamId') ?? '',
      keyID: configService.get<string>('auth.apple.keyId') ?? '',
      privateKeyString:
        configService.get<string>('auth.apple.privateKey') ?? '',
      callbackURL:
        configService.get<string>('app.appleCallbackUrl') ??
        'http://localhost:3000/api/v1/auth/apple/callback',
      scope: ['name', 'email'],
      passReqToCallback: false,
    } as AuthenticateOptions & ConstructorParameters<typeof Strategy>[0];

    super(opts);
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
