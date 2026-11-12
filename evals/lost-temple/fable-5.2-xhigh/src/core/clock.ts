/**
 * The day clock: one compressed day from dawn to darkness, then the short
 * window in which the great door grinds shut.
 * Pure rules, driven by `advance(dt)`. Unit-tested in tests/clock.test.ts.
 */
import { clamp01, lerp } from './rng';
import type { SceneId } from './scenes';

export const DAY_LENGTH = 780; // seconds of daylight: 13 minutes
export const DOOR_CLOSE_TIME = 60; // seconds from darkness until the door is shut
export const WARN_TICK_AT = 120; // ticking accelerates below this
export const WARN_PULSE_AT = 60; // edge pulse, danger music, rumble
/** Gap (m) of the fully open great door. */
export const DOOR_OPEN_HEIGHT = 5.2;
/** The player needs this much gap to pass standing / crouched. */
export const DOOR_STAND_GAP = 1.85;
export const DOOR_CROUCH_GAP = 1.15;

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

export type ClockEvent =
  | { type: 'tick'; volume: number; urgent: boolean }
  | { type: 'twoMinutes' }
  | { type: 'oneMinute' }
  | { type: 'darkness' }
  | { type: 'wave'; scene: SceneId; index: number }
  | { type: 'doorClosed' };

/** Guardian waves after darkness: deepest scene first, sweeping outward. */
export const WAVES: { delay: number; scene: SceneId }[] = [
  { delay: 0, scene: 'vault' },
  { delay: 12, scene: 'catacombs' },
  { delay: 24, scene: 'sanctum' },
  { delay: 34, scene: 'halls' },
  { delay: 46, scene: 'courtyard' },
];

/** Seconds between ticks for a given time left. 1 s normally, down to 0.3 s at zero. */
export function tickInterval(remaining: number): number {
  if (remaining > WARN_TICK_AT) return 1;
  const k = clamp01(1 - remaining / WARN_TICK_AT);
  return lerp(1, 0.3, k * k * 0.6 + k * 0.4);
}

/** Tick loudness 0..1 for a given time left. Quiet all day, loud at the end. */
export function tickVolume(remaining: number): number {
  if (remaining > WARN_TICK_AT) return 0.22;
  const k = clamp01(1 - remaining / WARN_TICK_AT);
  return lerp(0.22, 1, k);
}

export function phaseOf(t: number): DayPhase {
  const f = t / DAY_LENGTH;
  if (f >= 1) return 'night';
  if (f < 0.1) return 'dawn';
  if (f < 0.72) return 'day';
  return 'dusk';
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

export class DayClock {
  /** Seconds since dawn. */
  t = 0;
  private tickAcc = 0;
  private firedTwo = false;
  private firedOne = false;
  private firedDark = false;
  private firedClosed = false;
  private wavesFired = 0;

  constructor(startT = 0) {
    this.t = startT;
    // If a run is started late (debug time skip), do not replay warnings that
    // are already in the past. Darkness itself always fires so guardians wake.
    this.firedTwo = this.remaining < WARN_TICK_AT;
    this.firedOne = this.remaining < WARN_PULSE_AT;
  }

  /** Debug: jump to an absolute time. Past warnings are swallowed, darkness is not. */
  jumpTo(t: number): void {
    this.t = t;
    this.tickAcc = 0;
    if (this.remaining < WARN_TICK_AT) this.firedTwo = true;
    if (this.remaining < WARN_PULSE_AT) this.firedOne = true;
  }

  /** Seconds of daylight left (0 once dark). */
  get remaining(): number {
    return Math.max(0, DAY_LENGTH - this.t);
  }

  /** 0 at dawn, 1 at darkness, keeps growing past 1 at night. */
  get dayFraction(): number {
    return this.t / DAY_LENGTH;
  }

  get phase(): DayPhase {
    return phaseOf(this.t);
  }

  get isDark(): boolean {
    return this.t >= DAY_LENGTH;
  }

  /** Seconds since darkness fell (0 before). */
  get sinceDark(): number {
    return Math.max(0, this.t - DAY_LENGTH);
  }

  /** True during the last minute of daylight. */
  get pulsing(): boolean {
    return !this.isDark && this.remaining <= WARN_PULSE_AT;
  }

  /** 0..1 strength of the last-minute warning (edge pulse, rumble). */
  get dread(): number {
    if (this.isDark) return 1;
    if (this.remaining > WARN_PULSE_AT) return 0;
    return lerp(0.35, 1, 1 - this.remaining / WARN_PULSE_AT);
  }

  /** 1 = fully open, 0 = shut. */
  get doorOpenFraction(): number {
    if (!this.isDark) return 1;
    return clamp01(1 - this.sinceDark / DOOR_CLOSE_TIME);
  }

  /** Current gap under the descending door slab, metres. */
  get doorGap(): number {
    return DOOR_OPEN_HEIGHT * this.doorOpenFraction;
  }

  get doorClosed(): boolean {
    return this.sinceDark >= DOOR_CLOSE_TIME;
  }

  /** Seconds until the door is shut (counts the whole remaining day too). */
  get untilDoorShut(): number {
    return Math.max(0, DAY_LENGTH + DOOR_CLOSE_TIME - this.t);
  }

  /** Advance time and report everything that happened in this step, in order. */
  advance(dt: number): ClockEvent[] {
    const events: ClockEvent[] = [];
    if (dt <= 0) return events;
    this.t += dt;

    if (!this.firedTwo && this.remaining <= WARN_TICK_AT) {
      this.firedTwo = true;
      events.push({ type: 'twoMinutes' });
    }
    if (!this.firedOne && this.remaining <= WARN_PULSE_AT) {
      this.firedOne = true;
      events.push({ type: 'oneMinute' });
    }

    // The clock only ticks while there is daylight left to count.
    if (!this.isDark) {
      this.tickAcc += dt;
      const interval = tickInterval(this.remaining);
      if (this.tickAcc >= interval) {
        this.tickAcc = this.tickAcc % interval;
        events.push({
          type: 'tick',
          volume: tickVolume(this.remaining),
          urgent: this.remaining <= WARN_TICK_AT,
        });
      }
    }

    if (!this.firedDark && this.isDark) {
      this.firedDark = true;
      events.push({ type: 'darkness' });
    }
    if (this.isDark) {
      while (this.wavesFired < WAVES.length && this.sinceDark >= WAVES[this.wavesFired].delay) {
        events.push({ type: 'wave', scene: WAVES[this.wavesFired].scene, index: this.wavesFired });
        this.wavesFired++;
      }
    }
    if (!this.firedClosed && this.doorClosed) {
      this.firedClosed = true;
      events.push({ type: 'doorClosed' });
    }
    return events;
  }
}
