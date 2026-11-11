/**
 * The day clock: a compressed day from dawn to darkness, then the door's closing window.
 * Emits threshold events (final two minutes, final minute, darkness, door shut) and the
 * audible tick schedule. Pure logic, unit tested.
 */

export const DAY_LENGTH = 780; // seconds from dawn to darkness (13 minutes)
export const DOOR_CLOSE_TIME = 90; // seconds the great door takes to close after darkness
export const FINAL_TWO_MINUTES = 120;
export const FINAL_MINUTE = 60;

export type Phase = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'sunset' | 'dusk' | 'night';

export const PHASES: { phase: Phase; from: number }[] = [
  { phase: 'dawn', from: 0 },
  { phase: 'morning', from: 0.08 },
  { phase: 'noon', from: 0.4 },
  { phase: 'afternoon', from: 0.6 },
  { phase: 'sunset', from: 0.85 },
  { phase: 'dusk', from: 0.95 },
  { phase: 'night', from: 1.0 },
];

export function phaseAt(dayFrac: number): Phase {
  let p: Phase = 'dawn';
  for (const e of PHASES) if (dayFrac >= e.from) p = e.phase;
  return p;
}

export function phaseLabel(p: Phase): string {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/** Seconds between ticks given seconds remaining until darkness. */
export function tickInterval(remaining: number): number {
  if (remaining > FINAL_TWO_MINUTES) return 1.0;
  if (remaining <= 0) return 0.33;
  const t = 1 - remaining / FINAL_TWO_MINUTES; // 0 at 2:00 left, 1 at 0:00
  return 1.0 + (0.33 - 1.0) * t;
}

/** Tick loudness (0..1) given seconds remaining. */
export function tickVolume(remaining: number): number {
  if (remaining > FINAL_TWO_MINUTES) return 0.25;
  if (remaining <= 0) return 1.0;
  const t = 1 - remaining / FINAL_TWO_MINUTES;
  return 0.35 + (1.0 - 0.35) * t * t;
}

/** Edge pulse amplitude (0..1) and frequency (Hz) for the last minute. */
export function edgePulse(remaining: number): { amp: number; hz: number } {
  if (remaining > FINAL_MINUTE) return { amp: 0, hz: 0 };
  const t = Math.min(1, 1 - Math.max(0, remaining) / FINAL_MINUTE);
  return { amp: 0.35 + 0.65 * t, hz: 0.8 + 1.7 * t };
}

export type ClockEvent =
  | { type: 'tick'; volume: number }
  | { type: 'finalTwoMinutes' }
  | { type: 'finalMinute' }
  | { type: 'sunset' }
  | { type: 'darkness' }
  | { type: 'doorShut' };

export class DayClock {
  elapsed = 0;
  private nextTick = 1;
  private fired = new Set<string>();

  constructor(public dayLength = DAY_LENGTH, public doorCloseTime = DOOR_CLOSE_TIME, startElapsed = 0) {
    this.elapsed = startElapsed;
    this.nextTick = startElapsed + 1;
    // Thresholds already passed at construction do not fire.
    this.markPassed();
  }

  private markPassed() {
    const r = this.remaining;
    if (r <= FINAL_TWO_MINUTES) this.fired.add('finalTwoMinutes');
    if (r <= FINAL_MINUTE) this.fired.add('finalMinute');
    if (r <= FINAL_MINUTE) this.fired.add('sunset');
    if (r <= 0) this.fired.add('darkness');
    if (r <= -this.doorCloseTime) this.fired.add('doorShut');
  }

  /** Seconds until darkness (negative after darkness). */
  get remaining(): number {
    return this.dayLength - this.elapsed;
  }
  get dayFrac(): number {
    return this.elapsed / this.dayLength;
  }
  get phase(): Phase {
    return phaseAt(this.dayFrac);
  }
  get isDark(): boolean {
    return this.remaining <= 0;
  }
  /** 0 = door fully open, 1 = fully shut. Only moves after darkness. */
  get doorClosure(): number {
    if (this.remaining > 0) return 0;
    return Math.min(1, -this.remaining / this.doorCloseTime);
  }
  get doorShut(): boolean {
    return this.remaining <= -this.doorCloseTime;
  }

  /** Jump the clock (debug / "swept downstream" penalty). Thresholds crossed by the jump still fire. */
  advance(seconds: number): ClockEvent[] {
    return this.update(seconds);
  }

  setRemaining(seconds: number) {
    this.elapsed = this.dayLength - seconds;
    this.nextTick = this.elapsed + tickInterval(this.remaining);
    this.fired.clear();
    this.markPassed();
  }

  update(dt: number): ClockEvent[] {
    const events: ClockEvent[] = [];
    if (dt <= 0) return events;
    this.elapsed += dt;
    const r = this.remaining;
    const once = (key: ClockEvent['type'], cond: boolean) => {
      if (cond && !this.fired.has(key)) {
        this.fired.add(key);
        events.push({ type: key } as ClockEvent);
      }
    };
    once('finalTwoMinutes', r <= FINAL_TWO_MINUTES);
    once('finalMinute', r <= FINAL_MINUTE);
    once('sunset', r <= FINAL_MINUTE);
    once('darkness', r <= 0);
    once('doorShut', r <= -this.doorCloseTime);

    // Audible ticks until the door has shut. Guard against long frames creating bursts.
    let guard = 0;
    while (this.elapsed >= this.nextTick && guard++ < 4) {
      const rem = this.dayLength - this.nextTick;
      if (rem > -this.doorCloseTime) events.push({ type: 'tick', volume: tickVolume(rem) });
      this.nextTick += tickInterval(rem);
    }
    if (this.elapsed >= this.nextTick) this.nextTick = this.elapsed + tickInterval(r);
    return events;
  }
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}
