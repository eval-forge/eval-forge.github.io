/**
 * First-person player: Rapier kinematic character controller with sprint, crouch, jump,
 * vine/rope climbing, ledge mantling, wading and swimming, platform riding (rope bridges),
 * pushing heavy blocks, and a physics grab/carry/throw for loose objects.
 */
import * as THREE from 'three';
import { RAPIER, type Physics } from '../physics/Physics';
import type { RunState } from '../game/RunState';
import type { Input } from '../core/Input';
import type { Climbable, WaterVolume, KillVolume } from '../world/types';
import {
  WALK_SPEED, SPRINT_SPEED, CROUCH_SPEED, CLIMB_SPEED, SWIM_SPEED, PLAYER_GRAVITY, JUMP_COST, MANTLE_COST,
  SPRINT_DRAIN, CLIMB_DRAIN, SWIM_DRAIN, MAX_LIFT_MASS, loadSpeedFactor, staminaDrainMultiplier, jumpVelocity,
} from '../logic/playerStats';
import type { MoveMode } from '../logic/noise';
import { GROUP_PLAYER, GROUP_HELD, GROUP_PROP, G, groups, FIXED_DT } from '../config';
import { PLAYER_BODY_MASS } from '../logic/traps';

export interface PlayerHost {
  physics: Physics;
  run: RunState;
  input: Input;
  climbables(): Climbable[];
  waters(): WaterVolume[];
  kills(): KillVolume[];
  loadFraction(): number;
  footstep(mode: MoveMode, surface: string, pos: THREE.Vector3): void;
  landed(impactSpeed: number, pos: THREE.Vector3): void;
  killVolume(k: KillVolume): void;
  stepOn(c: RAPIER.Collider, mass: number, dt: number): void;
  windAccel(pos: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
  toast(text: string, kind?: string): void;
  grabbed(body: RAPIER.RigidBody): void;
  released(body: RAPIER.RigidBody, thrown: boolean): void;
}

export interface Held {
  body: RAPIER.RigidBody;
  mass: number;
  savedGroups: number[];
  /** Seconds the object has trailed too far behind the hold point (snagged on something). */
  far: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _wind = new THREE.Vector3();

export class Player {
  readonly radius = 0.35;
  readonly standHalf = 0.525;
  readonly crouchHalf = 0.2;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  kcc: RAPIER.KinematicCharacterController;
  pos = new THREE.Vector3();
  prevPos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  crouching = false;
  crouchBlend = 0;
  grounded = false;
  groundCollider: RAPIER.Collider | null = null;
  groundSurface = 'stone';
  mode: 'walk' | 'climb' | 'mantle' | 'swim' | 'dead' | 'frozen' = 'walk';
  climbing: Climbable | null = null;
  private mantle: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null = null;
  jumpBuffer = 0;
  coyote = 0;
  private wasGrounded = false;
  private airVy = 0;
  private stride = 0;
  private platformVel = new THREE.Vector3();
  sprinting = false;
  moveMode: MoveMode = 'walk';
  held: Held | null = null;
  waterDepth = 0;
  waterSurface = -Infinity;
  inWater: WaterVolume | null = null;
  torchSubmerged = false;
  camera: THREE.PerspectiveCamera;
  shake = 0;
  private bobPhase = 0;
  private landDip = 0;
  private killCooldown = 0;
  speedNow = 0;
  /** Extra movement multiplier (relighting the torch, kicking). */
  slow = 1;
  private crouchWanted = false;
  private sprintWanted = false;

  constructor(private host: PlayerHost, camera: THREE.PerspectiveCamera, spawn: THREE.Vector3) {
    this.camera = camera;
    const w = host.physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + this.standHalf + this.radius, spawn.z));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(this.standHalf, this.radius).setCollisionGroups(GROUP_PLAYER).setFriction(0), this.body);
    host.physics.setOwner(this.collider, { kind: 'player' });
    this.kcc = w.createCharacterController(0.02);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.enableAutostep(0.42, 0.18, false);
    this.kcc.enableSnapToGround(0.35);
    this.kcc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.kcc.setSlideEnabled(true);
    this.kcc.setApplyImpulsesToDynamicBodies(false);
    this.kcc.setCharacterMass(PLAYER_BODY_MASS);
    this.pos.copy(spawn).y += this.standHalf + this.radius;
    this.prevPos.copy(this.pos);
  }

  get halfHeight() {
    return this.crouching ? this.crouchHalf : this.standHalf;
  }
  get feetY() {
    return this.pos.y - this.halfHeight - this.radius;
  }
  get feet(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.feetY, this.pos.z);
  }
  /** Eye height above the feet. */
  get eyeHeight() {
    return 1.62 - (1.62 - 1.0) * this.crouchBlend;
  }
  get torchHeight() {
    return this.crouching ? 0.85 : 1.35;
  }
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  lookDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  teleport(feet: THREE.Vector3, yaw?: number) {
    this.pos.set(feet.x, feet.y + this.halfHeight + this.radius, feet.z);
    this.prevPos.copy(this.pos);
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.vel.set(0, 0, 0);
    this.mode = 'walk';
    this.climbing = null;
    this.mantle = null;
    if (yaw !== undefined) this.yaw = yaw;
  }

  /** Per-frame: look, buffered actions, held states. */
  frameUpdate(dt: number, input: Input) {
    if (this.mode === 'dead' || this.mode === 'frozen') return;
    this.yaw -= input.lookX;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - input.lookY));
    if (input.pressed('jump')) this.jumpBuffer = 0.16;
    this.crouchWanted = input.isHeld('crouch');
    this.sprintWanted = input.isHeld('sprint');
  }

  private setCrouch(want: boolean): boolean {
    if (want === this.crouching) return true;
    if (want) {
      const feet = this.feetY;
      this.crouching = true;
      this.collider.setHalfHeight(this.crouchHalf);
      this.pos.y = feet + this.crouchHalf + this.radius;
      return true;
    }
    // standing up needs headroom
    const feet = this.feetY;
    const center = new THREE.Vector3(this.pos.x, feet + this.standHalf + this.radius + 0.02, this.pos.z);
    const shape = new RAPIER.Capsule(this.standHalf, this.radius - 0.02);
    let blocked = false;
    this.host.physics.world.intersectionsWithShape(
      { x: center.x, y: center.y, z: center.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      (c) => {
        if (c.handle === this.collider.handle) return true;
        if (this.held && c.parent()?.handle === this.held.body.handle) return true;
        blocked = true;
        return false;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(G.PLAYER, G.STATIC | G.PROP),
    );
    if (blocked) return false;
    this.crouching = false;
    this.collider.setHalfHeight(this.standHalf);
    this.pos.y = feet + this.standHalf + this.radius;
    return true;
  }

  private predicate = (c: RAPIER.Collider) => {
    if (this.held && c.parent()?.handle === this.held.body.handle) return false;
    return true;
  };

  private moveKCC(desired: THREE.Vector3) {
    this.kcc.computeColliderMovement(this.collider, { x: desired.x, y: desired.y, z: desired.z }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G.PLAYER, G.STATIC | G.PROP | G.GUARDIAN), this.predicate);
    const m = this.kcc.computedMovement();
    this.pos.x += m.x;
    this.pos.y += m.y;
    this.pos.z += m.z;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    return m;
  }

  fixedUpdate(dt: number) {
    this.prevPos.copy(this.pos);
    this.killCooldown = Math.max(0, this.killCooldown - dt);
    if (this.mode === 'dead' || this.mode === 'frozen') {
      this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
      this.updateHeld(dt);
      return;
    }
    const run = this.host.run;
    const lf = this.host.loadFraction();
    const drainMul = staminaDrainMultiplier(lf);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);

    // water
    this.inWater = null;
    this.waterSurface = -Infinity;
    for (const w of this.host.waters()) {
      if (this.pos.x >= w.box.min.x && this.pos.x <= w.box.max.x && this.pos.z >= w.box.min.z && this.pos.z <= w.box.max.z && this.feetY < w.surface + 0.05 && this.feetY > w.box.min.y - 2) {
        this.inWater = w;
        this.waterSurface = w.surface;
      }
    }
    this.waterDepth = this.inWater ? Math.max(0, this.waterSurface - this.feetY) : 0;
    const swimming = this.waterDepth > 1.45;
    // a swimmer has no hand free to hold the flame clear of the water
    this.torchSubmerged = this.inWater !== null && (swimming || this.feetY + this.torchHeight < this.waterSurface - 0.02);

    if (this.mode === 'mantle') {
      this.updateMantle(dt);
      this.updateHeld(dt);
      return;
    }

    this.setCrouch(this.crouchWanted && !swimming);
    this.crouchBlend += ((this.crouching ? 1 : 0) - this.crouchBlend) * Math.min(1, dt * 12);

    const input = this.host.input;
    const fwd = this.forward(_a);
    const right = _b.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = _c.set(0, 0, 0).addScaledVector(fwd, input.moveY).addScaledVector(right, input.moveX);
    const moving = wish.lengthSq() > 0.01;

    if (this.mode === 'climb') {
      this.updateClimb(dt, input, lf, drainMul);
      this.updateHeld(dt);
      return;
    }

    // speed selection
    const canSprint = this.sprintWanted && input.moveY > 0.2 && !this.crouching && run.stamina.canSprint() && !swimming && this.grounded;
    this.sprinting = canSprint && moving;
    this.moveMode = this.crouching ? 'crouch' : this.sprinting ? 'sprint' : 'walk';
    let speed = swimming ? SWIM_SPEED : this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    speed *= loadSpeedFactor(lf) * this.slow;
    if (this.inWater && !swimming) speed *= 1 - 0.45 * Math.min(1, this.waterDepth / 1.2);
    if (this.sprinting) run.stamina.drain(SPRINT_DRAIN * drainMul, dt);
    if (swimming) run.stamina.drain(SWIM_DRAIN * drainMul * (moving ? 1 : 0.4), dt);

    // horizontal velocity
    const tx = wish.x * speed;
    const tz = wish.z * speed;
    const accel = this.grounded || swimming ? 42 : 10;
    const dvx = tx - this.vel.x;
    const dvz = tz - this.vel.z;
    const dvl = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dvl > maxDv) {
      this.vel.x += (dvx / dvl) * maxDv;
      this.vel.z += (dvz / dvl) * maxDv;
    } else {
      this.vel.x = tx;
      this.vel.z = tz;
    }

    // vertical
    if (swimming) {
      const dive = this.crouchWanted ? 2.2 : 1.32;
      const targetFeet = this.waterSurface - dive;
      this.vel.y += ((targetFeet - this.feetY) * 4 - this.vel.y) * Math.min(1, dt * 4);
      this.mode = 'swim';
    } else {
      if (this.mode === 'swim') this.mode = 'walk';
      this.vel.y -= PLAYER_GRAVITY * dt;
      if (this.inWater) this.vel.y = Math.max(this.vel.y, -6);
    }

    // mantle / climb / jump
    // mantling also gets a swimmer out over a sheer edge (the flooded chamber's channel)
    if (this.jumpBuffer > 0 && this.tryMantle(lf)) return;
    if (this.tryClimb(wish, moving)) return;
    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0) && !swimming) {
      if (run.stamina.spend(JUMP_COST * drainMul)) {
        this.vel.y = jumpVelocity(lf);
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
      }
    }

    // external pushes: wind (a push velocity, so gusts really shove you; crouch to brace) and water current
    this.host.windAccel(this.pos, _wind);
    const desired = new THREE.Vector3(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    if (_wind.lengthSq() > 0) {
      const k = (this.crouching ? 0.3 : 1) * (this.grounded ? 1 : 1.3) * (1 - 0.35 * Math.min(1, lf));
      desired.x += _wind.x * dt * k;
      desired.z += _wind.z * dt * k;
    }
    if (this.inWater && this.inWater.flow.lengthSq() > 0) desired.addScaledVector(this.inWater.flow, dt * Math.min(1, this.waterDepth / 0.8));
    desired.addScaledVector(this.platformVel, dt);

    const before = this.pos.clone();
    const m = this.moveKCC(desired);
    const grounded = this.kcc.computedGrounded();
    this.speedNow = Math.hypot(m.x, m.z) / dt;

    // pushes against dynamic bodies
    for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
      const col = this.kcc.computedCollision(i);
      const c = col?.collider;
      const b = c?.parent();
      if (!b || !b.isDynamic()) continue;
      const owner = this.host.physics.ownerOf(c);
      const n = col!.normal1;
      if (n.y > 0.6) continue; // standing on it
      const dir = _a.set(desired.x, 0, desired.z);
      if (dir.lengthSq() < 1e-8) continue;
      dir.normalize();
      const mass = b.mass();
      if (owner && owner.kind === 'pushBlock') {
        const v = b.linvel();
        const along = v.x * dir.x + v.z * dir.z;
        const target = 1.25 * loadSpeedFactor(lf);
        const dv = Math.max(0, target - along);
        b.applyImpulse({ x: dir.x * dv * mass * 0.5, y: 0, z: dir.z * dv * mass * 0.5 }, true);
      } else {
        const k = Math.min(mass, 30) * 0.9 * dt * 60 * 0.05;
        b.applyImpulse({ x: dir.x * k, y: 0.02 * k, z: dir.z * k }, true);
      }
    }

    // vertical reconcile
    if (this.vel.y > 0 && m.y < desired.y - 1e-3) this.vel.y = 0; // bumped head
    if (grounded) {
      if (!this.wasGrounded && this.airVy < -2) this.host.landed(-this.airVy, this.feet);
      if (this.vel.y < 0) this.vel.y = 0;
      this.coyote = 0.12;
    } else {
      this.airVy = this.vel.y;
    }
    // horizontal speed follows what actually happened (no wall sticking)
    const actualVx = (this.pos.x - before.x) / dt - this.platformVel.x;
    const actualVz = (this.pos.z - before.z) / dt - this.platformVel.z;
    if (Math.abs(actualVx) < Math.abs(this.vel.x)) this.vel.x = actualVx;
    if (Math.abs(actualVz) < Math.abs(this.vel.z)) this.vel.z = actualVz;
    if (this.wasGrounded && !grounded && this.vel.y <= 0) this.coyote = 0.12;
    this.grounded = grounded;
    this.wasGrounded = grounded;

    this.probeGround(dt);

    // footsteps
    if (this.grounded && this.speedNow > 0.4) {
      const strideLen = this.moveMode === 'sprint' ? 1.9 : this.moveMode === 'crouch' ? 0.9 : 1.35;
      this.stride += this.speedNow * dt;
      this.bobPhase += (this.speedNow * dt * Math.PI) / strideLen;
      if (this.stride >= strideLen) {
        this.stride = 0;
        this.host.footstep(this.moveMode, this.inWater ? 'water' : this.groundSurface, this.feet);
      }
    } else if (this.inWater && swimming && this.speedNow > 0.3) {
      this.stride += this.speedNow * dt;
      if (this.stride > 1.6) {
        this.stride = 0;
        this.host.footstep('walk', 'water', this.feet);
      }
    }

    // kill volumes
    for (const k of this.host.kills()) {
      if (k.box.containsPoint(this.pos) && this.killCooldown <= 0) {
        this.killCooldown = 1;
        this.host.killVolume(k);
        break;
      }
    }
    this.updateHeld(dt);
  }

  /** Find what we stand on: platform carry, weight on dynamic bodies, step triggers. */
  private probeGround(dt: number) {
    this.platformVel.set(0, 0, 0);
    this.groundCollider = null;
    if (!this.grounded) return;
    const ph = this.host.physics;
    const origin = new THREE.Vector3(this.pos.x, this.feetY + 0.2, this.pos.z);
    let hit = ph.raycast(origin, new THREE.Vector3(0, -1, 0), 0.6, groups(G.PLAYER, G.STATIC | G.PROP), this.collider, undefined, this.predicate);
    if (!hit) {
      // edges: try a few offsets under the capsule
      for (const [ox, oz] of [[0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]]) {
        hit = ph.raycast(origin.clone().add(new THREE.Vector3(ox, 0, oz)), new THREE.Vector3(0, -1, 0), 0.6, groups(G.PLAYER, G.STATIC | G.PROP), this.collider, undefined, this.predicate);
        if (hit) break;
      }
    }
    if (!hit) return;
    this.groundCollider = hit.collider;
    const owner = ph.ownerOf(hit.collider);
    this.groundSurface = (owner?.surface as string) ?? 'stone';
    const b = hit.collider.parent();
    const totalMass = PLAYER_BODY_MASS + this.host.run.satchel.weight + (this.held?.mass ?? 0);
    this.host.stepOn(hit.collider, totalMass, dt);
    if (b && (b.isDynamic() || b.isKinematic())) {
      const v = b.linvel();
      const w = b.angvel();
      const t = b.translation();
      const r = new THREE.Vector3(hit.point.x - t.x, hit.point.y - t.y, hit.point.z - t.z);
      const wv = new THREE.Vector3(w.x, w.y, w.z).cross(r);
      // rope-bridge planks swing under your own push: ride them down, but do not let their
      // sway carry you backwards (that made the last steep planks a treadmill)
      const swinging = owner?.kind === 'plank';
      this.platformVel.set(swinging ? 0 : v.x + wv.x, Math.min(0, v.y + wv.y), swinging ? 0 : v.z + wv.z);
      if (b.isDynamic()) {
        const k = swinging ? 0.4 : 0.6;
        b.applyImpulseAtPoint({ x: 0, y: -totalMass * 12 * dt * k, z: 0 }, { x: hit.point.x, y: hit.point.y, z: hit.point.z }, true);
      }
    }
  }

  private tryMantle(lf: number): boolean {
    const ph = this.host.physics;
    const fwd = this.forward(new THREE.Vector3());
    const feet = this.feetY;
    const chest = new THREE.Vector3(this.pos.x, feet + 1.0, this.pos.z);
    const filter = groups(G.PLAYER, G.STATIC | G.PROP);
    const wall = ph.raycast(chest, fwd, this.radius + 0.75, filter, this.collider, undefined, this.predicate);
    let probeBase: THREE.Vector3;
    if (wall) {
      if (Math.abs(wall.normal.y) > 0.5) return false;
      probeBase = wall.point.clone().addScaledVector(fwd, 0.35);
    } else {
      // low obstacles (waist height) are found by a lower ray
      const low = ph.raycast(new THREE.Vector3(this.pos.x, feet + 0.55, this.pos.z), fwd, this.radius + 0.6, filter, this.collider, undefined, this.predicate);
      if (!low || Math.abs(low.normal.y) > 0.5) return false;
      probeBase = low.point.clone().addScaledVector(fwd, 0.35);
    }
    const top = ph.raycast(new THREE.Vector3(probeBase.x, feet + 2.55, probeBase.z), new THREE.Vector3(0, -1, 0), 2.3, filter, this.collider, undefined, this.predicate);
    if (!top || top.normal.y < 0.7) return false;
    const rise = top.point.y - feet;
    if (rise < 0.45 || rise > 2.35) return false;
    const owner = ph.ownerOf(top.collider);
    if (owner?.noMantle) return false;
    // destination must be clear
    const half = this.standHalf;
    const dest = new THREE.Vector3(top.point.x, top.point.y + half + this.radius + 0.05, top.point.z).addScaledVector(fwd, 0.15);
    let blocked = false;
    ph.world.intersectionsWithShape(
      { x: dest.x, y: dest.y, z: dest.z },
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Capsule(half, this.radius - 0.03),
      (c) => {
        if (c.handle === this.collider.handle) return true;
        blocked = true;
        return false;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      filter,
    );
    if (blocked) {
      // try crouched
      const cdest = new THREE.Vector3(dest.x, top.point.y + this.crouchHalf + this.radius + 0.05, dest.z);
      blocked = false;
      ph.world.intersectionsWithShape(
        { x: cdest.x, y: cdest.y, z: cdest.z },
        { x: 0, y: 0, z: 0, w: 1 },
        new RAPIER.Capsule(this.crouchHalf, this.radius - 0.03),
        (c) => {
          if (c.handle === this.collider.handle) return true;
          blocked = true;
          return false;
        },
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        filter,
      );
      if (blocked) return false;
      this.setCrouch(true);
      dest.copy(cdest);
    }
    const run = this.host.run;
    if (rise > 1.1 && !run.stamina.spend(MANTLE_COST * staminaDrainMultiplier(lf))) {
      this.host.toast('Too tired to climb');
      this.jumpBuffer = 0;
      return false;
    }
    if (!this.crouching) this.setCrouch(false);
    this.mode = 'mantle';
    this.mantle = { from: this.pos.clone(), to: dest, t: 0, dur: (rise > 1.1 ? 0.5 : 0.28) * (1 + 0.4 * Math.min(1, lf)) };
    this.jumpBuffer = 0;
    this.vel.set(0, 0, 0);
    return true;
  }

  private updateMantle(dt: number) {
    const m = this.mantle!;
    m.t += dt / m.dur;
    const t = Math.min(1, m.t);
    // rise first, then move over the edge
    const ty = Math.min(1, t * 1.6);
    const th = Math.max(0, (t - 0.35) / 0.65);
    const ey = 1 - (1 - ty) * (1 - ty);
    const eh = th * th * (3 - 2 * th);
    this.pos.set(m.from.x + (m.to.x - m.from.x) * eh, m.from.y + (m.to.y - m.from.y) * ey, m.from.z + (m.to.z - m.from.z) * eh);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    if (t >= 1) {
      this.mode = 'walk';
      this.mantle = null;
      this.vel.set(0, 0, 0);
      this.grounded = true;
      this.wasGrounded = true;
    }
  }

  private tryClimb(wish: THREE.Vector3, moving: boolean): boolean {
    if (!moving && this.jumpBuffer <= 0) return false;
    for (const c of this.host.climbables()) {
      if (!c.enabled) continue;
      const b = c.box;
      const pad = this.radius + 0.35;
      if (this.pos.x < b.min.x - pad || this.pos.x > b.max.x + pad || this.pos.z < b.min.z - pad || this.pos.z > b.max.z + pad) continue;
      if (this.feetY > b.max.y - 0.2 || this.pos.y + 0.6 < b.min.y) continue;
      const into = -wish.dot(c.normal);
      const lookInto = -this.lookDir(new THREE.Vector3()).dot(c.normal);
      if ((into > 0.35 && lookInto > -0.2) || (this.jumpBuffer > 0 && !this.grounded && lookInto > 0.2)) {
        if (this.host.run.stamina.exhausted) {
          this.host.toast('Too tired to climb');
          return false;
        }
        this.mode = 'climb';
        this.climbing = c;
        this.vel.set(0, 0, 0);
        this.jumpBuffer = 0;
        return true;
      }
    }
    return false;
  }

  private updateClimb(dt: number, input: Input, lf: number, drainMul: number) {
    const c = this.climbing!;
    const run = this.host.run;
    if (this.jumpBuffer > 0) {
      // push off the wall
      this.jumpBuffer = 0;
      this.mode = 'walk';
      this.climbing = null;
      this.vel.copy(c.normal).multiplyScalar(3.5);
      this.vel.y = 3.5;
      return;
    }
    const along = new THREE.Vector3().crossVectors(UP, c.normal).normalize();
    const speed = CLIMB_SPEED * loadSpeedFactor(lf);
    const up = input.moveY * speed;
    const side = -input.moveX * speed * 0.6;
    const moving = Math.abs(input.moveY) + Math.abs(input.moveX) > 0.1;
    run.stamina.drain(CLIMB_DRAIN * drainMul * (moving ? 1 : 0.35), dt);
    if (run.stamina.value <= 0) {
      this.mode = 'walk';
      this.climbing = null;
      this.host.toast('Your grip fails!', 'bad');
      return;
    }
    const desired = new THREE.Vector3().addScaledVector(UP, up * dt).addScaledVector(along, side * dt).addScaledVector(c.normal, -0.6 * dt);
    const m = this.moveKCC(desired);
    this.speedNow = Math.hypot(m.x, m.y, m.z) / dt;
    if (moving) {
      this.stride += this.speedNow * dt;
      if (this.stride > 0.9) {
        this.stride = 0;
        this.host.footstep('crouch', c.kind === 'rope' ? 'rope' : 'vine', this.feet);
      }
    }
    // top: mantle over
    if (input.moveY > 0.2 && this.feetY > c.box.max.y - 1.6) {
      if (this.tryMantle(lf)) {
        this.climbing = null;
        return;
      }
    }
    // left the climbable or reached the ground going down
    const b = c.box;
    const pad = this.radius + 0.5;
    const outside = this.pos.x < b.min.x - pad || this.pos.x > b.max.x + pad || this.pos.z < b.min.z - pad || this.pos.z > b.max.z + pad || this.feetY > b.max.y + 0.3 || this.pos.y < b.min.y - 0.5;
    if (outside || (input.moveY < -0.2 && this.kcc.computedGrounded())) {
      this.mode = 'walk';
      this.climbing = null;
      this.vel.set(0, 0, 0);
    }
  }

  // ---- held objects --------------------------------------------------------

  grab(body: RAPIER.RigidBody): boolean {
    if (this.held) return false;
    const mass = body.mass();
    if (mass > MAX_LIFT_MASS) {
      this.host.toast('Too heavy to lift. Push it instead.');
      return false;
    }
    const saved: number[] = [];
    for (let i = 0; i < body.numColliders(); i++) {
      const c = body.collider(i);
      saved.push(c.collisionGroups());
      if (!c.isSensor()) c.setCollisionGroups(GROUP_HELD);
    }
    body.setAngularDamping(4);
    body.wakeUp();
    this.held = { body, mass, savedGroups: saved, far: 0 };
    this.host.grabbed(body);
    return true;
  }

  release(throwIt: boolean) {
    const h = this.held;
    if (!h) return;
    this.held = null;
    if (!h.body.isValid()) return;
    for (let i = 0; i < h.body.numColliders(); i++) {
      const c = h.body.collider(i);
      if (!c.isSensor()) c.setCollisionGroups(h.savedGroups[i] ?? GROUP_PROP);
    }
    h.body.setAngularDamping(0.4);
    if (throwIt) {
      const dir = this.lookDir(new THREE.Vector3());
      const speed = Math.min(15, 60 / Math.max(1, h.mass)) + 3;
      const v = h.body.linvel();
      h.body.setLinvel({ x: dir.x * speed + v.x * 0.2, y: dir.y * speed + 1.2 + v.y * 0.2, z: dir.z * speed + v.z * 0.2 }, true);
      h.body.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 }, true);
    }
    this.host.released(h.body, throwIt);
  }

  /** Remove the held body reference without restoring (it was stashed or destroyed). */
  forgetHeld() {
    this.held = null;
  }

  private updateHeld(dt: number) {
    const h = this.held;
    if (!h) return;
    if (!h.body.isValid()) {
      this.held = null;
      return;
    }
    const eye = new THREE.Vector3(this.pos.x, this.feetY + this.eyeHeight, this.pos.z);
    const dir = this.lookDir(new THREE.Vector3());
    let dist = 1.3 + Math.min(0.6, h.mass * 0.03);
    const hit = this.host.physics.raycast(eye, dir, dist + 0.3, groups(G.PLAYER, G.STATIC), this.collider);
    if (hit) dist = Math.max(0.45, hit.toi - 0.3);
    const target = eye.addScaledVector(dir, dist);
    target.y -= 0.15;
    const t = h.body.translation();
    const dx = target.x - t.x;
    const dy = target.y - t.y;
    const dz = target.z - t.z;
    const d = Math.hypot(dx, dy, dz);
    // a quick turn swings the object round behind you for a moment; only let go of it when it
    // stays snagged (behind a wall, under a door) for a while
    h.far = d > 2.6 ? h.far + dt : 0;
    if (h.far > 0.35 || d > 6) {
      this.release(false);
      return;
    }
    const k = 16 / (1 + h.mass * 0.04);
    let vx = dx * k;
    let vy = dy * k;
    let vz = dz * k;
    const vl = Math.hypot(vx, vy, vz);
    const maxV = 14;
    if (vl > maxV) {
      vx *= maxV / vl;
      vy *= maxV / vl;
      vz *= maxV / vl;
    }
    h.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    const w = h.body.angvel();
    h.body.setAngvel({ x: w.x * 0.8, y: w.y * 0.8, z: w.z * 0.8 }, true);
    void dt;
  }

  // ---- camera ------------------------------------------------------------------

  updateCamera(alpha: number, dt: number, fovBase: number) {
    const p = new THREE.Vector3().lerpVectors(this.prevPos, this.pos, alpha);
    const feet = p.y - this.halfHeight - this.radius;
    let y = feet + this.eyeHeight;
    const moving = this.grounded && this.speedNow > 0.5;
    const bobAmp = moving ? (this.sprinting ? 0.05 : 0.03) : 0;
    const bob = Math.sin(this.bobPhase * 2) * bobAmp;
    const sway = Math.cos(this.bobPhase) * bobAmp * 0.6;
    this.landDip *= Math.exp(-dt * 8);
    y += bob - this.landDip;
    this.camera.position.set(p.x + Math.cos(this.yaw) * sway, y, p.z - Math.sin(this.yaw) * sway);
    let sx = 0;
    let sy = 0;
    if (this.shake > 0.001) {
      sx = (Math.random() - 0.5) * this.shake * 0.08;
      sy = (Math.random() - 0.5) * this.shake * 0.08;
      this.shake *= Math.exp(-dt * 3.5);
    }
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch + sy, this.yaw + sx, 0);
    const fov = fovBase + (this.sprinting ? 6 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }
  }

  dip(amount: number) {
    this.landDip = Math.min(0.35, this.landDip + amount);
  }

  dispose() {
    this.host.physics.world.removeCharacterController(this.kcc);
    this.host.physics.removeBody(this.body);
  }
}

export { FIXED_DT };
