import * as THREE from 'three';
import { SceneChunk } from '../SceneChunk';
import { materials } from '../textures';
import { mulberry32 } from '../../logic/rng';
import { G } from '../../core/ctx';
import { loot, slab, ceiling, wallX, wallZ, rubble, skeleton } from './common';

/** Floor height of the escape tunnel at z. */
export function tunnelY(z: number): number {
  if (z <= -410) return -14;
  if (z >= -200) return 0;
  return -14 + ((z + 410) / 210) * 14;
}

/** The escape tunnel: a long, dark, rising passage from the vault to the Broken Halls. */
export class Tunnel extends SceneChunk {
  id = 'tunnel' as const;
  zone = 'C' as const;
  name = 'Escape Tunnel';

  build() {
    const m = materials();
    const W = m.darkStone, F = m.cave;
    const rnd = mulberry32(G.seed ^ 0x8888);
    this.bounds.set(new THREE.Vector3(18.6, -16, -424), new THREE.Vector3(27, 5, -185));
    this.areas = [new THREE.Box3(new THREE.Vector3(18.6, -16, -424), new THREE.Vector3(27, 5, -185))];
    this.navRegions = [{ min: new THREE.Vector3(19, -15, -423), max: new THREE.Vector3(26, 1.5, -186) }];
    this.neighbours = ['vault', 'halls'];

    // Doorway from the vault (x 19..22)
    slab(this.b, 19, 22, -418, -422, -14, F);
    ceiling(this.b, 19, 22, -417.5, -422.5, -10.5, W);
    wallZ(this.b, -417.5, 19, 21.5, -14, 4, 1, W);
    wallZ(this.b, -422.5, 19, 21.5, -14, 4, 1, W);
    // Bottom flat section
    slab(this.b, 22, 26, -410, -423, -14, F);
    ceiling(this.b, 21.5, 26.5, -410, -423.5, -10, W);
    wallZ(this.b, -423.5, 21.5, 26.5, -14, 4, 1, W);
    wallX(this.b, 21.5, -410, -423.5, -14, 4, 1, W, [{ a: -418, b: -422, h: 3.5 }]);
    wallX(this.b, 26.5, -410, -423.5, -14, 4, 1, W);
    // Rising section as shallow steps, with walls & ceiling per segment
    this.b.stairs(24, 4, -410, -200, -14, 0, F, 0.25);
    for (let z = -410; z < -200; z += 10) {
      const y = tunnelY(z);
      this.b.box(1, 5, 10.05, 21.5, y + 1.5, z + 5, W);
      this.b.box(1, 5, 10.05, 26.5, y + 1.5, z + 5, W);
      this.b.box(6, 1, 10.05, 24, y + 5, z + 5, W);
    }
    // Top flat section with the cracked wall exit on the west
    slab(this.b, 22, 26, -200, -186, 0, F);
    ceiling(this.b, 21.5, 26.5, -186, -200, 4, W);
    wallZ(this.b, -185.5, 18.5, 26.5, 0, 4, 1, W);
    wallX(this.b, 26.5, -186, -200, 0, 4, 1, W);
    wallX(this.b, 21.5, -186, -200, 0, 4, 1, W, [{ a: -188, b: -192, h: 3.5 }]);
    slab(this.b, 18.8, 22, -188, -192, 0, F);
    ceiling(this.b, 18.8, 22, -188, -192, 3.5, W);
    wallZ(this.b, -187.5, 19, 21, 0, 3.5, 1, W);
    wallZ(this.b, -192.5, 19, 21, 0, 3.5, 1, W);

    rubble(this, 25, tunnelY(-300) + 0.2, -300, 1.5, 4, rnd, F);
    skeleton(this, 23, tunnelY(-330) + 0.25, -330, 1.6);
    loot(this, 'C', 24.6, tunnelY(-331) + 0.27, -331, rnd);
    this.addSconce(22.1, tunnelY(-260) + 2, -260, Math.PI / 2);
    this.addSconce(25.9, tunnelY(-350) + 2, -350, -Math.PI / 2);
  }
}
