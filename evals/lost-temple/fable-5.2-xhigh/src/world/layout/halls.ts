/** Scene 4: Broken Halls (Zone B). */
import { LayoutBuilder, Y_TEMPLE, type SceneLayout } from './types';

const Y = Y_TEMPLE;

export const HALLS = {
  x0: -25, x1: 25, z0: -72, z1: -22,
  roofY: Y + 6.5,
  nave: { x0: -6, x1: 6, z0: -62, z1: -34 },
  puzzle: { x0: -25, x1: -8, z0: -50, z1: -34 },
  plateA: { x: -21, z: -46.5 },
  plateB: { x: -11.5, z: -46.5 },
  blockA: { x: -21, z: -38 },
  blockB: { x: -16.5, z: -41.5 },
  blades: { x0: -13, x1: -10, zs: [-54.2, -57, -59.8] },
  ramp: { x0: 14, x1: 19, zBottom: -36, zTop: -56, yTop: Y + 3.5 },
  platform: { x0: 10, x1: 23, z0: -62, z1: -56, y: Y + 3.5 },
  boulder: { x: 16.5, z: -60.2, r: 1.85 },
  seal: { x0: 14, x1: 18, z0: -74, z1: -72 },
  sanctumDoor: { x0: -27, x1: -25, z0: -46, z1: -42 },
};

export function hallsLayout(): SceneLayout {
  const L = new LayoutBuilder('halls', -10);
  L.region(-27, -74, 27, -22, -1, 40);

  // Threshold at the top of the temple steps.
  L.floor(-3, -22, 3, -20, Y, 'templeStone', { noCarve: true });
  // Entry hall.
  L.floor(-25, -34, 25, -22, Y, 'hallFloor');
  // West gallery: the block puzzle room.
  L.floor(-25, -50, -8, -34, Y, 'hallFloor');
  // Central nave: shade scarabs live wherever the sun is not.
  L.floor(-6, -62, 6, -34, Y, 'naveFloor', { tag: 'nave' });
  // Blade corridor.
  L.floor(-13, -62, -10, -50, Y, 'hallFloor', { noCarve: true });
  // Treasury off the north hall.
  L.floor(-23, -61, -15, -55, Y, 'hallFloor');
  L.floor(-21, -62, -17, -61, Y, 'hallFloor', { noCarve: true });
  // North cross hall.
  L.floor(-25, -72, 25, -62, Y, 'hallFloor');
  // Catacomb seal threshold.
  L.floor(14, -74, 18, -72, Y, 'templeStone', { gate: 'seal', noCarve: true });
  // Sanctum door threshold.
  L.floor(-27, -46, -25, -42, Y, 'templeStone', { gate: 'sanctumDoor', noCarve: true });

  // Internal masonry (drawn, outside the floors).
  const top = HALLS.roofY;
  L.mass(-8, -62, -6, -34, Y, top); // nave west wall
  L.mass(6, -62, 8, -34, Y, top); // nave east wall
  L.mass(-25, -52, -13, -50, Y, top); // puzzle room north wall (west part)
  L.mass(-10, -62, -8, -50, Y, top); // blade corridor east wall
  L.mass(-25, -55, -13, -52, Y, top); // treasury south wall
  L.mass(-25, -62, -23, -55, Y, top); // treasury west wall
  L.mass(-15, -62, -13, -55, Y, top); // treasury east wall
  L.mass(-23, -62, -21, -61, Y, top);
  L.mass(-17, -62, -15, -61, Y, top);

  // Columns.
  // The east pair stands clear of x 14.6..18.4: that lane belongs to the boulder.
  for (const x of [-20, -12.5, 12.5, 20]) L.pillar(x, -28, 0.75, Y, 6.5, x === 12.5 ? 0.5 : 1);
  for (const x of [-18, -5, 5]) L.pillar(x, -67, 0.75, Y, 6.5, x === 5 ? 0.35 : 1);
  L.pillar(22, -67.5, 0.75, Y, 6.5, 1);

  // Relics.
  L.spot('entryW', -22.5, Y, -24.5, 1);
  L.spot('entryE', 21, Y, -32, 1);
  L.spot('puzzle', -23.4, Y, -35.8, 2, { mount: 'plinth' });
  L.spot('treasuryA', -21.6, Y, -56.6, 2, { mount: 'plinth' });
  L.spot('treasuryB', -16.4, Y, -56.6, 2, { mount: 'plinth' });
  L.spot('nave', 0, Y, -48, 2, { mount: 'plinth' });
  L.spot('boulder', HALLS.boulder.x, HALLS.platform.y, -57.4, 2, { mount: 'pedestal', trap: 'hallsBoulder' });

  L.guardian('crawler', 'crawler', -22, Y, -68.5, Math.PI / 2);
  L.guardian('sentinel', 'sentinel', 22.5, Y, -24.5, -Math.PI / 2);

  L.sweep(16, Y, -67);
  L.sweep(-11.5, Y, -58);
  L.sweep(-15, Y, -41);
  L.sweep(0, Y, -28);
  L.sweep(0, Y, -21);
  return L.done();
}
