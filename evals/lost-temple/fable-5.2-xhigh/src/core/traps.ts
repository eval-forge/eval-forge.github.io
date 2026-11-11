/**
 * Trap logic with the physics and visuals stripped away. Each class answers
 * one question ("should this fire now?") from plain numbers.
 * Unit-tested in tests/traps.test.ts.
 */
import { clamp01 } from './rng';

export const DAMAGE = {
  dart: 20,
  blade: 45,
  scarabPerSec: 12,
  boulder: 100,
  debris: 35,
  drownPerSec: 15,
  spikes: 100,
} as const;

/** Landing speed (m/s) below which a fall is free. */
export const SAFE_FALL_SPEED = 12.5;
export const LETHAL_FALL_SPEED = 22;

/** Damage for hitting the ground at a given downward speed. */
export function fallDamage(impactSpeed: number): number {
  if (impactSpeed <= SAFE_FALL_SPEED) return 0;
  if (impactSpeed >= LETHAL_FALL_SPEED) return 100;
  return Math.round(((impactSpeed - SAFE_FALL_SPEED) / (LETHAL_FALL_SPEED - SAFE_FALL_SPEED)) * 90 + 10);
}

// ---------------------------------------------------------------------------
// Weight-sensing pedestal
// ---------------------------------------------------------------------------

export const PEDESTAL_TOLERANCE = 0.25;
export const PEDESTAL_GRACE = 0.35;

/** Is `replacementKg` close enough to `expectedKg` to fool the pedestal? */
export function swapIsSafe(expectedKg: number, replacementKg: number, tolerance = PEDESTAL_TOLERANCE): boolean {
  return Math.abs(replacementKg - expectedKg) <= expectedKg * tolerance + 1e-9;
}

/**
 * A pedestal that expects a certain weight. If the weight on it stays outside
 * tolerance for longer than the grace period, it fires once.
 */
export class PedestalSensor {
  fired = false;
  armed = true;
  private current: number;
  private offTime = 0;

  constructor(
    public readonly expectedKg: number,
    public readonly tolerance = PEDESTAL_TOLERANCE,
    public readonly grace = PEDESTAL_GRACE,
  ) {
    this.current = expectedKg;
  }

  get weight(): number {
    return this.current;
  }

  get balanced(): boolean {
    return swapIsSafe(this.expectedKg, this.current, this.tolerance);
  }

  /** Report the total kilograms now resting on the pedestal. */
  setWeight(kg: number): void {
    this.current = Math.max(0, kg);
    if (this.balanced) this.offTime = 0;
  }

  /** Permanently disable (used once a trap has already gone off elsewhere). */
  disarm(): void {
    this.armed = false;
  }

  /** Returns true exactly once, on the step the trap fires. */
  update(dt: number): boolean {
    if (!this.armed || this.fired) return false;
    if (this.balanced) {
      this.offTime = 0;
      return false;
    }
    this.offTime += dt;
    if (this.offTime >= this.grace) {
      this.fired = true;
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pressure plate
// ---------------------------------------------------------------------------

export type PlateEvent = 'pressed' | 'released' | null;

/**
 * A plate that goes down when enough mass rests on it. `latch` plates stay
 * down forever once pressed; others pop back up after `releaseDelay`.
 */
export class PressurePlate {
  pressed = false;
  private lightTime = 0;

  constructor(
    public readonly thresholdKg: number,
    public readonly latch = false,
    public readonly releaseDelay = 0.25,
  ) {}

  update(massOnPlateKg: number, dt: number): PlateEvent {
    const heavy = massOnPlateKg >= this.thresholdKg;
    if (heavy) {
      this.lightTime = 0;
      if (!this.pressed) {
        this.pressed = true;
        return 'pressed';
      }
      return null;
    }
    if (this.pressed && !this.latch) {
      this.lightTime += dt;
      if (this.lightTime >= this.releaseDelay) {
        this.pressed = false;
        this.lightTime = 0;
        return 'released';
      }
    }
    return null;
  }
}

/** A door wired to several plates opens only while all of them are down. */
export function allPressed(plates: readonly { pressed: boolean }[]): boolean {
  return plates.length > 0 && plates.every((p) => p.pressed);
}

// ---------------------------------------------------------------------------
// Crack timer: bridge planks and crumbling floor tiles
// ---------------------------------------------------------------------------

export type CrackState = 'intact' | 'cracking' | 'broken';
export type CrackEvent = 'cracked' | 'broke' | null;

/**
 * Once loaded, the piece starts cracking and breaks after `delay` seconds
 * whether or not the load stays on. That is the "you cannot stop here" rule.
 */
export class CrackTimer {
  state: CrackState = 'intact';
  private t = 0;

  constructor(
    public readonly delay: number,
    /** Loads lighter than this never start the crack (a thrown pebble will not). */
    public readonly minLoadKg = 30,
  ) {}

  /** 0..1 how close to breaking. */
  get progress(): number {
    if (this.state === 'intact') return 0;
    if (this.state === 'broken') return 1;
    return clamp01(this.t / this.delay);
  }

  /** Force the piece into the broken state (restoring a saved scene). */
  forceBroken(): void {
    this.state = 'broken';
    this.t = this.delay;
  }

  update(loadKg: number, dt: number): CrackEvent {
    if (this.state === 'broken') return null;
    if (this.state === 'intact') {
      if (loadKg >= this.minLoadKg) {
        this.state = 'cracking';
        this.t = 0;
        return 'cracked';
      }
      return null;
    }
    this.t += dt;
    if (this.t >= this.delay) {
      this.state = 'broken';
      return 'broke';
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dart volleys
// ---------------------------------------------------------------------------

/**
 * A dart launcher bank. `trigger()` queues `volleys` volleys spaced by
 * `interval`; it will not re-trigger until `cooldown` has passed.
 */
export class DartTrigger {
  private queued = 0;
  private untilNext = 0;
  private cool = 0;
  totalFired = 0;

  constructor(
    public readonly volleys = 3,
    public readonly interval = 0.35,
    public readonly cooldown = 2.5,
    /** Delay between the click and the first volley: a beat to react. */
    public readonly windup = 0.25,
  ) {}

  get busy(): boolean {
    return this.queued > 0 || this.cool > 0;
  }

  /** Returns true if the trap accepted the trigger. */
  trigger(): boolean {
    if (this.busy) return false;
    this.queued = this.volleys;
    this.untilNext = this.windup;
    this.cool = this.cooldown + this.windup + this.interval * (this.volleys - 1);
    return true;
  }

  /** Returns how many volleys to launch this step. */
  update(dt: number): number {
    if (this.cool > 0) this.cool = Math.max(0, this.cool - dt);
    let launched = 0;
    if (this.queued > 0) {
      this.untilNext -= dt;
      while (this.queued > 0 && this.untilNext <= 0) {
        launched++;
        this.queued--;
        this.totalFired++;
        this.untilNext += this.interval;
      }
    }
    return launched;
  }
}

// ---------------------------------------------------------------------------
// Noise meter: the unstable sanctum ceiling
// ---------------------------------------------------------------------------

/**
 * Loud things fill the meter, silence drains it. Each time it crosses the
 * threshold a chunk of ceiling comes down and the meter drops back.
 * In `collapsing` mode (the idol was lifted bare) debris falls on a timer
 * that keeps speeding up, regardless of noise.
 */
export class NoiseMeter {
  level = 0;
  collapsing = false;
  private collapseT = 0;
  private untilDrop = 0;
  drops = 0;

  constructor(
    public readonly threshold = 1,
    public readonly decayPerSec = 0.22,
    public readonly dropRelief = 0.55,
  ) {}

  /** 0..1 for the HUD / dust effects. */
  get strain(): number {
    return this.collapsing ? 1 : clamp01(this.level / this.threshold);
  }

  /** Seconds since the collapse began (0 if it has not). */
  get collapseTime(): number {
    return this.collapsing ? this.collapseT : 0;
  }

  add(loudness: number): void {
    if (loudness > 0) this.level += loudness;
  }

  startCollapse(): void {
    if (this.collapsing) return;
    this.collapsing = true;
    this.collapseT = 0;
    this.untilDrop = 0.6;
  }

  /** Interval between debris drops t seconds into a collapse: 0.9 s shrinking to 0.18 s. */
  static collapseInterval(t: number): number {
    return Math.max(0.18, 0.9 - t * 0.035);
  }

  /** Returns how many debris chunks to drop this step. */
  update(dt: number): number {
    let n = 0;
    if (this.collapsing) {
      this.collapseT += dt;
      this.untilDrop -= dt;
      while (this.untilDrop <= 0) {
        n++;
        this.untilDrop += NoiseMeter.collapseInterval(this.collapseT);
      }
    } else {
      while (this.level >= this.threshold) {
        n++;
        this.level -= this.threshold * this.dropRelief;
      }
      this.level = Math.max(0, this.level - this.decayPerSec * dt);
    }
    this.drops += n;
    return n;
  }
}

// ---------------------------------------------------------------------------
// Swinging blade timing (used for telegraphs and tests; the blade itself is a
// physical pendulum that is kept on this schedule)
// ---------------------------------------------------------------------------

/** Pendulum angle (radians from vertical) at time t. */
export function bladeAngle(t: number, amplitude: number, period: number, phase = 0): number {
  return amplitude * Math.cos((2 * Math.PI * t) / period + phase);
}

/** Angular velocity of the same pendulum. */
export function bladeAngularVelocity(t: number, amplitude: number, period: number, phase = 0): number {
  const w = (2 * Math.PI) / period;
  return -amplitude * w * Math.sin(w * t + phase);
}

/** The blade crosses the walkway while within this angle of vertical. */
export function bladeInLane(angle: number, laneHalfAngle = 0.32): boolean {
  return Math.abs(angle) <= laneHalfAngle;
}

// ---------------------------------------------------------------------------
// One-shot release (boulder chock, gate slam)
// ---------------------------------------------------------------------------

export class OneShot {
  fired = false;
  private t = 0;
  private pending = false;

  constructor(public readonly delay = 0) {}

  trigger(): boolean {
    if (this.fired || this.pending) return false;
    this.pending = true;
    this.t = 0;
    return true;
  }

  /** Returns true on the step it goes off. */
  update(dt: number): boolean {
    if (!this.pending || this.fired) return false;
    this.t += dt;
    if (this.t >= this.delay) {
      this.fired = true;
      this.pending = false;
      return true;
    }
    return false;
  }
}
