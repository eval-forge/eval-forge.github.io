/**
 * Scene graph, gates and unlock rules. Pure.
 */
import type { ZoneId } from './economy';

export type SceneId = 'jungle' | 'courtyard' | 'cliffs' | 'halls' | 'sanctum' | 'catacombs' | 'vault';

export interface SceneInfo {
  id: SceneId;
  name: string;
  zone: ZoneId;
  /** Scenes that must be streamed in while this one is current. */
  neighbors: SceneId[];
}

export const SCENES: Record<SceneId, SceneInfo> = {
  jungle: { id: 'jungle', name: 'Jungle Approach', zone: 'A', neighbors: ['courtyard'] },
  courtyard: { id: 'courtyard', name: 'Temple Courtyard', zone: 'A', neighbors: ['jungle', 'cliffs', 'halls'] },
  cliffs: { id: 'cliffs', name: 'Outer Cliffs', zone: 'A', neighbors: ['courtyard'] },
  halls: { id: 'halls', name: 'Broken Halls', zone: 'B', neighbors: ['courtyard', 'sanctum', 'catacombs'] },
  sanctum: { id: 'sanctum', name: 'Collapsed Sanctum', zone: 'B', neighbors: ['halls', 'vault'] },
  catacombs: { id: 'catacombs', name: 'Lower Catacombs', zone: 'C', neighbors: ['halls', 'vault'] },
  vault: { id: 'vault', name: 'Deep Vault', zone: 'C', neighbors: ['catacombs', 'sanctum'] },
};

export const SCENE_ORDER: SceneId[] = ['jungle', 'courtyard', 'cliffs', 'halls', 'sanctum', 'catacombs', 'vault'];

/** Depth used for "deepest first" guardian spawns and difficulty. */
export const SCENE_DEPTH: Record<SceneId, number> = {
  jungle: 0,
  courtyard: 1,
  cliffs: 1,
  halls: 2,
  sanctum: 3,
  catacombs: 4,
  vault: 5,
};

export interface RunFlags {
  greatDoorOpen: boolean;
  greatDoorClosed: boolean; // closed for good at the end of the final window
  sundialSolved: boolean;
  hasSunDisc: boolean;
  sunSealOpen: boolean;
  hasBoneKey: boolean;
  vaultDoorOpen: boolean;
  kickWallBroken: boolean;
  drawbridgeDown: boolean;
  archwayBlocked: boolean;
  idolTaken: boolean;
}

export function defaultFlags(): RunFlags {
  return {
    greatDoorOpen: false,
    greatDoorClosed: false,
    sundialSolved: false,
    hasSunDisc: false,
    sunSealOpen: false,
    hasBoneKey: false,
    vaultDoorOpen: false,
    kickWallBroken: false,
    drawbridgeDown: false,
    archwayBlocked: false,
    idolTaken: false,
  };
}

export type GateId = 'bridge' | 'greatDoor' | 'cliffPath' | 'archway' | 'sunSeal' | 'vaultDoor' | 'kickWall' | 'drawbridge' | 'escapeRamp';

export interface GateInfo {
  id: GateId;
  a: SceneId;
  b: SceneId;
  /** If set, the gate can only be traversed a → b. */
  oneWay?: boolean;
  /** If set, the gate can only be opened from this scene. */
  openFrom?: SceneId;
  label: string;
}

export const GATES: GateInfo[] = [
  { id: 'bridge', a: 'jungle', b: 'courtyard', oneWay: true, label: 'Rope bridge' },
  { id: 'cliffPath', a: 'courtyard', b: 'cliffs', label: 'Cliff path' },
  { id: 'greatDoor', a: 'courtyard', b: 'halls', label: 'Great door' },
  { id: 'archway', a: 'halls', b: 'sanctum', label: 'Sanctum archway' },
  { id: 'kickWall', a: 'sanctum', b: 'halls', openFrom: 'sanctum', label: 'Cracked wall' },
  { id: 'sunSeal', a: 'halls', b: 'catacombs', label: 'Sun Seal' },
  { id: 'vaultDoor', a: 'catacombs', b: 'vault', label: 'Vault door' },
  { id: 'drawbridge', a: 'vault', b: 'sanctum', openFrom: 'vault', label: 'Drawbridge' },
];

/** Is this gate passable right now? */
export function gateOpen(id: GateId, f: RunFlags): boolean {
  switch (id) {
    case 'bridge':
    case 'cliffPath':
    case 'escapeRamp':
      return true;
    case 'greatDoor':
      return f.greatDoorOpen && !f.greatDoorClosed;
    case 'archway':
      return !f.archwayBlocked;
    case 'kickWall':
      return f.kickWallBroken;
    case 'sunSeal':
      return f.sunSealOpen;
    case 'vaultDoor':
      return f.vaultDoorOpen;
    case 'drawbridge':
      return f.drawbridgeDown;
  }
}

export type UnlockResult = { ok: true; flags: RunFlags; message: string } | { ok: false; reason: string };

/** Attempt to open a gate from a given scene. Returns new flags (input is not mutated). */
export function tryUnlock(id: GateId, f: RunFlags, fromScene: SceneId): UnlockResult {
  const g = GATES.find((x) => x.id === id);
  if (g && g.openFrom && fromScene !== g.openFrom) {
    return { ok: false, reason: id === 'kickWall' ? 'Solid from this side.' : 'The mechanism is on the far side.' };
  }
  const n = { ...f };
  switch (id) {
    case 'greatDoor':
      if (f.greatDoorClosed) return { ok: false, reason: 'The great door is sealed for the night.' };
      if (f.greatDoorOpen) return { ok: false, reason: 'Already open.' };
      n.greatDoorOpen = true;
      return { ok: true, flags: n, message: 'The great door grinds open.' };
    case 'sunSeal':
      if (f.sunSealOpen) return { ok: false, reason: 'Already open.' };
      if (!f.hasSunDisc) return { ok: false, reason: 'A sun-shaped recess. Something round belongs here.' };
      n.sunSealOpen = true;
      n.hasSunDisc = false;
      return { ok: true, flags: n, message: 'The Sun Disc turns. The seal rolls aside.' };
    case 'vaultDoor':
      if (f.vaultDoorOpen) return { ok: false, reason: 'Already open.' };
      if (!f.hasBoneKey) return { ok: false, reason: 'A keyhole shaped like a carved bone.' };
      n.vaultDoorOpen = true;
      n.hasBoneKey = false;
      return { ok: true, flags: n, message: 'The Bone Key turns. The vault door rises.' };
    case 'kickWall':
      if (f.kickWallBroken) return { ok: false, reason: 'Already broken.' };
      n.kickWallBroken = true;
      return { ok: true, flags: n, message: 'The cracked wall gives way. A shortcut to the halls.' };
    case 'drawbridge':
      if (f.drawbridgeDown) return { ok: false, reason: 'Already down.' };
      n.drawbridgeDown = true;
      return { ok: true, flags: n, message: 'Chains rattle. The drawbridge lowers across the chasm.' };
    default:
      return { ok: false, reason: 'Nothing to unlock.' };
  }
}

/** Scenes reachable from `start` through currently open gates (respecting one-way gates). */
export function reachableScenes(f: RunFlags, start: SceneId): Set<SceneId> {
  const seen = new Set<SceneId>([start]);
  const queue: SceneId[] = [start];
  while (queue.length) {
    const s = queue.shift()!;
    for (const g of GATES) {
      if (!gateOpen(g.id, f)) continue;
      let next: SceneId | null = null;
      if (g.a === s) next = g.b;
      else if (g.b === s && !g.oneWay) next = g.a;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Can the player get from `from` back out to the courtyard (the door) right now? */
export function canReachExit(f: RunFlags, from: SceneId): boolean {
  return reachableScenes(f, from).has('courtyard');
}

/** The set of scenes that should be loaded while `current` is the player's scene. */
export function streamingSet(current: SceneId): Set<SceneId> {
  return new Set<SceneId>([current, ...SCENES[current].neighbors]);
}

/** Taking the Sun Idol starts the collapse; when it finishes the archway is buried. */
export function applyCollapse(f: RunFlags): RunFlags {
  return { ...f, idolTaken: true, archwayBlocked: true };
}
