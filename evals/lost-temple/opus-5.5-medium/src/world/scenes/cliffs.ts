import * as THREE from 'three';
import { SceneChunk } from '../SceneChunk';
import { materials } from '../textures';
import { mulberry32 } from '../../logic/rng';
import { G } from '../../core/ctx';
import { Bridge } from '../../entities/Bridge';
import { loot, vines, ferns, trees, skeleton } from './common';

/** Optional outer cliffs: ledges, vines, wind gusts and relics out in the open. */
export class Cliffs extends SceneChunk {
  id = 'cliffs' as const;
  zone = 'A' as const;
  name = 'Outer Cliffs';
  bridge!: Bridge;
  private gustT = 6;
  private gust = 0;
  private gustDur = 0;
  private gustPeak = 0;
  private warned = false;

  build() {
    const m = materials();
    const rnd = mulberry32(G.seed ^ 0x3333);
    this.bounds.set(new THREE.Vector3(40, -40, -146), new THREE.Vector3(113, 30, -100));
    this.areas = [new THREE.Box3(new THREE.Vector3(41, -40, -146), new THREE.Vector3(113, 40, -100))];
    this.navRegions = [{ min: new THREE.Vector3(41, -1, -142), max: new THREE.Vector3(112, 16, -101) }];
    this.killY = -10;
    this.neighbours = ['courtyard'];

    const top = (x0: number, x1: number, z0: number, z1: number, y: number) =>
      this.b.box(x1 - x0, y + 40, Math.abs(z1 - z0), (x0 + x1) / 2, (y - 40) / 2, (z0 + z1) / 2, m.cliff);

    // Entry platform
    top(40, 52, -108, -141.5, 0);
    // Back rock wall
    this.b.box(74, 64, 4, 76, -8, -143.5, m.cliff);
    // Ledges
    top(52, 63, -133, -141.5, 0);
    top(65, 73, -135, -141.5, 0.6);
    top(70, 90, -136.5, -141.5, 6.5);
    this.b.box(12.7, 1, 3.7, 90.65, 12.5, -139.65, m.cliff);
    // Outcrop pillar across the second bridge
    top(104, 111, -131, -142, 6.5);
    // Far chasm floor
    this.b.box(80, 2, 50, 76, -38, -122, m.cave, { cast: false });
    // Boundaries
    this.b.wall(1, 60, 46, 112.5, 0, -123);
    this.b.wall(74, 60, 1, 76, 0, -100.5);

    // Vines
    this.climbs.push(vines(this, 69.95, 69.95, -140.5, -138.2, 0.6, 7.2));
    this.climbs.push(vines(this, 82.2, 84.2, -141.4, -141.4, 6.5, 13.6));

    // Second rope bridge
    this.bridge = new Bridge(this, new THREE.Vector3(90.1, 6.55, -138.8), new THREE.Vector3(103.9, 6.55, -138.8), 1.6, 15, 0.75);

    // Vegetation on top of the platform
    trees(this, [{ x: 43, y: 0, z: -110, s: 0.5 }, { x: 46, y: 0, z: -127, s: 0.8 }, { x: 108, y: 6.5, z: -133, s: 0.3 }]);
    const fp = [];
    for (let i = 0; i < 40; i++) fp.push({ x: 41 + rnd() * 10, y: 0, z: -109 - rnd() * 20, s: rnd() });
    ferns(this, fp);
    skeleton(this, 108, 6.5, -140, 2.2);

    // Relics out in the open (higher-value zone A picks)
    loot(this, 'A', 70, 0.62, -137.5, rnd);
    loot(this, 'A', 95, 13.02, -139.5, rnd, 'crown');
    loot(this, 'A', 107, 6.52, -136, rnd, 'woodmask');
    loot(this, 'A', 109.5, 6.52, -140.5, rnd);
  }

  windAt(p: THREE.Vector3): number {
    if (!this.contains(p) || p.x < 50) return 0;
    return this.gust;
  }

  tick(dt: number) {
    this.gustT -= dt;
    if (this.gustT <= 0 && this.gustDur <= 0) {
      this.gustDur = 2.5;
      this.gustPeak = 0.55 + Math.random() * 0.45;
      if (G.world?.current === this && !this.warned) { this.warned = true; G.toast('Wind gusts can blow your torch out and push you off the ledges!', 3); }
    }
    if (this.gustDur > 0) {
      this.gustDur -= dt;
      this.gust = this.gustPeak * Math.sin(Math.max(0, this.gustDur) / 2.5 * Math.PI);
      if (this.gustDur <= 0) { this.gust = 0; this.gustT = 7 + Math.random() * 7; }
    }
  }
}
