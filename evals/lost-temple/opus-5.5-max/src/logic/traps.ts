/**
 * Trap trigger rules: pressure plates, weighted pedestals, cracking planks and crumbling tiles,
 * and the damage numbers for hazards. Pure logic, unit tested.
 */

export const PLAYER_BODY_MASS = 75;

/**
 * Pressure plate with hysteresis: presses when load >= threshold for `pressTime`,
 * releases when load drops below `releaseRatio * threshold` for `releaseTime`.
 */
export class PressurePlateLogic {
  pressed = false;
  private above = 0;
  private below = 0;
  /** Latching plates stay pressed forever once triggered. */
  latched = false;

  constructor(
    public threshold: number,
    public opts: { pressTime?: number; releaseTime?: number; releaseRatio?: number; latch?: boolean } = {},
  ) {}

  update(load: number, dt: number): 'pressed' | 'released' | null {
    const pressTime = this.opts.pressTime ?? 0.08;
    const releaseTime = this.opts.releaseTime ?? 0.25;
    const releaseRatio = this.opts.releaseRatio ?? 0.8;
    if (this.latched) return null;
    if (!this.pressed) {
      if (load >= this.threshold) {
        this.above += dt;
        if (this.above >= pressTime) {
          this.pressed = true;
          this.above = 0;
          this.below = 0;
          if (this.opts.latch) this.latched = true;
          return 'pressed';
        }
      } else this.above = 0;
    } else {
      if (load < this.threshold * releaseRatio) {
        this.below += dt;
        if (this.below >= releaseTime) {
          this.pressed = false;
          this.below = 0;
          return 'released';
        }
      } else this.below = 0;
    }
    return null;
  }
}

/**
 * A pedestal that is armed with the mass of the relic on it. Remove the relic without leaving
 * something of similar mass and, after a short grace period, it fires (once).
 */
export class WeightTrapLogic {
  fired = false;
  private off = 0;
  constructor(public armedMass: number, public tolerance = 0.2, public grace = 0.3) {}

  isWithinTolerance(mass: number): boolean {
    return Math.abs(mass - this.armedMass) <= this.armedMass * this.tolerance;
  }

  update(mass: number, dt: number): boolean {
    if (this.fired) return false;
    if (this.isWithinTolerance(mass)) {
      this.off = 0;
      return false;
    }
    this.off += dt;
    if (this.off >= this.grace) {
      this.fired = true;
      return true;
    }
    return false;
  }
}

/** Seconds a rope-bridge plank holds after you step on it. Heavier loads break it sooner. */
export function plankBreakDelay(loadFraction: number): number {
  const lf = Math.max(0, Math.min(1.5, loadFraction));
  return 0.55 * (1 - 0.4 * Math.min(1, lf));
}

export const CRUMBLE_DELAY = 0.8;

/** Lifecycle of something that breaks a while after being touched (planks, tiles). */
export class BreakTimer {
  state: 'intact' | 'cracking' | 'fallen' = 'intact';
  remaining = 0;
  constructor(public baseDelay: number) {}

  /** Start cracking (no effect if already cracking or fallen). `delay` overrides the base delay. */
  touch(delay = this.baseDelay): boolean {
    if (this.state !== 'intact') return false;
    this.state = 'cracking';
    this.remaining = delay;
    return true;
  }

  update(dt: number): boolean {
    if (this.state !== 'cracking') return false;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.state = 'fallen';
      return true;
    }
    return false;
  }
}

// --- hazard damage -------------------------------------------------------

export const DART_DAMAGE = 20;
export const BLADE_DAMAGE = 55;
export const SPIKE_DAMAGE = 45;
export const BOULDER_LETHAL_SPEED = 3;

export function fallDamage(impactSpeed: number): number {
  return impactSpeed > 11 ? Math.round((impactSpeed - 11) * 9) : 0;
}

/** Damage from a rock or boulder hitting the player, from its speed and mass. */
export function impactDamage(speed: number, mass: number): number {
  if (mass >= 1000 && speed > BOULDER_LETHAL_SPEED) return 1000;
  const e = 0.5 * mass * speed * speed; // joules
  if (e < 60) return 0;
  return Math.min(100, Math.round((e - 60) / 12));
}

/** Damage a swinging blade does at a given tip speed (m/s). */
export function bladeDamage(tipSpeed: number): number {
  return tipSpeed < 1 ? 10 : BLADE_DAMAGE;
}
