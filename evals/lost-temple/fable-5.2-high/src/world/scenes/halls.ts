import { carve, type NavRect } from '../../core/navmesh';
import type { RoofOpening } from '../../core/sunlight';
import { bonePile, pillar, rubblePile } from '../props';
import { DartLauncher, LightShaft, PressurePlate, PushBlock, ScarabBand, SlideDoor, addVines, dartRow } from '../setpieces';
import type { SceneDef } from '../types';
import { flask, sconce, spawnRocks } from './common';

const ROOF_Y = 8.3;
/** Slots in the roof over each scarab band. The sun patch they throw slides west to east all day. */
export const BAND1_OPENINGS: RoofOpening[] = [9, 0, -9].map((cx) => ({ x1: cx - 1.25, x2: cx + 1.25, z1: -22.8, z2: -15.8, y: ROOF_Y }));
export const BAND2_OPENINGS: RoofOpening[] = [5, -5].map((cx) => ({ x1: cx - 1.5, x2: cx + 1.5, z1: -38.8, z2: -31.8, y: ROOF_Y }));
const CAVE_INS: RoofOpening[] = [{ x1: -12, x2: -6, z1: -14, z2: -9.5, y: ROOF_Y }, { x1: 8, x2: 13, z1: -50, z2: -45, y: ROOF_Y }];
const PILLARS: [number, number][] = [-12, -17, -29, -33, -45, -49].flatMap((z) => [[-7, z], [7, z]] as [number, number][]);

const hallFloor: NavRect[] = carve([{ x1: -14, z1: -52, x2: 14, z2: -8, y: 0 }],
  [...PILLARS.map(([x, z]) => ({ x1: x - 0.75, z1: z - 0.75, x2: x + 0.75, z2: z + 0.75 })), { x1: -13, z1: -31.5, x2: -12, z2: -30.5 }], 0.25);

export const halls: SceneDef = {
  id: 'halls',
  bounds: [{ x1: -16, x2: 16, z1: -54, z2: -7, y1: -5 }],
  nav: [...hallFloor, { x1: -2, z1: -54, x2: 2, z2: -52, y: 0, tag: 'portcullis' }],
  loot: [
    { id: 'h1', scene: 'halls', pos: [11.8, 0, -13.2] },
    { id: 'h2', scene: 'halls', pos: [-12.5, 0, -31], trap: 'hallDarts' },
    { id: 'h3', scene: 'halls', pos: [0, 0, -23], pedestal: true },
    { id: 'h4', scene: 'halls', pos: [12, 0, -39] },
    { id: 'h5', scene: 'halls', pos: [-12, 0, -50.2] },
    { id: 'h6', scene: 'halls', pos: [10.5, 0, -47.5], pedestal: true, rich: true },
  ],
  guardians: [
    { kind: 'shade', pos: [11, 0, -10.5], yaw: Math.PI, sweep: [[-10, 0, -40], [10, 0, -30], [0, 0, -12]] },
  ],
  map: [
    { x1: -14, z1: -52, x2: 14, z2: -8, kind: 'room' }, { x1: -14, z1: -26, x2: 14, z2: -20, kind: 'pit' },
    { x1: -14, z1: -42, x2: 14, z2: -36, kind: 'pit' }, { x1: -2, z1: -54, x2: 2, z2: -52, kind: 'path' },
  ],

  *build(game, b) {
    const { run } = game;
    // --- Shell -----------------------------------------------------------------------------
    b.box('floor', -16, -1, -54, 16, 0, -8);
    b.room('stone', -14, -52, 14, -8, 0, 8, 2,
      [{ side: 'n', a1: -2, a2: 2, h: 4.5 }, { side: 'e', a1: -33, a2: -30, h: 3.5, y: 3.5 }], {}, 's');
    // Thin inner wall behind the Great Door, so the hall is sealed even when the courtyard is not loaded.
    b.box('stone', -14, 0, -8.45, -2, 8, -8.02); b.box('stone', 2, 0, -8.45, 14, 8, -8.02); b.box('stone', -2, 5, -8.45, 2, 8, -8.02);
    yield;
    // Roof with its slots and cave-ins.
    const roof = carve([{ x1: -16, z1: -54, x2: 16, z2: -8, y: 8 }], [...BAND1_OPENINGS, ...BAND2_OPENINGS, ...CAVE_INS]);
    for (const r of roof) b.box('roof', r.x1, 8, r.z1, r.x2, 8.6, r.z2, { collide: false });
    for (const o of [...BAND1_OPENINGS, ...BAND2_OPENINGS, ...CAVE_INS]) b.piece(new LightShaft(game, b, o, 0));
    for (const [x, z] of PILLARS) pillar(b, 'stone', x, z, 0, 8);
    yield;
    // What fell out of the roof.
    rubblePile(b, -9, 0, -11.5, 1.7, 1.1, 21); rubblePile(b, 10.5, 0, -49.6, 1.2, 0.8, 23);
    bonePile(b, 4, 0, -24.5, 3); bonePile(b, -3.5, 0, -40.5, 4); bonePile(b, 12.6, 0, -21.5, 5);
    // Band edges are marked in dark stone so the danger reads before the first bite.
    for (const [z1, z2] of [[-26, -20], [-42, -36]] as const) {
      b.box('glyph', -14, 0, z1 - 0.25, 14, 0.02, z1, { collide: false, shadow: false, tint: 0.45 });
      b.box('glyph', -14, 0, z2, 14, 0.02, z2 + 0.25, { collide: false, shadow: false, tint: 0.45 });
    }
    b.piece(new ScarabBand(game, b, -14, -26, 14, -20, 0, BAND1_OPENINGS));
    b.piece(new ScarabBand(game, b, -14, -42, 14, -36, 0, BAND2_OPENINGS));
    yield;

    // --- Portcullis, plate and block --------------------------------------------------------
    const port = b.piece(new SlideDoor(game, b, { x: 0, y: 2.25, z: -53, sx: 4, sy: 4.5, sz: 0.5, open: [0, 4.4, 0], mat: 'iron', speed: 1.4 }));
    const portOpen = () => run.progress.portcullisOpen || run.progress.night;
    port.snap(portOpen() ? 1 : 0);
    b.piece({ fixedUpdate: () => port.setOpen(portOpen()) });
    b.piece(new PressurePlate(game, b, 'hallPlate', -1.2, -45.6, 1.2, -43.4, 0, (p) => {
      run.progress.portcullisOpen = p;
      if (p) game.toast('The portcullis rattles up. It will drop the moment the weight comes off.');
    }));
    b.piece(new PushBlock(game, b, 'hallBlock', -5, 0, -47.3));

    // --- Vine breach to the cliffs -----------------------------------------------------------
    b.piece(addVines(game, b, { x1: 13.3, x2: 14, z1: -33, z2: -30, y1: 0, y2: 3.5, nx: -1, nz: 0 }));

    // --- Trapped pedestal ------------------------------------------------------------------
    const darts = b.piece(new DartLauncher(game, b, 'hallDarts', dartRow(-13.95, 0, [-32.3, -31.7, -31.1, -30.5, -29.9], 1, 10)));
    game.relics.traps.set('hallDarts', () => darts.fire());

    sconce(game, b, 'h-s1', -13.95, 2.2, -10.5, 1, 0); sconce(game, b, 'h-s2', 13.95, 2.2, -28, -1, 0); sconce(game, b, 'h-s3', -3, 2.2, -51.95, 0, 1);
    flask(game, b, 'h-flask', 12.6, 0.02, -27.2);
    spawnRocks(game, 'halls', [[-11, 0, -29, 2.0], [3, 0, -34, 3.6], [-9.5, 0, -12.5, 5.8], [8, 0, -15, 1.1]]);
  },
};
