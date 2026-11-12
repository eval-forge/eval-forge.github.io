import { describe, it, expect } from 'vitest';
import { NavMesh } from '../src/logic/navmesh';
import { buildNavPolys } from '../src/logic/navbuild';

function lMesh() {
  // L-shaped corridor: east-west leg then north-south leg, with a wall block in the corner.
  const walks = [
    { x0: 0, z0: 0, x1: 20, z1: 4, y: 0, scene: 't' },
    { x0: 16, z0: 4, x1: 20, z1: 20, y: 0, scene: 't' },
  ];
  return new NavMesh(buildNavPolys(walks, [], []));
}

describe('navmesh build', () => {
  it('merges cells into few rectangles and links them', () => {
    const m = lMesh();
    expect(m.polys.length).toBeGreaterThan(1);
    expect(m.polys.length).toBeLessThan(30);
    expect(m.linkCount).toBeGreaterThan(0);
  });
  it('cuts obstacles out, dilated by the agent radius', () => {
    const polys = buildNavPolys([{ x0: 0, z0: 0, x1: 10, z1: 10, y: 0, scene: 't' }], [{ x0: 4, z0: 4, x1: 6, z1: 6, y0: 0, y1: 3 }], []);
    const m = new NavMesh(polys);
    expect(m.findPoly(5, 0, 5)).toBeNull();
    expect(m.findPoly(3.7, 0, 5)).toBeNull(); // inside dilation
    expect(m.findPoly(2, 0, 5)).not.toBeNull();
  });
  it('ignores low steps and overhead slabs', () => {
    const polys = buildNavPolys([{ x0: 0, z0: 0, x1: 10, z1: 10, y: 0, scene: 't' }], [
      { x0: 4, z0: 4, x1: 6, z1: 6, y0: 0, y1: 0.3 },
      { x0: 0, z0: 0, x1: 10, z1: 3, y0: 2.6, y1: 3 },
    ], []);
    const m = new NavMesh(polys);
    expect(m.findPoly(5, 0, 5)).not.toBeNull();
    expect(m.findPoly(5, 0, 1)).not.toBeNull();
  });
});

describe('pathfinding', () => {
  it('finds a path around a corner instead of straight-line homing', () => {
    const m = lMesh();
    const p = m.findPath([1, 0, 2], [18, 0, 19])!;
    expect(p).not.toBeNull();
    expect(p.length).toBeGreaterThanOrEqual(3);
    // every point is on the mesh
    for (const q of p) expect(m.findPoly(q[0], q[1] + 0.1, q[2]) ?? m.nearest(q[0], q[1], q[2], 0.2)).toBeTruthy();
    // the corner waypoint hugs the inside corner at (16, 4)
    const corner = p.find((q) => Math.abs(q[0] - 16) < 0.6 && Math.abs(q[2] - 4) < 0.6);
    expect(corner).toBeTruthy();
    const len = NavMesh.pathLength(p);
    const straight = Math.hypot(17, 17);
    expect(len).toBeGreaterThan(straight);
    expect(len).toBeLessThan(17 + 17 + 1);
  });
  it('a straight corridor gives a straight path', () => {
    const m = new NavMesh(buildNavPolys([{ x0: 0, z0: 0, x1: 30, z1: 3, y: 0, scene: 't' }], [], []));
    const p = m.findPath([1, 0, 1.5], [29, 0, 1.5])!;
    expect(p.length).toBe(2);
  });
  it('routes around a pillar', () => {
    const m = new NavMesh(buildNavPolys([{ x0: 0, z0: 0, x1: 20, z1: 10, y: 0, scene: 't' }], [{ x0: 9, z0: 2, x1: 11, z1: 10, y0: 0, y1: 3 }], []));
    const p = m.findPath([2, 0, 6], [18, 0, 6])!;
    expect(p).not.toBeNull();
    expect(Math.min(...p.map((q) => q[2]))).toBeLessThan(2);
  });
  it('closed gates block the way and reopen', () => {
    const walks = [
      { x0: 0, z0: 0, x1: 10, z1: 4, y: 0, scene: 't' },
      { x0: 10, z0: 0, x1: 12, z1: 4, y: 0, scene: 't', gate: 'door' },
      { x0: 12, z0: 0, x1: 22, z1: 4, y: 0, scene: 't' },
    ];
    const m = new NavMesh(buildNavPolys(walks, [], []));
    m.setGate('door', false);
    expect(m.findPath([1, 0, 2], [21, 0, 2])).toBeNull();
    m.setGate('door', true);
    expect(m.findPath([1, 0, 2], [21, 0, 2])).not.toBeNull();
  });
  it('a partial path leads up to a shut gate instead of giving up', () => {
    const walks = [
      { x0: 0, z0: 0, x1: 10, z1: 4, y: 0, scene: 't' },
      { x0: 10, z0: 0, x1: 12, z1: 4, y: 0, scene: 't', gate: 'door' },
      { x0: 12, z0: 0, x1: 22, z1: 4, y: 0, scene: 't' },
    ];
    const m = new NavMesh(buildNavPolys(walks, [], []));
    m.setGate('door', false);
    const p = m.findPath([1, 0, 2], [21, 0, 2], { partial: true })!;
    expect(p).not.toBeNull();
    const end = p[p.length - 1];
    // ends on the near side of the door, as far along as the floor goes
    expect(end[0]).toBeGreaterThan(9);
    expect(end[0]).toBeLessThanOrEqual(10);
  });
  it('climbs ramps between levels and keeps stacked floors apart', () => {
    const walks = [
      { x0: 0, z0: 0, x1: 10, z1: 4, y: 0, scene: 't' },
      { x0: 0, z0: 0, x1: 10, z1: 4, y: 5, scene: 't' }, // floor directly above, not connected
      { x0: 20, z0: 0, x1: 30, z1: 4, y: 5, scene: 't' },
    ];
    const ramps = [{ x0: 10, z0: 0, x1: 20, z1: 4, yStart: 0, yEnd: 5, axis: 'x' as const, scene: 't' }];
    const m = new NavMesh(buildNavPolys(walks, [], ramps));
    expect(m.findPoly(5, 0.1, 2)!.c).toBe(0);
    expect(m.findPoly(5, 5.1, 2)!.c).toBe(5);
    const p = m.findPath([1, 0, 2], [29, 5, 2])!;
    expect(p).not.toBeNull();
    expect(p[p.length - 1][1]).toBeCloseTo(5);
    const upper = m.findPath([1, 0, 2], [5, 5, 2]);
    expect(upper).toBeNull();
  });
  it('a cost function can forbid lit polygons (shadow pathing)', () => {
    const m = new NavMesh(buildNavPolys([{ x0: 0, z0: 0, x1: 24, z1: 12, y: 0, scene: 't' }], [], [], { maxRect: 4 }));
    const lit = (p: { cx: number; cz: number }) => Math.hypot(p.cx - 12, p.cz - 4) < 5;
    const p = m.findPath([2, 0, 4], [22, 0, 4], { cost: (poly) => (lit(poly) ? Infinity : 1) })!;
    expect(p).not.toBeNull();
    // must go around the lit disc, through the high-z side
    expect(Math.max(...p.map((q) => q[2]))).toBeGreaterThanOrEqual(7.99);
  });
});
