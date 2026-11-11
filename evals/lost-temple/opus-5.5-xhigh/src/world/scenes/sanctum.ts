/**
 * B2 Collapsed sanctum: an unstable roof (noise shakes debris loose), the Sun Idol on a
 * weight-trapped pedestal under the light well, the collapse sequence, the kick-wall
 * shortcut and the dark escape passage up from the vault.
 */
import * as THREE from 'three';
import { IDOL, KICK_WALL } from '../layout';
import { buildInteriorChunks, interiorGeometry, mesh, addBoxes, type BoxSpec } from '../build';
import { column, toppledColumn, rubble } from '../terrain';
import { hangingVines } from '../nature';
import { SunShaft } from '../shafts';
import { surface, tinted } from '../../engine/materials';
import { InstabilityMeter } from '../../logic/traps';
import { tryUnlock } from '../../logic/unlocks';
import { buildPedestal, buildSconce, pickSconces, wallDartSources, addInteract } from '../../entities/Interactables';
import { Rng } from '../../core/rng';
import type { SceneDef } from '../SceneManager';

const EXP = 'ruins' as const;

/** Inside the sanctum's main hall (where the roof can come down). */
function inMain(x: number, z: number) {
  return x > -16 && x < 16 && z > -96 && z < -62;
}
/** Under the remaining roof (not the light well). */
function underRoof(x: number, z: number) {
  return inMain(x, z) && !(x > -9 && x < 9 && z > -92 && z < -74);
}

export const sanctum: SceneDef = {
  id: 'sanctum',
  *build(game, h) {
    const rng = new Rng(505);
    const run = game.run;
    yield* buildInteriorChunks('sanctum', h.group, h.owner);

    const shaft = new SunShaft(h.group, { x0: -9, z0: -92, x1: 9, z1: -74 }, 16, 0, 0.06);
    h.update.push(() => shaft.update(game));

    // ---------------------------------------------------------- idol dais
    const dais: BoxSpec[] = [
      { c: [IDOL.x, 0.15, IDOL.z], h: [3.6, 0.15, 3.6], mat: 'templeWall', exp: EXP },
      { c: [IDOL.x, 0.45, IDOL.z], h: [2.5, 0.15, 2.5], mat: 'templeWall', exp: EXP },
    ];
    addBoxes(dais, h.group, h.owner);
    buildPedestal(game, h, 'idol', IDOL.x, 0.6, 1.7, IDOL.z, EXP, 'collapse');
    for (const [x, z] of [
      [-6, -77],
      [6, -77],
      [-6, -89],
      [6, -89],
    ] as [number, number][]) column(h, x, 0, z, 15.9, 0.85, EXP);
    // fallen roof slabs and debris
    for (let i = 0; i < 5; i++) {
      const x = rng.range(-14, 14);
      const z = rng.range(-94, -64);
      if (Math.abs(x) < 5 && Math.abs(z - IDOL.z) < 5) continue;
      const slab = mesh(new THREE.BoxGeometry(rng.range(2, 4), 0.6, rng.range(1.5, 3)), surface('templeWall', EXP), x, 0.4, z);
      slab.rotation.set(rng.range(-0.25, 0.25), rng.range(0, 3), rng.range(-0.25, 0.25));
      h.group.add(slab);
      h.owner.staticBox(x, 0.35, z, 1.0, 0.35, 0.8, undefined, slab.quaternion);
    }
    toppledColumn(h, -11, 0, -70, 7, 0.75, 0.3, EXP, rng);
    rubble(h, 12, 0, -82, 3, 10, EXP, rng);
    rubble(h, -12, 0, -88, 3, 10, EXP, rng);
    hangingVines(h.group, Array.from({ length: 22 }, () => ({ x: rng.range(-9, 9), y: 15.8, z: rng.chance(0.5) ? -92 : -74, len: rng.range(3, 9) })), EXP);
    buildPedestal(game, h, 's1', -13, 0, 1.0, -93, EXP);
    buildPedestal(game, h, 's2', 13, 0, 1.0, -93, EXP, 'darts', wallDartSources(0, 0, 0, [
      [15.6, -90],
      [15.6, -94],
      [9, -95.6],
    ]));
    yield;

    // ---------------------------------------------------------- instability: noise shakes the roof loose
    const meter = new InstabilityMeter(5);
    game.sanctumMeter = meter;
    h.dispose.push(() => {
      if (game.sanctumMeter === meter) game.sanctumMeter = null;
    });
    const drop = (x: number, z: number, big = false) => {
      // find a point under the roof near (x, z)
      for (let i = 0; i < 6; i++) {
        const px = x + rng.range(-4, 4);
        const pz = z + rng.range(-4, 4);
        if (underRoof(px, pz) || (big && inMain(px, pz))) {
          game.fx.rock(new THREE.Vector3(px, 15, pz), big ? rng.range(0.45, 0.8) : rng.range(0.2, 0.45));
          game.fx.dust(new THREE.Vector3(px, 15.2, pz), 0.5);
          return;
        }
      }
    };
    game.onNoiseHandlers.add(h.id, (x, _y, z, loud) => {
      if (!inMain(x, z)) return;
      const n = meter.add(loud);
      const pl = game.player.pos;
      for (let i = 0; i < n; i++) drop(pl.x, pl.z);
      if (n > 0) game.audio.rumble(1.2, 0.4);
    });
    h.dispose.push(() => game.onNoiseHandlers.remove(h.id));
    let grumbleT = 3;
    h.update.push((dt) => {
      meter.update(dt);
      grumbleT -= dt;
      if (grumbleT <= 0) {
        grumbleT = rng.range(3, 7);
        const p = game.player.pos;
        if (meter.value > 40 && inMain(p.x, p.z)) {
          game.fx.dust(new THREE.Vector3(p.x + rng.range(-3, 3), 15.3, p.z + rng.range(-3, 3)), 0.4);
          game.audio.crunch(new THREE.Vector3(p.x, 14, p.z), 0.3);
        }
      }
    });

    // ---------------------------------------------------------- the collapse (after the idol is taken)
    const archRubble = new THREE.Group();
    const buildArchRubble = () => {
      if (archRubble.children.length) return;
      const r2 = new Rng(7);
      for (let i = 0; i < 26; i++) {
        const s = r2.range(0.5, 1.2);
        const m = mesh(new THREE.DodecahedronGeometry(s, 0), surface('rock', EXP), r2.range(-3, 3), r2.range(0.3, 6), -61 + r2.range(-1.5, 1.2));
        m.rotation.set(r2.range(0, 3), r2.range(0, 3), r2.range(0, 3));
        archRubble.add(m);
      }
      h.group.add(archRubble);
      h.owner.staticBox(0, 3.5, -61, 3.2, 3.5, 1.4);
    };
    if (run.flags.archwayBlocked) buildArchRubble();
    h.update.push((dt) => {
      if (run.collapseT < 0) return;
      const before = run.collapseT;
      run.collapseT += dt;
      const t = run.collapseT;
      if (t < 25) {
        game.fx.shake = Math.max(game.fx.shake, 0.25 + 0.2 * Math.sin(t * 3));
        // rain of debris, denser near the player
        const rate = 2.5;
        if (Math.floor(t * rate) !== Math.floor(before * rate)) {
          const p = game.player.pos;
          if (inMain(p.x, p.z)) drop(p.x, p.z, rng.chance(0.3));
          drop(rng.range(-15, 15), rng.range(-95, -63), true);
        }
        if (Math.floor(t / 4) !== Math.floor(before / 4)) game.audio.rumble(4, 0.9);
      }
      if (before < 6 && t >= 6 && !run.flags.archwayBlocked) {
        run.flags.archwayBlocked = true;
        buildArchRubble();
        game.audio.crunch(new THREE.Vector3(0, 3, -61), 1.5);
        game.audio.rumble(3, 1);
        game.fx.dust(new THREE.Vector3(0, 2, -61.5), 3);
        game.toast('The archway caves in! Find another way out: the cracked wall in the side room.', 'danger');
      }
    });
    yield;

    // ---------------------------------------------------------- the kick wall (one way: from the sanctum side)
    const kw = new THREE.Group();
    const kwMesh = mesh(new THREE.BoxGeometry(4, 4, 1.6), surface('templeWall', EXP), 0, 0, 0);
    kw.add(kwMesh);
    for (let i = 0; i < 7; i++) {
      const crack = mesh(new THREE.BoxGeometry(rng.range(0.6, 1.8), 0.06, 0.05), tinted(0x141210, EXP, 1), rng.range(-1.2, 1.2), rng.range(-1.4, 1.4), -0.81, false, false);
      crack.rotation.z = rng.range(-1.2, 1.2);
      kw.add(crack);
    }
    kw.position.set(KICK_WALL.x, 2, KICK_WALL.z);
    let kwCol: ReturnType<typeof h.owner.staticBox> | null = null;
    if (!run.flags.kickWallBroken) {
      h.group.add(kw);
      kwCol = h.owner.staticBox(KICK_WALL.x, 2, KICK_WALL.z, 2, 2, 0.8);
    } else rubble(h, KICK_WALL.x, 0, KICK_WALL.z + 1.6, 1.8, 7, EXP, rng, false);
    let kicks = 0;
    addInteract(h, new THREE.Vector3(KICK_WALL.x, 1.5, KICK_WALL.z), new THREE.Vector3(2, 1.5, 0.95), {
      hold: 0.35,
      prompt: (g) => {
        if (g.run.flags.kickWallBroken) return null;
        return g.player.pos.z < KICK_WALL.z ? `E  Kick the cracked wall${kicks ? ` (${kicks}/3)` : ''}` : 'A cracked wall. It won\'t budge from this side.';
      },
      use: (g) => {
        if (g.run.flags.kickWallBroken) return;
        const r = tryUnlock('kickWall', g.run.flags, g.player.pos.z < KICK_WALL.z ? 'sanctum' : 'halls');
        if (!r.ok) {
          g.toast(r.reason, 'warn');
          return;
        }
        kicks++;
        g.audio.thud(new THREE.Vector3(KICK_WALL.x, 1, KICK_WALL.z), 0.9);
        g.noise(KICK_WALL.x, 1, KICK_WALL.z, 0.7);
        g.fx.shake = 0.3;
        g.fx.dust(new THREE.Vector3(KICK_WALL.x, 1, KICK_WALL.z - 0.9), 0.5);
        if (kicks < 3) return;
        g.run.flags = r.flags;
        h.group.remove(kw);
        if (kwCol) h.owner.removeCollider(kwCol);
        for (let i = 0; i < 10; i++) {
          g.fx.rock(new THREE.Vector3(KICK_WALL.x + rng.range(-1.6, 1.6), rng.range(0.5, 3.5), KICK_WALL.z + rng.range(-0.5, 0.5)), rng.range(0.25, 0.5), new THREE.Vector3(rng.range(-1, 1), 1, rng.range(3, 6)));
        }
        g.audio.crunch(new THREE.Vector3(KICK_WALL.x, 1, KICK_WALL.z), 1.4);
        g.toast(r.message, 'good');
      },
    });
    yield;

    // ---------------------------------------------------------- escape passage decor + sconces
    rubble(h, 24, 0, -100, 1.2, 5, 'dungeon', rng, false);
    rubble(h, 28, 0, -125, 1.2, 5, 'dungeon', rng, false);
    const sc = pickSconces(interiorGeometry().edges, 'sanctum', 12, new Set(['archway', 'kickwall']));
    for (const s of sc.slice(0, 16)) buildSconce(game, h, s);
  },
};
