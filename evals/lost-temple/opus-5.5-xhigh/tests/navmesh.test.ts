import { describe, it, expect } from 'vitest';
import { NavMesh, NavRect } from '../src/logic/navmesh';

// An L-shaped corridor with a gated door and a ramp down to a lower room.
//   A (0..10 x 0..4)  →  B (6..10 x 4..20)  →  door D (6..10 x 20..21, gate 'door')  →  C (6..10 x 21..30)
//   Ramp R from A's west side (-12..0 x 0..4) dropping from y=0 to y=-6, into lower room L.
const rects: NavRect[] = [
  { x0: 0, z0: 0, x1: 10, z1: 4, y0: 0 },
  { x0: 6, z0: 4, x1: 10, z1: 20, y0: 0 },
  { x0: 6, z0: 20, x1: 10, z1: 21, y0: 0, gate: 'door' },
  { x0: 6, z0: 21, x1: 10, z1: 30, y0: 0 },
  { x0: -12, z0: 0, x1: 0, z1: 4, y0: -6, y1: 0, axis: 'x' },
  { x0: -24, z0: -4, x1: -12, z1: 8, y0: -6 },
  // an overlapping upper floor directly above the lower room, NOT connected to it
  { x0: -24, z0: -4, x1: -12, z1: 8, y0: 4 },
];

describe('navmesh', () => {
  const nav = new NavMesh(rects);

  it('links rectangles that share edges at the same height only', () => {
    expect(nav.links[0].map((l) => l.to).sort()).toEqual([1, 4]);
    expect(nav.links[6].length).toBe(0); // upper floor is isolated
  });

  it('finds the right polygon on stacked floors by height', () => {
    expect(nav.findPoly(-18, -6, 2)).toBe(5);
    expect(nav.findPoly(-18, 4, 2)).toBe(6);
  });

  it('paths around the corner instead of straight through the wall', () => {
    const path = nav.findPath({ x: 1, y: 0, z: 2 }, { x: 8, y: 0, z: 18 }, () => true)!;
    expect(path).not.toBeNull();
    // the path must bend at the inner corner (x≈6, z≈4)
    expect(path.length).toBeGreaterThanOrEqual(2);
    const corner = path[0];
    expect(corner.x).toBeGreaterThan(5.5);
    expect(corner.z).toBeLessThan(4.6);
    expect(path[path.length - 1]).toEqual({ x: 8, y: 0, z: 18 });
  });

  it('straight line when there is line of sight', () => {
    const path = nav.findPath({ x: 8, y: 0, z: 5 }, { x: 8, y: 0, z: 19 })!;
    expect(path.length).toBe(1);
  });

  it('respects closed gates', () => {
    const closed = nav.findPath({ x: 8, y: 0, z: 5 }, { x: 8, y: 0, z: 28 }, (g) => g !== 'door');
    expect(closed).toBeNull();
    const open = nav.findPath({ x: 8, y: 0, z: 5 }, { x: 8, y: 0, z: 28 }, () => true);
    expect(open).not.toBeNull();
  });

  it('follows ramps between levels and reports heights along the way', () => {
    const path = nav.findPath({ x: 8, y: 0, z: 2 }, { x: -20, y: -6, z: 2 })!;
    expect(path).not.toBeNull();
    const last = path[path.length - 1];
    expect(last.y).toBeCloseTo(-6);
    expect(NavMesh.heightAt(rects[4], -6, 2)).toBeCloseTo(-3);
  });

  it('cannot reach the isolated upper floor', () => {
    expect(nav.findPath({ x: 8, y: 0, z: 2 }, { x: -20, y: 4, z: 2 })).toBeNull();
  });

  it('snaps off-mesh targets to the closest point', () => {
    const c = nav.closestPoint({ x: 3, y: 0, z: 9 })!; // inside the wall block
    expect(c.poly === 0 || c.poly === 1).toBe(true);
  });
});
