import { describe, it, expect } from 'vitest';
import { reachable, isUnlocked, doAction, canDo, neighbours, nextObjective, type Flags } from '../src/logic/unlocks';
import { sundialAligned, bestStep, SUNDIAL_STEPS } from '../src/logic/sundial';
import { sunDirection, DAY_LENGTH } from '../src/logic/countdown';

describe('scene unlock logic', () => {
  it('only zone A is reachable at the start', () => {
    const r = reachable('jungle', {});
    expect([...r].sort()).toEqual(['cliffs', 'courtyard', 'jungle']);
  });

  it('sun-disc requires the sundial; seal requires the sun-disc', () => {
    let f: Flags = {};
    expect(canDo('takeSunDisc', f)).toBe(false);
    expect(canDo('openSeal', f)).toBe(false);
    f = doAction('openSeal', f);
    expect(f.sealOpen).toBeUndefined();
    f = doAction('solveSundial', f);
    f = doAction('takeSunDisc', f);
    f = doAction('openSeal', f);
    expect(f.sealOpen).toBe(true);
  });

  it('full chain unlocks the vault in order', () => {
    let f: Flags = { doorOpened: true };
    expect(isUnlocked('halls', f)).toBe(true);
    expect(isUnlocked('sanctum', f)).toBe(false);
    f = { ...f, sanctumGateHeld: true };
    expect(isUnlocked('sanctum', f)).toBe(true);
    expect(isUnlocked('catacombs', f)).toBe(false);
    f = { ...f, sealOpen: true };
    expect(isUnlocked('catacombs', f)).toBe(true);
    expect(isUnlocked('vault', f)).toBe(false);
    f = doAction('openVault', f);
    expect(f.vaultOpen).toBeUndefined();
    f = doAction('takeKey', f);
    f = doAction('openVault', f);
    expect(isUnlocked('vault', f)).toBe(true);
  });

  it('shortcuts are one-way', () => {
    // with the wall kicked you can go catacombs → halls, but that edge alone does not open halls → catacombs
    const f: Flags = { doorOpened: true, wallKicked: true };
    expect(reachable('halls', f).has('catacombs')).toBe(false);
    expect(reachable('catacombs', f).has('halls')).toBe(true);
  });

  it('streaming neighbours ignore requirements', () => {
    expect(neighbours('halls').sort()).toEqual(['catacombs', 'courtyard', 'sanctum']);
  });

  it('objective hints follow progress', () => {
    expect(nextObjective({})).toMatch(/great door/);
    expect(nextObjective({ doorOpened: true })).toMatch(/sundial/);
  });
});

describe('sundial puzzle uses the real sun', () => {
  it('some ring step aligns at every daylight moment, and the answer changes over the day', () => {
    const answers = new Set<number>();
    for (let t = DAY_LENGTH - 5; t > 5; t -= 30) {
      const sun = sunDirection(t);
      const step = bestStep(sun)!;
      expect(sundialAligned(sun, step)).toBe(true);
      answers.add(step);
      let aligned = 0;
      for (let s = 0; s < SUNDIAL_STEPS; s++) if (sundialAligned(sun, s)) aligned++;
      expect(aligned).toBeLessThanOrEqual(2);
    }
    expect(answers.size).toBeGreaterThan(3);
  });

  it('no shadow at night', () => {
    expect(bestStep(sunDirection(-60))).toBeNull();
  });
});
