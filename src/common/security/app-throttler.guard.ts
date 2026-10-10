import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Signed-in requests are limited per user, anonymous ones per client IP.
 * Nigerian mobile carriers put many subscribers behind one public IP
 * (carrier-grade NAT), so per-IP limits alone would punish real users.
 * Registered after JwtAuthGuard so `req.user` is already populated.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { sub?: string } | undefined;
    if (user?.sub) return Promise.resolve(`u:${user.sub}`);
    const ips = req.ips as string[] | undefined;
    const ip =
      (ips && ips.length ? ips[0] : (req.ip as string | undefined)) ??
      'unknown';
    return Promise.resolve(`ip:${ip}`);
  }

  protected shouldSkip(context: ExecutionContext): Promise<boolean> {
    // WebSocket traffic has its own limits in SocketGateway
    return Promise.resolve(context.getType() !== 'http');
  }
}
