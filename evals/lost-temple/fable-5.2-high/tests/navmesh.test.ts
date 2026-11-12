import { describe, expect, it } from 'vitest';
import { NavMesh, carve, type NavRect } from '../src/core/navmesh';

// Two rooms joined by a doorway at the far end of a dividing wall:
//   room A: x 0..10, z 0..10      room B: x 12..22, z 0..10
//   door corridor: x 10..12, z 8..10
const rooms: NavRect[] = [
  { x1: 0, z1: 0, x2: 10, z2: 10, y: 0 },
  { x1: 10, z1: 8, x2: 12, z2: 10, y: 0 },
  { x1: 12, z1: 0, x2: 22, z2: 10, y: 0 },
];

describe('navmesh pathfinding', () => {
  it('links rectangles that share an edge', () => {
    const nm = new NavMesh(rooms);
    expect(nm.polys[0].links.length).toBe(1);
    expect(nm.polys[1].links.length).toBe(2);
  });
  it('routes around a wall through the doorway instead of homing straight', () => {
    const nm = new NavMesh(rooms);
    const from = { x: 5, y: 0, z: 1 }, to = { x: 17, y: 0, z: 1 };
    const path = nm.findPath(from, to)!;
    expect(path).not.toBeNull();
    const straight = Math.hypot(to.x - from.x, to.z - from.z);
    expect(path.length).toBeGreaterThan(straight * 1.3);
    expect(path.points.length).toBeGreaterThanOrEqual(4);
    // Every corner must be through the doorway band, not through the wall.
    for (const p of path.points.slice(1, -1)) { expect(p.z).toBeGreaterThanOrEqual(8); expect(p.x).toBeGreaterThanOrEqual(9.9); expect(p.x).toBeLessThanOrEqual(12.1); }
  });
  it('funnels to a straight line when nothing is in the way', () => {
    const nm = new NavMesh(rooms);
    const path = nm.findPath({ x: 1, y: 0, z: 9 }, { x: 21, y: 0, z: 9 })!;
    expect(path.points.length).toBe(2);
    expect(path.length).toBeCloseTo(20);
  });
  it('keeps corners away from walls by the agent radius', () => {
    const nm = new NavMesh(rooms);
    const path = nm.findPath({ x: 5, y: 0, z: 1 }, { x: 17, y: 0, z: 1 })!;
    for (const p of path.points.slice(1, -1)) expect(p.z).toBeGreaterThanOrEqual(8 + nm.agentRadius - 1e-6);
  });
  it('returns null when the goal is cut off', () => {
    const nm = new NavMesh([rooms[0], { x1: 30, z1: 0, x2: 40, z2: 10, y: 0 }]);
    expect(nm.findPath({ x: 5, y: 0, z: 5 }, { x: 35, y: 0, z: 5 })).toBeNull();
  });
  it('respects disabled polygons such as a crumbled floor or a shut door', () => {
    const tagged = rooms.map((r, i) => (i === 1 ? { ...r, tag: 'door' } : r));
    const nm = new NavMesh(tagged);
    expect(nm.connected({ x: 5, y: 0, z: 5 }, { x: 17, y: 0, z: 5 })).toBe(true);
    nm.setTagEnabled('door', false);
    expect(nm.connected({ x: 5, y: 0, z: 5 }, { x: 17, y: 0, z: 5 })).toBe(false);
    nm.setTagEnabled('door', true);
    expect(nm.connected({ x: 5, y: 0, z: 5 }, { x: 17, y: 0, z: 5 })).toBe(true);
  });
  it('picks the shorter of two routes', () => {
    const nm = new NavMesh([
      ...rooms,
      { x1: 10, z1: 0, x2: 12, z2: 2, y: 0 }, // second doorway at the near end
    ]);
    const path = nm.findPath({ x: 5, y: 0, z: 1 }, { x: 17, y: 0, z: 1 })!;
    expect(path.length).toBeCloseTo(12, 0);
  });
});

describe('ramps and levels', () => {
  const stairs: NavRect[] = [
    { x1: 0, z1: 0, x2: 4, z2: 4, y: 0 },
    { x1: 0, z1: 4, x2: 4, z2: 12, y: 0, y2: -6, slope: 'z' },
    { x1: 0, z1: 12, x2: 4, z2: 16, y: -6 },
    { x1: 4, z1: 12, x2: 8, z2: 16, y: -2 }, // a ledge too high to step onto
  ];
  it('walks down a ramp and reports heights along it', () => {
    const nm = new NavMesh(stairs);
    const path = nm.findPath({ x: 2, y: 0, z: 1 }, { x: 2, y: -6, z: 15 })!;
    expect(path).not.toBeNull();
    expect(path.points[path.points.length - 1].y).toBeCloseTo(-6);
    expect(nm.sampleHeight(2, 8, -3)).toBeCloseTo(-3);
  });
  it('does not link surfaces separated by a tall step', () => {
    const nm = new NavMesh(stairs);
    expect(nm.findPath({ x: 2, y: -6, z: 14 }, { x: 6, y: -2, z: 14 })).toBeNull();
  });
  it('finds the polygon at the right height when floors overlap', () => {
    const nm = new NavMesh([{ x1: 0, z1: 0, x2: 10, z2: 10, y: 0 }, { x1: 0, z1: 0, x2: 10, z2: 10, y: -10 }]);
    expect(nm.findPoly(5, -9.5, 5)).toBe(1);
    expect(nm.findPoly(5, 0.4, 5)).toBe(0);
  });
});

describe('carving obstacles', () => {
  it('cuts a pillar out of a floor and paths around it', () => {
    const rects = carve([{ x1: 0, z1: 0, x2: 10, z2: 10, y: 0 }], [{ x1: 4, z1: 2, x2: 6, z2: 8 }]);
    expect(rects.length).toBe(4);
    const area = rects.reduce((s, r) => s + (r.x2 - r.x1) * (r.z2 - r.z1), 0);
    expect(area).toBeCloseTo(100 - 12);
    const nm = new NavMesh(rects);
    const path = nm.findPath({ x: 1, y: 0, z: 5 }, { x: 9, y: 0, z: 5 })!;
    expect(path.length).toBeGreaterThan(8.5);
    for (const p of path.points) expect(p.x > 4.01 && p.x < 5.99 && p.z > 2.01 && p.z < 7.99).toBe(false);
  });
  it('clamps arbitrary points onto the mesh', () => {
    const nm = new NavMesh(rooms);
    const c = nm.clampPoint(-5, 0, 5)!;
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.z).toBeCloseTo(5);
  });
});
