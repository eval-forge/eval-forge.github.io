/**
 * A2 Temple courtyard: overgrown plazas, toppled pillars, the camp, the sundial puzzle
 * (press the glyph the gnomon's real shadow points at) and the great door (push the stone
 * block onto the door plate).
 */
import * as THREE from 'three';
import { SUNDIAL, DOOR_PLATE, DOOR_BLOCK, CAMP } from '../layout';
import { buildTerrain, groundY, groundColor, column, toppledColumn, rubble } from '../terrain';
import { buildVegetation, hangingVines } from '../nature';
import { addBoxes, mesh, type BoxSpec } from '../build';
import { surface, standard, tinted } from '../../engine/materials';
import { textures } from '../../engine/textures';
import { RAPIER, G_DYNAMIC } from '../../engine/physics';
import { PressurePlate, sundialGlyph, sundialGlyphAngle, SUNDIAL_GLYPHS, DART_HEIGHT } from '../../logic/traps';
import { tryUnlock } from '../../logic/unlocks';
import { buildPedestal, addInteract, SlidingStone } from '../../entities/Interactables';
import { Rng } from '../../core/rng';
import type { SceneDef } from '../SceneManager';

const EXP = 'outdoor' as const;

export const courtyard: SceneDef = {
  id: 'courtyard',
  *build(game, h) {
    const rng = new Rng(202);
    const run = game.run;
    buildTerrain(h, { x0: -60, x1: 42, z0: 0, z1: 70, cell: 1.5, exp: EXP, color: groundColor });
    yield;

    // ---------------------------------------------------------- paving
    const boxes: BoxSpec[] = [];
    const pave = (x0: number, x1: number, z0: number, z1: number) => boxes.push({ c: [(x0 + x1) / 2, -0.2, (z0 + z1) / 2], h: [(x1 - x0) / 2, 0.2, (z1 - z0) / 2], mat: 'floor', exp: EXP, uv: 4, tag: { kind: 'static', surface: 'stone' } });
    pave(-20, 20, 2, 64);
    pave(-34, -20, 40, 60);
    pave(20, 34, 40, 60);
    pave(-34, -20, 8, 28);
    pave(20, 34, 8, 28);

    // ---------------------------------------------------------- the facade
    const fz0 = -2.2;
    const fz1 = 1.5;
    const fc = (fz0 + fz1) / 2;
    const fh = (fz1 - fz0) / 2;
    const wall = (x0: number, x1: number, y0: number, y1: number, mat: 'templeWall' | 'templeWallMoss' = 'templeWallMoss', dz = 0) =>
      boxes.push({ c: [(x0 + x1) / 2, (y0 + y1) / 2, fc + dz], h: [(x1 - x0) / 2, (y1 - y0) / 2, fh], mat, exp: EXP, uv: 3 });
    wall(-42, -3, 0, 12);
    wall(3, 42, 0, 12);
    wall(-3, 3, 8.4, 12);
    wall(-32, 32, 12, 16, 'templeWall', -0.6);
    wall(-18, 18, 16, 20, 'templeWallMoss', -1.2);
    wall(-7, 7, 20, 23.5, 'templeWall', -1.8);
    // rock shoulders to either side
    boxes.push({ c: [-52, 7, -3], h: [10, 10, 4], mat: 'rockMoss', exp: EXP, uv: 5 });
    boxes.push({ c: [43, 7, -4], h: [2, 9, 5], mat: 'rockMoss', exp: EXP, uv: 5 });
    // engaged columns
    for (const x of [-34, -26, -18, -11, -6, 6, 11, 18, 26, 34]) {
      boxes.push({ c: [x, 6, 1.9], h: [0.7, 6, 0.45], mat: 'templeWall', exp: EXP, uv: 3 });
    }
    // low platform in front of the door
    boxes.push({ c: [0, 0.08, 2.4], h: [9, 0.1, 1.0], mat: 'floor', exp: EXP });
    // balustrade along the cliff edge, with a gap for the cliff trail
    for (const [z0, z1] of [
      [2, 27.5],
      [36.5, 70],
    ]) {
      boxes.push({ c: [41.5, 0.35, (z0 + z1) / 2], h: [0.5, 0.45, (z1 - z0) / 2], mat: 'templeWallMoss', exp: EXP });
    }
    // invisible west/south-west limits
    h.owner.staticBox(-54, 10, 35, 1, 30, 36);
    addBoxes(boxes, h.group, h.owner);
    // carved band + sun disc over the door
    const T = textures();
    const band = mesh(new THREE.PlaneGeometry(64, 1.6), standard('glyphBand', EXP, { map: T.glyphs, color: 0x4a4030, transparent: true, alphaTest: 0.3, roughness: 0.9 }), 0, 10.2, fz1 + 0.02, false, true);
    (band.material as THREE.MeshStandardMaterial).map!.wrapS = THREE.RepeatWrapping;
    h.group.add(band);
    const sun = mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.3, 24), surface('gold', EXP), 0, 14, fz1 - 0.4);
    sun.rotation.x = Math.PI / 2;
    h.group.add(sun);
    hangingVines(
      h.group,
      Array.from({ length: 34 }, () => {
        const x = rng.range(-40, 40);
        const top = Math.abs(x) < 7 ? 23.5 : Math.abs(x) < 18 ? 20 : Math.abs(x) < 32 ? 16 : 12;
        return { x, y: top - 0.2, z: fz1 + 0.15, len: rng.range(2, 7) };
      }).filter((p) => Math.abs(p.x) > 3.5 || p.len < 3),
      EXP,
    );
    yield;

    // ---------------------------------------------------------- great door
    const slab = new THREE.Group();
    const sm = mesh(new THREE.BoxGeometry(6, 8.4, 1), surface('templeWall', EXP), 0, 0, 0);
    const glyph = mesh(new THREE.PlaneGeometry(4, 4), standard('doorGlyph', EXP, { map: T.glyphs, color: 0x6a5a40, transparent: true, alphaTest: 0.3 }), 0, 0.6, 0.51, false, true);
    slab.add(sm, glyph);
    const door = new SlidingStone(game, h, slab, new THREE.Vector3(0, 4.2, -1), new THREE.Vector3(0, 12.6, -1), new THREE.Vector3(3, 4.2, 0.5), 0.2);
    const doorState = () => {
      if (run.flags.greatDoorClosed) return 0;
      if (!run.flags.greatDoorOpen) return 0;
      return 1 - game.clock.doorClosure;
    };
    door.set(doorState());
    h.update.push(() => {
      const want = doorState();
      if (game.clock.doorClosure > 0) door.set(want); // closing at night: track the clock exactly
      else door.target = want;
    });

    // door plate + the stone block
    const plate = new PressurePlate(250, true);
    if (run.flags.greatDoorOpen) plate.update(1e9);
    const plateMesh = mesh(new THREE.BoxGeometry(DOOR_PLATE.half * 2, 0.12, DOOR_PLATE.half * 2), surface('iron', EXP), DOOR_PLATE.x, -0.02, DOOR_PLATE.z, false, true);
    const plateRim = mesh(new THREE.BoxGeometry(DOOR_PLATE.half * 2 + 0.4, 0.06, DOOR_PLATE.half * 2 + 0.4), surface('templeWall', EXP), DOOR_PLATE.x, -0.05, DOOR_PLATE.z, false, true);
    h.group.add(plateRim, plateMesh);
    // drag marks from the block to the plate
    for (let i = 0; i < 6; i++) {
      const m = mesh(new THREE.PlaneGeometry(1.3, 0.1), tinted(0x5a5040, EXP, 1), DOOR_PLATE.x + 2 + i * 1.2, 0.012, DOOR_PLATE.z + (i % 2 ? 0.6 : -0.6), false, true);
      m.rotation.x = -Math.PI / 2;
      h.group.add(m);
    }
    const bp = run.blockPos ?? [DOOR_BLOCK.x, DOOR_BLOCK.y, DOOR_BLOCK.z];
    const blockBody = h.owner.body(RAPIER.RigidBodyDesc.dynamic().setTranslation(bp[0], bp[1], bp[2]).setLinearDamping(4).enabledRotations(false, false, false));
    h.owner.collider(RAPIER.ColliderDesc.cuboid(DOOR_BLOCK.half, DOOR_BLOCK.half, DOOR_BLOCK.half).setMass(400).setFriction(0.2).setCollisionGroups(G_DYNAMIC), blockBody, { kind: 'block', surface: 'stone' });
    const blockMesh = mesh(new THREE.BoxGeometry(2, 2, 2), surface('templeWall', EXP));
    const bglyph = mesh(new THREE.PlaneGeometry(1.6, 1.6), standard('doorGlyph', EXP, {}), 0, 0, 1.01, false, true);
    blockMesh.add(bglyph);
    h.group.add(blockMesh);
    game.blockBody = blockBody;
    h.dispose.push(() => {
      const t = blockBody.translation();
      run.blockPos = [t.x, t.y, t.z];
      if (game.blockBody === blockBody) game.blockBody = null;
    });
    h.fixed.push(() => {
      const { mass } = game.physics.massInBox(new THREE.Vector3(DOOR_PLATE.x, 0.45, DOOR_PLATE.z), new THREE.Vector3(DOOR_PLATE.half - 0.2, 0.4, DOOR_PLATE.half - 0.2));
      const ev = plate.update(mass);
      if (ev === 'pressed') {
        plateMesh.position.y = -0.07;
        const r = tryUnlock('greatDoor', run.flags, 'courtyard');
        if (r.ok) {
          run.flags = r.flags;
          game.toast(r.message, 'good');
          game.audio.rumble(3, 0.6);
        }
      }
    });
    h.update.push(() => {
      const t = blockBody.translation();
      blockMesh.position.set(t.x, t.y, t.z);
    });
    addInteract(h, new THREE.Vector3(0, 2, 0.6), new THREE.Vector3(3, 2, 0.3), {
      prompt: (g) => (g.run.flags.greatDoorOpen ? null : 'The great door is sealed. A worn plate lies in the paving nearby.'),
      use: () => {},
    });
    yield;

    // ---------------------------------------------------------- sundial
    const S = SUNDIAL;
    const dialTop = 0.4;
    const base = mesh(new THREE.CylinderGeometry(S.radius, S.radius + 0.3, dialTop + 0.2, 32), surface('templeWall', EXP), S.x, (dialTop - 0.2) / 2, S.z);
    h.group.add(base);
    h.owner.staticCylinder(S.x, (dialTop - 0.2) / 2, S.z, (dialTop + 0.2) / 2, S.radius + 0.15);
    const step = mesh(new THREE.CylinderGeometry(S.radius + 1.0, S.radius + 1.1, 0.2, 32), surface('templeWallMoss', EXP), S.x, 0.0, S.z);
    h.group.add(step);
    // dial face with radial lines
    const face = mesh(new THREE.CircleGeometry(S.radius - 0.15, 48), surface('floor', EXP), S.x, dialTop + 0.005, S.z, false, true);
    face.rotation.x = -Math.PI / 2;
    h.group.add(face);
    for (let i = 0; i < SUNDIAL_GLYPHS; i++) {
      const a = sundialGlyphAngle(i);
      const line = mesh(new THREE.PlaneGeometry(0.05, S.rimRadius - 0.6), tinted(0x3a3228, EXP, 1), S.x + Math.cos(a) * (S.rimRadius / 2 + 0.1), dialTop + 0.01, S.z + Math.sin(a) * (S.rimRadius / 2 + 0.1), false, true);
      line.rotation.x = -Math.PI / 2;
      line.rotation.z = -a + Math.PI / 2;
      h.group.add(line);
    }
    // gnomon
    const gn = mesh(new THREE.BoxGeometry(0.34, 4.6, 0.34), surface('templeWall', EXP), S.x, dialTop + 2.3, S.z);
    const gnTop = mesh(new THREE.ConeGeometry(0.3, 0.6, 4), surface('gold', EXP), S.x, dialTop + 4.9, S.z);
    gnTop.rotation.y = Math.PI / 4;
    h.group.add(gn, gnTop);
    h.owner.staticBox(S.x, dialTop + 2.3, S.z, 0.17, 2.3, 0.17);
    // glyph stones on the north rim
    const glyphMat = standard('glyphStone', EXP, { map: T.glyphs, color: 0x3a3022, transparent: true, alphaTest: 0.3, roughness: 0.8 });
    const stones: THREE.Mesh[] = [];
    for (let i = 0; i < SUNDIAL_GLYPHS; i++) {
      const a = sundialGlyphAngle(i);
      const x = S.x + Math.cos(a) * S.rimRadius;
      const z = S.z + Math.sin(a) * S.rimRadius;
      const st = mesh(new THREE.BoxGeometry(0.62, 0.22, 0.5), surface('templeWall', EXP), x, dialTop + 0.11, z);
      st.rotation.y = -a + Math.PI / 2;
      const top = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.4), glyphMat);
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.111;
      // pick glyph i from the 4×3 sheet
      const uv = top.geometry.getAttribute('uv') as THREE.BufferAttribute;
      const col = i % 4;
      const row = Math.floor(i / 4);
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (col + uv.getX(k)) / 4, 1 - (row + 1 - uv.getY(k)) / 3);
      st.add(top);
      h.group.add(st);
      stones.push(st);
      if (run.flags.sundialSolved && i === run.sundialGlyph) st.position.y -= 0.12;
      addInteract(h, new THREE.Vector3(x, dialTop + 0.25, z), new THREE.Vector3(0.35, 0.25, 0.35), {
        prompt: (g) => (g.run.flags.sundialSolved ? null : 'E  Press the glyph stone'),
        use: (g) => {
          if (g.run.flags.sundialSolved) return;
          const want = sundialGlyph([g.sky.sunDir.x, g.sky.sunDir.y, g.sky.sunDir.z]);
          g.audio.click();
          st.position.y -= 0.05;
          setTimeout(() => (st.position.y += g.run.flags.sundialSolved && i === want ? 0 : 0.05), 250);
          if (want < 0 || !g.sky.sunUp) {
            g.toast('No shadow falls on the dial now. Nothing happens.', 'warn');
            return;
          }
          if (i === want) {
            g.run.flags.sundialSolved = true;
            g.run.sundialGlyph = i;
            st.position.y -= 0.12;
            g.audio.stoneGrind(new THREE.Vector3(S.x, 0.5, S.z), 2.5, 0.6);
            g.toast('The glyph sinks under the shadow. Something rises from the dial.', 'good');
            const li = g.items.create('sunDisc', 'sun_disc', new THREE.Vector3(S.x, dialTop + 1.0, S.z + S.radius - 0.9), 3);
            li.body.setLinvel({ x: 0, y: 2.5, z: 0.5 }, true);
          } else {
            g.run.sundialFailures++;
            g.toast('Wrong glyph! The pillars hiss...', 'danger');
            const pl = g.player.feet();
            g.fx.volleyAt(
              dartPillars.map((p) => new THREE.Vector3(p[0], DART_HEIGHT, p[1])),
              new THREE.Vector3(pl.x, DART_HEIGHT, pl.z),
              0.15,
            );
          }
        },
      });
    }
    // dart pillars around the dial
    const dartPillars: [number, number][] = [
      [S.x - 7, S.z - 6],
      [S.x + 7, S.z - 6],
      [S.x - 7, S.z + 6],
      [S.x + 7, S.z + 6],
    ];
    for (const [x, z] of dartPillars) {
      column(h, x, 0, z, 2.6, 0.45, EXP, false);
      const hole = mesh(new THREE.CircleGeometry(0.06, 8), tinted(0x101010, EXP, 1), x, DART_HEIGHT, z + (z < S.z ? 0.5 : -0.5), false, false);
      if (z > S.z) hole.rotation.y = Math.PI;
      h.group.add(hole);
    }
    void stones;
    yield;

    // ---------------------------------------------------------- camp
    {
      const g = new THREE.Group();
      const canvas = tinted(0xb8a070, EXP, 1, 0, { side: THREE.DoubleSide });
      const tent = new THREE.Group();
      for (const s of [-1, 1]) {
        const p = mesh(new THREE.PlaneGeometry(3.2, 1.9), canvas, 0, 0.82, s * 0.6);
        p.rotation.x = s * 0.88;
        tent.add(p);
      }
      tent.position.set(-1.8, 0, -1.2);
      tent.rotation.y = 0.3;
      g.add(tent);
      const chest = mesh(new THREE.BoxGeometry(1.2, 0.7, 0.8), surface('wood', EXP), 1.2, 0.35, -0.3);
      const lid = mesh(new THREE.BoxGeometry(1.25, 0.12, 0.85), surface('iron', EXP), 1.2, 0.72, -0.3);
      g.add(chest, lid);
      for (let i = 0; i < 3; i++) {
        const crate = mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), surface('wood', EXP), -0.2 + i * 0.4, 0.3 + (i === 2 ? 0.6 : 0), 1.6 - (i === 2 ? 0.35 : 0));
        crate.rotation.y = rng.range(-0.4, 0.4);
        g.add(crate);
      }
      // campfire
      const fireX = 3.4;
      const fireZ = 1.6;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const st = mesh(new THREE.DodecahedronGeometry(0.18, 0), surface('rock', EXP), fireX + Math.cos(a) * 0.55, 0.1, fireZ + Math.sin(a) * 0.55);
        g.add(st);
      }
      for (let i = 0; i < 3; i++) {
        const lg = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 5), surface('bark', EXP), fireX, 0.12, fireZ);
        lg.rotation.set(Math.PI / 2, (i / 3) * Math.PI, 0);
        g.add(lg);
      }
      g.position.set(CAMP.x, 0, CAMP.z);
      h.group.add(g);
      h.owner.staticBox(CAMP.x + 1.2, 0.4, CAMP.z - 0.3, 0.6, 0.4, 0.4);
      const flame = game.torch.makeFlame(1.6);
      flame.position.set(CAMP.x + fireX, 0.45, CAMP.z + fireZ);
      h.group.add(flame);
      game.torch.addSource({ id: 'campfire', pos: new THREE.Vector3(CAMP.x + fireX, 0.5, CAMP.z + fireZ), lit: () => true, strength: () => 1, radius: 12, flame });
      h.dispose.push(() => game.torch.removeSource('campfire'));
      addInteract(h, new THREE.Vector3(CAMP.x + 1.2, 0.6, CAMP.z - 0.3), new THREE.Vector3(0.8, 0.6, 0.6), {
        hold: 1.2,
        prompt: (g2) => {
          const v = g2.run.carriedValue();
          if (v > 0) return `E  Stash your loot (+$${v})`;
          return `Hold E  Leave the temple with $${g2.run.stashValue()} and end the run`;
        },
        use: (g2) => {
          if (g2.run.carriedValue() > 0) g2.stashAtCamp();
          else g2.endRun('escaped');
        },
      });
    }
    yield;

    // ---------------------------------------------------------- pillars, ruins, pedestals
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const z = 8 + i * 8.5;
        if (Math.abs(z - SUNDIAL.z) < 7) continue;
        const roll = rng.next();
        if (roll < 0.55) column(h, sx * 14, 0, z, roll < 0.3 ? 7.5 : rng.range(2, 4.5), 0.6, EXP);
        else if (roll < 0.85) {
          column(h, sx * 14, 0, z, 1.2, 0.6, EXP);
          toppledColumn(h, sx * (14 + rng.range(2, 4)), 0, z + rng.range(-2, 2), rng.range(4, 6.5), 0.58, rng.range(0, Math.PI), EXP, rng);
        }
        rubble(h, sx * 15.5, 0, z + 2, 1.4, 4, EXP, rng, false);
      }
    }
    toppledColumn(h, -26, 0, 30, 7, 0.65, 0.4, EXP, rng);
    toppledColumn(h, 24, 0, 34, 6, 0.6, -0.9, EXP, rng);
    rubble(h, -30, 0, 36, 3, 10, EXP, rng);
    rubble(h, 29, 0, 14, 2.5, 8, EXP, rng);
    for (const [id, x, z] of [
      ['c1', -24, 52],
      ['c2', 26, 50],
    ] as [string, number, number][]) {
      buildPedestal(game, h, id, x, 0, 0.75, z, EXP);
      column(h, x - 3, 0, z - 3, 3.5, 0.4, EXP);
      column(h, x + 3, 0, z - 3, 2.2, 0.4, EXP);
    }
    // low walls marking the plazas
    const lw: BoxSpec[] = [];
    for (const [x0, x1, z] of [
      [-34, -24, 61],
      [24, 34, 61],
      [-34, -27, 39.5],
      [27, 34, 39.5],
    ] as [number, number, number][]) lw.push({ c: [(x0 + x1) / 2, 0.4, z], h: [(x1 - x0) / 2, 0.5, 0.35], mat: 'templeWallMoss', exp: EXP });
    addBoxes(lw, h.group, h.owner);
    yield;

    // ---------------------------------------------------------- vegetation
    const veg = (x: number, z: number): number | null => {
      if (Math.abs(x) < 21 && z > 1 && z < 65) return rng.chance(0.06) ? 0.0 : null; // weeds in cracks
      if (Math.abs(x) > 19 && Math.abs(x) < 35 && ((z > 39 && z < 61) || (z > 7 && z < 29))) return rng.chance(0.08) ? 0.0 : null;
      if (x > 40) return null;
      if (z < 4) return null;
      return groundY(x, z);
    };
    buildVegetation(h.group, { x0: -52, x1: 40, z0: 2, z1: 70, ground: veg, trees: 26, palms: 22, ferns: 500, grass: 2400, seed: 21 }, game.quality.vegetation);
  },
};
