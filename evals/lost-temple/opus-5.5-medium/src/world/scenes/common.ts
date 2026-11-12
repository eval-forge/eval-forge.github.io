import * as THREE from 'three';
import type { Builder } from '../kit';
import { instanced, mat4, crossQuad } from '../kit';
import { materials } from '../textures';
import type { SceneChunk } from '../SceneChunk';
import { RelicSpot } from '../../entities/Loot';
import { pickRelic, Zone } from '../../logic/relics';
import { G } from '../../core/ctx';

export type Gap = { a: number; b: number; h: number };

/** Wall at constant x from z0..z1 (any order), floor y0, height h, with door gaps. */
export function wallX(b: Builder, x: number, z0: number, z1: number, y0: number, h: number, t: number, mat: THREE.Material, gaps: Gap[] = []) {
  const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
  const gs = [...gaps].sort((p, q) => Math.min(p.a, p.b) - Math.min(q.a, q.b));
  let cur = lo;
  for (const g of gs) {
    const ga = Math.min(g.a, g.b), gb = Math.max(g.a, g.b);
    if (ga > cur) b.box(t, h, ga - cur, x, y0 + h / 2, (cur + ga) / 2, mat);
    if (g.h < h) b.box(t, h - g.h, gb - ga, x, y0 + g.h + (h - g.h) / 2, (ga + gb) / 2, mat);
    cur = gb;
  }
  if (hi > cur) b.box(t, h, hi - cur, x, y0 + h / 2, (cur + hi) / 2, mat);
}

/** Wall at constant z from x0..x1, with gaps along x. */
export function wallZ(b: Builder, z: number, x0: number, x1: number, y0: number, h: number, t: number, mat: THREE.Material, gaps: Gap[] = []) {
  const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
  const gs = [...gaps].sort((p, q) => Math.min(p.a, p.b) - Math.min(q.a, q.b));
  let cur = lo;
  for (const g of gs) {
    const ga = Math.min(g.a, g.b), gb = Math.max(g.a, g.b);
    if (ga > cur) b.box(ga - cur, h, t, (cur + ga) / 2, y0 + h / 2, z, mat);
    if (g.h < h) b.box(gb - ga, h - g.h, t, (ga + gb) / 2, y0 + g.h + (h - g.h) / 2, z, mat);
    cur = gb;
  }
  if (hi > cur) b.box(hi - cur, h, t, (cur + hi) / 2, y0 + h / 2, z, mat);
}

/** Floor slab whose top is at y. */
export function slab(b: Builder, x0: number, x1: number, z0: number, z1: number, y: number, mat: THREE.Material, thick = 1, cast = false) {
  b.box(Math.abs(x1 - x0), thick, Math.abs(z1 - z0), (x0 + x1) / 2, y - thick / 2, (z0 + z1) / 2, mat, { cast });
}

/** Ceiling slab whose underside is at y. */
export function ceiling(b: Builder, x0: number, x1: number, z0: number, z1: number, y: number, mat: THREE.Material, thick = 1) {
  b.box(Math.abs(x1 - x0), thick, Math.abs(z1 - z0), (x0 + x1) / 2, y + thick / 2, (z0 + z1) / 2, mat);
}

export function pillar(b: Builder, x: number, z: number, y0: number, h: number, mat: THREE.Material, r = 0.7, broken = false) {
  b.box(r * 2.6, 0.4, r * 2.6, x, y0 + 0.2, z, mat);
  b.cyl(r, h - (broken ? 0 : 0.8), x, y0 + 0.4 + (h - (broken ? 0 : 0.8)) / 2, z, mat, { segs: 10 });
  if (!broken) b.box(r * 2.6, 0.4, r * 2.6, x, y0 + h - 0.2, z, mat);
}

/** Random loot spot (type chosen by rarity for the zone). */
export function loot(chunk: SceneChunk, zone: Zone, x: number, y: number, z: number, rnd: () => number, forced?: string): RelicSpot {
  const t = forced ?? pickRelic(zone, rnd()).id;
  return new RelicSpot(chunk, t, zone, new THREE.Vector3(x, y, z), rnd() * Math.PI * 2);
}

/** Torch / oil pickups. */
export function pickup(chunk: SceneChunk, kind: 'torch' | 'flask', x: number, y: number, z: number) {
  const m = materials();
  const g = new THREE.Group();
  if (kind === 'torch') {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.6, 6), m.wood); s.rotation.z = Math.PI / 2; s.position.y = 0.05; g.add(s);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 6), m.cloth); w.rotation.z = Math.PI / 2; w.position.set(0.3, 0.05, 0); g.add(w);
  } else {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.4 })); f.position.y = 0.12; g.add(f);
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 6), m.cloth); n.position.y = 0.28; g.add(n);
  }
  g.position.set(x, y, z);
  g.traverse((o) => (o.castShadow = true));
  g.userData.dynamic = true;
  chunk.group.add(g);
  let taken = false;
  chunk.interactables.push({
    pos: new THREE.Vector3(x, y + 0.1, z), radius: 2,
    label: () => (taken ? null : kind === 'torch' ? 'Take spare torch' : 'Take oil flask'),
    act: () => {
      taken = true; g.visible = false;
      if (kind === 'torch') { G.torch.spares++; G.toast('Spare torch +1 (place in sconces with E, or relight with R when yours burns out)'); }
      else { G.torch.flasks++; G.toast('Oil flask +1 (T to refuel)'); }
      G.audio.pickup(10);
    },
  });
}

/** Instanced jungle trees: trunk + leafy canopy. */
export function trees(chunk: SceneChunk, pts: { x: number; y: number; z: number; s: number }[], collide = true) {
  const m = materials();
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.45, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
  const tm: THREE.Matrix4[] = [], cm: THREE.Matrix4[] = [];
  for (const p of pts) {
    const h = 7 + p.s * 7;
    tm.push(mat4(p.x, p.y - 0.3, p.z, p.s * 3, 1 + p.s * 0.6, h, 1 + p.s * 0.6));
    for (let k = 0; k < 3; k++) {
      const a = p.s * 10 + k * 2.1;
      cm.push(mat4(p.x + Math.cos(a) * 1.5, p.y + h - 0.5 + k * 0.8, p.z + Math.sin(a) * 1.5, a, 2.6 + p.s * 1.5, 1.4 + p.s * 0.6, 2.6 + p.s * 1.5));
    }
    if (collide) chunk.b.statics.push({ shape: 'cyl', r: 0.4, hh: h / 2, pos: new THREE.Vector3(p.x, p.y + h / 2, p.z), quat: new THREE.Quaternion() });
  }
  chunk.group.add(instanced(trunkGeo, m.bark, tm));
  chunk.group.add(instanced(canopyGeo, m.leaves, cm));
}

export function ferns(chunk: SceneChunk, pts: { x: number; y: number; z: number; s: number }[]) {
  const geo = crossQuad(1.6, 1.2);
  chunk.group.add(instanced(geo, materials().fern, pts.map((p) => mat4(p.x, p.y, p.z, p.s * 6, 0.7 + p.s * 0.8)), false));
}

/** Hanging vines on a wall (visual) + a climb zone. */
export function vines(chunk: SceneChunk, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) {
  const m = materials();
  const n = Math.max(2, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) * 3));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    chunk.b.box(0.06, y1 - y0, 0.06, x, (y0 + y1) / 2, z, m.bark, { collide: false, cast: false });
  }
  const leafGeo = new THREE.PlaneGeometry(0.5, 0.5);
  const mats: THREE.Matrix4[] = [];
  for (let i = 0; i < n * (y1 - y0) * 1.5; i++) {
    const t = Math.random();
    mats.push(mat4(x0 + (x1 - x0) * t, y0 + Math.random() * (y1 - y0), z0 + (z1 - z0) * t, Math.random() * 6, 0.6 + Math.random() * 0.6));
  }
  chunk.group.add(instanced(leafGeo, m.leaves, mats, false));
  return new THREE.Box3(new THREE.Vector3(Math.min(x0, x1) - 0.7, y0 - 0.2, Math.min(z0, z1) - 0.7), new THREE.Vector3(Math.max(x0, x1) + 0.7, y1 + 0.6, Math.max(z0, z1) + 0.7));
}

/** Rubble scattered on the floor (decor). */
export function rubble(chunk: SceneChunk, x: number, y: number, z: number, spread: number, n: number, rnd: () => number, mat?: THREE.Material) {
  const mm = mat ?? materials().stone;
  for (let i = 0; i < n; i++) {
    const s = 0.2 + rnd() * 0.6;
    chunk.b.deco(new THREE.DodecahedronGeometry(s, 0), x + (rnd() - 0.5) * spread, y + s * 0.5, z + (rnd() - 0.5) * spread, mm, rnd() * 6, 1, true);
  }
}

/** Skeleton of an unlucky explorer (decor). */
export function skeleton(chunk: SceneChunk, x: number, y: number, z: number, rot: number) {
  const m = materials().bone;
  const g = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), m); skull.position.set(0, 0.1, 0.7);
  const ribs = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.45, 8, 1, true), m); ribs.rotation.x = Math.PI / 2; ribs.position.set(0, 0.12, 0.35);
  g.add(skull, ribs);
  for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 5), m); l.rotation.x = Math.PI / 2; l.position.set(s * 0.1, 0.04, -0.2); g.add(l); }
  g.position.set(x, y, z); g.rotation.y = rot;
  g.traverse((o) => (o.castShadow = true));
  chunk.group.add(g);
}
