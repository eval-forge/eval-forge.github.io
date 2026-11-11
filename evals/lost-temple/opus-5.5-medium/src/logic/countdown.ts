/** Compressed day: 13 minutes from dawn to darkness. */
export const DAY_LENGTH = 780;
/** After darkness falls the great door takes this long to close. */
export const DOOR_CLOSE_TIME = 75;
export const URGENT_AT = 120;
export const CRITICAL_AT = 60;
export const MAX_ELEVATION_DEG = 68;
export const DAWN_ELEVATION_DEG = 4;

export type Phase = 'normal' | 'urgent' | 'critical' | 'dark' | 'sealed';

export function timeLeft(elapsed: number): number {
  return Math.max(0, DAY_LENGTH - elapsed);
}

export function phaseAt(elapsed: number): Phase {
  const left = DAY_LENGTH - elapsed;
  if (left > URGENT_AT) return 'normal';
  if (left > CRITICAL_AT) return 'urgent';
  if (left > 0) return 'critical';
  if (elapsed - DAY_LENGTH < DOOR_CLOSE_TIME) return 'dark';
  return 'sealed';
}

/** Door openness 1..0 during the final window. */
export function doorOpenFraction(elapsed: number): number {
  if (elapsed <= DAY_LENGTH) return 1;
  return Math.max(0, 1 - (elapsed - DAY_LENGTH) / DOOR_CLOSE_TIME);
}

/** Seconds between clock ticks. 1 s normally, speeding up to 0.25 s over the last 2 minutes. */
export function tickInterval(elapsed: number): number {
  const left = DAY_LENGTH - elapsed;
  if (left > URGENT_AT) return 1.0;
  if (left <= 0) return 0.25;
  const u = 1 - left / URGENT_AT; // 0 → 1
  return 1.0 - 0.75 * u;
}

/** Tick loudness 0..1. Quiet normally, rising over the last 2 minutes. */
export function tickVolume(elapsed: number): number {
  const left = DAY_LENGTH - elapsed;
  if (left > URGENT_AT) return 0.22;
  if (left <= 0) return 1;
  const u = 1 - left / URGENT_AT;
  return 0.35 + 0.65 * u;
}

const D2R = Math.PI / 180;

/** Day progress 0..1 (clamped; >1 = night). */
export function dayProgress(elapsed: number): number {
  return elapsed / DAY_LENGTH;
}

/**
 * Sun direction (unit vector pointing toward the sun). +x east, +y up, +z south.
 * Rises in the east, arcs through the south, sets in the west exactly at DAY_LENGTH.
 */
export function sunDirection(elapsed: number): [number, number, number] {
  const p = Math.max(0, elapsed / DAY_LENGTH);
  const theta0 = Math.asin(DAWN_ELEVATION_DEG / MAX_ELEVATION_DEG);
  const theta = theta0 + (Math.PI - theta0) * p;
  let el = MAX_ELEVATION_DEG * Math.sin(theta) * D2R;
  if (p > 1) el = -Math.min(25, (p - 1) * 200) * D2R;
  const az = Math.min(theta, Math.PI + 0.3);
  const c = Math.cos(el);
  return [Math.cos(az) * c, Math.sin(el), Math.sin(az) * c];
}

export function sunElevationDeg(elapsed: number): number {
  return Math.asin(sunDirection(elapsed)[1]) / D2R;
}

/** Format seconds as m:ss. */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
