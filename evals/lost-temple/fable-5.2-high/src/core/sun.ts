import { DAY_LENGTH } from './clock';
import { clamp01, lerp, type V3, type Zone } from './types';

/** The sun's arc is tilted this far toward the south (+Z). */
export const SUN_TILT = (25 * Math.PI) / 180;

/** The run starts just after sunrise: the sun is already this fraction of its arc above the horizon. */
export const DAWN_OFFSET = 0.045;

/**
 * Unit vector pointing from the world toward the sun. Rises in the east (+X), peaks toward the
 * south (+Z) at noon, sets in the west (-X). After sunset it keeps going below the horizon.
 */
export function sunDirection(t: number): V3 {
  const theta = Math.PI * (DAWN_OFFSET + (1 - DAWN_OFFSET) * (t / DAY_LENGTH));
  const s = Math.sin(theta);
  return { x: Math.cos(theta), y: s * Math.cos(SUN_TILT), z: s * Math.sin(SUN_TILT) };
}

/** Elevation above the horizon in radians (negative at night). */
export function sunElevation(t: number): number { return Math.asin(sunDirection(t).y); }

/** Compass-style azimuth of the sun in the XZ plane, radians, measured from +X toward +Z. */
export function sunAzimuth(t: number): number {
  const d = sunDirection(t);
  return Math.atan2(d.z, d.x);
}

/**
 * Direction a vertical gnomon's shadow falls on the ground (unit XZ vector), or null when the sun
 * is down. Used by the courtyard sundial puzzle so the answer tracks the real sun.
 */
export function gnomonShadowDir(t: number): { x: number; z: number } | null {
  const d = sunDirection(t);
  if (d.y <= 0.02) return null;
  const len = Math.hypot(d.x, d.z);
  if (len < 1e-6) return null;
  return { x: -d.x / len, z: -d.z / len };
}

export type RGB = [number, number, number];

export interface Grade {
  sunColor: RGB; sunIntensity: number;
  skyTop: RGB; skyHorizon: RGB; fog: RGB; fogDensity: number;
  ambSky: RGB; ambGround: RGB; ambIntensity: number;
  exposure: number;
  /** Screen tint (multiplied over the frame) and its strength. */
  tint: RGB; tintStrength: number;
}

interface Key { at: number; g: Grade; }

// Keyframes over day fraction (t / DAY_LENGTH). Past 1.0 is night.
const KEYS: Key[] = [
  { at: 0.0, g: { sunColor: [1.0, 0.62, 0.42], sunIntensity: 1.1, skyTop: [0.30, 0.38, 0.62], skyHorizon: [0.98, 0.66, 0.52], fog: [0.80, 0.62, 0.56], fogDensity: 0.016, ambSky: [0.72, 0.62, 0.70], ambGround: [0.30, 0.24, 0.20], ambIntensity: 0.55, exposure: 0.85, tint: [1.0, 0.82, 0.78], tintStrength: 0.35 } },
  { at: 0.12, g: { sunColor: [1.0, 0.86, 0.66], sunIntensity: 2.2, skyTop: [0.24, 0.46, 0.80], skyHorizon: [0.80, 0.84, 0.86], fog: [0.70, 0.80, 0.82], fogDensity: 0.010, ambSky: [0.66, 0.78, 0.92], ambGround: [0.32, 0.30, 0.22], ambIntensity: 0.75, exposure: 1.0, tint: [1.0, 0.95, 0.86], tintStrength: 0.18 } },
  { at: 0.5, g: { sunColor: [1.0, 0.97, 0.90], sunIntensity: 3.0, skyTop: [0.16, 0.42, 0.86], skyHorizon: [0.70, 0.84, 0.94], fog: [0.72, 0.84, 0.90], fogDensity: 0.008, ambSky: [0.70, 0.82, 1.0], ambGround: [0.36, 0.34, 0.26], ambIntensity: 0.9, exposure: 1.05, tint: [1.0, 1.0, 1.0], tintStrength: 0.0 } },
  { at: 0.8, g: { sunColor: [1.0, 0.84, 0.60], sunIntensity: 2.5, skyTop: [0.20, 0.38, 0.74], skyHorizon: [0.92, 0.78, 0.60], fog: [0.84, 0.76, 0.64], fogDensity: 0.010, ambSky: [0.80, 0.76, 0.80], ambGround: [0.36, 0.30, 0.22], ambIntensity: 0.75, exposure: 1.0, tint: [1.0, 0.90, 0.74], tintStrength: 0.25 } },
  { at: 0.95, g: { sunColor: [1.0, 0.42, 0.14], sunIntensity: 1.9, skyTop: [0.26, 0.20, 0.44], skyHorizon: [1.0, 0.40, 0.14], fog: [0.86, 0.38, 0.20], fogDensity: 0.014, ambSky: [0.80, 0.42, 0.34], ambGround: [0.30, 0.14, 0.10], ambIntensity: 0.55, exposure: 0.9, tint: [1.0, 0.52, 0.30], tintStrength: 0.5 } },
  { at: 1.0, g: { sunColor: [0.9, 0.22, 0.08], sunIntensity: 0.6, skyTop: [0.10, 0.07, 0.22], skyHorizon: [0.70, 0.16, 0.08], fog: [0.36, 0.12, 0.10], fogDensity: 0.018, ambSky: [0.42, 0.20, 0.26], ambGround: [0.12, 0.06, 0.06], ambIntensity: 0.3, exposure: 0.75, tint: [0.9, 0.36, 0.26], tintStrength: 0.55 } },
  { at: 1.05, g: { sunColor: [0.36, 0.46, 0.80], sunIntensity: 0.22, skyTop: [0.010, 0.014, 0.040], skyHorizon: [0.04, 0.05, 0.11], fog: [0.02, 0.03, 0.06], fogDensity: 0.022, ambSky: [0.16, 0.22, 0.42], ambGround: [0.03, 0.03, 0.05], ambIntensity: 0.16, exposure: 0.7, tint: [0.52, 0.62, 1.0], tintStrength: 0.4 } },
];

const mix3 = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Colour grading for a moment of the day: dawn, noon, red-orange sunset, night. */
export function gradeAt(t: number): Grade {
  const f = Math.max(0, t / DAY_LENGTH);
  if (f >= KEYS[KEYS.length - 1].at) return KEYS[KEYS.length - 1].g;
  let i = 0;
  while (i < KEYS.length - 2 && f > KEYS[i + 1].at) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const k = clamp01((f - a.at) / (b.at - a.at));
  const A = a.g, B = b.g;
  return {
    sunColor: mix3(A.sunColor, B.sunColor, k), sunIntensity: lerp(A.sunIntensity, B.sunIntensity, k),
    skyTop: mix3(A.skyTop, B.skyTop, k), skyHorizon: mix3(A.skyHorizon, B.skyHorizon, k),
    fog: mix3(A.fog, B.fog, k), fogDensity: lerp(A.fogDensity, B.fogDensity, k),
    ambSky: mix3(A.ambSky, B.ambSky, k), ambGround: mix3(A.ambGround, B.ambGround, k),
    ambIntensity: lerp(A.ambIntensity, B.ambIntensity, k),
    exposure: lerp(A.exposure, B.exposure, k),
    tint: mix3(A.tint, B.tint, k), tintStrength: lerp(A.tintStrength, B.tintStrength, k),
  };
}

/** Is it night (sun below the horizon)? */
export function isNight(t: number): boolean { return t >= DAY_LENGTH; }

/** Depth at which the stair down from the sanctum has lost all daylight. Zone C floors sit below this. */
export const DARK_DEPTH = -9;

/**
 * How much sky light (ambient and sun) reaches a spot, 0..1.
 * Zone A is open sky. Zone B is partly roofed. Zone C gets exactly nothing: no ambient, no sun,
 * no skybox. In Zone B the light fades with depth on the stair down so the handover is seamless.
 */
export function skyExposure(zone: Zone, y: number): { ambient: number; sun: number } {
  if (zone === 'C') return { ambient: 0, sun: 0 };
  const depthFade = clamp01((y - DARK_DEPTH) / 7);
  if (zone === 'B') return { ambient: 0.6 * depthFade, sun: depthFade };
  return { ambient: 1, sun: 1 };
}
