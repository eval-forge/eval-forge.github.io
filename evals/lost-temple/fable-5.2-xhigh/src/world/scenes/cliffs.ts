/** Scene 3: Outer Cliffs. Optional, exposed, windy, and worth it. */
import * as THREE from 'three';
import { RAPIER } from '../../engine/physics';
import { RopeLine, Vines } from '../entities/env';
import { PlankBridge, WindGusts } from '../entities/traps';
import type { SceneKit } from '../kit';
import { CLIFFS } from '../layout/cliffs';
import { crossCardGeometry, instanced, leafTint, mural, rock, supply, type Scatter } from './common';

export function* buildCliffs(k: SceneKit): Generator<void> {
  const game = k.game;
  const C = CLIFFS;
  const veg = game.renderer.quality.vegetation;
  const R = 'rock';
  const cliff = { shade: [0.45, 1] as [number, number] };

  k.floorsFromLayout();
  // ----------------------------------------------------------- the plateau
  // Everything west of the face (x = 42) is solid rock; the walkable clifftop is cut into its top.
  k.box(32, -46, -45, 42, -2, 48, R, cliff);
  k.box(32, -2, -13, 42, -0.01, -4, R, { surface: 'stone' }); // clifftop extension north to the shelf
  k.box(32, -2, 16, 42, 7.5, 48, R, cliff); // rock rising south of the clifftop
  k.box(34, -2, -22.5, 42, 3.2, -13, R, cliff); // the shelf: a one-way step down from the outcrop
  k.box(34, -2, -31, 42, C.outcrop.y, -22.5, R, cliff); // the outcrop
  k.box(42, 5.3, -31, 44.2, C.outcrop.y, -25, R, { shade: [0.7, 1] }); // its overhang above the traverse
  k.box(32, -2, -45, 34, 11, -13, R, cliff); // spine against the temple wall
  k.box(34, -2, -45, 42, 11.5, -31, R, cliff); // headland closing the north end
  yield;
  for (let i = 0; i < 9; i++) {
    rock(k, 42.3, -8 - i * 3.6, -40 + i * 9.5, 2.4 + (i % 3) * 0.6, { squash: 1.2, solid: false });
    rock(k, 41.6, -24 + (i % 4) * 5, -42 + i * 10.2, 3 + (i % 2), { squash: 1.3, solid: false });
  }
  for (const [x, z, r] of [[33.6, 14.6, 1.6], [40.6, 15.2, 1.3], [35.2, -11.8, 1.1], [40.8, -3.2, 0.7], [33.4, 9.6, 0.8]] as const) rock(k, x, 0, z, r);
  // A low parapet along the edge, broken where the vines go over.
  k.box(41.5, 0, 3.2, 42, 0.5, 16, R, { tint: 0.9 });
  k.box(41.5, 0, -13, 42, 0.5, -0.4, R, { tint: 0.9 });

  // ------------------------------------------------------- ledges and spire
  const l1 = C.ledge1;
  const l2 = C.ledge2;
  const tr = C.traverse;
  const sp = C.spire;
  k.box(l1.x0, l1.y - 1.6, l1.z0, l1.x1, l1.y, l1.z1, R, { shade: [0.6, 1] });
  k.box(l2.x0, l2.y - 1.6, l2.z0, l2.x1, l2.y, l2.z1, R, { shade: [0.6, 1] });
  k.box(tr.x0, tr.y - 1.1, tr.z0, tr.x1, tr.y, tr.z1, R, { shade: [0.6, 1] });
  k.box(tr.x0, tr.y - 1.4, tr.z0, tr.x1 + 0.9, tr.y, tr.z0 + 3.4, R, { shade: [0.6, 1] }); // bridge head
  k.box(sp.x0, sp.y - 3.4, sp.z0, sp.x1, sp.y, sp.z1, R, { shade: [0.6, 1] });
  k.cyl((sp.x0 + sp.x1) / 2, -46, (sp.z0 + sp.z1) / 2, 3.9, 46 + sp.y - 3.3, R, { seg: 9, rTop: 3.3, shade: [0.4, 1] });
  rock(k, sp.x1 - 0.9, sp.y, sp.z0 + 1, 0.8);
  rock(k, sp.x0 + 4.6, sp.y, sp.z1 - 0.8, 0.6);
  yield;

  // ----------------------------------------------------------------- vines
  k.add(new Vines(game, k.group, 42.0, 1.4, 2.4, l1.y, 0, 1, 0, true));
  k.add(new Vines(game, k.group, 42.0, -23.5, 1.7, l2.y, C.outcrop.y, 1, 0, true));
  // Hand-line across the gap between the two ledges (needs a rope from the shop).
  k.add(new RopeLine(game, k, 'cliffs.rope', { x: 43.3, y: l1.y, z: l1.z0 + 0.25 }, { x: 43.3, y: l2.y, z: l2.z1 - 0.25 }, false));

  // ------------------------------------------------------------------ wind
  k.add(new WindGusts(game, { x0: 41, y0: -6, z0: -38, x1: 55, y1: 8, z1: -24.6 }, { x: 1, y: 0, z: 0 }, [4.5, 8.5]));

  // ---------------------------------------------------------- spire bridge
  const b = C.bridge;
  k.add(
    new PlankBridge(game, k.group, 'cliffs.bridge', { x: b.x0 + 0.9, y: b.y, z: b.z }, { x: b.x1, y: b.y, z: b.z }, {
      planks: 9, width: 1.5, crackDelay: 0.7, rotten: [2, 4, 5, 7], dark: false,
    }),
  );
  for (const s of [-1, 1]) {
    k.box(b.x0 + 0.5, b.y, b.z + s * 0.85 - 0.12, b.x0 + 0.8, b.y + 1.3, b.z + s * 0.85 + 0.12, 'wood', { surface: 'wood' });
    k.box(b.x1 + 0.1, b.y, b.z + s * 0.85 - 0.12, b.x1 + 0.4, b.y + 1.3, b.z + s * 0.85 + 0.12, 'wood', { surface: 'wood' });
  }
  yield;

  // ------------------------------------------------------------------- sea
  {
    const g = new THREE.PlaneGeometry(260, 300, 1, 1);
    g.rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 40, uv.getY(i) * 46);
    const sea = game.mats.mesh(g, 'water', false);
    sea.position.set(42 + 125, C.seaY, 0);
    sea.receiveShadow = false;
    sea.renderOrder = 5;
    k.group.add(sea);
    // Rocks in the surf at the foot of the cliff.
    for (let i = 0; i < 10; i++) rock(k, 45 + (i % 3) * 5, C.seaY - 1, -44 + i * 9.3, 2.5 + (i % 4), { solid: false, squash: 0.9 });
  }
  k.collider(RAPIER.ColliderDesc.cuboid(0.5, 40, 50).setTranslation(100, -10, 0), { surface: 'stone' });

  // ------------------------------------------------------------- dressing
  supply(k, 'nookFlask', 'flask', l2.x0 + 0.5, l2.y, l2.z0 + 3.2, false);
  mural(k, 'wind', ['hand', 'wave', 'arrow', 'skull'], 42, l2.y + 1.5, l2.z0 + 1.6, 1, 0, { dark: false, accent: 'wave', height: 0.8 });
  mural(k, 'gate', ['eye', 'arrow', 'sun'], 34.5, 1.6, 16, 0, -1, { dark: false, height: 0.9 });
  k.prop('rockA', 'rock', 3, 36.6, 0.3, 11.5);
  k.prop('rockB', 'rock', 1.2, 43.2, l1.y + 0.3, -2);
  const rng = k.rng;
  const tufts: Scatter[] = [];
  for (let i = 0; i < Math.round(90 * veg); i++) {
    tufts.push({ x: rng.range(32.4, 41.3), y: -0.04, z: rng.range(-12.5, 15.5), s: rng.range(0.35, 0.8), rot: rng.next() * 6.28, hue: rng.next() });
  }
  for (let i = 0; i < Math.round(26 * veg); i++) {
    tufts.push({ x: rng.range(35, 41.6), y: C.outcrop.y - 0.04, z: rng.range(-30.5, -23), s: rng.range(0.35, 0.7), rot: rng.next() * 6.28, hue: rng.next() });
  }
  instanced(k, crossCardGeometry(1.2, 0.9), game.mats.get('leafCard'), tufts, { color: leafTint });
}
