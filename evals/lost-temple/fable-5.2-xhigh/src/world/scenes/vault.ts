/**
 * Scene 7: Deep Vault. Zone C. The richest loot, the guardians' lair next
 * door, and the escape stair that climbs back to the sanctum.
 */
import { gateOpen } from '../../core/unlock';
import { Gate, Lever, barsMesh, slabMesh } from '../entities/doors';
import { RopeLine } from '../entities/env';
import { DartTrap, DebrisField, PlankBridge, SwingBlade } from '../entities/traps';
import type { SceneKit } from '../kit';
import { Y_CATA, Y_TEMPLE, Y_VAULT } from '../layout/types';
import { VAULT } from '../layout/vault';
import { mural, rock, sconce, supply } from './common';

const Y = Y_VAULT;
const WALL = 'dungeonWall';

export function* buildVault(k: SceneKit): Generator<void> {
  const game = k.game;
  const V = VAULT;
  const ceil = Y + V.ceil;
  const base = Y - 1;
  const deep = V.chasm.floor - 1;

  k.floorsFromLayout();
  k.propsFromLayout();
  yield;

  // ------------------------------------------------ stair from the catacombs
  const st = V.stair;
  k.box(st.x0 + 1, base, st.z0 - 1, st.x1, Y_CATA + 4.4, st.z0, WALL);
  k.box(st.x0 + 1, base, st.z1, st.x1, Y_CATA + 4.4, st.z1 + 1, WALL);
  for (let i = 0; i < 4; i++) {
    const xa = st.x0 + ((st.x1 - st.x0) * i) / 4;
    const xb = st.x0 + ((st.x1 - st.x0) * (i + 1)) / 4;
    const hi = Y + ((Y_CATA - Y) * (i + 1)) / 4;
    k.box(xa, hi + 3.6, st.z0, xb, hi + 5.4, st.z1, WALL);
  }
  mural(k, 'down', ['eye', 'eye', 'moon', 'skull'], -17, (Y + Y_CATA) / 2 + 2.3, st.z0, 0, 1, { height: 0.9, accent: 'moon' });

  // ------------------------------------------------------------ chasm room
  const eb = V.eastBank;
  const wb = V.westBank;
  const cz0 = eb.z0;
  const cz1 = eb.z1;
  k.box(wb.x0, deep, cz0 - 1, V.tunnelGate.x0, ceil, cz0, WALL); // north wall (shared with the tunnel)
  k.box(V.tunnelGate.x1, deep, cz0 - 1, eb.x1 + 1, ceil, cz0, WALL);
  k.box(V.tunnelGate.x0, Y + 3.2, cz0 - 1, V.tunnelGate.x1, ceil, cz0, WALL);
  k.box(V.tunnelGate.x0, deep, cz0 - 1, V.tunnelGate.x1, Y - 0.6, cz0, WALL);
  k.box(wb.x0, deep, cz1, eb.x1 + 1, ceil, cz1 + 1, WALL); // south wall
  k.box(eb.x1, deep, cz0, eb.x1 + 1, ceil, st.z0, WALL); // east wall, either side of the stair
  k.box(eb.x1, deep, st.z1, eb.x1 + 1, ceil, cz1, WALL);
  k.box(eb.x1, deep, st.z0, eb.x1 + 1, Y - 0.6, st.z1, WALL);
  k.box(V.chasm.x0, deep, cz0, V.chasm.x1, V.chasm.floor, cz1, 'dungeonFloor');
  k.add(
    new PlankBridge(game, k.group, 'vault.bridge', { x: V.bridge.x1, y: Y, z: V.bridge.z }, { x: V.bridge.x0, y: Y, z: V.bridge.z }, {
      planks: 9, width: 1.6, crackDelay: 0.8, dark: true,
    }),
  );
  for (const x of [V.bridge.x1 + 0.3, V.bridge.x0 - 0.5]) {
    for (const s of [-1, 1]) k.box(x, Y, V.bridge.z + s * 0.95 - 0.1, x + 0.2, Y + 1.3, V.bridge.z + s * 0.95 + 0.1, 'wood', { surface: 'wood' });
  }
  k.add(new RopeLine(game, k, 'vault.rope', { x: eb.x0 + 0.35, y: Y, z: -96.5 }, { x: wb.x1 - 0.35, y: Y, z: -96.5 }, true));
  mural(k, 'chasm', ['hand', 'arrow', 'arrow', 'skull'], eb.x1, Y + 2.1, -87, -1, 0, { height: 0.9 });
  sconce(k, 'bankE', eb.x1, Y + 2.1, -95.8, -1, 0);
  supply(k, 'bankFlask', 'flask', eb.x1 - 0.6, Y, -84);
  rock(k, wb.x0 + 0.9, Y, -99, 0.7, { mat: WALL });
  yield;

  // ----------------------------------------------------------------- hall
  const h = V.hall;
  const d = V.door;
  const tn = V.tunnel;
  const lg = V.lairGate;
  const sd = V.stairDoor;
  const wellTop = Y_TEMPLE + 3.8;
  k.box(lg.x0, base, h.z0 - 1, eb.x1 + 1, ceil, h.z0, WALL); // north wall of hall and tunnel
  // East wall (2 m thick): tunnel mouth, then the door from the chasm.
  k.box(d.x0, base, tn.z1, d.x1, ceil, d.z0, WALL);
  k.box(d.x0, base, d.z1, d.x1, ceil, h.z1, WALL);
  k.box(d.x0, Y + 3.4, d.z0, d.x1, ceil, d.z1, WALL);
  k.box(d.x0, Y + 3.2, tn.z0, d.x1, ceil, tn.z1, WALL);
  // West wall (2 m thick) with the lair bars.
  k.box(lg.x0, base, h.z0, lg.x1, ceil, lg.z0, WALL);
  k.box(lg.x0, base, lg.z1, lg.x1, ceil, h.z1, WALL);
  k.box(lg.x0, Y + 3.2, lg.z0, lg.x1, ceil, lg.z1, WALL);
  // South wall (2 m thick): it is also the north side of the escape stairwell, so it runs full height.
  k.box(lg.x0, base, sd.z0, sd.x0, wellTop + 0.8, sd.z1, WALL);
  k.box(sd.x1, base, sd.z0, d.x1, wellTop + 0.8, sd.z1, WALL);
  k.box(sd.x0, Y + 3.5, sd.z0, sd.x1, wellTop + 0.8, sd.z1, WALL);
  // Tunnel: low roof, dead end at the bars.
  k.box(d.x1, Y + 3.2, tn.z0, tn.x1, ceil, tn.z1, WALL);
  k.box(tn.x1, base, tn.z0, tn.x1 + 1, ceil, tn.z1, WALL);
  // One ceiling over hall, chasm, tunnel and lair.
  k.box(-77, ceil, h.z0 - 1, eb.x1 + 1, ceil + 0.8, sd.z0, WALL, { tint: 0.85 });
  // Coffer dais.
  k.box(-61.6, Y, -90, -57.6, Y + 0.5, -86, 'vaultFloor', { tint: 1.1 });
  for (const [x, z] of [[-61.3, -89.7], [-57.9, -89.7], [-61.3, -86.3], [-57.9, -86.3]] as const) k.cyl(x, Y + 0.5, z, 0.16, 1.1, 'bronze', { seg: 8, solid: false });
  yield;

  // ----------------------------------------------------------------- gates
  {
    const bars = barsMesh(game, 3, 3.2, false, true);
    bars.position.set(-63, Y + 1.6, (lg.z0 + lg.z1) / 2);
    k.add(new Gate(game, k.group, bars, { x: -63, y: Y + 1.6, z: (lg.z0 + lg.z1) / 2 }, { x: 0.12, y: 1.6, z: 1.5 }, 3.25, () => gateOpen('lairGate', game.run.flags), 0.6));
    const tb = barsMesh(game, 3, 3.2, true, true);
    const tg = V.tunnelGate;
    tb.position.set((tg.x0 + tg.x1) / 2, Y + 1.6, (tg.z0 + tg.z1) / 2);
    k.add(new Gate(game, k.group, tb, { x: (tg.x0 + tg.x1) / 2, y: Y + 1.6, z: (tg.z0 + tg.z1) / 2 }, { x: 1.5, y: 1.6, z: 0.12 }, 3.25, () => gateOpen('lairGate', game.run.flags), 0.6));
    const slab = slabMesh(game, 2, 3.55, 1.5, 'darkPillar', true);
    slab.position.set((sd.x0 + sd.x1) / 2, Y + 1.77, (sd.z0 + sd.z1) / 2);
    k.add(new Gate(game, k.group, slab, { x: (sd.x0 + sd.x1) / 2, y: Y + 1.77, z: (sd.z0 + sd.z1) / 2 }, { x: 1, y: 1.77, z: 0.75 }, -3.62, () => gateOpen('escapeStair', game.run.flags), 0.4));
  }
  k.add(
    new Lever(game, k, { x: V.lever.x, y: Y, z: V.lever.z - 0.2 }, Math.PI, 'Pull: open the stair door (the way out)', () => game.hasFlag('escapeStair'), () => {
      game.setFlag('escapeStair');
      game.toast('Stone grinds twice: here, and far above. The escape stair is open.', 'good');
    }, true),
  );
  mural(k, 'escape', ['door', 'arrow', 'sun'], -54, Y + 2.2, h.z1, 0, -1, { accent: 'sun', height: 1.0 });
  mural(k, 'lair', ['eye', 'eye', 'eye', 'moon'], h.x0, Y + 2.3, -93, 1, 0, { accent: 'moon', height: 1.0 });
  sconce(k, 'hallN', -52, Y + 2.2, h.z0, 0, 1);
  sconce(k, 'hallS', -50, Y + 2.2, h.z1, 0, -1);
  sconce(k, 'hallW', h.x0, Y + 2.2, -86, 1, 0);
  supply(k, 'hallFlask', 'flask', -43, Y, -81);
  supply(k, 'hallSpare', 'spare', -61.2, Y, -103.2);

  // ----------------------------------------------------------------- traps
  {
    const holes = [-84.1, -83.4, -82.7].map((z) => ({ x: h.x1 - 0.04, y: Y + 1.3, z }));
    const trap = k.add(new DartTrap(game, k.group, holes, { x: -1, y: 0, z: 0 }, 13, true));
    for (const q of holes) k.box(h.x1 - 0.03, q.y - 0.06, q.z - 0.06, h.x1, q.y + 0.06, q.z + 0.06, 'char', { solid: false });
    k.trap('vaultDartsN', () => trap.trigger());
  }
  // A great axe hangs beside the middle pedestal. It is not there for decoration.
  const blade = k.add(new SwingBlade(game, k.group, { x: -53.25, y: ceil - 0.25, z: -92 }, 5.5, 'x', 0.85, 0, true, false));
  k.trap('vaultBlade', () => {
    blade.start();
    game.sfx('blade', { x: -53.25, y: Y + 1, z: -92 }, 1);
  });
  const debris = k.add(new DebrisField(game, k.group, ceil, Y, WALL, true));
  k.trap('vaultCrumble', (p) => {
    for (let i = 0; i < 7; i++) debris.drop(p.x + 0.6 + Math.random() * 4.5, p.z + 1.2 + (Math.random() * 2 - 1) * 2.6, undefined, 0.45 + i * 0.22);
    game.shake(0.6);
  });
  // Things heavy enough to leave on a pedestal.
  k.prop('rubble12', 'rubble', 12, -44, Y + 0.45, -88.5);
  k.prop('rubble35', 'rubble', 3.5, -60.6, Y + 0.3, -82);
  k.prop('rubble3', 'rubble', 3, -49.8, Y + 0.3, -102.6);
  k.prop('rubble2', 'rubble', 2.2, -54.4, Y + 0.3, -97.2);
  k.prop('rock1', 'rock', 1.2, -47.2, Y + 0.3, -90.6);
  k.prop('rubbleBank', 'rubble', 6, -38.2, Y + 0.35, -98.4);
  yield;

  // ------------------------------------------------------------------ lair
  const l = V.lair;
  k.room(l.x0, l.z0, l.x1, l.z1, base, ceil, WALL, [], { sides: 'nsw' });
  for (const [x, z, r] of [[-74.6, -85.4, 0.9], [-66, -99, 0.6], [-75, -93, 0.5]] as const) rock(k, x, Y, z, r, { mat: WALL, solid: false });
  for (const [x, z] of [[-69.5, -85], [-73.8, -98.8]] as const) rock(k, x, Y, z, 0.45, { mat: 'bone', solid: false, squash: 0.5 });
  yield;

  // ---------------------------------------------------------- escape stair
  const w = V.well;
  // Outer shell.
  k.box(w.x0 - 1, base, sd.z1, w.x0, wellTop + 0.8, w.z1, WALL); // west
  k.box(w.x1, base, sd.z1, w.x1 + 1, wellTop + 0.8, w.z1, WALL); // east
  k.box(-44, base, w.z0, w.x1, wellTop, -71.5, WALL); // fills the sliver beside the east landing
  k.box(w.x0 - 1, wellTop, sd.z1, w.x1 + 1, wellTop + 0.8, w.z1, WALL, { tint: 0.85 }); // ceiling
  // South liner: dungeon stone in front of the sanctum's wall, with the doorway cut out.
  const sdoor = { x0: -46.5, x1: -43.5 };
  k.box(w.x0, base, w.z1 - 0.4, sdoor.x0, wellTop, w.z1, WALL);
  k.box(sdoor.x0, Y_TEMPLE + 3.5, w.z1 - 0.4, w.x1, wellTop, w.z1, WALL);
  k.box(sdoor.x0, base, w.z1 - 0.4, w.x1, Y_TEMPLE - 0.6, w.z1, WALL);
  // Dividing walls between the three flights.
  k.box(w.x0, base, -75, -46, wellTop, -74.5, WALL);
  k.box(-58, base, -71.5, w.x1, wellTop, -71, WALL);
  sconce(k, 'wellLow', -45, V.y1 + 2.1, w.z0, 0, 1);
  sconce(k, 'wellHigh', w.x0, V.y2 + 2.1, -72.4, 1, 0);
  supply(k, 'wellFlask', 'flask', -44.6, V.y1, -76.6);
  mural(k, 'up', ['arrow', 'sun', 'door'], w.x0, Y + 2.0, -76.5, 1, 0, { accent: 'sun', height: 0.8 });
}
