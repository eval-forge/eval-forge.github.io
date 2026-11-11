/**
 * THE LEVEL. One continuous world space (metres, y up, −z = north).
 *
 *   Jungle      z  70 … 178   (spawn at the south end)
 *   Courtyard   z   0 …  70   (great door in the facade at z = 0)
 *   Cliffs      x  42 …  90   (east of the courtyard)
 *   Halls       z −60 …   0   y = 0
 *   Sanctum     z −100 … −60  y = 0, plus the escape passage
 *   Catacombs   x −80 … −20   y = −10
 *   Vault       z −140 … −80  y = −14 (under the sanctum)
 *
 * Interiors (zones B and C) are described as floor rectangles. Walls, floors, ceilings
 * and the guardians' navmesh are all generated from this one list.
 */
import type { NavRect } from '../logic/navmesh';
import type { SceneId } from '../logic/unlocks';
import type { Exposure, SurfaceName } from '../engine/materials';
import type { SlotRoll } from '../logic/economy';

export interface FloorDef extends NavRect {
  id: string;
  scene: SceneId;
  /** Height of walls / ceiling above the floor. */
  h: number;
  ceiling: boolean;
  exposure: Exposure;
  floorMat?: SurfaceName;
  wallMat?: SurfaceName;
  /**
   * 'solid'   — normal floor: geometry + walls + navmesh
   * 'open'    — counts as open space for wall generation only (e.g. outside the door)
   * 'nav'     — navmesh only (a drawbridge that an entity provides)
   * 'entity'  — walls treat it as open space, but the floor itself is built by an entity
   */
  kind?: 'solid' | 'open' | 'nav' | 'entity';
  /** Excluded from the guardians' navmesh. */
  noNav?: boolean;
}

const B: Exposure = 'ruins';
const C: Exposure = 'dungeon';

export const FLOORS: FloorDef[] = [
  // ---------------------------------------------------------------- B1 Broken halls
  { id: 'door_out', scene: 'courtyard', x0: -3, z0: 0, x1: 3, z1: 2, y0: 0, h: 8, ceiling: false, exposure: 'outdoor', kind: 'open', noNav: true },
  { id: 'door', scene: 'halls', x0: -3, z0: -2, x1: 3, z1: 0, y0: 0, h: 8, ceiling: true, exposure: B, gate: 'greatDoor' },
  { id: 'h_entry', scene: 'halls', x0: -6, z0: -14, x1: 6, z1: -2, y0: 0, h: 10, ceiling: false, exposure: B },
  { id: 'h_south', scene: 'halls', x0: -24, z0: -22, x1: 24, z1: -14, y0: 0, h: 12, ceiling: false, exposure: B },
  { id: 'h_pit', scene: 'halls', x0: -22, z0: -34, x1: 22, z1: -22, y0: -8, h: 20, ceiling: false, exposure: B, floorMat: 'rock', noNav: true },
  { id: 'h_north', scene: 'halls', x0: -24, z0: -60, x1: 24, z1: -34, y0: 0, h: 12, ceiling: false, exposure: B },
  { id: 'h_gallery', scene: 'halls', x0: 24, z0: -40, x1: 30, z1: -16, y0: 0, h: 6, ceiling: true, exposure: B },

  // ---------------------------------------------------------------- B2 Collapsed sanctum
  { id: 'archway', scene: 'sanctum', x0: -3, z0: -62, x1: 3, z1: -60, y0: 0, h: 7, ceiling: true, exposure: B, gate: 'archway' },
  { id: 'kickwall', scene: 'sanctum', x0: 18, z0: -62, x1: 22, z1: -60, y0: 0, h: 4, ceiling: true, exposure: B, gate: 'kickWall' },
  { id: 's_main', scene: 'sanctum', x0: -16, z0: -96, x1: 16, z1: -62, y0: 0, h: 16, ceiling: false, exposure: B },
  { id: 's_side', scene: 'sanctum', x0: 16, z0: -72, x1: 24, z1: -62, y0: 0, h: 6, ceiling: true, exposure: B },
  // escape passage (dark, enclosed)
  { id: 'e_c', scene: 'sanctum', x0: 16, z0: -92, x1: 26, z1: -88, y0: 0, h: 4, ceiling: true, exposure: C },
  { id: 'e_c2', scene: 'sanctum', x0: 26, z0: -138, x1: 30, z1: -88, y0: 0, h: 4, ceiling: true, exposure: C },
  { id: 'e_ramp', scene: 'sanctum', x0: 6, z0: -138, x1: 26, z1: -134, y0: -14, y1: 0, axis: 'x', h: 4.5, ceiling: true, exposure: C },
  { id: 'p_north', scene: 'sanctum', x0: -6, z0: -140, x1: 6, z1: -132, y0: -14, h: 6, ceiling: true, exposure: C },
  { id: 'chasm', scene: 'vault', x0: -6, z0: -132, x1: 6, z1: -122, y0: -40, h: 34, ceiling: true, exposure: C, floorMat: 'rock', noNav: true },
  { id: 'drawbridge', scene: 'vault', x0: -3, z0: -132, x1: 3, z1: -122, y0: -14, h: 6, ceiling: false, exposure: C, kind: 'nav', gate: 'drawbridge' },

  // ---------------------------------------------------------------- C1 Lower catacombs
  { id: 'seal', scene: 'catacombs', x0: -26, z0: -50, x1: -24, z1: -46, y0: 0, h: 4, ceiling: true, exposure: C, gate: 'sunSeal' },
  { id: 'c_stair', scene: 'catacombs', x0: -44, z0: -50, x1: -26, z1: -46, y0: -10, y1: 0, axis: 'x', h: 4.5, ceiling: true, exposure: C },
  { id: 'c_landing', scene: 'catacombs', x0: -56, z0: -54, x1: -44, z1: -42, y0: -10, h: 5, ceiling: true, exposure: C },
  { id: 'c_darts', scene: 'catacombs', x0: -54, z0: -86, x1: -50, z1: -54, y0: -10, h: 3.5, ceiling: true, exposure: C },
  { id: 'c_floodpass', scene: 'catacombs', x0: -62, z0: -72, x1: -54, z1: -68, y0: -10, h: 3, ceiling: true, exposure: C },
  { id: 'f_e', scene: 'catacombs', x0: -65, z0: -78, x1: -62, z1: -60, y0: -10, h: 4, ceiling: true, exposure: C },
  { id: 'f_w', scene: 'catacombs', x0: -78, z0: -78, x1: -75, z1: -60, y0: -10, h: 4, ceiling: true, exposure: C },
  { id: 'f_n', scene: 'catacombs', x0: -75, z0: -78, x1: -65, z1: -75, y0: -10, h: 4, ceiling: true, exposure: C },
  { id: 'f_s', scene: 'catacombs', x0: -75, z0: -63, x1: -65, z1: -60, y0: -10, h: 4, ceiling: true, exposure: C },
  { id: 'f_basin', scene: 'catacombs', x0: -75, z0: -75, x1: -65, z1: -63, y0: -13, h: 7, ceiling: true, exposure: C, noNav: true },
  { id: 'cc_south', scene: 'catacombs', x0: -66, z0: -90, x1: -46, z1: -86, y0: -10, h: 6, ceiling: true, exposure: C },
  { id: 'cc_ledge', scene: 'catacombs', x0: -66, z0: -98, x1: -65, z1: -90, y0: -10, h: 6, ceiling: true, exposure: C },
  { id: 'cc_pit', scene: 'catacombs', x0: -65, z0: -98, x1: -46, z1: -90, y0: -17, h: 13, ceiling: true, exposure: C, floorMat: 'rock', noNav: true },
  { id: 'cc_north', scene: 'catacombs', x0: -66, z0: -104, x1: -46, z1: -98, y0: -10, h: 6, ceiling: true, exposure: C },
  { id: 'c_boulder', scene: 'catacombs', x0: -46, z0: -103, x1: -20, z1: -99, y0: -10, y1: -14, axis: 'x', h: 4.5, ceiling: true, exposure: C },
  { id: 'c_alcove', scene: 'catacombs', x0: -34, z0: -106, x1: -30, z1: -103, y0: -12.15, h: 3, ceiling: true, exposure: C },

  // ---------------------------------------------------------------- C2 Deep vault
  { id: 'vaultdoor', scene: 'vault', x0: -20, z0: -103, x1: -18, z1: -99, y0: -14, h: 4, ceiling: true, exposure: C, gate: 'vaultDoor' },
  { id: 'v_main', scene: 'vault', x0: -18, z0: -116, x1: 14, z1: -80, y0: -14, h: 7, ceiling: true, exposure: C },
  { id: 'v_north', scene: 'vault', x0: -3, z0: -122, x1: 3, z1: -116, y0: -14, h: 5, ceiling: true, exposure: C },
  { id: 'l_arch', scene: 'vault', x0: 14, z0: -108, x1: 16, z1: -104, y0: -14, h: 4, ceiling: true, exposure: C },
  { id: 'lair', scene: 'vault', x0: 16, z0: -114, x1: 32, z1: -98, y0: -14, h: 6, ceiling: true, exposure: C },
];

/** Fix ramp y ordering for NavRect semantics: y0 at min axis coord. */
for (const f of FLOORS) {
  if (f.axis && f.y1 !== undefined) {
    // all ramps above are authored with y0 at the min-x end already
  }
}

export const FLOOR_BY_ID: Record<string, FloorDef> = Object.fromEntries(FLOORS.map((f) => [f.id, f]));

/** Top of the space above a floor (wall/ceiling height) at a point. */
export function floorTop(f: FloorDef, y: number) {
  return y + f.h;
}

// ---------------------------------------------------------------- roofs over zone B

export interface RoofDef {
  scene: SceneId;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
  /** pieces of roof that can fall in the sanctum collapse */
  unstable?: boolean;
}

/** Split a rectangle minus axis-aligned holes into rectangles. */
export function rectMinusHoles(r: { x0: number; z0: number; x1: number; z1: number }, holes: { x0: number; z0: number; x1: number; z1: number }[]) {
  const xs = new Set([r.x0, r.x1]);
  const zs = new Set([r.z0, r.z1]);
  for (const h of holes) {
    xs.add(Math.max(r.x0, Math.min(r.x1, h.x0)));
    xs.add(Math.max(r.x0, Math.min(r.x1, h.x1)));
    zs.add(Math.max(r.z0, Math.min(r.z1, h.z0)));
    zs.add(Math.max(r.z0, Math.min(r.z1, h.z1)));
  }
  const X = [...xs].sort((a, b) => a - b);
  const Z = [...zs].sort((a, b) => a - b);
  const out: { x0: number; z0: number; x1: number; z1: number }[] = [];
  // grid cells, then merge along x per row
  for (let j = 0; j < Z.length - 1; j++) {
    let run: { x0: number; z0: number; x1: number; z1: number } | null = null;
    for (let i = 0; i < X.length - 1; i++) {
      const cx = (X[i] + X[i + 1]) / 2;
      const cz = (Z[j] + Z[j + 1]) / 2;
      const inHole = holes.some((h) => cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1);
      if (!inHole) {
        if (run && run.x1 === X[i]) run.x1 = X[i + 1];
        else {
          if (run) out.push(run);
          run = { x0: X[i], z0: Z[j], x1: X[i + 1], z1: Z[j + 1] };
        }
      } else if (run) {
        out.push(run);
        run = null;
      }
    }
    if (run) out.push(run);
  }
  return out;
}

export const ROOFS: RoofDef[] = [
  // entry hall: mostly roofed, a crack lets a blade of light in
  ...rectMinusHoles({ x0: -6, z0: -14, x1: 6, z1: -2 }, [{ x0: -1, z0: -11, x1: 1, z1: -5 }]).map((r) => ({ ...r, scene: 'halls' as SceneId, y: 10 })),
  // south hall: open slot over the middle (continues over the pit)
  ...rectMinusHoles({ x0: -24, z0: -22, x1: 24, z1: -14 }, [{ x0: -6, z0: -22, x1: 6, z1: -14 }, { x0: 14, z0: -20, x1: 19, z1: -16 }]).map((r) => ({ ...r, scene: 'halls' as SceneId, y: 12 })),
  // over the pit: roofed at the sides, open in the middle
  ...rectMinusHoles({ x0: -22, z0: -34, x1: 22, z1: -22 }, [{ x0: -6, z0: -34, x1: 6, z1: -22 }]).map((r) => ({ ...r, scene: 'halls' as SceneId, y: 12 })),
  // north hall: several caved-in holes
  ...rectMinusHoles({ x0: -24, z0: -60, x1: 24, z1: -34 }, [
    { x0: -6, z0: -40, x1: 6, z1: -34 },
    { x0: 9, z0: -53, x1: 17, z1: -44 },
    { x0: -19, z0: -58, x1: -12, z1: -51 },
    { x0: -14, z0: -44, x1: -9, z1: -38 },
  ]).map((r) => ({ ...r, scene: 'halls' as SceneId, y: 12 })),
  // sanctum: the middle collapsed (the idol's light well); the rest is unstable
  ...rectMinusHoles({ x0: -16, z0: -96, x1: 16, z1: -62 }, [{ x0: -9, z0: -92, x1: 9, z1: -74 }]).map((r) => ({ ...r, scene: 'sanctum' as SceneId, y: 16, unstable: true })),
];

/** Roof beams spanning the halls' open slot: they throw moving bars of shadow. */
export const BEAMS = [
  { scene: 'halls' as SceneId, x0: -6, x1: 6, z: -19, y: 12.3 },
  { scene: 'halls' as SceneId, x0: -6, x1: 6, z: -27.5, y: 12.3 },
  { scene: 'halls' as SceneId, x0: -6, x1: 6, z: -37, y: 12.3 },
];

// ---------------------------------------------------------------- scene regions

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** Checked in order: first match wins. */
export const REGIONS: { scene: SceneId; boxes: Box[] }[] = [
  { scene: 'vault', boxes: [{ x0: -21, x1: 34, y0: -45, y1: -8, z0: -132, z1: -78 }] },
  {
    scene: 'catacombs',
    boxes: [
      { x0: -82, x1: -20, y0: -22, y1: -3, z0: -108, z1: -40 },
      { x0: -45, x1: -24.5, y0: -12, y1: 3, z0: -51, z1: -45 },
    ],
  },
  { scene: 'sanctum', boxes: [{ x0: -20, x1: 34, y0: -20, y1: 25, z0: -142, z1: -60.2 }] },
  { scene: 'halls', boxes: [{ x0: -26, x1: 32, y0: -10, y1: 25, z0: -60.2, z1: 0.3 }] },
  { scene: 'cliffs', boxes: [{ x0: 41, x1: 95, y0: -80, y1: 40, z0: -30, z1: 70 }] },
  { scene: 'courtyard', boxes: [{ x0: -60, x1: 41, y0: -10, y1: 40, z0: 0.3, z1: 70 }] },
  { scene: 'jungle', boxes: [{ x0: -80, x1: 80, y0: -60, y1: 60, z0: 70, z1: 200 }] },
];

export function sceneAt(x: number, y: number, z: number): SceneId | null {
  for (const r of REGIONS) {
    for (const b of r.boxes) {
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1) return r.scene;
    }
  }
  return null;
}

// ---------------------------------------------------------------- key positions

export const SPAWN = { x: 0, y: 0.2, z: 168, yaw: 0 };
export const DOOR = { x: 0, y: 0, z: -1, inside: { x: 0, y: 0, z: -6 } };
export const CAMP = { x: -8, y: 0, z: 9 };
export const SUNDIAL = { x: 0, y: 0, z: 36, radius: 4.2, rimRadius: 3.55 };
export const DOOR_PLATE = { x: 8, y: 0, z: 10, half: 1.4 };
export const DOOR_BLOCK = { x: 17, y: 1.05, z: 10, half: 1.0 };
export const BRIDGE = { x: 0, zSouth: 99, zNorth: 83, y: 0, width: 2.4 };
export const RIVER = { z0: 127, z1: 141, surface: -0.45, bed: -1.9 };
export const GORGE = { z0: 83, z1: 99, floor: -14, water: -12 };
export const FALLEN_TREE = { x: -24, zSouth: 101, zNorth: 81, y: -0.1 };
export const SUN_SEAL = { x: -24.6, y: 0, z: -48 };
export const VAULT_DOOR = { x: -19, y: -14, z: -101 };
export const IDOL = { x: 0, y: 1.5, z: -83 };
export const DRAWBRIDGE = { x: 0, y: -14, zHinge: -122, zFar: -132, width: 6, lever: { x: 5, y: -14, z: -114.5 } };
export const KICK_WALL = { x: 20, y: 0, z: -61 };
export const BONE_KEY = { x: -70, y: -12.9, z: -69 };
export const FLOOD = { x0: -78, x1: -62, z0: -78, z1: -60, surface: -10.45 };
export const HALL_PIT = { x0: -22, x1: 22, z0: -34, z1: -22, floor: -8 };
export const BONE_PIT = { x0: -65, x1: -46, z0: -98, z1: -90, floor: -17 };
export const BOULDER = { start: { x: -43, y: -10 + 1.75, z: -101 }, plate: { x: -37, y: -10.6, z: -101 }, radius: 1.7 };

/** Sun-stones across the halls pit (z centres). */
export const SUN_STONES = { x: 0, w: 3.4, d: 2.2, zs: [-23.4, -25.8, -28.2, -30.6, -33.0] };

/** Swinging blades in the gallery (z positions). */
export const BLADES = [
  { x: 27, z: -21, phase: 0 },
  { x: 27, z: -25.5, phase: 1.3 },
  { x: 27, z: -30, phase: 2.6 },
  { x: 27, z: -34.5, phase: 0.7 },
];

/** Dart corridor plates and which wall holes they fire. */
export const DART_PLATES = [
  { z: -60, holes: [-58.5, -60, -61.5] },
  { z: -66.5, holes: [-65, -66.5, -68] },
  { z: -74, holes: [-72.5, -74, -75.5] },
  { z: -80.5, holes: [-79, -80.5, -82] },
];

/** Vines: climbable volumes. `n` is the wall normal (direction you face away from). */
export interface VineDef {
  scene: SceneId;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  n: [number, number];
}

/** Cliff ledges: x0..x1 out from the face at x = 42, top height y. */
export const LEDGES: { x0: number; x1: number; z0: number; z1: number; y: number }[] = [
  { x0: 42, x1: 47, z0: 27, z1: 37, y: 0 }, // start, through the gap in the balustrade
  { x0: 42, x1: 45, z0: 39, z1: 43, y: -1.2 },
  { x0: 42, x1: 44.5, z0: 44.5, z1: 48, y: -2.6 },
  { x0: 42, x1: 46.5, z0: 49.5, z1: 53, y: -4.2 },
  { x0: 42, x1: 45, z0: 54.5, z1: 62, y: -5.8 },
  { x0: 42, x1: 47, z0: 62.5, z1: 69, y: -7.6 },
  { x0: 42, x1: 45, z0: 20, z1: 25, y: 0.6 },
  { x0: 42, x1: 46, z0: 11, z1: 18, y: -0.4 },
  { x0: 42, x1: 44.5, z0: 1, z1: 9, y: 0.4 },
  { x0: 42, x1: 47, z0: -12, z1: 1, y: 8 }, // the rock pillar
];

export const VINES: VineDef[] = [
  // gorge: south wall back up to the jungle
  { scene: 'jungle', x0: -8, x1: -4, y0: -14, y1: 0.3, z0: 98.4, z1: 99.4, n: [0, -1] },
  // halls pit: climb out on the south side
  { scene: 'halls', x0: -14, x1: -10, y0: -8, y1: 0.3, z0: -22.6, z1: -21.6, n: [0, -1] },
  // cliffs: from the lowest ledge back up to the courtyard
  { scene: 'cliffs', x0: 41.5, x1: 42.5, y0: -7.6, y1: 0.3, z0: 63.5, z1: 67.5, n: [1, 0] },
  // cliffs: up the south face of the rock pillar
  { scene: 'cliffs', x0: 43, x1: 46, y0: 0.4, y1: 8.3, z0: 0.5, z1: 1.5, n: [0, 1] },
  // bone pit: climb out north
  { scene: 'catacombs', x0: -58, x1: -54, y0: -17, y1: -9.7, z0: -98.6, z1: -97.6, n: [0, 1] },
];

// ---------------------------------------------------------------- relic slots

export interface RelicSlot {
  id: string;
  scene: SceneId;
  x: number;
  y: number;
  z: number;
  roll: SlotRoll;
  /** weight-plate pedestal */
  trapped?: 'darts' | 'blades' | 'collapse' | 'boulder';
  pedestal?: boolean;
}

export const RELIC_SLOTS: RelicSlot[] = [
  // A1 jungle
  { id: 'j1', scene: 'jungle', x: 9, y: 0.6, z: 156, roll: { zone: 'A', maxWeight: 4 } },
  { id: 'j2', scene: 'jungle', x: -14, y: 0.5, z: 146, roll: { zone: 'A' } },
  { id: 'j3', scene: 'jungle', x: 16, y: 0.4, z: 121, roll: { zone: 'A' } },
  { id: 'j4', scene: 'jungle', x: -11, y: 0.4, z: 106, roll: { zone: 'A', minRarity: 'uncommon' } },
  // A2 courtyard
  { id: 'c1', scene: 'courtyard', x: -24, y: 0.9, z: 52, roll: { zone: 'A' }, pedestal: true },
  { id: 'c2', scene: 'courtyard', x: 26, y: 0.9, z: 50, roll: { zone: 'A' }, pedestal: true },
  { id: 'c3', scene: 'courtyard', x: -30, y: 0.4, z: 18, roll: { zone: 'A' } },
  { id: 'c4', scene: 'courtyard', x: 30, y: 0.4, z: 22, roll: { zone: 'A', minRarity: 'uncommon' } },
  { id: 'c5', scene: 'courtyard', x: -12, y: 0.4, z: 62, roll: { zone: 'A' } },
  // A3 cliffs (exposed: rare-weighted)
  { id: 'k1', scene: 'cliffs', x: 44.5, y: 0.0, z: 14, roll: { zone: 'A', minRarity: 'uncommon' } },
  { id: 'k2', scene: 'cliffs', x: 44.5, y: 8.4, z: -6, roll: { zone: 'A', minRarity: 'rare' } },
  { id: 'k3', scene: 'cliffs', x: 45, y: -7.2, z: 66, roll: { zone: 'A', minRarity: 'rare' } },
  { id: 'k4', scene: 'cliffs', x: 44, y: -5.4, z: 58, roll: { zone: 'A', minRarity: 'uncommon' } },
  // B1 halls
  { id: 'h1', scene: 'halls', x: -20, y: 0.4, z: -17, roll: { zone: 'B' } },
  { id: 'h2', scene: 'halls', x: 20, y: 0.4, z: -18, roll: { zone: 'B' } },
  { id: 'h3', scene: 'halls', x: -18, y: 1.15, z: -56, roll: { zone: 'B' }, pedestal: true },
  { id: 'h4', scene: 'halls', x: 18, y: 1.15, z: -56, roll: { zone: 'B', minRarity: 'rare', maxWeight: 6 }, pedestal: true, trapped: 'darts' },
  { id: 'h5', scene: 'halls', x: 27, y: 0.4, z: -38, roll: { zone: 'B', minRarity: 'uncommon' } },
  { id: 'h6', scene: 'halls', x: -13, y: -7.6, z: -31, roll: { zone: 'B', minRarity: 'uncommon' } },
  { id: 'h7', scene: 'halls', x: -10, y: 0.4, z: -44, roll: { zone: 'B' } },
  // B2 sanctum
  { id: 'idol', scene: 'sanctum', x: IDOL.x, y: IDOL.y + 0.35, z: IDOL.z, roll: { zone: 'B', fixed: 'sun_idol' }, pedestal: true, trapped: 'collapse' },
  { id: 's1', scene: 'sanctum', x: -13, y: 1.15, z: -93, roll: { zone: 'B', minRarity: 'uncommon' }, pedestal: true },
  { id: 's2', scene: 'sanctum', x: 13, y: 1.15, z: -93, roll: { zone: 'B', minRarity: 'rare', maxWeight: 5 }, pedestal: true, trapped: 'darts' },
  { id: 's3', scene: 'sanctum', x: -13, y: 0.4, z: -66, roll: { zone: 'B' } },
  { id: 's4', scene: 'sanctum', x: 21, y: 0.4, z: -68, roll: { zone: 'B' } },
  { id: 's5', scene: 'sanctum', x: 12, y: 0.4, z: -76, roll: { zone: 'B' } },
  // C1 catacombs
  { id: 'cc1', scene: 'catacombs', x: -54, y: -9.6, z: -44, roll: { zone: 'C' } },
  { id: 'cc2', scene: 'catacombs', x: -52, y: -9.6, z: -84.5, roll: { zone: 'C', minRarity: 'uncommon' } },
  { id: 'cc3', scene: 'catacombs', x: -76.5, y: -9.6, z: -76.5, roll: { zone: 'C', minRarity: 'uncommon' } },
  { id: 'cc4', scene: 'catacombs', x: -66, y: -12.6, z: -72, roll: { zone: 'C' } },
  { id: 'cc5', scene: 'catacombs', x: -55, y: -16.6, z: -94, roll: { zone: 'C', minRarity: 'rare' } },
  { id: 'cc6', scene: 'catacombs', x: -62, y: -9.6, z: -102, roll: { zone: 'C' } },
  { id: 'cc7', scene: 'catacombs', x: -32, y: -11.75, z: -105, roll: { zone: 'C', minRarity: 'rare' } },
  { id: 'cc8', scene: 'catacombs', x: -48, y: -8.85, z: -48, roll: { zone: 'C', minRarity: 'uncommon', maxWeight: 6 }, pedestal: true, trapped: 'darts' },
  // C2 vault
  { id: 'v1', scene: 'vault', x: -12, y: -12.85, z: -86, roll: { zone: 'C', allowLegendary: true }, pedestal: true },
  { id: 'v2', scene: 'vault', x: 8, y: -12.85, z: -86, roll: { zone: 'C', allowLegendary: true }, pedestal: true },
  { id: 'v3', scene: 'vault', x: -12, y: -12.85, z: -98, roll: { zone: 'C', minRarity: 'rare', allowLegendary: true }, pedestal: true, trapped: 'darts' },
  { id: 'v4', scene: 'vault', x: 8, y: -12.85, z: -98, roll: { zone: 'C', minRarity: 'rare', allowLegendary: true }, pedestal: true, trapped: 'darts' },
  { id: 'v5', scene: 'vault', x: -2, y: -12.85, z: -108, roll: { zone: 'C', minRarity: 'epic', allowLegendary: true }, pedestal: true, trapped: 'collapse' },
  { id: 'v6', scene: 'vault', x: -15, y: -13.6, z: -112, roll: { zone: 'C', allowLegendary: true } },
  { id: 'v7', scene: 'vault', x: 11, y: -13.6, z: -112, roll: { zone: 'C', allowLegendary: true } },
  { id: 'v8', scene: 'vault', x: -15, y: -13.6, z: -83, roll: { zone: 'C' } },
  { id: 'v9', scene: 'vault', x: 24, y: -13.6, z: -112, roll: { zone: 'C', minRarity: 'epic', allowLegendary: true } },
];

// ---------------------------------------------------------------- props (for weight swaps and decoys)

export interface PropDef {
  id: string;
  scene: SceneId;
  kind: 'sandbag' | 'rock' | 'pot' | 'oil' | 'spareTorch';
  x: number;
  y: number;
  z: number;
  weight: number;
}

export const PROPS: PropDef[] = [
  // courtyard
  { id: 'pc1', scene: 'courtyard', kind: 'pot', x: -6, y: 0.5, z: 14, weight: 2.5 },
  { id: 'pc2', scene: 'courtyard', kind: 'rock', x: 12, y: 0.4, z: 30, weight: 3 },
  { id: 'pc3', scene: 'courtyard', kind: 'oil', x: CAMP.x + 1.5, y: 0.3, z: CAMP.z + 0.5, weight: 0.8 },
  // halls
  { id: 'ph1', scene: 'halls', kind: 'sandbag', x: 16, y: 0.4, z: -52, weight: 3.5 },
  { id: 'ph2', scene: 'halls', kind: 'sandbag', x: 19.5, y: 0.4, z: -50, weight: 5 },
  { id: 'ph3', scene: 'halls', kind: 'rock', x: -4, y: 0.4, z: -16, weight: 2 },
  { id: 'ph4', scene: 'halls', kind: 'pot', x: 4, y: 0.4, z: -12, weight: 1.5 },
  { id: 'ph5', scene: 'halls', kind: 'pot', x: -20, y: 0.4, z: -40, weight: 4 },
  { id: 'ph6', scene: 'halls', kind: 'oil', x: 22, y: 0.3, z: -58, weight: 0.8 },
  { id: 'ph7', scene: 'halls', kind: 'spareTorch', x: -22, y: 0.3, z: -36, weight: 0.6 },
  // sanctum
  { id: 'ps1', scene: 'sanctum', kind: 'sandbag', x: 6, y: 0.4, z: -70, weight: 7.5 },
  { id: 'ps2', scene: 'sanctum', kind: 'sandbag', x: -6, y: 0.4, z: -70, weight: 6.5 },
  { id: 'ps3', scene: 'sanctum', kind: 'rock', x: -10, y: 0.4, z: -78, weight: 8 },
  { id: 'ps4', scene: 'sanctum', kind: 'sandbag', x: 10, y: 0.4, z: -90, weight: 3 },
  { id: 'ps5', scene: 'sanctum', kind: 'pot', x: 20, y: 0.4, z: -64, weight: 2 },
  // catacombs
  { id: 'pk1', scene: 'catacombs', kind: 'oil', x: -46, y: -9.7, z: -44, weight: 0.8 },
  { id: 'pk2', scene: 'catacombs', kind: 'sandbag', x: -50, y: -9.6, z: -52, weight: 4 },
  { id: 'pk3', scene: 'catacombs', kind: 'pot', x: -63.5, y: -9.6, z: -62, weight: 2 },
  { id: 'pk4', scene: 'catacombs', kind: 'spareTorch', x: -60, y: -9.7, z: -70.5, weight: 0.6 },
  { id: 'pk5', scene: 'catacombs', kind: 'rock', x: -48, y: -9.6, z: -88, weight: 5 },
  { id: 'pk6', scene: 'catacombs', kind: 'oil', x: -64, y: -9.7, z: -101, weight: 0.8 },
  // vault
  { id: 'pv1', scene: 'vault', kind: 'sandbag', x: -4, y: -13.6, z: -84, weight: 5 },
  { id: 'pv2', scene: 'vault', kind: 'sandbag', x: 0, y: -13.6, z: -84, weight: 9 },
  { id: 'pv3', scene: 'vault', kind: 'sandbag', x: 4, y: -13.6, z: -84, weight: 14 },
  { id: 'pv4', scene: 'vault', kind: 'rock', x: -16, y: -13.6, z: -104, weight: 4.5 },
  { id: 'pv5', scene: 'vault', kind: 'rock', x: 12, y: -13.6, z: -104, weight: 6 },
  { id: 'pv6', scene: 'vault', kind: 'sandbag', x: 12, y: -13.6, z: -92, weight: 18 },
  { id: 'pv7', scene: 'vault', kind: 'pot', x: -16, y: -13.6, z: -92, weight: 3.5 },
  { id: 'pv8', scene: 'vault', kind: 'oil', x: 2, y: -13.7, z: -118, weight: 0.8 },
  { id: 'pv9', scene: 'vault', kind: 'spareTorch', x: -2, y: -13.7, z: -118, weight: 0.6 },
];

// ---------------------------------------------------------------- guardian spawns (dormant statues)

export const GUARDIAN_SPAWNS: Record<'vault' | 'catacombs' | 'sanctum' | 'halls', { x: number; y: number; z: number }[]> = {
  vault: [
    { x: 20, y: -14, z: -102 },
    { x: 24, y: -14, z: -110 },
    { x: 28, y: -14, z: -102 },
  ],
  catacombs: [
    { x: -62, y: -10, z: -101 },
    { x: -50, y: -10, z: -48 },
  ],
  sanctum: [{ x: 0, y: 0, z: -66 }],
  halls: [{ x: -18, y: 0, z: -46 }],
};
