import { describe, it, expect } from 'vitest';
import { RELICS, relicValue, rollRelic, speedMultiplier, staminaDrainMultiplier, canCarry, bankedHaul, buy, DEFAULT_UPGRADES, gearStats, insertScore, totalWeight } from '../src/logic/economy';
import { mulberry32 } from '../src/logic/rng';

describe('loot economy', () => {
  it('has at least 15 sellable relic types with distinct values, weights and rarities', () => {
    const sellable = RELICS.filter((r) => r.rarity !== 'key');
    expect(sellable.length).toBeGreaterThanOrEqual(15);
    expect(new Set(sellable.map((r) => r.rarity)).size).toBeGreaterThanOrEqual(4);
    for (const r of sellable) { expect(r.base).toBeGreaterThan(0); expect(r.weight).toBeGreaterThan(0); }
  });

  it('the same relic is worth more the deeper it is found', () => {
    const a = relicValue('mask', 'courtyard'), b = relicValue('mask', 'halls'), c = relicValue('mask', 'catacombs'), d = relicValue('mask', 'vault');
    expect(a).toBe(380);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(d).toBeGreaterThan(c);
  });

  it('rolls only relics allowed in the zone, deeper zones roll rarer on average', () => {
    const rand = mulberry32(42);
    let sumA = 0, sumC = 0;
    for (let i = 0; i < 2000; i++) {
      const ra = rollRelic(rand, 'A'); expect(ra.zones).toContain('A'); sumA += ra.base;
      const rc = rollRelic(rand, 'C'); expect(rc.zones).toContain('C'); sumC += rc.base;
      expect(['legendary', 'key']).not.toContain(rc.rarity);
    }
    expect(sumC / 2000).toBeGreaterThan(2 * (sumA / 2000));
  });

  it('weight slows you and drains stamina faster', () => {
    expect(speedMultiplier(0, 12)).toBe(1);
    expect(speedMultiplier(12, 12)).toBeCloseTo(0.6);
    expect(speedMultiplier(6, 12)).toBeLessThan(1);
    expect(speedMultiplier(6, 12)).toBeGreaterThan(0.6);
    expect(staminaDrainMultiplier(0, 12)).toBe(1);
    expect(staminaDrainMultiplier(12, 12)).toBeCloseTo(2.6);
    expect(speedMultiplier(6, 34)).toBeGreaterThan(speedMultiplier(6, 12));
  });

  it('enforces satchel capacity', () => {
    expect(canCarry(10, 2, 12)).toBe(true);
    expect(canCarry(10, 2.5, 12)).toBe(false);
    expect(totalWeight([{ weight: 1.5 }, { weight: 2 }])).toBe(3.5);
  });

  it('only escaped loot is banked', () => {
    const items = [{ value: 100 }, { value: 250 }];
    expect(bankedHaul('escaped', items)).toBe(350);
    expect(bankedHaul('caught', items)).toBe(0);
    expect(bankedHaul('killed', items)).toBe(0);
    expect(bankedHaul('sealed', items)).toBe(0);
  });

  it('shop buys tiers in order and refuses when broke or maxed', () => {
    expect(buy(100, DEFAULT_UPGRADES, 'torch')).toBeNull();
    const r1 = buy(3000, DEFAULT_UPGRADES, 'torch')!;
    expect(r1.bank).toBe(2400);
    expect(r1.upgrades.torch).toBe(1);
    const r2 = buy(r1.bank, r1.upgrades, 'torch')!;
    expect(r2.upgrades.torch).toBe(2);
    expect(buy(99999, r2.upgrades, 'torch')).toBeNull();
    expect(gearStats(r2.upgrades).torchRadius).toBe(12);
    expect(gearStats(DEFAULT_UPGRADES).satchelCapacity).toBe(12);
  });

  it('high score table keeps the top 10 sorted', () => {
    let t: any[] = [];
    for (let i = 0; i < 12; i++) t = insertScore(t, { value: i * 100, outcome: 'escaped', time: 100, relics: 1, date: '' }).table;
    expect(t.length).toBe(10);
    expect(t[0].value).toBe(1100);
    const { rank } = insertScore(t, { value: 50, outcome: 'escaped', time: 1, relics: 0, date: '' });
    expect(rank).toBe(-1);
  });
});
