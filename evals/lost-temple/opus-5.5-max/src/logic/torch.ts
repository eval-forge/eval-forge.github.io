/**
 * Torch fuel, light radius curve, the ways it goes out, and relighting. Pure logic, unit tested.
 */

export interface TorchStats {
  fuelCapacity: number;
  burnPerSec: number;
  maxRadius: number;
  minRadius: number;
  gustResist: number; // 0..1
  relightTime: number;
}

export const BASE_TORCH: TorchStats = {
  fuelCapacity: 100,
  burnPerSec: 1 / 3,
  maxRadius: 11,
  minRadius: 2.5,
  gustResist: 0,
  relightTime: 2.2,
};

/** Fuel fraction above which the torch burns at full radius. */
export const FULL_RADIUS_FRACTION = 0.45;
export const OIL_FLASK_FUEL = 50;
export const SCONCE_BURN_TIME = 360;
export const SCONCE_RADIUS = 7;
/** Landing speed (m/s) above which a fall snuffs the torch. */
export const FALL_SNUFF_SPEED = 9;

/**
 * Light radius for a given fuel amount. Full radius above 45% fuel, then an ease-out curve
 * down to minRadius just before the fuel runs out, and 0 when it is empty.
 */
export function torchRadius(fuel: number, stats: TorchStats): number {
  if (fuel <= 0) return 0;
  const f = Math.min(1, fuel / stats.fuelCapacity);
  if (f >= FULL_RADIUS_FRACTION) return stats.maxRadius;
  const x = f / FULL_RADIUS_FRACTION;
  const ease = 1 - (1 - x) * (1 - x);
  return stats.minRadius + (stats.maxRadius - stats.minRadius) * ease;
}

/** Light intensity multiplier (0..1) that goes with the radius, so a dying torch also dims. */
export function torchIntensity(fuel: number, stats: TorchStats): number {
  const r = torchRadius(fuel, stats);
  if (r <= 0) return 0;
  return 0.35 + 0.65 * (r / stats.maxRadius);
}

/** Chance (0..1) that a single gust blows the torch out. Crouching shields the flame. */
export function gustBlowOutChance(gustStrength: number, gustResist: number, crouched: boolean): number {
  const s = Math.max(0, Math.min(1, gustStrength));
  const shield = crouched ? 0.35 : 1;
  return Math.max(0, Math.min(1, s * s * 0.85 * (1 - gustResist) * shield));
}

export function fallSnuffsTorch(impactSpeed: number): boolean {
  return impactSpeed > FALL_SNUFF_SPEED;
}

export type TorchOutReason = 'water' | 'wind' | 'fall' | 'fuel' | 'snuffed';

export type TorchEvent =
  | { type: 'out'; reason: TorchOutReason }
  | { type: 'lit' }
  | { type: 'relightStart' }
  | { type: 'relightFail'; reason: 'noFuel' | 'water' }
  | { type: 'lowFuel' }
  | { type: 'refuel'; amount: number }
  | { type: 'freshTorch' };

export interface TorchEnv {
  /** Water surface above the flame. */
  submerged: boolean;
  /** Gusts that started this frame, each with a strength 0..1. */
  gusts: number[];
  crouched: boolean;
  rand: () => number;
}

export class TorchState {
  lit = false;
  fuel: number;
  relighting = 0; // seconds left in the relight animation, 0 when idle
  spareTorches: number;
  oilFlasks: number;
  private lowWarned = false;

  constructor(public stats: TorchStats, spareTorches = 1, oilFlasks = 1) {
    this.fuel = stats.fuelCapacity;
    this.spareTorches = spareTorches;
    this.oilFlasks = oilFlasks;
  }

  get radius(): number {
    return this.lit ? torchRadius(this.fuel, this.stats) : 0;
  }
  get fuelFraction(): number {
    return this.fuel / this.stats.fuelCapacity;
  }
  get isRelighting(): boolean {
    return this.relighting > 0;
  }

  /** Begin the vulnerable relight animation. */
  startRelight(submerged: boolean): TorchEvent[] {
    if (this.lit || this.relighting > 0) return [];
    if (submerged) return [{ type: 'relightFail', reason: 'water' }];
    if (this.fuel <= 0) {
      if (this.spareTorches > 0) {
        this.spareTorches--;
        this.fuel = this.stats.fuelCapacity;
        this.lowWarned = false;
        this.relighting = this.stats.relightTime;
        return [{ type: 'freshTorch' }, { type: 'relightStart' }];
      }
      return [{ type: 'relightFail', reason: 'noFuel' }];
    }
    this.relighting = this.stats.relightTime;
    return [{ type: 'relightStart' }];
  }

  /** Instantly light from another flame (a lit sconce). */
  lightFrom(): TorchEvent[] {
    if (this.lit) return [];
    if (this.fuel <= 0) {
      if (this.spareTorches <= 0) return [{ type: 'relightFail', reason: 'noFuel' }];
      this.spareTorches--;
      this.fuel = this.stats.fuelCapacity;
      this.lowWarned = false;
    }
    this.relighting = 0;
    this.lit = true;
    return [{ type: 'lit' }];
  }

  snuff(): TorchEvent[] {
    if (!this.lit) {
      this.relighting = 0;
      return [];
    }
    this.lit = false;
    return [{ type: 'out', reason: 'snuffed' }];
  }

  extinguish(reason: TorchOutReason): TorchEvent[] {
    this.relighting = 0;
    if (!this.lit) return [];
    this.lit = false;
    return [{ type: 'out', reason }];
  }

  useOilFlask(): TorchEvent[] {
    if (this.oilFlasks <= 0) return [];
    if (this.fuel >= this.stats.fuelCapacity - 0.5) return [];
    this.oilFlasks--;
    const before = this.fuel;
    this.fuel = Math.min(this.stats.fuelCapacity, this.fuel + OIL_FLASK_FUEL);
    if (this.fuelFraction > 0.2) this.lowWarned = false;
    return [{ type: 'refuel', amount: this.fuel - before }];
  }

  /** Take a spare torch out to place it in a sconce. */
  takeSpare(): boolean {
    if (this.spareTorches <= 0) return false;
    this.spareTorches--;
    return true;
  }

  update(dt: number, env: TorchEnv): TorchEvent[] {
    const ev: TorchEvent[] = [];
    if (this.relighting > 0) {
      if (env.submerged) {
        this.relighting = 0;
        ev.push({ type: 'relightFail', reason: 'water' });
        return ev;
      }
      this.relighting -= dt;
      if (this.relighting <= 0) {
        this.relighting = 0;
        this.lit = true;
        ev.push({ type: 'lit' });
      }
      return ev;
    }
    if (!this.lit) return ev;
    if (env.submerged) return this.extinguish('water');
    for (const g of env.gusts) {
      if (env.rand() < gustBlowOutChance(g, this.stats.gustResist, env.crouched)) return this.extinguish('wind');
    }
    this.fuel = Math.max(0, this.fuel - this.stats.burnPerSec * dt);
    if (!this.lowWarned && this.fuelFraction < 0.2) {
      this.lowWarned = true;
      ev.push({ type: 'lowFuel' });
    }
    if (this.fuel <= 0) {
      this.lit = false;
      ev.push({ type: 'out', reason: 'fuel' });
    }
    return ev;
  }
}

/** A torch placed in a wall sconce. */
export class SconceFlame {
  remaining = SCONCE_BURN_TIME;
  get lit() {
    return this.remaining > 0;
  }
  get radius() {
    if (this.remaining <= 0) return 0;
    const f = this.remaining / SCONCE_BURN_TIME;
    return f > 0.2 ? SCONCE_RADIUS : SCONCE_RADIUS * (0.4 + 0.6 * (f / 0.2));
  }
  update(dt: number) {
    this.remaining = Math.max(0, this.remaining - dt);
  }
  douse() {
    this.remaining = 0;
  }
}
