import { describe, expect, it } from 'vitest';
import {
  RELICS, RELIC_BY_ID, Satchel, bankedValue, buyUpgrade, eligibleRelics, loadoutFor, placeLoot, lootValueByZone,
  relicValue, rollRelic, speedFactor, staminaDrainFactor, upgradeCost, NO_UPGRADES, type LootSpotDef,
} from '../src/core/economy';
import { Rng } from '../src/core/rng';
import { SCENE_INFO, SCENE_ORDER, ZONE_RANK } from '../src/core/types';

describe('relic table', () => {
  it('has at least 15 relic types with unique ids', () => {
    expect(RELICS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(RELICS.map((r) => r.id)).size).toBe(RELICS.length);
  });
  it('gives every relic a positive value and weight', () => {
    for (const r of RELICS) { expect(r.baseValue).toBeGreaterThan(0); expect(r.weight).toBeGreaterThan(0); }
  });
  it('covers several rarities and a spread of weights', () => {
    expect(new Set(RELICS.map((r) => r.rarity)).size).toBeGreaterThanOrEqual(5);
    const w = RELICS.map((r) => r.weight);
    expect(Math.max(...w) / Math.min(...w)).toBeGreaterThan(10);
  });
});

describe('value by depth', () => {
  it('makes the same relic worth more the deeper it is found', () => {
    const order = [...SCENE_ORDER].sort((a, b) => SCENE_INFO[a].depthRank - SCENE_INFO[b].depthRank);
    for (let i = 1; i < order.length; i++) {
      expect(relicValue('pouch', order[i])).toBeGreaterThanOrEqual(relicValue('pouch', order[i - 1]));
    }
    expect(relicValue('pouch', 'vault')).toBeGreaterThan(relicValue('pouch', 'jungle') * 3);
  });
  it('applies the scene multiplier to the base value', () => {
    expect(relicValue('crown', 'vault')).toBe(Math.round(1600 * 3.2));
    expect(relicValue('votive', 'jungle')).toBe(40);
  });
  it('throws on an unknown relic', () => { expect(() => relicValue('nope', 'vault')).toThrow(); });
});

describe('loot rolls', () => {
  it('never rolls a relic shallower than allowed or a unique', () => {
    const rng = new Rng(7);
    for (const scene of SCENE_ORDER) {
      for (let i = 0; i < 200; i++) {
        const r = rollRelic(scene, rng, i % 2 === 0);
        expect(r.rarity).not.toBe('unique');
        expect(ZONE_RANK[r.minZone]).toBeLessThanOrEqual(ZONE_RANK[SCENE_INFO[scene].zone]);
        if (r.onlyIn) expect(r.onlyIn).toContain(scene);
      }
    }
  });
  it('keeps scene exclusives where they belong', () => {
    expect(eligibleRelics('vault').some((r) => r.id === 'crown')).toBe(true);
    expect(eligibleRelics('catacombs').some((r) => r.id === 'crown')).toBe(false);
    expect(eligibleRelics('cliffs').some((r) => r.id === 'opal')).toBe(true);
    expect(eligibleRelics('jungle').some((r) => r.id === 'opal')).toBe(false);
  });
  it('rich spots skew toward rarer relics', () => {
    const avg = (rich: boolean) => {
      const rng = new Rng(99); let s = 0;
      for (let i = 0; i < 2000; i++) s += rollRelic('halls', rng, rich).baseValue;
      return s / 2000;
    };
    expect(avg(true)).toBeGreaterThan(avg(false) * 1.2);
  });
  it('is deterministic for a seed and honours fixed spots', () => {
    const spots: LootSpotDef[] = [
      { id: 'a', scene: 'jungle', pos: [0, 0, 0] }, { id: 'b', scene: 'sanctum', pos: [0, 0, 0], fixed: 'jaguarIdol' },
      { id: 'c', scene: 'vault', pos: [0, 0, 0], rich: true },
    ];
    const one = placeLoot(spots, 1234), two = placeLoot(spots, 1234);
    expect(one.map((p) => p.relic.id)).toEqual(two.map((p) => p.relic.id));
    expect(one[1].relic.id).toBe('jaguarIdol');
    expect(lootValueByZone(one).B).toBe(relicValue('jaguarIdol', 'sanctum'));
  });
});

describe('satchel and encumbrance', () => {
  const item = (id: string) => ({ relicId: id, value: relicValue(id, 'vault'), weight: RELIC_BY_ID[id].weight, scene: 'vault' as const });
  it('totals value and weight', () => {
    const s = new Satchel(12);
    expect(s.add(item('crown'))).toBe(true);
    expect(s.add(item('pouch'))).toBe(true);
    expect(s.weight).toBeCloseTo(5.1);
    expect(s.value).toBe(relicValue('crown', 'vault') + relicValue('pouch', 'vault'));
  });
  it('refuses a pickup that would exceed capacity', () => {
    const s = new Satchel(12);
    expect(s.add(item('calendar'))).toBe(true);
    expect(s.add(item('ingot'))).toBe(false);
    expect(s.items.length).toBe(1);
  });
  it('drops the most recent relic', () => {
    const s = new Satchel(12);
    s.add(item('crown')); s.add(item('pouch'));
    expect(s.removeLast()!.relicId).toBe('pouch');
    expect(s.removeLast()!.relicId).toBe('crown');
    expect(s.removeLast()).toBeNull();
  });
  it('slows the player as load rises', () => {
    expect(speedFactor(0, 12)).toBe(1);
    expect(speedFactor(6, 12)).toBeLessThan(1);
    expect(speedFactor(12, 12)).toBeCloseTo(0.45);
    expect(speedFactor(6, 12)).toBeGreaterThan(speedFactor(12, 12));
    expect(speedFactor(50, 12)).toBeCloseTo(0.45);
  });
  it('drains stamina faster as load rises', () => {
    expect(staminaDrainFactor(0, 12)).toBe(1);
    expect(staminaDrainFactor(12, 12)).toBeCloseTo(2.5);
    expect(staminaDrainFactor(6, 12)).toBeGreaterThan(1);
  });
  it('a bigger satchel makes the same load lighter', () => {
    expect(speedFactor(10, 26)).toBeGreaterThan(speedFactor(10, 12));
  });
  it('only banks loot on escape', () => {
    const s = new Satchel(12); s.add(item('crown'));
    expect(bankedValue('escaped', s)).toBe(s.value);
    expect(bankedValue('caught', s)).toBe(0);
    expect(bankedValue('killed', s)).toBe(0);
    expect(bankedValue('entombed', s)).toBe(0);
  });
});

describe('shop', () => {
  it('charges rising prices and stops at max level', () => {
    const w = { gold: 100000, upgrades: { ...NO_UPGRADES } };
    const c0 = upgradeCost('torch', 0)!, c1 = upgradeCost('torch', 1)!;
    expect(c1).toBeGreaterThan(c0);
    expect(buyUpgrade(w, 'torch')).toBe(true);
    expect(buyUpgrade(w, 'torch')).toBe(true);
    expect(buyUpgrade(w, 'torch')).toBe(false);
    expect(w.gold).toBe(100000 - c0 - c1);
    expect(upgradeCost('torch', 2)).toBeNull();
  });
  it('refuses when gold is short', () => {
    const w = { gold: 10, upgrades: { ...NO_UPGRADES } };
    expect(buyUpgrade(w, 'satchel')).toBe(false);
    expect(w.gold).toBe(10);
    expect(w.upgrades.satchel).toBe(0);
  });
  it('turns levels into a better loadout', () => {
    const base = loadoutFor(NO_UPGRADES), top = loadoutFor({ torch: 2, fuel: 2, rope: 1, satchel: 2 });
    expect(top.torchRadius).toBeGreaterThan(base.torchRadius);
    expect(top.burnTime).toBeGreaterThan(base.burnTime);
    expect(top.capacity).toBeGreaterThan(base.capacity);
    expect(top.flasks).toBe(2);
    expect(top.ropes).toBe(1);
  });
});
