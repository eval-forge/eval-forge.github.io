/**
 * Zone C: the deep vault. The richest and heaviest loot in the temple: the Heart of the Temple
 * on a weighted dais behind four swinging blades, two trapped side pedestals, a gilded skull,
 * and statues along the walls, one of which is not a statue. The guardians sleep in the lair
 * next door behind a portcullis that rises when night falls (a crouch-height crack lets a brave
 * thief in early). A crank raises the aqueduct gate: the long way out climbs past a boulder
 * trap to the Bone Wing, and from there the Bone Stair leads back up to the halls.
 */
import * as THREE from 'three';
import type { SceneDef, SceneCtx, SceneRuntime } from '../SceneDef';
import { box3 } from '../SceneDef';
import type { LevelBuilder } from '../LevelBuilder';
import { room, rampY, rampCeiling, rampWalls, boneNiches } from './common';
import { Blade, Boulder, DartTrap, WeightedPedestal } from '../props/traps';
import { Crank, Sconce, SlidingSlab } from '../props/mechanisms';
import { fixedBody } from '../props/util';
import { RAPIER } from '../../physics/Physics';
import { GROUP_STATIC } from '../../config';
import { buildGuardian } from '../../entities/guardianMeshes';
import type { Prop } from '../types';

export const V = -24;
const F = -14;
const HALL = { x0: -20, z0: -142, x1: 14, z1: -118, h: 7.5 };
export const DAIS = { x: -3, z: -130 };
const HEART_TOP: [number, number, number] = [DAIS.x, V + 1.9, DAIS.z];
const LANDING_Y = -20;
const BOULDER_R = 1.4;

/** Statue slots [x, z, rotY]; the run seed picks which one is a sleeping sentinel. */
export const STATUE_SLOTS: [number, number, number][] = [
  [-18.4, -120.8, Math.PI / 2],
  [-18.4, -133, Math.PI / 2],
  [-18.4, -139.6, Math.PI / 2],
  [12.4, -132, -Math.PI / 2],
  [12.4, -139.6, -Math.PI / 2],
  [4, -140.4, 0],
];
export const STATUE_PLINTH = 0.25;

export function vaultStatueSlot(seed: number): number {
  return Math.abs(Math.floor(seed)) % STATUE_SLOTS.length;
}

/** Blade pivots: [x, z, axis]. Each guards one approach to the dais; crouch to pass under. */
const BLADES: [number, number, 'x' | 'z'][] = [
  [DAIS.x - 6, DAIS.z, 'x'],
  [DAIS.x + 6, DAIS.z, 'x'],
  [DAIS.x, DAIS.z - 6, 'z'],
  [DAIS.x, DAIS.z + 6, 'z'],
];

/** Opens the boulder ramp to guardians once the boulder has rolled. */
class BoulderGate implements Prop {
  id = 'boulderGate';
  private open: boolean;
  constructor(private ctx: SceneCtx, private boulder: Boulder) {
    this.open = this.cleared();
    ctx.nav.setGate('boulderRamp', this.open);
  }
  private cleared() {
    return !!this.ctx.run.get('boulder:aqueductBoulder') && !this.boulder.body;
  }
  fixedUpdate() {
    if (this.open || !this.cleared()) return;
    this.open = true;
    this.ctx.nav.setGate('boulderRamp', true);
  }
  dispose() {}
}

export const vault: SceneDef = {
  id: 'vault',
  zone: 'C',
  env: 'dark',
  boxes: [box3(-21, -30, -160, 16, -15, -117), box3(14, -30, -126, 36, -12, -100.5)],
  spawns: {
    lair1: [-16, V, -150],
    lair2: [-10, V, -152],
    lair3: [-13, V, -147],
  },
  mapRects: [
    [-20, -142, 14, -118],
    [-20, -156, -6, -142.5],
    [14, -124, 31, -120],
    [27, -120, 31, -100],
    [31, -112, 33.5, -109],
  ],
  respawn: [-17, V + 0.1, -125],
  layout(b: LevelBuilder) {
    const { x0, z0, x1, z1, h } = HALL;
    // ---- the vault hall ----
    room(b, x0, z0, x1, z1, V, h, {
      n: [[-15, -11, 3.6], [-9, -7.8, 1.2]],
      w: [[-127, -123, 3.6]],
      e: [[-124, -120, 3.6]],
      wall: 'dungeon',
      floor: 'dungeonFloor',
    });
    // floor strips through the doorways (portcullis is gated for guardians; the crack is crouch-only)
    b.floor(-15, -142.5, -11, -142, V, 'dungeonFloor', { nav: 'none' });
    b.navWalk(-15, -142.5, -11, -142, V, 'portcullis');
    b.floor(-9, -142.5, -7.8, -142, V, 'dungeonFloor', { nav: 'none' });
    b.floor(14, -124, 14.5, -120, V, 'dungeonFloor', { nav: 'none' });
    b.navWalk(14, -124, 14.5, -120, V, 'aqueduct');
    // pillars
    for (const x of [-14, 8]) for (const z of [-122, -130, -138]) b.pillar(x, z, V, h, 0.8, 'dungeon');
    // the dais: two low tiers (step-high), the Heart's pedestal is a prop
    b.box(DAIS.x, V + 0.2, DAIS.z, 6, 0.4, 6, 'glyphsDark', { nav: 'none' });
    b.box(DAIS.x, V + 0.6, DAIS.z, 3.6, 0.4, 3.6, 'dungeon', { nav: 'none' });
    b.navBlock(DAIS.x - 3, DAIS.z - 3, DAIS.x + 3, DAIS.z + 3, V, V + 1.2);
    // blade brackets in the ceiling
    for (const [x, z] of BLADES) b.box(x, V + h - 0.15, z, 0.6, 0.3, 0.6, 'iron', { nav: 'none', collider: false });
    // statue plinths
    for (const [x, z] of STATUE_SLOTS) {
      b.box(x, V + STATUE_PLINTH / 2, z, 1.3, STATUE_PLINTH, 1.3, 'glyphsDark', { nav: 'none' });
      b.navBlock(x - 0.65, z - 0.65, x + 0.65, z + 0.65, V, V + 2.4);
    }
    // side pedestals are props; keep guardians off them
    for (const [x, z] of [[8, -126], [-14, -134]] as const) b.navBlock(x - 0.4, z - 0.4, x + 0.4, z + 0.4, V, V + 1.1);
    // sarcophagus of the gilded priest
    b.box(8, V + 0.45, -134, 1.3, 0.9, 2.4, 'dungeon');
    b.box(8, V + 0.96, -134, 1.42, 0.12, 2.52, 'glyphsDark', { nav: 'none' });
    // carved friezes, treasure shelves
    b.box(-3, V + 5.2, -141.95, 14, 2.2, 0.1, 'glyphsDark', { nav: 'none', collider: false });
    b.box(-3, V + 5.2, -118.05, 14, 2.2, 0.1, 'glyphsDark', { nav: 'none', collider: false });
    boneNiches(b, -19.5, -16, -118, V, -1);
    boneNiches(b, 0, 6.5, -118, V, -1);
    // scattered coins and broken urns (no colliders)
    if (!b.navOnly) {
      for (let i = 0; i < 16; i++) b.rock(-17 + b.rng.next() * 28, V + 0.05, -140 + b.rng.next() * 20, 0.08 + b.rng.next() * 0.12, 'clay', { collider: false, squash: 0.5 });
    }

    // ---- the guardians' lair ----
    room(b, -20, -156, -6, -142.5, V, 5, { s: 'none', wall: 'dungeon', floor: 'dungeonFloor' });
    if (!b.navOnly) {
      for (let i = 0; i < 26; i++) b.rock(-19.5 + b.rng.next() * 13, V + 0.05, -155.5 + b.rng.next() * 12, 0.12 + b.rng.next() * 0.22, 'bone', { collider: false, squash: 0.5 });
      // gouges in the walls
      for (let i = 0; i < 9; i++) b.box(-19.97, V + 1 + b.rng.next() * 2.5, -154 + i * 1.3, 0.06, 0.9, 0.08, 'obsidian', { nav: 'none', collider: false, rot: new THREE.Euler(0.5, 0, 0) });
    }
    b.box(-8.5, V + 0.35, -153.8, 2.4, 0.7, 1.6, 'dungeon');

    // ---- the aqueduct: gate, flat run, lower ramp, landing with an alcove, upper ramp ----
    room(b, 14.5, -124, 31, -120, V, 3.5, { w: 'open', s: [[27, 31, 3.5]], wall: 'dungeon', floor: 'dungeonFloor' });
    // dry water channel along the passage
    b.box(22.75, V + 0.02, -123.2, 16.5, 0.04, 0.8, 'obsidian', { nav: 'none', collider: false });
    b.ramp(27, -120, 31, -112, V, LANDING_Y, 'z', 'dungeonFloor', { steps: true });
    rampWalls(b, 27, 31, -120, V, -112, LANDING_Y, 3.4);
    rampCeiling(b, 27, 31, -120, V, -112, LANDING_Y, 3.4, 'dungeon');
    b.floor(27, -112, 31, -109, LANDING_Y, 'dungeonFloor');
    b.floor(31, -112, 33.5, -109, LANDING_Y, 'dungeonFloor');
    b.wall(26.5, -112, 27, -109, LANDING_Y - 1.2, LANDING_Y + 4.2, 'dungeon');
    b.wall(33.5, -112.5, 34, -108.5, LANDING_Y - 1.2, LANDING_Y + 4.2, 'dungeon');
    b.wall(31, -112.5, 33.5, -112, LANDING_Y - 1.2, LANDING_Y + 4.2, 'dungeon');
    b.wall(31, -109, 33.5, -108.5, LANDING_Y - 1.2, LANDING_Y + 4.2, 'dungeon');
    b.box(30.25, LANDING_Y + 3.4 + 0.4, -110.5, 8, 0.8, 4.2, 'dungeon', { nav: 'none' });
    b.ramp(27, -109, 31, -100, LANDING_Y, F, 'z', 'dungeonFloor', { steps: true, gate: 'boulderRamp' });
    rampWalls(b, 27, 31, -109, LANDING_Y, -100, F, 3.4);
    rampCeiling(b, 27, 31, -109, LANDING_Y, -100, F, 3.4, 'dungeon');
  },
  *props(ctx: SceneCtx, rt: SceneRuntime) {
    const run = ctx.run;
    const R = ctx.relics;

    // ---- blades over the approaches ----
    BLADES.forEach(([x, z, axis], i) => {
      rt.addProp(new Blade(ctx, rt, 'vaultBlade' + i, new THREE.Vector3(x, V + HALL.h - 0.1, z), axis, HALL.h - 1.6, 0.6, 2.6, i * 1.3, 1.2, 0.5));
    });
    yield;

    // ---- the Heart of the Temple ----
    const heart = R.relicSpawn('templeHeart', 'vault', 'C', HEART_TOP, { type: 'templeHeart', rotY: 0 });
    const heartDarts: { pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
    const aim = new THREE.Vector3(DAIS.x, V + 1.6, DAIS.z);
    for (const [px, pz] of [[-14, -122], [-14, -130], [-14, -138], [8, -122], [8, -130], [8, -138]] as const) {
      for (const dy of [1.2, 1.9]) {
        const to = new THREE.Vector3(px, 0, pz);
        const dir = new THREE.Vector3(aim.x - px, 0, aim.z - pz).normalize();
        const pos = to.clone().addScaledVector(dir, 0.95);
        pos.y = V + dy;
        const d = aim.clone().sub(pos).normalize();
        heartDarts.push({ pos, dir: d });
      }
    }
    const heartTrap = rt.addProp(new DartTrap(ctx, rt, 'heartDarts', [], heartDarts));
    rt.addProp(
      new WeightedPedestal(
        ctx,
        rt,
        'heartPedestal',
        HEART_TOP,
        heart.uid,
        heart.mass,
        () => {
          heartTrap.fire();
          ctx.toast('The dais drops a finger-width. Every statue in the room turns its head.', 'bad');
          ctx.shake(1.2);
          ctx.sfx.play('rumble', new THREE.Vector3(DAIS.x, V + 2, DAIS.z), 1.6);
          ctx.noise(new THREE.Vector3(DAIS.x, V + 1, DAIS.z), 1.6, 'trap', false);
          ctx.wakeEarly('vaultStatue');
        },
        'dungeon',
      ),
    );
    yield;

    // ---- trapped side pedestals ----
    const sidePedestal = (id: string, type: 'moonMirror' | 'condorStatuette', x: number, z: number, standX: number) => {
      const top: [number, number, number] = [x, V + 1.1, z];
      const rec = R.relicSpawn(id, 'vault', 'C', top, { type, rotY: standX > x ? Math.PI / 2 : -Math.PI / 2 });
      const emit: { pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
      const target = new THREE.Vector3(standX, V + 1.25, z);
      for (const pz of [z + 4, z - 4]) {
        for (const dy of [0.95, 1.5]) {
          const pos = new THREE.Vector3(x, V + dy, pz + (pz > z ? -0.95 : 0.95));
          emit.push({ pos, dir: target.clone().sub(pos).normalize() });
        }
      }
      const trap = rt.addProp(new DartTrap(ctx, rt, id + 'Darts', [], emit));
      rt.addProp(
        new WeightedPedestal(ctx, rt, id + 'Pedestal', top, rec.uid, rec.mass, () => {
          trap.fire();
          ctx.toast('Click. Darts spit from the pillars!', 'bad');
          ctx.noise(target.clone(), 1.0, 'trap', false);
        }, 'dungeon'),
      );
    };
    sidePedestal('vMirror', 'moonMirror', 8, -126, 6.6);
    sidePedestal('vCondor', 'condorStatuette', -14, -134, -12.6);
    // counterweights (the right ones and a couple of liars)
    R.weightSpawn('vPot3', 'vault', 'pot', 3, [11.6, V, -119.3], 0.4);
    R.weightSpawn('vBag14', 'vault', 'sandbag', 14, [10.2, V, -119.4], 1.2);
    R.weightSpawn('vBag9', 'vault', 'sandbag', 9, [12.6, V, -136.2], 2.4);
    R.weightSpawn('vPot6', 'vault', 'pot', 6, [-17.4, V, -129.2], 0.1);
    R.weightSpawn('vBag2', 'vault', 'sandbag', 2, [-16.6, V, -136.6], 0.8);
    yield;

    // ---- statues: all but one are stone ----
    const live = vaultStatueSlot(run.seed);
    STATUE_SLOTS.forEach(([x, z, rotY], i) => {
      if (i === live) return;
      const rig = buildGuardian('sentinel', ctx.mats);
      rig.root.position.set(x, V + STATUE_PLINTH, z);
      rig.root.rotation.y = rotY;
      // frozen mid-stride, each slightly differently
      rig.joints.armR.rotation.x = -0.25 - (i % 3) * 0.15;
      rig.joints.armL.rotation.x = 0.1 + (i % 2) * 0.12;
      rig.joints.head.rotation.y = ((i % 3) - 1) * 0.25;
      rt.group.add(rig.root);
      const body = rt.trackBody(fixedBody(ctx.physics, x, V + STATUE_PLINTH + 1.2, z));
      ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.55, 1.2, 0.4).setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) }).setCollisionGroups(GROUP_STATIC), body);
    });
    yield;

    // ---- the lair portcullis: rises at nightfall (or when the sleepers wake) ----
    rt.addProp(
      new SlidingSlab(ctx, rt, {
        id: 'lairPortcullis',
        pos: [-13, V + 1.8, -142.25],
        size: [4, 3.6, 0.3],
        openOffset: [0, 3.5, 0],
        mat: 'iron',
        duration: 2.5,
        flag: 'lairOpen',
        navGate: 'portcullis',
        sound: 'gateOpen',
        bars: true,
      }),
    );

    // ---- the aqueduct crank and gate ----
    const gate = rt.addProp(
      new SlidingSlab(ctx, rt, {
        id: 'aqueductGate',
        pos: [14.25, V + 1.8, -122],
        size: [0.3, 3.6, 4],
        openOffset: [0, 3.5, 0],
        mat: 'iron',
        duration: 1.2,
        flag: 'aqueductOpen',
        navGate: 'aqueduct',
        sound: 'gateOpen',
        bars: true,
      }),
    );
    let built = false;
    rt.addProp(
      new Crank(ctx, rt, 'aqueductCrank', [12.2, V, -126.4], Math.PI / 2, 12, 'aqueductOpen', (f) => {
        if (f > 0 && f < 1) gate.setTarget(f * 0.85);
        if (f >= 1 && built) {
          ctx.toast('The aqueduct gate is up. A long climb, but it leads back toward daylight.', 'good');
          ctx.mapMark(14, -122, 'aqueduct gate');
        }
      }),
    );
    built = true;
    yield;

    // ---- the boulder on the upper aqueduct ramp ----
    const bz = -102;
    const slopeCos = 1 / Math.hypot(1, (F - LANDING_Y) / 9);
    const boulder = rt.addProp(
      new Boulder(ctx, rt, 'aqueductBoulder', new THREE.Vector3(29, rampY(bz, -109, LANDING_Y, -100, F) + BOULDER_R / slopeCos, bz), BOULDER_R, { x: 29, z: -110.5, y: LANDING_Y, size: 2.4 }, new THREE.Vector3(0, 0, -1)),
    );
    rt.addProp(new BoulderGate(ctx, boulder));

    // ---- sconces ----
    const sconces: [string, [number, number, number], number][] = [
      ['vaultSconceW', [-19.75, V + 2.6, -131.5], Math.PI / 2],
      ['vaultSconceE', [13.75, V + 2.6, -129], -Math.PI / 2],
      ['vaultSconceN', [-3, V + 2.6, -141.75], 0],
      ['vaultSconceS', [-10, V + 2.6, -118.25], Math.PI],
      ['aqueductSconce', [22, V + 2.2, -123.75], 0],
      ['landingSconce', [33.25, LANDING_Y + 2.2, -110.5], -Math.PI / 2],
    ];
    for (const [id, pos, rot] of sconces) rt.addProp(new Sconce(ctx, rt, id, pos, rot));

    // ---- loose loot ----
    R.relicSpawn('v1', 'vault', 'C', [6.2, V, -140.8], { type: 'goldIngot', rotY: 0.2 });
    R.relicSpawn('v2', 'vault', 'C', [8, V + 1.02, -134], { type: 'goldenSkull', rotY: -Math.PI / 2 });
    R.relicSpawn('v3', 'vault', 'C', [-7.5, V, -140.6], { minRarity: 'rare' });
    R.relicSpawn('v4', 'vault', 'C', [4.5, V, -119.4], { minRarity: 'uncommon' });
    R.relicSpawn('v5', 'vault', 'C', [-17.6, V, -153.4], { minRarity: 'rare' });
    R.relicSpawn('v6', 'vault', 'C', [-8.5, V + 0.7, -153.8], { type: 'emeraldEye' });
    R.relicSpawn('v7', 'vault', 'C', [29.6, V, -122.6]);
    R.relicSpawn('v8', 'vault', 'C', [32.6, LANDING_Y, -110.4], { minRarity: 'rare' });
  },
};

/** Where the sleeping sentinel stands this run (on its plinth), with its facing. */
export function vaultStatuePose(seed: number): { pos: [number, number, number]; rotY: number } {
  const [x, z, rotY] = STATUE_SLOTS[vaultStatueSlot(seed)];
  return { pos: [x, V + STATUE_PLINTH, z], rotY };
}
