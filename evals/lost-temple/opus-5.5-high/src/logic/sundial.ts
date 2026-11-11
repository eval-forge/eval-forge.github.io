import { angleDiff } from './vec';

export const SUNDIAL_STEPS = 12;
export const SUNDIAL_TOLERANCE = (15 * Math.PI) / 180;
const STEP = (Math.PI * 2) / SUNDIAL_STEPS;

/**
 * Azimuth (radians, atan2(z, x) on the ground plane) that a vertical gnomon's
 * shadow points toward, given the direction toward the sun. Null when the sun
 * is below the horizon (no shadow).
 */
export function shadowAzimuth(sun: { x: number; y: number; z: number }): number | null {
  if (sun.y <= 0.01) return null;
  return Math.atan2(-sun.z, -sun.x);
}

/** World azimuth of the eye glyph given the ring step (eye starts pointing north, -z). */
export function eyeAzimuth(step: number): number {
  const base = Math.atan2(-1, 0); // north
  return base + ((step % SUNDIAL_STEPS) + SUNDIAL_STEPS) % SUNDIAL_STEPS * STEP;
}

export function sundialAligned(sun: { x: number; y: number; z: number }, step: number): boolean {
  const s = shadowAzimuth(sun);
  if (s === null) return false;
  return Math.abs(angleDiff(s, eyeAzimuth(step))) <= SUNDIAL_TOLERANCE;
}

/** The step that best aligns with the shadow (used for hints and tests). */
export function bestStep(sun: { x: number; y: number; z: number }): number | null {
  const s = shadowAzimuth(sun);
  if (s === null) return null;
  let best = 0, bd = Infinity;
  for (let i = 0; i < SUNDIAL_STEPS; i++) {
    const d = Math.abs(angleDiff(s, eyeAzimuth(i)));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
