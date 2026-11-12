import * as THREE from 'three';
import { RAPIER } from '../world/Physics';
import type { SceneCtx, Interactable } from '../core/types';
import {
  tickCrack, newCrack, PLANK_CRACK_AT, PLANK_DROP_AT, CRUMBLE_SHAKE_AT, CRUMBLE_DROP_AT, type CrackState,
  tickPlate, newPlate, type PlateState, tickDart, DART_SPEED, DAMAGE, bladeAngle, tickPedestal, newPedestal, type PedestalState,
  sunTileSolid, tickInstability,
} from '../logic/traps';
import { LevelBuilder } from '../world/LevelBuilder';
import type { MatKey } from '../world/Materials';

export const GROUP_PLAYER = 0x0002;
/** membership 0x0004, collides with everything except the player */
export const GROUPS_NO_PLAYER = (0x0004 << 16) | (0xffff & ~GROUP_PLAYER);

const up = new THREE.Vector3(0, 1, 0);

function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(p, a).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

/** Distance from point p to the player's capsule axis. */
function distToPlayer(ctx: SceneCtx, p: THREE.Vector3): number {
  const pl = ctx.player;
  const a = new THREE.Vector3(pl.feet.x, pl.feet.y + 0.35, pl.feet.z);
  const b = new THREE.Vector3(pl.feet.x, pl.feet.y + pl.height - 0.35, pl.feet.z);
  return segDist(p, a, b);
}

function boxMesh(ctx: SceneCtx, sx: number, sy: number, sz: number, mat: MatKey | THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(LevelBuilder.boxGeo(sx, sy, sz, 2), typeof mat === 'string' ? ctx.mats.get(mat) : mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// =====================================================================================
/** Rope bridge: planks hang from the handrail ropes on rope joints. Each plank cracks and drops. */
export class RopeBridge {
  private anchor!: RAPIER.RigidBody;
  private planks: { body: RAPIER.RigidBody; col: RAPIER.Collider; mesh: THREE.Mesh; joints: RAPIER.ImpulseJoint[]; crack: CrackState; anchors: THREE.Vector3[]; dropT: number; gone: boolean }[] = [];
  private group = new THREE.Group();
  private hangers: THREE.LineSegments;
  private dropped: Set<number>;

  constructor(private ctx: SceneCtx, private id: string, private a: THREE.Vector3, private b: THREE.Vector3, private width = 1.6, private sag = 0.7) {
    this.dropped = new Set<number>(ctx.run().entities.get(id) ?? []);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(400 * 3), 3));
    this.hangers = new THREE.LineSegments(hg, new THREE.LineBasicMaterial({ color: 0x6a5434 }));
    this.hangers.frustumCulled = false;
  }

  attach() {
    const { ctx, a, b } = this;
    const w = ctx.physics.world;
    this.anchor = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector3().crossVectors(up, dir).normalize();
    const n = Math.max(6, Math.round(len / 0.62));
    const pitch = len / n;
    const plankDepth = pitch * 0.82;
    const yaw = Math.atan2(dir.x, dir.z);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    const deckAt = (t: number) => a.clone().lerp(b, t).add(new THREE.Vector3(0, -this.sag * 4 * t * (1 - t) - 0.06, 0));
    const railH = 1.0;
    // handrails (static tubes)
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        pts.push(deckAt(t).addScaledVector(side, (s * this.width) / 2).add(new THREE.Vector3(0, railH - (this.sag * 0.5) * 4 * t * (1 - t) * 0 , 0)));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.03, 5), ctx.mats.get('rope'));
      tube.castShadow = true;
      this.group.add(tube);
      // posts at both ends
      for (const end of [a, b]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.4, 8), ctx.mats.get('bark'));
        post.position.copy(end).addScaledVector(side, (s * this.width) / 2 + s * 0.1).add(new THREE.Vector3(0, 0.4, 0));
        post.castShadow = true;
        this.group.add(post);
      }
    }
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const c = deckAt(t);
      const mesh = boxMesh(ctx, this.width - 0.1, 0.08, plankDepth, 'wood');
      this.group.add(mesh);
      if (this.dropped.has(i)) { mesh.visible = false; this.planks.push({ body: null as any, col: null as any, mesh, joints: [], crack: { loadTime: 9, stage: 'dropped' }, anchors: [], dropT: 99, gone: true }); continue; }
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setLinearDamping(1.5).setAngularDamping(3));
      const col = w.createCollider(RAPIER.ColliderDesc.cuboid((this.width - 0.1) / 2, 0.04, plankDepth / 2).setDensity(5 / ((this.width - 0.1) * 0.08 * plankDepth)).setFriction(1), body);
      ctx.physics.tag(col, { kind: 'plank', ref: this });
      const joints: RAPIER.ImpulseJoint[] = [];
      const anchors: THREE.Vector3[] = [];
      for (const s of [-1, 1]) for (const f of [-1, 1]) {
        const local = new THREE.Vector3((s * (this.width - 0.1)) / 2, 0, (f * plankDepth) / 2);
        const world = local.clone().applyQuaternion(q).add(c);
        const anchorPt = world.clone().add(new THREE.Vector3(0, railH, 0));
        anchors.push(anchorPt);
        const jd = RAPIER.JointData.rope(railH + 0.01, { x: local.x, y: local.y, z: local.z }, { x: anchorPt.x, y: anchorPt.y, z: anchorPt.z });
        joints.push(w.createImpulseJoint(jd, body, this.anchor, true));
      }
      this.planks.push({ body, col, mesh, joints, crack: newCrack(), anchors, dropT: 0, gone: false });
    }
    this.group.add(this.hangers);
    ctx.scene.add(this.group);
  }

  detach() {
    this.ctx.run().entities.set(this.id, [...this.dropped]);
    for (const p of this.planks) if (p.body) this.ctx.physics.removeBody(p.body);
    this.ctx.physics.removeBody(this.anchor);
    this.ctx.scene.remove(this.group);
    this.planks = [];
  }

  update(dt: number) {
    const g = this.ctx.groundCollider();
    const pos = this.hangers.geometry.attributes.position as THREE.BufferAttribute;
    let k = 0;
    for (let i = 0; i < this.planks.length; i++) {
      const p = this.planks[i];
      if (p.gone) continue;
      const loaded = !!g && g === p.col;
      const r = tickCrack(p.crack, loaded, dt, PLANK_CRACK_AT, PLANK_DROP_AT);
      p.crack = r.state;
      const t = p.body.translation();
      const tp = new THREE.Vector3(t.x, t.y, t.z);
      if (r.event === 'crack') { this.ctx.audio.play('creak', tp, 0.8); this.ctx.noise(tp, 8); }
      if (r.event === 'drop') {
        this.ctx.audio.play('snap', tp, 1);
        this.ctx.noise(tp, 14);
        for (const j of p.joints) this.ctx.physics.world.removeImpulseJoint(j, true);
        p.joints = [];
        p.body.setLinearDamping(0.1);
        p.body.wakeUp();
        this.dropped.add(i);
      }
      if (p.crack.stage === 'dropped') {
        p.dropT += dt;
        if (p.dropT > 6) { this.ctx.physics.removeBody(p.body); p.mesh.visible = false; p.gone = true; continue; }
      }
      const q = p.body.rotation();
      p.mesh.position.copy(tp);
      p.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      if (p.crack.stage === 'cracking') p.mesh.position.y += (Math.random() - 0.5) * 0.03;
      if (p.joints.length) {
        for (let c = 0; c < 4; c++) {
          const s = c < 2 ? -1 : 1, f = c % 2 === 0 ? -1 : 1;
          const w = new THREE.Vector3((s * (this.width - 0.1)) / 2, 0, (f * 0.2)).applyQuaternion(p.mesh.quaternion).add(tp);
          const an = p.anchors[c];
          if (k < 398) { pos.setXYZ(k++, w.x, w.y, w.z); pos.setXYZ(k++, an.x, an.y, an.z); }
        }
      }
    }
    for (; k < 400; k++) pos.setXYZ(k, 0, -1000, 0);
    pos.needsUpdate = true;
  }
}

// =====================================================================================
export interface TileSpec { x: number; z: number; y: number; sx: number; sz: number }

/** Crumbling floor tiles: shake when stepped on, then fall. */
export class CrumbleFloor {
  private tiles: { spec: TileSpec; body: RAPIER.RigidBody | null; col: RAPIER.Collider | null; mesh: THREE.Mesh; crack: CrackState; t: number }[] = [];
  private dropped: Set<number>;
  constructor(private ctx: SceneCtx, private id: string, private specs: TileSpec[], private mat: MatKey = 'dungeonFloor') {
    this.dropped = new Set<number>(ctx.run().entities.get(id) ?? []);
  }
  attach() {
    const w = this.ctx.physics.world;
    this.specs.forEach((s, i) => {
      const mesh = boxMesh(this.ctx, s.sx - 0.04, 0.35, s.sz - 0.04, this.mat);
      mesh.position.set(s.x, s.y - 0.175, s.z);
      this.ctx.scene.add(mesh);
      if (this.dropped.has(i)) { mesh.visible = false; this.tiles.push({ spec: s, body: null, col: null, mesh, crack: { loadTime: 9, stage: 'dropped' }, t: 99 }); return; }
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(s.x, s.y - 0.175, s.z));
      const col = w.createCollider(RAPIER.ColliderDesc.cuboid(s.sx / 2 - 0.02, 0.175, s.sz / 2 - 0.02).setDensity(800), body);
      this.ctx.physics.tag(col, { kind: 'crumble', ref: this });
      this.tiles.push({ spec: s, body, col, mesh, crack: newCrack(), t: 0 });
    });
  }
  detach() {
    this.ctx.run().entities.set(this.id, [...this.dropped]);
    for (const t of this.tiles) { if (t.body) this.ctx.physics.removeBody(t.body); this.ctx.scene.remove(t.mesh); }
    this.tiles = [];
  }
  update(dt: number) {
    const g = this.ctx.groundCollider();
    this.tiles.forEach((t, i) => {
      if (!t.body) return;
      const r = tickCrack(t.crack, g === t.col, dt, CRUMBLE_SHAKE_AT, CRUMBLE_DROP_AT);
      t.crack = r.state;
      const p = t.body.translation();
      const tp = new THREE.Vector3(p.x, p.y, p.z);
      if (r.event === 'crack') { this.ctx.audio.play('crumble', tp, 0.7); this.ctx.noise(tp, 6); }
      if (r.event === 'drop') {
        t.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        t.body.setAngvel({ x: Math.random() - 0.5, y: 0, z: Math.random() - 0.5 }, true);
        this.ctx.audio.play('crumble', tp, 1);
        this.ctx.noise(tp, 12);
        this.dropped.add(i);
      }
      if (t.crack.stage === 'dropped') {
        t.t += dt;
        if (t.t > 5) { this.ctx.physics.removeBody(t.body); t.body = null; t.col = null; t.mesh.visible = false; return; }
      }
      const q = t.body.rotation();
      t.mesh.position.copy(tp);
      t.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      if (t.crack.stage === 'cracking') { t.mesh.position.x += (Math.random() - 0.5) * 0.05; t.mesh.position.z += (Math.random() - 0.5) * 0.05; }
    });
  }
}

// =====================================================================================
/** Sunstone tiles: solid only while the real sun reaches them. Zone B only. */
export class SunTiles {
  private tiles: { spec: TileSpec; body: RAPIER.RigidBody; col: RAPIER.Collider; mesh: THREE.Mesh; solid: boolean; glow: number }[] = [];
  private t = 0;
  private solidMat: THREE.MeshStandardMaterial;
  private weakMat: THREE.MeshStandardMaterial;
  constructor(private ctx: SceneCtx, private specs: TileSpec[]) {
    const base = ctx.mats.get('sunTile');
    this.solidMat = base.clone();
    this.solidMat.emissive = new THREE.Color(0x6a4a10);
    this.solidMat.emissiveIntensity = 0.6;
    this.weakMat = base.clone();
    this.weakMat.color = new THREE.Color(0x4a4238);
    this.weakMat.transparent = true;
    this.weakMat.opacity = 0.45;
  }
  attach() {
    const w = this.ctx.physics.world;
    for (const s of this.specs) {
      const mesh = boxMesh(this.ctx, s.sx - 0.06, 0.3, s.sz - 0.06, this.solidMat);
      mesh.position.set(s.x, s.y - 0.15, s.z);
      this.ctx.scene.add(mesh);
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(s.x, s.y - 0.15, s.z));
      const col = w.createCollider(RAPIER.ColliderDesc.cuboid(s.sx / 2 - 0.03, 0.15, s.sz / 2 - 0.03), body);
      this.ctx.physics.tag(col, { kind: 'sunTile', ref: this });
      this.tiles.push({ spec: s, body, col, mesh, solid: true, glow: 1 });
    }
    this.refresh(true);
  }
  detach() {
    for (const t of this.tiles) { this.ctx.physics.removeBody(t.body); this.ctx.scene.remove(t.mesh); }
    this.tiles = [];
  }
  private refresh(force = false) {
    const night = this.ctx.isNight();
    for (const t of this.tiles) {
      const lit = this.ctx.sunlit(new THREE.Vector3(t.spec.x, t.spec.y + 0.15, t.spec.z));
      const solid = sunTileSolid(lit, night);
      if (solid !== t.solid || force) {
        t.solid = solid;
        t.col.setEnabled(solid);
        t.mesh.material = solid ? this.solidMat : this.weakMat;
        if (!force && !solid) this.ctx.audio.play('crumble', new THREE.Vector3(t.spec.x, t.spec.y, t.spec.z), 0.35);
      }
    }
  }
  update(dt: number) {
    this.t += dt;
    if (this.t > 0.25) { this.t = 0; this.refresh(); }
  }
  count() { return this.tiles.filter((t) => t.solid).length; }
}

// =====================================================================================
/** Pressure plate. Weighs the player and props on it. */
export class PressurePlate {
  state: PlateState = newPlate();
  mesh: THREE.Mesh;
  private min: THREE.Vector3;
  private max: THREE.Vector3;
  constructor(private ctx: SceneCtx, public x: number, public z: number, public y: number, public sx: number, public sz: number, public threshold: number, public onDown: () => void, public onUp: () => void = () => {}, mat: MatKey = 'carved') {
    this.mesh = boxMesh(ctx, sx, 0.12, sz, mat);
    this.mesh.position.set(x, y + 0.02, z);
    this.min = new THREE.Vector3(x - sx / 2, y - 0.3, z - sz / 2);
    this.max = new THREE.Vector3(x + sx / 2, y + 1.6, z + sz / 2);
  }
  attach() { this.ctx.scene.add(this.mesh); }
  detach() { this.ctx.scene.remove(this.mesh); }
  measure(): number {
    let m = this.ctx.props.massIn(this.min, this.max);
    const f = this.ctx.player.feet;
    if (this.ctx.player.grounded && f.x >= this.min.x - 0.2 && f.x <= this.max.x + 0.2 && f.z >= this.min.z - 0.2 && f.z <= this.max.z + 0.2 && Math.abs(f.y - this.y) < 0.5) m += this.ctx.playerMass();
    return m;
  }
  update(dt: number) {
    const r = tickPlate(this.state, this.measure(), this.threshold, dt);
    this.state = r.state;
    const target = this.y + (this.state.pressed ? -0.03 : 0.02);
    this.mesh.position.y += (target - this.mesh.position.y) * Math.min(1, dt * 10);
    if (r.event === 'down') { this.ctx.audio.play('click', this.mesh.position, 0.8); this.onDown(); }
    if (r.event === 'up') { this.ctx.audio.play('click', this.mesh.position, 0.4); this.onUp(); }
  }
}

// =====================================================================================
/** A sliding stone gate/portcullis. open: 0 closed, 1 open. */
export class Gate {
  body!: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  open = 0;
  target = 0;
  private wasMoving = false;
  dir = new THREE.Vector3(0, 1, 0);
  constructor(private ctx: SceneCtx, public id: string, public pos: THREE.Vector3, public size: THREE.Vector3, public rise: number, public speed = 1.2, mat: MatKey = 'carved', public persist = true, dir?: THREE.Vector3) {
    if (dir) this.dir.copy(dir);
    this.mesh = boxMesh(ctx, size.x, size.y, size.z, mat);
    const saved = persist ? ctx.run().entities.get(id) : undefined;
    if (saved !== undefined) { this.open = saved.open; this.target = saved.target; }
  }
  attach() {
    const p = this.current();
    this.body = this.ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z));
    const col = this.ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(this.size.x / 2, this.size.y / 2, this.size.z / 2), this.body);
    this.ctx.physics.tag(col, { kind: 'gate', ref: this });
    this.mesh.position.copy(p);
    this.ctx.scene.add(this.mesh);
  }
  detach() {
    if (this.persist) this.ctx.run().entities.set(this.id, { open: this.open, target: this.target });
    this.ctx.physics.removeBody(this.body);
    this.ctx.scene.remove(this.mesh);
  }
  current() { return this.pos.clone().addScaledVector(this.dir, this.rise * this.open); }
  set(target: number) { this.target = target; }
  update(dt: number) {
    const d = this.target - this.open;
    const moving = Math.abs(d) > 1e-3;
    if (moving) {
      this.open += Math.sign(d) * Math.min(Math.abs(d), (this.speed * dt) / Math.abs(this.rise));
      if (!this.wasMoving) this.ctx.audio.play('grind', this.pos, 1);
    }
    if (!moving && this.wasMoving) this.ctx.audio.play('thud', this.pos, 0.8);
    this.wasMoving = moving;
    const p = this.current();
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
    this.mesh.position.copy(p);
  }
}

// =====================================================================================
interface Dart { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; life: number }
/** Wall-mounted dart launchers fired by pressure plates or pedestal traps. */
export class DartTraps {
  launchers: { pos: THREE.Vector3; dir: THREE.Vector3; cooldown: number }[] = [];
  private darts: Dart[] = [];
  private geo = new THREE.CylinderGeometry(0.008, 0.008, 0.28, 4).rotateX(Math.PI / 2);
  constructor(private ctx: SceneCtx) {}
  add(pos: THREE.Vector3, dir: THREE.Vector3) { this.launchers.push({ pos, dir: dir.clone().normalize(), cooldown: 0 }); return this.launchers.length - 1; }
  fire(indices?: number[]) {
    const list = indices ?? this.launchers.map((_, i) => i);
    for (const i of list) {
      const l = this.launchers[i];
      const r = tickDart(l, true, 0);
      l.cooldown = r.state.cooldown;
      if (!r.fire) continue;
      const mesh = new THREE.Mesh(this.geo, this.ctx.mats.get('iron'));
      mesh.position.copy(l.pos);
      mesh.lookAt(l.pos.clone().add(l.dir));
      this.ctx.scene.add(mesh);
      // aim a little at the player when close (darts are triggered by them)
      const v = l.dir.clone().multiplyScalar(DART_SPEED);
      const to = this.ctx.playerCenter().add(new THREE.Vector3(0, 0.25, 0)).sub(l.pos);
      if (to.length() < 18) {
        const aim = to.normalize();
        if (aim.dot(l.dir) > 0.9) v.copy(l.dir).lerp(aim, 0.75).normalize().multiplyScalar(DART_SPEED); // within ~25°: leans toward where you stand now
      }
      this.darts.push({ mesh, pos: l.pos.clone(), vel: v, life: 2.5 });
      this.ctx.audio.play('dart', l.pos, 0.9);
    }
  }
  update(dt: number) {
    for (const l of this.launchers) l.cooldown = Math.max(0, l.cooldown - dt);
    for (let i = this.darts.length - 1; i >= 0; i--) {
      const d = this.darts[i];
      const step = d.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const hit = this.ctx.physics.raycast(d.pos, step.clone().normalize(), len, this.ctx.player.collider, (c) => this.ctx.physics.infoOf(c)?.kind !== 'prop');
      d.pos.add(step);
      d.mesh.position.copy(d.pos);
      d.life -= dt;
      const mid = d.pos.clone().addScaledVector(step, -0.5);
      if (distToPlayer(this.ctx, d.pos) < 0.42 || distToPlayer(this.ctx, mid) < 0.42) {
        this.ctx.damage(DAMAGE.dart, 'a poisoned dart', d.vel.clone().normalize().multiplyScalar(1.5));
        this.ctx.audio.play('hit', d.pos, 1);
        this.kill(i);
        continue;
      }
      if (hit || d.life <= 0) {
        if (hit) this.ctx.audio.play('tick', d.pos, 0.4);
        this.kill(i);
      }
    }
  }
  private kill(i: number) { this.ctx.scene.remove(this.darts[i].mesh); this.darts.splice(i, 1); }
  detach() { for (let i = this.darts.length - 1; i >= 0; i--) this.kill(i); }
}

// =====================================================================================
/** Swinging pendulum blade. Damage + knockback when the blade sweeps through you. */
export class Blade {
  group = new THREE.Group();
  private arm = new THREE.Group();
  private cool = 0;
  private lastAngle = 0;
  private whooshed = false;
  constructor(private ctx: SceneCtx, public pivot: THREE.Vector3, public length: number, public axis: 'x' | 'z', public amplitude = 1.1, public period = 2.4, public phase = 0) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, length, 6), ctx.mats.get('iron'));
    rod.position.y = -length / 2;
    const bladeShape = new THREE.Shape();
    bladeShape.absarc(0, 0, 0.9, Math.PI * 1.15, Math.PI * 1.85, false);
    bladeShape.lineTo(0, -0.35);
    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.03, bevelEnabled: false });
    bladeGeo.translate(0, 0, -0.015);
    const blade = new THREE.Mesh(bladeGeo, ctx.mats.get('iron'));
    blade.position.y = -length + 0.4;
    if (axis === 'z') blade.rotation.y = Math.PI / 2;
    for (const m of [rod, blade]) { m.castShadow = true; this.arm.add(m); }
    this.group.add(this.arm);
    this.group.position.copy(pivot);
  }
  attach() { this.ctx.scene.add(this.group); }
  detach() { this.ctx.scene.remove(this.group); }
  update(dt: number) {
    const ang = bladeAngle(this.ctx.time(), this.amplitude, this.period, this.phase);
    if (this.axis === 'x') this.arm.rotation.x = ang; else this.arm.rotation.z = ang;
    const tip = new THREE.Vector3(0, -this.length, 0).applyEuler(this.arm.rotation).add(this.pivot);
    const mid = new THREE.Vector3(0, -this.length + 0.7, 0).applyEuler(this.arm.rotation).add(this.pivot);
    const d = Math.min(distToPlayer(this.ctx, tip), distToPlayer(this.ctx, mid), distToPlayer(this.ctx, tip.clone().lerp(mid, 0.5)));
    const speed = Math.abs(ang - this.lastAngle) / Math.max(dt, 1e-4);
    if (Math.abs(ang) < 0.2 && !this.whooshed) { this.ctx.audio.play('swoosh', tip, 0.6); this.whooshed = true; }
    if (Math.abs(ang) > 0.5) this.whooshed = false;
    this.cool -= dt;
    if (d < 0.5 && this.cool <= 0 && speed > 0.4) {
      this.cool = 1;
      const knock = this.axis === 'x' ? new THREE.Vector3(0, 0.3, Math.sign(ang - this.lastAngle) * -6) : new THREE.Vector3(Math.sign(ang - this.lastAngle) * 6, 0.3, 0);
      this.ctx.damage(DAMAGE.blade, 'a swinging blade', knock);
      this.ctx.audio.play('hit', tip, 1);
    }
    this.lastAngle = ang;
  }
}

// =====================================================================================
/** Rolling boulder released by a plate. Passes through the player collider; damage is explicit. */
export class Boulder {
  body: RAPIER.RigidBody | null = null;
  mesh: THREE.Mesh;
  released = false;
  private cool = 0;
  private rollT = 0;
  constructor(private ctx: SceneCtx, private id: string, public start: THREE.Vector3, public radius: number, public launch: THREE.Vector3) {
    const g = new THREE.IcosahedronGeometry(radius, 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const k = 0.94 + 0.06 * Math.sin(i * 1.7); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
    g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, ctx.mats.get('rock'));
    this.mesh.castShadow = true;
    const saved = ctx.run().entities.get(id);
    if (saved) { this.released = true; this.start = new THREE.Vector3(...(saved.pos as [number, number, number])); }
  }
  attach() {
    const w = this.ctx.physics.world;
    const desc = this.released ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed();
    this.body = w.createRigidBody(desc.setTranslation(this.start.x, this.start.y, this.start.z).setAngularDamping(0.2).setLinearDamping(0.05));
    const col = w.createCollider(RAPIER.ColliderDesc.ball(this.radius).setDensity(2400).setFriction(0.9).setRestitution(0.05).setCollisionGroups(GROUPS_NO_PLAYER), this.body);
    this.ctx.physics.tag(col, { kind: 'boulder', ref: this });
    this.ctx.scene.add(this.mesh);
  }
  detach() {
    if (this.body) {
      const t = this.body.translation();
      if (this.released) this.ctx.run().entities.set(this.id, { pos: [t.x, t.y, t.z] });
      this.ctx.physics.removeBody(this.body);
    }
    this.body = null;
    this.ctx.scene.remove(this.mesh);
  }
  release() {
    if (this.released || !this.body) return;
    this.released = true;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setLinvel({ x: this.launch.x, y: this.launch.y, z: this.launch.z }, true);
    this.ctx.audio.play('boulder', this.start, 1);
    this.ctx.shake(0.4);
    this.ctx.noise(this.start, 30);
  }
  update(dt: number) {
    if (!this.body) return;
    const t = this.body.translation(), q = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    if (!this.released) return;
    const v = this.body.linvel();
    const sp = Math.hypot(v.x, v.y, v.z);
    this.cool -= dt;
    const c = new THREE.Vector3(t.x, t.y, t.z);
    if (sp > 1.5) {
      this.rollT += dt;
      if (this.rollT > 0.5) { this.rollT = 0; this.ctx.audio.play('rumble', c, Math.min(1, sp / 8)); this.ctx.shake(Math.min(0.25, 2 / Math.max(2, c.distanceTo(this.ctx.player.feet)))); }
    }
    if (sp > 2 && this.cool <= 0 && distToPlayer(this.ctx, c) < this.radius + 0.35) {
      this.cool = 1.2;
      const knock = new THREE.Vector3(v.x, 0, v.z).normalize().multiplyScalar(9).setY(2);
      this.ctx.damage(DAMAGE.boulder, 'a rolling boulder', knock);
      this.ctx.audio.play('hit', c, 1);
    }
  }
}

// =====================================================================================
/** Weighs what sits on a pedestal; fires its trap once if the weight changes too much. */
export class Pedestal {
  state: PedestalState;
  mesh: THREE.Mesh;
  min: THREE.Vector3;
  max: THREE.Vector3;
  private measured = false;
  constructor(private ctx: SceneCtx, public id: string, public top: THREE.Vector3, public onFire: () => void, mat: MatKey = 'carved') {
    this.mesh = boxMesh(ctx, 0.8, top.y - (top.y - 1.1), 0.8, mat);
    this.mesh.scale.y = 1;
    this.mesh.geometry = LevelBuilder.boxGeo(0.8, 1.1, 0.8, 2);
    this.mesh.position.set(top.x, top.y - 0.55, top.z);
    this.min = new THREE.Vector3(top.x - 0.42, top.y - 0.05, top.z - 0.42);
    this.max = new THREE.Vector3(top.x + 0.42, top.y + 0.9, top.z + 0.42);
    const saved = ctx.run().entities.get(id);
    this.state = saved ?? newPedestal(0);
    if (saved) this.measured = true;
  }
  attach() {
    this.ctx.scene.add(this.mesh);
    const body = this.ctx.physics.fixedBody();
    this.ctx.physics.addBox(body, { pos: this.mesh.position.clone(), half: new THREE.Vector3(0.4, 0.55, 0.4) });
    this.body = body;
  }
  private body: RAPIER.RigidBody | null = null;
  detach() {
    this.ctx.run().entities.set(this.id, this.state);
    this.ctx.scene.remove(this.mesh);
    this.ctx.physics.removeBody(this.body);
  }
  massNow() { return this.ctx.props.massIn(this.min, this.max); }
  update(dt: number) {
    if (!this.measured) {
      // let the relic settle a few frames first
      this.state = newPedestal(this.massNow());
      if (this.state.original > 0) this.measured = true;
      return;
    }
    const r = tickPedestal(this.state, this.massNow(), dt);
    this.state = r.state;
    if (r.fire) { this.ctx.audio.play('click', this.top, 1); this.onFire(); }
  }
}

// =====================================================================================
/** Falling ceiling debris driven by noise (instability). Optionally a scripted collapse. */
export class Debris {
  level = 0;
  collapse = 0;
  private rocks: { body: RAPIER.RigidBody; mesh: THREE.Mesh; t: number; hit: boolean }[] = [];
  private geo = new THREE.DodecahedronGeometry(1, 0);
  constructor(private ctx: SceneCtx, public zones: { min: THREE.Vector3; max: THREE.Vector3; ceiling: number }[]) {}
  addNoise(n: number) { this.level += n; }
  private inZone(p: THREE.Vector3) {
    return this.zones.find((z) => p.x >= z.min.x && p.x <= z.max.x && p.z >= z.min.z && p.z <= z.max.z && p.y >= z.min.y && p.y <= z.max.y);
  }
  spawnRock(at: THREE.Vector3, size: number) {
    const w = this.ctx.physics.world;
    const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setAngvel({ x: Math.random() * 3, y: Math.random() * 3, z: Math.random() * 3 }));
    const col = w.createCollider(RAPIER.ColliderDesc.ball(size * 0.8).setDensity(2200).setRestitution(0.2), body);
    this.ctx.physics.tag(col, { kind: 'debris' });
    const mesh = new THREE.Mesh(this.geo, this.ctx.mats.get('rock'));
    mesh.scale.setScalar(size);
    mesh.castShadow = true;
    this.ctx.scene.add(mesh);
    this.rocks.push({ body, mesh, t: 0, hit: false });
  }
  update(dt: number) {
    const pc = this.ctx.player.feet;
    const z = this.inZone(pc);
    if (z) {
      const r = tickInstability(this.level, 0, dt);
      this.level = r.level;
      if (r.drop) {
        this.ctx.audio.play('crumble', pc, 1);
        this.ctx.shake(0.25);
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) this.spawnRock(new THREE.Vector3(pc.x + (Math.random() - 0.5) * 3, z.ceiling - 0.6, pc.z + (Math.random() - 0.5) * 3), 0.25 + Math.random() * 0.25);
      }
    } else this.level = Math.max(0, this.level - dt * 0.2);
    if (this.collapse > 0) {
      this.collapse -= dt;
      if (Math.random() < dt * 6) {
        const zz = this.zones[Math.floor(Math.random() * this.zones.length)];
        const p = new THREE.Vector3(THREE.MathUtils.lerp(zz.min.x, zz.max.x, Math.random()), zz.ceiling - 0.5, THREE.MathUtils.lerp(zz.min.z, zz.max.z, Math.random()));
        if (Math.random() < 0.35) p.set(pc.x + (Math.random() - 0.5) * 6, zz.ceiling - 0.5, pc.z + (Math.random() - 0.5) * 6);
        this.spawnRock(p, 0.3 + Math.random() * 0.5);
      }
      if (Math.random() < dt * 2) { this.ctx.audio.play('rumble', pc, 0.8); this.ctx.shake(0.3); }
    }
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      r.t += dt;
      const t = r.body.translation(), q = r.body.rotation(), v = r.body.linvel();
      r.mesh.position.set(t.x, t.y, t.z);
      r.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      const p = new THREE.Vector3(t.x, t.y, t.z);
      if (!r.hit && v.y < -4 && distToPlayer(this.ctx, p) < 0.7 + r.mesh.scale.x) {
        r.hit = true;
        this.ctx.damage(DAMAGE.debris, 'falling masonry');
        this.ctx.audio.play('hit', p, 1);
      }
      if (!r.hit && Math.abs(v.y) < 0.5 && r.t > 0.4 && r.t < 0.6) { this.ctx.audio.play('thud', p, 0.7); this.ctx.noise(p, 10); }
      if (r.t > 10) { this.ctx.physics.removeBody(r.body); this.ctx.scene.remove(r.mesh); this.rocks.splice(i, 1); }
    }
  }
  detach() {
    for (const r of this.rocks) { this.ctx.physics.removeBody(r.body); this.ctx.scene.remove(r.mesh); }
    this.rocks = [];
  }
}

// =====================================================================================
/** Pull lever. */
export class Lever implements Interactable {
  group = new THREE.Group();
  private handle: THREE.Mesh;
  pulled = false;
  radius = 2.2;
  constructor(private ctx: SceneCtx, public id: string, public pos: THREE.Vector3, rotY: number, private label: string, private onPull: () => void, private canPull: () => string | null = () => null) {
    const base = boxMesh(ctx, 0.5, 0.6, 0.3, 'carved');
    base.position.y = 0.3;
    this.handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), ctx.mats.get('bronze'));
    this.handle.geometry.translate(0, 0.45, 0);
    this.handle.position.set(0, 0.55, 0);
    this.handle.rotation.x = -0.7;
    this.handle.castShadow = true;
    this.group.add(base, this.handle);
    this.group.position.copy(pos);
    this.group.rotation.y = rotY;
    this.pulled = !!ctx.run().entities.get(id);
    if (this.pulled) this.handle.rotation.x = 0.7;
  }
  attach() { this.ctx.scene.add(this.group); }
  detach() { this.ctx.run().entities.set(this.id, this.pulled); this.ctx.scene.remove(this.group); }
  prompt() {
    if (this.pulled) return null;
    const block = this.canPull();
    return block ?? `E: pull lever (${this.label})`;
  }
  act() {
    if (this.pulled || this.canPull()) return;
    this.pulled = true;
    this.handle.rotation.x = 0.7;
    this.ctx.audio.play('clunk', this.pos, 1);
    this.onPull();
  }
}
