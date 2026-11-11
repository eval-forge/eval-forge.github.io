/**
 * Instanced vegetation (trees, palms, ferns, grass, hanging vines) and water surfaces.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { textures } from '../engine/textures';
import { standard, applySkyMask, type Exposure, surface } from '../engine/materials';

export const VEG_LAYER = 1;

export interface ScatterOpts {
  count: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** return ground height or null to reject */
  ground: (x: number, z: number) => number | null;
  rng: Rng;
  minScale?: number;
  maxScale?: number;
}

function scatter(o: ScatterOpts): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let tries = 0;
  while (out.length < o.count && tries < o.count * 8) {
    tries++;
    const x = o.rng.range(o.x0, o.x1);
    const z = o.rng.range(o.z0, o.z1);
    const y = o.ground(x, z);
    if (y === null) continue;
    const s = o.rng.range(o.minScale ?? 0.8, o.maxScale ?? 1.25);
    e.set(o.rng.range(-0.06, 0.06), o.rng.range(0, Math.PI * 2), o.rng.range(-0.06, 0.06));
    q.setFromEuler(e);
    out.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)));
  }
  return out;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], cast: boolean, colors?: THREE.Color[]): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  im.count = mats.length;
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  if (colors) colors.forEach((c, i) => im.setColorAt(i, c));
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = cast;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  // layer 1: seen by the main camera and the sun's shadow camera, but not by the torch's
  // 6-face point-light shadow (vegetation there is all cost, little benefit)
  im.layers.set(VEG_LAYER);
  return im;
}

// ------------------------------------------------------------ geometries (shared)

let geoCache: Record<string, THREE.BufferGeometry> | null = null;

function geos() {
  if (geoCache) return geoCache;
  const trunk = new THREE.CylinderGeometry(0.22, 0.42, 7, 7, 3);
  trunk.translate(0, 3.5, 0);
  jitter(trunk, 0.06, 1);

  // canopy: three blobs
  const blobs: THREE.BufferGeometry[] = [];
  const r = new Rng(5);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.IcosahedronGeometry(r.range(1.8, 2.6), 1);
    jitter(b, 0.35, i + 3);
    b.scale(1, 0.7, 1);
    b.translate(r.range(-1.3, 1.3), 7 + r.range(-0.5, 1.2), r.range(-1.3, 1.3));
    blobs.push(b.index ? b.toNonIndexed() : b);
  }
  const canopy = mergeNonIndexed(blobs);
  canopy.computeVertexNormals();

  // palm: curved trunk from segments
  const palmTrunk = curvedTrunk();
  const frond = new THREE.PlaneGeometry(1.4, 4.2, 1, 4);
  frond.translate(0, 2.1, 0);
  // bend the frond downward
  const fp = frond.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < fp.count; i++) {
    const y = fp.getY(i);
    fp.setZ(i, -0.12 * y * y);
  }
  frond.computeVertexNormals();
  const fronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const g = frond.clone();
    g.rotateX(-Math.PI * 0.36);
    g.rotateY((i / 8) * Math.PI * 2);
    g.translate(0.9, 6.9, 0.25);
    fronds.push(g);
  }
  const palmCrown = mergeNonIndexed(fronds.map((g) => g.toNonIndexed()));

  // crossed cards
  const cross = (w: number, h: number, n: number) => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const p = new THREE.PlaneGeometry(w, h);
      p.translate(0, h / 2, 0);
      p.rotateY((i / n) * Math.PI);
      parts.push(p.toNonIndexed());
    }
    return mergeNonIndexed(parts);
  };
  const fern = cross(2.2, 1.6, 3);
  const grass = cross(1.1, 0.7, 2);
  const vine = new THREE.PlaneGeometry(0.5, 1, 1, 6);
  vine.translate(0, -0.5, 0);
  geoCache = { trunk, canopy, palmTrunk, palmCrown, fern, grass, vine };
  for (const g of Object.values(geoCache)) (g as any).userData.shared = true;
  return geoCache;
}

function curvedTrunk(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector3(Math.sin(t * 1.4) * 0.9, t * 7, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, 10, 0.2, 6, false);
}

function jitter(g: THREE.BufferGeometry, amt: number, seed: number) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const r = new Rng(seed);
  const map = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let o = map.get(k);
    if (!o) map.set(k, (o = [r.range(-amt, amt), r.range(-amt, amt), r.range(-amt, amt)]));
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  g.computeVertexNormals();
}

function mergeNonIndexed(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const g of list) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of list) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    const u = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    for (let i = 0; i < p.count; i++) {
      pos[(o + i) * 3] = p.getX(i);
      pos[(o + i) * 3 + 1] = p.getY(i);
      pos[(o + i) * 3 + 2] = p.getZ(i);
      nor[(o + i) * 3] = n.getX(i);
      nor[(o + i) * 3 + 1] = n.getY(i);
      nor[(o + i) * 3 + 2] = n.getZ(i);
      if (u) {
        uv[(o + i) * 2] = u.getX(i);
        uv[(o + i) * 2 + 1] = u.getY(i);
      }
    }
    o += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ------------------------------------------------------------ materials

function leafMat(exp: Exposure) {
  return standard('leafCanopy', exp, { color: 0xffffff, roughness: 0.85, flatShading: true });
}

function cardMat(kind: 'leaves' | 'palm' | 'grass', exp: Exposure) {
  const T = textures();
  const map = kind === 'leaves' ? T.leaves : kind === 'palm' ? T.palm : T.grass;
  return standard(`card-${kind}`, exp, { map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 });
}

// ------------------------------------------------------------ public builders

export interface VegetationArea {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  ground: (x: number, z: number) => number | null;
  trees: number;
  palms: number;
  ferns: number;
  grass: number;
  seed: number;
  exposure?: Exposure;
}

export function buildVegetation(group: THREE.Group, a: VegetationArea, density: number) {
  const G = geos();
  const exp = a.exposure ?? 'outdoor';
  const rng = new Rng(a.seed);
  const base = { x0: a.x0, x1: a.x1, z0: a.z0, z1: a.z1, ground: a.ground, rng };
  const trees = scatter({ ...base, count: Math.round(a.trees * density), minScale: 0.8, maxScale: 1.5 });
  if (trees.length) {
    group.add(instanced(G.trunk, surface('bark', exp), trees, true));
    const cols = trees.map(() => new THREE.Color().setHSL(0.25 + rng.range(-0.04, 0.05), 0.5 + rng.range(-0.1, 0.1), 0.24 + rng.range(-0.05, 0.06)));
    group.add(instanced(G.canopy, leafMat(exp), trees, true, cols));
  }
  const palms = scatter({ ...base, count: Math.round(a.palms * density), minScale: 0.8, maxScale: 1.3 });
  if (palms.length) {
    group.add(instanced(G.palmTrunk, surface('bark', exp), palms, true));
    group.add(instanced(G.palmCrown, cardMat('palm', exp), palms, true));
  }
  const ferns = scatter({ ...base, count: Math.round(a.ferns * density), minScale: 0.6, maxScale: 1.4 });
  if (ferns.length) group.add(instanced(G.fern, cardMat('leaves', exp), ferns, false));
  const grass = scatter({ ...base, count: Math.round(a.grass * density), minScale: 0.6, maxScale: 1.3 });
  if (grass.length) group.add(instanced(G.grass, cardMat('grass', exp), grass, false));
}

/** Hanging vines along a line (decorative, e.g. on the temple facade). */
export function hangingVines(group: THREE.Group, pts: { x: number; y: number; z: number; len: number }[], exp: Exposure) {
  const G = geos();
  const mats = pts.map((p) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(), new THREE.Vector3(1, p.len, 1)));
  group.add(instanced(G.vine, cardMat('leaves', exp), mats, false));
}

/** A climbable vine wall visual: a dense sheet of leaf cards over an area. */
export function vineSheet(group: THREE.Group, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, n: [number, number], exp: Exposure, seed: number) {
  const rng = new Rng(seed);
  const mats: THREE.Matrix4[] = [];
  const w = Math.max(x1 - x0, z1 - z0);
  const count = Math.ceil(w * (y1 - y0) * 1.6);
  const facing = Math.atan2(n[0], n[1]);
  for (let i = 0; i < count; i++) {
    const t = rng.next();
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    const y = rng.range(y0, y1);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facing + rng.range(-0.3, 0.3), rng.range(-0.4, 0.4)));
    // push the card slightly off the wall along its normal
    const px = x - n[0] * 0.5 + n[0] * rng.range(0.05, 0.2);
    const pz = z - n[1] * 0.5 + n[1] * rng.range(0.05, 0.2);
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(px, y, pz), q, new THREE.Vector3(0.9, 0.9, 0.9)));
  }
  const geo = new THREE.PlaneGeometry(1.1, 1.1);
  const im = instanced(geo, cardMat('leaves', exp), mats, false);
  group.add(im);
  // ropes of vine stems
  const stems = Math.ceil(w / 0.8);
  const stemGeo = new THREE.CylinderGeometry(0.03, 0.04, y1 - y0, 4);
  const sm = standard('vinestem', exp, { color: 0x3c5a24, roughness: 1 });
  for (let i = 0; i < stems; i++) {
    const t = (i + 0.5) / stems;
    const m = new THREE.Mesh(stemGeo, sm);
    m.position.set(x0 + (x1 - x0) * t - n[0] * 0.4, (y0 + y1) / 2, z0 + (z1 - z0) * t - n[1] * 0.4);
    group.add(m);
  }
}

// ------------------------------------------------------------ water

export class WaterSurface {
  mesh: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  constructor(group: THREE.Group, x0: number, x1: number, z0: number, z1: number, y: number, exp: Exposure, color = 0x2c5a58) {
    const T = textures();
    const nm = T.waterNormal.clone();
    nm.wrapS = nm.wrapT = THREE.RepeatWrapping;
    nm.repeat.set((x1 - x0) / 6, (z1 - z0) / 6);
    nm.needsUpdate = true;
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 0.12, metalness: 0.1, transparent: true, opacity: exp === 'dungeon' ? 0.85 : 0.78, normalMap: nm, depthWrite: false });
    this.mat.normalScale.set(0.6, 0.6);
    applySkyMask(this.mat, exp);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    group.add(this.mesh);
  }
  update(t: number, flow = 0) {
    const nm = this.mat.normalMap!;
    nm.offset.set(Math.sin(t * 0.05) * 0.2 + t * flow, t * 0.03);
  }
}

/** Visual for a climbable vine volume (the wall face is the middle of the volume). */
export function vineFor(group: THREE.Group, v: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; n: [number, number] }, exp: Exposure, seed: number) {
  if (v.n[1] !== 0) {
    const zf = (v.z0 + v.z1) / 2 + v.n[1] * 0.5;
    vineSheet(group, v.x0, v.x1, v.y0, v.y1, zf, zf, v.n, exp, seed);
  } else {
    const xf = (v.x0 + v.x1) / 2 + v.n[0] * 0.5;
    vineSheet(group, xf, xf, v.y0, v.y1, v.z0, v.z1, v.n, exp, seed);
  }
}
