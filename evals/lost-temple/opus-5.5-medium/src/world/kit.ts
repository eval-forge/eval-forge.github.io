import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Static collider descriptors; the chunk turns them into Rapier colliders on load. */
export type StaticDesc =
  | { shape: 'box'; hx: number; hy: number; hz: number; pos: THREE.Vector3; quat: THREE.Quaternion }
  | { shape: 'cyl'; r: number; hh: number; pos: THREE.Vector3; quat: THREE.Quaternion }
  | { shape: 'ball'; r: number; pos: THREE.Vector3 }
  | { shape: 'trimesh'; vertices: Float32Array; indices: Uint32Array };

export interface BoxOpts { rotY?: number; rotX?: number; rotZ?: number; collide?: boolean; cast?: boolean; receive?: boolean; uvScale?: number; visible?: boolean }

/** Project UVs from world position along the dominant normal axis so textures tile at a consistent scale. */
export function worldUV(g: THREE.BufferGeometry, scale = 0.5) {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * Collects static geometry per material, merges it into a few big meshes
 * (few draw calls), and records collider descriptors.
 */
export class Builder {
  private batches = new Map<THREE.Material, { cast: THREE.BufferGeometry[]; nocast: THREE.BufferGeometry[] }>();
  statics: StaticDesc[] = [];
  constructor(public group: THREE.Group) {}

  addGeometry(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, mat: THREE.Material, cast = true, uvScale = 0.5) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (uvScale > 0) worldUV(g, uvScale);
    let b = this.batches.get(mat);
    if (!b) { b = { cast: [], nocast: [] }; this.batches.set(mat, b); }
    (cast ? b.cast : b.nocast).push(g);
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, o: BoxOpts = {}) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotX ?? 0, o.rotY ?? 0, o.rotZ ?? 0));
    const p = new THREE.Vector3(x, y, z);
    if (o.visible !== false) {
      const m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
      this.addGeometry(new THREE.BoxGeometry(w, h, d), m, mat, o.cast !== false, o.uvScale ?? 0.5);
    }
    if (o.collide !== false) this.statics.push({ shape: 'box', hx: w / 2, hy: h / 2, hz: d / 2, pos: p, quat: q });
  }

  /** Invisible collider wall. */
  wall(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0) {
    this.box(w, h, d, x, y, z, null as unknown as THREE.Material, { visible: false, rotY });
  }

  cyl(r: number, h: number, x: number, y: number, z: number, mat: THREE.Material, o: BoxOpts & { segs?: number; r2?: number } = {}) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotX ?? 0, o.rotY ?? 0, o.rotZ ?? 0));
    const p = new THREE.Vector3(x, y, z);
    const m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
    this.addGeometry(new THREE.CylinderGeometry(o.r2 ?? r, r, h, o.segs ?? 12), m, mat, o.cast !== false, o.uvScale ?? 0.5);
    if (o.collide !== false) this.statics.push({ shape: 'cyl', r: Math.max(r, o.r2 ?? r), hh: h / 2, pos: p, quat: q });
  }

  /** Arbitrary decorative geometry (no collider). */
  deco(geo: THREE.BufferGeometry, x: number, y: number, z: number, mat: THREE.Material, rotY = 0, scale = 1, cast = true, uvScale = 0.5) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), new THREE.Vector3(scale, scale, scale));
    this.addGeometry(geo, m, mat, cast, uvScale);
  }

  /** Simple stairs from (x, y0, z0) going toward z1 rising/falling to y1. */
  stairs(x: number, w: number, z0: number, z1: number, y0: number, y1: number, mat: THREE.Material, step = 0.3) {
    const n = Math.max(1, Math.round(Math.abs(y1 - y0) / step));
    const dz = (z1 - z0) / n, dy = (y1 - y0) / n;
    for (let i = 0; i < n; i++) {
      const top = y0 + dy * (i + 1);
      const bottom = Math.min(y0, y1) - 0.5;
      const h = top - bottom;
      this.box(w, h, Math.abs(dz), x, bottom + h / 2, z0 + dz * (i + 0.5), mat, { cast: false });
    }
  }

  finish() {
    for (const [mat, b] of this.batches) {
      if (!mat) continue;
      for (const [list, cast] of [[b.cast, true], [b.nocast, false]] as const) {
        if (!list.length) continue;
        // Merge in chunks to keep frustum culling useful
        const merged = mergeGeometries(list, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.group.add(mesh);
      }
    }
    this.batches.clear();
  }
}

/** Instanced foliage helpers. */
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], cast = true): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
  matrices.forEach((m, i) => im.setMatrixAt(i, m));
  im.count = matrices.length;
  im.castShadow = cast;
  im.receiveShadow = true;
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  return im;
}

export function mat4(x: number, y: number, z: number, rotY = 0, sx = 1, sy = sx, sz = sx, rotX = 0, rotZ = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ)), new THREE.Vector3(sx, sy, sz));
}

/** Crossed-quad plant geometry (two vertical planes). */
export function crossQuad(w: number, h: number): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(w, h); a.translate(0, h / 2, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  return mergeGeometries([a, b])!;
}
