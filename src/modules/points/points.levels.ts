import { PointsReason } from '@prisma/client';

/**
 * Reputation ladder shared by customers and pharmacies. A ledger's level is
 * the highest tier whose `minPoints` its lifetime-earned total has reached.
 * Levels never drop when points are deducted.
 */
export interface ReputationLevel {
  level: number;
  name: string;
  minPoints: number;
}

export const REPUTATION_LEVELS: readonly ReputationLevel[] = [
  { level: 1, name: 'Newcomer', minPoints: 0 },
  { level: 2, name: 'Regular', minPoints: 100 },
  { level: 3, name: 'Trusted', minPoints: 300 },
  { level: 4, name: 'Established', minPoints: 750 },
  { level: 5, name: 'Reputable', minPoints: 1500 },
  { level: 6, name: 'Elite', minPoints: 3000 },
  { level: 7, name: 'Legend', minPoints: 6000 },
] as const;

export function levelFor(lifetimePoints: number): ReputationLevel {
  let current = REPUTATION_LEVELS[0];
  for (const l of REPUTATION_LEVELS) {
    if (lifetimePoints >= l.minPoints) current = l;
    else break;
  }
  return current;
}

export function nextLevelAfter(level: number): ReputationLevel | null {
  return REPUTATION_LEVELS.find((l) => l.level === level + 1) ?? null;
}

/** Progress summary the apps render as a bar. */
export function levelProgress(lifetimePoints: number) {
  const current = levelFor(lifetimePoints);
  const next = nextLevelAfter(current.level);
  const span = next ? next.minPoints - current.minPoints : 0;
  const into = lifetimePoints - current.minPoints;
  return {
    level: current.level,
    name: current.name,
    badge: `LVL ${current.level}`,
    lifetimePoints,
    nextLevel: next
      ? { level: next.level, name: next.name, minPoints: next.minPoints }
      : null,
    pointsToNext: next ? Math.max(0, next.minPoints - lifetimePoints) : 0,
    progressPercent: next
      ? Math.min(100, Math.round((into / span) * 100))
      : 100,
  };
}

// ─── Earning rules ────────────────────────────────────────────────────────────

export type LedgerOwnerKind = 'customer' | 'pharmacy';

export interface EarningRule {
  key: string;
  reason: PointsReason;
  owner: LedgerOwnerKind;
  points: number;
  description: string;
  /** Source domain event */
  event: string;
  /** Max awards of this rule per owner per calendar day (UTC); undefined = unlimited */
  dailyCap?: number;
}

export const EARNING_RULES: readonly EarningRule[] = [
  {
    key: 'customer.registration',
    reason: 'registration',
    owner: 'customer',
    points: 50,
    description: 'Create and verify your FADA account',
    event: 'auth.user.verified',
  },
  {
    key: 'pharmacy.registration',
    reason: 'registration',
    owner: 'pharmacy',
    points: 100,
    description: 'Register your pharmacy on FADA',
    event: 'pharmacy.registered',
  },
  {
    key: 'customer.reservation_completed',
    reason: 'reservation_completed',
    owner: 'customer',
    points: 10,
    description: 'Pick up a reservation',
    event: 'reservation.served',
  },
  {
    key: 'pharmacy.reservation_completed',
    reason: 'reservation_completed',
    owner: 'pharmacy',
    points: 20,
    description: 'Serve a customer reservation',
    event: 'reservation.served',
  },
  {
    key: 'pharmacy.drug_added',
    reason: 'drug_added',
    owner: 'pharmacy',
    points: 5,
    description: 'Add a drug to your inventory (up to 50 drugs a day)',
    event: 'inventory.drug.added',
    dailyCap: 50,
  },
  {
    key: 'pharmacy.ad_launched',
    reason: 'ad_launched',
    owner: 'pharmacy',
    points: 15,
    description: 'Launch an ad campaign',
    event: 'ads.campaign.activated',
  },
  {
    key: 'customer.profile_completed',
    reason: 'profile_completed',
    owner: 'customer',
    points: 20,
    description: 'Complete your profile',
    event: 'customer.profile.completed',
  },
  {
    key: 'pharmacy.profile_completed',
    reason: 'profile_completed',
    owner: 'pharmacy',
    points: 30,
    description:
      'Complete your pharmacy profile (photo, address, hours, contact)',
    event: 'pharmacy.profile.completed',
  },
] as const;

export function ruleByKey(key: string): EarningRule {
  const rule = EARNING_RULES.find((r) => r.key === key);
  if (!rule) throw new Error(`Unknown earning rule ${key}`);
  return rule;
}
