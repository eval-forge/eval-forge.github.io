import { describe, expect, it } from 'vitest';
import {
  FALL_DOUSE_SPEED, FLASK_FUEL, GUST_DOUSE_STRENGTH, SHADE_SAFE_FRACTION, TORCH_DIM_BELOW, TORCH_MIN_RADIUS,
  TORCH_RELIGHT_TIME, TorchModel, WATER_DOUSE_DEPTH, brightnessForFuel, fallDouses, gustDouses, radiusForFuel,
  waterDouses, type TorchEvent,
} from '../src/core/torch';

function litTorch(capacity = 200, radius = 13, spares = 0): TorchModel {
  const t = new TorchModel(capacity, radius, spares);
  t.toggle();
  t.update(TORCH_RELIGHT_TIME + 0.01);
  expect(t.lit).toBe(true);
  return t;
}

describe('torch radius curve', () => {
  it('is at full radius while fuel is above the dim threshold', () => {
    expect(radiusForFuel(1, 13)).toBe(13);
    expect(radiusForFuel(0.5, 13)).toBe(13);
    expect(radiusForFuel(TORCH_DIM_BELOW, 13)).toBe(13);
  });

  it('shrinks smoothly to the minimum radius at empty', () => {
    expect(radiusForFuel(0, 13)).toBeCloseTo(TORCH_MIN_RADIUS, 6);
    const half = radiusForFuel(TORCH_DIM_BELOW / 2, 13);
    expect(half).toBeGreaterThan(TORCH_MIN_RADIUS);
    expect(half).toBeLessThan(13);
  });

  it('never grows as fuel falls', () => {
    let prev = radiusForFuel(1, 16);
    for (let f = 0.99; f >= 0; f -= 0.01) {
      const r = radiusForFuel(f, 16);
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      prev = r;
    }
  });

  it('is continuous at the threshold', () => {
    expect(radiusForFuel(TORCH_DIM_BELOW - 1e-4, 13)).toBeCloseTo(13, 2);
  });

  it('brightness follows the same shape', () => {
    expect(brightnessForFuel(1)).toBe(1);
    expect(brightnessForFuel(0)).toBeCloseTo(0.3, 6);
    expect(brightnessForFuel(0.1)).toBeLessThan(1);
  });

  it('clamps silly inputs', () => {
    expect(radiusForFuel(-1, 13)).toBeCloseTo(TORCH_MIN_RADIUS, 6);
    expect(radiusForFuel(5, 13)).toBe(13);
  });
});

describe('torch fuel', () => {
  it('starts out, full, and gives no light', () => {
    const t = new TorchModel(210, 13);
    expect(t.state).toBe('out');
    expect(t.fuelFraction).toBe(1);
    expect(t.radius).toBe(0);
  });

  it('burns only while lit', () => {
    const t = new TorchModel(100, 13);
    t.update(50);
    expect(t.fuel).toBe(100);
    t.toggle();
    t.update(TORCH_RELIGHT_TIME + 0.01);
    t.update(40);
    expect(t.fuel).toBeCloseTo(60, 5);
  });

  it('radius shrinks as fuel runs low', () => {
    const t = litTorch(100, 13);
    t.update(50);
    expect(t.radius).toBe(13);
    t.update(40); // 10 % left
    expect(t.radius).toBeLessThan(13);
    expect(t.radius).toBeGreaterThan(TORCH_MIN_RADIUS);
  });

  it('warns once when low, then dies at zero', () => {
    const t = litTorch(100, 13);
    const events: TorchEvent[] = [];
    for (let i = 0; i < 1100; i++) events.push(...t.update(0.1));
    expect(events.filter((e) => e.type === 'low').length).toBe(1);
    const doused = events.filter((e) => e.type === 'doused');
    expect(doused.length).toBe(1);
    expect(doused[0]).toEqual({ type: 'doused', cause: 'empty' });
    expect(t.fuel).toBe(0);
    expect(t.lit).toBe(false);
    expect(t.radius).toBe(0);
  });

  it('cannot be relit with no fuel', () => {
    const t = litTorch(10, 13);
    t.update(20);
    expect(t.toggle()).toBeNull();
    expect(t.state).toBe('out');
  });

  it('a flask adds fuel up to capacity; a spare is a full torch', () => {
    const t = litTorch(210, 13, 1);
    t.update(150);
    t.flasks = 1;
    expect(t.refuel()).toBe('flask');
    expect(t.fuel).toBeCloseTo(60 + FLASK_FUEL, 5);
    t.update(100);
    expect(t.refuel()).toBe('spare');
    expect(t.fuel).toBe(210);
    expect(t.spares).toBe(0);
    t.update(100);
    expect(t.refuel()).toBeNull();
  });

  it('does not waste a refill on a full torch', () => {
    const t = new TorchModel(210, 13, 2);
    t.flasks = 2;
    expect(t.refuel()).toBeNull();
    expect(t.flasks).toBe(2);
    expect(t.spares).toBe(2);
  });

  it('spares can be given up for sconces', () => {
    const t = new TorchModel(210, 13, 1);
    expect(t.takeSpare()).toBe(true);
    expect(t.takeSpare()).toBe(false);
  });
});

describe('torch state machine', () => {
  it('relighting takes a short, vulnerable moment', () => {
    const t = new TorchModel(210, 13);
    expect(t.toggle()).toEqual({ type: 'relightStarted' });
    expect(t.vulnerable).toBe(true);
    expect(t.lit).toBe(false);
    t.update(TORCH_RELIGHT_TIME * 0.5);
    expect(t.relightProgress).toBeCloseTo(0.5, 2);
    expect(t.lit).toBe(false);
    const ev = t.update(TORCH_RELIGHT_TIME * 0.6);
    expect(ev).toContainEqual({ type: 'lit' });
    expect(t.lit).toBe(true);
    expect(t.vulnerable).toBe(false);
  });

  it('pressing the key again while relighting does nothing', () => {
    const t = new TorchModel(210, 13);
    t.toggle();
    expect(t.toggle()).toBeNull();
    expect(t.state).toBe('relighting');
  });

  it('can be doused by hand and relit', () => {
    const t = litTorch();
    expect(t.toggle()).toEqual({ type: 'doused', cause: 'manual' });
    expect(t.lit).toBe(false);
    expect(t.toggle()).toEqual({ type: 'relightStarted' });
  });

  it('a hit interrupts a relight', () => {
    const t = new TorchModel(210, 13);
    t.toggle();
    t.update(1);
    expect(t.douse('hit')).toEqual({ type: 'relightInterrupted' });
    expect(t.state).toBe('out');
    t.toggle();
    expect(t.relightProgress).toBe(0);
  });

  it('dousing an unlit torch is a no-op', () => {
    const t = new TorchModel(210, 13);
    expect(t.douse('water')).toBeNull();
  });

  it('water, wind and falls put it out', () => {
    for (const cause of ['water', 'wind', 'fall'] as const) {
      const t = litTorch();
      expect(t.douse(cause)).toEqual({ type: 'doused', cause });
      expect(t.radius).toBe(0);
    }
  });

  it('keeps shades at a fraction of the light radius', () => {
    const t = litTorch(210, 13);
    expect(t.shadeSafeRadius).toBeCloseTo(13 * SHADE_SAFE_FRACTION, 6);
    t.toggle();
    expect(t.shadeSafeRadius).toBe(0);
  });
});

describe('what puts a flame out', () => {
  it('deep water does, wading does not', () => {
    expect(waterDouses(WATER_DOUSE_DEPTH + 0.1)).toBe(true);
    expect(waterDouses(1.1)).toBe(false);
  });
  it('strong gusts do unless the flame is shielded by crouching', () => {
    expect(gustDouses(GUST_DOUSE_STRENGTH, false)).toBe(true);
    expect(gustDouses(1, true)).toBe(false);
    expect(gustDouses(GUST_DOUSE_STRENGTH - 0.1, false)).toBe(false);
  });
  it('hard landings do', () => {
    expect(fallDouses(FALL_DOUSE_SPEED + 1)).toBe(true);
    expect(fallDouses(5)).toBe(false);
  });
});
