import { describe, expect, it } from 'vitest';
import {
  CROUCH_CLEARANCE, DAY_LENGTH, DOOR_HEIGHT, ENTOMB_DELAY, FINAL_WINDOW, STAND_CLEARANCE, doorClosedFraction, doorPassableFor, dreadLevel, eventsBetween, formatTime, phaseAt,
  sundialShadowAngle, tickInterval, tickVolume, timeLeft,
} from '../src/core/clock';

describe('countdown', () => {
  it('runs a compressed 12 to 15 minute day', () => {
    expect(DAY_LENGTH).toBeGreaterThanOrEqual(12 * 60);
    expect(DAY_LENGTH).toBeLessThanOrEqual(15 * 60);
  });
  it('counts down to darkness', () => {
    expect(timeLeft(0)).toBe(DAY_LENGTH);
    expect(timeLeft(DAY_LENGTH)).toBe(0);
    expect(timeLeft(DAY_LENGTH + 5)).toBe(-5);
  });
  it('moves through the phases', () => {
    expect(phaseAt(0)).toBe('dawn');
    expect(phaseAt(DAY_LENGTH / 2)).toBe('day');
    expect(phaseAt(DAY_LENGTH - 119)).toBe('lastTwoMinutes');
    expect(phaseAt(DAY_LENGTH - 60)).toBe('lastMinute');
    expect(phaseAt(DAY_LENGTH)).toBe('dark');
    expect(phaseAt(DAY_LENGTH + FINAL_WINDOW)).toBe('sealed');
  });
});

describe('threshold events', () => {
  it('fires each threshold exactly once as time crosses it', () => {
    const seen: string[] = [];
    let prev = 0;
    for (let t = 0.016; t < DAY_LENGTH + FINAL_WINDOW + ENTOMB_DELAY + 5; t += 0.016) {
      seen.push(...eventsBetween(prev, t));
      prev = t;
    }
    expect(seen).toEqual(['twoMinutes', 'oneMinute', 'darkness', 'doorSealed', 'entombed']);
  });
  it('fires at 120 s, 60 s and 0 s left', () => {
    expect(eventsBetween(DAY_LENGTH - 121, DAY_LENGTH - 120)).toEqual(['twoMinutes']);
    expect(eventsBetween(DAY_LENGTH - 61, DAY_LENGTH - 60)).toEqual(['oneMinute']);
    expect(eventsBetween(DAY_LENGTH - 1, DAY_LENGTH)).toEqual(['darkness']);
    expect(eventsBetween(DAY_LENGTH - 130, DAY_LENGTH - 121)).toEqual([]);
  });
  it('reports several thresholds in order after a long frame', () => {
    expect(eventsBetween(DAY_LENGTH - 200, DAY_LENGTH + 1)).toEqual(['twoMinutes', 'oneMinute', 'darkness']);
  });
  it('does not re-fire a threshold already passed', () => {
    expect(eventsBetween(DAY_LENGTH, DAY_LENGTH + 1)).toEqual([]);
  });
});

describe('ticking', () => {
  it('ticks once a second until the last two minutes', () => {
    expect(tickInterval(500)).toBe(1);
    expect(tickInterval(120)).toBe(1);
  });
  it('speeds up and gets louder through the last two minutes', () => {
    let prevI = tickInterval(120), prevV = tickVolume(120);
    for (let left = 110; left > 0; left -= 10) {
      const i = tickInterval(left), v = tickVolume(left);
      expect(i).toBeLessThan(prevI);
      expect(v).toBeGreaterThan(prevV);
      prevI = i; prevV = v;
    }
    expect(tickInterval(1)).toBeLessThan(0.3);
    expect(tickVolume(1)).toBeGreaterThan(0.95);
  });
  it('stops at darkness', () => {
    expect(tickInterval(0)).toBe(0);
    expect(tickVolume(-3)).toBe(0);
  });
});

describe('last minute and the door', () => {
  it('has no dread before the last minute and builds through it', () => {
    expect(dreadLevel(61)).toBe(0);
    expect(dreadLevel(60)).toBeGreaterThan(0);
    expect(dreadLevel(10)).toBeGreaterThan(dreadLevel(50));
    expect(dreadLevel(-5)).toBe(1);
  });
  it('keeps the door open all day, then closes it over the final window', () => {
    expect(doorClosedFraction(DAY_LENGTH - 1)).toBe(0);
    expect(doorClosedFraction(DAY_LENGTH + FINAL_WINDOW)).toBe(1);
    expect(doorClosedFraction(DAY_LENGTH + 999)).toBe(1);
    let prev = 0;
    for (let s = 0; s <= FINAL_WINDOW; s++) { const f = doorClosedFraction(DAY_LENGTH + s); expect(f).toBeGreaterThanOrEqual(prev); prev = f; }
  });
  it('leaves most of the final window usable: walk under late, duck under later still', () => {
    const stand = doorPassableFor(STAND_CLEARANCE), crouch = doorPassableFor(CROUCH_CLEARANCE);
    expect(stand).toBeGreaterThan(FINAL_WINDOW * 0.8);
    expect(crouch).toBeGreaterThan(stand + 2);
    expect(crouch).toBeLessThan(FINAL_WINDOW);
    // The numbers agree with the curve itself.
    expect((1 - doorClosedFraction(DAY_LENGTH + stand - 0.5)) * DOOR_HEIGHT).toBeGreaterThan(STAND_CLEARANCE);
    expect((1 - doorClosedFraction(DAY_LENGTH + stand + 0.5)) * DOOR_HEIGHT).toBeLessThan(STAND_CLEARANCE);
  });
  it('sweeps the sundial shadow over a half circle', () => {
    expect(sundialShadowAngle(0)).toBe(0);
    expect(sundialShadowAngle(DAY_LENGTH / 2)).toBeCloseTo(Math.PI / 2);
    expect(sundialShadowAngle(DAY_LENGTH * 2)).toBeCloseTo(Math.PI);
  });
  it('formats time', () => {
    expect(formatTime(125)).toBe('2:05');
    expect(formatTime(59.2)).toBe('1:00');
    expect(formatTime(-4)).toBe('0:00');
  });
});
