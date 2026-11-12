/**
 * Convex-polygon navmesh built from axis-aligned floor rectangles (flat or ramped).
 * A* over polygons, then the "simple stupid funnel algorithm" to string-pull the corridor.
 * Polygons can carry a gate id: closed gates make the polygon impassable.
 * Pure: unit-tested in Node.
 */

export interface NavRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Floor height (at the min end of `axis` for ramps). */
  y0: number;
  /** Ramp: height at the max end of `axis`. */
  y1?: number;
  axis?: 'x' | 'z';
  gate?: string;
  tag?: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Portal {
  to: number;
  // endpoints in xz with their heights
  ax: number;
  az: number;
  bx: number;
  bz: number;
  y: number;
  // unit normal pointing from this poly into `to`
  nx: number;
  nz: number;
}

export class NavMesh {
  readonly polys: NavRect[];
  readonly links: Portal[][];

  constructor(rects: NavRect[]) {
    this.polys = rects.map((r) => ({
      ...r,
      x0: Math.min(r.x0, r.x1),
      x1: Math.max(r.x0, r.x1),
      z0: Math.min(r.z0, r.z1),
      z1: Math.max(r.z0, r.z1),
    }));
    this.links = this.polys.map(() => []);
    this.buildLinks();
  }

  static heightAt(r: NavRect, x: number, z: number): number {
    if (r.y1 === undefined || !r.axis) return r.y0;
    if (r.axis === 'x') {
      const t = clamp01((x - r.x0) / (r.x1 - r.x0));
      return r.y0 + (r.y1 - r.y0) * t;
    }
    const t = clamp01((z - r.z0) / (r.z1 - r.z0));
    return r.y0 + (r.y1 - r.y0) * t;
  }

  private buildLinks() {
    const eps = 0.05;
    const minOverlap = 0.5;
    const P = this.polys;
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        const a = P[i];
        const b = P[j];
        // shared vertical edge (constant x)
        for (const [ax, bx, sign] of [
          [a.x1, b.x0, 1],
          [a.x0, b.x1, -1],
        ] as const) {
          if (Math.abs(ax - bx) < eps) {
            const lo = Math.max(a.z0, b.z0);
            const hi = Math.min(a.z1, b.z1);
            if (hi - lo >= minOverlap) {
              const mid = (lo + hi) / 2;
              const ha = NavMesh.heightAt(a, ax, mid);
              const hb = NavMesh.heightAt(b, ax, mid);
              if (Math.abs(ha - hb) < 0.6) {
                const y = (ha + hb) / 2;
                this.links[i].push({ to: j, ax, az: lo, bx: ax, bz: hi, y, nx: sign, nz: 0 });
                this.links[j].push({ to: i, ax, az: lo, bx: ax, bz: hi, y, nx: -sign, nz: 0 });
              }
            }
          }
        }
        // shared horizontal edge (constant z)
        for (const [az, bz, sign] of [
          [a.z1, b.z0, 1],
          [a.z0, b.z1, -1],
        ] as const) {
          if (Math.abs(az - bz) < eps) {
            const lo = Math.max(a.x0, b.x0);
            const hi = Math.min(a.x1, b.x1);
            if (hi - lo >= minOverlap) {
              const mid = (lo + hi) / 2;
              const ha = NavMesh.heightAt(a, mid, az);
              const hb = NavMesh.heightAt(b, mid, az);
              if (Math.abs(ha - hb) < 0.6) {
                const y = (ha + hb) / 2;
                this.links[i].push({ to: j, ax: lo, az, bx: hi, bz: az, y, nx: 0, nz: sign });
                this.links[j].push({ to: i, ax: lo, az, bx: hi, bz: az, y, nx: 0, nz: -sign });
              }
            }
          }
        }
      }
    }
  }

  /** Index of the polygon under (x, z) closest in height to y, or -1. */
  findPoly(x: number, y: number, z: number, margin = 0.01, maxDy = 2.5): number {
    let best = -1;
    let bestDy = Infinity;
    for (let i = 0; i < this.polys.length; i++) {
      const r = this.polys[i];
      if (x < r.x0 - margin || x > r.x1 + margin || z < r.z0 - margin || z > r.z1 + margin) continue;
      const dy = Math.abs(NavMesh.heightAt(r, x, z) - y);
      if (dy < bestDy && dy <= maxDy) {
        bestDy = dy;
        best = i;
      }
    }
    return best;
  }

  /** Closest point on the navmesh (prefers polys near the given height). */
  closestPoint(p: Vec3, maxDy = 4): { poly: number; point: Vec3 } | null {
    const direct = this.findPoly(p.x, p.y, p.z, 0.01, maxDy);
    if (direct >= 0) {
      return { poly: direct, point: { x: p.x, y: NavMesh.heightAt(this.polys[direct], p.x, p.z), z: p.z } };
    }
    let best = -1;
    let bestD = Infinity;
    let bx = 0;
    let bz = 0;
    for (let i = 0; i < this.polys.length; i++) {
      const r = this.polys[i];
      const cx = Math.min(Math.max(p.x, r.x0 + 0.05), r.x1 - 0.05);
      const cz = Math.min(Math.max(p.z, r.z0 + 0.05), r.z1 - 0.05);
      const dy = Math.abs(NavMesh.heightAt(r, cx, cz) - p.y);
      if (dy > maxDy) continue;
      const d = Math.hypot(cx - p.x, cz - p.z) + dy * 2;
      if (d < bestD) {
        bestD = d;
        best = i;
        bx = cx;
        bz = cz;
      }
    }
    if (best < 0) return null;
    return { poly: best, point: { x: bx, y: NavMesh.heightAt(this.polys[best], bx, bz), z: bz } };
  }

  heightAtPoint(x: number, y: number, z: number): number {
    const i = this.findPoly(x, y, z, 0.3, 3);
    return i >= 0 ? NavMesh.heightAt(this.polys[i], x, z) : y;
  }

  private center(i: number): Vec3 {
    const r = this.polys[i];
    const x = (r.x0 + r.x1) / 2;
    const z = (r.z0 + r.z1) / 2;
    return { x, y: NavMesh.heightAt(r, x, z), z };
  }

  /** A* over polygons. Returns the polygon corridor or null. */
  findCorridor(startPoly: number, endPoly: number, start: Vec3, end: Vec3, isOpen: (gate: string) => boolean): number[] | null {
    if (startPoly < 0 || endPoly < 0) return null;
    if (startPoly === endPoly) return [startPoly];
    const n = this.polys.length;
    const g = new Float64Array(n).fill(Infinity);
    const f = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const pos: Vec3[] = new Array(n);
    const closed = new Uint8Array(n);
    const open: number[] = [startPoly];
    g[startPoly] = 0;
    pos[startPoly] = start;
    f[startPoly] = dist(start, end);
    while (open.length) {
      // small graphs: linear scan for the lowest f
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open[bi];
      open.splice(bi, 1);
      if (cur === endPoly) {
        const out: number[] = [];
        let c = cur;
        while (c !== -1) {
          out.push(c);
          c = came[c];
        }
        return out.reverse();
      }
      closed[cur] = 1;
      for (const l of this.links[cur]) {
        const nb = l.to;
        if (closed[nb]) continue;
        const gate = this.polys[nb].gate;
        if (gate && !isOpen(gate) && nb !== endPoly) continue;
        if (gate && !isOpen(gate) && nb === endPoly) continue;
        const mid: Vec3 = { x: (l.ax + l.bx) / 2, y: l.y, z: (l.az + l.bz) / 2 };
        const ng = g[cur] + dist(pos[cur], mid);
        if (ng < g[nb]) {
          g[nb] = ng;
          pos[nb] = mid;
          came[nb] = cur;
          f[nb] = ng + dist(mid, end);
          if (!open.includes(nb)) open.push(nb);
        }
      }
    }
    return null;
  }

  /**
   * Full path query. Returns waypoints from start to end (start excluded, end included),
   * or null if unreachable. `agentRadius` keeps corners away from walls.
   */
  findPath(start: Vec3, end: Vec3, isOpen: (gate: string) => boolean = () => true, agentRadius = 0.4): Vec3[] | null {
    const s = this.closestPoint(start);
    const e = this.closestPoint(end);
    if (!s || !e) return null;
    const corridor = this.findCorridor(s.poly, e.poly, s.point, e.point, isOpen);
    if (!corridor) return null;
    if (corridor.length === 1) return [e.point];

    type P2 = { x: number; z: number; y: number };
    const lefts: P2[] = [{ x: s.point.x, z: s.point.z, y: s.point.y }];
    const rights: P2[] = [{ x: s.point.x, z: s.point.z, y: s.point.y }];
    for (let i = 0; i < corridor.length - 1; i++) {
      const link = this.links[corridor[i]].find((l) => l.to === corridor[i + 1])!;
      let ax = link.ax;
      let az = link.az;
      let bx = link.bx;
      let bz = link.bz;
      const len = Math.hypot(bx - ax, bz - az);
      const shrink = Math.min(agentRadius, len * 0.45);
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      ax += ux * shrink;
      az += uz * shrink;
      bx -= ux * shrink;
      bz -= uz * shrink;
      // left = endpoint with positive cross(normal, p - mid)
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const crossA = link.nx * (az - mz) - link.nz * (ax - mx);
      const A = { x: ax, z: az, y: link.y };
      const B = { x: bx, z: bz, y: link.y };
      if (crossA > 0) {
        lefts.push(A);
        rights.push(B);
      } else {
        lefts.push(B);
        rights.push(A);
      }
    }
    lefts.push({ x: e.point.x, z: e.point.z, y: e.point.y });
    rights.push({ x: e.point.x, z: e.point.z, y: e.point.y });

    const pts = stringPull(lefts, rights);
    // drop the start point
    pts.shift();
    return pts.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  }

  /** Total polygon area (for tests / debug). */
  area(): number {
    return this.polys.reduce((a, r) => a + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
  }
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function dist(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

type P = { x: number; z: number; y: number };

/** cross((b - a), (c - a)) in the xz plane. Positive: c is to the "left" of a→b. */
function cross(a: P, b: P, c: P) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function same(a: P, b: P) {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
}

/**
 * Simple stupid funnel algorithm. `lefts[i]`/`rights[i]` are portal endpoints, where
 * "left" means positive cross product relative to the travel direction.
 */
export function stringPull(lefts: P[], rights: P[]): P[] {
  const pts: P[] = [];
  let apex = lefts[0];
  let pl = lefts[0];
  let pr = rights[0];
  let apexI = 0;
  let li = 0;
  let ri = 0;
  pts.push(apex);
  for (let i = 1; i < lefts.length; i++) {
    const left = lefts[i];
    const right = rights[i];
    // tighten right side: new right must be left of (or on) apex→pr
    if (cross(apex, pr, right) >= 0) {
      if (same(apex, pr) || cross(apex, pl, right) < 0) {
        pr = right;
        ri = i;
      } else {
        // right crossed over left: left becomes new apex
        pts.push(pl);
        apex = pl;
        apexI = li;
        pl = apex;
        pr = apex;
        li = apexI;
        ri = apexI;
        i = apexI;
        continue;
      }
    }
    // tighten left side
    if (cross(apex, pl, left) <= 0) {
      if (same(apex, pl) || cross(apex, pr, left) > 0) {
        pl = left;
        li = i;
      } else {
        pts.push(pr);
        apex = pr;
        apexI = ri;
        pl = apex;
        pr = apex;
        li = apexI;
        ri = apexI;
        i = apexI;
        continue;
      }
    }
  }
  const last = lefts[lefts.length - 1];
  if (!same(pts[pts.length - 1], last)) pts.push(last);
  return pts;
}
