import type { V3 } from './types';

/** A hole in a roof: an axis-aligned rectangle at height y that lets the sun through. */
export interface RoofOpening { x1: number; z1: number; x2: number; z2: number; y: number; }

export interface Rect2 { x1: number; z1: number; x2: number; z2: number; }

/**
 * Is a point lit by direct sun through one of the roof openings?
 * Walks from the point toward the sun up to the roof plane and checks whether it leaves through a hole.
 * This is the same projection the shadow map renders, so safe lanes match what the player sees.
 */
export function isSunlit(px: number, py: number, pz: number, openings: readonly RoofOpening[], sun: V3): boolean {
  if (sun.y <= 0.03) return false;
  for (const o of openings) {
    if (o.y <= py) continue;
    const k = (o.y - py) / sun.y;
    const hx = px + sun.x * k, hz = pz + sun.z * k;
    if (hx >= o.x1 && hx <= o.x2 && hz >= o.z1 && hz <= o.z2) return true;
  }
  return false;
}

/** The patch of floor (at floorY) lit through an opening, or null when the sun is down. */
export function sunPatch(o: RoofOpening, floorY: number, sun: V3): Rect2 | null {
  if (sun.y <= 0.03) return null;
  const k = (o.y - floorY) / sun.y;
  const dx = -sun.x * k, dz = -sun.z * k;
  return { x1: o.x1 + dx, z1: o.z1 + dz, x2: o.x2 + dx, z2: o.z2 + dz };
}
