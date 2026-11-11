/**
 * Geometry helpers: world-scaled UV boxes, rocks, lathe shapes, and attribute normalisation
 * so everything can be merged into a handful of meshes.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WorldNoise } from './noise';

const wn = new WorldNoise(3);

/** Ensure non-indexed position/normal/uv/color so geometries can be merged together. */
export function normalizeGeometry(g: THREE.BufferGeometry, color?: THREE.Color): THREE.BufferGeometry {
  let geo = g.index ? g.toNonIndexed() : g;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.position.count;
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.attributes.color) {
    const c = new Float32Array(n * 3);
    const col = color ?? new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) {
      c[i * 3] = col.r;
      c[i * 3 + 1] = col.g;
      c[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  } else if (color) {
    const c = geo.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) c.setXYZ(i, c.getX(i) * color.r, c.getY(i) * color.g, c.getZ(i) * color.b);
  }
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
  geo.morphAttributes = {};
  return geo;
}

/**
 * Box with UVs from its position in a local frame offset by `origin`, so textures are
 * continuous across neighbouring boxes and keep a constant texel density (texScale per metre).
 */
export function uvBox(sx: number, sy: number, sz: number, texScale = 0.5, origin = new THREE.Vector3()): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + origin.x;
    const y = pos.getY(i) + origin.y;
    const z = pos.getZ(i) + origin.z;
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    if (ax > 0.5) uv.setXY(i, z * texScale * Math.sign(nor.getX(i)), y * texScale);
    else if (ay > 0.5) uv.setXY(i, x * texScale, z * texScale);
    else uv.setXY(i, x * texScale * -Math.sign(nor.getZ(i)), y * texScale);
  }
  return g;
}

/** Cylinder with UVs wrapped around (u by circumference in metres) and v by height. */
export function uvCylinder(rTop: number, rBot: number, h: number, seg = 16, texScale = 0.5, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const circ = Math.PI * 2 * Math.max(rTop, rBot);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ * texScale, uv.getY(i) * h * texScale);
  return g;
}

/** Lumpy rock from a displaced icosahedron. */
export function rockGeometry(radius: number, seed: number, squash = 0.75, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = wn.fbm(v.x * 0.9 + seed * 3.1, v.z * 0.9 + v.y * 0.7 - seed, 3);
    const k = 1 + n * 0.35;
    v.multiplyScalar(k);
    v.y *= squash;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * 0.5 + pos.getZ(i) * 0.3, pos.getY(i) * 0.5);
  return g;
}

export function lathe(points: [number, number][], seg = 20, texScale = 1): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * texScale * 2, uv.getY(i) * texScale);
  return g;
}

export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = geos.map((g) => normalizeGeometry(g));
  const m = mergeGeometries(prepared, false);
  if (!m) throw new Error('merge failed');
  m.computeBoundingSphere();
  m.computeBoundingBox();
  return m;
}

export function transformed(g: THREE.BufferGeometry, pos: THREE.Vector3 | [number, number, number], rot?: THREE.Euler | THREE.Quaternion, scale?: THREE.Vector3 | number): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = rot instanceof THREE.Quaternion ? rot : new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler());
  const p = Array.isArray(pos) ? new THREE.Vector3(...pos) : pos;
  const s = scale === undefined ? new THREE.Vector3(1, 1, 1) : typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale;
  m.compose(p, q, s);
  const out = g.clone();
  out.applyMatrix4(m);
  return out;
}

export function tinted(g: THREE.BufferGeometry, c: THREE.Color | number): THREE.BufferGeometry {
  return normalizeGeometry(g, c instanceof THREE.Color ? c : new THREE.Color(c));
}
