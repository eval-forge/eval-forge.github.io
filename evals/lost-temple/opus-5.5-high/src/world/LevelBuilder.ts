import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, type Physics, type ColliderKind } from './Physics';
import { Materials, TEX_SCALE, type MatKey } from './Materials';

export interface StaticColliderDesc { make: () => RAPIER.ColliderDesc; kind: ColliderKind }

export interface AABB { min: THREE.Vector3; max: THREE.Vector3 }
export interface ClimbVolume extends AABB { normal: THREE.Vector3; rope?: boolean }
export interface WaterVolume extends AABB { surface: number }
export interface KillVolume extends AABB { cause: 'spikes' | 'abyss' | 'chasm' }

const CELL = 24;

/** Static level geometry DSL: boxes/walls/ramps → merged chunked meshes + fixed colliders. */
export class LevelBuilder {
  private geos = new Map<string, { mat: THREE.Material; cast: boolean; list: THREE.BufferGeometry[] }>();
  colliders: StaticColliderDesc[] = [];
  climbs: ClimbVolume[] = [];
  waters: WaterVolume[] = [];
  kills: KillVolume[] = [];
  extra: THREE.Object3D[] = [];
  private m4 = new THREE.Matrix4();

  constructor(public mats: Materials) {}

  // ------------------------------------------------------------- primitives
  private push(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true) {
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    if (!geo.index) {
      const n = geo.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    geo.computeBoundingBox();
    const c = geo.boundingBox!.getCenter(new THREE.Vector3());
    const key = `${mat.uuid}|${cast}|${Math.floor(c.x / CELL)}|${Math.floor(c.z / CELL)}|${Math.floor(c.y / 16)}`;
    let e = this.geos.get(key);
    if (!e) { e = { mat, cast, list: [] }; this.geos.set(key, e); }
    e.list.push(geo);
  }

  /** Box with world-scaled UVs. */
  static boxGeo(w: number, h: number, d: number, scale: number): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * dims[f][0] / scale, uv.getY(i) * dims[f][1] / scale);
      }
    }
    return g;
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: MatKey, opts: { rotY?: number; rotX?: number; rotZ?: number; collide?: boolean; cast?: boolean; kind?: ColliderKind; friction?: number } = {}) {
    const scale = TEX_SCALE[mat] ?? 3;
    const g = LevelBuilder.boxGeo(sx, sy, sz, scale);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rotX ?? 0, opts.rotY ?? 0, opts.rotZ ?? 0));
    this.m4.compose(new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(this.m4);
    this.push(g, this.mats.get(mat), opts.cast ?? true);
    if (opts.collide ?? true) {
      const kind = opts.kind ?? 'static';
      const fr = opts.friction ?? 0.8;
      this.colliders.push({
        kind,
        make: () => RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(cx, cy, cz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(fr),
      });
    }
  }

  /** Axis-aligned box from min/max corners. */
  aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: MatKey, opts: { collide?: boolean; cast?: boolean; kind?: ColliderKind } = {}) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
    if (bx - ax < 1e-3 || by - ay < 1e-3 || bz - az < 1e-3) return;
    this.box((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, bx - ax, by - ay, bz - az, mat, opts);
  }

  /** Floor slab with its top at y. */
  floor(x0: number, z0: number, x1: number, z1: number, y: number, mat: MatKey, thick = 1) {
    this.aabb(x0, y - thick, z0, x1, y, z1, mat);
  }

  /** Ceiling slab with its bottom at y. */
  ceiling(x0: number, z0: number, x1: number, z1: number, y: number, mat: MatKey, thick = 1) {
    this.aabb(x0, y, z0, x1, y + thick, z1, mat);
  }

  /** Wall running along z at x (centre line), from z0..z1, y0..y1, with optional openings [zA, zB, topY]. */
  wallX(x: number, z0: number, z1: number, y0: number, y1: number, mat: MatKey, thick = 1, gaps: [number, number, number][] = []) {
    this.wallRun('x', x, z0, z1, y0, y1, mat, thick, gaps);
  }
  /** Wall running along x at z (centre line). */
  wallZ(z: number, x0: number, x1: number, y0: number, y1: number, mat: MatKey, thick = 1, gaps: [number, number, number][] = []) {
    this.wallRun('z', z, x0, x1, y0, y1, mat, thick, gaps);
  }
  private wallRun(axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, y1: number, mat: MatKey, thick: number, gaps: [number, number, number][]) {
    const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
    const sorted = [...gaps].sort((p, q) => p[0] - q[0]);
    let cur = lo;
    const seg = (s: number, e: number, ya: number, yb: number) => {
      if (e - s < 1e-3 || yb - ya < 1e-3) return;
      if (axis === 'x') this.aabb(c - thick / 2, ya, s, c + thick / 2, yb, e, mat);
      else this.aabb(s, ya, c - thick / 2, e, yb, c + thick / 2, mat);
    };
    for (const [g0, g1, top] of sorted) {
      seg(cur, g0, y0, y1);
      seg(g0, g1, top, y1); // lintel
      cur = g1;
    }
    seg(cur, hi, y0, y1);
  }

  /**
   * Stairs/ramp. Visual steps, smooth collider slab. Height goes yStart→yEnd from the
   * a0 end to the a1 end along `axis`.
   */
  ramp(x0: number, z0: number, x1: number, z1: number, axis: 'x' | 'z', yStart: number, yEnd: number, mat: MatKey, stepped = true) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
    const along0 = axis === 'x' ? x0 : z0, along1 = axis === 'x' ? x1 : z1;
    const len = Math.abs(along1 - along0);
    const rise = yEnd - yStart;
    const dir = Math.sign(along1 - along0);
    if (stepped) {
      const n = Math.max(2, Math.round(Math.abs(rise) / 0.3));
      const step = len / n;
      for (let i = 0; i < n; i++) {
        const s0 = along0 + dir * step * i, s1 = s0 + dir * step;
        const top = yStart + rise * ((i + 0.5) / n) + Math.abs(rise) / n / 2 * Math.sign(rise) * 0;
        const yTop = rise > 0 ? yStart + rise * ((i + 1) / n) : yStart + rise * (i / n);
        const yBot = Math.min(yStart, yEnd) - 0.5;
        void top;
        if (axis === 'x') this.aabb(s0, yBot, az, s1, yTop, bz, mat, { collide: false });
        else this.aabb(ax, yBot, s0, bx, yTop, s1, mat, { collide: false });
      }
    } else {
      // smooth visual slab
    }
    // collider: a thin rotated slab whose top surface follows the slope
    const angle = Math.atan2(rise, len);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, cy = (yStart + yEnd) / 2;
    const slabLen = Math.hypot(len, rise);
    const t = 0.4;
    const q = new THREE.Quaternion();
    if (axis === 'x') q.setFromEuler(new THREE.Euler(0, 0, dir * angle));
    else q.setFromEuler(new THREE.Euler(-dir * angle, 0, 0));
    const offset = new THREE.Vector3(0, -t / 2, 0).applyQuaternion(q);
    const hx = axis === 'x' ? slabLen / 2 : (bx - ax) / 2, hz = axis === 'x' ? (bz - az) / 2 : slabLen / 2;
    this.colliders.push({
      kind: 'static',
      make: () => RAPIER.ColliderDesc.cuboid(hx, t / 2, hz).setTranslation(cx + offset.x, cy + offset.y + (stepped ? 0.1 : 0), cz + offset.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(1),
    });
    if (!stepped) {
      const g = LevelBuilder.boxGeo(hx * 2, t, hz * 2, TEX_SCALE[mat] ?? 3);
      this.m4.compose(new THREE.Vector3(cx + offset.x, cy + offset.y, cz + offset.z), q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(this.m4);
      this.push(g, this.mats.get(mat));
    }
  }

  cylinder(cx: number, cy: number, cz: number, r: number, h: number, mat: MatKey, opts: { collide?: boolean; seg?: number; rotX?: number; rotZ?: number; rotY?: number; r2?: number; cast?: boolean } = {}) {
    const g = new THREE.CylinderGeometry(opts.r2 ?? r, r, h, opts.seg ?? 14, 1);
    const scale = TEX_SCALE[mat] ?? 3;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (Math.PI * 2 * r) / scale, uv.getY(i) * h / scale);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rotX ?? 0, opts.rotY ?? 0, opts.rotZ ?? 0));
    this.m4.compose(new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(this.m4);
    this.push(g, this.mats.get(mat), opts.cast ?? true);
    if (opts.collide ?? true) {
      const rr = Math.max(r, opts.r2 ?? r);
      this.colliders.push({ kind: 'static', make: () => RAPIER.ColliderDesc.cylinder(h / 2, rr).setTranslation(cx, cy, cz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }) });
    }
  }

  /** Arbitrary geometry, already in world space. Optional trimesh collider. */
  geometry(g: THREE.BufferGeometry, mat: MatKey | THREE.Material, opts: { trimesh?: boolean; cast?: boolean } = {}) {
    const material = typeof mat === 'string' ? this.mats.get(mat) : mat;
    if (opts.trimesh) {
      const pos = g.attributes.position.array as Float32Array;
      const verts = new Float32Array(pos);
      let idx: Uint32Array;
      if (g.index) idx = new Uint32Array(g.index.array as ArrayLike<number>);
      else { idx = new Uint32Array(pos.length / 3); for (let i = 0; i < idx.length; i++) idx[i] = i; }
      this.colliders.push({ kind: 'static', make: () => RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.9) });
    }
    this.push(g, material, opts.cast ?? true);
  }

  /** Invisible collider-only box. */
  blocker(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    const hx = Math.abs(x1 - x0) / 2, hy = Math.abs(y1 - y0) / 2, hz = Math.abs(z1 - z0) / 2;
    this.colliders.push({ kind: 'static', make: () => RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz) });
  }

  climb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, normal: [number, number, number], visual = true, rope = false) {
    const min = new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
    const max = new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
    const n = new THREE.Vector3(...normal);
    this.climbs.push({ min, max, normal: n, rope });
    if (visual) {
      // vine sheet hugging the wall face
      const w = n.x !== 0 ? max.z - min.z : max.x - min.x;
      const h = max.y - min.y;
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 3, uv.getY(i) * h / 3);
      const c = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
      // place on the wall side (opposite the normal)
      const wallPos = c.clone().addScaledVector(n, -0.5 * (n.x !== 0 ? max.x - min.x : max.z - min.z) + 0.06);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      this.m4.compose(wallPos, q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(this.m4);
      this.push(g, this.mats.get(rope ? 'rope' : 'vines'), false);
    }
  }

  water(x0: number, z0: number, x1: number, z1: number, bottom: number, surface: number) {
    this.waters.push({ min: new THREE.Vector3(Math.min(x0, x1), bottom - 1, Math.min(z0, z1)), max: new THREE.Vector3(Math.max(x0, x1), surface + 0.05, Math.max(z0, z1)), surface });
    const g = new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0));
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.abs(x1 - x0) / 6, uv.getY(i) * Math.abs(z1 - z0) / 6);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, surface, (z0 + z1) / 2);
    const mesh = new THREE.Mesh(g, this.mats.get('water'));
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    this.extra.push(mesh);
  }

  kill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cause: KillVolume['cause']) {
    this.kills.push({ min: new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)), max: new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)), cause });
  }

  add(o: THREE.Object3D) { this.extra.push(o); }

  /** Merge everything into a group. */
  finalize(): THREE.Group {
    const group = new THREE.Group();
    for (const e of this.geos.values()) {
      const merged = mergeGeometries(e.list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, e.mat);
      mesh.castShadow = e.cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      for (const g of e.list) g.dispose();
    }
    for (const o of this.extra) group.add(o);
    this.geos.clear();
    return group;
  }

  createColliders(physics: Physics, body: RAPIER.RigidBody, scene: string) {
    const out: RAPIER.Collider[] = [];
    for (const c of this.colliders) {
      const col = physics.world.createCollider(c.make(), body);
      physics.tag(col, { kind: c.kind, scene });
      out.push(col);
    }
    return out;
  }
}

export function inAABB(p: THREE.Vector3, b: AABB, pad = 0): boolean {
  return p.x >= b.min.x - pad && p.x <= b.max.x + pad && p.y >= b.min.y - pad && p.y <= b.max.y + pad && p.z >= b.min.z - pad && p.z <= b.max.z + pad;
}
