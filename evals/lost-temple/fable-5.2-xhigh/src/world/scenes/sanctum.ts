/** Scene 5: Collapsed Sanctum. Half a ceiling, and it is listening. */
import * as THREE from 'three';
import { NOISE_SHAKE } from '../../core/noise';
import { clamp } from '../../core/rng';
import { NoiseMeter } from '../../core/traps';
import { gateOpen } from '../../core/unlock';
import { GROUPS, RAPIER } from '../../engine/physics';
import { Gate, KickWall, slabMesh } from '../entities/doors';
import { LightShaft } from '../entities/env';
import { Fn } from '../entities/props';
import { DebrisField } from '../entities/traps';
import type { SceneKit } from '../kit';
import { SANCTUM } from '../layout/sanctum';
import { Y_TEMPLE } from '../layout/types';
import { mural, rock, sconce, slabWithHoles, supply } from './common';

const Y = Y_TEMPLE;
const COLLAPSE_SECONDS = 32;
const BURY_AFTER = 5;

export function* buildSanctum(k: SceneKit): Generator<void> {
  const game = k.game;
  const S = SANCTUM;
  const top = S.ceilY + 1.2;
  const W = 'templeStone';
  const rng = k.rng;

  k.floorsFromLayout(undefined, (f) => ({ tint: f.mat === 'sanctumFloor' ? 0.9 : 0.8 }));
  k.propsFromLayout({ tint: 0.9 });
  yield;

  // ----------------------------------------------------------------- walls
  const c = S.corridor;
  const kw = S.kick;
  const sd = S.stairDoor;
  k.box(-66, -1, -68, -64, top, -34, W, { tint: 0.85 }); // west
  k.box(-34, -1, -68, -32, top, c.z0, W); // east, north of the corridor
  k.box(-34, -1, c.z1, -32, top, -34, W); // east, south of it
  k.box(-34, Y + 3.9, c.z0, -32, top, c.z1, W);
  k.box(-64, -1, -36, kw.x0, top, -34, W); // south, either side of the cracked section
  k.box(kw.x1, -1, -36, -34, top, -34, W);
  k.box(kw.x0, Y + 3.6, -36, kw.x1, top, -34, W);
  k.box(kw.x0, -1, -36, kw.x1, Y, -34, W, { solid: true });
  k.box(-64, -1, -68, sd.x0, top, -66, W, { tint: 0.85 }); // north, either side of the stair door
  k.box(sd.x1, -1, -68, -34, top, -66, W);
  k.box(sd.x0, Y + 3.5, -68, sd.x1, top, -66, W);
  // The corridor from the halls.
  k.box(-32, -1, c.z0 - 2, -27, 6.4, c.z0, W, { tint: 0.85 });
  k.box(-32, -1, c.z1, -27, 6.4, c.z1 + 2, W, { tint: 0.85 });
  k.box(-32, Y + 3.9, c.z0, -27, 6.4, c.z1, W, { tint: 0.7 });
  yield;

  // --------------------------------------------------------------- ceiling
  slabWithHoles(k, -64, -66, S.roofEdgeX, -36, S.ceilY, S.ceilY + 0.6, 'roofStone', [S.hole], { tint: 0.72 });
  // The broken edge: stubs of slab still hanging out over the open half.
  for (let z = -66; z < -36; ) {
    const w = rng.range(1.4, 3.2);
    const len = rng.range(0.4, 3.4);
    k.box(S.roofEdgeX, S.ceilY, z, S.roofEdgeX + len, S.ceilY + 0.6, Math.min(-36, z + w), 'roofStone', { tint: 0.8 });
    z += w;
  }
  k.add(new LightShaft(game, k.group, S.hole.x0, S.hole.z0, S.hole.x1, S.hole.z1, S.ceilY + 0.6, Y, 1.7));
  // What has already come down, in the open half.
  for (let i = 0; i < 16; i++) {
    const x = rng.range(-45, -35.5);
    const z = rng.range(-65, -37);
    if (Math.abs(z - (c.z0 + c.z1) / 2) < 3.4 && x > -40) continue; // keep the way in clear
    if (Math.hypot(x + 40, z + 51) < 1.6 || Math.hypot(x + 40, z + 61) < 1.6 || Math.hypot(x + 40, z + 41) < 1.6) continue;
    const s = rng.range(0.7, 1.9);
    k.boxRot(x, Y + s * 0.22, z, s * 1.4, s * 0.45, s, rng.next() * 3.1, 'roofStone', { rotZ: rng.range(-0.25, 0.25), rotX: rng.range(-0.15, 0.15) });
    if (i % 3 === 0) rock(k, x + 1.1, Y, z - 0.7, 0.45, { mat: 'roofStone', solid: false });
  }
  yield;

  // ------------------------------------------------------------------ dais
  const d = S.dais;
  for (let i = 0; i < d.steps; i++) {
    const h = d.half - i * 0.85;
    k.box(d.x - h, Y + i * d.stepH, d.z - h, d.x + h, Y + (i + 1) * d.stepH, d.z + h, 'sanctumFloor', { tint: 1.05 - i * 0.03 });
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    k.cyl(d.x + sx * (d.half - 0.5), Y + d.stepH, d.z + sz * (d.half - 0.5), 0.3, 1.5, 'bronze', { seg: 8, rTop: 0.2 });
  }
  // Niches in the west wall.
  for (const z of [-60, -51, -42]) {
    k.box(-64, Y, z - 1.5, -63.6, Y + 3.2, z - 1.1, 'mossStone', { solid: false });
    k.box(-64, Y, z + 1.1, -63.6, Y + 3.2, z + 1.5, 'mossStone', { solid: false });
    k.box(-64, Y + 3.0, z - 1.5, -63.6, Y + 3.4, z + 1.5, 'mossStone', { solid: false });
  }
  mural(k, 'idol', ['hand', 'block', 'arrow', 'eye'], -64, Y + 2.2, -55.5, 1, 0, { dark: false, accent: 'block', height: 1.0 });
  mural(k, 'quiet', ['hand', 'wave', 'skull'], -34, Y + 2.2, -39.5, -1, 0, { dark: false, accent: 'wave', height: 1.0 });
  mural(k, 'crack', ['door', 'arrow', 'sun'], -52.5, Y + 2.0, -36, 0, -1, { dark: false, height: 0.9 });
  sconce(k, 'west', -64, Y + 2.2, -46.5, 1, 0, false);
  sconce(k, 'north', -52, Y + 2.2, -66, 0, 1, false);
  supply(k, 'flask', 'flask', -62.6, Y, -64.6, false);
  // Something to leave in the idol's place (8 kg), and a few things that are not it.
  k.prop('rubble8', 'rubble', 8, -38.4, Y + 0.4, -57.6);
  k.prop('rubble5', 'rubble', 5, -42.2, Y + 0.4, -39.4);
  k.prop('rubble11', 'rubble', 11, -37.2, Y + 0.4, -48.8);
  k.prop('skull', 'skull', 1, -60.4, Y + 0.3, -38.2);
  k.prop('pot', 'pot', 2.5, -61.6, Y + 0.3, -55.4);
  yield;

  // ----------------------------------------------------------------- doors
  k.add(new KickWall(game, k, kw.x0, Y, kw.z0, kw.x1, Y + 3.6, kw.z1, { x: 0, y: 0, z: 1 }, false));
  {
    const m = slabMesh(game, 3, 3.55, 1.2, 'mossStone', false);
    m.position.set(-45, Y + 1.77, -67);
    k.add(new Gate(game, k.group, m, { x: -45, y: Y + 1.77, z: -67 }, { x: 1.5, y: 1.77, z: 0.6 }, -3.6, () => gateOpen('escapeStair', game.run.flags), 0.35));
  }

  // The door to the halls can be buried. Once it is, it stays buried.
  let pile: THREE.Group | null = null;
  let pileCol: RAPIER.Collider | null = null;
  const bury = (): void => {
    if (pile) return;
    pile = new THREE.Group();
    const r2 = k.rng.fork(77);
    for (let i = 0; i < 12; i++) {
      const s = r2.range(0.9, 1.8);
      const m = slabMesh(game, s * 1.3, s * 0.7, s, 'roofStone', false);
      m.position.set(r2.range(-35.6, -32.4), Y + 0.3 + (i % 4) * 0.85 + r2.range(0, 0.3), r2.range(c.z0 + 0.4, c.z1 - 0.4));
      m.rotation.set(r2.range(-0.5, 0.5), r2.range(0, 3.1), r2.range(-0.5, 0.5));
      pile.add(m);
    }
    k.group.add(pile);
    pileCol = game.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(1.9, 2.2, (c.z1 - c.z0) / 2 + 0.3).setTranslation(-34, Y + 2.2, (c.z0 + c.z1) / 2).setCollisionGroups(GROUPS.world),
      k.body,
    );
    game.physics.setMeta(pileCol, { surface: 'stone', kind: 'rubble' });
    const pl = game.player;
    if (pl.pos.x > -36.4 && pl.pos.x < -31.6 && pl.pos.z > c.z0 - 0.5 && pl.pos.z < c.z1 + 0.5) pl.teleport(-37.4, Y + 0.05, pl.pos.z, pl.yaw);
  };
  if (game.hasFlag('doorBuried')) bury();

  // -------------------------------------------------- the listening ceiling
  const debris = k.add(new DebrisField(game, k.group, S.ceilY, Y, 'roofStone', false));
  const meter = new NoiseMeter();
  const inRoom = (x: number, z: number): boolean => x > S.x0 - 1 && x < S.x1 + 1 && z > S.z0 - 1 && z < S.z1 + 1;
  const unlisten = game.listenNoise((n) => {
    if (!inRoom(n.pos.x, n.pos.z)) return;
    meter.add(NOISE_SHAKE[n.kind]);
  });
  const dropNear = (x: number, z: number, spread: number): void => {
    debris.drop(clamp(x + (Math.random() * 2 - 1) * spread, S.x0 + 1, S.roofEdgeX - 0.8), clamp(z + (Math.random() * 2 - 1) * spread, S.z0 + 1, S.z1 - 1));
  };
  let collapseT = game.run.get('sanctum.collapseT', -1);
  let groan = 0;
  let trickle = 0;
  if (collapseT >= 0 && collapseT < COLLAPSE_SECONDS) meter.startCollapse();
  k.trap('collapse', () => {
    if (collapseT >= 0) return;
    collapseT = 0;
    meter.startCollapse();
    game.shake(1);
    game.sfx('rumble', { x: d.x, y: Y, z: d.z }, 1);
    game.sfx('gong', { x: d.x, y: Y, z: d.z }, 0.8, 0.6);
    game.toast('The sanctum is coming down. The way you came in will not last. Find another.', 'bad');
  });
  k.trap('sanctumDebris', (p) => {
    for (let i = 0; i < 4; i++) debris.drop(clamp(p.x + 1.2 + Math.random() * 3.5, S.x0 + 1, S.roofEdgeX - 1), p.z + (Math.random() * 2 - 1) * 2.4, undefined, 0.5 + i * 0.3);
    meter.add(0.4);
  });
  k.add(
    new Fn({
      step: (dt) => {
        const pl = game.player;
        const here = inRoom(pl.pos.x, pl.pos.z);
        if (collapseT >= 0 && collapseT < COLLAPSE_SECONDS) {
          collapseT += dt;
          if (collapseT >= BURY_AFTER && !game.hasFlag('doorBuried')) {
            game.setFlag('doorBuried');
            bury();
            game.sfx('debris', { x: -34, y: Y + 1, z: -44 }, 1, 0.6);
            game.shake(0.8);
            game.particles.emit('dust', { x: -35, y: Y + 1.5, z: -44 }, 50, { spread: 2 });
            game.toast('The door to the halls is buried.', 'bad');
          }
          groan -= dt;
          if (groan <= 0) {
            groan = 2.2;
            game.sfx('rumble', { x: d.x, y: S.ceilY, z: d.z }, 0.8, 0.8 + Math.random() * 0.3);
            if (here) game.shake(0.45);
          }
          if (collapseT >= COLLAPSE_SECONDS) {
            meter.collapsing = false;
            meter.level = 0;
            game.toast('The dust settles. What is left of the ceiling holds, for now.', 'info');
          }
        }
        const n = meter.update(dt);
        for (let i = 0; i < n; i++) {
          // Noise brings it down near whoever made the noise; the collapse brings it down everywhere.
          if (meter.collapsing && Math.random() < 0.45) dropNear(rng.range(S.x0 + 2, S.roofEdgeX - 2), rng.range(S.z0 + 2, S.z1 - 2), 1);
          else dropNear(pl.pos.x, pl.pos.z, 2.6);
        }
        if (!here) return;
        // Dust sifts down as the strain builds: the warning before the stone.
        const strain = meter.strain;
        trickle -= dt * (0.4 + strain * 5);
        if (strain > 0.3 && trickle <= 0) {
          trickle = 1;
          const x = clamp(pl.pos.x + (Math.random() * 2 - 1) * 5, S.x0 + 1, S.roofEdgeX - 0.5);
          const z = clamp(pl.pos.z + (Math.random() * 2 - 1) * 5, S.z0 + 1, S.z1 - 1);
          game.particles.emit('dust', { x, y: S.ceilY - 0.2, z }, 5, { spread: 0.3, dir: { x: 0, y: -1, z: 0 }, speed: 1.2 });
          if (strain > 0.7 && Math.random() < 0.5) game.sfx('crack', { x, y: S.ceilY, z }, 0.5, 1.3);
        }
      },
      dispose: () => {
        unlisten();
        game.sanctumStrain = null;
        game.run.set('sanctum.collapseT', collapseT);
        pileCol = null;
        pile = null;
      },
    }),
  );
  game.sanctumStrain = () => meter.strain;
}
