import * as THREE from 'three';
import { speedFactor, staminaDrainFactor } from '../core/economy';
import { douse, dousedByFall, dousedByWater, dousedByWind } from '../core/torch';
import { NOISE, fallDamage, gustStrength } from '../core/traps';
import { CG, RAPIER } from '../engine/physics';
import type { Game } from '../game/Game';
import type { Climbable, Interactable } from '../world/types';
import type { Prop } from './Props';

const RADIUS = 0.35;
const ROT0 = { x: 0, y: 0, z: 0, w: 1 };
const STAND_H = 1.75;
const CROUCH_H = 1.1;
const WALK = 3.6, RUN = 6.2, CROUCH = 1.8, CLIMB = 2.5;
const JUMP_V = 6.4;
const GRAVITY = 20;
const SWIM_DEPTH = 1.35;

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _t = new THREE.Vector3();

/** First-person body: a capsule driven by Rapier's kinematic character controller. */
export class Player {
  /** Feet position. */
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  height = STAND_H;
  grounded = false;
  crouching = false;
  climbing: Climbable | null = null;
  swimming = false;
  running = false;
  stamina = 100;
  health = 100;
  dead = false;
  held: Prop | null = null;
  target: Interactable | null = null;
  /** How deep the feet are under a water surface (0 when dry). */
  waterDepth = 0;
  wind = 0;
  /** Recent damage flash 0..1 for the HUD. */
  hurtFlash = 0;

  private body: RAPIER.RigidBody;
  private col: RAPIER.Collider;
  private ctl: RAPIER.KinematicCharacterController;
  private eye = 1.6;
  private coyote = 0;
  private jumpBuffer = 0;
  private airPeakY = 0;
  private wasGrounded = true;
  private stepDist = 0;
  private staminaDelay = 0;
  private exhausted = false;
  private mantle: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null = null;
  private knockV = new THREE.Vector3();
  private bob = 0;
  private landDip = 0;
  private wetT = 0;
  private climbCooldown = 0;
  private windWarned = false;

  constructor(private game: Game) {
    const w = game.physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.col = w.createCollider(RAPIER.ColliderDesc.capsule(STAND_H / 2 - RADIUS, RADIUS).setCollisionGroups(CG.PLAYER), this.body);
    this.ctl = w.createCharacterController(0.02);
    // The landing must be wider than the capsule radius, or the rounded foot comes down on the lip of
    // the step and Rapier reads that contact as a slope too steep to stand on.
    this.ctl.enableAutostep(0.42, RADIUS + 0.08, false);
    this.ctl.enableSnapToGround(0.35);
    this.ctl.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.ctl.setMinSlopeSlideAngle((58 * Math.PI) / 180);
    this.ctl.setApplyImpulsesToDynamicBodies(false);
    this.ctl.setSlideEnabled(true);
  }

  reset(x: number, y: number, z: number, yaw: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0); this.knockV.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.height = STAND_H; this.eye = 1.6;
    this.crouching = false; this.climbing = null; this.swimming = false; this.mantle = null;
    this.stamina = 100; this.health = 100; this.dead = false; this.held = null; this.hurtFlash = 0;
    this.grounded = false; this.wasGrounded = true; this.airPeakY = y;
    this.setCapsule();
    this.body.setTranslation({ x, y: y + this.height / 2, z }, true);
  }

  teleport(x: number, y: number, z: number): void {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.mantle = null; this.climbing = null;
    this.airPeakY = y; this.wasGrounded = true;
    this.body.setTranslation({ x, y: y + this.height / 2, z }, true);
  }

  get eyePos(): THREE.Vector3 { return _t.set(this.pos.x, this.pos.y + this.eye, this.pos.z); }
  get center(): THREE.Vector3 { return new THREE.Vector3(this.pos.x, this.pos.y + this.height / 2, this.pos.z); }
  get rigidBody(): RAPIER.RigidBody { return this.body; }
  /** Put the player on a climbable at a given spot, facing the wall (used to get onto a rope from above). */
  startClimb(c: Climbable, x: number, y: number, z: number): void {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0);
    this.mantle = null; this.crouching = false; this.climbing = c; this.climbCooldown = 0;
    this.airPeakY = y; this.grounded = false;
    this.yaw = Math.atan2(c.nx, c.nz); this.pitch = -0.5;
    this.body.setTranslation({ x, y: y + this.height / 2, z }, true);
  }

  get busyHands(): boolean { return this.climbing !== null || this.mantle !== null || this.swimming; }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  private setCapsule(): void {
    this.col.setHalfHeight(Math.max(0.05, this.height / 2 - RADIUS));
  }

  damage(amount: number, cause: string): void {
    if (this.dead || amount <= 0 || this.game.godMode) return;
    this.health = Math.max(0, this.health - amount);
    this.hurtFlash = Math.min(1, this.hurtFlash + 0.35 + amount / 60);
    this.game.audio.play('hurt', { vol: Math.min(1, 0.4 + amount / 40) });
    this.game.shake(Math.min(0.6, amount / 60));
    this.game.run.stats.damageTaken += amount;
    if (this.health <= 0) { this.dead = true; this.game.endRun('killed', cause); }
  }

  knock(x: number, y: number, z: number): void {
    this.knockV.set(x, 0, z);
    if (y > 0) { this.vel.y = y; this.grounded = false; }
    this.climbing = null;
  }

  // -------------------------------------------------------------------------------------------
  // Per-frame: look, interaction, hands
  // -------------------------------------------------------------------------------------------
  update(dt: number): void {
    const { game } = this;
    const inp = game.input;
    if (!this.dead && inp.active) {
      const { dx, dy } = inp.look(dt);
      const s = 0.0022 * game.save.settings.sensitivity;
      this.yaw -= dx * s;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * s * (game.save.settings.invertY ? -1 : 1)));
      if (inp.hit('jump')) this.jumpBuffer = 0.15;

      this.findTarget();
      if (inp.hit('interact') && this.target) this.target.act();
      if (this.held) {
        if (inp.hit('throw')) this.throwHeld();
        else if (inp.hit('release')) this.dropHeld();
      }
    } else {
      inp.look(dt);
      this.target = null;
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.4);

    // Camera
    const wantEye = this.height - 0.15;
    this.eye += (wantEye - this.eye) * Math.min(1, dt * 12);
    this.landDip = Math.max(0, this.landDip - dt * 1.6);
    const moving = this.grounded ? Math.hypot(this.vel.x, this.vel.z) : 0;
    this.bob += moving * dt * (this.crouching ? 2.4 : 1.9);
    const bobY = Math.sin(this.bob * 2) * 0.035 * Math.min(1, moving / 3) - this.landDip * this.landDip * 0.45;
    const cam = game.camera;
    cam.position.set(this.pos.x, this.pos.y + this.eye + bobY, this.pos.z);
    const sh = game.shakeAmount;
    if (sh > 0) cam.position.add(_t.set((Math.random() - 0.5) * sh * 0.25, (Math.random() - 0.5) * sh * 0.25, (Math.random() - 0.5) * sh * 0.25));
    cam.rotation.set(this.pitch, this.yaw, Math.sin(this.bob) * 0.006 * Math.min(1, moving / 3) + (this.swimming ? Math.sin(game.run.time * 1.7) * 0.02 : 0), 'YXZ');
  }

  private findTarget(): void {
    const { game } = this;
    const eye = this.eyePos.clone();
    const fwd = this.forward(_f);
    let best: Interactable | null = null, bestScore = Infinity;
    for (const it of game.interactables) {
      _r.subVectors(it.pos, eye);
      const d = _r.length();
      if (d > it.range) continue;
      const dot = d > 0.01 ? _r.dot(fwd) / d : 1;
      if (dot < 0.82 && d > 0.9) continue;
      if (it.prompt() === null) continue;
      const score = (1 - dot) * 6 + d * 0.25 + (it.priority ?? 3) * 0.05;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    if (best && !best.solid && !game.physics.lineOfSight(eye, _r.copy(best.pos).lerp(eye, 0.15))) best = null;
    this.target = best;
  }

  grab(p: Prop): void {
    if (this.held) return;
    this.held = p;
    p.held = true; p.thrown = false;
    p.mesh.traverse((o) => { o.castShadow = false; });
    p.body.setGravityScale(0, true);
    this.game.audio.play('pickup', { vol: 0.5 });
  }

  dropHeld(): Prop | null {
    const p = this.held;
    if (!p) return null;
    this.held = null;
    p.held = false;
    p.mesh.traverse((o) => { o.castShadow = true; });
    p.body.setGravityScale(1, true);
    p.body.setLinvel({ x: this.vel.x * 0.5, y: 0, z: this.vel.z * 0.5 }, true);
    return p;
  }

  throwHeld(): void {
    const p = this.dropHeld();
    if (!p) return;
    const f = this.forward(_f);
    const power = 11 / Math.sqrt(Math.max(1, p.weight / 1.5));
    p.body.setLinvel({ x: f.x * power + this.vel.x * 0.4, y: f.y * power + 2.2, z: f.z * power + this.vel.z * 0.4 }, true);
    p.body.setAngvel({ x: Math.random() * 6 - 3, y: Math.random() * 6 - 3, z: Math.random() * 6 - 3 }, true);
    p.thrown = true;
    this.game.audio.play('throw', { vol: 0.6 });
    this.stamina = Math.max(0, this.stamina - 4);
  }

  // -------------------------------------------------------------------------------------------
  // Fixed step: movement
  // -------------------------------------------------------------------------------------------
  fixedUpdate(dt: number): void {
    const { game } = this;
    const run = game.run;
    if (this.dead) return;

    // Read back where physics put us last step.
    const bt = this.body.translation();
    this.pos.set(bt.x, bt.y - this.height / 2, bt.z);

    this.updateHeld(dt);

    if (this.mantle) { this.stepMantle(dt); return; }

    const inp = game.input;
    const active = inp.active;
    let mx = active ? inp.moveX() : 0, mz = active ? inp.moveZ() : 0;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Camera forward on the ground plane is (-sin, -cos).
    const wishX = -sin * mz + cos * mx, wishZ = -cos * mz - sin * mx;

    // Environment
    const water = game.waterAt(this.pos.x, this.pos.y, this.pos.z);
    this.waterDepth = water ? Math.max(0, water.surfaceY - this.pos.y) : 0;
    this.swimming = this.waterDepth > SWIM_DEPTH - 0.05 && !this.grounded || this.waterDepth > SWIM_DEPTH + 0.25;
    if (dousedByWater(this.waterDepth) && douse(run.torch, 'water')) { game.audio.play('douse'); game.toast('The water put your torch out'); }
    if (this.waterDepth > 0.25) {
      this.wetT -= dt;
      if (this.wetT <= 0 && (ml > 0.1 || this.swimming)) { this.wetT = 0.55; game.audio.play('splash', { vol: 0.35 }); game.emitNoise(this.pos, 9); }
    }

    // Crouch
    const wantCrouch = active && inp.held('crouch') && !this.swimming && !this.climbing;
    if (wantCrouch) this.crouching = true;
    else if (this.crouching && this.headroom()) this.crouching = false;
    const targetH = this.crouching ? CROUCH_H : STAND_H;
    if (Math.abs(this.height - targetH) > 0.001) {
      this.height += Math.sign(targetH - this.height) * Math.min(Math.abs(targetH - this.height), dt * 4.5);
      this.setCapsule();
    }

    const load = speedFactor(run.satchel.weight, run.satchel.capacity);
    const drain = staminaDrainFactor(run.satchel.weight, run.satchel.capacity);
    const relighting = run.torch.state === 'relighting';

    // Climbing
    this.climbCooldown -= dt;
    if (!this.climbing && this.climbCooldown <= 0 && !this.held) {
      const c = game.climbableAt(this.pos.x, this.pos.y + 0.9, this.pos.z);
      if (c && this.pos.y < c.y2 - 0.3) {
        // Start climbing when pushing into the wall, or catch hold when dropping past it
        // (which is how you get onto a rope or vines from the ledge above).
        const pushing = ml > 0.1 && wishX * -c.nx + wishZ * -c.nz > 0.35;
        const falling = !this.grounded && this.vel.y < -0.5;
        if (pushing || falling) { this.climbing = c; this.vel.set(0, 0, 0); this.airPeakY = this.pos.y; }
      }
    }
    if (this.climbing) { this.stepClimb(dt, mx, mz, load, drain); return; }

    // Sprint and stamina
    const wantsRun = active && inp.held('run') && mz > 0.2 && !this.crouching && !this.swimming && !relighting && this.waterDepth < 0.7;
    if (this.stamina <= 0) this.exhausted = true;
    if (this.exhausted && this.stamina > 25) this.exhausted = false;
    this.running = wantsRun && !this.exhausted && (this.grounded || this.coyote > 0);
    if (this.running) { this.stamina = Math.max(0, this.stamina - 12 * drain * dt); this.staminaDelay = 0.8; }
    else {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) this.stamina = Math.min(100, this.stamina + (ml < 0.1 ? 22 : 14) * dt);
    }

    let speed = (this.crouching ? CROUCH : this.running ? RUN : WALK) * load;
    if (this.waterDepth > 0.3) speed *= 1 - 0.5 * Math.min(1, this.waterDepth / 1.2);
    if (relighting) speed *= 0.55;
    if (this.held) speed *= 1 - Math.min(0.3, this.held.weight * 0.03);

    const accel = this.grounded ? 14 : this.swimming ? 4 : 2.6;
    const k = Math.min(1, accel * dt);
    this.vel.x += (wishX * speed - this.vel.x) * k;
    this.vel.z += (wishZ * speed - this.vel.z) * k;

    // Vertical
    this.jumpBuffer -= dt;
    this.coyote -= dt;
    if (this.swimming) {
      const targetVy = (this.waterDepth - SWIM_DEPTH) * 4 + (active && inp.held('jump') ? 1.2 : 0);
      this.vel.y += (Math.max(-3, Math.min(3, targetVy)) - this.vel.y) * Math.min(1, dt * 6);
      this.airPeakY = this.pos.y;
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.grounded && this.vel.y < 0) this.vel.y = -2;
      if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0) && this.stamina > 4 && this.headroom()) {
        this.vel.y = JUMP_V * (1 - 0.22 * run.satchel.ratio);
        this.jumpBuffer = 0; this.coyote = 0; this.grounded = false;
        this.stamina = Math.max(0, this.stamina - 7 * drain);
        this.staminaDelay = 0.6;
        game.audio.play('jump', { vol: 0.4 });
        game.emitNoise(this.pos, 8, NOISE.jump);
      }
    }
    if (this.vel.y < -40) this.vel.y = -40;

    // External pushes: river current, wind, knockback.
    let px = this.knockV.x, pz = this.knockV.z;
    this.knockV.multiplyScalar(Math.max(0, 1 - dt * 3.5));
    if (water && this.waterDepth > 0.25) {
      const f = Math.min(1, this.waterDepth / 0.9);
      px += water.flowX * f; pz += water.flowZ * f;
    }
    const wz = game.windAt(this.pos.x, this.pos.y, this.pos.z);
    this.wind = 0;
    if (wz) {
      const g = gustStrength(run.time) * wz.strength;
      this.wind = g;
      const shelter = this.crouching ? 0.07 : 1;
      px += wz.dx * g * 5.2 * shelter; pz += wz.dz * g * 5.2 * shelter;
      if (dousedByWind(g) && douse(run.torch, 'wind')) { game.audio.play('douse'); game.toast('A gust blew your torch out'); }
      if (g > 0.3 && !this.windWarned) { this.windWarned = true; game.toast('Wind! Crouch to keep your footing.'); }
      if (g < 0.15) this.windWarned = false;
    }

    // Move
    const desired = { x: (this.vel.x + px) * dt, y: this.vel.y * dt, z: (this.vel.z + pz) * dt };
    this.ctl.computeColliderMovement(this.col, desired, undefined, CG.PLAYER);
    const mv = this.ctl.computedMovement();
    const wasY = this.pos.y;
    this.pos.x += mv.x; this.pos.y += mv.y; this.pos.z += mv.z;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.height / 2, z: this.pos.z });

    // Blocked horizontally: stop pushing into the wall, and shove blocks.
    const n = this.ctl.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const c = this.ctl.computedCollision(i);
      if (!c || !c.collider) continue;
      const blk = game.pushables.get(c.collider.handle);
      if (blk && Math.abs(c.normal1.y) < 0.4 && this.grounded && ml > 0.2) {
        blk.push(-c.normal1.x, -c.normal1.z, load);
        this.stamina = Math.max(0, this.stamina - 4 * dt);
      }
    }
    // Rapier's own autostep gives up when the capsule's rounded foot meets the lip of a low step
    // (it reads the contact as a slope and then cannot slide along it), so low steps are ours.
    const wantH = Math.hypot(desired.x, desired.z);
    let stepped = false;
    if (this.grounded && ml > 0.1 && wantH > 1e-4 && Math.hypot(mv.x, mv.z) < wantH * 0.4) stepped = this.tryStep(wishX, wishZ);
    // Only a real obstruction eats momentum. A slope also shortens the step, and feeding that back
    // into the velocity every frame would make every ramp a crawl.
    if (dt > 0 && !stepped && Math.hypot(mv.x, mv.z) < wantH * 0.5) {
      const ax = mv.x / dt - px, az = mv.z / dt - pz;
      if (Math.abs(ax) < Math.abs(this.vel.x)) this.vel.x = ax;
      if (Math.abs(az) < Math.abs(this.vel.z)) this.vel.z = az;
    }
    if (this.vel.y > 0 && mv.y < desired.y - 1e-4) this.vel.y = 0; // bumped a ceiling

    // Ground state
    this.grounded = this.ctl.computedGrounded() && !this.swimming;
    if (this.grounded) {
      this.coyote = 0.12;
      const hit = game.physics.raycast({ x: this.pos.x, y: this.pos.y + 0.4, z: this.pos.z }, { x: 0, y: -1, z: 0 }, 0.75, CG.Q_WALK, this.body);
      if (hit) game.groundTriggers.get(hit.collider.handle)?.();
    }

    // Landing
    if (!this.grounded && !this.swimming) this.airPeakY = Math.max(this.airPeakY, this.pos.y);
    if (this.grounded && !this.wasGrounded) {
      const fell = this.airPeakY - this.pos.y;
      if (fell > 0.6) {
        const inWater = this.waterDepth > 0.9;
        const dmg = inWater ? 0 : fallDamage(fell);
        this.landDip = Math.min(1, fell / 4);
        game.audio.play(inWater ? 'splash' : 'land', { vol: Math.min(1, 0.3 + fell / 6) });
        game.emitNoise(this.pos, fell > 2.5 ? 20 : 11, fell > 2.5 ? NOISE.hardLand : NOISE.land);
        if (dmg > 0) this.damage(dmg, 'a long fall');
        if (dousedByFall(fell) && douse(run.torch, 'fall')) { game.audio.play('douse'); game.toast('The fall knocked your torch out'); }
      }
    }
    if (this.grounded || this.swimming) this.airPeakY = this.pos.y;
    if (this.swimming && !this.wasSwimming && wasY - this.pos.y > 0.05) game.audio.play('splash', { vol: 0.8 });
    this.wasSwimming = this.swimming;
    this.wasGrounded = this.grounded;

    // Footsteps
    if (this.grounded) {
      this.stepDist += Math.hypot(mv.x, mv.z);
      const stride = this.running ? 2.3 : this.crouching ? 1.3 : 1.7;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        const wet = this.waterDepth > 0.1;
        game.audio.play('step', { vol: this.crouching ? 0.12 : this.running ? 0.55 : 0.32, rate: wet ? 0.7 : 1 });
        if (!this.crouching) game.emitNoise(this.pos, this.running ? 15 : 6, this.running ? NOISE.runStep : NOISE.walkStep);
      }
    }

    // Mantle up ledges while airborne and pushing forward.
    // Only when properly airborne: a one-frame loss of footing while shoving a block must not count.
    this.airT = this.grounded ? 0 : this.airT + dt;
    if (!this.grounded && !this.swimming && this.airT > 0.1 && mz > 0.3 && this.vel.y < 3 && this.vel.y > -9 && !this.held) this.tryMantle();
    else if (this.swimming && mz > 0.3) this.tryMantle();
  }

  private wasSwimming = false;
  private airT = 0;

  /** Step up onto a low, flat obstacle in the direction of travel. */
  private tryStep(dx: number, dz: number): boolean {
    const w = this.game.physics.world;
    const l = Math.hypot(dx, dz);
    if (l < 0.1) return false;
    dx /= l; dz /= l;
    const UP = 0.46, FWD = RADIUS + 0.1;
    const shape = this.col.shape, cy = this.pos.y + this.height / 2;
    const above = { x: this.pos.x, y: cy + UP, z: this.pos.z };
    const ahead = { x: this.pos.x + dx * FWD, y: cy + UP, z: this.pos.z + dz * FWD };
    if (w.intersectionWithShape(above, ROT0, shape, undefined, CG.PLAYER, this.col, this.body)) return false;
    if (w.intersectionWithShape(ahead, ROT0, shape, undefined, CG.PLAYER, this.col, this.body)) return false;
    const hit = w.castShape(ahead, ROT0, { x: 0, y: -1, z: 0 }, shape, 0, UP + 0.05, true, undefined, CG.PLAYER, this.col, this.body);
    if (!hit) return false;
    const rise = UP - hit.time_of_impact;
    if (rise > 0.43) return false;
    if (rise < 0.015) {
      // Nothing to climb, so what stopped us is a low lip with open ground beyond it. Hop it.
      if (rise < -0.3) return false;
      const hop = { x: this.pos.x + dx * 0.2, y: cy + 0.14, z: this.pos.z + dz * 0.2 };
      if (w.intersectionWithShape(hop, ROT0, shape, undefined, CG.PLAYER, this.col, this.body)) return false;
      this.pos.set(hop.x, hop.y - this.height / 2, hop.z);
      this.body.setNextKinematicTranslation(hop);
      return true;
    }
    // The landing has to be under the middle of the foot, not just a lip under its edge.
    const floor = this.game.physics.raycast({ x: ahead.x, y: this.pos.y + UP, z: ahead.z }, { x: 0, y: -1, z: 0 }, UP + 0.1, CG.Q_WALK, this.body);
    if (!floor || Math.abs(UP - floor.dist - rise) > 0.06 || floor.normal.y < 0.75) return false;
    this.pos.y += rise + 0.01;
    this.pos.x += dx * 0.05; this.pos.z += dz * 0.05;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.height / 2, z: this.pos.z });
    return true;
  }

  private headroom(): boolean {
    if (this.height >= STAND_H - 0.01) return true;
    const hit = this.game.physics.raycast({ x: this.pos.x, y: this.pos.y + this.height - 0.1, z: this.pos.z }, { x: 0, y: 1, z: 0 }, STAND_H - this.height + 0.15, CG.Q_WALK, this.body);
    return !hit;
  }

  private stepClimb(dt: number, mx: number, mz: number, load: number, drain: number): void {
    const { game } = this;
    const c = this.climbing!;
    const inp = game.input;
    const tired = this.stamina <= 0;
    let vy = mz * CLIMB * load;
    if (tired) vy = -1.6;
    else if (Math.abs(mz) > 0.1) this.stamina = Math.max(0, this.stamina - 6 * drain * dt);
    this.staminaDelay = 0.5;
    // Sideways along the wall.
    const tx = -c.nz, tz = c.nx;
    // Facing the wall, "right" on screen maps onto the wall tangent by the sign of the view.
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const rightDot = cos * tx - sin * tz;
    const lat = mx * 1.4 * Math.sign(rightDot || 1);
    // Hug the wall.
    const hug = 1.2;
    const desired = { x: (tx * lat - c.nx * hug) * dt, y: vy * dt, z: (tz * lat - c.nz * hug) * dt };
    this.ctl.computeColliderMovement(this.col, desired, undefined, CG.PLAYER);
    const mv = this.ctl.computedMovement();
    this.pos.x += mv.x; this.pos.y += mv.y; this.pos.z += mv.z;
    this.vel.set(0, 0, 0);
    this.airPeakY = this.pos.y;
    this.grounded = false;
    this.stepDist += Math.abs(mv.y);
    if (this.stepDist > 0.9) { this.stepDist = 0; game.audio.play('rustle', { vol: 0.3 }); }

    const outside = this.pos.x < c.x1 - 0.5 || this.pos.x > c.x2 + 0.5 || this.pos.z < c.z1 - 0.5 || this.pos.z > c.z2 + 0.5;
    if (this.pos.y >= c.y2 - 0.25 && vy > 0) {
      // Over the top: step onto the ledge.
      this.climbing = null; this.climbCooldown = 0.5;
      this.mantle = { from: this.pos.clone(), to: new THREE.Vector3(this.pos.x - c.nx * 0.95, c.y2 + 0.05, this.pos.z - c.nz * 0.95), t: 0, dur: 0.4 };
    } else if (outside || (this.pos.y <= c.y1 + 0.02 && vy < 0) || (this.ctl.computedGrounded() && vy <= 0)) {
      this.climbing = null; this.climbCooldown = 0.3;
    } else if (inp.active && inp.hit('jump') || this.jumpBuffer > 0) {
      // Kick off the wall.
      this.jumpBuffer = 0;
      this.climbing = null; this.climbCooldown = 0.45;
      this.vel.set(c.nx * 3.2, 4.2, c.nz * 3.2);
    }
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.height / 2, z: this.pos.z });
  }

  private tryMantle(): void {
    const { game } = this;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const ph = game.physics;
    // A wall in front at chest height...
    const wall = ph.raycast({ x: this.pos.x, y: this.pos.y + 1.0, z: this.pos.z }, { x: fx, y: 0, z: fz }, 0.75, CG.Q_WALK, this.body);
    if (!wall || Math.abs(wall.normal.y) > 0.5) return;
    // ...with a top surface within reach just beyond it...
    const reach = this.swimming ? 2.2 : 2.05;
    const ox = this.pos.x + fx * (wall.dist + 0.3), oz = this.pos.z + fz * (wall.dist + 0.3);
    const top = ph.raycast({ x: ox, y: this.pos.y + reach, z: oz }, { x: 0, y: -1, z: 0 }, reach - 0.45, CG.Q_WALK, this.body);
    if (!top || top.normal.y < 0.7 || top.dist < 0.02) return;
    const ledgeY = top.point.y;
    // ...and room to stand on it.
    if (ph.raycast({ x: ox, y: ledgeY + 0.1, z: oz }, { x: 0, y: 1, z: 0 }, CROUCH_H, CG.Q_WALK, this.body)) return;
    if (this.stamina < 6) return;
    this.stamina -= 8 * staminaDrainFactor(game.run.satchel.weight, game.run.satchel.capacity);
    this.staminaDelay = 0.8;
    const rise = ledgeY - this.pos.y;
    this.mantle = { from: this.pos.clone(), to: new THREE.Vector3(ox, ledgeY + 0.03, oz), t: 0, dur: 0.3 + Math.max(0, rise) * 0.16 };
    game.audio.play('rustle', { vol: 0.4 });
  }

  private stepMantle(dt: number): void {
    const m = this.mantle!;
    m.t += dt / m.dur;
    const k = Math.min(1, m.t);
    // Up first, then forward.
    const up = Math.min(1, k * 1.6), fw = Math.max(0, (k - 0.35) / 0.65);
    this.pos.set(m.from.x + (m.to.x - m.from.x) * fw, m.from.y + (m.to.y - m.from.y) * up, m.from.z + (m.to.z - m.from.z) * fw);
    this.vel.set(0, 0, 0);
    this.airPeakY = this.pos.y;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.height / 2, z: this.pos.z });
    if (k >= 1) { this.mantle = null; this.wasGrounded = true; this.grounded = true; }
  }

  private updateHeld(dt: number): void {
    const p = this.held;
    if (!p) return;
    const f = this.forward(_f);
    const tx = this.pos.x + f.x * 1.05, ty = this.pos.y + this.eye - 0.32 + f.y * 0.9, tz = this.pos.z + f.z * 1.05;
    const t = p.body.translation();
    const dx = tx - t.x, dy = ty - t.y, dz = tz - t.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 3.2 || this.busyHands) { this.dropHeld(); return; }
    const k = Math.min(16, 12 / Math.max(0.5, Math.sqrt(p.weight / 3)));
    p.body.setLinvel({ x: dx * k, y: dy * k, z: dz * k }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    void dt;
  }
}
