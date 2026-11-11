import * as THREE from 'three';
import type { SceneDef } from '../SceneBase';
import { box3, looseRelics } from '../SceneBase';
import { pillar, fallenPillar, rubble, statue, jungleTrees, treeColliders, hangingVines } from '../decor';
import { Gate, Lever } from '../../entities/Traps';
import { sundialAligned, eyeAzimuth, SUNDIAL_STEPS } from '../../logic/sundial';
import { sunDirection, doorClosedFraction } from '../../logic/countdown';
import { mulberry32 } from '../../logic/rng';
import { LevelBuilder } from '../LevelBuilder';

export const DOOR_POS = new THREE.Vector3(0, 0, 7.5);
export const SUNDIAL_POS = new THREE.Vector3(0, 0, 52);

export const courtyard: SceneDef = {
  id: 'courtyard',
  name: 'Temple courtyard',
  zone: 'A',
  bounds: [box3(-46, -10, 9, 45, 60, 95)],
  exposure: () => ({ outdoor: 1, ambient: 1 }),
  sconces: [],
  build(b) {
    // ground
    b.floor(-46, 9, 46, 95, 0, 'flag', 1);
    // raised plazas
    b.aabb(-30, 0, 30, -12, 0.3, 70, 'flag');
    b.aabb(12, 0, 30, 30, 0.3, 70, 'flag');
    b.aabb(-6, 0, 14, 6, 0.25, 22, 'flag');
    // perimeter walls, ruined to varying heights
    const rand = mulberry32(4);
    for (let z = 9; z < 95; z += 4) {
      const hw = 2.2 + rand() * 3;
      b.aabb(-46, 0, z, -44.5, hw, z + 4, 'mossy');
      if (!(z + 4 > 44 && z < 56)) b.aabb(44.5, 0, z, 46, 2.2 + rand() * 3, z + 4, 'mossy');
    }
    b.aabb(44.5, 3.8, 44, 46, 4.6, 56, 'mossy'); // lintel over the cliff path
    for (let x = -46; x < 46; x += 4) {
      if (x + 4 > -5 && x < 5) continue;
      b.aabb(x, 0, 94, x + 4, 1.8 + rand() * 2.5, 95.5, 'mossy');
    }
    // gate posts at the jungle entrance
    pillar(b, -5.5, 94.5, 0, 6, 0.9, 'mossy');
    pillar(b, 5.5, 94.5, 0, 6, 0.9, 'mossy', true);
    b.blocker(-46, -5, 8, -44.5, 30, 96);
    b.blocker(44.5, -5, 8, 46, 30, 44);
    b.blocker(44.5, -5, 56, 46, 30, 96);

    // ------------------------------------------------ temple facade (z 6..10)
    b.wallZ(7.5, -36, 36, 0, 14, 'sandstone', 3, [[-3, 3, 7.5]]);
    b.floor(-3.4, 5.9, 3.4, 9.1, 0, 'flag'); // threshold under the great door
    // stepped crown above the facade
    b.aabb(-30, 14, 6, 30, 17, 9, 'sandstone');
    b.aabb(-20, 17, 6.5, 20, 20, 8.5, 'sandstone');
    b.aabb(-9, 20, 7, 9, 24, 8.4, 'carved');
    // carved band and lintel
    b.aabb(-6, 7.5, 9, 6, 9.5, 9.6, 'carved', { collide: false });
    b.aabb(-4, 0, 9, -3, 7.5, 9.8, 'carved');
    b.aabb(3, 0, 9, 4, 7.5, 9.8, 'carved');
    // side blocks so the temple has mass
    b.aabb(-46, 0, -2, -36, 12, 9, 'mossy');
    b.aabb(36, 0, -2, 46, 12, 9, 'mossy');
    // steps up to the door
    b.aabb(-8, 0, 9, 8, 0.2, 13, 'sandstone');
    b.aabb(-6, 0.2, 9, 6, 0.4, 11, 'sandstone');
    statue(b, -9, 12, 0, 0, 'sandstone', 1.4);
    statue(b, 9, 12, 0, 0, 'sandstone', 1.4);
    hangingVines(b, -30, 9.3, 30, 9.6, 14, 30, 8);

    // ------------------------------------------------ colonnade + ruins
    for (let i = 0; i < 6; i++) {
      const z = 26 + i * 9;
      pillar(b, -18, z, 0.3, 7, 0.8, 'mossy', i % 3 === 1);
      pillar(b, 18, z, 0.3, 7, 0.8, 'mossy', i % 2 === 0);
    }
    fallenPillar(b, -24, 40, 0.3, 7, 1.1);
    fallenPillar(b, 25, 60, 0.3, 6, -0.6);
    fallenPillar(b, 9, 78, 0, 8, 1.6);
    fallenPillar(b, -30, 82, 0, 6, 0.2);
    rubble(b, -44, 10, -32, 30, 0, 40, 21, 'mossy');
    rubble(b, 30, 70, 44, 93, 0, 35, 22, 'mossy');
    rubble(b, -20, 72, -8, 88, 0, 20, 23, 'sandstone');
    statue(b, -38, 60, 0, Math.PI / 2, 'mossy', 1.1);
    statue(b, 38, 30, 0, -Math.PI / 2, 'mossy', 1.1);

    // ------------------------------------------------ sundial
    const S = SUNDIAL_POS;
    b.cylinder(S.x, 0.25, S.z, 4.6, 0.5, 'flag', { seg: 32 });
    b.cylinder(S.x, 0.65, S.z, 3.7, 0.3, 'carved', { seg: 32 });
    b.cylinder(S.x, 0.8 + 3, S.z, 0.16, 6, 'bronze', { seg: 10, r2: 0.05 }); // gnomon
    // fixed hour marks around the outer rim
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      b.box(S.x + Math.cos(a) * 4.25, 0.55, S.z + Math.sin(a) * 4.25, 0.3, 0.12, 0.12, 'bronze', { rotY: -a, collide: false });
    }
    // sun-disc plinth socket
    b.box(S.x, 0.5, S.z + 6, 1.0, 1.0, 1.0, 'carved');

    // ------------------------------------------------ overgrowth
    const trees: { x: number; z: number; s: number }[] = [];
    const tr = mulberry32(31);
    const spots = [[-38, 20], [-40, 45], [-36, 75], [38, 15], [40, 80], [-26, 90], [26, 88], [34, 66], [-34, 33]];
    for (const [x, z] of spots) trees.push({ x, z, s: tr() * 0.6 });
    const ferns: { x: number; z: number; s: number }[] = [];
    for (let i = 0; i < 260; i++) {
      const x = -44 + tr() * 88, z = 11 + tr() * 83;
      if (Math.abs(x) < 7 || Math.hypot(x - S.x, z - S.z) < 6) continue;
      ferns.push({ x, z, s: tr() * 0.6 });
    }
    const set = jungleTrees(b.mats, trees, () => 0, ferns, 11);
    b.add(set.group);
    treeColliders(b, set);
  },
  props(seed) {
    return [
      ...looseRelics('courtyard', seed, [[-22, 0.8, 46], [26, 0.8, 34], [-36, 0.5, 86], [37, 0.5, 52], [-12, 0.5, 17]]),
      { id: 'cy_oil', kind: 'oil', pos: [6.5, 0.6, 13], origin: 'courtyard' },
      { id: 'cy_spare', kind: 'spare', pos: [-6.5, 0.6, 13], origin: 'courtyard' },
      { id: 'cy_rock1', kind: 'rock', pos: [-14, 0.6, 30], origin: 'courtyard', mass: 3.2, size: [0.2, 0.17, 0.2] },
      { id: 'cy_bag1', kind: 'sandbag', pos: [13, 0.6, 24], origin: 'courtyard', mass: 2.4, size: [0.25, 0.16, 0.2] },
    ];
  },
  spawn(ctx, rt) {
    const run = ctx.run();
    // ---------------- great door: heave it open; it slides shut after sunset
    const door = rt.add(new Gate(ctx, 'greatDoor', new THREE.Vector3(0, 3.75, 7.5), new THREE.Vector3(6, 7.5, 1.2), 7.3, 0.9, 'carved', true));
    if (run.flags.doorOpened && door.target === 0 && ctx.remaining() > 0) door.set(1);
    rt.interact({
      pos: new THREE.Vector3(0, 1.2, 10), radius: 3.2,
      prompt: () => (run.flags.doorOpened || ctx.remaining() <= 0 ? null : 'E: heave the great door open'),
      act: () => {
        if (run.flags.doorOpened) return;
        ctx.setFlag('doorOpened');
        door.set(1);
        ctx.audio.play('door', door.pos, 1);
        ctx.shake(0.3);
        ctx.noise(door.pos, 25);
        ctx.message('The great door grinds open. It is your only way out.');
      },
    });
    rt.interact({
      pos: new THREE.Vector3(0, 1, 12.5), radius: 2.6,
      prompt: () => (run.flags.doorOpened && ctx.player.feet.z > 10.5 ? `E: leave the temple and end the run (haul ${run.carriedValue})` : null),
      act: () => ctx.escape(),
    });
    rt.every(() => {
      const closed = doorClosedFraction(ctx.remaining());
      if (closed > 0) {
        door.target = Math.min(door.target, 1 - closed);
        door.open = Math.min(door.open, 1 - closed);
      }
    });

    // ---------------- sundial puzzle
    const S = SUNDIAL_POS;
    const ring = new THREE.Group();
    ring.position.set(S.x, 0.82, S.z);
    const ringMesh = new THREE.Mesh(new THREE.RingGeometry(1.2, 3.3, 48, 1).rotateX(-Math.PI / 2), ctx.mats.get('carved'));
    ringMesh.receiveShadow = true;
    ring.add(ringMesh);
    for (let i = 0; i < SUNDIAL_STEPS; i++) {
      const a = (i / SUNDIAL_STEPS) * Math.PI * 2;
      const glyph = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 0.18), ctx.mats.get(i === 0 ? 'gold' : 'iron'));
      glyph.position.set(Math.cos(a) * 2.6, 0.03, -Math.sin(a) * 2.6);
      glyph.rotation.y = a;
      glyph.receiveShadow = true;
      ring.add(glyph);
    }
    // the eye glyph (at local angle 0 → +x)
    const eye = new THREE.Group();
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 8).scale(1, 0.15, 0.6), ctx.mats.color(0xe8dcc0, 0, 0.6));
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8).scale(1, 0.3, 1), ctx.mats.color(0x101010, 0, 0.5));
    pupil.position.y = 0.04;
    eye.add(eyeWhite, pupil);
    eye.position.set(2.75, 0.05, 0);
    eye.traverse((o) => { (o as THREE.Mesh).receiveShadow = true; });
    ring.add(eye);
    rt.object(ring);
    const setRing = () => { ring.rotation.y = -eyeAzimuth(run.sundialStep); };
    setRing();
    let solved = !!run.flags.sundialSolved;
    const plinth = new THREE.Mesh(LevelBuilder.boxGeo(0.8, 0.6, 0.8, 2), ctx.mats.get('gold'));
    plinth.position.set(S.x, solved ? 1.3 : 0.7, S.z + 6);
    rt.object(plinth);
    rt.interact({
      pos: new THREE.Vector3(S.x, 1, S.z), radius: 5,
      prompt: () => (solved ? null : ctx.remaining() <= 0 ? 'No shadow. The sun has set.' : 'E: turn the sundial ring (align the eye with the gnomon\'s shadow)'),
      act: () => {
        if (solved) return;
        run.sundialStep = (run.sundialStep + 1) % SUNDIAL_STEPS;
        setRing();
        ctx.audio.play('grind', S, 0.6);
      },
    });
    rt.every(() => {
      if (solved) return;
      const sun = sunDirection(ctx.remaining());
      if (sundialAligned(sun, run.sundialStep)) {
        solved = true;
        ctx.setFlag('sundialSolved');
        ctx.audio.play('clunk', S, 1);
        ctx.audio.play('grind', S, 1);
        ctx.message('The eye sits in the shadow. Something rises from the plinth.');
        plinth.position.y = 1.3;
        if (!run.flags.hasSunDisc && !run.entities.get('prop:sundisc')) {
          ctx.props.spawn({ id: 'sundisc', kind: 'relic', relicId: 'sundisc', pos: [S.x, 2.0, S.z + 6], origin: 'courtyard' }, 'courtyard');
        }
      }
    });
    void Lever;
  },
};
