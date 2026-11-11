import { clamp } from './vec';

export const TORCH_HEIGHT_STANDING = 1.3;
export const TORCH_HEIGHT_CROUCHED = 0.8;
export const RELIGHT_TIME = 2.5;
export const BURN_RATE = 1; // fuel seconds per second
export const OIL_FLASK_FUEL = 60;
export const SPARE_TORCH_FUEL = 120;
export const SCONCE_BURN = 300;
export const SCONCE_RADIUS = 7;
export const WIND_BLOWOUT_CHANCE = 0.6;
export const FALL_BLOWOUT_HEIGHT = 4;

export interface TorchState {
  fuel: number;
  capacity: number;
  lit: boolean;
  /** seconds remaining in relight animation, 0 when not relighting */
  relighting: number;
}

export function newTorch(capacity: number): TorchState {
  return { fuel: capacity, capacity, lit: true, relighting: 0 };
}

/** Radius curve: full radius while fuel ≥ 50%, then shrinks to 30% of full as fuel approaches 0. */
export function torchRadius(maxRadius: number, fuel: number, capacity: number): number {
  if (fuel <= 0) return 0;
  const f = clamp(fuel / capacity, 0, 1);
  if (f >= 0.5) return maxRadius;
  return maxRadius * (0.3 + 0.7 * Math.pow(f / 0.5, 0.7));
}

/** Burn fuel for dt seconds. Returns new state (goes out at 0). */
export function burn(t: TorchState, dt: number): TorchState {
  if (!t.lit) return t;
  const fuel = Math.max(0, t.fuel - BURN_RATE * dt);
  return { ...t, fuel, lit: fuel > 0 };
}

export type ExtinguishCause = 'water' | 'wind' | 'fall' | 'empty' | 'manual';

/** Water reaches the flame when the surface is above the torch's height. */
export function submerged(waterSurfaceY: number | null, feetY: number, crouched: boolean): boolean {
  if (waterSurfaceY === null) return false;
  const h = crouched ? TORCH_HEIGHT_CROUCHED : TORCH_HEIGHT_STANDING;
  return waterSurfaceY > feetY + h;
}

/** Wind gust blows the torch out (roll < chance) unless the player is crouched/sheltered. */
export function windBlowsOut(roll: number, crouched: boolean, sheltered: boolean): boolean {
  if (crouched || sheltered) return false;
  return roll < WIND_BLOWOUT_CHANCE;
}

export function fallBlowsOut(fallHeight: number, ropeEquipped: boolean): boolean {
  return !ropeEquipped && fallHeight > FALL_BLOWOUT_HEIGHT;
}

export function extinguish(t: TorchState): TorchState {
  return { ...t, lit: false, relighting: 0 };
}

export function canRelight(t: TorchState, inWater: boolean): boolean {
  return !t.lit && t.relighting === 0 && t.fuel > 0 && !inWater;
}

export function startRelight(t: TorchState): TorchState {
  return { ...t, relighting: RELIGHT_TIME };
}

/** Advance relight animation; interrupted by water. */
export function tickRelight(t: TorchState, dt: number, inWater: boolean): TorchState {
  if (t.relighting <= 0) return t;
  if (inWater) return { ...t, relighting: 0 };
  const r = t.relighting - dt;
  if (r <= 0) return { ...t, relighting: 0, lit: t.fuel > 0 };
  return { ...t, relighting: r };
}

export function addFuel(t: TorchState, amount: number): TorchState {
  return { ...t, fuel: Math.min(t.capacity, t.fuel + amount) };
}

/** Flicker multiplier from a time value; deterministic, ±6%. */
export function flicker(time: number): number {
  return 1 + 0.035 * Math.sin(time * 13.1) + 0.015 * Math.sin(time * 27.7 + 1.3) + 0.01 * Math.sin(time * 51.3 + 0.4);
}
