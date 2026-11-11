/**
 * A rectangle navmesh.
 *
 * Levels declare walkable floors as axis-aligned rectangles (flat or sloped)
 * plus obstacle footprints. Building the mesh:
 *   1. carves every obstacle (grown by the agent radius) out of the floors,
 *   2. finds portals where two rects share part of an edge at matching height,
 *   3. tags gate rects that doors can close.
 * Queries: point location, A* over rects through portal midpoints, and the
 * funnel (string-pulling) algorithm over the resulting portal chain.
 *
 * Pure: no three, no rapier. Unit-tested in tests/navmesh.test.ts.
 */
import type { Vec3Like } from './scenes';

export interface NavRectDef {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Height (flat), or the height at the low-coordinate edge of a ramp. */
  y: number;
  /** Ramps: height at the high-coordinate edge along `slope`. */
  y2?: number;
  slope?: 'x' | 'z';
  scene: string;
  /** Rects with a gate can only be crossed while that gate is open. */
  gate?: string;
  tag?: string;
  /** Doorway rects are never carved by obstacles. */
  noCarve?: boolean;
}

export interface NavObstacleDef {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  yMin: number;
  yMax: number;
}

export interface NavLink {
  to: number;
  /** Portal endpoints in XZ. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  mx: number;
  mz: number;
  /** 0 = west (x0), 1 = east (x1), 2 = north (z0), 3 = south (z1). */
  side: number;
}

export interface NavRect {
  id: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Plane: y = h0 + gx * x + gz * z. */
  h0: number;
  gx: number;
  gz: number;
  scene: string;
  gate: string | null;
  tag: string | null;
  links: NavLink[];
}

export interface NavPath {
  /** Corner points from start to goal, inclusive. */
  points: Vec3Like[];
  /** Rect corridor the path runs through. */
  rects: number[];
  length: number;
}

const EDGE_EPS = 0.08;
const HEIGHT_EPS = 0.5;
const MIN_PORTAL = 0.55;
/** Carving can leave thin slivers. They are kept: a sliver still joins its neighbours along its long edges. */
const MIN_PIECE = 0.02;
/** Connected groups of rects smaller than this (m^2) are unreachable crumbs behind obstacles: dropped. */
const MIN_ISLAND_AREA = 3;

interface Piece {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

function subtract(r: Piece, o: Piece): Piece[] {
  if (o.x0 >= r.x1 - 1e-6 || o.x1 <= r.x0 + 1e-6 || o.z0 >= r.z1 - 1e-6 || o.z1 <= r.z0 + 1e-6) return [r];
  const out: Piece[] = [];
  if (o.x0 > r.x0) out.push({ x0: r.x0, x1: o.x0, z0: r.z0, z1: r.z1 });
  if (o.x1 < r.x1) out.push({ x0: o.x1, x1: r.x1, z0: r.z0, z1: r.z1 });
  const mx0 = Math.max(r.x0, o.x0);
  const mx1 = Math.min(r.x1, o.x1);
  if (o.z0 > r.z0) out.push({ x0: mx0, x1: mx1, z0: r.z0, z1: o.z0 });
  if (o.z1 < r.z1) out.push({ x0: mx0, x1: mx1, z0: o.z1, z1: r.z1 });
  return out;
}

class MinHeap {
  private items: number[] = [];
  constructor(private readonly score: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(v: number): void {
    const a = this.items;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.score[a[p]] <= this.score[a[i]]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l;
        if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Mononen's triarea2, with z as the second axis. */
function tri(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (cx - ax) * (bz - az) - (bx - ax) * (cz - az);
}

export class NavMesh {
  rects: NavRect[] = [];
  readonly agentRadius: number;
  private gates = new Map<string, boolean>();
  private byScene = new Map<string, number[]>();

  constructor(defs: readonly NavRectDef[], obstacles: readonly NavObstacleDef[] = [], agentRadius = 0.45) {
    this.agentRadius = agentRadius;
    this.build(defs, obstacles);
  }

  // -- construction ---------------------------------------------------------

  private build(defs: readonly NavRectDef[], obstacles: readonly NavObstacleDef[]): void {
    const r = this.agentRadius;
    for (const d of defs) {
      const x0 = Math.min(d.x0, d.x1);
      const x1 = Math.max(d.x0, d.x1);
      const z0 = Math.min(d.z0, d.z1);
      const z1 = Math.max(d.z0, d.z1);
      let gx = 0;
      let gz = 0;
      let h0 = d.y;
      if (d.slope === 'x' && d.y2 !== undefined) {
        gx = (d.y2 - d.y) / (x1 - x0);
        h0 = d.y - gx * x0;
      } else if (d.slope === 'z' && d.y2 !== undefined) {
        gz = (d.y2 - d.y) / (z1 - z0);
        h0 = d.y - gz * z0;
      }
      const yLo = Math.min(d.y, d.y2 ?? d.y);
      const yHi = Math.max(d.y, d.y2 ?? d.y);
      let pieces: Piece[] = [{ x0, z0, x1, z1 }];
      if (!d.noCarve) {
        for (const o of obstacles) {
          // An obstacle blocks a floor if it stands on or just above it.
          if (o.yMax < yLo + 0.25 || o.yMin > yHi + 1.6) continue;
          const grown = { x0: o.x0 - r, x1: o.x1 + r, z0: o.z0 - r, z1: o.z1 + r };
          const next: Piece[] = [];
          for (const p of pieces) for (const q of subtract(p, grown)) next.push(q);
          pieces = next;
          if (pieces.length === 0) break;
        }
      }
      for (const p of pieces) {
        if (p.x1 - p.x0 < MIN_PIECE || p.z1 - p.z0 < MIN_PIECE) continue;
        const id = this.rects.length;
        this.rects.push({
          id, x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1, h0, gx, gz,
          scene: d.scene, gate: d.gate ?? null, tag: d.tag ?? null, links: [],
        });
        let list = this.byScene.get(d.scene);
        if (!list) this.byScene.set(d.scene, (list = []));
        list.push(id);
        if (d.gate && !this.gates.has(d.gate)) this.gates.set(d.gate, false);
      }
    }
    this.linkAll();
    this.dropCrumbs();
  }

  /** Remove tiny disconnected islands left behind obstacles, then relink. */
  private dropCrumbs(): void {
    const comps = this.islands(true);
    const drop = new Set<number>();
    for (const comp of comps) {
      let area = 0;
      for (const id of comp) {
        const q = this.rects[id];
        area += (q.x1 - q.x0) * (q.z1 - q.z0);
      }
      if (area < MIN_ISLAND_AREA && comp.every((id) => this.rects[id].gate === null)) for (const id of comp) drop.add(id);
    }
    if (drop.size === 0) return;
    const kept = this.rects.filter((q) => !drop.has(q.id));
    this.byScene.clear();
    kept.forEach((q, i) => {
      q.id = i;
      q.links = [];
      let list = this.byScene.get(q.scene);
      if (!list) this.byScene.set(q.scene, (list = []));
      list.push(i);
    });
    this.rects = kept;
    this.linkAll();
  }

  private linkAll(): void {
    const R = this.rects;
    for (let i = 0; i < R.length; i++) {
      const a = R[i];
      for (let j = i + 1; j < R.length; j++) {
        const b = R[j];
        // Shared vertical edge (constant x).
        let sx: number | null = null;
        let sideA = 0;
        if (Math.abs(a.x1 - b.x0) < EDGE_EPS) {
          sx = (a.x1 + b.x0) / 2;
          sideA = 1;
        } else if (Math.abs(a.x0 - b.x1) < EDGE_EPS) {
          sx = (a.x0 + b.x1) / 2;
          sideA = 0;
        }
        if (sx !== null) {
          const lo = Math.max(a.z0, b.z0);
          const hi = Math.min(a.z1, b.z1);
          if (hi - lo >= MIN_PORTAL) {
            const mz = (lo + hi) / 2;
            if (Math.abs(this.heightOn(a, sx, mz) - this.heightOn(b, sx, mz)) <= HEIGHT_EPS) {
              a.links.push({ to: j, ax: sx, az: lo, bx: sx, bz: hi, mx: sx, mz, side: sideA });
              b.links.push({ to: i, ax: sx, az: lo, bx: sx, bz: hi, mx: sx, mz, side: sideA === 1 ? 0 : 1 });
            }
          }
          continue;
        }
        // Shared horizontal edge (constant z).
        let sz: number | null = null;
        if (Math.abs(a.z1 - b.z0) < EDGE_EPS) {
          sz = (a.z1 + b.z0) / 2;
          sideA = 3;
        } else if (Math.abs(a.z0 - b.z1) < EDGE_EPS) {
          sz = (a.z0 + b.z1) / 2;
          sideA = 2;
        }
        if (sz !== null) {
          const lo = Math.max(a.x0, b.x0);
          const hi = Math.min(a.x1, b.x1);
          if (hi - lo >= MIN_PORTAL) {
            const mx = (lo + hi) / 2;
            if (Math.abs(this.heightOn(a, mx, sz) - this.heightOn(b, mx, sz)) <= HEIGHT_EPS) {
              a.links.push({ to: j, ax: lo, az: sz, bx: hi, bz: sz, mx, mz: sz, side: sideA });
              b.links.push({ to: i, ax: lo, az: sz, bx: hi, bz: sz, mx, mz: sz, side: sideA === 3 ? 2 : 3 });
            }
          }
        }
      }
    }
  }

  // -- gates ----------------------------------------------------------------

  setGate(id: string, open: boolean): void {
    this.gates.set(id, open);
  }

  isGateOpen(id: string): boolean {
    return this.gates.get(id) ?? true;
  }

  gateIds(): string[] {
    return [...this.gates.keys()];
  }

  private passable(r: NavRect): boolean {
    return r.gate === null || this.isGateOpen(r.gate);
  }

  // -- geometry queries -------------------------------------------------------

  heightOn(r: NavRect, x: number, z: number): number {
    return r.h0 + r.gx * x + r.gz * z;
  }

  heightAt(rect: number, x: number, z: number): number {
    return this.heightOn(this.rects[rect], x, z);
  }

  rectsOfScene(scene: string): number[] {
    return this.byScene.get(scene) ?? [];
  }

  /** Index of the rect under (x, z) whose surface is closest to y, or -1. */
  locate(x: number, y: number, z: number, maxDy = 3): number {
    let best = -1;
    let bestDy = maxDy;
    for (const r of this.rects) {
      if (x < r.x0 - 0.01 || x > r.x1 + 0.01 || z < r.z0 - 0.01 || z > r.z1 + 0.01) continue;
      const dy = Math.abs(y - this.heightOn(r, x, z));
      if (dy < bestDy) {
        bestDy = dy;
        best = r.id;
      }
    }
    return best;
  }

  /** Like locate, but tries the hinted rect and its neighbours first. */
  locateFrom(hint: number, x: number, y: number, z: number): number {
    if (hint >= 0 && hint < this.rects.length) {
      const r = this.rects[hint];
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return hint;
      for (const l of r.links) {
        const n = this.rects[l.to];
        if (x >= n.x0 && x <= n.x1 && z >= n.z0 && z <= n.z1 && Math.abs(y - this.heightOn(n, x, z)) < 2) {
          return l.to;
        }
      }
    }
    return this.locate(x, y, z);
  }

  /** Nearest point on the mesh to an arbitrary position. */
  nearest(x: number, y: number, z: number, onlyPassable = false): { rect: number; x: number; y: number; z: number } | null {
    let best: { rect: number; x: number; y: number; z: number } | null = null;
    let bestD = Infinity;
    for (const r of this.rects) {
      if (onlyPassable && !this.passable(r)) continue;
      const cx = Math.min(Math.max(x, r.x0), r.x1);
      const cz = Math.min(Math.max(z, r.z0), r.z1);
      const cy = this.heightOn(r, cx, cz);
      const d = Math.hypot(cx - x, cz - z) + Math.abs(cy - y) * 1.5;
      if (d < bestD) {
        bestD = d;
        best = { rect: r.id, x: cx, y: cy, z: cz };
      }
    }
    return best;
  }

  /**
   * Keep a point inside a rect and at least `margin` away from any part of
   * the rect's border that is a wall (not a portal).
   */
  constrain(rect: number, x: number, z: number, margin = this.agentRadius): { x: number; z: number } {
    const r = this.rects[rect];
    let nx = Math.min(Math.max(x, r.x0), r.x1);
    let nz = Math.min(Math.max(z, r.z0), r.z1);
    const inPortal = (side: number, c: number): boolean => {
      for (const l of r.links) {
        if (l.side !== side) continue;
        const lo = side < 2 ? l.az : l.ax;
        const hi = side < 2 ? l.bz : l.bx;
        if (c >= lo + margin * 0.5 && c <= hi - margin * 0.5) return true;
      }
      return false;
    };
    if (r.x1 - r.x0 > margin * 2) {
      if (nx - r.x0 < margin && !inPortal(0, nz)) nx = r.x0 + margin;
      if (r.x1 - nx < margin && !inPortal(1, nz)) nx = r.x1 - margin;
    }
    if (r.z1 - r.z0 > margin * 2) {
      if (nz - r.z0 < margin && !inPortal(2, nx)) nz = r.z0 + margin;
      if (r.z1 - nz < margin && !inPortal(3, nx)) nz = r.z1 - margin;
    }
    return { x: nx, z: nz };
  }

  /** A deterministic pseudo-random point inside a scene (u, v in [0,1)). */
  pointInScene(scene: string, pick: number, u: number, v: number): Vec3Like | null {
    const ids = this.rectsOfScene(scene);
    if (ids.length === 0) return null;
    const r = this.rects[ids[Math.floor(pick * ids.length) % ids.length]];
    const x = r.x0 + (r.x1 - r.x0) * (0.15 + 0.7 * u);
    const z = r.z0 + (r.z1 - r.z0) * (0.15 + 0.7 * v);
    return { x, y: this.heightOn(r, x, z), z };
  }

  // -- pathfinding ------------------------------------------------------------

  /**
   * A* over rects, then funnel. Returns null if the goal is cut off (closed
   * gates) or either end is off the mesh entirely.
   */
  findPath(start: Vec3Like, goal: Vec3Like): NavPath | null {
    const s = this.nearest(start.x, start.y, start.z);
    const g = this.nearest(goal.x, goal.y, goal.z, true);
    if (!s || !g) return null;
    const n = this.rects.length;
    const gScore = new Float64Array(n).fill(Infinity);
    const fScore = new Float64Array(n).fill(Infinity);
    const cameFrom = new Int32Array(n).fill(-1);
    const cameLink = new Array<NavLink | null>(n).fill(null);
    const entryX = new Float64Array(n);
    const entryZ = new Float64Array(n);
    const closed = new Uint8Array(n);
    const heap = new MinHeap(fScore);

    gScore[s.rect] = 0;
    fScore[s.rect] = Math.hypot(g.x - s.x, g.z - s.z);
    entryX[s.rect] = s.x;
    entryZ[s.rect] = s.z;
    heap.push(s.rect);

    let found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === g.rect) {
        found = true;
        break;
      }
      const cr = this.rects[cur];
      for (const l of cr.links) {
        if (closed[l.to]) continue;
        const nr = this.rects[l.to];
        if (!this.passable(nr)) continue;
        const dy = this.heightOn(cr, l.mx, l.mz) - this.heightOn(cr, entryX[cur], entryZ[cur]);
        const step = Math.hypot(l.mx - entryX[cur], l.mz - entryZ[cur], dy);
        const tentative = gScore[cur] + step;
        if (tentative < gScore[l.to]) {
          gScore[l.to] = tentative;
          cameFrom[l.to] = cur;
          cameLink[l.to] = l;
          entryX[l.to] = l.mx;
          entryZ[l.to] = l.mz;
          fScore[l.to] = tentative + Math.hypot(g.x - l.mx, g.z - l.mz);
          heap.push(l.to);
        }
      }
    }
    if (!found) return null;

    const corridor: number[] = [];
    const links: NavLink[] = [];
    for (let c = g.rect; c !== -1; c = cameFrom[c]) {
      corridor.unshift(c);
      const l = cameLink[c];
      if (l) links.unshift(l);
    }
    const points = this.funnel(s, g, corridor, links);
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z);
    }
    return { points, rects: corridor, length };
  }

  /** Simple Stupid Funnel Algorithm over the portal chain. */
  private funnel(
    s: { x: number; y: number; z: number },
    g: { x: number; y: number; z: number },
    corridor: number[],
    links: NavLink[],
  ): Vec3Like[] {
    const r = this.agentRadius;
    // Build left/right portal lists. Each entry also remembers which rect its height comes from.
    const L: { x: number; z: number; rect: number }[] = [];
    const Rr: { x: number; z: number; rect: number }[] = [];
    L.push({ x: s.x, z: s.z, rect: corridor[0] });
    Rr.push({ x: s.x, z: s.z, rect: corridor[0] });
    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      const from = this.rects[corridor[i]];
      const to = this.rects[corridor[i + 1]];
      // Travel direction: from the source rect centre to the target rect centre.
      const dx = (to.x0 + to.x1) / 2 - (from.x0 + from.x1) / 2;
      const dz = (to.z0 + to.z1) / 2 - (from.z0 + from.z1) / 2;
      let ax = l.ax;
      let az = l.az;
      let bx = l.bx;
      let bz = l.bz;
      const len = Math.hypot(bx - ax, bz - az);
      if (len > 2 * r + 0.1) {
        const ux = (bx - ax) / len;
        const uz = (bz - az) / len;
        ax += ux * r;
        az += uz * r;
        bx -= ux * r;
        bz -= uz * r;
      } else {
        ax = bx = l.mx;
        az = bz = l.mz;
      }
      // Use the portal normal (not the centre-to-centre vector) to decide sides,
      // signed by the travel direction: robust for long thin rects.
      const horizontal = Math.abs(l.bx - l.ax) > Math.abs(l.bz - l.az);
      const ndx = horizontal ? 0 : Math.sign(dx) || 1;
      const ndz = horizontal ? Math.sign(dz) || 1 : 0;
      // cross(d, a - mid) > 0  =>  a is on the left.
      const cross = ndx * (az - l.mz) - ndz * (ax - l.mx);
      if (cross > 0) {
        L.push({ x: ax, z: az, rect: corridor[i] });
        Rr.push({ x: bx, z: bz, rect: corridor[i] });
      } else {
        L.push({ x: bx, z: bz, rect: corridor[i] });
        Rr.push({ x: ax, z: az, rect: corridor[i] });
      }
    }
    const last = corridor[corridor.length - 1];
    L.push({ x: g.x, z: g.z, rect: last });
    Rr.push({ x: g.x, z: g.z, rect: last });

    const out: Vec3Like[] = [{ x: s.x, y: s.y, z: s.z }];
    let apex = { x: s.x, z: s.z, rect: corridor[0] };
    let left = L[0];
    let right = Rr[0];
    let apexI = 0;
    let leftI = 0;
    let rightI = 0;
    const eq = (a: { x: number; z: number }, b: { x: number; z: number }): boolean =>
      Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
    const push = (p: { x: number; z: number; rect: number }): void => {
      const prev = out[out.length - 1];
      if (Math.abs(prev.x - p.x) < 1e-6 && Math.abs(prev.z - p.z) < 1e-6) return;
      out.push({ x: p.x, y: this.heightAt(p.rect, p.x, p.z), z: p.z });
    };

    let guard = 0;
    for (let i = 1; i < L.length && guard < 10000; i++, guard++) {
      const nl = L[i];
      const nr = Rr[i];
      // Tighten right.
      if (tri(apex.x, apex.z, right.x, right.z, nr.x, nr.z) <= 0) {
        if (eq(apex, right) || tri(apex.x, apex.z, left.x, left.z, nr.x, nr.z) > 0) {
          right = nr;
          rightI = i;
        } else {
          // Right crossed left: left becomes a corner.
          push(left);
          apex = left;
          apexI = leftI;
          left = apex;
          right = apex;
          leftI = apexI;
          rightI = apexI;
          i = apexI;
          continue;
        }
      }
      // Tighten left.
      if (tri(apex.x, apex.z, left.x, left.z, nl.x, nl.z) >= 0) {
        if (eq(apex, left) || tri(apex.x, apex.z, right.x, right.z, nl.x, nl.z) < 0) {
          left = nl;
          leftI = i;
        } else {
          push(right);
          apex = right;
          apexI = rightI;
          left = apex;
          right = apex;
          leftI = apexI;
          rightI = apexI;
          i = apexI;
          continue;
        }
      }
    }
    const end = out[out.length - 1];
    if (Math.abs(end.x - g.x) > 1e-6 || Math.abs(end.z - g.z) > 1e-6) out.push({ x: g.x, y: g.y, z: g.z });
    else end.y = g.y;
    return out;
  }

  // -- validation (used by tests) ----------------------------------------------

  /** Number of connected components, honouring current gate state. */
  islands(ignoreGates = false): number[][] {
    const seen = new Uint8Array(this.rects.length);
    const out: number[][] = [];
    for (const r of this.rects) {
      if (seen[r.id]) continue;
      if (!ignoreGates && !this.passable(r)) continue;
      const comp: number[] = [];
      const stack = [r.id];
      seen[r.id] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        comp.push(c);
        for (const l of this.rects[c].links) {
          if (seen[l.to]) continue;
          if (!ignoreGates && !this.passable(this.rects[l.to])) continue;
          seen[l.to] = 1;
          stack.push(l.to);
        }
      }
      out.push(comp);
    }
    return out;
  }

  /** Pairs of rects that overlap in XZ at similar heights (authoring errors). */
  overlaps(): [number, number][] {
    const out: [number, number][] = [];
    const R = this.rects;
    for (let i = 0; i < R.length; i++) {
      for (let j = i + 1; j < R.length; j++) {
        const a = R[i];
        const b = R[j];
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
        if (ox > 0.15 && oz > 0.15) {
          const cx = (Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2;
          const cz = (Math.max(a.z0, b.z0) + Math.min(a.z1, b.z1)) / 2;
          if (Math.abs(this.heightOn(a, cx, cz) - this.heightOn(b, cx, cz)) < 1.5) out.push([i, j]);
        }
      }
    }
    return out;
  }

  get linkCount(): number {
    let n = 0;
    for (const r of this.rects) n += r.links.length;
    return n / 2;
  }
}
