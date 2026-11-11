import type { V3 } from './vec';

export type GuardianKind = 'sentinel' | 'crawler' | 'shade';
export type GState = 'dormant' | 'waking' | 'sweep' | 'investigate' | 'chase' | 'stalk' | 'search' | 'flee';

export interface Perception {
  /** Spawn signal (sunset schedule reached this guardian). */
  awake: boolean;
  dist: number;
  /** Line of sight from guardian eyes to player. */
  los: boolean;
  playerPos: V3;
  torchLit: boolean;
  torchRadius: number;
  /** Loudest noise this guardian can hear this frame (already filtered by range). */
  noise: V3 | null;
  /** Is the player standing in any light (torch, sconce, sun)? */
  playerLit: boolean;
  /** Is the guardian standing in light? */
  selfLit: boolean;
}

export interface GMem {
  state: GState;
  timer: number;
  target: V3 | null;
  /** Seconds since the guardian last had contact with the player. */
  lostFor: number;
}

export interface GDecision { mem: GMem; speed: number; caught: boolean; call: boolean }

export const CATCH_DIST = 1.1;
export const WAKE_TIME = 2.0;

export const SPEEDS: Record<GuardianKind, { sweep: number; chase: number; investigate: number }> = {
  sentinel: { sweep: 1.6, chase: 2.3, investigate: 2.0 },
  crawler: { sweep: 2.6, chase: 6.2, investigate: 5.0 },
  shade: { sweep: 2.4, chase: 4.2, investigate: 3.0 },
};

export const newMem = (): GMem => ({ state: 'dormant', timer: 0, target: null, lostFor: 0 });

/** Sight range for a sentinel: a lit torch gives you away from far off. */
export function sentinelSightRange(torchLit: boolean, torchRadius: number): number {
  return torchLit ? torchRadius * 3 + 6 : 4;
}

function to(mem: GMem, state: GState, target: V3 | null = mem.target): GMem {
  return { state, timer: 0, target, lostFor: state === 'chase' ? 0 : mem.lostFor };
}

/**
 * One FSM step. Pure: same inputs → same outputs. The runtime turns `target`
 * into a navmesh path and moves the guardian at `speed`.
 */
export function stepGuardian(kind: GuardianKind, m: GMem, p: Perception, dt: number, door: V3): GDecision {
  let mem: GMem = { ...m, timer: m.timer + dt };
  let call = false;
  const sp = SPEEDS[kind];

  if (mem.state === 'dormant') {
    if (p.awake) { mem = to(mem, 'waking', null); call = true; }
    return { mem, speed: 0, caught: false, call };
  }
  if (mem.state === 'waking') {
    if (mem.timer >= WAKE_TIME) mem = to(mem, 'sweep', door);
    return { mem, speed: 0, caught: false, call };
  }

  const caught = p.dist <= CATCH_DIST && !(kind === 'shade' && p.playerLit && p.torchLit);

  if (kind === 'sentinel') {
    const sees = p.los && p.dist <= sentinelSightRange(p.torchLit, p.torchRadius);
    switch (mem.state) {
      case 'sweep':
      case 'search':
      case 'investigate':
        if (sees) { mem = to(mem, 'chase', p.playerPos); call = true; break; }
        if (mem.state === 'search' && mem.timer > 6) mem = to(mem, 'sweep', door);
        if (mem.state === 'sweep') mem.target = door;
        break;
      case 'chase':
        if (sees) { mem.target = p.playerPos; mem.lostFor = 0; }
        else {
          mem.lostFor += dt;
          if (mem.lostFor > 8) mem = to(mem, 'search', mem.target);
        }
        break;
      default:
        mem = to(mem, 'sweep', door);
    }
    const speed = mem.state === 'chase' ? sp.chase : mem.state === 'sweep' ? sp.sweep : sp.investigate;
    return { mem, speed, caught, call };
  }

  if (kind === 'crawler') {
    // blind: hearing, plus feeling heat/vibration very close
    const feels = p.dist < 3 || (p.torchLit && p.dist < 6);
    switch (mem.state) {
      case 'sweep':
        if (feels) { mem = to(mem, 'chase', p.playerPos); call = true; }
        else if (p.noise) { mem = to(mem, 'investigate', p.noise); call = true; }
        else mem.target = door;
        break;
      case 'investigate':
        if (feels) { mem = to(mem, 'chase', p.playerPos); call = true; }
        else if (p.noise) { mem.target = p.noise; mem.timer = 0; }
        else if (mem.timer > 7) mem = to(mem, 'search', mem.target);
        break;
      case 'chase':
        if (feels || p.noise) { mem.target = feels ? p.playerPos : p.noise; mem.lostFor = 0; }
        else {
          mem.lostFor += dt;
          if (mem.lostFor > 3) mem = to(mem, 'search', mem.target);
        }
        break;
      case 'search':
        if (feels) { mem = to(mem, 'chase', p.playerPos); call = true; }
        else if (p.noise) mem = to(mem, 'investigate', p.noise);
        else if (mem.timer > 4) mem = to(mem, 'sweep', door);
        break;
      default:
        mem = to(mem, 'sweep', door);
    }
    const speed = mem.state === 'chase' ? sp.chase : mem.state === 'investigate' ? sp.investigate : mem.state === 'search' ? 1.5 : sp.sweep;
    return { mem, speed, caught, call };
  }

  // shade: hunts in darkness, never enters light
  const senses = p.dist < 18;
  switch (mem.state) {
    case 'sweep':
      if (senses) { mem = to(mem, p.playerLit ? 'stalk' : 'chase', p.playerPos); call = true; }
      else mem.target = door;
      break;
    case 'stalk':
      mem.target = p.playerPos;
      if (p.selfLit) mem = to(mem, 'flee', mem.target);
      else if (!p.playerLit) { mem = to(mem, 'chase', p.playerPos); call = true; }
      else if (p.dist > 30) mem = to(mem, 'sweep', door);
      break;
    case 'chase':
      mem.target = p.playerPos;
      if (p.selfLit || (p.playerLit && p.torchLit && p.dist < p.torchRadius)) mem = to(mem, 'flee', mem.target);
      else if (p.dist > 30) mem = to(mem, 'sweep', door);
      break;
    case 'flee':
      if (mem.timer > 2.5 && !p.selfLit) mem = to(mem, senses ? 'stalk' : 'sweep', senses ? p.playerPos : door);
      break;
    default:
      mem = to(mem, 'sweep', door);
  }
  const speed = mem.state === 'chase' ? sp.chase : mem.state === 'flee' ? sp.chase : mem.state === 'stalk' ? sp.investigate : sp.sweep;
  return { mem, speed, caught, call };
}

/** For a stalking shade: where to stand so it stays just outside the player's light. */
export function stalkPoint(guardian: V3, player: V3, lightRadius: number): V3 {
  const dx = guardian.x - player.x, dz = guardian.z - player.z;
  const d = Math.hypot(dx, dz) || 1;
  const r = lightRadius + 1.5;
  return { x: player.x + (dx / d) * r, y: player.y, z: player.z + (dz / d) * r };
}

/** Flee point: directly away from the player. */
export function fleePoint(guardian: V3, player: V3, distance = 8): V3 {
  const dx = guardian.x - player.x, dz = guardian.z - player.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: guardian.x + (dx / d) * distance, y: guardian.y, z: guardian.z + (dz / d) * distance };
}

/** Sunset spawn schedule: deepest first. Seconds after sunset. */
export const SPAWN_SCHEDULE: { scene: 'vault' | 'catacombs' | 'sanctum' | 'halls'; delay: number }[] = [
  { scene: 'vault', delay: 0 },
  { scene: 'catacombs', delay: 10 },
  { scene: 'sanctum', delay: 20 },
  { scene: 'halls', delay: 30 },
];
export function spawnDue(scene: string, secondsSinceSunset: number): boolean {
  const e = SPAWN_SCHEDULE.find((s) => s.scene === scene);
  return !!e && secondsSinceSunset >= e.delay;
}
