import type { V2, V3 } from './vec';

/**
 * Convex-polygon navmesh with portal graph, A* and funnel string pulling.
 * Polygons live on the xz plane; each has a planar height function so ramps
 * and stairs work and several floors can stack.
 */

export interface NavPolyDef {
  /** Convex polygon vertices on xz (either winding). */
  verts: V2[];
  /** Height plane: y = y0 + gx * (x - ox) + gz * (z - oz). */
  y0: number;
  gx?: number;
  gz?: number;
  ox?: number;
  oz?: number;
  /** Optional gate key; a predicate decides whether it can be crossed. */
  gate?: string;
  tag?: string;
}

export interface Portal { a: V2; b: V2; to: number }

export interface NavPoly extends NavPolyDef {
  id: number;
  centroid: V2;
  portals: Portal[];
  minX: number; maxX: number; minZ: number; maxZ: number;
}

const EPS = 1e-4;

export function rectPoly(x0: number, z0: number, x1: number, z1: number, y: number, extra: Partial<NavPolyDef> = {}): NavPolyDef {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
  return { verts: [{ x: ax, z: az }, { x: bx, z: az }, { x: bx, z: bz }, { x: ax, z: bz }], y0: y, ...extra };
}

/** Ramp along x or z: height goes from yStart at the start coordinate to yEnd at the end coordinate. */
export function rampPoly(x0: number, z0: number, x1: number, z1: number, axis: 'x' | 'z', yStart: number, yEnd: number, extra: Partial<NavPolyDef> = {}): NavPolyDef {
  const base = rectPoly(x0, z0, x1, z1, yStart, extra);
  if (axis === 'x') {
    return { ...base, y0: yStart, ox: x0, oz: 0, gx: (yEnd - yStart) / (x1 - x0), gz: 0 };
  }
  return { ...base, y0: yStart, ox: 0, oz: z0, gx: 0, gz: (yEnd - yStart) / (z1 - z0) };
}

export function polyHeight(p: NavPolyDef, x: number, z: number): number {
  return p.y0 + (p.gx ?? 0) * (x - (p.ox ?? 0)) + (p.gz ?? 0) * (z - (p.oz ?? 0));
}

function cross(ax: number, az: number, bx: number, bz: number) { return ax * bz - az * bx; }

export function pointInPoly(p: NavPolyDef, x: number, z: number): boolean {
  const v = p.verts;
  let sign = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const c = cross(b.x - a.x, b.z - a.z, x - a.x, z - a.z);
    if (Math.abs(c) < EPS) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function closestOnSegment(px: number, pz: number, a: V2, b: V2): V2 {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - a.x) * dx + (pz - a.z) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + dx * t, z: a.z + dz * t };
}

export function closestPointInPoly(p: NavPolyDef, x: number, z: number): V2 {
  if (pointInPoly(p, x, z)) return { x, z };
  let best: V2 = p.verts[0], bd = Infinity;
  for (let i = 0; i < p.verts.length; i++) {
    const c = closestOnSegment(x, z, p.verts[i], p.verts[(i + 1) % p.verts.length]);
    const d = (c.x - x) ** 2 + (c.z - z) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/** Overlap of two collinear, opposite-facing edges; returns the shared segment or null. */
function sharedSegment(a0: V2, a1: V2, b0: V2, b1: V2, minWidth: number): [V2, V2] | null {
  const dx = a1.x - a0.x, dz = a1.z - a0.z;
  const len = Math.hypot(dx, dz);
  if (len < EPS) return null;
  const ux = dx / len, uz = dz / len;
  // collinearity: both b points on line a
  const d0 = Math.abs(cross(ux, uz, b0.x - a0.x, b0.z - a0.z));
  const d1 = Math.abs(cross(ux, uz, b1.x - a0.x, b1.z - a0.z));
  if (d0 > 0.05 || d1 > 0.05) return null;
  const tb0 = (b0.x - a0.x) * ux + (b0.z - a0.z) * uz;
  const tb1 = (b1.x - a0.x) * ux + (b1.z - a0.z) * uz;
  const lo = Math.max(0, Math.min(tb0, tb1));
  const hi = Math.min(len, Math.max(tb0, tb1));
  if (hi - lo < minWidth) return null;
  return [{ x: a0.x + ux * lo, z: a0.z + uz * lo }, { x: a0.x + ux * hi, z: a0.z + uz * hi }];
}

export class NavMesh {
  polys: NavPoly[] = [];

  constructor(defs: NavPolyDef[], opts: { minPortal?: number; maxStep?: number } = {}) {
    const minPortal = opts.minPortal ?? 0.5;
    const maxStep = opts.maxStep ?? 0.6;
    this.polys = defs.map((d, id) => {
      const xs = d.verts.map((v) => v.x), zs = d.verts.map((v) => v.z);
      const centroid = { x: xs.reduce((a, b) => a + b, 0) / xs.length, z: zs.reduce((a, b) => a + b, 0) / zs.length };
      return { ...d, id, centroid, portals: [], minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    });
    for (let i = 0; i < this.polys.length; i++) {
      for (let j = i + 1; j < this.polys.length; j++) {
        const A = this.polys[i], B = this.polys[j];
        if (A.maxX < B.minX - 0.05 || B.maxX < A.minX - 0.05 || A.maxZ < B.minZ - 0.05 || B.maxZ < A.minZ - 0.05) continue;
        for (let ea = 0; ea < A.verts.length; ea++) {
          const a0 = A.verts[ea], a1 = A.verts[(ea + 1) % A.verts.length];
          for (let eb = 0; eb < B.verts.length; eb++) {
            const b0 = B.verts[eb], b1 = B.verts[(eb + 1) % B.verts.length];
            const seg = sharedSegment(a0, a1, b0, b1, minPortal);
            if (!seg) continue;
            const mx = (seg[0].x + seg[1].x) / 2, mz = (seg[0].z + seg[1].z) / 2;
            if (Math.abs(polyHeight(A, mx, mz) - polyHeight(B, mx, mz)) > maxStep) continue;
            A.portals.push({ a: seg[0], b: seg[1], to: j });
            B.portals.push({ a: seg[0], b: seg[1], to: i });
          }
        }
      }
    }
  }

  /** Polygon containing (x,z) whose floor is closest to y (within maxDy). */
  findPoly(p: V3, maxDy = 2.5): NavPoly | null {
    let best: NavPoly | null = null, bd = Infinity;
    for (const poly of this.polys) {
      if (p.x < poly.minX - EPS || p.x > poly.maxX + EPS || p.z < poly.minZ - EPS || p.z > poly.maxZ + EPS) continue;
      if (!pointInPoly(poly, p.x, p.z)) continue;
      const dy = Math.abs(polyHeight(poly, p.x, p.z) - p.y);
      if (dy < bd && dy <= maxDy) { bd = dy; best = poly; }
    }
    return best;
  }

  /** Nearest polygon and snapped point, searching all polys (3D distance with height). */
  nearest(p: V3, canUse: (poly: NavPoly) => boolean = () => true): { poly: NavPoly; point: V3 } | null {
    const inside = this.findPoly(p);
    if (inside && canUse(inside)) return { poly: inside, point: { x: p.x, y: polyHeight(inside, p.x, p.z), z: p.z } };
    let best: { poly: NavPoly; point: V3 } | null = null, bd = Infinity;
    for (const poly of this.polys) {
      if (!canUse(poly)) continue;
      const c = closestPointInPoly(poly, p.x, p.z);
      const y = polyHeight(poly, c.x, c.z);
      const d = (c.x - p.x) ** 2 + ((y - p.y) * 2) ** 2 + (c.z - p.z) ** 2;
      if (d < bd) { bd = d; best = { poly, point: { x: c.x, y, z: c.z } }; }
    }
    return best;
  }

  /** A* over polygons using portal midpoints as waypoints. Returns poly id corridor. */
  corridor(start: V3, end: V3, canUse: (poly: NavPoly) => boolean = () => true): { polys: number[]; start: V3; end: V3 } | null {
    const s = this.nearest(start, canUse), e = this.nearest(end, canUse);
    if (!s || !e) return null;
    if (s.poly.id === e.poly.id) return { polys: [s.poly.id], start: s.point, end: e.point };
    const n = this.polys.length;
    const g = new Float64Array(n).fill(Infinity);
    const f = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const pos: V2[] = new Array(n);
    const closed = new Uint8Array(n);
    const open: number[] = [s.poly.id];
    g[s.poly.id] = 0;
    pos[s.poly.id] = { x: s.point.x, z: s.point.z };
    const h = (x: number, z: number) => Math.hypot(x - e.point.x, z - e.point.z);
    f[s.poly.id] = h(s.point.x, s.point.z);
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open.splice(bi, 1);
      if (cur === e.poly.id) break;
      closed[cur] = 1;
      const cp = pos[cur];
      for (const portal of this.polys[cur].portals) {
        const nb = portal.to;
        if (closed[nb] || !canUse(this.polys[nb])) continue;
        const mx = (portal.a.x + portal.b.x) / 2, mz = (portal.a.z + portal.b.z) / 2;
        let cost = g[cur] + Math.hypot(mx - cp.x, mz - cp.z);
        if (nb === e.poly.id) cost += Math.hypot(e.point.x - mx, e.point.z - mz);
        if (cost < g[nb]) {
          g[nb] = cost;
          f[nb] = cost + h(mx, mz);
          came[nb] = cur;
          pos[nb] = { x: mx, z: mz };
          if (!open.includes(nb)) open.push(nb);
        }
      }
    }
    if (came[e.poly.id] === -1) return null;
    const polys: number[] = [];
    for (let c = e.poly.id; c !== -1; c = came[c]) polys.push(c);
    polys.reverse();
    return { polys, start: s.point, end: e.point };
  }

  /** Full path: A* corridor + funnel string pulling. Points include floor height. */
  findPath(start: V3, end: V3, canUse: (poly: NavPoly) => boolean = () => true): V3[] | null {
    const c = this.corridor(start, end, canUse);
    if (!c) return null;
    const { polys } = c;
    // build portals as (left, right) in travel direction
    const portals: { left: V2; right: V2 }[] = [{ left: c.start, right: c.start }];
    for (let i = 0; i < polys.length - 1; i++) {
      const A = this.polys[polys[i]];
      const portal = A.portals.find((p) => p.to === polys[i + 1])!;
      // orient: looking from A's centroid toward the portal, `left` is on the left
      const from = A.centroid;
      const side = triArea2(from, portal.a, portal.b);
      if (side > 0) portals.push({ left: portal.a, right: portal.b });
      else portals.push({ left: portal.b, right: portal.a });
    }
    portals.push({ left: c.end, right: c.end });
    const pts2 = funnel(portals);
    // lift points onto the mesh: find the poly along the corridor that contains the point
    const out: V3[] = [];
    for (const p of pts2) {
      let y = c.start.y;
      let found = false;
      for (const id of polys) {
        const poly = this.polys[id];
        if (pointInPoly(poly, p.x, p.z)) { y = polyHeight(poly, p.x, p.z); found = true; break; }
      }
      if (!found) y = polyHeight(this.nearest({ x: p.x, y: c.start.y, z: p.z })!.poly, p.x, p.z);
      out.push({ x: p.x, y, z: p.z });
    }
    out[0] = c.start;
    out[out.length - 1] = c.end;
    return out;
  }

  /** Height of the mesh at (x,z) nearest to y, or null when off-mesh. */
  heightAt(x: number, y: number, z: number): number | null {
    const p = this.findPoly({ x, y, z });
    return p ? polyHeight(p, x, z) : null;
  }
}

/** Signed area*2 of triangle (a,b,c) on xz. Positive when c is to the right of a→b (x right, z down). */
export function triArea2(a: V2, b: V2, c: V2): number {
  const ax = b.x - a.x, az = b.z - a.z;
  const bx = c.x - a.x, bz = c.z - a.z;
  return bx * az - ax * bz;
}

const veq = (a: V2, b: V2) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < 1e-8;

/** Simple Stupid Funnel Algorithm (Mononen). portals[0] and last are the start/end points. */
export function funnel(portals: { left: V2; right: V2 }[]): V2[] {
  const pts: V2[] = [];
  let apex = portals[0].left, pl = portals[0].left, pr = portals[0].right;
  let apexI = 0, li = 0, ri = 0;
  pts.push(apex);
  for (let i = 1; i < portals.length; i++) {
    const left = portals[i].left, right = portals[i].right;
    // right side
    if (triArea2(apex, pr, right) <= 0) {
      if (veq(apex, pr) || triArea2(apex, pl, right) > 0) {
        pr = right; ri = i;
      } else {
        apex = pl; apexI = li;
        if (!veq(pts[pts.length - 1], apex)) pts.push(apex);
        pl = apex; pr = apex; li = apexI; ri = apexI; i = apexI;
        continue;
      }
    }
    // left side
    if (triArea2(apex, pl, left) >= 0) {
      if (veq(apex, pl) || triArea2(apex, pr, left) < 0) {
        pl = left; li = i;
      } else {
        apex = pr; apexI = ri;
        if (!veq(pts[pts.length - 1], apex)) pts.push(apex);
        pl = apex; pr = apex; li = apexI; ri = apexI; i = apexI;
        continue;
      }
    }
  }
  const end = portals[portals.length - 1].left;
  if (!veq(pts[pts.length - 1], end)) pts.push(end);
  return pts;
}

/** Total length of a polyline. */
export function pathLength(p: V3[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y, p[i].z - p[i - 1].z);
  return s;
}
