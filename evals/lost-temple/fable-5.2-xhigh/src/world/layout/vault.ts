/** Scene 7: Deep Vault (Zone C), the guardians' lair and the escape stair. */
import { LayoutBuilder, Y_CATA, Y_TEMPLE, Y_VAULT, type SceneLayout } from './types';

const Y = Y_VAULT;
const RISE = (Y_TEMPLE - Y_VAULT) / 3;

export const VAULT = {
  ceil: 6,
  stair: { x0: -24, x1: -10, z0: -93, z1: -90 },
  eastBank: { x0: -28, x1: -24, z0: -100, z1: -83 },
  chasm: { x0: -36, x1: -28, z0: -100, z1: -83, floor: -27 },
  westBank: { x0: -40, x1: -36, z0: -100, z1: -83 },
  bridge: { x0: -36, x1: -28, z: -91.5, y: Y },
  door: { x0: -42, x1: -40, z0: -93, z1: -90 },
  hall: { x0: -62, x1: -42, z0: -104, z1: -80 },
  tunnel: { x0: -42, x1: -25, z0: -104, z1: -101 },
  tunnelGate: { x0: -28, x1: -25, z0: -101, z1: -100 },
  lairGate: { x0: -64, x1: -62, z0: -99, z1: -96 },
  lair: { x0: -76, x1: -64, z0: -100, z1: -84 },
  coffer: { x: -59.6, z: -88, y: Y + 0.5 },
  lever: { x: -56.4, z: -80.3 },
  // Escape stairwell: three flights zig-zagging up to the sanctum.
  well: { x0: -60, x1: -43.5, z0: -78, z1: -68 },
  stairDoor: { x0: -60, x1: -58, z0: -80, z1: -78 },
  y1: Y + RISE,
  y2: Y + 2 * RISE,
};

export function vaultLayout(): SceneLayout {
  const L = new LayoutBuilder('vault', -22.5);
  L.region(-78, -134, -10, -78, -30, -2);
  L.region(-60.5, -78, -43, -68, -16, 8);

  const V = VAULT;
  // Stair down from the vault gate.
  L.ramp(V.stair.x0, V.stair.z0, V.stair.x1, V.stair.z1, Y, Y_CATA, 'x', 'dungeonFloor');
  // Chasm room: two banks; the plank bridge between them is physics, not nav.
  L.floor(V.eastBank.x0, V.eastBank.z0, V.eastBank.x1, V.eastBank.z1, Y, 'vaultFloor', { thick: 14 });
  L.floor(V.westBank.x0, V.westBank.z0, V.westBank.x1, V.westBank.z1, Y, 'vaultFloor', { thick: 14 });
  L.floor(V.door.x0, V.door.z0, V.door.x1, V.door.z1, Y, 'vaultFloor', { noCarve: true });
  // Treasure hall.
  L.floor(V.hall.x0, V.hall.z0, V.hall.x1, V.hall.z1, Y, 'vaultFloor');
  // Guardians' tunnel round the chasm: barred until dark.
  L.floor(V.tunnel.x0, V.tunnel.z0, V.tunnel.x1, V.tunnel.z1, Y, 'dungeonFloor', { noCarve: true });
  L.floor(V.tunnelGate.x0, V.tunnelGate.z0, V.tunnelGate.x1, V.tunnelGate.z1, Y, 'dungeonFloor', { gate: 'lairGate', noCarve: true });
  // The lair.
  L.floor(V.lairGate.x0, V.lairGate.z0, V.lairGate.x1, V.lairGate.z1, Y, 'dungeonFloor', { gate: 'lairGate', noCarve: true });
  L.floor(V.lair.x0, V.lair.z0, V.lair.x1, V.lair.z1, Y, 'dungeonFloor');

  // Escape stair.
  L.floor(V.stairDoor.x0, V.stairDoor.z0, V.stairDoor.x1, V.stairDoor.z1, Y, 'dungeonFloor', { gate: 'escapeStair', noCarve: true });
  L.floor(-60, -78, -58, -75, Y, 'dungeonFloor', { noCarve: true }); // bottom landing
  L.ramp(-58, -78, -46, -75, Y, V.y1, 'x', 'dungeonFloor'); // flight 1, rising east
  L.floor(-46, -78, -44, -71.5, V.y1, 'dungeonFloor', { noCarve: true });
  L.ramp(-58, -74.5, -46, -71.5, V.y2, V.y1, 'x', 'dungeonFloor'); // flight 2, rising west
  L.floor(-60, -74.5, -58, -68, V.y2, 'dungeonFloor', { noCarve: true });
  L.ramp(-58, -71, -46, -68, V.y2, Y_TEMPLE, 'x', 'dungeonFloor'); // flight 3, rising east
  L.floor(-46, -71, -43.5, -68, Y_TEMPLE, 'dungeonFloor', { noCarve: true }); // top landing

  // Hall columns and the coffer dais.
  for (const x of [-48.5, -55.5]) for (const z of [-87.5, -96.5]) L.pillar(x, z, 0.85, Y, VAULT.ceil, 1, 'darkPillar');
  L.obstacle(-61.6, -90, -57.6, -86, Y, Y + 1.5);

  // Relics: the richest and heaviest.
  L.spot('hallNE', -45.6, Y, -83.4, 3, { mount: 'pedestal', trap: 'vaultDartsN' });
  L.spot('hallSE', -45.6, Y, -100.6, 3, { mount: 'plinth' });
  L.spot('hallMid', -52, Y, -92, 3, { mount: 'pedestal', trap: 'vaultBlade' });
  L.spot('hallNW', -56.5, Y, -83, 3, { mount: 'plinth' });
  L.spot('hallSW', -56.5, Y, -101.4, 3, { mount: 'pedestal', trap: 'vaultCrumble' });
  L.spot('hallE', -43.6, Y, -96.5, 3);
  L.spot('bankW', -38.6, Y, -84.4, 3);
  L.spot('bankE', -25.2, Y, -98.6, 3);
  L.spot('coffer', V.coffer.x, V.coffer.y, V.coffer.z, 3, { fixed: 'emperor_coffer', mount: 'floor' });

  // The lair: all three kinds, visible through the bars all day.
  L.guardian('sentinel', 'sentinel', -70, Y, -88, Math.PI / 2);
  L.guardian('crawler', 'crawler', -72.5, Y, -96.5, Math.PI / 2);
  L.guardian('shade', 'shade', -67, Y, -92, Math.PI / 2);

  L.sweep(-60, Y, -97.5);
  L.sweep(-50, Y, -102.4);
  L.sweep(-33, Y, -102.5);
  L.sweep(-26, Y, -95);
  L.sweep(-17, (Y + Y_CATA) / 2, -91.5);
  return L.done();
}
