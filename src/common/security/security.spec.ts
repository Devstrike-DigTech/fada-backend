import { JwtService } from '@nestjs/jwt';
import {
  activeSecrets,
  pickVerifyingSecret,
  verifyWithRotation,
} from './jwt-rotation';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { AppThrottlerGuard } from './app-throttler.guard';
import { RedisService } from '@infra/redis/redis.service';

const OLD = 'old-secret-old-secret-old-secret-0000';
const NEW = 'new-secret-new-secret-new-secret-1111';
const OTHER = 'attacker-secret-attacker-secret-2222';
const jwt = new JwtService({});

describe('JWT secret rotation', () => {
  it('lists configured secrets only', () => {
    expect(activeSecrets(NEW, undefined)).toEqual([NEW]);
    expect(activeSecrets(NEW, '')).toEqual([NEW]);
    expect(activeSecrets(NEW, OLD)).toEqual([NEW, OLD]);
  });

  it('accepts tokens signed with the current or the previous secret', () => {
    const fresh = jwt.sign({ sub: 'u1' }, { secret: NEW });
    const legacy = jwt.sign({ sub: 'u2' }, { secret: OLD });
    expect(
      verifyWithRotation<{ sub: string }>(jwt, fresh, [NEW, OLD]).sub,
    ).toBe('u1');
    expect(
      verifyWithRotation<{ sub: string }>(jwt, legacy, [NEW, OLD]).sub,
    ).toBe('u2');
    expect(pickVerifyingSecret(jwt, legacy, [NEW, OLD])).toBe(OLD);
  });

  it('rejects tokens from an unknown secret, and old tokens once rotation ends', () => {
    const forged = jwt.sign({ sub: 'x' }, { secret: OTHER });
    expect(() => verifyWithRotation(jwt, forged, [NEW, OLD])).toThrow();
    const legacy = jwt.sign({ sub: 'u2' }, { secret: OLD });
    expect(() => verifyWithRotation(jwt, legacy, [NEW])).toThrow();
  });

  it('does not let an expired token fall through to another secret', () => {
    const expired = jwt.sign(
      { sub: 'u', exp: Math.floor(Date.now() / 1000) - 10 },
      { secret: NEW },
    );
    expect(() => verifyWithRotation(jwt, expired, [NEW, OLD])).toThrow(
      /expired/,
    );
  });
});

describe('RedisThrottlerStorage', () => {
  it('fails open when Redis is down', async () => {
    const redis = {
      getClient: () => ({
        eval: () => Promise.reject(new Error('ECONNREFUSED')),
      }),
    } as unknown as RedisService;
    const r = await new RedisThrottlerStorage(redis).increment(
      'k',
      60000,
      5,
      60000,
      'medium',
    );
    expect(r).toEqual({
      totalHits: 0,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('maps the script result', async () => {
    const redis = {
      getClient: () => ({ eval: () => Promise.resolve([6, 41000, 1, 60000]) }),
    } as unknown as RedisService;
    const r = await new RedisThrottlerStorage(redis).increment(
      'k',
      60000,
      5,
      60000,
      'medium',
    );
    expect(r).toEqual({
      totalHits: 6,
      timeToExpire: 41,
      isBlocked: true,
      timeToBlockExpire: 60,
    });
  });
});

describe('AppThrottlerGuard tracker', () => {
  const guard = Object.create(
    AppThrottlerGuard.prototype,
  ) as AppThrottlerGuard & {
    getTracker(req: Record<string, unknown>): Promise<string>;
  };

  it('tracks signed-in users by id (carrier NAT friendly)', async () => {
    await expect(
      guard.getTracker({ user: { sub: 'u1' }, ip: '1.2.3.4' }),
    ).resolves.toBe('u:u1');
  });

  it('tracks anonymous clients by the first forwarded IP', async () => {
    await expect(
      guard.getTracker({ ips: ['41.58.1.1', '10.0.0.1'], ip: '10.0.0.1' }),
    ).resolves.toBe('ip:41.58.1.1');
    await expect(guard.getTracker({ ip: '1.2.3.4' })).resolves.toBe(
      'ip:1.2.3.4',
    );
  });
});
