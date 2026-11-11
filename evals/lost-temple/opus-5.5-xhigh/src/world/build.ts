/**
 * Level builders. Turns the floor list into wall/floor/ceiling boxes (once, at startup),
 * and turns box specs into merged meshes + colliders when a scene streams in.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FLOORS, FloorDef, ROOFS, BEAMS } from './layout';
import { NavMesh } from '../logic/navmesh';
import type { SceneId } from '../logic/unlocks';
import { surface, type Exposure, type SurfaceName } from '../engine/materials';
import type { Owner, Tag } from '../engine/physics';

export interface BoxSpec {
  c: [number, number, number];
  h: [number, number, number];
  mat: SurfaceName;
  exp: Exposure;
  rot?: THREE.Quaternion;
  collide?: boolean;
  cast?: boolean;
  uv?: number; // metres per texture tile
  tag?: Tag;
}

// ------------------------------------------------------------------ geometry helpers

/** Box geometry with world-scaled, world-offset UVs so adjacent boxes tile seamlessly. */
export function worldBox(w: number, h: number, d: number, center: THREE.Vector3, uvScale = 2.5, rotated = false): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const normal = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const px = pos.getX(i) + (rotated ? 0 : center.x);
    const py = pos.getY(i) + (rotated ? 0 : center.y);
    const pz = pos.getZ(i) + (rotated ? 0 : center.z);
    let u: number;
    let v: number;
    if (nx > 0.5) {
      u = pz;
      v = py;
    } else if (ny > 0.5) {
      u = px;
      v = pz;
    } else {
      u = px;
      v = py;
    }
    uv.setXY(i, u / uvScale, v / uvScale);
  }
  uv.needsUpdate = true;
  return g;
}

/** Merge box specs by material and add them (and their colliders) to a scene. */
export function addBoxes(specs: BoxSpec[], group: THREE.Group, owner: Owner | null, opts: { receive?: boolean } = {}): THREE.Mesh[] {
  const byMat = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean }>();
  for (const s of specs) {
    const center = new THREE.Vector3(...s.c);
    const g = worldBox(s.h[0] * 2, s.h[1] * 2, s.h[2] * 2, center, s.uv ?? 2.5, !!s.rot);
    if (s.rot) g.applyQuaternion(s.rot);
    g.translate(s.c[0], s.c[1], s.c[2]);
    const key = `${s.mat}|${s.exp}|${s.cast === false ? 0 : 1}`;
    let e = byMat.get(key);
    if (!e) {
      e = { mat: surface(s.mat, s.exp), geos: [], cast: s.cast !== false };
      byMat.set(key, e);
    }
    e.geos.push(g);
    if (owner && s.collide !== false) {
      owner.staticBox(s.c[0], s.c[1], s.c[2], s.h[0], s.h[1], s.h[2], s.tag ?? { kind: 'static', surface: s.mat === 'wood' ? 'wood' : 'stone' }, s.rot);
    }
  }
  const meshes: THREE.Mesh[] = [];
  for (const e of byMat.values()) {
    // merge in chunks so frustum / shadow culling still has something to work with
    const CH = 48;
    for (let i = 0; i < e.geos.length; i += CH) {
      const part = e.geos.slice(i, i + CH);
      const merged = mergeGeometries(part, false);
      for (const p of part) p.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, e.mat);
      m.castShadow = e.cast;
      m.receiveShadow = opts.receive !== false;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      group.add(m);
      meshes.push(m);
    }
  }
  return meshes;
}

// ------------------------------------------------------------------ interior generation

const CELL = 1;

interface Interval {
  a: number;
  b: number;
}

function heightAtCell(f: FloorDef, x: number, z: number) {
  return NavMesh.heightAt(f, x, z);
}

function subtract(list: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const iv of list) {
    if (cut.b <= iv.a || cut.a >= iv.b) {
      out.push(iv);
      continue;
    }
    if (cut.a > iv.a) out.push({ a: iv.a, b: cut.a });
    if (cut.b < iv.b) out.push({ a: cut.b, b: iv.b });
  }
  return out;
}

function mergeIntervals(list: Interval[]): Interval[] {
  const s = [...list].sort((p, q) => p.a - q.a);
  const out: Interval[] = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv.a <= last.b + 0.01) last.b = Math.max(last.b, iv.b);
    else out.push({ ...iv });
  }
  return out;
}

export interface InteriorGeometry {
  byScene: Map<SceneId, BoxSpec[]>;
  /** Wall boundary samples (for sconce placement): position on the boundary + inward normal. */
  edges: { scene: SceneId; x: number; y: number; z: number; nx: number; nz: number; exp: Exposure; floorId: string }[];
}

let interiorCache: InteriorGeometry | null = null;

/** Generate walls/floors/ceilings/roofs for every interior floor rect. Cached. */
export function interiorGeometry(): InteriorGeometry {
  if (interiorCache) return interiorCache;
  const byScene = new Map<SceneId, BoxSpec[]>();
  const push = (scene: SceneId, s: BoxSpec) => {
    let l = byScene.get(scene);
    if (!l) byScene.set(scene, (l = []));
    l.push(s);
  };
  const wallFloors = FLOORS.filter((f) => f.kind !== 'nav');
  // grid bounds
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const f of wallFloors) {
    minX = Math.min(minX, f.x0);
    minZ = Math.min(minZ, f.z0);
    maxX = Math.max(maxX, f.x1);
    maxZ = Math.max(maxZ, f.z1);
  }
  minX -= 2;
  minZ -= 2;
  maxX += 2;
  maxZ += 2;
  const W = Math.round((maxX - minX) / CELL);
  const H = Math.round((maxZ - minZ) / CELL);
  const cells: number[][] = new Array(W * H);
  for (let i = 0; i < cells.length; i++) cells[i] = [];
  wallFloors.forEach((f, idx) => {
    for (let x = f.x0; x < f.x1; x += CELL) {
      for (let z = f.z0; z < f.z1; z += CELL) {
        const i = Math.floor((x - minX) / CELL);
        const j = Math.floor((z - minZ) / CELL);
        cells[j * W + i].push(idx);
      }
    }
  });
  const cellCenter = (i: number, j: number) => ({ x: minX + (i + 0.5) * CELL, z: minZ + (j + 0.5) * CELL });

  type WallCell = { iv: Interval[]; owner: FloorDef };
  const walls = new Map<number, WallCell>();
  const edges: InteriorGeometry['edges'] = [];

  wallFloors.forEach((f, fi) => {
    if (f.kind === 'open') return;
    for (let x = f.x0; x < f.x1; x += CELL) {
      for (let z = f.z0; z < f.z1; z += CELL) {
        const i = Math.floor((x - minX) / CELL);
        const j = Math.floor((z - minZ) / CELL);
        const c = cellCenter(i, j);
        const yF = heightAtCell(f, c.x, c.z);
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const nIdx = nj * W + ni;
          const nList = cells[nIdx];
          if (nList.includes(fi)) continue;
          const nc = cellCenter(ni, nj);
          let req: Interval[] = [{ a: yF - 0.6, b: yF + f.h + 0.6 }];
          for (const gi of nList) {
            const g = wallFloors[gi];
            const yG = heightAtCell(g, nc.x, nc.z);
            req = subtract(req, { a: yG - 0.5, b: yG + g.h + 0.6 });
          }
          req = req.filter((iv) => iv.b - iv.a >= 0.15);
          if (!req.length) continue;
          let wc = walls.get(nIdx);
          if (!wc) walls.set(nIdx, (wc = { iv: [], owner: f }));
          wc.iv = mergeIntervals([...wc.iv, ...req]);
          // full-height wall boundary → candidate for a sconce
          if (req.some((iv) => iv.a <= yF && iv.b >= yF + 2.2)) {
            edges.push({ scene: f.scene, x: (c.x + nc.x) / 2, y: yF, z: (c.z + nc.z) / 2, nx: -di, nz: -dj, exp: f.exposure, floorId: f.id });
          }
        }
      }
    }
  });

  // merge wall cells into boxes: first along x per row, then stack identical runs along z
  type Run = { i0: number; i1: number; j0: number; j1: number; iv: Interval; owner: FloorDef };
  const rowRuns: Run[][] = [];
  for (let j = 0; j < H; j++) {
    const runs: Run[] = [];
    let open: Run[] = [];
    for (let i = 0; i <= W; i++) {
      const wc = i < W ? walls.get(j * W + i) : undefined;
      const next: Run[] = [];
      if (wc) {
        for (const iv of wc.iv) {
          const k = open.find((r) => Math.abs(r.iv.a - iv.a) < 0.01 && Math.abs(r.iv.b - iv.b) < 0.01 && r.owner.exposure === wc.owner.exposure && r.owner.scene === wc.owner.scene);
          if (k) {
            k.i1 = i + 1;
            next.push(k);
          } else next.push({ i0: i, i1: i + 1, j0: j, j1: j + 1, iv, owner: wc.owner });
        }
      }
      for (const r of open) if (!next.includes(r)) runs.push(r);
      open = next;
    }
    rowRuns.push(runs);
  }
  // vertical merge
  const finalRuns: Run[] = [];
  let active: Run[] = [];
  for (let j = 0; j < H; j++) {
    const next: Run[] = [];
    for (const r of rowRuns[j]) {
      const k = active.find((a) => a.i0 === r.i0 && a.i1 === r.i1 && a.j1 === j && Math.abs(a.iv.a - r.iv.a) < 0.01 && Math.abs(a.iv.b - r.iv.b) < 0.01 && a.owner.exposure === r.owner.exposure && a.owner.scene === r.owner.scene);
      if (k) {
        k.j1 = j + 1;
        next.push(k);
      } else next.push(r);
    }
    for (const a of active) if (!next.includes(a)) finalRuns.push(a);
    active = next;
  }
  finalRuns.push(...active);

  for (const r of finalRuns) {
    const x0 = minX + r.i0 * CELL;
    const x1 = minX + r.i1 * CELL;
    const z0 = minZ + r.j0 * CELL;
    const z1 = minZ + r.j1 * CELL;
    const f = r.owner;
    const mat: SurfaceName = f.wallMat ?? (f.exposure === 'dungeon' ? 'dungeonWall' : 'templeWallMoss');
    push(f.scene, {
      c: [(x0 + x1) / 2, (r.iv.a + r.iv.b) / 2, (z0 + z1) / 2],
      h: [(x1 - x0) / 2, (r.iv.b - r.iv.a) / 2, (z1 - z0) / 2],
      mat,
      exp: f.exposure,
      uv: 3,
    });
  }

  // floors and ceilings
  for (const f of wallFloors) {
    if (f.kind === 'open' || f.kind === 'entity') continue;
    const fm: SurfaceName = f.floorMat ?? (f.exposure === 'dungeon' ? 'dungeonFloor' : 'floor');
    const w = f.x1 - f.x0;
    const d = f.z1 - f.z0;
    if (f.axis && f.y1 !== undefined) {
      rampBoxes(f, fm).forEach((s) => push(f.scene, s));
      if (f.ceiling) rampCeiling(f).forEach((s) => push(f.scene, s));
    } else {
      push(f.scene, { c: [(f.x0 + f.x1) / 2, f.y0 - 0.25, (f.z0 + f.z1) / 2], h: [w / 2, 0.25, d / 2], mat: fm, exp: f.exposure, uv: 4, tag: { kind: 'static', surface: 'stone' } });
      if (f.ceiling) {
        push(f.scene, { c: [(f.x0 + f.x1) / 2, f.y0 + f.h + 0.3, (f.z0 + f.z1) / 2], h: [w / 2, 0.3, d / 2], mat: 'ceiling', exp: f.exposure, uv: 3 });
      }
    }
  }
  // zone B roofs and beams
  for (const r of ROOFS) {
    push(r.scene, { c: [(r.x0 + r.x1) / 2, r.y + 0.4, (r.z0 + r.z1) / 2], h: [(r.x1 - r.x0) / 2, 0.4, (r.z1 - r.z0) / 2], mat: 'templeWall', exp: 'ruins', uv: 3 });
  }
  for (const b of BEAMS) {
    push(b.scene, { c: [(b.x0 + b.x1) / 2, b.y, b.z], h: [(b.x1 - b.x0) / 2 + 0.5, 0.35, 0.4], mat: 'templeWall', exp: 'ruins' });
  }

  interiorCache = { byScene, edges };
  return interiorCache;
}

/** Visual steps + one smooth sloped collider for a ramp. */
function rampBoxes(f: FloorDef, mat: SurfaceName): BoxSpec[] {
  const out: BoxSpec[] = [];
  const along = f.axis!;
  const len = along === 'x' ? f.x1 - f.x0 : f.z1 - f.z0;
  const width = along === 'x' ? f.z1 - f.z0 : f.x1 - f.x0;
  const y0 = f.y0;
  const y1 = f.y1!;
  const dy = y1 - y0;
  const steps = Math.max(2, Math.ceil(Math.abs(dy) / 0.28));
  const stepLen = len / steps;
  for (let k = 0; k < steps; k++) {
    const t0 = k / steps;
    const top = y0 + dy * ((k + 0.5) / steps); // plane cuts each step through its middle
    const bottom = Math.min(y0, y1) - 0.4;
    const a = (along === 'x' ? f.x0 : f.z0) + t0 * len;
    const cA = a + stepLen / 2;
    const cy = (top + bottom) / 2;
    const hy = (top - bottom) / 2;
    if (along === 'x') out.push({ c: [cA, cy, (f.z0 + f.z1) / 2], h: [stepLen / 2, hy, width / 2], mat, exp: f.exposure, collide: false });
    else out.push({ c: [(f.x0 + f.x1) / 2, cy, cA], h: [width / 2, hy, stepLen / 2], mat, exp: f.exposure, collide: false });
  }
  // smooth collider: rotated slab whose top face is the ramp plane
  const slope = Math.atan2(dy, len);
  const hyp = Math.hypot(len, dy);
  const q = new THREE.Quaternion();
  if (along === 'x') q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), slope);
  else q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -slope);
  const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const mid = along === 'x' ? new THREE.Vector3((f.x0 + f.x1) / 2, (y0 + y1) / 2, (f.z0 + f.z1) / 2) : new THREE.Vector3((f.x0 + f.x1) / 2, (y0 + y1) / 2, (f.z0 + f.z1) / 2);
  const c = mid.clone().addScaledVector(n, -0.25);
  const half: [number, number, number] = along === 'x' ? [hyp / 2 + 0.05, 0.25, width / 2] : [width / 2, 0.25, hyp / 2 + 0.05];
  out.push({ c: [c.x, c.y, c.z], h: half, mat, exp: f.exposure, rot: q, collide: true, cast: false, tag: { kind: 'static', surface: 'stone' }, uv: 4 });
  // the collider slab is also drawn slightly below the steps (hidden), keep it non-casting
  out[out.length - 1].c[1] -= 0.02;
  return out;
}

function rampCeiling(f: FloorDef): BoxSpec[] {
  const along = f.axis!;
  const len = along === 'x' ? f.x1 - f.x0 : f.z1 - f.z0;
  const width = along === 'x' ? f.z1 - f.z0 : f.x1 - f.x0;
  const dy = f.y1! - f.y0;
  const slope = Math.atan2(dy, len);
  const hyp = Math.hypot(len, dy);
  const q = new THREE.Quaternion();
  if (along === 'x') q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), slope);
  else q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -slope);
  const mid = new THREE.Vector3((f.x0 + f.x1) / 2, (f.y0 + f.y1!) / 2 + f.h + 0.3, (f.z0 + f.z1) / 2);
  const half: [number, number, number] = along === 'x' ? [hyp / 2 + 0.6, 0.35, width / 2 + 0.2] : [width / 2 + 0.2, 0.35, hyp / 2 + 0.6];
  return [{ c: [mid.x, mid.y, mid.z], h: half, mat: 'ceiling', exp: f.exposure, rot: q, uv: 3 }];
}

/** The guardians' navmesh, built from every interior floor that allows navigation. */
export function buildNavMesh(): NavMesh {
  const rects = FLOORS.filter((f) => !f.noNav && f.kind !== 'open' && f.kind !== 'entity').map((f) => ({
    x0: f.x0,
    z0: f.z0,
    x1: f.x1,
    z1: f.z1,
    y0: f.y0,
    y1: f.y1,
    axis: f.axis,
    gate: f.gate,
    tag: f.id,
  }));
  return new NavMesh(rects);
}

// ------------------------------------------------------------------ misc mesh helpers

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, cast = true, receive = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/** Freeze a static object's matrices (no per-frame matrix updates). */
export function freeze(o: THREE.Object3D) {
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    c.matrixAutoUpdate = false;
  });
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !(m.geometry as any).userData?.shared) m.geometry.dispose();
  });
}

/** Generator: add a scene's generated walls/floors/ceilings in chunks. */
export function* buildInteriorChunks(sceneId: SceneId, group: THREE.Group, owner: Owner, chunk = 120): Generator<void, void, void> {
  // spatially sorted so each merged chunk is compact (better frustum / shadow culling)
  const cellKey = (s: BoxSpec) => Math.floor((s.c[0] + 300) / 14) * 1000 + Math.floor((s.c[2] + 300) / 14);
  const specs = [...(interiorGeometry().byScene.get(sceneId) ?? [])].sort((a, b) => cellKey(a) - cellKey(b));
  for (let i = 0; i < specs.length; i += chunk) {
    addBoxes(specs.slice(i, i + chunk), group, owner);
    yield;
  }
}
