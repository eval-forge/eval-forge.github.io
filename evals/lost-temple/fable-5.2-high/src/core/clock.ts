import { clamp01, lerp } from './types';

/** Seconds of game time from sunrise to sunset. */
export const DAY_LENGTH = 780;
/** Seconds the Great Door takes to close after darkness falls. */
export const FINAL_WINDOW = 60;
/** Seconds after the door seals before a trapped player is entombed. */
export const ENTOMB_DELAY = 90;
export const TWO_MINUTES = 120;
export const ONE_MINUTE = 60;

export type ClockPhase = 'dawn' | 'day' | 'lastTwoMinutes' | 'lastMinute' | 'dark' | 'sealed';

export type ClockEvent = 'twoMinutes' | 'oneMinute' | 'darkness' | 'doorSealed' | 'entombed';

/** Seconds until darkness. Negative once night has fallen. */
export function timeLeft(t: number): number { return DAY_LENGTH - t; }

export function phaseAt(t: number): ClockPhase {
  const left = timeLeft(t);
  if (left <= -FINAL_WINDOW) return 'sealed';
  if (left <= 0) return 'dark';
  if (left <= ONE_MINUTE) return 'lastMinute';
  if (left <= TWO_MINUTES) return 'lastTwoMinutes';
  if (t < DAY_LENGTH * 0.08) return 'dawn';
  return 'day';
}

const EVENT_TIMES: [ClockEvent, number][] = [
  ['twoMinutes', DAY_LENGTH - TWO_MINUTES],
  ['oneMinute', DAY_LENGTH - ONE_MINUTE],
  ['darkness', DAY_LENGTH],
  ['doorSealed', DAY_LENGTH + FINAL_WINDOW],
  ['entombed', DAY_LENGTH + FINAL_WINDOW + ENTOMB_DELAY],
];

/** Threshold events crossed while time advanced from prevT (exclusive) to t (inclusive), in order. */
export function eventsBetween(prevT: number, t: number): ClockEvent[] {
  const out: ClockEvent[] = [];
  for (const [ev, at] of EVENT_TIMES) if (prevT < at && t >= at) out.push(ev);
  return out;
}

/**
 * Seconds between clock ticks. One per second for most of the day, speeding up through the last
 * two minutes to four per second. Zero means the ticking has stopped (night).
 */
export function tickInterval(left: number): number {
  if (left <= 0) return 0;
  if (left >= TWO_MINUTES) return 1;
  return lerp(0.25, 1, left / TWO_MINUTES);
}

/** Tick loudness 0..1: quiet all day, rising through the last two minutes. */
export function tickVolume(left: number): number {
  if (left <= 0) return 0;
  if (left >= TWO_MINUTES) return 0.3;
  return lerp(1, 0.3, left / TWO_MINUTES);
}

/** Height of the Great Door's opening and of someone walking or ducking through it, in metres. */
export const DOOR_HEIGHT = 5, STAND_CLEARANCE = 1.8, CROUCH_CLEARANCE = 1.15;

/**
 * 0 while the door is fully open, 1 when sealed. It starts slowly and finishes fast, so most of
 * the final window is usable: you can still walk under it with ten seconds left and slide under
 * it on your knees a few seconds after that.
 */
export function doorClosedFraction(t: number): number {
  return clamp01((t - DAY_LENGTH) / FINAL_WINDOW) ** 3;
}

/** Seconds after dark until a gap of the given height is gone. */
export function doorPassableFor(clearance: number): number {
  return FINAL_WINDOW * Math.cbrt(clamp01(1 - clearance / DOOR_HEIGHT));
}

/** Strength 0..1 of the screen-edge pulse and rumble in the last minute. */
export function dreadLevel(left: number): number {
  if (left > ONE_MINUTE) return 0;
  if (left <= 0) return 1;
  return lerp(1, 0.35, left / ONE_MINUTE);
}

/** Fraction of the day elapsed, 0 at dawn and 1 at sunset (clamped). */
export function dayFraction(t: number): number { return clamp01(t / DAY_LENGTH); }

/** Angle of the HUD sundial shadow in radians, sweeping a half circle from dawn (left) to dusk (right). */
export function sundialShadowAngle(t: number): number { return Math.PI * dayFraction(t); }

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
