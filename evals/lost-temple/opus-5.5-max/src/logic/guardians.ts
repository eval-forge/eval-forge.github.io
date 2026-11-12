/**
 * Guardian brains: one state machine per guardian type. The game layer gathers perception
 * (line of sight, light, noises) and moves the body along navmesh paths; the brain decides
 * state, target and speed. Pure logic, unit tested.
 */

export type V3 = [number, number, number];
export type GuardianKind = 'sentinel' | 'crawler' | 'shadow';
export type GuardianState =
  | 'dormant'
  | 'waking'
  | 'sweep'
  | 'investigate'
  | 'chase'
  | 'search'
  | 'roam'
  | 'hunt'
  | 'lurk'
  | 'stalk'
  | 'strike'
  | 'flee';

export interface HeardNoise {
  x: number;
  y: number;
  z: number;
  loudness: number;
  dist: number;
  byPlayer: boolean;
}

export interface SeenLight {
  id: string;
  x: number;
  y: number;
  z: number;
  dist: number;
}

export interface Perception {
  dt: number;
  awake: boolean;
  pos: V3;
  player: V3;
  playerDist: number;
  /** Clear line of sight from the guardian's eyes to the player. */
  playerLOS: boolean;
  /** Angle between the guardian's facing and the direction to the player (radians). */
  playerAngle: number;
  /** Radius of the player's own light (0 when the torch is out). */
  playerLightRadius: number;
  /** Player is standing in some other light (a sconce, or sun/moon outdoors). */
  playerInLight: boolean;
  noises: HeardNoise[];
  /** How lit the guardian's own position is (0..1). */
  lightAtSelf: number;
  litSconces: SeenLight[];
  /** Where to head when there is nothing to chase (toward the great door). */
  sweepTarget: V3;
  rand: () => number;
}

export type Cue = 'wake' | 'alert' | 'lost' | 'strike' | 'flee' | null;

export interface Decision {
  state: GuardianState;
  target: V3 | null;
  speed: number;
  catchPlayer: boolean;
  avoidLight: boolean;
  smashSconce: string | null;
  cue: Cue;
}

export const GUARDIAN_STATS = {
  sentinel: {
    sweep: 1.7,
    investigate: 2.2,
    chase: 2.9,
    catchRadius: 1.4,
    wakeTime: 2.5,
    fov: (120 * Math.PI) / 180,
    darkSight: 4,
    baseSight: 9,
    lightSightMul: 2.2,
    maxSight: 35,
    hearAcuity: 12,
    hearMinLoudness: 0.75,
    loseTime: 4,
    searchTime: 6,
    sconceRange: 25,
  },
  crawler: {
    roam: 2.4,
    rush: 6.3,
    sniff: 1.4,
    catchRadius: 1.1,
    feelRadius: 1.8,
    wakeTime: 1.0,
    hearAcuity: 28,
    memory: 3.5,
    searchTime: 4,
  },
  shadow: {
    lurk: 3.0,
    stalk: 3.6,
    strike: 7.2,
    catchRadius: 1.0,
    senseRange: 40,
    stalkRange: 18,
    giveUpRange: 28,
    strikeBelow: 3.5,
    keepAwayPad: 1.5,
    fleeTime: 3,
    fleeLight: 0.35,
  },
};

function dist2(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function out(state: GuardianState, target: V3 | null, speed: number, extra: Partial<Decision> = {}): Decision {
  return { state, target, speed, catchPlayer: false, avoidLight: false, smashSconce: null, cue: null, ...extra };
}

export interface Brain {
  kind: GuardianKind;
  state: GuardianState;
  update(p: Perception): Decision;
}

/** Stone Sentinel: slow, relentless, sees light from far away, only hears loud noises. */
export class SentinelBrain implements Brain {
  kind: GuardianKind = 'sentinel';
  state: GuardianState = 'dormant';
  timer = 0;
  lastKnown: V3 | null = null;
  invTarget: V3 | null = null;
  invSconce: string | null = null;
  private wanderT = 0;
  private wanderTarget: V3 | null = null;
  readonly s = GUARDIAN_STATS.sentinel;

  sightRange(p: Perception): number {
    const lit = p.playerLightRadius > 0 || p.playerInLight;
    if (!lit) return this.s.darkSight;
    const light = p.playerLightRadius + (p.playerInLight ? 6 : 0);
    return Math.min(this.s.maxSight, this.s.baseSight + this.s.lightSightMul * light);
  }

  canSee(p: Perception): boolean {
    if (!p.playerLOS) return false;
    if (p.playerDist <= 2.5) return true;
    if (p.playerDist > this.sightRange(p)) return false;
    return Math.abs(p.playerAngle) <= this.s.fov / 2;
  }

  update(p: Perception): Decision {
    const s = this.s;
    let cue: Cue = null;
    if (this.state === 'dormant') {
      if (!p.awake) return out('dormant', null, 0);
      this.state = 'waking';
      this.timer = s.wakeTime;
      return out('waking', null, 0, { cue: 'wake' });
    }
    if (this.state === 'waking') {
      this.timer -= p.dt;
      if (this.timer > 0) return out('waking', null, 0);
      this.state = 'sweep';
    }
    const sees = this.canSee(p);
    if (sees) {
      this.lastKnown = [...p.player] as V3;
      this.timer = 0;
      if (this.state !== 'chase') {
        this.state = 'chase';
        cue = 'alert';
      }
    }
    let smash: string | null = null;
    switch (this.state) {
      case 'chase': {
        if (!sees) {
          this.timer += p.dt;
          if (this.timer >= s.loseTime) {
            this.state = 'search';
            this.timer = s.searchTime;
            cue = 'lost';
          }
        }
        if (this.state === 'chase') {
          const d = out('chase', this.lastKnown, s.chase, { cue });
          d.catchPlayer = p.playerDist <= s.catchRadius;
          return d;
        }
        break;
      }
      case 'sweep': {
        const loud = p.noises.filter((n) => n.loudness >= s.hearMinLoudness && n.dist <= n.loudness * s.hearAcuity).sort((a, b) => b.loudness - a.loudness)[0];
        if (loud) {
          this.state = 'investigate';
          this.invTarget = [loud.x, loud.y, loud.z];
          this.invSconce = null;
          this.timer = 10;
        } else {
          const sconce = p.litSconces.filter((l) => l.dist <= s.sconceRange).sort((a, b) => a.dist - b.dist)[0];
          if (sconce) {
            this.state = 'investigate';
            this.invTarget = [sconce.x, sconce.y, sconce.z];
            this.invSconce = sconce.id;
            this.timer = 15;
          }
        }
        break;
      }
      default:
        break;
    }
    if (this.state === 'investigate') {
      this.timer -= p.dt;
      const t = this.invTarget!;
      const reach = this.invSconce ? 1.9 : 1.5;
      if (dist2(p.pos, t) <= reach || this.timer <= 0) {
        if (this.invSconce && dist2(p.pos, t) <= reach) smash = this.invSconce;
        this.lastKnown = t;
        this.invSconce = null;
        this.state = 'search';
        this.timer = smash ? 2 : 4;
      } else {
        const d = out('investigate', t, s.investigate, { cue });
        d.catchPlayer = p.playerDist <= s.catchRadius;
        return d;
      }
    }
    if (this.state === 'search') {
      this.timer -= p.dt;
      if (this.timer <= 0) {
        this.state = 'sweep';
        this.wanderTarget = null;
      } else {
        this.wanderT -= p.dt;
        if (!this.wanderTarget || this.wanderT <= 0) {
          const c = this.lastKnown ?? p.pos;
          const a = p.rand() * Math.PI * 2;
          this.wanderTarget = [c[0] + Math.cos(a) * 3, c[1], c[2] + Math.sin(a) * 3];
          this.wanderT = 2;
        }
        const d = out('search', this.wanderTarget, s.sweep, { cue, smashSconce: smash });
        d.catchPlayer = p.playerDist <= s.catchRadius;
        return d;
      }
    }
    const d = out('sweep', p.sweepTarget, s.sweep, { cue, smashSconce: smash });
    d.catchPlayer = p.playerDist <= s.catchRadius;
    return d;
  }
}

/** Crawler: blind, very fast, hunts by sound. Silent players can slip past it. */
export class CrawlerBrain implements Brain {
  kind: GuardianKind = 'crawler';
  state: GuardianState = 'dormant';
  timer = 0;
  memory = 0;
  noiseTarget: V3 | null = null;
  private wanderTarget: V3 | null = null;
  private wanderT = 0;
  readonly s = GUARDIAN_STATS.crawler;

  /** Loudest audible noise, scored by how far inside its hearing range it is. */
  pickNoise(p: Perception): HeardNoise | null {
    let best: HeardNoise | null = null;
    let bestScore = 0;
    for (const n of p.noises) {
      const range = n.loudness * this.s.hearAcuity;
      if (n.dist > range) continue;
      const score = 1 - n.dist / range + n.loudness * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  update(p: Perception): Decision {
    const s = this.s;
    let cue: Cue = null;
    if (this.state === 'dormant') {
      if (!p.awake) return out('dormant', null, 0);
      this.state = 'waking';
      this.timer = s.wakeTime;
      return out('waking', null, 0, { cue: 'wake' });
    }
    if (this.state === 'waking') {
      this.timer -= p.dt;
      if (this.timer > 0) return out('waking', null, 0);
      this.state = 'roam';
    }
    const heard = this.pickNoise(p);
    if (heard) {
      this.noiseTarget = [heard.x, heard.y, heard.z];
      this.memory = s.memory;
      const next: GuardianState = heard.byPlayer ? 'hunt' : 'investigate';
      if (this.state !== 'hunt' && this.state !== 'investigate') cue = 'alert';
      if (this.state !== 'hunt' || next === 'hunt') this.state = next;
    }
    // Touch: something moving right next to it.
    const touching = p.playerDist <= s.catchRadius || (p.playerDist <= s.feelRadius && p.noises.some((n) => n.byPlayer && n.dist <= s.feelRadius + 0.5));
    if (this.state === 'hunt' || this.state === 'investigate') {
      this.memory -= p.dt;
      const t = this.noiseTarget!;
      if (dist2(p.pos, t) <= 1.2 || this.memory <= -2) {
        this.state = 'search';
        this.timer = s.searchTime;
        this.wanderTarget = null;
      } else {
        return out(this.state, t, s.rush, { cue, catchPlayer: touching });
      }
    }
    if (this.state === 'search') {
      this.timer -= p.dt;
      if (this.timer <= 0) {
        this.state = 'roam';
      } else {
        this.wanderT -= p.dt;
        if (!this.wanderTarget || this.wanderT <= 0) {
          const c = this.noiseTarget ?? p.pos;
          const a = p.rand() * Math.PI * 2;
          this.wanderTarget = [c[0] + Math.cos(a) * 2.5, c[1], c[2] + Math.sin(a) * 2.5];
          this.wanderT = 1.3;
        }
        return out('search', this.wanderTarget, s.sniff, { cue, catchPlayer: touching });
      }
    }
    return out('roam', p.sweepTarget, s.roam, { cue, catchPlayer: touching });
  }
}

/** Shadow: avoids light, circles at the edge of your torch, strikes when it gutters. */
export class ShadowBrain implements Brain {
  kind: GuardianKind = 'shadow';
  state: GuardianState = 'dormant';
  timer = 0;
  orbit = 0;
  readonly s = GUARDIAN_STATS.shadow;

  keepAway(p: Perception): number {
    return Math.max(3, p.playerLightRadius + this.s.keepAwayPad);
  }

  update(p: Perception): Decision {
    const s = this.s;
    let cue: Cue = null;
    if (this.state === 'dormant') {
      if (!p.awake) return out('dormant', null, 0);
      this.state = 'lurk';
      cue = 'wake';
      this.orbit = p.rand() * Math.PI * 2;
    }
    const exposed = p.playerLightRadius >= s.strikeBelow || p.playerInLight;
    if (this.state !== 'flee' && p.lightAtSelf >= s.fleeLight) {
      this.state = 'flee';
      this.timer = s.fleeTime;
      cue = 'flee';
    }
    if (this.state === 'flee') {
      this.timer -= p.dt;
      if (this.timer <= 0 && p.lightAtSelf < s.fleeLight) {
        this.state = 'lurk';
      } else {
        const dx = p.pos[0] - p.player[0];
        const dz = p.pos[2] - p.player[2];
        const l = Math.hypot(dx, dz) || 1;
        const t: V3 = [p.pos[0] + (dx / l) * 10, p.pos[1], p.pos[2] + (dz / l) * 10];
        return out('flee', t, s.strike, { cue, avoidLight: true });
      }
    }
    if (this.state === 'strike') {
      if (exposed) {
        this.state = 'flee';
        this.timer = s.fleeTime;
        const dx = p.pos[0] - p.player[0];
        const dz = p.pos[2] - p.player[2];
        const l = Math.hypot(dx, dz) || 1;
        return out('flee', [p.pos[0] + (dx / l) * 10, p.pos[1], p.pos[2] + (dz / l) * 10], s.strike, { cue: 'flee', avoidLight: true });
      }
      return out('strike', [...p.player] as V3, s.strike, { cue, catchPlayer: p.playerDist <= s.catchRadius });
    }
    if (this.state === 'stalk') {
      if (p.playerDist > s.giveUpRange) this.state = 'lurk';
      else if (!exposed) {
        this.state = 'strike';
        return out('strike', [...p.player] as V3, s.strike, { cue: 'strike', catchPlayer: p.playerDist <= s.catchRadius });
      } else {
        this.orbit += p.dt * 0.35;
        const r = this.keepAway(p);
        const t: V3 = [p.player[0] + Math.cos(this.orbit) * r, p.player[1], p.player[2] + Math.sin(this.orbit) * r];
        return out('stalk', t, s.stalk, { cue, avoidLight: true });
      }
    }
    // lurk
    if (p.playerDist <= s.stalkRange) {
      this.state = 'stalk';
      if (!exposed) {
        this.state = 'strike';
        return out('strike', [...p.player] as V3, s.strike, { cue: 'strike', catchPlayer: p.playerDist <= s.catchRadius });
      }
      const r = this.keepAway(p);
      this.orbit = Math.atan2(p.pos[2] - p.player[2], p.pos[0] - p.player[0]);
      return out('stalk', [p.player[0] + Math.cos(this.orbit) * r, p.player[1], p.player[2] + Math.sin(this.orbit) * r], s.stalk, { cue, avoidLight: true });
    }
    const target = p.playerDist <= s.senseRange ? ([...p.player] as V3) : p.sweepTarget;
    return out('lurk', target, s.lurk, { cue, avoidLight: true });
  }
}

export function createBrain(kind: GuardianKind): Brain {
  switch (kind) {
    case 'sentinel':
      return new SentinelBrain();
    case 'crawler':
      return new CrawlerBrain();
    case 'shadow':
      return new ShadowBrain();
  }
}

/** Spawn schedule after darkness, deepest first. Seconds after darkness. */
export interface SpawnEntry {
  kind: GuardianKind;
  at: number;
  spawn: string; // spawn point id in the level
}

export const SPAWN_SCHEDULE: SpawnEntry[] = [
  { kind: 'sentinel', at: 0, spawn: 'lair1' },
  { kind: 'crawler', at: 0, spawn: 'lair2' },
  { kind: 'shadow', at: 0, spawn: 'lair3' },
  { kind: 'sentinel', at: 8, spawn: 'vaultStatue' },
  { kind: 'crawler', at: 18, spawn: 'catacombs1' },
  { kind: 'shadow', at: 18, spawn: 'catacombs2' },
  { kind: 'sentinel', at: 30, spawn: 'sanctum1' },
  { kind: 'crawler', at: 45, spawn: 'halls1' },
];

/** Heartbeat rate (beats per minute) and volume from the nearest awake guardian distance. */
export function heartbeat(nearestDist: number): { bpm: number; volume: number } {
  if (!Number.isFinite(nearestDist) || nearestDist > 18) return { bpm: 0, volume: 0 };
  const t = 1 - Math.max(0, nearestDist - 2) / 16;
  return { bpm: 70 + 80 * t, volume: 0.25 + 0.75 * t };
}
