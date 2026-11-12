import * as THREE from 'three';
import { RAPIER, type Physics } from '../world/Physics';
import type { Input } from '../core/Input';
import type { ClimbVolume, WaterVolume } from '../world/LevelBuilder';
import { inAABB } from '../world/LevelBuilder';
import { clamp } from '../logic/vec';

export interface PlayerEnv {
  climbs(): ClimbVolume[];
  waters(): WaterVolume[];
  speedMult(): number;
  staminaDrainMult(): number;
  climbMult(): number;
  maxStamina(): number;
  stamina: { get(): number; set(v: number): void };
  canAct(): boolean;
  ignoreCollider(c: RAPIER.Collider): boolean;
  onLand(height: number): void;
  onStep(loudness: number, inWater: boolean): void;
  onJump(): void;
  onGround(c: RAPIER.Collider | null): void;
  onPush(body: RAPIER.RigidBody, dir: THREE.Vector3): boolean;
}

const RADIUS = 0.35;
const HH_STAND = 0.55;
const HH_CROUCH = 0.2;
const EYE_STAND = 1.65;
const EYE_CROUCH = 0.95;
const GRAVITY = 20;

export class Player {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  feet = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  grounded = false;
  crouched = false;
  climbing: ClimbVolume | null = null;
  inWater: WaterVolume | null = null;
  sprinting = false;
  moving = false;
  eyeHeight = EYE_STAND;
  private airMaxY = 0;
  private wasGrounded = true;
  private staminaIdle = 0;
  private stepDist = 0;
  private mantle: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
  bob = 0;
  external = new THREE.Vector3(); // wind / knockback velocity, decays
  slowFactor = 1; // relighting etc.
  frozen = false;
  private tmp = new THREE.Vector3();

  constructor(private physics: Physics, private input: Input, private env: PlayerEnv) {
    const w = physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 5, 0));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(HH_STAND, RADIUS).setFriction(0), this.body);
    physics.tag(this.collider, { kind: 'player' });
    this.controller = w.createCharacterController(0.03);
    this.controller.enableAutostep(0.45, 0.25, false);
    this.controller.enableSnapToGround(0.35);
    this.controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(30);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
  }

  get halfHeight() { return this.crouched ? HH_CROUCH : HH_STAND; }
  get center() { return new THREE.Vector3(this.feet.x, this.feet.y + RADIUS + this.halfHeight, this.feet.z); }
  get height() { return 2 * (RADIUS + this.halfHeight); }
  eye(out = new THREE.Vector3()) { return out.set(this.feet.x, this.feet.y + this.eyeHeight + Math.sin(this.bob) * 0.035, this.feet.z); }
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  teleport(p: THREE.Vector3, yaw?: number) {
    this.feet.copy(p);
    this.vel.set(0, 0, 0);
    this.external.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    this.airMaxY = p.y;
    this.mantle = null;
    this.climbing = null;
    const c = this.center;
    this.body.setTranslation({ x: c.x, y: c.y, z: c.z }, true);
    this.body.setNextKinematicTranslation({ x: c.x, y: c.y, z: c.z });
  }

  look(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, -1.5, 1.5);
  }

  private setCrouch(c: boolean) {
    if (c === this.crouched) return;
    if (!c) {
      // need headroom to stand
      const top = this.feet.y + 2 * (RADIUS + HH_CROUCH) - 0.05;
      const hit = this.physics.raycast(new THREE.Vector3(this.feet.x, top, this.feet.z), new THREE.Vector3(0, 1, 0), 2 * (HH_STAND - HH_CROUCH) + 0.1, this.collider, (col) => !this.env.ignoreCollider(col));
      if (hit) return;
    }
    this.crouched = c;
    this.collider.setHalfHeight(c ? HH_CROUCH : HH_STAND);
  }

  private findClimb(): ClimbVolume | null {
    const c = this.center;
    for (const v of this.env.climbs()) if (inAABB(c, v, 0.45)) return v;
    return null;
  }

  private findWater(): WaterVolume | null {
    for (const w of this.env.waters()) if (inAABB(this.feet, w, 0.05)) return w;
    return null;
  }

  /** Try to pull up onto a ledge in front of us. */
  private tryMantle(): boolean {
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const chest = new THREE.Vector3(this.feet.x, this.feet.y + 1.0, this.feet.z);
    const hit = this.physics.raycast(chest, fwd, 0.9, this.collider, (col) => !this.env.ignoreCollider(col));
    if (!hit) return false;
    const probe = hit.point.clone().addScaledVector(fwd, 0.45);
    probe.y = this.feet.y + 2.4;
    const down = this.physics.raycast(probe, new THREE.Vector3(0, -1, 0), 2.2, this.collider, (col) => !this.env.ignoreCollider(col));
    if (!down) return false;
    const rise = down.point.y - this.feet.y;
    if (rise < 0.5 || rise > 2.25 || down.normal.y < 0.7) return false;
    // headroom above the ledge
    const head = this.physics.raycast(down.point.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0, 1, 0), 1.2, this.collider);
    if (head) return false;
    this.mantle = { from: this.feet.clone(), to: down.point.clone().add(new THREE.Vector3(0, 0.02, 0)), t: 0 };
    this.vel.set(0, 0, 0);
    this.env.stamina.set(Math.max(0, this.env.stamina.get() - 8));
    return true;
  }

  update(dt: number) {
    const inp = this.input;
    const act = this.env.canAct() && !this.frozen;

    // ------------------------------------------------ mantle animation
    if (this.mantle) {
      const m = this.mantle;
      m.t += dt / 0.42;
      const t = Math.min(1, m.t);
      const up = Math.min(1, t * 1.6);
      const fw = Math.max(0, (t - 0.35) / 0.65);
      this.feet.set(m.from.x + (m.to.x - m.from.x) * fw, m.from.y + (m.to.y - m.from.y) * up, m.from.z + (m.to.z - m.from.z) * fw);
      if (t >= 1) { this.mantle = null; this.airMaxY = this.feet.y; this.grounded = true; this.wasGrounded = true; }
      const c = this.center;
      this.body.setNextKinematicTranslation({ x: c.x, y: c.y, z: c.z });
      return;
    }

    // ------------------------------------------------ input
    let ix = 0, iy = 0;
    if (act) {
      if (inp.isDown('forward')) iy += 1;
      if (inp.isDown('back')) iy -= 1;
      if (inp.isDown('right')) ix += 1;
      if (inp.isDown('left')) ix -= 1;
      ix += inp.moveX; iy -= inp.moveY;
    }
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    this.moving = len > 0.1;

    const wantCrouch = act && inp.isDown('crouch');
    this.setCrouch(wantCrouch && !this.climbing);

    this.inWater = this.findWater();
    const stamina = this.env.stamina.get();
    const drainMult = this.env.staminaDrainMult();
    this.sprinting = act && inp.isDown('sprint') && this.moving && iy > 0 && !this.crouched && stamina > 1 && !this.inWater && this.slowFactor >= 1;

    // ------------------------------------------------ climbing
    const climb = this.findClimb();
    const fwdFlat = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    if (!this.climbing && climb && act) {
      const facing = -fwdFlat.dot(climb.normal);
      if ((iy > 0.3 && facing > 0.35) || (inp.isDown('jump') && facing > 0.2 && !this.grounded)) this.climbing = climb;
    }
    if (this.climbing && (!climb || climb !== this.climbing)) {
      // left the vine volume: if we were going up, pop onto the ledge
      if (iy > 0 && !this.tryMantle()) this.vel.y = Math.max(this.vel.y, 3);
      this.climbing = null;
    }

    let desired = new THREE.Vector3();
    if (this.climbing) {
      const v = this.climbing;
      const sp = 2.4 * this.env.climbMult() * this.env.speedMult();
      this.vel.set(0, 0, 0);
      const climbUp = iy * sp;
      // move along the wall plane horizontally with strafe
      const along = new THREE.Vector3(0, 1, 0).cross(v.normal).normalize();
      const camRight = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const side = ix * sp * 0.6 * Math.sign(camRight.dot(along) || 1);
      desired.set(along.x * side, climbUp, along.z * side).multiplyScalar(dt);
      desired.addScaledVector(v.normal, -0.6 * dt); // hug the wall
      if (act && inp.pressed('jump')) {
        // jump off the wall
        this.climbing = null;
        this.vel.copy(v.normal).multiplyScalar(4).setY(4);
      } else if (climbUp > 0 && this.center.y > v.max.y - 0.2) {
        this.tryMantle();
      }
      if (iy !== 0 || ix !== 0) this.env.stamina.set(Math.max(0, stamina - 3 * drainMult * dt));
      this.airMaxY = this.feet.y;
    } else {
      // ------------------------------------------------ walking
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const wish = new THREE.Vector3().addScaledVector(fwdFlat, iy).addScaledVector(right, ix);
      let speed = this.crouched ? 2.0 : this.sprinting ? 7.0 : 4.2;
      speed *= this.env.speedMult() * this.slowFactor;
      if (this.inWater) speed *= 0.6;
      const target = wish.multiplyScalar(speed);
      const accel = this.grounded ? 40 : 8;
      const dvx = target.x - this.vel.x, dvz = target.z - this.vel.z;
      const dl = Math.hypot(dvx, dvz);
      const maxDv = accel * dt;
      if (dl > maxDv) { this.vel.x += (dvx / dl) * maxDv; this.vel.z += (dvz / dl) * maxDv; }
      else { this.vel.x = target.x; this.vel.z = target.z; }

      if (this.grounded && act && inp.pressed('jump')) {
        if (!this.tryMantle() && stamina >= 6) {
          this.vel.y = this.inWater ? 3.5 : 5.6;
          this.env.stamina.set(stamina - 10 * drainMult);
          this.grounded = false;
          this.env.onJump();
        }
      } else if (!this.grounded && act && inp.pressed('jump')) {
        this.tryMantle();
      }
      this.vel.y -= GRAVITY * dt;
      if (this.grounded && this.vel.y < -1) this.vel.y = -1;
      if (this.vel.y < -40) this.vel.y = -40;
      desired.copy(this.vel).add(this.external).multiplyScalar(dt);

      if (this.sprinting) {
        this.env.stamina.set(Math.max(0, stamina - 18 * drainMult * dt));
        this.staminaIdle = 0;
      }
    }
    // stamina regen
    this.staminaIdle += dt;
    if (!this.sprinting && this.staminaIdle > 0.8) {
      this.env.stamina.set(Math.min(this.env.maxStamina(), this.env.stamina.get() + 22 * dt));
    }
    if (this.sprinting) this.staminaIdle = 0;
    this.external.multiplyScalar(Math.max(0, 1 - 3 * dt));

    // ------------------------------------------------ collide & slide
    this.controller.computeColliderMovement(this.collider, { x: desired.x, y: desired.y, z: desired.z }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (c) => !this.env.ignoreCollider(c));
    const mv = this.controller.computedMovement();
    this.feet.x += mv.x; this.feet.y += mv.y; this.feet.z += mv.z;
    const groundedNow = this.controller.computedGrounded() || (!!this.climbing && false);
    if (desired.y > 0 && mv.y < desired.y * 0.5) this.vel.y = Math.min(this.vel.y, 0); // bonked head

    // pushing blocks
    const n = this.controller.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const col = this.controller.computedCollision(i);
      const c = col?.collider;
      const b = c?.parent();
      if (!b || !b.isDynamic()) continue;
      const dir = new THREE.Vector3(desired.x, 0, desired.z);
      if (dir.lengthSq() < 1e-8) continue;
      dir.normalize();
      this.env.onPush(b, dir);
    }

    // landing / falls
    if (!groundedNow) {
      this.airMaxY = Math.max(this.airMaxY, this.feet.y);
    }
    if (groundedNow && !this.wasGrounded && !this.climbing) {
      const h = this.airMaxY - this.feet.y;
      this.env.onLand(h);
      this.vel.y = -1;
    }
    if (groundedNow) this.airMaxY = this.feet.y;
    this.grounded = groundedNow;
    this.wasGrounded = groundedNow;

    // ground object (planks, crumbling tiles)
    if (this.grounded) {
      const hit = this.physics.raycast(new THREE.Vector3(this.feet.x, this.feet.y + 0.2, this.feet.z), new THREE.Vector3(0, -1, 0), 0.6, this.collider, (col) => !this.env.ignoreCollider(col));
      this.env.onGround(hit ? hit.collider : null);
    } else this.env.onGround(null);

    // footsteps
    const hs = Math.hypot(mv.x, mv.z) / Math.max(dt, 1e-4);
    if (this.grounded && hs > 0.5) {
      this.stepDist += hs * dt;
      this.bob += hs * dt * 2.1;
      const stride = this.sprinting ? 2.4 : this.crouched ? 1.1 : 1.7;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.env.onStep(this.sprinting ? 1 : this.crouched ? 0.15 : 0.45, !!this.inWater);
      }
    }

    const c = this.center;
    this.body.setNextKinematicTranslation({ x: c.x, y: c.y, z: c.z });
    const targetEye = this.crouched ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 12);
    this.tmp.set(0, 0, 0);
  }
}
