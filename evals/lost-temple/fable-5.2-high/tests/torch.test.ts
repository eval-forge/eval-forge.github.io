import { describe, expect, it } from 'vitest';
import {
  FLASK_REFILL, LOW_FUEL, MIN_RADIUS_FRACTION, RELIGHT_TIME, douse, dousedByFall, dousedByWater, dousedByWind, flicker,
  isLit, newTorch, placeSpare, radiusForFuel, startRelight, stepTorch, stow, torchRadius, useFlask, useSpare,
} from '../src/core/torch';

const cfg = { burnTime: 240, maxRadius: 11 };
const light = (t = newTorch()) => { startRelight(t); stepTorch(t, RELIGHT_TIME + 0.01, cfg); return t; };

describe('radius curve', () => {
  it('holds full radius while fuel is healthy', () => {
    expect(radiusForFuel(1, 11)).toBe(11);
    expect(radiusForFuel(LOW_FUEL, 11)).toBe(11);
  });
  it('shrinks as fuel runs low and never grows as fuel falls', () => {
    let prev = radiusForFuel(1, 11);
    for (let f = 1; f > 0; f -= 0.01) {
      const r = radiusForFuel(f, 11);
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      prev = r;
    }
    expect(radiusForFuel(0.1, 11)).toBeLessThan(11);
    expect(radiusForFuel(0.05, 11)).toBeLessThan(radiusForFuel(0.2, 11));
  });
  it('bottoms out near the minimum fraction, then goes dark at empty', () => {
    expect(radiusForFuel(0.0001, 11)).toBeGreaterThan(11 * MIN_RADIUS_FRACTION - 0.01);
    expect(radiusForFuel(0.0001, 11)).toBeLessThan(11 * (MIN_RADIUS_FRACTION + 0.05));
    expect(radiusForFuel(0, 11)).toBe(0);
    expect(radiusForFuel(-1, 11)).toBe(0);
  });
  it('scales with the upgraded torch', () => {
    expect(radiusForFuel(0.2, 15)).toBeGreaterThan(radiusForFuel(0.2, 11));
  });
});

describe('fuel', () => {
  it('burns only while lit, over the configured burn time', () => {
    const t = newTorch();
    stepTorch(t, 100, cfg);
    expect(t.fuel).toBe(1);
    light(t);
    stepTorch(t, 120, cfg);
    expect(t.fuel).toBeCloseTo(0.5, 2);
  });
  it('dies when the fuel is gone and gives no light', () => {
    const t = light();
    const ev = stepTorch(t, 241, cfg);
    expect(ev).toContain('died');
    expect(t.state).toBe('dead');
    expect(torchRadius(t, cfg)).toBe(0);
    expect(startRelight(t)).toBe(false);
  });
  it('warns once when fuel gets low', () => {
    const t = light();
    let lows = 0;
    for (let i = 0; i < 230; i++) if (stepTorch(t, 1, cfg).includes('low')) lows++;
    expect(lows).toBe(1);
  });
  it('a flask refills and revives a dead torch to relightable', () => {
    const t = light(newTorch(1, 1));
    stepTorch(t, 241, cfg);
    expect(useFlask(t)).toBe(true);
    expect(t.fuel).toBeCloseTo(FLASK_REFILL);
    expect(t.state).toBe('out');
    expect(startRelight(t)).toBe(true);
    expect(useFlask(t)).toBe(false);
  });
  it('a spare torch is a full refill and is consumed', () => {
    const t = light(newTorch(1, 0));
    stepTorch(t, 241, cfg);
    expect(useSpare(t)).toBe(true);
    expect(t.fuel).toBe(1);
    expect(t.spares).toBe(0);
    expect(useSpare(t)).toBe(false);
  });
  it('placing a torch in a sconce spends a spare', () => {
    const t = newTorch(1);
    expect(placeSpare(t)).toBe(true);
    expect(placeSpare(t)).toBe(false);
  });
});

describe('lighting and dousing', () => {
  it('takes a relight delay with no light during it', () => {
    const t = newTorch();
    expect(startRelight(t)).toBe(true);
    expect(t.state).toBe('relighting');
    stepTorch(t, RELIGHT_TIME * 0.5, cfg);
    expect(isLit(t)).toBe(false);
    expect(torchRadius(t, cfg)).toBe(0);
    const ev = stepTorch(t, RELIGHT_TIME * 0.6, cfg);
    expect(ev).toContain('lit');
    expect(torchRadius(t, cfg)).toBe(11);
  });
  it('is blown out by water, wind and falls, keeping its fuel', () => {
    for (const cause of ['water', 'wind', 'fall'] as const) {
      const t = light();
      stepTorch(t, 24, cfg);
      const fuel = t.fuel;
      expect(douse(t, cause)).toBe(true);
      expect(t.state).toBe('out');
      expect(t.fuel).toBe(fuel);
      expect(torchRadius(t, cfg)).toBe(0);
      expect(startRelight(t)).toBe(true);
    }
  });
  it('dousing interrupts a relight', () => {
    const t = newTorch();
    startRelight(t);
    expect(douse(t, 'wind')).toBe(true);
    stepTorch(t, 10, cfg);
    expect(isLit(t)).toBe(false);
  });
  it('uses thresholds for water depth, fall height and wind', () => {
    expect(dousedByWater(0.4)).toBe(false);
    expect(dousedByWater(1.2)).toBe(true);
    expect(dousedByFall(2)).toBe(false);
    expect(dousedByFall(6)).toBe(true);
    expect(dousedByWind(0.3)).toBe(false);
    expect(dousedByWind(0.9)).toBe(true);
  });
  it('can be stowed to save fuel', () => {
    const t = light();
    expect(stow(t)).toBe(true);
    stepTorch(t, 100, cfg);
    expect(t.fuel).toBe(1);
    expect(stow(t)).toBe(false);
  });
  it('flickers around 1 and more wildly when nearly empty', () => {
    let maxFull = 0, maxLow = 0;
    for (let i = 0; i < 500; i++) {
      maxFull = Math.max(maxFull, Math.abs(flicker(i * 0.037, 1) - 1));
      maxLow = Math.max(maxLow, Math.abs(flicker(i * 0.037, 0.02) - 1));
    }
    expect(maxFull).toBeLessThan(0.1);
    expect(maxLow).toBeGreaterThan(maxFull);
  });
});
