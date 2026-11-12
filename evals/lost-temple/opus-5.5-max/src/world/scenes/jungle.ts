/**
 * Zone A: the jungle approach. Start at dawn in the south, cross the river (stepping stones,
 * a log, a shallow ford, or swim and drown your torch), then the gorge: a jointed rope bridge
 * whose planks crack and fall, or the long way round over a fallen tree.
 */
import * as THREE from 'three';
import { RAPIER } from '../../physics/Physics';
import { GROUP_STATIC } from '../../config';
import type { SceneDef, SceneCtx, SceneRuntime } from '../SceneDef';
import { box3 } from '../SceneDef';
import type { LevelBuilder } from '../LevelBuilder';
import { WorldNoise } from '../../render/noise';
import { Vegetation } from '../../render/vegetation';
import { Rng } from '../../logic/rng';
import { RopeBridge } from '../props/traps';
import { boxMesh } from '../props/util';

const wn = new WorldNoise(11);
const ss = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const RIVER_Z = 122;
export const RIVER_SURFACE = -0.6;
export const BRIDGE_X = 2;
export function pathX(z: number) {
  return Math.sin(z * 0.035) * 6;
}

export function jungleHeight(x: number, z: number): number {
  let h = wn.fbm(x * 0.03, z * 0.03, 4) * 3.2 + wn.noise(x * 0.13, z * 0.13) * 0.35 + 0.6;
  const ax = Math.abs(x);
  if (ax > 46) h += (ax - 46) * (ax - 46) * 0.012;
  if (z > 184) h += (z - 184) * (z - 184) * 0.035;
  // main path
  const dp = Math.abs(x - pathX(z));
  h = lerp(h, 0.15 + wn.noise(x * 0.05, z * 0.05) * 0.25, ss(4.5, 1.2, dp) * 0.9);
  // trail along the gorge to the fallen tree
  if (z < 92 && x < pathX(z) + 2) {
    const k = ss(5, 1.5, Math.abs(z - 87)) * ss(-50, -44, x);
    h = lerp(h, 0.1, k * 0.9);
  }
  // camp clearing
  const dc = Math.hypot(x - 0, z - 176);
  h = lerp(h, 0.2, ss(9, 5, dc));
  // river channel with a shallow ford at x ~ 18
  const dz = Math.abs(z - RIVER_Z);
  if (dz < 10) {
    const ford = ss(6, 2.5, Math.abs(x - 18));
    const bed = -2.6 + 1.75 * Math.min(1, (dz / 6) ** 2);
    const bedF = lerp(bed, Math.max(bed, -1.25), ford);
    h = lerp(h, Math.min(h, bedF), ss(9.5, 6.2, dz));
  }
  // gorge rim
  if (z < 86) h = lerp(h, 0, ss(86, 80, z));
  return h;
}

function groundColor(x: number, z: number, h: number): THREE.Color {
  const n = wn.noise(x * 0.2, z * 0.2) * 0.5 + 0.5;
  const dp = Math.abs(x - pathX(z));
  const path = ss(3.5, 1, dp);
  const wet = ss(-0.2, -1.2, h);
  const c = new THREE.Color().setHSL(0.11 + n * 0.04, 0.35, 0.33 + n * 0.12);
  const moss = new THREE.Color().setHSL(0.22, 0.45, 0.24 + n * 0.08);
  c.lerp(moss, (1 - path) * 0.55 * (1 - wet));
  c.lerp(new THREE.Color(0.25, 0.22, 0.18), wet * 0.6);
  return c;
}

const STONES: [number, number, number][] = [
  [-5.6, 115.6, 0.75],
  [-4.4, 117.6, 0.7],
  [-5.8, 119.7, 0.75],
  [-4.6, 121.9, 0.7],
  [-5.9, 124.1, 0.75],
  [-4.8, 126.3, 0.7],
  [-5.4, 128.4, 0.8],
];

export const jungle: SceneDef = {
  id: 'jungle',
  zone: 'A',
  env: 'outdoor',
  boxes: [box3(-95, -70, 62, 95, 70, 205)],
  respawn: [BRIDGE_X, jungleHeight(BRIDGE_X, 88) + 0.1, 88],
  mapRects: [
    [-60, 80, 60, 190],
  ],
  layout(b: LevelBuilder) {
    b.terrain(-90, 80, 90, 200, 2, jungleHeight, 'ground', groundColor);
    // gorge walls and floor
    b.wall(-90, 78, 90, 80, -42, 0, 'rock', { nav: 'none', tex: 0.25 });
    b.wall(-90, 62, 90, 64, -42, 0, 'rock', { nav: 'none', tex: 0.25 });
    b.floor(-90, 64, 90, 78, -30, 'rock', { nav: 'none', thick: 2 });
    for (let i = 0; i < 26; i++) {
      const x = -86 + i * 6.8 + b.rng.next() * 3;
      b.rock(x, -27 + b.rng.next() * 2, 64.5 + b.rng.next() * 13, 1.2 + b.rng.next() * 1.8, 'rockMoss', { collider: false });
      b.rock(x + 2, -6 - b.rng.next() * 18, 78.4, 1 + b.rng.next() * 1.4, 'rockMoss', { collider: false, squash: 0.5 });
      b.rock(x - 1, -6 - b.rng.next() * 18, 63.6, 1 + b.rng.next() * 1.4, 'rockMoss', { collider: false, squash: 0.5 });
    }
    b.kill(-95, -70, 64, 95, -9, 78, 'gorge', [BRIDGE_X, jungleHeight(BRIDGE_X, 88) + 0.2, 88]);
    // river: water volume, stepping stones, a fallen log
    b.water(-90, RIVER_Z - 7.5, 90, RIVER_Z + 7.5, -4, RIVER_SURFACE, [-1.1, 0, 0]);
    for (const [x, z, r] of STONES) {
      b.cylinder(x, z, -2.8, 2.55, r, 'rockMoss', { rTop: r * 0.85, seg: 9, nav: 'none' });
    }
    b.cylinder(-20, RIVER_Z, -0.95, 22, 0.55, 'bark', { rot: new THREE.Euler(Math.PI / 2, 0, 0), nav: 'none', seg: 10 });
    // fallen tree across the gorge, roots on the north rim
    b.cylinder(-40, 71, -0.45, 27, 0.9, 'bark', { rot: new THREE.Euler(Math.PI / 2, 0, 0.0), nav: 'none', seg: 12 });
    b.rock(-40, 0.6, 57.2, 2.4, 'bark', { squash: 0.8, collider: true, tint: 0x8a7050 });
    // jungle shrine ruin
    b.box(-22, 0.6, 150, 6, 1.6, 6, 'sandstoneMoss', { nav: 'none' });
    b.box(-22, 1.6, 150, 4, 0.4, 4, 'sandstoneMoss', { nav: 'none' });
    b.pillar(-24.5, 147.5, 1.4, 3, 0.35, 'sandstoneMoss', { broken: true, nav: 'none' });
    b.pillar(-19.5, 152.5, 1.4, 3, 0.35, 'sandstoneMoss', { broken: true, nav: 'none' });
    b.box(-19.6, 1.85, 147.3, 1.2, 0.5, 0.8, 'sandstoneMoss', { rotY: 0.4, nav: 'none' });
    // camp crates
    b.box(3.5, 0.6, 177, 1.0, 0.9, 1.0, 'wood', { rotY: 0.3, nav: 'none' });
    b.box(4.4, 0.45, 178.3, 0.8, 0.6, 0.8, 'wood', { rotY: -0.2, nav: 'none' });
    b.box(-3.6, 0.55, 177.5, 1.6, 0.25, 0.9, 'burlap', { rotY: 0.1, nav: 'none', collider: false });
    // boulders scattered in the undergrowth
    for (let i = 0; i < 22; i++) {
      const x = -60 + b.rng.next() * 120;
      const z = 90 + b.rng.next() * 95;
      if (Math.abs(x - pathX(z)) < 5 || Math.abs(z - RIVER_Z) < 8) continue;
      b.rock(x, jungleHeight(x, z), z, 0.6 + b.rng.next() * 1.4, 'rockMoss', { squash: 0.6 });
    }
  },
  props(ctx: SceneCtx, rt: SceneRuntime) {
    // water surfaces
    const river = new THREE.Mesh(new THREE.PlaneGeometry(180, 15, 1, 1), ctx.mats.water);
    river.rotation.x = -Math.PI / 2;
    river.position.set(0, RIVER_SURFACE, RIVER_Z);
    river.receiveShadow = true;
    rt.group.add(river);
    const stream = new THREE.Mesh(new THREE.PlaneGeometry(180, 14), ctx.mats.water);
    stream.rotation.x = -Math.PI / 2;
    stream.position.set(0, -28.6, 71);
    rt.group.add(stream);
    // rope bridge
    // anchored at the lip of each rim (the walls are z 78..80 and 62..64), so the last plank meets
    // the rim edge instead of hanging into the wall top
    rt.addProp(new RopeBridge(ctx, rt, 'gorge', new THREE.Vector3(BRIDGE_X, -0.06, 78.0), new THREE.Vector3(BRIDGE_X, -0.06, 64.0), 1.8, 22));
    // relics
    ctx.relics.relicSpawn('j1', 'jungle', 'A', [-22, 1.8, 150]);
    ctx.relics.relicSpawn('j2', 'jungle', 'A', [19.5, jungleHeight(19.5, 133.5) + 0.05, 133.5]);
    ctx.relics.relicSpawn('j3', 'jungle', 'A', [-37.5, jungleHeight(-37.5, 88) + 0.05, 88]);
    // tents and a signpost at camp
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2, 4, 1, true), ctx.mats.get('cloth'));
    (tent.geometry as THREE.BufferGeometry).setAttribute('color', new THREE.BufferAttribute(new Float32Array((tent.geometry as THREE.BufferGeometry).attributes.position.count * 3).fill(0.9), 3));
    tent.position.set(-4, 1.0 + 0.2, 180);
    tent.rotation.y = Math.PI / 4;
    tent.castShadow = true;
    rt.group.add(tent);
    const sign = boxMesh(ctx.mats, 'wood', 0.12, 1.6, 0.12, 1);
    sign.position.set(2.5, 0.95, 168);
    rt.group.add(sign);
    const board = boxMesh(ctx.mats, 'wood', 0.9, 0.35, 0.06, 1);
    board.position.set(2.5, 1.6, 168);
    board.rotation.y = 0.2;
    rt.group.add(board);
    // vegetation
    const q = ctx.quality;
    const vq = q === 'low' ? 0.45 : q === 'medium' ? 0.75 : 1;
    const rng = new Rng(901);
    const clear = (x: number, z: number, pad: number) => {
      if (Math.abs(x - pathX(z)) < 3.5 + pad) return false;
      if (Math.abs(z - RIVER_Z) < 7 + pad) return false;
      if (z < 83 + pad) return false;
      if (Math.hypot(x, z - 176) < 8 + pad) return false;
      if (Math.hypot(x + 22, z - 150) < 6 + pad) return false;
      if (z < 92 && x < 4 && x > -48 && Math.abs(z - 87) < 3.5 + pad) return false;
      return true;
    };
    const h = (pad: number) => (x: number, z: number) => (clear(x, z, pad) ? jungleHeight(x, z) - 0.15 : null);
    const trees = Vegetation.scatter(rng, Math.round(85 * vq), -75, 84, 75, 198, h(2.5), 0.75, 1.25);
    const palms = Vegetation.scatter(rng, Math.round(30 * vq), -60, 84, 60, 196, h(1.5), 0.8, 1.2);
    const ferns = Vegetation.scatter(rng, Math.round(320 * vq), -70, 82, 70, 198, h(0.2), 0.7, 1.6);
    const bushes = Vegetation.scatter(rng, Math.round(110 * vq), -70, 82, 70, 198, h(0.5), 0.7, 1.4);
    const gq = q === 'low' ? 0.35 : q === 'medium' ? 0.7 : 1;
    const grass = Vegetation.scatter(rng, Math.round(2600 * gq), -55, 82, 55, 196, (x, z) => (Math.abs(z - RIVER_Z) < 6.5 || z < 81 ? null : jungleHeight(x, z) - 0.05), 0.8, 1.5);
    for (const [k, list] of [['trunk', trees], ['canopy', trees], ['palmTrunk', palms], ['palmFronds', palms], ['fern', ferns], ['bush', bushes], ['grass', grass]] as const) {
      const im = ctx.veg.instances(k, list);
      if (im) rt.group.add(im);
    }
    for (const t of trees) {
      ctx.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(3, 0.5 * t.s).setTranslation(t.x, t.y + 3, t.z).setCollisionGroups(GROUP_STATIC), rt.body);
    }
    for (const t of palms) {
      ctx.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(2, 0.22 * t.s).setTranslation(t.x, t.y + 2, t.z).setCollisionGroups(GROUP_STATIC), rt.body);
    }
  },
};
