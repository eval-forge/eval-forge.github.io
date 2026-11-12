import { describe, it, expect } from 'vitest';
import { clockPhase, tickInterval, tickVolume, crossedThresholds, doorClosedFraction, sunDirection, sunElevation, DAY_LENGTH, DOOR_CLOSE_TIME, formatClock, gradeKey } from '../src/logic/countdown';

describe('countdown thresholds', () => {
  it('phases switch at 120 s, 60 s, 0 and after the door window', () => {
    expect(clockPhase(DAY_LENGTH)).toBe('day');
    expect(clockPhase(121)).toBe('day');
    expect(clockPhase(120)).toBe('urgent');
    expect(clockPhase(61)).toBe('urgent');
    expect(clockPhase(60)).toBe('critical');
    expect(clockPhase(0.01)).toBe('critical');
    expect(clockPhase(0)).toBe('night');
    expect(clockPhase(-DOOR_CLOSE_TIME + 0.1)).toBe('night');
    expect(clockPhase(-DOOR_CLOSE_TIME)).toBe('sealed');
  });

  it('ticking speeds up and gets louder in the last 2 minutes', () => {
    expect(tickInterval(300)).toBe(1);
    expect(tickInterval(120)).toBeCloseTo(1);
    expect(tickInterval(60)).toBeLessThan(1);
    expect(tickInterval(1)).toBeLessThan(tickInterval(60));
    expect(tickVolume(300)).toBeLessThan(tickVolume(100));
    expect(tickVolume(10)).toBeGreaterThan(tickVolume(100));
  });

  it('reports threshold crossings exactly once', () => {
    expect(crossedThresholds(121, 119)).toEqual(['urgent']);
    expect(crossedThresholds(61, 59)).toEqual(['critical']);
    expect(crossedThresholds(0.5, -0.5)).toEqual(['night']);
    expect(crossedThresholds(-74, -76)).toEqual(['sealed']);
    expect(crossedThresholds(119, 118)).toEqual([]);
  });

  it('door closes over the final window', () => {
    expect(doorClosedFraction(10)).toBe(0);
    expect(doorClosedFraction(-DOOR_CLOSE_TIME / 2)).toBeCloseTo(0.5);
    expect(doorClosedFraction(-1000)).toBe(1);
  });

  it('sun rises in the east, peaks around noon in the south, sets in the west', () => {
    const dawn = sunDirection(DAY_LENGTH), noon = sunDirection(DAY_LENGTH / 2), dusk = sunDirection(1);
    expect(dawn.x).toBeGreaterThan(0.9);
    expect(dusk.x).toBeLessThan(-0.9);
    expect(noon.z).toBeGreaterThan(0.2);
    expect(noon.y).toBeGreaterThan(0.9);
    expect(sunElevation(-30)).toBeLessThan(0);
    expect(Math.hypot(noon.x, noon.y, noon.z)).toBeCloseTo(1);
  });

  it('grading goes dawn → noon → sunset → night', () => {
    expect(gradeKey(DAY_LENGTH)).toBe(0);
    expect(gradeKey(DAY_LENGTH / 2)).toBe(1);
    expect(gradeKey(0.01)).toBeCloseTo(2, 1);
    expect(gradeKey(-60)).toBe(3);
  });

  it('formats the clock', () => {
    expect(formatClock(780)).toBe('13:00');
    expect(formatClock(59.2)).toBe('1:00');
    expect(formatClock(-5)).toBe('0:00');
  });
});
