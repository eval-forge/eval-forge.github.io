/** Scene 1: Jungle Approach. Terrain, river, gorge and the first collapsing bridge. */
import * as THREE from 'three';
import { smoothstep } from '../../core/rng';
import { RAPIER } from '../../engine/physics';
import { Water } from '../entities/env';
import { PlankBridge } from '../entities/traps';
import type { SceneKit } from '../kit';
import { JUNGLE, jungleHeight, jungleTrailX } from '../layout/jungle';
import { canopyGeometry, crossCardGeometry, instanced, leafTint, mural, rock, supply, type Scatter } from './common';

const NX = 61;
const NZ = 90;

export function* buildJungle(k: SceneKit): Generator<void> {
  const game = k.game;
  const J = JUNGLE;
  const veg = game.renderer.quality.vegetation;

  // ---------------------------------------------------------------- terrain
  const pos = new Float32Array(NX * NZ * 3);
  const col = new Float32Array(NX * NZ * 3);
  const uv = new Float32Array(NX * NZ * 2);
  const dx = (J.x1 - J.x0) / (NX - 1);
  const dz = (J.z1 - J.z0) / (NZ - 1);
  for (let iz = 0; iz < NZ; iz++) {
    const z = J.z0 + iz * dz;
    const trail = jungleTrailX(z);
    for (let ix = 0; ix < NX; ix++) {
      const x = J.x0 + ix * dx;
      const i = iz * NX + ix;
      const h = jungleHeight(x, z);
      pos[i * 3] = x;
      pos[i * 3 + 1] = h;
      pos[i * 3 + 2] = z;
      // Height feeds the UVs too, so the texture does not smear down the gorge and valley walls.
      uv[i * 2] = (x + h * 0.35) / 7;
      uv[i * 2 + 1] = (z + h) / 7;
      // Colour: trodden earth on the trail, wet sand in the river, bare rock in the gorge, grass elsewhere.
      const off = Math.abs(x - trail);
      const onTrail = 1 - smoothstep(1.2, 3.4, off);
      const river = 1 - smoothstep(3.5, 6.5, Math.abs(z - J.riverZ));
      const gorge = 1 - smoothstep(5, 7.5, Math.abs(z - J.gorgeZ));
      const plaza = (1 - smoothstep(56, 62, z)) * (1 - smoothstep(13, 19, Math.abs(x)));
      const n = 0.86 + 0.28 * Math.abs(Math.sin(x * 1.7 + z * 2.3) * Math.cos(x * 0.9 - z * 1.3));
      // Vertex colours are linear: these are darker than they read as numbers.
      let r = 0.17;
      let g = 0.27;
      let b = 0.09;
      const mix = (tr: number, tg: number, tb: number, t: number): void => {
        r += (tr - r) * t;
        g += (tg - g) * t;
        b += (tb - b) * t;
      };
      const steep = smoothstep(0.55, 1.3, Math.abs(jungleHeight(x + 0.6, z) - jungleHeight(x - 0.6, z)) + Math.abs(jungleHeight(x, z + 0.6) - jungleHeight(x, z - 0.6)));
      mix(0.4, 0.29, 0.18, onTrail * 0.9);
      mix(0.46, 0.4, 0.27, river);
      mix(0.24, 0.21, 0.17, Math.max(gorge * 0.9, steep));
      mix(0.42, 0.4, 0.35, plaza);
      col[i * 3] = r * n;
      col[i * 3 + 1] = g * n;
      col[i * 3 + 2] = b * n;
    }
    if (iz % 16 === 15) yield;
  }
  const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
  let q = 0;
  for (let iz = 0; iz < NZ - 1; iz++) {
    for (let ix = 0; ix < NX - 1; ix++) {
      const a = iz * NX + ix;
      const b = a + 1;
      const c = a + NX;
      const d = c + 1;
      idx[q++] = a;
      idx[q++] = c;
      idx[q++] = b;
      idx[q++] = b;
      idx[q++] = c;
      idx[q++] = d;
    }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  tg.setIndex(new THREE.BufferAttribute(idx, 1));
  tg.computeVertexNormals();
  const terrain = game.mats.mesh(tg, 'terrain', false);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  terrain.name = 'jungle:terrain';
  k.group.add(terrain);
  k.collider(RAPIER.ColliderDesc.trimesh(pos.slice(), idx.slice()), { surface: 'dirt', kind: 'terrain' });
  yield;

  // ------------------------------------------------- boundaries and masonry
  const wall = (x0: number, z0: number, x1: number, z1: number): void => {
    k.collider(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, 30, (z1 - z0) / 2).setTranslation((x0 + x1) / 2, 10, (z0 + z1) / 2), { surface: 'stone' });
  };
  wall(J.x0 - 1, J.z0, J.x0 + 0.5, J.z1);
  wall(J.x1 - 0.5, J.z0, J.x1 + 1, J.z1);
  wall(J.x0, J.z1 - 0.5, J.x1, J.z1 + 1);
  // Jungle-side rock shoulders either side of the compound wall.
  for (const s of [-1, 1]) {
    k.box(s * 32, -4, 42, s * 46, 16, 47, 'rock', { shade: [0.6, 1], tint: 0.9 });
    for (let i = 0; i < 5; i++) rock(k, s * (33 + i * 2.6), jungleHeight(s * (33 + i * 2.6), 48.5) - 0.6, 48 + (i % 2) * 1.6, 2.2 + (i % 3) * 0.7, { squash: 0.9 });
  }

  // Plaza flagstones and the processional kerbs.
  k.box(-12, -0.5, 42, 12, 0.02, 56, 'flagstone', { solid: false });
  for (const s of [-1, 1]) {
    k.box(s * 12, -0.5, 42, s * 12.6, 0.35, 56, 'templeStone', { solid: true });
    k.pillar(s * 6.2, 0, 54, 0.55, 4.6, s < 0 ? 0.4 : 1, 'pillar', { dungeon: false });
  }
  // Broken statue by the door: plinth, legs, the head lying beside it.
  k.box(-9.2, 0, 50.6, -7.6, 0.9, 52.2, 'templeStone');
  k.cyl(-8.4, 0.9, 51.4, 0.45, 1.5, 'mossStone', { rTop: 0.38, seg: 8 });
  rock(k, -6.6, 0.05, 49.2, 0.62, { mat: 'mossStone', squash: 1 });
  mural(k, 'warn', ['sun', 'arrow', 'door', 'moon', 'skull'], -8.4, 1.4, 50.56, 0, -1, { dark: false, accent: 'door', height: 0.5 });

  // Bridge abutments: dressed stone so the rope span has something honest to hang from.
  const south = J.gorgeZ + J.gorgeHalf - 0.2;
  const north = J.gorgeZ - J.gorgeHalf + 0.2;
  k.box(-2.4, -9, south, 2.4, 0.02, south + 3.4, 'mossStone', { shade: [0.55, 1] });
  k.box(-2.4, -9, north - 3.4, 2.4, 0.02, north, 'mossStone', { shade: [0.55, 1] });
  for (const s of [-1, 1]) {
    k.box(s * 1.9 - 0.25, 0, south + 0.2, s * 1.9 + 0.25, 1.5, south + 0.7, 'wood', { surface: 'wood' });
    k.box(s * 1.9 - 0.25, 0, north - 0.7, s * 1.9 + 0.25, 1.5, north - 0.2, 'wood', { surface: 'wood' });
  }
  k.add(
    new PlankBridge(game, k.group, 'jungle.bridge', { x: 0, y: 0, z: south }, { x: 0, y: 0, z: north }, {
      planks: 12, width: 1.9, crackDelay: 0.75, snapWhenCrossed: true, dark: false,
    }),
  );
  yield;

  // ----------------------------------------------------------------- river
  k.add(new Water(game, k.group, 'jungle', J.x0, J.riverZ - 6.2, J.x1, J.riverZ + 6.2, J.waterY, { x: 1.6, y: 0, z: 0 }, false));
  const sx = jungleTrailX(J.riverZ);
  const stones = [-4.4, -2.7, -0.9, 0.9, 2.6, 4.3];
  stones.forEach((o, i) => {
    const x = sx + Math.sin(i * 2.4) * 0.45;
    k.cyl(x, -2.4, J.riverZ + o, 0.72 + (i % 2) * 0.08, 2.4 + J.waterY + 0.27, 'rock', { seg: 7, rTop: 0.62, tint: 0.95 });
  });
  // The flat rock mid-stream (relic) and two lower stones to reach it.
  k.cyl(-6.5, -2.2, 121, 1.35, 2.4, 'rock', { seg: 9, rTop: 1.15 });
  k.cyl(-6.3, -2.2, 118.9, 0.7, 1.55, 'rock', { seg: 7, rTop: 0.6 });
  k.cyl(-4.4, -2.2, 121.6, 0.6, 1.5, 'rock', { seg: 7, rTop: 0.5 });
  for (let i = 0; i < 14; i++) {
    const x = k.rng.range(J.x0 + 4, J.x1 - 4);
    if (Math.abs(x - sx) < 3 || Math.abs(x + 6) < 3.5) continue;
    rock(k, x, -1.5, J.riverZ + k.rng.range(-4.5, 4.5), k.rng.range(0.6, 1.5), { solid: true });
  }
  yield;

  // ------------------------------------------------------------------ camp
  const cy = jungleHeight(4.2, 154.5);
  k.box(3.6, cy - 0.5, 153.9, 4.8, cy + 0.75, 155.1, 'mossStone'); // shrine stone (relic on top)
  mural(k, 'camp', ['sun', 'serpent', 'door'], 4.2, cy + 0.38, 153.88, 0, -1, { dark: false, height: 0.5, accent: 'sun' });
  const ty = jungleHeight(-3.4, 162.5);
  // Tent: two leaning cloth panels and a ridge pole.
  k.boxRot(-4.25, ty + 0.85, 162.5, 2.1, 0.05, 2.8, 0, 'cloth', { rotZ: 0.92, solid: false });
  k.boxRot(-2.55, ty + 0.85, 162.5, 2.1, 0.05, 2.8, 0, 'cloth', { rotZ: -0.92, solid: false });
  k.box(-3.46, ty, 161.0, -3.34, ty + 1.75, 161.12, 'wood', { solid: false });
  k.box(-3.46, ty, 163.88, -3.34, ty + 1.75, 164.0, 'wood', { solid: false });
  k.collider(RAPIER.ColliderDesc.cuboid(1.5, 0.9, 1.4).setTranslation(-3.4, ty + 0.9, 162.5), { surface: 'wood' });
  const by = jungleHeight(2.6, 163.2);
  k.box(2.1, by, 162.7, 3.1, by + 0.8, 163.7, 'wood'); // supply crate
  supply(k, 'campFlask', 'flask', 2.6, by + 0.8, 163.2, false);
  // Fire ring.
  const fy = jungleHeight(0.2, 157.2);
  for (let i = 0; i < 7; i++) rock(k, 0.2 + Math.cos(i * 0.9) * 0.7, fy - 0.12, 157.2 + Math.sin(i * 0.9) * 0.7, 0.24, { solid: false, squash: 0.8 });
  k.cyl(0.2, fy - 0.06, 157.2, 0.52, 0.1, 'rock', { seg: 9, tint: 0.3, solid: false }); // ash bed
  k.boxRot(0.2, fy + 0.1, 157.2, 0.13, 0.13, 0.85, 0.5, 'wood', { tint: 0.35, solid: false });
  k.boxRot(0.2, fy + 0.17, 157.2, 0.12, 0.12, 0.8, 2.1, 'wood', { tint: 0.3, solid: false });
  k.prop('rock1', 'rock', 2, 1.6, fy + 0.3, 156.2);
  k.prop('rock2', 'rock', 4, -1.4, fy + 0.3, 158.4);
  k.prop('sandbag', 'sandbag', 8, 3.4, by + 0.3, 164.4);
  k.prop('pot', 'pot', 1.5, 5.2, cy + 0.3, 155.6);

  // Ruined arch beside the trail (relic underneath).
  const ax = jungleTrailX(105) + 6.5;
  const ay = jungleHeight(ax, 105) - 0.4;
  k.box(ax - 2.2, ay, 104.4, ax - 1.3, ay + 3.6, 105.6, 'mossStone');
  k.box(ax + 1.3, ay, 104.4, ax + 2.2, ay + 2.3, 105.6, 'mossStone');
  k.boxRot(ax - 0.2, ay + 3.75, 105, 3.6, 0.7, 1.2, 0, 'mossStone', { rotZ: -0.16 });
  rock(k, ax + 2.6, ay + 0.2, 106.4, 0.9, { mat: 'mossStone' });
  yield;

  // ------------------------------------------------------------ vegetation
  const clear = (x: number, z: number, pad: number): boolean => {
    if (Math.abs(x - jungleTrailX(z)) < pad) return false;
    if (Math.abs(z - J.riverZ) < 7.5) return false;
    if (Math.abs(z - J.gorgeZ) < 8.2) return false;
    if (Math.hypot(x - J.spawn.x, z - J.spawn.z) < 8.5 + pad * 0.3) return false;
    if (z < 60 && Math.abs(x) < 18) return false;
    if (z < 48.5) return false;
    if (Math.hypot(x - ax, z - 105) < 3.5) return false;
    return true;
  };
  const rng = k.rng;
  const trunks: Scatter[] = [];
  const crowns: Scatter[] = [];
  const nTrees = Math.round(250 * veg);
  for (let i = 0, tries = 0; i < nTrees && tries < nTrees * 12; tries++) {
    const x = rng.range(J.x0 + 1.5, J.x1 - 1.5);
    const z = rng.range(J.z0 + 6, J.z1 - 1.5);
    if (!clear(x, z, 3.6)) continue;
    const y = jungleHeight(x, z);
    if (y < -1) continue;
    const s = rng.range(0.75, 1.35);
    const h = 6.5 * s;
    trunks.push({ x, y: y - 0.3, z, s, rot: rng.next() * 6.28, hue: rng.next() });
    crowns.push({ x: x + rng.range(-0.6, 0.6), y: y + h * 0.92, z: z + rng.range(-0.6, 0.6), s: 3.1 * s, rot: rng.next() * 6.28, hue: rng.next() });
    crowns.push({ x: x + rng.range(-1.6, 1.6), y: y + h * 0.74, z: z + rng.range(-1.6, 1.6), s: 2.2 * s, rot: rng.next() * 6.28, hue: rng.next() });
    k.collider(RAPIER.ColliderDesc.cylinder(h / 2, 0.34 * s).setTranslation(x, y + h / 2 - 0.3, z), { surface: 'wood' });
    i++;
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.42, 6.5, 7, 1);
  trunkGeo.translate(0, 3.25, 0);
  const tuv = trunkGeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * 2, tuv.getY(i) * 3);
  instanced(k, trunkGeo, game.mats.get('bark'), trunks, { cast: true, tilt: 0.07 });
  instanced(k, canopyGeometry(), game.mats.get('foliage'), crowns, { cast: true, color: leafTint });
  yield;

  // Undergrowth: leafy blobs, then two sizes of leaf cards, densest along the trail edges.
  const shrubs: Scatter[] = [];
  const nShrubs = Math.round(330 * veg);
  for (let i = 0, tries = 0; i < nShrubs && tries < nShrubs * 10; tries++) {
    const z = rng.range(J.z0 + 5, J.z1 - 1.5);
    const near = rng.chance(0.6);
    const x = near ? jungleTrailX(z) + (rng.chance(0.5) ? -1 : 1) * rng.range(2.6, 8) : rng.range(J.x0 + 1, J.x1 - 1);
    if (x < J.x0 + 1 || x > J.x1 - 1 || !clear(x, z, 2.5)) continue;
    const y = jungleHeight(x, z);
    if (y < -1) continue;
    shrubs.push({ x, y: y + 0.25, z, s: rng.range(0.6, 1.5), rot: rng.next() * 6.28, hue: rng.next() });
    i++;
  }
  instanced(k, canopyGeometry(), game.mats.get('foliage'), shrubs, { cast: false, color: leafTint });
  const cards: Scatter[] = [];
  const grass: Scatter[] = [];
  const nCards = Math.round(900 * veg);
  for (let i = 0, tries = 0; i < nCards && tries < nCards * 8; tries++) {
    const z = rng.range(J.z0 + 4.5, J.z1 - 1);
    const near = rng.chance(0.7);
    const x = near ? jungleTrailX(z) + (rng.chance(0.5) ? -1 : 1) * rng.range(1.7, 11) : rng.range(J.x0 + 1, J.x1 - 1);
    if (x < J.x0 + 1 || x > J.x1 - 1 || !clear(x, z, 1.6)) continue;
    const y = jungleHeight(x, z);
    if (y < -0.9) continue;
    if (rng.chance(0.45)) cards.push({ x, y: y - 0.05, z, s: rng.range(0.8, 1.7), rot: rng.next() * 6.28, hue: rng.next() });
    else grass.push({ x, y: y - 0.05, z, s: rng.range(0.4, 0.8), rot: rng.next() * 6.28, hue: rng.next() });
    i++;
  }
  const cardMat = game.mats.get('leafCard');
  instanced(k, crossCardGeometry(1.5, 1.5), cardMat, cards, { cast: false, color: leafTint });
  instanced(k, crossCardGeometry(1.2, 0.9), cardMat, grass, { cast: false, color: leafTint });
  yield;

  // Boulders along the valley walls, a few fallen logs across the undergrowth.
  for (let i = 0; i < Math.round(26 * (0.5 + veg * 0.5)); i++) {
    const z = rng.range(J.z0 + 8, J.z1 - 3);
    const x = jungleTrailX(z) + (rng.chance(0.5) ? -1 : 1) * rng.range(6, 26);
    if (x < J.x0 + 2 || x > J.x1 - 2 || !clear(x, z, 5)) continue;
    rock(k, x, jungleHeight(x, z) - 0.2, z, rng.range(0.7, 2.1), { tint: 0.95 });
  }
  for (let i = 0; i < 5; i++) {
    const z = 100 + i * 13 + rng.range(-3, 3);
    if (Math.abs(z - J.riverZ) < 9) continue;
    const x = jungleTrailX(z) + (i % 2 ? -1 : 1) * rng.range(5.5, 9);
    const y = jungleHeight(x, z);
    k.boxRot(x, y + 0.28, z, 0.55, 0.55, rng.range(3, 5), rng.next() * 3.1, 'bark', { surface: 'wood' });
  }
}
