import { describe, it, expect } from 'vitest';
import { PressurePlateLogic, WeightTrapLogic, BreakTimer, plankBreakDelay, fallDamage, impactDamage, PLAYER_BODY_MASS } from '../src/logic/traps';

describe('pressure plate', () => {
  it('presses under enough weight and releases with hysteresis', () => {
    const p = new PressurePlateLogic(60);
    expect(p.update(59, 0.5)).toBeNull();
    expect(p.update(PLAYER_BODY_MASS, 0.05)).toBeNull();
    expect(p.update(PLAYER_BODY_MASS, 0.05)).toBe('pressed');
    // dips slightly below threshold (but above 80%) do not release
    expect(p.update(55, 1)).toBeNull();
    expect(p.pressed).toBe(true);
    expect(p.update(10, 0.1)).toBeNull();
    expect(p.update(10, 0.2)).toBe('released');
  });
  it('ignores a momentary touch', () => {
    const p = new PressurePlateLogic(60);
    expect(p.update(100, 0.03)).toBeNull();
    expect(p.update(0, 0.03)).toBeNull();
    expect(p.pressed).toBe(false);
  });
  it('latching plates stay down', () => {
    const p = new PressurePlateLogic(60, { latch: true });
    p.update(100, 0.2);
    expect(p.pressed).toBe(true);
    expect(p.update(0, 5)).toBeNull();
    expect(p.pressed).toBe(true);
  });
  it('a light pot does not trigger a dart plate but the player does', () => {
    const p = new PressurePlateLogic(30);
    expect(p.update(3, 1)).toBeNull();
    expect(p.update(PLAYER_BODY_MASS, 0.2)).toBe('pressed');
  });
});

describe('weighted pedestal', () => {
  it('fires when the relic is lifted with nothing in its place', () => {
    const t = new WeightTrapLogic(4.5);
    expect(t.update(4.5, 1)).toBe(false);
    expect(t.update(0, 0.2)).toBe(false); // grace
    expect(t.update(0, 0.2)).toBe(true);
    expect(t.update(0, 1)).toBe(false); // only once
  });
  it('a counterweight within 20% keeps it quiet', () => {
    const t = new WeightTrapLogic(8);
    expect(t.update(7, 5)).toBe(false);
    expect(t.update(9.5, 5)).toBe(false);
    expect(t.fired).toBe(false);
  });
  it('a counterweight that is too light or too heavy still fires', () => {
    const light = new WeightTrapLogic(8);
    light.update(5, 1);
    expect(light.fired).toBe(true);
    const heavy = new WeightTrapLogic(8);
    heavy.update(12, 1);
    expect(heavy.fired).toBe(true);
  });
  it('a quick swap inside the grace window is safe', () => {
    const t = new WeightTrapLogic(4.5);
    t.update(0, 0.15);
    t.update(4.2, 0.5);
    expect(t.fired).toBe(false);
  });
});

describe('planks and crumbling floors', () => {
  it('plank delay is short and shorter when loaded', () => {
    expect(plankBreakDelay(0)).toBeCloseTo(0.55);
    expect(plankBreakDelay(1)).toBeLessThan(plankBreakDelay(0));
    expect(plankBreakDelay(5)).toBeCloseTo(plankBreakDelay(1));
  });
  it('break timer goes intact, cracking, fallen exactly once', () => {
    const b = new BreakTimer(0.5);
    expect(b.update(1)).toBe(false);
    expect(b.touch()).toBe(true);
    expect(b.touch()).toBe(false);
    expect(b.update(0.3)).toBe(false);
    expect(b.update(0.3)).toBe(true);
    expect(b.state).toBe('fallen');
    expect(b.update(1)).toBe(false);
  });
});

describe('damage', () => {
  it('falls hurt only above 11 m/s', () => {
    expect(fallDamage(10)).toBe(0);
    expect(fallDamage(15)).toBeGreaterThan(30);
  });
  it('a moving boulder is lethal, a pebble is not', () => {
    expect(impactDamage(5, 3000)).toBeGreaterThanOrEqual(100);
    expect(impactDamage(2, 1)).toBe(0);
    expect(impactDamage(8, 40)).toBeGreaterThan(0);
  });
});
