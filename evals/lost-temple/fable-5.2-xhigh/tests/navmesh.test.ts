import { describe, expect, it } from 'vitest';
import { NavMesh, type NavRectDef } from '../src/core/navmesh';
import { SCENE_ORDER } from '../src/core/scenes';
import { ALL_GATES } from '../src/core/unlock';
import { allGuardianSpawns, buildNavMesh, layouts, sceneAt, sweepRoute } from '../src/world/layout';

const flat = (x0: number, z0: number, x1: number, z1: number, y = 0, extra: Partial<NavRectDef> = {}): NavRectDef => ({
  x0, z0, x1, z1, y, scene: 't', ...extra,
});

/** Every sampled point of a path must lie on the mesh. */
function pathOnMesh(nav: NavMesh, pts: { x: number; y: number; z: number }[]): boolean {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const y = a.y + (b.y - a.y) * t;
      if (nav.locate(x, y, z, 3.5) < 0) return false;
    }
  }
  return true;
}

describe('navmesh construction', () => {
  it('links rects that share an edge', () => {
    const nav = new NavMesh([flat(0, 0, 10, 10), flat(10, 0, 20, 10)]);
    expect(nav.rects.length).toBe(2);
    expect(nav.linkCount).toBe(1);
  });

  it('does not link rects at different heights', () => {
    const nav = new NavMesh([flat(0, 0, 10, 10, 0), flat(10, 0, 20, 10, 3)]);
    expect(nav.linkCount).toBe(0);
  });

  it('does not link rects that only touch at a corner or a sliver', () => {
    const nav = new NavMesh([flat(0, 0, 10, 10), flat(10, 10, 20, 20), flat(10, -5, 20, 0.3)]);
    expect(nav.linkCount).toBe(0);
  });

  it('links a ramp to the floors at both ends', () => {
    const nav = new NavMesh([
      flat(0, 0, 10, 4, 0),
      { x0: 10, z0: 0, x1: 20, z1: 4, y: 0, y2: 5, slope: 'x', scene: 't' },
      flat(20, 0, 30, 4, 5),
    ]);
    expect(nav.linkCount).toBe(2);
    expect(nav.heightAt(1, 15, 2)).toBeCloseTo(2.5, 6);
    const path = nav.findPath({ x: 1, y: 0, z: 2 }, { x: 29, y: 5, z: 2 })!;
    expect(path).not.toBeNull();
    expect(path.points[path.points.length - 1].y).toBeCloseTo(5, 6);
  });

  it('carves obstacles out of floors, grown by the agent radius', () => {
    const nav = new NavMesh([flat(0, 0, 10, 10)], [{ x0: 4, z0: 4, x1: 6, z1: 6, yMin: 0, yMax: 2 }], 0.5);
    expect(nav.rects.length).toBe(4);
    expect(nav.locate(5, 0, 5)).toBe(-1);
    expect(nav.locate(3.6, 0, 5)).toBe(-1); // inside the grown footprint
    expect(nav.locate(3.4, 0, 5)).toBeGreaterThanOrEqual(0);
    expect(nav.islands().length).toBe(1);
  });

  it('ignores obstacles on a different storey', () => {
    const nav = new NavMesh([flat(0, 0, 10, 10, 0)], [{ x0: 4, z0: 4, x1: 6, z1: 6, yMin: 6, yMax: 9 }]);
    expect(nav.rects.length).toBe(1);
  });
});

describe('pathfinding', () => {
  it('goes straight across open floor', () => {
    const nav = new NavMesh([flat(0, 0, 10, 10), flat(10, 0, 20, 10)]);
    const p = nav.findPath({ x: 1, y: 0, z: 5 }, { x: 19, y: 0, z: 5 })!;
    expect(p.points.length).toBe(2);
    expect(p.length).toBeCloseTo(18, 5);
  });

  it('routes around a wall through the doorway instead of homing through it', () => {
    // Two rooms joined by a 2 m door at the far end of the shared wall.
    const nav = new NavMesh([flat(0, 0, 10, 20), flat(10, 17, 12, 19), flat(12, 0, 22, 20)], [], 0.4);
    const start = { x: 5, y: 0, z: 2 };
    const goal = { x: 17, y: 0, z: 2 };
    const p = nav.findPath(start, goal)!;
    expect(p).not.toBeNull();
    const straight = Math.hypot(goal.x - start.x, goal.z - start.z);
    expect(p.length).toBeGreaterThan(straight * 2);
    expect(p.points.some((q) => q.z > 16.5)).toBe(true);
    expect(pathOnMesh(nav, p.points)).toBe(true);
  });

  it('string-pulls: an L-shaped corridor takes one corner, not a zig-zag', () => {
    const nav = new NavMesh([flat(0, 0, 3, 20), flat(0, 20, 3, 23), flat(3, 20, 20, 23)], [], 0.4);
    const p = nav.findPath({ x: 1.5, y: 0, z: 1 }, { x: 19, y: 0, z: 21.5 })!;
    // One bend: at most two corner points, both hugging the inside of it (offset by the agent radius).
    expect(p.points.length).toBeLessThanOrEqual(4);
    expect(pathOnMesh(nav, p.points)).toBe(true);
    for (const corner of p.points.slice(1, -1)) expect(Math.hypot(corner.x - 3, corner.z - 20)).toBeLessThan(0.6);
    const straightAround = Math.hypot(1.5 - 3, 1 - 20) + Math.hypot(19 - 3, 21.5 - 20);
    expect(p.length).toBeLessThan(straightAround + 1);
  });

  it('walks around a carved pillar', () => {
    const nav = new NavMesh([flat(0, 0, 20, 6)], [{ x0: 9, z0: 1, x1: 11, z1: 5, yMin: 0, yMax: 3 }], 0.4);
    const p = nav.findPath({ x: 1, y: 0, z: 3 }, { x: 19, y: 0, z: 3 })!;
    expect(p).not.toBeNull();
    expect(p.points.length).toBeGreaterThan(2);
    expect(pathOnMesh(nav, p.points)).toBe(true);
  });

  it('returns null when the goal is on a separate island', () => {
    const nav = new NavMesh([flat(0, 0, 10, 10), flat(30, 0, 40, 10)]);
    expect(nav.findPath({ x: 1, y: 0, z: 1 }, { x: 35, y: 0, z: 5 })).toBeNull();
  });

  it('snaps off-mesh endpoints to the nearest point on the mesh', () => {
    const nav = new NavMesh([flat(0, 0, 10, 10)]);
    const p = nav.findPath({ x: -3, y: 0, z: 5 }, { x: 14, y: 0, z: 5 })!;
    expect(p.points[0].x).toBeCloseTo(0, 6);
    expect(p.points[p.points.length - 1].x).toBeCloseTo(10, 6);
  });

  it('picks the right storey when floors overlap in plan', () => {
    const nav = new NavMesh([flat(0, 0, 10, 10, 0), flat(0, 0, 10, 10, 8, { scene: 'up' })]);
    expect(nav.rects[nav.locate(5, 0.2, 5)].scene).toBe('t');
    expect(nav.rects[nav.locate(5, 7.8, 5)].scene).toBe('up');
  });
});

describe('gates', () => {
  const defs = [flat(0, 0, 10, 4), flat(10, 0, 12, 4, 0, { gate: 'door' }), flat(12, 0, 22, 4)];

  it('a closed gate blocks the path, an open one lets it through', () => {
    const nav = new NavMesh(defs);
    const a = { x: 1, y: 0, z: 2 };
    const b = { x: 21, y: 0, z: 2 };
    expect(nav.isGateOpen('door')).toBe(false);
    expect(nav.findPath(a, b)).toBeNull();
    nav.setGate('door', true);
    expect(nav.findPath(a, b)).not.toBeNull();
    nav.setGate('door', false);
    expect(nav.findPath(a, b)).toBeNull();
  });

  it('takes the long way round while a shortcut gate is shut', () => {
    const nav = new NavMesh([
      flat(0, 0, 4, 4), flat(4, 0, 6, 4, 0, { gate: 'short' }), flat(6, 0, 10, 4),
      flat(0, 4, 4, 30), flat(0, 30, 10, 34), flat(6, 4, 10, 30),
    ]);
    const a = { x: 2, y: 0, z: 2 };
    const b = { x: 8, y: 0, z: 2 };
    const long = nav.findPath(a, b)!;
    nav.setGate('short', true);
    const short = nav.findPath(a, b)!;
    expect(long.length).toBeGreaterThan(50);
    expect(short.length).toBeLessThan(8);
  });
});

describe('wall clearance', () => {
  it('keeps agents off walls but lets them through portals', () => {
    const nav = new NavMesh([flat(0, 0, 10, 10), flat(10, 4, 14, 6)], [], 0.45);
    // Against the west wall: pushed in.
    expect(nav.constrain(0, 0.1, 5).x).toBeCloseTo(0.45, 6);
    // At the east side, in front of the doorway: allowed right up to the edge.
    expect(nav.constrain(0, 9.95, 5).x).toBeCloseTo(9.95, 6);
    // At the east side, away from the doorway: pushed in.
    expect(nav.constrain(0, 9.95, 1).x).toBeCloseTo(9.55, 6);
  });
});

describe('the real temple navmesh', () => {
  const nav = buildNavMesh();
  const L = layouts();
  const openAll = (): void => {
    for (const g of nav.gateIds()) nav.setGate(g, g !== 'greatDoor');
  };
  const closeAll = (): void => {
    for (const g of nav.gateIds()) nav.setGate(g, false);
  };

  it('has no overlapping floors', () => {
    expect(nav.overlaps()).toEqual([]);
  });

  it('knows every gate used by the unlock rules', () => {
    for (const g of ALL_GATES) expect(nav.gateIds()).toContain(g);
    expect(nav.gateIds()).toContain('greatDoor');
  });

  it('is one connected piece with every gate open (bar the cliff-top and plaza)', () => {
    for (const g of nav.gateIds()) nav.setGate(g, true);
    expect(nav.islands().length).toBe(1);
  });

  it('every guardian spawn stands on the mesh', () => {
    for (const g of allGuardianSpawns()) {
      const r = nav.locate(g.pos.x, g.pos.y, g.pos.z, 1);
      expect(r, g.id).toBeGreaterThanOrEqual(0);
      expect(nav.rects[r].scene).toBe(g.scene);
    }
  });

  it('every sweep waypoint stands on the mesh', () => {
    for (const id of SCENE_ORDER) {
      for (const p of L[id].sweep) expect(nav.locate(p.x, p.y, p.z, 1.2), `${id} ${p.x},${p.z}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('with all seals shut, the lair is cut off from the door', () => {
    closeAll();
    const lair = L.vault.guardians[0].pos;
    expect(nav.findPath(lair, { x: 0, y: 0, z: 37 })).toBeNull();
  });

  it('once the seals break, every guardian can path to the great door on the mesh', () => {
    closeAll();
    for (const g of ['seal', 'sanctumDoor', 'vaultGate', 'lairGate']) nav.setGate(g, true);
    const door = { x: 0, y: 0, z: 37 };
    for (const g of allGuardianSpawns()) {
      const p = nav.findPath(g.pos, door);
      expect(p, g.id).not.toBeNull();
      expect(pathOnMesh(nav, p!.points), g.id).toBe(true);
    }
  });

  it('the lair route out runs vault -> catacombs -> halls -> courtyard unless the player opened the stair', () => {
    closeAll();
    for (const g of ['seal', 'sanctumDoor', 'vaultGate', 'lairGate']) nav.setGate(g, true);
    const lair = L.vault.guardians[0].pos;
    const door = { x: 0, y: 0, z: 37 };
    const scenes = (p: { rects: number[] }): string[] => {
      const out: string[] = [];
      for (const r of p.rects) if (out[out.length - 1] !== nav.rects[r].scene) out.push(nav.rects[r].scene);
      return out;
    };
    const long = nav.findPath(lair, door)!;
    expect(scenes(long)).toEqual(['vault', 'catacombs', 'halls', 'courtyard']);
    // The player's shortcuts help the guardians too: up the escape stair and out through the sanctum.
    for (const g of ['escapeStair', 'kickWall', 'drawbridge']) nav.setGate(g, true);
    const short = nav.findPath(lair, door)!;
    expect(scenes(short).slice(0, 2)).toEqual(['vault', 'sanctum']);
    expect(short.length).toBeLessThan(long.length);
    // With the sanctum door buried by a collapse, the kicked wall and drawbridge are the way.
    nav.setGate('sanctumDoor', false);
    const viaTerrace = nav.findPath(lair, door)!;
    expect(scenes(viaTerrace)).toEqual(['vault', 'sanctum', 'courtyard']);
    expect(viaTerrace.length).toBeLessThan(long.length);
  });

  it('guardians can never path out through the great door', () => {
    openAll();
    const p = nav.findPath({ x: 0, y: 0, z: 30 }, { x: 0, y: 0, z: 50 });
    // The plaza outside is a separate island for them: no path.
    expect(p).toBeNull();
  });

  it('sweep routes lead from every scene toward the door', () => {
    for (const id of ['vault', 'catacombs', 'sanctum', 'halls', 'courtyard'] as const) {
      const r = sweepRoute(id);
      expect(r.length).toBeGreaterThan(2);
      const last = r[r.length - 1];
      expect(last.z).toBeGreaterThan(30);
      expect(Math.abs(last.x)).toBeLessThan(5);
    }
  });

  it('escape stair climbs from the vault floor to the sanctum floor', () => {
    openAll();
    const p = nav.findPath({ x: -52, y: -14, z: -92 }, { x: -49, y: 1.2, z: -60 })!;
    expect(p).not.toBeNull();
    expect(p.points[0].y).toBeCloseTo(-14, 1);
    expect(p.points[p.points.length - 1].y).toBeCloseTo(1.2, 1);
    expect(pathOnMesh(nav, p.points)).toBe(true);
  });
});

describe('scene lookup', () => {
  it('places the key spots of each scene in that scene', () => {
    expect(sceneAt({ x: 0, y: 1, z: 150 })).toBe('jungle');
    expect(sceneAt({ x: 0, y: 1, z: 10 })).toBe('courtyard');
    expect(sceneAt({ x: -48, y: 2, z: -20 })).toBe('courtyard'); // terrace
    expect(sceneAt({ x: 45, y: 0, z: 0 })).toBe('cliffs');
    expect(sceneAt({ x: 0, y: 2, z: -40 })).toBe('halls');
    expect(sceneAt({ x: -49, y: 2, z: -51 })).toBe('sanctum');
    expect(sceneAt({ x: 35, y: -7, z: -87 })).toBe('catacombs');
    expect(sceneAt({ x: -52, y: -13, z: -92 })).toBe('vault');
    expect(sceneAt({ x: -52, y: -5, z: -73 })).toBe('vault'); // escape stairwell
  });

  it('every relic spot and guardian spawn is inside its own scene', () => {
    const all = layouts();
    for (const id of SCENE_ORDER) {
      for (const s of all[id].spots) expect(sceneAt({ x: s.pos.x, y: s.pos.y + 0.5, z: s.pos.z }), s.id).toBe(id);
      for (const g of all[id].guardians) expect(sceneAt({ x: g.pos.x, y: g.pos.y + 0.5, z: g.pos.z }), g.id).toBe(id);
    }
  });

  it('sticks to the preferred scene at a seam', () => {
    expect(sceneAt({ x: 0, y: 1.5, z: -22.3 }, 'courtyard')).toBe('courtyard');
    expect(sceneAt({ x: 0, y: 1.5, z: -22.3 }, 'halls')).toBe('halls');
  });
});
