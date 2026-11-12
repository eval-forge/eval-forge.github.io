/**
 * Navigation mesh: axis-aligned convex polygons (flat rectangles and ramps) with portals on
 * shared edges, A* over polygons and the funnel algorithm for straight paths.
 * Pure logic, unit tested.
 */

export interface NavPoly {
  id: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Surface height: y = a*x + b*z + c */
  a: number;
  b: number;
  c: number;
  scene: string;
  gate: string | null;
  enabled: boolean;
  cx: number;
  cz: number;
}

export interface NavLink {
  to: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export type V3 = [number, number, number];

export interface PathOptions {
  /** Cost multiplier for entering a polygon; Infinity makes it impassable. */
  cost?: (p: NavPoly) => number;
  maxIterations?: number;
  /**
   * When the goal cannot be reached (a closed gate), return a path to the reachable polygon
   * closest to it instead of null. Guardians use this to press up against shut doors.
   */
  partial?: boolean;
}

const CELL = 4;

export function polyHeight(p: NavPoly, x: number, z: number): number {
  return p.a * x + p.b * z + p.c;
}

class MinHeap {
  private items: { id: number; f: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(id: number, f: number) {
    const a = this.items;
    a.push({ id, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { id: number; f: number } | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function triarea2(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const acx = cx - ax;
  const acz = cz - az;
  return acx * abz - abx * acz;
}

export class NavMesh {
  polys: NavPoly[];
  links: NavLink[][];
  private grid = new Map<string, number[]>();

  constructor(polys: NavPoly[]) {
    this.polys = polys.map((p, i) => ({ ...p, id: i }));
    this.links = this.polys.map(() => []);
    for (const p of this.polys) {
      const gx0 = Math.floor(p.x0 / CELL);
      const gx1 = Math.floor((p.x1 - 1e-6) / CELL);
      const gz0 = Math.floor(p.z0 / CELL);
      const gz1 = Math.floor((p.z1 - 1e-6) / CELL);
      for (let gx = gx0; gx <= gx1; gx++)
        for (let gz = gz0; gz <= gz1; gz++) {
          const k = gx + ',' + gz;
          let arr = this.grid.get(k);
          if (!arr) this.grid.set(k, (arr = []));
          arr.push(p.id);
        }
    }
    this.buildLinks();
  }

  private buildLinks() {
    type Edge = { poly: number; s: number; e: number };
    const lines = new Map<string, Edge[]>();
    const add = (key: string, e: Edge) => {
      let arr = lines.get(key);
      if (!arr) lines.set(key, (arr = []));
      arr.push(e);
    };
    for (const p of this.polys) {
      add('z' + Math.round(p.z0 * 100), { poly: p.id, s: p.x0, e: p.x1 });
      add('z' + Math.round(p.z1 * 100), { poly: p.id, s: p.x0, e: p.x1 });
      add('x' + Math.round(p.x0 * 100), { poly: p.id, s: p.z0, e: p.z1 });
      add('x' + Math.round(p.x1 * 100), { poly: p.id, s: p.z0, e: p.z1 });
    }
    for (const [key, edges] of lines) {
      const horizontal = key[0] === 'z';
      const coord = parseInt(key.slice(1), 10) / 100;
      edges.sort((a, b) => a.s - b.s);
      for (let i = 0; i < edges.length; i++) {
        const ei = edges[i];
        for (let j = i + 1; j < edges.length; j++) {
          const ej = edges[j];
          if (ej.s >= ei.e - 0.05) break;
          if (ej.poly === ei.poly) continue;
          const s = Math.max(ei.s, ej.s);
          const e = Math.min(ei.e, ej.e);
          if (e - s < 0.3) continue;
          const pa = this.polys[ei.poly];
          const pb = this.polys[ej.poly];
          // The two polygons must lie on opposite sides of the line.
          const sideA = horizontal ? pa.cz - coord : pa.cx - coord;
          const sideB = horizontal ? pb.cz - coord : pb.cx - coord;
          if (sideA * sideB >= 0) continue;
          const mid = (s + e) / 2;
          const mx = horizontal ? mid : coord;
          const mz = horizontal ? coord : mid;
          if (Math.abs(polyHeight(pa, mx, mz) - polyHeight(pb, mx, mz)) > 0.45) continue;
          const ax = horizontal ? s : coord;
          const az = horizontal ? coord : s;
          const bx = horizontal ? e : coord;
          const bz = horizontal ? coord : e;
          if (!this.links[pa.id].some((l) => l.to === pb.id && Math.abs(l.ax - ax) + Math.abs(l.az - az) < 0.01)) {
            this.links[pa.id].push({ to: pb.id, ax, az, bx, bz });
            this.links[pb.id].push({ to: pa.id, ax, az, bx, bz });
          }
        }
      }
    }
  }

  get linkCount(): number {
    return this.links.reduce((s, l) => s + l.length, 0) / 2;
  }

  private candidates(x: number, z: number): number[] {
    return this.grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)) ?? [];
  }

  /** Polygon containing (x, z) whose surface is closest to y (preferring surfaces at or below y). */
  findPoly(x: number, y: number, z: number, maxDy = 2.5, includeDisabled = false): NavPoly | null {
    let best: NavPoly | null = null;
    let bestScore = Infinity;
    for (const id of this.candidates(x, z)) {
      const p = this.polys[id];
      if (!includeDisabled && !p.enabled) continue;
      if (x < p.x0 - 1e-6 || x > p.x1 + 1e-6 || z < p.z0 - 1e-6 || z > p.z1 + 1e-6) continue;
      const h = polyHeight(p, x, z);
      const dy = y - h;
      if (dy < -0.8 || dy > maxDy) continue;
      const score = dy >= 0 ? dy : -dy * 3;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  /** Nearest enabled polygon within `radius` (horizontal), with the clamped point on it. */
  nearest(x: number, y: number, z: number, radius = 4, maxDy = 3): { poly: NavPoly; x: number; y: number; z: number } | null {
    const inside = this.findPoly(x, y, z, maxDy);
    if (inside) return { poly: inside, x, y: polyHeight(inside, x, z), z };
    let best: { poly: NavPoly; x: number; y: number; z: number } | null = null;
    let bestD = Infinity;
    const r = Math.ceil(radius / CELL);
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    const seen = new Set<number>();
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const arr = this.grid.get(gx + dx + ',' + (gz + dz));
        if (!arr) continue;
        for (const id of arr) {
          if (seen.has(id)) continue;
          seen.add(id);
          const p = this.polys[id];
          if (!p.enabled) continue;
          const cx = Math.min(p.x1 - 0.05, Math.max(p.x0 + 0.05, x));
          const cz = Math.min(p.z1 - 0.05, Math.max(p.z0 + 0.05, z));
          const h = polyHeight(p, cx, cz);
          const dy = Math.abs(h - y);
          if (dy > maxDy) continue;
          const d = Math.hypot(cx - x, cz - z) + dy * 0.5;
          if (d < bestD && Math.hypot(cx - x, cz - z) <= radius) {
            bestD = d;
            best = { poly: p, x: cx, y: h, z: cz };
          }
        }
      }
    return best;
  }

  setGate(gate: string, enabled: boolean) {
    for (const p of this.polys) if (p.gate === gate) p.enabled = enabled;
  }

  /** Enable or disable every polygon overlapping a rectangle near height y (fallen floors, rubble). */
  setRect(x0: number, z0: number, x1: number, z1: number, y: number, enabled: boolean, dy = 1) {
    for (const p of this.polys) {
      if (p.x1 <= x0 || p.x0 >= x1 || p.z1 <= z0 || p.z0 >= z1) continue;
      const h = polyHeight(p, (Math.max(p.x0, x0) + Math.min(p.x1, x1)) / 2, (Math.max(p.z0, z0) + Math.min(p.z1, z1)) / 2);
      if (Math.abs(h - y) > dy) continue;
      p.enabled = enabled;
    }
  }

  /** A* over polygons followed by the funnel algorithm. Returns 3D waypoints or null. */
  findPath(start: V3, end: V3, opts: PathOptions = {}): V3[] | null {
    const s = this.nearest(start[0], start[1], start[2], 3);
    const e = this.nearest(end[0], end[1], end[2], 6);
    if (!s || !e) return null;
    const sp: V3 = [s.x, s.y, s.z];
    const ep: V3 = [e.x, e.y, e.z];
    if (s.poly.id === e.poly.id) return [sp, ep];
    const cost = opts.cost;
    const maxIt = opts.maxIterations ?? 20000;
    const n = this.polys.length;
    const g = new Float64Array(n).fill(Infinity);
    const px = new Float64Array(n);
    const pz = new Float64Array(n);
    const py = new Float64Array(n);
    const parent = new Int32Array(n).fill(-1);
    const parentLink: (NavLink | null)[] = new Array(n).fill(null);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    g[s.poly.id] = 0;
    px[s.poly.id] = sp[0];
    py[s.poly.id] = sp[1];
    pz[s.poly.id] = sp[2];
    heap.push(s.poly.id, Math.hypot(ep[0] - sp[0], ep[2] - sp[2]));
    let found = false;
    let it = 0;
    let bestId = s.poly.id;
    let bestH = Math.hypot(ep[0] - sp[0], ep[2] - sp[2]);
    while (heap.size && it++ < maxIt) {
      const cur = heap.pop()!.id;
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === e.poly.id) {
        found = true;
        break;
      }
      const curPoly = this.polys[cur];
      // distance from the goal to the nearest point of this rectangle
      const qx = Math.min(curPoly.x1, Math.max(curPoly.x0, ep[0]));
      const qz = Math.min(curPoly.z1, Math.max(curPoly.z0, ep[2]));
      const h = Math.hypot(ep[0] - qx, ep[2] - qz);
      if (h < bestH) {
        bestH = h;
        bestId = cur;
      }
      for (const l of this.links[cur]) {
        const to = this.polys[l.to];
        if (!to.enabled || closed[l.to]) continue;
        let mul = 1;
        if (cost && l.to !== e.poly.id) {
          mul = cost(to);
          if (!Number.isFinite(mul)) continue;
        }
        // entry point: closest point on the portal to the current point
        const ex = l.bx - l.ax;
        const ez = l.bz - l.az;
        const len2 = ex * ex + ez * ez;
        let t = len2 > 0 ? ((px[cur] - l.ax) * ex + (pz[cur] - l.az) * ez) / len2 : 0.5;
        t = Math.min(0.9, Math.max(0.1, t));
        const mx = l.ax + ex * t;
        const mz = l.az + ez * t;
        const my = polyHeight(to, mx, mz);
        const ng = g[cur] + Math.hypot(mx - px[cur], mz - pz[cur], (my - py[cur]) * 0.5) * mul;
        if (ng < g[l.to]) {
          g[l.to] = ng;
          px[l.to] = mx;
          pz[l.to] = mz;
          py[l.to] = my;
          parent[l.to] = cur;
          parentLink[l.to] = l;
          heap.push(l.to, ng + Math.hypot(ep[0] - mx, ep[2] - mz));
        }
      }
    }
    let goal = e.poly.id;
    let goalPt = ep;
    if (!found) {
      if (!opts.partial || bestId === s.poly.id) return null;
      const b = this.polys[bestId];
      goal = bestId;
      // the point of that polygon nearest the goal, kept a little inside its edge
      const m = 0.4;
      const gx = Math.min(b.x1 - Math.min(m, (b.x1 - b.x0) / 2), Math.max(b.x0 + Math.min(m, (b.x1 - b.x0) / 2), ep[0]));
      const gz = Math.min(b.z1 - Math.min(m, (b.z1 - b.z0) / 2), Math.max(b.z0 + Math.min(m, (b.z1 - b.z0) / 2), ep[2]));
      goalPt = [gx, polyHeight(b, gx, gz), gz];
    }
    // Collect the polygon corridor.
    const corridor: number[] = [];
    for (let c = goal; c !== -1; c = parent[c]) corridor.unshift(c);
    return this.funnel(sp, goalPt, corridor, parentLink);
  }

  private funnel(sp: V3, ep: V3, corridor: number[], parentLink: (NavLink | null)[]): V3[] {
    // Portals as (left, right) with the poly index on the far side for height lookup.
    const L: [number, number][] = [[sp[0], sp[2]]];
    const R: [number, number][] = [[sp[0], sp[2]]];
    const owner: number[] = [corridor[0]];
    for (let i = 1; i < corridor.length; i++) {
      const l = parentLink[corridor[i]]!;
      const a = this.polys[corridor[i - 1]];
      const b = this.polys[corridor[i]];
      const dx = b.cx - a.cx;
      const dz = b.cz - a.cz;
      // cross(d, p - a) is larger for the endpoint further to the left in the (x, z) frame.
      const crA = dx * (l.az - a.cz) - dz * (l.ax - a.cx);
      const crB = dx * (l.bz - a.cz) - dz * (l.bx - a.cx);
      if (crA > crB) {
        L.push([l.ax, l.az]);
        R.push([l.bx, l.bz]);
      } else {
        L.push([l.bx, l.bz]);
        R.push([l.ax, l.az]);
      }
      owner.push(corridor[i]);
    }
    L.push([ep[0], ep[2]]);
    R.push([ep[0], ep[2]]);
    owner.push(corridor[corridor.length - 1]);

    const out: [number, number, number][] = [[sp[0], sp[2], corridor[0]]];
    let apex = [sp[0], sp[2]] as [number, number];
    let left = L[0];
    let right = R[0];
    let apexI = 0;
    let leftI = 0;
    let rightI = 0;
    const eq = (p: [number, number], q: [number, number]) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
    for (let i = 1; i < L.length; i++) {
      const pl = L[i];
      const pr = R[i];
      // right side
      if (triarea2(apex[0], apex[1], right[0], right[1], pr[0], pr[1]) <= 0) {
        if (eq(apex, right) || triarea2(apex[0], apex[1], left[0], left[1], pr[0], pr[1]) > 0) {
          right = pr;
          rightI = i;
        } else {
          out.push([left[0], left[1], owner[leftI]]);
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
      // left side
      if (triarea2(apex[0], apex[1], left[0], left[1], pl[0], pl[1]) >= 0) {
        if (eq(apex, left) || triarea2(apex[0], apex[1], right[0], right[1], pl[0], pl[1]) < 0) {
          left = pl;
          leftI = i;
        } else {
          out.push([right[0], right[1], owner[rightI]]);
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
    const last = out[out.length - 1];
    if (Math.abs(last[0] - ep[0]) > 1e-4 || Math.abs(last[1] - ep[2]) > 1e-4) out.push([ep[0], ep[2], corridor[corridor.length - 1]]);
    return out.map(([x, z, pi], idx) => {
      if (idx === 0) return sp;
      if (idx === out.length - 1 && x === ep[0] && z === ep[2]) return ep;
      return [x, polyHeight(this.polys[pi], x, z), z] as V3;
    });
  }

  /** Total length of a path. */
  static pathLength(path: V3[]): number {
    let d = 0;
    for (let i = 1; i < path.length; i++) d += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
    return d;
  }

  /** Random enabled point within radius of (x, z) on the same scene, for wandering. */
  randomPointNear(x: number, y: number, z: number, radius: number, rand: () => number): V3 | null {
    for (let tries = 0; tries < 12; tries++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radius;
      const q = this.nearest(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 2, 3);
      if (q) return [q.x, q.y, q.z];
    }
    return null;
  }
}
