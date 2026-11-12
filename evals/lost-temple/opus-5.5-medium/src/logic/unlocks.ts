export type SceneId = 'jungle' | 'courtyard' | 'cliffs' | 'halls' | 'sanctum' | 'catacombs' | 'vault' | 'tunnel';

export interface UnlockFlags {
  sunDiscSolved: boolean; // sundial puzzle solved (sun-disc released)
  hallsGateOpen: boolean; // block on the halls plate
  sealOpen: boolean; // sun-disc placed in the catacomb seal
  vaultGateOpen: boolean; // bronze key used
  drawbridgeDown: boolean; // catacomb shortcut
  escapeOpen: boolean; // vault escape lever pulled
  wallKicked: boolean; // tunnel → halls shortcut
  greatDoorOpen: boolean; // false once closed at night
}

export const INITIAL_FLAGS: UnlockFlags = {
  sunDiscSolved: false, hallsGateOpen: false, sealOpen: false, vaultGateOpen: false,
  drawbridgeDown: false, escapeOpen: false, wallKicked: false, greatDoorOpen: true,
};

/** Edges in the scene graph with the flag that gates them (null = always open). */
export const EDGES: Array<{ a: SceneId; b: SceneId; gate: keyof UnlockFlags | null }> = [
  { a: 'jungle', b: 'courtyard', gate: null },
  { a: 'courtyard', b: 'cliffs', gate: null },
  { a: 'courtyard', b: 'halls', gate: 'greatDoorOpen' },
  { a: 'halls', b: 'sanctum', gate: 'hallsGateOpen' },
  { a: 'sanctum', b: 'catacombs', gate: 'sealOpen' },
  { a: 'catacombs', b: 'vault', gate: 'vaultGateOpen' },
  { a: 'vault', b: 'tunnel', gate: 'escapeOpen' },
  { a: 'tunnel', b: 'halls', gate: 'wallKicked' },
];

export function canPass(a: SceneId, b: SceneId, f: UnlockFlags): boolean {
  const e = EDGES.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  if (!e) return false;
  return e.gate === null || f[e.gate];
}

/** Scenes reachable from `start` given the flags (BFS). */
export function reachable(start: SceneId, f: UnlockFlags): Set<SceneId> {
  const seen = new Set<SceneId>([start]);
  const q: SceneId[] = [start];
  while (q.length) {
    const s = q.shift()!;
    for (const e of EDGES) {
      const other = e.a === s ? e.b : e.b === s ? e.a : null;
      if (other && !seen.has(other) && (e.gate === null || f[e.gate])) {
        seen.add(other);
        q.push(other);
      }
    }
  }
  return seen;
}

export type UnlockAction = 'solveSundial' | 'placeBlock' | 'insertSunDisc' | 'useBronzeKey' | 'pullDrawbridgeLever' | 'pullEscapeLever' | 'kickWall' | 'closeDoor';

export interface UnlockContext { hasSunDisc: boolean; hasBronzeKey: boolean; inTunnel: boolean }

/** Apply an action if its requirements hold. Returns the new flags or null if not allowed. */
export function applyUnlock(f: UnlockFlags, action: UnlockAction, ctx: UnlockContext): UnlockFlags | null {
  switch (action) {
    case 'solveSundial': return f.sunDiscSolved ? null : { ...f, sunDiscSolved: true };
    case 'placeBlock': return f.hallsGateOpen ? null : { ...f, hallsGateOpen: true };
    case 'insertSunDisc': return !f.sealOpen && ctx.hasSunDisc ? { ...f, sealOpen: true } : null;
    case 'useBronzeKey': return !f.vaultGateOpen && ctx.hasBronzeKey ? { ...f, vaultGateOpen: true } : null;
    case 'pullDrawbridgeLever': return f.drawbridgeDown ? null : { ...f, drawbridgeDown: true };
    case 'pullEscapeLever': return f.escapeOpen ? null : { ...f, escapeOpen: true };
    case 'kickWall': return !f.wallKicked && ctx.inTunnel ? { ...f, wallKicked: true } : null;
    case 'closeDoor': return { ...f, greatDoorOpen: false };
  }
}
