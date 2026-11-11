/**
 * Trap rules: pressure plates, weight-swap pedestals, cracking planks / crumbling tiles,
 * dart volleys, the sanctum's instability meter, sun-stones and the sundial glyph.
 * Pure: the entity layer feeds measured loads / contacts / light in and acts on results.
 */

// ---------------------------------------------------------------- pressure plate

export function plateLoad(masses: readonly number[]): number {
  let m = 0;
  for (const x of masses) m += Math.max(0, x);
  return m;
}

export type PlateEvent = 'pressed' | 'released' | null;

export class PressurePlate {
  pressed = false;
  /** Once latched it stays down (door counterweights). */
  latched = false;
  constructor(public threshold: number, public latching = false, public releaseHysteresis = 0.9) {}

  update(load: number): PlateEvent {
    if (this.latched) return null;
    if (!this.pressed && load >= this.threshold) {
      this.pressed = true;
      if (this.latching) this.latched = true;
      return 'pressed';
    }
    if (this.pressed && load < this.threshold * this.releaseHysteresis) {
      this.pressed = false;
      return 'released';
    }
    return null;
  }
}

// ---------------------------------------------------------------- pedestal

export const PEDESTAL_TOLERANCE = 0.15;

/** True when the load left on a pedestal differs from the relic's weight by more than the tolerance. */
export function pedestalTriggered(relicWeight: number, loadAfter: number, tolerance = PEDESTAL_TOLERANCE): boolean {
  if (relicWeight <= 0) return false;
  return Math.abs(loadAfter - relicWeight) > tolerance * relicWeight;
}

export class PedestalTrap {
  armed = true;
  fired = false;
  constructor(public relicWeight: number, public tolerance = PEDESTAL_TOLERANCE) {}

  /** Call once when the relic leaves the pedestal, with whatever load is now on it. */
  onRelicLifted(loadAfter: number): 'fire' | 'safe' {
    if (!this.armed || this.fired) return 'safe';
    if (pedestalTriggered(this.relicWeight, loadAfter, this.tolerance)) {
      this.fired = true;
      this.armed = false;
      return 'fire';
    }
    // a correct swap disarms the pedestal for good
    this.armed = false;
    return 'safe';
  }
}

// ---------------------------------------------------------------- failing floor

export type FailState = 'solid' | 'cracking' | 'failed';

/**
 * A plank or tile that starts cracking on first contact and fails after `delay` seconds,
 * whether or not you are still on it. You cannot stop on it.
 */
export class FailTimer {
  state: FailState = 'solid';
  t = 0;
  constructor(public delay: number) {}

  touch(): boolean {
    if (this.state !== 'solid') return false;
    this.state = 'cracking';
    this.t = 0;
    return true;
  }

  /** Returns true on the frame it fails. */
  update(dt: number): boolean {
    if (this.state !== 'cracking') return false;
    this.t += dt;
    if (this.t >= this.delay) {
      this.state = 'failed';
      return true;
    }
    return false;
  }

  /** 0..1 how close to failing (for shaking / creaking). */
  get progress(): number {
    if (this.state === 'solid') return 0;
    if (this.state === 'failed') return 1;
    return Math.min(1, this.t / this.delay);
  }
}

// ---------------------------------------------------------------- darts

export class DartLauncher {
  cooldown = 0;
  constructor(public reload = 1.4, public volley = 3) {}

  /** Returns number of darts to fire now (0 if reloading). */
  trigger(): number {
    if (this.cooldown > 0) return 0;
    this.cooldown = this.reload;
    return this.volley;
  }

  update(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }
}

/** Dart flight height above the floor. Standing eye/chest is hit, a crouched player is not. */
export const DART_HEIGHT = 1.25;
export function dartHitsPlayer(dartY: number, floorY: number, playerHeight: number): boolean {
  const top = floorY + playerHeight;
  return dartY >= floorY + 0.1 && dartY <= top;
}

// ---------------------------------------------------------------- sanctum instability

export class InstabilityMeter {
  value = 0; // 0..100
  private pending = 0;
  constructor(public decayPerSecond = 4) {}

  /**
   * Add a noise (loudness 0..1). Returns how many debris rocks to drop right now.
   * Quiet noises only build instability; loud ones on an unstable ceiling shake rocks loose.
   */
  add(loudness: number): number {
    const l = Math.max(0, Math.min(1, loudness));
    this.value = Math.min(100, this.value + l * 22);
    if (l < 0.25 || this.value < 25) return 0;
    this.pending += l * (this.value / 100) * 3;
    const n = Math.floor(this.pending);
    this.pending -= n;
    return n;
  }

  update(dt: number) {
    this.value = Math.max(0, this.value - this.decayPerSecond * dt);
  }
}

// ---------------------------------------------------------------- sun-stones

export type SunStoneState = 'phantom' | 'solid' | 'fading';

/**
 * A slab that is only solid while sunlit. It solidifies after 0.25 s of light and,
 * when the light leaves, flickers for a grace period before turning to phantom.
 */
export class SunStone {
  state: SunStoneState = 'phantom';
  private t = 0;
  constructor(public solidifyTime = 0.25, public graceTime = 1.0) {}

  update(dt: number, lit: boolean): SunStoneState {
    if (lit) {
      if (this.state === 'phantom') {
        this.t += dt;
        if (this.t >= this.solidifyTime) {
          this.state = 'solid';
          this.t = 0;
        }
      } else {
        this.state = 'solid';
        this.t = 0;
      }
    } else {
      if (this.state === 'solid') {
        this.state = 'fading';
        this.t = 0;
      } else if (this.state === 'fading') {
        this.t += dt;
        if (this.t >= this.graceTime) {
          this.state = 'phantom';
          this.t = 0;
        }
      } else {
        this.t = 0;
      }
    }
    return this.state;
  }

  get solid(): boolean {
    return this.state !== 'phantom';
  }
}

// ---------------------------------------------------------------- sundial

export const SUNDIAL_GLYPHS = 12;

/**
 * Which rim glyph the gnomon's shadow points at. Glyphs run from west (0) through north
 * to east (11). `sunDir` points toward the sun; the shadow points away from it.
 * Returns -1 when the sun is down (no shadow).
 */
export function sundialGlyph(sunDir: readonly [number, number, number]): number {
  if (sunDir[1] <= 0.005) return -1;
  const sx = -sunDir[0];
  const sz = -sunDir[2];
  if (Math.hypot(sx, sz) < 1e-4) return Math.floor(SUNDIAL_GLYPHS / 2); // straight overhead
  let phi = Math.atan2(sz, sx); // (-π, π]
  // map to [π, 2π] range: west = π, north = 1.5π, east = 2π
  if (phi < 0) phi += 2 * Math.PI;
  if (phi < Math.PI) phi = phi < Math.PI / 2 ? 2 * Math.PI : Math.PI; // shadow on the south side: clamp to an end
  const idx = Math.floor(((phi - Math.PI) / Math.PI) * SUNDIAL_GLYPHS);
  return Math.max(0, Math.min(SUNDIAL_GLYPHS - 1, idx));
}

/** Angle (radians in the xz-plane, atan2(z, x)) of a glyph's centre on the dial rim. */
export function sundialGlyphAngle(i: number): number {
  return Math.PI + ((i + 0.5) / SUNDIAL_GLYPHS) * Math.PI;
}

// ---------------------------------------------------------------- damage

export const DAMAGE = {
  dart: 14,
  blade: 34,
  boulder: 80,
  debrisMax: 30,
  spikes: 45,
};

/** Fall damage from landing speed (m/s). Safe below 11 m/s (~3.4 m drop with our gravity). */
export function fallDamage(impactSpeed: number): number {
  if (impactSpeed < 11) return 0;
  return Math.round((impactSpeed - 11) * 9);
}
