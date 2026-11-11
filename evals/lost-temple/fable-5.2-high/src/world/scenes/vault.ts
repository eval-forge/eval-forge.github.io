import { carve, type NavRect } from '../../core/navmesh';
import { bonePile, pillar, statue } from '../props';
import { Blade, Boulder, DartLauncher, Lever, PressurePlate, dartRow, dartRowZ } from '../setpieces';
import type { SceneDef } from '../types';
import { chamber, flask, sconce, spareTorch, spawnRocks } from './common';

const Y = -10, TOP = -6;
const HALL_PILLARS: [number, number][] = [[-78, -100], [-78, -90], [-66, -100], [-66, -90]];
const hall: NavRect[] = carve([{ x1: -84, z1: -104, x2: -60, z2: -86, y: Y }], [
  ...HALL_PILLARS.map(([x, z]) => ({ x1: x - 0.8, z1: z - 0.8, x2: x + 0.8, z2: z + 0.8 })),
  { x1: -83, z1: -97, x2: -80.5, z2: -93 }, { x1: -72.5, z1: -99, x2: -71.5, z2: -98 },
], 0.25);
const rampY = (z: number) => Y + ((-106 - z) / 16) * (TOP - Y);

/**
 * Deep vault: the treasure hall, the guardians' lair next door, the boulder ramp up to the crown
 * chamber, and the blade corridor to the drawbridge lever, which is the long way home.
 */
export const vault: SceneDef = {
  id: 'vault',
  bounds: [{ x1: -95, x2: -59, z1: -142, z2: -70, y1: -60, y2: 0 }],
  nav: [
    { x1: -60, z1: -96.5, x2: -58, z2: -93.5, y: Y, tag: 'vaultDoor' },
    ...hall,
    { x1: -75, z1: -86, x2: -71, z2: -84, y: Y }, { x1: -80, z1: -84, x2: -66, z2: -74, y: Y },
    { x1: -74, z1: -106, x2: -70, z2: -104, y: Y },
    { x1: -74, z1: -122, x2: -70, z2: -106, y: TOP, y2: Y, slope: 'z' },
    { x1: -74, z1: -124, x2: -70, z2: -122, y: TOP }, { x1: -80, z1: -136, x2: -64, z2: -124, y: TOP },
    { x1: -66, z1: -106, x2: -62, z2: -104, y: Y }, { x1: -66, z1: -117, x2: -62, z2: -106, y: Y },
    { x1: -66, z1: -123, x2: -60, z2: -117, y: Y }, { x1: -60, z1: -121.5, x2: -58, z2: -118.5, y: Y },
  ],
  loot: [
    { id: 'v1', scene: 'vault', pos: [-81.8, Y + 0.4, -95], fixed: 'calendar', pedestal: true },
    { id: 'v2', scene: 'vault', pos: [-77, TOP, -130], fixed: 'crown', trap: 'crownDarts' },
    { id: 'v3', scene: 'vault', pos: [-82.6, Y, -102.6], rich: true },
    { id: 'v4', scene: 'vault', pos: [-61.6, Y, -87.6], rich: true },
    { id: 'v5', scene: 'vault', pos: [-72, Y, -98.5], trap: 'vaultDarts' },
    { id: 'v6', scene: 'vault', pos: [-78.4, Y, -75.6], rich: true },
    { id: 'v7', scene: 'vault', pos: [-67.4, Y, -82.6], rich: true },
    { id: 'v8', scene: 'vault', pos: [-65.6, TOP, -134.4], fixed: 'ingot' },
    { id: 'v9', scene: 'vault', pos: [-64.8, Y, -122], rich: true },
    { id: 'v10', scene: 'vault', pos: [-82.6, Y, -87.6], fixed: 'ingot' },
  ],
  guardians: [
    { kind: 'sentinel', pos: [-73, Y, -79], yaw: Math.PI, sweep: [[-72, Y, -98], [-45, Y, -95], [-34, Y, -95], [-33.5, Y, -109], [-33.5, Y, -120], [0, Y, -120], [0, 0, -80], [0, 0, -30], [0, 0, -12]] },
    { kind: 'crawler', pos: [-78, Y, -82], yaw: Math.PI, sweep: [[-63, Y, -120], [-45, Y, -120], [-33.5, Y, -120], [0, Y, -120], [-10, 0, -70], [8, 0, -40], [0, 0, -12]] },
    { kind: 'shade', pos: [-68, Y, -76], yaw: Math.PI, sweep: [[-34, Y, -95], [-34, -12.2, -77], [-21.7, Y, -66], [-17, 0, -64.5], [0, 0, -60], [-8, 0, -30], [0, 0, -12]] },
  ],
  map: [
    { x1: -84, z1: -104, x2: -60, z2: -86, kind: 'room' }, { x1: -80, z1: -84, x2: -66, z2: -74, kind: 'room' },
    { x1: -74, z1: -124, x2: -70, z2: -104, kind: 'path' }, { x1: -80, z1: -136, x2: -64, z2: -124, kind: 'room' },
    { x1: -66, z1: -117, x2: -62, z2: -104, kind: 'path' }, { x1: -66, z1: -123, x2: -58, z2: -117, kind: 'room' },
  ],

  *build(game, b) {
    const { run } = game;
    const W = 'crypt', F = 'cryptFloor';
    // --- Treasure hall --------------------------------------------------------------------------
    chamber(b, W, F, -84, -104, -60, -86, Y, -5, 2,
      [{ side: 'n', a1: -74, a2: -70, h: 4 }, { side: 'n', a1: -66, a2: -62, h: 3.6 }, { side: 's', a1: -75, a2: -71, h: 3.2 }], 'e');
    b.box(W, -60, -5.5, -104, -58, -5, -86);
    for (const [x, z] of HALL_PILLARS) pillar(b, 'glyph', x, z, Y, 5, 0.6);
    b.box('glyph', -83.6, Y, -97.2, -80.6, Y + 0.4, -92.8);                            // dais for the sun calendar
    statue(b, W, -82.4, Y, -99.2, Math.PI / 2, 1.1); statue(b, W, -82.4, Y, -90.8, Math.PI / 2, 1.1);
    b.box('gold', -83.95, Y + 1.2, -96.5, -83.8, Y + 4, -93.5, { collide: false, shadow: false });
    bonePile(b, -63, Y, -101.5, 61); bonePile(b, -76.5, Y, -87.5, 62); bonePile(b, -69, Y, -96.5, 63);
    const vd = b.piece(new DartLauncher(game, b, 'vaultDarts', [
      ...dartRow(-83.95, Y, [-99.3, -98.7, -98.2, -97.6], 1, 23.5), ...dartRow(-60.05, Y, [-99.1, -98.5, -97.9], -1, 23.5),
    ]));
    game.relics.traps.set('vaultDarts', () => vd.fire());
    sconce(game, b, 'v-s1', -60.05, Y + 2.2, -100, -1, 0); sconce(game, b, 'v-s2', -79, Y + 2.2, -103.95, 0, 1); sconce(game, b, 'v-s3', -65, Y + 2.2, -86.05, 0, -1);
    yield;

    // --- Guardians' lair ------------------------------------------------------------------------
    chamber(b, W, F, -80, -84, -66, -74, Y, -5.5, 2, [], 'n');
    for (const [x, z] of [[-78.6, -78.6], [-67.4, -78.6]] as const) pillar(b, W, x, z, Y, 4.5, 0.5);
    bonePile(b, -70, Y, -75, 64); bonePile(b, -76, Y, -83, 65); bonePile(b, -73, Y, -76.6, 66); bonePile(b, -67, Y, -80, 67);
    yield;

    // --- Boulder ramp and crown chamber ---------------------------------------------------------
    b.stairs(F, 'z', -106, -122, -74, -70, Y, TOP);
    // Side walls, each with one alcove to dive into.
    b.box(W, -76, Y - 1, -110, -74, -1.3, -106); b.box(W, -76, Y - 1, -122, -74, -1.3, -112.4);
    b.box(W, -78, Y - 1, -112.6, -76, -1.3, -109.8); b.box(F, -76, Y - 1, -112.4, -74, rampY(-111.2), -110);
    b.box(W, -70, Y - 1, -116.6, -68, -1.3, -106); b.box(W, -70, Y - 1, -122, -68, -1.3, -119);
    b.box(F, -70, Y - 1, -119, -68, rampY(-117.8), -116.6);
    b.box(W, -76, -2, -122, -68, -1.3, -104, { tint: 0.8 });
    b.box(W, -74, -6, -106, -70, -2, -104.6);
    const boulder = b.piece(new Boulder(game, b, 'crown', -72, TOP + 1.52, -130.5, 1.5, [0, 0, 5]));
    b.piece(new PressurePlate(game, b, 'boulderPlate', -74, -115.2, -70, -114.2, rampY(-114.7), (p) => {
      if (p && !boulder.released) { run.stats.trapsSprung++; boulder.release(); }
    }));
    chamber(b, W, F, -80, -136, -64, -124, TOP, -1, 2, [{ side: 's', a1: -74, a2: -70, h: 4 }]);
    for (const [x, z] of [[-78, -134], [-66, -126]] as const) pillar(b, 'glyph', x, z, TOP, 5, 0.55);
    const cd = b.piece(new DartLauncher(game, b, 'crownDarts', [
      ...dartRow(-79.95, TOP, [-131, -130.4, -129.6, -129], 1, 15.5), ...dartRowZ(-135.95, TOP, [-78, -77.3, -76.7, -76], 1, 11.5),
    ]));
    game.relics.traps.set('crownDarts', () => cd.fire());
    sconce(game, b, 'v-s4', -64.05, TOP + 2.2, -130, -1, 0);
    yield;

    // --- Blade corridor and the lever room --------------------------------------------------------
    chamber(b, W, F, -66, -117, -62, -106, Y, -5.3, 2, [], 'ns');
    for (const [z, ph] of [[-108.6, 0], [-111.6, 2.1], [-114.6, 4.2]] as const) b.piece(new Blade(game, b, -64, -5.5, z, 3.7, 'x', 2.6, ph, 0.62));
    chamber(b, W, F, -66, -123, -60, -117, Y, -5.5, 2, [], 'se');
    b.piece(new Lever(game, b, -61, Y, -122.3, 'Pull the drawbridge lever', run.progress.drawbridgeDown, () => {
      run.progress.drawbridgeDown = true;
      game.toast('Chains run out somewhere to the east. The drawbridge is coming down.');
    }));
    flask(game, b, 'v-flask', -65.2, Y + 0.02, -118); spareTorch(game, b, 'v-torch', -83, Y + 0.08, -86.8);
    sconce(game, b, 'v-s5', -63, Y + 2.2, -122.95, 0, 1);
    spawnRocks(game, 'vault', [[-70, Y, -101, 4.4], [-75.5, Y, -89, 7.2], [-62, Y, -98, 9.0], [-68, TOP, -126.5, 4.6], [-79, Y, -96, 2.4], [-63.5, Y, -119.5, 3.0]]);
  },
};
