/**
 * Sundial puzzle. The gnomon's shadow on a horizontal dial points away from the sun.
 * The dial ring has 12 notches (30° each); the puzzle is solved when the ring marker
 * is within TOLERANCE of the real shadow direction and the sun is high enough to cast one.
 */
export const NOTCHES = 12;
export const TOLERANCE_DEG = 18;
export const MIN_ELEVATION = 0.06; // sin(elevation)

/** Shadow azimuth in degrees [0,360) measured in the XZ plane from +x toward +z. */
export function shadowAngleDeg(sun: [number, number, number]): number {
  const a = Math.atan2(-sun[2], -sun[0]) * 180 / Math.PI;
  return (a + 360) % 360;
}

export function ringAngleDeg(notch: number): number {
  return (((notch % NOTCHES) + NOTCHES) % NOTCHES) * (360 / NOTCHES);
}

export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return d;
}

export function sundialSolved(notch: number, sun: [number, number, number], dialSunlit: boolean): boolean {
  if (!dialSunlit || sun[1] < MIN_ELEVATION) return false;
  return angleDiff(ringAngleDeg(notch), shadowAngleDeg(sun)) <= TOLERANCE_DEG;
}

/** The notch closest to the current shadow (used for hints/tests). */
export function bestNotch(sun: [number, number, number]): number {
  return Math.round(shadowAngleDeg(sun) / (360 / NOTCHES)) % NOTCHES;
}
