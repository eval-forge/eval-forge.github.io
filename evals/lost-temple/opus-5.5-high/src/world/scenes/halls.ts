import * as THREE from 'three';
import type { SceneDef } from '../SceneBase';
import { box3, looseRelics } from '../SceneBase';
import { pillar, rubble, statue, spikes, skullPile, hangingVines, fallenPillar } from '../decor';
import { SunTiles, Boulder, PressurePlate, Gate, Pedestal, DartTraps, type TileSpec } from '../../entities/Traps';
import { clamp } from '../../logic/vec';
import { RAPIER } from '../Physics';
import { LevelBuilder } from '../LevelBuilder';

const SUN_TILES: TileSpec[] = [];
for (let r = 0; r < 10; r++) for (let c = 0; c < 3; c++) SUN_TILES.push({ x: -2 + c * 2, z: -21 - r * 2, y: 0, sx: 2, sz: 2 });

export const halls: SceneDef = {
  id: 'halls',
  name: 'Broken halls',
  zone: 'B',
  bounds: [box3(-31, -4, -63, 31, 40, 6.01)],
  exposure: (p) => {
    if (p.x < -24.5 && p.z < -51.5 && p.y < 0) return { outdoor: clamp(1 + p.y / 4, 0, 1), ambient: 0.3 };
    return { outdoor: 1, ambient: p.x < -12.5 && p.z < -14 ? 0.25 : 0.4 };
  },
  sconces: [
    { id: 'h_v1', pos: new THREE.Vector3(-29.7, 2.3, -4), normal: new THREE.Vector3(1, 0, 0) },
    { id: 'h_v2', pos: new THREE.Vector3(29.7, 2.3, -4), normal: new THREE.Vector3(-1, 0, 0) },
    { id: 'h_ea', pos: new THREE.Vector3(18.3, 2.3, -30), normal: new THREE.Vector3(1, 0, 0) },
    { id: 'h_nh', pos: new THREE.Vector3(10, 2.3, -61.7), normal: new THREE.Vector3(0, 0, 1) },
    { id: 'h_w1', pos: new THREE.Vector3(-29.7, 2.3, -30), normal: new THREE.Vector3(1, 0, 0) },
    { id: 'h_w2', pos: new THREE.Vector3(-12.8, 2.3, -46), normal: new THREE.Vector3(-1, 0, 0) },
  ],
  build(b) {
    // ---------------------------------------------- floors
    b.floor(-30, -14, 30, 6, 0, 'flag');
    b.floor(-12, -20, 12, -14, 0, 'flag');
    b.floor(-12, -48, 12, -40, 0, 'flag');
    b.floor(18, -48, 26, -14, 0, 'flag');
    b.floor(-12, -62, 30, -48, 0, 'flag');
    b.floor(-30, -52, -12, -14, 0, 'dungeonFloor');
    b.floor(-25, -62, -12, -52, 0, 'dungeonFloor');
    b.floor(-31, -62, -29, -52, 0, 'dungeonFloor');
    // the spike pit
    b.floor(-11.5, -40, 11.5, -20, -7, 'dungeonFloor');
    b.aabb(-12, -7, -20, 12, -1, -19, 'dungeon');
    b.aabb(-12, -7, -41, 12, -1, -40, 'dungeon');
    b.aabb(-12.5, -7, -40, -11.5, 0, -20, 'dungeon');
    b.aabb(11.5, -7, -40, 12.5, 0, -20, 'dungeon');
    spikes(b, -11.5, -40, 11.5, -20, -7);
    b.kill(-11.5, -9, -40, 11.5, -5.6, -20, 'spikes');
    // ---------------------------------------------- walls
    b.wallX(-30.5, -63, 6, 0, 12, 'sandstone');
    b.wallX(30.5, -63, 6, 0, 12, 'sandstone');
    b.wallZ(-62.5, -31, 31, 0, 14, 'carved', 1, [[-3, 3, 6]]);
    b.wallX(-12, -62, -14, 0, 12, 'sandstone');
    b.wallZ(-14, -30, -12, 0, 12, 'sandstone', 1, [[-27, -21, 5]]);
    b.aabb(12, 0, -48, 18, 12, -14, 'sandstone');
    b.aabb(26, 0, -48, 30, 12, -14, 'sandstone');
    b.aabb(24, 0, -48, 26, 12, -37, 'sandstone');
    b.aabb(24, 0, -35, 26, 12, -25, 'sandstone');
    b.aabb(24, 0, -23, 26, 12, -14, 'sandstone');
    // carved friezes in the pit room
    b.aabb(-11.5, 6, -48, -11.4, 9, -14, 'carved', { collide: false });
    b.aabb(11.4, 6, -48, 11.5, 9, -14, 'carved', { collide: false });
    // ---------------------------------------------- roof (y 12), partly missing
    b.ceiling(-30, -14, -6, 6, 12, 'sandstone');
    b.ceiling(6, -5, 30, 6, 12, 'sandstone');
    b.ceiling(6, -14, 14, -5, 12, 'sandstone');
    b.ceiling(-6, -1, 6, 6, 12, 'sandstone');
    b.ceiling(-6, -14, 6, -9, 12, 'sandstone');
    for (const z of [-38, -33, -28, -23]) b.aabb(-12, 12, z - 0.6, 12, 13, z + 0.6, 'sandstone');
    b.ceiling(-12, -48, 12, -41, 12, 'sandstone');
    b.ceiling(-12, -19, 12, -14, 12, 'sandstone');
    b.ceiling(18, -48, 26, -14, 12, 'sandstone');
    b.ceiling(-12, -62, 10, -48, 12, 'sandstone');
    b.ceiling(-31, -63, -12, -14, 12, 'sandstone');
    // broken roof chunks around the edges of the holes
    rubble(b, 14, -14, 29, -5, 0, 18, 71, 'sandstone', 1.4);
    rubble(b, -5, -8, 5, -2, 0, 6, 72, 'sandstone', 0.7);
    // ---------------------------------------------- vestibule decor
    for (const x of [-20, -8, 8, 20]) for (const z of [-10, -1]) pillar(b, x, z, 0, 12, 0.85, 'sandstone', x === 20 && z === -10);
    statue(b, -27, 3, 0, Math.PI / 2, 'sandstone', 1.2);
    statue(b, 27, 3, 0, -Math.PI / 2, 'sandstone', 1.2);
    hangingVines(b, -6, -9, 6, -1, 12, 12, 13);
    hangingVines(b, -12, -40, 12, -20, 12, 16, 14);
    // ---------------------------------------------- north hall
    b.aabb(-6.5, 0, -63, 6.5, 8, -62.8, 'carved', { collide: false });
    fallenPillar(b, 4, -52, 0, 6, 1.4, 0.6, 'sandstone');
    // rubble kept out of the block's lane (z -57..-51) so it can be shoved onto the plate
    rubble(b, 13, -61.5, 29, -58, 0, 9, 73, 'sandstone', 0.8);
    rubble(b, 14, -50.2, 23, -49, 0, 3, 75, 'sandstone', 0.6);
    // ---------------------------------------------- west wing (sealed; only reached via the servants' passage)
    rubble(b, -29, -50, -14, -16, 0, 50, 74, 'dungeon', 1.0);
    skullPile(b, -20, -33, 0, 1);
    skullPile(b, -15, -22, 0, 2);
    // servants' stair down to the passage (y 0 at z -52 → y -12 at z -70)
    b.ramp(-29, -52, -25, -70, 'z', 0, -12, 'dungeon');
    b.aabb(-30, -13, -70, -29, 0, -52, 'dungeon');
    b.aabb(-25, -13, -62, -24, 0, -52, 'dungeon');
    b.aabb(-30, -13, -71, -24, -12.5, -70, 'dungeon', { collide: false });
    b.ceiling(-31, -70, -24, -62.5, 0, 'dungeon');
    b.aabb(-25, -13, -70, -24, 0, -62, 'dungeon');
  },
  props(seed) {
    return [
      ...looseRelics('halls', seed, [[-24, 0.5, -6], [24, 0.5, 2], [5, 0.5, -58], [28, 0.5, -51], [-20, 0.5, -40], [-26, 0.5, -24], [-16, 0.5, -58], [25, 0.5, -36]]),
      { id: 'h_serpent', kind: 'relic', relicId: 'serpent', pos: [-6, 1.35, -56], origin: 'halls', sleeping: true },
      { id: 'h_block', kind: 'block', pos: [12, 0.76, -54], origin: 'halls', mass: 260, size: [0.75, 0.75, 0.75] },
      { id: 'h_bag', kind: 'sandbag', pos: [-9, 0.5, -51], origin: 'halls', mass: 3.1, size: [0.26, 0.17, 0.22] },
      { id: 'h_rock', kind: 'rock', pos: [-3, 0.5, -51], origin: 'halls', mass: 1.6, size: [0.15, 0.13, 0.15] },
      { id: 'h_oil', kind: 'oil', pos: [-14, 0.5, 4], origin: 'halls' },
      { id: 'h_spare', kind: 'spare', pos: [16, 0.5, -60], origin: 'halls' },
      { id: 'h_oil2', kind: 'oil', pos: [-27, 0.5, -55], origin: 'halls' },
    ];
  },
  spawn(ctx, rt) {
    const run = ctx.run();
    rt.add(new SunTiles(ctx, SUN_TILES));
    // boulder corridor
    const boulder = rt.add(new Boulder(ctx, 'h_boulder', new THREE.Vector3(21, 1.45, -45.5), 1.4, new THREE.Vector3(0, 0, 11)));
    rt.add(new PressurePlate(ctx, 21, -30, 0, 5.8, 2, 40, () => boulder.release()));
    // sanctum gate held by the block on the plate
    const gate = rt.add(new Gate(ctx, 'sanctumGate', new THREE.Vector3(0, 3, -62.5), new THREE.Vector3(6, 6, 1.1), 5.8, 4, 'iron'));
    const jammed = () => !!run.entities.get('gateJammed');
    rt.add(new PressurePlate(ctx, 27.4, -54.8, 0, 4.2, 3.2, 150, () => {
      gate.set(1);
      ctx.setFlag('sanctumGateHeld');
      ctx.message('Somewhere a gate grinds upward.');
    }, () => { if (!jammed()) gate.set(0); }));
    rt.every(() => { if (jammed() && gate.target < 1) gate.set(1); });
    // trapped pedestal with the serpent idol
    const darts = rt.add(new DartTraps(ctx));
    darts.add(new THREE.Vector3(-11.4, 1.3, -55.5), new THREE.Vector3(1, 0, 0));
    darts.add(new THREE.Vector3(-11.4, 1.7, -56.6), new THREE.Vector3(1, 0, 0.05));
    darts.add(new THREE.Vector3(-6, 1.5, -61.9), new THREE.Vector3(0, 0, 1));
    darts.add(new THREE.Vector3(-4.5, 1.2, -61.9), new THREE.Vector3(-0.2, 0, 1));
    let volleys = 0;
    rt.add(new Pedestal(ctx, 'h_ped', new THREE.Vector3(-6, 1.1, -56), () => {
      ctx.message('Click. The walls hiss.');
      volleys = 4;
    }));
    let vt = 0;
    rt.every((dt) => {
      if (volleys <= 0) return;
      vt -= dt;
      if (vt <= 0) { vt = 0.45; volleys--; darts.fire(); }
    });
    // the cracked wall: kick it down from the west-wing side (one-way shortcut)
    let hits = run.flags.wallKicked ? 3 : 0;
    const wallMesh = new THREE.Mesh(LevelBuilder.boxGeo(6, 5, 1, 2), ctx.mats.get('mossy'));
    wallMesh.position.set(-24, 2.5, -14);
    wallMesh.castShadow = true; wallMesh.receiveShadow = true;
    let wallBody: RAPIER.RigidBody | null = null;
    if (!run.flags.wallKicked) {
      rt.object(wallMesh);
      wallBody = ctx.physics.fixedBody();
      ctx.physics.addBox(wallBody, { pos: wallMesh.position.clone(), half: new THREE.Vector3(3, 2.5, 0.5) });
      rt.onDetach(() => ctx.physics.removeBody(wallBody));
    } else {
      // rubble where it fell
      const rb = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const m = new THREE.Mesh(LevelBuilder.boxGeo(0.8, 0.5, 0.7, 2), ctx.mats.get('mossy'));
        m.position.set(-27 + Math.random() * 6, 0.25, -13 + Math.random() * 2);
        m.rotation.y = Math.random() * 3;
        rb.add(m);
      }
      rt.object(rb);
    }
    rt.interact({
      pos: new THREE.Vector3(-24, 1.2, -14.8), radius: 2.6,
      prompt: () => {
        if (run.flags.wallKicked) return null;
        if (ctx.player.feet.z > -14) return 'A cracked wall. It will not budge from this side.';
        return `E: kick the cracked wall (${3 - hits} more)`;
      },
      act: () => {
        if (run.flags.wallKicked || ctx.player.feet.z > -14) { ctx.audio.play('deny'); return; }
        hits++;
        ctx.audio.play('kick', wallMesh.position, 1);
        ctx.noise(wallMesh.position, 18);
        ctx.shake(0.2);
        wallMesh.position.x += (Math.random() - 0.5) * 0.05;
        if (hits >= 3) {
          ctx.setFlag('wallKicked');
          ctx.audio.play('collapse', wallMesh.position, 1);
          ctx.scene.remove(wallMesh);
          if (wallBody) { ctx.physics.removeBody(wallBody); wallBody = null; }
          ctx.message('The wall gives way. A shortcut back to the great door.');
          for (let i = 0; i < 8; i++) {
            ctx.props.drop({ kind: 'rock', pos: [-27 + Math.random() * 6, 1 + Math.random() * 3, -14.5 + Math.random()], origin: 'halls', mass: 8, size: [0.3, 0.25, 0.3] }, 'halls', new THREE.Vector3(0, 0, 3));
          }
        }
      },
    });
    // gate lever on the sanctum side lives in the sanctum scene; we only honour it here.
  },
};
