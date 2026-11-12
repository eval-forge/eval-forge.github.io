import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G } from '../core/ctx';
import { R } from '../core/Physics';
import { Crumbler, DartLauncher, PressurePlate, sunTileShouldCrumble, UnstableCeiling } from '../logic/traps';
import type { SceneChunk, Entity } from '../world/SceneChunk';
import { materials } from '../world/textures';

/** Distance from point p to segment ab. */
function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a), ap = p.clone().sub(a);
  const t = Math.max(0, Math.min(1, ap.dot(ab) / Math.max(1e-6, ab.lengthSq())));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

/** Distance from the player's capsule axis to a point. */
export function playerCapsuleDist(p: THREE.Vector3): number {
  const pl = G.player;
  const a = new THREE.Vector3(pl.position.x, pl.feetY + 0.35, pl.position.z);
  const b = new THREE.Vector3(pl.position.x, pl.feetY + (pl.crouching ? 0.75 : 1.45), pl.position.z);
  return segDist(p, a, b);
}

/**
 * Grid of tiles over a pit. Each tile cracks when stepped on and drops after a delay.
 * Sun tiles crumble only when they are in shadow, and respawn.
 */
export class CrumbleFloor implements Entity {
  tiles: { mesh: THREE.Mesh; body: RAPIER.RigidBody | null; crumb: Crumbler; pos: THREE.Vector3; sunlit: boolean; fallT: number }[] = [];
  private sunTimer = 0;
  constructor(public chunk: SceneChunk, origin: THREE.Vector3, nx: number, nz: number, public size: number, public opts: { delay?: number; respawn?: number; sun?: boolean; mat?: THREE.Material } = {}) {
    const geo = new THREE.BoxGeometry(size * 0.96, 0.3, size * 0.96);
    const mat = opts.mat ?? (opts.sun ? materials().sunTile : materials().crackedStone);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const pos = new THREE.Vector3(origin.x + (i + 0.5) * size, origin.y - 0.15, origin.z - (j + 0.5) * size);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.dynamic = true;
      chunk.group.add(mesh);
      this.tiles.push({ mesh, body: null, crumb: new Crumbler((opts.delay ?? 0.6) + ((i * 7 + j * 3) % 5) * 0.05, opts.respawn ?? 0), pos, sunlit: true, fallT: 0 });
    }
    chunk.entities.push(this);
  }

  private makeBody(t: CrumbleFloor['tiles'][number]) {
    const body = G.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(t.pos.x, t.pos.y, t.pos.z));
    const c = G.physics.world.createCollider(R.ColliderDesc.cuboid(this.size * 0.5, 0.15, this.size * 0.5).setFriction(0.9), body);
    G.physics.tag(c, { kind: 'tile', ref: { floor: this, tile: t } });
    t.body = body;
  }

  load() {
    for (const t of this.tiles) {
      if (t.crumb.state === 'fallen') { t.mesh.visible = false; continue; }
      t.crumb.state = 'solid';
      t.mesh.position.copy(t.pos); t.mesh.rotation.set(0, 0, 0); t.mesh.visible = true;
      this.makeBody(t);
    }
  }
  unload() { for (const t of this.tiles) { if (t.body) G.physics.removeBody(t.body); t.body = null; } }

  update(dt: number) {
    const gt = G.player.groundTag;
    // Sun checks at 4 Hz
    if (this.opts.sun) {
      this.sunTimer -= dt;
      if (this.sunTimer <= 0) {
        this.sunTimer = 0.25;
        for (const t of this.tiles) {
          if (t.crumb.state !== 'solid') continue;
          const p = t.pos.clone(); p.y += 0.2;
          t.sunlit = G.sky.sunlit(p, t.body?.collider(0));
          const m = t.mesh.material as THREE.MeshStandardMaterial;
          void m;
        }
      }
    }
    for (const t of this.tiles) {
      const onIt = gt?.kind === 'tile' && (gt.ref as { tile: unknown }).tile === t;
      if (onIt) {
        if (!this.opts.sun || sunTileShouldCrumble(true, t.sunlit)) {
          if (t.crumb.state === 'solid') { G.audio.grind(0.4, t.pos); G.noise([t.pos.x, t.pos.y, t.pos.z], 0.25); }
          t.crumb.step();
        }
      }
      const ev = t.crumb.update(dt);
      if (t.crumb.state === 'cracking') t.mesh.position.set(t.pos.x + (Math.random() - 0.5) * 0.03, t.pos.y, t.pos.z + (Math.random() - 0.5) * 0.03);
      if (ev === 'fall' && t.body) {
        G.audio.snap(t.pos);
        t.body.setBodyType(R.RigidBodyType.Dynamic, true);
        t.body.setAngvel({ x: Math.random() - 0.5, y: 0, z: Math.random() - 0.5 }, true);
        t.fallT = 3;
      }
      if (t.crumb.state === 'fallen' && t.body) {
        const tr = t.body.translation(), r = t.body.rotation();
        t.mesh.position.set(tr.x, tr.y, tr.z); t.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        t.fallT -= dt;
        if (t.fallT <= 0) { G.physics.removeBody(t.body); t.body = null; t.mesh.visible = false; }
      }
      if (ev === 'respawn') {
        t.mesh.visible = true; t.mesh.position.copy(t.pos); t.mesh.quaternion.identity();
        if (!t.body) this.makeBody(t);
        G.audio.grind(0.6, t.pos);
      }
    }
  }
}

/** Pressure-plate dart corridor. */
export class DartTrap implements Entity {
  plates: { box: THREE.Box3; plate: PressurePlate; mesh: THREE.Mesh }[] = [];
  launchers: { pos: THREE.Vector3; dir: THREE.Vector3; l: DartLauncher }[] = [];
  darts: { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; life: number }[] = [];
  private dartGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4).rotateX(Math.PI / 2);
  private dartMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.8 });
  constructor(public chunk: SceneChunk, public damage = 22) { chunk.entities.push(this); }

  addPlate(x: number, y: number, z: number, w = 1, d = 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.95, 0.06, d * 0.95), materials().crackedStone);
    mesh.position.set(x, y + 0.03, z);
    mesh.receiveShadow = true;
    mesh.userData.dynamic = true;
    this.chunk.group.add(mesh);
    this.plates.push({ box: new THREE.Box3(new THREE.Vector3(x - w / 2, y - 0.5, z - d / 2), new THREE.Vector3(x + w / 2, y + 0.6, z + d / 2)), plate: new PressurePlate(1), mesh });
  }
  addLauncher(pos: THREE.Vector3, dir: THREE.Vector3) {
    this.launchers.push({ pos, dir: dir.clone().normalize(), l: new DartLauncher(1.4) });
    // wall hole
    this.chunk.b.deco(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 6).rotateZ(Math.PI / 2), pos.x, pos.y, pos.z, materials().iron, 0, 1, false);
  }
  fire() {
    for (const L of this.launchers) {
      if (!L.l.trigger()) continue;
      const m = new THREE.Mesh(this.dartGeo, this.dartMat);
      m.position.copy(L.pos);
      m.lookAt(L.pos.clone().add(L.dir));
      G.scene.add(m);
      this.darts.push({ mesh: m, pos: L.pos.clone(), vel: L.dir.clone().multiplyScalar(22), life: 2 });
      G.audio.dartFire(L.pos);
    }
  }
  load() {}
  unload() { for (const d of this.darts) G.scene.remove(d.mesh); this.darts = []; }
  update(dt: number) {
    for (const L of this.launchers) L.l.update(dt);
    const p = new THREE.Vector3(G.player.position.x, G.player.feetY + 0.1, G.player.position.z);
    for (const pl of this.plates) {
      const inside = pl.box.containsPoint(p) && G.player.grounded;
      if (pl.plate.update(inside ? 80 : 0)) { G.audio.grind(0.2); this.fire(); }
      pl.mesh.position.y = pl.box.min.y + 0.5 + (pl.plate.pressed ? -0.02 : 0.03);
    }
    for (const d of this.darts) {
      const step = d.vel.clone().multiplyScalar(dt);
      const next = d.pos.clone().add(step);
      // hit player?
      const pd = Math.min(playerCapsuleDist(next), playerCapsuleDist(d.pos));
      if (pd < 0.4 && d.life > 0) {
        d.life = 0;
        G.damage(this.damage, 'dart');
        G.player.knock.add(d.vel.clone().setY(0).normalize().multiplyScalar(2));
      }
      // hit wall?
      const hit = G.physics.ray(d.pos.x, d.pos.y, d.pos.z, step.x, step.y, step.z, 1, G.player.collider);
      if (hit && hit.toi < 1 && d.life > 0) { d.life = Math.min(d.life, 0.8); d.vel.set(0, 0, 0); }
      d.pos.add(step.normalize().multiplyScalar(d.vel.length() * dt));
      d.mesh.position.copy(d.pos);
      d.life -= dt;
    }
    for (const d of this.darts) if (d.life <= 0) G.scene.remove(d.mesh);
    this.darts = this.darts.filter((d) => d.life > 0);
  }
}

/** Swinging pendulum blade. */
export class Blade implements Entity {
  body: RAPIER.RigidBody | null = null;
  group = new THREE.Group();
  blade: THREE.Mesh;
  private cool = 0;
  private lastWhoosh = 0;
  constructor(public chunk: SceneChunk, public pivot: THREE.Vector3, public length: number, public axis: 'x' | 'z', public phase = 0, public period = 2.4, public amp = 1.1) {
    const mats = materials();
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, length, 6), mats.iron);
    arm.position.y = -length / 2;
    this.blade = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.05, 20, 1, false, 0, Math.PI), mats.iron);
    this.blade.rotation.set(Math.PI / 2, 0, axis === 'x' ? 0 : Math.PI / 2);
    this.blade.position.y = -length;
    if (axis === 'z') this.blade.rotation.set(0, 0, Math.PI / 2);
    this.blade.rotation.set(Math.PI / 2, axis === 'x' ? Math.PI / 2 : 0, 0);
    this.blade.castShadow = true; arm.castShadow = true;
    this.group.add(arm, this.blade);
    this.group.position.copy(pivot);
    this.group.userData.dynamic = true;
    chunk.group.add(this.group);
    chunk.entities.push(this);
  }
  angle(t: number) { return Math.sin((t / this.period) * Math.PI * 2 + this.phase) * this.amp; }
  load() {
    this.body = G.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pivot.x, this.pivot.y, this.pivot.z));
    const c = G.physics.world.createCollider(R.ColliderDesc.cuboid(this.axis === 'x' ? 0.03 : 0.7, 0.35, this.axis === 'x' ? 0.7 : 0.03).setTranslation(0, -this.length + 0.2, 0).setSensor(true), this.body);
    G.physics.tag(c, { kind: 'blade', ref: this });
  }
  unload() { G.physics.removeBody(this.body); this.body = null; }
  update(dt: number) {
    const a = this.angle(G.time);
    // swing across the corridor: rotate around the corridor's length axis
    if (this.axis === 'x') this.group.rotation.set(0, 0, a); else this.group.rotation.set(a, 0, 0);
    if (this.body) {
      const q = new THREE.Quaternion().setFromEuler(this.group.rotation);
      this.body.setNextKinematicRotation(q);
    }
    this.cool -= dt;
    const bladePos = new THREE.Vector3(0, -this.length + 0.1, 0).applyEuler(this.group.rotation).add(this.pivot);
    const d = playerCapsuleDist(bladePos);
    if (d < 0.75 && this.cool <= 0) {
      this.cool = 1.0;
      G.damage(38, 'blade');
      const push = new THREE.Vector3(G.player.position.x - this.pivot.x, 0, G.player.position.z - this.pivot.z);
      if (this.axis === 'x') push.set(Math.sign(Math.cos(G.time)) * 4, 0, 0); else push.set(0, 0, Math.sign(push.z || 1) * 4);
      G.player.knock.add(push);
    }
    const da = Math.abs(a);
    if (da < 0.1 && G.time - this.lastWhoosh > 0.5 && G.player.position.distanceTo(this.pivot) < 18) { this.lastWhoosh = G.time; G.audio.whoosh(bladePos); }
  }
}

/** Rolling boulder released by a plate or event. */
export class Boulder implements Entity {
  body: RAPIER.RigidBody | null = null;
  mesh: THREE.Mesh;
  released = false;
  done = false;
  pos: THREE.Vector3;
  private thudT = 0;
  constructor(public chunk: SceneChunk, start: THREE.Vector3, public radius: number, public push: THREE.Vector3) {
    this.pos = start.clone();
    const geo = new THREE.IcosahedronGeometry(radius, 2);
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); v.multiplyScalar(0.92 + Math.random() * 0.12); p.setXYZ(i, v.x, v.y, v.z); }
    geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, materials().cave);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.position.copy(start);
    this.mesh.userData.dynamic = true;
    chunk.group.add(this.mesh);
    chunk.entities.push(this);
  }
  load() {
    const bd = this.released ? R.RigidBodyDesc.dynamic() : R.RigidBodyDesc.kinematicPositionBased();
    this.body = G.physics.world.createRigidBody(bd.setTranslation(this.pos.x, this.pos.y, this.pos.z).setCcdEnabled(true));
    const c = G.physics.world.createCollider(R.ColliderDesc.ball(this.radius).setDensity(2600).setFriction(0.9).setRestitution(0.05), this.body);
    G.physics.tag(c, { kind: 'boulder', ref: this });
  }
  unload() {
    if (this.body) { const t = this.body.translation(); this.pos.set(t.x, t.y, t.z); }
    G.physics.removeBody(this.body); this.body = null;
  }
  release() {
    if (this.released || !this.body) return;
    this.released = true;
    this.body.setBodyType(R.RigidBodyType.Dynamic, true);
    this.body.setLinvel({ x: this.push.x, y: this.push.y, z: this.push.z }, true);
    G.audio.rumble(1, 2.5);
    G.audio.grind(1.5, this.pos);
    G.noise([this.pos.x, this.pos.y, this.pos.z], 1);
    G.toast('A boulder breaks loose! RUN!');
  }
  update(dt: number) {
    if (!this.body) return;
    const t = this.body.translation(), r = this.body.rotation();
    this.pos.set(t.x, t.y, t.z);
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    if (!this.released || this.done) return;
    const v = this.body.linvel();
    const sp = Math.hypot(v.x, v.z);
    this.thudT -= dt;
    if (sp > 1 && this.thudT <= 0) { this.thudT = 0.35; G.audio.thud(this.pos, Math.min(1, sp / 6)); }
    if (sp > 1.5 && playerCapsuleDist(this.pos) < this.radius + 0.3) G.damage(100, 'boulder');
    if (sp < 0.2 && this.thudT < -3) this.done = true;
  }
}

/** Falling ceiling debris that accumulates with noise (sanctum). */
export class DebrisField implements Entity {
  ceiling = new UnstableCeiling(1.0, 0.18);
  rocks: { body: RAPIER.RigidBody | null; mesh: THREE.Mesh; life: number; hit: boolean }[] = [];
  collapse = 0;
  private spawnT = 0;
  constructor(public chunk: SceneChunk, public area: THREE.Box3, public ceilingY: number) { chunk.entities.push(this); }
  load() {}
  unload() { for (const r of this.rocks) { G.physics.removeBody(r.body); this.chunk.group.remove(r.mesh); } this.rocks = []; }

  /** Hear a noise; if it is inside the area, it may bring debris down. */
  hear(pos: [number, number, number], loud: number) {
    if (!this.area.containsPoint(new THREE.Vector3(...pos))) return;
    if (this.ceiling.addNoise(loud * 0.5)) {
      G.toast('Dust trickles down... the ceiling is unstable. Keep quiet!', 2.5);
      for (let i = 0; i < 3; i++) this.spawnNear(G.player.position, 3.5);
      G.audio.rumble(0.5, 1.5);
    }
  }
  spawnNear(p: THREE.Vector3, spread: number) {
    if (this.rocks.length > 18) return;
    const x = THREE.MathUtils.clamp(p.x + (Math.random() - 0.5) * spread * 2, this.area.min.x + 1, this.area.max.x - 1);
    const z = THREE.MathUtils.clamp(p.z + (Math.random() - 0.5) * spread * 2, this.area.min.z + 1, this.area.max.z - 1);
    const s = 0.25 + Math.random() * 0.5;
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), materials().stone);
    mesh.castShadow = true;
    mesh.userData.dynamic = true;
    this.chunk.group.add(mesh);
    const body = G.physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, this.ceilingY - 0.5, z).setAngvel({ x: Math.random() * 3, y: Math.random() * 3, z: Math.random() * 3 }).setCcdEnabled(true));
    const c = G.physics.world.createCollider(R.ColliderDesc.ball(s * 0.9).setDensity(2400), body);
    G.physics.tag(c, { kind: 'debris' });
    this.rocks.push({ body, mesh, life: 12, hit: false });
  }
  update(dt: number) {
    this.ceiling.update(dt);
    if (this.collapse > 0) {
      this.collapse -= dt;
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = 0.25 + Math.random() * 0.5;
        if (this.area.containsPoint(G.player.position)) this.spawnNear(G.player.position, 6);
        else this.spawnNear(this.area.getCenter(new THREE.Vector3()), 12);
        if (Math.random() < 0.3) G.audio.rumble(0.4, 1);
      }
    }
    for (const r of this.rocks) {
      if (!r.body) continue;
      const t = r.body.translation(), q = r.body.rotation();
      r.mesh.position.set(t.x, t.y, t.z); r.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      const v = r.body.linvel();
      if (!r.hit && v.y < -4 && playerCapsuleDist(r.mesh.position) < 0.8) { r.hit = true; G.damage(28, 'debris'); }
      if (!r.hit && v.y > -1 && t.y < this.ceilingY - 2) { r.hit = true; G.audio.thud(r.mesh.position, 0.6); }
      r.life -= dt;
      if (r.life <= 0) { G.physics.removeBody(r.body); r.body = null; this.chunk.group.remove(r.mesh); }
    }
    this.rocks = this.rocks.filter((r) => r.body);
  }
}
