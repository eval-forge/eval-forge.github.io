/** Scene 5: Collapsed Sanctum (Zone B). */
import { LayoutBuilder, Y_TEMPLE, type SceneLayout } from './types';

const Y = Y_TEMPLE;

export const SANCTUM = {
  x0: -64, x1: -34, z0: -66, z1: -36,
  ceilY: Y + 9,
  /** Everything west of this x still has a (cracked) ceiling. */
  roofEdgeX: -46,
  /** Hole in the remaining ceiling that lets the beam fall on the idol. */
  hole: { x0: -52.5, x1: -46, z0: -50.5, z1: -43 },
  dais: { x: -49, z: -51, half: 4, steps: 3, stepH: 0.3 },
  corridor: { x0: -34, x1: -27, z0: -46, z1: -42 },
  kick: { x0: -50, x1: -46, z0: -36, z1: -34 },
  stairDoor: { x0: -46.5, x1: -43.5, z0: -68, z1: -66 },
};

export function sanctumLayout(): SceneLayout {
  const L = new LayoutBuilder('sanctum', -10);
  L.region(-66, -68, -32, -34, -1, 40);
  L.region(-34, -46.5, -27, -41.5, -1, 40);

  const c = SANCTUM.corridor;
  L.floor(c.x0, c.z0, c.x1, c.z1, Y, 'hallFloor', { noCarve: true });
  L.floor(SANCTUM.x0, SANCTUM.z0, SANCTUM.x1, SANCTUM.z1, Y, 'sanctumFloor');
  const k = SANCTUM.kick;
  L.floor(k.x0, k.z0, k.x1, k.z1, Y, 'templeStone', { gate: 'kickWall', noCarve: true });
  const s = SANCTUM.stairDoor;
  L.floor(s.x0, s.z0, s.x1, s.z1, Y, 'templeStone', { gate: 'escapeStair', noCarve: true });

  // The stepped dais (built by the scene) blocks straight-line walking.
  const d = SANCTUM.dais;
  L.obstacle(d.x - d.half, d.z - d.half, d.x + d.half, d.z + d.half, Y, Y + 1.2);

  L.pillar(-58, -61, 0.9, Y, 9, 1);
  L.pillar(-58, -51, 0.9, Y, 9, 1);
  L.pillar(-58, -41, 0.9, Y, 9, 1);
  L.pillar(-40, -61, 0.9, Y, 9, 0.55);
  L.pillar(-40, -41, 0.9, Y, 9, 0.8);
  L.pillar(-40, -51, 0.9, Y, 9, 0.3);

  // Relics: three wall niches under the unstable ceiling, two among the rubble.
  L.spot('nicheN', -62.9, Y, -60, 2, { mount: 'pedestal' });
  L.spot('nicheM', -62.9, Y, -51, 2, { mount: 'pedestal', trap: 'sanctumDebris' });
  L.spot('nicheS', -62.9, Y, -42, 2, { mount: 'pedestal' });
  L.spot('rubble', -36.6, Y, -63.6, 2);
  L.spot('corner', -61.8, Y, -37.4, 2);
  // The Dawn Idol, on the dais.
  L.spot('idol', d.x, Y + d.steps * d.stepH, d.z, 2, { fixed: 'dawn_idol', mount: 'pedestal', trap: 'collapse' });

  L.guardian('sentinel', 'sentinel', -61.5, Y, -64, Math.PI * 0.75);
  L.guardian('shade', 'shade', -36.5, Y, -38.5, -Math.PI * 0.25);

  L.sweep(-49, Y, -60);
  L.sweep(-40, Y, -46);
  L.sweep(-30, Y, -44);
  return L.done();
}
