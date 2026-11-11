/** Scene 6: Lower Catacombs (Zone C: no sky, no ambient light). */
import { LayoutBuilder, Y_CATA, Y_TEMPLE, type SceneLayout } from './types';

const Y = Y_CATA;
const Y_LAND = -3.4;

export const CATA = {
  ceil: 3.6,
  landingY: Y_LAND,
  flight1: { x0: 14, x1: 18, z0: -84, z1: -74 },
  landing: { x0: 14, x1: 18, z0: -88, z1: -84 },
  flight2: { x0: 18, x1: 28, z0: -88, z1: -84 },
  ossuary: { x0: 28, x1: 42, z0: -94, z1: -80 },
  north: { x0: 33.5, x1: 36.5, z0: -100, z1: -94 },
  flooded: { x0: 26, x1: 46, z0: -124, z1: -100, water: -8.5, shallow: -9.6, deep: -11.8 },
  island: { x0: 33, x1: 39, z0: -117, z1: -111, y: -8.2 },
  rock: { x: 43.2, z: -112.5, y: -8.25 },
  key: { x: 36, z: -114 },
  dart: { x0: 2, x1: 28, z0: -93, z1: -90 },
  crypt: { x0: 8, x1: 20, z0: -104, z1: -95 },
  cryptDoor: { x0: 12.5, x1: 15.5, z0: -95, z1: -93 },
  gateRoom: { x0: -8, x1: 2, z0: -97, z1: -86 },
  vaultGate: { x0: -10, x1: -8, z0: -93, z1: -90 },
  crumble: { x0: 42, x1: 52, z0: -88.5, z1: -85.5, pit: -14 },
  crawl: { x0: 42, x1: 52, z0: -93, z1: -91.5, h: 1.25 },
  chapel: { x0: 52, x1: 60, z0: -94, z1: -80 },
};

export function catacombsLayout(): SceneLayout {
  const L = new LayoutBuilder('catacombs', -13.2);
  L.region(-10, -134, 62, -74, -20, 6);

  const C = CATA;
  // The L-shaped stair down from the seal: no daylight has line of sight past the landing.
  L.ramp(C.flight1.x0, C.flight1.z0, C.flight1.x1, C.flight1.z1, Y_LAND, Y_TEMPLE, 'z', 'dungeonFloor');
  L.floor(C.landing.x0, C.landing.z0, C.landing.x1, C.landing.z1, Y_LAND, 'dungeonFloor');
  L.ramp(C.flight2.x0, C.flight2.z0, C.flight2.x1, C.flight2.z1, Y_LAND, Y, 'x', 'dungeonFloor');

  // Ossuary hall.
  L.floor(C.ossuary.x0, C.ossuary.z0, C.ossuary.x1, C.ossuary.z1, Y, 'dungeonFloor');

  // North corridor and the flooded chamber's wadeable causeway.
  L.floor(C.north.x0, C.north.z0, C.north.x1, C.north.z1, Y, 'dungeonFloor', { noCarve: true });
  const sh = C.flooded.shallow;
  L.ramp(33.5, -103, 36.5, -100, sh, Y, 'z', 'dungeonFloor');
  L.floor(33.5, -107, 36.5, -103, sh, 'causeway', { thick: 3 });
  L.floor(28, -107, 33.5, -104, sh, 'causeway', { thick: 3 });
  L.floor(28, -122, 31, -107, sh, 'causeway', { thick: 3 });
  L.floor(31, -122, 37.5, -119, sh, 'causeway', { thick: 3 });
  L.ramp(34.5, -119, 37.5, -117, sh, C.island.y, 'z', 'dungeonFloor', { steps: false });
  L.floor(C.island.x0, C.island.z0, C.island.x1, C.island.z1, C.island.y, 'dungeonFloor', { thick: 4 });

  // Dart corridor west to the gate room.
  L.floor(C.dart.x0, C.dart.z0, C.dart.x1, C.dart.z1, Y, 'dungeonFloor', { noCarve: true });
  L.floor(C.cryptDoor.x0, C.cryptDoor.z0, C.cryptDoor.x1, C.cryptDoor.z1, Y, 'dungeonFloor', { noCarve: true });
  L.floor(C.crypt.x0, C.crypt.z0, C.crypt.x1, C.crypt.z1, Y, 'dungeonFloor');
  L.floor(C.gateRoom.x0, C.gateRoom.z0, C.gateRoom.x1, C.gateRoom.z1, Y, 'dungeonFloor');
  L.floor(C.vaultGate.x0, C.vaultGate.z0, C.vaultGate.x1, C.vaultGate.z1, Y, 'dungeonFloor', { gate: 'vaultGate', noCarve: true });

  // Bone chapel and the crawl tunnel back (the crumbling corridor is not navigable).
  L.floor(C.crawl.x0, C.crawl.z0, C.crawl.x1, C.crawl.z1, Y, 'dungeonFloor', { noCarve: true });
  L.floor(C.chapel.x0, C.chapel.z0, C.chapel.x1, C.chapel.z1, Y, 'dungeonFloor');

  // Sarcophagi in the crypt.
  L.obstacle(9.2, -100.6, 11.6, -97.4, Y, Y + 1.2);
  L.obstacle(16.4, -100.6, 18.8, -97.4, Y, Y + 1.2);
  // Altar in the chapel, altar on the island.
  L.obstacle(55.2, -88, 56.8, -86, Y, Y + 1.1);

  // Relics.
  L.spot('ossuaryW', 29.2, Y, -81.3, 2);
  L.spot('ossuaryE', 40.6, Y, -81.3, 2);
  L.spot('gateRoom', -6.4, Y, -87.6, 3, { mount: 'plinth' });
  L.spot('cryptA', 9.6, Y, -102.6, 3, { mount: 'plinth' });
  L.spot('cryptB', 18.4, Y, -102.6, 3, { mount: 'pedestal', trap: 'cryptDarts' });
  L.spot('chapelA', 58.6, Y, -82, 3, { mount: 'plinth' });
  L.spot('chapelB', 58.6, Y, -92, 3, { mount: 'pedestal', trap: 'chapelDarts' });
  L.spot('rock', C.rock.x, C.rock.y, C.rock.z, 3);

  L.guardian('crawler', 'crawler', 14, Y, -100.5, 0);
  L.guardian('shade', 'shade', 40.4, Y, -92.4, -Math.PI * 0.75);

  L.sweep(-3, Y, -91.5);
  L.sweep(15, Y, -91.5);
  L.sweep(35, Y, -87);
  L.sweep(16, Y_LAND, -86);
  L.sweep(16, Y_TEMPLE, -73);
  return L.done();
}
