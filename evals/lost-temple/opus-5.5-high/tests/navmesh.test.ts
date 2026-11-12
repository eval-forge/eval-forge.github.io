import { describe, it, expect } from 'vitest';
import { NavMesh, rectPoly, rampPoly, pathLength, funnel } from '../src/logic/navmesh';

// L-shaped corridor: east along z∈[0,2] from x=0..10, then north (−z) along x∈[8,10] to z=-10
const L = () => new NavMesh([
  rectPoly(0, 0, 8, 2, 0),
  rectPoly(8, 0, 10, 2, 0),
  rectPoly(8, -10, 10, 0, 0),
]);

describe('navmesh', () => {
  it('builds portals between touching rectangles', () => {
    const m = L();
    expect(m.polys[0].portals.map((p) => p.to)).toEqual([1]);
    expect(m.polys[1].portals.map((p) => p.to).sort()).toEqual([0, 2]);
  });

  it('A* finds a corridor and funnel cuts the inside corner', () => {
    const m = L();
    const path = m.findPath({ x: 1, y: 0, z: 1 }, { x: 9, y: 0, z: -9 })!;
    expect(path).not.toBeNull();
    expect(path[0]).toMatchObject({ x: 1, z: 1 });
    expect(path[path.length - 1]).toMatchObject({ x: 9, z: -9 });
    // must bend at the inside corner (8, 0), not go straight through the wall
    const corner = path.find((p) => Math.abs(p.x - 8) < 1e-6 && Math.abs(p.z - 0) < 1e-6);
    expect(corner).toBeTruthy();
    expect(path.length).toBe(3);
    // shorter than walking through centroids
    expect(pathLength(path)).toBeLessThan(7.2 + 9.1 + 0.01);
  });

  it('works for the mirrored corner too', () => {
    const m = new NavMesh([rectPoly(0, 0, 8, 2, 0), rectPoly(8, 0, 10, 2, 0), rectPoly(8, 2, 10, 12, 0)]);
    const path = m.findPath({ x: 1, y: 0, z: 1 }, { x: 9, y: 0, z: 11 })!;
    expect(path.length).toBe(3);
    expect(path[1].x).toBeCloseTo(8);
    expect(path[1].z).toBeCloseTo(2);
  });

  it('straight line when visible', () => {
    const m = new NavMesh([rectPoly(0, 0, 5, 5, 0), rectPoly(5, 0, 10, 5, 0)]);
    const path = m.findPath({ x: 1, y: 0, z: 1 }, { x: 9, y: 0, z: 4 })!;
    expect(path.length).toBe(2);
  });

  it('respects gates', () => {
    const m = new NavMesh([rectPoly(0, 0, 4, 4, 0), rectPoly(4, 0, 8, 4, 0, { gate: 'bridge' }), rectPoly(8, 0, 12, 4, 0)]);
    expect(m.findPath({ x: 1, y: 0, z: 1 }, { x: 11, y: 0, z: 1 }, (p) => p.gate !== 'bridge')).toBeNull();
    expect(m.findPath({ x: 1, y: 0, z: 1 }, { x: 11, y: 0, z: 1 })).not.toBeNull();
  });

  it('ramps connect floors at different heights and the path follows the slope', () => {
    const m = new NavMesh([
      rectPoly(0, 0, 4, 4, 0),
      rampPoly(4, 0, 12, 4, 'x', 0, -8),
      rectPoly(12, 0, 16, 4, -8),
    ]);
    const path = m.findPath({ x: 1, y: 0, z: 2 }, { x: 15, y: -8, z: 2 })!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1].y).toBeCloseTo(-8);
    expect(m.heightAt(8, -4, 2)).toBeCloseTo(-4);
  });

  it('does not connect stacked floors that only overlap in plan', () => {
    const m = new NavMesh([rectPoly(0, 0, 4, 4, 0), rectPoly(4, 0, 8, 4, -12)]);
    expect(m.polys[0].portals.length).toBe(0);
  });

  it('snaps off-mesh targets to the nearest polygon', () => {
    const m = L();
    const path = m.findPath({ x: 1, y: 0, z: 1 }, { x: 5, y: 0, z: -5 })!; // target inside the wall area
    expect(path).not.toBeNull();
    const end = path[path.length - 1];
    expect(end.x >= 8 - 1e-6 || end.z >= -1e-6).toBe(true);
  });

  it('funnel handles a zig-zag', () => {
    const pts = funnel([
      { left: { x: 0, z: 0 }, right: { x: 0, z: 0 } },
      { left: { x: 2, z: -1 }, right: { x: 2, z: 1 } },
      { left: { x: 4, z: 0 }, right: { x: 4, z: 2 } },
      { left: { x: 6, z: 1 }, right: { x: 6, z: 1 } },
    ]);
    expect(pts[0]).toEqual({ x: 0, z: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 6, z: 1 });
  });
});
