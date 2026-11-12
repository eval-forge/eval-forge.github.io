import * as THREE from 'three';
import type { SceneDef } from '../SceneBase';
import { box3, looseRelics } from '../SceneBase';
import { room, ALL, rubble, skullPile, statue, pillar } from '../decor';
import { Pedestal, DartTraps, Lever } from '../../entities/Traps';
import { RAPIER } from '../Physics';
import { LevelBuilder } from '../LevelBuilder';

const Y = -20;
export const LAIR_CENTER = new THREE.Vector3(24, Y, -204);

export const vault: SceneDef = {
  id: 'vault',
  name: 'Deep vault',
  zone: 'C',
  bounds: [box3(-32, -50, -218, 36, -13, -189.9)],
  exposure: () => ({ outdoor: 0, ambient: 0 }),
  sconces: [
    { id: 'v_1', pos: new THREE.Vector3(-13.7, Y + 2, -205), normal: new THREE.Vector3(1, 0, 0) },
    { id: 'v_2', pos: new THREE.Vector3(13.7, Y + 2, -192), normal: new THREE.Vector3(-1, 0, 0) },
    { id: 'v_3', pos: new THREE.Vector3(0, Y + 2, -215.7), normal: new THREE.Vector3(0, 0, 1) },
    { id: 'v_wl', pos: new THREE.Vector3(-30.7, Y + 2, -195), normal: new THREE.Vector3(1, 0, 0) },
  ],
  build(b) {
    const W = 'dungeon', F = 'dungeonFloor';
    // treasure hall
    room(b, -14, -216, 14, -188, Y, 7, W, F, [['s', -3, 3], ['w', -197, -193], ['e', -208, -200]]);
    b.aabb(-3, Y, -207, 3, Y + 0.6, -201, 'carvedDark');
    for (const x of [-9, 9]) for (const z of [-194, -210]) pillar(b, x, z, Y, 7, 0.7, 'carvedDark');
    statue(b, -12, -214, Y, Math.PI / 4, 'carvedDark', 1.3);
    statue(b, 12, -214, Y, -Math.PI / 4, 'carvedDark', 1.3);
    rubble(b, -13, -215, 13, -189, Y, 16, 101, 'dungeon', 0.5);
    // lair
    room(b, 14, -214, 34, -194, Y, 5, W, F, [['w', ...ALL]]);
    for (let i = 0; i < 4; i++) b.box(18 + i * 4.5, Y + 0.5, -211, 1.5, 1, 3, 'carvedDark');
    for (let i = 0; i < 4; i++) b.box(18 + i * 4.5, Y + 0.5, -197, 1.5, 1, 3, 'carvedDark');
    b.box(30, Y + 0.4, -204, 2.5, 0.8, 1.5, 'carvedDark');
    skullPile(b, 25, -205, Y, 21); skullPile(b, 20, -200, Y, 22); skullPile(b, 32, -210, Y, 23);
    // west ledge where the servants' passage arrives
    room(b, -31, -200, -23, -190, Y, 12, W, F, [['s', -29, -25], ['e', ...ALL]]);
    b.aabb(-31, -45, -200, -23, Y - 1, -190, 'rock');
    // the chasm between the ledge and the vault
    b.wallZ(-216.5, -24, -13.5, -45, Y + 12, W);
    b.wallZ(-187.5, -24, -13.5, -45, Y + 12, W);
    b.ceiling(-24, -217, -14, -187, Y + 12, W);
    b.aabb(-14.5, -45, -216, -13.5, Y - 1, -188, 'rock');
    b.aabb(-24, -46, -217, -13, -45, -187, 'rock');
    rubble(b, -22, -215, -15, -189, -45, 12, 102, 'rock', 1.2);
    b.kill(-23, -60, -216, -14.4, -32, -188, 'chasm');
  },
  props(seed) {
    return [
      ...looseRelics('vault', seed, [[-10, Y + 0.5, -200], [10, Y + 0.5, -205], [-6, Y + 0.5, -213], [6, Y + 0.5, -191], [22, Y + 1.2, -211], [26, Y + 1.2, -197]]),
      { id: 'v_heart', kind: 'relic', relicId: 'heart', pos: [0, Y + 2.0, -204], origin: 'vault', sleeping: true },
      { id: 'v_crown', kind: 'relic', relicId: 'crown', pos: [-6, Y + 1.3, -209], origin: 'vault', sleeping: true },
      { id: 'v_tablet', kind: 'relic', relicId: 'tablet', pos: [6, Y + 1.4, -209], origin: 'vault', sleeping: true },
      { id: 'v_skull', kind: 'relic', relicId: 'skull', pos: [30, Y + 1.1, -204], origin: 'vault' },
      { id: 'v_rock9', kind: 'rock', pos: [-4, Y + 0.5, -196], origin: 'vault', mass: 9.4, size: [0.24, 0.2, 0.24] },
      { id: 'v_bag3', kind: 'sandbag', pos: [-11, Y + 0.5, -207], origin: 'vault', mass: 3.6, size: [0.27, 0.17, 0.22] },
      { id: 'v_bag6', kind: 'sandbag', pos: [11, Y + 0.5, -199], origin: 'vault', mass: 6.1, size: [0.3, 0.2, 0.25] },
      { id: 'v_oil', kind: 'oil', pos: [-28, Y + 0.5, -198], origin: 'vault' },
    ];
  },
  spawn(ctx, rt) {
    const run = ctx.run();
    const darts = rt.add(new DartTraps(ctx));
    for (const z of [-203, -206, -209]) {
      darts.add(new THREE.Vector3(-13.4, Y + 1.5, z), new THREE.Vector3(1, -0.05, 0));
      darts.add(new THREE.Vector3(13.4, Y + 1.5, z + 1), new THREE.Vector3(-1, -0.05, 0));
    }
    let volleys = 0, vt = 0;
    rt.every((dt) => { if (volleys > 0) { vt -= dt; if (vt <= 0) { vt = 0.4; volleys--; darts.fire(); } } });
    rt.add(new Pedestal(ctx, 'v_ped_heart', new THREE.Vector3(0, Y + 0.6 + 1.1, -204), () => {
      ctx.message('The Heart was guarded. The vault door slams shut and something stirs in the lair!', 5);
      run.entities.set('vaultSlammed', true);
      run.entities.set('earlyWake', true);
      const door = (ctx as any).vaultDoor;
      if (door) door.set(0); else run.entities.set('vaultDoor', { open: 0, target: 0 });
      volleys = 4;
      ctx.audio.play('growl', new THREE.Vector3(24, Y + 1, -204), 1);
    }));
    rt.add(new Pedestal(ctx, 'v_ped_crown', new THREE.Vector3(-6, Y + 1.1, -209), () => { volleys = 3; ctx.message('Click.'); }));
    rt.add(new Pedestal(ctx, 'v_ped_tablet', new THREE.Vector3(6, Y + 1.1, -209), () => { volleys = 3; ctx.message('Click.'); }));

    // drawbridge: hinged at the vault wall, lowered from this side by a lever
    const pivot = new THREE.Vector3(-14, Y, -195);
    const deck = new THREE.Mesh(LevelBuilder.boxGeo(9.2, 0.3, 4, 1.6), ctx.mats.get('wood'));
    deck.geometry.translate(-4.6, -0.15, 0);
    deck.castShadow = deck.receiveShadow = true;
    const dbGroup = new THREE.Group();
    dbGroup.position.copy(pivot);
    dbGroup.add(deck);
    for (const z of [-1.8, 1.8]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 9.3, 4), ctx.mats.get('iron'));
      chain.position.set(-4.6, 0.1, z);
      chain.rotation.z = Math.PI / 2;
      dbGroup.add(chain);
    }
    rt.object(dbGroup);
    let angle = run.flags.drawbridgeLowered ? 0 : -Math.PI / 2;
    let target = angle;
    const body = ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pivot.x, pivot.y, pivot.z));
    const col = ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(4.6, 0.15, 2).setTranslation(-4.6, -0.15, 0).setFriction(1), body);
    ctx.physics.tag(col, { kind: 'gate' });
    rt.onDetach(() => ctx.physics.removeBody(body));
    const apply = () => {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      dbGroup.quaternion.copy(q);
      body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    };
    // once it is down, the deck becomes plain fixed ground (the character controller is happier on fixed bodies)
    const settle = () => {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      dbGroup.quaternion.copy(q);
      body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    };
    if (angle === 0) settle(); else apply();
    rt.every((dt) => {
      if (Math.abs(target - angle) > 1e-3) {
        angle += Math.sign(target - angle) * Math.min(Math.abs(target - angle), dt * 0.6);
        if (Math.abs(target - angle) <= 1e-3) {
          angle = target;
          ctx.audio.play('thud', pivot, 1); ctx.shake(0.3);
          settle();
        } else apply();
      }
    });
    rt.add(new Lever(ctx, 'v_drawLever', new THREE.Vector3(-11.5, Y, -199.5), -Math.PI / 2, 'lower the drawbridge', () => {
      ctx.setFlag('drawbridgeLowered');
      target = 0;
      ctx.audio.play('grind', pivot, 1);
      ctx.message('The drawbridge creaks down over the chasm. A way out to the west.');
    }));
  },
};
