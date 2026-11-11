import * as THREE from 'three';
import { G } from '../core/ctx';
import { R } from '../core/Physics';
import type { SceneChunk } from '../world/SceneChunk';

/**
 * Baked navigation mesh: a multi-level grid of walkable 1 m cells produced by raycasting
 * the real static colliders, connected into a graph for A* with string pulling.
 */
export interface NavNode { id: number; x: number; y: number; z: number; ix: number; iz: number; nbrs: number[]; blocked: boolean; seen: boolean; chunk: string }

const CELL = 1;
const MAX_STEP = 1.25; // 1 m cells on 38° stairs can straddle three risers

class Heap {
  private a: number[] = [];
  constructor(private score: Float64Array) {}
  push(i: number) { const a = this.a; a.push(i); let k = a.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (this.score[a[p]] <= this.score[a[k]]) break; [a[p], a[k]] = [a[k], a[p]]; k = p; } }
  pop(): number { const a = this.a; const top = a[0]; const last = a.pop()!; if (a.length) { a[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l; if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r; if (m === k) break; [a[m], a[k]] = [a[k], a[m]]; k = m; } } return top; }
  get size() { return this.a.length; }
}

export class NavGraph {
  nodes: NavNode[] = [];
  private grid = new Map<string, number[]>();
  bakeMs = 0;

  private key(ix: number, iz: number) { return ix + ',' + iz; }

  private tryNode(chunk: string, x: number, z: number, y: number, okCollider: (c: { handle: number }) => boolean, ball: InstanceType<typeof R.Ball>, rot: { x: number; y: number; z: number; w: number }) {
    const world = G.physics.world;
    // headroom
    const up = world.castRay(new R.Ray({ x: x + 0.5, y: y + 0.05, z: z + 0.5 }, { x: 0, y: 1, z: 0 }), 1.7, true, undefined, undefined, undefined, undefined, (c) => okCollider(c));
    if (up) return;
    // clearance from walls
    let blocked = false;
    world.intersectionsWithShape({ x: x + 0.5, y: y + 1.25, z: z + 0.5 }, rot, ball, (c) => { if (G.physics.tags.get(c.handle)?.kind === 'static') { blocked = true; return false; } return true; });
    if (blocked) return;
    const ix = Math.floor(x), iz = Math.floor(z);
    const k = this.key(ix, iz);
    const list = this.grid.get(k) ?? [];
    if (list.some((id) => Math.abs(this.nodes[id].y - y) < 0.5)) return;
    const n: NavNode = { id: this.nodes.length, x: x + 0.5, y, z: z + 0.5, ix, iz, nbrs: [], blocked: false, seen: false, chunk };
    this.nodes.push(n);
    list.push(n.id);
    this.grid.set(k, list);
  }

  bake(chunks: SceneChunk[]) {
    const t0 = performance.now();
    const world = G.physics.world;
    const ball = new R.Ball(0.3);
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    const okCollider = (c: { handle: number }) => {
      const t = G.physics.tags.get(c.handle);
      return !!t && (t.kind === 'static' || t.kind === 'tile' || t.kind === 'plank');
    };
    for (const ch of chunks) {
      for (const reg of ch.navRegions) {
        for (let x = Math.ceil(reg.min.x); x <= reg.max.x; x += CELL) {
          for (let z = Math.ceil(reg.min.z); z <= reg.max.z; z += CELL) {
            // Multi-level column scan with hollow casts: every upward-facing surface
            // in the column is a candidate floor (ceilings are passed through via
            // their downward-facing undersides).
            let sy = reg.max.y;
            for (let k = 0; k < 10 && sy > reg.min.y; k++) {
              const ray = new R.Ray({ x: x + 0.5, y: sy, z: z + 0.5 }, { x: 0, y: -1, z: 0 });
              const hit = world.castRayAndGetNormal(ray, sy - reg.min.y, false, undefined, undefined, undefined, undefined, (c) => okCollider(c));
              if (!hit) break;
              const hy = sy - hit.timeOfImpact;
              sy = hy - 0.02;
              if (hit.normal.y >= 0.65) this.tryNode(ch.id, x, z, hy, okCollider, ball, rot);
            }
          }
        }
      }
    }
    // Link neighbours
    for (const n of this.nodes) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const list = this.grid.get(this.key(n.ix + dx, n.iz + dz));
        if (!list) continue;
        for (const id of list) {
          const m = this.nodes[id];
          if (Math.abs(m.y - n.y) > MAX_STEP) continue;
          if (dx && dz) {
            // diagonal only if both orthogonal cells exist (no corner cutting)
            const a = this.grid.get(this.key(n.ix + dx, n.iz)), b = this.grid.get(this.key(n.ix, n.iz + dz));
            if (!a || !b) continue;
          }
          // wall between?
          const h = Math.max(n.y, m.y) + 0.6;
          const d = new THREE.Vector3(m.x - n.x, 0, m.z - n.z);
          const len = d.length(); d.normalize();
          const wall = world.castRay(new R.Ray({ x: n.x, y: h, z: n.z }, { x: d.x, y: 0, z: d.z }), len, true, undefined, undefined, undefined, undefined, (c) => G.physics.tags.get(c.handle)?.kind === 'static');
          if (wall) continue;
          n.nbrs.push(id);
        }
      }
    }
    this.bakeMs = performance.now() - t0;
  }

  nearest(p: THREE.Vector3, maxDist = 3): NavNode | null {
    const ix = Math.floor(p.x), iz = Math.floor(p.z);
    let best: NavNode | null = null, bd = Infinity;
    for (let r = 0; r <= Math.ceil(maxDist); r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const list = this.grid.get(this.key(ix + dx, iz + dz));
        if (!list) continue;
        for (const id of list) {
          const n = this.nodes[id];
          const d = Math.hypot(n.x - p.x, (n.y - p.y) * 3, n.z - p.z);
          if (d < bd) { bd = d; best = n; }
        }
      }
      if (best && r >= 1) break;
    }
    return best && bd < maxDist * 3 ? best : null;
  }

  /** Mark nodes inside a box as (un)blocked (doors, gates). */
  setBlocked(box: THREE.Box3, blocked: boolean) {
    for (let x = Math.floor(box.min.x); x <= box.max.x; x++) for (let z = Math.floor(box.min.z); z <= box.max.z; z++) {
      const list = this.grid.get(this.key(x, z));
      if (!list) continue;
      for (const id of list) { const n = this.nodes[id]; if (n.y >= box.min.y - 0.5 && n.y <= box.max.y) n.blocked = blocked; }
    }
  }

  /** A* from a to b. Returns world-space waypoints (smoothed) or null. */
  findPath(from: THREE.Vector3, to: THREE.Vector3, maxExpand = 12000): THREE.Vector3[] | null {
    const s = this.nearest(from), t = this.nearest(to, 6);
    if (!s || !t) return null;
    if (s === t) return [new THREE.Vector3(t.x, t.y, t.z)];
    const N = this.nodes.length;
    const g = new Float64Array(N).fill(Infinity);
    const f = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const h = (n: NavNode) => { const dx = Math.abs(n.x - t.x), dz = Math.abs(n.z - t.z); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz) + Math.abs(n.y - t.y); };
    const open = new Heap(f);
    g[s.id] = 0; f[s.id] = h(s); open.push(s.id);
    let expanded = 0;
    let bestId = s.id, bestH = h(s);
    while (open.size) {
      const cur = open.pop();
      if (closed[cur]) continue;
      if (cur === t.id) { bestId = cur; break; }
      closed[cur] = 1;
      if (++expanded > maxExpand) break;
      const cn = this.nodes[cur];
      const hc = h(cn);
      if (hc < bestH) { bestH = hc; bestId = cur; }
      for (const nb of cn.nbrs) {
        const m = this.nodes[nb];
        if (m.blocked || closed[nb]) continue;
        const cost = Math.hypot(m.x - cn.x, m.z - cn.z) + Math.abs(m.y - cn.y) * 0.5;
        const ng = g[cur] + cost;
        if (ng < g[nb]) { g[nb] = ng; came[nb] = cur; f[nb] = ng + h(m); open.push(nb); }
      }
    }
    // Reconstruct (to target, or to the closest reachable node)
    const ids: number[] = [];
    for (let c = bestId; c !== -1; c = came[c]) ids.push(c);
    ids.reverse();
    return this.smooth(ids);
  }

  /** String pulling: skip waypoints when the straight line stays on walkable cells at a similar height. */
  private smooth(ids: number[]): THREE.Vector3[] {
    const pts = ids.map((i) => this.nodes[i]);
    if (pts.length <= 2) return pts.map((n) => new THREE.Vector3(n.x, n.y, n.z));
    const out: NavNode[] = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      if (!this.walkableLine(pts[anchor], pts[i])) { out.push(pts[i - 1]); anchor = i - 1; }
    }
    out.push(pts[pts.length - 1]);
    return out.map((n) => new THREE.Vector3(n.x, n.y, n.z));
  }

  private walkableLine(a: NavNode, b: NavNode): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d > 14) return false;
    const steps = Math.ceil(d / 0.5);
    let prevY = a.y;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const list = this.grid.get(this.key(Math.floor(x), Math.floor(z)));
      if (!list) return false;
      let ok = false;
      for (const id of list) { const n = this.nodes[id]; if (!n.blocked && Math.abs(n.y - prevY) < MAX_STEP) { ok = true; prevY = n.y; break; } }
      if (!ok) return false;
    }
    return true;
  }

  /** Height of the walkable surface under a point (for agents). */
  heightAt(p: THREE.Vector3): number | null {
    const n = this.nearest(p, 1.5);
    return n ? n.y : null;
  }

  markSeen(p: THREE.Vector3, r: number) {
    const ix = Math.floor(p.x), iz = Math.floor(p.z), rr = Math.ceil(r);
    for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
      if (dx * dx + dz * dz > r * r) continue;
      const list = this.grid.get(this.key(ix + dx, iz + dz));
      if (!list) continue;
      for (const id of list) { const n = this.nodes[id]; if (Math.abs(n.y - p.y) < 4) n.seen = true; }
    }
  }
}
