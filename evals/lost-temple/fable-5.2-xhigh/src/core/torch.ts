/**
 * The torch: fuel, the radius curve, and the lit / out / relighting state
 * machine. Pure rules. Unit-tested in tests/torch.test.ts.
 */
import { clamp01, lerp, smoothstep } from './rng';

export const TORCH_MIN_RADIUS = 3.5;
/** Below this fuel fraction the light starts closing in. */
export const TORCH_DIM_BELOW = 0.35;
export const TORCH_RELIGHT_TIME = 1.6;
export const FLASK_FUEL = 90;
/** Water deeper than this (measured at the player's feet) drowns the flame. */
export const WATER_DOUSE_DEPTH = 1.4;
/** Gusts at or above this strength blow the flame out unless you shield it. */
export const GUST_DOUSE_STRENGTH = 0.6;
/** Landing faster than this (m/s) knocks the flame out. */
export const FALL_DOUSE_SPEED = 9;
/** A shade will not come closer than this fraction of the torch radius. */
export const SHADE_SAFE_FRACTION = 0.8;
/** Light radius of a torch mounted in a sconce. */
export const SCONCE_RADIUS = 9;

export type TorchState = 'out' | 'relighting' | 'lit';
export type DouseCause = 'manual' | 'water' | 'wind' | 'fall' | 'empty' | 'hit';

export type TorchEvent =
  | { type: 'lit' }
  | { type: 'doused'; cause: DouseCause }
  | { type: 'relightStarted' }
  | { type: 'relightInterrupted' }
  | { type: 'low' };

/** Light radius for a fuel fraction: full until 35 %, then easing down to the minimum. */
export function radiusForFuel(fraction: number, maxRadius: number, minRadius = TORCH_MIN_RADIUS): number {
  const f = clamp01(fraction);
  if (f >= TORCH_DIM_BELOW) return maxRadius;
  return lerp(minRadius, maxRadius, smoothstep(0, TORCH_DIM_BELOW, f));
}

/** Relative brightness 0..1 for a fuel fraction (drops a little faster than the radius). */
export function brightnessForFuel(fraction: number): number {
  const f = clamp01(fraction);
  if (f >= TORCH_DIM_BELOW) return 1;
  return lerp(0.3, 1, smoothstep(0, TORCH_DIM_BELOW, f));
}

export const waterDouses = (depthAtFeet: number): boolean => depthAtFeet > WATER_DOUSE_DEPTH;
export const gustDouses = (strength: number, shielded: boolean): boolean =>
  !shielded && strength >= GUST_DOUSE_STRENGTH;
export const fallDouses = (impactSpeed: number): boolean => impactSpeed > FALL_DOUSE_SPEED;

export class TorchModel {
  state: TorchState = 'out';
  /** Seconds of flame left in the torch in hand. */
  fuel: number;
  flasks = 0;
  spares = 0;
  private relightT = 0;
  private warnedLow = false;

  constructor(
    public capacity: number,
    public maxRadius: number,
    spares = 0,
  ) {
    this.fuel = capacity;
    this.spares = spares;
  }

  get lit(): boolean {
    return this.state === 'lit';
  }

  /** True during the relight animation: the player is slowed and exposed. */
  get vulnerable(): boolean {
    return this.state === 'relighting';
  }

  get fuelFraction(): number {
    return clamp01(this.fuel / this.capacity);
  }

  /** 0..1 progress of the relight animation. */
  get relightProgress(): number {
    return this.state === 'relighting' ? clamp01(this.relightT / TORCH_RELIGHT_TIME) : 0;
  }

  /** Current light radius in metres (0 when not lit). */
  get radius(): number {
    return this.lit ? radiusForFuel(this.fuelFraction, this.maxRadius) : 0;
  }

  /** Current brightness 0..1 (0 when not lit). */
  get brightness(): number {
    return this.lit ? brightnessForFuel(this.fuelFraction) : 0;
  }

  /** The distance inside which a shade cannot reach you. */
  get shadeSafeRadius(): number {
    return this.radius * SHADE_SAFE_FRACTION;
  }

  /** F key: douse if lit, otherwise start striking the flint. */
  toggle(): TorchEvent | null {
    if (this.state === 'lit') return this.douse('manual');
    if (this.state === 'relighting') return null;
    return this.startRelight();
  }

  startRelight(): TorchEvent | null {
    if (this.state !== 'out' || this.fuel <= 0) return null;
    this.state = 'relighting';
    this.relightT = 0;
    return { type: 'relightStarted' };
  }

  /** Something put the flame out. Also cancels a relight in progress. */
  douse(cause: DouseCause): TorchEvent | null {
    if (this.state === 'lit') {
      this.state = 'out';
      return { type: 'doused', cause };
    }
    if (this.state === 'relighting') {
      this.state = 'out';
      this.relightT = 0;
      return { type: 'relightInterrupted' };
    }
    return null;
  }

  /** Pour a flask or swap in a spare. Returns what was used. */
  refuel(): 'flask' | 'spare' | null {
    if (this.fuel >= this.capacity - 1) return null;
    if (this.flasks > 0) {
      this.flasks--;
      this.fuel = Math.min(this.capacity, this.fuel + FLASK_FUEL);
      this.warnedLow = this.fuelFraction < 0.2;
      return 'flask';
    }
    if (this.spares > 0) {
      this.spares--;
      this.fuel = this.capacity;
      this.warnedLow = false;
      return 'spare';
    }
    return null;
  }

  /** Give up a spare torch (to mount it in a sconce). */
  takeSpare(): boolean {
    if (this.spares <= 0) return false;
    this.spares--;
    return true;
  }

  update(dt: number): TorchEvent[] {
    const events: TorchEvent[] = [];
    if (this.state === 'lit') {
      this.fuel = Math.max(0, this.fuel - dt);
      if (!this.warnedLow && this.fuelFraction < 0.2) {
        this.warnedLow = true;
        events.push({ type: 'low' });
      }
      if (this.fuel <= 0) {
        this.state = 'out';
        events.push({ type: 'doused', cause: 'empty' });
      }
    } else if (this.state === 'relighting') {
      this.relightT += dt;
      if (this.relightT >= TORCH_RELIGHT_TIME) {
        this.state = 'lit';
        this.relightT = 0;
        events.push({ type: 'lit' });
      }
    }
    return events;
  }
}
