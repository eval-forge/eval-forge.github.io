/**
 * Physical traps: the jointed rope bridge, crumbling floors, swinging blades, dart traps,
 * the rolling boulder, weighted pedestals and the sanctum's collapsing ceiling.
 */
import * as THREE from 'three';
import { RAPIER } from '../../physics/Physics';
import { G, groups } from '../../config';
import { GROUP_STATIC, GROUP_DEBRIS, GROUP_HAZARD, GROUP_DART } from './constants';
import { BreakTimer, CRUMBLE_DELAY, plankBreakDelay, WeightTrapLogic, DART_DAMAGE, bladeDamage, impactDamage, BOULDER_LETHAL_SPEED } from '../../logic/traps';
import { CeilingStrain, type NoiseEvent } from '../../logic/noise';
import type { SceneCtx, SceneRuntime } from '../SceneDef';
import type { Prop } from '../types';
import { boxMesh, cylMesh, massInBox, playerOn, playerSegment, segSegDist, fixedBody } from './util';
import { rockGeometry, normalizeGeometry } from '../../render/geometry';

const UPY = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

function segmentMatrix(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Matrix4) {
  const d = _s.subVectors(b, a);
  const len = d.length();
  if (len < 1e-5) return out.makeScale(0, 0, 0);
  _q.setFromUnitVectors(UPY, d.divideScalar(len));
  return out.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), _q, new THREE.Vector3(1, len, 1));
}

// ---------------------------------------------------------------------------
// Rope bridge: chain of planks joined by spherical joints at both rope sides

interface Plank {
  body: RAPIER.RigidBody;
  deck: RAPIER.Collider;
  mesh: THREE.Mesh;
  timer: BreakTimer;
  shake: number;
}

export class RopeBridge implements Prop {
  planks: Plank[] = [];
  ropes: THREE.InstancedMesh;
  private falling: { body: RAPIER.RigidBody; mesh: THREE.Mesh; t: number }[] = [];
  private pitch: number;
  private halfW: number;
  private creak = 0;
  private fallen: Set<number>;

  constructor(private ctx: SceneCtx, private rt: SceneRuntime, public id: string, private south: THREE.Vector3, private north: THREE.Vector3, width = 1.8, n = 29, sag = 0.9) {
    const world = ctx.physics.world;
    const span = south.distanceTo(north);
    this.pitch = (span * 1.007) / n;
    this.halfW = width / 2 - 0.05;
    const dir = new THREE.Vector3().subVectors(north, south).normalize();
    this.fallen = new Set((ctx.run.get('bridge:' + id) as number[] | undefined) ?? []);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const c = south.clone().lerp(north, u);
      c.y -= sag * 4 * u * (1 - u);
      const body = rt.trackBody(world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(c.x, c.y, c.z).setLinearDamping(0.6).setAngularDamping(1.5).setCanSleep(true)));
      const isFallen = this.fallen.has(i);
      const deck = world.createCollider(
        RAPIER.ColliderDesc.cuboid(width / 2, 0.045, this.pitch * 0.44).setMass(isFallen ? 1 : 6).setFriction(1.0).setCollisionGroups(isFallen ? groups(0, 0) : groups(G.PROP, G.PLAYER | G.PROP | G.DEBRIS | G.HELD | G.SENSOR)),
        body,
      );
      const idx = i;
      ctx.physics.setOwner(deck, { kind: 'plank', surface: 'wood', onStep: (mass: number) => this.step(idx, mass) });
      const mesh = boxMesh(ctx.mats, 'wood', width, 0.08, this.pitch * 0.86, 1.2, i % 3 === 0 ? 0xc0b0a0 : 0xffffff);
      mesh.visible = !isFallen;
      rt.group.add(mesh);
      ctx.physics.addSync(body, mesh);
      this.planks.push({ body, deck, mesh, timer: new BreakTimer(0.5), shake: 0 });
      if (isFallen) this.planks[i].timer.state = 'fallen';
    }
    // joints
    const half = this.pitch / 2;
    for (let i = 0; i <= n; i++) {
      for (const sx of [-this.halfW, this.halfW]) {
        if (i === 0) {
          const a = new THREE.Vector3(south.x + sx, south.y, south.z);
          world.createImpulseJoint(RAPIER.JointData.spherical({ x: a.x, y: a.y, z: a.z }, { x: sx, y: 0, z: -dir.z * half }), rt.body, this.planks[0].body, true);
        } else if (i === n) {
          const a = new THREE.Vector3(north.x + sx, north.y, north.z);
          world.createImpulseJoint(RAPIER.JointData.spherical({ x: sx, y: 0, z: dir.z * half }, { x: a.x, y: a.y, z: a.z }), this.planks[n - 1].body, rt.body, true);
        } else {
          world.createImpulseJoint(RAPIER.JointData.spherical({ x: sx, y: 0, z: dir.z * half }, { x: sx, y: 0, z: -dir.z * half }), this.planks[i - 1].body, this.planks[i].body, true);
        }
      }
    }
    // rope visuals: 2 deck ropes + 2 handrails, (n+1) segments each, plus hangers
    const segCount = (n + 1) * 4 + n * 2;
    const ropeGeo = normalizeGeometry(new THREE.CylinderGeometry(0.025, 0.025, 1, 5, 1, true));
    this.ropes = new THREE.InstancedMesh(ropeGeo, ctx.mats.get('rope'), segCount);
    this.ropes.castShadow = true;
    this.ropes.frustumCulled = false;
    rt.group.add(this.ropes);
    // posts
    for (const end of [south, north]) {
      for (const sx of [-1, 1]) {
        const post = cylMesh(ctx.mats, 'darkWood', 0.13, 0.16, 2.6, 8);
        post.position.set(end.x + sx * (width / 2 + 0.15), end.y + 0.6, end.z);
        rt.group.add(post);
      }
    }
  }

  private step(i: number, _mass: number) {
    const p = this.planks[i];
    if (p.timer.state !== 'intact') return;
    const lf = this.ctx.run.satchel.loadFraction;
    p.timer.touch(plankBreakDelay(lf));
    p.shake = 1;
    const pos = p.body.translation();
    this.ctx.sfx.play('plankCrack', new THREE.Vector3(pos.x, pos.y, pos.z), 0.7);
    this.ctx.noise(new THREE.Vector3(pos.x, pos.y, pos.z), 0.4, 'snap', true);
  }

  private drop(i: number) {
    const p = this.planks[i];
    p.deck.setCollisionGroups(groups(0, 0));
    p.deck.setMass(1);
    p.mesh.visible = false;
    this.fallen.add(i);
    const t = p.body.translation();
    const r = p.body.rotation();
    const body = this.rt.trackBody(this.ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x, t.y - 0.05, t.z).setRotation(r)));
    this.ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.04, this.pitch * 0.43).setMass(6).setCollisionGroups(GROUP_DEBRIS), body);
    body.setAngvel({ x: (Math.random() - 0.5) * 3, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 3 }, true);
    const mesh = p.mesh.clone();
    mesh.visible = true;
    this.rt.group.add(mesh);
    this.falling.push({ body, mesh, t: 6 });
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    this.ctx.sfx.play('woodSnap', pos, 0.9);
    this.ctx.noise(pos, 0.8, 'snap', true);
  }

  fixedUpdate(dt: number) {
    for (let i = 0; i < this.planks.length; i++) {
      const p = this.planks[i];
      if (p.timer.update(dt)) this.drop(i);
    }
    for (const f of this.falling) {
      f.t -= dt;
      const t = f.body.translation();
      const r = f.body.rotation();
      f.mesh.position.set(t.x, t.y, t.z);
      f.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (f.t <= 0) {
        this.ctx.physics.removeBody(f.body);
        f.mesh.removeFromParent();
      }
    }
    this.falling = this.falling.filter((f) => f.t > 0);
  }

  update(dt: number) {
    // rope segments follow the plank edges
    let k = 0;
    const n = this.planks.length;
    const half = this.pitch / 2;
    const pts: THREE.Vector3[][] = [[], []];
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? -this.halfW : this.halfW;
      pts[s].push(new THREE.Vector3(this.south.x + sx, this.south.y, this.south.z));
      for (let i = 0; i < n; i++) {
        const b = this.planks[i].body;
        const t = b.translation();
        const r = b.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        const local = new THREE.Vector3(sx, 0, -half).applyQuaternion(_q);
        pts[s].push(new THREE.Vector3(t.x + local.x, t.y + local.y, t.z + local.z));
      }
      pts[s][pts[s].length - 1].set(this.north.x + sx, this.north.y, this.north.z);
    }
    for (let s = 0; s < 2; s++) {
      const P = pts[s];
      for (let i = 0; i < P.length - 1; i++) {
        this.ropes.setMatrixAt(k++, segmentMatrix(P[i], P[i + 1], _m));
        const a = P[i].clone();
        a.y += 0.95;
        const b = P[i + 1].clone();
        b.y += 0.95;
        this.ropes.setMatrixAt(k++, segmentMatrix(a, b, _m));
        if (i % 1 === 0 && i < n) this.ropes.setMatrixAt(k++, segmentMatrix(P[i + 1], b, _m));
      }
    }
    while (k < this.ropes.count) this.ropes.setMatrixAt(k++, _m.makeScale(0, 0, 0));
    this.ropes.instanceMatrix.needsUpdate = true;
    // shaking planks about to go
    for (const p of this.planks) {
      if (p.timer.state === 'cracking') {
        p.mesh.position.y += (Math.random() - 0.5) * 0.02;
      }
    }
    // creak when someone is on the bridge and it sways
    this.creak -= dt;
    const pl = this.ctx.player();
    if (this.creak <= 0 && pl.groundCollider && this.ctx.physics.ownerOf(pl.groundCollider)?.kind === 'plank') {
      this.creak = 0.7 + Math.random() * 0.8;
      this.ctx.sfx.play('woodCreak', pl.pos, 0.6);
    }
  }

  dispose() {
    this.ctx.run.set('bridge:' + this.id, [...this.fallen]);
    for (const f of this.falling) f.mesh.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Crumbling floor tiles

interface Tile {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  timer: BreakTimer;
  t: number;
  base: THREE.Vector3;
}

export class CrumbleTiles implements Prop {
  tiles: (Tile | null)[] = [];
  private fallen: Set<number>;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, rects: [number, number, number, number][], y: number, mat: 'floor' | 'dungeonFloor' | 'floorMoss' = 'dungeonFloor', private onFall?: (i: number) => void) {
    this.fallen = new Set((ctx.run.get('crumble:' + id) as number[] | undefined) ?? []);
    rects.forEach(([x0, z0, x1, z1], i) => {
      if (this.fallen.has(i)) {
        this.tiles.push(null);
        return;
      }
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const body = rt.trackBody(fixedBody(ctx.physics, cx, y - 0.15, cz));
      const c = ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2 - 0.01, 0.15, (z1 - z0) / 2 - 0.01).setDensity(2000).setCollisionGroups(GROUP_STATIC), body);
      const idx = i;
      ctx.physics.setOwner(c, { kind: 'crumble', surface: 'stone', onStep: () => this.touch(idx) });
      const mesh = boxMesh(ctx.mats, mat, x1 - x0 - 0.04, 0.3, z1 - z0 - 0.04, 0.5, 0xe8dcc8 - (i % 3) * 0x080808);
      mesh.position.set(cx, y - 0.15, cz);
      rt.group.add(mesh);
      ctx.physics.addSync(body, mesh);
      this.tiles.push({ body, mesh, timer: new BreakTimer(CRUMBLE_DELAY), t: 0, base: new THREE.Vector3(cx, y - 0.15, cz) });
    });
  }
  touch(i: number) {
    const t = this.tiles[i];
    if (!t || !t.timer.touch()) return;
    this.ctx.sfx.play('crumble', t.base, 0.6);
    this.ctx.fx.dustBurst(t.base, 6, 1, true);
  }
  fixedUpdate(dt: number) {
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (!t) continue;
      if (t.timer.state === 'cracking') {
        t.mesh.position.set(t.base.x + (Math.random() - 0.5) * 0.03, t.base.y, t.base.z + (Math.random() - 0.5) * 0.03);
      }
      if (t.timer.update(dt)) {
        t.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        for (let k = 0; k < t.body.numColliders(); k++) {
          const c = t.body.collider(k);
          c.setCollisionGroups(GROUP_DEBRIS);
          // shrink it a little so it cannot wedge between its neighbours on the way down
          const he = c.halfExtents();
          if (he) c.setHalfExtents({ x: Math.max(0.1, he.x - 0.12), y: he.y, z: Math.max(0.1, he.z - 0.12) });
        }
        t.body.setLinvel({ x: 0, y: -1.2, z: 0 }, true);
        t.body.setAngvel({ x: (Math.random() - 0.5) * 0.8, y: 0, z: (Math.random() - 0.5) * 0.8 }, true);
        this.ctx.sfx.play('crumble', t.base, 1);
        this.ctx.noise(t.base.clone(), 0.7, 'trap', false);
        this.fallen.add(i);
        this.onFall?.(i);
      }
      if (t.timer.state === 'fallen') {
        t.t += dt;
        if (t.t > 4) {
          this.ctx.physics.removeBody(t.body);
          t.mesh.removeFromParent();
          this.tiles[i] = null;
        }
      }
    }
  }
  dispose() {
    this.ctx.run.set('crumble:' + this.id, [...this.fallen]);
  }
}

// ---------------------------------------------------------------------------
// Swinging blade (kinematic pendulum)

export class Blade implements Prop {
  body: RAPIER.RigidBody;
  obj: THREE.Group;
  private t = 0;
  private lastAngle = 0;
  private cooldown = 0;
  private axisV: THREE.Vector3;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, private pivot: THREE.Vector3, axis: 'x' | 'z', private length: number, private amp: number, private period: number, private phase: number, private bladeW = 1.0, private bladeH = 0.5) {
    this.axisV = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    this.body = rt.trackBody(ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pivot.x, pivot.y, pivot.z)));
    // blade broad face lies in the swing plane
    const hx = axis === 'z' ? bladeW / 2 : 0.04;
    const hz = axis === 'z' ? 0.04 : bladeW / 2;
    const c = ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, bladeH / 2, hz).setTranslation(0, -length, 0).setCollisionGroups(GROUP_HAZARD), this.body);
    ctx.physics.setOwner(c, { kind: 'blade' });
    this.obj = new THREE.Group();
    const arm = cylMesh(ctx.mats, 'iron', 0.04, 0.04, length, 6);
    arm.position.y = -length / 2;
    this.obj.add(arm);
    // crescent blade from a lathe-free shape: extruded crescent
    const shape = new THREE.Shape();
    const R = bladeW / 2;
    shape.absarc(0, 0, R, Math.PI * 0.05, Math.PI * 0.95, false);
    shape.absarc(0, R * 0.55, R * 0.85, Math.PI * 0.92, Math.PI * 0.08, true);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 1 });
    geo.translate(0, -R * 0.1, -0.02);
    geo.rotateZ(Math.PI);
    if (axis === 'x') geo.rotateY(Math.PI / 2);
    const blade = new THREE.Mesh(normalizeGeometry(geo), ctx.mats.get('silver'));
    blade.position.y = -length + bladeH * 0.2;
    blade.castShadow = true;
    this.obj.add(blade);
    const hub = cylMesh(ctx.mats, 'iron', 0.12, 0.12, 0.3, 10);
    hub.rotation.set(axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? Math.PI / 2 : 0);
    this.obj.add(hub);
    this.obj.position.copy(pivot);
    rt.group.add(this.obj);
  }
  angleAt(t: number) {
    return this.amp * Math.sin((t / this.period) * Math.PI * 2 + this.phase);
  }
  fixedUpdate(dt: number) {
    this.t = this.ctx.time();
    const a = this.angleAt(this.t);
    const q = new THREE.Quaternion().setFromAxisAngle(this.axisV, a);
    this.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    this.obj.quaternion.copy(q);
    const pl = this.ctx.player();
    const dist = pl.pos.distanceTo(this.pivot);
    if (Math.sign(a) !== Math.sign(this.lastAngle) && dist < 14) {
      this.ctx.sfx.play('blade', this.pivot.clone().add(new THREE.Vector3(0, -this.length, 0)), 0.8);
    }
    const omega = (a - this.lastAngle) / dt;
    this.lastAngle = a;
    this.cooldown -= dt;
    if (this.cooldown > 0 || dist > this.length + 3 || pl.mode === 'dead') return;
    // blade core segment in world space
    const w = this.bladeW / 2;
    const along = this.axisV.x !== 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const c0 = new THREE.Vector3(0, -this.length, 0).addScaledVector(along, -w).applyQuaternion(q).add(this.pivot);
    const c1 = new THREE.Vector3(0, -this.length, 0).addScaledVector(along, w).applyQuaternion(q).add(this.pivot);
    const [p0, p1] = playerSegment(pl);
    if (segSegDist(c0, c1, p0, p1) < pl.radius + this.bladeH / 2) {
      const tip = Math.abs(omega) * this.length;
      this.cooldown = 0.9;
      this.ctx.damage(bladeDamage(tip), 'Cut down by a swinging blade');
      const push = along.clone().multiplyScalar(Math.sign(omega) * 4);
      pl.vel.x += push.x;
      pl.vel.z += push.z;
      pl.vel.y += 2;
      this.ctx.sfx.play('hurt', pl.pos, 1);
      this.ctx.shake(0.6);
    }
  }
  dispose() {}
}

// ---------------------------------------------------------------------------
// Dart traps: plates fire volleys from wall emitters

interface Dart {
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  prev: THREE.Vector3;
  life: number;
  stuck: boolean;
}

export class DartTrap implements Prop {
  private darts: Dart[] = [];
  private cool: number[] = [];
  private queue: { t: number; e: number }[] = [];
  private dartGeo: THREE.BufferGeometry;
  constructor(private ctx: SceneCtx, private rt: SceneRuntime, public id: string, private plates: { x: number; z: number; y: number; size: number; emitters: number[] }[], private emitters: { pos: THREE.Vector3; dir: THREE.Vector3 }[]) {
    for (const p of plates) {
      const m = boxMesh(ctx.mats, 'dungeonFloor', p.size, 0.06, p.size, 1, 0xb0a698);
      m.position.set(p.x, p.y + 0.02, p.z);
      rt.group.add(m);
      this.cool.push(0);
    }
    for (const e of emitters) {
      const hole = boxMesh(ctx.mats, 'obsidian', 0.14, 0.14, 0.14, 1);
      hole.position.copy(e.pos).addScaledVector(e.dir, -0.05);
      rt.group.add(hole);
    }
    const shaft = new THREE.CylinderGeometry(0.012, 0.012, 0.32, 4);
    shaft.rotateX(Math.PI / 2);
    this.dartGeo = normalizeGeometry(shaft);
  }
  /** Fire the given emitters (or all): one volley, or a second one a moment later. */
  fire(which?: number[], volleys = 2) {
    const list = which ?? this.emitters.map((_, i) => i);
    for (const e of list) {
      this.queue.push({ t: 0, e });
      if (volleys > 1) this.queue.push({ t: 0.15 + Math.random() * 0.1, e });
    }
    const p = this.emitters[list[0]]?.pos;
    if (p) {
      this.ctx.sfx.play('click', p, 1);
      this.ctx.noise(p.clone(), 0.6, 'trap', false);
    }
  }
  private spawn(e: number) {
    const em = this.emitters[e];
    const dir = em.dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.04)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const p = em.pos.clone().addScaledVector(dir, 0.2);
    const body = this.rt.trackBody(
      this.ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCcdEnabled(true).setGravityScale(0.15)),
    );
    this.ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.015, 0.015, 0.16).setMass(0.05).setCollisionGroups(GROUP_DART), body);
    body.setLinvel({ x: dir.x * 24, y: dir.y * 24, z: dir.z * 24 }, true);
    const mesh = new THREE.Mesh(this.dartGeo, this.ctx.mats.get('iron'));
    mesh.userData.sharedGeo = true;
    mesh.position.copy(p);
    mesh.quaternion.copy(q);
    this.rt.group.add(mesh);
    this.darts.push({ body, mesh, prev: p.clone(), life: 12, stuck: false });
    this.ctx.sfx.play('dartFire', em.pos, 0.9);
  }
  fixedUpdate(dt: number) {
    const pl = this.ctx.player();
    // plates
    for (let i = 0; i < this.plates.length; i++) {
      const p = this.plates[i];
      this.cool[i] -= dt;
      if (this.cool[i] > 0) continue;
      const h = p.size / 2;
      const onIt = playerOn(pl, p.x - h, p.z - h, p.x + h, p.z + h, p.y, 0.5) || massInBox(this.ctx.physics, new THREE.Vector3(p.x, p.y + 0.25, p.z), new THREE.Vector3(h, 0.25, h)) > 4;
      if (onIt) {
        this.cool[i] = 2.2;
        // a plate fires one volley across itself: a thief crossing it takes a dart or two
        this.fire(p.emitters, 1);
      }
    }
    for (const q of this.queue) q.t -= dt;
    for (const q of this.queue.filter((q) => q.t <= 0)) this.spawn(q.e);
    this.queue = this.queue.filter((q) => q.t > 0);
    // darts
    const [p0, p1] = playerSegment(pl);
    for (const d of this.darts) {
      d.life -= dt;
      if (d.stuck) continue;
      const t = d.body.translation();
      const cur = new THREE.Vector3(t.x, t.y, t.z);
      const v = d.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (pl.mode !== 'dead' && segSegDist(d.prev, cur, p0, p1) < pl.radius + 0.05) {
        this.ctx.damage(DART_DAMAGE, 'Poisoned darts');
        this.ctx.sfx.play('dartHit', cur, 1);
        this.ctx.sfx.play('hurt', pl.pos, 0.7);
        d.life = 0;
      } else if (speed < 6 && d.life < 11.9) {
        d.stuck = true;
        d.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        this.ctx.sfx.play('dartHit', cur, 0.6);
      }
      d.mesh.position.copy(cur);
      const r = d.body.rotation();
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      d.prev.copy(cur);
    }
    for (const d of this.darts.filter((d) => d.life <= 0)) {
      this.ctx.physics.removeBody(d.body);
      d.mesh.removeFromParent();
    }
    this.darts = this.darts.filter((d) => d.life > 0);
  }
  dispose() {}
}

// ---------------------------------------------------------------------------
// Rolling boulder released by a plate

export class Boulder implements Prop {
  body: RAPIER.RigidBody | null = null;
  mesh: THREE.Mesh;
  private released = false;
  private life = 0;
  private slow = 0;
  private loop: { stop(): void; setPos(p: THREE.Vector3): void; setGain(g: number): void } | null = null;
  private noiseT = 0;
  constructor(private ctx: SceneCtx, private rt: SceneRuntime, public id: string, private start: THREE.Vector3, private radius: number, private plate: { x: number; z: number; y: number; size: number }, private push: THREE.Vector3) {
    const used = ctx.run.get('boulder:' + id);
    const g = rockGeometry(radius, 3.3, 1.0, 2);
    this.mesh = new THREE.Mesh(normalizeGeometry(g), ctx.mats.get('rock'));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.position.copy(start);
    this.mesh.visible = !used;
    rt.group.add(this.mesh);
    const pm = boxMesh(ctx.mats, 'dungeonFloor', plate.size, 0.06, plate.size, 1, 0xa89e90);
    pm.position.set(plate.x, plate.y + 0.02, plate.z);
    rt.group.add(pm);
    if (used) this.released = true;
    else {
      // hold it in place with a fixed body until released
      this.body = rt.trackBody(ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(start.x, start.y, start.z)));
      ctx.physics.world.createCollider(RAPIER.ColliderDesc.ball(radius * 0.95).setDensity(2100).setFriction(0.9).setCollisionGroups(GROUP_HAZARD), this.body);
    }
  }
  release() {
    if (this.released || !this.body) return;
    this.released = true;
    this.ctx.run.set('boulder:' + this.id, true);
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setLinvel({ x: this.push.x * 2.5, y: 0, z: this.push.z * 2.5 }, true);
    this.ctx.sfx.play('stoneClick', new THREE.Vector3(this.plate.x, this.plate.y, this.plate.z), 1);
    this.ctx.sfx.play('rumble', this.start, 0.8);
    this.loop = this.ctx.sfx.loop('boulder', this.start, 0);
    this.ctx.toast('Something heavy breaks loose above you!', 'warn');
  }
  fixedUpdate(dt: number) {
    const pl = this.ctx.player();
    if (!this.released) {
      const h = this.plate.size / 2;
      if (playerOn(pl, this.plate.x - h, this.plate.z - h, this.plate.x + h, this.plate.z + h, this.plate.y, 0.5)) this.release();
      return;
    }
    if (!this.body) return;
    this.life += dt;
    const t = this.body.translation();
    const c = new THREE.Vector3(t.x, t.y, t.z);
    const v = this.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    this.loop?.setPos(c);
    this.loop?.setGain(Math.min(1.4, speed / 4));
    const r = this.body.rotation();
    this.mesh.position.copy(c);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    const d = c.distanceTo(pl.pos);
    if (d < 14) this.ctx.shake(Math.min(0.25, (speed / 10) * (1 - d / 14)) * dt * 10);
    this.noiseT -= dt;
    if (this.noiseT <= 0) {
      this.noiseT = 0.5;
      this.ctx.noise(c, 1.2, 'trap', false);
    }
    const [p0, p1] = playerSegment(pl);
    if (pl.mode !== 'dead' && segSegDist(c, c, p0, p1) < this.radius + pl.radius && speed > BOULDER_LETHAL_SPEED) {
      this.ctx.damage(impactDamage(speed, 3000), 'Crushed by a rolling boulder');
    }
    if (speed < 0.6 && this.life > 2) this.slow += dt;
    else this.slow = 0;
    if (this.slow > 0.8 || this.life > 12) this.smash();
  }
  private smash() {
    if (!this.body) return;
    const t = this.body.translation();
    const c = new THREE.Vector3(t.x, t.y, t.z);
    this.ctx.physics.removeBody(this.body);
    this.body = null;
    this.mesh.visible = false;
    this.loop?.stop();
    this.ctx.sfx.play('debris', c, 1.2);
    this.ctx.fx.dustBurst(c, 50, 2.5);
    this.ctx.shake(0.5);
  }
  dispose() {
    this.loop?.stop();
  }
}

// ---------------------------------------------------------------------------
// Weighted pedestal: lift the relic without a counterweight and the trap fires

export class WeightedPedestal implements Prop {
  logic: WeightTrapLogic;
  top: THREE.Vector3;
  fired: boolean;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, top: [number, number, number], public relicUid: string, armedMass: number, private onFire: () => void, mat: 'sandstone' | 'dungeon' = 'sandstone') {
    this.top = new THREE.Vector3(...top);
    this.logic = new WeightTrapLogic(armedMass);
    this.fired = !!ctx.run.get('pedestal:' + id);
    if (this.fired) this.logic.fired = true;
    const h = top[1] - (top[1] - 1.0);
    const col = cylMesh(ctx.mats, mat, 0.28, 0.34, h, 10);
    col.position.set(top[0], top[1] - h / 2 - 0.08, top[2]);
    rt.group.add(col);
    const plate = boxMesh(ctx.mats, mat, 0.75, 0.16, 0.75, 1);
    plate.position.set(top[0], top[1] - 0.08, top[2]);
    rt.group.add(plate);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.03, 6, 20), ctx.mats.get('bronze'));
    (ring.geometry as THREE.BufferGeometry).setAttribute('color', new THREE.BufferAttribute(new Float32Array((ring.geometry as THREE.BufferGeometry).attributes.position.count * 3).fill(1), 3));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(top[0], top[1] - 0.3, top[2]);
    rt.group.add(ring);
    const body = rt.trackBody(fixedBody(ctx.physics, top[0], top[1] - 0.5, top[2]));
    ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.375, 0.5, 0.375).setCollisionGroups(GROUP_STATIC), body);
    rt.addInteract({
      kind: 'interact',
      id: id + ':swap',
      position: this.top.clone().add(new THREE.Vector3(0, 0.2, 0)),
      reach: 2.4,
      prompt: () => {
        if (this.logic.fired) return null;
        const pl = ctx.player();
        const live = ctx.relics.live.get(this.relicUid);
        if (!live || live.rec.state !== 'world') return null;
        if (!pl.held) return 'A pressure ring. Hold something of similar weight and press E to swap.';
        const hm = pl.held.mass;
        return `E  Swap: put down ${hm.toFixed(1)} kg, take ${live.rec.mass.toFixed(1)} kg`;
      },
      interact: () => this.swap(),
    });
  }
  private swap() {
    const pl = this.ctx.player();
    const live = this.ctx.relics.live.get(this.relicUid);
    if (!pl.held || !live || this.logic.fired) return;
    const heldBody = pl.held.body;
    pl.release(false);
    heldBody.setTranslation({ x: this.top.x, y: this.top.y + 0.25, z: this.top.z }, true);
    heldBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    heldBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    heldBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    live.body.setTranslation({ x: pl.pos.x, y: pl.pos.y + 0.3, z: pl.pos.z }, true);
    pl.grab(live.body);
    this.ctx.sfx.play('stoneClick', this.top, 0.6);
  }
  fixedUpdate(dt: number) {
    if (this.logic.fired) return;
    const m = massInBox(this.ctx.physics, this.top.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(0.4, 0.32, 0.4));
    if (this.logic.update(m, dt)) {
      this.fired = true;
      this.ctx.run.set('pedestal:' + this.id, true);
      this.ctx.sfx.play('stoneClick', this.top, 1.2);
      this.ctx.sfx.play('rumble', this.top, 0.6);
      this.ctx.shake(0.4);
      this.onFire();
    }
  }
  dispose() {}
}

// ---------------------------------------------------------------------------
// Sanctum ceiling: noise strains sections until they collapse into falling rock

interface Section {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
  body: RAPIER.RigidBody | null;
  mesh: THREE.Mesh | null;
  threshold: number;
}

interface Rock {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  mass: number;
  t: number;
  settled: boolean;
}

export class CeilingCollapse implements Prop {
  strain: CeilingStrain;
  private rocks: Rock[] = [];
  private schedule: { at: number; id: number }[] = [];
  private t = 0;
  private dustT = 0;
  collapsed: Set<number>;
  constructor(private ctx: SceneCtx, private rt: SceneRuntime, public id: string, private sections: Section[], private area: THREE.Box3) {
    this.strain = new CeilingStrain(sections.map((s) => ({ x: (s.x0 + s.x1) / 2, z: (s.z0 + s.z1) / 2, threshold: s.threshold })));
    this.collapsed = new Set((ctx.run.get('ceiling:' + id) as number[] | undefined) ?? []);
    sections.forEach((s, i) => {
      if (this.collapsed.has(i)) {
        this.strain.sections[i].state = 'collapsed';
        // settled rubble from an earlier collapse
        const rng = mulberry(i * 977 + 3);
        for (let k = 0; k < 6; k++) {
          const x = s.x0 + 1 + rng() * (s.x1 - s.x0 - 2);
          const z = s.z0 + 1 + rng() * (s.z1 - s.z0 - 2);
          const r = 0.5 + rng() * 0.6;
          const g = rockGeometry(r, k + i * 10, 0.6);
          g.translate(x, r * 0.4, z);
          const m = new THREE.Mesh(normalizeGeometry(g), ctx.mats.get('sandstone'));
          m.castShadow = m.receiveShadow = true;
          rt.group.add(m);
          const b = rt.trackBody(fixedBody(ctx.physics, x, r * 0.35, z));
          ctx.physics.world.createCollider(RAPIER.ColliderDesc.ball(r * 0.7).setCollisionGroups(GROUP_STATIC), b);
        }
        return;
      }
      const cx = (s.x0 + s.x1) / 2;
      const cz = (s.z0 + s.z1) / 2;
      s.body = rt.trackBody(fixedBody(ctx.physics, cx, s.y + 0.5, cz));
      ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid((s.x1 - s.x0) / 2, 0.5, (s.z1 - s.z0) / 2).setCollisionGroups(GROUP_STATIC), s.body);
      s.mesh = boxMesh(ctx.mats, 'sandstone', s.x1 - s.x0, 1.0, s.z1 - s.z0, 0.5, 0xb8a890);
      s.mesh.position.set(cx, s.y + 0.5, cz);
      rt.group.add(s.mesh);
      // cracks hanging below
      for (let k = 0; k < 3; k++) {
        const crack = boxMesh(ctx.mats, 'obsidian', 0.05, 0.02, (s.z1 - s.z0) * 0.6, 1);
        crack.position.set(s.x0 + (k + 1) * ((s.x1 - s.x0) / 4), s.y - 0.005, cz);
        crack.rotation.y = 0.3 * (k - 1);
        rt.group.add(crack);
        s.mesh.userData['crack' + k] = crack;
      }
    });
  }
  onNoise(ev: NoiseEvent) {
    if (!this.area.containsPoint(new THREE.Vector3(ev.x, Math.min(ev.y, this.area.max.y - 0.1), ev.z))) return;
    this.strain.addNoise(ev);
  }
  /** Bring down every remaining section over `duration` seconds (idol collapse). */
  collapseAll(duration: number) {
    const left = this.strain.sections.filter((s) => s.state === 'stable');
    left.forEach((s, k) => this.schedule.push({ at: this.t + 1 + (k / Math.max(1, left.length)) * duration, id: s.id }));
  }
  fixedUpdate(dt: number) {
    this.t += dt;
    for (const s of this.schedule.filter((s) => s.at <= this.t)) this.strain.trigger(s.id);
    this.schedule = this.schedule.filter((s) => s.at > this.t);
    const { warnings, collapses } = this.strain.update(dt);
    for (const w of warnings) {
      const s = this.sections[w.id];
      this.ctx.sfx.play('woodCreak', new THREE.Vector3(w.x, s.y, w.z), 1, 0.4);
      this.ctx.sfx.play('crumble', new THREE.Vector3(w.x, s.y, w.z), 1);
      this.ctx.toast('The ceiling groans above you!', 'warn');
    }
    // warning sections drip dust
    this.dustT -= dt;
    if (this.dustT <= 0) {
      this.dustT = 0.1;
      for (const sec of this.strain.sections) {
        if (sec.state === 'warning' || (sec.state === 'stable' && sec.strain > sec.threshold * 0.6)) {
          const s = this.sections[sec.id];
          const p = new THREE.Vector3(s.x0 + Math.random() * (s.x1 - s.x0), s.y - 0.1, s.z0 + Math.random() * (s.z1 - s.z0));
          this.ctx.fx.dustBurst(p, sec.state === 'warning' ? 4 : 1, 0.5, true);
        }
      }
    }
    for (const c of collapses) this.collapse(c.id);
    // falling rocks
    const pl = this.ctx.player();
    const [p0, p1] = playerSegment(pl);
    for (const r of this.rocks) {
      r.t += dt;
      if (r.settled) continue;
      const t = r.body.translation();
      const v = r.body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      const c = new THREE.Vector3(t.x, t.y, t.z);
      if (sp > 4 && pl.mode !== 'dead' && segSegDist(c, c, p0, p1) < 0.7 + pl.radius) {
        const dmg = impactDamage(sp, r.mass);
        if (dmg > 0) {
          this.ctx.damage(dmg, 'Crushed by the falling ceiling');
          r.body.setLinvel({ x: v.x * 0.3, y: v.y * 0.3, z: v.z * 0.3 }, true);
        }
      }
      if ((r.body.isSleeping() || sp < 0.05) && r.t > 1.5) {
        r.settled = true;
        r.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        for (let k = 0; k < r.body.numColliders(); k++) r.body.collider(k).setCollisionGroups(GROUP_STATIC);
      }
      if (r.t > 8 && !r.settled) {
        r.settled = true;
        r.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        for (let k = 0; k < r.body.numColliders(); k++) r.body.collider(k).setCollisionGroups(GROUP_STATIC);
      }
    }
  }
  private collapse(i: number) {
    const s = this.sections[i];
    if (!s.body) return;
    this.collapsed.add(i);
    this.ctx.physics.removeBody(s.body);
    s.body = null;
    if (s.mesh) {
      for (let k = 0; k < 3; k++) (s.mesh.userData['crack' + k] as THREE.Object3D | undefined)?.removeFromParent();
      s.mesh.removeFromParent();
    }
    s.mesh = null;
    const c = new THREE.Vector3((s.x0 + s.x1) / 2, s.y, (s.z0 + s.z1) / 2);
    this.ctx.sfx.play('debris', c, 1.5);
    this.ctx.sfx.play('rumble', c, 1);
    this.ctx.shake(1.0);
    this.ctx.noise(c, 1.8, 'trap', false);
    for (let k = 0; k < 10; k++) {
      const r = 0.45 + Math.random() * 0.55;
      const p = new THREE.Vector3(s.x0 + 0.8 + Math.random() * (s.x1 - s.x0 - 1.6), s.y + 0.3 + Math.random() * 0.8, s.z0 + 0.8 + Math.random() * (s.z1 - s.z0 - 1.6));
      const body = this.rt.trackBody(this.ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setCanSleep(true)));
      const g = rockGeometry(r, Math.random() * 50, 0.7, 1);
      const hull = RAPIER.ColliderDesc.convexHull(new Float32Array((g.index ? g.toNonIndexed() : g).attributes.position.array as Float32Array));
      const mass = 2400 * (4 / 3) * Math.PI * r * r * r * 0.7;
      (hull ?? RAPIER.ColliderDesc.ball(r)).setMass(mass).setFriction(0.9).setCollisionGroups(GROUP_DEBRIS);
      this.ctx.physics.world.createCollider(hull ?? RAPIER.ColliderDesc.ball(r).setMass(mass).setCollisionGroups(GROUP_DEBRIS), body);
      body.setAngvel({ x: (Math.random() - 0.5) * 3, y: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3 }, true);
      const mesh = new THREE.Mesh(normalizeGeometry(g), this.ctx.mats.get('sandstone'));
      mesh.castShadow = mesh.receiveShadow = true;
      this.rt.group.add(mesh);
      this.ctx.physics.addSync(body, mesh);
      this.rocks.push({ body, mesh, mass, t: 0, settled: false });
    }
    for (let k = 0; k < 4; k++) this.ctx.fx.dustBurst(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, -1, (Math.random() - 0.5) * 8)), 25, 4, true);
  }
  dispose() {
    this.ctx.run.set('ceiling:' + this.id, [...this.collapsed]);
  }
}

function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Tripwire: a thin cord at shin height; walk through it and it snaps (once). Jump over it.

export class Tripwire implements Prop {
  tripped: boolean;
  private wire: THREE.Mesh;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, private a: THREE.Vector3, private b: THREE.Vector3, private onTrip: () => void) {
    this.tripped = !!ctx.run.get('tripwire:' + id);
    const len = a.distanceTo(b);
    this.wire = cylMesh(ctx.mats, 'rope', 0.008, 0.008, len, 4, 0xb8a888);
    segmentMatrix(a, b, _m);
    this.wire.matrixAutoUpdate = false;
    this.wire.matrix.copy(_m).multiply(new THREE.Matrix4().makeScale(1, 1 / len, 1));
    this.wire.castShadow = false;
    this.wire.visible = !this.tripped;
    rt.group.add(this.wire);
    for (const p of [a, b]) {
      const peg = boxMesh(ctx.mats, 'iron', 0.06, 0.06, 0.06, 1);
      peg.position.copy(p);
      rt.group.add(peg);
    }
  }
  fixedUpdate() {
    if (this.tripped) return;
    const pl = this.ctx.player();
    if (pl.mode === 'dead') return;
    const [p0, p1] = playerSegment(pl);
    if (segSegDist(this.a, this.b, p0, p1) < pl.radius + 0.02) {
      this.tripped = true;
      this.ctx.run.set('tripwire:' + this.id, true);
      this.wire.visible = false;
      this.ctx.sfx.play('plankCrack', this.a, 0.5);
      this.ctx.sfx.play('click', this.a, 1);
      this.onTrip();
    }
  }
  dispose() {}
}
