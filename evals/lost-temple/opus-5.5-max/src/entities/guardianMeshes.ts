/**
 * Procedural guardian bodies. Every limb hangs from a named pivot so the walk, crawl and strike
 * animations can swing it. Nothing here glows: zone C has no light of its own, so the eyes are
 * glossy and only show when a torch catches them.
 */
import * as THREE from 'three';
import type { Materials, MatKey } from '../render/materials';
import { lathe, normalizeGeometry, rockGeometry, uvBox, uvCylinder } from '../render/geometry';
import type { GuardianKind } from '../logic/guardians';

export interface GuardianRig {
  /** At the feet, facing +z. */
  root: THREE.Group;
  joints: Record<string, THREE.Object3D>;
  height: number;
  /** Eye height above the feet (for line of sight). */
  eyeHeight: number;
}

let eyeMat: THREE.MeshStandardMaterial | null = null;
function eyeMaterial(): THREE.MeshStandardMaterial {
  if (!eyeMat) eyeMat = new THREE.MeshStandardMaterial({ color: 0xfff0c0, roughness: 0.06, metalness: 0.35 });
  return eyeMat;
}

function mk(mats: Materials, mat: MatKey, g: THREE.BufferGeometry, tint?: number): THREE.Mesh {
  const m = new THREE.Mesh(normalizeGeometry(g, tint !== undefined ? new THREE.Color(tint) : undefined), mats.get(mat));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function pivot(parent: THREE.Object3D, name: string, x: number, y: number, z: number, joints: Record<string, THREE.Object3D>): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  joints[name] = g;
  return g;
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): T {
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  return o;
}

function eye(r: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), eyeMaterial());
  m.castShadow = false;
  return m;
}

/** Stone Sentinel: a 2.4 m temple statue that walks. Also used for the decoy statues. */
function sentinel(mats: Materials): GuardianRig {
  const joints: Record<string, THREE.Object3D> = {};
  const root = new THREE.Group();
  const body = pivot(root, 'body', 0, 0, 0, joints);
  const stone: MatKey = 'dungeon';
  const tint = 0xb8ad98;
  // legs
  for (const [name, x] of [['legL', -0.24], ['legR', 0.24]] as const) {
    const leg = pivot(body, name, x, 1.05, 0, joints);
    leg.add(at(mk(mats, stone, uvBox(0.34, 0.6, 0.38, 1), tint), 0, -0.28, 0));
    leg.add(at(mk(mats, stone, uvBox(0.3, 0.5, 0.34, 1), tint), 0, -0.78, 0.02));
    leg.add(at(mk(mats, stone, uvBox(0.36, 0.14, 0.52, 1), tint), 0, -0.98, 0.07));
  }
  // hips, belt, torso, chest glyph plate, shoulders
  body.add(at(mk(mats, stone, uvBox(0.78, 0.26, 0.46, 1), tint), 0, 1.12, 0));
  body.add(at(mk(mats, 'glyphsDark', uvBox(0.84, 0.12, 0.5, 2), 0x9a9080), 0, 1.27, 0));
  const torso = pivot(body, 'torso', 0, 1.3, 0, joints);
  torso.add(at(mk(mats, stone, uvBox(0.92, 0.72, 0.52, 1), tint), 0, 0.36, 0));
  torso.add(at(mk(mats, 'glyphsDark', uvBox(0.5, 0.4, 0.06, 2), 0x9a9080), 0, 0.42, 0.28));
  torso.add(at(mk(mats, stone, uvBox(1.24, 0.22, 0.56, 1), tint), 0, 0.78, 0));
  // arms hang from the shoulders
  for (const [name, x] of [['armL', -0.66], ['armR', 0.66]] as const) {
    const arm = pivot(torso, name, x, 0.74, 0, joints);
    arm.add(at(mk(mats, stone, uvBox(0.28, 0.62, 0.3, 1), tint), 0, -0.32, 0));
    const fore = pivot(arm, name + 'Fore', 0, -0.64, 0, joints);
    fore.add(at(mk(mats, stone, uvBox(0.26, 0.56, 0.28, 1), tint), 0, -0.28, 0));
    fore.add(at(mk(mats, stone, uvBox(0.32, 0.26, 0.32, 1), tint), 0, -0.64, 0.02));
  }
  // head with a feathered crest carved in stone, a flat face and two glossy eyes
  const head = pivot(torso, 'head', 0, 0.9, 0, joints);
  head.add(at(mk(mats, stone, uvBox(0.48, 0.52, 0.46, 1), tint), 0, 0.26, 0));
  head.add(at(mk(mats, 'glyphsDark', uvBox(0.4, 0.3, 0.06, 2), 0xa09684), 0, 0.22, 0.24));
  head.add(at(mk(mats, stone, uvBox(0.82, 0.36, 0.12, 1), tint), 0, 0.62, -0.08));
  head.add(at(mk(mats, stone, uvBox(0.16, 0.12, 0.12, 1), tint), 0, 0.12, 0.27));
  for (const x of [-0.1, 0.1]) head.add(at(eye(0.045), x, 0.32, 0.245));
  return { root, joints, height: 2.45, eyeHeight: 2.15 };
}

/** Bone Crawler: a long, low, many-legged hunter that follows sound. */
function crawler(mats: Materials): GuardianRig {
  const joints: Record<string, THREE.Object3D> = {};
  const root = new THREE.Group();
  const body = pivot(root, 'body', 0, 0.55, 0, joints);
  const bone: MatKey = 'bone';
  const tint = 0x9c9080;
  const seg = (r: number, sx: number, sy: number, sz: number, z: number, y = 0) => {
    const g = new THREE.SphereGeometry(r, 12, 9);
    g.scale(sx, sy, sz);
    body.add(at(mk(mats, bone, g, tint), 0, y, z));
  };
  seg(0.32, 1.1, 0.8, 1.4, 0.0);
  seg(0.3, 1.0, 0.75, 1.3, -0.62, -0.03);
  seg(0.24, 0.95, 0.7, 1.4, -1.12, -0.07);
  // spine ridge
  for (let i = 0; i < 7; i++) {
    const c = new THREE.ConeGeometry(0.05, 0.22, 5);
    body.add(at(mk(mats, bone, c, 0xc8bca8), 0, 0.24 - i * 0.012, 0.25 - i * 0.22, -0.4));
  }
  // tail
  const tail = pivot(body, 'tail', 0, -0.05, -1.4, joints);
  const tg = new THREE.ConeGeometry(0.14, 1.1, 7);
  tg.rotateX(-Math.PI / 2);
  tail.add(at(mk(mats, bone, tg, tint), 0, 0, -0.5));
  // head and jaws
  const head = pivot(body, 'head', 0, 0.02, 0.42, joints);
  const hg = new THREE.SphereGeometry(0.22, 12, 9);
  hg.scale(1, 0.7, 1.5);
  head.add(at(mk(mats, bone, hg, 0xb0a490), 0, 0.02, 0.22));
  const jaw = pivot(head, 'jaw', 0, -0.06, 0.18, joints);
  for (const x of [-0.11, 0.11]) {
    const m = new THREE.ConeGeometry(0.05, 0.42, 6);
    m.rotateX(Math.PI / 2);
    jaw.add(at(mk(mats, bone, m, 0xd8ccb8), x, 0, 0.3, 0, -x * 1.2, 0));
  }
  for (const [x, y] of [[-0.12, 0.1], [0.12, 0.1], [-0.07, 0.14], [0.07, 0.14]] as const) head.add(at(eye(0.03), x, y, 0.42));
  // six legs: upper segment out to the side, lower segment down to the floor
  const legZ = [0.18, -0.55, -1.05];
  let k = 0;
  for (const z of legZ) {
    for (const side of [-1, 1]) {
      const name = 'leg' + k++;
      const leg = pivot(body, name, side * 0.28, -0.02, z, joints);
      const up = uvCylinder(0.045, 0.06, 0.55, 6, 1);
      up.rotateZ(Math.PI / 2);
      leg.add(at(mk(mats, bone, up, tint), side * 0.26, 0.12, 0, 0, 0, side * -0.45));
      const knee = pivot(leg, name + 'Low', side * 0.5, 0.24, 0, joints);
      const low = uvCylinder(0.035, 0.015, 0.78, 6, 1);
      knee.add(at(mk(mats, bone, low, 0xc0b4a0), side * 0.12, -0.36, 0, 0, 0, side * 0.3));
    }
  }
  return { root, joints, height: 0.95, eyeHeight: 0.7 };
}

/** The Shadow: a tall hooded shape in rags that keeps to the dark and strikes when the light dies. */
function shadow(mats: Materials): GuardianRig {
  const joints: Record<string, THREE.Object3D> = {};
  const root = new THREE.Group();
  const body = pivot(root, 'body', 0, 0, 0, joints);
  const rag: MatKey = 'cloth';
  const dark = 0x161214;
  const cloak = lathe(
    [
      [0.0, 0.05],
      [0.5, 0.05],
      [0.46, 0.4],
      [0.36, 1.0],
      [0.28, 1.5],
      [0.26, 1.78],
      [0.3, 1.86],
      [0.0, 1.9],
    ],
    14,
    1,
  );
  body.add(at(mk(mats, rag, cloak, dark), 0, 0, 0));
  // tattered hem
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const c = new THREE.ConeGeometry(0.07, 0.36 + (i % 3) * 0.08, 4);
    c.rotateX(Math.PI);
    body.add(at(mk(mats, rag, c, dark), Math.cos(a) * 0.47, 0.06, Math.sin(a) * 0.47));
  }
  // hood and the pale mask inside it
  const head = pivot(body, 'head', 0, 1.9, 0, joints);
  const hood = new THREE.SphereGeometry(0.26, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.75);
  hood.scale(1, 1.25, 1.1);
  head.add(at(mk(mats, rag, hood, dark), 0, 0.14, -0.03));
  const mask = new THREE.SphereGeometry(0.17, 12, 8, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.2, Math.PI * 0.6);
  mask.scale(1, 1.3, 0.8);
  head.add(at(mk(mats, 'bone', mask, 0xd4ccbc), 0, 0.1, 0.06));
  for (const x of [-0.06, 0.06]) head.add(at(eye(0.022), x, 0.15, 0.2));
  // long arms ending in claws
  for (const [name, x] of [['armL', -0.3], ['armR', 0.3]] as const) {
    const arm = pivot(body, name, x, 1.72, 0, joints);
    arm.add(at(mk(mats, rag, uvCylinder(0.06, 0.05, 1.1, 6, 1), dark), 0, -0.55, 0.02));
    for (let f = 0; f < 3; f++) {
      const claw = new THREE.ConeGeometry(0.018, 0.26, 4);
      claw.rotateX(Math.PI);
      arm.add(at(mk(mats, 'bone', claw, 0xbab2a4), (f - 1) * 0.035, -1.2, 0.03));
    }
  }
  return { root, joints, height: 2.2, eyeHeight: 2.0 };
}

export function buildGuardian(kind: GuardianKind, mats: Materials): GuardianRig {
  switch (kind) {
    case 'sentinel':
      return sentinel(mats);
    case 'crawler':
      return crawler(mats);
    case 'shadow':
      return shadow(mats);
  }
}

/** A sleeping crawler or shadow curled on the lair floor (shown until it wakes). */
export function sleeperMound(mats: Materials, r: number): THREE.Mesh {
  return mk(mats, 'bone', rockGeometry(r, 7.3, 0.45, 1), 0x8a8070);
}
