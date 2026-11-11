import { describe, expect, it } from 'vitest';
import {
  GEAR, GEAR_ORDER, RELICS, RELIC_BY_ID, Satchel, baseGear, buyGear, expectedSpotValue, gearMaxed, jumpMultiplier,
  loadoutFor, nextPrice, relicValue, rollLoot, rollWeight, speedMultiplier, staminaDrainMultiplier,
  type LootSpot, type RelicId,
} from '../src/core/economy';
import { SCENES, SCENE_ORDER, type SceneId, type Zone } from '../src/core/scenes';
import { lootSpots } from '../src/world/layout';

describe('relic table', () => {
  it('has at least 15 relic types with distinct ids and names', () => {
    expect(RELICS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(RELICS.map((r) => r.id)).size).toBe(RELICS.length);
    expect(new Set(RELICS.map((r) => r.name)).size).toBe(RELICS.length);
  });

  it('gives every relic a positive value and weight', () => {
    for (const r of RELICS) {
      expect(r.base).toBeGreaterThan(0);
      expect(r.weight).toBeGreaterThan(0);
    }
  });

  it('varies value, weight and rarity', () => {
    expect(new Set(RELICS.map((r) => r.base)).size).toBeGreaterThan(10);
    expect(new Set(RELICS.map((r) => r.weight)).size).toBeGreaterThan(8);
    expect(new Set(RELICS.map((r) => r.rarity)).size).toBeGreaterThanOrEqual(5);
  });

  it('higher tiers are worth more on average', () => {
    const avg = (tier: number): number => {
      const rs = RELICS.filter((r) => r.tier === tier && !r.fixedOnly);
      return rs.reduce((s, r) => s + r.base, 0) / rs.length;
    };
    expect(avg(2)).toBeGreaterThan(avg(1));
    expect(avg(3)).toBeGreaterThan(avg(2));
  });
});

describe('depth pricing', () => {
  it('the same relic is worth more the deeper it is found', () => {
    const chain: SceneId[] = ['courtyard', 'cliffs', 'halls', 'sanctum', 'catacombs', 'vault'];
    for (const r of RELICS) {
      let prev = relicValue(r.id, 'jungle');
      for (const s of chain) {
        const v = relicValue(r.id, s);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
      expect(relicValue(r.id, 'vault')).toBeGreaterThan(relicValue(r.id, 'jungle'));
    }
  });

  it('multipliers rise strictly with depth past the courtyard', () => {
    const order = SCENE_ORDER.slice(1);
    for (let i = 1; i < order.length; i++) expect(SCENES[order[i]].mult).toBeGreaterThan(SCENES[order[i - 1]].mult);
  });

  it('rounds to 5 and applies the multiplier', () => {
    expect(relicValue('jade_mask', 'jungle')).toBe(320);
    expect(relicValue('jade_mask', 'vault')).toBe(Math.round((320 * 3.4) / 5) * 5);
    for (const r of RELICS) expect(relicValue(r.id, 'catacombs') % 5).toBe(0);
  });
});

describe('loot roll', () => {
  const spots = lootSpots();

  it('fills every spot, deterministically per seed', () => {
    const a = rollLoot(1234, spots);
    const b = rollLoot(1234, spots);
    expect(a.size).toBe(spots.length);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('different seeds give different temples', () => {
    const a = [...rollLoot(1, spots).values()].join(',');
    const b = [...rollLoot(2, spots).values()].join(',');
    expect(a).not.toBe(b);
  });

  it('never rolls a relic above the spot tier, and never rolls fixed-only relics', () => {
    for (let seed = 0; seed < 40; seed++) {
      const roll = rollLoot(seed, spots);
      for (const s of spots) {
        const id = roll.get(s.id) as RelicId;
        const def = RELIC_BY_ID[id];
        if (s.fixed) {
          expect(id).toBe(s.fixed);
        } else {
          expect(def.tier).toBeLessThanOrEqual(s.tier);
          expect(def.fixedOnly).toBeFalsy();
        }
      }
    }
  });

  it('fixed relics are where the design says', () => {
    const roll = rollLoot(99, spots);
    expect(roll.get('sanctum.idol')).toBe('dawn_idol');
    expect(roll.get('vault.coffer')).toBe('emperor_coffer');
  });

  it('favours relics that match the spot tier', () => {
    expect(rollWeight(RELIC_BY_ID.gold_mask, 3)).toBeGreaterThan(rollWeight(RELIC_BY_ID.jade_mask, 3));
    expect(rollWeight(RELIC_BY_ID.gold_mask, 2)).toBe(0);
    expect(rollWeight(RELIC_BY_ID.dawn_idol, 3)).toBe(0);
  });

  it('each scene holds more expected value than the one before', () => {
    const totals = SCENE_ORDER.map((id) => spots.filter((s) => s.scene === id).reduce((sum, s) => sum + expectedSpotValue(s), 0));
    for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeGreaterThan(totals[i - 1]);
  });

  it('each zone holds more loot than the one before, in expectation and in actual rolls', () => {
    const zoneTotal = (value: (s: LootSpot) => number): Record<Zone, number> => {
      const t: Record<Zone, number> = { A: 0, B: 0, C: 0 };
      for (const s of spots) t[SCENES[s.scene].zone] += value(s);
      return t;
    };
    const exp = zoneTotal(expectedSpotValue);
    expect(exp.B).toBeGreaterThan(exp.A * 2);
    expect(exp.C).toBeGreaterThan(exp.B * 2);
    for (let seed = 0; seed < 25; seed++) {
      const roll = rollLoot(seed, spots);
      const act = zoneTotal((s) => relicValue(roll.get(s.id) as RelicId, s.scene));
      expect(act.B).toBeGreaterThan(act.A);
      expect(act.C).toBeGreaterThan(act.B);
    }
  });

  it('has the spot counts from the design', () => {
    const count = (id: SceneId): number => spots.filter((s) => s.scene === id).length;
    expect(count('jungle')).toBe(4);
    expect(count('courtyard')).toBe(6);
    expect(count('cliffs')).toBe(4);
    expect(count('halls')).toBe(7);
    expect(count('sanctum')).toBe(6);
    expect(count('catacombs')).toBe(8);
    expect(count('vault')).toBe(9);
  });
});

describe('satchel', () => {
  it('sums value and weight of what it carries', () => {
    const s = new Satchel(20);
    s.add('jade_mask', 'halls', 'a');
    s.add('coin_stack', 'courtyard', 'b');
    expect(s.count).toBe(2);
    expect(s.weight).toBeCloseTo(3.1, 6);
    expect(s.value).toBe(relicValue('jade_mask', 'halls') + relicValue('coin_stack', 'courtyard'));
  });

  it('refuses a relic that would exceed capacity and stays unchanged', () => {
    const s = new Satchel(20);
    expect(s.add('gold_jaguar', 'vault', 'a')).not.toBeNull();
    expect(s.add('emperor_coffer', 'vault', 'b')).toBeNull();
    expect(s.count).toBe(1);
    expect(s.weight).toBe(12);
    expect(s.canFit(8)).toBe(true);
    expect(s.canFit(8.1)).toBe(false);
  });

  it('a bigger satchel carries more', () => {
    const s = new Satchel(36);
    expect(s.add('gold_jaguar', 'vault', 'a')).not.toBeNull();
    expect(s.add('emperor_coffer', 'vault', 'b')).not.toBeNull();
    expect(s.loadRatio).toBeCloseTo(28 / 36, 6);
  });

  it('drops the last or the heaviest relic', () => {
    const s = new Satchel(30);
    s.add('gem_urn', 'sanctum', 'a');
    s.add('ruby_scarab', 'sanctum', 'b');
    expect(s.dropHeaviest()?.relic).toBe('gem_urn');
    expect(s.dropLast()?.relic).toBe('ruby_scarab');
    expect(s.dropLast()).toBeNull();
    expect(s.value).toBe(0);
  });

  it('a dropped relic keeps the value it was found at when picked up again', () => {
    const s = new Satchel(30);
    const item = s.add('crystal_skull', 'vault', 'a')!;
    s.dropLast();
    expect(s.addCarried(item)).toBe(true);
    expect(s.value).toBe(relicValue('crystal_skull', 'vault'));
  });

  it('key items weigh something but are worth nothing', () => {
    const s = new Satchel(20);
    s.addKey('sun_disc');
    expect(s.weight).toBeCloseTo(1.5, 6);
    expect(s.value).toBe(0);
    expect(s.hasKey('sun_disc')).toBe(true);
    expect(s.useKey('sun_disc')).toBe(true);
    expect(s.weight).toBe(0);
    expect(s.useKey('sun_disc')).toBe(false);
  });

  it('load ratio is clamped to 0..1', () => {
    const s = new Satchel(1);
    expect(s.loadRatio).toBe(0);
    s.addKey('sun_disc');
    expect(s.loadRatio).toBe(1);
  });
});

describe('weight slows you down', () => {
  it('an empty satchel costs nothing', () => {
    expect(speedMultiplier(0)).toBe(1);
    expect(staminaDrainMultiplier(0)).toBe(1);
    expect(jumpMultiplier(0)).toBe(1);
  });

  it('speed falls and stamina drain rises monotonically with load', () => {
    let ps = 1;
    let pd = 1;
    for (let r = 0.05; r <= 1.0001; r += 0.05) {
      expect(speedMultiplier(r)).toBeLessThan(ps);
      expect(staminaDrainMultiplier(r)).toBeGreaterThan(pd);
      ps = speedMultiplier(r);
      pd = staminaDrainMultiplier(r);
    }
  });

  it('a full satchel roughly halves speed and more than doubles stamina drain', () => {
    expect(speedMultiplier(1)).toBeCloseTo(0.55, 6);
    expect(staminaDrainMultiplier(1)).toBeCloseTo(2.2, 6);
    expect(jumpMultiplier(1)).toBeCloseTo(0.85, 6);
  });

  it('light loads barely matter (the curve is convex)', () => {
    expect(speedMultiplier(0.25)).toBeGreaterThan(0.94);
  });

  it('clamps out-of-range ratios', () => {
    expect(speedMultiplier(3)).toBe(speedMultiplier(1));
    expect(speedMultiplier(-1)).toBe(1);
  });
});

describe('shop', () => {
  it('sells torch, fuel, rope and satchel upgrades', () => {
    for (const id of ['torch', 'fuel', 'rope', 'satchel'] as const) expect(GEAR[id].prices.length).toBeGreaterThan(0);
    expect(GEAR_ORDER.length).toBe(Object.keys(GEAR).length);
  });

  it('every gear has one more stat value than it has prices', () => {
    for (const id of GEAR_ORDER) expect(GEAR[id].values.length).toBe(GEAR[id].prices.length + 1);
  });

  it('refuses a purchase you cannot afford', () => {
    const gear = baseGear();
    expect(buyGear(399, gear, 'torch')).toBeNull();
    expect(gear.torch).toBe(0);
  });

  it('charges the tier price and raises the level', () => {
    const gear = baseGear();
    expect(buyGear(1000, gear, 'torch')).toBe(600);
    expect(gear.torch).toBe(1);
    expect(nextPrice(gear, 'torch')).toBe(1200);
  });

  it('stops at the top tier', () => {
    const gear = baseGear();
    let coins = 100000;
    coins = buyGear(coins, gear, 'satchel')!;
    coins = buyGear(coins, gear, 'satchel')!;
    expect(gearMaxed(gear, 'satchel')).toBe(true);
    expect(nextPrice(gear, 'satchel')).toBeNull();
    expect(buyGear(coins, gear, 'satchel')).toBeNull();
  });

  it('upgrades change the loadout', () => {
    const gear = baseGear();
    const base = loadoutFor(gear);
    expect(base).toEqual({ torchRadius: 13, fuelCapacity: 210, satchelCapacity: 20, ropes: 0, spareTorches: 1, footstepNoise: 1 });
    gear.torch = 2;
    gear.fuel = 1;
    gear.satchel = 2;
    gear.rope = 1;
    gear.spares = 2;
    gear.soles = 1;
    expect(loadoutFor(gear)).toEqual({
      torchRadius: 19, fuelCapacity: 300, satchelCapacity: 36, ropes: 1, spareTorches: 3, footstepNoise: 0.6,
    });
  });

  it('every upgrade is strictly better than the tier before', () => {
    for (const id of ['torch', 'fuel', 'satchel', 'rope', 'spares'] as const) {
      const v = GEAR[id].values;
      for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThan(v[i - 1]);
    }
    expect(GEAR.soles.values[1]).toBeLessThan(GEAR.soles.values[0]);
  });
});
