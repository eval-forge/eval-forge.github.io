/** Things in the loaded world that the player and guardians query every step. */
import type RAPIER from '@dimforge/rapier3d-compat';
import type { SceneId, Vec3Like } from '../core/scenes';

export interface Entity {
  /** Fixed 60 Hz step. */
  step?(dt: number): void;
  /** Once per rendered frame (visual sync, animation). */
  frame?(dt: number): void;
  dispose(): void;
}

export interface WaterVolume {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Height of the water surface. */
  surface: number;
  /** Velocity of the current (m/s) applied to anything wading or swimming. */
  current: Vec3Like;
  scene: SceneId;
}

/** A climbable strip of vines (or a rope) on a wall. */
export interface ClimbZone {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** Unit vector pointing out of the wall, toward the climber. */
  nx: number;
  nz: number;
  /** Climbing past the top puts you on the ledge behind the wall face. */
  topOut: boolean;
  /** A horizontal hand-line: you hang and shuffle sideways, there is no wall to lean on. */
  line?: boolean;
}

export interface WindSource {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  dir: Vec3Like;
  /** Current gust strength 0..1. */
  strength: number;
}

export interface SconceRef {
  pos: Vec3Like;
  lit: boolean;
  radius: number;
}

/** Anything a pressure plate can feel. */
export interface Weighted {
  body: RAPIER.RigidBody;
  mass: number;
  /** Half extent used to decide whether it rests on a plate. */
  half: number;
}

export class Registry {
  water: WaterVolume[] = [];
  climbs: ClimbZone[] = [];
  winds: WindSource[] = [];
  sconces: SconceRef[] = [];
  weights: Weighted[] = [];

  clear(): void {
    this.water.length = 0;
    this.climbs.length = 0;
    this.winds.length = 0;
    this.sconces.length = 0;
    this.weights.length = 0;
  }

  waterAt(x: number, z: number): WaterVolume | null {
    for (const w of this.water) if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1) return w;
    return null;
  }

  climbAt(p: Vec3Like, pad = 0.15): ClimbZone | null {
    for (const c of this.climbs) {
      if (p.x >= c.x0 - pad && p.x <= c.x1 + pad && p.z >= c.z0 - pad && p.z <= c.z1 + pad && p.y >= c.y0 - 1.2 && p.y <= c.y1 + 0.2) return c;
    }
    return null;
  }

  windAt(p: Vec3Like): WindSource | null {
    for (const w of this.winds) {
      if (w.strength > 0.01 && p.x >= w.x0 && p.x <= w.x1 && p.y >= w.y0 && p.y <= w.y1 && p.z >= w.z0 && p.z <= w.z1) return w;
    }
    return null;
  }
}

export function removeFrom<T>(list: T[], item: T): void {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}
