import { describe, it, expect } from 'vitest';
import { DAY_LENGTH, phaseAt, tickInterval, tickVolume, sunDirection, sunElevationDeg, doorOpenFraction, DOOR_CLOSE_TIME, fmtClock } from '../src/logic/countdown';

describe('countdown thresholds', () => {
  it('is a 12-15 minute day', () => {
    expect(DAY_LENGTH).toBeGreaterThanOrEqual(720);
    expect(DAY_LENGTH).toBeLessThanOrEqual(900);
  });
  it('moves through phases at 120 s, 60 s, 0 and door close', () => {
    expect(phaseAt(0)).toBe('normal');
    expect(phaseAt(DAY_LENGTH - 121)).toBe('normal');
    expect(phaseAt(DAY_LENGTH - 120)).toBe('urgent');
    expect(phaseAt(DAY_LENGTH - 61)).toBe('urgent');
    expect(phaseAt(DAY_LENGTH - 60)).toBe('critical');
    expect(phaseAt(DAY_LENGTH - 1)).toBe('critical');
    expect(phaseAt(DAY_LENGTH)).toBe('dark');
    expect(phaseAt(DAY_LENGTH + DOOR_CLOSE_TIME - 0.1)).toBe('dark');
    expect(phaseAt(DAY_LENGTH + DOOR_CLOSE_TIME)).toBe('sealed');
  });
  it('ticks faster and louder in the last two minutes', () => {
    expect(tickInterval(0)).toBe(1);
    expect(tickInterval(DAY_LENGTH - 60)).toBeLessThan(tickInterval(DAY_LENGTH - 119));
    expect(tickInterval(DAY_LENGTH - 1)).toBeLessThan(0.3);
    expect(tickVolume(DAY_LENGTH - 10)).toBeGreaterThan(tickVolume(DAY_LENGTH - 100));
    expect(tickVolume(DAY_LENGTH - 100)).toBeGreaterThan(tickVolume(0));
  });
  it('closes the door over the final window', () => {
    expect(doorOpenFraction(DAY_LENGTH - 5)).toBe(1);
    expect(doorOpenFraction(DAY_LENGTH + DOOR_CLOSE_TIME / 2)).toBeCloseTo(0.5);
    expect(doorOpenFraction(DAY_LENGTH + DOOR_CLOSE_TIME + 3)).toBe(0);
  });
  it('sun rises in the east, peaks around noon and sets in the west at zero', () => {
    const dawn = sunDirection(0);
    expect(dawn[0]).toBeGreaterThan(0.9);
    expect(sunElevationDeg(0)).toBeCloseTo(4, 0);
    expect(sunElevationDeg(DAY_LENGTH / 2)).toBeCloseTo(68, 0);
    expect(sunElevationDeg(DAY_LENGTH)).toBeCloseTo(0, 1);
    expect(sunDirection(DAY_LENGTH)[0]).toBeLessThan(-0.9);
    expect(sunElevationDeg(DAY_LENGTH + 30)).toBeLessThan(0);
  });
  it('formats the clock', () => {
    expect(fmtClock(780)).toBe('13:00');
    expect(fmtClock(59.2)).toBe('1:00');
    expect(fmtClock(-3)).toBe('0:00');
  });
});
