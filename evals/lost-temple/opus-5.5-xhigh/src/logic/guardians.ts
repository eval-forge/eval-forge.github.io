/**
 * Guardian brains: one state machine per guardian kind. They read a `Percept` that the
 * entity layer fills in (line of sight, light levels, noises) and return an `Intent`
 * (where to go, how fast, whether to attack). Movement along the navmesh happens
 * elsewhere. Pure and deterministic given the RNG.
 */
import { Rng } from '../core/rng';
import type { Vec3 } from './navmesh';

export type GuardianKind = 'sentinel' | 'crawler' | 'shade';
export type GState =
  | 'dormant'
  | 'waking'
  | 'sweep'
  | 'guard'
  | 'investigate'
  | 'chase'
  | 'search'
  | 'stalk'
  | 'lunge'
  | 'retreat';

export interface NoiseEvent {
  x: number;
  y: number;
  z: number;
  /** 0..1. A sprint footstep ≈ 0.35, a landing ≈ 0.5, a thrown urn shattering ≈ 0.8. */
  loudness: number;
}

export interface Percept {
  dt: number;
  self: Vec3;
  /** Unit facing vector in xz. */
  facing: { x: number; z: number };
  player: Vec3;
  /** Clear line of sight from the guardian's eyes to the player's chest. */
  los: boolean;
  playerTorchLit: boolean;
  /** 0..1: how lit the player's position is by any source (torch, sconces, sun). */
  playerLight: number;
  /** 0..1: light level at the guardian. */
  lightAtSelf: number;
  noises: NoiseEvent[];
  /** Reached the current move target (or within a metre of it). */
  arrived: boolean;
}

export type Call = 'roar' | 'screech' | 'whisper' | 'grind' | null;

export interface Intent {
  state: GState;
  moveTo: Vec3 | null;
  speed: number;
  attack: boolean;
  /** Movement layer must not step into light above this level (shades). */
  avoidLight: boolean;
  call: Call;
}

export interface GuardianTuning {
  sweepSpeed: number;
  chaseSpeed: number;
  catchRadius: number;
}

export const TUNING: Record<GuardianKind, GuardianTuning & Record<string, number>> = {
  sentinel: {
    sweepSpeed: 2.4,
    chaseSpeed: 3.6,
    catchRadius: 1.6,
    sightRange: 30,
    torchSightRange: 40,
    coneHalfAngle: (55 * Math.PI) / 180,
    darkSightRange: 6,
    loseTime: 2.0,
    searchTime: 5,
    wakeTime: 2.5,
  },
  crawler: {
    sweepSpeed: 3.5,
    chaseSpeed: 6.6,
    catchRadius: 1.3,
    hearRange: 34,
    chaseHearRange: 12,
    touchRange: 2.2,
    loseTime: 3.0,
    searchTime: 3,
    wakeTime: 1.5,
  },
  shade: {
    sweepSpeed: 3.2,
    chaseSpeed: 4.8,
    lungeSpeed: 6.8,
    catchRadius: 1.4,
    senseRange: 25,
    lungeRange: 11,
    darkThreshold: 0.25,
    retreatTime: 2.0,
    wakeTime: 1.0,
  },
};

export const DEFAULT_TUNING = TUNING;

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export abstract class Brain {
  state: GState = 'dormant';
  protected t = 0; // time in current state
  protected wakeDelay = 0;
  protected target: Vec3 | null = null;
  readonly tune: GuardianTuning & Record<string, number>;

  constructor(public kind: GuardianKind, public sweepTarget: Vec3, protected rng: Rng) {
    this.tune = TUNING[kind];
  }

  /** Begin waking after `delay` seconds. */
  wake(delay = 0) {
    if (this.state !== 'dormant') return;
    this.state = 'waking';
    this.t = 0;
    this.wakeDelay = delay;
  }

  protected go(s: GState) {
    this.state = s;
    this.t = 0;
  }

  protected idle(): Intent {
    return { state: this.state, moveTo: null, speed: 0, attack: false, avoidLight: false, call: null };
  }

  /** Random guard point near the sweep target. */
  protected guardPoint(): Vec3 {
    const a = this.rng.range(0, Math.PI * 2);
    const r = this.rng.range(2, 7);
    return { x: this.sweepTarget.x + Math.cos(a) * r, y: this.sweepTarget.y, z: this.sweepTarget.z + Math.sin(a) * r };
  }

  /** Common handling of dormant / waking. Returns an intent if still asleep. */
  protected sleepStep(p: Percept): Intent | null {
    if (this.state === 'dormant') return this.idle();
    if (this.state === 'waking') {
      this.t += p.dt;
      if (this.t >= this.wakeDelay + this.tune.wakeTime) {
        this.go('sweep');
        return { ...this.idle(), state: 'sweep', call: 'grind' };
      }
      return this.idle();
    }
    return null;
  }

  abstract update(p: Percept): Intent;
}

// ---------------------------------------------------------------- Stone Sentinel

/** Slow, relentless, hunts by sight and is drawn to torchlight. */
export class SentinelBrain extends Brain {
  lastSeen: Vec3 | null = null;
  private unseen = 0;

  constructor(sweepTarget: Vec3, rng: Rng) {
    super('sentinel', sweepTarget, rng);
  }

  canSee(p: Percept): boolean {
    if (!p.los) return false;
    const T = this.tune;
    const d = dist(p.self, p.player);
    if (d < 3.5) return true;
    if (p.playerTorchLit && d < T.torchSightRange) return true;
    const dx = p.player.x - p.self.x;
    const dz = p.player.z - p.self.z;
    const len = Math.hypot(dx, dz) || 1;
    const cos = (dx * p.facing.x + dz * p.facing.z) / len;
    const inCone = cos >= Math.cos(T.coneHalfAngle);
    if (inCone && p.playerLight > 0.35 && d < T.sightRange) return true;
    if (inCone && d < T.darkSightRange) return true;
    return false;
  }

  update(p: Percept): Intent {
    const asleep = this.sleepStep(p);
    if (asleep) return asleep;
    const T = this.tune;
    this.t += p.dt;
    const sees = this.canSee(p);
    const d = dist(p.self, p.player);
    let call: Call = null;

    if (sees) {
      this.lastSeen = { ...p.player };
      this.unseen = 0;
      if (this.state !== 'chase') {
        this.go('chase');
        call = 'roar';
      }
    }

    switch (this.state) {
      case 'sweep': {
        if (p.arrived) this.go('guard');
        return { state: this.state, moveTo: this.sweepTarget, speed: T.sweepSpeed, attack: false, avoidLight: false, call };
      }
      case 'guard': {
        if (!this.target || p.arrived || this.t > 8) {
          this.target = this.guardPoint();
          this.t = 0;
        }
        return { state: 'guard', moveTo: this.target, speed: T.sweepSpeed * 0.7, attack: false, avoidLight: false, call };
      }
      case 'chase': {
        if (!sees) {
          this.unseen += p.dt;
          if (this.unseen > T.loseTime) {
            this.go('search');
            this.target = this.lastSeen;
          }
        }
        const attack = d <= T.catchRadius && p.los;
        return { state: this.state, moveTo: this.lastSeen ?? p.player, speed: T.chaseSpeed, attack, avoidLight: false, call };
      }
      case 'search': {
        if (p.arrived) {
          // look around near the last known position
          if (this.t > T.searchTime) {
            this.go('sweep');
            this.target = null;
          } else if (this.lastSeen) {
            const a = this.rng.range(0, Math.PI * 2);
            this.target = { x: this.lastSeen.x + Math.cos(a) * 3, y: this.lastSeen.y, z: this.lastSeen.z + Math.sin(a) * 3 };
          }
        }
        const attack = d <= T.catchRadius && p.los;
        return { state: this.state, moveTo: this.target, speed: T.sweepSpeed, attack, avoidLight: false, call };
      }
      default:
        this.go('sweep');
        return { state: 'sweep', moveTo: this.sweepTarget, speed: T.sweepSpeed, attack: false, avoidLight: false, call };
    }
  }
}

// ---------------------------------------------------------------- Crawler

/** Fast, blind, hunts by sound. Silence (crouch-walking) or a thrown decoy beats it. */
export class CrawlerBrain extends Brain {
  lastNoise: Vec3 | null = null;
  private quiet = 0;

  constructor(sweepTarget: Vec3, rng: Rng) {
    super('crawler', sweepTarget, rng);
  }

  /** Loudest audible noise this tick, weighted by distance. */
  hear(p: Percept): { n: NoiseEvent; d: number } | null {
    let best: { n: NoiseEvent; d: number; score: number } | null = null;
    for (const n of p.noises) {
      const d = Math.hypot(n.x - p.self.x, n.y - p.self.y, n.z - p.self.z);
      const reach = n.loudness * this.tune.hearRange;
      if (d > reach) continue;
      const score = reach - d;
      if (!best || score > best.score) best = { n, d, score };
    }
    return best ? { n: best.n, d: best.d } : null;
  }

  update(p: Percept): Intent {
    const asleep = this.sleepStep(p);
    if (asleep) return asleep;
    const T = this.tune;
    this.t += p.dt;
    const heard = this.hear(p);
    const dPlayer = dist(p.self, p.player);
    let call: Call = null;

    if (heard) {
      this.lastNoise = { x: heard.n.x, y: heard.n.y, z: heard.n.z };
      this.quiet = 0;
      const close = heard.d <= T.chaseHearRange;
      if (close && this.state !== 'chase') {
        this.go('chase');
        call = 'screech';
      } else if (!close && (this.state === 'sweep' || this.state === 'guard' || this.state === 'search')) {
        this.go('investigate');
      }
    } else {
      this.quiet += p.dt;
    }
    // it can feel you if you brush right past it
    if (dPlayer <= T.touchRange && this.state !== 'chase') {
      this.lastNoise = { ...p.player };
      this.quiet = 0;
      this.go('chase');
      call = 'screech';
    }

    switch (this.state) {
      case 'sweep':
        if (p.arrived) this.go('guard');
        return { state: this.state, moveTo: this.sweepTarget, speed: T.sweepSpeed, attack: false, avoidLight: false, call };
      case 'guard':
        if (!this.target || p.arrived || this.t > 6) {
          this.target = this.guardPoint();
          this.t = 0;
        }
        return { state: 'guard', moveTo: this.target, speed: T.sweepSpeed * 0.6, attack: false, avoidLight: false, call };
      case 'investigate':
        if (p.arrived) this.go('search');
        return { state: this.state, moveTo: this.lastNoise, speed: T.sweepSpeed * 1.25, attack: false, avoidLight: false, call };
      case 'chase': {
        if (dPlayer <= T.touchRange) {
          this.lastNoise = { ...p.player };
          this.quiet = 0;
        }
        if (this.quiet > T.loseTime) this.go('search');
        const attack = dPlayer <= T.catchRadius;
        return { state: this.state, moveTo: this.lastNoise, speed: T.chaseSpeed, attack, avoidLight: false, call };
      }
      case 'search':
        if (this.t > T.searchTime) {
          this.go('sweep');
          this.target = null;
        } else if (p.arrived && this.lastNoise) {
          const a = this.rng.range(0, Math.PI * 2);
          this.target = { x: this.lastNoise.x + Math.cos(a) * 2.5, y: this.lastNoise.y, z: this.lastNoise.z + Math.sin(a) * 2.5 };
        }
        return { state: this.state, moveTo: this.target ?? this.lastNoise, speed: T.sweepSpeed, attack: dPlayer <= T.catchRadius, avoidLight: false, call };
      default:
        this.go('sweep');
        return { state: 'sweep', moveTo: this.sweepTarget, speed: T.sweepSpeed, attack: false, avoidLight: false, call };
    }
  }
}

// ---------------------------------------------------------------- Shade

/** Avoids light. Stalks at the edge of your torchlight and lunges the moment it fails. */
export class ShadeBrain extends Brain {
  constructor(sweepTarget: Vec3, rng: Rng) {
    super('shade', sweepTarget, rng);
  }

  update(p: Percept): Intent {
    const asleep = this.sleepStep(p);
    if (asleep) return asleep;
    const T = this.tune;
    this.t += p.dt;
    const d = dist(p.self, p.player);
    const playerDark = p.playerLight < T.darkThreshold;
    let call: Call = null;

    // burned: light on the shade forces it back
    if (p.lightAtSelf > 0.5 && this.state !== 'retreat' && this.state !== 'sweep' && this.state !== 'guard') {
      this.go('retreat');
      call = 'whisper';
    }

    switch (this.state) {
      case 'sweep':
      case 'guard': {
        if (d < T.senseRange) {
          this.go('stalk');
          call = 'whisper';
          break;
        }
        if (this.state === 'sweep' && p.arrived) this.go('guard');
        if (this.state === 'guard' && (!this.target || p.arrived || this.t > 7)) {
          this.target = this.guardPoint();
          this.t = 0;
        }
        const to = this.state === 'sweep' ? this.sweepTarget : this.target;
        return { state: this.state, moveTo: to, speed: T.sweepSpeed, attack: false, avoidLight: true, call };
      }
      case 'retreat': {
        if (this.t > T.retreatTime && p.lightAtSelf < 0.3) this.go(d < T.senseRange ? 'stalk' : 'sweep');
        // move directly away from the player
        const dx = p.self.x - p.player.x;
        const dz = p.self.z - p.player.z;
        const l = Math.hypot(dx, dz) || 1;
        const to = { x: p.self.x + (dx / l) * 6, y: p.self.y, z: p.self.z + (dz / l) * 6 };
        return { state: 'retreat', moveTo: to, speed: T.chaseSpeed, attack: false, avoidLight: true, call };
      }
      default:
        break;
    }

    if (this.state === 'stalk') {
      if (d > T.senseRange * 1.3) {
        this.go('sweep');
        return { state: 'sweep', moveTo: this.sweepTarget, speed: T.sweepSpeed, attack: false, avoidLight: true, call };
      }
      if (playerDark && d < T.lungeRange) {
        this.go('lunge');
        call = 'whisper';
      } else {
        return { state: 'stalk', moveTo: { ...p.player }, speed: T.chaseSpeed, attack: false, avoidLight: true, call };
      }
    }
    if (this.state === 'lunge') {
      if (!playerDark) {
        this.go('stalk');
        return { state: 'stalk', moveTo: { ...p.player }, speed: T.chaseSpeed, attack: false, avoidLight: true, call };
      }
      return { state: 'lunge', moveTo: { ...p.player }, speed: T.lungeSpeed, attack: d <= T.catchRadius, avoidLight: true, call };
    }
    this.go('sweep');
    return { state: 'sweep', moveTo: this.sweepTarget, speed: T.sweepSpeed, attack: false, avoidLight: true, call };
  }
}

export function makeBrain(kind: GuardianKind, sweepTarget: Vec3, rng: Rng): Brain {
  switch (kind) {
    case 'sentinel':
      return new SentinelBrain(sweepTarget, rng);
    case 'crawler':
      return new CrawlerBrain(sweepTarget, rng);
    case 'shade':
      return new ShadeBrain(sweepTarget, rng);
  }
}

/** Spawn waves after darkness: deepest first, sweeping outward toward the door. */
export interface SpawnWave {
  delay: number;
  scene: 'vault' | 'catacombs' | 'sanctum' | 'halls';
  kinds: GuardianKind[];
}

export const SPAWN_WAVES: SpawnWave[] = [
  { delay: 0, scene: 'vault', kinds: ['sentinel', 'crawler', 'shade'] },
  { delay: 15, scene: 'catacombs', kinds: ['crawler', 'shade'] },
  { delay: 30, scene: 'sanctum', kinds: ['sentinel'] },
  { delay: 45, scene: 'halls', kinds: ['shade'] },
];

/**
 * Waves due between two times measured from darkness (negative before dark), using the
 * half-open interval (prev, now] so each wave fires exactly once.
 */
export function wavesDue(prevAfterDark: number, nowAfterDark: number): SpawnWave[] {
  return SPAWN_WAVES.filter((w) => w.delay > prevAfterDark && w.delay <= nowAfterDark);
}
