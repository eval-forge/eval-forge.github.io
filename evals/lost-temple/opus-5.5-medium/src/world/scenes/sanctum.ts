import * as THREE from 'three';
import { SceneChunk } from '../SceneChunk';
import { materials } from '../textures';
import { mulberry32 } from '../../logic/rng';
import { G } from '../../core/ctx';
import { loot, pillar, rubble, slab, wallX, wallZ } from './common';
import { Mover } from '../../entities/Door';
import { Boulder, DebrisField } from '../../entities/Traps';
import { Pedestal, Prop, sandbagMesh, stoneHeadMesh, potMesh } from '../../entities/Loot';

export const IDOL_POS = new THREE.Vector3(-3, 0, -262);

export class Sanctum extends SceneChunk {
  id = 'sanctum' as const;
  zone = 'B' as const;
  name = 'Collapsed Sanctum';
  seal!: Mover;
  debris!: DebrisField;
  boulder!: Boulder;
  beam!: THREE.Mesh;
  idol!: Pedestal;
  collapseStarted = false;

  build() {
    const m = materials();
    const rnd = mulberry32(G.seed ^ 0x5555);
    this.bounds.set(new THREE.Vector3(-22, -2, -287), new THREE.Vector3(22, 16, -235));
    this.areas = [new THREE.Box3(new THREE.Vector3(-21, -2, -285.6), new THREE.Vector3(21, 16, -235.6))];
    this.navRegions = [{ min: new THREE.Vector3(-20, -1, -285), max: new THREE.Vector3(20, 6, -236) }];
    this.neighbours = ['halls', 'catacombs'];

    slab(this.b, -21, 21, -236, -286, 0, m.plaza, 1);
    wallX(this.b, -20.5, -236, -286, 0, 12, 1, m.mossStone);
    wallX(this.b, 20.5, -236, -286, 0, 12, 1, m.mossStone);
    wallZ(this.b, -286, -21, 21, 0, 12, 1, m.mossStone, [{ a: -2.6, b: 2.6, h: 5 }]);
    // Half the ceiling is gone (west); the east half still stands but is unstable.
    for (let i = 0; i < 5; i++) for (let j = 0; j < 12; j++) {
      if (rnd() < 0.15) continue;
      this.b.box(4, 1, 4.2, 2 + i * 4, 11.5, -238 + -j * 4.15, m.mossStone);
    }
    // ragged edge pieces on the west half
    for (let j = 0; j < 6; j++) this.b.box(3, 0.8, 4, -1.5, 11.4, -240 - j * 8, m.mossStone);
    // Pillars, some still holding the roof
    for (const z of [-244, -256, -268, -278]) { pillar(this.b, 10, z, 0, 11, m.stone, 0.75); pillar(this.b, -12, z, 0, 3 + rnd() * 4, m.stone, 0.75, true); }
    rubble(this, -14, 0, -250, 8, 16, rnd, m.mossStone);
    rubble(this, -8, 0, -276, 6, 12, rnd, m.mossStone);
    this.b.box(3.5, 1.6, 3.5, -15, 0.8, -262, m.mossStone, { rotY: 0.5 });
    this.b.box(4.2, 1.0, 4.2, 15, 0.5, -248, m.mossStone, { rotY: 0.3, rotZ: 0.2 });

    // Altar dais and the main idol under the sun beam
    this.b.box(6, 0.4, 6, IDOL_POS.x, 0.2, IDOL_POS.z, m.stone, { cast: false });
    this.b.box(4, 0.3, 4, IDOL_POS.x, 0.55, IDOL_POS.z, m.stone, { cast: false });
    this.idol = new Pedestal(this, 'idol', 'B', new THREE.Vector3(IDOL_POS.x, 0.7, IDOL_POS.z), () => this.trapFired(), () => this.startCollapse(), 1.0);
    // Faint light-shaft volume (only visible while the sun is up)
    const beamGeo = new THREE.CylinderGeometry(0.9, 1.6, 12, 16, 1, true);
    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.beam.position.set(IDOL_POS.x, 7.2, IDOL_POS.z);
    this.beam.userData.dynamic = true;
    this.group.add(this.beam);

    // Boulder waiting in the back alcove
    this.b.box(6, 2.5, 3, -3, 1.25 - 0.2, -283.5, m.stone, { collide: true });
    this.boulder = new Boulder(this, new THREE.Vector3(-3, 1.5 + 2.3, -283.4), 1.5, new THREE.Vector3(0, 0, 9));

    // Ceiling debris (noise brings it down)
    this.debris = new DebrisField(this, new THREE.Box3(new THREE.Vector3(-20, -1, -285), new THREE.Vector3(20, 12, -236)), 11);

    // Swap objects
    new Prop(this, 'sandbag', 7, sandbagMesh(), new THREE.Vector3(5, 0.3, -240), new THREE.Vector3(0.28, 0.17, 0.22));
    new Prop(this, 'stone head', 5, stoneHeadMesh(), new THREE.Vector3(-8, 0.3, -246), new THREE.Vector3(0.2, 0.22, 0.2));
    new Prop(this, 'clay pot', 2, potMesh(), new THREE.Vector3(8, 0.3, -276), new THREE.Vector3(0.2, 0.22, 0.2));
    new Prop(this, 'sandbag', 7, sandbagMesh(), new THREE.Vector3(-17, 0.3, -280), new THREE.Vector3(0.28, 0.17, 0.22));

    // Catacomb seal (needs the Sun-Disc)
    const sealMesh = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.6, 28), m.stone);
    disc.rotation.x = Math.PI / 2;
    const socket = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 6, 20), m.darkStone);
    socket.position.z = 0.32;
    sealMesh.add(disc, socket);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const ray = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.08), m.darkStone);
      ray.position.set(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0.32); ray.rotation.z = a + Math.PI / 2;
      sealMesh.add(ray);
    }
    this.seal = new Mover(this, new THREE.Vector3(4.6, 4.6, 0.6), { pos: new THREE.Vector3(0, 2.45, -285.7) }, { pos: new THREE.Vector3(-5.2, 2.45, -285.7), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 2.1)) }, m.stone, 0.3, false, sealMesh);
    this.seal.onArrive = () => G.nav.setBlocked(new THREE.Box3(new THREE.Vector3(-2.5, -1, -287), new THREE.Vector3(2.5, 5, -284.5)), false);
    this.interactables.push({
      pos: new THREE.Vector3(0, 1.6, -285), radius: 3,
      label: () => (G.flags.sealOpen ? null : G.satchel.has('sundisc') ? 'Set the Sun-Disc into the seal' : 'A great stone seal with a sun-shaped socket. (It needs a Sun-Disc)'),
      act: () => {
        if (!G.satchel.has('sundisc')) { G.audio.denied(); G.toast('Find the Sun-Disc. The sundial in the courtyard hides it.'); return; }
        G.satchel.takeType('sundisc');
        G.setFlag('sealOpen');
        this.seal.setOpen(true);
        G.audio.rumble(0.8, 3);
        G.toast('The disc clicks into place. The seal rolls aside, revealing stairs into darkness.', 4);
      },
    });

    loot(this, 'B', 14, 0.02, -240, rnd);
    loot(this, 'B', -17, 0.02, -270, rnd);
    loot(this, 'B', 12, 0.02, -281, rnd);
  }

  startCollapse() {
    if (this.collapseStarted) return;
    this.collapseStarted = true;
    this.debris.collapse = 28;
    G.audio.rumble(1.2, 5);
    G.toast('The whole sanctum shudders. It\'s coming down! GET OUT!', 4);
    for (let i = 0; i < 5; i++) this.debris.spawnNear(G.player.position, 6);
  }

  trapFired() {
    G.toast('CLICK. Something heavy rolls loose behind the altar!', 3);
    this.boulder.release();
    for (let i = 0; i < 6; i++) this.debris.spawnNear(G.player.position, 4);
  }

  update(dt: number) {
    super.update(dt);
    const s = G.sky.sunVec;
    const mat = this.beam.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.max(0, Math.min(0.1, s.y * 0.15)) * G.sky.exposure;
    this.beam.visible = mat.opacity > 0.005;
    // Lean the beam along the sun direction
    this.beam.position.set(IDOL_POS.x + s.x * 6 / Math.max(0.3, s.y), 7.2, IDOL_POS.z + s.z * 6 / Math.max(0.3, s.y));
    this.beam.lookAt(IDOL_POS.x, 1, IDOL_POS.z);
    this.beam.rotateX(Math.PI / 2);
  }
}
