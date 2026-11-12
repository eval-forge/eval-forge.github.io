import { describe, it, expect } from 'vitest';
import { INITIAL_FLAGS, reachable, canPass, applyUnlock } from '../src/logic/unlocks';
import { sundialSolved, bestNotch, shadowAngleDeg, NOTCHES } from '../src/logic/sundial';
import { sunDirection, DAY_LENGTH } from '../src/logic/countdown';

const ctx = { hasSunDisc: false, hasBronzeKey: false, inTunnel: false };

describe('scene unlocks', () => {
  it('starts with only the outside and the halls reachable', () => {
    const r = reachable('jungle', INITIAL_FLAGS);
    expect([...r].sort()).toEqual(['cliffs', 'courtyard', 'halls', 'jungle']);
  });
  it('requires the sun-disc for the seal and the bronze key for the vault', () => {
    expect(applyUnlock(INITIAL_FLAGS, 'insertSunDisc', ctx)).toBeNull();
    const f1 = applyUnlock(INITIAL_FLAGS, 'insertSunDisc', { ...ctx, hasSunDisc: true })!;
    expect(f1.sealOpen).toBe(true);
    expect(applyUnlock(f1, 'useBronzeKey', ctx)).toBeNull();
    expect(applyUnlock(f1, 'useBronzeKey', { ...ctx, hasBronzeKey: true })!.vaultGateOpen).toBe(true);
  });
  it('opens the full chain in order', () => {
    let f = INITIAL_FLAGS;
    f = applyUnlock(f, 'placeBlock', ctx)!;
    expect(reachable('jungle', f).has('sanctum')).toBe(true);
    expect(reachable('jungle', f).has('catacombs')).toBe(false);
    f = applyUnlock(f, 'insertSunDisc', { ...ctx, hasSunDisc: true })!;
    f = applyUnlock(f, 'useBronzeKey', { ...ctx, hasBronzeKey: true })!;
    expect(reachable('jungle', f).has('vault')).toBe(true);
    expect(canPass('vault', 'tunnel', f)).toBe(false);
    f = applyUnlock(f, 'pullEscapeLever', ctx)!;
    expect(canPass('vault', 'tunnel', f)).toBe(true);
    expect(canPass('tunnel', 'halls', f)).toBe(false);
  });
  it('the cracked wall can only be kicked from the tunnel side', () => {
    expect(applyUnlock(INITIAL_FLAGS, 'kickWall', ctx)).toBeNull();
    expect(applyUnlock(INITIAL_FLAGS, 'kickWall', { ...ctx, inTunnel: true })!.wallKicked).toBe(true);
  });
  it('closing the great door cuts the temple off from the outside', () => {
    const f = applyUnlock({ ...INITIAL_FLAGS, hallsGateOpen: true }, 'closeDoor', ctx)!;
    expect(reachable('jungle', f).has('halls')).toBe(false);
    expect(reachable('sanctum', f).has('courtyard')).toBe(false);
  });
});

describe('sundial puzzle', () => {
  it('the shadow points away from the sun', () => {
    expect(shadowAngleDeg([1, 0.5, 0])).toBeCloseTo(180);
    expect(shadowAngleDeg([0, 0.5, 1])).toBeCloseTo(270);
  });
  it('the solution moves with the sun', () => {
    const morning = bestNotch(sunDirection(100));
    const evening = bestNotch(sunDirection(DAY_LENGTH - 100));
    expect(morning).not.toBe(evening);
  });
  it('is solved only by the right notch, while sunlit and the sun is up', () => {
    const sun = sunDirection(300);
    const n = bestNotch(sun);
    expect(sundialSolved(n, sun, true)).toBe(true);
    expect(sundialSolved((n + 3) % NOTCHES, sun, true)).toBe(false);
    expect(sundialSolved(n, sun, false)).toBe(false);
    expect(sundialSolved(bestNotch(sunDirection(DAY_LENGTH + 20)), sunDirection(DAY_LENGTH + 20), true)).toBe(false);
  });
  it('always has a solvable notch during the day', () => {
    for (let t = 30; t < DAY_LENGTH - 30; t += 10) {
      const s = sunDirection(t);
      expect(sundialSolved(bestNotch(s), s, true)).toBe(true);
    }
  });
});
