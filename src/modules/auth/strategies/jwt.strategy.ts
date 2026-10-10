import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import {
  activeSecrets,
  pickVerifyingSecret,
} from '@common/security/jwt-rotation';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '@infra/database/prisma.service';
import { CurrentUserData } from '@common/decorators/current-user.decorator';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    jwtService: JwtService,
  ) {
    const secrets = activeSecrets(
      configService.get<string>('jwt.accessSecret'),
      configService.get<string>('jwt.accessSecretPrevious'),
    );
    if (secrets.length === 0)
      throw new Error('JWT_ACCESS_SECRET is not configured');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Rotation: accept tokens signed with the current or the previous secret
      secretOrKeyProvider: (
        _req: unknown,
        rawJwtToken: string,
        done: (err: Error | null, secret?: string) => void,
      ) => done(null, pickVerifyingSecret(jwtService, rawJwtToken, secrets)),
    });
  }

  async validate(payload: JwtPayload): Promise<CurrentUserData> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account not found or deactivated');
    }

    return {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
  }
}
