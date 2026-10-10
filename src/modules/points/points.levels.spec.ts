import {
  EARNING_RULES,
  levelFor,
  levelProgress,
  nextLevelAfter,
  ruleByKey,
} from './points.levels';

describe('points.levels', () => {
  it('maps lifetime points to the right level', () => {
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100).level).toBe(2);
    expect(levelFor(749).level).toBe(3);
    expect(levelFor(750).level).toBe(4);
    expect(levelFor(999999).level).toBe(7);
  });

  it('reports progress toward the next level', () => {
    const p = levelProgress(200);
    expect(p.level).toBe(2);
    expect(p.nextLevel?.level).toBe(3);
    expect(p.pointsToNext).toBe(100);
    expect(p.progressPercent).toBe(50);
    expect(p.badge).toBe('LVL 2');
  });

  it('caps progress at the top level', () => {
    const p = levelProgress(10000);
    expect(p.nextLevel).toBeNull();
    expect(p.pointsToNext).toBe(0);
    expect(p.progressPercent).toBe(100);
    expect(nextLevelAfter(7)).toBeNull();
  });

  it('matches the product spec points table', () => {
    expect(ruleByKey('customer.registration').points).toBe(50);
    expect(ruleByKey('pharmacy.registration').points).toBe(100);
    expect(ruleByKey('customer.reservation_completed').points).toBe(10);
    expect(ruleByKey('pharmacy.reservation_completed').points).toBe(20);
    expect(ruleByKey('pharmacy.drug_added').points).toBe(5);
    expect(ruleByKey('pharmacy.ad_launched').points).toBe(15);
    expect(ruleByKey('customer.profile_completed').points).toBe(20);
    expect(ruleByKey('pharmacy.profile_completed').points).toBe(30);
    expect(new Set(EARNING_RULES.map((r) => r.key)).size).toBe(
      EARNING_RULES.length,
    );
  });
});
