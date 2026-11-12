import * as THREE from 'three';
import type { SceneDef } from '../SceneBase';
import { box3, looseRelics } from '../SceneBase';
import { rubble, jungleTrees, treeColliders, hangingVines, statue } from '../decor';
import { RopeBridge } from '../../entities/Traps';
import { mulberry32 } from '../../logic/rng';
import { smoothstep } from '../../logic/vec';

export const cliffs: SceneDef = {
  id: 'cliffs',
  name: 'Outer cliffs',
  zone: 'A',
  bounds: [box3(45, -80, -5, 130, 60, 100)],
  exposure: () => ({ outdoor: 1, ambient: 1 }),
  sconces: [],
  wind: (p) => Math.max(smoothstep(64, 72, p.x), smoothstep(2.5, 6, p.y) * smoothstep(52, 58, p.x)),
  build(b) {
    // plateau (cliff block)
    b.aabb(45, -40, 12, 70, 0, 90, 'cliff');
    b.aabb(45, 0, 12, 70, 0.05, 90, 'jungle', { collide: false });
    // temple mountain face to the north
    b.aabb(45, -40, -5, 120, 24, 12, 'cliff');
    // rock outcrops on the plateau edge
    const rand = mulberry32(5);
    for (let z = 16; z < 88; z += 5) b.box(70.5, -0.5 + rand() * 0.8, z + rand() * 3, 1.5, 1.6 + rand(), 2 + rand() * 2, 'cliff', { rotY: rand(), collide: false });
    b.blocker(70.6, 0, 33, 71.4, 1.2, 90); // knee-high lip south of the arch (still easy to hop)
    b.blocker(45, -5, 89, 70, 30, 91);
    // L1: ledge along the face at y=0 with a jump gap
    b.aabb(70, -5, 12, 84, 0, 14.5, 'cliff');
    b.aabb(86.4, -5, 12, 97, 0, 14.5, 'cliff');
    b.aabb(92, -6, 12, 97, 0, 16.5, 'cliff');
    // vines from the plateau to L2
    b.climb(58, 0, 12, 61, 7.6, 13, [0, 0, 1]);
    // L2: high ledge at y=7
    b.aabb(56, 6, 12, 103, 7, 14, 'cliff');
    b.aabb(98, 5, 12, 104, 7, 15.6, 'cliff');
    b.climb(98.5, -0.2, 14.5, 101.5, 7.4, 15.5, [0, 0, 1], true); // hanging roots back down to L1
    // spire with relic
    b.aabb(97, -45, 26.4, 105, 7, 35, 'cliff');
    rubble(b, 98, 27, 104, 34, 7, 8, 61, 'cliff', 0.5);
    statue(b, 103.5, 33.5, 7, -Math.PI * 0.75, 'mossy', 0.8);
    // natural rock arch rising from the plateau to the spire
    b.ramp(70, 30, 97, 32.2, 'x', 0, 7, 'cliff', false);
    for (let i = 0; i < 6; i++) b.box(72 + i * 4.4, -2 + i * 1.1 - 1.5, 31.1, 4.6, 3.5 - i * 0.1, 2, 'cliff', { collide: false, rotZ: 0.25 });
    // abyss far below
    b.aabb(60, -64, -40, 220, -60, 160, 'rock', { collide: false });
    // distant peaks
    for (let i = 0; i < 9; i++) {
      const x = 150 + rand() * 60, z = -40 + i * 22, h = 30 + rand() * 50;
      b.box(x, -60 + h / 2, z, 20 + rand() * 20, h, 20 + rand() * 20, 'cliff', { collide: false, rotY: rand() * 2, cast: false });
    }
    b.kill(45, -80, -5, 220, -25, 160, 'abyss');
    // plants
    const trees: { x: number; z: number; s: number }[] = [{ x: 50, z: 80, s: 0.5 }, { x: 64, z: 86, s: 0.3 }, { x: 48, z: 22, s: 0.2 }];
    const ferns: { x: number; z: number; s: number }[] = [];
    for (let i = 0; i < 120; i++) ferns.push({ x: 46 + rand() * 22, z: 14 + rand() * 74, s: rand() * 0.5 });
    const set = jungleTrees(b.mats, trees, () => 0, ferns, 21);
    b.add(set.group);
    treeColliders(b, set);
    hangingVines(b, 60, 12.2, 100, 12.4, 22, 30, 9);
  },
  props(seed) {
    return [
      { id: 'cliff_mask', kind: 'relic', relicId: 'mask', pos: [95, 0.5, 14.5], origin: 'cliffs' },
      { id: 'cliff_chalice', kind: 'relic', relicId: 'chalice', pos: [101, 7.5, 31], origin: 'cliffs' },
      ...looseRelics('cliffs', seed, [[82, 7.5, 13], [62, 0.5, 72], [99, 7.5, 13.2]]),
    ];
  },
  spawn(ctx, rt) {
    rt.add(new RopeBridge(ctx, 'bridge_spire', new THREE.Vector3(101, 7, 15.4), new THREE.Vector3(101, 7, 26.6), 1.6, 0.5));
  },
};
