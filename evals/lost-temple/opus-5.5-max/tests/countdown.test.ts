import { describe, it, expect } from 'vitest';
import { DayClock, DAY_LENGTH, DOOR_CLOSE_TIME, tickInterval, tickVolume, edgePulse, phaseAt, formatClock } from '../src/logic/countdown';

describe('day length', () => {
  it('is a compressed 12 to 15 minute day', () => {
    expect(DAY_LENGTH).toBeGreaterThanOrEqual(12 * 60);
    expect(DAY_LENGTH).toBeLessThanOrEqual(15 * 60);
  });
});

describe('tick schedule', () => {
  it('ticks once a second until the last two minutes', () => {
    expect(tickInterval(600)).toBe(1);
    expect(tickInterval(121)).toBe(1);
    expect(tickVolume(300)).toBeCloseTo(0.25);
  });
  it('speeds up and gets louder in the last two minutes', () => {
    expect(tickInterval(60)).toBeLessThan(tickInterval(119));
    expect(tickInterval(1)).toBeLessThan(tickInterval(60));
    expect(tickInterval(0)).toBeCloseTo(0.33);
    expect(tickVolume(60)).toBeGreaterThan(tickVolume(119));
    expect(tickVolume(0)).toBeCloseTo(1);
  });
  it('emits accelerating ticks from the clock', () => {
    const c = new DayClock();
    let early = 0;
    for (let i = 0; i < 600; i++) early += c.update(0.1).filter((e) => e.type === 'tick').length; // first 60 s
    c.setRemaining(60);
    let late = 0;
    for (let i = 0; i < 600; i++) late += c.update(0.1).filter((e) => e.type === 'tick').length; // last 60 s
    expect(early).toBeGreaterThanOrEqual(59);
    expect(early).toBeLessThanOrEqual(61);
    expect(late).toBeGreaterThan(early * 1.5);
  });
});

describe('thresholds', () => {
  it('fires final two minutes, final minute, darkness and door shut exactly once, in order', () => {
    const c = new DayClock();
    const seen: string[] = [];
    for (let t = 0; t < DAY_LENGTH + DOOR_CLOSE_TIME + 5; t += 0.5) {
      for (const e of c.update(0.5)) if (e.type !== 'tick') seen.push(e.type);
    }
    expect(seen).toEqual(['finalTwoMinutes', 'finalMinute', 'sunset', 'darkness', 'doorShut']);
  });
  it('fires final minute when remaining crosses 60 s', () => {
    const c = new DayClock();
    c.setRemaining(60.2);
    expect(c.update(0.1).some((e) => e.type === 'finalMinute')).toBe(false);
    expect(c.update(0.2).some((e) => e.type === 'finalMinute')).toBe(true);
  });
  it('door only closes after darkness and takes the full window', () => {
    const c = new DayClock();
    c.setRemaining(10);
    expect(c.doorClosure).toBe(0);
    c.update(10);
    expect(c.isDark).toBe(true);
    expect(c.doorClosure).toBeCloseTo(0, 5);
    c.update(DOOR_CLOSE_TIME / 2);
    expect(c.doorClosure).toBeCloseTo(0.5, 5);
    expect(c.doorShut).toBe(false);
    c.update(DOOR_CLOSE_TIME / 2 + 0.01);
    expect(c.doorShut).toBe(true);
  });
  it('a time jump still fires the thresholds it skips', () => {
    const c = new DayClock();
    c.setRemaining(70);
    const ev = c.advance(80).map((e) => e.type);
    expect(ev).toContain('finalMinute');
    expect(ev).toContain('darkness');
  });
  it('setRemaining does not re-fire thresholds already passed', () => {
    const c = new DayClock();
    c.setRemaining(30);
    expect(c.update(0.1).filter((e) => e.type !== 'tick')).toEqual([]);
  });
});

describe('edge pulse and phases', () => {
  it('pulses only in the last minute and quickens', () => {
    expect(edgePulse(61).amp).toBe(0);
    expect(edgePulse(59).amp).toBeGreaterThan(0);
    expect(edgePulse(5).hz).toBeGreaterThan(edgePulse(55).hz);
  });
  it('walks dawn to night', () => {
    expect(phaseAt(0)).toBe('dawn');
    expect(phaseAt(0.5)).toBe('noon');
    expect(phaseAt(0.9)).toBe('sunset');
    expect(phaseAt(1.01)).toBe('night');
  });
  it('formats the countdown', () => {
    expect(formatClock(780)).toBe('13:00');
    expect(formatClock(59.2)).toBe('1:00');
    expect(formatClock(-5)).toBe('0:00');
  });
});
