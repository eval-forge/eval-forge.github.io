import { describe, it, expect } from 'vitest';
import { torchRadius, burn, newTorch, submerged, windBlowsOut, fallBlowsOut, canRelight, startRelight, tickRelight, extinguish, addFuel, RELIGHT_TIME, flicker } from '../src/logic/torch';

describe('torch fuel and radius curve', () => {
  it('keeps full radius above half fuel, then shrinks monotonically to 30%', () => {
    expect(torchRadius(8, 180, 180)).toBe(8);
    expect(torchRadius(8, 90, 180)).toBe(8);
    let prev = 8;
    for (let f = 89; f > 0; f -= 1) {
      const r = torchRadius(8, f, 180);
      expect(r).toBeLessThanOrEqual(prev);
      expect(r).toBeGreaterThanOrEqual(8 * 0.3 - 1e-9);
      prev = r;
    }
    expect(torchRadius(8, 0.0001, 180)).toBeCloseTo(8 * 0.3, 1);
    expect(torchRadius(8, 0, 180)).toBe(0);
  });

  it('burns 1 fuel per second and goes out when empty', () => {
    let t = newTorch(10);
    t = burn(t, 4);
    expect(t.fuel).toBe(6);
    expect(t.lit).toBe(true);
    t = burn(t, 10);
    expect(t.fuel).toBe(0);
    expect(t.lit).toBe(false);
    expect(burn(extinguish(newTorch(10)), 5).fuel).toBe(10); // unlit torch does not burn
  });

  it('water puts it out above torch height (lower when crouched)', () => {
    expect(submerged(null, 0, false)).toBe(false);
    expect(submerged(1.0, 0, false)).toBe(false);
    expect(submerged(1.0, 0, true)).toBe(true);
    expect(submerged(1.4, 0, false)).toBe(true);
  });

  it('wind and falls', () => {
    expect(windBlowsOut(0.1, false, false)).toBe(true);
    expect(windBlowsOut(0.9, false, false)).toBe(false);
    expect(windBlowsOut(0.1, true, false)).toBe(false);
    expect(fallBlowsOut(5, false)).toBe(true);
    expect(fallBlowsOut(5, true)).toBe(false);
    expect(fallBlowsOut(3, false)).toBe(false);
  });

  it('relight takes time, fails in water, needs fuel', () => {
    let t = extinguish(newTorch(50));
    expect(canRelight(t, true)).toBe(false);
    expect(canRelight(t, false)).toBe(true);
    t = startRelight(t);
    t = tickRelight(t, RELIGHT_TIME - 0.1, false);
    expect(t.lit).toBe(false);
    t = tickRelight(t, 0.2, false);
    expect(t.lit).toBe(true);
    let w = startRelight(extinguish(newTorch(50)));
    w = tickRelight(w, 0.5, true);
    expect(w.relighting).toBe(0);
    expect(w.lit).toBe(false);
    const empty = extinguish({ ...newTorch(50), fuel: 0 });
    expect(canRelight(empty, false)).toBe(false);
    expect(addFuel(empty, 100).fuel).toBe(50);
  });

  it('flicker stays within ±6%', () => {
    for (let t = 0; t < 20; t += 0.013) { const f = flicker(t); expect(f).toBeGreaterThanOrEqual(0.94); expect(f).toBeLessThanOrEqual(1.06); }
  });
});
