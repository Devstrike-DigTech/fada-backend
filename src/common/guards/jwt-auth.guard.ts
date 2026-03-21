import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_GUEST_KEY } from '../decorators/allow-guest.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const allowGuest = this.reflector.getAllAndOverride<boolean>(
      ALLOW_GUEST_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (allowGuest) {
      // Try to authenticate but don't block if no token present
      const request = context.switchToHttp().getRequest<{
        headers: { authorization?: string; 'x-guest-token'?: string };
        guestToken?: string;
      }>();
      const authHeader = request.headers.authorization;
      const guestToken = request.headers['x-guest-token'];

      if (!authHeader && guestToken) {
        // Attach guest token to request and allow through
        request.guestToken = guestToken;
        return true;
      }
    }

    return super.canActivate(context);
  }

  handleRequest<TUser>(err: Error | null, user: TUser): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException('Authentication required');
    }
    return user;
  }
}
