/**
 * One guardian: a rigged procedural body, a kinematic capsule the player bumps into, a brain
 * from logic/guardians.ts, and navmesh path following with periodic repaths. The director
 * gathers perception and hands it in; this class turns decisions into motion and animation.
 */
import * as THREE from 'three';
import { RAPIER, type Physics } from '../physics/Physics';
import { GROUP_GUARDIAN } from '../config';
import type { Materials } from '../render/materials';
import { createBrain, type Brain, type Decision, type GuardianKind, type Perception, type V3 } from '../logic/guardians';
import type { NavMesh, NavPoly } from '../logic/navmesh';
import { polyHeight } from '../logic/navmesh';
import { buildGuardian, type GuardianRig } from './guardianMeshes';

const SIZES: Record<GuardianKind, { r: number; half: number }> = {
  sentinel: { r: 0.45, half: 0.8 },
  crawler: { r: 0.45, half: 0.05 },
  shadow: { r: 0.35, half: 0.7 },
};

export class Guardian {
  brain: Brain;
  rig: GuardianRig;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  pos = new THREE.Vector3();
  yaw = 0;
  /** Set by the director when it is time to wake (schedule, noise, a stolen Heart). */
  awake = false;
  decision: Decision | null = null;
  path: V3[] | null = null;
  private pathIdx = 0;
  private repathT = 0;
  private lastTarget: V3 | null = null;
  private stuckT = 0;
  private lastPos = new THREE.Vector3();
  private stride = 0;
  private anim = 0;
  private vy = 0;
  speedNow = 0;
  callT = 3 + Math.random() * 4;
  dark = false;
  /** Seconds of the "waking" shudder (stone cracking off). */
  private shudder = 0;

  constructor(public kind: GuardianKind, public spawn: string, pos: THREE.Vector3, yaw: number, mats: Materials, private physics: Physics, root: THREE.Object3D) {
    this.brain = createBrain(kind);
    this.rig = buildGuardian(kind, mats);
    this.rig.root.name = 'guardian:' + kind;
    root.add(this.rig.root);
    this.pos.copy(pos);
    this.lastPos.copy(pos);
    this.yaw = yaw;
    const s = SIZES[kind];
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + s.half + s.r, pos.z));
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(s.half, s.r).setCollisionGroups(GROUP_GUARDIAN), this.body);
    physics.setOwner(this.collider, { kind: 'guardian', surface: 'stone' });
    this.applyPose(0);
  }

  get state() {
    return this.brain.state;
  }
  get eye(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.rig.eyeHeight, this.pos.z);
  }
  get active(): boolean {
    return this.brain.state !== 'dormant' && this.brain.state !== 'waking';
  }
  get radius() {
    return SIZES[this.kind].r;
  }

  think(p: Perception): Decision {
    const d = this.brain.update(p);
    if (d.cue === 'wake') this.shudder = this.kind === 'sentinel' ? 2.4 : 0.8;
    this.decision = d;
    return d;
  }

  /** Follow the navmesh toward the decision target. */
  move(dt: number, nav: NavMesh, avoid: ((p: NavPoly) => number) | null, others: Guardian[]) {
    const d = this.decision;
    this.shudder = Math.max(0, this.shudder - dt);
    if (!d || !d.target || d.speed <= 0 || !this.active) {
      this.speedNow = 0;
      this.applyPose(dt);
      return;
    }
    // repath when the target moves, on a timer, or when the path runs out
    this.repathT -= dt;
    const tgt = d.target;
    const moved = !this.lastTarget || Math.hypot(tgt[0] - this.lastTarget[0], tgt[2] - this.lastTarget[2]) > 1.0;
    if (!this.path || this.pathIdx >= this.path.length || this.repathT <= 0 || moved) {
      this.repathT = d.state === 'chase' || d.state === 'hunt' || d.state === 'strike' ? 0.35 : 0.9;
      this.lastTarget = [...tgt] as V3;
      // partial: with a gate shut between us and the target, go as close as the mesh allows
      this.path = nav.findPath([this.pos.x, this.pos.y, this.pos.z], tgt, avoid ? { cost: avoid, partial: true } : { partial: true });
      this.pathIdx = 1;
    }
    let wx: number;
    let wz: number;
    if (this.path && this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx];
      wx = wp[0];
      wz = wp[2];
      if (Math.hypot(wx - this.pos.x, wz - this.pos.z) < 0.35) {
        this.pathIdx++;
        if (this.pathIdx < this.path.length) {
          wx = this.path[this.pathIdx][0];
          wz = this.path[this.pathIdx][2];
        }
      }
    } else {
      // no path: shuffle straight at the target if it is close (last few metres)
      wx = tgt[0];
      wz = tgt[2];
      if (Math.hypot(wx - this.pos.x, wz - this.pos.z) > 5) {
        this.speedNow = 0;
        this.applyPose(dt);
        return;
      }
    }
    let dx = wx - this.pos.x;
    let dz = wz - this.pos.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) {
      dx /= len;
      dz /= len;
    }
    // separation from the others
    for (const o of others) {
      if (o === this) continue;
      const ox = this.pos.x - o.pos.x;
      const oz = this.pos.z - o.pos.z;
      const ol = Math.hypot(ox, oz);
      const min = this.radius + o.radius + 0.3;
      if (ol > 1e-3 && ol < min && Math.abs(this.pos.y - o.pos.y) < 2) {
        dx += (ox / ol) * (min - ol) * 1.5;
        dz += (oz / ol) * (min - ol) * 1.5;
      }
    }
    const l2 = Math.hypot(dx, dz) || 1;
    const step = Math.min(len, d.speed * dt);
    const nx = this.pos.x + (dx / l2) * step;
    const nz = this.pos.z + (dz / l2) * step;
    // stay on the mesh: the new spot must be on an enabled polygon close in height
    let mx = nx;
    let mz = nz;
    let poly = nav.findPoly(mx, this.pos.y + 0.5, mz, 1.2);
    if (!poly && this.path && nav.findPoly(this.pos.x, this.pos.y + 0.5, this.pos.z, 1.2)) {
      // the straight step clips the corner of a doorway (the polygons are axis-aligned
      // rectangles and a funnel corner can sit just past one): slide along one axis toward the
      // waypoint instead of standing there for the rest of the night
      const ex = wx - this.pos.x;
      const ez = wz - this.pos.z;
      const sx = Math.sign(ex) * Math.min(step, Math.abs(ex));
      const sz = Math.sign(ez) * Math.min(step, Math.abs(ez));
      const tries: [number, number][] = Math.abs(ex) >= Math.abs(ez) ? [[sx, 0], [0, sz]] : [[0, sz], [sx, 0]];
      for (const [ox, oz] of tries) {
        if (Math.abs(ox) + Math.abs(oz) < 1e-5) continue;
        const p = nav.findPoly(this.pos.x + ox, this.pos.y + 0.5, this.pos.z + oz, 1.2);
        if (p) {
          poly = p;
          mx = this.pos.x + ox;
          mz = this.pos.z + oz;
          break;
        }
      }
    }
    if (poly) {
      this.pos.x = mx;
      this.pos.z = mz;
      const gy = polyHeight(poly, mx, mz);
      this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 12);
      this.vy = 0;
    } else if (!this.path || !nav.findPoly(this.pos.x, this.pos.y + 0.5, this.pos.z, 1.2)) {
      // no path, or standing off the mesh (a statue stepping down from its plinth): walk freely,
      // easing down toward the floor of the first waypoint
      if (this.path && this.pathIdx < this.path.length) this.pos.y += (this.path[this.pathIdx][1] - this.pos.y) * Math.min(1, dt * 3);
      this.pos.x = nx;
      this.pos.z = nz;
    } else {
      this.repathT = 0;
    }
    const want = Math.atan2(dx, dz);
    let dy = want - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * (this.kind === 'sentinel' ? 4 : 9));
    this.speedNow = step / Math.max(dt, 1e-4);
    // stuck: barely moving while trying to
    if (this.pos.distanceTo(this.lastPos) < 0.02 * dt * 60 && d.speed > 0.5) {
      this.stuckT += dt;
      if (this.stuckT > 1.2) {
        this.stuckT = 0;
        this.path = null;
        this.repathT = 0;
      }
    } else this.stuckT = 0;
    this.lastPos.copy(this.pos);
    this.applyPose(dt);
  }

  /** Teleport (spawn, debug). */
  place(p: THREE.Vector3, yaw = this.yaw) {
    this.pos.copy(p);
    this.lastPos.copy(p);
    this.yaw = yaw;
    this.path = null;
    this.applyPose(0);
  }

  private applyPose(dt: number) {
    const s = SIZES[this.kind];
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + s.half + s.r, z: this.pos.z });
    const root = this.rig.root;
    root.position.copy(this.pos);
    root.rotation.y = this.yaw;
    const j = this.rig.joints;
    const sp = this.speedNow;
    this.anim += dt * (0.6 + sp * (this.kind === 'crawler' ? 2.2 : 1.6));
    const a = this.anim;
    if (this.kind === 'sentinel') {
      const swing = Math.min(0.55, sp * 0.22);
      j.legL.rotation.x = Math.sin(a) * swing;
      j.legR.rotation.x = -Math.sin(a) * swing;
      if (this.active) {
        j.armL.rotation.x = -Math.sin(a) * swing * 0.7 - (this.decision?.state === 'chase' ? 0.7 : 0);
        j.armR.rotation.x = Math.sin(a) * swing * 0.7 - (this.decision?.state === 'chase' ? 0.7 : 0);
      }
      j.body.position.y = Math.abs(Math.cos(a)) * swing * 0.06;
      if (this.shudder > 0) {
        j.body.position.x = (Math.random() - 0.5) * 0.04 * this.shudder;
        j.head.rotation.y = Math.sin(this.shudder * 9) * 0.2;
      } else j.body.position.x = 0;
    } else if (this.kind === 'crawler') {
      const amp = Math.min(0.6, 0.1 + sp * 0.1);
      for (let i = 0; i < 6; i++) {
        const leg = j['leg' + i];
        if (!leg) continue;
        const ph = a * 2 + (i % 2) * Math.PI + Math.floor(i / 2) * 0.9;
        leg.rotation.y = Math.sin(ph) * amp * (i % 2 ? -1 : 1);
        leg.rotation.z = Math.max(0, Math.cos(ph)) * amp * 0.5 * (i % 2 ? -1 : 1);
      }
      j.body.position.y = 0.55 + Math.sin(a * 4) * 0.03;
      j.tail.rotation.y = Math.sin(a * 1.3) * 0.4;
      const hunting = this.decision?.state === 'hunt';
      j.jaw.rotation.x = hunting ? 0.35 + Math.sin(a * 6) * 0.1 : 0.05;
      j.head.rotation.y = Math.sin(a * 0.7) * (hunting ? 0.1 : 0.35);
    } else {
      j.body.position.y = 0.08 + Math.sin(a * 1.4) * 0.06;
      const striking = this.decision?.state === 'strike';
      j.armL.rotation.x = striking ? -1.4 : Math.sin(a * 0.9) * 0.15;
      j.armR.rotation.x = striking ? -1.4 : -Math.sin(a * 0.9) * 0.15;
      j.head.rotation.x = striking ? -0.2 : 0.15;
    }
    // footfalls for sound (sentinel and crawler)
    this.stride += sp * dt;
  }

  /** True once per stride (for footstep sounds). */
  takeStride(len: number): boolean {
    if (this.stride >= len) {
      this.stride = 0;
      return true;
    }
    return false;
  }

  dispose() {
    this.rig.root.removeFromParent();
    this.physics.removeBody(this.body);
  }
}
