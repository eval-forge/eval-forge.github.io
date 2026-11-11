/**
 * The scene graph and what opens each edge. Pure rules.
 * Unit-tested in tests/unlock.test.ts.
 */
import type { SceneId } from './scenes';

/** Things that are true about the current run. */
export type Flag =
  | 'sunDisc' // the courtyard sundial has given up the Sun Disc
  | 'sealOpen' // Sun Disc placed in the catacomb seal
  | 'sanctumDoor' // both plates in the Broken Halls are held down
  | 'serpentKey' // taken from the altar in the flooded chamber
  | 'vaultGate' // Serpent Key used on the vault gate
  | 'escapeStair' // lever pulled on the vault side
  | 'wallKicked' // cracked wall kicked out from the sanctum side
  | 'drawbridge' // winch turned on the terrace
  | 'sealsBroken' // darkness: the temple opens every seal for its guardians
  | 'doorBuried'; // sanctum collapse has buried the door to the halls

/** The terrace is part of the courtyard scene but is its own island until the drawbridge drops. */
export type NodeId = SceneId | 'terrace';

export type Gate =
  | 'seal'
  | 'sanctumDoor'
  | 'vaultGate'
  | 'lairGate'
  | 'escapeStair'
  | 'kickWall'
  | 'drawbridge';

export type FlagSet = ReadonlySet<Flag>;

/** Is a physical gate passable given the run flags? Used by doors and by the navmesh. */
export function gateOpen(gate: Gate, flags: FlagSet): boolean {
  switch (gate) {
    case 'seal':
      return flags.has('sealOpen') || flags.has('sealsBroken');
    case 'sanctumDoor':
      return (flags.has('sanctumDoor') || flags.has('sealsBroken')) && !flags.has('doorBuried');
    case 'vaultGate':
      return flags.has('vaultGate') || flags.has('sealsBroken');
    case 'lairGate':
      return flags.has('sealsBroken');
    case 'escapeStair':
      return flags.has('escapeStair');
    case 'kickWall':
      return flags.has('wallKicked');
    case 'drawbridge':
      return flags.has('drawbridge');
  }
}

export const ALL_GATES: Gate[] = ['seal', 'sanctumDoor', 'vaultGate', 'lairGate', 'escapeStair', 'kickWall', 'drawbridge'];

export interface Edge {
  a: NodeId;
  b: NodeId;
  /** null = always open. */
  gate: Gate | null;
  label: string;
  /** 'in' edges are how you go deeper; 'out' edges are the purpose-built escape route. */
  role: 'in' | 'out' | 'optional';
  /** Rough walking distance in metres (used to compare routes). */
  metres: number;
}

export const EDGES: Edge[] = [
  { a: 'jungle', b: 'courtyard', gate: null, label: 'Great door', role: 'in', metres: 110 },
  { a: 'courtyard', b: 'cliffs', gate: null, label: 'Cliff gate', role: 'optional', metres: 35 },
  { a: 'courtyard', b: 'halls', gate: null, label: 'Temple portal', role: 'in', metres: 40 },
  { a: 'halls', b: 'sanctum', gate: 'sanctumDoor', label: 'Sanctum door', role: 'in', metres: 40 },
  { a: 'halls', b: 'catacombs', gate: 'seal', label: 'Catacomb seal', role: 'in', metres: 65 },
  { a: 'catacombs', b: 'vault', gate: 'vaultGate', label: 'Vault gate', role: 'in', metres: 85 },
  { a: 'vault', b: 'sanctum', gate: 'escapeStair', label: 'Escape stair', role: 'out', metres: 60 },
  { a: 'sanctum', b: 'terrace', gate: 'kickWall', label: 'Kicked wall', role: 'out', metres: 25 },
  { a: 'terrace', b: 'courtyard', gate: 'drawbridge', label: 'Drawbridge', role: 'out', metres: 45 },
];

export function edgeOpen(edge: Edge, flags: FlagSet): boolean {
  return edge.gate === null || gateOpen(edge.gate, flags);
}

/** Everything reachable from `from` with the given flags. */
export function reachable(from: NodeId, flags: FlagSet): Set<NodeId> {
  const seen = new Set<NodeId>([from]);
  const queue: NodeId[] = [from];
  while (queue.length) {
    const n = queue.shift()!;
    for (const e of EDGES) {
      if (!edgeOpen(e, flags)) continue;
      const other = e.a === n ? e.b : e.b === n ? e.a : null;
      if (other && !seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return seen;
}

/** Shortest node path by walking distance, or null if cut off. */
export function route(from: NodeId, to: NodeId, flags: FlagSet): NodeId[] | null {
  const dist = new Map<NodeId, number>([[from, 0]]);
  const prev = new Map<NodeId, NodeId | null>([[from, null]]);
  const done = new Set<NodeId>();
  for (;;) {
    let cur: NodeId | null = null;
    let best = Infinity;
    for (const [n, d] of dist) {
      if (!done.has(n) && d < best) {
        best = d;
        cur = n;
      }
    }
    if (cur === null) return null;
    if (cur === to) break;
    done.add(cur);
    for (const e of EDGES) {
      if (!edgeOpen(e, flags)) continue;
      const other = e.a === cur ? e.b : e.b === cur ? e.a : null;
      if (!other || done.has(other)) continue;
      const nd = best + e.metres;
      if (nd < (dist.get(other) ?? Infinity)) {
        dist.set(other, nd);
        prev.set(other, cur);
      }
    }
  }
  const path: NodeId[] = [];
  let c: NodeId | null = to;
  while (c) {
    path.unshift(c);
    c = prev.get(c) ?? null;
  }
  return path;
}

/** Walking distance of a node path. */
export function routeMetres(path: readonly NodeId[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) {
    const e = EDGES.find((x) => (x.a === path[i - 1] && x.b === path[i]) || (x.b === path[i - 1] && x.a === path[i]));
    m += e ? e.metres : 0;
  }
  return m;
}

/** Where each flag can be earned and what you must already have. */
export interface Unlockable {
  flag: Flag;
  at: NodeId;
  needs: Flag[];
  how: string;
}

export const UNLOCKABLES: Unlockable[] = [
  { flag: 'sunDisc', at: 'courtyard', needs: [], how: 'Align the sundial ring with the gnomon shadow' },
  { flag: 'sealOpen', at: 'halls', needs: ['sunDisc'], how: 'Set the Sun Disc into the catacomb seal' },
  { flag: 'sanctumDoor', at: 'halls', needs: [], how: 'Push both stone blocks onto the pressure plates' },
  { flag: 'serpentKey', at: 'catacombs', needs: [], how: 'Take the key from the altar in the flooded chamber' },
  { flag: 'vaultGate', at: 'catacombs', needs: ['serpentKey'], how: 'Unlock the vault gate with the Serpent Key' },
  { flag: 'escapeStair', at: 'vault', needs: [], how: 'Pull the lever beside the stair door' },
  { flag: 'wallKicked', at: 'sanctum', needs: [], how: 'Kick out the cracked wall' },
  { flag: 'drawbridge', at: 'terrace', needs: [], how: 'Turn the winch to lower the drawbridge' },
];

export interface ProgressionResult {
  /** Flags in the order a player can earn them. */
  order: Flag[];
  reachable: Set<NodeId>;
}

/**
 * Greedy closure: from the start, keep earning every flag whose location is
 * reachable and whose prerequisites are met. Proves the graph has no deadlock.
 */
export function solveProgression(start: NodeId = 'jungle', initial: Flag[] = []): ProgressionResult {
  const flags = new Set<Flag>(initial);
  const order: Flag[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    const here = reachable(start, flags);
    for (const u of UNLOCKABLES) {
      if (flags.has(u.flag)) continue;
      if (!here.has(u.at)) continue;
      if (!u.needs.every((n) => flags.has(n))) continue;
      flags.add(u.flag);
      order.push(u.flag);
      changed = true;
    }
  }
  return { order, reachable: reachable(start, flags) };
}

/** Which scene a node streams as. */
export const sceneOfNode = (n: NodeId): SceneId => (n === 'terrace' ? 'courtyard' : n);
