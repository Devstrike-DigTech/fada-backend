import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * GuestGuard — Used on routes that require EITHER a valid JWT user OR a guest token.
 * Routes that need full authentication should use JwtAuthGuard instead.
 * Routes that need *only* a guest token (not authenticated users) use this guard.
 */
@Injectable()
export class GuestGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      Request & { guestToken?: string }
    >();

    const guestToken = request.headers['x-guest-token'] as string | undefined;
    const hasUser = !!request.user;

    if (!hasUser && !guestToken) {
      throw new UnauthorizedException(
        'Authentication required. Provide a JWT token or a guest token (x-guest-token header).',
      );
    }

    if (guestToken) {
      request.guestToken = guestToken;
    }

    return true;
  }
}
