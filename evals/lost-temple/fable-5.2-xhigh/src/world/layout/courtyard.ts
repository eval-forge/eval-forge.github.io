/**
 * Scene 2: Temple Courtyard (Zone A), including the western terrace that the
 * sanctum's kicked wall opens onto.
 */
import { LayoutBuilder, Y_COURT, Y_TEMPLE, type SceneLayout } from './types';

export const COURT = {
  x0: -30, x1: 30, z0: -20, z1: 40,
  wallH: 7.5,
  doorHalf: 2.6,
  sundial: { x: 0, z: 10, r: 4 },
  canal: { x0: -30, x1: -23, z0: -18, z1: 26, floor: -3, water: -1.45 },
  bridge: { z0: -12, z1: -8 },
  fountain: { x: -12, z: 24, r: 3 },
  alcove: { x0: 30, x1: 31.7, z0: 20.4, z1: 23.6 },
  winch: { x: -33.2, z: -7.4 },
};

export function courtyardLayout(): SceneLayout {
  const L = new LayoutBuilder('courtyard', -20);
  L.region(-32, -22, 32, 42, -6, 40);
  L.region(-52, -34, -32, -6, -2, 40);

  // Plaza.
  L.floor(-23, -16, 30, 40, Y_COURT, 'flagstone');
  L.floor(-23, -20, -3, -16, Y_COURT, 'flagstone');
  L.floor(3, -20, 30, -16, Y_COURT, 'flagstone');
  // Temple steps: 0 at z=-16 rising to the platform at z=-20.
  L.ramp(-3, -20, 3, -16, Y_TEMPLE, Y_COURT, 'z', 'templeStone');
  // Corners beside the canal.
  L.floor(-30, 32, -23, 40, Y_COURT, 'flagstone');
  L.floor(-30, -20, -23, -18, Y_COURT, 'flagstone');
  // Canal bed and the steps out of it (not navigable for guardians).
  L.floor(-30, -18, -23, 26, COURT.canal.floor, 'mossStone', { nav: false, thick: 1 });
  L.ramp(-30, 26, -23, 32, COURT.canal.floor, Y_COURT, 'z', 'mossStone', { nav: false });
  // Great door threshold: guardians never pass it.
  L.floor(-COURT.doorHalf, 40, COURT.doorHalf, 42, Y_COURT, 'templeStone', { gate: 'greatDoor', noCarve: true });
  // Cliff gate threshold.
  L.floor(30, 4, 32, 8, Y_COURT, 'templeStone', { noCarve: true });

  // Terrace: from the sanctum's kicked wall down to the drawbridge.
  L.floor(-50, -34, -46, -12, Y_TEMPLE, 'mossStone');
  L.floor(-50, -12, -40, -8, Y_TEMPLE, 'mossStone');
  L.ramp(-40, -12, -34, -8, Y_TEMPLE, Y_COURT, 'x', 'mossStone');
  L.floor(-34, -12, -30, -8, Y_COURT, 'mossStone', { noCarve: true });
  // The drawbridge deck itself is a physics body; this is its nav footprint.
  L.floor(-30, -12, -23, -8, Y_COURT, 'wood', { gate: 'drawbridge', visual: false, noCarve: true });

  // Sundial dais, fountain, toppled pillars.
  const s = COURT.sundial;
  L.obstacle(s.x - s.r - 0.2, s.z - s.r - 0.2, s.x + s.r + 0.2, s.z + s.r + 0.2, 0, 1.5);
  const f = COURT.fountain;
  L.obstacle(f.x - f.r, f.z - f.r, f.x + f.r, f.z + f.r, 0, 1.5);
  L.obstacle(5.2, 25.2, 13.6, 29.6, 0, 1.6); // toppled pillar A
  L.obstacle(-13.5, -10.2, -5.0, -5.6, 0, 1.6); // toppled pillar B

  // Colonnades.
  for (const z of [-8, 0, 16, 28]) L.pillar(22, z, 0.7, Y_COURT, 6.2, z === 16 ? 0.45 : 1);
  for (const z of [-2, 6, 14]) L.pillar(-18.5, z, 0.7, Y_COURT, 6.2, z === 6 ? 0.3 : 1);
  L.pillar(12, -6, 0.7, Y_COURT, 6.2, 0.6);
  L.pillar(-10, 34, 0.7, Y_COURT, 6.2, 1);
  L.pillar(10, 34, 0.7, Y_COURT, 6.2, 0.75);

  // Relics.
  L.spot('mural', -6.5, Y_COURT, 37.2, 1);
  L.spot('fountain', f.x, 0.62, f.z - f.r + 0.35, 1);
  L.spot('pillar', 9.5, Y_COURT, 31, 1);
  L.spot('colonnade', 24.6, Y_COURT, 29.5, 1);
  L.spot('canal', -26.5, COURT.canal.floor, -2, 1);
  L.spot('alcove', 30.95, Y_COURT, 22, 1, { fixed: 'silver_censer', mount: 'pedestal', trap: 'courtDarts' });

  // The two statues by the temple steps are sentinels. They wake last.
  L.guardian('gateL', 'sentinel', -6.5, Y_COURT, -17.5, 0);
  L.guardian('gateR', 'sentinel', 6.5, Y_COURT, -17.5, 0);

  L.sweep(0, Y_COURT, -12);
  L.sweep(8, Y_COURT, 10);
  L.sweep(-8, Y_COURT, 24);
  L.sweep(0, Y_COURT, 37);
  return L.done();
}
