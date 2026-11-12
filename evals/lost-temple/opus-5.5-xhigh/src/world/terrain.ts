/**
 * Outdoor ground: one height function for the jungle and the courtyard, turned into a
 * vertex-coloured mesh and a Rapier heightfield per scene. Plus small shared props
 * (pillars, rubble, ruin blocks) used by several scenes.
 */
import * as THREE from 'three';
import { RIVER, GORGE } from './layout';
import { standard, surface, type Exposure } from '../engine/materials';
import { textures } from '../engine/textures';
import { Rng } from '../core/rng';
import type { SceneHandle } from './SceneManager';
import { mesh } from './build';

// value noise
function hash2(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, z: number, oct = 4) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Outdoor ground height. */
export function groundY(x: number, z: number): number {
  // ------------------------------------------------ courtyard (z < 70)
  if (z < 70) {
    let y = 0;
    // west hillside
    if (x < -38) y += Math.pow(x < -38 ? -38 - x : 0, 1.35) * 0.45;
    // soft bumps outside the plazas
    const plaza = Math.abs(x) < 34 && z > 2;
    if (!plaza) y += (fbm(x * 0.15, z * 0.15) - 0.5) * 0.5;
    else y -= 0.15; // paving sits on top
    // fade into the jungle
    if (z > 64) y += (fbm(x * 0.08, z * 0.08) - 0.5) * 0.7 * smooth(64, 70, z);
    return y;
  }
  // ------------------------------------------------ jungle
  let y = (fbm(x * 0.06, z * 0.06) - 0.5) * 1.1 + (fbm(x * 0.3, z * 0.3) - 0.5) * 0.25;
  // hills bound the valley
  const ax = Math.abs(x);
  if (ax > 36) y += Math.pow(ax - 36, 1.3) * 0.42;
  if (z > 176) y += (z - 176) * 0.9;
  // keep the trail near the middle gentle
  y *= 0.6 + 0.4 * smooth(4, 14, ax);
  // river channel
  if (z > RIVER.z0 - 3 && z < RIVER.z1 + 3) {
    const mid = (RIVER.z0 + RIVER.z1) / 2;
    const half = (RIVER.z1 - RIVER.z0) / 2;
    const d = Math.abs(z - mid);
    const k = 1 - smooth(half - 3.5, half + 2.5, d);
    y = y * (1 - k) + RIVER.bed * k;
  }
  // gorge: drop far below (rock walls and the gorge floor are boxes)
  if (z > GORGE.z0 - 0.2 && z < GORGE.z1 + 0.2) y = GORGE.floor - 2;
  // flatten the gorge lips so the rock walls meet the ground
  else if (z > GORGE.z0 - 3 && z < GORGE.z1 + 3) y = Math.min(y, 0) * 0.3;
  return y;
}

export interface TerrainOpts {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  cell: number;
  exp: Exposure;
  color?: (x: number, y: number, z: number) => [number, number, number];
}

/** Build a ground mesh + heightfield collider over a rectangle. */
export function buildTerrain(h: SceneHandle, o: TerrainOpts) {
  const nx = Math.round((o.x1 - o.x0) / o.cell);
  const nz = Math.round((o.z1 - o.z0) / o.cell);
  const geo = new THREE.PlaneGeometry(o.x1 - o.x0, o.z1 - o.z0, nx, nz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const cx = (o.x0 + o.x1) / 2;
  const cz = (o.z0 + o.z1) / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    const y = groundY(x, z);
    pos.setY(i, y);
    uv.setXY(i, x / 4, z / 4);
    const c = o.color ? o.color(x, y, z) : [1, 1, 1];
    colors.set(c, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.translate(cx, 0, cz);
  geo.computeVertexNormals();
  const T = textures();
  const mat = standard('groundVC', o.exp, { map: T.ground.map, normalMap: T.ground.normal, normalScale: 0.8, roughness: 0.97, vertexColors: true });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.castShadow = false;
  h.group.add(m);
  // heightfield: rows along z, columns along x, column-major
  const heights = new Float32Array((nz + 1) * (nx + 1));
  for (let j = 0; j <= nx; j++) {
    for (let i = 0; i <= nz; i++) {
      const x = o.x0 + (j / nx) * (o.x1 - o.x0);
      const z = o.z0 + (i / nz) * (o.z1 - o.z0);
      heights[i + j * (nz + 1)] = groundY(x, z);
    }
  }
  h.owner.heightfield(nz, nx, heights, { x: o.x1 - o.x0, y: 1, z: o.z1 - o.z0 }, cx, cz, { kind: 'static', surface: 'grass' });
  return m;
}

/** Jungle / courtyard ground colouring. */
export function groundColor(x: number, y: number, z: number): [number, number, number] {
  const n = fbm(x * 0.1, z * 0.1);
  let r = 0.62 + n * 0.3;
  let g = 0.78 + n * 0.25;
  let b = 0.5 + n * 0.2;
  // mud near water
  if (y < -0.2) {
    const k = Math.min(1, -y / 1.5);
    r = r * (1 - k) + 0.55 * k;
    g = g * (1 - k) + 0.48 * k;
    b = b * (1 - k) + 0.38 * k;
  }
  return [r, g, b];
}

// ------------------------------------------------------------ props

/** A carved column; `broken` gives a jagged top. Adds a collider. */
export function column(h: SceneHandle, x: number, y: number, z: number, height: number, r: number, exp: Exposure, mossy = true) {
  const mat = surface(mossy ? 'templeWallMoss' : 'templeWall', exp);
  const g = new THREE.Group();
  const base = mesh(new THREE.BoxGeometry(r * 2.6, 0.4, r * 2.6), mat, 0, 0.2, 0);
  const shaft = mesh(new THREE.CylinderGeometry(r, r * 1.08, height - 0.4, 12, 3), mat, 0, 0.4 + (height - 0.4) / 2, 0);
  g.add(base, shaft);
  if (height > 4.5) {
    const cap = mesh(new THREE.BoxGeometry(r * 2.8, 0.45, r * 2.8), mat, 0, height + 0.2, 0);
    g.add(cap);
  }
  g.position.set(x, y, z);
  h.group.add(g);
  h.owner.staticCylinder(x, y + height / 2, z, height / 2, r * 1.15);
  return g;
}

/** A column lying on its side (toppled), in a few segments. */
export function toppledColumn(h: SceneHandle, x: number, y: number, z: number, len: number, r: number, yaw: number, exp: Exposure, rng: Rng) {
  const mat = surface('templeWallMoss', exp);
  const segs = Math.max(2, Math.round(len / 1.6));
  const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs - 0.5;
    const c = new THREE.Vector3(x, y + r, z).addScaledVector(dir, t * len);
    c.x += rng.range(-0.15, 0.15);
    c.z += rng.range(-0.15, 0.15);
    const sl = (len / segs) * 0.95;
    const m = mesh(new THREE.CylinderGeometry(r, r, sl, 12), mat, c.x, c.y, c.z);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6)));
    m.quaternion.copy(q);
    h.group.add(m);
    h.owner.staticBox(c.x, c.y, c.z, r * 0.9, sl / 2, r * 0.9, { kind: 'static', surface: 'stone' }, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  }
}

/** Rubble pile: a few rock chunks (static). */
export function rubble(h: SceneHandle, x: number, y: number, z: number, radius: number, n: number, exp: Exposure, rng: Rng, collide = true) {
  const mat = surface('rock', exp);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0, radius);
    const s = rng.range(0.2, 0.6) * (1 - r / (radius * 1.4));
    const m = mesh(new THREE.DodecahedronGeometry(s, 0), mat, x + Math.cos(a) * r, y + s * 0.5, z + Math.sin(a) * r);
    m.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
    m.scale.y = rng.range(0.6, 1);
    h.group.add(m);
    if (collide && s > 0.35) h.owner.staticBox(m.position.x, m.position.y, m.position.z, s * 0.7, s * 0.5, s * 0.7);
  }
}
