/**
 * Zone A (optional): the outer cliffs. A shelf above a bottomless canyon, a staircase of
 * ledges up the cliff face (mantle, then climb the vines), a windswept plateau with a ruined
 * watchtower, and the Eagle's Nest on a rock spire that only a rope reaches. The best loot of
 * Zone A is up here, and the wind wants you off the edge.
 */
import * as THREE from 'three';
import type { SceneDef, SceneCtx, SceneRuntime } from '../SceneDef';
import { box3 } from '../SceneDef';
import type { LevelBuilder } from '../LevelBuilder';
import { Vegetation } from '../../render/vegetation';
import { Rng } from '../../logic/rng';
import { RopeAnchor } from '../props/mechanisms';

export const SPIRE = { x: 60, z: -6, r: 2.6, top: 20 };
export const PLATEAU_Y = 14;

/** Ledges up the cliff face: [x0, z0, x1, z1, top]. */
const LEDGES: [number, number, number, number, number][] = [
  [56, 16, 62, 19, 2.0],
  [50, 16, 56, 18.5, 4.2],
  [44, 16, 50, 18, 6.3],
  [38, 16, 44, 19.5, 11],
];

export const cliffs: SceneDef = {
  id: 'cliffs',
  zone: 'A',
  env: 'outdoor',
  boxes: [box3(34, -80, -30, 100, 50, 62)],
  respawn: [38, 0.1, 24],
  mapRects: [
    [34, 20, 42, 28],
    [42, 16, 64, 34],
    [34, -30, 95, 16],
  ],
  layout(b: LevelBuilder) {
    // cliff path and shelf over the canyon
    b.wall(34, 20, 42, 28, -60, 0, 'rockMoss', { nav: 'none', tex: 0.2 });
    b.wall(42, 16, 64, 34, -60, 0, 'rockMoss', { nav: 'none', tex: 0.2 });
    // the cliff mass and its plateau
    b.wall(34, -30, 95, 16, -60, PLATEAU_Y, 'rock', { nav: 'none', tex: 0.15 });
    // ledges (solid blocks attached to the face)
    for (const [x0, z0, x1, z1, top] of LEDGES) b.wall(x0, z0, x1, z1, 0, top, 'rockMoss', { nav: 'none', tex: 0.3 });
    // vines: from the third ledge up the fourth ledge's east face, then up the cliff to the plateau
    b.vines('cliffVineA', 43.9, 6.3, 16.2, 44.05, 11, 19.3, [1, 0, 0], 1.8);
    b.vines('cliffVineB', 38.4, 11, 15.4, 41.6, PLATEAU_Y, 16, [0, 0, 1], 1.8);
    // rough rock dressing on the faces
    for (let i = 0; i < 26; i++) {
      const x = 36 + b.rng.next() * 56;
      const y = -50 + b.rng.next() * 60;
      b.rock(x, y, 16.6 + b.rng.next() * 0.5, 1.2 + b.rng.next() * 1.6, 'rock', { collider: false, squash: 0.45 });
    }
    for (let i = 0; i < 16; i++) {
      const z = 17 + b.rng.next() * 16;
      b.rock(64.4 + b.rng.next() * 0.6, -50 + b.rng.next() * 48, z, 1.2 + b.rng.next() * 1.4, 'rockMoss', { collider: false, squash: 0.45 });
      const x = 43 + b.rng.next() * 20;
      b.rock(x, -50 + b.rng.next() * 48, 34.5, 1.2 + b.rng.next() * 1.4, 'rockMoss', { collider: false, squash: 0.45 });
    }
    // boulders on the shelf and plateau
    for (const [x, z, r] of [[46, 31, 1.0], [61, 21, 1.3], [63, 31, 0.8], [52, 23, 0.7]] as const) b.rock(x, 0.2, z, r, 'rockMoss', { squash: 0.65 });
    for (let i = 0; i < 18; i++) {
      const x = 38 + b.rng.next() * 54;
      const z = -27 + b.rng.next() * 40;
      if (Math.hypot(x - SPIRE.x, z - SPIRE.z) < 5 || (x > 78 && z < -12) || (x < 46 && z > 10)) continue;
      b.rock(x, PLATEAU_Y + 0.1, z, 0.6 + b.rng.next() * 1.3, 'rockMoss', { squash: 0.6 });
    }
    // the rock spire and the Eagle's Nest
    b.cylinder(SPIRE.x, SPIRE.z, PLATEAU_Y - 0.5, SPIRE.top - PLATEAU_Y + 0.5, SPIRE.r, 'rock', { rTop: SPIRE.r * 0.92, seg: 10, nav: 'none' });
    if (!b.navOnly) {
      const sticks: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 34; k++) {
        const a = (k / 34) * Math.PI * 2 + b.rng.next() * 0.2;
        const r = 1.0 + b.rng.next() * 0.5;
        const g = new THREE.CylinderGeometry(0.04, 0.05, 1.3 + b.rng.next() * 0.6, 4);
        g.rotateZ(Math.PI / 2 + (b.rng.next() - 0.5) * 0.5);
        g.rotateY(-a + Math.PI / 2 + (b.rng.next() - 0.5) * 0.8);
        g.translate(SPIRE.x + Math.cos(a) * r, SPIRE.top + 0.12 + b.rng.next() * 0.25, SPIRE.z + Math.sin(a) * r);
        sticks.push(g);
      }
      for (const g of sticks) b.mesh(g, 'bark', { cast: true });
    }
    // a dead branch jutting from the nest, where a thrown rope can catch
    b.box(SPIRE.x, SPIRE.top + 0.15, SPIRE.z + SPIRE.r - 0.2, 0.3, 0.3, 1.9, 'darkWood', { nav: 'none', collider: false, rot: new THREE.Euler(0.12, 0, 0) });

    // ruined watchtower on the plateau
    const tx = 85;
    const tz = -19;
    b.wall(tx - 4, tz - 4, tx + 4, tz - 3.4, PLATEAU_Y, PLATEAU_Y + 6.5, 'sandstoneMoss', { nav: 'none' });
    b.wall(tx - 4, tz - 3.4, tx - 3.4, tz + 4, PLATEAU_Y, PLATEAU_Y + 4.8, 'sandstoneMoss', { nav: 'none' });
    b.wall(tx + 3.4, tz - 3.4, tx + 4, tz + 1, PLATEAU_Y, PLATEAU_Y + 3.2, 'sandstoneMoss', { nav: 'none' });
    b.wall(tx - 3.4, tz + 3.4, tx - 1, tz + 4, PLATEAU_Y, PLATEAU_Y + 2.2, 'sandstoneMoss', { nav: 'none' });
    b.floor(tx - 3.4, tz - 3.4, tx + 3.4, tz + 3.4, PLATEAU_Y + 0.12, 'floorMoss', { nav: 'none', thick: 0.3 });
    b.box(tx + 1.5, PLATEAU_Y + 0.6, tz + 2.6, 1.6, 1.0, 1.0, 'sandstoneMoss', { rotY: 0.5, nav: 'none' });
    b.vines('towerVines', tx - 3, PLATEAU_Y + 1, tz - 3.4, tx + 1, PLATEAU_Y + 6.4, tz - 3.4, [0, 0, 1], 1.2, false);

    // canyon below: a floor far down that fog mostly hides, and the far wall
    b.floor(30, -40, 125, 75, -60, 'rock', { nav: 'none', thick: 2 });
    b.wall(110, -40, 122, 75, -60, 26, 'rock', { nav: 'none', tex: 0.12 });
    for (let i = 0; i < 14; i++) b.rock(70 + b.rng.next() * 40, -59, 20 + b.rng.next() * 50, 2 + b.rng.next() * 3, 'rock', { collider: false });

    // death below, wind above
    b.kill(30, -80, -40, 125, -32, 75, 'abyss');
    // wind strengths are peak gust push speeds in m/s (gusts come and go)
    b.wind(34, PLATEAU_Y - 0.5, -30, 95, PLATEAU_Y + 12, 16, [0.45, 0, 1], 3.4);
    b.wind(36, 0, 16, 64, PLATEAU_Y, 21, [0.3, 0, 1], 2.2);
    b.wind(42, 0, 21, 64, 6, 34, [0.6, 0, 1], 1.7);
  },
  props(ctx: SceneCtx, rt: SceneRuntime) {
    // rope over the nest beam
    rt.addProp(new RopeAnchor(ctx, rt, 'nestRope', [SPIRE.x, SPIRE.top + 0.1, SPIRE.z + SPIRE.r + 0.4], PLATEAU_Y, [0, 0, 1]));
    // relics: the best of Zone A
    ctx.relics.relicSpawn('cl1', 'cliffs', 'A', [52, 0, 30.5]);
    ctx.relics.relicSpawn('cl2', 'cliffs', 'A', [47, 6.3, 17], { type: 'featheredCrown' });
    ctx.relics.relicSpawn('cl3', 'cliffs', 'A', [70, PLATEAU_Y, 5], { minRarity: 'uncommon' });
    ctx.relics.relicSpawn('cl4', 'cliffs', 'A', [86.5, PLATEAU_Y + 0.12, -20], { minRarity: 'rare' });
    ctx.relics.relicSpawn('cl5', 'cliffs', 'A', [SPIRE.x - 0.3, SPIRE.top + 0.05, SPIRE.z - 0.2], { type: 'condorStatuette' });
    ctx.relics.relicSpawn('cl6', 'cliffs', 'A', [59.5, 2.0, 17.6]);

    // hardy plants clinging to the rock
    const q = ctx.quality;
    const vq = q === 'low' ? 0.45 : q === 'medium' ? 0.75 : 1;
    const rng = new Rng(4242);
    const plateau = (x: number, z: number) => {
      if (Math.hypot(x - SPIRE.x, z - SPIRE.z) < SPIRE.r + 0.6) return null;
      if (Math.abs(x - 85) < 4.5 && Math.abs(z + 19) < 4.5) return null;
      return PLATEAU_Y - 0.05;
    };
    const shelf = (x: number, z: number) => {
      if (x > 42 && x < 63.5 && z > 19.5 && z < 33.5) return -0.05;
      if (x > 34 && x < 42 && z > 20.5 && z < 27.5) return -0.05;
      return null;
    };
    const grass = [
      ...Vegetation.scatter(rng, Math.round(500 * vq), 35, -29, 94, 15.5, plateau, 0.7, 1.3),
      ...Vegetation.scatter(rng, Math.round(160 * vq), 34, 16, 64, 34, shelf, 0.6, 1.1),
    ];
    const bushes = Vegetation.scatter(rng, Math.round(26 * vq), 35, -29, 94, 15, plateau, 0.6, 1.1);
    const ferns = Vegetation.scatter(rng, Math.round(40 * vq), 34, 16, 64, 34, shelf, 0.5, 1.0);
    const trees = Vegetation.scatter(rng, Math.round(6 * vq), 40, -28, 92, 8, plateau, 0.55, 0.8);
    for (const [k, list] of [['grass', grass], ['bush', bushes], ['fern', ferns], ['trunk', trees], ['canopy', trees]] as const) {
      const im = ctx.veg.instances(k, list);
      if (im) rt.group.add(im);
    }
    for (const t of trees) rt.addTreeCollider(ctx, t.x, t.y, t.z, 0.5 * t.s, 5);
  },
};
