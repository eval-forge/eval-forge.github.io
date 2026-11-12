import type { SceneId } from './economy';

/** Run flags that gate progression. */
export type Flag =
  | 'doorOpened'
  | 'hasSunDisc'
  | 'sundialSolved'
  | 'sanctumGateHeld'
  | 'sealOpen'
  | 'hasObsidianKey'
  | 'vaultOpen'
  | 'drawbridgeLowered'
  | 'wallKicked'
  | 'idolTaken';

export type Flags = Partial<Record<Flag, boolean>>;

export interface Edge {
  from: SceneId;
  to: SceneId;
  /** All of these flags must be set to traverse. Empty = free. */
  requires: Flag[];
  /** One-way edges (e.g. the cracked wall can only be kicked from one side). */
  oneWay?: boolean;
  label: string;
  shortcut?: boolean;
}

export const EDGES: Edge[] = [
  { from: 'jungle', to: 'courtyard', requires: [], label: 'rope bridge over the gorge' },
  { from: 'courtyard', to: 'cliffs', requires: [], label: 'cliff path (optional)' },
  { from: 'courtyard', to: 'halls', requires: ['doorOpened'], label: 'great door' },
  { from: 'halls', to: 'sanctum', requires: ['sanctumGateHeld'], label: 'sanctum gate (block on plate)' },
  { from: 'sanctum', to: 'catacombs', requires: ['sealOpen'], label: 'catacomb seal (sun-disc)' },
  { from: 'catacombs', to: 'vault', requires: ['vaultOpen'], label: 'vault door (obsidian key)' },
  { from: 'vault', to: 'catacombs', requires: ['drawbridgeLowered'], label: 'drawbridge to the servants\' passage', shortcut: true, oneWay: true },
  { from: 'catacombs', to: 'halls', requires: ['wallKicked'], label: 'kicked-down wall (servants\' passage)', shortcut: true, oneWay: true },
];

/** Which flag an action sets, and what it needs first. */
export const ACTIONS: Record<string, { sets: Flag; needs: Flag[] }> = {
  openDoor: { sets: 'doorOpened', needs: [] },
  solveSundial: { sets: 'sundialSolved', needs: [] },
  takeSunDisc: { sets: 'hasSunDisc', needs: ['sundialSolved'] },
  openSeal: { sets: 'sealOpen', needs: ['hasSunDisc'] },
  takeKey: { sets: 'hasObsidianKey', needs: [] },
  openVault: { sets: 'vaultOpen', needs: ['hasObsidianKey'] },
  lowerDrawbridge: { sets: 'drawbridgeLowered', needs: [] },
  kickWall: { sets: 'wallKicked', needs: [] },
};

export function canDo(action: keyof typeof ACTIONS, flags: Flags): boolean {
  const a = ACTIONS[action];
  return a.needs.every((f) => flags[f]);
}

export function doAction(action: keyof typeof ACTIONS, flags: Flags): Flags {
  if (!canDo(action, flags)) return flags;
  return { ...flags, [ACTIONS[action].sets]: true };
}

export function edgeOpen(e: Edge, flags: Flags): boolean {
  return e.requires.every((f) => flags[f]);
}

/** Scenes reachable from `start` with the given flags (BFS over open edges). */
export function reachable(start: SceneId, flags: Flags): Set<SceneId> {
  const seen = new Set<SceneId>([start]);
  const queue: SceneId[] = [start];
  while (queue.length) {
    const s = queue.shift()!;
    for (const e of EDGES) {
      if (!edgeOpen(e, flags)) continue;
      const nexts: SceneId[] = [];
      if (e.from === s) nexts.push(e.to);
      if (!e.oneWay && e.to === s) nexts.push(e.from);
      for (const n of nexts) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return seen;
}

/** True if a scene is unlocked (reachable from the jungle start). */
export function isUnlocked(scene: SceneId, flags: Flags): boolean {
  return reachable('jungle', flags).has(scene);
}

/** Graph neighbours, ignoring requirements. Used for streaming. */
export function neighbours(scene: SceneId): SceneId[] {
  const out = new Set<SceneId>();
  for (const e of EDGES) {
    if (e.from === scene) out.add(e.to);
    if (e.to === scene) out.add(e.from);
  }
  return [...out];
}

/** What the player needs next to go deeper, for HUD hints. */
export function nextObjective(flags: Flags): string {
  if (!flags.doorOpened) return 'Reach the temple courtyard and heave open the great door.';
  if (!flags.hasSunDisc) return flags.sundialSolved ? 'Take the sun-disc from the sundial plinth.' : 'Turn the courtyard sundial until the gnomon\'s shadow falls on the eye.';
  if (!flags.sanctumGateHeld && !flags.sealOpen) return 'Hold the sanctum gate open: push the stone block onto the plate.';
  if (!flags.sealOpen) return 'Set the sun-disc into the catacomb seal in the sanctum floor.';
  if (!flags.hasObsidianKey) return 'Find the obsidian key in the flooded chamber.';
  if (!flags.vaultOpen) return 'Unlock the vault door with the obsidian key.';
  return 'Grab what you can carry and get out through the great door before dark.';
}
