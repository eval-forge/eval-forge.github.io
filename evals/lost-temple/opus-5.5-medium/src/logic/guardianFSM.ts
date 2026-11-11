/**
 * Guardian state machine. Pure: given the previous state and what the guardian
 * perceives this tick, return the next state and a movement intent.
 */
export type GuardianKind = 'sentinel' | 'crawler' | 'shade';
export type GState = 'DORMANT' | 'WAKING' | 'SWEEP' | 'INVESTIGATE' | 'CHASE' | 'SEARCH' | 'STALK' | 'CATCH';
export type V3 = [number, number, number];

export interface GuardianSpec {
  kind: GuardianKind;
  walkSpeed: number;
  chaseSpeed: number;
  catchRadius: number;
  wakeDuration: number;
  searchDuration: number;
  /** Max distance a noise of loudness 1 is heard from. */
  hearing: number;
  /** Base sight range (m) independent of light. */
  sight: number;
}

export const SPECS: Record<GuardianKind, GuardianSpec> = {
  sentinel: { kind: 'sentinel', walkSpeed: 1.8, chaseSpeed: 2.6, catchRadius: 1.4, wakeDuration: 2.5, searchDuration: 8, hearing: 6, sight: 4 },
  crawler: { kind: 'crawler', walkSpeed: 2.6, chaseSpeed: 6.2, catchRadius: 1.1, wakeDuration: 1.2, searchDuration: 5, hearing: 30, sight: 3 },
  shade: { kind: 'shade', walkSpeed: 2.4, chaseSpeed: 4.4, catchRadius: 1.2, wakeDuration: 1.5, searchDuration: 6, hearing: 0, sight: 22 },
};

export interface Perception {
  awake: boolean; // the clock has reached this guardian's wake time
  playerPos: V3;
  playerDist: number;
  /** Line of sight to the player (no walls between). */
  los: boolean;
  /** Player inside the guardian's field of view cone. */
  inFov: boolean;
  /** Player's torch radius (0 if unlit). */
  torchRadius: number;
  /** Strongest noise heard this tick: position and loudness 0..1 (already distance-attenuated is NOT applied). */
  noise: { pos: V3; loudness: number; dist: number } | null;
  /** For the shade: is the player within any light (own torch radius > SHADE_DARK_RADIUS or standing in sun/sconce)? */
  playerLit: boolean;
  /** For the shade: would stepping toward the player put the shade inside light? */
  nextStepLit: boolean;
}

export interface GuardianMind {
  state: GState;
  timer: number;
  target: V3 | null;
  lastKnown: V3 | null;
}

export interface Intent {
  moveTo: V3 | null; // null = hold position
  speed: number;
  caught: boolean;
}

export function newMind(): GuardianMind {
  return { state: 'DORMANT', timer: 0, target: null, lastKnown: null };
}

/** Effective sight range: sentinels see torchlight from far away. */
export function sightRange(spec: GuardianSpec, torchRadius: number): number {
  if (spec.kind === 'sentinel') return Math.max(spec.sight, torchRadius * 2.2);
  if (spec.kind === 'crawler') return spec.sight + torchRadius * 0.3;
  return spec.sight;
}

export function detects(spec: GuardianSpec, p: Perception): boolean {
  if (spec.kind === 'shade') return p.playerDist <= spec.sight; // senses you; light is what stops it
  if (!p.los) return false;
  if (p.playerDist <= spec.catchRadius * 2) return true;
  if (spec.kind === 'crawler') return p.playerDist <= sightRange(spec, p.torchRadius); // no cone, short range
  return p.inFov && p.playerDist <= sightRange(spec, p.torchRadius);
}

export function hears(spec: GuardianSpec, p: Perception): boolean {
  if (!p.noise || spec.hearing <= 0) return false;
  return p.noise.dist <= spec.hearing * p.noise.loudness;
}

/**
 * Advance the mind. `sweepTarget` is where the guardian heads when it has nothing better to do
 * (outward toward the great door).
 */
export function step(spec: GuardianSpec, m: GuardianMind, p: Perception, dt: number, sweepTarget: V3): { mind: GuardianMind; intent: Intent } {
  const mind: GuardianMind = { ...m };
  const hold: Intent = { moveTo: null, speed: 0, caught: false };

  if (mind.state === 'CATCH') return { mind, intent: { ...hold, caught: true } };

  if (mind.state === 'DORMANT') {
    if (!p.awake) return { mind, intent: hold };
    mind.state = 'WAKING';
    mind.timer = spec.wakeDuration;
    return { mind, intent: hold };
  }
  if (mind.state === 'WAKING') {
    mind.timer -= dt;
    if (mind.timer > 0) return { mind, intent: hold };
    mind.state = 'SWEEP';
  }

  // Catch check (any active state). The shade can't catch you while you're lit.
  if (p.playerDist <= spec.catchRadius && p.los && !(spec.kind === 'shade' && p.playerLit)) {
    mind.state = 'CATCH';
    return { mind, intent: { ...hold, caught: true } };
  }

  const seen = detects(spec, p);

  if (spec.kind === 'shade') {
    if (seen) {
      mind.lastKnown = p.playerPos;
      if (p.playerLit) {
        // Stalk: hover at the edge of the light, never stepping into it.
        mind.state = 'STALK';
        return { mind, intent: { moveTo: p.nextStepLit ? null : p.playerPos, speed: spec.walkSpeed, caught: false } };
      }
      mind.state = 'CHASE';
      return { mind, intent: { moveTo: p.playerPos, speed: spec.chaseSpeed, caught: false } };
    }
  } else if (seen) {
    mind.state = 'CHASE';
    mind.lastKnown = p.playerPos;
    return { mind, intent: { moveTo: p.playerPos, speed: spec.chaseSpeed, caught: false } };
  }

  if (hears(spec, p) && mind.state !== 'CHASE') {
    mind.state = 'INVESTIGATE';
    mind.target = p.noise!.pos;
    mind.timer = 12;
  }

  switch (mind.state) {
    case 'CHASE':
    case 'STALK': {
      // Lost the player: go to the last known position, then search.
      mind.state = 'SEARCH';
      mind.timer = spec.searchDuration;
      mind.target = mind.lastKnown;
      return { mind, intent: { moveTo: mind.target, speed: spec.chaseSpeed * 0.8, caught: false } };
    }
    case 'INVESTIGATE': {
      mind.timer -= dt;
      if (mind.timer <= 0) {
        mind.state = 'SEARCH';
        mind.timer = spec.searchDuration;
      }
      const speed = spec.kind === 'crawler' ? spec.chaseSpeed * 0.85 : spec.walkSpeed * 1.2;
      return { mind, intent: { moveTo: mind.target, speed, caught: false } };
    }
    case 'SEARCH': {
      mind.timer -= dt;
      if (mind.timer <= 0) {
        mind.state = 'SWEEP';
        mind.target = null;
      }
      return { mind, intent: { moveTo: mind.target, speed: spec.walkSpeed, caught: false } };
    }
    case 'SWEEP':
    default:
      mind.state = 'SWEEP';
      return { mind, intent: { moveTo: sweepTarget, speed: spec.walkSpeed, caught: false } };
  }
}

/** Called by the agent when it reaches its target during INVESTIGATE: switch to searching. */
export function arrived(spec: GuardianSpec, m: GuardianMind): GuardianMind {
  if (m.state === 'INVESTIGATE') return { ...m, state: 'SEARCH', timer: spec.searchDuration };
  return m;
}

export function dist(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Wake order: deepest scenes first. Returns wake delay (s after dark) for a spawn scene. */
export const WAKE_ORDER = ['lair', 'vault', 'catacombs', 'tunnel', 'sanctum', 'halls'] as const;
export function wakeDelay(scene: string): number {
  const i = WAKE_ORDER.indexOf(scene as typeof WAKE_ORDER[number]);
  return i < 0 ? 0 : i * 6;
}
