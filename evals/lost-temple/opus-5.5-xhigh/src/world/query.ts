/** Spatial lookups over the level description (no Three / Rapier needed). */
import { FLOORS, type FloorDef } from './layout';
import { NavMesh } from '../logic/navmesh';
import type { Exposure } from '../engine/materials';

/** The interior floor whose volume contains the point (feet height), if any. */
export function floorAt(x: number, y: number, z: number): FloorDef | null {
  let best: FloorDef | null = null;
  let bestDy = Infinity;
  for (const f of FLOORS) {
    if (f.kind === 'open') continue;
    if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
    const fy = NavMesh.heightAt(f, x, z);
    if (y < fy - 1.2 || y > fy + f.h) continue;
    const dy = Math.abs(y - fy);
    if (dy < bestDy) {
      bestDy = dy;
      best = f;
    }
  }
  return best;
}

/** Lighting class of a point: interior floors carry their own, everything else is outdoors. */
export function exposureAt(x: number, y: number, z: number): Exposure {
  const f = floorAt(x, y, z);
  return f ? f.exposure : 'outdoor';
}
