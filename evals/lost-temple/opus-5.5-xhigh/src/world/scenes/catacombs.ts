/**
 * C1 Lower catacombs (zero ambient light): the dart corridor with hidden plates, the
 * flooded chamber with the Bone Key at the bottom, the crumbling floor over the bone pit,
 * and the sloped corridor with the rolling boulder.
 */
import * as THREE from 'three';
import { DART_PLATES, FLOOD, BONE_PIT, BOULDER, VINES } from '../layout';
import { buildInteriorChunks, interiorGeometry, mesh, type BoxSpec, addBoxes } from '../build';
import { rubble } from '../terrain';
import { vineFor, WaterSurface } from '../nature';
import { surface, tinted } from '../../engine/materials';
import { RAPIER, G_DYNAMIC, G_DEBRIS } from '../../engine/physics';
import { DartLauncher, FailTimer, DART_HEIGHT, DAMAGE } from '../../logic/traps';
import { buildPedestal, buildSconce, pickSconces, wallDartSources } from '../../entities/Interactables';
import { Rng } from '../../core/rng';
import type { SceneDef } from '../SceneManager';

const EXP = 'dungeon' as const;
const FLOOR_Y = -10;

export const catacombs: SceneDef = {
  id: 'catacombs',
  *build(game, h) {
    const rng = new Rng(606);
    const run = game.run;
    yield* buildInteriorChunks('catacombs', h.group, h.owner);

    // ---------------------------------------------------------- dart corridor
    const launchers = DART_PLATES.map(() => new DartLauncher(1.6, 3));
    const plateMeshes = DART_PLATES.map((p) => {
      const m = mesh(new THREE.BoxGeometry(3.6, 0.05, 1.1), surface('dungeonFloor', EXP), -52, FLOOR_Y + 0.01, p.z, false, true);
      h.group.add(m);
      for (const hz of p.holes) {
        const hole = mesh(new THREE.CircleGeometry(0.05, 6), tinted(0x050505, EXP, 1), -53.98, FLOOR_Y + DART_HEIGHT, hz, false, false);
        hole.rotation.y = Math.PI / 2;
        h.group.add(hole);
      }
      return m;
    });
    h.fixed.push((dt) => {
      const p = game.player;
      for (let i = 0; i < DART_PLATES.length; i++) {
        launchers[i].update(dt);
        const pz = DART_PLATES[i].z;
        const on = p.grounded && p.pos.x > -54 && p.pos.x < -50 && Math.abs(p.pos.z - pz) < 0.6 && p.feetY < FLOOR_Y + 0.4;
        plateMeshes[i].position.y = FLOOR_Y + (on ? -0.02 : 0.01);
        if (!on) continue;
        const n = launchers[i].trigger();
        if (n > 0) {
          game.audio.click();
          const holes = DART_PLATES[i].holes;
          for (let k = 0; k < n; k++) {
            const hz = holes[k % holes.length];
            game.fx.after(0.12 + k * 0.09, () => game.fx.dart(new THREE.Vector3(-53.9, FLOOR_Y + DART_HEIGHT, hz), new THREE.Vector3(1, 0, 0), 24));
          }
        }
      }
    });
    yield;

    // ---------------------------------------------------------- flooded chamber
    const basin = { x0: -75, x1: -65, z0: -75, z1: -63 };
    const water = new WaterSurface(h.group, basin.x0, basin.x1, basin.z0, basin.z1, FLOOD.surface, EXP, 0x1c3434);
    h.update.push((_dt, t) => water.update(t, 0));
    h.waters.push({ ...basin, surface: FLOOD.surface, bottom: -13 });
    // drowned columns and bones on the basin floor
    for (const [x, z] of [
      [-72, -72],
      [-68, -66],
      [-72, -66],
    ] as [number, number][]) {
      const c = mesh(new THREE.CylinderGeometry(0.4, 0.45, 3.5, 10), surface('dungeonWall', EXP), x, -11.25, z);
      h.group.add(c);
      h.owner.staticCylinder(x, -11.25, z, 1.75, 0.45);
    }
    rubble(h, -70, -13, -73, 2, 6, EXP, rng, false);
    yield;

    // ---------------------------------------------------------- crumbling floor over the bone pit
    const tilesX = 10;
    const tilesZ = 4;
    const tw = (BONE_PIT.x1 - BONE_PIT.x0) / tilesX;
    const td = (BONE_PIT.z1 - BONE_PIT.z0) / tilesZ;
    const tileGeo = new THREE.BoxGeometry(tw - 0.06, 0.3, td - 0.06);
    const tileMat = surface('dungeonFloor', EXP);
    const crackMat = tinted(0x4a4238, EXP, 1);
    interface Tile {
      id: string;
      x: number;
      z: number;
      col: RAPIER.Collider | null;
      mesh: THREE.Mesh;
      timer: FailTimer;
    }
    const tiles: Tile[] = [];
    for (let i = 0; i < tilesX; i++) {
      for (let j = 0; j < tilesZ; j++) {
        const id = `t${i}_${j}`;
        if (run.crumbled.has(id)) continue;
        const x = BONE_PIT.x0 + (i + 0.5) * tw;
        const z = BONE_PIT.z0 + (j + 0.5) * td;
        const m = mesh(tileGeo, tileMat, x, FLOOR_Y - 0.15, z, true, true);
        m.rotation.y = rng.range(-0.02, 0.02);
        h.group.add(m);
        const t: Tile = { id, x, z, col: null, mesh: m, timer: new FailTimer(0.35 + rng.range(0, 0.25)) };
        t.col = h.owner.staticBox(x, FLOOR_Y - 0.15, z, tw / 2 - 0.03, 0.15, td / 2 - 0.03, { kind: 'tile', ref: t, surface: 'stone' });
        tiles.push(t);
      }
    }
    const fall = (t: Tile) => {
      run.crumbled.add(t.id);
      if (t.col) h.owner.removeCollider(t.col);
      t.col = null;
      h.group.remove(t.mesh);
      const b = h.owner.body(RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x, FLOOR_Y - 0.15, t.z).setAngvel({ x: rng.range(-1, 1), y: 0, z: rng.range(-1, 1) }));
      h.owner.collider(RAPIER.ColliderDesc.cuboid(tw / 2 - 0.1, 0.14, td / 2 - 0.1).setMass(80).setCollisionGroups(G_DEBRIS), b, { kind: 'debris' });
      const fm = mesh(tileGeo, tileMat, t.x, FLOOR_Y - 0.15, t.z);
      h.group.add(fm);
      h.update.push(() => {
        const p = b.translation();
        const q = b.rotation();
        fm.position.set(p.x, p.y, p.z);
        fm.quaternion.set(q.x, q.y, q.z, q.w);
      });
      game.audio.crunch(new THREE.Vector3(t.x, FLOOR_Y, t.z), 0.8);
      game.fx.dust(new THREE.Vector3(t.x, FLOOR_Y - 0.2, t.z), 0.8);
      game.noise(t.x, FLOOR_Y, t.z, 0.5);
    };
    h.dispose.push(
      game.onStand((tag) => {
        if (tag.kind !== 'tile' || !tag.ref) return;
        const t = tag.ref as Tile;
        if (t.timer.touch()) {
          t.mesh.material = crackMat;
          game.audio.creak(new THREE.Vector3(t.x, FLOOR_Y, t.z), 0.4);
        }
      }),
    );
    h.fixed.push((dt) => {
      for (const t of tiles) {
        if (!t.col) continue;
        if (t.timer.update(dt)) fall(t);
        else if (t.timer.state === 'cracking') t.mesh.position.y = FLOOR_Y - 0.15 - Math.random() * 0.02;
      }
    });
    // bones at the bottom of the pit
    for (let i = 0; i < 40; i++) {
      const b = mesh(new THREE.CylinderGeometry(0.035, 0.03, rng.range(0.3, 0.6), 5), surface('bone', EXP), rng.range(BONE_PIT.x0 + 0.5, BONE_PIT.x1 - 0.5), BONE_PIT.floor + 0.04, rng.range(BONE_PIT.z0 + 0.5, BONE_PIT.z1 - 0.5), false, true);
      b.rotation.set(Math.PI / 2, rng.range(0, 3), 0);
      h.group.add(b);
    }
    for (let i = 0; i < 8; i++) {
      const s = mesh(new THREE.SphereGeometry(0.12, 8, 6), surface('bone', EXP), rng.range(BONE_PIT.x0 + 1, BONE_PIT.x1 - 1), BONE_PIT.floor + 0.1, rng.range(BONE_PIT.z0 + 1, BONE_PIT.z1 - 1), false, true);
      h.group.add(s);
    }
    const pitVine = VINES.find((v) => v.scene === 'catacombs')!;
    vineFor(h.group, pitVine, EXP, 61);
    h.vines.push(pitVine);
    yield;

    // ---------------------------------------------------------- the boulder
    if (!run.boulderSpent) {
      const R = BOULDER.radius;
      const body = h.owner.body(RAPIER.RigidBodyDesc.fixed().setTranslation(BOULDER.start.x, BOULDER.start.y, BOULDER.start.z));
      const col = h.owner.collider(RAPIER.ColliderDesc.ball(R).setMass(3500).setFriction(1.2).setRestitution(0.05).setCollisionGroups(G_DYNAMIC), body, { kind: 'boulder' });
      void col;
      const bm = mesh(new THREE.IcosahedronGeometry(R, 2), surface('rock', EXP), BOULDER.start.x, BOULDER.start.y, BOULDER.start.z);
      h.group.add(bm);
      const plate = mesh(new THREE.BoxGeometry(1.2, 0.05, 3.8), surface('dungeonFloor', EXP), BOULDER.plate.x, -11.38 + 0.02, BOULDER.plate.z, false, true);
      plate.rotation.z = Math.atan2(-4, 26);
      h.group.add(plate);
      let rolling = false;
      let hit = false;
      let rollT = 0;
      h.fixed.push((dt) => {
        const p = game.player;
        if (!rolling) {
          if (p.grounded && Math.abs(p.pos.x - BOULDER.plate.x) < 0.7 && p.pos.z > -103 && p.pos.z < -99) {
            rolling = true;
            body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
            body.setLinvel({ x: 3.2, y: 0, z: 0 }, true);
            game.audio.click();
            game.audio.stoneGrind(new THREE.Vector3(BOULDER.start.x, BOULDER.start.y, BOULDER.start.z), 1.5, 0.9);
            game.toast('Click... a deep rumble behind you. RUN!', 'danger');
          }
          return;
        }
        rollT += dt;
        const t = body.translation();
        const v = body.linvel();
        const sp = Math.hypot(v.x, v.z);
        game.fx.shake = Math.max(game.fx.shake, Math.max(0, 0.35 - Math.abs(t.x - p.pos.x) * 0.02));
        if (!hit && sp > 1.5 && Math.hypot(t.x - p.pos.x, t.z - p.pos.z) < R + 0.4 && p.feetY < t.y + R) {
          hit = true;
          p.damage(DAMAGE.boulder, 'boulder');
          p.externalVel.set(9, 3, 0);
          game.hurtFlash(1);
          game.audio.crunch(p.eye(), 1.2);
        }
        if (Math.floor(rollT * 3) !== Math.floor((rollT - dt) * 3)) game.audio.rumble(0.5, Math.min(1, sp / 6));
        if (t.x > -23.5 || rollT > 14) {
          run.boulderSpent = true;
          game.audio.crunch(new THREE.Vector3(t.x, t.y, t.z), 1.6);
          game.fx.dust(new THREE.Vector3(t.x, t.y, t.z), 3);
          for (let i = 0; i < 7; i++) game.fx.rock(new THREE.Vector3(t.x + rng.range(-1, 1), t.y + rng.range(-0.5, 1), t.z + rng.range(-1, 1)), rng.range(0.3, 0.6), new THREE.Vector3(rng.range(-3, 1), rng.range(1, 4), rng.range(-2, 2)));
          h.group.remove(bm);
          if (h.owner.bodies.includes(body)) h.owner.removeBody(body);
          game.noise(t.x, t.y, t.z, 1);
          rolling = false;
          h.fixed.splice(h.fixed.indexOf(boulderStep), 1);
        }
      });
      const boulderStep = h.fixed[h.fixed.length - 1];
      h.update.push(() => {
        if (run.boulderSpent) return;
        const t = body.translation();
        const q = body.rotation();
        bm.position.set(t.x, t.y, t.z);
        bm.quaternion.set(q.x, q.y, q.z, q.w);
      });
    } else rubble(h, -25, -13.7, -101, 1.5, 7, EXP, rng, false);
    yield;

    // ---------------------------------------------------------- pedestal, decor, sconces
    buildPedestal(game, h, 'cc8', -48, FLOOR_Y, -9.0, -48, EXP, 'darts', wallDartSources(0, FLOOR_Y, 0, [
      [-55.6, -46],
      [-55.6, -50],
      [-50, -53.6],
    ]));
    // wall niches with skulls along the landing and the north hall
    const deco: BoxSpec[] = [];
    for (const [x, z] of [
      [-56, -45],
      [-56, -51],
      [-66, -101],
      [-66, -103],
    ] as [number, number][]) {
      deco.push({ c: [x + 0.2, FLOOR_Y + 1.1, z], h: [0.25, 0.08, 0.6], mat: 'dungeonWall', exp: EXP });
      for (let k = 0; k < 3; k++) {
        const s = mesh(new THREE.SphereGeometry(0.11, 8, 6), surface('bone', EXP), x + 0.3, FLOOR_Y + 1.29, z - 0.35 + k * 0.35, true, true);
        h.group.add(s);
      }
    }
    // sarcophagi in the north hall
    for (const x of [-60, -52]) {
      deco.push({ c: [x, FLOOR_Y + 0.45, -102.2], h: [1.1, 0.45, 0.6], mat: 'dungeonWall', exp: EXP });
      deco.push({ c: [x, FLOOR_Y + 0.95, -102.2], h: [1.15, 0.07, 0.65], mat: 'dungeonWall', exp: EXP });
    }
    addBoxes(deco, h.group, h.owner);
    rubble(h, -47, FLOOR_Y, -88.5, 1.2, 5, EXP, rng, false);
    const sc = pickSconces(interiorGeometry().edges, 'catacombs', 10, new Set(['cc_pit', 'f_basin', 'seal', 'c_alcove']));
    for (const s of sc.slice(0, 18)) buildSconce(game, h, s);
  },
};
