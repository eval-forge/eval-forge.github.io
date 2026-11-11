import * as THREE from 'three';
import type { RelicType } from '../core/economy';
import { Rng } from '../core/rng';
import type { SceneBuilder } from '../engine/builder';
import type { Gate, MatName, Materials } from '../engine/materials';

// ---------------------------------------------------------------------------------------------
// Relic meshes: every relic type is modelled from primitives.
// ---------------------------------------------------------------------------------------------

export function makeRelicMesh(r: RelicType, mats: Materials, gate: Gate = 'sky'): THREE.Group {
  const S = (c: number, rough = 0.6, metal = 0) => mats.solid(c, rough, Math.min(metal, 0.45), 0, gate);
  const g = new THREE.Group();
  const metal = ['gem', 'mirror', 'idol', 'sceptre', 'ingot', 'disc', 'crown', 'serpent'].includes(r.shape);
  // Metalness is kept moderate: there is no environment map (it would be ambient light underground).
  const main = S(r.color, metal ? 0.32 : 0.7, metal ? 0.45 : 0.05);
  const dark = S(0x1a1612, 0.9);
  const ruby = S(0xb01828, 0.2, 0.3);
  const teal = S(0x2aa6a0, 0.25, 0.3);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  };
  const sph = (rad: number, d = 8) => new THREE.SphereGeometry(rad, d, Math.max(4, d - 2));
  const cyl = (a: number, b: number, h: number, s = 10) => new THREE.CylinderGeometry(a, b, h, s);
  const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

  switch (r.shape) {
    case 'figurine':
      add(cyl(0.05, 0.08, 0.2), main, 0, 0.1); add(sph(0.06), main, 0, 0.25); add(box(0.22, 0.04, 0.05), main, 0, 0.16);
      add(box(0.12, 0.03, 0.07), main, 0, 0.32);
      break;
    case 'pouch':
      add(sph(0.11), main, 0, 0.09, 0, 0, 0, 0, 1, 0.82, 1); add(cyl(0.035, 0.05, 0.06), main, 0, 0.19);
      add(new THREE.TorusGeometry(0.045, 0.012, 5, 10), S(0xc8a878, 0.9), 0, 0.17, 0, Math.PI / 2);
      add(cyl(0.03, 0.03, 0.008, 10), S(0xc88a3a, 0.4, 0.8), 0.13, 0.01, 0.04); add(cyl(0.03, 0.03, 0.008, 10), S(0xc88a3a, 0.4, 0.8), 0.1, 0.01, -0.08);
      break;
    case 'flute':
      add(cyl(0.018, 0.022, 0.42, 8), main, 0, 0.03, 0, 0, 0, Math.PI / 2);
      for (let i = 0; i < 4; i++) add(cyl(0.008, 0.008, 0.05, 6), dark, -0.1 + i * 0.06, 0.035, 0);
      add(cyl(0.026, 0.026, 0.03, 8), S(0x8a3a2a, 0.8), 0.2, 0.03, 0, 0, 0, Math.PI / 2);
      break;
    case 'frog':
      add(sph(0.11), main, 0, 0.07, 0, 0, 0, 0, 1.15, 0.62, 1.3); add(sph(0.03), main, 0.05, 0.14, 0.09); add(sph(0.03), main, -0.05, 0.14, 0.09);
      add(sph(0.012), dark, 0.05, 0.15, 0.115); add(sph(0.012), dark, -0.05, 0.15, 0.115);
      for (const s of [-1, 1]) { add(box(0.06, 0.04, 0.12), main, s * 0.13, 0.03, -0.04, 0, s * 0.5, 0); add(box(0.04, 0.03, 0.07), main, s * 0.1, 0.02, 0.11); }
      break;
    case 'mask':
      add(sph(0.16, 10), main, 0, 0.18, 0, 0, 0, 0, 1, 1.25, 0.42);
      add(box(0.07, 0.03, 0.05), dark, 0.06, 0.22, 0.06); add(box(0.07, 0.03, 0.05), dark, -0.06, 0.22, 0.06);
      add(box(0.12, 0.035, 0.05), dark, 0, 0.09, 0.05); add(box(0.035, 0.09, 0.07), main, 0, 0.16, 0.07);
      for (let i = -2; i <= 2; i++) add(new THREE.ConeGeometry(0.025, 0.16, 5), i % 2 ? teal : ruby, i * 0.06, 0.42 - Math.abs(i) * 0.02, 0, 0, 0, -i * 0.22);
      break;
    case 'gem':
      add(new THREE.OctahedronGeometry(0.1, 0), S(r.color, 0.05, 0.4), 0, 0.14, 0, 0, 0.4, 0, 1, 1.35, 1);
      add(cyl(0.05, 0.07, 0.03, 8), S(0x3a3a3a, 0.8), 0, 0.015);
      break;
    case 'scroll':
      add(cyl(0.035, 0.035, 0.34, 10), main, 0, 0.04, 0, 0, 0, Math.PI / 2);
      for (const s of [-1, 1]) add(cyl(0.02, 0.02, 0.06, 8), S(0x7a2a1e, 0.6), s * 0.19, 0.04, 0, 0, 0, Math.PI / 2);
      add(box(0.02, 0.075, 0.075), ruby, 0, 0.04, 0);
      break;
    case 'mirror':
      add(cyl(0.15, 0.15, 0.025, 20), S(r.color, 0.08, 1), 0, 0.3, 0, Math.PI / 2);
      add(new THREE.TorusGeometry(0.15, 0.022, 6, 20), S(0x9a8050, 0.4, 0.8), 0, 0.3, 0);
      add(cyl(0.02, 0.028, 0.16, 8), S(0x9a8050, 0.4, 0.8), 0, 0.08);
      break;
    case 'skull':
      add(sph(0.12, 10), main, 0, 0.16, 0, 0, 0, 0, 1, 1, 1.15); add(box(0.14, 0.07, 0.12), main, 0, 0.05, 0.03);
      add(sph(0.035), dark, 0.05, 0.16, 0.115); add(sph(0.035), dark, -0.05, 0.16, 0.115); add(box(0.03, 0.04, 0.03), dark, 0, 0.1, 0.13);
      break;
    case 'urn': {
      const pts = [[0.06, 0], [0.13, 0.06], [0.16, 0.18], [0.12, 0.3], [0.06, 0.34], [0.08, 0.4]].map(([x, y]) => new THREE.Vector2(x, y));
      add(new THREE.LatheGeometry(pts, 14), main);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add(sph(0.022, 6), i % 2 ? ruby : teal, Math.cos(a) * 0.16, 0.18, Math.sin(a) * 0.16); }
      add(cyl(0.065, 0.065, 0.03, 12), S(0xd0a030, 0.4, 0.8), 0, 0.41);
      break;
    }
    case 'idol':
      add(box(0.3, 0.06, 0.3), main, 0, 0.03); add(box(0.2, 0.22, 0.24), main, 0, 0.17); add(box(0.18, 0.15, 0.18), main, 0, 0.36, 0.04);
      for (const s of [-1, 1]) { add(new THREE.ConeGeometry(0.035, 0.07, 4), main, s * 0.07, 0.47, 0.04); add(box(0.06, 0.16, 0.09), main, s * 0.1, 0.14, 0.14); add(sph(0.022, 6), S(0x20c070, 0.2, 0.4), s * 0.045, 0.385, 0.135); }
      add(box(0.1, 0.05, 0.06), main, 0, 0.33, 0.15);
      break;
    case 'dagger':
      add(new THREE.ConeGeometry(0.04, 0.3, 4), main, 0, 0.02, 0.1, Math.PI / 2, 0, 0, 1, 1, 0.35);
      add(box(0.13, 0.025, 0.03), S(0xc8a040, 0.4, 0.8), 0, 0.02, -0.06); add(cyl(0.018, 0.018, 0.12, 6), S(0x5a3a22, 0.9), 0, 0.02, -0.13, Math.PI / 2);
      break;
    case 'serpent':
      for (let i = 0; i < 3; i++) add(new THREE.TorusGeometry(0.12 - i * 0.025, 0.035, 6, 14), main, 0, 0.035 + i * 0.065, 0, Math.PI / 2);
      add(sph(0.05), main, 0.02, 0.27, 0.03, 0, 0, 0, 1, 0.8, 1.4); add(sph(0.014, 6), ruby, 0.045, 0.285, 0.075); add(sph(0.014, 6), ruby, -0.005, 0.285, 0.075);
      break;
    case 'sceptre':
      add(cyl(0.02, 0.025, 0.6, 8), main, 0, 0.04, 0, 0, 0, Math.PI / 2); add(sph(0.06), teal, 0.33, 0.06, 0);
      add(new THREE.TorusGeometry(0.06, 0.014, 5, 12), main, 0.33, 0.06, 0, Math.PI / 2); add(sph(0.03), main, -0.31, 0.04, 0);
      break;
    case 'ingot': {
      const geo = box(0.3, 0.09, 0.15);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * 0.82, p.getY(i), p.getZ(i) * 0.72);
      geo.computeVertexNormals();
      add(geo, main, 0, 0.045);
      break;
    }
    case 'disc':
      add(cyl(0.3, 0.3, 0.05, 24), main, 0, 0.3, 0, Math.PI / 2); add(cyl(0.09, 0.09, 0.07, 14), S(0xfff0a0, 0.25, 0.9), 0, 0.3, 0, Math.PI / 2);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; add(box(0.03, 0.09, 0.065), S(0xb88818, 0.4, 0.8), Math.cos(a) * 0.21, 0.3 + Math.sin(a) * 0.21, 0, 0, 0, a + Math.PI / 2); }
      break;
    case 'crown':
      (add(new THREE.CylinderGeometry(0.13, 0.12, 0.09, 16, 1, true), S(r.color, 0.25, 0.9), 0, 0.045).material as THREE.Material).side = THREE.DoubleSide;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.028, 0.12, 4), main, Math.cos(a) * 0.125, 0.14, Math.sin(a) * 0.125);
        add(sph(0.016, 6), i % 2 ? ruby : teal, Math.cos(a) * 0.132, 0.05, Math.sin(a) * 0.132);
      }
      break;
  }
  // Heavier things are bigger.
  const s = 0.9 + 0.13 * Math.cbrt(r.weight);
  g.scale.setScalar(s);
  // Recentre so the origin is the middle of the model (physics props rotate about it).
  const bb = new THREE.Box3().setFromObject(g);
  const c = bb.getCenter(new THREE.Vector3()).divideScalar(s);
  for (const ch of g.children) ch.position.sub(c);
  g.userData.halfHeight = (bb.max.y - bb.min.y) / 2;
  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}

// ---------------------------------------------------------------------------------------------
// Architecture bits
// ---------------------------------------------------------------------------------------------

/** Round column with a square base and capital. */
export function pillar(b: SceneBuilder, mat: MatName, x: number, z: number, y: number, h: number, r = 0.55): void {
  b.box(mat, x - r * 1.35, y, z - r * 1.35, x + r * 1.35, y + 0.4, z + r * 1.35);
  b.cyl(mat, x, y + h / 2, z, r, h - 0.8, { segs: 10 });
  b.box(mat, x - r * 1.4, y + h - 0.45, z - r * 1.4, x + r * 1.4, y + h, z + r * 1.4, { collide: false });
}

/** A column lying on its side, in drums. */
export function toppledPillar(b: SceneBuilder, mat: MatName, x: number, y: number, z: number, yaw: number, len: number, r = 0.55): void {
  const drums = Math.max(2, Math.round(len / 1.6));
  const dl = len / drums;
  for (let i = 0; i < drums; i++) {
    const t = (i + 0.5) * dl - len / 2;
    const gap = i * 0.07;
    const px = x + Math.sin(yaw) * (t + gap), pz = z + Math.cos(yaw) * (t + gap);
    b.cyl(mat, px, y + r - 0.03, pz, r, dl - 0.06, { rot: [Math.PI / 2, yaw + (i % 2 ? 0.05 : -0.04), 0], segs: 10 });
  }
}

/** Relic pedestal. Trapped ones carry a gold pressure ring so the player can read the danger. */
export function pedestal(b: SceneBuilder, x: number, y: number, z: number, h: number, trapped: boolean): void {
  b.box('glyph', x - 0.42, y, z - 0.42, x + 0.42, y + 0.18, z + 0.42);
  b.box('stone', x - 0.3, y + 0.18, z - 0.3, x + 0.3, y + h - 0.12, z + 0.3);
  b.box('glyph', x - 0.4, y + h - 0.12, z - 0.4, x + 0.4, y + h, z + 0.4);
  if (trapped) {
    b.cyl('gold', x, y + h + 0.015, z, 0.3, 0.03, { segs: 16, collide: false, shadow: false });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.obox('iron', x + Math.cos(a) * 0.36, y + h + 0.02, z + Math.sin(a) * 0.36, 0.08, 0.05, 0.08, null, { collide: false, shadow: false });
    }
  }
}

/** A heap of broken masonry. */
export function rubblePile(b: SceneBuilder, x: number, y: number, z: number, radius: number, height: number, seed: number, mat: MatName = 'rubble'): void {
  const rng = new Rng(seed);
  const n = Math.round(8 + radius * 5);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * radius;
    const s = rng.range(0.35, 0.95) * (1 - d / radius * 0.45);
    const hh = height * (1 - d / radius) * rng.range(0.5, 1);
    b.obox(mat, x + Math.cos(a) * d, y + hh + s * 0.25, z + Math.sin(a) * d, s, s * rng.range(0.5, 0.9), s * rng.range(0.6, 1.2),
      [rng.range(-0.5, 0.5), rng.range(0, 3), rng.range(-0.5, 0.5)], { collide: false });
  }
  // One simple hull so it behaves like a mound.
  b.obox(mat, x, y + height * 0.35, z, radius * 1.3, height * 0.7, radius * 1.3, null, { tint: 0.8 });
}

/** Bones and a skull or two in a heap. Purely decorative. */
export function bonePile(b: SceneBuilder, x: number, y: number, z: number, seed: number): void {
  const rng = new Rng(seed);
  for (let i = 0; i < 7; i++) {
    b.obox('bone', x + rng.range(-0.4, 0.4), y + 0.04, z + rng.range(-0.4, 0.4), rng.range(0.3, 0.55), 0.05, 0.05, [0, rng.range(0, 3), rng.range(-0.2, 0.2)], { collide: false, shadow: false });
  }
  const g = new THREE.SphereGeometry(0.11, 8, 6);
  b.geom('bone', g, new THREE.Matrix4().makeTranslation(x + rng.range(-0.2, 0.2), y + 0.1, z + rng.range(-0.2, 0.2)), { shadow: false });
  g.dispose();
}

/** A blocky guardian statue used as architecture (the real dormant guardians are entities). */
export function statue(b: SceneBuilder, mat: MatName, x: number, y: number, z: number, yaw: number, scale = 1): void {
  const o = (dx: number, dy: number, dz: number, sx: number, sy: number, sz: number) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    b.obox(mat, x + (dx * c + dz * s) * scale, y + dy * scale, z + (-dx * s + dz * c) * scale, sx * scale, sy * scale, sz * scale, [0, yaw, 0], { collide: false });
  };
  o(0, 0.25, 0, 1.5, 0.5, 1.5); o(0, 1.4, 0, 1.0, 1.8, 0.7); o(0, 2.75, 0.05, 0.75, 0.75, 0.7);
  o(-0.75, 1.5, 0.1, 0.38, 1.5, 0.45); o(0.75, 1.5, 0.1, 0.38, 1.5, 0.45); o(0, 3.25, 0, 1.1, 0.25, 0.9);
  b.blocker(x - 0.8 * scale, y, z - 0.8 * scale, x + 0.8 * scale, y + 3.4 * scale, z + 0.8 * scale);
}

// ---------------------------------------------------------------------------------------------
// Vegetation geometry (instanced by the scenes)
// ---------------------------------------------------------------------------------------------

/** Two crossed quads standing on the ground: the classic foliage card. */
export function crossCard(w: number, h: number, planes = 2): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let p = 0; p < planes; p++) {
    const a = (p / planes) * Math.PI;
    const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
    const base = pos.length / 3;
    pos.push(-dx, 0, -dz, dx, 0, dz, dx, h, dz, -dx, h, -dz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    // Normals point up so cards are lit like the ground they stand on rather than going black edge-on.
    for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Lumpy low-poly canopy: a few displaced blobs merged into one geometry. */
export function canopyGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const blobs = 4;
  for (let i = 0; i < blobs; i++) {
    const g = new THREE.IcosahedronGeometry(rng.range(1.5, 2.3), 1);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const n = 0.82 + ((Math.sin(p.getX(k) * 3.1 + i) + Math.sin(p.getY(k) * 2.7) + Math.sin(p.getZ(k) * 3.7)) / 3) * 0.25;
      p.setXYZ(k, p.getX(k) * n, p.getY(k) * n * 0.7, p.getZ(k) * n);
    }
    const a = (i / blobs) * Math.PI * 2;
    g.translate(Math.cos(a) * rng.range(0.6, 1.6), rng.range(-0.4, 0.9), Math.sin(a) * rng.range(0.6, 1.6));
    parts.push(g);
  }
  const merged = mergeGeoms(parts);
  merged.computeVertexNormals();
  // Darker underneath.
  const p = merged.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const k = 0.55 + Math.min(1, Math.max(0, (p.getY(i) + 1.2) / 2.6)) * 0.55; col[i * 3] = k * 0.85; col[i * 3 + 1] = k; col[i * 3 + 2] = k * 0.8; }
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  parts.forEach((g) => g.dispose());
  return merged;
}

export function mergeGeoms(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const src of parts) {
    const g = src.index ? src.toNonIndexed() : src;
    const base = pos.length / 3;
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (n) nor.push(n.getX(i), n.getY(i), n.getZ(i)); else nor.push(0, 1, 0);
      if (u) uv.push(u.getX(i), u.getY(i)); else uv.push(0, 0);
      idx.push(base + i);
    }
    if (g !== src) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** Small props used as pickups. */
export function flaskMesh(mats: Materials): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mats.solid(0x7a4a26, 0.6));
  body.scale.set(1, 1.15, 1); body.position.y = 0.12;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.09, 8), mats.solid(0x7a4a26, 0.6));
  neck.position.y = 0.28;
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8), mats.solid(0xc8a878, 1));
  cork.position.y = 0.34;
  g.add(body, neck, cork);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

export function torchMesh(mats: Materials): THREE.Group {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.6, 6), mats.solid(0x5a3a22, 0.9));
  stick.rotation.z = Math.PI / 2 - 0.2; stick.position.y = 0.08;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.16, 8), mats.solid(0x2a2018, 1));
  head.rotation.z = Math.PI / 2 - 0.2; head.position.set(0.3, 0.14, 0);
  g.add(stick, head);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

export function sunDiscMesh(mats: Materials): THREE.Group {
  const g = new THREE.Group();
  const gold = mats.solid(0xe8b020, 0.3, 0.9);
  const d = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 20), gold);
  g.add(d);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const ray = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 4), gold);
    ray.position.set(Math.cos(a) * 0.27, 0, Math.sin(a) * 0.27);
    ray.rotation.set(Math.PI / 2, 0, 0); ray.rotation.y = 0;
    ray.lookAt(Math.cos(a) * 2, 0, Math.sin(a) * 2); ray.rotateX(Math.PI / 2);
    g.add(ray);
  }
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

export function keyMesh(mats: Materials): THREE.Group {
  const g = new THREE.Group();
  const jade = mats.solid(0x2f9a6a, 0.3, 0.3);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), jade); shaft.rotation.z = Math.PI / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 6, 12), jade); ring.position.x = -0.2;
  const bit1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.02), jade); bit1.position.set(0.12, -0.04, 0);
  const bit2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.02), jade); bit2.position.set(0.07, -0.03, 0);
  g.add(shaft, ring, bit1, bit2);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}
