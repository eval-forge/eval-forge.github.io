/**
 * B1 Broken halls: caved-in roof with moving sun shafts, the pit crossed by sun-stones
 * (solid only while sunlight actually reaches them: a real raycast toward the sun), the
 * blade gallery, and the Sun Seal down to the catacombs.
 */
import * as THREE from 'three';
import { SUN_STONES, BLADES, HALL_PIT, SUN_SEAL, VINES, ROOFS } from '../layout';
import { buildInteriorChunks, interiorGeometry, mesh, addBoxes, type BoxSpec } from '../build';
import { column, toppledColumn, rubble } from '../terrain';
import { vineFor, hangingVines } from '../nature';
import { SunShaft } from '../shafts';
import { surface, standard, tinted } from '../../engine/materials';
import { textures } from '../../engine/textures';
import { Q_SOLID } from '../../engine/physics';
import { SunStone, DAMAGE } from '../../logic/traps';
import { tryUnlock } from '../../logic/unlocks';
import { buildPedestal, buildSconce, pickSconces, wallDartSources, addInteract, SlidingStone } from '../../entities/Interactables';
import { Rng } from '../../core/rng';
import type { SceneDef } from '../SceneManager';

const EXP = 'ruins' as const;

export const halls: SceneDef = {
  id: 'halls',
  *build(game, h) {
    const rng = new Rng(404);
    const run = game.run;
    yield* buildInteriorChunks('halls', h.group, h.owner);

    // ---------------------------------------------------------- sun shafts through the roof holes
    const shafts: SunShaft[] = [];
    const holes = [
      { x0: -1, z0: -11, x1: 1, z1: -5, floor: 0 },
      { x0: -6, z0: -22, x1: 6, z1: -14, floor: 0 },
      { x0: 14, z0: -20, x1: 19, z1: -16, floor: 0 },
      { x0: -6, z0: -34, x1: 6, z1: -22, floor: -8 },
      { x0: -6, z0: -40, x1: 6, z1: -34, floor: 0 },
      { x0: 9, z0: -53, x1: 17, z1: -44, floor: 0 },
      { x0: -19, z0: -58, x1: -12, z1: -51, floor: 0 },
      { x0: -14, z0: -44, x1: -9, z1: -38, floor: 0 },
    ];
    for (const ho of holes) shafts.push(new SunShaft(h.group, ho, ho.x1 - ho.x0 < 3 ? 10 : 12, ho.floor, 0.045));
    h.update.push(() => {
      for (const s of shafts) s.update(game);
    });
    void ROOFS;
    yield;

    // ---------------------------------------------------------- the pit: spikes, vine, sun-stones
    const spikeGeo = new THREE.ConeGeometry(0.09, 0.7, 5);
    const spikes = new THREE.InstancedMesh(spikeGeo, surface('iron', EXP), 220);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (let x = -4.6; x <= 4.6; x += 0.75) {
      for (let z = HALL_PIT.z0 + 0.6; z <= HALL_PIT.z1 - 0.6; z += 0.8) {
        if (k >= 220) break;
        m4.makeRotationFromEuler(new THREE.Euler(rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15))).setPosition(x + rng.range(-0.2, 0.2), HALL_PIT.floor + 0.33, z + rng.range(-0.2, 0.2));
        spikes.setMatrixAt(k++, m4);
      }
    }
    spikes.count = k;
    spikes.castShadow = true;
    h.group.add(spikes);
    let spikeCd = 0;
    h.fixed.push((dt) => {
      spikeCd -= dt;
      const p = game.player;
      if (spikeCd <= 0 && p.feetY < HALL_PIT.floor + 0.6 && Math.abs(p.pos.x) < 5 && p.pos.z > HALL_PIT.z0 && p.pos.z < HALL_PIT.z1) {
        spikeCd = 1.2;
        p.damage(DAMAGE.spikes, 'spikes');
        game.hurtFlash(1);
        game.audio.crunch(p.feet(), 0.5);
      }
    });
    const pitVine = VINES.find((v) => v.scene === 'halls')!;
    vineFor(h.group, pitVine, EXP, 41);
    h.vines.push(pitVine);
    rubble(h, -16, HALL_PIT.floor, -27, 3, 9, EXP, rng);
    rubble(h, 15, HALL_PIT.floor, -31, 3, 9, EXP, rng);

    const T = textures();
    const solidMat = surface('templeWall', EXP);
    const glyphMat = standard('sunGlyph', EXP, { map: T.glyphs, color: 0xd8a030, transparent: true, alphaTest: 0.3, roughness: 0.5, metalness: 0.6 });
    const ghostMat = tinted(0xffd27a, EXP, 0.4, 0, { transparent: true, opacity: 0.16 });
    const stones = SUN_STONES.zs.map((z, i) => {
      const hx = SUN_STONES.w / 2;
      const hz = SUN_STONES.d / 2;
      const solid = mesh(new THREE.BoxGeometry(SUN_STONES.w, 0.4, SUN_STONES.d), solidMat, SUN_STONES.x, -0.2, z);
      const glyph = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), glyphMat);
      glyph.rotation.x = -Math.PI / 2;
      glyph.position.y = 0.205;
      solid.add(glyph);
      const ghost = mesh(new THREE.BoxGeometry(SUN_STONES.w, 0.4, SUN_STONES.d), ghostMat, SUN_STONES.x, -0.2, z, false, false);
      h.group.add(solid, ghost);
      const col = h.owner.staticBox(SUN_STONES.x, -0.2, z, hx, 0.2, hz, { kind: 'sunstone', surface: 'stone' });
      const logic = new SunStone(0.25, 1.0);
      col.setEnabled(false);
      solid.visible = false;
      return { z, solid, ghost, col, logic, i };
    });
    const up = new THREE.Vector3();
    let flick = 0;
    h.fixed.push((dt) => {
      const sun = game.sky.sunDir;
      const sunUp = game.sky.sunUp;
      up.copy(sun);
      flick += dt;
      for (const s of stones) {
        let lit = false;
        if (sunUp) {
          let n = 0;
          for (const ox of [-1.2, 0, 1.2]) {
            const from = new THREE.Vector3(SUN_STONES.x + ox, 0.3, s.z);
            if (!game.physics.ray(from, up, 90, Q_SOLID)) n++;
          }
          lit = n >= 2;
        }
        const before = s.logic.state;
        const st = s.logic.update(dt, lit);
        s.col.setEnabled(st !== 'phantom');
        s.solid.visible = st === 'solid' || (st === 'fading' && Math.sin(flick * 40 + s.i) > -0.2);
        s.ghost.visible = st !== 'solid';
        if (before === 'phantom' && st === 'solid') game.audio.stoneGrind(new THREE.Vector3(0, 0, s.z), 0.4, 0.2);
        if (before !== 'phantom' && st === 'phantom') game.audio.whisper(new THREE.Vector3(0, 0, s.z));
      }
    });
    addInteract(h, new THREE.Vector3(0, 0.3, HALL_PIT.z1 + 0.6), new THREE.Vector3(1.8, 0.3, 0.4), {
      prompt: (g) => (g.sky.sunUp ? 'Sun-stones: solid only while sunlight touches them' : 'Sun-stones: no sun, no bridge. Try the blade gallery.'),
      use: () => {},
    });
    yield;

    // ---------------------------------------------------------- the blade gallery
    const bladeGeo = new THREE.BoxGeometry(1.5, 0.95, 0.07);
    const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 4.3, 6);
    const blades = BLADES.map((b) => {
      const pivot = new THREE.Group();
      pivot.position.set(b.x, 5.75, b.z);
      const arm = mesh(armGeo, surface('iron', EXP), 0, -2.15, 0);
      const blade = mesh(bladeGeo, surface('iron', EXP), 0, -4.35, 0);
      const edge = mesh(new THREE.BoxGeometry(1.55, 0.1, 0.03), tinted(0xd0d0d8, EXP, 0.2, 1), 0, -4.8, 0);
      pivot.add(arm, blade, edge);
      h.group.add(pivot);
      const axle = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.4, 8), surface('iron', EXP), b.x, 5.75, b.z);
      axle.rotation.x = Math.PI / 2;
      h.group.add(axle);
      return { ...b, pivot, cd: 0, prevSide: 0 };
    });
    let bt = 0;
    h.fixed.push((dt) => {
      bt += dt;
      const p = game.player;
      for (const b of blades) {
        const th = 1.1 * Math.sin(bt * 2.1 + b.phase);
        const om = 1.1 * 2.1 * Math.cos(bt * 2.1 + b.phase);
        b.pivot.rotation.z = th;
        const bx = b.x + Math.sin(th) * 4.35;
        const by = 5.75 - Math.cos(th) * 4.35;
        b.cd -= dt;
        const side = Math.sign(Math.sin(th));
        if (side !== b.prevSide && Math.abs(p.pos.z - b.z) < 9) game.audio.bladeWhoosh(new THREE.Vector3(bx, by, b.z));
        b.prevSide = side;
        if (b.cd <= 0 && !p.dead && Math.abs(bx - p.pos.x) < 0.95 && Math.abs(b.z - p.pos.z) < 0.45 && by > p.feetY - 0.2 && by < p.feetY + p.height + 0.2) {
          b.cd = 0.9;
          p.damage(DAMAGE.blade, 'blade');
          p.externalVel.set(Math.sign(om) * 7, 2.5, (p.pos.z - b.z) * 3);
          game.hurtFlash(1);
          game.audio.crunch(p.eye(), 0.5);
        }
      }
    });
    yield;

    // ---------------------------------------------------------- the Sun Seal
    const sealMesh = new THREE.Group();
    const disc = mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.5, 28), surface('templeWall', EXP), 0, 0, 0);
    disc.rotation.z = Math.PI / 2;
    const recess = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 20), tinted(0x1a1612, EXP, 1), 0.27, 0, 0, false, false);
    recess.rotation.z = Math.PI / 2;
    const inset = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 20), surface('gold', EXP), 0.28, 0, 0, false, false);
    inset.rotation.z = Math.PI / 2;
    inset.visible = run.flags.sunSealOpen;
    const face = mesh(new THREE.CircleGeometry(1.7, 28), standard('sealGlyph', EXP, { map: T.glyphs, color: 0x5a4a34, transparent: true, alphaTest: 0.3 }), 0.26, 0, 0, false, false);
    face.rotation.y = Math.PI / 2;
    sealMesh.add(disc, recess, inset, face);
    const seal = new SlidingStone(game, h, sealMesh, new THREE.Vector3(SUN_SEAL.x, 2.0, SUN_SEAL.z), new THREE.Vector3(SUN_SEAL.x, 2.0, SUN_SEAL.z - 4.3), new THREE.Vector3(0.25, 1.95, 1.95), 0.3);
    seal.set(run.flags.sunSealOpen ? 1 : 0);
    h.update.push(() => {
      disc.rotation.x = seal.t * 2.2;
      face.rotation.x = seal.t * 2.2;
    });
    addInteract(h, new THREE.Vector3(SUN_SEAL.x + 0.5, 2, SUN_SEAL.z), new THREE.Vector3(0.4, 1.9, 1.9), {
      prompt: (g) => {
        if (g.run.flags.sunSealOpen) return null;
        return g.run.flags.hasSunDisc ? 'E  Set the Sun Disc into the seal' : 'A great stone seal with a round, sun-shaped recess.';
      },
      use: (g) => {
        const r = tryUnlock('sunSeal', g.run.flags, 'halls');
        if (!r.ok) {
          g.toast(r.reason, 'warn');
          return;
        }
        g.run.flags = r.flags;
        inset.visible = true;
        seal.target = 1;
        g.toast(r.message + ' Stairs lead down into absolute darkness.', 'good');
      },
    });
    yield;

    // ---------------------------------------------------------- pedestals, columns, ruins
    buildPedestal(game, h, 'h3', -18, 0, 1.0, -56, EXP);
    buildPedestal(game, h, 'h4', 18, 0, 1.0, -56, EXP, 'darts', wallDartSources(0, 0, 0, [
      [23.5, -53.5],
      [23.5, -57.5],
      [14, -59.5],
      [21, -59.5],
    ]));
    const deco: BoxSpec[] = [];
    // dais under the pedestals
    deco.push({ c: [-18, 0.1, -56], h: [2.2, 0.12, 2.2], mat: 'floor', exp: EXP });
    deco.push({ c: [18, 0.1, -56], h: [2.2, 0.12, 2.2], mat: 'floor', exp: EXP });
    addBoxes(deco, h.group, h.owner);
    for (const z of [-17, -39, -47, -55]) {
      for (const x of [-20, -10, 10, 20]) {
        if (z === -55 && Math.abs(x) === 20) continue;
        const r = rng.next();
        if (r < 0.6) column(h, x, 0, z, r < 0.35 ? 11.9 : rng.range(2.5, 6), 0.75, EXP);
        else rubble(h, x, 0, z, 2, 7, EXP, rng);
      }
    }
    toppledColumn(h, -16, 0, -42, 8, 0.7, 1.2, EXP, rng);
    toppledColumn(h, 6, 0, -52, 7, 0.7, -0.4, EXP, rng);
    rubble(h, -15, 0, -54, 3, 12, EXP, rng);
    rubble(h, 13, 0, -48, 3.5, 12, EXP, rng);
    rubble(h, 16, 0, -18, 2.5, 8, EXP, rng);
    hangingVines(
      h.group,
      holes.flatMap((ho) => Array.from({ length: 5 }, () => ({ x: rng.range(ho.x0, ho.x1), y: 11.8, z: rng.chance(0.5) ? ho.z0 : ho.z1, len: rng.range(2, 6) }))),
      EXP,
    );
    yield;

    // ---------------------------------------------------------- sconces
    const sc = pickSconces(interiorGeometry().edges, 'halls', 13, new Set(['h_pit', 'door']));
    for (const s of sc.slice(0, 16)) buildSconce(game, h, s);
  },
};
