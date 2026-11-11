/** Trap trigger logic, independent of rendering/physics. */

/** Pressure plate: pressed when load on it reaches the threshold. Latching plates stay pressed. */
export class PressurePlate {
  pressed = false;
  constructor(public threshold: number, public latching = false) {}
  update(load: number): boolean {
    const was = this.pressed;
    if (load >= this.threshold) this.pressed = true;
    else if (!this.latching) this.pressed = false;
    return this.pressed && !was; // rising edge
  }
}

/**
 * Trapped pedestal. Lifting the relic starts a grace window; if the load left on
 * the pedestal is < 75% of the relic's weight when it expires, the trap fires.
 */
export class TrappedPedestal {
  static TOLERANCE = 0.75;
  static GRACE = 1.0;
  state: 'armed' | 'grace' | 'safe' | 'fired' = 'armed';
  graceLeft = 0;
  constructor(public relicWeight: number) {}

  /** Call every frame with the current load on the pedestal (kg) and whether the original relic is still on it. */
  update(dt: number, load: number, relicPresent: boolean): 'fire' | null {
    if (this.state === 'fired' || this.state === 'safe') return null;
    if (this.state === 'armed') {
      if (relicPresent) return null;
      this.state = 'grace';
      this.graceLeft = TrappedPedestal.GRACE;
    }
    if (this.state === 'grace') {
      if (relicPresent) { this.state = 'armed'; return null; }
      this.graceLeft -= dt;
      if (this.graceLeft <= 0) {
        if (load >= this.relicWeight * TrappedPedestal.TOLERANCE) {
          this.state = 'safe';
          return null;
        }
        this.state = 'fired';
        return 'fire';
      }
    }
    return null;
  }

  static swapIsSafe(relicWeight: number, swapWeight: number): boolean {
    return swapWeight >= relicWeight * TrappedPedestal.TOLERANCE;
  }
}

/** Crumbling tile / plank: starts cracking when stepped on, drops after `delay`. Optionally respawns. */
export class Crumbler {
  state: 'solid' | 'cracking' | 'fallen' = 'solid';
  timer = 0;
  constructor(public delay: number, public respawn = 0) {}
  step(): void {
    if (this.state === 'solid') { this.state = 'cracking'; this.timer = this.delay; }
  }
  update(dt: number): 'fall' | 'respawn' | null {
    if (this.state === 'cracking') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'fallen';
        this.timer = this.respawn;
        return 'fall';
      }
    } else if (this.state === 'fallen' && this.respawn > 0) {
      this.timer -= dt;
      if (this.timer <= 0) { this.state = 'solid'; return 'respawn'; }
    }
    return null;
  }
}

/** Sun tile: safe only while sunlit. Stepping on it in shadow makes it crumble. */
export function sunTileShouldCrumble(occupied: boolean, sunlit: boolean): boolean {
  return occupied && !sunlit;
}

/** Dart launcher with a cooldown. */
export class DartLauncher {
  cooldown = 0;
  constructor(public reload = 1.6) {}
  trigger(): boolean {
    if (this.cooldown > 0) return false;
    this.cooldown = this.reload;
    return true;
  }
  update(dt: number) { this.cooldown = Math.max(0, this.cooldown - dt); }
}

/** Noise-triggered debris: accumulates noise, drops debris when over threshold, decays over time. */
export class UnstableCeiling {
  level = 0;
  constructor(public threshold = 1, public decay = 0.25) {}
  addNoise(amount: number): boolean {
    this.level += amount;
    if (this.level >= this.threshold) { this.level = 0; return true; }
    return false;
  }
  update(dt: number) { this.level = Math.max(0, this.level - this.decay * dt); }
}
