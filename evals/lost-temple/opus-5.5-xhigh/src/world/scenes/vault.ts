/**
 * C2 Deep vault: the richest and heaviest loot on trapped pedestals, the Bone Key door,
 * the drawbridge lever (the shortcut out over the chasm) and the guardians' lair.
 */
import * as THREE from 'three';
import { VAULT_DOOR, DRAWBRIDGE } from '../layout';
import { buildInteriorChunks, interiorGeometry, mesh, addBoxes, type BoxSpec } from '../build';
import { rubble } from '../terrain';
import { surface, tinted } from '../../engine/materials';
import { RAPIER, G_STATIC } from '../../engine/physics';
import { tryUnlock } from '../../logic/unlocks';
import { buildPedestal, buildSconce, pickSconces, wallDartSources, addInteract, SlidingStone } from '../../entities/Interactables';
import { Rng } from '../../core/rng';
import type { SceneDef } from '../SceneManager';

const EXP = 'dungeon' as const;
const FY = -14;

export const vault: SceneDef = {
  id: 'vault',
  *build(game, h) {
    const rng = new Rng(707);
    const run = game.run;
    yield* buildInteriorChunks('vault', h.group, h.owner);

    // ---------------------------------------------------------- vault door
    const dg = new THREE.Group();
    dg.add(mesh(new THREE.BoxGeometry(0.8, 4, 4), surface('dungeonWall', EXP)));
    for (const y of [-1.3, 0, 1.3]) dg.add(mesh(new THREE.BoxGeometry(0.86, 0.18, 4.02), surface('iron', EXP), 0, y, 0));
    const keyhole = mesh(new THREE.BoxGeometry(0.9, 0.5, 0.16), surface('bone', EXP), 0, 0.3, 0);
    dg.add(keyhole);
    const door = new SlidingStone(game, h, dg, new THREE.Vector3(VAULT_DOOR.x, FY + 2, VAULT_DOOR.z), new THREE.Vector3(VAULT_DOOR.x, FY + 5.9, VAULT_DOOR.z), new THREE.Vector3(0.4, 2, 2), 0.3);
    door.set(run.flags.vaultDoorOpen ? 1 : 0);
    addInteract(h, new THREE.Vector3(VAULT_DOOR.x - 0.5, FY + 1.5, VAULT_DOOR.z), new THREE.Vector3(0.3, 1.5, 1.9), {
      prompt: (g) => {
        if (g.run.flags.vaultDoorOpen) return null;
        return g.run.flags.hasBoneKey ? 'E  Turn the Bone Key' : 'A sealed vault door. The keyhole is shaped like a carved bone.';
      },
      use: (g) => {
        const r = tryUnlock('vaultDoor', g.run.flags, 'catacombs');
        if (!r.ok) {
          g.toast(r.reason, 'warn');
          return;
        }
        g.run.flags = r.flags;
        door.target = 1;
        g.toast(r.message, 'good');
      },
    });
    yield;

    // ---------------------------------------------------------- pedestals
    buildPedestal(game, h, 'v1', -12, FY, FY + 1, -86, EXP);
    buildPedestal(game, h, 'v2', 8, FY, FY + 1, -86, EXP);
    buildPedestal(game, h, 'v3', -12, FY, FY + 1, -98, EXP, 'darts', wallDartSources(0, FY, 0, [
      [-17.6, -96],
      [-17.6, -100],
      [-6, -96],
    ]));
    buildPedestal(game, h, 'v4', 8, FY, FY + 1, -98, EXP, 'darts', wallDartSources(0, FY, 0, [
      [13.6, -96],
      [13.6, -100],
      [2, -100],
    ]));
    buildPedestal(game, h, 'v5', -2, FY, FY + 1, -108, EXP, 'collapse');
    // raised daises + columns + treasure heaps (lit only by flame)
    const deco: BoxSpec[] = [];
    for (const [x, z] of [
      [-12, -86],
      [8, -86],
      [-12, -98],
      [8, -98],
      [-2, -108],
    ] as [number, number][]) deco.push({ c: [x, FY + 0.08, z], h: [1.8, 0.1, 1.8], mat: 'dungeonFloor', exp: EXP });
    addBoxes(deco, h.group, h.owner);
    for (const z of [-82, -92, -104, -113]) {
      for (const x of [-16, 12]) {
        const c = mesh(new THREE.CylinderGeometry(0.6, 0.7, 7, 10), surface('dungeonWall', EXP), x, FY + 3.5, z);
        h.group.add(c);
        h.owner.staticCylinder(x, FY + 3.5, z, 3.5, 0.7);
      }
    }
    const gold = surface('gold', EXP);
    for (let i = 0; i < 9; i++) {
      const x = rng.range(-16, 12);
      const z = rng.range(-114, -82);
      if (Math.abs(x - 3) < 3 && z < -110) continue;
      const r = rng.range(0.5, 1.1);
      const pile = mesh(new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), gold, x, FY, z, true, true);
      pile.scale.y = 0.35;
      h.group.add(pile);
      for (let k = 0; k < 6; k++) {
        const coin = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 8), gold, x + rng.range(-r * 1.4, r * 1.4), FY + 0.01, z + rng.range(-r * 1.4, r * 1.4), false, true);
        coin.rotation.set(rng.range(-0.2, 0.2), 0, rng.range(-0.2, 0.2));
        h.group.add(coin);
      }
    }
    yield;

    // ---------------------------------------------------------- the drawbridge + lever
    const DB = DRAWBRIDGE;
    const pivot = new THREE.Group();
    pivot.position.set(DB.x, DB.y, DB.zHinge);
    const deck = new THREE.Group();
    deck.add(mesh(new THREE.BoxGeometry(DB.width, 0.35, 10), surface('wood', EXP), 0, -0.175, -5));
    for (const x of [-DB.width / 2 + 0.2, DB.width / 2 - 0.2]) deck.add(mesh(new THREE.BoxGeometry(0.2, 0.4, 10.1), surface('iron', EXP), x, -0.1, -5));
    pivot.add(deck);
    h.group.add(pivot);
    const dbBody = h.owner.body(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(DB.x, DB.y, DB.zHinge));
    h.owner.collider(RAPIER.ColliderDesc.cuboid(DB.width / 2, 0.175, 5).setTranslation(0, -0.175, -5).setCollisionGroups(G_STATIC), dbBody, { kind: 'static', surface: 'wood' });
    let angle = run.flags.drawbridgeDown ? 0 : Math.PI / 2;
    let stopGrind: (() => void) | null = null;
    const chainGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 5);
    const chains = [0, 1].map(() => {
      const c = mesh(chainGeo, surface('iron', EXP), 0, 0, 0, true, false);
      h.group.add(c);
      return c;
    });
    const applyDB = () => {
      pivot.rotation.x = angle;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(angle, 0, 0));
      dbBody.setNextKinematicRotation(q);
      dbBody.setNextKinematicTranslation({ x: DB.x, y: DB.y, z: DB.zHinge });
      // chains from above the arch to the deck's far corners
      const far = new THREE.Vector3(0, 0, -9.6).applyQuaternion(q).add(new THREE.Vector3(DB.x, DB.y, DB.zHinge));
      [-1, 1].forEach((sx, i) => {
        const a = new THREE.Vector3(DB.x + sx * (DB.width / 2 - 0.3), DB.y + 5.6, DB.zHinge + 0.4);
        const b = far.clone().add(new THREE.Vector3(sx * (DB.width / 2 - 0.3), 0, 0));
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const len = a.distanceTo(b);
        chains[i].position.copy(mid);
        chains[i].scale.set(1, len, 1);
        chains[i].quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      });
    };
    applyDB();
    dbBody.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(angle, 0, 0)), true);
    h.update.push((dt) => {
      const want = run.flags.drawbridgeDown ? 0 : Math.PI / 2;
      if (Math.abs(angle - want) < 1e-4) return;
      if (!stopGrind) stopGrind = game.audio.grindLoop(new THREE.Vector3(DB.x, DB.y + 2, DB.zHinge), 0.6);
      angle = Math.max(want, angle - dt * 0.4);
      game.fx.shake = Math.max(game.fx.shake, 0.06);
      applyDB();
      if (Math.abs(angle - want) < 1e-4) {
        stopGrind?.();
        stopGrind = null;
        game.audio.thud(new THREE.Vector3(DB.x, DB.y, DB.zFar), 1);
        game.audio.crunch(new THREE.Vector3(DB.x, DB.y, DB.zFar), 0.8);
        game.noise(DB.x, DB.y, DB.zFar, 0.9);
      }
    });
    h.dispose.push(() => stopGrind?.());
    // lever
    const lv = DB.lever;
    const leverBase = mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), surface('dungeonWall', EXP), lv.x, FY + 0.25, lv.z);
    const handlePivot = new THREE.Group();
    handlePivot.position.set(lv.x, FY + 0.5, lv.z);
    const handle = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), surface('iron', EXP), 0, 0.6, 0);
    const knob = mesh(new THREE.SphereGeometry(0.1, 8, 6), surface('bone', EXP), 0, 1.2, 0);
    handlePivot.add(handle, knob);
    handlePivot.rotation.x = run.flags.drawbridgeDown ? 0.7 : -0.7;
    h.group.add(leverBase, handlePivot);
    h.owner.staticBox(lv.x, FY + 0.25, lv.z, 0.3, 0.25, 0.3);
    addInteract(h, new THREE.Vector3(lv.x, FY + 1, lv.z), new THREE.Vector3(0.45, 0.8, 0.45), {
      prompt: (g) => (g.run.flags.drawbridgeDown ? null : 'E  Pull the lever'),
      use: (g) => {
        const r = tryUnlock('drawbridge', g.run.flags, 'vault');
        if (!r.ok) {
          g.toast(r.reason, 'warn');
          return;
        }
        g.run.flags = r.flags;
        handlePivot.rotation.x = 0.7;
        g.audio.click();
        g.toast(r.message + ' The way out beyond leads up to the sanctum.', 'good');
      },
    });
    yield;

    // ---------------------------------------------------------- the lair: bones, a nest of rubble
    for (let i = 0; i < 30; i++) {
      const b = mesh(new THREE.CylinderGeometry(0.035, 0.03, rng.range(0.3, 0.7), 5), surface('bone', EXP), rng.range(17, 31), FY + 0.04, rng.range(-113, -99), false, true);
      b.rotation.set(Math.PI / 2, rng.range(0, 3), 0);
      h.group.add(b);
    }
    rubble(h, 30, FY, -113, 2, 8, EXP, rng, false);
    rubble(h, 17.5, FY, -99.5, 1.5, 6, EXP, rng, false);
    // carved guardian reliefs either side of the lair arch
    for (const z of [-103.2, -108.8]) {
      const rel = mesh(new THREE.BoxGeometry(0.2, 3, 0.8), tinted(0x5a5246, EXP, 0.9), 14.1, FY + 1.6, z);
      h.group.add(rel);
    }

    // ---------------------------------------------------------- the vault's own cave-in (v5 trap)
    h.update.push((dt) => {
      if (run.vaultCollapseT < 0 || run.vaultCollapseT > 10) return;
      const before = run.vaultCollapseT;
      run.vaultCollapseT += dt;
      game.fx.shake = Math.max(game.fx.shake, 0.2);
      if (Math.floor(run.vaultCollapseT * 2.5) !== Math.floor(before * 2.5)) {
        const p = game.player.pos;
        const x = Math.max(-17, Math.min(13, p.x + rng.range(-4, 4)));
        const z = Math.max(-115, Math.min(-81, p.z + rng.range(-4, 4)));
        game.fx.rock(new THREE.Vector3(x, FY + 6.5, z), rng.range(0.25, 0.6));
        game.fx.dust(new THREE.Vector3(x, FY + 6.8, z), 0.4);
      }
      if (Math.floor(before / 3) !== Math.floor(run.vaultCollapseT / 3)) game.audio.rumble(3, 0.8);
    });

    const sc = pickSconces(interiorGeometry().edges, 'vault', 10, new Set(['chasm', 'vaultdoor', 'l_arch']));
    for (const s of sc.slice(0, 16)) buildSconce(game, h, s);
  },
};
