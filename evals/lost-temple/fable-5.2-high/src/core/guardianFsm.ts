import { SCENE_INFO, type SceneId, type V3 } from './types';

export type GuardianKind = 'sentinel' | 'crawler' | 'shade';
export type GState = 'dormant' | 'waking' | 'sweep' | 'investigate' | 'chase' | 'search' | 'lurk' | 'flee';

export interface GuardianSpec {
  name: string;
  /** Movement speed per state, m/s. */
  speed: Partial<Record<GState, number>> & { enraged: number };
  wakeTime: number;
  /** Fraction of a noise's radius at which this guardian can hear it. 0 is deaf. */
  hearing: number;
  /** Sight range with the player's torch out / lit. 0 is blind. */
  sightDark: number;
  sightLit: number;
  catchRange: number;
}

export const GUARDIANS: Record<GuardianKind, GuardianSpec> = {
  // Slow, relentless, sees along a line of sight. A lit torch gives you away from far off.
  sentinel: {
    name: 'Stone Sentinel',
    speed: { sweep: 1.8, investigate: 2.0, chase: 2.3, search: 1.6, enraged: 3.0 },
    wakeTime: 4, hearing: 0.35, sightDark: 14, sightLit: 30, catchRange: 1.3,
  },
  // Fast and blind. Hunts whatever made the last noise.
  crawler: {
    name: 'Crawler',
    speed: { sweep: 3.0, investigate: 5.6, chase: 6.6, search: 3.4, enraged: 7.0 },
    wakeTime: 2, hearing: 1.0, sightDark: 0, sightLit: 0, catchRange: 1.2,
  },
  // Cannot stand in light. Follows torchlight, waits at its edge, strikes when it fails.
  shade: {
    name: 'Shade',
    speed: { sweep: 2.6, investigate: 3.2, chase: 4.2, search: 2.6, lurk: 3.4, flee: 5.2, enraged: 4.8 },
    wakeTime: 3, hearing: 0.5, sightDark: 9, sightLit: 0, catchRange: 1.2,
  },
};

/** How far away a Shade can sense a burning torch, through walls. */
export const SHADE_TORCH_SENSE = 40;
/** A torch dimmer than this radius no longer holds a Shade back. */
export const SHADE_STRIKE_RADIUS = 3.0;
/** A Crawler notices you by touch inside this range even if you are silent. */
export const CRAWLER_TOUCH = 2.0;
/** A Sentinel notices anything this close if it has line of sight, whichever way it faces. */
export const SENTINEL_NEAR = 2.5;

export interface HeardNoise { pos: V3; radius: number; dist: number; }

export interface Percept {
  dt: number;
  /** The wake signal has reached this guardian. */
  wake: boolean;
  /** Door sealed: every guardian knows where the player is. */
  enraged: boolean;
  selfPos: V3;
  playerPos: V3;
  dist: number;
  /** Unobstructed line from the guardian's eyes to the player. */
  los: boolean;
  /** The player is inside the guardian's forward vision cone. */
  facing: boolean;
  torchLit: boolean;
  /** Radius of the player's torch light, 0 when it is not burning. */
  lightRadius: number;
  /** The guardian is standing in light (player torch or a sconce). */
  inLight: boolean;
  /** Centre of the light the guardian is standing in, if any. */
  lightPos: V3 | null;
  /** Loudest noise this tick, if any. */
  noise: HeardNoise | null;
  /** The guardian has reached its current goal. */
  arrived: boolean;
}

export interface Mind {
  kind: GuardianKind;
  state: GState;
  timer: number;
  /** Seconds since the player was last sensed during a chase. */
  lostT: number;
  /** Where to go. null with goalKind 'sweep' means "next sweep waypoint". */
  goal: V3 | null;
  goalKind: 'none' | 'sweep' | 'point';
  sweepIndex: number;
  speed: number;
  enraged: boolean;
}

export function newMind(kind: GuardianKind): Mind {
  return { kind, state: 'dormant', timer: 0, lostT: 0, goal: null, goalKind: 'none', sweepIndex: 0, speed: 0, enraged: false };
}

/** Seconds after darkness that guardians in a scene wake. Deepest first. */
export function wakeDelay(scene: SceneId): number {
  const deepest = SCENE_INFO.vault.depthRank;
  return Math.max(0, (deepest - SCENE_INFO[scene].depthRank) * 15);
}

// --- Senses ------------------------------------------------------------------------

export function canHear(kind: GuardianKind, n: HeardNoise | null): boolean {
  return !!n && n.dist <= n.radius * GUARDIANS[kind].hearing;
}

export function canSee(kind: GuardianKind, p: Percept): boolean {
  const spec = GUARDIANS[kind];
  if (kind === 'sentinel') {
    if (!p.los) return false;
    if (p.dist <= SENTINEL_NEAR) return true;
    return p.facing && p.dist <= (p.torchLit ? spec.sightLit : spec.sightDark);
  }
  if (kind === 'shade') return !p.torchLit && p.los && p.dist <= spec.sightDark;
  return false;
}

export function sensesTorch(p: Percept): boolean {
  return p.torchLit && p.lightRadius > 0 && p.dist <= SHADE_TORCH_SENSE;
}

/** Light strong enough to hold a Shade off. */
export function lightHolds(p: Percept): boolean {
  return p.torchLit && p.lightRadius >= SHADE_STRIKE_RADIUS;
}

/** Does this guardian catch the player this tick? */
export function catches(m: Mind, p: Percept): boolean {
  if (m.state === 'dormant' || m.state === 'waking') return false;
  if (p.dist > GUARDIANS[m.kind].catchRange) return false;
  // A Shade cannot touch you while you stand in strong light (unless enraged).
  if (m.kind === 'shade' && !m.enraged && lightHolds(p)) return false;
  return true;
}

// --- State machine -------------------------------------------------------------------

function enter(m: Mind, state: GState, goal: V3 | null = null, timer = 0): void {
  m.state = state;
  m.timer = timer;
  m.lostT = 0;
  if (state === 'sweep') { m.goalKind = 'sweep'; m.goal = null; }
  else if (goal) { m.goalKind = 'point'; m.goal = { ...goal }; }
  else { m.goalKind = 'none'; m.goal = null; }
}

function awayFrom(self: V3, from: V3, dist: number): V3 {
  let dx = self.x - from.x, dz = self.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len; dz /= len;
  return { x: self.x + dx * dist, y: self.y, z: self.z + dz * dist };
}

/** A point just outside the player's light, on the guardian's side. */
function lurkPoint(p: Percept): V3 {
  let dx = p.selfPos.x - p.playerPos.x, dz = p.selfPos.z - p.playerPos.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len; dz /= len;
  const r = p.lightRadius + 1.5;
  return { x: p.playerPos.x + dx * r, y: p.playerPos.y, z: p.playerPos.z + dz * r };
}

/** Advance one guardian's mind by one tick. Mutates and returns it. */
export function stepGuardian(m: Mind, p: Percept): Mind {
  const spec = GUARDIANS[m.kind];
  m.timer = Math.max(0, m.timer - p.dt);

  if (m.state === 'dormant') {
    if (p.wake) enter(m, 'waking', null, spec.wakeTime);
    m.speed = 0;
    return m;
  }
  if (m.state === 'waking') {
    if (m.timer <= 0) enter(m, 'sweep');
    m.speed = 0;
    return m;
  }

  // Door sealed: no more hiding.
  if (p.enraged) {
    m.enraged = true;
    if (m.state !== 'chase') enter(m, 'chase', p.playerPos);
    m.goal = { ...p.playerPos };
    m.goalKind = 'point';
    m.speed = spec.speed.enraged;
    return m;
  }

  if (m.kind === 'sentinel') stepSentinel(m, p);
  else if (m.kind === 'crawler') stepCrawler(m, p);
  else stepShade(m, p);

  m.speed = spec.speed[m.state] ?? 0;
  return m;
}

function stepSentinel(m: Mind, p: Percept): void {
  const sees = canSee('sentinel', p);
  const hears = canHear('sentinel', p.noise);
  switch (m.state) {
    case 'sweep':
      if (sees) enter(m, 'chase', p.playerPos);
      else if (hears) enter(m, 'investigate', p.noise!.pos);
      else if (p.arrived) m.sweepIndex++;
      break;
    case 'investigate':
      if (sees) enter(m, 'chase', p.playerPos);
      else if (hears) m.goal = { ...p.noise!.pos };
      else if (p.arrived) enter(m, 'search', null, 4);
      break;
    case 'chase':
      if (sees) { m.goal = { ...p.playerPos }; m.lostT = 0; }
      else {
        m.lostT += p.dt;
        if (p.arrived || m.lostT > 8) enter(m, 'search', null, 5);
      }
      break;
    case 'search':
      if (sees) enter(m, 'chase', p.playerPos);
      else if (hears) enter(m, 'investigate', p.noise!.pos);
      else if (m.timer <= 0) enter(m, 'sweep');
      break;
    default:
      enter(m, 'sweep');
  }
}

function stepCrawler(m: Mind, p: Percept): void {
  const hears = canHear('crawler', p.noise);
  const feels = p.dist <= CRAWLER_TOUCH;
  switch (m.state) {
    case 'sweep':
      if (feels) enter(m, 'chase', p.playerPos);
      else if (hears) enter(m, 'investigate', p.noise!.pos);
      else if (p.arrived) m.sweepIndex++;
      break;
    case 'investigate':
      if (feels) enter(m, 'chase', p.playerPos);
      else if (hears) {
        // A second noise close by means it has a trail to run down.
        if (p.noise!.dist < 10) enter(m, 'chase', p.noise!.pos);
        else m.goal = { ...p.noise!.pos };
      } else if (p.arrived) enter(m, 'search', null, 4);
      break;
    case 'chase':
      if (feels) { m.goal = { ...p.playerPos }; m.lostT = 0; }
      else if (hears) { m.goal = { ...p.noise!.pos }; m.lostT = 0; }
      else {
        m.lostT += p.dt;
        // Go quiet and it loses you.
        if (m.lostT > 2.5 || p.arrived) enter(m, 'search', null, 5);
      }
      break;
    case 'search':
      if (feels) enter(m, 'chase', p.playerPos);
      else if (hears) enter(m, 'investigate', p.noise!.pos);
      else if (m.timer <= 0) enter(m, 'sweep');
      break;
    default:
      enter(m, 'sweep');
  }
}

function stepShade(m: Mind, p: Percept): void {
  const torch = sensesTorch(p);
  const sees = canSee('shade', p);
  const holds = lightHolds(p);
  switch (m.state) {
    case 'sweep':
      if (p.inLight && p.lightPos) enter(m, 'flee', awayFrom(p.selfPos, p.lightPos, 6), 1.2);
      else if (torch) enter(m, 'lurk', lurkPoint(p));
      else if (sees) enter(m, 'chase', p.playerPos);
      else if (p.arrived) m.sweepIndex++;
      break;
    case 'lurk':
      if (p.inLight && p.lightPos && holds) enter(m, 'flee', awayFrom(p.selfPos, p.lightPos, 6), 1.2);
      else if (!holds && p.dist <= SHADE_TORCH_SENSE * 0.5) enter(m, 'chase', p.playerPos);
      else if (!torch) enter(m, 'search', null, 6);
      else m.goal = lurkPoint(p);
      break;
    case 'flee':
      if (m.timer <= 0) {
        if (torch) enter(m, 'lurk', lurkPoint(p));
        else enter(m, 'search', null, 4);
      }
      break;
    case 'chase':
      if (p.inLight && p.lightPos && (holds || p.lightPos !== null && !p.torchLit)) {
        // Either the player's torch is strong again, or it ran into a sconce's light.
        enter(m, 'flee', awayFrom(p.selfPos, p.lightPos, 6), 1.2);
      } else if (holds) enter(m, 'lurk', lurkPoint(p));
      else if (sees || p.dist <= 12 || torch) { m.goal = { ...p.playerPos }; m.lostT = 0; }
      else {
        m.lostT += p.dt;
        if (m.lostT > 4 || p.arrived) enter(m, 'search', null, 5);
      }
      break;
    case 'search':
      if (torch) enter(m, 'lurk', lurkPoint(p));
      else if (sees) enter(m, 'chase', p.playerPos);
      else if (m.timer <= 0) enter(m, 'sweep');
      break;
    default:
      enter(m, 'sweep');
  }
}
