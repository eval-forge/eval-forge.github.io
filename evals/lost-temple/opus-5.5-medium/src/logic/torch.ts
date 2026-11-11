/** Torch fuel and light radius rules. Fuel is measured in seconds of burn. */
export interface TorchStats { capacity: number; burnRate: number; maxRadius: number; minRadius: number }

export function torchStats(level: number): TorchStats {
  const l = Math.max(0, Math.min(3, level));
  return {
    capacity: 200 + 40 * l,
    burnRate: 1 - 0.12 * l,
    maxRadius: 11 + 2 * l,
    minRadius: 2.2,
  };
}

export const FLASK_FUEL = 70;
/** Below this fraction of capacity the radius starts shrinking. */
export const SHRINK_START = 0.4;
export const RELIGHT_TIME = 1.8;
export const FALL_SPEED_EXTINGUISH = 11;

/** Light radius for a fuel amount. Full until SHRINK_START, then eases down to minRadius, 0 when empty. */
export function torchRadius(fuel: number, s: TorchStats): number {
  if (fuel <= 0) return 0;
  const f = Math.min(1, fuel / s.capacity);
  if (f >= SHRINK_START) return s.maxRadius;
  const u = f / SHRINK_START; // 0..1
  const eased = Math.sqrt(u);
  return s.minRadius + (s.maxRadius - s.minRadius) * eased;
}

export function burn(fuel: number, dt: number, s: TorchStats, lit: boolean): number {
  if (!lit) return fuel;
  return Math.max(0, fuel - dt * s.burnRate);
}

export interface ExtinguishContext {
  waterDepthAtTorch: number; // >0 means the torch is under water
  windGust: number; // 0..1 strength
  fallSpeed: number; // impact speed on landing this frame (m/s), 0 if none
  crouchingInWater: boolean;
}

export type ExtinguishCause = 'water' | 'wind' | 'fall' | null;

/** Deterministic extinguish rule. `roll` in [0,1) is used for the wind check. */
export function extinguishCheck(ctx: ExtinguishContext, roll: number): ExtinguishCause {
  if (ctx.waterDepthAtTorch > 0 || ctx.crouchingInWater) return 'water';
  if (ctx.fallSpeed >= FALL_SPEED_EXTINGUISH) return 'fall';
  if (ctx.windGust > 0.6 && roll < (ctx.windGust - 0.6) * 1.5) return 'wind';
  return null;
}

/** Flicker multiplier 0.85..1.1, smooth-ish from time. */
export function flicker(t: number, seed = 0): number {
  return 0.97 + 0.06 * Math.sin(t * 13.1 + seed) + 0.04 * Math.sin(t * 27.7 + seed * 2) + 0.03 * Math.sin(t * 5.3);
}
