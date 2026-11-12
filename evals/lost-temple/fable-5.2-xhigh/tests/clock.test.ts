import { describe, expect, it } from 'vitest';
import {
  DAY_LENGTH, DOOR_CLOSE_TIME, DOOR_CROUCH_GAP, DOOR_OPEN_HEIGHT, DOOR_STAND_GAP, DayClock, WARN_PULSE_AT,
  WARN_TICK_AT, WAVES, formatClock, phaseOf, tickInterval, tickVolume, type ClockEvent,
} from '../src/core/clock';

function run(clock: DayClock, seconds: number, step = 1 / 60): ClockEvent[] {
  const out: ClockEvent[] = [];
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) out.push(...clock.advance(step));
  return out;
}

describe('day clock', () => {
  it('is a compressed 12 to 15 minute day', () => {
    expect(DAY_LENGTH).toBeGreaterThanOrEqual(12 * 60);
    expect(DAY_LENGTH).toBeLessThanOrEqual(15 * 60);
  });

  it('counts down from the full day to zero and never below', () => {
    const c = new DayClock();
    expect(c.remaining).toBe(DAY_LENGTH);
    c.advance(100);
    expect(c.remaining).toBe(DAY_LENGTH - 100);
    c.advance(DAY_LENGTH);
    expect(c.remaining).toBe(0);
    expect(c.isDark).toBe(true);
  });

  it('ticks once per second for most of the day', () => {
    const c = new DayClock();
    const ticks = run(c, 60).filter((e) => e.type === 'tick');
    expect(ticks.length).toBeGreaterThanOrEqual(59);
    expect(ticks.length).toBeLessThanOrEqual(61);
    expect(ticks.every((t) => t.type === 'tick' && !t.urgent)).toBe(true);
  });

  it('tick interval is 1 s until two minutes are left, then shortens monotonically', () => {
    expect(tickInterval(DAY_LENGTH)).toBe(1);
    expect(tickInterval(WARN_TICK_AT + 0.01)).toBe(1);
    let prev = tickInterval(WARN_TICK_AT);
    for (let r = WARN_TICK_AT - 1; r >= 0; r--) {
      const cur = tickInterval(r);
      expect(cur).toBeLessThanOrEqual(prev + 1e-9);
      prev = cur;
    }
    expect(tickInterval(0)).toBeCloseTo(0.3, 5);
  });

  it('tick volume rises through the last two minutes', () => {
    expect(tickVolume(500)).toBeLessThan(0.3);
    expect(tickVolume(60)).toBeGreaterThan(tickVolume(119));
    expect(tickVolume(0)).toBeCloseTo(1, 5);
  });

  it('ticks faster in the last two minutes than before', () => {
    const c = new DayClock(DAY_LENGTH - 30);
    const ticks = run(c, 20).filter((e) => e.type === 'tick');
    expect(ticks.length).toBeGreaterThan(30);
    expect(ticks.every((t) => t.type === 'tick' && t.urgent)).toBe(true);
  });

  it('fires each threshold exactly once and in order', () => {
    const c = new DayClock(DAY_LENGTH - 130);
    const ev = run(c, 130 + DOOR_CLOSE_TIME + 5).filter((e) => e.type !== 'tick' && e.type !== 'wave');
    expect(ev.map((e) => e.type)).toEqual(['twoMinutes', 'oneMinute', 'darkness', 'doorClosed']);
  });

  it('fires the two-minute warning at 120 s and the one-minute warning at 60 s', () => {
    const c = new DayClock();
    let twoAt = -1;
    let oneAt = -1;
    for (let i = 0; i < DAY_LENGTH * 10; i++) {
      for (const e of c.advance(0.1)) {
        if (e.type === 'twoMinutes') twoAt = c.remaining;
        if (e.type === 'oneMinute') oneAt = c.remaining;
      }
    }
    expect(twoAt).toBeGreaterThan(WARN_TICK_AT - 0.2);
    expect(twoAt).toBeLessThanOrEqual(WARN_TICK_AT);
    expect(oneAt).toBeGreaterThan(WARN_PULSE_AT - 0.2);
    expect(oneAt).toBeLessThanOrEqual(WARN_PULSE_AT);
  });

  it('pulses only during the final minute of daylight', () => {
    const c = new DayClock();
    c.advance(DAY_LENGTH - 61);
    expect(c.pulsing).toBe(false);
    expect(c.dread).toBe(0);
    c.advance(2);
    expect(c.pulsing).toBe(true);
    expect(c.dread).toBeGreaterThan(0);
    const early = c.dread;
    c.advance(50);
    expect(c.dread).toBeGreaterThan(early);
  });

  it('stops ticking at zero', () => {
    const c = new DayClock(DAY_LENGTH + 1);
    expect(run(c, 10).some((e) => e.type === 'tick')).toBe(false);
  });

  it('door stays open all day, then closes linearly over the final window', () => {
    const c = new DayClock();
    c.advance(DAY_LENGTH - 1);
    expect(c.doorOpenFraction).toBe(1);
    expect(c.doorGap).toBe(DOOR_OPEN_HEIGHT);
    c.advance(1 + DOOR_CLOSE_TIME / 2);
    expect(c.doorOpenFraction).toBeCloseTo(0.5, 5);
    expect(c.doorClosed).toBe(false);
    c.advance(DOOR_CLOSE_TIME / 2);
    expect(c.doorOpenFraction).toBe(0);
    expect(c.doorClosed).toBe(true);
  });

  it('leaves a short final window: standing, then crouch-only, then shut', () => {
    const standUntil = DOOR_CLOSE_TIME * (1 - DOOR_STAND_GAP / DOOR_OPEN_HEIGHT);
    const crouchUntil = DOOR_CLOSE_TIME * (1 - DOOR_CROUCH_GAP / DOOR_OPEN_HEIGHT);
    expect(standUntil).toBeGreaterThan(30);
    expect(crouchUntil).toBeGreaterThan(standUntil + 5);
    expect(crouchUntil).toBeLessThan(DOOR_CLOSE_TIME);
    const c = new DayClock(DAY_LENGTH + standUntil - 1);
    expect(c.doorGap).toBeGreaterThan(DOOR_STAND_GAP);
    c.advance(2);
    expect(c.doorGap).toBeLessThan(DOOR_STAND_GAP);
    expect(c.doorGap).toBeGreaterThan(DOOR_CROUCH_GAP);
  });

  it('wakes guardians in waves, deepest scene first', () => {
    const c = new DayClock(DAY_LENGTH - 1);
    const waves = run(c, 70).filter((e) => e.type === 'wave');
    expect(waves.map((w) => (w.type === 'wave' ? w.scene : ''))).toEqual(['vault', 'catacombs', 'sanctum', 'halls', 'courtyard']);
    for (let i = 1; i < WAVES.length; i++) expect(WAVES[i].delay).toBeGreaterThan(WAVES[i - 1].delay);
    expect(WAVES[WAVES.length - 1].delay).toBeLessThan(DOOR_CLOSE_TIME);
  });

  it('a late-started clock does not replay old warnings but still fires darkness', () => {
    const c = new DayClock(DAY_LENGTH - 10);
    const ev = run(c, 12).filter((e) => e.type !== 'tick' && e.type !== 'wave');
    expect(ev.map((e) => e.type)).toEqual(['darkness']);
  });

  it('names the phases of the day', () => {
    expect(phaseOf(0)).toBe('dawn');
    expect(phaseOf(DAY_LENGTH * 0.5)).toBe('day');
    expect(phaseOf(DAY_LENGTH * 0.9)).toBe('dusk');
    expect(phaseOf(DAY_LENGTH + 1)).toBe('night');
  });

  it('formats time left', () => {
    expect(formatClock(780)).toBe('13:00');
    expect(formatClock(59.2)).toBe('1:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(-3)).toBe('0:00');
  });
});
