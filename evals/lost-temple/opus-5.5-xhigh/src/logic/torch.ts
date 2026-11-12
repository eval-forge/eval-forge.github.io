/**
 * Torch rules: fuel burn, the radius curve, blow-out chances and the relight timer. Pure.
 */

export const BASE_FUEL = 300; // seconds of burn
export const BASE_RADIUS = 9; // metres
export const FULL_RADIUS_ABOVE = 0.4; // fuel fraction above which the radius is full
export const MIN_RADIUS_FRACTION = 0.3; // radius fraction just before the torch dies
export const RELIGHT_TIME = 2.2;
export const OIL_FLASK_FUEL = 90;
export const SCONCE_BURN = 600;
export const FALL_BLOWOUT_SPEED = 9; // m/s impact

export interface TorchStats {
  maxFuel: number;
  maxRadius: number;
  /** 0..1: fraction of gust blow-out chance removed. */
  gustResist: number;
  startSpareTorches: number;
  startOilFlasks: number;
}

export function torchStats(torchLevel: number, fuelLevel: number): TorchStats {
  const tl = Math.max(0, Math.min(3, torchLevel));
  const fl = Math.max(0, Math.min(3, fuelLevel));
  return {
    maxFuel: BASE_FUEL + fl * 60,
    maxRadius: BASE_RADIUS + tl * 2,
    gustResist: [0, 0.3, 0.6, 0.8][tl],
    startSpareTorches: 2 + (fl >= 2 ? 1 : 0),
    startOilFlasks: fl,
  };
}

/**
 * Light radius for a given amount of fuel. Full radius while fuel > 40 %; below that it
 * shrinks along an ease-out curve to 30 % of the maximum, and it is 0 when fuel is gone.
 */
export function radiusForFuel(fuel: number, maxFuel: number, maxRadius: number): number {
  if (fuel <= 0 || maxFuel <= 0) return 0;
  const f = Math.min(1, fuel / maxFuel);
  if (f >= FULL_RADIUS_ABOVE) return maxRadius;
  const t = f / FULL_RADIUS_ABOVE; // 0..1
  const ease = 1 - (1 - t) * (1 - t);
  return maxRadius * (MIN_RADIUS_FRACTION + (1 - MIN_RADIUS_FRACTION) * ease);
}

/** Probability that one gust of a given strength (0..1) blows the torch out. */
export function gustBlowoutChance(strength: number, gustResist: number): number {
  const s = Math.max(0, Math.min(1, strength));
  return Math.max(0, Math.min(1, 0.55 * s * s * (1 - gustResist)));
}

export function fallBlowsOut(impactSpeed: number): boolean {
  return impactSpeed >= FALL_BLOWOUT_SPEED;
}

export type DouseReason = 'water' | 'wind' | 'fall' | 'fuel' | 'player';

export type TorchEvent =
  | { type: 'out'; reason: DouseReason }
  | { type: 'lit' }
  | { type: 'relightStart' }
  | { type: 'relightFailed'; why: 'noFuel' | 'wet' }
  | { type: 'lowFuel' };

export class TorchState {
  fuel: number;
  lit = false;
  relighting = false;
  relightT = 0;
  wet = 0; // seconds until dry enough to relight
  private lowWarned = false;

  constructor(public stats: TorchStats, startLit = false) {
    this.fuel = stats.maxFuel;
    this.lit = startLit;
  }

  get radius(): number {
    return this.lit ? radiusForFuel(this.fuel, this.stats.maxFuel, this.stats.maxRadius) : 0;
  }

  get fuelFraction(): number {
    return this.fuel / this.stats.maxFuel;
  }

  update(dt: number): TorchEvent[] {
    const ev: TorchEvent[] = [];
    if (this.wet > 0) this.wet = Math.max(0, this.wet - dt);
    if (this.relighting) {
      this.relightT += dt;
      if (this.relightT >= RELIGHT_TIME) {
        this.relighting = false;
        this.relightT = 0;
        this.lit = true;
        ev.push({ type: 'lit' });
      }
    }
    if (this.lit) {
      this.fuel = Math.max(0, this.fuel - dt);
      if (!this.lowWarned && this.fuelFraction < 0.2) {
        this.lowWarned = true;
        ev.push({ type: 'lowFuel' });
      }
      if (this.fuel <= 0) {
        this.lit = false;
        ev.push({ type: 'out', reason: 'fuel' });
      }
    }
    return ev;
  }

  douse(reason: DouseReason): TorchEvent[] {
    const ev: TorchEvent[] = [];
    if (reason === 'water') this.wet = 3;
    if (this.relighting) {
      this.relighting = false;
      this.relightT = 0;
    }
    if (this.lit) {
      this.lit = false;
      ev.push({ type: 'out', reason });
    }
    return ev;
  }

  startRelight(): TorchEvent[] {
    if (this.lit || this.relighting) return [];
    if (this.fuel <= 0) return [{ type: 'relightFailed', why: 'noFuel' }];
    if (this.wet > 0) return [{ type: 'relightFailed', why: 'wet' }];
    this.relighting = true;
    this.relightT = 0;
    return [{ type: 'relightStart' }];
  }

  addFuel(amount: number) {
    this.fuel = Math.min(this.stats.maxFuel, this.fuel + amount);
    if (this.fuelFraction >= 0.2) this.lowWarned = false;
  }

  /** Swap to a fresh spare torch: full fuel, unlit. */
  replaceWithSpare() {
    this.fuel = this.stats.maxFuel;
    this.lowWarned = false;
  }

  get relightProgress(): number {
    return this.relighting ? this.relightT / RELIGHT_TIME : 0;
  }
}
