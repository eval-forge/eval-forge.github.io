import { describe, it, expect } from 'vitest';
import { torchRadius, torchIntensity, BASE_TORCH, TorchState, gustBlowOutChance, fallSnuffsTorch, SconceFlame, FULL_RADIUS_FRACTION, OIL_FLASK_FUEL } from '../src/logic/torch';

const env = (o: Partial<{ submerged: boolean; gusts: number[]; crouched: boolean; rand: () => number }> = {}) => ({
  submerged: false, gusts: [], crouched: false, rand: () => 0.99, ...o,
});

describe('radius curve', () => {
  const s = BASE_TORCH;
  it('is full above 45% fuel', () => {
    expect(torchRadius(100, s)).toBe(s.maxRadius);
    expect(torchRadius(FULL_RADIUS_FRACTION * 100 + 0.01, s)).toBe(s.maxRadius);
  });
  it('shrinks monotonically below 45% and hits min radius just before empty', () => {
    let prev = Infinity;
    for (let f = 45; f > 0; f -= 1) {
      const r = torchRadius(f, s);
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      prev = r;
    }
    expect(torchRadius(0.001, s)).toBeCloseTo(s.minRadius, 1);
    expect(torchRadius(0, s)).toBe(0);
  });
  it('is continuous at the knee', () => {
    expect(torchRadius(44.99, s)).toBeCloseTo(s.maxRadius, 1);
  });
  it('dims with the radius', () => {
    expect(torchIntensity(100, s)).toBe(1);
    expect(torchIntensity(10, s)).toBeLessThan(0.8);
    expect(torchIntensity(0, s)).toBe(0);
  });
});

describe('fuel', () => {
  it('burns about five minutes per full torch', () => {
    const t = new TorchState(BASE_TORCH, 0, 0);
    t.lit = true;
    let seconds = 0;
    while (t.lit && seconds < 1000) {
      t.update(1, env());
      seconds++;
    }
    expect(seconds).toBeGreaterThan(280);
    expect(seconds).toBeLessThan(320);
    expect(t.fuel).toBe(0);
  });
  it('warns once at low fuel and goes out when empty', () => {
    const t = new TorchState(BASE_TORCH, 0, 0);
    t.lit = true;
    t.fuel = 20.1;
    const ev = t.update(1, env());
    expect(ev.some((e) => e.type === 'lowFuel')).toBe(true);
    expect(t.update(1, env()).some((e) => e.type === 'lowFuel')).toBe(false);
    t.fuel = 0.1;
    expect(t.update(1, env())).toContainEqual({ type: 'out', reason: 'fuel' });
  });
  it('oil flask adds fuel and is consumed', () => {
    const t = new TorchState(BASE_TORCH, 0, 1);
    t.fuel = 30;
    expect(t.useOilFlask()).toEqual([{ type: 'refuel', amount: OIL_FLASK_FUEL }]);
    expect(t.fuel).toBe(80);
    expect(t.oilFlasks).toBe(0);
    expect(t.useOilFlask()).toEqual([]);
  });
});

describe('going out and relighting', () => {
  it('water puts it out', () => {
    const t = new TorchState(BASE_TORCH);
    t.lit = true;
    expect(t.update(0.1, env({ submerged: true }))).toContainEqual({ type: 'out', reason: 'water' });
    expect(t.lit).toBe(false);
  });
  it('a gust can blow it out, crouching and upgrades help', () => {
    expect(gustBlowOutChance(1, 0, false)).toBeGreaterThan(gustBlowOutChance(1, 0, true));
    expect(gustBlowOutChance(1, 0.6, false)).toBeLessThan(gustBlowOutChance(1, 0, false));
    expect(gustBlowOutChance(0, 0, false)).toBe(0);
    const t = new TorchState(BASE_TORCH);
    t.lit = true;
    expect(t.update(0.1, env({ gusts: [1], rand: () => 0 }))).toContainEqual({ type: 'out', reason: 'wind' });
  });
  it('hard landings snuff it', () => {
    expect(fallSnuffsTorch(8)).toBe(false);
    expect(fallSnuffsTorch(10)).toBe(true);
  });
  it('relighting takes time and can be interrupted by water', () => {
    const t = new TorchState(BASE_TORCH);
    expect(t.startRelight(false)).toEqual([{ type: 'relightStart' }]);
    expect(t.isRelighting).toBe(true);
    t.update(1, env());
    expect(t.lit).toBe(false);
    expect(t.update(1.3, env())).toContainEqual({ type: 'lit' });
    expect(t.lit).toBe(true);
    const u = new TorchState(BASE_TORCH);
    u.startRelight(false);
    expect(u.update(0.5, env({ submerged: true }))).toContainEqual({ type: 'relightFail', reason: 'water' });
    expect(u.isRelighting).toBe(false);
  });
  it('an empty torch needs a spare', () => {
    const t = new TorchState(BASE_TORCH, 1, 0);
    t.fuel = 0;
    expect(t.startRelight(false)).toEqual([{ type: 'freshTorch' }, { type: 'relightStart' }]);
    expect(t.fuel).toBe(BASE_TORCH.fuelCapacity);
    expect(t.spareTorches).toBe(0);
    t.lit = false;
    t.relighting = 0;
    t.fuel = 0;
    expect(t.startRelight(false)).toEqual([{ type: 'relightFail', reason: 'noFuel' }]);
  });
  it('lighting from a sconce is instant', () => {
    const t = new TorchState(BASE_TORCH);
    expect(t.lightFrom()).toEqual([{ type: 'lit' }]);
    expect(t.lit).toBe(true);
  });
});

describe('sconce torches', () => {
  it('burn for six minutes and fade at the end', () => {
    const s = new SconceFlame();
    expect(s.radius).toBe(7);
    s.update(340);
    expect(s.lit).toBe(true);
    expect(s.radius).toBeLessThan(7);
    s.update(30);
    expect(s.lit).toBe(false);
    expect(s.radius).toBe(0);
  });
});
