import { describe, it, expect } from 'vitest';
import { PressurePlate, TrappedPedestal, Crumbler, sunTileShouldCrumble, DartLauncher, UnstableCeiling } from '../src/logic/traps';

describe('pressure plates', () => {
  it('fires on the rising edge only', () => {
    const p = new PressurePlate(30);
    expect(p.update(10)).toBe(false);
    expect(p.update(40)).toBe(true);
    expect(p.update(40)).toBe(false);
    expect(p.update(0)).toBe(false);
    expect(p.pressed).toBe(false);
    expect(p.update(31)).toBe(true);
  });
  it('latching plates stay down', () => {
    const p = new PressurePlate(30, true);
    p.update(50);
    p.update(0);
    expect(p.pressed).toBe(true);
  });
});

describe('trapped pedestal', () => {
  it('fires if the relic is lifted with nothing swapped in', () => {
    const t = new TrappedPedestal(8);
    expect(t.update(0.1, 8, true)).toBeNull();
    expect(t.update(0.5, 0, false)).toBeNull(); // grace
    expect(t.update(0.6, 0, false)).toBe('fire');
    expect(t.update(1, 0, false)).toBeNull(); // only once
  });
  it('is safe when an object of similar weight is swapped in during the grace window', () => {
    const t = new TrappedPedestal(8);
    t.update(0.2, 0, false);
    expect(t.update(1.0, 7, false)).toBeNull();
    expect(t.state).toBe('safe');
  });
  it('fires if the swapped object is too light', () => {
    const t = new TrappedPedestal(8);
    t.update(0.2, 0, false);
    expect(t.update(1.0, 2, false)).toBe('fire');
  });
  it('re-arms if the relic is put back during grace', () => {
    const t = new TrappedPedestal(8);
    t.update(0.5, 0, false);
    t.update(0.1, 8, true);
    expect(t.state).toBe('armed');
  });
  it('swapIsSafe uses the 75% tolerance', () => {
    expect(TrappedPedestal.swapIsSafe(8, 6)).toBe(true);
    expect(TrappedPedestal.swapIsSafe(8, 5.9)).toBe(false);
  });
});

describe('crumbling planks and tiles', () => {
  it('drops after the delay', () => {
    const c = new Crumbler(0.7);
    expect(c.update(1)).toBeNull();
    c.step();
    expect(c.update(0.5)).toBeNull();
    expect(c.update(0.3)).toBe('fall');
    expect(c.state).toBe('fallen');
  });
  it('respawns when configured', () => {
    const c = new Crumbler(0.5, 4);
    c.step(); c.update(0.6);
    expect(c.update(3)).toBeNull();
    expect(c.update(1.1)).toBe('respawn');
    expect(c.state).toBe('solid');
  });
  it('sun tiles crumble only when occupied and in shadow', () => {
    expect(sunTileShouldCrumble(true, false)).toBe(true);
    expect(sunTileShouldCrumble(true, true)).toBe(false);
    expect(sunTileShouldCrumble(false, false)).toBe(false);
  });
});

describe('darts and ceilings', () => {
  it('dart launchers respect their reload', () => {
    const d = new DartLauncher(1);
    expect(d.trigger()).toBe(true);
    expect(d.trigger()).toBe(false);
    d.update(1.01);
    expect(d.trigger()).toBe(true);
  });
  it('noise accumulates into debris and decays', () => {
    const c = new UnstableCeiling(1, 0.5);
    expect(c.addNoise(0.6)).toBe(false);
    c.update(1);
    expect(c.addNoise(0.6)).toBe(false);
    expect(c.addNoise(0.6)).toBe(true);
    expect(c.level).toBe(0);
  });
});
