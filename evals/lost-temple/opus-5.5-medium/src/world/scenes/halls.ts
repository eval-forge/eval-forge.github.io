import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { SceneChunk, Entity } from '../SceneChunk';
import { materials } from '../textures';
import { mulberry32 } from '../../logic/rng';
import { G } from '../../core/ctx';
import { R } from '../../core/Physics';
import { loot, pillar, rubble, slab, vines, wallX, wallZ, pickup, skeleton } from './common';
import { Mover, CrackedWall } from '../../entities/Door';
import { CrumbleFloor } from '../../entities/Traps';
import { PressurePlate } from '../../logic/traps';

/** Heavy stone block you push onto the pressure plate. */
class PushBlock implements Entity {
  body: RAPIER.RigidBody | null = null;
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  quat = new THREE.Quaternion();
  pushing = 0;
  private grindT = 0;
  constructor(public chunk: SceneChunk, pos: THREE.Vector3, public size = 1.6) {
    this.pos = pos.clone();
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), materials().stone);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.userData.dynamic = true;
    chunk.group.add(this.mesh);
    chunk.entities.push(this);
    chunk.interactables.push({ pos: this.pos, radius: 2.2, label: () => (this.body ? 'Heavy block: walk into it to push it' : null), act: () => {} });
  }
  load() {
    this.body = G.physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(this.pos.x, this.pos.y, this.pos.z).setRotation(this.quat).setLinearDamping(4).setAngularDamping(8).enabledRotations(false, false, false));
    const c = G.physics.world.createCollider(R.ColliderDesc.cuboid(this.size / 2, this.size / 2, this.size / 2).setDensity(350 / (this.size ** 3)).setFriction(0.4), this.body);
    G.physics.tag(c, { kind: 'pushable', ref: this });
  }
  unload() {
    if (this.body) { const t = this.body.translation(), r = this.body.rotation(); this.pos.set(t.x, t.y, t.z); this.quat.set(r.x, r.y, r.z, r.w); }
    G.physics.removeBody(this.body); this.body = null;
  }
  update(dt: number) {
    if (!this.body) return;
    const t = this.body.translation(), r = this.body.rotation();
    this.pos.set(t.x, t.y, t.z);
    this.mesh.position.copy(this.pos); this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    if (this.pushing > 0) {
      this.pushing -= dt;
      this.grindT -= dt;
      if (this.grindT <= 0) { this.grindT = 0.8; G.audio.grind(0.8, this.pos); G.noise([t.x, t.y, t.z], 0.45); }
    }
  }
}

export class Halls extends SceneChunk {
  id = 'halls' as const;
  zone = 'B' as const;
  name = 'Broken Halls';
  gate!: Mover;
  block!: PushBlock;
  plate = new PressurePlate(1, true);
  plateBox = new THREE.Box3(new THREE.Vector3(4.6, -0.5, -229.4), new THREE.Vector3(7.4, 2, -226.6));
  plateMesh!: THREE.Mesh;
  sunTiles!: CrumbleFloor;
  wall!: CrackedWall;

  build() {
    const m = materials();
    const rnd = mulberry32(G.seed ^ 0x4444);
    this.bounds.set(new THREE.Vector3(-20, -8, -236), new THREE.Vector3(20, 12, -176));
    this.areas = [new THREE.Box3(new THREE.Vector3(-19, -8, -235), new THREE.Vector3(18.5, 14, -175))];
    this.navRegions = [
      { min: new THREE.Vector3(-18, -1, -235), max: new THREE.Vector3(18, 5, -178) },
      { min: new THREE.Vector3(-18, -7, -213.5), max: new THREE.Vector3(18, -1.2, -198.5) },
    ];
    this.killY = -30;
    this.neighbours = ['courtyard', 'sanctum'];

    // Floors with the pit between z -198 and -214
    slab(this.b, -18, 18, -178, -198, 0, m.plaza, 1);
    slab(this.b, -18, 18, -214, -235, 0, m.plaza, 1);
    this.b.box(36, 6, 1, 0, -3, -198.5 + 0.0, m.darkStone, { cast: false });
    this.b.box(36, 6, 1, 0, -3, -213.5, m.darkStone, { cast: false });
    slab(this.b, -18, 18, -198, -214, -6, m.darkStone, 1);
    rubble(this, -6, -6, -206, 10, 14, rnd, m.darkStone);
    skeleton(this, 9, -6, -204, 1.2);
    // Walls
    wallX(this.b, -18.5, -178, -235, -6, 15, 1, m.mossStone);
    wallX(this.b, 18.5, -178, -235, -6, 15, 1, m.mossStone, [{ a: -188, b: -192, h: 3.5 + 6 }]);
    wallZ(this.b, -235.5, -19, 19, 0, 9, 1, m.mossStone, [{ a: -2, b: 2, h: 4.5 }]);

    // Roof with collapsed sections: the sun reaches the floor through the gaps
    const holes = new Set<string>();
    for (let i = 0; i < 9; i++) for (let j = 0; j < 14; j++) {
      const zc = -180 - j * 4;
      const overPit = zc < -196 && zc > -216;
      if (rnd() < (overPit ? 0.55 : 0.4)) holes.add(i + ',' + j);
    }
    for (let i = 0; i < 9; i++) for (let j = 0; j < 14; j++) {
      if (holes.has(i + ',' + j)) continue;
      const x = -16 + i * 4, z = -180 - j * 4;
      this.b.box(4, 0.9, 4, x, 9.45, z, m.mossStone);
    }
    // fallen roof slabs
    this.b.box(4, 0.9, 4, -12, 0.9, -186, m.mossStone, { rotZ: 0.35, rotY: 0.4 });
    this.b.box(4, 0.9, 4, 13, 0.6, -230, m.mossStone, { rotX: 0.25, rotY: -0.3 });
    // Pillars
    for (const z of [-184, -192, -220, -230]) for (const x of [-11, 11]) pillar(this.b, x, z, 0, 9, m.stone, 0.65, rnd() < 0.2);

    // Sun tiles across the pit: safe only while sunlit
    this.sunTiles = new CrumbleFloor(this, new THREE.Vector3(-9, 0, -198), 9, 8, 2, { sun: true, delay: 0.55, respawn: 6 });
    // invisible lip so you can't walk off the tile edges into the side void too easily
    // Climb out of the pit
    this.climbs.push(vines(this, -14, -12, -198.95, -198.95, -6, 0.3));
    this.climbs.push(vines(this, 12, 14, -198.95, -198.95, -6, 0.3));
    this.climbs.push(vines(this, -14, -12, -213.05, -213.05, -6, 0.3));

    // Push-block puzzle
    this.block = new PushBlock(this, new THREE.Vector3(-5, 0.81, -222));
    this.plateMesh = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 2.6), m.crackedStone);
    this.plateMesh.position.set(6, 0.06, -228);
    this.plateMesh.receiveShadow = true;
    this.plateMesh.userData.dynamic = true;
    this.group.add(this.plateMesh);
    this.gate = new Mover(this, new THREE.Vector3(4, 4.5, 0.4), { pos: new THREE.Vector3(0, 2.25, -235.5) }, { pos: new THREE.Vector3(0, 6.6, -235.5) }, m.iron, 0.6);
    this.gate.onArrive = () => G.nav.setBlocked(new THREE.Box3(new THREE.Vector3(-2, -1, -236.5), new THREE.Vector3(2, 4, -234.5)), this.gate.t < 0.5);

    // Cracked wall (kick from the tunnel side only)
    this.wall = new CrackedWall(this, new THREE.Vector3(18.5, 1.75, -190), new THREE.Vector3(1, 3.5, 4), (p) => p.x > 18.6, () => G.setFlag('wallKicked'));

    // Loot
    loot(this, 'B', -16, 0.02, -181, rnd);
    loot(this, 'B', 15.5, 0.02, -224, rnd);
    loot(this, 'B', 2, -5.98, -207, rnd);
    loot(this, 'B', -15.5, 0.02, -231, rnd);
    pickup(this, 'torch', -16.5, 0.02, -194);
    this.addSconce(-17.9, 2.2, -222, Math.PI / 2);
    this.addSconce(17.9, 2.2, -182, -Math.PI / 2);
    this.addSconce(-17.9, 2.2, -186, Math.PI / 2);
  }

  update(dt: number) {
    super.update(dt);
    const inside = this.plateBox.containsPoint(this.block.pos);
    if (this.plate.update(inside ? 350 : 0)) {
      this.plateMesh.position.y = 0.0;
      G.audio.grind(1.2);
      this.gate.setOpen(true);
      G.setFlag('hallsGateOpen');
      G.toast('The plate sinks with a heavy clunk. The inner gate rises!', 3);
    }
  }
}
