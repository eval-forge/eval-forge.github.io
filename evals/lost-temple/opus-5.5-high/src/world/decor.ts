import * as THREE from 'three';
import type { LevelBuilder } from './LevelBuilder';
import type { Materials, MatKey } from './Materials';
import { RAPIER } from './Physics';
import { mulberry32 } from '../logic/rng';

/** Shared decoration helpers. All geometry is procedural. */

export function pillar(b: LevelBuilder, x: number, z: number, y: number, h: number, r = 0.8, mat: MatKey = 'sandstone', broken = false) {
  b.box(x, y + 0.3, z, r * 2.6, 0.6, r * 2.6, mat);
  const hh = broken ? h * 0.6 : h;
  const drums = Math.max(1, Math.round(hh / 1.6));
  for (let i = 0; i < drums; i++) b.cylinder(x, y + 0.6 + (i + 0.5) * ((hh - 1.2) / drums), z, r, (hh - 1.2) / drums - 0.04, mat, { seg: 12, collide: i === 0 });
  b.blocker(x - r, y, z - r, x + r, y + hh, z + r);
  if (!broken) b.box(x, y + h - 0.3, z, r * 2.8, 0.6, r * 2.8, mat);
}

/** A toppled column lying on the ground. */
export function fallenPillar(b: LevelBuilder, x: number, z: number, y: number, len: number, rotY: number, r = 0.75, mat: MatKey = 'mossy') {
  const n = Math.max(2, Math.round(len / 1.7));
  const dx = Math.sin(rotY), dz = Math.cos(rotY);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    const off = (Math.sin(i * 7.1) * 0.12);
    b.cylinder(x + dx * t * len + off, y + r, z + dz * t * len, r, len / n - 0.08, mat, { rotX: Math.PI / 2, rotY, seg: 12 });
  }
}

export function rubble(b: LevelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, count: number, seed: number, mat: MatKey = 'sandstone', maxSize = 0.9) {
  const rand = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const s = 0.25 + rand() * maxSize;
    b.box(x0 + rand() * (x1 - x0), y + s * 0.35, z0 + rand() * (z1 - z0), s * (0.8 + rand() * 0.8), s * 0.7, s * (0.8 + rand() * 0.6), mat, { rotY: rand() * 3, rotX: (rand() - 0.5) * 0.4, rotZ: (rand() - 0.5) * 0.4, collide: s > 0.6 });
  }
}

/** Stylised guardian-like statue. */
export function statue(b: LevelBuilder, x: number, z: number, y: number, rotY: number, mat: MatKey = 'sandstone', scale = 1) {
  const s = scale;
  b.box(x, y + 0.5 * s, z, 1.6 * s, 1 * s, 1.6 * s, mat, { rotY });
  b.box(x, y + 2.0 * s, z, 1.0 * s, 2.0 * s, 0.7 * s, mat, { rotY });
  b.box(x, y + 3.4 * s, z, 0.8 * s, 0.8 * s, 0.75 * s, mat, { rotY });
  const ox = Math.cos(rotY), oz = -Math.sin(rotY);
  b.box(x + ox * 0.7 * s, y + 2.2 * s, z + oz * 0.7 * s, 0.35 * s, 1.6 * s, 0.35 * s, mat, { rotY });
  b.box(x - ox * 0.7 * s, y + 2.2 * s, z - oz * 0.7 * s, 0.35 * s, 1.6 * s, 0.35 * s, mat, { rotY });
}

export function skullPile(b: LevelBuilder, x: number, z: number, y: number, seed: number) {
  const rand = mulberry32(seed);
  const g = new THREE.SphereGeometry(0.11, 6, 5);
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const c = g.clone();
    c.translate(x + (rand() - 0.5) * 0.7, y + 0.1 + rand() * 0.25, z + (rand() - 0.5) * 0.7);
    geos.push(c);
  }
  for (const c of geos) b.geometry(c, 'bone', { cast: false });
}

/** Wall niches with skulls (ossuary walls). */
export function ossuaryWall(b: LevelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, rows: number, seed: number) {
  const rand = mulberry32(seed);
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.floor(len / 0.5);
  for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) {
    if (rand() < 0.35) continue;
    const t = (i + 0.5) / n;
    const g = new THREE.SphereGeometry(0.12, 6, 5);
    g.scale(1, 0.9, 1.1);
    g.translate(x0 + (x1 - x0) * t, y + 0.4 + r * 0.45, z0 + (z1 - z0) * t);
    b.geometry(g, 'bone', { cast: false });
  }
}

export function spikes(b: LevelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, mat: MatKey = 'iron') {
  const geos: THREE.BufferGeometry[] = [];
  for (let x = x0 + 0.4; x < x1; x += 0.8) for (let z = z0 + 0.4; z < z1; z += 0.8) {
    const c = new THREE.ConeGeometry(0.09, 0.9, 5);
    c.translate(x + Math.sin(z * 3) * 0.15, y + 0.45, z + Math.cos(x * 3) * 0.15);
    geos.push(c);
  }
  for (const g of geos) b.geometry(g, mat, { cast: false });
}

/** Wall sconce bracket (visual only; the light is a separate pooled light). */
export function sconceMesh(b: LevelBuilder, p: THREE.Vector3, normal: THREE.Vector3) {
  const back = p.clone().addScaledVector(normal, -0.18);
  b.box(back.x, p.y - 0.15, back.z, 0.25, 0.35, 0.25, 'iron', { collide: false, cast: false });
  b.cylinder(p.x, p.y - 0.05, p.z, 0.09, 0.14, 'iron', { collide: false, r2: 0.14, seg: 8, cast: false });
}

// ------------------------------------------------------------------ vegetation (instanced)
export interface TreeSet { group: THREE.Group; colliders: { x: number; z: number; y: number; r: number; h: number }[] }

/** Instanced jungle trees + canopy cards + ferns. `ground(x,z)` gives terrain height. */
export function jungleTrees(mats: Materials, spots: { x: number; z: number; s: number }[], ground: (x: number, z: number) => number, ferns: { x: number; z: number; s: number }[], seed = 3): TreeSet {
  const rand = mulberry32(seed);
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.42, 1, 7, 1);
  trunkGeo.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, mats.get('bark'), spots.length);
  const cardsPer = 7;
  const cardGeo = new THREE.PlaneGeometry(1, 1);
  const cards = new THREE.InstancedMesh(cardGeo, mats.get('leaves'), spots.length * cardsPer);
  const cards2 = new THREE.InstancedMesh(cardGeo, mats.get('leaves2'), spots.length * 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const colliders: TreeSet['colliders'] = [];
  let ci = 0, ci2 = 0;
  spots.forEach((t, i) => {
    const y = ground(t.x, t.z);
    const h = 9 + t.s * 9;
    const r = 0.5 + t.s * 0.4;
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.12, rand() * 6, (rand() - 0.5) * 0.12));
    m.compose(p.set(t.x, y - 0.3, t.z), q, s.set(r * 2, h, r * 2));
    trunks.setMatrixAt(i, m);
    colliders.push({ x: t.x, z: t.z, y, r: r * 0.42 * 2, h });
    for (let k = 0; k < cardsPer; k++) {
      const a = rand() * Math.PI * 2, d = rand() * 2.5;
      const cs = 3.5 + rand() * 3 + t.s * 2;
      q.setFromEuler(new THREE.Euler(-Math.PI / 2 + (rand() - 0.5) * 0.9, 0, rand() * 6));
      m.compose(p.set(t.x + Math.cos(a) * d, y + h - 1 + rand() * 2.5, t.z + Math.sin(a) * d), q, s.set(cs, cs, cs));
      cards.setMatrixAt(ci++, m);
    }
    for (let k = 0; k < 3; k++) {
      q.setFromEuler(new THREE.Euler(0, rand() * 6, 0));
      const cs = 2.5 + rand() * 2;
      m.compose(p.set(t.x + (rand() - 0.5) * 2, y + h * (0.45 + rand() * 0.3), t.z + (rand() - 0.5) * 2), q, s.set(cs, cs, cs));
      cards2.setMatrixAt(ci2++, m);
    }
  });
  trunks.castShadow = true; trunks.receiveShadow = true;
  cards.castShadow = true; cards.receiveShadow = true;
  cards2.castShadow = true;
  group.add(trunks, cards, cards2);
  // ferns: crossed quads
  if (ferns.length) {
    const fg = new THREE.PlaneGeometry(1, 1);
    fg.translate(0, 0.5, 0);
    const fernMesh = new THREE.InstancedMesh(fg, mats.get('fern'), ferns.length * 2);
    let fi = 0;
    for (const f of ferns) {
      const y = ground(f.x, f.z);
      const sc = 1 + f.s * 1.6;
      for (let k = 0; k < 2; k++) {
        q.setFromEuler(new THREE.Euler(0, k * Math.PI / 2 + f.s * 3, 0));
        m.compose(p.set(f.x, y - 0.05, f.z), q, s.set(sc * 1.4, sc, sc));
        fernMesh.setMatrixAt(fi++, m);
      }
    }
    fernMesh.receiveShadow = true;
    group.add(fernMesh);
  }
  return { group, colliders };
}

export function treeColliders(b: LevelBuilder, set: TreeSet) {
  for (const c of set.colliders) {
    b.colliders.push({ kind: 'static', make: () => RAPIER.ColliderDesc.cylinder(c.h / 2, Math.max(0.25, c.r)).setTranslation(c.x, c.y + c.h / 2, c.z) });
  }
}

/** Hanging vine strands (visual). */
export function hangingVines(b: LevelBuilder, x0: number, z0: number, x1: number, z1: number, top: number, count: number, seed: number) {
  const rand = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0);
    const len = 2 + rand() * 5;
    const g = new THREE.PlaneGeometry(0.6, len);
    g.rotateY(rand() * Math.PI);
    g.translate(x, top - len / 2, z);
    b.geometry(g, 'vines', { cast: false });
  }
}

export type Side = 'n' | 's' | 'e' | 'w';
/**
 * A rectangular room: floor, ceiling and 1 m walls around the footprint.
 * Openings are full-height gaps on a side, given as [from, to] along that side.
 * n = min z, s = max z, w = min x, e = max x.
 */
export function room(b: LevelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, wall: MatKey, floor: MatKey | null, openings: [Side, number, number][] = [], ceiling = true) {
  if (floor) b.floor(x0, z0, x1, z1, y, floor);
  if (ceiling) b.ceiling(x0 - 1, z0 - 1, x1 + 1, z1 + 1, y + h, wall);
  const gaps = (s: Side) => openings.filter((o) => o[0] === s).map((o) => [o[1], o[2], y + h] as [number, number, number]);
  const open = (s: Side) => openings.some((o) => o[0] === s && o[1] < -1e8);
  if (!open('n')) b.wallZ(z0 - 0.5, x0 - 1, x1 + 1, y, y + h, wall, 1, gaps('n'));
  if (!open('s')) b.wallZ(z1 + 0.5, x0 - 1, x1 + 1, y, y + h, wall, 1, gaps('s'));
  if (!open('w')) b.wallX(x0 - 0.5, z0, z1, y, y + h, wall, 1, gaps('w'));
  if (!open('e')) b.wallX(x1 + 0.5, z0, z1, y, y + h, wall, 1, gaps('e'));
}

export const ALL = [-1e9, 1e9] as const;
