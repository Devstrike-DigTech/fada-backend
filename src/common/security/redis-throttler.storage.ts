import { Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from '@infra/redis/redis.service';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Atomic hit counter + block flag in Redis, shared by every app instance.
 * KEYS[1]=hits KEYS[2]=block; ARGV: ttlMs, limit, blockMs.
 * Returns { hits, hitsPttl, blocked(0|1), blockPttl }.
 */
const SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return { hits, redis.call('PTTL', KEYS[1]), 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local pttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return { hits, pttl, 1, tonumber(ARGV[3]) }
end
return { hits, pttl, 0, 0 }
`;

/**
 * Throttler storage in Redis so limits hold across instances. If Redis is
 * unreachable the request is allowed (fail open) and the outage is logged:
 * availability of the pharmacy marketplace beats strict rate limiting.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private lastWarn = 0;

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;
    try {
      const [hits, hitsPttl, blocked, blockPttl] = (await this.redis
        .getClient()
        .eval(
          SCRIPT,
          2,
          hitsKey,
          blockKey,
          ttl,
          limit,
          blockDuration || ttl,
        )) as number[];
      return {
        totalHits: Number(hits),
        timeToExpire: Math.max(0, Math.ceil(Number(hitsPttl) / 1000)),
        isBlocked: Number(blocked) === 1,
        timeToBlockExpire: Math.max(0, Math.ceil(Number(blockPttl) / 1000)),
      };
    } catch (err) {
      if (Date.now() - this.lastWarn > 60_000) {
        this.lastWarn = Date.now();
        this.logger.warn(
          `Rate limiting skipped, Redis unavailable: ${(err as Error).message}`,
        );
      }
      return {
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
