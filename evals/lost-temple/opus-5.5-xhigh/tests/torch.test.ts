import { describe, it, expect } from 'vitest';
import { radiusForFuel, TorchState, torchStats, gustBlowoutChance, fallBlowsOut, RELIGHT_TIME, BASE_RADIUS } from '../src/logic/torch';

describe('torch radius curve', () => {
  it('is full above 40% fuel', () => {
    expect(radiusForFuel(300, 300, 9)).toBe(9);
    expect(radiusForFuel(121, 300, 9)).toBe(9);
  });
  it('shrinks monotonically below 40% down to 30% of max, then 0', () => {
    let prev = Infinity;
    for (let f = 120; f > 0; f -= 5) {
      const r = radiusForFuel(f, 300, 9);
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      expect(r).toBeGreaterThanOrEqual(9 * 0.3 - 1e-9);
      prev = r;
    }
    expect(radiusForFuel(0.0001, 300, 9)).toBeCloseTo(2.7, 1);
    expect(radiusForFuel(0, 300, 9)).toBe(0);
  });
  it('upgrades raise radius and fuel', () => {
    expect(torchStats(0, 0).maxRadius).toBe(BASE_RADIUS);
    expect(torchStats(2, 0).maxRadius).toBeGreaterThan(BASE_RADIUS);
    expect(torchStats(0, 3).maxFuel).toBeGreaterThan(torchStats(0, 0).maxFuel);
  });
});

describe('torch fuel and state', () => {
  it('burns only while lit and goes out when empty', () => {
    const t = new TorchState(torchStats(0, 0));
    t.update(10);
    expect(t.fuel).toBe(300);
    t.lit = true;
    t.update(10);
    expect(t.fuel).toBe(290);
    const ev = t.update(400);
    expect(t.lit).toBe(false);
    expect(ev.some((e) => e.type === 'out' && e.reason === 'fuel')).toBe(true);
    expect(t.radius).toBe(0);
  });
  it('warns once when fuel runs low', () => {
    const t = new TorchState(torchStats(0, 0), true);
    const ev = t.update(250);
    expect(ev.filter((e) => e.type === 'lowFuel').length).toBe(1);
    expect(t.update(1).filter((e) => e.type === 'lowFuel').length).toBe(0);
  });
  it('relighting takes time and cannot happen while wet or empty', () => {
    const t = new TorchState(torchStats(0, 0), true);
    t.douse('water');
    expect(t.lit).toBe(false);
    expect(t.startRelight()[0]).toEqual({ type: 'relightFailed', why: 'wet' });
    t.update(3.1);
    expect(t.startRelight()[0]).toEqual({ type: 'relightStart' });
    t.update(RELIGHT_TIME - 0.1);
    expect(t.lit).toBe(false);
    expect(t.relightProgress).toBeGreaterThan(0.9);
    expect(t.update(0.2).some((e) => e.type === 'lit')).toBe(true);
    t.fuel = 0;
    t.lit = false;
    expect(t.startRelight()[0]).toEqual({ type: 'relightFailed', why: 'noFuel' });
  });
  it('dousing interrupts a relight', () => {
    const t = new TorchState(torchStats(0, 0));
    t.startRelight();
    t.update(1);
    t.douse('wind');
    expect(t.relighting).toBe(false);
    t.update(5);
    expect(t.lit).toBe(false);
  });
  it('gusts and falls', () => {
    expect(gustBlowoutChance(1, 0)).toBeGreaterThan(gustBlowoutChance(1, 0.6));
    expect(gustBlowoutChance(0, 0)).toBe(0);
    expect(fallBlowsOut(5)).toBe(false);
    expect(fallBlowsOut(12)).toBe(true);
  });
  it('oil adds fuel up to the max', () => {
    const t = new TorchState(torchStats(0, 0));
    t.fuel = 100;
    t.addFuel(90);
    expect(t.fuel).toBe(190);
    t.addFuel(1000);
    expect(t.fuel).toBe(300);
  });
});
