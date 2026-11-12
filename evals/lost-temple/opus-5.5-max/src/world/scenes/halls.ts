/**
 * Zone B: the broken halls behind the great door. Sun shafts fall through holes in the roof
 * and move with the real sun. The chasm room can be crossed three ways: sunstone tiles that
 * are solid only while sunlight reaches them, a narrow beam under swinging blades, or the
 * drawbridge once someone has lowered it from the far side. Beyond lie the inner halls with a
 * trapped pedestal, the east annex (top of the Bone Stair) and the two ways into the sanctum:
 * the main nave and a side aisle with a crumbling floor.
 */
import * as THREE from 'three';
import type { SceneDef, SceneCtx, SceneRuntime } from '../SceneDef';
import { box3 } from '../SceneDef';
import type { LevelBuilder } from '../LevelBuilder';
import { room } from './common';
import { SunstoneTiles } from '../props/puzzles';
import { SunShaft } from '../props/effects';
import { Blade, DartTrap, WeightedPedestal, CrumbleTiles } from '../props/traps';
import { Drawbridge, Lever, Sconce, SupplyCache } from '../props/mechanisms';

const ROOF_HOLES_ENTRANCE: [number, number, number, number][] = [[-2, -9, 2, -6]];
const ROOF_HOLES_INNER: [number, number, number, number][] = [
  [-13.5, -41.5, -10.5, -38.5],
  [-3.5, -46.5, -0.5, -43.5],
  [8.5, -40.5, 11.5, -37.5],
];
/** Chasm room roof: N-S beams over an open lattice. */
const CHASM_BEAMS_X = [-11, -8, -5, -2, 1, 4, 7, 10, 13];
const CHASM_CROSS_Z = [-24, -17];
export const SUNSTONE_CENTERS: [number, number][] = [];
for (const x of [-5, -3, -1, 1]) for (const z of [-27, -25, -23, -21]) SUNSTONE_CENTERS.push([x, z]);

/** Aisle crumble tiles over the pit (3 across x 2 m wide, 4 along z 1.5 m deep). */
const AISLE_TILES: [number, number, number, number][] = [];
for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) AISLE_TILES.push([-16 + k * 2, -59 + i * 1.5, -14 + k * 2, -57.5 + i * 1.5]);

export const halls: SceneDef = {
  id: 'halls',
  zone: 'B',
  env: 'interior',
  boxes: [box3(-36, -24, -62, 36, 20, -2)],
  spawns: {
    halls1: [0, 0, -46],
    halls2: [27, 0, -50],
  },
  mapRects: [
    [-8, -14, 8, -2],
    [-14, -20, 14, -14],
    [-14, -34, 14, -28],
    [-20, -50, 20, -34.5],
    [20.5, -58, 34, -42],
    [-4, -62, 4, -50.5],
    [-16, -62, -10, -50.5],
  ],
  respawn: [0, 0.1, -17],
  layout(b: LevelBuilder) {
    // ---- temple grounds between the buildings (seen only from the cliffs) ----
    const g = (x0: number, z0: number, x1: number, z1: number) => b.floor(x0, z0, x1, z1, -0.05, 'floorMoss', { nav: 'none', thick: 0.5, collider: false });
    g(-36, -20, 36, -2);
    g(-36, -28, -14.5, -20);
    g(14.5, -28, 36, -20);
    g(-36, -55, 36, -28);
    g(-36, -57, -16.5, -55);
    g(-9.5, -57, 36, -55);
    // leave room for the Bone Stair corridor that climbs up into the annex
    g(-36, -62, 25.5, -57);
    g(30.5, -62, 36, -57);

    // ---- entrance hall ----
    room(b, -8, -14, 8, -2, 0, 9, { n: 'none', s: 'none', wall: 'sandstone', floor: 'floor', holes: ROOF_HOLES_ENTRANCE });
    b.floor(-3.5, -2, 3.5, 0, 0, 'floor');
    for (const sx of [-1, 1]) {
      b.box(sx * 6, 0.5, -8, 1.1, 1.0, 1.1, 'glyphs');
      b.pillar(sx * 4.5, -4, 0, 9, 0.5, 'sandstone');
      b.pillar(sx * 4.5, -12, 0, 9, 0.5, 'sandstone', { broken: sx > 0 });
      // glyph panels
      b.box(sx * 7.95, 4, -8, 0.1, 4.5, 7, 'glyphs', { nav: 'none', collider: false });
    }
    // fallen ceiling slab and rubble
    b.box(5.2, 0.35, -11.2, 2.6, 0.7, 1.6, 'sandstone', { rot: new THREE.Euler(0.1, 0.4, 0.15) });
    if (!b.navOnly) for (let i = 0; i < 6; i++) b.rock(4 + b.rng.next() * 3, 0.15, -13 + b.rng.next() * 3, 0.25 + b.rng.next() * 0.3, 'sandstone', { collider: false });

    // ---- chasm room ----
    // floors are the tops of thick blocks so the pit has walls
    b.floor(-14, -20, 14, -14, 0, 'floor', { thick: 22 });
    b.floor(-14, -34, 14, -28, 0, 'floor', { thick: 22 });
    b.floor(-14, -28, 14, -20, -20, 'rock', { nav: 'none', thick: 2 });
    if (!b.navOnly) for (let i = 0; i < 16; i++) b.rock(-13 + b.rng.next() * 26, -19.6, -27.5 + b.rng.next() * 7, 0.4 + b.rng.next() * 0.9, 'sandstone', { collider: false });
    b.kill(-14, -24, -28, 14, -12, -20, 'abyss');
    b.wallZ(-34.5, -14, -14.5, -14, -22, 10, 'sandstone');
    b.wallZ(-34.5, -14, 14, 14.5, -22, 10, 'sandstone');
    b.wallX(-14.5, 14.5, -14.5, -14, 0, 10, 'sandstone', [[-3, 3, 5.5]]);
    // shared wall with the inner halls (two doorways)
    b.wallX(-20.5, 20.5, -34.5, -34, 0, 10, 'sandstone', [[-3, 3, 5.5], [9, 13, 5.5]]);
    // floors under every doorway so walking (and the navmesh) is continuous
    b.floor(-3, -34.5, 3, -34, 0, 'floor');
    b.floor(9, -34.5, 13, -34, 0, 'floor');
    b.floor(20, -48, 20.5, -44, 0, 'floor');
    b.floor(-4, -50.5, 4, -50, 0, 'floor');
    b.floor(-16, -50.5, -10, -50, 0, 'floor');
    // roof: a solid band at the north end, then a lattice of beams
    b.box(0, 10.35, -32.75, 29, 0.7, 3.5, 'sandstone', { nav: 'none' });
    for (const x of CHASM_BEAMS_X) b.box(x, 10.35, -22.75, 1, 0.7, 16.5, 'sandstone', { nav: 'none', vary: 0.08 });
    for (const z of CHASM_CROSS_Z) b.box(0, 10.35, z, 29, 0.7, 1, 'sandstone', { nav: 'none', vary: 0.08 });
    // blade beam across the pit, with the blades hanging from the x = -11 roof beam
    b.box(-11, -0.3, -24, 1.2, 0.6, 8, 'sandstone', { nav: 'none' });
    b.box(-11, -0.8, -24, 0.6, 0.4, 8, 'sandstone', { nav: 'none', collider: false });
    // drawbridge walk (gated until lowered) and the stone lugs it rests on
    b.navWalk(9, -28, 13, -20, 0, 'drawbridge');
    b.box(11, -0.45, -20.25, 4.4, 0.5, 0.5, 'sandstone', { nav: 'none' });
    // carved warning on the south wall
    b.box(-8, 4.2, -14.05, 6, 3, 0.1, 'glyphs', { nav: 'none', collider: false });

    // ---- inner halls ----
    room(b, -20, -50, 20, -34.5, 0, 9, { n: 'none', s: 'none', e: 'none', wall: 'sandstone', floor: 'floor', holes: ROOF_HOLES_INNER });
    b.wallX(-20.5, 20.5, -50.5, -50, 0, 9, 'sandstone', [[-16, -10, 5], [-4, 4, 7]]);
    b.wallZ(-58, -34.5, 20, 20.5, 0, 9, 'sandstone', [[-48, -44, 5]]);
    for (const sx of [-1, 1]) for (const z of [-38, -42.5, -47]) b.pillar(sx * 7, z, 0, 9, 0.6, 'sandstone', { broken: sx < 0 && z === -38 });
    // fallen pillar drums and a collapsed corner
    b.cylinder(-4.8, -37.4, 0.55, 3.8, 0.55, 'sandstone', { rot: new THREE.Euler(0, 0.3, Math.PI / 2), nav: 'none' });
    b.navBlock(-6.8, -38.4, -2.8, -36.4, 0, 1.1);
    b.box(16.5, 1.2, -36.6, 6, 2.4, 3.6, 'sandstone', { rot: new THREE.Euler(0.2, 0.15, -0.1) });
    // pedestal dais (the pedestal itself is a prop; keep guardians off it)
    b.box(0, 0.12, -42, 3.4, 0.24, 3.4, 'glyphs');
    b.navBlock(-0.6, -42.6, 0.6, -41.4, 0, 1.4);
    // offering niches along the west wall
    for (const z of [-37, -45]) b.box(-19.6, 1.1, z, 0.8, 0.2, 1.6, 'sandstone', { nav: 'none' });

    // ---- east annex (top of the Bone Stair) ----
    room(b, 20.5, -58, 34, -42, 0, 7, { w: 'none', n: [[26, 30, 3.8]], wall: 'sandstone', floor: 'floor' });
    b.box(32.5, 0.6, -45, 1.6, 1.2, 1.6, 'sandstone');
    b.box(23.2, 0.4, -55.6, 1.2, 0.8, 2.2, 'darkWood', { rotY: 0.2 });

    // ---- nave and side aisle ----
    room(b, -4, -62, 4, -50.5, 0, 7, { n: 'open', s: 'none', wall: 'sandstone', floor: 'floor' });
    b.navWalk(-4, -62, 4, -60, 0, 'nave');
    for (const z of [-53, -57]) for (const sx of [-1, 1]) b.box(sx * 3.7, 2.8, z, 0.6, 5.6, 0.6, 'sandstone', { nav: 'none' });
    // aisle: solid ends, a pit in the middle under crumbling tiles
    room(b, -16, -62, -10, -50.5, 0, 6, { n: 'open', s: 'none', wall: 'sandstone', floor: null });
    b.floor(-16, -53, -10, -50.5, 0, 'floor');
    b.floor(-16, -62, -10, -59, 0, 'floor');
    b.floor(-16, -59, -10, -53, -2.2, 'rock', { nav: 'none', thick: 0.6 });
    b.wallZ(-59, -53, -16.5, -16, -2.8, 0, 'sandstone', [], { nav: 'none' });
    b.wallZ(-59, -53, -10, -9.5, -2.8, 0, 'sandstone', [], { nav: 'none' });
    b.spikes(-16, -57, -11.6, -55, -2.2);
    // the rock under the aisle's solid ends meets the pit
    b.wallX(-16, -10, -59.2, -59, -2.8, 0, 'sandstone', [], { nav: 'none' });
    b.wallX(-16, -10, -53, -52.8, -2.8, 0, 'sandstone', [], { nav: 'none' });
    // the crumbling tiles are walkable until they fall (the props switch them off)
    for (const [x0, z0, x1, z1] of AISLE_TILES) b.navWalk(x0, z0, x1, z1, 0);
  },
  *props(ctx: SceneCtx, rt: SceneRuntime) {
    // sun shafts
    rt.addProp(new SunShaft(ctx, rt, 'shaftEntrance', ROOF_HOLES_ENTRANCE[0], 9, 0, 1.2));
    ROOF_HOLES_INNER.forEach((h, i) => rt.addProp(new SunShaft(ctx, rt, 'shaftInner' + i, h, 9, 0, 1)));
    rt.addProp(new SunShaft(ctx, rt, 'shaftChasmA', [-4.5, -31, -2.5, -17.5], 10, 0, 0.45));
    rt.addProp(new SunShaft(ctx, rt, 'shaftChasmB', [1.5, -31, 3.5, -17.5], 10, 0, 0.45));
    yield;

    // sunstones over the chasm
    rt.addProp(new SunstoneTiles(ctx, rt, 'sunstones', SUNSTONE_CENTERS, 0, 1.9));
    // blades over the beam
    rt.addProp(new Blade(ctx, rt, 'bladeA', new THREE.Vector3(-11, 9.95, -26.5), 'z', 9.05, 0.3, 2.9, 0));
    rt.addProp(new Blade(ctx, rt, 'bladeB', new THREE.Vector3(-11, 9.95, -24), 'z', 9.05, 0.3, 2.9, 2.1));
    rt.addProp(new Blade(ctx, rt, 'bladeC', new THREE.Vector3(-11, 9.95, -21.5), 'z', 9.05, 0.3, 2.9, 4.2));
    // drawbridge and its lever on the far side
    const bridge = rt.addProp(new Drawbridge(ctx, rt, 'drawbridge', new THREE.Vector3(11, 0, -28), 4, 8));
    rt.addProp(
      new Lever(ctx, rt, 'drawLever', [12.8, 0, -31.8], Math.PI, 'E  Pull the lever (lower the drawbridge)', () => {
        bridge.lower();
        ctx.toast('Chains rattle. The drawbridge drops across the chasm.', 'good');
        ctx.mapMark(11, -24, 'drawbridge');
      }, ctx.run.flag('drawbridgeLowered')),
    );
    yield;

    // relics
    const R = ctx.relics;
    R.relicSpawn('h1', 'halls', 'B', [-6, 1.0, -8]);
    R.relicSpawn('h2', 'halls', 'B', [6, 1.0, -8]);
    R.relicSpawn('hc', 'halls', 'B', [-12.6, 0, -32.6], { minRarity: 'uncommon' });
    R.relicSpawn('h3', 'halls', 'B', [-17, 0, -37]);
    R.relicSpawn('h4', 'halls', 'B', [17, 0, -48]);
    R.relicSpawn('h6', 'halls', 'B', [32.5, 1.2, -45], { minRarity: 'uncommon' });
    R.relicSpawn('h7', 'halls', 'B', [-13, 0, -61], { minRarity: 'uncommon' });
    // trapped pedestal: a gem urn armed at its own weight; three sandbags lie nearby
    const pedTop: [number, number, number] = [0, 1.3, -42];
    const urn = R.relicSpawn('h5', 'halls', 'B', pedTop, { type: 'gemUrn' });
    R.weightSpawn('sandbag2', 'halls', 'sandbag', 2, [-18.2, 0, -48.6], 0.3);
    R.weightSpawn('sandbag4', 'halls', 'sandbag', 4, [-17.2, 0, -49.1], 1.1);
    R.weightSpawn('sandbag7', 'halls', 'sandbag', 7, [-18.4, 0, -47.4], 2.0);
    const darts = rt.addProp(
      new DartTrap(ctx, rt, 'pedestalDarts', [], [
        { pos: new THREE.Vector3(-6.35, 1.0, -42.5), dir: new THREE.Vector3(1, 0, 0.25) },
        { pos: new THREE.Vector3(6.35, 1.0, -42.5), dir: new THREE.Vector3(-1, 0, 0.25) },
        { pos: new THREE.Vector3(-6.35, 1.35, -42.5), dir: new THREE.Vector3(1, 0, 0.02) },
        { pos: new THREE.Vector3(6.35, 1.35, -42.5), dir: new THREE.Vector3(-1, 0, -0.02) },
        { pos: new THREE.Vector3(-6.35, 1.7, -42.5), dir: new THREE.Vector3(1, -0.02, -0.25) },
        { pos: new THREE.Vector3(6.35, 1.7, -42.5), dir: new THREE.Vector3(-1, -0.02, -0.25) },
      ]),
    );
    rt.addProp(
      new WeightedPedestal(ctx, rt, 'urnPedestal', pedTop, urn.uid, urn.mass, () => {
        darts.fire();
        ctx.toast('Click. Darts hiss from the pillars!', 'bad');
        ctx.noise(new THREE.Vector3(0, 1, -42), 1.0, 'trap', false);
      }),
    );
    // sconces
    rt.addProp(new Sconce(ctx, rt, 'hallSconceW', [-19.75, 2.3, -41.5], Math.PI / 2));
    rt.addProp(new SupplyCache(ctx, rt, 'hallsOil', 'oil', [-15.8, 0, -36.2], 0.4));
    rt.addProp(new Sconce(ctx, rt, 'hallSconceE', [19.75, 2.3, -38], -Math.PI / 2));
    rt.addProp(new Sconce(ctx, rt, 'annexSconce', [27, 2.3, -42.25], 0));
    yield;

    // crumbling aisle
    rt.addProp(
      new CrumbleTiles(ctx, rt, 'aisle', AISLE_TILES, 0, 'floor', (i) => {
        const [x0, z0, x1, z1] = AISLE_TILES[i];
        ctx.nav.setRect(x0, z0, x1, z1, 0, false, 0.5);
      }),
    );
    // tiles that already fell earlier in the run stay out of the navmesh
    const fallen = (ctx.run.get('crumble:aisle') as number[] | undefined) ?? [];
    for (const i of fallen) {
      const [x0, z0, x1, z1] = AISLE_TILES[i];
      ctx.nav.setRect(x0, z0, x1, z1, 0, false, 0.5);
    }
  },
};
