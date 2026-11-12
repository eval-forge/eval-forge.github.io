/**
 * Sun position over the compressed day, the sundial puzzle geometry, and the colour keys
 * (sun light, sky, grading) that follow from it. Pure logic, unit tested.
 */
import { DAY_LENGTH, FINAL_MINUTE } from './countdown';

export type V3 = [number, number, number];

export const SUN_TILT = (25 * Math.PI) / 180; // arc leans toward +Z (south), noon elevation 65 deg
export const THETA_START = 0.05 * Math.PI;
/** Elapsed seconds at which the sun touches the western horizon: exactly 60 s before darkness. */
export const SUNSET_ELAPSED = DAY_LENGTH - FINAL_MINUTE;
export const THETA_PER_SEC = (Math.PI - THETA_START) / SUNSET_ELAPSED;
export const THETA_MAX = 1.3 * Math.PI;

export function sunTheta(elapsed: number): number {
  return Math.min(THETA_MAX, THETA_START + THETA_PER_SEC * Math.max(0, elapsed));
}

/** Unit vector pointing from the ground toward the sun. +X east, +Y up, +Z south. */
export function sunDirection(elapsed: number): V3 {
  const th = sunTheta(elapsed);
  return [Math.cos(th), Math.sin(th) * Math.cos(SUN_TILT), Math.sin(th) * Math.sin(SUN_TILT)];
}

/** Elevation above the horizon in radians (negative below). */
export function sunElevation(elapsed: number): number {
  const d = sunDirection(elapsed);
  return Math.asin(Math.max(-1, Math.min(1, d[1])));
}

/** Angle (atan2(z, x)) of the shadow cast by a vertical gnomon. Null when the sun is too low. */
export function gnomonShadowAngle(sunDir: V3, minElevation = (4 * Math.PI) / 180): number | null {
  const elev = Math.asin(Math.max(-1, Math.min(1, sunDir[1])));
  if (elev < minElevation) return null;
  return Math.atan2(-sunDir[2], -sunDir[0]);
}

/** Length of the gnomon shadow tip for a gnomon of height h. */
export function gnomonShadowLength(sunDir: V3, h: number): number {
  const elev = Math.asin(Math.max(-1, Math.min(1, sunDir[1])));
  if (elev <= 0.01) return Infinity;
  return h / Math.tan(elev);
}

export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export const SUNDIAL_STEPS = 12;
export const SUNDIAL_STEP = (Math.PI * 2) / SUNDIAL_STEPS;
export const SUNDIAL_TOLERANCE = (16 * Math.PI) / 180;
/** World angle of the Eye glyph when the ring is at step 0 (pointing south, +Z). */
export const SUNDIAL_EYE_BASE = Math.PI / 2;

export function sundialEyeAngle(ringStep: number): number {
  return SUNDIAL_EYE_BASE + ringStep * SUNDIAL_STEP;
}

/** True when the gnomon's real shadow falls on the Eye glyph. */
export function sundialAligned(ringStep: number, sunDir: V3): boolean {
  const shadow = gnomonShadowAngle(sunDir);
  if (shadow === null) return false;
  return Math.abs(angleDiff(sundialEyeAngle(ringStep), shadow)) <= SUNDIAL_TOLERANCE;
}

/** The ring step that would solve the dial right now (for tests and the debug overlay). */
export function sundialSolutionStep(sunDir: V3): number | null {
  const shadow = gnomonShadowAngle(sunDir);
  if (shadow === null) return null;
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < SUNDIAL_STEPS; k++) {
    const d = Math.abs(angleDiff(sundialEyeAngle(k), shadow));
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Colour keys

export type RGB = [number, number, number];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function lerp3(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

interface Key<T> {
  at: number;
  v: T;
}
function sampleKeys<T>(keys: Key<T>[], x: number, mix: (a: T, b: T, t: number) => T): T {
  if (x <= keys[0].at) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i].at) {
      const t = (x - keys[i - 1].at) / (keys[i].at - keys[i - 1].at);
      return mix(keys[i - 1].v, keys[i].v, t);
    }
  }
  return keys[keys.length - 1].v;
}

/** Colour of direct sunlight by elevation (radians). */
export function sunColor(elev: number): RGB {
  const deg = (elev * 180) / Math.PI;
  return sampleKeys<RGB>(
    [
      { at: -4, v: [1.0, 0.3, 0.12] },
      { at: 2, v: [1.0, 0.45, 0.22] },
      { at: 8, v: [1.0, 0.66, 0.42] },
      { at: 18, v: [1.0, 0.84, 0.66] },
      { at: 35, v: [1.0, 0.95, 0.88] },
      { at: 90, v: [1.0, 0.98, 0.94] },
    ],
    deg,
    lerp3,
  );
}

/** Direct sunlight intensity by elevation (three.js units). */
export function sunIntensity(elev: number): number {
  return 3.4 * smoothstep(-0.03, 0.22, Math.sin(elev));
}

export interface SkyKey {
  zenith: RGB;
  horizon: RGB;
  ground: RGB;
  hemiSky: RGB;
  hemiGround: RGB;
  hemiIntensity: number;
  fog: RGB;
}

export function skyAt(elev: number): SkyKey {
  const deg = (elev * 180) / Math.PI;
  const keys: Key<SkyKey>[] = [
    { at: -14, v: { zenith: [0.005, 0.008, 0.02], horizon: [0.02, 0.025, 0.05], ground: [0.01, 0.01, 0.015], hemiSky: [0.08, 0.1, 0.2], hemiGround: [0.02, 0.02, 0.03], hemiIntensity: 0.12, fog: [0.02, 0.025, 0.045] } },
    { at: -5, v: { zenith: [0.02, 0.03, 0.08], horizon: [0.25, 0.1, 0.08], ground: [0.03, 0.025, 0.03], hemiSky: [0.2, 0.18, 0.3], hemiGround: [0.06, 0.04, 0.04], hemiIntensity: 0.22, fog: [0.12, 0.07, 0.08] } },
    { at: 1, v: { zenith: [0.08, 0.12, 0.28], horizon: [0.95, 0.42, 0.2], ground: [0.12, 0.08, 0.06], hemiSky: [0.45, 0.38, 0.45], hemiGround: [0.15, 0.1, 0.07], hemiIntensity: 0.45, fog: [0.6, 0.38, 0.28] } },
    { at: 8, v: { zenith: [0.16, 0.3, 0.58], horizon: [0.95, 0.7, 0.5], ground: [0.2, 0.17, 0.12], hemiSky: [0.55, 0.62, 0.75], hemiGround: [0.22, 0.2, 0.13], hemiIntensity: 0.6, fog: [0.72, 0.66, 0.58] } },
    { at: 25, v: { zenith: [0.18, 0.4, 0.78], horizon: [0.66, 0.8, 0.92], ground: [0.25, 0.24, 0.18], hemiSky: [0.6, 0.72, 0.9], hemiGround: [0.26, 0.25, 0.16], hemiIntensity: 0.7, fog: [0.66, 0.76, 0.84] } },
    { at: 65, v: { zenith: [0.12, 0.34, 0.78], horizon: [0.62, 0.78, 0.94], ground: [0.26, 0.25, 0.19], hemiSky: [0.62, 0.74, 0.92], hemiGround: [0.27, 0.26, 0.17], hemiIntensity: 0.75, fog: [0.64, 0.76, 0.86] } },
  ];
  const mix = (a: SkyKey, b: SkyKey, t: number): SkyKey => ({
    zenith: lerp3(a.zenith, b.zenith, t),
    horizon: lerp3(a.horizon, b.horizon, t),
    ground: lerp3(a.ground, b.ground, t),
    hemiSky: lerp3(a.hemiSky, b.hemiSky, t),
    hemiGround: lerp3(a.hemiGround, b.hemiGround, t),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, t),
    fog: lerp3(a.fog, b.fog, t),
  });
  return sampleKeys(keys, deg, mix);
}

export interface GradeParams {
  exposure: number;
  contrast: number;
  saturation: number;
  shadowTint: RGB;
  highlightTint: RGB;
  vignette: number;
}

const GRADE_KEYS: Key<GradeParams>[] = [
  { at: 0.0, v: { exposure: 0.85, contrast: 1.04, saturation: 0.86, shadowTint: [0.86, 0.9, 1.12], highlightTint: [1.14, 0.96, 0.92], vignette: 0.32 } },
  { at: 0.1, v: { exposure: 1.0, contrast: 1.05, saturation: 1.0, shadowTint: [0.95, 0.98, 1.05], highlightTint: [1.05, 1.0, 0.95], vignette: 0.28 } },
  { at: 0.5, v: { exposure: 1.02, contrast: 1.08, saturation: 1.1, shadowTint: [1.0, 1.0, 1.0], highlightTint: [1.02, 1.01, 0.97], vignette: 0.25 } },
  { at: 0.75, v: { exposure: 1.0, contrast: 1.1, saturation: 1.12, shadowTint: [0.95, 0.95, 1.05], highlightTint: [1.1, 1.0, 0.86], vignette: 0.28 } },
  { at: 0.9, v: { exposure: 0.98, contrast: 1.18, saturation: 1.22, shadowTint: [0.9, 0.84, 1.08], highlightTint: [1.32, 0.84, 0.58], vignette: 0.34 } },
  { at: 0.97, v: { exposure: 0.85, contrast: 1.16, saturation: 0.95, shadowTint: [0.8, 0.8, 1.15], highlightTint: [1.18, 0.78, 0.72], vignette: 0.4 } },
  { at: 1.05, v: { exposure: 0.8, contrast: 1.1, saturation: 0.62, shadowTint: [0.75, 0.85, 1.2], highlightTint: [0.86, 0.95, 1.2], vignette: 0.45 } },
];

export function gradeAt(dayFrac: number): GradeParams {
  return sampleKeys(GRADE_KEYS, dayFrac, (a, b, t) => ({
    exposure: lerp(a.exposure, b.exposure, t),
    contrast: lerp(a.contrast, b.contrast, t),
    saturation: lerp(a.saturation, b.saturation, t),
    shadowTint: lerp3(a.shadowTint, b.shadowTint, t),
    highlightTint: lerp3(a.highlightTint, b.highlightTint, t),
    vignette: lerp(a.vignette, b.vignette, t),
  }));
}

/** Direction of moonlight once the sun is down (high in the south-west). */
export const MOON_DIR: V3 = (() => {
  const v: V3 = [-0.35, 0.82, 0.45];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
