/**
 * Scene graph and unlock rules: which scenes connect, what each connection needs, and the
 * shortcuts that open once used. Pure logic, unit tested.
 */
import type { Zone } from './economy';

export type SceneId = 'jungle' | 'courtyard' | 'cliffs' | 'halls' | 'sanctum' | 'catacombs' | 'vault';

export const SCENE_IDS: SceneId[] = ['jungle', 'courtyard', 'cliffs', 'halls', 'sanctum', 'catacombs', 'vault'];

export const SCENE_INFO: Record<SceneId, { name: string; zone: Zone; optional?: boolean; depth: number }> = {
  jungle: { name: 'Jungle Approach', zone: 'A', depth: 0 },
  courtyard: { name: 'Temple Courtyard', zone: 'A', depth: 1 },
  cliffs: { name: 'Outer Cliffs', zone: 'A', optional: true, depth: 1 },
  halls: { name: 'Broken Halls', zone: 'B', depth: 2 },
  sanctum: { name: 'Collapsed Sanctum', zone: 'B', depth: 3 },
  catacombs: { name: 'Lower Catacombs', zone: 'C', depth: 4 },
  vault: { name: 'Deep Vault', zone: 'C', depth: 5 },
};

export type Flag =
  | 'greatDoorOpen'
  | 'sundialSolved'
  | 'sealOpen'
  | 'vaultDoorOpen'
  | 'drawbridgeLowered'
  | 'boneWallBroken'
  | 'aqueductOpen'
  | 'idolTaken'
  | 'naveBlocked'
  | 'darkness'
  | 'doorShut'
  | 'nestRope'
  | 'lairOpen';

export type KeyItem = 'sunDisc' | 'serpentKey';

export interface UnlockState {
  flags: Set<Flag>;
  items: Set<KeyItem>;
}

export function newUnlockState(): UnlockState {
  return { flags: new Set(), items: new Set() };
}

export interface Connection {
  id: string;
  a: SceneId;
  b: SceneId;
  /** All flags must be set for the connection to be open. */
  requires: Flag[];
  /** Any flag here closes it. */
  closedBy?: Flag[];
  shortcut?: boolean;
  label: string;
}

export const CONNECTIONS: Connection[] = [
  { id: 'gorge', a: 'jungle', b: 'courtyard', requires: [], label: 'Rope bridge or fallen tree over the gorge' },
  { id: 'cliffPath', a: 'courtyard', b: 'cliffs', requires: [], label: 'East cliff path' },
  { id: 'greatDoor', a: 'courtyard', b: 'halls', requires: ['greatDoorOpen'], closedBy: ['doorShut'], label: 'The great door' },
  { id: 'nave', a: 'halls', b: 'sanctum', requires: [], closedBy: ['naveBlocked'], label: 'Main nave' },
  { id: 'aisle', a: 'halls', b: 'sanctum', requires: [], label: 'Side aisle (crumbling floor)' },
  { id: 'sealStairs', a: 'sanctum', b: 'catacombs', requires: ['sealOpen'], label: 'Stairs under the catacomb seal' },
  { id: 'vaultDoor', a: 'catacombs', b: 'vault', requires: ['vaultDoorOpen'], label: 'Serpent door' },
  { id: 'boneStair', a: 'catacombs', b: 'halls', requires: ['boneWallBroken'], shortcut: true, label: 'Bone Stair (kicked-down wall)' },
  { id: 'aqueduct', a: 'vault', b: 'catacombs', requires: ['aqueductOpen'], shortcut: true, label: 'Aqueduct (escape route)' },
];

/** In-scene shortcuts that do not change scene connectivity but change the route. */
export const IN_SCENE_SHORTCUTS: { flag: Flag; scene: SceneId; label: string }[] = [
  { flag: 'drawbridgeLowered', scene: 'halls', label: 'Drawbridge over the chasm' },
];

export function isOpen(c: Connection, s: UnlockState): boolean {
  if (c.requires.some((f) => !s.flags.has(f))) return false;
  if (c.closedBy && c.closedBy.some((f) => s.flags.has(f))) return false;
  return true;
}

export function neighbours(scene: SceneId, s: UnlockState): SceneId[] {
  const out: SceneId[] = [];
  for (const c of CONNECTIONS) {
    if (!isOpen(c, s)) continue;
    if (c.a === scene && !out.includes(c.b)) out.push(c.b);
    else if (c.b === scene && !out.includes(c.a)) out.push(c.a);
  }
  return out;
}

/** Every scene adjacent in the world, open or not (used for streaming). */
export function physicalNeighbours(scene: SceneId): SceneId[] {
  const out: SceneId[] = [];
  for (const c of CONNECTIONS) {
    if (c.a === scene && !out.includes(c.b)) out.push(c.b);
    else if (c.b === scene && !out.includes(c.a)) out.push(c.a);
  }
  return out;
}

export function reachable(s: UnlockState, from: SceneId = 'jungle'): Set<SceneId> {
  const seen = new Set<SceneId>([from]);
  const queue: SceneId[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of neighbours(cur, s)) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

export function canEnter(scene: SceneId, s: UnlockState): boolean {
  return reachable(s).has(scene);
}

/** Shortest open route between two scenes, or null. */
export function route(from: SceneId, to: SceneId, s: UnlockState): SceneId[] | null {
  const prev = new Map<SceneId, SceneId | null>([[from, null]]);
  const queue: SceneId[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const n of neighbours(cur, s)) {
      if (!prev.has(n)) {
        prev.set(n, cur);
        queue.push(n);
      }
    }
  }
  if (!prev.has(to)) return null;
  const path: SceneId[] = [];
  let c: SceneId | null = to;
  while (c) {
    path.unshift(c);
    c = prev.get(c) ?? null;
  }
  return path;
}

export type UseTarget = 'seal' | 'vaultDoor';

export interface UseResult {
  ok: boolean;
  reason?: 'missingItem' | 'alreadyOpen' | 'wrongTarget';
  flag?: Flag;
}

/** Use a key item on a lock. Consumes nothing (the disc and key stay in their sockets). */
export function useKeyItem(s: UnlockState, item: KeyItem, target: UseTarget): UseResult {
  const lock: Record<UseTarget, { item: KeyItem; flag: Flag }> = {
    seal: { item: 'sunDisc', flag: 'sealOpen' },
    vaultDoor: { item: 'serpentKey', flag: 'vaultDoorOpen' },
  };
  const l = lock[target];
  if (s.flags.has(l.flag)) return { ok: false, reason: 'alreadyOpen' };
  if (l.item !== item) return { ok: false, reason: 'wrongTarget' };
  if (!s.items.has(item)) return { ok: false, reason: 'missingItem' };
  s.items.delete(item);
  s.flags.add(l.flag);
  return { ok: true, flag: l.flag };
}

/** Requirements a scene needs before it can be entered, as human-readable hints. */
export function hintsFor(scene: SceneId, s: UnlockState): string[] {
  if (canEnter(scene, s)) return [];
  switch (scene) {
    case 'halls':
      return s.flags.has('doorShut') ? ['The great door has closed.'] : ['Weigh down both plates before the great door.'];
    case 'sanctum':
      return ['Reach the broken halls first.'];
    case 'catacombs':
      return s.items.has('sunDisc') ? ['Set the Sun-Disc into the seal in the sanctum.'] : ['The seal needs a Sun-Disc. The courtyard sundial holds one.'];
    case 'vault':
      return s.items.has('serpentKey') ? ['Unlock the serpent door with the Serpent Key.'] : ['The vault needs the Serpent Key, somewhere in the flooded chamber.'];
    default:
      return [];
  }
}

/**
 * The entry and escape routes, as lists of connection ids. Used to check (in tests) that
 * the way out is not just the way in backwards.
 */
export const ENTRY_ROUTE = ['gorge', 'greatDoor', 'nave', 'sealStairs', 'vaultDoor'];
export const ESCAPE_ROUTE = ['aqueduct', 'boneStair', 'greatDoor'];
