/**
 * Guardian brains as pure state machines.
 *
 * The game gathers a `Percepts` snapshot for a guardian (what it can see and
 * hear right now), calls `think()`, and executes the returned `Decision`
 * (where to path to, how fast, whether the player is caught).
 * No three, no rapier, no navmesh here. Unit-tested in tests/guardians.test.ts.
 */
import type { Vec3Like } from './scenes';

export type GuardianType = 'sentinel' | 'crawler' | 'shade';

export type GuardianState =
  | 'dormant' // a statue
  | 'waking' // shaking itself loose
  | 'sweep' // no target: advancing along waypoints toward the great door
  | 'investigate' // going to look at a noise
  | 'chase' // has the player
  | 'search' // lost the player, checking the last known position
  | 'repelled'; // shade only: held at the edge of a light

export interface GuardianSpec {
  type: GuardianType;
  name: string;
  wakeTime: number;
  sweepSpeed: number;
  investigateSpeed: number;
  chaseSpeed: number;
  /** Distance at which contact ends the run. */
  catchRadius: number;
  /** Sight range when the player is lit / unlit. 0 = blind. */
  sightLit: number;
  sightDark: number;
  /** Half-angle of the view cone, radians. PI = sees all round. */
  fovHalf: number;
  /** A lit torch is spotted from this far regardless of facing (needs line of sight). */
  beaconRange: number;
  /** Multiplier on noise radius. 0 = deaf. */
  hearing: number;
  /** Noise this quiet is ignored. */
  hearThreshold: number;
  /** Always notices the player inside this distance. */
  proximity: number;
  /** Seconds without a detection before giving up a chase. */
  loseTime: number;
  /** Seconds spent looking around at a search / investigation point. */
  lingerTime: number;
  /** Shade: refuses to enter light. */
  fearsLight: boolean;
}

export const GUARDIAN_SPECS: Record<GuardianType, GuardianSpec> = {
  sentinel: {
    type: 'sentinel', name: 'Stone Sentinel', wakeTime: 3.0,
    sweepSpeed: 1.9, investigateSpeed: 2.2, chaseSpeed: 2.7,
    catchRadius: 1.35, sightLit: 22, sightDark: 7, fovHalf: (55 * Math.PI) / 180,
    beaconRange: 40, hearing: 0.45, hearThreshold: 0.35, proximity: 2.6,
    loseTime: 2.5, lingerTime: 4, fearsLight: false,
  },
  crawler: {
    type: 'crawler', name: 'Crawler', wakeTime: 1.5,
    sweepSpeed: 3.2, investigateSpeed: 4.2, chaseSpeed: 6.0,
    catchRadius: 1.25, sightLit: 0, sightDark: 0, fovHalf: 0,
    beaconRange: 0, hearing: 1.25, hearThreshold: 0.02, proximity: 1.6,
    loseTime: 0, lingerTime: 3, fearsLight: false,
  },
  shade: {
    type: 'shade', name: 'Shade', wakeTime: 2.0,
    sweepSpeed: 3.0, investigateSpeed: 3.4, chaseSpeed: 4.4,
    catchRadius: 1.3, sightLit: 30, sightDark: 30, fovHalf: Math.PI,
    beaconRange: 0, hearing: 0.3, hearThreshold: 0.5, proximity: 4,
    loseTime: 3, lingerTime: 3, fearsLight: true,
  },
};

export interface Percepts {
  dt: number;
  selfPos: Vec3Like;
  playerPos: Vec3Like;
  /** Straight-line distance to the player. */
  dist: number;
  /** Nothing solid between guardian and player. */
  lineOfSight: boolean;
  /** Angle between the guardian's facing and the player, radians (0 = dead ahead). */
  angleToPlayer: number;
  /** The player is carrying a lit torch or standing in sconce light. */
  playerLit: boolean;
  /** Radius of light the shade will not enter around the player (0 if none). */
  playerSafeRadius: number;
  /** The guardian itself is standing in light a shade cannot bear (sconce / torch). */
  selfInLight: boolean;
  /** Loudest noise heard this think step (already scaled by this guardian's hearing). */
  heard: { pos: Vec3Like; loudness: number } | null;
  /** The nav agent has reached the point given by the last decision. */
  arrived: boolean;
  /** The player is alive and inside the temple. */
  playerPresent: boolean;
}

export type MoveGoal =
  | { kind: 'none' }
  | { kind: 'sweep' } // follow the sweep route toward the door
  | { kind: 'point'; pos: Vec3Like } // path to a position
  | { kind: 'holdEdge'; around: Vec3Like; radius: number } // shade: hover on a circle around the light
  | { kind: 'fleeLight' }; // shade: get out of the light it is standing in

export type GuardianCall = 'wake' | 'alert' | 'lost' | 'hiss' | null;

export interface Decision {
  state: GuardianState;
  move: MoveGoal;
  speed: number;
  caught: boolean;
  call: GuardianCall;
}

export interface Brain {
  spec: GuardianSpec;
  state: GuardianState;
  /** Seconds in the current state. */
  stateTime: number;
  /** Seconds since the player was last detected (chase). */
  lostTime: number;
  lastKnown: Vec3Like | null;
  noiseTarget: Vec3Like | null;
  /** Time spent lingering at an arrival point. */
  linger: number;
}

export function createBrain(type: GuardianType): Brain {
  return {
    spec: GUARDIAN_SPECS[type],
    state: 'dormant',
    stateTime: 0,
    lostTime: 0,
    lastKnown: null,
    noiseTarget: null,
    linger: 0,
  };
}

/** Begin waking a dormant guardian. Returns false if it was already awake. */
export function wake(brain: Brain): boolean {
  if (brain.state !== 'dormant') return false;
  setState(brain, 'waking');
  return true;
}

function setState(brain: Brain, s: GuardianState): void {
  if (brain.state !== s) {
    brain.state = s;
    brain.stateTime = 0;
    brain.linger = 0;
  }
}

/** Can this guardian perceive the player right now (sight or proximity)? */
export function detects(spec: GuardianSpec, p: Percepts): boolean {
  if (!p.playerPresent) return false;
  if (p.dist <= spec.proximity && (p.lineOfSight || p.dist <= 1.5)) return true;
  if (spec.sightLit <= 0) return false; // blind
  if (!p.lineOfSight) return false;
  const range = p.playerLit ? spec.sightLit : spec.sightDark;
  if (p.dist <= range && p.angleToPlayer <= spec.fovHalf) return true;
  if (p.playerLit && spec.beaconRange > 0 && p.dist <= spec.beaconRange) return true;
  return false;
}

const copy = (v: Vec3Like): Vec3Like => ({ x: v.x, y: v.y, z: v.z });

/** One think step. Mutates the brain, returns what to do. */
export function think(brain: Brain, p: Percepts): Decision {
  const spec = brain.spec;
  brain.stateTime += p.dt;
  let call: GuardianCall = null;

  if (brain.state === 'dormant') {
    return { state: 'dormant', move: { kind: 'none' }, speed: 0, caught: false, call: null };
  }
  if (brain.state === 'waking') {
    if (brain.stateTime >= spec.wakeTime) {
      setState(brain, 'sweep');
      call = 'wake';
    } else {
      return { state: 'waking', move: { kind: 'none' }, speed: 0, caught: false, call: null };
    }
  }

  const sees = detects(spec, p);
  const heard = p.heard && p.heard.loudness >= spec.hearThreshold ? p.heard : null;

  // A shade can never close on a lit player: light is safety from it.
  const lightHoldsItOff = spec.fearsLight && p.playerLit && p.playerSafeRadius > 0;
  const caught =
    p.playerPresent &&
    p.dist <= spec.catchRadius &&
    (p.lineOfSight || p.dist <= 0.9) &&
    !(lightHoldsItOff && p.playerSafeRadius >= spec.catchRadius);
  if (caught) {
    return { state: brain.state, move: { kind: 'none' }, speed: 0, caught: true, call };
  }

  // Shade: light it is standing in overrides everything.
  if (spec.fearsLight && p.selfInLight && !(sees && lightHoldsItOff)) {
    if (brain.state !== 'repelled') call = call ?? 'hiss';
    setState(brain, 'repelled');
    return { state: 'repelled', move: { kind: 'fleeLight' }, speed: spec.chaseSpeed, caught: false, call };
  }

  if (sees) {
    brain.lastKnown = copy(p.playerPos);
    brain.lostTime = 0;
    if (lightHoldsItOff) {
      // Hover just outside the light, waiting for the flame to fail.
      if (brain.state !== 'repelled') call = call ?? 'hiss';
      setState(brain, 'repelled');
      return {
        state: 'repelled',
        move: { kind: 'holdEdge', around: copy(p.playerPos), radius: p.playerSafeRadius + 1.6 },
        speed: spec.chaseSpeed,
        caught: false,
        call,
      };
    }
    if (brain.state !== 'chase') call = call ?? 'alert';
    setState(brain, 'chase');
    return { state: 'chase', move: { kind: 'point', pos: copy(p.playerPos) }, speed: spec.chaseSpeed, caught: false, call };
  }

  // Not currently detecting the player.
  switch (brain.state) {
    case 'repelled':
      // The light is gone or the player slipped away: go look where they were.
      setState(brain, brain.lastKnown ? 'search' : 'sweep');
      break;
    case 'chase': {
      // Sighted hunters coast toward the last known position for a moment.
      brain.lostTime += p.dt;
      if (heard) {
        brain.lastKnown = copy(heard.pos);
        brain.lostTime = 0;
      }
      // Sighted hunters give up after loseTime; the blind crawler when it gets there.
      const gaveUp = spec.sightLit > 0 ? brain.lostTime >= spec.loseTime : p.arrived && !heard;
      if (gaveUp) {
        setState(brain, 'search');
        call = call ?? 'lost';
      }
      break;
    }
    default:
      break;
  }

  // Noises redirect anything that is not already chasing by sight.
  if (heard && brain.state !== 'chase') {
    brain.noiseTarget = copy(heard.pos);
    // The blind crawler commits to much fainter sounds than the sighted guardians do.
    const loud = heard.loudness >= (spec.sightLit <= 0 ? 0.3 : 0.45);
    if (spec.sightLit <= 0) {
      // The crawler hunts by sound alone: a noise *is* its target.
      brain.lastKnown = copy(heard.pos);
      const next: GuardianState = loud ? 'chase' : 'investigate';
      if (next === 'chase') call = call ?? 'alert';
      setState(brain, next);
      brain.linger = 0;
      return {
        state: next,
        move: { kind: 'point', pos: copy(heard.pos) },
        speed: next === 'chase' ? spec.chaseSpeed : spec.investigateSpeed,
        caught: false,
        call,
      };
    }
    if (brain.state === 'sweep' || brain.state === 'investigate' || (brain.state === 'search' && loud)) {
      setState(brain, 'investigate');
      brain.linger = 0;
    }
  }

  switch (brain.state) {
    case 'chase': {
      const target = brain.lastKnown ?? p.playerPos;
      return { state: 'chase', move: { kind: 'point', pos: copy(target) }, speed: spec.chaseSpeed, caught: false, call };
    }
    case 'search': {
      if (!brain.lastKnown) {
        setState(brain, 'sweep');
        return { state: 'sweep', move: { kind: 'sweep' }, speed: spec.sweepSpeed, caught: false, call };
      }
      if (p.arrived) {
        brain.linger += p.dt;
        if (brain.linger >= spec.lingerTime) {
          brain.lastKnown = null;
          setState(brain, 'sweep');
          return { state: 'sweep', move: { kind: 'sweep' }, speed: spec.sweepSpeed, caught: false, call };
        }
        return { state: 'search', move: { kind: 'none' }, speed: 0, caught: false, call };
      }
      return {
        state: 'search',
        move: { kind: 'point', pos: copy(brain.lastKnown) },
        speed: spec.investigateSpeed,
        caught: false,
        call,
      };
    }
    case 'investigate': {
      if (!brain.noiseTarget) {
        setState(brain, 'sweep');
        return { state: 'sweep', move: { kind: 'sweep' }, speed: spec.sweepSpeed, caught: false, call };
      }
      if (p.arrived) {
        brain.linger += p.dt;
        if (brain.linger >= spec.lingerTime) {
          brain.noiseTarget = null;
          setState(brain, 'sweep');
          return { state: 'sweep', move: { kind: 'sweep' }, speed: spec.sweepSpeed, caught: false, call };
        }
        return { state: 'investigate', move: { kind: 'none' }, speed: 0, caught: false, call };
      }
      return {
        state: 'investigate',
        move: { kind: 'point', pos: copy(brain.noiseTarget) },
        speed: spec.investigateSpeed,
        caught: false,
        call,
      };
    }
    default:
      setState(brain, 'sweep');
      return { state: 'sweep', move: { kind: 'sweep' }, speed: spec.sweepSpeed, caught: false, call };
  }
}
