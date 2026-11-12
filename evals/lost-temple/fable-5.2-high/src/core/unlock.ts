import type { SceneId } from './types';

/**
 * Everything that gates movement between scenes. Some flags are items, some are world state,
 * some are permanent shortcuts and some are damage the player did to their own way back.
 */
export interface Progress {
  hasSunDisc: boolean;
  /** Great Door released (the Sun Disc was lifted out of the sundial). */
  doorOpen: boolean;
  /** Great Door fully closed after dark. */
  doorSealed: boolean;
  /** A block (or the player) is holding the halls pressure plate down. */
  portcullisOpen: boolean;
  /** Sun Disc set into the catacomb seal. */
  sealOpen: boolean;
  hasSerpentKey: boolean;
  vaultOpen: boolean;
  /** The catacombs rope bridge still has enough planks to cross. */
  chasmBridgeIntact: boolean;
  drawbridgeDown: boolean;
  /** Shortcut: cracked wall between sanctum and cliffs kicked down. */
  kickEast: boolean;
  /** Shortcut: cracked wall at the top of the smugglers' stair kicked down. */
  kickSmuggler: boolean;
  /** The idol collapse has plugged the doorway between halls and sanctum. */
  rubblePlug: boolean;
  /** After dark the temple opens its inner gates for the guardians. */
  night: boolean;
}

export function newProgress(): Progress {
  return {
    hasSunDisc: false, doorOpen: false, doorSealed: false, portcullisOpen: false, sealOpen: false,
    hasSerpentKey: false, vaultOpen: false, chasmBridgeIntact: true, drawbridgeDown: false,
    kickEast: false, kickSmuggler: false, rubblePlug: false, night: false,
  };
}

export interface Edge {
  id: string;
  a: SceneId;
  b: SceneId;
  label: string;
  /** If true the edge can only be walked a → b. */
  oneWay?: boolean;
  open: (p: Progress) => boolean;
  /** Short hint shown when the way is shut. */
  hint: string;
}

export const EDGES: Edge[] = [
  { id: 'approach', a: 'jungle', b: 'courtyard', label: 'Jungle path', open: () => true, hint: '' },
  { id: 'greatDoor', a: 'courtyard', b: 'halls', label: 'Great Door',
    open: (p) => p.doorOpen && !p.doorSealed, hint: 'The Great Door is held by the sundial. Solve it and lift the Sun Disc.' },
  { id: 'breach', a: 'halls', b: 'cliffs', label: 'Vine breach', open: () => true, hint: '' },
  { id: 'portcullis', a: 'halls', b: 'sanctum', label: 'Portcullis',
    open: (p) => (p.portcullisOpen || p.night) && !p.rubblePlug, hint: 'The portcullis needs weight on the hall plate.' },
  { id: 'kickEast', a: 'sanctum', b: 'cliffs', label: 'Cracked east wall',
    open: (p) => p.kickEast, hint: 'The cracked wall could be kicked down.' },
  { id: 'sunSeal', a: 'sanctum', b: 'catacombs', label: 'Sun seal',
    open: (p) => p.sealOpen || p.night, hint: 'The seal has a socket shaped like a sun disc.' },
  { id: 'smugglers', a: 'catacombs', b: 'sanctum', label: "Smugglers' stair",
    open: (p) => p.kickSmuggler, hint: 'The stair ends at a cracked wall.' },
  { id: 'chasmBridge', a: 'catacombs', b: 'vault', label: 'Chasm rope bridge', oneWay: true,
    open: (p) => p.chasmBridgeIntact && (p.vaultOpen || p.night), hint: 'The vault door wants the Serpent Key.' },
  { id: 'drawbridge', a: 'vault', b: 'catacombs', label: 'Drawbridge',
    open: (p) => p.drawbridgeDown || p.night, hint: 'The drawbridge lever is on the vault side.' },
];

/** Can the player move from one scene directly into a neighbouring one right now? */
export function canTraverse(from: SceneId, to: SceneId, p: Progress): boolean {
  return EDGES.some((e) => {
    if (!e.open(p)) return false;
    if (e.a === from && e.b === to) return true;
    return !e.oneWay && e.b === from && e.a === to;
  });
}

export function neighbours(scene: SceneId): SceneId[] {
  const out = new Set<SceneId>();
  for (const e of EDGES) {
    if (e.a === scene) out.add(e.b);
    if (e.b === scene) out.add(e.a);
  }
  return [...out];
}

/** Every scene reachable from start with the current progress. */
export function reachable(start: SceneId, p: Progress): Set<SceneId> {
  const seen = new Set<SceneId>([start]);
  const queue: SceneId[] = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of neighbours(cur)) {
      if (!seen.has(n) && canTraverse(cur, n, p)) { seen.add(n); queue.push(n); }
    }
  }
  return seen;
}

/** Shortest scene route between two scenes with the current progress, or null if cut off. */
export function sceneRoute(from: SceneId, to: SceneId, p: Progress): SceneId[] | null {
  const prev = new Map<SceneId, SceneId | null>([[from, null]]);
  const queue: SceneId[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) {
      const path: SceneId[] = [];
      for (let c: SceneId | null = cur; c; c = prev.get(c) ?? null) path.unshift(c);
      return path;
    }
    for (const n of neighbours(cur)) {
      if (!prev.has(n) && canTraverse(cur, n, p)) { prev.set(n, cur); queue.push(n); }
    }
  }
  return null;
}

// --- State changes -------------------------------------------------------------

/** Lifting the Sun Disc out of the solved sundial is what releases the Great Door. */
export function takeSunDisc(p: Progress): void { p.hasSunDisc = true; p.doorOpen = true; }

export function useSunDiscOnSeal(p: Progress): boolean {
  if (!p.hasSunDisc || p.sealOpen) return false;
  p.sealOpen = true;
  return true;
}

export function useSerpentKey(p: Progress): boolean {
  if (!p.hasSerpentKey || p.vaultOpen) return false;
  p.vaultOpen = true;
  return true;
}

/**
 * Darkness: inner gates open for the guardians, the drawbridge drops, both cracked walls give way
 * and any rubble plugging the sanctum doorway is torn out.
 */
export function fallNight(p: Progress): void {
  p.night = true;
  p.sealOpen = true;
  p.vaultOpen = true;
  p.drawbridgeDown = true;
  p.kickEast = true;
  p.kickSmuggler = true;
  p.rubblePlug = false;
}

/** Sundial puzzle: is the dial's glyph lined up with the gnomon shadow? Angles in radians. */
export function sundialSolved(dialAngle: number, shadowAngle: number | null, tolerance = (12 * Math.PI) / 180): boolean {
  if (shadowAngle === null) return false;
  let d = (dialAngle - shadowAngle) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= tolerance;
}
