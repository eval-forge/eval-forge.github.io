/** Scene 3: Outer Cliffs (Zone A, optional). */
import { LayoutBuilder, Y_COURT, type SceneLayout } from './types';

export const CLIFFS = {
  seaY: -42,
  faceX: 42,
  top: { x0: 32, x1: 42, z0: -4, z1: 16 },
  ledge1: { x0: 42, x1: 44.6, z0: -10, z1: 3, y: -2.6 },
  ledge2: { x0: 42, x1: 44.6, z0: -24, z1: -13.6, y: -2.6 },
  outcrop: { x0: 35.5, x1: 44.2, z0: -31, z1: -22.5, y: 6.4 },
  traverse: { x0: 42, x1: 43.1, z0: -36.5, z1: -24, y: -2.6 },
  bridge: { x0: 43.1, x1: 53.1, z: -34.4, y: -2.6 },
  spire: { x0: 53.1, x1: 59.5, z0: -37.6, z1: -31.2, y: -2.6 },
};

export function cliffsLayout(): SceneLayout {
  const L = new LayoutBuilder('cliffs', -24);
  L.region(32, -45, 100, 48, -50, 60);

  const t = CLIFFS.top;
  L.floor(t.x0, t.z0, t.x1, t.z1, Y_COURT, 'rock', { thick: 2 });
  // Ledges are built by the scene (irregular rock); guardians stay on the clifftop.

  const l1 = CLIFFS.ledge1;
  const l2 = CLIFFS.ledge2;
  const o = CLIFFS.outcrop;
  const s = CLIFFS.spire;
  L.spot('ledge', l1.x1 - 0.7, l1.y, l1.z0 + 1.2, 2);
  L.spot('nook', l2.x0 + 0.6, l2.y, l2.z0 + 6.2, 2);
  L.spot('outcrop', o.x0 + 2.4, o.y, o.z0 + 3.4, 2, { mount: 'plinth' });
  L.spot('spire', (s.x0 + s.x1) / 2 + 1.2, s.y, (s.z0 + s.z1) / 2, 2, { mount: 'plinth' });
  return L.done();
}
