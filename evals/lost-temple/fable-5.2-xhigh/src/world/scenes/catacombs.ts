/**
 * Scene 6: Lower Catacombs. Zone C: every surface here uses the dungeon
 * material variant, so nothing is lit unless a flame is near it.
 */
import * as THREE from 'three';
import { gateOpen } from '../../core/unlock';
import { RAPIER } from '../../engine/physics';
import { Gate, Lever, Trigger, barsMesh } from '../entities/doors';
import { Water } from '../entities/env';
import { Plate } from '../entities/props';
import { KeyPickup } from '../entities/relics';
import { CrumbleFloor, DartTrap } from '../entities/traps';
import type { SceneKit } from '../kit';
import { CATA } from '../layout/catacombs';
import { Y_CATA, Y_TEMPLE } from '../layout/types';
import { mural, rock, sconce, slabWithHoles, supply } from './common';

const Y = Y_CATA;
const WALL = 'dungeonWall';

export function* buildCatacombs(k: SceneKit): Generator<void> {
  const game = k.game;
  const C = CATA;
  const ceil = Y + C.ceil;
  const door = Y + 3.2;

  k.floorsFromLayout(undefined, (f) => ({ tint: f.mat === 'causeway' ? 0.95 : 1 }));
  yield;

  // ---------------------------------------------------------------- stairs
  const f1 = C.flight1;
  const ld = C.landing;
  const f2 = C.flight2;
  k.box(f1.x0 - 1, Y - 1, ld.z0 - 1, f1.x0, 6.2, f1.z1, WALL); // west wall of the stair and landing
  k.box(f1.x1, C.landingY - 1, f1.z0, f1.x1 + 1, 6.2, f1.z1, WALL); // east wall of the first flight
  k.box(ld.x0, Y - 1, ld.z0 - 1, f2.x1 - 1, 1.4, ld.z0, WALL); // north wall of landing and second flight
  k.box(f2.x0 + 1, Y - 1, f2.z1, f2.x1 - 1, 1.4, f2.z1 + 1, WALL); // south wall of the second flight
  // Under the first flight and landing: solid.
  k.box(f1.x0, Y - 1, ld.z0, f1.x1, C.landingY - 0.6, f1.z1, WALL, { solid: false });
  // Stepped ceilings that follow the flights down.
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const za = f1.z0 + ((f1.z1 - f1.z0) * i) / steps;
    const zb = f1.z0 + ((f1.z1 - f1.z0) * (i + 1)) / steps;
    const hi = C.landingY + ((Y_TEMPLE - C.landingY) * (i + 1)) / steps;
    k.box(f1.x0, hi + 3.7, za, f1.x1, Math.min(6.2, hi + 5.9), zb, WALL);
    const xa = f2.x0 + ((f2.x1 - 1 - f2.x0) * i) / steps;
    const xb = f2.x0 + ((f2.x1 - 1 - f2.x0) * (i + 1)) / steps;
    const hf = C.landingY + ((Y - C.landingY) * (xa - f2.x0)) / (f2.x1 - f2.x0);
    k.box(xa, Math.max(ceil, hf + 3.7), f2.z0, xb, Math.max(ceil, hf + 3.7) + 1.3, f2.z1, WALL);
  }
  k.box(ld.x0, C.landingY + 3.7, ld.z0, ld.x1, C.landingY + 5.9, ld.z1, WALL);
  k.box(f2.x1 - 1, ceil + 0.8, f2.z0, f2.x1, 1.4, f2.z1, WALL); // above the arch into the ossuary
  mural(k, 'descent', ['flame', 'eye', 'moon'], f1.x0 + 0.0, C.landingY + 1.7, -86, 1, 0, { accent: 'flame', height: 0.9 });
  sconce(k, 'landing', (ld.x0 + ld.x1) / 2, C.landingY + 2, ld.z0, 0, 1);
  yield;

  // --------------------------------------------------------------- ceiling
  slabWithHoles(k, -10, -125, 61, -79, ceil, ceil + 0.8, WALL, [
    { x0: f1.x0, z0: ld.z0, x1: f2.x1 - 1, z1: ld.z1 },
    { x0: f1.x0, z0: ld.z1, x1: f1.x1, z1: -79 },
  ], { tint: 0.85 });
  yield;

  // --------------------------------------------------------------- ossuary
  const o = C.ossuary;
  k.room(o.x0, o.z0, o.x1, o.z1, Y - 0.6, ceil, WALL, [
    { side: 'w', a: C.dart.z0, b: C.dart.z1, top: door },
    { side: 'w', a: f2.z0, b: f2.z1 },
    { side: 'e', a: C.crawl.z0, b: C.crawl.z1, top: Y + C.crawl.h },
    { side: 'e', a: C.crumble.z0, b: C.crumble.z1, top: door },
    { side: 'n', a: C.north.x0, b: C.north.x1, top: door },
  ]);
  // Bone shelves along the south wall: skulls stacked like bricks.
  {
    const skull = new THREE.IcosahedronGeometry(0.13, 1);
    const m = new THREE.Matrix4();
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 34; i++) {
        if ((i * 7 + row * 3) % 11 === 0) continue;
        m.makeTranslation(o.x0 + 0.5 + i * 0.39 + (row % 2) * 0.18, Y + 0.75 + row * 0.5, o.z1 - 0.2 - ((i + row) % 3) * 0.03);
        k.geo(skull, 'bone', m, { tint: 0.75 + ((i * 13 + row * 5) % 7) * 0.04 });
      }
      k.box(o.x0 + 0.2, Y + 0.5 + row * 0.5, o.z1 - 0.42, o.x1 - 0.2, Y + 0.58 + row * 0.5, o.z1, WALL, { solid: false });
    }
    skull.dispose();
    k.collider(RAPIER.ColliderDesc.cuboid((o.x1 - o.x0 - 0.4) / 2, 1.1, 0.21).setTranslation((o.x0 + o.x1) / 2, Y + 1.1, o.z1 - 0.21), { surface: 'stone' });
  }
  for (const [x, z] of [[29.4, -92.6], [40.8, -89.8], [31.2, -82.2]] as const) rock(k, x, Y, z, 0.55, { mat: 'bone', solid: false, squash: 0.5 });
  mural(k, 'ossuary', ['skull', 'flame', 'eye', 'hand'], 35, Y + 2.3, o.z0 + 0.0, 0, 1, { height: 1.0 });
  sconce(k, 'ossuaryW', o.x0, Y + 2.1, -82.4, 1, 0);
  sconce(k, 'ossuaryE', o.x1, Y + 2.1, -90, -1, 0);
  supply(k, 'ossFlask', 'flask', 29.2, Y, -93.2);
  k.prop('skullA', 'skull', 1, 33.5, Y + 0.3, -81.6);
  k.prop('skullB', 'skull', 1, 38.2, Y + 0.3, -92.8);
  k.prop('skullC', 'skull', 1.2, 30.4, Y + 0.3, -87.5);
  k.prop('potA', 'pot', 2.5, 41.2, Y + 0.3, -83);
  k.prop('rubbleA', 'rubble', 3.5, 36.4, Y + 0.3, -80.9);
  yield;

  // --------------------------------------------------------- dart corridor
  const d = C.dart;
  const cd = C.cryptDoor;
  k.box(3, Y - 0.6, d.z1, o.x0 - 1, ceil, d.z1 + 1, WALL); // south wall (the one with the holes)
  k.box(3, Y - 0.6, C.crypt.z1, cd.x0, ceil, d.z0, WALL); // north wall, 2 m of rock between corridor and crypt
  k.box(cd.x1, Y - 0.6, C.crypt.z1, o.x0 - 1, ceil, d.z0, WALL);
  k.box(cd.x0, door, C.crypt.z1, cd.x1, ceil, d.z0, WALL);
  for (const px of [21, 16.6, 6]) {
    const holes = [0.25, 0.75, 1.25, 1.75].map((q) => ({ x: px + q, y: Y + 1.3, z: d.z1 - 0.04 }));
    const trap = k.add(new DartTrap(game, k.group, holes, { x: 0, y: 0, z: -1 }, 3.3, true, 2));
    for (const h of holes) k.box(h.x - 0.06, h.y - 0.06, d.z1 - 0.03, h.x + 0.06, h.y + 0.06, d.z1, 'char', { solid: false });
    k.add(new Plate(game, px, d.z0 + 0.05, px + 2, d.z1 - 0.05, Y, 40, false, (pressed) => {
      if (pressed) trap.trigger();
    }, k.group, true));
  }
  mural(k, 'darts', ['hand', 'arrow', 'eye', 'skull'], 26.2, Y + 1.9, d.z0 + 0.0, 0, 1, { accent: 'arrow', height: 0.9 });
  sconce(k, 'dartE', 24.6, Y + 2.1, d.z0, 0, 1);
  sconce(k, 'dartW', 10.4, Y + 2.1, d.z1, 0, -1);
  yield;

  // ----------------------------------------------------------------- crypt
  const cr = C.crypt;
  k.room(cr.x0, cr.z0, cr.x1, cr.z1, Y - 0.6, ceil, WALL, [], { sides: 'new' });
  for (const sx of [9.2, 16.4]) {
    k.box(sx, Y, -100.6, sx + 2.4, Y + 0.95, -97.4, 'darkPillar');
    k.box(sx - 0.1, Y + 0.95, -100.7, sx + 2.5, Y + 1.15, -97.3, 'dungeonFloor', { solid: false });
  }
  {
    const holes = [17.7, 18.4, 19.1].map((x) => ({ x, y: Y + 1.3, z: cr.z0 + 0.04 }));
    const trap = k.add(new DartTrap(game, k.group, holes, { x: 0, y: 0, z: 1 }, 8.6, true));
    for (const h of holes) k.box(h.x - 0.06, h.y - 0.06, cr.z0, h.x + 0.06, h.y + 0.06, cr.z0 + 0.03, 'char', { solid: false });
    k.trap('cryptDarts', () => trap.trigger());
  }
  sconce(k, 'crypt', cr.x0, Y + 2.1, -96.4, 1, 0);
  supply(k, 'cryptFlask', 'flask', 19.2, Y, -95.8);
  k.prop('cryptSkull', 'skull', 1, 12.4, Y + 0.3, -103.2);
  k.prop('cryptRubble', 'rubble', 3, 15.2, Y + 0.3, -103.4);
  k.prop('cryptPot', 'pot', 2.2, 8.7, Y + 0.3, -96.2);

  // ------------------------------------------------------------- gate room
  const g = C.gateRoom;
  const vg = C.vaultGate;
  k.room(g.x0, g.z0, g.x1, g.z1, Y - 0.6, ceil, WALL, [{ side: 'e', a: d.z0, b: d.z1, top: door }], { sides: 'nse' });
  k.box(vg.x0, Y - 0.6, g.z0, vg.x1, ceil, vg.z0, WALL);
  k.box(vg.x0, Y - 0.6, vg.z1, vg.x1, ceil, g.z1, WALL);
  k.box(vg.x0, door, vg.z0, vg.x1, ceil, vg.z1, WALL);
  k.box(vg.x0, Y - 0.6, g.z0 - 1, vg.x1, ceil, g.z0, WALL);
  k.box(vg.x0, Y - 0.6, g.z1, vg.x1, ceil, g.z1 + 1, WALL);
  {
    const bars = barsMesh(game, 3, 3.2, false, true);
    bars.position.set(-9, Y + 1.6, -91.5);
    k.add(new Gate(game, k.group, bars, { x: -9, y: Y + 1.6, z: -91.5 }, { x: 0.12, y: 1.6, z: 1.5 }, 3.25, () => gateOpen('vaultGate', game.run.flags), 0.5));
    // The lock: a bronze serpent's mouth on the pier beside the bars.
    k.box(-8.25, Y + 1.0, -89.9, -8, Y + 1.6, -89.4, 'bronze', { solid: false });
    const lock: Trigger = k.add(
      new Trigger(game, k, { x: -8.4, y: Y + 1.4, z: -91.5 }, { x: 0.35, y: 1.3, z: 1.6 },
        () => {
          if (gateOpen('vaultGate', game.run.flags)) return null;
          return game.run.satchel.hasKey('serpent_key') ? 'Unlock the vault gate with the Serpent Key' : 'Bronze bars and a serpent-mouthed lock. The key is somewhere wet.';
        },
        () => {
          if (gateOpen('vaultGate', game.run.flags) || !game.run.satchel.useKey('serpent_key')) {
            game.sfx('deny');
            return;
          }
          game.setFlag('vaultGate');
          game.sfx('unlock', { x: -9, y: Y + 1, z: -91.5 });
          game.toast('The bars lift. The stair beyond goes down a long way.', 'good');
          lock.remove();
        }),
    );
  }
  mural(k, 'gate', ['key', 'wave', 'arrow', 'door'], -3, Y + 2.2, g.z0 + 0.0, 0, 1, { accent: 'key', height: 1.0 });
  sconce(k, 'gate', -3, Y + 2.1, g.z1, 0, -1);
  supply(k, 'gateSpare', 'spare', 0.8, Y, -96);
  k.prop('gateRubble', 'rubble', 12, -6.8, Y + 0.45, -95.4);
  k.prop('gateSkull', 'skull', 1, 1, Y + 0.3, -87.2);
  yield;

  // ------------------------------------------- north corridor and the flood
  const n = C.north;
  const fl = C.flooded;
  k.box(n.x0 - 1, Y - 0.6, fl.z1 + 1, n.x0, ceil, o.z0 - 1, WALL);
  k.box(n.x1, Y - 0.6, fl.z1 + 1, n.x1 + 1, ceil, o.z0 - 1, WALL);
  k.box(fl.x0, fl.deep - 1, fl.z0, fl.x1, fl.deep, fl.z1, 'dungeonFloor');
  k.room(fl.x0, fl.z0, fl.x1, fl.z1, fl.deep - 1, ceil, WALL, [{ side: 's', a: n.x0, b: n.x1, top: door }]);
  k.box(n.x0, fl.deep - 1, fl.z1, n.x1, Y - 0.6, fl.z1 + 1, WALL); // below the doorway
  k.add(new Water(game, k.group, 'catacombs', fl.x0, fl.z0, fl.x1, fl.z1, fl.water, { x: 0, y: 0, z: 0 }, true));
  // Island altar and the rock the far relic sits on.
  const isl = C.island;
  k.box(C.key.x - 0.6, isl.y, C.key.z - 0.6, C.key.x + 0.6, isl.y + 0.8, C.key.z + 0.6, 'darkPillar');
  if (!game.hasFlag('serpentKey')) {
    k.add(new KeyPickup(game, k, 'serpent_key', { x: C.key.x, y: isl.y + 0.86, z: C.key.z }, true, () => game.setFlag('serpentKey')));
  }
  k.cyl(C.rock.x, fl.deep, C.rock.z, 1.25, C.rock.y - fl.deep, WALL, { seg: 8, rTop: 1.0 });
  for (const [x, z] of [[41, -106], [41.4, -120], [27.6, -102.4]] as const) k.cyl(x, fl.deep, z, 0.7, ceil - fl.deep, 'darkPillar', { seg: 10 });
  mural(k, 'flood', ['wave', 'flame', 'skull'], n.x0 + 0.0, Y + 1.9, -97.4, 1, 0, { accent: 'wave', height: 0.9 });
  sconce(k, 'flood', n.x1, Y + 2.1, -96.6, -1, 0);
  supply(k, 'islandFlask', 'flask', isl.x1 - 0.8, isl.y, isl.z0 + 0.8);
  yield;

  // ------------------------------------- crumbling corridor, pit and crawl
  const cb = C.crumble;
  const cw = C.crawl;
  const ch = C.chapel;
  k.box(cb.x0, cb.pit - 1.6, cb.z0 - 1, cb.x1, Y - 0.6, cb.z0, WALL); // pit walls
  k.box(cb.x0, cb.pit - 1.6, cb.z1, cb.x1, Y - 0.6, cb.z1 + 1, WALL);
  k.box(cb.x0 - 0.6, cb.pit - 1.6, cb.z0, cb.x0, Y - 0.6, cb.z1, WALL);
  k.box(cb.x1, cb.pit - 1.6, cb.z0, cb.x1 + 0.6, Y - 0.6, cb.z1, WALL);
  k.box(cb.x0, cb.pit - 1.6, cb.z0, cb.x1, cb.pit - 1, cb.z1, 'dungeonFloor');
  k.box(cb.x0 + 1, Y - 0.6, cb.z0 - 1, cb.x1 - 1, ceil, cb.z0, WALL); // corridor walls above
  k.box(cb.x0 + 1, Y - 0.6, cb.z1, cb.x1 - 1, ceil, cb.z1 + 1, WALL);
  {
    // Spikes at the bottom, for anyone with a torch and a strong stomach.
    const spike = new THREE.ConeGeometry(0.12, 1.1, 5);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 40; i++) {
      m.makeTranslation(cb.x0 + 0.4 + (i % 10) * 1.0 + ((i * 7) % 3) * 0.12, cb.pit - 0.45, cb.z0 + 0.5 + Math.floor(i / 10) * 0.7);
      k.geo(spike, 'iron', m);
    }
    spike.dispose();
  }
  k.add(new CrumbleFloor(game, k.group, 'cata.crumble', cb.x0, cb.z0, cb.x1, cb.z1, Y, 10, 3, 0.55, 'dungeonFloor', true));
  k.box(cw.x0 + 1, Y - 0.6, cw.z0 - 1, cw.x1 - 1, ceil, cw.z0, WALL);
  k.box(cw.x0 + 1, Y - 0.6, cw.z1, cw.x1 - 1, ceil, cb.z0 - 1, WALL);
  k.box(cw.x0 + 1, Y + cw.h, cw.z0, cw.x1 - 1, ceil, cw.z1, WALL);
  {
    const bars = barsMesh(game, cw.z1 - cw.z0, cw.h, false, true);
    bars.position.set(cw.x0 + 0.5, Y + cw.h / 2, (cw.z0 + cw.z1) / 2);
    k.add(
      new Gate(game, k.group, bars, { x: cw.x0 + 0.5, y: Y + cw.h / 2, z: (cw.z0 + cw.z1) / 2 }, { x: 0.1, y: cw.h / 2, z: (cw.z1 - cw.z0) / 2 }, -1.32,
        () => game.run.get('cata.crawl', false) || game.hasFlag('sealsBroken'), 0.7),
    );
  }
  mural(k, 'crumble', ['hand', 'arrow', 'arrow', 'skull'], o.x1 + 0.0, Y + 1.9, -84.2, -1, 0, { height: 0.8 });

  // ---------------------------------------------------------------- chapel
  k.room(ch.x0, ch.z0, ch.x1, ch.z1, Y - 0.6, ceil, WALL, [
    { side: 'w', a: cw.z0, b: cw.z1, top: Y + cw.h },
    { side: 'w', a: cb.z0, b: cb.z1, top: door },
  ]);
  k.box(55.2, Y, -88, 56.8, Y + 1.05, -86, 'darkPillar');
  k.box(55.0, Y + 1.05, -88.2, 57.0, Y + 1.2, -85.8, 'dungeonFloor', { solid: false });
  {
    const holes = [-92.7, -92, -91.3].map((z) => ({ x: ch.x1 - 0.04, y: Y + 1.3, z }));
    const trap = k.add(new DartTrap(game, k.group, holes, { x: -1, y: 0, z: 0 }, 7.6, true));
    for (const h of holes) k.box(ch.x1 - 0.03, h.y - 0.06, h.z - 0.06, ch.x1, h.y + 0.06, h.z + 0.06, 'char', { solid: false });
    k.trap('chapelDarts', () => trap.trigger());
  }
  k.add(
    new Lever(game, k, { x: 52.7, y: Y, z: -90.4 }, Math.PI / 2, 'Pull: open the grate on the crawl tunnel', () => game.run.get('cata.crawl', false), () => {
      game.run.set('cata.crawl', true);
      game.toast('Iron scrapes somewhere to the west. The low tunnel is open.', 'good');
    }, true),
  );
  mural(k, 'chapel', ['block', 'arrow', 'hand', 'door'], 56, Y + 2.2, ch.z0 + 0.0, 0, 1, { accent: 'block', height: 1.0 });
  sconce(k, 'chapel', 56, Y + 2.1, ch.z1, 0, -1);
  supply(k, 'chapelFlask', 'flask', 53, Y, -81.2);
  k.prop('chapelSkull', 'skull', 1, 59.2, Y + 0.3, -86.6);
  k.prop('chapelRubble', 'rubble', 2.2, 53.4, Y + 0.3, -83.6);
  k.prop('chapelPot', 'pot', 3, 59.3, Y + 0.3, -89.6);
  for (const [x, z] of [[53, -93.2], [59.4, -80.8]] as const) rock(k, x, Y, z, 0.5, { mat: 'bone', solid: false, squash: 0.5 });
}
