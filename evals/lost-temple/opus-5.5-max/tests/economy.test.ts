import { describe, it, expect } from 'vitest';
import {
  RELICS, RELIC_IDS, ZONE_MULTIPLIER, relicValue, rollRelicType, relicsForZone, Satchel, LootLedger, makeRelic,
  settleRun, purchase, defaultUpgrades, nextUpgradeCost, gearFromUpgrades, expectedSpawnValue, SHOP,
} from '../src/logic/economy';
import { Rng } from '../src/logic/rng';

describe('relic table', () => {
  it('has at least 15 relic types with distinct values and weights', () => {
    expect(RELIC_IDS.length).toBeGreaterThanOrEqual(15);
    const values = new Set(RELIC_IDS.map((id) => RELICS[id].base));
    const weights = new Set(RELIC_IDS.map((id) => RELICS[id].weight));
    expect(values.size).toBeGreaterThanOrEqual(15);
    expect(weights.size).toBeGreaterThanOrEqual(10);
  });
  it('covers every rarity', () => {
    const rarities = new Set(RELIC_IDS.map((id) => RELICS[id].rarity));
    for (const r of ['common', 'uncommon', 'rare', 'legendary', 'unique']) expect(rarities.has(r as any)).toBe(true);
  });
  it('every zone has relics to roll', () => {
    for (const z of ['A', 'B', 'C'] as const) expect(relicsForZone(z).length).toBeGreaterThan(3);
  });
});

describe('relic value', () => {
  it('is worth more the deeper it is found', () => {
    for (const id of ['coinPouch', 'jadeFigurine'] as const) {
      expect(relicValue(id, 'B')).toBeGreaterThan(relicValue(id, 'A'));
      expect(relicValue(id, 'C')).toBeGreaterThan(relicValue(id, 'B'));
    }
    expect(ZONE_MULTIPLIER.A).toBeLessThan(ZONE_MULTIPLIER.B);
    expect(ZONE_MULTIPLIER.B).toBeLessThan(ZONE_MULTIPLIER.C);
  });
  it('applies condition and rounds to 5', () => {
    expect(relicValue('coinPouch', 'A', 1)).toBe(90);
    expect(relicValue('jadeFigurine', 'C', 1)).toBe(550);
    expect(relicValue('jadeFigurine', 'C', 1.1) % 5).toBe(0);
    // condition is clamped
    expect(relicValue('goldIngot', 'C', 5)).toBe(relicValue('goldIngot', 'C', 1.15));
  });
  it('rolls only relics allowed in the zone and never fixed-only ones', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 500; i++) {
      const id = rollRelicType('A', rng);
      expect(RELICS[id].zones).toContain('A');
      expect(RELICS[id].fixedOnly).toBeFalsy();
    }
  });
  it('respects rarity bands', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 200; i++) {
      const id = rollRelicType('C', rng, 'rare', 'legendary');
      expect(['rare', 'legendary']).toContain(RELICS[id].rarity);
    }
  });
  it('deeper zones have higher expected spawn value', () => {
    expect(expectedSpawnValue('B')).toBeGreaterThan(expectedSpawnValue('A'));
    expect(expectedSpawnValue('C')).toBeGreaterThan(expectedSpawnValue('B'));
  });
});

describe('satchel and ledger', () => {
  it('enforces capacity by weight', () => {
    const s = new Satchel(20);
    expect(s.add(makeRelic('a', 'goldIngot', 'C', 1))).toBe(true);
    expect(s.add(makeRelic('b', 'sunTablet', 'C', 1))).toBe(true); // 19.5 kg
    expect(s.add(makeRelic('c', 'coinPouch', 'C', 1))).toBe(false); // would be 21.5
    expect(s.weight).toBeCloseTo(19.5);
    expect(s.loadFraction).toBeCloseTo(0.975);
    expect(s.remove('a')?.type).toBe('goldIngot');
    expect(s.weight).toBeCloseTo(7.5);
  });
  it('banks everything carried', () => {
    const s = new Satchel(30);
    const l = new LootLedger(s);
    s.add(makeRelic('a', 'emeraldEye', 'C', 1));
    s.add(makeRelic('b', 'clayIdol', 'A', 1));
    const v = l.carriedValue;
    expect(l.bankAll()).toBe(v);
    expect(l.bankedValue).toBe(v);
    expect(l.carriedValue).toBe(0);
    expect(s.items.length).toBe(0);
  });
  it('sorts by value density', () => {
    const s = new Satchel(56);
    s.add(makeRelic('a', 'goldIngot', 'C', 1));
    s.add(makeRelic('b', 'emeraldEye', 'C', 1));
    expect(s.byDensity()[0].type).toBe('emeraldEye');
  });
});

describe('run settlement', () => {
  it('only loot carried out the door counts', () => {
    expect(settleRun('escaped', 1000, 500, true)).toMatchObject({ haul: 1500, lost: 0, success: true });
    expect(settleRun('caught', 1000, 500, false)).toMatchObject({ haul: 1000, lost: 500, success: false });
    expect(settleRun('killed', 0, 800, false)).toMatchObject({ haul: 0, lost: 800 });
    expect(settleRun('entombed', 200, 300, false)).toMatchObject({ haul: 200, lost: 300 });
  });
});

describe('shop', () => {
  it('buys levels in order and stops at max', () => {
    let u = defaultUpgrades();
    let money = 100000;
    for (let i = 0; i < 3; i++) {
      const r = purchase(money, u, 'satchel');
      expect(r.ok).toBe(true);
      money = r.money;
      u = r.upgrades;
    }
    expect(u.satchel).toBe(3);
    expect(purchase(money, u, 'satchel')).toMatchObject({ ok: false, reason: 'maxed' });
    expect(nextUpgradeCost('satchel', 3)).toBeNull();
  });
  it('refuses when broke', () => {
    expect(purchase(100, defaultUpgrades(), 'torch')).toMatchObject({ ok: false, reason: 'funds', money: 100 });
  });
  it('gear follows upgrades', () => {
    const base = gearFromUpgrades(defaultUpgrades());
    expect(base.satchelCapacity).toBe(20);
    expect(base.ropes).toBe(0);
    const up = gearFromUpgrades({ ...defaultUpgrades(), satchel: 2, torch: 2, fuel: 1, rope: 3, boots: 1 });
    expect(up.satchelCapacity).toBe(42);
    expect(up.torchRadiusMul).toBe(1.5);
    expect(up.gustResist).toBe(0.6);
    expect(up.fuelCapacity).toBe(140);
    expect(up.ropes).toBe(3);
    expect(up.staminaMax).toBe(125);
  });
  it('sells the four gear upgrades the brief names', () => {
    const ids = SHOP.map((s) => s.id);
    for (const id of ['torch', 'fuel', 'rope', 'satchel']) expect(ids).toContain(id);
  });
});
