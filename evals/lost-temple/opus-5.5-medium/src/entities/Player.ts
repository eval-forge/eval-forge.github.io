import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G } from '../core/ctx';
import { R } from '../core/Physics';
import { PAD } from '../core/Input';
import { speedFactor, staminaDrainFactor, jumpFactor, staminaMax } from '../logic/economy';

const RADIUS = 0.35;
const HH_STAND = 0.55;
const HH_CROUCH = 0.2;
const GRAVITY = 19;

export class Player {
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  kcc!: RAPIER.KinematicCharacterController;
  position = new THREE.Vector3(0, 1.3, 4);
  yaw = 0;
  pitch = 0;
  vy = 0;
  grounded = false;
  crouching = false;
  sprinting = false;
  climbing = false;
  inWater = false;
  waterDepth = 0;
  stamina = 100;
  staminaMax = 100;
  private staminaDelay = 0;
  health = 100;
  private regenDelay = 0;
  private hh = HH_STAND;
  private stride = 0;
  private bob = 0;
  private lastSafe = new THREE.Vector3();
  private safeTimer = 0;
  private airTime = 0;
  private fallStartY = 0;
  landingSpeed = 0;
  groundTag: { kind: string; ref?: unknown } | null = null;
  private mantle: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
  ropesLeft = 0;
  slowFactor = 1; // external slow (relighting, etc.)
  moveIntent = new THREE.Vector3();
  hurtFlash = 0;
  knock = new THREE.Vector3();
  eyeHeightNow = 1.6;
  dead = false;

  spawn(pos: THREE.Vector3, yaw: number) {
    const w = G.physics.world;
    this.body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z));
    this.collider = w.createCollider(R.ColliderDesc.capsule(HH_STAND, RADIUS).setFriction(0), this.body);
    G.physics.tag(this.collider, { kind: 'player' });
    this.kcc = w.createCharacterController(0.03);
    this.kcc.enableAutostep(0.45, 0.2, false);
    this.kcc.enableSnapToGround(0.35);
    this.kcc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(60);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.position.copy(pos);
    this.lastSafe.copy(pos);
    this.yaw = yaw;
    this.staminaMax = staminaMax(G.upgrades.boots);
    this.stamina = this.staminaMax;
    this.ropesLeft = G.upgrades.rope;
  }

  get feetY() { return this.position.y - this.hh - RADIUS; }
  get eye(): THREE.Vector3 { return new THREE.Vector3(this.position.x, this.feetY + this.eyeHeightNow, this.position.z); }
  get forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  look(dt: number) {
    const inp = G.input;
    const sens = 0.0022 * inp.sensitivity;
    this.yaw -= inp.mouseDX * sens;
    this.pitch -= inp.mouseDY * sens * (inp.invertY ? -1 : 1);
    this.yaw -= inp.padLook.x * 2.6 * dt * inp.sensitivity;
    this.pitch -= inp.padLook.y * 2.0 * dt * inp.sensitivity * (inp.invertY ? -1 : 1);
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
  }

  /** Physics-rate movement update. */
  step(dt: number) {
    if (this.dead) return;
    const inp = G.input;
    const sat = G.satchel;
    const wfac = speedFactor(sat.weight + G.carry.heldWeight * 0.5, sat.capacity);

    // --- crouch ---
    const wantCrouch = inp.down('KeyC') || inp.down('ControlLeft') || inp.padDown(PAD.B) || inp.padDown(PAD.R3);
    if (wantCrouch !== this.crouching) {
      if (wantCrouch) this.setCrouch(true);
      else if (this.canStand()) this.setCrouch(false);
    }

    // --- move intent ---
    let fx = 0, fz = 0;
    if (inp.down('KeyW') || inp.down('ArrowUp')) fz += 1;
    if (inp.down('KeyS') || inp.down('ArrowDown')) fz -= 1;
    if (inp.down('KeyA') || inp.down('ArrowLeft')) fx -= 1;
    if (inp.down('KeyD') || inp.down('ArrowRight')) fx += 1;
    fx += inp.padMove.x; fz -= inp.padMove.y;
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const mx = fx * cos - fz * sin;
    const mz = -fx * sin - fz * cos;
    this.moveIntent.set(mx, 0, mz);
    const moving = len > 0.1;

    const wantSprint = (inp.down('ShiftLeft') || inp.down('ShiftRight') || inp.padDown(PAD.L3) || inp.padDown(PAD.RB)) && moving && !this.crouching;
    this.sprinting = wantSprint && this.stamina > 1 && this.grounded;

    let speed = this.crouching ? 2.1 : this.sprinting ? 6.9 : 4.3;
    speed *= wfac * this.slowFactor;
    if (this.inWater) speed *= this.waterDepth > 1.0 ? 0.45 : 0.65;

    // stamina
    const drain = staminaDrainFactor(sat.weight, sat.capacity);
    if (this.sprinting) { this.stamina -= 17 * drain * dt; this.staminaDelay = 0.9; }
    else if (this.climbing) { this.stamina -= 7 * drain * dt; this.staminaDelay = 0.6; }
    else if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else this.stamina += 16 * dt * (moving ? 0.7 : 1);
    this.stamina = Math.max(0, Math.min(this.staminaMax, this.stamina));

    // --- mantle animation ---
    if (this.mantle) {
      this.mantle.t += dt / 0.45;
      const t = Math.min(1, this.mantle.t);
      const p = new THREE.Vector3().lerpVectors(this.mantle.from, this.mantle.to, t);
      p.y = this.mantle.from.y + (this.mantle.to.y - this.mantle.from.y) * Math.min(1, t * 1.6);
      this.body.setNextKinematicTranslation(p);
      this.position.copy(p);
      if (t >= 1) { this.mantle = null; this.vy = 0; }
      return;
    }

    // --- climbing ---
    const chest = new THREE.Vector3(this.position.x, this.position.y + 0.3, this.position.z);
    const canClimb = G.world.inClimb(chest) || G.world.inClimb(this.position);
    const jumpHit = inp.hit('Space') || inp.padHit(PAD.A);
    this.climbing = canClimb && (fz > 0.2 || (this.climbing && !jumpHit)) && this.stamina > 0;
    let dy: number;
    if (this.climbing) {
      this.vy = 0;
      const climbSpeed = 2.6 * Math.max(0.55, wfac);
      dy = (fz > 0.2 ? climbSpeed : fz < -0.2 ? -climbSpeed : 0) * dt;
      speed *= 0.4;
      if (jumpHit) { this.climbing = false; this.vy = 4; }
    } else {
      // jump
      if (jumpHit && this.grounded && this.stamina > 8 && !this.crouching) {
        this.vy = 6.4 * jumpFactor(sat.weight, sat.capacity);
        this.stamina -= 10 * drain;
        this.staminaDelay = 0.6;
        this.grounded = false;
      } else if (jumpHit && !this.grounded) {
        this.tryMantle();
      }
      this.vy -= GRAVITY * dt;
      if (this.inWater) this.vy = Math.max(this.vy, -3);
      dy = this.vy * dt;
    }

    // knockback
    const kx = this.knock.x * dt, kz = this.knock.z * dt;
    this.knock.multiplyScalar(Math.max(0, 1 - dt * 5));

    const desired = { x: mx * speed * dt + kx, y: dy, z: mz * speed * dt + kz };
    // Wind gusts push you (cliffs)
    const wind = G.world.windAt(this.position);
    if (wind > 0) { desired.z += wind * 1.4 * dt; desired.x -= wind * 0.3 * dt; }

    const wasGrounded = this.grounded;
    const prevVy = this.vy;
    this.kcc.computeColliderMovement(this.collider, desired, undefined, undefined, (c) => {
      const t = G.physics.tagOf(c);
      return !(t && (t.kind === 'water' || t.kind === 'player' || t.kind === 'debris' && false));
    });
    const mv = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();

    // Push heavy pushables explicitly (the KCC's impulse is too weak for a 400 kg block)
    for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
      const col = this.kcc.computedCollision(i);
      if (!col || !col.collider) continue;
      const tag = G.physics.tagOf(col.collider);
      if (tag?.kind === 'pushable' && moving && !this.climbing) {
        const b = col.collider.parent();
        if (b && b.isDynamic()) {
          // Sokoban-style: push along the block's dominant axis away from the player
          const bt = b.translation();
          const dx = bt.x - this.position.x, dz = bt.z - this.position.z;
          const axis = Math.abs(dx) > Math.abs(dz) ? new THREE.Vector3(Math.sign(dx), 0, 0) : new THREE.Vector3(0, 0, Math.sign(dz));
          if (axis.dot(new THREE.Vector3(mx, 0, mz)) > 0.4) {
            const v = b.linvel();
            const sp = 1.7 * Math.max(0.6, wfac);
            b.setLinvel({ x: axis.x * sp, y: v.y, z: axis.z * sp }, true);
            (tag.ref as { pushing?: number }).pushing = 0.2;
          }
        }
      }
    }

    const np = this.body.translation();
    const next = new THREE.Vector3(np.x + mv.x, np.y + mv.y, np.z + mv.z);
    this.body.setNextKinematicTranslation(next);
    this.position.copy(next);

    // Vertical velocity bookkeeping
    if (this.grounded) {
      if (!wasGrounded) this.onLand(-prevVy);
      this.vy = Math.min(0, this.vy);
      if (this.vy < -1) this.vy = -1;
      this.airTime = 0;
    } else {
      if (wasGrounded) this.fallStartY = this.position.y;
      this.airTime += dt;
      if (mv.y > dy * 0.2 + 0.001 && this.vy > 0 && Math.abs(mv.y) < Math.abs(dy) * 0.3) this.vy = 0; // bonked head
    }

    // Ground detection for planks / tiles
    this.groundTag = null;
    if (this.grounded) {
      const hit = G.physics.ray(next.x, this.feetY + 0.2, next.z, 0, -1, 0, 0.6, this.collider);
      if (hit) this.groundTag = G.physics.tagOf(hit.collider) ?? null;
      // Remember a safe spot (static ground only)
      this.safeTimer -= dt;
      if (this.safeTimer <= 0 && this.groundTag?.kind === 'static' && !this.inWater) { this.lastSafe.copy(next); this.safeTimer = 1; }
    }

    // Footsteps & noise
    const hs = Math.hypot(mv.x, mv.z) / dt;
    if (this.grounded && hs > 0.5) {
      this.stride += hs * dt;
      this.bob += hs * dt * 2.2;
      const strideLen = this.sprinting ? 2.6 : this.crouching ? 1.4 : 2.0;
      if (this.stride > strideLen) {
        this.stride = 0;
        const quiet = 1 - 0.2 * G.upgrades.boots;
        let loud = (this.sprinting ? 0.65 : this.crouching ? 0.08 : 0.28) + 0.25 * (sat.weight / sat.capacity);
        loud *= quiet;
        const surface = this.inWater ? 'water' : this.groundTag?.kind === 'plank' ? 'wood' : G.world.current.zone === 'A' && G.world.current.id === 'jungle' ? 'dirt' : 'stone';
        G.audio.footstep(surface, Math.min(1, loud * 1.6));
        G.noise([next.x, this.feetY, next.z], loud);
      }
    }

    // Water
    const surf = G.world.waterSurfaceAt(new THREE.Vector3(next.x, this.feetY + 0.05, next.z));
    const wasIn = this.inWater;
    this.inWater = surf !== null;
    this.waterDepth = surf !== null ? surf - this.feetY : 0;
    if (this.inWater && !wasIn) { G.audio.splash(); G.noise([next.x, this.feetY, next.z], 0.5); }

    // Fatal falls
    if (this.position.y < G.world.current.killY) this.fellToDeath();
  }

  private onLand(impact: number) {
    this.landingSpeed = impact;
    if (impact > 5) {
      G.audio.thud(undefined, Math.min(1, impact / 12));
      G.noise([this.position.x, this.feetY, this.position.z], Math.min(1, impact / 10));
    }
    if (impact > 10 && !this.inWater) G.damage((impact - 10) * 11, 'fall');
  }

  private fellToDeath() {
    if (this.ropesLeft > 0) {
      this.ropesLeft--;
      G.toast('Your climbing rope caught you!');
      this.teleport(this.lastSafe);
      this.vy = 0;
      G.damage(15, 'fall');
      return;
    }
    G.kill('You fell to your death.');
  }

  teleport(p: THREE.Vector3) {
    this.body.setTranslation({ x: p.x, y: p.y + 0.2, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + 0.2, z: p.z });
    this.position.set(p.x, p.y + 0.2, p.z);
  }

  private setCrouch(c: boolean) {
    const old = this.hh;
    this.hh = c ? HH_CROUCH : HH_STAND;
    this.collider.setHalfHeight(this.hh);
    const t = this.body.translation();
    const ny = t.y + (this.hh - old);
    this.body.setTranslation({ x: t.x, y: ny, z: t.z }, true);
    this.body.setNextKinematicTranslation({ x: t.x, y: ny, z: t.z });
    this.position.y = ny;
    this.crouching = c;
  }

  private canStand(): boolean {
    const hit = G.physics.ray(this.position.x, this.feetY + 0.9, this.position.z, 0, 1, 0, 1.0, this.collider);
    return !hit;
  }

  private tryMantle() {
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const chestY = this.feetY + 1.0;
    const wall = G.physics.ray(this.position.x, chestY, this.position.z, f.x, 0, f.z, 0.9, this.collider);
    if (!wall) return;
    const probe = new THREE.Vector3(this.position.x + f.x * (wall.toi + 0.45), this.feetY + 2.6, this.position.z + f.z * (wall.toi + 0.45));
    const down = G.physics.ray(probe.x, probe.y, probe.z, 0, -1, 0, 2.0, this.collider);
    if (!down) return;
    const topY = probe.y - down.toi;
    if (topY < this.feetY + 0.5 || topY > this.feetY + 2.3) return;
    // headroom
    if (G.physics.ray(probe.x, topY + 0.05, probe.z, 0, 1, 0, 1.75, this.collider)) return;
    if (this.stamina < 10) return;
    this.stamina -= 10;
    const to = new THREE.Vector3(probe.x, topY + this.hh + RADIUS + 0.05, probe.z);
    this.mantle = { from: this.position.clone(), to, t: 0 };
    G.audio.footstep('stone', 0.6);
  }

  /** Frame-rate camera update. */
  updateCamera(cam: THREE.PerspectiveCamera, dt: number) {
    const targetEye = this.crouching ? 1.0 : 1.62;
    this.eyeHeightNow += (targetEye - this.eyeHeightNow) * Math.min(1, dt * 12);
    const bobAmt = this.grounded ? (this.sprinting ? 0.06 : 0.035) : 0;
    const by = Math.sin(this.bob * Math.PI) * bobAmt;
    const bx = Math.cos(this.bob * Math.PI * 0.5) * bobAmt * 0.6;
    cam.position.set(this.position.x, this.feetY + this.eyeHeightNow + by, this.position.z);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.addScaledVector(right, bx);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (this.hurtFlash > 0) this.hurtFlash -= dt;

    // health regen
    if (this.regenDelay > 0) this.regenDelay -= dt;
    else if (this.health < 100) this.health = Math.min(100, this.health + 3 * dt);
  }

  hurt(amount: number) {
    this.health -= amount;
    this.regenDelay = 6;
    this.hurtFlash = 0.6;
  }
}
