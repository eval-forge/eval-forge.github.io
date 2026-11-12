/** Physics set pieces: plank bridges, crumbling floors, the boulder, blades, darts, falling debris, wind. */
import * as THREE from 'three';
import { clamp, clamp01 } from '../../core/rng';
import type { Vec3Like } from '../../core/scenes';
import { CrackTimer, DAMAGE, DartTrigger, OneShot } from '../../core/traps';
import { GROUPS, RAPIER, RAY } from '../../engine/physics';
import type { Game } from '../../game/game';
import { removeFrom, type Entity, type WindSource } from '../registry';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _zero = new THREE.Vector3(0, 0, 0);

// ---------------------------------------------------------------------------
// Plank bridge
// ---------------------------------------------------------------------------

export interface BridgeOpts {
  planks: number;
  width: number;
  /** Seconds a plank survives once stood on. */
  crackDelay: number;
  /** If given, only these planks are rotten; the rest hold. */
  rotten?: number[];
  /** Cut the near end loose once the player is across (the jungle bridge). */
  snapWhenCrossed?: boolean;
  dark: boolean;
}

/**
 * Take a collider out of the world for good. Disabling alone is not enough:
 * the character controller's shape casts still land on a disabled collider,
 * so it also loses every collision group.
 */
function knockOut(col: RAPIER.Collider): void {
  col.setEnabled(false);
  col.setCollisionGroups(0);
}

/**
 * A chain of dynamic segments joined edge to edge with revolute joints and
 * pinned to both banks. Each segment carries a plank; a plank that has been
 * stood on cracks, then drops out of the frame.
 */
export class PlankBridge implements Entity {
  private readonly bodies: RAPIER.RigidBody[] = [];
  private readonly colliders: RAPIER.Collider[] = [];
  private readonly joints: RAPIER.ImpulseJoint[] = [];
  private readonly anchor: RAPIER.RigidBody;
  private readonly timers: CrackTimer[] = [];
  private readonly planks: THREE.InstancedMesh;
  private readonly rails: THREE.InstancedMesh;
  private readonly falling: { body: RAPIER.RigidBody; mesh: THREE.Mesh; t: number }[] = [];
  private readonly segLen: number;
  private readonly dir = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private snapped = false;
  private touched = false;
  private readonly snap = new OneShot(0.6);
  private creakT = 0;
  private gone = false;

  constructor(
    private readonly game: Game,
    private readonly parent: THREE.Object3D,
    private readonly key: string,
    private readonly a: Vec3Like,
    private readonly b: Vec3Like,
    private readonly o: BridgeOpts,
  ) {
    const w = game.physics.world;
    const n = o.planks;
    this.dir.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const span = this.dir.length();
    this.dir.normalize();
    this.side.set(-this.dir.z, 0, this.dir.x).normalize();
    this.segLen = span / n;
    const L = this.segLen;
    const saved = game.run.get<{ broken: number[]; snapped: boolean } | null>(key, null);
    // The anchor shares the span's orientation so one joint axis (local X) is valid in both frames.
    const yaw0 = Math.atan2(this.dir.x, this.dir.z);
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw0);
    this.anchor = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(a.x, a.y, a.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }));

    // Visuals: one instanced draw for planks, one for the rope rails.
    const plankGeo = new THREE.BoxGeometry(o.width, 0.09, L * 0.86);
    const railGeo = new THREE.BufferGeometry();
    {
      // Two hand ropes and two hangers per segment, merged.
      const parts: THREE.BufferGeometry[] = [];
      for (const sgn of [-1, 1]) {
        const rope = new THREE.CylinderGeometry(0.035, 0.035, L * 1.02, 5);
        rope.rotateX(Math.PI / 2);
        rope.translate((sgn * o.width) / 2, 1.0, 0);
        parts.push(rope);
        const hanger = new THREE.CylinderGeometry(0.02, 0.02, 1.0, 4);
        hanger.translate((sgn * o.width) / 2, 0.5, 0);
        parts.push(hanger);
        const under = new THREE.CylinderGeometry(0.04, 0.04, L * 1.02, 5);
        under.rotateX(Math.PI / 2);
        under.translate((sgn * o.width) / 2 * 0.92, -0.07, 0);
        parts.push(under);
      }
      const pos: number[] = [];
      const nor: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      for (const g of parts) {
        const base = pos.length / 3;
        pos.push(...(g.getAttribute('position').array as Float32Array));
        nor.push(...(g.getAttribute('normal').array as Float32Array));
        uv.push(...(g.getAttribute('uv').array as Float32Array));
        const ix = g.getIndex()!;
        for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
        g.dispose();
      }
      railGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      railGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      railGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      railGeo.setIndex(idx);
    }
    this.planks = new THREE.InstancedMesh(game.mats.prep(plankGeo, 'wood'), game.mats.get('wood', o.dark), n);
    this.rails = new THREE.InstancedMesh(railGeo, game.mats.get('rope', o.dark), n);
    for (const im of [this.planks, this.rails]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent.add(im);
    }
    if (saved?.snapped) {
      // The span is already at the bottom of the gorge.
      this.gone = true;
      this.snapped = true;
      this.planks.visible = false;
      this.rails.visible = false;
      return;
    }

    // Orientation: local +Z along the span.
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const rot = { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
    for (let i = 0; i < n; i++) {
      const c = (i + 0.5) * L;
      const body = w.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(a.x + this.dir.x * c, a.y + this.dir.y * c - 0.045, a.z + this.dir.z * c)
          .setRotation(rot)
          .setLinearDamping(0.6)
          .setAngularDamping(1.8),
      );
      const col = w.createCollider(
        RAPIER.ColliderDesc.cuboid(o.width / 2, 0.045, L * 0.47).setMass(14).setFriction(1).setCollisionGroups(GROUPS.prop),
        body,
      );
      game.physics.setMeta(col, { kind: 'plank', surface: 'wood', owner: this });
      this.bodies.push(body);
      this.colliders.push(col);
      const end = i === 0 || i === n - 1;
      const sound = o.rotten !== undefined && !o.rotten.includes(i);
      this.timers.push(new CrackTimer(o.crackDelay * (end ? 1.7 : 1), sound ? 1e9 : 30));
    }
    // Joints: revolute about the bridge's side axis (local X), at the shared edges.
    const axis = { x: 1, y: 0, z: 0 };
    const half = L / 2;
    this.joints.push(
      w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: -0.045, z: 0 }, { x: 0, y: 0, z: -half }, axis), this.anchor, this.bodies[0], true),
    );
    for (let i = 0; i < n - 1; i++) {
      this.joints.push(w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: half }, { x: 0, y: 0, z: -half }, axis), this.bodies[i], this.bodies[i + 1], true));
    }
    this.joints.push(
      w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: half }, { x: 0, y: -0.045, z: span }, axis), this.bodies[n - 1], this.anchor, true),
    );
    if (saved) for (const i of saved.broken) this.breakPlank(i, true);
    this.frame();
  }

  /** Index of the plank under a world position, or -1. */
  private plankAt(p: Vec3Like): number {
    const rx = p.x - this.a.x;
    const rz = p.z - this.a.z;
    const along = rx * this.dir.x + rz * this.dir.z;
    const across = rx * this.side.x + rz * this.side.z;
    if (Math.abs(across) > this.o.width / 2 + 0.25) return -1;
    const i = Math.floor(along / this.segLen);
    return i >= 0 && i < this.o.planks ? i : -1;
  }

  private breakPlank(i: number, silent = false): void {
    const t = this.timers[i];
    if (t.state !== 'broken') t.forceBroken();
    const col = this.colliders[i];
    if (!col.isEnabled()) return;
    knockOut(col);
    if (silent) return;
    const game = this.game;
    const body = this.bodies[i];
    const tr = body.translation();
    const rot = body.rotation();
    game.sfx('snap', tr, 1, 0.9 + Math.random() * 0.3);
    game.noise('plank', tr);
    game.particles.emit('chip', tr, 14, { spread: 0.5, color: [0.5, 0.36, 0.2] });
    // The plank itself tumbles away as a free body.
    const w = game.physics.world;
    const fb = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(tr.x, tr.y - 0.1, tr.z).setRotation(rot).setAngvel({ x: Math.random() * 4 - 2, y: Math.random() * 2 - 1, z: Math.random() * 4 - 2 }),
    );
    w.createCollider(RAPIER.ColliderDesc.cuboid(this.o.width / 2, 0.045, this.segLen * 0.43).setMass(8).setCollisionGroups(GROUPS.debris), fb);
    const mesh = new THREE.Mesh(this.planks.geometry, this.planks.material);
    mesh.userData.sharedGeometry = true;
    mesh.castShadow = true;
    this.parent.add(mesh);
    this.falling.push({ body: fb, mesh, t: 0 });
  }

  step(dt: number): void {
    if (this.gone) return;
    const game = this.game;
    const pl = game.player;
    let on = -1;
    if (pl.alive && pl.grounded) {
      const i = this.plankAt(pl.pos);
      if (i >= 0) {
        const t = this.bodies[i].translation();
        if (Math.abs(pl.pos.y - (t.y + 0.045)) < 0.5 && this.colliders[i].isEnabled()) on = i;
      }
    }
    if (on >= 0) {
      this.touched = true;
      this.creakT -= dt;
      if (this.creakT <= 0) {
        this.creakT = 0.5 + Math.random() * 0.6;
        game.sfx('creak', pl.pos, 0.6);
      }
    }
    for (let i = 0; i < this.timers.length; i++) {
      const ev = this.timers[i].update(i === on ? pl.mass : 0, dt);
      if (ev === 'cracked') {
        const t = this.bodies[i].translation();
        game.sfx('crack', t, 0.8, 1.2);
        game.particles.emit('chip', t, 5, { spread: 0.3, color: [0.5, 0.36, 0.2] });
      } else if (ev === 'broke') {
        this.breakPlank(i);
      }
    }
    // Once the player is across, the near end lets go.
    if (this.o.snapWhenCrossed && !this.snapped && this.touched) {
      const rx = pl.pos.x - this.b.x;
      const rz = pl.pos.z - this.b.z;
      if (rx * this.dir.x + rz * this.dir.z > 1.2) this.snap.trigger();
      if (this.snap.update(dt)) {
        this.snapped = true;
        game.physics.removeJoint(this.joints[0]);
        game.sfx('snap', this.a, 1, 0.6);
        game.sfx('creak', this.a, 1, 0.6);
        game.noise('plank', this.a, 1.4);
        game.toast('The bridge tears loose behind you. No going back that way.', 'bad');
      }
    }
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      if (f.t > 6) {
        game.physics.removeBody(f.body);
        f.mesh.removeFromParent();
        this.falling.splice(i, 1);
      }
    }
  }

  frame(): void {
    if (this.gone) return;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      const t = b.translation();
      const r = b.rotation();
      _p.set(t.x, t.y, t.z);
      _q.set(r.x, r.y, r.z, r.w);
      _m.compose(_p, _q, _s);
      this.rails.setMatrixAt(i, _m);
      const tm = this.timers[i];
      if (tm.state === 'broken') {
        _m.compose(_p, _q, _zero);
      } else if (tm.state === 'cracking') {
        _p.y -= tm.progress * 0.05;
        _m.compose(_p, _q, _s);
      }
      this.planks.setMatrixAt(i, _m);
    }
    this.planks.instanceMatrix.needsUpdate = true;
    this.rails.instanceMatrix.needsUpdate = true;
    for (const f of this.falling) {
      const t = f.body.translation();
      const r = f.body.rotation();
      f.mesh.position.set(t.x, t.y, t.z);
      f.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  dispose(): void {
    const broken: number[] = [];
    this.timers.forEach((t, i) => {
      if (t.state === 'broken') broken.push(i);
    });
    this.game.run.set(this.key, { broken, snapped: this.snapped });
    const ph = this.game.physics;
    for (const j of this.joints) ph.removeJoint(j);
    for (const b of this.bodies) ph.removeBody(b);
    for (const f of this.falling) {
      ph.removeBody(f.body);
      f.mesh.removeFromParent();
    }
    ph.removeBody(this.anchor);
    this.planks.removeFromParent();
    this.rails.removeFromParent();
    this.planks.geometry.dispose();
    this.rails.geometry.dispose();
    this.planks.dispose();
    this.rails.dispose();
  }
}

// ---------------------------------------------------------------------------
// Crumbling floor
// ---------------------------------------------------------------------------

/** A grid of tiles over a pit. Each tile cracks when stood on, then becomes a falling body. */
export class CrumbleFloor implements Entity {
  private readonly tiles: { body: RAPIER.RigidBody; col: RAPIER.Collider; timer: CrackTimer; x: number; z: number; fallT: number }[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly tx: number;
  private readonly tz: number;

  constructor(
    private readonly game: Game,
    parent: THREE.Object3D,
    private readonly key: string,
    private readonly x0: number,
    private readonly z0: number,
    x1: number,
    z1: number,
    private readonly y: number,
    nx: number,
    nz: number,
    delay: number,
    mat: string,
    dark: boolean,
  ) {
    const w = game.physics.world;
    this.tx = (x1 - x0) / nx;
    this.tz = (z1 - z0) / nz;
    const saved = new Set(game.run.get<number[]>(key, []));
    const g = new THREE.BoxGeometry(this.tx * 0.97, 0.22, this.tz * 0.97);
    this.mesh = new THREE.InstancedMesh(game.mats.prep(g, mat), game.mats.get(mat, dark), nx * nz);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parent.add(this.mesh);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = x0 + (ix + 0.5) * this.tx;
        const z = z0 + (iz + 0.5) * this.tz;
        const body = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y - 0.11, z));
        const col = w.createCollider(
          RAPIER.ColliderDesc.cuboid(this.tx / 2, 0.11, this.tz / 2).setMass(60).setCollisionGroups(GROUPS.world),
          body,
        );
        game.physics.setMeta(col, { kind: 'tile', surface: 'stone' });
        // Tiles nearer the middle go faster: the edges give you a moment to commit.
        const timer = new CrackTimer(delay * (0.75 + 0.5 * Math.abs(Math.sin(ix * 12.9 + iz * 4.1))), 30);
        const tile = { body, col, timer, x, z, fallT: 0 };
        this.tiles.push(tile);
        if (saved.has(this.tiles.length - 1)) {
          timer.forceBroken();
          knockOut(col);
          tile.fallT = 99;
        }
      }
    }
    this.frame();
  }

  step(dt: number): void {
    const game = this.game;
    const pl = game.player;
    let on = -1;
    if (pl.alive && pl.grounded && Math.abs(pl.pos.y - this.y) < 0.4) {
      const ix = Math.floor((pl.pos.x - this.x0) / this.tx);
      const iz = Math.floor((pl.pos.z - this.z0) / this.tz);
      const nx = Math.round(this.tiles.length / Math.max(1, this.countZ()));
      if (ix >= 0 && ix < nx && iz >= 0 && iz < this.countZ()) on = iz * nx + ix;
    }
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t.timer.state === 'broken') {
        if (t.fallT < 90) {
          t.fallT += dt;
          if (t.fallT > 5) {
            t.fallT = 99;
            knockOut(t.col);
            t.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
          }
        }
        continue;
      }
      const ev = t.timer.update(i === on ? pl.mass : 0, dt);
      if (ev === 'cracked') {
        game.sfx('crack', { x: t.x, y: this.y, z: t.z }, 0.9);
        game.particles.emit('dust', { x: t.x, y: this.y, z: t.z }, 5, { spread: 0.4 });
      } else if (ev === 'broke') {
        t.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        t.col.setCollisionGroups(GROUPS.debris);
        t.body.setAngvel({ x: Math.random() * 2 - 1, y: 0, z: Math.random() * 2 - 1 }, true);
        game.sfx('debris', { x: t.x, y: this.y, z: t.z }, 0.7, 1.2);
        game.noise('debris', { x: t.x, y: this.y, z: t.z }, 0.6);
        game.particles.emit('dust', { x: t.x, y: this.y, z: t.z }, 10, { spread: 0.5 });
      }
    }
  }

  private nzCache = 0;
  private countZ(): number {
    if (!this.nzCache) {
      const zs = new Set(this.tiles.map((t) => t.z.toFixed(3)));
      this.nzCache = zs.size;
    }
    return this.nzCache;
  }

  frame(): void {
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t.fallT >= 90) {
        _m.compose(_p.set(t.x, -999, t.z), _q.identity(), _zero);
      } else {
        const tr = t.body.translation();
        const r = t.body.rotation();
        _p.set(tr.x, tr.y, tr.z);
        if (t.timer.state === 'cracking') {
          _p.x += (Math.random() - 0.5) * 0.03;
          _p.y -= t.timer.progress * 0.05;
          _p.z += (Math.random() - 0.5) * 0.03;
        }
        _m.compose(_p, _q.set(r.x, r.y, r.z, r.w), _s);
      }
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    const broken: number[] = [];
    this.tiles.forEach((t, i) => {
      if (t.timer.state === 'broken') broken.push(i);
    });
    this.game.run.set(this.key, broken);
    for (const t of this.tiles) this.game.physics.removeBody(t.body);
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

// ---------------------------------------------------------------------------
// Rolling boulder
// ---------------------------------------------------------------------------

export class Boulder implements Entity {
  private readonly body: RAPIER.RigidBody;
  private readonly col: RAPIER.Collider;
  private readonly mesh: THREE.Mesh;
  private state: 'held' | 'rolling' | 'rest' = 'held';
  private readonly release = new OneShot(0.7);
  private stillT = 0;
  private rumbleT = 0;

  constructor(
    private readonly game: Game,
    parent: THREE.Object3D,
    private readonly key: string,
    at: Vec3Like,
    private readonly r: number,
    private readonly push: Vec3Like,
    dark: boolean,
  ) {
    const saved = game.run.get<{ state: 'held' | 'rolling' | 'rest'; x: number; y: number; z: number } | null>(key, null);
    const w = game.physics.world;
    const p = saved ?? { state: 'held' as const, x: at.x, y: at.y + r, z: at.z };
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z).setAngularDamping(0.05).setLinearDamping(0.02));
    this.col = w.createCollider(
      RAPIER.ColliderDesc.ball(r).setDensity(2200).setFriction(1.2).setRestitution(0.05).setCollisionGroups(GROUPS.world),
      this.body,
    );
    game.physics.setMeta(this.col, { kind: 'boulder', surface: 'stone' });
    const g = new THREE.IcosahedronGeometry(r, 3);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const k = 1 - 0.035 * Math.abs(Math.sin(pos.getX(i) * 3.1 + pos.getY(i) * 5.3) + Math.sin(pos.getZ(i) * 4.7));
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    this.mesh = game.mats.mesh(g, 'rock', dark);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    parent.add(this.mesh);
    if (saved && saved.state !== 'held') this.state = 'rest';
    this.frame();
  }

  trigger(): void {
    if (this.state !== 'held') return;
    if (this.release.trigger()) {
      this.game.sfx('grindLong', this.body.translation(), 1);
      this.game.shake(0.5);
    }
  }

  step(dt: number): void {
    const game = this.game;
    if (this.state === 'held') {
      if (this.release.update(dt)) {
        this.state = 'rolling';
        this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        this.col.setCollisionGroups(GROUPS.debris);
        this.body.setLinvel(this.push, true);
        game.toast('RUN.', 'bad');
      }
      return;
    }
    if (this.state !== 'rolling') return;
    const t = this.body.translation();
    const v = this.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    this.rumbleT -= dt;
    if (this.rumbleT <= 0 && speed > 0.8) {
      this.rumbleT = 0.5;
      game.sfx('boulder', t, 1, 0.8 + speed * 0.03);
      game.noise('trap', t);
      game.particles.emit('dust', { x: t.x, y: t.y - this.r, z: t.z }, 8, { spread: 1 });
    }
    const pl = game.player;
    const d = Math.hypot(pl.pos.x - t.x, pl.centerY - t.y, pl.pos.z - t.z);
    if (speed > 0.8) game.shake(clamp01(1 - d / 22) * 0.5);
    if (pl.alive && speed > 1.5 && d < this.r + 0.45) {
      game.damage(DAMAGE.boulder, 'Flattened by the boulder.');
    }
    if (speed < 0.35) this.stillT += dt;
    else this.stillT = 0;
    if (this.stillT > 1.2 && d > this.r + 0.8) {
      this.state = 'rest';
      this.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
      this.col.setCollisionGroups(GROUPS.world);
    }
    if (t.y < game.killY() - 20) this.state = 'rest';
  }

  frame(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  dispose(): void {
    const t = this.body.translation();
    this.game.run.set(this.key, { state: this.state === 'held' ? 'held' : 'rest', x: t.x, y: t.y, z: t.z });
    this.game.physics.removeBody(this.body);
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

// ---------------------------------------------------------------------------
// Swinging blade
// ---------------------------------------------------------------------------

/** A dynamic pendulum on a revolute joint. It is topped back up to full swing each time it passes the bottom. */
export class SwingBlade implements Entity {
  private readonly body: RAPIER.RigidBody;
  private readonly anchor: RAPIER.RigidBody;
  private readonly joint: RAPIER.ImpulseJoint;
  private readonly mesh: THREE.Group;
  private lastSign = 0;
  private readonly wMax: number;
  private active: boolean;
  private whooshed = false;

  /**
   * @param pivot world position of the hinge
   * @param axis 'x' swings in the YZ plane, 'z' swings in the XY plane
   */
  constructor(
    private readonly game: Game,
    parent: THREE.Object3D,
    private readonly pivot: Vec3Like,
    private readonly length: number,
    private readonly axis: 'x' | 'z',
    amplitude: number,
    phase: number,
    dark: boolean,
    startActive = true,
  ) {
    const w = game.physics.world;
    this.active = startActive;
    const g = Math.abs(game.physics.gravity);
    // Energy conservation: w at the bottom for a given amplitude.
    this.wMax = Math.sqrt((2 * g * (1 - Math.cos(amplitude))) / (length * 0.86));
    this.anchor = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pivot.x, pivot.y, pivot.z));
    const a0 = startActive ? amplitude * Math.cos(phase) : 0;
    const off = axis === 'z' ? { x: Math.sin(a0) * length * 0.5, y: -Math.cos(a0) * length * 0.5, z: 0 } : { x: 0, y: -Math.cos(a0) * length * 0.5, z: Math.sin(a0) * length * 0.5 };
    const rotAxis = axis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(-1, 0, 0);
    _q.setFromAxisAngle(rotAxis, a0);
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pivot.x + off.x, pivot.y + off.y, pivot.z + off.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setLinearDamping(0)
        .setAngularDamping(0)
        .setCanSleep(false),
    );
    // Mass concentrated low so it swings like a real axe head.
    w.createCollider(
      RAPIER.ColliderDesc.cuboid(axis === 'z' ? 0.5 : 0.06, 0.3, axis === 'z' ? 0.06 : 0.5).setTranslation(0, -length * 0.42, 0).setMass(120).setCollisionGroups(GROUPS.rope),
      this.body,
    );
    this.joint = w.createImpulseJoint(
      RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: length * 0.5, z: 0 }, axis === 'z' ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }),
      this.anchor,
      this.body,
      true,
    );
    if (startActive) this.setSwing(-this.wMax * Math.sin(phase) * 0.9);

    this.mesh = new THREE.Group();
    const arm = game.mats.mesh(new THREE.BoxGeometry(0.12, length * 0.8, 0.12), 'wood', dark);
    arm.position.y = length * 0.1;
    const head = new THREE.Shape();
    head.moveTo(-0.75, 0.25);
    head.quadraticCurveTo(0, -0.65, 0.75, 0.25);
    head.lineTo(0.2, 0.42);
    head.lineTo(-0.2, 0.42);
    head.closePath();
    const hg = new THREE.ExtrudeGeometry(head, { depth: 0.05, bevelEnabled: false });
    hg.translate(0, 0, -0.025);
    if (axis === 'x') hg.rotateY(Math.PI / 2);
    const blade = game.mats.mesh(hg, 'iron', dark);
    blade.position.y = -length * 0.42;
    for (const m of [arm, blade]) {
      m.castShadow = true;
      this.mesh.add(m);
    }
    parent.add(this.mesh);
    this.frame();
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.setSwing(this.wMax);
  }

  /**
   * Give the blade a swing rate `w` (rad/s, positive = toward +x or +z) about its hinge.
   * The mass sits far from the hinge, so the centre of mass must be given the matching
   * linear velocity; an angular velocity alone is all but cancelled by the joint.
   */
  private setSwing(w: number): void {
    const c = this.body.worldCom();
    const rx = c.x - this.pivot.x;
    const ry = c.y - this.pivot.y;
    const rz = c.z - this.pivot.z;
    if (this.axis === 'z') {
      this.body.setAngvel({ x: 0, y: 0, z: w }, true);
      this.body.setLinvel({ x: -w * ry, y: w * rx, z: 0 }, true);
    } else {
      this.body.setAngvel({ x: -w, y: 0, z: 0 }, true);
      this.body.setLinvel({ x: 0, y: w * rz, z: -w * ry }, true);
    }
  }

  /** Signed swing angle from vertical. */
  private angle(): number {
    const t = this.body.translation();
    return this.axis === 'z' ? Math.atan2(t.x - this.pivot.x, this.pivot.y - t.y) : Math.atan2(t.z - this.pivot.z, this.pivot.y - t.y);
  }

  step(): void {
    if (!this.active) return;
    const game = this.game;
    const ang = this.angle();
    const av = this.body.angvel();
    const w = this.axis === 'z' ? av.z : -av.x;
    const sign = Math.sign(ang);
    if (sign !== 0 && sign !== this.lastSign) {
      // Through the bottom: restore full speed in the direction of travel.
      const dir = Math.sign(w) || 1;
      this.setSwing(dir * this.wMax);
      this.lastSign = sign;
      this.whooshed = false;
    }
    if (!this.whooshed && Math.abs(ang) < 0.5) {
      this.whooshed = true;
      game.sfx('blade', this.tip(), 0.8, 0.9 + Math.random() * 0.2);
    }
    // Hit test: the cutting edge against the player's body.
    const pl = game.player;
    if (!pl.alive) return;
    const tip = this.tip();
    const dy = tip.y - pl.pos.y;
    if (dy < -0.3 || dy > 1.9) return;
    const d = Math.hypot(tip.x - pl.pos.x, tip.z - pl.pos.z);
    if (d < 0.75 && Math.abs(w) > 0.4 && pl.canBeHit()) {
      const k = Math.sign(w) * 5;
      game.damage(DAMAGE.blade, 'Cut down by a swinging blade.');
      if (this.axis === 'z') pl.knock(k, 3, 0);
      else pl.knock(0, 3, k);
      game.particles.emit('spark', tip, 8);
    }
  }

  private tip(): Vec3Like {
    const t = this.body.translation();
    // Body origin is mid-arm; the edge is 0.42 L further along the same direction.
    const k = 0.9;
    return { x: t.x + (t.x - this.pivot.x) * k, y: t.y + (t.y - this.pivot.y) * k, z: t.z + (t.z - this.pivot.z) * k };
  }

  frame(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  dispose(): void {
    this.game.physics.removeJoint(this.joint);
    this.game.physics.removeBody(this.body);
    this.game.physics.removeBody(this.anchor);
    this.mesh.removeFromParent();
    this.mesh.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

// ---------------------------------------------------------------------------
// Dart trap
// ---------------------------------------------------------------------------

const DART_SPEED = 30;

/** Rows of holes in a wall. A trigger fires volleys of darts that fly as swept projectiles. */
export class DartTrap implements Entity {
  readonly logic: DartTrigger;
  private readonly mesh: THREE.InstancedMesh;
  private readonly darts: { x: number; y: number; z: number; live: boolean; stuck: number; travelled: number }[] = [];
  private readonly dir: THREE.Vector3;
  private readonly quat = new THREE.Quaternion();

  constructor(
    private readonly game: Game,
    parent: THREE.Object3D,
    private readonly holes: Vec3Like[],
    dir: Vec3Like,
    private readonly range: number,
    dark: boolean,
    volleys = 3,
  ) {
    this.logic = new DartTrigger(volleys, 0.32, 2.2, 0.28);
    this.dir = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    this.quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.dir);
    const g = new THREE.CylinderGeometry(0.012, 0.022, 0.5, 5);
    const max = holes.length * (volleys + 1);
    this.mesh = new THREE.InstancedMesh(g, game.mats.get('bone', dark), max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    for (let i = 0; i < max; i++) {
      this.darts.push({ x: 0, y: -999, z: 0, live: false, stuck: 0, travelled: 0 });
      this.mesh.setMatrixAt(i, _m.compose(_p.set(0, -999, 0), this.quat, _zero));
    }
    parent.add(this.mesh);
  }

  /** Click... then darts. Returns false while the trap is still cycling. */
  trigger(): boolean {
    const ok = this.logic.trigger();
    if (ok) {
      this.game.sfx('plate', this.holes[0], 1, 1.5);
      this.game.noise('trap', this.holes[0], 0.7);
    }
    return ok;
  }

  step(dt: number): void {
    const game = this.game;
    const n = this.logic.update(dt);
    for (let v = 0; v < n; v++) {
      for (const h of this.holes) {
        const d = this.darts.find((q) => !q.live && q.stuck <= 0) ?? this.darts[0];
        d.x = h.x;
        d.y = h.y;
        d.z = h.z;
        d.live = true;
        d.stuck = 0;
        d.travelled = 0;
      }
      game.sfx('dart', this.holes[Math.floor(this.holes.length / 2)], 1);
    }
    const pl = game.player;
    const step = DART_SPEED * dt;
    for (const d of this.darts) {
      if (d.stuck > 0) {
        d.stuck -= dt;
        if (d.stuck <= 0) d.y = -999;
        continue;
      }
      if (!d.live) continue;
      // Sweep this step's segment against the world, then against the player.
      const hit = game.physics.raycast(d, this.dir, step, RAY.solidWorld);
      const travel = hit ? hit.distance : step;
      if (pl.alive) {
        // Closest approach of the segment to the player's vertical axis.
        const rx = pl.pos.x - d.x;
        const rz = pl.pos.z - d.z;
        const along = clamp(rx * this.dir.x + rz * this.dir.z, 0, travel);
        const cx = d.x + this.dir.x * along;
        const cy = d.y + this.dir.y * along;
        const cz = d.z + this.dir.z * along;
        const top = pl.pos.y + (pl.crouching ? 1.0 : 1.72);
        if (Math.hypot(pl.pos.x - cx, pl.pos.z - cz) < 0.4 && cy > pl.pos.y + 0.05 && cy < top) {
          d.live = false;
          d.y = -999;
          game.damage(DAMAGE.dart, 'Bled out full of darts.');
          game.sfx('dartHit', pl.pos, 1);
          game.particles.emit('spark', { x: cx, y: cy, z: cz }, 4);
          continue;
        }
      }
      d.x += this.dir.x * travel;
      d.y += this.dir.y * travel;
      d.z += this.dir.z * travel;
      d.travelled += travel;
      if (hit || d.travelled > this.range) {
        d.live = false;
        d.stuck = hit ? 6 : 0.001;
        if (hit) {
          game.sfx('dartHit', d, 0.7, 0.8);
          game.particles.emit('chip', d, 3, { spread: 0.05 });
        }
      }
    }
  }

  frame(): void {
    for (let i = 0; i < this.darts.length; i++) {
      const d = this.darts[i];
      const vis = d.live || d.stuck > 0;
      _m.compose(_p.set(d.x - this.dir.x * 0.22, d.y - this.dir.y * 0.22, d.z - this.dir.z * 0.22), this.quat, vis ? _s : _zero);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

// ---------------------------------------------------------------------------
// Falling debris (sanctum ceiling, trapped pedestals)
// ---------------------------------------------------------------------------

const MAX_DEBRIS = 40;

export class DebrisField implements Entity {
  private readonly mesh: THREE.InstancedMesh;
  private readonly blocks: { body: RAPIER.RigidBody; col: RAPIER.Collider; size: number; state: 'fall' | 'settle' | 'rest'; t: number }[] = [];
  private readonly pending: { x: number; y: number; z: number; t: number; size: number }[] = [];

  constructor(
    private readonly game: Game,
    parent: THREE.Object3D,
    private readonly ceilY: number,
    private readonly floorY: number,
    mat: string,
    dark: boolean,
  ) {
    this.mesh = new THREE.InstancedMesh(game.mats.prep(new THREE.BoxGeometry(1, 1, 1), mat), game.mats.get(mat, dark), MAX_DEBRIS);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_DEBRIS; i++) this.mesh.setMatrixAt(i, _m.compose(_p.set(0, -999, 0), _q.identity(), _zero));
    parent.add(this.mesh);
  }

  get count(): number {
    return this.blocks.length;
  }

  /** Schedule a chunk of ceiling to come down at (x, z) after a warning trickle of dust. */
  drop(x: number, z: number, size = 0.5 + Math.random() * 0.55, warn = 0.75): void {
    const game = this.game;
    this.pending.push({ x, y: this.ceilY - size / 2 - 0.05, z, t: warn, size });
    game.sfx('crack', { x, y: this.ceilY, z }, 1, 0.7);
    game.particles.emit('dust', { x, y: this.ceilY - 0.3, z }, 14, { spread: 0.5, dir: { x: 0, y: -1, z: 0 }, speed: 1.5 });
  }

  step(dt: number): void {
    const game = this.game;
    const w = game.physics.world;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t > 0) continue;
      this.pending.splice(i, 1);
      if (this.blocks.length >= MAX_DEBRIS) {
        const old = this.blocks.shift()!;
        game.physics.removeBody(old.body);
      }
      const body = w.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setAngvel({ x: Math.random() * 3 - 1.5, y: Math.random() * 3 - 1.5, z: Math.random() * 3 - 1.5 }).setCcdEnabled(true),
      );
      const h = p.size / 2;
      const col = w.createCollider(RAPIER.ColliderDesc.cuboid(h, h * 0.8, h).setDensity(1800).setFriction(0.9).setCollisionGroups(GROUPS.debris), body);
      game.physics.setMeta(col, { kind: 'debris', surface: 'stone' });
      this.blocks.push({ body, col, size: p.size, state: 'fall', t: 0 });
    }
    const pl = game.player;
    for (const b of this.blocks) {
      if (b.state === 'rest') continue;
      b.t += dt;
      const t = b.body.translation();
      const v = b.body.linvel();
      if (b.state === 'fall') {
        // Still coming down: anything under it gets hurt.
        if (pl.alive && v.y < -4 && Math.hypot(t.x - pl.pos.x, t.z - pl.pos.z) < b.size / 2 + 0.4 && t.y - b.size / 2 < pl.pos.y + 1.75 && t.y > pl.pos.y && pl.canBeHit()) {
          game.damage(DAMAGE.debris, 'Crushed by falling masonry.');
          pl.knock((pl.pos.x - t.x) * 2, 1, (pl.pos.z - t.z) * 2);
        }
        if (t.y - b.size / 2 < this.floorY + 0.25 || (b.t > 0.4 && Math.abs(v.y) < 0.6)) {
          b.state = 'settle';
          b.t = 0;
          game.sfx('debris', t, 1, 0.8 + Math.random() * 0.4);
          game.noise('debris', t);
          game.particles.emit('dust', t, 16, { spread: b.size });
          game.particles.emit('chip', t, 10, { spread: b.size * 0.6 });
          const d = Math.hypot(t.x - pl.pos.x, t.y - pl.pos.y, t.z - pl.pos.z);
          game.shake(clamp01(1 - d / 14) * 0.7);
        }
      } else if (b.t > 1.5 && Math.hypot(v.x, v.y, v.z) < 0.3) {
        // At rest: becomes ordinary rubble you have to walk round.
        if (Math.hypot(t.x - pl.pos.x, t.z - pl.pos.z) > b.size / 2 + 0.75 || b.t > 8) {
          b.state = 'rest';
          b.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
          if (Math.hypot(t.x - pl.pos.x, t.z - pl.pos.z) > b.size / 2 + 0.75) b.col.setCollisionGroups(GROUPS.world);
        }
      }
    }
  }

  frame(): void {
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const b = this.blocks[i];
      if (!b) {
        this.mesh.setMatrixAt(i, _m.compose(_p.set(0, -999, 0), _q.identity(), _zero));
        continue;
      }
      const t = b.body.translation();
      const r = b.body.rotation();
      _m.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _s.set(b.size, b.size * 0.8, b.size));
      this.mesh.setMatrixAt(i, _m);
    }
    _s.set(1, 1, 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const b of this.blocks) this.game.physics.removeBody(b.body);
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

// ---------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------

/** Telegraphed gusts across an exposed stretch. Crouch, or be shoved (and lose your flame). */
export class WindGusts implements Entity {
  private readonly src: WindSource;
  private t: number;
  private phase: 'calm' | 'warn' | 'blow' = 'calm';

  constructor(
    private readonly game: Game,
    region: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number },
    dir: Vec3Like,
    private readonly every: [number, number],
  ) {
    this.src = { ...region, dir, strength: 0 };
    game.reg.winds.push(this.src);
    this.t = 3 + Math.random() * 3;
  }

  step(dt: number): void {
    const game = this.game;
    const s = this.src;
    const pl = game.player.pos;
    const near = pl.x > s.x0 - 14 && pl.x < s.x1 + 14 && pl.z > s.z0 - 14 && pl.z < s.z1 + 14;
    this.t -= dt;
    if (this.phase === 'calm') {
      s.strength = Math.max(0, s.strength - dt * 2);
      if (this.t <= 0) {
        this.phase = 'warn';
        this.t = 1.1;
        if (near) game.sfx('gust', { x: (s.x0 + s.x1) / 2, y: pl.y, z: clamp(pl.z, s.z0, s.z1) }, 1, 1, 60);
      }
    } else if (this.phase === 'warn') {
      if (this.t <= 0) {
        this.phase = 'blow';
        this.t = 1.9;
      }
    } else {
      s.strength = Math.min(1, s.strength + dt * 2.2);
      if (near && Math.random() < 0.6) {
        const p = { x: s.x0 + Math.random() * (s.x1 - s.x0) - s.dir.x * 3, y: s.y0 + 1 + Math.random() * 3, z: s.z0 + Math.random() * (s.z1 - s.z0) };
        game.particles.emit('leaf', p, 1, { dir: { x: s.dir.x * 3, y: 0.1, z: s.dir.z * 3 }, speed: 9, life: 0.4 });
      }
      if (this.t <= 0) {
        this.phase = 'calm';
        this.t = this.every[0] + Math.random() * (this.every[1] - this.every[0]);
      }
    }
  }

  dispose(): void {
    removeFrom(this.game.reg.winds, this.src);
  }
}
