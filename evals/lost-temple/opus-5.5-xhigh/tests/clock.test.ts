import { describe, it, expect } from 'vitest';
import {
  RunClock, phaseFor, tickInterval, tickVolume, DAY_SECONDS, FINAL_WINDOW, sunAt, gradeAt, gameHour, formatClock,
} from '../src/logic/clock';

describe('countdown thresholds', () => {
  it('phases switch at 120 s, 60 s, 0 and the end of the final window', () => {
    expect(phaseFor(0)).toBe('day');
    expect(phaseFor(DAY_SECONDS - 121)).toBe('day');
    expect(phaseFor(DAY_SECONDS - 120)).toBe('late');
    expect(phaseFor(DAY_SECONDS - 61)).toBe('late');
    expect(phaseFor(DAY_SECONDS - 60)).toBe('critical');
    expect(phaseFor(DAY_SECONDS - 0.01)).toBe('critical');
    expect(phaseFor(DAY_SECONDS)).toBe('dark');
    expect(phaseFor(DAY_SECONDS + FINAL_WINDOW - 0.01)).toBe('dark');
    expect(phaseFor(DAY_SECONDS + FINAL_WINDOW)).toBe('sealed');
  });
  it('emits each phase exactly once, in order, even across a big jump', () => {
    const c = new RunClock(DAY_SECONDS - 125);
    const ev = c.advance(200).filter((e) => e.type === 'phase').map((e: any) => e.phase);
    expect(ev).toEqual(['late', 'critical', 'dark', 'sealed']);
    expect(c.advance(10).filter((e) => e.type === 'phase')).toEqual([]);
  });
  it('ticks once a second normally, faster and louder in the last two minutes', () => {
    expect(tickInterval(500)).toBe(1);
    expect(tickInterval(120)).toBeCloseTo(1);
    expect(tickInterval(60)).toBeLessThan(1);
    expect(tickInterval(1)).toBeLessThan(0.3);
    expect(tickVolume(500)).toBe(0.25);
    expect(tickVolume(30)).toBeGreaterThan(tickVolume(90));
    const c = new RunClock(0);
    let ticks = 0;
    for (let i = 0; i < 600; i++) ticks += c.update(1 / 60).filter((e) => e.type === 'tick').length;
    expect(ticks).toBe(10);
    const late = new RunClock(DAY_SECONDS - 30);
    let lateTicks = 0;
    for (let i = 0; i < 600; i++) lateTicks += late.update(1 / 60).filter((e) => e.type === 'tick').length;
    expect(lateTicks).toBeGreaterThan(20);
  });
  it('the door closes over the final window', () => {
    const c = new RunClock(DAY_SECONDS);
    expect(c.doorClosure).toBe(0);
    c.update(FINAL_WINDOW / 2);
    expect(c.doorClosure).toBeCloseTo(0.5);
    c.update(FINAL_WINDOW);
    expect(c.doorClosure).toBe(1);
  });
});

describe('sun', () => {
  it('rises in the east, is due south and high at midday, sets in the west', () => {
    const dawn = sunAt(0);
    const noon = sunAt(DAY_SECONDS / 2);
    const dusk = sunAt(DAY_SECONDS * 0.99);
    expect(dawn.dir[0]).toBeGreaterThan(0.9);
    expect(noon.dir[2]).toBeGreaterThan(0.25);
    expect(Math.abs(noon.dir[0])).toBeLessThan(0.01);
    expect(noon.elevationDeg).toBeCloseTo(72, 0);
    expect(dusk.dir[0]).toBeLessThan(-0.9);
    expect(dusk.elevationDeg).toBeLessThan(dawn.elevationDeg + 1);
    expect(sunAt(DAY_SECONDS + 5).isMoon).toBe(true);
  });
  it('game hours run 06:00 → 19:00', () => {
    expect(gameHour(0)).toBe(6);
    expect(gameHour(DAY_SECONDS)).toBe(19);
    expect(formatClock(61)).toBe('1:01');
  });
  it('grading goes warm at sunset and cold at night', () => {
    const noon = gradeAt(DAY_SECONDS / 2);
    const sunset = gradeAt(DAY_SECONDS * 0.92);
    const night = gradeAt(DAY_SECONDS * 1.08);
    expect(sunset.tint[0]).toBeGreaterThan(noon.tint[0]);
    expect(sunset.sunColor[2]).toBeLessThan(noon.sunColor[2]);
    expect(night.tint[2]).toBeGreaterThan(night.tint[0]);
    expect(night.sunIntensity).toBeLessThan(noon.sunIntensity);
  });
});
