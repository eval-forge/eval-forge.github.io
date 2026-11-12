import * as THREE from 'three';
import { SceneChunk } from '../SceneChunk';
import { materials } from '../textures';
import { mulberry32 } from '../../logic/rng';
import { G } from '../../core/ctx';
import { loot, slab, ceiling, wallX, wallZ, rubble, skeleton, pickup } from './common';
import { Drawbridge, Lever } from '../../entities/Door';
import { CrumbleFloor, DartTrap, Blade, Boulder } from '../../entities/Traps';
import { RelicSpot } from '../../entities/Loot';

export const FLOOR = -14;
const CEIL = -10;

export class Catacombs extends SceneChunk {
  id = 'catacombs' as const;
  zone = 'C' as const;
  name = 'Lower Catacombs';
  darts!: DartTrap;
  bridge!: Drawbridge;
  boulder!: Boulder;
  plateBox = new THREE.Box3(new THREE.Vector3(10.5, -11, -318), new THREE.Vector3(13.5, -9, -315));
  private boulderArmed = true;

  build() {
    const m = materials();
    const W = m.darkStone, F = m.cave;
    const rnd = mulberry32(G.seed ^ 0x6666);
    this.bounds.set(new THREE.Vector3(-20, -28, -376), new THREE.Vector3(14, 6, -285.5));
    this.areas = [
      new THREE.Box3(new THREE.Vector3(-2.6, -15, -305), new THREE.Vector3(2.6, 6, -285.8)), // stairwell
      new THREE.Box3(new THREE.Vector3(-20, -28, -375), new THREE.Vector3(14, -7, -304)),
    ];
    this.navRegions = [
      { min: new THREE.Vector3(-2, -15, -305), max: new THREE.Vector3(2, 1, -286) },
      // Main level: cast from just under the -10 ceiling
      { min: new THREE.Vector3(-19, -17.5, -376), max: new THREE.Vector3(11, -10.1, -305) },
      // Boulder ramp, one region per roofed segment (each below its own roof)
      ...Array.from({ length: 7 }, (_, i) => {
        const za = -351 + i * 5, zb = Math.min(-318, za + 5);
        const y = Math.min(-14 + ((za + 351) / 33) * 3.4, -14 + ((zb + 351) / 33) * 3.4);
        return { min: new THREE.Vector3(7, y - 1, za), max: new THREE.Vector3(11, y + 4.3, zb) };
      }),
      { min: new THREE.Vector3(6.5, -11.5, -318), max: new THREE.Vector3(14, -6.8, -311) },
    ];
    this.killY = -24;
    this.neighbours = ['sanctum', 'vault'];

    // --- Stairwell down from the sanctum seal ---
    this.b.stairs(0, 4, -286.2, -304, 0, FLOOR, W, 0.35);
    for (let i = 0; i < 9; i++) {
      const z0 = -286 - i * 2, y = -((i + 0.5) / 9) * 14;
      this.b.box(1, 6, 2.05, -2.5, y + 2.2, z0 - 1, W);
      this.b.box(1, 6, 2.05, 2.5, y + 2.2, z0 - 1, W);
      this.b.box(6, 1, 2.05, 0, y + 4.9, z0 - 1, W);
    }

    // --- Entry hall x[-6,6] z[-304,-315] ---
    slab(this.b, -6, 6, -304, -315, FLOOR, F);
    ceiling(this.b, -6, 6, -304, -315, CEIL, W);
    wallZ(this.b, -304, -7, 7, FLOOR, 4, 1, W, [{ a: -2, b: 2, h: 4 }]);
    wallX(this.b, -6.5, -304, -315, FLOOR, 4, 1, W);
    wallX(this.b, 6.5, -304, -315, FLOOR, 4, 1, W);
    wallZ(this.b, -315.5, -7, 7, FLOOR, 4, 1, W, [{ a: -1.5, b: 1.5, h: 4 }]);
    skeleton(this, -4, FLOOR, -312, 2.4);
    loot(this, 'C', -5, FLOOR + 0.02, -308, rnd);
    pickup(this, 'torch', 4.5, FLOOR + 0.02, -306);
    this.addSconce(-5.9, -12.2, -306.5, Math.PI / 2);

    // --- Dart corridor x[-1.5,1.5] z[-315,-335] ---
    slab(this.b, -1.5, 1.5, -315, -335, FLOOR, F);
    ceiling(this.b, -2, 2, -315, -335, CEIL, W);
    wallX(this.b, -2, -315, -335, FLOOR, 4, 1, W);
    wallX(this.b, 2, -315, -335, FLOOR, 4, 1, W);
    this.darts = new DartTrap(this, 24);
    for (const z of [-318, -322, -326, -330]) this.darts.addPlate(0, FLOOR, z, 2.8, 1.2);
    for (let z = -317; z >= -333; z -= 2) {
      this.darts.addLauncher(new THREE.Vector3(-1.45, FLOOR + 1.25, z), new THREE.Vector3(1, 0, 0));
      this.darts.addLauncher(new THREE.Vector3(1.45, FLOOR + 1.25, z - 1), new THREE.Vector3(-1, 0, 0));
    }
    rubble(this, 0.9, FLOOR, -334, 0.6, 3, rnd, F);

    // --- Crumbling chasm room x[-6,6] z[-335,-349.5] ---
    wallZ(this.b, -335, -7, 7, FLOOR, 4, 1, W, [{ a: -1.5, b: 1.5, h: 4 }]);
    slab(this.b, -6, 6, -335.5, -337, FLOOR, F);
    slab(this.b, -6, 6, -347.5, -349.5, FLOOR, F);
    this.b.box(12, 11, 1, 0, -20.5, -336.5, W, { cast: false });
    this.b.box(12, 11, 1, 0, -20.5, -348, W, { cast: false });
    ceiling(this.b, -6, 6, -335.5, -349.5, CEIL, W);
    wallX(this.b, -6.5, -335, -349.5, -26, 16, 1, W);
    wallX(this.b, 6.5, -335, -349.5, -26, 16, 1, W);
    slab(this.b, -6, 6, -337, -347.5, -26, F); // chasm bottom (lethal fall)
    new CrumbleFloor(this, new THREE.Vector3(-5.5, FLOOR, -337), 6, 7, 1.5, { delay: 0.65 });
    loot(this, 'C', -5, FLOOR + 0.02, -336.2, rnd);
    // Drawbridge shortcut, lowered from the far side
    this.bridge = new Drawbridge(this, new THREE.Vector3(5, FLOOR - 0.15, -347.5), 10.5, 2, new THREE.Vector3(0, 0, 1));
    new Lever(this, new THREE.Vector3(3, FLOOR, -348.8), 0, 'Pull the lever (lower the drawbridge)', () => {
      this.bridge.setOpen(true);
      G.setFlag('drawbridgeDown');
      G.toast('Chains rattle. The drawbridge slams down across the chasm.');
    });

    // --- Junction x[-6,6] z[-349.5,-362] ---
    slab(this.b, -6, 6, -349.5, -362, FLOOR, F);
    ceiling(this.b, -6, 6, -349.5, -362, CEIL, W);
    wallX(this.b, -6.5, -349.5, -362, FLOOR, 4, 1, W, [{ a: -353, b: -357, h: 3.2 }]);
    wallX(this.b, 6.5, -349.5, -362, FLOOR, 4, 1, W, [{ a: -352, b: -356, h: 3.2 }]);
    wallZ(this.b, -362.5, -7, 7, FLOOR, 4, 1, W, [{ a: -1.5, b: 1.5, h: 4 }]);
    loot(this, 'C', 5, FLOOR + 0.02, -360.5, rnd);
    pickup(this, 'flask', -5, FLOOR + 0.02, -361);
    this.addSconce(-5.9, -12.2, -360, Math.PI / 2);

    // --- Flooded chamber x[-18,-6.5] z[-350,-372] ---
    const WY = -14.55;
    slab(this.b, -18, -7, -350, -372, -16.5, F);
    for (let i = 0; i < 6; i++) this.b.box(0.6, 1, 4, -7.2 - i * 0.6, FLOOR - 0.5 - i * 0.42, -355, F, { cast: false });
    ceiling(this.b, -18, -6.5, -350, -372, CEIL, W);
    wallX(this.b, -18.5, -350, -372, -16.5, 7, 1, W);
    wallZ(this.b, -349.5, -19, -6.5, -16.5, 7, 1, W);
    wallZ(this.b, -372.5, -19, -6.5, -16.5, 7, 1, W);
    this.b.box(1, 2.5, 22, -6.5, -15.25, -361, W, { cast: false }); // below the junction floor
    const water = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 22), m.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(-12.25, WY, -361);
    this.group.add(water);
    this.waters.push({ box: new THREE.Box3(new THREE.Vector3(-18, -17, -372), new THREE.Vector3(-6.8, WY, -350)), surface: WY });
    const key = new RelicSpot(this, 'bronzekey', 'C', new THREE.Vector3(-15, -16.48, -368));
    void key;
    loot(this, 'C', -12, -16.48, -358, rnd);
    rubble(this, -16, -16.5, -352, 3, 5, rnd, F);

    // --- Boulder ramp x[7,11] rising from z -351 (y -14) to z -318 (y -10.6) ---
    const rampLen = 33, rise = 3.4;
    const ang = Math.atan2(rise, rampLen);
    const midY = FLOOR + rise / 2, midZ = -334.5;
    this.b.box(4, 1, Math.hypot(rampLen, rise), 9, midY - 0.5, midZ, F, { rotX: -ang, cast: false });
    const rampY = (z: number) => FLOOR + ((-351 - z) / -rampLen) * rise;
    for (let i = 0; i < 7; i++) {
      const za = -351 + i * 5, zb = Math.min(-318, za + 5), z = (za + zb) / 2;
      const y = Math.min(rampY(za), rampY(zb));
      this.b.box(1, 5.2, zb - za + 0.05, 6.5, y + 2.1, z, W);
      this.b.box(1, 5.2, zb - za + 0.05, 11.5, y + 2.1, z, W);
      this.b.box(6, 1, zb - za + 0.05, 9, y + 4.9, z, W);
    }
    // bottom landing
    slab(this.b, 7, 11, -351, -358.5, FLOOR, F);
    ceiling(this.b, 7, 11, -351, -358.5, CEIL, W);
    wallX(this.b, 11.5, -351, -359, FLOOR, 4, 1, W);
    wallX(this.b, 6.5, -356, -359, FLOOR, 4, 1, W);
    wallZ(this.b, -359, 6, 12, FLOOR, 4.2, 1, W);
    // top landing and loot niche
    const topY = FLOOR + rise;
    slab(this.b, 6.5, 14, -311, -318, topY, F);
    ceiling(this.b, 6.5, 14, -311, -318, topY + 4, W);
    wallZ(this.b, -310.5, 6, 14.5, topY, 4, 1, W);
    wallX(this.b, 6, -311, -318, topY, 4, 1, W);
    wallX(this.b, 14.5, -311, -318, topY, 4, 1, W);
    wallZ(this.b, -318.5, 11, 14.5, topY, 4, 1, W);
    loot(this, 'C', 12.8, topY + 0.02, -316.6, rnd);
    loot(this, 'C', 13.2, topY + 0.02, -312.4, rnd);
    this.boulder = new Boulder(this, new THREE.Vector3(8.8, topY + 1.45, -312.6), 1.4, new THREE.Vector3(0, 0, -5));
    this.addSconce(6.6, topY + 2, -340, Math.PI / 2);

    // --- Blade corridor x[-1.5,1.5] z[-362.5,-375] ---
    slab(this.b, -1.5, 1.5, -362.5, -375.5, FLOOR, F);
    ceiling(this.b, -2, 2, -362.5, -375.5, CEIL, W);
    wallX(this.b, -2, -362.5, -375.5, FLOOR, 4, 1, W);
    wallX(this.b, 2, -362.5, -375.5, FLOOR, 4, 1, W);
    new Blade(this, new THREE.Vector3(0, CEIL - 0.1, -365.5), 3.0, 'x', 0, 2.4, 1.0);
    new Blade(this, new THREE.Vector3(0, CEIL - 0.1, -369), 3.0, 'x', 1.7, 2.1, 1.0);
    new Blade(this, new THREE.Vector3(0, CEIL - 0.1, -372.5), 3.0, 'x', 3.4, 2.6, 1.0);
  }

  update(dt: number) {
    super.update(dt);
    if (this.boulderArmed) {
      const p = new THREE.Vector3(G.player.position.x, G.player.feetY + 0.2, G.player.position.z);
      if (this.plateBox.containsPoint(p)) { this.boulderArmed = false; G.audio.grind(0.3); this.boulder.release(); }
    }
  }
}
