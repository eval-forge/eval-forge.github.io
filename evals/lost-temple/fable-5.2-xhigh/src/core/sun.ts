/**
 * The sun: where it is for a given day fraction, what colour the world is
 * graded, and the sundial maths. Pure. Unit-tested in tests/sun.test.ts.
 *
 * World axes: +X east, +Y up, +Z south. The temple lies north (-Z) of the start.
 */
import { angleDiff, clamp01, lerp } from './rng';
import type { Vec3Like } from './scenes';

/** The sun's path leans this far south of straight overhead. */
export const SUN_TILT = (28 * Math.PI) / 180;
/** The sundial cannot be read with the sun lower than this (shadow too long / gnomon shaded). */
export const SUNDIAL_MIN_ELEVATION = (9 * Math.PI) / 180;
/** How close (radians) the ring glyph must be to the shadow. */
export const SUNDIAL_TOLERANCE = (9 * Math.PI) / 180;
/** The sundial ring turns in steps of this many radians. */
export const SUNDIAL_STEP = (7.5 * Math.PI) / 180;

/** Unit vector pointing from the ground toward the sun. Valid for f in [0, 1]. */
export function sunDirection(f: number): Vec3Like {
  const a = Math.PI * clamp01(f);
  return {
    x: Math.cos(a),
    y: Math.sin(a) * Math.cos(SUN_TILT),
    z: Math.sin(a) * Math.sin(SUN_TILT),
  };
}

export function sunElevation(f: number): number {
  if (f <= 0 || f >= 1) return 0;
  return Math.asin(sunDirection(f).y);
}

const MOON_DIR: Vec3Like = (() => {
  const v = { x: 0.42, y: 0.78, z: -0.46 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

export interface Celestial {
  /** Unit vector toward the active light source (sun by day, moon by night). */
  dir: Vec3Like;
  isMoon: boolean;
  /** Elevation of the active body, radians. */
  elevation: number;
  /** True while real sunlight reaches the ground (drives sun-safe paths and the sundial). */
  sunUp: boolean;
}

export function celestial(f: number): Celestial {
  if (f < 1) {
    const dir = sunDirection(f);
    // Keep the light a hair above the horizon so shadow maths stays finite.
    const y = Math.max(dir.y, 0.03);
    const l = Math.hypot(dir.x, y, dir.z);
    return {
      dir: { x: dir.x / l, y: y / l, z: dir.z / l },
      isMoon: false,
      elevation: Math.asin(clamp01(dir.y)),
      sunUp: f > 0.004 && f < 0.996,
    };
  }
  return { dir: MOON_DIR, isMoon: true, elevation: Math.asin(MOON_DIR.y), sunUp: false };
}

/**
 * Compass angle of the shadow a vertical gnomon casts, measured in the XZ
 * plane as atan2(x, z): 0 = pointing south (+Z), +PI/2 = pointing east (+X).
 */
export function shadowAzimuth(f: number): number {
  const d = sunDirection(f);
  return Math.atan2(-d.x, -d.z);
}

/** Length of the shadow of a vertical gnomon of height h. Infinity at the horizon. */
export function shadowLength(f: number, h: number): number {
  const el = sunElevation(f);
  if (el <= 1e-4) return Infinity;
  return h / Math.tan(el);
}

/** Can the sundial be read right now (sun up and high enough)? */
export function sundialReadable(f: number): boolean {
  return f > 0 && f < 1 && sunElevation(f) >= SUNDIAL_MIN_ELEVATION;
}

/**
 * The courtyard puzzle: the ring's serpent glyph must sit under the gnomon's
 * real shadow. `ringAngle` uses the same convention as shadowAzimuth.
 */
export function sundialAligned(ringAngle: number, f: number, tolerance = SUNDIAL_TOLERANCE): boolean {
  if (!sundialReadable(f)) return false;
  return Math.abs(angleDiff(ringAngle, shadowAzimuth(f))) <= tolerance;
}

// ---------------------------------------------------------------------------
// Colour script
// ---------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface SkyLook {
  /** Colour and strength of the directional light. */
  sunColor: Rgb;
  sunIntensity: number;
  skyTop: Rgb;
  skyHorizon: Rgb;
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiIntensity: number;
  fog: Rgb;
  fogDensity: number;
  /** Grade pass parameters. */
  tint: Rgb;
  saturation: number;
  contrast: number;
  exposure: number;
  lift: number;
  /** 0..1 how visible the stars are. */
  stars: number;
}

const hex = (h: number): Rgb => ({
  r: ((h >> 16) & 255) / 255,
  g: ((h >> 8) & 255) / 255,
  b: (h & 255) / 255,
});

interface Key extends SkyLook {
  f: number;
}

const KEYS: Key[] = [
  {
    f: 0.0, // first light
    sunColor: hex(0xff8f55), sunIntensity: 0.55,
    skyTop: hex(0x34467e), skyHorizon: hex(0xffa77c),
    hemiSky: hex(0x8a98d0), hemiGround: hex(0x5a4838), hemiIntensity: 0.8,
    fog: hex(0xd6a48c), fogDensity: 0.013,
    tint: { r: 1.1, g: 0.95, b: 0.9 }, saturation: 1.05, contrast: 0.96, exposure: 0.95, lift: 0.02,
    stars: 0.15,
  },
  {
    f: 0.1, // morning
    sunColor: hex(0xffd49a), sunIntensity: 2.8,
    skyTop: hex(0x4675c6), skyHorizon: hex(0xd3e2ee),
    hemiSky: hex(0xa6c2ee), hemiGround: hex(0x6a6046), hemiIntensity: 1.3,
    fog: hex(0xc6d6dc), fogDensity: 0.007,
    tint: { r: 1.04, g: 1.0, b: 0.96 }, saturation: 1.08, contrast: 1.0, exposure: 1.0, lift: 0.01,
    stars: 0,
  },
  {
    f: 0.5, // solar noon
    sunColor: hex(0xfff3de), sunIntensity: 3.2,
    skyTop: hex(0x2c6bcc), skyHorizon: hex(0xb8d6f0),
    hemiSky: hex(0xb6cef6), hemiGround: hex(0x746a50), hemiIntensity: 1.9,
    fog: hex(0xbdd2e2), fogDensity: 0.006,
    tint: { r: 1, g: 1, b: 1 }, saturation: 1.1, contrast: 1.05, exposure: 1.0, lift: 0,
    stars: 0,
  },
  {
    f: 0.78, // late afternoon
    sunColor: hex(0xffcb84), sunIntensity: 2.6,
    skyTop: hex(0x3865b4), skyHorizon: hex(0xf0cc9c),
    hemiSky: hex(0xaeb6d6), hemiGround: hex(0x70583c), hemiIntensity: 1.52,
    fog: hex(0xdec49c), fogDensity: 0.007,
    tint: { r: 1.07, g: 0.98, b: 0.89 }, saturation: 1.1, contrast: 1.05, exposure: 1.0, lift: 0,
    stars: 0,
  },
  {
    f: 0.93, // sunset
    sunColor: hex(0xff6526), sunIntensity: 1.7,
    skyTop: hex(0x383874), skyHorizon: hex(0xff7636),
    hemiSky: hex(0x9e6e86), hemiGround: hex(0x5a3020), hemiIntensity: 0.95,
    fog: hex(0xde7444), fogDensity: 0.01,
    tint: { r: 1.24, g: 0.85, b: 0.68 }, saturation: 1.2, contrast: 1.1, exposure: 0.96, lift: 0,
    stars: 0.1,
  },
  {
    f: 1.0, // last light
    sunColor: hex(0xc02c18), sunIntensity: 0.12,
    skyTop: hex(0x181636), skyHorizon: hex(0x882828),
    hemiSky: hex(0x3e2e4e), hemiGround: hex(0x201418), hemiIntensity: 0.42,
    fog: hex(0x4e2228), fogDensity: 0.014,
    tint: { r: 1.1, g: 0.85, b: 0.9 }, saturation: 0.9, contrast: 1.1, exposure: 0.9, lift: 0,
    stars: 0.6,
  },
  {
    f: 1.04, // night (moon)
    sunColor: hex(0x8ea6ff), sunIntensity: 0.55,
    skyTop: hex(0x04050d), skyHorizon: hex(0x0b1124),
    hemiSky: hex(0x242e4c), hemiGround: hex(0x090b12), hemiIntensity: 0.3,
    fog: hex(0x06090f), fogDensity: 0.02,
    // Contrast stays at 1 here: the grade pivots on mid grey, so anything above 1 crushes
    // moonlit ground to pure black.
    tint: { r: 0.82, g: 0.92, b: 1.15 }, saturation: 0.6, contrast: 1.0, exposure: 0.9, lift: 0,
    stars: 1,
  },
];

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => ({
  r: lerp(a.r, b.r, t),
  g: lerp(a.g, b.g, t),
  b: lerp(a.b, b.b, t),
});

/** The colour script for a day fraction (clamps before dawn / deep night). */
export function skyLook(f: number): SkyLook {
  if (f <= KEYS[0].f) return KEYS[0];
  const last = KEYS[KEYS.length - 1];
  if (f >= last.f) return last;
  let i = 0;
  while (i < KEYS.length - 2 && f > KEYS[i + 1].f) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = clamp01((f - a.f) / (b.f - a.f));
  return {
    sunColor: mixRgb(a.sunColor, b.sunColor, t),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    skyTop: mixRgb(a.skyTop, b.skyTop, t),
    skyHorizon: mixRgb(a.skyHorizon, b.skyHorizon, t),
    hemiSky: mixRgb(a.hemiSky, b.hemiSky, t),
    hemiGround: mixRgb(a.hemiGround, b.hemiGround, t),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, t),
    fog: mixRgb(a.fog, b.fog, t),
    fogDensity: lerp(a.fogDensity, b.fogDensity, t),
    tint: mixRgb(a.tint, b.tint, t),
    saturation: lerp(a.saturation, b.saturation, t),
    contrast: lerp(a.contrast, b.contrast, t),
    exposure: lerp(a.exposure, b.exposure, t),
    lift: lerp(a.lift, b.lift, t),
    stars: lerp(a.stars, b.stars, t),
  };
}

/** Short label for the HUD / debug overlay. */
export function gradeName(f: number): string {
  if (f < 0.1) return 'dawn';
  if (f < 0.7) return 'noon';
  if (f < 1.0) return 'sunset';
  return 'night';
}
