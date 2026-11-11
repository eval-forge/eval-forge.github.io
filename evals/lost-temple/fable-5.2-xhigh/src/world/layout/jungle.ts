/**
 * Scene 1: Jungle Approach (Zone A). Terrain is a height function shared by
 * the mesh, the collider and relic placement.
 */
import { fbm, lerp, smoothstep } from '../../core/rng';
import { LayoutBuilder, Y_COURT, type SceneLayout } from './types';

export const JUNGLE = {
  x0: -45, x1: 45, z0: 42, z1: 175,
  riverZ: 121, riverHalf: 5, waterY: -0.45,
  gorgeZ: 86, gorgeHalf: 6.2, gorgeFloor: -16,
  bridgeSouthZ: 92.3, bridgeNorthZ: 79.7,
  spawn: { x: 0.5, z: 160 },
};

/** Where the trail runs for a given z. */
export function jungleTrailX(z: number): number {
  const w = smoothstep(96, 108, z) * (1 - smoothstep(146, 160, z));
  return 7.5 * Math.sin((z - 96) * 0.052) * w;
}

/** Terrain height. Pure and deterministic. */
export function jungleHeight(x: number, z: number): number {
  const trail = jungleTrailX(z);
  const off = Math.abs(x - trail);
  const rolling = (fbm(x * 0.06 + 11.3, z * 0.06 - 4.1, 4, 7) - 0.5) * 5;
  const detail = (fbm(x * 0.22, z * 0.22, 2, 31) - 0.5) * 0.7;
  const walls = smoothstep(13, 38, off) * 10 + smoothstep(30, 45, Math.abs(x)) * 6;
  const trailLevel = 0.45 + (fbm(z * 0.035, 3.3, 2, 5) - 0.5) * 1.3;
  let h = lerp(trailLevel + detail * 0.15, trailLevel + rolling + detail + walls, smoothstep(2.2, 7.5, off));

  // Camp clearing at the start.
  const camp = 1 - smoothstep(5, 10, Math.hypot(x - JUNGLE.spawn.x, z - JUNGLE.spawn.z));
  h = lerp(h, trailLevel, camp);

  // River: level the banks, then cut the channel.
  const dzR = Math.abs(z - JUNGLE.riverZ);
  const bank = 1 - smoothstep(6.5, 12, dzR);
  h = lerp(h, 0.35 + walls * 0.55, bank);
  h -= 1.95 * (1 - smoothstep(2.6, 6.2, dzR));

  // Gorge: flatten the rim near the bridge, then cut straight down.
  const dzG = Math.abs(z - JUNGLE.gorgeZ);
  const rim = (1 - smoothstep(6.2, 13, dzG)) * (1 - smoothstep(9, 22, Math.abs(x)));
  h = lerp(h, 0, rim);
  const cut = 1 - smoothstep(JUNGLE.gorgeHalf - 1.5, JUNGLE.gorgeHalf, dzG);
  h = lerp(h, JUNGLE.gorgeFloor + (fbm(x * 0.1, z * 0.3, 2, 9) - 0.5) * 2, cut);

  // Door plaza: flat flagstones in front of the wall.
  const plaza = (1 - smoothstep(55, 64, z)) * (1 - smoothstep(13, 21, Math.abs(x)));
  h = lerp(h, Y_COURT, plaza);
  // The compound wall sits on level ground all the way across.
  h = lerp(h, Math.max(h, Y_COURT), 1 - smoothstep(42, 46, z));
  return h;
}

export function jungleLayout(): SceneLayout {
  const L = new LayoutBuilder('jungle', -13);
  L.region(JUNGLE.x0, 42, JUNGLE.x1, JUNGLE.z1, -40, 80);

  // Door plaza (terrain is drawn by the scene; this rect only feeds the navmesh for path queries).
  L.floor(-12, 42, 12, 56, Y_COURT, 'flagstone', { visual: false });

  const at = (x: number, z: number): [number, number, number] => [x, jungleHeight(x, z), z];
  // 1: on the camp shrine, a few steps from the start.
  L.spot('camp', 4.2, jungleHeight(4.2, 154.5) + 0.75, 154.5, 1, { mount: 'floor' });
  // 2: on the flat rock in the middle of the river.
  L.spot('river', -6.5, 0.2, 121, 1, { mount: 'floor' });
  // 3: under the ruined arch beside the trail.
  L.spot('arch', ...at(jungleTrailX(105) + 6.5, 105), 1);
  // 4: at the feet of the broken statue on the plaza.
  L.spot('statue', -8.2, Y_COURT, 50, 1);
  return L.done();
}
