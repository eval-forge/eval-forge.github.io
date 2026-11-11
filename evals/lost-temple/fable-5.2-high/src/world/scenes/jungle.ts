import * as THREE from 'three';
import { Rng, fbm2 } from '../../core/rng';
import { smoothstep } from '../../core/types';
import { RAPIER } from '../../engine/physics';
import { canopyGeometry, crossCard, statue } from '../props';
import { RopeBridge, addVines, addWater } from '../setpieces';
import type { SceneDef } from '../types';
import { spawnRocks, white } from './common';

const X0 = -32, X1 = 32, Z0 = 42, Z1 = 126, STEP = 2;

/** The trail the player follows from the landing to the temple gate. */
export const pathX = (z: number): number => 5 * Math.sin((z - 66) / 13);

/** Ground height of the jungle. The gorge is cut out of it; its sheer faces are rock blocks. */
export function terrainH(x: number, z: number): number {
  if (z >= 60 && z <= 72) return Math.abs(x) < 5.9 ? -15.3 : -13;
  const off = smoothstep(2.5, 9, Math.abs(x - pathX(z)));
  const gorge = z < 60 ? 60 - z : z - 72;
  const flat = smoothstep(0, 5, gorge) * smoothstep(42, 47, z);
  let h = off * (fbm2(x * 0.09, z * 0.09, 4, 5) * 2.4 - 0.5) + smoothstep(21, 31, Math.abs(x)) * 4.5;
  h = Math.max(h, -0.25) * flat;
  const river = smoothstep(5.6, 3.2, Math.abs(z - 95));
  return h * (1 - river) - 1.7 * river;
}

export const JUNGLE_START: [number, number, number] = [pathX(119), 0.05, 119];

export const jungle: SceneDef = {
  id: 'jungle',
  bounds: [{ x1: -40, x2: 40, z1: 41, z2: 135 }],
  nav: [],
  loot: [
    { id: 'j1', scene: 'jungle', pos: [9.5, 0.4, 104] },
    { id: 'j2', scene: 'jungle', pos: [-16.5, -12, 61.5], rich: true },
    { id: 'j3', scene: 'jungle', pos: [-6.2, 0.3, 48.6] },
  ],
  guardians: [],
  map: [
    { x1: -3, z1: 100, x2: 9, z2: 124, kind: 'path' }, { x1: -30, z1: 90, x2: 30, z2: 100, kind: 'water' },
    { x1: -1, z1: 72, x2: 8, z2: 90, kind: 'path' }, { x1: -30, z1: 60, x2: 30, z2: 72, kind: 'pit' },
    { x1: -1.2, z1: 60, x2: 1.2, z2: 72, kind: 'bridge' }, { x1: -7, z1: 42, x2: 3, z2: 60, kind: 'path' },
  ],

  *build(game, b) {
    // --- Terrain ---------------------------------------------------------------------------
    const W = (X1 - X0) / STEP + 1, D = (Z1 - Z0) / STEP + 1;
    const pos = new Float32Array(W * D * 3), col = new Float32Array(W * D * 3), uv = new Float32Array(W * D * 2);
    const ts = game.mats.scaleOf('grass');
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
      const x = X0 + i * STEP, z = Z0 + j * STEP, k = j * W + i;
      const h = terrainH(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      uv[k * 2] = x / ts; uv[k * 2 + 1] = z / ts;
      const onPath = 1 - smoothstep(1.2, 3.4, Math.abs(x - pathX(z)));
      const wet = h < -0.5 ? 1 : 0;
      const shade = 0.82 + fbm2(x * 0.3, z * 0.3, 2, 9) * 0.36;
      let r = shade, g = shade, bl = shade * 0.9;
      // Worn earth on the trail, silt in the river bed, bare rock in the gorge.
      r += onPath * 0.45; g += onPath * 0.02; bl -= onPath * 0.3;
      if (wet) { r = 0.62; g = 0.58; bl = 0.45; }
      if (h < -5) { r = 0.5; g = 0.52; bl = 0.5; }
      col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = bl;
    }
    const idx: number[] = [];
    for (let j = 0; j < D - 1; j++) for (let i = 0; i < W - 1; i++) {
      const a = j * W + i, bb = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, bb, bb, c, d);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    tg.setIndex(idx);
    tg.computeVertexNormals();
    const terrain = new THREE.Mesh(tg, game.mats.get('grass'));
    terrain.receiveShadow = true;
    b.add(terrain); b.track(tg);
    b.collider(RAPIER.ColliderDesc.trimesh(pos.slice(), new Uint32Array(idx)));
    yield;

    // --- Edges -----------------------------------------------------------------------------
    b.blocker(-31, -20, 42, -30, 40, 126); b.blocker(30, -20, 42, 31, 40, 126); b.blocker(-32, -5, 125.5, 32, 40, 126.5);

    // --- Gorge -----------------------------------------------------------------------------
    b.box('rock', -32, -17, 58, 32, 0.02, 60.15); b.box('rock', -32, -17, 71.85, 32, 0.02, 74);
    b.box('rock', -32, -17, 60.15, -29, 5, 71.85); b.box('rock', 29, -17, 60.15, 32, 5, 71.85);
    b.box('rock', -18, -17, 60.15, -8, -12, 62.8, { tint: 0.9 });
    b.box('rock', 9, -17, 68.5, 15, -12.6, 71.85, { tint: 0.85 });
    b.piece(addVines(game, b, { x1: -14, x2: -11, y1: -12, y2: 0.02, z1: 60.15, z2: 60.85, nx: 0, nz: 1 }));
    b.piece(addWater(game, b, { x1: -29, x2: 29, z1: 60.15, z2: 71.85, surfaceY: -12.3, minY: -16.5, flowX: -1.6, flowZ: 0 }));
    b.piece(new RopeBridge(game, b, 'jungleBridge', 0, 0.02, 72.3, 0, 0.02, 59.7, 2.2));
    yield;

    // --- River -----------------------------------------------------------------------------
    b.piece(addWater(game, b, { x1: -31, x2: 31, z1: 89.6, z2: 100.4, surfaceY: -0.55, minY: -3, flowX: -1.8, flowZ: 0 }));
    const rng = new Rng(4242);
    for (let i = 0; i < 6; i++) {
      const z = 99.3 - i * 1.72, x = pathX(z) + rng.range(-0.25, 0.25);
      b.cyl('rock', x, -1.15 + rng.range(-0.05, 0.05), z, 0.72, 2.2, { segs: 8, tint: 0.95 });
    }
    // A fallen trunk upstream is the slow, dry way over.
    b.cyl('bark', -9, -0.25, 95, 0.55, 13, { rot: [Math.PI / 2, 0, 0], segs: 9 });
    b.box('stoneMoss', 8.3, -1, 102.8, 10.7, 0.4, 105.2); b.box('glyph', 8.9, 0.4, 104.6, 10.1, 1.5, 105.1);
    yield;

    // --- Ruins along the trail -------------------------------------------------------------
    statue(b, 'stoneMoss', -8.6, 0, 48, 0.9, 1.1);
    b.box('stoneMoss', -7, -0.5, 47.8, -5.4, 0.3, 49.4);
    for (const [z, side] of [[112, 1], [112, -1], [82, 1], [80, -1], [54, 1], [54, -1]] as const) {
      const x = pathX(z) + side * 3.4, h = 1.6 + ((z * 7 + side * 3) % 5) * 0.5;
      b.box('stoneMoss', x - 0.5, terrainH(x, z) - 0.6, z - 0.5, x + 0.5, h, z + 0.5);
    }
    spawnRocks(game, 'jungle', [[pathX(110) + 1.6, 0, 110, 1.4], [pathX(84) - 1.4, 0, 84, 2.2], [pathX(52) + 1.5, 0, 52, 3.0]]);
    yield;

    // --- Trees -----------------------------------------------------------------------------
    const trunkM: THREE.Matrix4[] = [], canopyM: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    const clear = (x: number, z: number, pad: number) =>
      Math.abs(x - pathX(z)) > pad && Math.abs(z - 95) > 7 && (z < 55.5 || z > 76.5) && z > 44.5 && z < 124.5;
    for (let n = 0; n < 420 && trunkM.length < 130; n++) {
      const x = rng.range(-29, 29), z = rng.range(44, 125);
      if (!clear(x, z, 3.6)) continue;
      const y = terrainH(x, z), r = rng.range(0.32, 0.62), h = rng.range(7, 12);
      trunkM.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + h / 2 - 0.3, z), q.setFromEuler(e.set(0, rng.range(0, 6), 0)), new THREE.Vector3(r, h, r)));
      const s = rng.range(1.5, 2.3);
      canopyM.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + h, z), q.setFromEuler(e.set(0, rng.range(0, 6), 0)), new THREE.Vector3(s, s * rng.range(0.8, 1.1), s)));
      b.collider(RAPIER.ColliderDesc.cylinder(h / 2, r * 1.1).setTranslation(x, y + h / 2, z));
    }
    b.instances(white(new THREE.CylinderGeometry(0.8, 1.2, 1, 7, 1)), game.mats.get('bark'), trunkM);
    b.instances(canopyGeometry(3), game.mats.canopy(), canopyM);
    yield;

    // --- Undergrowth -----------------------------------------------------------------------
    const scatter = (count: number, pad: number, w: number, h: number, kind: 'bush' | 'fern' | 'grass', shadow: boolean) => {
      const ms: THREE.Matrix4[] = [];
      for (let n = 0; n < count * 3 && ms.length < count; n++) {
        const x = rng.range(-29.5, 29.5), z = rng.range(43, 125.5);
        if (!clear(x, z, pad) && !(kind === 'grass' && Math.abs(x - pathX(z)) > pad && Math.abs(z - 95) > 5.5 && (z < 58 || z > 74))) continue;
        const s = rng.range(0.7, 1.5);
        ms.push(new THREE.Matrix4().compose(new THREE.Vector3(x, terrainH(x, z) - 0.05, z), q.setFromEuler(e.set(0, rng.range(0, 3.1), 0)), new THREE.Vector3(s, s, s)));
      }
      b.instances(crossCard(w, h), game.mats.card(kind), ms, shadow, true);
    };
    scatter(170, 2.4, 2.4, 1.8, 'bush', true);
    yield;
    scatter(200, 1.6, 1.5, 1.0, 'fern', false);
    yield;
    scatter(900, 1.1, 0.9, 0.55, 'grass', false);
  },
};
