/**
 * Player stat curves: how carried weight affects speed, jumps and stamina. Pure logic.
 */

export const WALK_SPEED = 4.2;
export const SPRINT_SPEED = 6.6;
export const CROUCH_SPEED = 2.0;
export const CLIMB_SPEED = 2.2;
export const SWIM_SPEED = 1.9;
export const JUMP_VELOCITY = 6.4;
export const PLAYER_GRAVITY = 20;
export const MAX_LIFT_MASS = 25;

export const SPRINT_DRAIN = 18;
export const CLIMB_DRAIN = 10;
export const SWIM_DRAIN = 6;
export const JUMP_COST = 12;
export const MANTLE_COST = 10;
export const STAMINA_REGEN = 22;
export const STAMINA_REGEN_DELAY = 0.8;
export const EXHAUSTED_RECOVER = 25;

/** Speed multiplier from load fraction: 1 when empty, 0.55 when the satchel is full. */
export function loadSpeedFactor(loadFraction: number): number {
  const lf = Math.max(0, Math.min(1.3, loadFraction));
  return Math.max(0.45, 1 - 0.45 * Math.pow(lf, 1.25));
}

export function staminaDrainMultiplier(loadFraction: number): number {
  return 1 + 1.2 * Math.max(0, Math.min(1.3, loadFraction));
}

export function jumpVelocity(loadFraction: number): number {
  return JUMP_VELOCITY * (1 - 0.22 * Math.max(0, Math.min(1, loadFraction)));
}

export class Stamina {
  value: number;
  exhausted = false;
  private sinceDrain = 999;

  constructor(public max: number) {
    this.value = max;
  }

  get fraction() {
    return this.value / this.max;
  }

  /** Continuous drain (per second). */
  drain(perSec: number, dt: number) {
    if (perSec <= 0) return;
    this.value = Math.max(0, this.value - perSec * dt);
    this.sinceDrain = 0;
    if (this.value <= 0) this.exhausted = true;
  }

  /** One-off cost. Returns false (and spends nothing) if there is not enough. */
  spend(amount: number): boolean {
    if (this.exhausted || this.value < amount * 0.5) return false;
    this.value = Math.max(0, this.value - amount);
    this.sinceDrain = 0;
    if (this.value <= 0) this.exhausted = true;
    return true;
  }

  update(dt: number, loadFraction: number) {
    this.sinceDrain += dt;
    if (this.sinceDrain >= STAMINA_REGEN_DELAY) {
      const slow = loadFraction > 1 ? 0.5 : 1;
      this.value = Math.min(this.max, this.value + STAMINA_REGEN * slow * dt);
    }
    if (this.exhausted && this.value >= EXHAUSTED_RECOVER) this.exhausted = false;
  }

  canSprint() {
    return !this.exhausted && this.value > 1;
  }
}
