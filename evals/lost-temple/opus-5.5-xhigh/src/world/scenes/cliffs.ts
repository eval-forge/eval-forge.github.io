/**
 * A3 Outer cliffs (optional): a ledge trail down the cliff face east of the courtyard,
 * vine walls, and wind gusts that shove you toward an 80 m drop and can blow your torch out.
 * High-value relics in the open.
 */
import * as THREE from 'three';
import { LEDGES, VINES } from '../layout';
import { addBoxes, mesh, type BoxSpec } from '../build';
import { vineFor, buildVegetation } from '../nature';
import { surface, standard } from '../../engine/materials';
import { Rng } from '../../core/rng';
import type { SceneDef } from '../SceneManager';

const EXP = 'outdoor' as const;

export const cliffs: SceneDef = {
  id: 'cliffs',
  *build(game, h) {
    const rng = new Rng(303);
    const boxes: BoxSpec[] = [];
    // the cliff face (x = 42), from just under the courtyard down to the valley
    boxes.push({ c: [40, -30.4, 20], h: [2, 30, 52], mat: 'rockMoss', exp: EXP, uv: 5 });
    // ledges: rock slabs sticking out of the face
    for (const l of LEDGES) {
      const pillar = l.y > 4;
      const depth = pillar ? 68 : 1.6 + rng.range(0, 1.2);
      boxes.push({ c: [(l.x0 + l.x1) / 2, l.y - depth / 2, (l.z0 + l.z1) / 2], h: [(l.x1 - l.x0) / 2, depth / 2, (l.z1 - l.z0) / 2], mat: pillar ? 'rockMoss' : 'rock', exp: EXP, uv: 4 });
      // a tapering underside so ledges read as rock, not shelves
      if (!pillar) {
        boxes.push({ c: [(l.x0 + l.x1) / 2 - 0.6, l.y - depth - 0.8, (l.z0 + l.z1) / 2], h: [(l.x1 - l.x0) / 2 - 0.6, 0.8, (l.z1 - l.z0) / 2 - 0.4], mat: 'rock', exp: EXP, uv: 4, collide: false });
      }
    }
    // jagged rock below and between the ledges
    for (let i = 0; i < 40; i++) {
      const z = rng.range(-14, 70);
      const y = rng.range(-50, -10);
      const s = rng.range(1, 3.5);
      boxes.push({ c: [42 + s * 0.3, y, z], h: [s * 0.7, s * 1.4, s], mat: 'rock', exp: EXP, rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.3, 0.3), rng.range(-0.5, 0.5), rng.range(-0.2, 0.2))), collide: false });
    }
    addBoxes(boxes, h.group, h.owner);
    yield;

    for (const v of VINES.filter((x) => x.scene === 'cliffs')) {
      vineFor(h.group, v, EXP, 31 + Math.round(v.z0));
      h.vines.push(v);
    }
    // small shrubs clinging to ledges
    for (const l of LEDGES) {
      buildVegetation(h.group, { x0: l.x0 + 0.3, x1: l.x1 - 0.3, z0: l.z0 + 0.3, z1: l.z1 - 0.3, ground: () => l.y, trees: 0, palms: 0, ferns: 3, grass: 18, seed: Math.round(l.z0 * 7) }, game.quality.vegetation);
    }
    yield;

    // ---------------------------------------------------------- the view: valley floor far below, distant ridges
    const valley = mesh(new THREE.PlaneGeometry(700, 700, 1, 1), standard('valley', EXP, { color: 0x2f4a26, roughness: 1 }), 360, -62, 20, false, true);
    valley.rotation.x = -Math.PI / 2;
    h.group.add(valley);
    for (let i = 0; i < 14; i++) {
      const r = rng.range(40, 110);
      const m = mesh(new THREE.ConeGeometry(r, rng.range(60, 130), 7), surface('rockMoss', EXP), rng.range(260, 520), -62, rng.range(-260, 300), false, false);
      m.rotation.y = rng.range(0, 3);
      h.group.add(m);
    }
    buildVegetation(h.group, { x0: 60, x1: 200, z0: -120, z1: 160, ground: () => -62, trees: 260, palms: 0, ferns: 0, grass: 0, seed: 33 }, Math.min(1, game.quality.vegetation));
    yield;

    // ---------------------------------------------------------- wind gusts
    let gustT = 4;
    let gust = 0;
    let gustDir = 1;
    const wind = { x0: 41.5, x1: 70, z0: -14, z1: 70, y0: -30, y1: 14, dir: [1, 0] as [number, number], strength: 0.15 };
    h.winds.push(wind);
    h.update.push((dt) => {
      gustT -= dt;
      if (gustT <= 0 && gust <= 0) {
        gust = 1.6 + rng.range(0, 0.8);
        gustDir = rng.chance(0.75) ? 1 : -0.4;
        const strength = rng.range(0.55, 1);
        wind.strength = strength;
        gustT = rng.range(6, 11);
        const p = game.player.pos;
        if (p.x > 41.5 && game.scenes.current === 'cliffs') {
          game.audio.windGust(strength);
          game.torch.gust(strength);
        }
      }
      if (gust > 0) {
        gust -= dt;
        wind.dir = [gustDir, 0.15 * Math.sin(gust * 3)];
        if (gust <= 0) wind.strength = 0.15;
      }
    });
  },
};
