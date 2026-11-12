/** Helpers shared by the scene builders. */
import * as THREE from 'three';
import type { Vec3Like } from '../../core/scenes';
import { muralTexture, type Glyph } from '../../engine/textures';
import { RAPIER } from '../../engine/physics';
import { Sconce } from '../entities/env';
import { Supply } from '../entities/relics';
import type { BoxOpts, SceneKit } from '../kit';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

export function sconce(k: SceneKit, id: string, x: number, y: number, z: number, nx: number, nz: number, dark = k.dungeon): void {
  k.add(new Sconce(k.game, k, `${k.id}.${id}`, { x, y, z }, nx, nz, dark));
}

export function supply(k: SceneKit, id: string, kind: 'flask' | 'spare', x: number, y: number, z: number, dark = k.dungeon): void {
  k.add(new Supply(k.game, k, `${k.id}.${id}`, kind, { x, y, z }, dark));
}

/**
 * A carved panel on a wall. (nx, nz) is the direction the panel faces.
 * The texture is lit like any other surface: in the dark you need a torch to read it.
 */
export function mural(
  k: SceneKit, id: string, glyphs: Glyph[], x: number, y: number, z: number, nx: number, nz: number,
  o: { accent?: Glyph; height?: number; dark?: boolean } = {},
): void {
  const dark = o.dark ?? k.dungeon;
  const h = o.height ?? 1.1;
  const w = (h * 128 * glyphs.length) / 160;
  const tex = muralTexture(glyphs, dark, o.accent ?? null);
  const g = new THREE.PlaneGeometry(w, h);
  const mesh = new THREE.Mesh(g, k.game.mats.fromTexture(`${k.id}.${id}`, tex, dark));
  mesh.position.set(x + nx * 0.03, y, z + nz * 0.03);
  mesh.rotation.y = Math.atan2(nx, nz);
  mesh.receiveShadow = true;
  k.group.add(mesh);
}

/** A column lying on its side between two points. */
export function fallenPillar(k: SceneKit, x0: number, z0: number, x1: number, z1: number, r: number, y: number, mat = 'pillar'): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  const g = new THREE.CylinderGeometry(r, r * 0.94, len, 12);
  g.rotateX(Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, (uv.getY(i) * len) / 3);
  _q.setFromEuler(_e.set(0, yaw, 0));
  _m.compose(_v.set((x0 + x1) / 2, y + r * 0.92, (z0 + z1) / 2), _q, _s.set(1, 1, 1));
  k.geo(g, mat, _m.clone());
  g.dispose();
  k.collider(
    RAPIER.ColliderDesc.cuboid(r * 0.85, r * 0.9, len / 2).setTranslation((x0 + x1) / 2, y + r * 0.9, (z0 + z1) / 2).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }),
    { surface: 'stone' },
  );
}

/** A lumpy rock merged into the static batch, with a ball-ish collider. */
export function rock(k: SceneKit, x: number, y: number, z: number, r: number, o: { solid?: boolean; mat?: string; squash?: number; tint?: number } = {}): void {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const seed = x * 12.9898 + z * 78.233;
  for (let i = 0; i < p.count; i++) {
    const kk = 0.78 + 0.32 * Math.abs(Math.sin(seed + p.getX(i) * 9.1 + p.getY(i) * 5.3 + p.getZ(i) * 7.7));
    p.setXYZ(i, p.getX(i) * kk, p.getY(i) * kk * (o.squash ?? 0.7), p.getZ(i) * kk);
  }
  g.computeVertexNormals();
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 1.5, uv.getY(i) * r);
  _m.compose(_v.set(x, y + r * 0.35, z), _q.setFromEuler(_e.set(0, seed % 6.28, 0)), _s.set(1, 1, 1));
  k.geo(g, o.mat ?? 'rock', _m.clone(), { tint: o.tint });
  g.dispose();
  if (o.solid ?? true) {
    k.collider(RAPIER.ColliderDesc.ball(r * 0.78).setTranslation(x, y + r * 0.2, z), { surface: 'stone' });
  }
}

export interface Scatter {
  x: number;
  y: number;
  z: number;
  /** Uniform scale. */
  s: number;
  rot: number;
  /** 0..1 colour variation. */
  hue: number;
}

/** One instanced mesh from a list of placements. */
export function instanced(
  k: SceneKit, geo: THREE.BufferGeometry, mat: THREE.Material, items: Scatter[],
  o: { cast?: boolean; receive?: boolean; color?: (hue: number, c: THREE.Color) => void; tilt?: number } = {},
): THREE.InstancedMesh | null {
  if (items.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const c = new THREE.Color();
  items.forEach((it, i) => {
    _e.set(o.tilt ? Math.sin(it.rot * 7) * o.tilt : 0, it.rot, o.tilt ? Math.cos(it.rot * 5) * o.tilt : 0);
    _m.compose(_v.set(it.x, it.y, it.z), _q.setFromEuler(_e), _s.set(it.s, it.s, it.s));
    mesh.setMatrixAt(i, _m);
    if (o.color) {
      o.color(it.hue, c);
      mesh.setColorAt(i, c);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = o.cast ?? false;
  mesh.receiveShadow = o.receive ?? true;
  mesh.computeBoundingSphere();
  k.group.add(mesh);
  return mesh;
}

/** Two crossed quads standing on the origin: the classic bush card. */
export function crossCardGeometry(w: number, h: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < 2; i++) {
    const a = (i * Math.PI) / 2 + 0.4;
    const cx = (Math.cos(a) * w) / 2;
    const cz = (Math.sin(a) * w) / 2;
    const b = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, h, cz, -cx, h, -cz);
    // Normals point up so cards take the sky's light instead of going black edge-on.
    for (let j = 0; j < 4; j++) nor.push(0, 1, 0);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A leafy blob: an icosphere with baked vertex shading (dark underneath). */
export function canopyGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const kk = 0.82 + 0.3 * Math.abs(Math.sin(p.getX(i) * 7.3 + p.getY(i) * 3.1 + p.getZ(i) * 5.7));
    p.setXYZ(i, p.getX(i) * kk, p.getY(i) * kk * 0.72, p.getZ(i) * kk);
    const shade = 0.45 + 0.55 * Math.max(0, p.getY(i) * 0.9 + 0.35);
    // Linear values (vertex colours are not sRGB-decoded).
    col[i * 3] = 0.11 * shade;
    col[i * 3 + 1] = 0.21 * shade;
    col[i * 3 + 2] = 0.065 * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export const leafTint = (hue: number, c: THREE.Color): void => {
  c.setRGB(0.8 + hue * 0.45, 0.84 + hue * 0.26, 0.74 + hue * 0.3);
};

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A horizontal slab with rectangular holes cut out of it (roofs with skylights, floors with pits). */
export function slabWithHoles(
  k: SceneKit, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: string, holes: Rect[], o: BoxOpts = {},
): void {
  const cuts = (lo: number, hi: number, vals: number[]): number[] =>
    [...new Set([lo, hi, ...vals.filter((v) => v > lo && v < hi)])].sort((a, b) => a - b);
  const xs = cuts(x0, x1, holes.flatMap((h) => [h.x0, h.x1]));
  const zs = cuts(z0, z1, holes.flatMap((h) => [h.z0, h.z1]));
  const inHole = (x: number, z: number): boolean => holes.some((h) => x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1);
  for (let j = 0; j < zs.length - 1; j++) {
    let runStart: number | null = null;
    for (let i = 0; i <= xs.length - 1; i++) {
      const open = i < xs.length - 1 && !inHole((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2);
      if (open && runStart === null) runStart = xs[i];
      if (!open && runStart !== null) {
        k.box(runStart, y0, zs[j], xs[i], y1, zs[j + 1], mat, o);
        runStart = null;
      }
    }
  }
}

export type { Vec3Like };
