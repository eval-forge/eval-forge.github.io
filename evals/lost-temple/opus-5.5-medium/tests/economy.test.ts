import { describe, it, expect } from 'vitest';
import { Satchel, makeCarried, speedFactor, staminaDrainFactor, settleRun, buyUpgrade, NO_UPGRADES, satchelCapacity, insertHighScore, upgradePrice } from '../src/logic/economy';
import { RELICS, relicValue, pickRelic, lootPool, expectedSpotValue, ZONE_MULTIPLIER } from '../src/logic/relics';

describe('relics', () => {
  it('has at least 15 relic types', () => {
    expect(RELICS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(RELICS.map((r) => r.id)).size).toBe(RELICS.length);
  });
  it('is worth more the deeper it is found', () => {
    const bell = RELICS.find((r) => r.id === 'bell')!;
    expect(relicValue(bell, 'A')).toBeLessThan(relicValue(bell, 'B'));
    expect(relicValue(bell, 'B')).toBeLessThan(relicValue(bell, 'C'));
    expect(relicValue(bell, 'C')).toBe(Math.round(80 * ZONE_MULTIPLIER.C));
  });
  it('loot pools never contain keys or uniques', () => {
    for (const z of ['A', 'B', 'C'] as const) {
      for (const r of lootPool(z)) expect(['key', 'unique']).not.toContain(r.rarity);
    }
  });
  it('rarity-weighted picks stay in the zone pool and favour commons', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const r = pickRelic('C', i / 1000);
      expect(r.zones).toContain('C');
      counts[r.rarity] = (counts[r.rarity] ?? 0) + 1;
    }
    expect((counts.common ?? 0) + (counts.uncommon ?? 0)).toBeGreaterThan(counts.epic ?? 0);
  });
  it('expected spot value rises by zone', () => {
    expect(expectedSpotValue('A')).toBeLessThan(expectedSpotValue('B'));
    expect(expectedSpotValue('B')).toBeLessThan(expectedSpotValue('C'));
  });
});

describe('satchel and weight', () => {
  it('tracks weight and value and enforces capacity', () => {
    const s = new Satchel(10);
    expect(s.add(makeCarried('ingot', 'C'))).toBe(true); // 9 kg
    expect(s.add(makeCarried('bell', 'A'))).toBe(false); // +2.5 > 10
    expect(s.add(makeCarried('necklace', 'A'))).toBe(true);
    expect(s.weight).toBeCloseTo(9.4);
    expect(s.value).toBe(900 + 60);
  });
  it('slows you down and drains stamina faster with more weight', () => {
    expect(speedFactor(0, 20)).toBe(1);
    expect(speedFactor(20, 20)).toBeCloseTo(0.5);
    expect(speedFactor(10, 20)).toBeLessThan(1);
    expect(speedFactor(10, 20)).toBeGreaterThan(speedFactor(15, 20));
    expect(staminaDrainFactor(0, 20)).toBe(1);
    expect(staminaDrainFactor(20, 20)).toBeCloseTo(2.5);
  });
  it('only banks loot when you escape', () => {
    expect(settleRun(true, 1234.4)).toBe(1234);
    expect(settleRun(false, 9999)).toBe(0);
  });
  it('takes keys out by type', () => {
    const s = new Satchel(20);
    s.add(makeCarried('sundisc', 'A'));
    expect(s.has('sundisc')).toBe(true);
    expect(s.takeType('sundisc')?.typeId).toBe('sundisc');
    expect(s.has('sundisc')).toBe(false);
  });
});

describe('shop', () => {
  it('buys upgrades when affordable and stops at max level', () => {
    let st = { bank: 10000, ups: { ...NO_UPGRADES } };
    for (let i = 0; i < 3; i++) st = buyUpgrade(st.bank, st.ups, 'satchel')!;
    expect(st.ups.satchel).toBe(3);
    expect(satchelCapacity(st.ups.satchel)).toBe(45);
    expect(buyUpgrade(st.bank, st.ups, 'satchel')).toBeNull();
    expect(upgradePrice('satchel', 3)).toBeNull();
  });
  it('refuses when broke', () => {
    expect(buyUpgrade(10, NO_UPGRADES, 'torch')).toBeNull();
  });
  it('keeps a sorted high score table', () => {
    let t = insertHighScore([], { value: 100, time: 300, relics: 2, date: '', escaped: true });
    t = insertHighScore(t, { value: 500, time: 600, relics: 5, date: '', escaped: true });
    t = insertHighScore(t, { value: 300, time: 400, relics: 3, date: '', escaped: true });
    expect(t.map((e) => e.value)).toEqual([500, 300, 100]);
  });
});
