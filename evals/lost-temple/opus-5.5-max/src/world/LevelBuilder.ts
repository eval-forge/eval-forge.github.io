/**
 * Level DSL. Scenes describe their static layout with boxes, ramps, cylinders and custom
 * meshes; the builder turns that into merged meshes per (chunk, material), one fixed Rapier
 * body with simple colliders, and navmesh input. In nav-only mode it records just the nav data,
 * which lets the whole world's navmesh be built without building any meshes.
 */
import * as THREE from 'three';
import { RAPIER, type Physics } from '../physics/Physics';
import type { Materials, MatKey } from '../render/materials';
import { uvBox, uvCylinder, merge, normalizeGeometry, rockGeometry } from '../render/geometry';
import type { WalkRect, ObstacleBox, RampRect } from '../logic/navbuild';
import type { SceneId } from '../logic/unlocks';
import { GROUP_STATIC, GROUP_RAYONLY } from '../config';
import type { Climbable, WaterVolume, KillVolume, WindZone } from './types';
import { Rng, hashString } from '../logic/rng';

export interface BuildEnv {
  physics: Physics;
  mats: Materials;
}

export interface BoxOpts {
  rotY?: number;
  rot?: THREE.Euler;
  tint?: number | THREE.Color;
  /** Random brightness variation 0..1 */
  vary?: number;
  collider?: boolean;
  rayOnly?: boolean;
  nav?: 'walk' | 'obstacle' | 'none';
  gate?: string;
  cast?: boolean;
  receive?: boolean;
  visible?: boolean;
  tex?: number;
  friction?: number;
}

interface Piece {
  mat: MatKey;
  geos: THREE.BufferGeometry[];
  cast: boolean;
  receive: boolean;
}

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

export class LevelBuilder {
  navWalks: WalkRect[] = [];
  navObstacles: ObstacleBox[] = [];
  navRamps: RampRect[] = [];
  climbables: Climbable[] = [];
  waters: WaterVolume[] = [];
  kills: KillVolume[] = [];
  winds: WindZone[] = [];
  private pieces = new Map<string, Piece>();
  private colliderDescs: RAPIER.ColliderDesc[] = [];
  rng: Rng;
  private chunk = 16;
  private extraMeshes: THREE.Object3D[] = [];

  constructor(public env: BuildEnv | null, public scene: SceneId, public navOnly = false) {
    this.rng = new Rng(hashString('layout:' + scene));
  }

  private addPiece(mat: MatKey, geo: THREE.BufferGeometry, cast: boolean, receive: boolean, center: THREE.Vector3) {
    const key = `${mat}|${cast ? 1 : 0}|${receive ? 1 : 0}|${Math.floor(center.x / this.chunk)}|${Math.floor(center.z / this.chunk)}|${Math.floor(center.y / 12)}`;
    let p = this.pieces.get(key);
    if (!p) this.pieces.set(key, (p = { mat, geos: [], cast, receive }));
    p.geos.push(geo);
  }

  private tintColor(o: BoxOpts): THREE.Color {
    const c = o.tint === undefined ? new THREE.Color(1, 1, 1) : o.tint instanceof THREE.Color ? o.tint.clone() : new THREE.Color(o.tint);
    const v = o.vary ?? 0.12;
    if (v > 0) c.multiplyScalar(1 - v / 2 + this.rng.next() * v);
    return c;
  }

  /** Axis-aligned or Y-rotated box. Centre and full sizes. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: MatKey, o: BoxOpts = {}) {
    const rotY = o.rotY ?? 0;
    const navKind = o.nav ?? 'obstacle';
    if (navKind !== 'none' && !o.rot) {
      const c = Math.abs(Math.cos(rotY));
      const s = Math.abs(Math.sin(rotY));
      const hx = (sx * c + sz * s) / 2;
      const hz = (sx * s + sz * c) / 2;
      if (navKind === 'walk') this.navWalks.push({ x0: cx - hx, z0: cz - hz, x1: cx + hx, z1: cz + hz, y: cy + sy / 2, scene: this.scene, gate: o.gate ?? null });
      else this.navObstacles.push({ x0: cx - hx, z0: cz - hz, x1: cx + hx, z1: cz + hz, y0: cy - sy / 2, y1: cy + sy / 2 });
    } else if (navKind === 'obstacle' && o.rot) {
      const half = new THREE.Vector3(sx / 2, sy / 2, sz / 2);
      const bb = new THREE.Box3(half.clone().negate(), half);
      bb.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(o.rot));
      this.navObstacles.push({ x0: cx + bb.min.x, z0: cz + bb.min.z, x1: cx + bb.max.x, z1: cz + bb.max.z, y0: cy + bb.min.y, y1: cy + bb.max.y });
    }
    if (this.navOnly) return;
    const rot = o.rot ?? (rotY ? tmpE.set(0, rotY, 0) : null);
    if (o.visible !== false) {
      const origin = rot ? new THREE.Vector3() : new THREE.Vector3(cx, cy, cz);
      const g = uvBox(sx, sy, sz, o.tex ?? 0.5, origin);
      if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
      g.translate(cx, cy, cz);
      this.addPiece(mat, normalizeGeometry(g, this.tintColor(o)), o.cast ?? true, o.receive ?? true, new THREE.Vector3(cx, cy, cz));
    }
    if (o.collider !== false) {
      const d = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(cx, cy, cz);
      if (rot) {
        tmpQ.setFromEuler(rot);
        d.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w });
      }
      d.setCollisionGroups(o.rayOnly ? GROUP_RAYONLY : GROUP_STATIC);
      if (o.friction !== undefined) d.setFriction(o.friction);
      this.colliderDescs.push(d);
    }
  }

  /** Walkable slab whose top is at y. */
  floor(x0: number, z0: number, x1: number, z1: number, y: number, mat: MatKey, o: BoxOpts & { thick?: number } = {}) {
    const t = o.thick ?? 0.6;
    this.box((x0 + x1) / 2, y - t / 2, (z0 + z1) / 2, x1 - x0, t, z1 - z0, mat, { nav: 'walk', vary: 0.06, ...o });
  }

  /** Solid block from corner to corner. */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: MatKey, o: BoxOpts = {}) {
    this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0), mat, { nav: 'obstacle', ...o });
  }

  /** Wall with a doorway gap along x (doorway between dx0..dx1, up to height dh). */
  wallX(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, mat: MatKey, gaps: [number, number, number][] = [], o: BoxOpts = {}) {
    const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
    let cur = x0;
    for (const [g0, g1, gh] of sorted) {
      if (g0 > cur) this.wall(cur, z0, g0, z1, y0, y1, mat, o);
      if (gh < y1 - y0) this.wall(g0, z0, g1, z1, y0 + gh, y1, mat, { ...o, nav: 'none' });
      cur = g1;
    }
    if (cur < x1) this.wall(cur, z0, x1, z1, y0, y1, mat, o);
  }

  /** Wall with gaps along z. */
  wallZ(z0: number, z1: number, x0: number, x1: number, y0: number, y1: number, mat: MatKey, gaps: [number, number, number][] = [], o: BoxOpts = {}) {
    const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
    let cur = z0;
    for (const [g0, g1, gh] of sorted) {
      if (g0 > cur) this.wall(x0, cur, x1, g0, y0, y1, mat, o);
      if (gh < y1 - y0) this.wall(x0, g0, x1, g1, y0 + gh, y1, mat, { ...o, nav: 'none' });
      cur = g1;
    }
    if (cur < z1) this.wall(x0, cur, x1, z1, y0, y1, mat, o);
  }

  /**
   * Ramp or staircase from (x0,z0)-(x1,z1); the height goes from yStart at the low end of
   * `axis` to yEnd at the high end. Collider is a smooth slab; visuals are steps if asked.
   */
  ramp(x0: number, z0: number, x1: number, z1: number, yStart: number, yEnd: number, axis: 'x' | 'z', mat: MatKey, o: BoxOpts & { steps?: boolean; gate?: string; stepDepth?: number } = {}) {
    this.navRamps.push({ x0, z0, x1, z1, yStart, yEnd, axis, scene: this.scene, gate: o.gate ?? null });
    if (this.navOnly) return;
    const len = axis === 'x' ? x1 - x0 : z1 - z0;
    const width = axis === 'x' ? z1 - z0 : x1 - x0;
    const dy = yEnd - yStart;
    const L = Math.hypot(len, dy);
    const ang = Math.atan2(dy, len);
    const thick = 0.4;
    const midA = axis === 'x' ? (x0 + x1) / 2 : (z0 + z1) / 2;
    const midY = (yStart + yEnd) / 2;
    // slab centre is below the surface by thick/2 along the slab normal
    const nA = -Math.sin(ang);
    const nY = Math.cos(ang);
    const cA = midA - nA * (thick / 2);
    const cY = midY - nY * (thick / 2);
    const rot = axis === 'x' ? new THREE.Euler(0, 0, ang) : new THREE.Euler(-ang, 0, 0);
    const cx = axis === 'x' ? cA : (x0 + x1) / 2;
    const cz = axis === 'x' ? (z0 + z1) / 2 : cA;
    const d = RAPIER.ColliderDesc.cuboid(axis === 'x' ? L / 2 : width / 2, thick / 2, axis === 'x' ? width / 2 : L / 2).setTranslation(cx, cY, cz);
    tmpQ.setFromEuler(rot);
    d.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w });
    d.setCollisionGroups(GROUP_STATIC);
    this.colliderDescs.push(d);
    if (o.visible === false) return;
    if (o.steps) {
      const n = Math.max(2, Math.round(Math.abs(dy) / 0.25));
      const stepLen = len / n;
      const stepH = dy / n;
      for (let i = 0; i < n; i++) {
        const a0 = (axis === 'x' ? x0 : z0) + i * stepLen;
        // step tops sit half a step around the smooth collider so feet neither float nor sink much
        const top = yStart + stepH * (i + 0.5);
        // solid down to the low end, unless the stair runs above another room (stepDepth)
        const bottom = Math.max(Math.min(yStart, yEnd) - 0.3, o.stepDepth !== undefined ? top - o.stepDepth : -Infinity);
        const h = top - bottom;
        if (h <= 0.01) continue;
        const ca = a0 + stepLen / 2;
        const g = axis === 'x' ? uvBox(stepLen, h, width, 0.5, new THREE.Vector3(ca, bottom + h / 2, (z0 + z1) / 2)) : uvBox(width, h, stepLen, 0.5, new THREE.Vector3((x0 + x1) / 2, bottom + h / 2, ca));
        if (axis === 'x') g.translate(ca, bottom + h / 2, (z0 + z1) / 2);
        else g.translate((x0 + x1) / 2, bottom + h / 2, ca);
        this.addPiece(mat, normalizeGeometry(g, this.tintColor({ vary: 0.08 })), true, true, new THREE.Vector3(axis === 'x' ? ca : (x0 + x1) / 2, top, axis === 'x' ? (z0 + z1) / 2 : ca));
      }
    } else {
      const g = uvBox(axis === 'x' ? L : width, thick, axis === 'x' ? width : L, 0.5);
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
      g.translate(cx, cY, cz);
      this.addPiece(mat, normalizeGeometry(g, this.tintColor({ vary: 0.05 })), true, true, new THREE.Vector3(cx, cY, cz));
    }
  }

  /** Vertical cylinder (pillar) from y0 up by h. With `rot` it is a lying log whose centre is at y0. */
  cylinder(x: number, z: number, y0: number, h: number, r: number, mat: MatKey, o: BoxOpts & { rTop?: number; seg?: number } = {}) {
    if ((o.nav ?? 'obstacle') !== 'none' && !o.rot) this.navObstacles.push({ x0: x - r, z0: z - r, x1: x + r, z1: z + r, y0, y1: y0 + h });
    if (this.navOnly) return;
    const cy = o.rot ? y0 : y0 + h / 2;
    if (o.visible !== false) {
      const g = uvCylinder(o.rTop ?? r, r, h, o.seg ?? 14, o.tex ?? 0.5);
      if (o.rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(o.rot));
      g.translate(x, cy, z);
      this.addPiece(mat, normalizeGeometry(g, this.tintColor(o)), o.cast ?? true, o.receive ?? true, new THREE.Vector3(x, cy, z));
    }
    if (o.collider !== false) {
      const d = RAPIER.ColliderDesc.cylinder(h / 2, Math.max(r, o.rTop ?? r)).setTranslation(x, cy, z);
      if (o.rot) {
        tmpQ.setFromEuler(o.rot);
        d.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w });
      }
      d.setCollisionGroups(GROUP_STATIC);
      this.colliderDescs.push(d);
    }
  }

  /** Fluted column with base and capital; `broken` leaves a jagged stump. */
  pillar(x: number, z: number, y0: number, h: number, r: number, mat: MatKey, o: BoxOpts & { broken?: boolean } = {}) {
    const hh = o.broken ? h * (0.3 + this.rng.next() * 0.4) : h;
    this.box(x, y0 + 0.25, z, r * 2.6, 0.5, r * 2.6, mat, { ...o, nav: o.nav ?? 'obstacle' });
    this.cylinder(x, z, y0 + 0.5, hh - (o.broken ? 0.5 : 1.0), r, mat, { ...o, seg: 12 });
    if (!o.broken) this.box(x, y0 + h - 0.25, z, r * 2.6, 0.5, r * 2.6, mat, { ...o, nav: 'none' });
    else if (!this.navOnly) this.rock(x + 0.1, y0 + hh - 0.1, z, r * 0.9, mat, { collider: false, squash: 0.6 });
  }

  /** Arbitrary geometry (already in world space) merged into the level. */
  mesh(geo: THREE.BufferGeometry, mat: MatKey, o: { cast?: boolean; receive?: boolean; tint?: number | THREE.Color; collider?: 'none' | 'hull' | 'trimesh' | 'box'; rayOnly?: boolean } = {}) {
    if (this.navOnly) return;
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const center = bb.getCenter(new THREE.Vector3());
    const c = o.tint === undefined ? undefined : o.tint instanceof THREE.Color ? o.tint : new THREE.Color(o.tint);
    this.addPiece(mat, normalizeGeometry(geo, c), o.cast ?? true, o.receive ?? true, center);
    const kind = o.collider ?? 'none';
    if (kind === 'none') return;
    const pos = (geo.index ? geo.toNonIndexed() : geo).attributes.position.array as Float32Array;
    let d: RAPIER.ColliderDesc | null = null;
    if (kind === 'hull') d = RAPIER.ColliderDesc.convexHull(new Float32Array(pos));
    else if (kind === 'box') {
      const s = bb.getSize(new THREE.Vector3());
      d = RAPIER.ColliderDesc.cuboid(s.x / 2, s.y / 2, s.z / 2).setTranslation(center.x, center.y, center.z);
    } else {
      const idx = new Uint32Array(pos.length / 3);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      d = RAPIER.ColliderDesc.trimesh(new Float32Array(pos), idx);
    }
    if (d) {
      d.setCollisionGroups(o.rayOnly ? GROUP_RAYONLY : GROUP_STATIC);
      this.colliderDescs.push(d);
    }
  }

  /** Rock or boulder with an optional hull collider. */
  rock(x: number, y: number, z: number, r: number, mat: MatKey = 'rock', o: { collider?: boolean; squash?: number; rotY?: number; nav?: boolean; tint?: number } = {}) {
    if (o.nav) this.navObstacles.push({ x0: x - r, z0: z - r, x1: x + r, z1: z + r, y0: y - r, y1: y + r });
    if (this.navOnly) return;
    const g = rockGeometry(r, this.rng.next() * 100, o.squash ?? 0.75);
    g.rotateY(o.rotY ?? this.rng.next() * Math.PI * 2);
    g.translate(x, y, z);
    this.mesh(g, mat, { collider: o.collider === false ? 'none' : 'hull', tint: o.tint });
  }

  /** Non-merged object added to the scene as-is (props with their own transforms). */
  object(obj: THREE.Object3D) {
    if (this.navOnly) return;
    this.extraMeshes.push(obj);
  }

  /** Extra static collider (no visual). */
  collider(desc: RAPIER.ColliderDesc) {
    if (this.navOnly) return;
    desc.setCollisionGroups(GROUP_STATIC);
    this.colliderDescs.push(desc);
  }

  navWalk(x0: number, z0: number, x1: number, z1: number, y: number, gate?: string) {
    this.navWalks.push({ x0, z0, x1, z1, y, scene: this.scene, gate: gate ?? null });
  }

  navBlock(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number) {
    this.navObstacles.push({ x0, z0, x1, z1, y0, y1 });
  }

  climb(id: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, normal: [number, number, number], kind: 'vine' | 'rope' = 'vine', enabled = true) {
    this.climbables.push({ id, box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)), normal: new THREE.Vector3(...normal).normalize(), kind, enabled, scene: this.scene });
  }

  water(x0: number, z0: number, x1: number, z1: number, bottom: number, surface: number, flow: [number, number, number] = [0, 0, 0]) {
    this.waters.push({ box: new THREE.Box3(new THREE.Vector3(x0, bottom, z0), new THREE.Vector3(x1, surface, z1)), surface, flow: new THREE.Vector3(...flow), scene: this.scene });
  }

  kill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind: KillVolume['kind'], respawn?: [number, number, number]) {
    this.kills.push({ box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)), kind, respawn: respawn ? new THREE.Vector3(...respawn) : undefined, scene: this.scene });
  }

  wind(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dir: [number, number, number], strength: number) {
    this.winds.push({ box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)), dir: new THREE.Vector3(...dir).normalize(), strength, scene: this.scene });
  }

  /**
   * Heightfield terrain over a rectangle: one mesh (vertex coloured by `color`) and one Rapier
   * heightfield collider. Not walkable for the navmesh (guardians stay in the temple).
   */
  terrain(x0: number, z0: number, x1: number, z1: number, cell: number, height: (x: number, z: number) => number, mat: MatKey, color?: (x: number, z: number, h: number) => THREE.Color) {
    if (this.navOnly) return;
    const nx = Math.max(1, Math.round((x1 - x0) / cell));
    const nz = Math.max(1, Math.round((z1 - z0) / cell));
    const dx = (x1 - x0) / nx;
    const dz = (z1 - z0) / nz;
    const hs = new Float32Array((nx + 1) * (nz + 1));
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    const uv = new Float32Array((nx + 1) * (nz + 1) * 2);
    const col = new Float32Array((nx + 1) * (nz + 1) * 3);
    for (let i = 0; i <= nz; i++) {
      for (let j = 0; j <= nx; j++) {
        const x = x0 + j * dx;
        const z = z0 + i * dz;
        const h = height(x, z);
        hs[j * (nz + 1) + i] = h;
        const k = i * (nx + 1) + j;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        uv[k * 2] = x * 0.25;
        uv[k * 2 + 1] = z * 0.25;
        const c = color ? color(x, z, h) : new THREE.Color(1, 1, 1);
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < nz; i++) {
      for (let j = 0; j < nx; j++) {
        const a = i * (nx + 1) + j;
        const b = a + 1;
        const c = a + (nx + 1);
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.env!.mats.get(mat));
    m.receiveShadow = true;
    m.castShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.extraMeshes.push(m);
    const d = RAPIER.ColliderDesc.heightfield(nz, nx, hs, { x: x1 - x0, y: 1, z: z1 - z0 }).setTranslation((x0 + x1) / 2, 0, (z0 + z1) / 2);
    d.setCollisionGroups(GROUP_STATIC);
    d.setFriction(0.9);
    this.colliderDescs.push(d);
  }

  /** Hanging vine strands over a wall face plus the climb volume (unless purely decorative). */
  vines(id: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, normal: [number, number, number], density = 1.6, climbable = true) {
    if (climbable) this.climb(id, x0, y0, z0, x1, y1, z1, normal, 'vine');
    if (this.navOnly) return;
    const n = new THREE.Vector3(...normal).normalize();
    const alongX = Math.abs(n.z) > Math.abs(n.x);
    const width = alongX ? x1 - x0 : z1 - z0;
    const strands = Math.max(2, Math.round(width * density));
    for (let s = 0; s < strands; s++) {
      const u = (s + 0.5) / strands;
      const bx = alongX ? x0 + u * (x1 - x0) : (n.x > 0 ? x1 : x0);
      const bz = alongX ? (n.z > 0 ? z1 : z0) : z0 + u * (z1 - z0);
      const top = y1 + 0.2;
      const len = (y1 - y0) * (0.75 + this.rng.next() * 0.3);
      const segs = Math.max(2, Math.round(len / 0.6));
      for (let k = 0; k < segs; k++) {
        const y = top - (k + 0.5) * (len / segs);
        const wob = Math.sin(k * 1.3 + s) * 0.08;
        const leaf = new THREE.PlaneGeometry(0.34, len / segs + 0.12);
        leaf.rotateY(alongX ? 0 : Math.PI / 2);
        leaf.rotateZ(wob);
        leaf.translate(bx + n.x * 0.06 + (alongX ? wob : 0), y, bz + n.z * 0.06 + (alongX ? 0 : wob));
        const c = climbable
          ? new THREE.Color().setHSL(0.27 + this.rng.next() * 0.05, 0.62, 0.3 + this.rng.next() * 0.12)
          : new THREE.Color().setHSL(0.22 + this.rng.next() * 0.06, 0.38, 0.2 + this.rng.next() * 0.1);
        this.addPiece('leaf', normalizeGeometry(leaf, c), false, true, new THREE.Vector3(bx, y, bz));
      }
    }
  }

  /** A bed of spikes with a damage volume. */
  spikes(x0: number, z0: number, x1: number, z1: number, y: number) {
    this.kill(x0, y - 0.5, z0, x1, y + 0.9, z1, 'spikes');
    if (this.navOnly) return;
    const geos: THREE.BufferGeometry[] = [];
    for (let x = x0 + 0.25; x < x1; x += 0.5) {
      for (let z = z0 + 0.25; z < z1; z += 0.5) {
        const h = 0.55 + this.rng.next() * 0.3;
        const c = new THREE.ConeGeometry(0.07, h, 5);
        c.translate(x + (this.rng.next() - 0.5) * 0.15, y + h / 2, z + (this.rng.next() - 0.5) * 0.15);
        geos.push(normalizeGeometry(c));
      }
    }
    if (geos.length) this.addPiece('iron', merge(geos), true, true, new THREE.Vector3((x0 + x1) / 2, y, (z0 + z1) / 2));
  }

  /** Build meshes and colliders. Yields between merges so the work spreads over frames. */
  *finish(group: THREE.Group, body: RAPIER.RigidBody): Generator<void, void, void> {
    if (!this.env) return;
    const { mats, physics } = this.env;
    let n = 0;
    for (const p of this.pieces.values()) {
      const geo = merge(p.geos);
      const m = new THREE.Mesh(geo, mats.get(p.mat));
      m.castShadow = p.cast;
      m.receiveShadow = p.receive;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      group.add(m);
      if (++n % 6 === 0) yield;
    }
    for (const o of this.extraMeshes) group.add(o);
    let k = 0;
    for (const d of this.colliderDescs) {
      physics.world.createCollider(d, body);
      if (++k % 400 === 0) yield;
    }
    this.pieces.clear();
    this.colliderDescs = [];
  }
}
