import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G } from '../core/ctx';
import { R } from '../core/Physics';
import type { SceneChunk, Entity } from '../world/SceneChunk';
import { materials } from '../world/textures';

/**
 * A kinematic slab that moves between a closed and an open transform:
 * portcullis gates, the great door, the catacomb seal, drawbridges.
 */
export class Mover implements Entity {
  body: RAPIER.RigidBody | null = null;
  mesh: THREE.Object3D;
  t = 0; // 0 closed, 1 open
  target = 0;
  moving = false;
  /** Externally driven movers (the temple door) stay kinematic. */
  alwaysKinematic = false;
  onArrive?: () => void;
  constructor(public chunk: SceneChunk, public size: THREE.Vector3, public closed: { pos: THREE.Vector3; quat?: THREE.Quaternion }, public open: { pos: THREE.Vector3; quat?: THREE.Quaternion }, mat: THREE.Material, public speed = 0.5, startOpen = false, mesh?: THREE.Object3D) {
    this.mesh = mesh ?? new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
    this.mesh.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    this.mesh.userData.dynamic = true;
    this.t = this.target = startOpen ? 1 : 0;
    this.apply();
    chunk.group.add(this.mesh);
    chunk.entities.push(this);
  }
  transformAt(t: number): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const pos = this.closed.pos.clone().lerp(this.open.pos, t);
    const q0 = this.closed.quat ?? new THREE.Quaternion(), q1 = this.open.quat ?? new THREE.Quaternion();
    return { pos, quat: q0.clone().slerp(q1, t) };
  }
  apply() {
    const { pos, quat } = this.transformAt(this.t);
    this.mesh.position.copy(pos);
    this.mesh.quaternion.copy(quat);
    if (this.body) {
      // Kinematic while moving, fixed while at rest: Rapier's character controller
      // snags on resting kinematic boxes, but slides cleanly over fixed ones.
      const atRest = !this.alwaysKinematic && this.t === this.target;
      const want = atRest ? R.RigidBodyType.Fixed : R.RigidBodyType.KinematicPositionBased;
      if (this.body.bodyType() !== want) this.body.setBodyType(want, true);
      if (atRest) { this.body.setTranslation(pos, false); this.body.setRotation(quat, false); }
      else { this.body.setNextKinematicTranslation(pos); this.body.setNextKinematicRotation(quat); }
    }
  }
  load() {
    const { pos, quat } = this.transformAt(this.t);
    this.body = G.physics.world.createRigidBody((this.t === this.target && !this.alwaysKinematic ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.kinematicPositionBased()).setTranslation(pos.x, pos.y, pos.z).setRotation(quat));
    const c = G.physics.world.createCollider(R.ColliderDesc.cuboid(this.size.x / 2, this.size.y / 2, this.size.z / 2).setFriction(0.8), this.body);
    G.physics.tag(c, { kind: 'gate', ref: this });
  }
  unload() { G.physics.removeBody(this.body); this.body = null; }
  setOpen(open: boolean) { this.target = open ? 1 : 0; }
  update(dt: number) {
    if (this.t !== this.target) {
      const d = Math.sign(this.target - this.t) * this.speed * dt;
      this.t = Math.abs(this.target - this.t) <= Math.abs(d) ? this.target : this.t + d;
      if (!this.moving) { this.moving = true; G.audio.grind(Math.min(3, 1 / this.speed), this.mesh.position); }
      if (this.t === this.target) { this.moving = false; G.audio.thud(this.mesh.position, 0.8); this.onArrive?.(); }
    }
    if (this.alwaysKinematic || this.t !== this.target || this.moving || this.body?.bodyType() !== R.RigidBodyType.Fixed) this.apply();
  }
  /** Update even when the chunk is unloaded (timers). */
  tick(dt: number) { if (!this.body) { if (this.t !== this.target) { const d = Math.sign(this.target - this.t) * this.speed * dt; this.t = Math.abs(this.target - this.t) <= Math.abs(d) ? this.target : this.t + d; } this.apply(); } }
}

/** Drawbridge: rotates around a hinge from vertical (raised) to horizontal (lowered). */
export class Drawbridge extends Mover {
  constructor(chunk: SceneChunk, public hinge: THREE.Vector3, public length: number, public width: number, public dirToFar: THREE.Vector3) {
    super(chunk, new THREE.Vector3(width, 0.3, length), { pos: hinge.clone() }, { pos: hinge.clone() }, materials().wood, 0.35);
  }
  transformAt(t: number) {
    const dir = (this.dirToFar ?? new THREE.Vector3(0, 0, 1)).clone().normalize();
    const angle = (1 - t) * (Math.PI / 2) * 0.98; // 0 = lowered
    const axis = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    // Lowered: plank extends along dir. Raised: rotates up around the hinge axis.
    const base = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const raise = new THREE.Quaternion().setFromAxisAngle(axis, -angle);
    const quat = raise.clone().multiply(base);
    const center = new THREE.Vector3(0, 0, (this.length ?? 1) / 2).applyQuaternion(quat).add(this.hinge ?? new THREE.Vector3());
    return { pos: center, quat };
  }
}

/** A lever you pull with E. */
export class Lever implements Entity {
  handle: THREE.Mesh;
  pulled = false;
  constructor(public chunk: SceneChunk, public pos: THREE.Vector3, rotY: number, public label: string, public onPull: () => void, public canPull: () => boolean = () => true) {
    const m = materials();
    chunk.b.box(0.5, 0.6, 0.3, pos.x, pos.y + 0.3, pos.z, m.darkStone, { rotY });
    this.handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), m.iron);
    this.handle.geometry.translate(0, 0.45, 0);
    this.handle.position.set(pos.x, pos.y + 0.55, pos.z);
    this.handle.rotation.set(0, rotY, -0.6);
    this.handle.castShadow = true;
    this.handle.userData.dynamic = true;
    chunk.group.add(this.handle);
    chunk.interactables.push({ pos: new THREE.Vector3(pos.x, pos.y + 0.9, pos.z), radius: 2, label: () => (this.pulled || !this.canPull() ? null : label), act: () => this.pull() });
    chunk.entities.push(this);
  }
  pull() {
    if (this.pulled) return;
    this.pulled = true;
    this.handle.rotation.z = 0.6;
    G.audio.lever(this.pos);
    this.onPull();
  }
  load() {}
  unload() {}
}

/** A cracked wall that can be kicked down from one side only. */
export class CrackedWall implements Entity {
  broken = false;
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody | null = null;
  chunks: { body: RAPIER.RigidBody | null; mesh: THREE.Mesh; life: number }[] = [];
  constructor(public chunk: SceneChunk, public center: THREE.Vector3, public size: THREE.Vector3, public kickSide: (p: THREE.Vector3) => boolean, public onBreak: () => void) {
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), materials().crackedStone);
    this.mesh.position.copy(center);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.userData.dynamic = true;
    chunk.group.add(this.mesh);
    chunk.interactables.push({ pos: center, radius: 2.4, label: () => (this.broken ? null : this.kickSide(G.player.position) ? 'Kick down the cracked wall' : null), act: () => this.kick() });
    chunk.entities.push(this);
  }
  load() {
    if (this.broken) return;
    this.body = G.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(this.center.x, this.center.y, this.center.z));
    G.physics.tag(G.physics.world.createCollider(R.ColliderDesc.cuboid(this.size.x / 2, this.size.y / 2, this.size.z / 2), this.body), { kind: 'static' });
  }
  unload() { G.physics.removeBody(this.body); this.body = null; for (const c of this.chunks) { G.physics.removeBody(c.body); this.chunk.group.remove(c.mesh); } this.chunks = []; }
  kick() {
    if (this.broken) return;
    this.broken = true;
    G.physics.removeBody(this.body); this.body = null;
    this.mesh.visible = false;
    G.audio.thud(this.center, 1.5); G.audio.rumble(0.6, 1.5);
    G.noise([this.center.x, this.center.y, this.center.z], 1);
    const away = new THREE.Vector3().subVectors(this.center, G.player.position).setY(0).normalize();
    for (let i = 0; i < 10; i++) {
      const s = 0.3 + Math.random() * 0.35;
      const p = this.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * this.size.x, (Math.random() - 0.5) * this.size.y, (Math.random() - 0.5) * this.size.z));
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), materials().crackedStone);
      mesh.castShadow = true; mesh.userData.dynamic = true;
      this.chunk.group.add(mesh);
      const body = G.physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setLinvel(away.x * 4 + Math.random(), 1, away.z * 4 + Math.random()));
      G.physics.tag(G.physics.world.createCollider(R.ColliderDesc.cuboid(s / 2, s / 2, s / 2).setDensity(1500), body), { kind: 'debris' });
      this.chunks.push({ body, mesh, life: 6 });
    }
    this.onBreak();
  }
  update(dt: number) {
    for (const c of this.chunks) {
      if (!c.body) continue;
      const t = c.body.translation(), q = c.body.rotation();
      c.mesh.position.set(t.x, t.y, t.z); c.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      c.life -= dt;
      if (c.life <= 0) { G.physics.removeBody(c.body); c.body = null; }
    }
  }
}
