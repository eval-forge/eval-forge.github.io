import type { V3 } from './types';

/**
 * Walkable rectangle. Flat by default; with `slope` set it is a ramp whose height runs from
 * `y` at the low-coordinate edge to `y2` at the high-coordinate edge along that axis.
 */
export interface NavRect {
  x1: number; z1: number; x2: number; z2: number;
  y: number; y2?: number; slope?: 'x' | 'z';
  /** Polygons sharing a tag can be switched off together (crumbled floor, shut door). */
  tag?: string;
}

interface Portal { to: number; ax: number; az: number; bx: number; bz: number; y: number; }

interface Poly { id: number; r: NavRect; cx: number; cz: number; links: Portal[]; enabled: boolean; }

const EPS = 0.06;
const MIN_PORTAL = 0.7;
const MAX_STEP = 0.75;

function rectHeight(r: NavRect, x: number, z: number): number {
  if (!r.slope || r.y2 === undefined) return r.y;
  const k = r.slope === 'x' ? (x - r.x1) / (r.x2 - r.x1) : (z - r.z1) / (r.z2 - r.z1);
  return r.y + (r.y2 - r.y) * Math.min(1, Math.max(0, k));
}

/** Cut axis-aligned holes (pillars, pits) out of a set of rectangles. */
export function carve(rects: NavRect[], holes: { x1: number; z1: number; x2: number; z2: number }[], margin = 0): NavRect[] {
  let out = rects.map((r) => normalize(r));
  for (const h0 of holes) {
    const h = { x1: Math.min(h0.x1, h0.x2) - margin, x2: Math.max(h0.x1, h0.x2) + margin, z1: Math.min(h0.z1, h0.z2) - margin, z2: Math.max(h0.z1, h0.z2) + margin };
    const next: NavRect[] = [];
    for (const r of out) {
      if (h.x2 <= r.x1 || h.x1 >= r.x2 || h.z2 <= r.z1 || h.z1 >= r.z2) { next.push(r); continue; }
      const part = (x1: number, z1: number, x2: number, z2: number) => {
        // Thin strips are kept: dropping them would leave gaps that cut the mesh in two. Whether
        // an agent fits through is decided by portal width when the pieces are linked.
        if (x2 - x1 < 0.02 || z2 - z1 < 0.02) return;
        const p: NavRect = { ...r, x1, z1, x2, z2 };
        if (r.slope && r.y2 !== undefined) {
          // Keep the same plane on the cut piece.
          if (r.slope === 'x') { p.y = rectHeight(r, x1, 0); p.y2 = rectHeight(r, x2, 0); }
          else { p.y = rectHeight(r, 0, z1); p.y2 = rectHeight(r, 0, z2); }
        }
        next.push(p);
      };
      part(r.x1, r.z1, r.x2, Math.max(r.z1, h.z1));                       // strip before the hole in z
      part(r.x1, Math.min(r.z2, h.z2), r.x2, r.z2);                       // strip after
      const za = Math.max(r.z1, h.z1), zb = Math.min(r.z2, h.z2);
      part(r.x1, za, Math.max(r.x1, h.x1), zb);                           // left of the hole
      part(Math.min(r.x2, h.x2), za, r.x2, zb);                           // right of the hole
    }
    out = next;
  }
  return out;
}

function normalize(r: NavRect): NavRect {
  const n = { ...r };
  if (n.x1 > n.x2) {
    [n.x1, n.x2] = [n.x2, n.x1];
    if (n.slope === 'x' && n.y2 !== undefined) [n.y, n.y2] = [n.y2, n.y];
  }
  if (n.z1 > n.z2) {
    [n.z1, n.z2] = [n.z2, n.z1];
    if (n.slope === 'z' && n.y2 !== undefined) [n.y, n.y2] = [n.y2, n.y];
  }
  return n;
}

interface P2 { x: number; z: number; y: number; }

const triarea2 = (a: P2, b: P2, c: P2) => (c.x - a.x) * (b.z - a.z) - (b.x - a.x) * (c.z - a.z);
const same = (a: P2, b: P2) => Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.z - b.z) < 1e-4;

export interface PathResult { points: V3[]; length: number; polys: number[]; }

/**
 * A polygon navmesh whose polygons are axis-aligned rectangles (flat or ramped). Neighbouring
 * rectangles are joined by portals along the edge they share. Paths are found with A* over the
 * polygon graph and then pulled tight with the funnel algorithm, so agents cut corners properly
 * instead of homing in a straight line or zig-zagging between polygon centres.
 */
export class NavMesh {
  readonly polys: Poly[] = [];
  agentRadius = 0.45;

  constructor(rects: NavRect[]) {
    rects.forEach((r0, i) => {
      const r = normalize(r0);
      this.polys.push({ id: i, r, cx: (r.x1 + r.x2) / 2, cz: (r.z1 + r.z2) / 2, links: [], enabled: true });
    });
    this.link();
  }

  private link(): void {
    const ps = this.polys;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const A = ps[i].r, B = ps[j].r;
        let portal: { ax: number; az: number; bx: number; bz: number } | null = null;
        for (const x of [A.x2, A.x1]) {
          const other = x === A.x2 ? B.x1 : B.x2;
          if (Math.abs(x - other) < EPS) {
            const lo = Math.max(A.z1, B.z1), hi = Math.min(A.z2, B.z2);
            if (hi - lo >= MIN_PORTAL) portal = { ax: x, az: lo, bx: x, bz: hi };
          }
        }
        if (!portal) {
          for (const z of [A.z2, A.z1]) {
            const other = z === A.z2 ? B.z1 : B.z2;
            if (Math.abs(z - other) < EPS) {
              const lo = Math.max(A.x1, B.x1), hi = Math.min(A.x2, B.x2);
              if (hi - lo >= MIN_PORTAL) portal = { ax: lo, az: z, bx: hi, bz: z };
            }
          }
        }
        if (!portal) continue;
        const mx = (portal.ax + portal.bx) / 2, mz = (portal.az + portal.bz) / 2;
        const hA = rectHeight(A, mx, mz), hB = rectHeight(B, mx, mz);
        if (Math.abs(hA - hB) > MAX_STEP) continue;
        const y = (hA + hB) / 2;
        ps[i].links.push({ to: j, ...portal, y });
        ps[j].links.push({ to: i, ...portal, y });
      }
    }
  }

  /** Enable or disable every polygon carrying a tag. */
  setTagEnabled(tag: string, enabled: boolean): void {
    for (const p of this.polys) if (p.r.tag === tag) p.enabled = enabled;
  }

  heightAt(poly: number, x: number, z: number): number { return rectHeight(this.polys[poly].r, x, z); }

  /** The polygon under (or nearest to) a point, preferring the one closest in height. -1 if none. */
  findPoly(x: number, y: number, z: number, maxDist = 6): number {
    let best = -1, bestScore = Infinity;
    for (const p of this.polys) {
      if (!p.enabled) continue;
      const r = p.r;
      const cx = Math.min(r.x2, Math.max(r.x1, x)), cz = Math.min(r.z2, Math.max(r.z1, z));
      const d = Math.hypot(cx - x, cz - z);
      if (d > maxDist) continue;
      const dy = Math.abs(rectHeight(r, cx, cz) - y);
      const score = d * 2 + dy * (dy > 2.2 ? 6 : 1);
      if (score < bestScore) { bestScore = score; best = p.id; }
    }
    return best;
  }

  /** Nearest point on the mesh to an arbitrary point. */
  clampPoint(x: number, y: number, z: number): V3 | null {
    const id = this.findPoly(x, y, z, 30);
    if (id < 0) return null;
    const r = this.polys[id].r;
    const cx = Math.min(r.x2 - 0.2, Math.max(r.x1 + 0.2, x)), cz = Math.min(r.z2 - 0.2, Math.max(r.z1 + 0.2, z));
    return { x: cx, y: rectHeight(r, cx, cz), z: cz };
  }

  /** Height of the walkable surface nearest in height to nearY at (x, z), or null if off the mesh. */
  sampleHeight(x: number, z: number, nearY: number): number | null {
    const id = this.findPoly(x, nearY, z, 1.5);
    return id < 0 ? null : this.heightAt(id, x, z);
  }

  /** A* over polygons, then funnel. Returns null when the goal cannot be reached. */
  findPath(from: V3, to: V3): PathResult | null {
    const start = this.findPoly(from.x, from.y, from.z);
    const goal = this.findPoly(to.x, to.y, to.z);
    if (start < 0 || goal < 0) return null;
    const gr = this.polys[goal].r;
    const end: P2 = {
      x: Math.min(gr.x2, Math.max(gr.x1, to.x)), z: Math.min(gr.z2, Math.max(gr.z1, to.z)), y: 0,
    };
    end.y = rectHeight(gr, end.x, end.z);
    const begin: P2 = { x: from.x, z: from.z, y: from.y };

    const n = this.polys.length;
    const g = new Float64Array(n).fill(Infinity);
    const f = new Float64Array(n).fill(Infinity);
    const cameFrom = new Int32Array(n).fill(-1);
    const viaPortal: (Portal | null)[] = new Array(n).fill(null);
    const entryX = new Float64Array(n), entryZ = new Float64Array(n);
    const closed = new Uint8Array(n);
    const open: number[] = [start];
    g[start] = 0;
    f[start] = Math.hypot(end.x - begin.x, end.z - begin.z);
    entryX[start] = begin.x; entryZ[start] = begin.z;

    let found = false;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) { found = true; break; }
      closed[cur] = 1;
      for (const l of this.polys[cur].links) {
        if (closed[l.to] || !this.polys[l.to].enabled) continue;
        const mx = (l.ax + l.bx) / 2, mz = (l.az + l.bz) / 2;
        const cost = g[cur] + Math.hypot(mx - entryX[cur], mz - entryZ[cur]);
        if (cost < g[l.to]) {
          g[l.to] = cost;
          f[l.to] = cost + Math.hypot(end.x - mx, end.z - mz);
          cameFrom[l.to] = cur;
          viaPortal[l.to] = l;
          entryX[l.to] = mx; entryZ[l.to] = mz;
          if (!open.includes(l.to)) open.push(l.to);
        }
      }
    }
    if (!found) return null;

    const chain: number[] = [];
    for (let c = goal; c !== -1; c = cameFrom[c]) chain.unshift(c);

    // Build left/right portal list for the funnel.
    const lefts: P2[] = [begin], rights: P2[] = [begin];
    for (let i = 1; i < chain.length; i++) {
      const l = viaPortal[chain[i]]!;
      const fromPoly = this.polys[chain[i - 1]];
      let a: P2 = { x: l.ax, z: l.az, y: l.y }, b: P2 = { x: l.bx, z: l.bz, y: l.y };
      // Pull the portal ends in by the agent radius so paths do not scrape corners.
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const inset = Math.min(this.agentRadius, len / 2 - 0.05);
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      a = { x: a.x + ux * inset, z: a.z + uz * inset, y: l.y };
      b = { x: b.x - ux * inset, z: b.z - uz * inset, y: l.y };
      const c: P2 = { x: fromPoly.cx, z: fromPoly.cz, y: 0 };
      if (triarea2(c, a, b) < 0) { rights.push(a); lefts.push(b); } else { rights.push(b); lefts.push(a); }
    }
    lefts.push(end); rights.push(end);

    const pts: P2[] = [begin];
    let apex = begin, pl = lefts[0], pr = rights[0];
    let ai = 0, li = 0, ri = 0;
    for (let i = 1; i < lefts.length; i++) {
      const left = lefts[i], right = rights[i];
      if (triarea2(apex, pr, right) <= 0) {
        if (same(apex, pr) || triarea2(apex, pl, right) > 0) { pr = right; ri = i; }
        else {
          pts.push(pl); apex = pl; ai = li; pl = apex; pr = apex; li = ai; ri = ai; i = ai;
          continue;
        }
      }
      if (triarea2(apex, pl, left) >= 0) {
        if (same(apex, pl) || triarea2(apex, pr, left) < 0) { pl = left; li = i; }
        else {
          pts.push(pr); apex = pr; ai = ri; pl = apex; pr = apex; li = ai; ri = ai; i = ai;
          continue;
        }
      }
      if (pts.length > 4 * lefts.length + 8) break; // safety against degenerate loops
    }
    if (!same(pts[pts.length - 1], end)) pts.push(end);

    const points: V3[] = [];
    let length = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0 && same(pts[i], pts[i - 1])) continue;
      points.push({ x: pts[i].x, y: pts[i].y, z: pts[i].z });
      if (points.length > 1) {
        const a = points[points.length - 2], b = points[points.length - 1];
        length += Math.hypot(b.x - a.x, b.z - a.z);
      }
    }
    return { points, length, polys: chain };
  }

  /** Are two points connected at all? */
  connected(a: V3, b: V3): boolean { return this.findPath(a, b) !== null; }
}
