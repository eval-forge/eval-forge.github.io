import * as THREE from 'three';
import type { SceneDef } from '../SceneBase';
import { box3, looseRelics } from '../SceneBase';
import { jungleTrees, treeColliders, hangingVines, rubble } from '../decor';
import { RopeBridge } from '../../entities/Traps';
import { mulberry32 } from '../../logic/rng';
import { smoothstep } from '../../logic/vec';

export const JUNGLE_START = new THREE.Vector3(0.5, 0.3, 200);

/** Path centre line through the jungle. */
export const pathX = (z: number) => 3 * Math.sin((z - 118) / 14) + (z > 165 ? (z - 165) * 0.05 : 0);

const GORGE0 = 110, GORGE1 = 126;

/** Terrain height of the jungle approach. */
export function jungleHeight(x: number, z: number): number {
  let h = 0.35 * Math.sin(x * 0.31 + z * 0.17) + 0.25 * Math.sin(x * 0.11 - z * 0.23 + 1.7) + 0.15 * Math.sin(x * 0.7 + z * 0.5);
  const dp = Math.abs(x - pathX(z));
  h *= smoothstep(1.5, 5, dp);
  // hills at the edges keep you on the approach
  const ax = Math.abs(x);
  if (ax > 22) h += (ax - 22) * (ax - 22) * 0.12;
  // river channel
  if (z > 151 && z < 163) {
    const d = Math.min(z - 151, 163 - z);
    h = Math.min(h, -1.3 * smoothstep(0, 2.5, d));
  }
  // gorge
  if (z > GORGE0 && z < GORGE1) h = -16;
  // flatten into the courtyard
  if (z < 99) h *= smoothstep(95, 99, z);
  return h;
}

export const jungle: SceneDef = {
  id: 'jungle',
  name: 'Jungle approach',
  zone: 'A',
  bounds: [box3(-40, -30, 95, 40, 60, 215)],
  exposure: () => ({ outdoor: 1, ambient: 1 }),
  sconces: [],
  build(b) {
    // terrain trimesh
    const x0 = -36, x1 = 36, z0 = 95, z1 = 210;
    const nx = x1 - x0, nz = z1 - z0;
    const g = new THREE.PlaneGeometry(nx, nz, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, jungleHeight(x, z));
      uv.setXY(i, x / 6, z / 6);
    }
    g.computeVertexNormals();
    b.geometry(g, 'jungle', { trimesh: true, cast: false });
    // dirt path strip (visual decal slightly above the terrain)
    {
      const pts: number[] = [], uvs: number[] = [], idx: number[] = [];
      let k = 0;
      for (let z = 96; z <= 208; z += 1) {
        if (z > GORGE0 - 1 && z < GORGE1 + 1) continue;
        if (z > 151 && z < 163) continue;
        const cx = pathX(z);
        for (const s of [-1.6, 1.6]) { const x = cx + s; pts.push(x, jungleHeight(x, z) + 0.04, z); uvs.push(s > 0 ? 1 : 0, z / 4); }
        if (k > 0 && pts.length >= 12) {
          const a = k * 2 - 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
        k++;
      }
      // the gaps above would stitch segments over the river/gorge; split by rebuilding per run
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const keep: number[] = [];
      for (let i = 0; i < idx.length; i += 6) {
        const za = pts[idx[i] * 3 + 2], zb = pts[idx[i + 1] * 3 + 2];
        if (Math.abs(za - zb) < 1.5) keep.push(...idx.slice(i, i + 6));
      }
      geo.setIndex(keep);
      geo.computeVertexNormals();
      b.geometry(geo, 'dirt', { cast: false });
    }
    // gorge walls (rock faces hide the stretched terrain)
    b.aabb(-36, -17, GORGE0 - 0.4, 36, 0.05, GORGE0 + 1.2, 'rock');
    b.aabb(-36, -17, GORGE1 - 1.2, 36, 0.05, GORGE1 + 0.4, 'rock');
    rubble(b, -30, GORGE0 + 1.5, 30, GORGE1 - 1.5, -16, 26, 51, 'rock', 1.4);
    // vines to climb out of the gorge (both sides)
    b.climb(-14, -16, GORGE0 + 1.2, -10, 0.6, GORGE0 + 2.0, [0, 0, 1]);
    b.climb(10, -16, GORGE1 - 2.0, 14, 0.6, GORGE1 - 1.2, [0, 0, -1]);
    b.water(-36, GORGE0 + 1, 36, GORGE1 - 1, -16, -14.6);
    // river
    b.water(-36, 151, 36, 163, -1.3, -0.35);
    const rand = mulberry32(12);
    for (let i = 0; i < 7; i++) {
      const z = 152.5 + i * 1.6;
      const x = pathX(z) + (rand() - 0.5) * 1.5;
      b.box(x, -0.55, z, 1.1 + rand() * 0.4, 1.3, 1.0 + rand() * 0.3, 'rock', { rotY: rand() * 3 });
    }
    // fallen log across the river
    b.cylinder(pathX(157) + 6, -0.05, 157, 0.45, 15, 'bark', { rotX: Math.PI / 2, rotY: 0.15 });
    // invisible boundaries
    b.blocker(-34, -20, 95, -32, 40, 212);
    b.blocker(32, -20, 95, 34, 40, 212);
    b.blocker(-34, -20, 208, 34, 40, 212);
    // vegetation
    const trees: { x: number; z: number; s: number }[] = [];
    const ferns: { x: number; z: number; s: number }[] = [];
    const tr = mulberry32(99);
    let guard = 0;
    while (trees.length < 150 && guard++ < 5000) {
      const x = -33 + tr() * 66, z = 97 + tr() * 112;
      if (Math.abs(x - pathX(z)) < 4.5) continue;
      if (z > GORGE0 - 2.5 && z < GORGE1 + 2.5) continue;
      if (z > 150 && z < 164) continue;
      if (z > 196 && Math.abs(x) < 7) continue;
      if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 9)) continue;
      trees.push({ x, z, s: tr() });
    }
    guard = 0;
    while (ferns.length < 700 && guard++ < 8000) {
      const x = -33 + tr() * 66, z = 96 + tr() * 112;
      if (Math.abs(x - pathX(z)) < 1.8) continue;
      if (z > GORGE0 - 0.5 && z < GORGE1 + 0.5) continue;
      if (z > 151 && z < 163) continue;
      ferns.push({ x, z, s: tr() });
    }
    const set = jungleTrees(b.mats, trees, jungleHeight, ferns, 7);
    b.add(set.group);
    treeColliders(b, set);
    hangingVines(b, -30, 128, 30, 150, 13, 40, 5);
    hangingVines(b, -30, 165, 30, 205, 13, 45, 6);
    // the start camp: crates and a bedroll
    b.box(-3.2, 0.45, 202, 1, 0.9, 0.8, 'wood', { rotY: 0.3 });
    b.box(-3.0, 1.2, 202.1, 0.7, 0.6, 0.6, 'wood', { rotY: 0.6 });
    b.box(3.4, 0.12, 203, 0.9, 0.2, 2, 'cloth' as any, { collide: false });
    // ancient marker stones along the approach
    for (const [x, z] of [[-5, 140], [6, 132], [-6, 170], [5, 186]]) {
      b.box(x, 1.2 + jungleHeight(x, z), z, 0.9, 2.4, 0.5, 'mossy', { rotY: rand() });
    }
  },
  props(seed) {
    return [
      ...looseRelics('jungle', seed, [[-6.5, 2.0, 170.2], [-7.6, 0.6, 128.5], [8.5, 0.6, 145]]),
      { id: 'jungle_oil', kind: 'oil', pos: [-3.1, 1.7, 202.1], origin: 'jungle' },
    ];
  },
  spawn(ctx, rt) {
    rt.add(new RopeBridge(ctx, 'bridge_gorge', new THREE.Vector3(0, 0.12, GORGE1 - 1.0), new THREE.Vector3(0, 0.12, GORGE0 + 1.0), 1.8, 0.8));
  },
};
