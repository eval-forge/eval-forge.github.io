/** Scene 4: Broken Halls. Roofless: the sun does half the level design. */
import * as THREE from 'three';
import { DAMAGE } from '../../core/traps';
import { gateOpen } from '../../core/unlock';
import { Gate, Lever, Trigger, slabMesh } from '../entities/doors';
import { LightShaft } from '../entities/env';
import { Fn, Plate, PushBlock } from '../entities/props';
import { Boulder, SwingBlade } from '../entities/traps';
import type { SceneKit } from '../kit';
import { HALLS } from '../layout/halls';
import { Y_TEMPLE } from '../layout/types';
import { mural, rock, sconce, slabWithHoles, supply, type Rect } from './common';

const Y = Y_TEMPLE;

export function* buildHalls(k: SceneKit): Generator<void> {
  const game = k.game;
  const H = HALLS;
  const top = H.roofY;
  const WT = top + 0.9;
  const W = 'templeStone';

  k.floorsFromLayout(undefined, (f) => ({ tint: f.tag === 'nave' ? 1 : 0.82 }));
  k.propsFromLayout({ tint: 0.85 });
  yield;

  // ------------------------------------------------------------ outer walls
  const sd = H.sanctumDoor;
  k.box(-27, -1, -74, -25, WT, sd.z0, W);
  k.box(-27, -1, sd.z1, -25, WT, -22, W);
  k.box(-27, Y + 3.9, sd.z0, -25, WT, sd.z1, W);
  k.box(25, -1, -74, 27, WT, -22, W);
  k.box(-25, -1, -74, H.seal.x0, WT, -72, W);
  k.box(H.seal.x1, -1, -74, 25, WT, -72, W);
  k.box(H.seal.x0, Y + 4.3, -74, H.seal.x1, WT, -72, W);
  // Carved jambs round the seal.
  for (const x of [H.seal.x0 - 0.5, H.seal.x1]) k.box(x, Y, -72, x + 0.5, Y + 4.8, -71.6, 'mossStone', { solid: false });
  k.box(H.seal.x0 - 0.5, Y + 4.3, -72, H.seal.x1 + 0.5, Y + 4.9, -71.6, 'mossStone', { solid: false });
  yield;

  // ------------------------------------------- east gallery: ramp and boulder
  const r = H.ramp;
  const p = H.platform;
  k.box(8, Y - 0.6, -56, 25, Y, -34, 'hallFloor', { tint: 0.9 });
  k.box(p.x0, Y - 0.6, p.z0, p.x1, p.y, p.z1, W, { tint: 0.9 });
  k.box(8, Y, p.z0, p.x0, top, p.z1, W, { tint: 0.85 });
  k.box(p.x1, Y, p.z0, 25, top, p.z1, W, { tint: 0.85 });
  k.box(p.x0, p.y, p.z0, p.x1, p.y + 1.6, p.z0 + 0.6, W); // backstop behind the boulder
  k.box(p.x0, p.y, p.z1 - 0.4, r.x0 - 0.5, p.y + 0.6, p.z1, W);
  k.box(r.x1 + 0.5, p.y, p.z1 - 0.4, p.x1, p.y + 0.6, p.z1, W);
  k.ramp(r.x0, r.zTop, r.x1, r.zBottom, r.yTop, Y, 'z', 'hallFloor', { steps: false });
  const segs = 10;
  for (let i = 0; i < segs; i++) {
    const z0 = r.zTop + ((r.zBottom - r.zTop) * i) / segs;
    const z1 = r.zTop + ((r.zBottom - r.zTop) * (i + 1)) / segs;
    const yHi = r.yTop - ((r.yTop - Y) * i) / segs;
    const yLo = r.yTop - ((r.yTop - Y) * (i + 1)) / segs;
    if (yLo - 0.1 > Y) k.box(r.x0, Y, z0, r.x1, yLo - 0.1, z1, W, { solid: false, tint: 0.75 });
    k.box(r.x0 - 0.5, Y, z0, r.x0, yHi + 0.45, z1, W, { tint: 0.95 });
    k.box(r.x1, Y, z0, r.x1 + 0.5, yHi + 0.45, z1, W, { tint: 0.95 });
  }
  const boulder = k.add(new Boulder(game, k.group, 'halls.boulder', { x: H.boulder.x, y: p.y, z: H.boulder.z }, H.boulder.r, { x: 0, y: 0, z: 2.4 }, false));
  k.trap('hallsBoulder', () => boulder.trigger());
  mural(k, 'boulder', ['hand', 'block', 'arrow', 'skull'], 13.5, Y + 1.2, -47, -1, 0, { dark: false, accent: 'block', height: 0.8 });
  k.prop('rubbleE', 'rubble', 5, 21, Y + 0.3, -44);
  k.prop('potE', 'pot', 2.5, 22.5, Y + 0.3, -50.5);
  k.prop('skullE', 'skull', 1, 10.2, Y + 0.3, -37);
  k.prop('rockE', 'rock', 3.5, 11.6, Y + 0.3, -53);
  yield;

  // ------------------------------------------------------------------ roof
  const roof = (x0: number, z0: number, x1: number, z1: number, holes: Rect[]): void => {
    slabWithHoles(k, x0, z0, x1, z1, top, top + 0.5, 'roofStone', holes, { tint: 0.9 });
    for (const h of holes) {
      k.add(new LightShaft(game, k.group, h.x0, h.z0, h.x1, h.z1, top + 0.5, Y, 1));
      // What fell out of the hole is still lying under it.
      const cx = (h.x0 + h.x1) / 2;
      const cz = (h.z0 + h.z1) / 2;
      k.boxRot(cx + 0.8, Y + 0.22, cz - 0.6, 1.6, 0.45, 1.1, cx * 0.7, 'roofStone', { rotZ: 0.12, solid: false });
      rock(k, cx - 1.1, Y, cz + 0.9, 0.5, { mat: 'roofStone', solid: false });
    }
  };
  roof(-25, -34, 25, -22, [{ x0: -17, z0: -31, x1: -12, z1: -26 }, { x0: -2.5, z0: -30, x1: 2.5, z1: -25.5 }, { x0: 13, z0: -31, x1: 18, z1: -26 }]);
  roof(-25, -50, -8, -34, [{ x0: -22.5, z0: -48, x1: -10, z1: -37 }]);
  roof(-25, -62, -8, -50, []);
  roof(-25, -72, 25, -62, [{ x0: -12, z0: -70, x1: -7, z1: -65 }, { x0: 1, z0: -70, x1: 6, z1: -65 }, { x0: 19.5, z0: -70, x1: 23.5, z1: -65.5 }]);
  // The nave has lost its vault: only the long beams are left, and they stripe the floor with shadow.
  for (const x of [-4.5, -1.5, 1.5, 4.5]) k.box(x - 0.6, top - 0.1, H.nave.z0, x + 0.6, top + 0.5, H.nave.z1, 'roofStone');
  for (const z of [-41, -48, -55]) k.box(H.nave.x0, top + 0.1, z - 0.22, H.nave.x1, top + 0.5, z + 0.22, 'roofStone');
  // East gallery beams. None closer to the ramp head than z -49: the boulder needs the headroom up there.
  for (const z of [-37.5, -43, -48.5]) k.box(8, top, z - 0.4, 25, top + 0.5, z + 0.4, 'roofStone');
  yield;

  // ------------------------------------------------------------------ seal
  {
    const g = new THREE.Group();
    g.add(slabMesh(game, 4, 4.3, 1.2, 'mossStone', false));
    const ring = game.mats.mesh(new THREE.TorusGeometry(0.62, 0.09, 8, 24), 'bronze', false);
    ring.position.set(0, 0.5, 0.62);
    g.add(ring);
    const disc = game.mats.mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.08, 24), 'gold', false);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(0, 0.5, 0.63);
    disc.visible = game.hasFlag('sealOpen');
    g.add(disc);
    g.position.set(16, Y + 2.15, -73);
    k.add(new Gate(game, k.group, g, { x: 16, y: Y + 2.15, z: -73 }, { x: 2, y: 2.15, z: 0.6 }, -4.4, () => gateOpen('seal', game.run.flags), 0.3));
    const socket: Trigger = k.add(
      new Trigger(game, k, { x: 16, y: Y + 2.6, z: -72.25 }, { x: 1.3, y: 1.3, z: 0.2 },
        () => {
          if (game.hasFlag('sealOpen') || game.hasFlag('sealsBroken')) return null;
          return game.run.satchel.hasKey('sun_disc') ? 'Set the Sun Disc into the seal' : 'A sun-shaped socket. Something round and bronze belongs here.';
        },
        () => {
          if (game.hasFlag('sealOpen') || !game.run.satchel.useKey('sun_disc')) {
            game.sfx('deny');
            return;
          }
          disc.visible = true;
          game.setFlag('sealOpen');
          game.sfx('unlock', { x: 16, y: Y + 2, z: -72 });
          game.toast('The seal grinds down into the floor. Cold air comes up the stair. Light your torch (F).', 'good');
          socket.remove();
        }),
    );
  }
  mural(k, 'seal', ['sun', 'door', 'arrow', 'flame', 'moon'], 21.4, Y + 2.2, -72, 0, 1, { dark: false, accent: 'sun', height: 1.2 });
  sconce(k, 'sealW', 12.6, Y + 2.1, -72, 0, 1, false);
  sconce(k, 'sealE', 19.4, Y + 2.1, -72, 0, 1, false);
  supply(k, 'sealFlask', 'flask', 11.2, Y, -70.6, false);

  // ----------------------------------------------------------- sanctum door
  {
    const m = slabMesh(game, 1.2, 3.95, 4, 'mossStone', false);
    m.position.set(-26, Y + 1.97, -44);
    k.add(new Gate(game, k.group, m, { x: -26, y: Y + 1.97, z: -44 }, { x: 0.6, y: 1.97, z: 2 }, -4.0, () => gateOpen('sanctumDoor', game.run.flags), 0.35));
  }
  yield;

  // ---------------------------------------------------- the block puzzle
  const blocks = [
    k.add(new PushBlock(game, 'halls.blockA', H.blockA.x, Y, H.blockA.z, 1.6, k.group, false)),
    k.add(new PushBlock(game, 'halls.blockB', H.blockB.x, Y, H.blockB.z, 1.6, k.group, false)),
  ];
  const plates: Plate[] = [];
  const check = (): void => {
    if (plates.length === 2 && plates[0].pressed && plates[1].pressed && !game.hasFlag('sanctumDoor')) {
      game.setFlag('sanctumDoor');
      game.sfx('unlock', { x: -25, y: Y + 1, z: -44 });
      game.toast('Both plates hold. Stone slides away in the west wall.', 'good');
    }
  };
  for (const pl of [H.plateA, H.plateB]) {
    plates.push(k.add(new Plate(game, pl.x - 1.25, pl.z - 1.25, pl.x + 1.25, pl.z + 1.25, Y, 150, false, check, k.group, false)));
    k.box(pl.x - 1.45, Y, pl.z - 1.45, pl.x + 1.45, Y + 0.02, pl.z + 1.45, 'mossStone', { solid: false });
  }
  k.add(
    new Lever(game, k, { x: -9.3, y: Y, z: -35.4 }, -Math.PI / 2, 'Pull: return the stone blocks to where they started', () => false, () => {
      for (const b of blocks) b.reset();
      game.toast('Counterweights drop. The blocks slide home.', 'info');
    }, false),
  );
  mural(k, 'puzzle', ['block', 'arrow', 'block', 'door'], -25, Y + 2, -40, 1, 0, { dark: false, accent: 'block', height: 1.1 });
  yield;

  // -------------------------------------------------------- blade corridor
  H.blades.zs.forEach((z, i) => {
    k.add(new SwingBlade(game, k.group, { x: (H.blades.x0 + H.blades.x1) / 2, y: top - 0.25, z }, 6.0, 'z', 0.5, i * 2.1, false));
    // Slots worn into the walls where the blade passes.
    k.box(H.blades.x0, Y + 0.3, z - 0.2, H.blades.x0 + 0.03, Y + 4.6, z + 0.2, 'char', { solid: false });
    k.box(H.blades.x1 - 0.03, Y + 0.3, z - 0.2, H.blades.x1, Y + 4.6, z + 0.2, 'char', { solid: false });
  });
  sconce(k, 'blade', -10, Y + 2.1, -51.4, -1, 0, false);
  sconce(k, 'treasury', -19, Y + 2.1, -55, 0, -1, false);
  supply(k, 'treasurySpare', 'spare', -19, Y, -57.8, false);
  mural(k, 'blades', ['hand', 'eye', 'skull'], -13, Y + 1.7, -50.9, 1, 0, { dark: false, height: 0.8 });

  // ------------------------------------------------- the nave and its scarabs
  mural(k, 'naveS', ['sun', 'hand', 'arrow', 'moon', 'skull'], 6, Y + 1.8, -35.6, -1, 0, { dark: false, accent: 'sun', height: 1.0 });
  mural(k, 'naveN', ['sun', 'hand', 'arrow', 'moon', 'skull'], -6, Y + 1.8, -60.4, 1, 0, { dark: false, accent: 'sun', height: 1.0 });
  let shade = 0;
  let chitter = 0;
  const n = H.nave;
  const probe = { x: 0, y: 0, z: 0 };
  k.add(
    new Fn({
      step: (dt) => {
        const pl = game.player;
        const near = pl.pos.x > n.x0 - 6 && pl.pos.x < n.x1 + 6 && pl.pos.z > n.z0 - 6 && pl.pos.z < n.z1 + 6 && pl.pos.y < top;
        if (!near) return;
        // Skitter in whatever shade there is, so the rule can be read before it bites.
        for (let i = 0; i < 2; i++) {
          probe.x = n.x0 + 0.3 + Math.random() * (n.x1 - n.x0 - 0.6);
          probe.z = n.z0 + 0.3 + Math.random() * (n.z1 - n.z0 - 0.6);
          probe.y = Y + 0.12;
          if (Math.hypot(probe.x - pl.pos.x, probe.z - pl.pos.z) < 13 && !game.isSunlit(probe)) game.particles.emit('scarab', probe, 1, { spread: 0.25 });
        }
        const inside = pl.alive && pl.pos.x > n.x0 && pl.pos.x < n.x1 && pl.pos.z > n.z0 && pl.pos.z < n.z1 && pl.pos.y < Y + 2.5;
        if (!inside) {
          shade = 0;
          return;
        }
        probe.x = pl.pos.x;
        probe.y = pl.pos.y + 0.9;
        probe.z = pl.pos.z;
        if (game.isSunlit(probe)) {
          shade = Math.max(0, shade - dt * 2);
          return;
        }
        shade += dt;
        if (shade < 0.35) return;
        game.damage(DAMAGE.scarabPerSec * dt, 'Stripped by shade scarabs in the nave. They do not cross sunlight.');
        game.particles.emit('scarab', pl.pos, 3, { spread: 0.5 });
        chitter -= dt;
        if (chitter <= 0) {
          chitter = 0.3;
          game.sfx('scarab', pl.pos, 1, 0.9 + Math.random() * 0.3);
        }
      },
    }),
  );
}
