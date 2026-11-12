import * as THREE from 'three';
import { hash2 } from '../core/rng';
import type { Gate, MatName, Materials } from './materials';
import { CG, RAPIER, type Physics } from './physics';

export interface SetPiece {
  /** Per rendered frame. */
  update?(dt: number): void;
  /** Per fixed physics step. */
  fixedUpdate?(dt: number): void;
  /** Darkness has fallen: gates open, cracked walls give way. */
  onNight?(): void;
  dispose?(): void;
}

export interface BoxOpts {
  collide?: boolean;
  shadow?: boolean;
  gate?: Gate;
  /** Multiplies the vertex colour, e.g. 0.8 for a darker block. */
  tint?: number;
  /** RGB multiplier for the vertex colour. */
  color?: [number, number, number];
}

interface Bucket {
  mat: THREE.Material; shadow: boolean;
  pos: number[]; nor: number[]; uv: number[]; col: number[]; idx: number[];
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

// Unit cube faces: normal, then the two tangent axes used for UVs.
const FACES: { n: [number, number, number]; u: [number, number, number]; v: [number, number, number] }[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

/**
 * The level kit. Collects boxes, cylinders and arbitrary geometry into one merged mesh per
 * material (so a whole scene is a handful of draw calls) and one fixed rigid body holding every
 * static collider (so a whole scene streams out with one removal).
 */
export class SceneBuilder {
  readonly group = new THREE.Group();
  readonly body: RAPIER.RigidBody;
  readonly pieces: SetPiece[] = [];
  /** Default sky gate for everything built from here on. */
  gate: Gate = 'sky';
  private buckets = new Map<string, Bucket>();
  private disposables: { dispose(): void }[] = [];
  private finished = false;

  constructor(readonly physics: Physics, readonly mats: Materials, readonly name: string) {
    this.group.name = name;
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  private bucket(mat: MatName, gate: Gate, shadow: boolean): Bucket {
    const key = `${mat}|${gate}|${shadow ? 1 : 0}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { mat: this.mats.get(mat, gate), shadow, pos: [], nor: [], uv: [], col: [], idx: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  /** Axis-aligned box given two corners. */
  box(mat: MatName, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, o: BoxOpts = {}): void {
    const sx = Math.abs(x2 - x1), sy = Math.abs(y2 - y1), sz = Math.abs(z2 - z1);
    this.obox(mat, (x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2, sx, sy, sz, null, o);
  }

  /** Oriented box: centre, size and optional Euler rotation (radians, XYZ order). */
  obox(mat: MatName, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number,
    rot: [number, number, number] | null, o: BoxOpts = {}): void {
    const b = this.bucket(mat, o.gate ?? this.gate, o.shadow !== false);
    const ts = this.mats.scaleOf(mat);
    if (rot) { _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])); _m.compose(_v.set(cx, cy, cz), _q, new THREE.Vector3(1, 1, 1)); }
    const k = (o.tint ?? 1) * (0.86 + hash2(Math.round(cx * 7.3 + cz * 3.1), Math.round(cy * 5.7 + cz * 1.9)) * 0.2);
    const cr = k * (o.color?.[0] ?? 1), cg = k * (o.color?.[1] ?? 1), cb = k * (o.color?.[2] ?? 1);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    // World-anchored UVs for unrotated boxes so neighbouring blocks tile continuously.
    const ox = rot ? hash2(Math.round(cx * 3), Math.round(cz * 3)) * ts : cx, oy = rot ? 0 : cy, oz = rot ? 0 : cz;
    for (const f of FACES) {
      const base = b.pos.length / 3;
      for (let i = 0; i < 4; i++) {
        const su = i === 0 || i === 3 ? -1 : 1, sv = i < 2 ? -1 : 1;
        const lx = (f.n[0] + f.u[0] * su + f.v[0] * sv) * hx;
        const ly = (f.n[1] + f.u[1] * su + f.v[1] * sv) * hy;
        const lz = (f.n[2] + f.u[2] * su + f.v[2] * sv) * hz;
        if (rot) {
          _v.set(lx, ly, lz).applyMatrix4(_m);
          _n.set(f.n[0], f.n[1], f.n[2]).applyQuaternion(_q);
          b.pos.push(_v.x, _v.y, _v.z); b.nor.push(_n.x, _n.y, _n.z);
        } else {
          b.pos.push(cx + lx, cy + ly, cz + lz); b.nor.push(f.n[0], f.n[1], f.n[2]);
        }
        const wx = lx + ox, wy = ly + oy, wz = lz + oz;
        b.uv.push((wx * f.u[0] + wy * f.u[1] + wz * f.u[2]) / ts, (wx * f.v[0] + wy * f.v[1] + wz * f.v[2]) / ts);
        b.col.push(cr, cg, cb);
      }
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (o.collide !== false) {
      const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setCollisionGroups(CG.STATIC);
      if (rot) d.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
      this.physics.world.createCollider(d, this.body);
    }
  }

  /** Cylinder (or cone frustum) with its axis along local Y. */
  cyl(mat: MatName, cx: number, cy: number, cz: number, radius: number, height: number,
    o: BoxOpts & { rot?: [number, number, number]; segs?: number; radiusTop?: number } = {}): void {
    const g = new THREE.CylinderGeometry(o.radiusTop ?? radius, radius, height, o.segs ?? 10, 1);
    const ts = this.mats.scaleOf(mat);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * Math.PI * 2 * radius) / ts, (uv.getY(i) * height) / ts);
    _q.setFromEuler(_e.set(o.rot?.[0] ?? 0, o.rot?.[1] ?? 0, o.rot?.[2] ?? 0));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), _q, new THREE.Vector3(1, 1, 1));
    this.geom(mat, g, m, o);
    g.dispose();
    if (o.collide !== false) {
      const d = RAPIER.ColliderDesc.cylinder(height / 2, Math.max(radius, o.radiusTop ?? radius)).setTranslation(cx, cy, cz)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }).setCollisionGroups(CG.STATIC);
      this.physics.world.createCollider(d, this.body);
    }
  }

  /** Merge any geometry (visual only). The geometry is read, not kept. */
  geom(mat: MatName, g: THREE.BufferGeometry, matrix: THREE.Matrix4, o: BoxOpts = {}): void {
    const b = this.bucket(mat, o.gate ?? this.gate, o.shadow !== false);
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const base = b.pos.length / 3;
    _nm.getNormalMatrix(matrix);
    const k = o.tint ?? 1;
    const cr = k * (o.color?.[0] ?? 1), cg = k * (o.color?.[1] ?? 1), cb = k * (o.color?.[2] ?? 1);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      b.pos.push(_v.x, _v.y, _v.z);
      if (nor) { _n.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize(); b.nor.push(_n.x, _n.y, _n.z); } else b.nor.push(0, 1, 0);
      if (uv) b.uv.push(uv.getX(i), uv.getY(i)); else b.uv.push(0, 0);
      b.col.push(cr, cg, cb);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) b.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) b.idx.push(base + i);
  }

  /** Raw static collider with no visual (invisible walls, simplified hulls). */
  collider(desc: RAPIER.ColliderDesc): RAPIER.Collider {
    return this.physics.world.createCollider(desc.setCollisionGroups(CG.STATIC), this.body);
  }

  /** Invisible axis-aligned blocker. */
  blocker(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): void {
    this.collider(RAPIER.ColliderDesc.cuboid(Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, Math.abs(z2 - z1) / 2)
      .setTranslation((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2));
  }

  /**
   * A flight of steps. Rises from yFrom at a=from to yTo at a=to along `axis`, spanning c1..c2 on
   * the other axis. Visual steps, with one smooth ramp collider so the character glides up.
   */
  stairs(mat: MatName, axis: 'x' | 'z', from: number, to: number, c1: number, c2: number, yFrom: number, yTo: number, o: BoxOpts = {}): void {
    const run = to - from, rise = yTo - yFrom;
    const n = Math.max(1, Math.round(Math.abs(rise) / 0.25));
    const lowY = Math.min(yFrom, yTo);
    for (let i = 0; i < n; i++) {
      const a0 = from + (run * i) / n, a1 = from + (run * (i + 1)) / n;
      // Treads straddle the walking surface (a smooth ramp), half a riser above and below it, so the
      // ramp meets both landings flush and feet never hang up on a lip.
      const top = yFrom + (rise * (i + 0.5)) / n;
      const bottom = Math.max(lowY - 0.4, top - 1.2);
      if (axis === 'z') this.box(mat, c1, bottom, a0, c2, top, a1, { ...o, collide: false });
      else this.box(mat, a0, bottom, c1, a1, top, c2, { ...o, collide: false });
    }
    const len = Math.hypot(run, rise) + 0.3, ang = Math.atan2(rise, Math.abs(run));
    const th = 0.5;
    const mid = (from + to) / 2, midY = (yFrom + yTo) / 2 - th / 2 / Math.cos(ang);
    const dir = Math.sign(run) || 1;
    const d = axis === 'z'
      ? RAPIER.ColliderDesc.cuboid(Math.abs(c2 - c1) / 2, th / 2, len / 2).setTranslation((c1 + c2) / 2, midY, mid)
      : RAPIER.ColliderDesc.cuboid(len / 2, th / 2, Math.abs(c2 - c1) / 2).setTranslation(mid, midY, (c1 + c2) / 2);
    _q.setFromEuler(axis === 'z' ? _e.set(-ang * dir, 0, 0) : _e.set(0, 0, ang * dir));
    d.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    this.collider(d);
  }

  /**
   * Four walls around an interior rectangle, built outward by `t`. Openings are cut per side:
   * side n is z1 (min z), s is z2, w is x1, e is x2; a1..a2 run along the wall; h is the opening height.
   */
  room(mat: MatName, x1: number, z1: number, x2: number, z2: number, y1: number, y2: number, t: number,
    openings: { side: 'n' | 's' | 'e' | 'w'; a1: number; a2: number; h: number; y?: number }[] = [], o: BoxOpts = {}, skip: string = ''): void {
    for (const side of ['n', 's', 'e', 'w'] as const) {
      if (skip.includes(side)) continue;
      const along: [number, number] = side === 'n' || side === 's' ? [x1 - t, x2 + t] : [z1, z2];
      const ops = openings.filter((p) => p.side === side).sort((a, b) => a.a1 - b.a1);
      const seg = (a: number, b: number, ya: number, yb: number) => {
        if (b - a < 0.01 || yb - ya < 0.01) return;
        if (side === 'n') this.box(mat, a, ya, z1 - t, b, yb, z1, o);
        else if (side === 's') this.box(mat, a, ya, z2, b, yb, z2 + t, o);
        else if (side === 'w') this.box(mat, x1 - t, ya, a, x1, yb, b, o);
        else this.box(mat, x2, ya, a, x2 + t, yb, b, o);
      };
      let cur = along[0];
      for (const p of ops) {
        seg(cur, p.a1, y1, y2);
        const oy = p.y ?? y1;
        seg(p.a1, p.a2, y1, oy);            // sill below a raised opening
        seg(p.a1, p.a2, oy + p.h, y2);      // lintel above
        cur = p.a2;
      }
      seg(cur, along[1], y1, y2);
    }
  }

  /** Add an unmerged object (animated things, instanced meshes). */
  add<T extends THREE.Object3D>(obj: T): T { this.group.add(obj); return obj; }

  piece<T extends SetPiece>(p: T): T { this.pieces.push(p); return p; }

  track(d: { dispose(): void }): void { this.disposables.push(d); }

  /** Instanced mesh from a list of matrices. */
  instances(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], shadow = true, receive = true): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length));
    im.count = matrices.length;
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = shadow; im.receiveShadow = receive;
    im.computeBoundingSphere();
    this.group.add(im);
    this.track(geometry);
    return im;
  }

  /** Turn the collected buckets into meshes. Call once, last. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const b of this.buckets.values()) {
      if (!b.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, b.mat);
      mesh.castShadow = b.shadow; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.disposables.push(g);
      b.pos = []; b.nor = []; b.uv = []; b.col = []; b.idx = [];
    }
  }

  update(dt: number): void { for (const p of this.pieces) p.update?.(dt); }
  fixedUpdate(dt: number): void { for (const p of this.pieces) p.fixedUpdate?.(dt); }

  dispose(): void {
    for (const p of this.pieces) p.dispose?.();
    this.pieces.length = 0;
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.physics.removeBody(this.body);
  }
}
