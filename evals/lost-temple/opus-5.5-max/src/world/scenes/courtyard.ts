/**
 * Zone A: the temple courtyard. An overgrown plaza in front of the temple facade with toppled
 * pillars, two pressure plates that open the great door (the only way in and out of the
 * temple), the haul cart where loot is banked, and the sundial whose ring must be turned until
 * the carved Eye sits in the gnomon's real shadow.
 */
import * as THREE from 'three';
import type { SceneDef, SceneCtx, SceneRuntime } from '../SceneDef';
import { box3 } from '../SceneDef';
import type { LevelBuilder } from '../LevelBuilder';
import { WorldNoise } from '../../render/noise';
import { Vegetation } from '../../render/vegetation';
import { Rng } from '../../logic/rng';
import { PressurePlate, PushBlock, SlidingSlab, HaulCart } from '../props/mechanisms';
import { Sundial } from '../props/puzzles';
import { boxMesh } from '../props/util';

const wn = new WorldNoise(23);
const ss = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const PLAZA = { x0: -30, z0: 0, x1: 30, z1: 44 };
export const SUNDIAL_CENTER = new THREE.Vector3(0, 0.6, 30);
export const DOOR = { x0: -3.5, x1: 3.5, z0: -2, z1: 0, h: 7 };
export const CART_POS: [number, number, number] = [-14, 0, 4.5];

/** Distance from a point to the plaza rectangle (0 inside). */
function plazaDist(x: number, z: number) {
  const dx = Math.max(PLAZA.x0 - x, 0, x - PLAZA.x1);
  const dz = Math.max(PLAZA.z0 - z, 0, z - PLAZA.z1);
  return Math.hypot(dx, dz);
}

export function courtyardHeight(x: number, z: number): number {
  let h = wn.fbm(x * 0.04, z * 0.04, 3) * 1.4 + 0.25;
  // west cliff foot
  if (x < -40) h += (-40 - x) * (-40 - x) * 0.25;
  // the approach path from the bridge and the west plaza stay level
  const dPath = Math.abs(x - 2 + (z - 62) * 0.02);
  if (z > 40) h = lerp(h, 0.05, ss(5, 1.5, dPath) * 0.95);
  const dWest = Math.max(Math.abs(x + 37.5) - 6, Math.abs(z - 40) - 10, 0);
  h = lerp(h, 0.02, ss(3, 0, dWest));
  // gorge rim meets the jungle's north gorge wall at y = 0
  h = lerp(h, 0, ss(57, 61.5, z));
  // the plaza slab sits on top
  const d = plazaDist(x, z);
  h = lerp(-0.35, h, ss(0.4, 4, d));
  // east strip leading to the cliff path
  if (x > 29 && z > 18 && z < 30) h = lerp(h, -0.35, ss(31, 29.5, Math.abs(z - 24) + 25));
  return h;
}

function groundColor(x: number, z: number, h: number): THREE.Color {
  const n = wn.noise(x * 0.23, z * 0.23) * 0.5 + 0.5;
  const c = new THREE.Color().setHSL(0.1 + n * 0.04, 0.3, 0.3 + n * 0.1);
  const moss = new THREE.Color().setHSL(0.23, 0.45, 0.22 + n * 0.08);
  c.lerp(moss, 0.55 + 0.3 * n);
  if (h > 1.2) c.lerp(new THREE.Color(0.36, 0.33, 0.3), Math.min(1, (h - 1.2) * 0.3));
  return c;
}

const PILLARS: { x: number; z: number; broken: boolean }[] = [
  { x: -10.5, z: 12, broken: false },
  { x: 10.5, z: 12, broken: false },
  { x: -10.5, z: 20, broken: true },
  { x: 10.5, z: 20, broken: false },
  { x: -10.5, z: 36, broken: false },
  { x: 10.5, z: 36, broken: true },
  { x: -10.5, z: 42, broken: true },
  { x: 10.5, z: 42, broken: false },
];

export const courtyard: SceneDef = {
  id: 'courtyard',
  zone: 'A',
  env: 'outdoor',
  boxes: [box3(-50, -10, -2, 34, 45, 62)],
  mapRects: [
    [-30, 0, 30, 44],
    [-44, 30, -31, 50],
    [-4, 44, 8, 62],
    [29, 20, 34, 28],
  ],
  layout(b: LevelBuilder) {
    b.terrain(-46, -2, 34, 62, 2, courtyardHeight, 'ground', groundColor);
    // plaza slab and a raised processional way
    b.floor(PLAZA.x0, PLAZA.z0, PLAZA.x1, PLAZA.z1, 0, 'floorMoss', { nav: 'none', thick: 0.8 });
    b.floor(-3, 0, 3, 44, 0.08, 'floor', { nav: 'none', thick: 0.3, tint: 0xd8ccb4 });
    b.floor(-44, 30, -31, 50, 0.05, 'floorMoss', { nav: 'none', thick: 0.6 });
    // strip to the cliff path
    b.floor(29.5, 20, 34, 28, 0, 'floorMoss', { nav: 'none', thick: 0.6 });

    // --- temple facade -------------------------------------------------
    b.wallX(-30, 30, -2, 0, 0, 16, 'sandstoneMoss', [[DOOR.x0, DOOR.x1, DOOR.h]], { nav: 'none', tex: 0.35 });
    // corner masses tie the facade into the rock
    b.wall(-46, -6, -30, 0, -1, 18, 'rockMoss', { nav: 'none', tex: 0.2 });
    b.wall(30, -6, 36, 0, -1, 17, 'rockMoss', { nav: 'none', tex: 0.2 });
    // upper tiers
    b.box(0, 17.75, -1.25, 44, 3.5, 1.5, 'sandstoneMoss', { nav: 'none' });
    b.box(0, 20.5, -1.6, 20, 2, 0.8, 'sandstone', { nav: 'none' });
    b.box(0, 22.3, -1.8, 8, 1.6, 0.4, 'glyphs', { nav: 'none' });
    // pilasters and frieze
    for (const x of [-27, -21, -15, -9, 9, 15, 21, 27]) b.box(x, 8, 0.3, 1.3, 16, 0.6, 'sandstone', { nav: 'none', vary: 0.1 });
    b.box(0, 12.2, 0.15, 60, 1.6, 0.3, 'glyphs', { nav: 'none', vary: 0.02 });
    b.box(0, 15.4, 0.35, 61, 0.8, 0.7, 'sandstone', { nav: 'none' });
    // door frame
    b.box(0, 7.6, 0.4, 9.2, 1.2, 0.8, 'glyphs', { nav: 'none' });
    b.box(-4.1, 3.5, 0.4, 1.2, 7, 0.8, 'sandstone', { nav: 'none' });
    b.box(4.1, 3.5, 0.4, 1.2, 7, 0.8, 'sandstone', { nav: 'none' });
    // serpent guardians flanking the door
    for (const sx of [-1, 1]) {
      const x = sx * 6.3;
      b.box(x, 0.6, 2.2, 1.8, 1.2, 2.4, 'sandstone', { nav: 'none' });
      b.box(x, 1.8, 2.0, 1.2, 1.2, 1.6, 'sandstoneMoss', { nav: 'none' });
      b.box(x, 2.25, 3.05, 1.0, 0.55, 0.9, 'sandstoneMoss', { nav: 'none' });
      b.box(x, 1.75, 3.0, 0.9, 0.25, 0.8, 'sandstone', { nav: 'none' });
      for (const ex of [-0.32, 0.32]) {
        const eye = new THREE.SphereGeometry(0.08, 8, 6);
        eye.translate(x + ex, 2.38, 3.52);
        b.mesh(eye, 'obsidian', { cast: false });
      }
    }
    // decorative creepers on the facade (not climbable: too thin)
    b.vines('facadeA', -26, 3, 0, -22, 15, 0.6, [0, 0, 1], 1.2, false);
    b.vines('facadeB', 17, 5, 0, 20, 15.5, 0.6, [0, 0, 1], 1.1, false);
    b.vines('facadeC', -13, 8, 0, -10, 15.5, 0.6, [0, 0, 1], 1.0, false);

    // --- west cliff and east boundary ------------------------------------
    b.wall(-52, -6, -46, 64, -2, 24, 'rockMoss', { nav: 'none', tex: 0.18 });
    for (let i = 0; i < 12; i++) {
      const z = -2 + i * 5.6 + b.rng.next() * 2;
      b.rock(-45.5 + b.rng.next() * 1.2, 2 + b.rng.next() * 14, z, 1.6 + b.rng.next() * 2, 'rockMoss', { collider: false, squash: 0.55 });
      b.rock(-44 + b.rng.next() * 2, courtyardHeight(-44, z) + 0.2, z + 2, 0.8 + b.rng.next() * 1.0, 'rockMoss', { squash: 0.6 });
    }
    b.vines('westCliff', -46, 1, 14, -45.6, 20, 20, [1, 0, 0], 1.0, false);
    // low ruined boundary wall to the east, with the gap to the cliff path
    b.wallZ(0, 58, 30.5, 31.5, -0.5, 1.3, 'sandstoneMoss', [[19.5, 28.5, 4]], { nav: 'none' });
    for (const z of [6, 13, 37, 46, 53]) b.box(31, 1.6 + b.rng.next() * 0.6, z, 1.1, 1.0, 1.1, 'sandstoneMoss', { nav: 'none', rotY: b.rng.next() });
    // invisible barrier along the cliff edge
    b.box(33.75, 14, 9, 0.5, 32, 22, 'rock', { visible: false, nav: 'none' });
    b.box(33.75, 14, 45, 0.5, 32, 34, 'rock', { visible: false, nav: 'none' });

    // --- colonnade and toppled pillars ------------------------------------
    for (const p of PILLARS) b.pillar(p.x, p.z, 0, 7.5, 0.6, 'sandstoneMoss', { broken: p.broken, nav: 'none' });
    // fallen shafts lying across the plaza
    b.cylinder(-14.6, 21.6, 0.55, 5.6, 0.55, 'sandstoneMoss', { rot: new THREE.Euler(0, 0.5, Math.PI / 2), nav: 'none' });
    b.cylinder(13.8, 38.8, 0.55, 4.8, 0.55, 'sandstoneMoss', { rot: new THREE.Euler(0, -0.3, Math.PI / 2), nav: 'none' });
    b.cylinder(-12.8, 44.8, 0.55, 3.2, 0.55, 'sandstoneMoss', { rot: new THREE.Euler(0, 1.2, Math.PI / 2), nav: 'none' });
    // scattered drums and capitals
    for (const [x, z, r] of [[-16.5, 25, 0.6], [16, 34.5, 0.6], [17.2, 37.8, 0.55], [-9, 47.5, 0.6], [22, 15, 0.55]] as const) {
      b.cylinder(x, z, 0, 0.9, r, 'sandstoneMoss', { seg: 12, nav: 'none' });
    }
    b.box(-16, 0.3, 28.5, 1.6, 0.6, 1.6, 'sandstoneMoss', { rotY: 0.4, nav: 'none' });
    b.box(18.6, 0.3, 41, 1.6, 0.6, 1.6, 'sandstoneMoss', { rotY: -0.7, nav: 'none' });
    // broken paving slabs heaved up by roots
    for (let i = 0; i < 18; i++) {
      const x = -27 + b.rng.next() * 54;
      const z = 2 + b.rng.next() * 40;
      if (Math.abs(x) < 4 || Math.hypot(x - SUNDIAL_CENTER.x, z - SUNDIAL_CENTER.z) < 5 || (Math.abs(Math.abs(x) - 6) < 2.5 && Math.abs(z - 7) < 2.5)) continue;
      b.box(x, 0.05, z, 0.9 + b.rng.next() * 0.8, 0.18, 0.9 + b.rng.next() * 0.8, 'floorMoss', {
        rot: new THREE.Euler((b.rng.next() - 0.5) * 0.25, b.rng.next() * 3, (b.rng.next() - 0.5) * 0.25),
        nav: 'none',
        collider: false,
      });
    }

    // --- sundial plinth -------------------------------------------------
    const c = SUNDIAL_CENTER;
    b.cylinder(c.x, c.z, 0, 0.25, 4.1, 'sandstone', { seg: 36, nav: 'none' });
    b.cylinder(c.x, c.z, 0.25, 0.35, 3.3, 'sandstone', { seg: 36, nav: 'none' });
    // the slot on the plinth's north face where the Sun-Disc rises
    b.box(c.x, 0.45, c.z - 3.45, 1.2, 0.08, 0.4, 'obsidian', { nav: 'none', collider: false });
    // offering altar
    b.box(-5.5, 0.35, 35.5, 1.4, 0.7, 1.0, 'glyphs', { nav: 'none' });

    // --- west plaza shrine ------------------------------------------------
    b.box(-40, 0.45, 41, 3.2, 0.8, 3.2, 'sandstoneMoss', { nav: 'none' });
    b.pillar(-41.2, 39.8, 0.85, 3.4, 0.3, 'sandstoneMoss', { broken: true, nav: 'none' });
    b.pillar(-38.8, 42.2, 0.85, 3.4, 0.3, 'sandstoneMoss', { nav: 'none' });
    b.box(-38.8, 4.4, 41.0, 0.9, 0.3, 3.0, 'sandstoneMoss', { nav: 'none', rot: new THREE.Euler(0.15, 0, 0.6) });

    // stones by the bridgehead
    b.rock(-3, courtyardHeight(-3, 58), 58, 1.1, 'rockMoss', { squash: 0.6 });
    b.rock(8, courtyardHeight(8, 57), 57, 1.4, 'rockMoss', { squash: 0.5 });
  },
  props(ctx: SceneCtx, rt: SceneRuntime) {
    const run = ctx.run;
    // the great door
    const door = rt.addProp(
      new SlidingSlab(ctx, rt, {
        id: 'greatDoor',
        pos: [0, DOOR.h / 2 + 0.1, -1],
        size: [DOOR.x1 - DOOR.x0, DOOR.h + 0.2, 1.0],
        openOffset: [0, DOOR.h - 0.1, 0],
        mat: 'glyphs',
        duration: 5,
        flag: 'greatDoorOpen',
      }),
    );
    // both plates held down at once open it
    const plates: PressurePlate[] = [];
    const check = () => {
      if (run.flag('greatDoorOpen') || run.flag('darkness')) return;
      if (plates.length === 2 && plates.every((p) => p.pressed)) {
        ctx.setFlag('greatDoorOpen');
        ctx.toast('With a groan of stone, the great door rises.', 'good');
        ctx.shake(0.6);
        ctx.mapMark(0, -1, 'great door');
      }
    };
    plates.push(rt.addProp(new PressurePlate(ctx, rt, 'doorPlateW', -6, 0.0, 7, 2.2, 70, () => check())));
    plates.push(rt.addProp(new PressurePlate(ctx, rt, 'doorPlateE', 6, 0.0, 7, 2.2, 70, () => check())));
    rt.addInteract({
      kind: 'interact',
      id: 'doorHint',
      position: new THREE.Vector3(0, 1.4, 0.6),
      reach: 3.5,
      prompt: () => {
        if (door.open > 0.5) return null;
        if (run.flag('doorShut')) return 'The great door is sealed for the night.';
        return 'The great door. Two worn plates lie before it.';
      },
      interact: () => {},
    });
    // push blocks heavy enough to hold a plate
    rt.addProp(new PushBlock(ctx, rt, 'courtBlockW', [-15, 0, 24], [1.7, 1.7, 1.7], 700, 'sandstoneMoss'));
    rt.addProp(new PushBlock(ctx, rt, 'courtBlockE', [17, 0, 9.5], [1.7, 1.7, 1.7], 700, 'sandstoneMoss'));

    // the sundial
    rt.addProp(new Sundial(ctx, rt, 'sundial', SUNDIAL_CENTER.clone()));

    // relics
    ctx.relics.relicSpawn('c1', 'courtyard', 'A', [-24, 0, 10]);
    ctx.relics.relicSpawn('c2', 'courtyard', 'A', [20, 0, 36]);
    ctx.relics.relicSpawn('c3', 'courtyard', 'A', [-40, 0.85, 41]);
    ctx.relics.relicSpawn('c4', 'courtyard', 'A', [24, 0, 3]);
    ctx.relics.relicSpawn('c5', 'courtyard', 'A', [-5.5, 0.7, 35.5], { minRarity: 'uncommon' });

    // water bowl and a fallen banner by the cart, purely decorative
    const banner = boxMesh(ctx.mats, 'cloth', 0.05, 2.2, 0.9, 1);
    banner.position.set(-9.2, 1.1, 1.0);
    banner.rotation.set(0, 0.3, 0.12);
    rt.group.add(banner);

    // vegetation: trees at the edges, ferns and grass breaking through the paving
    const q = ctx.quality;
    const vq = q === 'low' ? 0.45 : q === 'medium' ? 0.75 : 1;
    const rng = new Rng(777);
    const edge = (pad: number) => (x: number, z: number) => {
      if (plazaDist(x, z) < 2 + pad) return null;
      if (Math.abs(x - 2) < 4 + pad && z > 40) return null;
      if (x > 28 && z > 17 && z < 31) return null;
      if (z > 59 || x > 30) return null;
      if (Math.max(Math.abs(x + 37.5) - 6.5, Math.abs(z - 40) - 10.5) < pad) return null;
      return courtyardHeight(x, z) - 0.1;
    };
    const plazaCrack = (x: number, z: number) => {
      if (plazaDist(x, z) > 0) return null;
      if (Math.abs(x) < 3.5) return null;
      if (Math.hypot(x - SUNDIAL_CENTER.x, z - SUNDIAL_CENTER.z) < 4.6) return null;
      if (Math.abs(Math.abs(x) - 6) < 2 && Math.abs(z - 7) < 2) return null;
      return 0.0;
    };
    const trees = Vegetation.scatter(rng, Math.round(26 * vq), -45, -1, 30, 60, edge(2.5), 0.8, 1.25);
    const palms = Vegetation.scatter(rng, Math.round(14 * vq), -45, 2, 30, 60, edge(1.5), 0.85, 1.2);
    const bushes = Vegetation.scatter(rng, Math.round(60 * vq), -45, 0, 31, 62, edge(0.3), 0.7, 1.3);
    const ferns = [
      ...Vegetation.scatter(rng, Math.round(140 * vq), -45, 0, 31, 62, edge(0.1), 0.6, 1.4),
      ...Vegetation.scatter(rng, Math.round(70 * vq), -30, 0, 30, 44, plazaCrack, 0.4, 0.9),
    ];
    const gq = q === 'low' ? 0.35 : q === 'medium' ? 0.7 : 1;
    const grass = [
      ...Vegetation.scatter(rng, Math.round(900 * gq), -45, 0, 31, 62, edge(0), 0.8, 1.4),
      ...Vegetation.scatter(rng, Math.round(700 * gq), -30, 0, 30, 44, plazaCrack, 0.5, 1.0),
    ];
    for (const [k, list] of [['trunk', trees], ['canopy', trees], ['palmTrunk', palms], ['palmFronds', palms], ['fern', ferns], ['bush', bushes], ['grass', grass]] as const) {
      const im = ctx.veg.instances(k, list);
      if (im) rt.group.add(im);
    }
    for (const t of trees) rt.addTreeCollider(ctx, t.x, t.y, t.z, 0.5 * t.s, 6);
    for (const t of palms) rt.addTreeCollider(ctx, t.x, t.y, t.z, 0.22 * t.s, 4);

    // the haul cart, parked outside the door
    rt.addProp(
      new HaulCart(ctx, rt, 'cart', CART_POS, 0.3, {
        bank: () => ctx.bankAll(),
        leave: () => ctx.leaveTemple(),
        carriedCount: () => ctx.carriedCount(),
      }),
    );
  },
};
