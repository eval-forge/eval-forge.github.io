/** A1 Jungle approach: spawn, river crossing, the gorge with the rope bridge and a fallen tree. */
import * as THREE from 'three';
import { RIVER, GORGE, FALLEN_TREE, VINES, BRIDGE } from '../layout';
import { buildTerrain, groundY, groundColor, column, rubble, fbm } from '../terrain';
import { buildVegetation, vineFor, WaterSurface } from '../nature';
import { addBoxes, mesh, type BoxSpec } from '../build';
import { surface } from '../../engine/materials';
import { buildBridge } from '../../entities/Bridge';
import { Rng } from '../../core/rng';
import type { SceneDef } from '../SceneManager';

const EXP = 'outdoor' as const;

export const jungle: SceneDef = {
  id: 'jungle',
  *build(game, h) {
    const rng = new Rng(101);
    buildTerrain(h, { x0: -60, x1: 60, z0: 70, z1: 190, cell: 1.5, exp: EXP, color: groundColor });
    yield;

    // ---------------------------------------------------------- gorge
    const boxes: BoxSpec[] = [];
    // rock walls (faces at z = 83 and z = 99), floor below the water
    boxes.push({ c: [0, -7.25, GORGE.z1 + 1.2], h: [60, 7.25, 1.2], mat: 'rockMoss', exp: EXP, uv: 4 });
    boxes.push({ c: [0, -7.25, GORGE.z0 - 1.2], h: [60, 7.25, 1.2], mat: 'rockMoss', exp: EXP, uv: 4 });
    boxes.push({ c: [0, GORGE.floor - 0.5, (GORGE.z0 + GORGE.z1) / 2], h: [60, 0.5, (GORGE.z1 - GORGE.z0) / 2 + 0.2], mat: 'rock', exp: EXP, uv: 4 });
    // jagged outcrops on the walls
    for (let i = 0; i < 26; i++) {
      const x = rng.range(-55, 55);
      if (Math.abs(x) < 3.5 || Math.abs(x - FALLEN_TREE.x) < 2) continue;
      const south = rng.chance(0.5);
      const y = rng.range(-12, -2);
      const s = rng.range(0.6, 1.5);
      boxes.push({ c: [x, y, south ? GORGE.z1 - s * 0.3 : GORGE.z0 + s * 0.3], h: [s * 1.6, s, s * 0.6], mat: 'rock', exp: EXP, rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.3, 0.3), rng.range(-0.4, 0.4), rng.range(-0.3, 0.3))) });
    }
    // valley boundary: invisible walls behind the hills
    addBoxes(boxes, h.group, h.owner);
    for (const sx of [-1, 1]) h.owner.staticBox(sx * 49, 10, 130, 1, 30, 62);
    h.owner.staticBox(0, 10, 187, 60, 30, 1);
    const gw = new WaterSurface(h.group, -60, 60, GORGE.z0, GORGE.z1, GORGE.water, EXP, 0x2a4a48);
    h.waters.push({ x0: -60, x1: 60, z0: GORGE.z0, z1: GORGE.z1, surface: GORGE.water, bottom: GORGE.floor });
    h.update.push((_dt, t) => gw.update(t, 0.02));
    // vine wall to climb back out on the south side
    const v = VINES[0];
    vineFor(h.group, v, EXP, 7);
    h.vines.push(v);
    yield;

    // ---------------------------------------------------------- river
    const rw = new WaterSurface(h.group, -60, 60, RIVER.z0 - 2.5, RIVER.z1 + 2.5, RIVER.surface, EXP, 0x3a6660);
    h.waters.push({ x0: -60, x1: 60, z0: RIVER.z0 - 2.5, z1: RIVER.z1 + 2.5, surface: RIVER.surface, bottom: RIVER.bed });
    h.update.push((_dt, t) => rw.update(t, 0.05));
    // stepping stones (east) and a log (west)
    const stones: [number, number, number][] = [
      [5.5, 128.6, 0.75],
      [6.8, 130.6, 0.7],
      [5.6, 132.7, 0.65],
      [6.9, 134.9, 0.7],
      [5.9, 137.0, 0.7],
      [6.6, 139.2, 0.75],
    ];
    for (const [x, z, r] of stones) {
      const top = RIVER.surface + 0.32;
      const m = mesh(new THREE.CylinderGeometry(r, r * 1.15, top - RIVER.bed + 0.2, 9), surface('rockMoss', EXP), x, (top + RIVER.bed - 0.2) / 2, z);
      m.rotation.y = rng.range(0, 3);
      h.group.add(m);
      h.owner.staticCylinder(x, (top + RIVER.bed - 0.2) / 2, z, (top - RIVER.bed + 0.2) / 2, r);
    }
    {
      const len = RIVER.z1 - RIVER.z0 + 7;
      const log = mesh(new THREE.CylinderGeometry(0.42, 0.5, len, 10), surface('bark', EXP), -14, -0.2, (RIVER.z0 + RIVER.z1) / 2);
      log.rotation.x = Math.PI / 2;
      log.rotation.y = 0.05;
      h.group.add(log);
      h.owner.staticCylinder(-14, -0.2, (RIVER.z0 + RIVER.z1) / 2, len / 2, 0.42, { kind: 'static', surface: 'wood' }, new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0.05, 0)));
    }
    game.riverPos = new THREE.Vector3(0, RIVER.surface, (RIVER.z0 + RIVER.z1) / 2);
    yield;

    // ---------------------------------------------------------- crossings
    buildBridge(game, h);
    {
      const len = FALLEN_TREE.zSouth - FALLEN_TREE.zNorth + 4;
      const cz = (FALLEN_TREE.zSouth + FALLEN_TREE.zNorth) / 2;
      const r = 0.55;
      const trunk = mesh(new THREE.CylinderGeometry(r * 0.8, r * 1.15, len, 12), surface('bark', EXP), FALLEN_TREE.x, FALLEN_TREE.y, cz);
      trunk.rotation.x = Math.PI / 2;
      h.group.add(trunk);
      h.owner.staticCylinder(FALLEN_TREE.x, FALLEN_TREE.y, cz, len / 2, r * 0.85, { kind: 'static', surface: 'wood' }, new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
      // root ball on the south end and a few broken branches
      const roots = mesh(new THREE.DodecahedronGeometry(1.6, 0), surface('bark', EXP), FALLEN_TREE.x - 0.4, 0.4, FALLEN_TREE.zSouth + 2.6);
      roots.scale.set(1, 0.8, 0.5);
      h.group.add(roots);
      for (let i = 0; i < 5; i++) {
        const b = mesh(new THREE.CylinderGeometry(0.06, 0.12, rng.range(1, 2.4), 5), surface('bark', EXP), FALLEN_TREE.x + rng.range(-0.6, 0.6), 0.3, rng.range(FALLEN_TREE.zNorth + 2, FALLEN_TREE.zSouth - 2));
        b.rotation.set(rng.range(-1, 1), 0, rng.range(-1.4, 1.4));
        h.group.add(b);
      }
    }
    yield;

    // ---------------------------------------------------------- ruins & relic altars
    for (const [x, z] of [
      [9, 156],
      [-14, 146],
      [16, 121],
      [-11, 106],
    ] as [number, number][]) {
      const y = groundY(x, z);
      const altar = mesh(new THREE.BoxGeometry(1.4, 0.5, 1.0), surface('templeWallMoss', EXP), x, y + 0.1, z);
      altar.rotation.y = rng.range(-0.4, 0.4);
      h.group.add(altar);
      h.owner.staticBox(x, y + 0.1, z, 0.7, 0.25, 0.5, undefined, altar.quaternion);
      rubble(h, x + 1.5, y, z + 0.5, 1.6, 5, EXP, rng, false);
    }
    // a broken gateway near the spawn and one before the courtyard
    for (const [z, w] of [
      [160, 5],
      [73, 4.5],
    ] as [number, number][]) {
      column(h, -w, groundY(-w, z) - 0.2, z, z > 100 ? 4.2 : 6.5, 0.55, EXP);
      column(h, w, groundY(w, z) - 0.2, z, z > 100 ? 2.6 : 6.5, 0.55, EXP);
      if (z < 100) {
        const lintel = mesh(new THREE.BoxGeometry(w * 2 + 1.6, 0.8, 1.4), surface('templeWallMoss', EXP), 0, 7.1, z);
        h.group.add(lintel);
        h.owner.staticBox(0, 7.1, z, w + 0.8, 0.4, 0.7);
      }
    }
    // a giant stone head half-buried by the trail
    {
      const x = -6;
      const z = 116;
      const y = groundY(x, z);
      const head = mesh(new THREE.BoxGeometry(2.4, 2.6, 2.2), surface('templeWallMoss', EXP), x, y + 0.9, z);
      head.rotation.set(0.15, 0.6, 0.1);
      h.group.add(head);
      h.owner.staticBox(x, y + 0.9, z, 1.2, 1.3, 1.1, undefined, head.quaternion);
    }
    yield;

    // ---------------------------------------------------------- vegetation
    const dens = game.quality.vegetation;
    const veg = (x: number, z: number): number | null => {
      if (z > RIVER.z0 - 3 && z < RIVER.z1 + 3) return null;
      if (z > GORGE.z0 - 2 && z < GORGE.z1 + 2) return null;
      if (Math.abs(x) < 3 && z > 100 && z < 172) return null; // trail
      if (Math.abs(x - FALLEN_TREE.x) < 2.5 && z > 99 && z < 106) return null;
      return groundY(x, z);
    };
    buildVegetation(h.group, { x0: -55, x1: 55, z0: 101, z1: 186, ground: veg, trees: 150, palms: 60, ferns: 900, grass: 2600, seed: 11 }, dens);
    yield;
    buildVegetation(h.group, { x0: -55, x1: 55, z0: 70, z1: 82, ground: veg, trees: 40, palms: 18, ferns: 260, grass: 800, seed: 12 }, dens);
    // dense undergrowth along the gorge lips hides the boundary
    void fbm;
    void BRIDGE;
  },
};
