import { describe, it, expect } from 'vitest';
import { pedestalTriggered, newPedestal, tickPedestal, PEDESTAL_GRACE, tickCrack, newCrack, PLANK_CRACK_AT, PLANK_DROP_AT, tickPlate, newPlate, tickDart, DART_COOLDOWN, fallDamage, bladeAngle, tickInstability, sunTileSolid } from '../src/logic/traps';

describe('trap triggers', () => {
  it('pedestal fires when weight drifts beyond 15%', () => {
    expect(pedestalTriggered(7, 7)).toBe(false);
    expect(pedestalTriggered(7, 6.2)).toBe(false); // -11%
    expect(pedestalTriggered(7, 5.8)).toBe(true); // -17%
    expect(pedestalTriggered(7, 0)).toBe(true);
    expect(pedestalTriggered(7, 8.0)).toBe(false);
    expect(pedestalTriggered(7, 8.2)).toBe(true);
  });

  it('pedestal has a grace period for a swap and fires only once', () => {
    let p = newPedestal(7);
    let r = tickPedestal(p, 0, PEDESTAL_GRACE / 2); expect(r.fire).toBe(false);
    r = tickPedestal(r.state, 7.2, 0.1); expect(r.fire).toBe(false); // swapped in time
    expect(r.state.unbalancedFor).toBe(0);
    r = tickPedestal(r.state, 0, PEDESTAL_GRACE + 0.01); expect(r.fire).toBe(true);
    r = tickPedestal(r.state, 0, 1); expect(r.fire).toBe(false);
  });

  it('planks crack then drop, and keep going once you step off', () => {
    let s = newCrack();
    let r = tickCrack(s, false, 1, PLANK_CRACK_AT, PLANK_DROP_AT); expect(r.event).toBeNull();
    r = tickCrack(r.state, true, PLANK_CRACK_AT, PLANK_CRACK_AT, PLANK_DROP_AT); expect(r.event).toBe('crack');
    r = tickCrack(r.state, false, 0.2, PLANK_CRACK_AT, PLANK_DROP_AT); expect(r.event).toBeNull();
    r = tickCrack(r.state, false, PLANK_DROP_AT, PLANK_CRACK_AT, PLANK_DROP_AT); expect(r.event).toBe('drop');
    r = tickCrack(r.state, true, 1, PLANK_CRACK_AT, PLANK_DROP_AT); expect(r.event).toBeNull();
  });

  it('pressure plates report edges', () => {
    let p = newPlate();
    let r = tickPlate(p, 50, 150, 0.1); expect(r.event).toBeNull();
    r = tickPlate(r.state, 250, 150, 0.1); expect(r.event).toBe('down');
    r = tickPlate(r.state, 250, 150, 0.1); expect(r.event).toBeNull(); expect(r.state.heldFor).toBeCloseTo(0.1);
    r = tickPlate(r.state, 0, 150, 0.1); expect(r.event).toBe('up');
  });

  it('dart launchers respect their cooldown', () => {
    let l = { cooldown: 0 };
    let r = tickDart(l, true, 0.016); expect(r.fire).toBe(true);
    r = tickDart(r.state, true, 0.5); expect(r.fire).toBe(false);
    r = tickDart(r.state, true, DART_COOLDOWN); expect(r.fire).toBe(true);
  });

  it('fall damage, blades, instability, sun tiles', () => {
    expect(fallDamage(5, 6)).toBe(0);
    expect(fallDamage(8, 6)).toBe(24);
    expect(fallDamage(8, 10)).toBe(0);
    expect(Math.abs(bladeAngle(0.37, 1, 2, 0))).toBeLessThanOrEqual(1);
    let lvl = 0, drops = 0;
    for (let i = 0; i < 10; i++) { const r = tickInstability(lvl, 0.3, 0.1); lvl = r.level; if (r.drop) drops++; }
    expect(drops).toBeGreaterThan(0);
    expect(tickInstability(0.5, 0, 1).level).toBeLessThan(0.5);
    expect(sunTileSolid(true, false)).toBe(true);
    expect(sunTileSolid(false, false)).toBe(false);
    expect(sunTileSolid(true, true)).toBe(false);
  });
});
