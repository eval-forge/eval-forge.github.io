/** Layout helpers shared by the interior scenes. */
import * as THREE from 'three';
import type { LevelBuilder } from '../LevelBuilder';
import type { MatKey } from '../../render/materials';

export type Gap = [number, number, number];

export interface RoomOpts {
  n?: Gap[] | 'open' | 'none';
  s?: Gap[] | 'open' | 'none';
  w?: Gap[] | 'open' | 'none';
  e?: Gap[] | 'open' | 'none';
  wall?: MatKey;
  floor?: MatKey | null;
  ceiling?: MatKey | null;
  /** Ceiling holes as [x0, z0, x1, z1]. */
  holes?: [number, number, number, number][];
  thick?: number;
  floorThick?: number;
}

/**
 * A rectangular room: floor top at y, walls of height h outside the rect, a ceiling slab.
 * 'open' skips a wall entirely, 'none' as well (wall built by a neighbour).
 */
export function room(b: LevelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, o: RoomOpts = {}) {
  const t = o.thick ?? 0.5;
  const wm = o.wall ?? 'dungeon';
  if (o.floor !== null) b.floor(x0, z0, x1, z1, y, o.floor ?? 'dungeonFloor', { thick: o.floorThick ?? 0.6 });
  const side = (g: Gap[] | 'open' | 'none' | undefined, f: (gaps: Gap[]) => void) => {
    if (g === 'open' || g === 'none') return;
    f(g ?? []);
  };
  side(o.n, (g) => b.wallX(x0 - t, x1 + t, z0 - t, z0, y, y + h, wm, g));
  side(o.s, (g) => b.wallX(x0 - t, x1 + t, z1, z1 + t, y, y + h, wm, g));
  side(o.w, (g) => b.wallZ(z0, z1, x0 - t, x0, y, y + h, wm, g));
  side(o.e, (g) => b.wallZ(z0, z1, x1, x1 + t, y, y + h, wm, g));
  if (o.ceiling !== null) ceiling(b, x0 - t, z0 - t, x1 + t, z1 + t, y + h, o.ceiling ?? wm, o.holes ?? []);
}

/** Ceiling slab with rectangular holes, split into boxes around them. */
export function ceiling(b: LevelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, mat: MatKey, holes: [number, number, number, number][], thick = 0.7) {
  // cut along z into bands at hole edges, then along x within each band
  const zs = new Set<number>([z0, z1]);
  for (const h of holes) {
    zs.add(Math.max(z0, Math.min(z1, h[1])));
    zs.add(Math.max(z0, Math.min(z1, h[3])));
  }
  const zl = [...zs].sort((a, b2) => a - b2);
  for (let i = 0; i < zl.length - 1; i++) {
    const za = zl[i];
    const zb = zl[i + 1];
    if (zb - za < 1e-3) continue;
    const zm = (za + zb) / 2;
    const cuts = holes.filter((h) => zm > h[1] && zm < h[3]).map((h) => [h[0], h[2]] as [number, number]).sort((a, b2) => a[0] - b2[0]);
    let cur = x0;
    for (const [hx0, hx1] of cuts) {
      if (hx0 > cur) b.box((cur + hx0) / 2, y + thick / 2, (za + zb) / 2, hx0 - cur, thick, zb - za, mat, { nav: 'none', vary: 0.04 });
      cur = Math.max(cur, hx1);
    }
    if (cur < x1) b.box((cur + x1) / 2, y + thick / 2, (za + zb) / 2, x1 - cur, thick, zb - za, mat, { nav: 'none', vary: 0.04 });
  }
}

/** Ramp height helper for a ramp along z from (zLow, yLow) to (zHigh, yHigh). */
export function rampY(z: number, za: number, ya: number, zb: number, yb: number) {
  return ya + ((z - za) / (zb - za)) * (yb - ya);
}

/** Stepped ceiling boxes over a ramp so headroom stays constant. */
export function rampCeiling(b: LevelBuilder, x0: number, x1: number, za: number, ya: number, zb: number, yb: number, head: number, mat: MatKey, step = 2) {
  const lo = Math.min(za, zb);
  const hi = Math.max(za, zb);
  for (let z = lo; z < hi - 1e-3; z += step) {
    const z2 = Math.min(hi, z + step);
    const y = Math.max(rampY(z, za, ya, zb, yb), rampY(z2, za, ya, zb, yb)) + head;
    b.box((x0 + x1) / 2, y + 0.4, (z + z2) / 2, x1 - x0 + 1, 0.8, z2 - z, mat, { nav: 'none', vary: 0.03 });
  }
}

/** Decorative niche shelves with skulls along a wall (zone C ossuary look). */
export function boneNiches(b: LevelBuilder, x0: number, x1: number, z: number, y: number, facing: 1 | -1) {
  for (let x = x0 + 0.6; x < x1 - 0.5; x += 1.4) {
    for (let k = 0; k < 2; k++) {
      const yy = y + 0.6 + k * 1.1;
      b.box(x, yy, z + facing * 0.2, 1.1, 0.12, 0.45, 'dungeon', { nav: 'none', collider: false });
      for (let s = 0; s < 3; s++) {
        const g = new THREE.SphereGeometry(0.11, 8, 6);
        g.scale(1, 0.9, 1.1);
        g.translate(x - 0.35 + s * 0.35, yy + 0.16, z + facing * 0.22);
        b.mesh(g, 'bone', { cast: false });
      }
    }
  }
}

/** Stepped walls for a ramp corridor so nothing pokes far above the local ceiling. */
export function rampWalls(b: LevelBuilder, xw0: number, xw1: number, za: number, ya: number, zb: number, yb: number, head: number, mat: MatKey = 'dungeon') {
  const lo = Math.min(za, zb);
  const hi = Math.max(za, zb);
  for (let z = lo; z < hi - 1e-3; z += 4) {
    const z2 = Math.min(hi, z + 4);
    const y0 = Math.min(rampY(z, za, ya, zb, yb), rampY(z2, za, ya, zb, yb)) - 1.2;
    const y1 = Math.max(rampY(z, za, ya, zb, yb), rampY(z2, za, ya, zb, yb)) + head + 0.8;
    b.wall(xw0 - 0.5, z, xw0, z2, y0, y1, mat, { nav: 'none' });
    b.wall(xw1, z, xw1 + 0.5, z2, y0, y1, mat, { nav: 'none' });
  }
}
