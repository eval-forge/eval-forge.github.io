import { clamp, lerp, smoothstep } from './vec';

export const DAY_LENGTH = 780; // seconds of daylight: 13:00
export const DOOR_CLOSE_TIME = 75; // seconds after sunset until the great door is shut
export const URGENT_AT = 120;
export const CRITICAL_AT = 60;

export type ClockPhase = 'day' | 'urgent' | 'critical' | 'night' | 'sealed';

/** remaining = seconds until sunset (negative after sunset). */
export function clockPhase(remaining: number): ClockPhase {
  if (remaining <= -DOOR_CLOSE_TIME) return 'sealed';
  if (remaining <= 0) return 'night';
  if (remaining <= CRITICAL_AT) return 'critical';
  if (remaining <= URGENT_AT) return 'urgent';
  return 'day';
}

/** Seconds between clock ticks. Calm 1 s; speeds up to 0.35 s over the last 2 minutes; 0.25 s at night. */
export function tickInterval(remaining: number): number {
  if (remaining <= 0) return 0.25;
  if (remaining > URGENT_AT) return 1;
  return lerp(0.35, 1, clamp(remaining / URGENT_AT, 0, 1));
}

/** Tick volume 0..1. Gets louder in the last 2 minutes. */
export function tickVolume(remaining: number): number {
  if (remaining <= 0) return 0.9;
  if (remaining > URGENT_AT) return 0.18;
  return lerp(0.9, 0.3, clamp(remaining / URGENT_AT, 0, 1));
}

/** 0..1: how far the great door has closed. */
export function doorClosedFraction(remaining: number): number {
  if (remaining > 0) return 0;
  return clamp(-remaining / DOOR_CLOSE_TIME, 0, 1);
}

/** Fraction of the day elapsed 0..1 (clamped). */
export function dayFraction(remaining: number): number {
  return clamp(1 - remaining / DAY_LENGTH, 0, 1);
}

const DEG = Math.PI / 180;

/** Sun elevation (radians). Low at dawn, ~70° at noon, at the horizon at sunset, below it at night. */
export function sunElevation(remaining: number): number {
  if (remaining <= 0) return -2 * DEG - clamp(-remaining / 30, 0, 1) * 16 * DEG;
  const f = dayFraction(remaining);
  return -2 * DEG + 72 * DEG * Math.sin(Math.PI * (0.04 + 0.92 * f));
}

/** Sun azimuth (radians): 0 = east (+x), PI/2 = south (+z), PI = west (-x). */
export function sunAzimuth(remaining: number): number {
  const f = remaining <= 0 ? 1 + clamp(-remaining / 300, 0, 0.2) : dayFraction(remaining);
  return Math.PI * (0.04 + 0.92 * f);
}

/** Unit vector pointing from the ground toward the sun. */
export function sunDirection(remaining: number): { x: number; y: number; z: number } {
  const el = sunElevation(remaining);
  const az = sunAzimuth(remaining);
  return { x: Math.cos(az) * Math.cos(el), y: Math.sin(el), z: Math.sin(az) * Math.cos(el) };
}

/**
 * Colour grading key 0..3 (dawn 0 → noon 1 → sunset 2 → night 3) used to blend palettes.
 */
export function gradeKey(remaining: number): number {
  if (remaining <= 0) return 2 + smoothstep(0, 25, -remaining);
  const f = dayFraction(remaining);
  if (f < 0.3) return smoothstep(0, 0.3, f); // dawn → noon
  if (f < 0.75) return 1;
  return 1 + smoothstep(0.75, 1, f); // noon → sunset
}

/** Format seconds as m:ss (clamped at 0). */
export function formatClock(remaining: number): string {
  const s = Math.max(0, Math.ceil(remaining));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Events fired when crossing thresholds between two clock readings. */
export function crossedThresholds(prev: number, next: number): ClockPhase[] {
  const out: ClockPhase[] = [];
  if (prev > URGENT_AT && next <= URGENT_AT) out.push('urgent');
  if (prev > CRITICAL_AT && next <= CRITICAL_AT) out.push('critical');
  if (prev > 0 && next <= 0) out.push('night');
  if (prev > -DOOR_CLOSE_TIME && next <= -DOOR_CLOSE_TIME) out.push('sealed');
  return out;
}
