import { describe, it, expect } from 'vitest';
import {
  RELICS, RELIC_BY_ID, relicValue, rollRelic, expectedSlotValue, Satchel, makeInstance,
  speedMultiplier, staminaDrainMultiplier, settleRun, satchelCapacity, ZONE_MULT, handsSpeedMultiplier,
} from '../src/logic/economy';
import { Rng } from '../src/core/rng';
import { buyUpgrade, defaultSave, upgradeCost, bankHaul, addScore, parseSave, serializeSave, maybeStoreGhost } from '../src/logic/meta';

describe('relic table', () => {
  it('has at least 15 distinct relic types with unique ids', () => {
    expect(RELICS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(RELICS.map((r) => r.id)).size).toBe(RELICS.length);
  });
  it('every relic has positive value and weight', () => {
    for (const r of RELICS) {
      expect(r.base).toBeGreaterThan(0);
      expect(r.weight).toBeGreaterThan(0);
    }
  });
  it('the same relic is worth more the deeper it is found', () => {
    const r = RELIC_BY_ID['silver_chalice'];
    expect(relicValue(r, 'A')).toBe(180);
    expect(relicValue(r, 'B')).toBeGreaterThan(relicValue(r, 'A'));
    expect(relicValue(r, 'C')).toBeGreaterThan(relicValue(r, 'B'));
    expect(ZONE_MULT.C).toBeGreaterThan(ZONE_MULT.B);
  });
  it('values are rounded to 5', () => {
    for (const r of RELICS) for (const z of ['A', 'B', 'C'] as const) expect(relicValue(r, z) % 5).toBe(0);
  });
});

describe('slot rolls', () => {
  it('only rolls relics allowed in the zone, never the unique idol', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 500; i++) {
      const r = rollRelic(rng, { zone: 'A' });
      expect(r.zones).toContain('A');
      expect(r.unique).toBeFalsy();
      expect(r.rarity).not.toBe('legendary');
    }
  });
  it('legendary relics only roll where allowed', () => {
    const rng = new Rng(7);
    let legendary = 0;
    for (let i = 0; i < 3000; i++) if (rollRelic(rng, { zone: 'C', allowLegendary: true }).rarity === 'legendary') legendary++;
    expect(legendary).toBeGreaterThan(0);
  });
  it('respects minRarity and maxWeight', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 300; i++) {
      const r = rollRelic(rng, { zone: 'B', minRarity: 'rare', maxWeight: 4 });
      expect(['rare', 'epic', 'legendary']).toContain(r.rarity);
      expect(r.weight).toBeLessThanOrEqual(4);
    }
  });
  it('is deterministic for a seed', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    for (let i = 0; i < 50; i++) expect(rollRelic(a, { zone: 'C' }).id).toBe(rollRelic(b, { zone: 'C' }).id);
  });
  it('fixed slots return the fixed relic', () => {
    expect(rollRelic(new Rng(1), { zone: 'B', fixed: 'sun_idol' }).id).toBe('sun_idol');
  });
  it('expected slot value grows with depth', () => {
    const a = expectedSlotValue({ zone: 'A' });
    const b = expectedSlotValue({ zone: 'B' });
    const c = expectedSlotValue({ zone: 'C', allowLegendary: true });
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe('satchel and weight', () => {
  it('refuses relics over capacity', () => {
    const s = new Satchel(10);
    expect(s.add(makeInstance('a', RELIC_BY_ID['gold_ingot'], 'B'))).toBe(true);
    expect(s.add(makeInstance('b', RELIC_BY_ID['gem_urn'], 'B'))).toBe(false);
    expect(s.add(makeInstance('c', RELIC_BY_ID['scroll_case'], 'B'))).toBe(true);
    expect(s.weight()).toBeCloseTo(9);
    expect(s.items.length).toBe(2);
  });
  it('tracks value and removes last', () => {
    const s = new Satchel(18);
    s.add(makeInstance('a', RELIC_BY_ID['bone_flute'], 'A'));
    s.add(makeInstance('b', RELIC_BY_ID['ruby_heart'], 'C'));
    expect(s.value()).toBe(80 + relicValue(RELIC_BY_ID['ruby_heart'], 'C'));
    expect(s.removeLast()?.uid).toBe('b');
    expect(s.value()).toBe(80);
  });
  it('carrying more slows you down and drains stamina faster', () => {
    expect(speedMultiplier(0, 18)).toBe(1);
    expect(speedMultiplier(9, 18)).toBeLessThan(1);
    expect(speedMultiplier(18, 18)).toBeCloseTo(0.55);
    expect(speedMultiplier(99, 18)).toBeCloseTo(0.55);
    expect(staminaDrainMultiplier(0, 18)).toBe(1);
    expect(staminaDrainMultiplier(18, 18)).toBeCloseTo(2.5);
    expect(handsSpeedMultiplier(1)).toBe(1);
    expect(handsSpeedMultiplier(18)).toBeLessThan(handsSpeedMultiplier(6));
  });
  it('capacity grows with satchel upgrades', () => {
    expect(satchelCapacity(0)).toBe(18);
    expect(satchelCapacity(3)).toBe(44);
    expect(satchelCapacity(99)).toBe(44);
  });
});

describe('run settlement', () => {
  const stash = [makeInstance('s1', RELIC_BY_ID['silver_chalice'], 'A')];
  const carried = [makeInstance('c1', RELIC_BY_ID['crystal_skull'], 'C')];
  it('escaping keeps stash and carried loot', () => {
    const r = settleRun('escaped', stash, carried);
    expect(r.haul).toBe(180 + relicValue(RELIC_BY_ID['crystal_skull'], 'C'));
    expect(r.lostValue).toBe(0);
    expect(r.relicsOut).toBe(2);
  });
  it('getting caught loses everything carried but not what already left the temple', () => {
    const r = settleRun('caught', stash, carried);
    expect(r.haul).toBe(180);
    expect(r.lostValue).toBe(relicValue(RELIC_BY_ID['crystal_skull'], 'C'));
    expect(r.escaped).toBe(false);
  });
  it('being sealed in is a loss too', () => {
    expect(settleRun('sealed', [], carried).haul).toBe(0);
  });
});

describe('shop and save', () => {
  it('buys upgrades only with enough money and up to max level', () => {
    let s = defaultSave();
    expect(buyUpgrade(s, 'satchel')).toEqual({ ok: false, reason: 'funds' });
    s = bankHaul(s, 10000);
    expect(s.bank).toBe(10000);
    const r1 = buyUpgrade(s, 'satchel');
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.save.upgrades.satchel).toBe(1);
      expect(r1.save.bank).toBe(10000 - 500);
      s = r1.save;
    }
    s = { ...s, upgrades: { ...s.upgrades, rope: 2 } };
    expect(upgradeCost(s, 'rope')).toBeNull();
    expect(buyUpgrade(s, 'rope')).toEqual({ ok: false, reason: 'maxed' });
  });
  it('keeps the top 10 scores sorted by haul', () => {
    let s = defaultSave();
    for (let i = 0; i < 12; i++) s = addScore(s, { haul: i * 100, outcome: 'escaped', timeSurvived: 300, relics: i, date: '', deepest: 'halls' }).save;
    expect(s.highScores.length).toBe(10);
    expect(s.highScores[0].haul).toBe(1100);
    expect(s.highScores[9].haul).toBe(200);
    const r = addScore(s, { haul: 50, outcome: 'caught', timeSurvived: 1, relics: 0, date: '', deepest: 'jungle' });
    expect(r.rank).toBe(-1);
  });
  it('round-trips and survives corrupt saves', () => {
    const s = bankHaul(defaultSave(), 1234);
    expect(parseSave(serializeSave(s)).bank).toBe(1234);
    expect(parseSave('{not json').bank).toBe(0);
    expect(parseSave(JSON.stringify({ bank: -50, upgrades: { torch: 99 } })).upgrades.torch).toBe(3);
    expect(parseSave(JSON.stringify({ bank: -50 })).bank).toBe(0);
  });
  it('stores a ghost only for a better escaped run', () => {
    let s = defaultSave();
    const samples = new Array(40).fill(1.234);
    s = maybeStoreGhost(s, 500, true, samples);
    expect(s.ghost?.haul).toBe(500);
    expect(maybeStoreGhost(s, 400, true, samples).ghost?.haul).toBe(500);
    expect(maybeStoreGhost(s, 900, false, samples).ghost?.haul).toBe(500);
  });
});
