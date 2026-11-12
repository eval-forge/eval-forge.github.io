/**
 * Zone B: the collapsed sanctum. Half its ceiling fell long ago (the open north-west corner,
 * where the catacomb seal lies in the sun); the rest is cracked, and noise strains it until
 * sections come down as real falling rock. The Sun Idol sits on a weighted pedestal under the
 * oculus, where the midday sun falls. Lift it without a counterweight and the whole sanctum
 * starts to come down, sealing the nave behind you.
 */
import * as THREE from 'three';
import { RAPIER } from '../../physics/Physics';
import { GROUP_STATIC, GROUP_DEBRIS } from '../../config';
import type { SceneDef, SceneCtx, SceneRuntime } from '../SceneDef';
import { box3 } from '../SceneDef';
import type { LevelBuilder } from '../LevelBuilder';
import { useKeyItem } from '../../logic/unlocks';
import { CeilingCollapse, WeightedPedestal } from '../props/traps';
import { SlidingSlab, Sconce, SupplyCache } from '../props/mechanisms';
import { SunShaft } from '../props/effects';
import { boxMesh, cylMesh, fixedBody } from '../props/util';
import { rockGeometry, normalizeGeometry } from '../../render/geometry';
import type { Prop } from '../types';

export const SEAL = { x0: -19, z0: -104, x1: -15, z1: -97 };
export const SOCKET: [number, number, number] = [-12.5, 0, -94.5];
export const ALTAR = { x: 0, z: -88.5, top: 2.0 };
const CEIL_Y = 14;
/** Collapsible ceiling sections (x0, z0, x1, z1) and their strain thresholds. */
const SECTIONS: [number, number, number, number, number][] = [
  [8, -110, 24, -94, 8],
  [8, -94, 24, -78, 9],
  [8, -78, 24, -62.5, 8],
  [-8, -110, 8, -94, 10],
];

/** Rubble that falls into the nave when the idol is taken, sealing that way out. */
class NaveRubble implements Prop {
  id = 'naveRubble';
  private rocks: { body: RAPIER.RigidBody; t: number; settled: boolean }[] = [];
  private pending = -1;
  constructor(private ctx: SceneCtx, private rt: SceneRuntime) {
    if (ctx.run.flag('naveBlocked')) this.buildStatic();
  }
  /** Schedule the fall in `delay` seconds. */
  trigger(delay: number) {
    if (this.ctx.run.flag('naveBlocked') || this.pending >= 0) return;
    this.pending = delay;
  }
  private blocker() {
    const b = this.rt.trackBody(fixedBody(this.ctx.physics, 0, 2.2, -62));
    this.ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(4.2, 2.2, 1.6).setCollisionGroups(GROUP_STATIC), b);
  }
  private buildStatic() {
    const rng = mulberry(91);
    for (let k = 0; k < 16; k++) {
      const r = 0.5 + rng() * 0.8;
      const x = -3.6 + rng() * 7.2;
      const z = -63.6 + rng() * 3.2;
      const y = r * 0.5 + (k > 9 ? 1.1 + rng() * 1.6 : 0);
      const g = rockGeometry(r, k * 3 + 1, 0.7);
      g.translate(x, y, z);
      const m = new THREE.Mesh(normalizeGeometry(g), this.ctx.mats.get('sandstone'));
      m.castShadow = m.receiveShadow = true;
      this.rt.group.add(m);
    }
    this.blocker();
  }
  fixedUpdate(dt: number) {
    if (this.pending >= 0) {
      this.pending -= dt;
      if (this.pending < 0) this.fall();
    }
    for (const r of this.rocks) {
      r.t += dt;
      if (r.settled) continue;
      const v = r.body.linvel();
      if ((Math.hypot(v.x, v.y, v.z) < 0.08 && r.t > 1.2) || r.t > 6) {
        r.settled = true;
        r.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      }
    }
  }
  private fall() {
    const ctx = this.ctx;
    ctx.setFlag('naveBlocked');
    ctx.nav.setGate('nave', false);
    const c = new THREE.Vector3(0, 4, -62);
    ctx.sfx.play('debris', c, 1.6);
    ctx.sfx.play('rumble', c, 1.2);
    ctx.shake(1.2);
    ctx.noise(c, 1.8, 'trap', false);
    for (let k = 0; k < 4; k++) ctx.fx.dustBurst(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, -2, (Math.random() - 0.5) * 3)), 30, 3, true);
    for (let k = 0; k < 14; k++) {
      const r = 0.5 + Math.random() * 0.7;
      const p = new THREE.Vector3(-3.4 + Math.random() * 6.8, 5 + Math.random() * 2.5, -63.5 + Math.random() * 3);
      const body = this.rt.trackBody(ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z)));
      const g = rockGeometry(r, Math.random() * 40, 0.7, 1);
      const hull = RAPIER.ColliderDesc.convexHull(new Float32Array((g.index ? g.toNonIndexed() : g).attributes.position.array as Float32Array)) ?? RAPIER.ColliderDesc.ball(r);
      ctx.physics.world.createCollider(hull.setDensity(2300).setFriction(0.9).setCollisionGroups(GROUP_DEBRIS), body);
      const m = new THREE.Mesh(normalizeGeometry(g), ctx.mats.get('sandstone'));
      m.castShadow = m.receiveShadow = true;
      this.rt.group.add(m);
      ctx.physics.addSync(body, m);
      this.rocks.push({ body, t: 0, settled: false });
    }
    this.blocker();
    ctx.toast('Behind you, the nave caves in. Find another way out.', 'warn');
  }
  dispose() {}
}

export const sanctum: SceneDef = {
  id: 'sanctum',
  zone: 'B',
  env: 'interior',
  boxes: [box3(-26, -4, -112, 26, 30, -62)],
  spawns: {
    sanctum1: [16, 0, -100],
  },
  mapRects: [[-24, -110, 24, -62.5]],
  respawn: [0, 0.1, -66],
  layout(b: LevelBuilder) {
    // floor around the seal opening
    b.floor(-24, -110, 24, -104, 0, 'floor');
    b.floor(-24, -97, 24, -62, 0, 'floor');
    b.floor(-24, -104, SEAL.x0, -97, 0, 'floor');
    b.floor(SEAL.x1, -104, 24, -97, 0, 'floor');
    // walls
    b.wallZ(-110.5, -62, -24.5, -24, 0, 15, 'sandstone');
    b.wallZ(-110.5, -62, 24, 24.5, 0, 15, 'sandstone');
    b.wallX(-24.5, 24.5, -110.5, -110, 0, 15, 'sandstone');
    b.wallX(-24.5, 24.5, -62.5, -62, 0, 15, 'sandstone', [[-16, -10, 6], [-4, 4, 7]]);
    // standing ceiling (the north-west quarter is long gone; the oculus is open)
    b.box(-16.25, CEIL_Y + 0.5, -78, 16.5, 1, 32, 'sandstone', { nav: 'none' });
    b.box(0, CEIL_Y + 0.5, -70.25, 16, 1, 15.5, 'sandstone', { nav: 'none' });
    b.box(0, CEIL_Y + 0.5, -90, 16, 1, 8, 'sandstone', { nav: 'none' });
    // oculus rim
    for (const sx of [-1, 1]) b.box(sx * 7.6, CEIL_Y + 1.15, -82, 0.8, 0.3, 8, 'glyphs', { nav: 'none' });
    // massive pillars (the north-west pair broke when the roof came down)
    for (const sx of [-1, 1])
      for (const z of [-70, -86, -102]) {
        const broken = sx < 0 && z === -102;
        b.pillar(sx * 12, z, 0, CEIL_Y, 1.0, 'sandstone', { broken });
      }
    // rubble from the old collapse in the open corner
    if (!b.navOnly) {
      for (let i = 0; i < 26; i++) {
        const x = -23 + b.rng.next() * 14;
        const z = -109 + b.rng.next() * 14;
        if (x > SEAL.x0 - 1.6 && x < SEAL.x1 + 1.6 && z > SEAL.z0 - 1.6 && z < SEAL.z1 + 1.6) continue;
        if (Math.hypot(x - SOCKET[0], z - SOCKET[2]) < 2.2) continue;
        b.rock(x, 0.2, z, 0.3 + b.rng.next() * 0.9, 'sandstone', { squash: 0.6, collider: b.rng.next() > 0.4 });
      }
    }
    b.box(-21, 0.6, -107.4, 4.8, 1.2, 2.6, 'sandstone', { rot: new THREE.Euler(0.15, 0.3, 0.1) });
    b.box(-10.4, 0.5, -106.2, 3.6, 1.0, 2.2, 'sandstone', { rot: new THREE.Euler(-0.1, -0.5, 0.2) });
    // altar dais in three tiers
    b.box(ALTAR.x, 0.17, ALTAR.z, 7, 0.34, 7, 'glyphs', { nav: 'obstacle' });
    b.box(ALTAR.x, 0.5, ALTAR.z, 5, 0.33, 5, 'sandstone', { nav: 'obstacle' });
    b.box(ALTAR.x, 0.835, ALTAR.z, 3, 0.33, 3, 'glyphs', { nav: 'obstacle' });
    // carved sun on the north wall
    b.box(0, 8, -109.95, 9, 9, 0.1, 'glyphs', { nav: 'none', collider: false });
    // seal socket pedestal
    b.box(SOCKET[0], 0.55, SOCKET[2], 1.2, 1.1, 1.2, 'glyphs');
  },
  *props(ctx: SceneCtx, rt: SceneRuntime) {
    const run = ctx.run;
    // the catacomb seal
    rt.addProp(
      new SlidingSlab(ctx, rt, {
        id: 'seal',
        pos: [(SEAL.x0 + SEAL.x1) / 2, -0.3, (SEAL.z0 + SEAL.z1) / 2],
        size: [SEAL.x1 - SEAL.x0, 0.6, SEAL.z1 - SEAL.z0],
        openOffset: [-(SEAL.x1 - SEAL.x0) - 0.6, -0.65, 0],
        mat: 'glyphs',
        duration: 4,
        flag: 'sealOpen',
        navGate: 'seal',
      }),
    );
    const disc = ctx.models.make('sunDisc');
    disc.position.set(SOCKET[0], 1.25, SOCKET[2]);
    disc.visible = run.flag('sealOpen');
    rt.group.add(disc);
    rt.addInteract({
      kind: 'interact',
      id: 'sealSocket',
      position: new THREE.Vector3(SOCKET[0], 1.1, SOCKET[2]),
      reach: 2.4,
      prompt: () => {
        if (run.flag('sealOpen')) return null;
        if (run.unlock.items.has('sunDisc')) return 'E  Set the Sun-Disc into the seal';
        return 'A round socket, the size of a disc. The sundial outside might hold one.';
      },
      interact: () => {
        const r = useKeyItem(run.unlock, 'sunDisc', 'seal');
        if (!r.ok) {
          ctx.sfx.play('deny');
          return;
        }
        disc.visible = true;
        ctx.sfx.play('chime', disc.position, 1);
        ctx.sfx.play('stoneGrind', disc.position, 1);
        ctx.shake(0.5);
        ctx.toast('The seal grinds aside. Stairs lead down into darkness.', 'good');
        ctx.mapMark(-17, -100, 'seal');
      },
    });
    yield;

    // unstable ceiling
    const sections = SECTIONS.map(([x0, z0, x1, z1, threshold]) => ({ x0, z0, x1, z1, y: CEIL_Y, body: null, mesh: null, threshold }));
    const ceilingProp = rt.addProp(new CeilingCollapse(ctx, rt, 'sanctumCeiling', sections, box3(-24, -2, -110, 24, 16, -62)));
    const rubble = rt.addProp(new NaveRubble(ctx, rt));
    yield;

    // the Sun Idol under the oculus
    const idol = ctx.relics.relicSpawn('sunIdol', 'sanctum', 'B', [ALTAR.x, ALTAR.top, ALTAR.z], { type: 'sunIdol', rotY: 0 });
    rt.addProp(
      new WeightedPedestal(ctx, rt, 'idolPedestal', [ALTAR.x, ALTAR.top, ALTAR.z], idol.uid, idol.mass, () => {
        ctx.setFlag('idolTaken');
        ctx.toast('The pedestal sinks. The sanctum begins to fall apart!', 'bad');
        ctx.shake(1.0);
        ctx.sfx.play('rumble', new THREE.Vector3(ALTAR.x, 4, ALTAR.z), 1.5);
        ceilingProp.collapseAll(18);
        rubble.trigger(8);
      }),
    );
    rt.addProp(new SunShaft(ctx, rt, 'oculusShaft', [-7.2, -86, 7.2, -78], CEIL_Y + 1, 0, 1.4));
    rt.addProp(new SunShaft(ctx, rt, 'openCornerShaft', [-23, -109, -9, -95], 15, 0, 0.35));
    // offering bowls around the dais
    for (const [x, z] of [[-3.2, -85.3], [3.2, -85.3], [-3.2, -91.7], [3.2, -91.7]] as const) {
      const bowl = cylMesh(ctx.mats, 'bronze', 0.3, 0.18, 0.16, 12);
      bowl.position.set(x, 0.42, z);
      rt.group.add(bowl);
    }
    yield;

    // relics
    const R = ctx.relics;
    R.relicSpawn('s1', 'sanctum', 'B', [18, 0, -101], { minRarity: 'uncommon' });
    R.relicSpawn('s2', 'sanctum', 'B', [19, 0, -70]);
    R.relicSpawn('s3', 'sanctum', 'B', [-20, 0, -70]);
    R.relicSpawn('s4', 'sanctum', 'B', [-21, 0, -88]);
    R.relicSpawn('s5', 'sanctum', 'B', [20.5, 0, -86], { minRarity: 'rare' });
    R.relicSpawn('s6', 'sanctum', 'B', [-2.5, 0, -107], { minRarity: 'uncommon' });
    rt.addProp(new Sconce(ctx, rt, 'sanctumSconceW', [-23.75, 2.4, -80], Math.PI / 2));
    rt.addProp(new SupplyCache(ctx, rt, 'sanctumTorch', 'torch', [-20.4, 0, -84.6], 1.1));
    rt.addProp(new Sconce(ctx, rt, 'sanctumSconceE', [23.75, 2.4, -94], -Math.PI / 2));
    // a cracked lintel over the side doorway, purely decoration
    const lintel = boxMesh(ctx.mats, 'sandstone', 6.4, 0.5, 0.6, 0.5);
    lintel.position.set(-13, 6.2, -62.2);
    lintel.rotation.z = 0.04;
    rt.group.add(lintel);
  },
};

function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
