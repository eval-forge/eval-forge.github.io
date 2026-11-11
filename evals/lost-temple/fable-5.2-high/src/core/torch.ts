import { clamp01 } from './types';

export const RELIGHT_TIME = 2.2;
export const FLASK_REFILL = 0.45;
/** Below this fuel fraction the light starts closing in. */
export const LOW_FUEL = 0.35;
/** Fraction of full radius left just before the torch dies. */
export const MIN_RADIUS_FRACTION = 0.35;
export const WATER_DOUSE_DEPTH = 0.9;
export const FALL_DOUSE_HEIGHT = 4;
export const WIND_DOUSE_STRENGTH = 0.75;
/** Relighting a blown-out torch costs a little fuel. */
export const RELIGHT_FUEL_COST = 0.02;

export interface TorchConfig { burnTime: number; maxRadius: number; }

/**
 * stowed: put away on purpose, not burning.
 * relighting: the vulnerable strike-and-catch animation; no light yet.
 * lit: burning fuel.
 * out: blown out by water, wind or a fall. Fuel remains; needs relighting.
 * dead: fuel exhausted. Needs a flask or a spare torch.
 */
export type TorchState = 'stowed' | 'relighting' | 'lit' | 'out' | 'dead';

export type DouseCause = 'water' | 'wind' | 'fall';
export type TorchEvent = 'lit' | 'died' | 'low';

export interface Torch { state: TorchState; fuel: number; relightT: number; spares: number; flasks: number; lowWarned: boolean; }

export function newTorch(spares = 1, flasks = 0): Torch {
  return { state: 'stowed', fuel: 1, relightT: 0, spares, flasks, lowWarned: false };
}

/**
 * Light radius for a fuel level. Full radius until fuel drops under LOW_FUEL, then it shrinks
 * toward MIN_RADIUS_FRACTION of full, and it is zero once the fuel is gone.
 */
export function radiusForFuel(fuel: number, maxRadius: number): number {
  if (fuel <= 0) return 0;
  if (fuel >= LOW_FUEL) return maxRadius;
  const k = Math.pow(fuel / LOW_FUEL, 0.7);
  return maxRadius * (MIN_RADIUS_FRACTION + (1 - MIN_RADIUS_FRACTION) * k);
}

/** Current light radius: zero unless the torch is actually burning. */
export function torchRadius(t: Torch, cfg: TorchConfig): number {
  return t.state === 'lit' ? radiusForFuel(t.fuel, cfg.maxRadius) : 0;
}

export function isLit(t: Torch): boolean { return t.state === 'lit'; }

/** Advance the torch by dt seconds. Returns events for audio and HUD. */
export function stepTorch(t: Torch, dt: number, cfg: TorchConfig): TorchEvent[] {
  const ev: TorchEvent[] = [];
  if (t.state === 'relighting') {
    t.relightT -= dt;
    if (t.relightT <= 0) { t.state = 'lit'; t.relightT = 0; ev.push('lit'); }
  } else if (t.state === 'lit') {
    t.fuel = clamp01(t.fuel - dt / cfg.burnTime);
    if (t.fuel <= 0) { t.fuel = 0; t.state = 'dead'; ev.push('died'); }
    else if (t.fuel < LOW_FUEL && !t.lowWarned) { t.lowWarned = true; ev.push('low'); }
  }
  return ev;
}

/** Begin lighting. Works from stowed or out, as long as there is fuel. */
export function startRelight(t: Torch): boolean {
  if ((t.state !== 'stowed' && t.state !== 'out') || t.fuel <= 0) return false;
  if (t.state === 'out') t.fuel = Math.max(0.001, t.fuel - RELIGHT_FUEL_COST);
  t.state = 'relighting';
  t.relightT = RELIGHT_TIME;
  return true;
}

/** Put a burning torch away to save fuel. */
export function stow(t: Torch): boolean {
  if (t.state !== 'lit' && t.state !== 'relighting') return false;
  t.state = 'stowed';
  t.relightT = 0;
  return true;
}

/** Something blew it out. Interrupts a relight too. */
export function douse(t: Torch, _cause: DouseCause): boolean {
  if (t.state !== 'lit' && t.state !== 'relighting') return false;
  t.state = 'out';
  t.relightT = 0;
  return true;
}

export function dousedByWater(depth: number): boolean { return depth > WATER_DOUSE_DEPTH; }
export function dousedByFall(height: number): boolean { return height > FALL_DOUSE_HEIGHT; }
/** A gust at or above the threshold always kills the flame; weaker gusts only make it gutter. */
export function dousedByWind(strength: number): boolean { return strength >= WIND_DOUSE_STRENGTH; }

/** Pour a flask in. Revives a dead torch to "out" so it can be relit. */
export function useFlask(t: Torch): boolean {
  if (t.flasks <= 0 || t.fuel >= 0.999) return false;
  t.flasks -= 1;
  t.fuel = clamp01(t.fuel + FLASK_REFILL);
  if (t.fuel >= LOW_FUEL) t.lowWarned = false;
  if (t.state === 'dead') t.state = 'out';
  return true;
}

/** Swap in a spare torch: full fuel, but it still has to be lit. */
export function useSpare(t: Torch): boolean {
  if (t.spares <= 0) return false;
  t.spares -= 1;
  t.fuel = 1;
  t.lowWarned = false;
  if (t.state === 'dead' || t.state === 'lit' || t.state === 'relighting') t.state = 'out';
  return true;
}

/** Leave a spare torch burning in a wall sconce. */
export function placeSpare(t: Torch): boolean {
  if (t.spares <= 0) return false;
  t.spares -= 1;
  return true;
}

/** Flicker multiplier around 1 for the light intensity; gets jumpier as fuel runs down. */
export function flicker(time: number, fuel: number): number {
  const jitter = 0.06 + 0.16 * (1 - clamp01(fuel / LOW_FUEL));
  const n = Math.sin(time * 13.1) * 0.5 + Math.sin(time * 31.7 + 1.3) * 0.3 + Math.sin(time * 71.3 + 4.1) * 0.2;
  return 1 + n * jitter;
}
