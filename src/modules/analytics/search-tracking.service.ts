import { Injectable, Logger } from '@nestjs/common';
import { SearchType } from '@prisma/client';
import { RedisService } from '@infra/redis/redis.service';
import { SearchResultsServedPayload } from '@common/types/events.types';
import { lagosDay } from './analytics-dates';

/** Counters live long enough for the nightly snapshot plus a week of rebuilds. */
const TTL_SECS = 9 * 24 * 60 * 60;
const SEARCH_TYPES: SearchType[] = ['drug', 'ailment', 'pharmacy'];

const k = {
  appear: (day: string) => `an:appear:${day}`,
  pharmacyQueries: (day: string, pid: string) => `an:pq:${day}:${pid}`,
  queries: (day: string, type: string) => `an:q:${day}:${type}`,
  zero: (day: string, type: string) => `an:zero:${day}:${type}`,
  searches: (day: string) => `an:searches:${day}`,
  zeroSearches: (day: string) => `an:searches0:${day}`,
};

export interface QueryCount {
  query: string;
  count: number;
}

/** Lower-cases and trims queries so "Panadol " and "panadol" count together. */
export function normaliseQuery(q: string | undefined): string | null {
  if (!q) return null;
  const n = q.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
  return n.length >= 2 ? n : null;
}

/**
 * Per-day search counters in Redis: which pharmacies appeared, what people
 * searched for, and which searches found nothing. Search volume is too high
 * to write a row per search; the nightly snapshot persists the totals.
 */
@Injectable()
export class SearchTrackingService {
  private readonly logger = new Logger(SearchTrackingService.name);

  constructor(private readonly redis: RedisService) {}

  async record(p: SearchResultsServedPayload): Promise<void> {
    const day = lagosDay(p.servedAt ? new Date(p.servedAt) : new Date());
    const query = normaliseQuery(p.query);
    const r = this.redis.getClient().pipeline();

    r.hincrby(k.searches(day), p.searchType, 1).expire(
      k.searches(day),
      TTL_SECS,
    );
    if (p.resultCount === 0) {
      r.hincrby(k.zeroSearches(day), p.searchType, 1).expire(
        k.zeroSearches(day),
        TTL_SECS,
      );
    }

    for (const pid of new Set(p.pharmacyIds)) {
      r.hincrby(k.appear(day), pid, 1);
      if (query) {
        r.zincrby(k.pharmacyQueries(day, pid), 1, query).expire(
          k.pharmacyQueries(day, pid),
          TTL_SECS,
        );
      }
    }
    if (p.pharmacyIds.length) r.expire(k.appear(day), TTL_SECS);

    if (query) {
      r.zincrby(k.queries(day, p.searchType), 1, query).expire(
        k.queries(day, p.searchType),
        TTL_SECS,
      );
      if (p.resultCount === 0) {
        r.zincrby(k.zero(day, p.searchType), 1, query).expire(
          k.zero(day, p.searchType),
          TTL_SECS,
        );
      }
    }
    await r.exec();
  }

  // ─── Readers ─────────────────────────────────────────────────────────────────

  async appearances(day: string): Promise<Record<string, number>> {
    const raw = await this.redis.hgetall(k.appear(day));
    return Object.fromEntries(
      Object.entries(raw).map(([pid, n]) => [pid, Number(n)]),
    );
  }

  async appearancesFor(day: string, pharmacyId: string): Promise<number> {
    return Number((await this.redis.hget(k.appear(day), pharmacyId)) ?? 0);
  }

  topQueriesFor(
    day: string,
    pharmacyId: string,
    limit = 10,
  ): Promise<QueryCount[]> {
    return this.top(k.pharmacyQueries(day, pharmacyId), limit);
  }

  topQueries(
    day: string,
    type: SearchType,
    limit = 500,
  ): Promise<QueryCount[]> {
    return this.top(k.queries(day, type), limit);
  }

  zeroResultQueries(
    day: string,
    type: SearchType,
    limit = 500,
  ): Promise<QueryCount[]> {
    return this.top(k.zero(day, type), limit);
  }

  async searchTotals(day: string): Promise<{
    searches: number;
    zeroResult: number;
    byType: Record<string, number>;
  }> {
    const [all, zero] = await Promise.all([
      this.redis.hgetall(k.searches(day)),
      this.redis.hgetall(k.zeroSearches(day)),
    ]);
    const byType = Object.fromEntries(
      SEARCH_TYPES.map((t) => [t, Number(all[t] ?? 0)]),
    );
    return {
      searches: Object.values(byType).reduce((a, b) => a + b, 0),
      zeroResult: Object.values(zero).reduce((a, b) => a + Number(b), 0),
      byType,
    };
  }

  /** True when Redis still holds counters for that day (they expire after 9 days). */
  async hasData(day: string): Promise<boolean> {
    return this.redis.exists(k.searches(day));
  }

  private async top(key: string, limit: number): Promise<QueryCount[]> {
    const flat = await this.redis
      .getClient()
      .zrevrange(key, 0, limit - 1, 'WITHSCORES');
    const out: QueryCount[] = [];
    for (let i = 0; i < flat.length; i += 2)
      out.push({ query: flat[i], count: Number(flat[i + 1]) });
    return out;
  }
}
