/**
 * SceneKit: the builder API the seven scenes are written in.
 *
 * Static geometry is batched: every box / cylinder / merged mesh goes into one
 * vertex buffer per (material, zone variant, 24 m cell), so a whole scene is a
 * few dozen draw calls. Colliders all hang off one fixed body per scene.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { SceneId } from '../core/scenes';
import { GROUPS, RAPIER, type ColliderMeta, type Surface } from '../engine/physics';
import type { Game } from '../game/game';
import type { SceneLayout } from './layout';
import type { FloorDef } from './layout/types';
import type { PropKind } from './entities/props';
import type { Entity } from './registry';

export interface BoxOpts {
  /** Add a collider (default true). */
  solid?: boolean;
  /** Override the scene's default zone variant. */
  dungeon?: boolean;
  /** Brightness multiplier on the vertex colour. */
  tint?: number;
  /** Vertex colour multipliers at the bottom and top of the box (cheap ambient occlusion / falloff). */
  shade?: [number, number];
  surface?: Surface;
  kind?: string;
  /** Texture metres-per-tile override. */
  scale?: number;
  /** Leave out of the sun/torch shadow passes. */
  noShadow?: boolean;
  /** RGB multiplier. */
  color?: [number, number, number];
}

interface Batch {
  mat: string;
  dungeon: boolean;
  shadow: boolean;
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

export interface LoadedScene {
  id: SceneId;
  group: THREE.Group;
  body: RAPIER.RigidBody;
  entities: Entity[];
  /** Trap handlers wired to trapped pedestals. */
  traps: Map<string, (pos: { x: number; y: number; z: number }) => void>;
}

const CELL = 24;
const SURFACE_OF: Record<string, Surface> = {
  wood: 'wood', bark: 'wood', terrain: 'dirt', foliage: 'grass', iron: 'metal', bronze: 'metal', gold: 'metal',
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export class SceneKit implements LoadedScene {
  readonly group = new THREE.Group();
  readonly body: RAPIER.RigidBody;
  readonly entities: Entity[] = [];
  readonly traps = new Map<string, (pos: { x: number; y: number; z: number }) => void>();
  readonly rng: Rng;
  /** Default zone variant for this scene's materials. */
  dungeon: boolean;
  private batches = new Map<string, Batch>();

  constructor(
    readonly game: Game,
    readonly id: SceneId,
    readonly layout: SceneLayout,
    dungeon: boolean,
  ) {
    this.dungeon = dungeon;
    this.group.name = `scene:${id}`;
    this.rng = new Rng(game.run.seed ^ (id.length * 7919 + id.charCodeAt(0) * 131 + id.charCodeAt(2)));
    this.body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  // ---------------------------------------------------------------- batching

  private batch(mat: string, dungeon: boolean, cx: number, cz: number, shadow: boolean): Batch {
    const key = `${mat}|${dungeon ? 1 : 0}|${shadow ? 1 : 0}|${Math.floor(cx / CELL)}|${Math.floor(cz / CELL)}`;
    let b = this.batches.get(key);
    if (!b) {
      b = { mat, dungeon, shadow, pos: [], nor: [], uv: [], col: [], idx: [] };
      this.batches.set(key, b);
    }
    return b;
  }

  private tintOf(o: BoxOpts): [number, number, number] {
    const j = (o.tint ?? 1) * (0.94 + this.rng.next() * 0.12);
    const c = o.color ?? [1, 1, 1];
    const warm = (this.rng.next() - 0.5) * 0.04;
    return [c[0] * j * (1 + warm), c[1] * j, c[2] * j * (1 - warm)];
  }

  /** Axis-aligned box given by its min and max corners. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string, o: BoxOpts = {}): void {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const dungeon = o.dungeon ?? this.dungeon;
    const b = this.batch(mat, dungeon, (x0 + x1) / 2, (z0 + z1) / 2, !o.noShadow);
    const s = 1 / (o.scale ?? this.game.mats.scaleOf(mat));
    const [r, g, bl] = this.tintOf(o);
    const h = y1 - y0;
    const sh = o.shade ?? (h >= 2 ? [0.8, 1] : [1, 1]);
    const base = b.pos.length / 3;
    // Offset UVs per box so neighbouring boxes do not show the same texels.
    const ou = this.rng.next();
    const ov = this.rng.next();
    const face = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
      dx: number, dy: number, dz: number,
      nx: number, ny: number, nz: number,
    ): void => {
      const i = b.pos.length / 3;
      b.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      for (let k = 0; k < 4; k++) b.nor.push(nx, ny, nz);
      const uvOf = (x: number, y: number, z: number): void => {
        if (ny !== 0) b.uv.push(x * s + ou, z * s + ov);
        else if (nx !== 0) b.uv.push(z * s + ou, y * s + ov);
        else b.uv.push(x * s + ou, y * s + ov);
      };
      uvOf(ax, ay, az);
      uvOf(bx, by, bz);
      uvOf(cx, cy, cz);
      uvOf(dx, dy, dz);
      for (const y of [ay, by, cy, dy]) {
        const k = h > 1e-6 ? sh[0] + (sh[1] - sh[0]) * ((y - y0) / h) : sh[1];
        b.col.push(r * k, g * k, bl * k);
      }
      b.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    };
    face(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0);
    face(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0);
    face(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0);
    face(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0);
    face(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1);
    face(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1);
    void base;
    if (o.solid ?? true) {
      this.collider(
        RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2).setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
        { surface: o.surface ?? SURFACE_OF[mat] ?? 'stone', kind: o.kind },
      );
    }
  }

  /** Merge any geometry (transformed by `m`) into the static batches. Visual only. */
  geo(g: THREE.BufferGeometry, mat: string, m: THREE.Matrix4, o: BoxOpts = {}): void {
    const dungeon = o.dungeon ?? this.dungeon;
    _v.setFromMatrixPosition(m);
    const b = this.batch(mat, dungeon, _v.x, _v.z, !o.noShadow);
    const [r, gg, bl] = this.tintOf(o);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const col = g.getAttribute('color');
    const base = b.pos.length / 3;
    _nm.getNormalMatrix(m);
    const us = o.scale ?? 1;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(m);
      b.pos.push(_v.x, _v.y, _v.z);
      if (n) _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
      else _n.set(0, 1, 0);
      b.nor.push(_n.x, _n.y, _n.z);
      if (uv) b.uv.push(uv.getX(i) * us, uv.getY(i) * us);
      else b.uv.push(0, 0);
      if (col) b.col.push(col.getX(i) * r, col.getY(i) * gg, col.getZ(i) * bl);
      else b.col.push(r, gg, bl);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) b.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) b.idx.push(base + i);
  }

  /** Upright cylinder standing on (x, y, z). */
  cyl(x: number, y: number, z: number, r: number, h: number, mat: string, o: BoxOpts & { rTop?: number; seg?: number } = {}): void {
    const seg = o.seg ?? 12;
    const g = new THREE.CylinderGeometry(o.rTop ?? r, r, h, seg, 1);
    // World-scaled UVs: once round the circumference, up the height.
    const s = 1 / (o.scale ?? this.game.mats.scaleOf(mat));
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r * s, uv.getY(i) * h * s);
    _m.makeTranslation(x, y + h / 2, z);
    this.geo(g, mat, _m, { ...o, scale: 1 });
    g.dispose();
    if (o.solid ?? true) {
      this.collider(RAPIER.ColliderDesc.cylinder(h / 2, Math.max(r, o.rTop ?? r)).setTranslation(x, y + h / 2, z), {
        surface: o.surface ?? SURFACE_OF[mat] ?? 'stone', kind: o.kind,
      });
    }
  }

  /** A box rotated about Y (and optionally tilted): toppled pillars, leaning slabs. Collider optional. */
  boxRot(
    cx: number, cy: number, cz: number, sx: number, sy: number, sz: number,
    rotY: number, mat: string, o: BoxOpts & { rotX?: number; rotZ?: number } = {},
  ): void {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const s = 1 / (o.scale ?? this.game.mats.scaleOf(mat));
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const big = Math.max(sx, sz);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * big * s, uv.getY(i) * Math.max(sy, Math.min(sx, sz)) * s);
    const e = new THREE.Euler(o.rotX ?? 0, rotY, o.rotZ ?? 0, 'YXZ');
    _q.setFromEuler(e);
    _m.compose(_v.set(cx, cy, cz), _q, new THREE.Vector3(1, 1, 1));
    this.geo(g, mat, _m.clone(), { ...o, scale: 1 });
    g.dispose();
    if (o.solid ?? true) {
      this.collider(
        RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(cx, cy, cz).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }),
        { surface: o.surface ?? SURFACE_OF[mat] ?? 'stone', kind: o.kind },
      );
    }
  }

  /** Attach a collider to the scene's fixed body. */
  collider(desc: RAPIER.ColliderDesc, meta: ColliderMeta = {}, groups: number = GROUPS.world): RAPIER.Collider {
    desc.setCollisionGroups(groups);
    desc.setFriction(0.9);
    const c = this.game.physics.world.createCollider(desc, this.body);
    this.game.physics.setMeta(c, meta);
    return c;
  }

  // ------------------------------------------------------------ layout pieces

  /** Slabs, ramps and steps for every `visual` floor in the layout. */
  floorsFromLayout(filter: (f: FloorDef) => boolean = () => true, o: (f: FloorDef) => BoxOpts = () => ({})): void {
    for (const f of this.layout.floors) {
      if (!f.visual || !filter(f)) continue;
      if (f.slope && f.y2 !== undefined) this.ramp(f.x0, f.z0, f.x1, f.z1, f.y, f.y2, f.slope, f.mat, { steps: f.steps, thick: f.thick, ...o(f) });
      else this.box(f.x0, f.y - f.thick, f.z0, f.x1, f.y, f.z1, f.mat, o(f));
    }
  }

  /**
   * A ramp between two heights. The collider is one smooth incline; the
   * visual is a flight of steps (or a sloped slab with `steps: false`).
   */
  ramp(
    x0: number, z0: number, x1: number, z1: number, yLow: number, yHigh: number, slope: 'x' | 'z', mat: string,
    o: BoxOpts & { steps?: boolean; thick?: number } = {},
  ): void {
    const run = slope === 'x' ? x1 - x0 : z1 - z0;
    const rise = yHigh - yLow;
    const len = Math.hypot(run, rise);
    const angle = Math.atan2(rise, run);
    const thick = 0.4;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const cy = (yLow + yHigh) / 2;
    // Rotate about Z (slope along X) or about X (slope along Z); shift down so the top face is the walking surface.
    const e = slope === 'x' ? new THREE.Euler(0, 0, angle) : new THREE.Euler(-angle, 0, 0);
    _q.setFromEuler(e);
    const drop = thick / 2 / Math.cos(angle);
    const hx = slope === 'x' ? len / 2 : (x1 - x0) / 2;
    const hz = slope === 'x' ? (z1 - z0) / 2 : len / 2;
    this.collider(
      RAPIER.ColliderDesc.cuboid(hx, thick / 2, hz).setTranslation(cx, cy - drop, cz).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }),
      { surface: o.surface ?? SURFACE_OF[mat] ?? 'stone' },
    );
    const bottom = Math.min(yLow, yHigh) - (o.thick ?? 0.6);
    if (o.steps ?? true) {
      const n = Math.max(2, Math.round(Math.abs(rise) / 0.24));
      for (let i = 0; i < n; i++) {
        const a = i / n;
        const b = (i + 1) / n;
        const top = yLow + rise * ((a + b) / 2) + Math.abs(rise) / n / 2 - 0.02;
        if (slope === 'x') this.box(x0 + run * a, bottom, z0, x0 + run * b, top, z1, mat, { ...o, solid: false, shade: o.shade ?? [1, 1] });
        else this.box(x0, bottom, z0 + run * a, x1, top, z0 + run * b, mat, { ...o, solid: false, shade: o.shade ?? [1, 1] });
      }
    } else {
      const g = new THREE.BoxGeometry(hx * 2, thick, hz * 2);
      const s = 1 / this.game.mats.scaleOf(mat);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * hx * 2 * s, uv.getY(i) * hz * 2 * s);
      _m.compose(_v.set(cx, cy - drop, cz), _q, new THREE.Vector3(1, 1, 1));
      this.geo(g, mat, _m.clone(), { ...o, scale: 1 });
      g.dispose();
    }
  }

  /** Pillars and masonry blocks listed in the layout. */
  propsFromLayout(o: BoxOpts = {}): void {
    for (const p of this.layout.props) {
      if (p.kind === 'block') {
        this.box(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, p.mat, o);
      } else {
        this.pillar(p.x, p.y, p.z, p.r, p.h, p.standing, p.mat, o);
      }
    }
  }

  /** A column with base and capital. `standing` < 1 leaves a broken stump. */
  pillar(x: number, y: number, z: number, r: number, h: number, standing = 1, mat = 'pillar', o: BoxOpts = {}): void {
    const hh = Math.max(1, h * standing);
    this.box(x - r * 1.25, y, z - r * 1.25, x + r * 1.25, y + 0.35, z + r * 1.25, mat, { ...o, solid: false });
    this.cyl(x, y + 0.35, z, r, hh - 0.35, mat, { ...o, rTop: standing >= 1 ? r * 0.92 : r * 0.97, seg: 12 });
    if (standing >= 1) this.box(x - r * 1.3, y + h - 0.4, z - r * 1.3, x + r * 1.3, y + h, z + r * 1.3, mat, { ...o, solid: false });
  }

  /**
   * Four walls round a rectangle (inner dimensions), with door gaps.
   * An opening is `{ side, a, b, top }`: the gap runs from a to b along the wall,
   * with masonry above `top` if given.
   */
  room(
    x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: string,
    openings: { side: 'n' | 's' | 'e' | 'w'; a: number; b: number; top?: number }[] = [],
    o: BoxOpts & { thick?: number; sides?: string } = {},
  ): void {
    const t = o.thick ?? 1;
    const sides = o.sides ?? 'nsew';
    const run = (side: 'n' | 's' | 'e' | 'w'): void => {
      const along = side === 'n' || side === 's';
      const lo = along ? x0 - t : z0;
      const hi = along ? x1 + t : z1;
      const gaps = openings.filter((g) => g.side === side).sort((p, q) => p.a - q.a);
      let cur = lo;
      const seg = (a: number, b: number, ya: number, yb: number): void => {
        if (b - a < 0.02 || yb - ya < 0.02) return;
        if (side === 'n') this.box(a, ya, z0 - t, b, yb, z0, mat, o);
        else if (side === 's') this.box(a, ya, z1, b, yb, z1 + t, mat, o);
        else if (side === 'w') this.box(x0 - t, ya, a, x0, yb, b, mat, o);
        else this.box(x1, ya, a, x1 + t, yb, b, mat, o);
      };
      for (const g of gaps) {
        seg(cur, g.a, y0, y1);
        if (g.top !== undefined) seg(g.a, g.b, g.top, y1);
        cur = g.b;
      }
      seg(cur, hi, y0, y1);
    };
    for (const s of ['n', 's', 'e', 'w'] as const) if (sides.includes(s)) run(s);
  }

  add<T extends Entity>(e: T): T {
    this.entities.push(e);
    return e;
  }

  /** Declare a loose prop. It is spawned wherever the run last left it (possibly in another scene). */
  prop(id: string, kind: PropKind, mass: number, x: number, y: number, z: number): void {
    const key = `${this.id}.${id}`;
    if (!this.game.run.props.has(key)) this.game.run.props.set(key, { id: key, kind, mass, scene: this.id, x, y, z });
  }

  /** Register what a trapped pedestal sets off. */
  trap(id: string, fn: (pos: { x: number; y: number; z: number }) => void): void {
    this.traps.set(id, fn);
  }

  /** Upload the batches. Call once, after the last piece of static geometry. */
  finish(): LoadedScene {
    for (const b of this.batches.values()) {
      if (b.idx.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, this.game.mats.get(b.mat, b.dungeon));
      mesh.castShadow = b.shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = `${this.id}:${b.mat}`;
      this.group.add(mesh);
    }
    this.batches.clear();
    return this;
  }
}

/** Dispose every geometry under a group (materials and textures are shared and stay). */
export function disposeGroup(group: THREE.Object3D): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.userData.sharedGeometry) m.geometry.dispose();
  });
}
