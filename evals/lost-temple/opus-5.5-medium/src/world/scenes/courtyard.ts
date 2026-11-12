import * as THREE from 'three';
import { SceneChunk } from '../SceneChunk';
import { materials } from '../textures';
import { mulberry32 } from '../../logic/rng';
import { G } from '../../core/ctx';
import { trees, ferns, loot, pillar, rubble, vines, wallX, pickup } from './common';
import { Mover } from '../../entities/Door';
import { RelicSpot, Prop, potMesh, stoneHeadMesh } from '../../entities/Loot';
import { NOTCHES, ringAngleDeg, sundialSolved, shadowAngleDeg } from '../../logic/sundial';
import { doorOpenFraction } from '../../logic/countdown';

export const DOOR_Z = -176.5;
export const SUNDIAL = new THREE.Vector3(-14, 0, -130);

export class Courtyard extends SceneChunk {
  id = 'courtyard' as const;
  zone = 'A' as const;
  name = 'Temple Courtyard';
  door!: Mover;
  notch = 3;
  ring!: THREE.Group;
  solved = false;
  private checkT = 0;
  disc!: RelicSpot;
  lid!: THREE.Mesh;
  private lidT = 0;
  private doorBlocked = false;

  build() {
    const m = materials();
    const rnd = mulberry32(G.seed ^ 0x2222);
    this.bounds.set(new THREE.Vector3(-42, -40, -179), new THREE.Vector3(42, 30, -91));
    this.areas = [new THREE.Box3(new THREE.Vector3(-42, -40, -175), new THREE.Vector3(41, 40, -91))];
    this.navRegions = [{ min: new THREE.Vector3(-40, -2, -180), max: new THREE.Vector3(40, 6, -93) }];
    this.killY = -10;
    this.neighbours = ['jungle', 'halls'];

    // Plaza floor
    this.b.box(84, 1, 84, 0, -0.5, -133, m.plaza, { cast: false, uvScale: 0.35 });
    // Threshold under the great door (bridges the plaza to the halls floor)
    this.b.box(36, 1, 3.2, 0, -0.5, -176.55, m.plaza, { cast: false });
    this.b.box(84, 40, 2, 0, -20.5, -92, m.cliff, { cast: false });
    // Boundary walls (ruined low walls with invisible tops), gap to the cliffs on the east
    wallX(this.b, -40.5, -93, -175, 0, 2.2, 1, m.mossStone);
    this.b.wall(1, 30, 84, -41, 15, -133);
    wallX(this.b, 40.5, -93, -175, 0, 2.2, 1, m.mossStone, [{ a: -112, b: -128, h: 0 }]);
    this.b.wall(1, 30, 19, 41, 15, -102.5);
    this.b.wall(1, 30, 47, 41, 15, -151.5);

    // Temple facade with the great door opening
    const fz = -176.5;
    this.b.box(37.5, 16, 3, -21.25, 8, fz, m.mossStone);
    this.b.box(37.5, 16, 3, 21.25, 8, fz, m.mossStone);
    this.b.box(5, 10, 3, 0, 11, fz, m.mossStone);
    // stepped pyramid silhouette
    for (let i = 0; i < 4; i++) this.b.box(60 - i * 12, 4, 30 - i * 5, 0, 18 + i * 4, -192 - i * 1.5, m.mossStone, { collide: false });
    // columns and steps
    for (const x of [-12, -6, 6, 12]) pillar(this.b, x, -173.2, 0, 10, m.stone, 0.8);
    this.b.box(30, 0.3, 3, 0, 0.15, -173.5, m.stone, { cast: false });
    // carved lintel face
    this.b.box(7, 2.2, 0.6, 0, 7.4, -174.8, m.stone);
    this.b.box(1.0, 0.6, 0.4, -1.6, 7.6, -174.4, m.darkStone, { collide: false });
    this.b.box(1.0, 0.6, 0.4, 1.6, 7.6, -174.4, m.darkStone, { collide: false });

    // The great door: open at dawn, closes over the final window after dark.
    this.door = new Mover(this, new THREE.Vector3(5, 6.2, 0.8), { pos: new THREE.Vector3(0, 3.1, DOOR_Z) }, { pos: new THREE.Vector3(0, 9.4, DOOR_Z) }, m.darkStone, 1, true);
    this.door.alwaysKinematic = true;

    // Avenue of pillars, some toppled
    for (let i = 0; i < 6; i++) {
      const z = -102 - i * 12;
      for (const x of [-7, 7]) {
        const broken = rnd() < 0.35;
        if (rnd() < 0.2) continue;
        pillar(this.b, x, z, 0, broken ? 2 + rnd() * 3 : 7, m.mossStone, 0.7, broken);
      }
    }
    this.b.cyl(0.7, 7, -18, 0.7, -106, m.mossStone, { rotZ: Math.PI / 2, rotY: 0.6 });
    this.b.cyl(0.7, 6, 20, 0.7, -140, m.mossStone, { rotZ: Math.PI / 2, rotY: -0.3 });
    this.b.cyl(0.7, 5, 4, 0.7, -158, m.mossStone, { rotZ: Math.PI / 2, rotY: 1.2 });
    rubble(this, 18, 0, -142, 6, 10, rnd, m.mossStone);
    rubble(this, -20, 0, -108, 5, 8, rnd, m.mossStone);

    // Overgrowth
    const tp: { x: number; y: number; z: number; s: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const x = side * (28 + rnd() * 10), z = -96 - rnd() * 70;
      if (side > 0 && z < -108 && z > -132) continue;
      tp.push({ x, y: 0, z, s: rnd() });
    }
    trees(this, tp);
    const fp: { x: number; y: number; z: number; s: number }[] = [];
    for (let i = 0; i < 260; i++) {
      const x = (rnd() - 0.5) * 78, z = -94 - rnd() * 78;
      if (Math.abs(x) < 3 || new THREE.Vector2(x - SUNDIAL.x, z - SUNDIAL.z).length() < 4) continue;
      fp.push({ x, y: 0, z, s: rnd() });
    }
    ferns(this, fp);

    this.buildSundial();

    // Loot
    loot(this, 'A', -18.5, 1.42, -106.3, rnd);
    const stx = 24, stz = -152;
    this.b.box(1.2, 1.0, 1.2, stx, 0.5, stz, m.mossStone);
    this.b.box(0.9, 1.6, 0.6, stx, 1.8, stz, m.mossStone, { rotY: 0.3 });
    loot(this, 'A', stx + 1.4, 0.02, stz + 0.6, rnd);
    // Climb the facade vines to a ledge relic
    this.b.box(8, 0.5, 1.8, 30, 4.25, -174.1, m.mossStone);
    this.climbs.push(vines(this, 26.5, 28.5, -174.8, -174.8, 0, 4.6));
    loot(this, 'A', 32, 4.5, -174.2, rnd, 'crown');

    // Props to carry / throw
    new Prop(this, 'clay pot', 2, potMesh(), new THREE.Vector3(-10, 0.3, -168), new THREE.Vector3(0.2, 0.22, 0.2));
    new Prop(this, 'stone head', 5, stoneHeadMesh(), new THREE.Vector3(10, 0.3, -165), new THREE.Vector3(0.2, 0.22, 0.2));
    pickup(this, 'torch', 3.5, 0.02, -170);
  }

  private buildSundial() {
    const m = materials();
    const { x, z } = SUNDIAL;
    this.b.cyl(2.5, 0.5, x, 0.25, z, m.stone, { segs: 24 });
    this.b.cyl(2.25, 0.06, x, 0.53, z, m.plaza, { segs: 24, collide: false, cast: false });
    // hour marks
    for (let i = 0; i < NOTCHES; i++) {
      const a = (ringAngleDeg(i) * Math.PI) / 180;
      this.b.box(0.08, 0.04, 0.35, x + Math.cos(a) * 1.9, 0.57, z + Math.sin(a) * 1.9, m.darkStone, { collide: false, rotY: -a + Math.PI / 2, cast: false });
    }
    // gnomon: vertical post (visual only, so the dial's sunlit check isn't blocked by it)
    const gn = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.7, 8), m.bronze);
    gn.position.set(x, 0.56 + 0.85, z);
    gn.castShadow = true;
    this.group.add(gn);
    // rotating ring with a pointer
    this.ring = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.09, 6, 40), m.bronze);
    torus.rotation.x = Math.PI / 2;
    const ptr = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 4), m.bronze);
    ptr.rotation.z = -Math.PI / 2;
    ptr.position.set(2.0, 0, 0);
    this.ring.add(torus, ptr);
    this.ring.position.set(x, 0.62, z);
    this.ring.traverse((o) => { o.castShadow = true; o.userData.dynamic = true; });
    this.ring.userData.dynamic = true;
    this.group.add(this.ring);
    this.setRing();
    this.interactables.push({
      pos: new THREE.Vector3(x, 0.8, z), radius: 3.2,
      label: () => (this.solved ? null : 'Turn the bronze ring  (the plaque reads: "Point the sun\'s hand where the shadow falls")'),
      act: () => { this.notch = (this.notch + 1) % NOTCHES; this.setRing(); G.audio.grind(0.35, SUNDIAL); this.checkT = 0; },
    });
    // stone compartment holding the Sun-Disc
    const cx = x + 3.6, cz = z;
    this.b.box(1.4, 0.8, 1.4, cx, 0.4, cz, m.stone);
    this.lid = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 1.2), m.darkStone);
    this.lid.position.set(cx, 0.88, cz);
    this.lid.castShadow = true;
    this.lid.userData.dynamic = true;
    this.group.add(this.lid);
    this.disc = new RelicSpot(this, 'sundisc', 'A', new THREE.Vector3(cx, 0.72, cz));
    this.disc.mesh.scale.setScalar(0.8);
    this.disc.blocked = () => !this.solved;
  }

  private setRing() {
    const a = (ringAngleDeg(this.notch) * Math.PI) / 180;
    // pointer sits on +x of the ring group; rotate so it points along (cos a, sin a) in XZ
    this.ring.rotation.y = -a;
  }

  update(dt: number) {
    super.update(dt);
    // Sundial check (real sun position + shadow ray)
    if (!this.solved) {
      this.checkT -= dt;
      if (this.checkT <= 0) {
        this.checkT = 0.3;
        const s = G.sky.sunVec;
        const lit = G.sky.sunlit(new THREE.Vector3(SUNDIAL.x, 0.7, SUNDIAL.z));
        if (sundialSolved(this.notch, [s.x, s.y, s.z], lit)) {
          this.solved = true;
          G.setFlag('sunDiscSolved');
          G.audio.grind(1.6, SUNDIAL);
          G.audio.pickup(800);
          G.toast('The ring locks with the shadow. A stone lid grinds open!', 4);
        }
        void shadowAngleDeg;
      }
    } else if (this.lidT < 1) {
      this.lidT = Math.min(1, this.lidT + dt * 0.6);
      this.lid.position.x = SUNDIAL.x + 3.6 + this.lidT * 1.3;
      this.lid.position.y = 0.88 - this.lidT * 0.5;
      this.lid.rotation.z = -this.lidT * 0.6;
    }
    // Great door follows the clock
    this.door.t = this.door.target = doorOpenFraction(G.elapsed);
    const blocked = this.door.t < 0.3;
    if (blocked !== this.doorBlocked) {
      this.doorBlocked = blocked;
      G.nav.setBlocked(new THREE.Box3(new THREE.Vector3(-2.5, -1, DOOR_Z - 1.5), new THREE.Vector3(2.5, 6, DOOR_Z + 1.5)), blocked);
    }
  }

  tick(dt: number) {
    // keep the door transform correct even while unloaded
    if (!this.loaded) { this.door.t = doorOpenFraction(G.elapsed); this.door.apply(); }
    void dt;
  }
}
