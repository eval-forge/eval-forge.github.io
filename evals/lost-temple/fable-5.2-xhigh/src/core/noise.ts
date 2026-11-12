/**
 * How loud things are. A noise is a point with a radius; a listener inside
 * the radius hears it with loudness 1 at the source falling to 0 at the edge.
 * Pure. Used by the crawler, the sentinel and the sanctum ceiling.
 */
import { clamp01 } from './rng';
import type { Vec3Like } from './scenes';

export type NoiseKind =
  | 'stepCrouch'
  | 'stepWalk'
  | 'stepSprint'
  | 'jump'
  | 'land'
  | 'impact'
  | 'relic'
  | 'flint'
  | 'splash'
  | 'plank'
  | 'trap'
  | 'debris'
  | 'door'
  | 'block';

/** Base audible radius in metres. */
export const NOISE_RADIUS: Record<NoiseKind, number> = {
  stepCrouch: 2.2,
  stepWalk: 8,
  stepSprint: 17,
  jump: 6,
  land: 13,
  impact: 18,
  relic: 5,
  flint: 7,
  splash: 12,
  plank: 24,
  trap: 26,
  debris: 30,
  door: 30,
  block: 14,
};

/** How much each noise shakes the sanctum ceiling (0 = not at all). */
export const NOISE_SHAKE: Record<NoiseKind, number> = {
  stepCrouch: 0,
  stepWalk: 0.012,
  stepSprint: 0.11,
  jump: 0.08,
  land: 0.3,
  impact: 0.4,
  relic: 0.03,
  flint: 0.02,
  splash: 0.1,
  plank: 0.3,
  trap: 0.5,
  debris: 0,
  door: 0.2,
  block: 0.09,
};

export interface Noise {
  pos: Vec3Like;
  radius: number;
  kind: NoiseKind;
  /** Game time it happened. */
  t: number;
}

export const FOOTSTEP_KINDS: ReadonlySet<NoiseKind> = new Set(['stepCrouch', 'stepWalk', 'stepSprint', 'jump', 'land']);

/** Radius of a noise, scaled by intensity (e.g. impact speed) and footwear. */
export function noiseRadius(kind: NoiseKind, scale = 1, footstepMult = 1): number {
  const base = NOISE_RADIUS[kind] * scale;
  return FOOTSTEP_KINDS.has(kind) ? base * footstepMult : base;
}

/** Loudness 0..1 at a listener. `hearing` scales the listener's ears (crawler > sentinel). */
export function loudnessAt(noise: Noise, listener: Vec3Like, hearing = 1): number {
  const d = Math.hypot(noise.pos.x - listener.x, noise.pos.y - listener.y, noise.pos.z - listener.z);
  const r = noise.radius * hearing;
  if (r <= 0 || d >= r) return 0;
  return clamp01(1 - d / r);
}

/** Pick the loudest noise a listener can hear, or null. */
export function loudestHeard(
  noises: readonly Noise[],
  listener: Vec3Like,
  hearing = 1,
): { noise: Noise; loudness: number } | null {
  let best: { noise: Noise; loudness: number } | null = null;
  for (const n of noises) {
    const l = loudnessAt(n, listener, hearing);
    if (l > 0 && (!best || l > best.loudness)) best = { noise: n, loudness: l };
  }
  return best;
}
