/**
 * Pure level data. A layout says where you can walk, what blocks the way,
 * where relics and guardians sit. No three, no rapier: the scene builders
 * turn this into geometry, and tests check it directly.
 */
import type { RelicId } from '../../core/economy';
import type { GuardianType } from '../../core/guardianFsm';
import type { NavObstacleDef, NavRectDef } from '../../core/navmesh';
import type { SceneId, Vec3Like } from '../../core/scenes';

/** World heights of the main floors. */
export const Y_COURT = 0;
export const Y_TEMPLE = 1.2;
export const Y_CATA = -8;
export const Y_VAULT = -14;

export interface FloorDef extends NavRectDef {
  /** Material key for the auto-built slab. */
  mat: string;
  /** Build a visible slab + collider for this rect (default true). */
  visual: boolean;
  /** Include in the navmesh (default true). */
  nav: boolean;
  /** Slab thickness below the walking surface. */
  thick: number;
  /** Ramps: draw as steps instead of a smooth incline. */
  steps: boolean;
}

export type PropDef =
  | {
      kind: 'pillar';
      x: number;
      z: number;
      r: number;
      y: number;
      h: number;
      /** 0..1: fraction of the height still standing (1 = intact). */
      standing: number;
      mat: string;
    }
  | { kind: 'block'; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; mat: string };

export type SpotMount = 'floor' | 'pedestal' | 'plinth';

export interface RelicSpotDef {
  id: string;
  scene: SceneId;
  tier: 1 | 2 | 3;
  fixed?: RelicId;
  /** Where the relic rests (its base). For pedestals this is the floor under the pedestal. */
  pos: Vec3Like;
  mount: SpotMount;
  /** Id of the trap this pedestal is wired to (pedestal mount only). */
  trap?: string;
}

export interface GuardianSpawnDef {
  id: string;
  type: GuardianType;
  scene: SceneId;
  pos: Vec3Like;
  /** Facing as a heading: atan2(x, z) of the look direction. */
  facing: number;
}

export interface Region {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
}

export interface SceneLayout {
  id: SceneId;
  /** Volumes that count as "inside this scene" for streaming and the HUD. */
  regions: Region[];
  floors: FloorDef[];
  obstacles: NavObstacleDef[];
  props: PropDef[];
  spots: RelicSpotDef[];
  guardians: GuardianSpawnDef[];
  /** Guardian sweep waypoints, ordered from deep toward the door. */
  sweep: Vec3Like[];
  /** Falling below this is fatal. */
  killY: number;
}

export interface FloorOpts {
  gate?: string;
  tag?: string;
  visual?: boolean;
  nav?: boolean;
  thick?: number;
  noCarve?: boolean;
  steps?: boolean;
}

export class LayoutBuilder {
  private layout: SceneLayout;

  constructor(id: SceneId, killY: number) {
    this.layout = { id, regions: [], floors: [], obstacles: [], props: [], spots: [], guardians: [], sweep: [], killY };
  }

  region(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): this {
    this.layout.regions.push({ x0, z0, x1, z1, y0, y1 });
    return this;
  }

  floor(x0: number, z0: number, x1: number, z1: number, y: number, mat: string, o: FloorOpts = {}): this {
    this.layout.floors.push({
      x0, z0, x1, z1, y, scene: this.layout.id, mat,
      gate: o.gate, tag: o.tag, noCarve: o.noCarve,
      visual: o.visual ?? true, nav: o.nav ?? true, thick: o.thick ?? 0.6, steps: false,
    });
    return this;
  }

  /** `yLow` is the height at the low-coordinate edge along `slope`, `yHigh` at the other. */
  ramp(
    x0: number, z0: number, x1: number, z1: number,
    yLow: number, yHigh: number, slope: 'x' | 'z', mat: string, o: FloorOpts = {},
  ): this {
    this.layout.floors.push({
      x0, z0, x1, z1, y: yLow, y2: yHigh, slope, scene: this.layout.id, mat,
      gate: o.gate, tag: o.tag, noCarve: o.noCarve ?? true,
      visual: o.visual ?? true, nav: o.nav ?? true, thick: o.thick ?? 0.6, steps: o.steps ?? true,
    });
    return this;
  }

  /** A column: blocks the navmesh and is drawn by the scene builder. */
  pillar(x: number, z: number, r: number, y: number, h: number, standing = 1, mat = 'pillar'): this {
    this.layout.props.push({ kind: 'pillar', x, z, r, y, h, standing, mat });
    this.layout.obstacles.push({ x0: x - r, z0: z - r, x1: x + r, z1: z + r, yMin: y, yMax: y + Math.max(1, h * standing) });
    return this;
  }

  /** A solid masonry block: blocks the navmesh and is drawn by the scene builder. */
  block(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat = 'templeStone'): this {
    this.layout.props.push({ kind: 'block', x0, z0, x1, z1, y0, y1, mat });
    this.layout.obstacles.push({ x0, z0, x1, z1, yMin: y0, yMax: y1 });
    return this;
  }

  /** Solid masonry that is drawn but does not carve the navmesh (it sits outside the floors). */
  mass(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat = 'templeStone'): this {
    this.layout.props.push({ kind: 'block', x0, z0, x1, z1, y0, y1, mat });
    return this;
  }

  /** Navmesh-only obstacle (the visual is built by hand in the scene). */
  obstacle(x0: number, z0: number, x1: number, z1: number, yMin: number, yMax: number): this {
    this.layout.obstacles.push({ x0, z0, x1, z1, yMin, yMax });
    return this;
  }

  spot(
    id: string, x: number, y: number, z: number, tier: 1 | 2 | 3,
    o: { fixed?: RelicId; mount?: SpotMount; trap?: string } = {},
  ): this {
    const mount = o.mount ?? 'floor';
    this.layout.spots.push({
      id: `${this.layout.id}.${id}`, scene: this.layout.id, tier, fixed: o.fixed, pos: { x, y, z }, mount, trap: o.trap,
    });
    // Pedestals and plinths are solid: keep guardians from walking through them.
    if (mount !== 'floor') this.layout.obstacles.push({ x0: x - 0.45, z0: z - 0.45, x1: x + 0.45, z1: z + 0.45, yMin: y, yMax: y + 1 });
    return this;
  }

  guardian(id: string, type: GuardianType, x: number, y: number, z: number, facing = 0): this {
    this.layout.guardians.push({ id: `${this.layout.id}.${id}`, type, scene: this.layout.id, pos: { x, y, z }, facing });
    return this;
  }

  sweep(x: number, y: number, z: number): this {
    this.layout.sweep.push({ x, y, z });
    return this;
  }

  done(): SceneLayout {
    return this.layout;
  }
}

export function regionContains(r: Region, p: Vec3Like, pad = 0): boolean {
  return (
    p.x >= r.x0 - pad && p.x <= r.x1 + pad && p.z >= r.z0 - pad && p.z <= r.z1 + pad && p.y >= r.y0 - pad && p.y <= r.y1 + pad
  );
}
