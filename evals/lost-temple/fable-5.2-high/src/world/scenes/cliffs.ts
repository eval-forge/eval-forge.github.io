import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { crossCard } from '../props';
import { RopeAnchor, RopeBridge, addVines, addWind } from '../setpieces';
import type { SceneDef } from '../types';
import { KillZone, spawnRocks } from './common';

/**
 * Outer cliffs: an optional loop of ledges on the outside of the temple, over the canyon. Reached
 * through the vine breach in the halls or the cracked east wall of the sanctum, so it is also the
 * way round when the idol collapse chokes the sanctum door.
 */
export const cliffs: SceneDef = {
  id: 'cliffs',
  bounds: [{ x1: 16, x2: 60, z1: -84, z2: -18, y1: -60 }, { x1: 15, x2: 16, z1: -84, z2: -54, y1: -60 }],
  nav: [
    { x1: 15, z1: -67, x2: 19.5, z2: -58, y: 0 },
    { x1: 15, z1: -58, x2: 17.3, z2: -50, y: 0 },
    { x1: 16, z1: -50, x2: 19.4, z2: -44, y: 0 },
  ],
  loot: [
    { id: 'x1', scene: 'cliffs', pos: [27.4, 3.55, -41], fixed: 'opal', pedestal: true },
    { id: 'x2', scene: 'cliffs', pos: [16.9, 0, -72.4], rich: true },
    { id: 'x3', scene: 'cliffs', pos: [17.8, -6, -26.2], rich: true },
    { id: 'x4', scene: 'cliffs', pos: [25.6, 0.4, -47.4] },
  ],
  guardians: [],
  map: [
    { x1: 16, z1: -36, x2: 18.6, z2: -28, kind: 'path' }, { x1: 16, z1: -44, x2: 18.2, z2: -38.3, kind: 'path' },
    { x1: 18.2, z1: -41.9, x2: 25, z2: -40.1, kind: 'bridge' }, { x1: 25, z1: -43, x2: 29, z2: -39, kind: 'path' },
    { x1: 22, z1: -49.5, x2: 27.5, z2: -45, kind: 'path' }, { x1: 15, z1: -67, x2: 19.4, z2: -44, kind: 'path' },
    { x1: 15, z1: -74, x2: 18.5, z2: -69.4, kind: 'path' }, { x1: 16, z1: -29.5, x2: 19.2, z2: -24.5, kind: 'path' },
  ],

  *build(game, b) {
    // --- The mountain's flank ----------------------------------------------------------------
    b.box('rock', 14.4, -45, -52, 16, -0.03, -19); b.box('rock', 13.4, -45, -84, 15, -0.03, -52);
    b.box('rock', 14.4, -45, -20, 44, 16, -17, { tint: 0.9 }); b.box('rock', 13.4, -45, -86, 44, 18, -82, { tint: 0.9 });
    // Outer face of the halls above its roofline, so the breach is a hole in a wall and not in the sky.
    b.box('rock', 15.2, 8.6, -52, 16, 13, -19, { collide: false, tint: 0.95 });
    yield;
    // --- Ledges ------------------------------------------------------------------------------
    b.box('rock', 16, -45, -36, 18.6, 3.5, -28);                 // L1: outside the breach
    b.box('rock', 16, -45, -29.5, 19.2, -6, -24.5);              // L0: low shelf, rope only
    b.box('rock', 16, -45, -44, 18.2, 3.5, -38.3);               // L2: bridge head
    b.box('rock', 25, -45, -43, 29, 3.55, -39);                  // the spire
    b.box('rock', 22, -45, -49.5, 27.5, 0.4, -45);               // L5: under the spire
    b.box('rock', 16, -45, -50, 19.4, 0, -44);                   // L4
    b.box('rock', 15, -45, -58, 17.3, 0, -50);                   // the narrow traverse
    b.box('rock', 15, -45, -67, 19.5, 0, -58);                   // L6: outside the cracked wall
    b.box('rock', 15, -45, -74, 18.5, 0, -69.4);                 // L7
    b.box('rock', 19.4, -45, -47.5, 20.6, -0.5, -45.5, { tint: 0.85 });
    yield;
    b.piece(addVines(game, b, { x1: 16.2, x2: 18, z1: -44.7, z2: -44, y1: 0, y2: 3.5, nx: 0, nz: -1 }));
    b.piece(new RopeBridge(game, b, 'cliffBridge', 18.2, 3.5, -41, 25, 3.55, -41, 1.8));
    b.piece(new RopeAnchor(game, b, 'cliffs', 17.5, 3.5, -28, -6, 0, 1));
    b.piece(addWind(game, { x1: 15, x2: 34, z1: -78, z2: -22, y1: -8, y2: 12, dx: 1, dz: 0, strength: 1 }));
    b.piece(new KillZone(game, 12, -90, 70, -10, -22, 'the long drop into the canyon'));
    spawnRocks(game, 'cliffs', [[17, 3.5, -34, 0.5], [17.5, 0, -62, 2.6], [17.6, 0, -47, 1.5]]);

    // --- Far side of the canyon and the mist below ---------------------------------------------
    // The far rim sits below the ledges, so the view from them is open sky over a mesa.
    b.box('rock', 78, -45, -150, 110, -3, 50, { collide: false, tint: 0.75 });
    b.box('rock', 92, -3, -120, 118, 7, 10, { collide: false, tint: 0.7 });
    const mistGeo = new THREE.PlaneGeometry(120, 220);
    mistGeo.rotateX(-Math.PI / 2);
    const mistMat = new THREE.MeshBasicMaterial({ color: 0x9fb4c4, transparent: true, opacity: 0.85, depthWrite: false });
    const mist = new THREE.Mesh(mistGeo, mistMat);
    mist.position.set(60, -26, -50);
    b.add(mist); b.track(mistGeo); b.track(mistMat);
    b.piece({ update: () => { const f = game.sky.grade.fog; mistMat.color.setRGB(f[0] * 0.9, f[1] * 0.9, f[2] * 0.9); } });

    const rng = new Rng(55);
    const ms: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const [x1, z1, x2, z2, y] of [[16, -36, 18.6, -28, 3.5], [16, -50, 19.4, -44, 0], [15, -67, 19.5, -58, 0], [15, -74, 18.5, -69.4, 0], [22, -49.5, 27.5, -45, 0.4], [16, -29.5, 19.2, -24.5, -6]] as const) {
      for (let i = 0; i < 14; i++) {
        const s = rng.range(0.7, 1.3);
        ms.push(new THREE.Matrix4().compose(new THREE.Vector3(rng.range(x1 + 0.2, x2 - 0.2), y, rng.range(z1 + 0.2, z2 - 0.2)), q.setFromEuler(e.set(0, rng.range(0, 3), 0)), new THREE.Vector3(s, s, s)));
      }
    }
    b.instances(crossCard(0.8, 0.45), game.mats.card('grass'), ms, false, true);
  },
};
