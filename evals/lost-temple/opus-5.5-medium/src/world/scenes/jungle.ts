import * as THREE from 'three';
import { SceneChunk } from '../SceneChunk';
import { materials } from '../textures';
import { mulberry32 } from '../../logic/rng';
import { G } from '../../core/ctx';
import { Bridge } from '../../entities/Bridge';
import { trees, ferns, loot, rubble, skeleton, pickup } from './common';
import { Prop, potMesh } from '../../entities/Loot';

export const RIVER_Z = -40;
export const WATER_Y = -0.45;

/** Terrain height for the jungle approach. */
export function jungleHeight(x: number, z: number): number {
  let h = 0.35 * Math.sin(x * 0.21 + z * 0.13) + 0.25 * Math.sin(x * 0.53 - z * 0.37) + 0.15 * Math.cos(z * 0.71 + x * 0.19);
  // path flattening
  const path = Math.exp(-(x * x) / 30);
  h *= 1 - 0.8 * path;
  // hills at the edges
  const e = Math.max(0, Math.abs(x) - 26);
  h += e * e * 0.06;
  // river channel
  const dr = Math.abs(z - RIVER_Z);
  const carve = THREE.MathUtils.smoothstep(6.5, 3.5, dr);
  const deep = x > 10 && x < 26 ? 2.3 : 1.25;
  h -= carve * deep;
  // flatten near the gorge edge and start
  if (z < -70) h *= 0.3;
  return h;
}

export class Jungle extends SceneChunk {
  id = 'jungle' as const;
  zone = 'A' as const;
  name = 'Jungle Approach';
  bridge!: Bridge;

  build() {
    const m = materials();
    const rnd = mulberry32(G.seed ^ 0x1111);
    this.bounds.set(new THREE.Vector3(-42, -40, -92), new THREE.Vector3(42, 30, 12));
    this.areas = [new THREE.Box3(new THREE.Vector3(-42, -40, -91), new THREE.Vector3(42, 40, 12))];
    this.navRegions = [{ min: new THREE.Vector3(-40, -4, -77), max: new THREE.Vector3(40, 6, 10) }];
    this.killY = -10;
    this.neighbours = ['courtyard'];

    // Terrain (visual + trimesh collider)
    const W = 84, D = 90, segW = 84, segD = 90;
    const geo = new THREE.PlaneGeometry(W, D, segW, segD);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 12 - D / 2);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, jungleHeight(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 0.25, pos.getZ(i) * 0.25);
    const terrain = new THREE.Mesh(geo, m.ground);
    terrain.receiveShadow = true;
    this.group.add(terrain);
    const idx = geo.getIndex()!;
    this.b.statics.push({ shape: 'trimesh', vertices: new Float32Array(pos.array as Float32Array), indices: new Uint32Array(idx.array) });

    // River water
    const water = new THREE.Mesh(new THREE.PlaneGeometry(84, 14), m.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, WATER_Y, RIVER_Z);
    water.receiveShadow = true;
    this.group.add(water);
    this.waters.push({ box: new THREE.Box3(new THREE.Vector3(-42, -4, RIVER_Z - 7), new THREE.Vector3(42, WATER_Y, RIVER_Z + 7)), surface: WATER_Y });
    // Stepping stones and a fallen log
    for (let i = 0; i < 7; i++) {
      const z = RIVER_Z + 5 - i * 1.65;
      this.b.cyl(0.65, 1.6, (i % 2 ? 0.5 : -0.5), -1.05, z, m.mossStone, { segs: 9 });
    }
    this.b.cyl(0.55, 16, -9, -0.2, RIVER_Z, m.bark, { rotX: Math.PI / 2, segs: 9 });

    // Gorge walls and floor
    this.b.box(84, 40, 2, 0, -20.3, -78, m.cliff, { cast: false });
    this.b.box(84, 2, 14, 0, -36, -85, m.cliff, { cast: false });
    // Boundaries
    this.b.wall(1, 30, 104, -41.5, 10, -40);
    this.b.wall(1, 30, 104, 41.5, 10, -40);
    this.b.wall(84, 30, 1, 0, 10, 11.5);

    // Rope bridge over the gorge
    this.bridge = new Bridge(this, new THREE.Vector3(0, 0.05, -77.4), new THREE.Vector3(0, 0.05, -92.6), 1.8, 18, 0.7);

    // Vegetation
    const tp: { x: number; y: number; z: number; s: number }[] = [];
    for (let i = 0; i < 150; i++) {
      const x = (rnd() - 0.5) * 80, z = 10 - rnd() * 86;
      if (Math.abs(x) < 6 || Math.abs(z - RIVER_Z) < 7 || z < -74) continue;
      tp.push({ x, y: jungleHeight(x, z), z, s: rnd() });
    }
    trees(this, tp);
    const fp: { x: number; y: number; z: number; s: number }[] = [];
    for (let i = 0; i < 500; i++) {
      const x = (rnd() - 0.5) * 82, z = 11 - rnd() * 86;
      if (Math.abs(x) < 2.2 || Math.abs(z - RIVER_Z) < 5 || z < -76) continue;
      fp.push({ x, y: jungleHeight(x, z) - 0.05, z, s: rnd() });
    }
    ferns(this, fp);

    // Ruined shrine with a relic
    const sx = 9, sz = -20, sy = jungleHeight(sx, sz);
    this.b.box(3, 1, 2, sx, sy + 0.5, sz, m.mossStone);
    this.b.box(0.8, 2.6, 0.8, sx - 1.8, sy + 1.3, sz - 0.5, m.mossStone);
    this.b.box(1.2, 0.6, 1.2, sx - 1.8, sy + 2.9, sz - 0.5, m.mossStone);
    rubble(this, sx + 2, sy, sz + 1, 4, 6, rnd, m.mossStone);
    loot(this, 'A', sx, sy + 1.0, sz, rnd);

    // Deep pool relic (douses the torch)
    loot(this, 'A', 18, jungleHeight(18, RIVER_Z) + 0.02, RIVER_Z - 1, rnd);

    // Big rock you must mantle onto
    const rx = -15, rz = -58, ry = jungleHeight(rx, rz);
    this.b.box(4, 2.0, 4, rx, ry + 1.0, rz, m.cliff, { rotY: 0.4 });
    this.b.box(2, 1.0, 2, rx + 2.5, ry + 0.5, rz + 1.5, m.cliff, { rotY: 0.2 });
    loot(this, 'A', rx, ry + 2.0, rz, rnd);

    // Explorer who didn't make it, by the gorge
    const kx = -5, kz = -73;
    skeleton(this, kx, jungleHeight(kx, kz), kz, 0.6);
    loot(this, 'A', kx + 1, jungleHeight(kx + 1, kz) + 0.02, kz + 0.6, rnd);
    pickup(this, 'flask', kx - 0.8, jungleHeight(kx - 0.8, kz), kz - 0.4);

    // Camp at the start
    const cx = 3, cz = 6, cy = jungleHeight(cx, cz);
    this.b.box(2.4, 0.08, 1.6, cx, cy + 0.04, cz, m.cloth, { collide: false });
    this.b.cyl(0.35, 0.5, cx - 2, cy + 0.25, cz + 1, m.stone, { segs: 8 });
    const pot = new Prop(this, 'clay pot', 2, potMesh(), new THREE.Vector3(cx + 1.5, cy + 0.4, cz - 1), new THREE.Vector3(0.2, 0.22, 0.2));
    void pot;

    // Stone markers along the path
    for (let i = 0; i < 4; i++) {
      const z = -6 - i * 16, x = (i % 2 ? 3.2 : -3.2);
      this.b.box(0.6, 1.6, 0.6, x, jungleHeight(x, z) + 0.6, z, m.mossStone, { rotY: i });
    }
  }
}
