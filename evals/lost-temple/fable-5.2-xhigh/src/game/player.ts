/**
 * First-person player on a Rapier kinematic character controller:
 * run, jump, crouch, climb vines, mantle ledges, wade and swim, carry and
 * throw props. Loot weight slows everything down.
 */
import * as THREE from 'three';
import { jumpMultiplier, speedMultiplier, staminaDrainMultiplier } from '../core/economy';
import { clamp, clamp01, damp, lerp } from '../core/rng';
import { fallDouses, gustDouses, waterDouses } from '../core/torch';
import { DAMAGE, fallDamage } from '../core/traps';
import { GROUPS, RAPIER, RAY, type Surface } from '../engine/physics';
import type { Prop } from '../world/entities/props';
import type { ClimbZone } from '../world/registry';
import type { Game } from './game';

export const PLAYER_RADIUS = 0.35;
export const STAND_HEIGHT = 1.75;
export const CROUCH_HEIGHT = 1.05;
const EYE_STAND = 1.62;
const EYE_CROUCH = 0.92;
const WALK = 4.2;
const SPRINT = 6.8;
const CROUCH = 2.0;
const JUMP_SPEED = 6.7;
const GRAVITY = 20;
const SWIM_DEPTH = 1.35;

export type MoveMode = 'walk' | 'climb' | 'mantle' | 'swim' | 'dead';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Player {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly kcc: RAPIER.KinematicCharacterController;
  /** Feet position. */
  readonly pos = new THREE.Vector3();
  readonly prevPos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly eye = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, -1);
  yaw = 0;
  pitch = 0;
  mode: MoveMode = 'walk';
  grounded = false;
  crouching = false;
  private crouchToggle = false;
  sprinting = false;
  stamina = 100;
  private staminaDelay = 0;
  private height = STAND_HEIGHT;
  private eyeH = EYE_STAND;
  private coyote = 0;
  private jumpBuffer = 0;
  private stride = 0;
  private airSpeed = 0;
  private landDip = 0;
  private bob = 0;
  surface: Surface = 'dirt';
  /** Water depth at the feet (0 on dry land). */
  waterDepth = 0;
  underwater = false;
  private climb: ClimbZone | null = null;
  private climbCooldown = 0;
  private mantleT = 0;
  private mantleDur = 0.4;
  private readonly mantleFrom = new THREE.Vector3();
  private readonly mantleTo = new THREE.Vector3();
  private mantleCooldown = 0;
  held: Prop | null = null;
  /** Camera shake energy, decays. */
  shake = 0;
  private shakeT = 0;
  /** Speed over ground last step (for the HUD and footsteps). */
  speed = 0;
  /** True while a wind gust is shoving the player. */
  gusted = false;
  private hurtCooldown = 0;
  noclip = false;

  constructor(private readonly game: Game) {
    const w = game.physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 5, 0));
    this.collider = w.createCollider(
      RAPIER.ColliderDesc.capsule(STAND_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS).setCollisionGroups(GROUPS.player).setFriction(0),
      this.body,
    );
    game.physics.setMeta(this.collider, { kind: 'player' });
    this.kcc = w.createCharacterController(0.02);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.enableAutostep(0.45, 0.2, false);
    this.kcc.enableSnapToGround(0.35);
    this.kcc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((44 * Math.PI) / 180);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(80);
  }

  /** Total kilograms the legs are carrying beyond the body. */
  get load(): number {
    return this.game.run.satchel.weight + (this.held ? this.held.mass : 0);
  }

  get loadRatio(): number {
    return clamp01(this.load / this.game.run.satchel.capacity);
  }

  /** Mass a pressure plate or plank feels. */
  get mass(): number {
    return 75 + this.load;
  }

  get alive(): boolean {
    return this.mode !== 'dead';
  }

  get centerY(): number {
    return this.pos.y + this.height / 2;
  }

  teleport(x: number, y: number, z: number, yaw = this.yaw): void {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.airSpeed = 0;
    this.yaw = yaw;
    this.mode = this.mode === 'dead' ? 'dead' : 'walk';
    this.climb = null;
    this.syncBody(true);
    this.updateEye(1);
  }

  reset(x: number, y: number, z: number, yaw: number): void {
    this.mode = 'walk';
    this.stamina = 100;
    this.pitch = 0;
    this.crouching = false;
    this.crouchToggle = false;
    this.setHeight(STAND_HEIGHT);
    this.held = null;
    this.shake = 0;
    this.waterDepth = 0;
    this.underwater = false;
    this.airSpeed = 0;
    this.teleport(x, y, z, yaw);
  }

  private setHeight(h: number): void {
    if (h === this.height) return;
    this.height = h;
    this.collider.setHalfHeight(h / 2 - PLAYER_RADIUS);
    this.syncBody(true);
  }

  private syncBody(hard: boolean): void {
    const t = { x: this.pos.x, y: this.pos.y + this.height / 2, z: this.pos.z };
    if (hard) this.body.setTranslation(t, true);
    this.body.setNextKinematicTranslation(t);
  }

  /** Is the player's body over this rectangle, standing at about `y`? */
  over(x0: number, z0: number, x1: number, z1: number, y: number, tol = 0.35, pad = 0.2): boolean {
    const p = this.pos;
    return p.x >= x0 - pad && p.x <= x1 + pad && p.z >= z0 - pad && p.z <= z1 + pad && Math.abs(p.y - y) <= tol && this.grounded;
  }

  /** Mouse / stick look. Called every rendered frame. */
  look(dt: number): void {
    if (!this.alive) return;
    const input = this.game.input;
    const s = this.game.meta.data.settings;
    const m = input.takeMouse();
    const k = 0.0022 * s.sensitivity;
    const inv = s.invertY ? -1 : 1;
    this.yaw -= m.dx * k;
    this.pitch -= m.dy * k * inv;
    const pad = input.padLook;
    this.yaw -= pad.x * 2.6 * s.sensitivity * dt;
    this.pitch -= pad.y * 1.9 * s.sensitivity * dt * inv;
    this.pitch = clamp(this.pitch, -1.5, 1.5);
  }

  /** One 60 Hz step. */
  step(dt: number): void {
    const game = this.game;
    const input = game.input;
    this.prevPos.copy(this.pos);
    if (this.mode === 'dead') return;
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    this.climbCooldown = Math.max(0, this.climbCooldown - dt);
    this.mantleCooldown = Math.max(0, this.mantleCooldown - dt);

    const torch = game.run.torch;
    const ratio = this.loadRatio;
    const drainMult = staminaDrainMultiplier(ratio);

    // --- intent -----------------------------------------------------------
    const mx = input.moveX;
    const mz = input.moveZ;
    if (input.take('jump')) this.jumpBuffer = 0.14;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (input.take('crouch')) this.crouchToggle = !this.crouchToggle;
    const wantCrouch = this.crouchToggle || input.crouchHeld;
    if (wantCrouch && !this.crouching && this.mode === 'walk') {
      this.crouching = true;
      this.setHeight(CROUCH_HEIGHT);
    } else if (!wantCrouch && this.crouching && this.headroom()) {
      this.crouching = false;
      this.setHeight(STAND_HEIGHT);
    }

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
    let wx = -sin * mz + cos * mx;
    let wz = -cos * mz - sin * mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }

    // --- water ------------------------------------------------------------
    const water = game.reg.waterAt(this.pos.x, this.pos.z);
    const depth = water ? Math.max(0, water.surface - this.pos.y) : 0;
    if (depth > 0.25 && this.waterDepth <= 0.25 && this.vel.y < -3) {
      game.sfx('splash', this.pos, clamp01(-this.vel.y / 10));
      game.particles.emit('splash', { x: this.pos.x, y: water!.surface, z: this.pos.z }, 26, { spread: 0.4 });
      game.noise('splash', this.pos);
    }
    this.waterDepth = depth;
    this.underwater = !!water && this.eye.y < water.surface - 0.05;
    if (waterDouses(depth) && (torch.lit || torch.vulnerable)) game.torchEvent(torch.douse('water'));

    // --- external pushes ----------------------------------------------------
    let ex = 0;
    let ez = 0;
    this.gusted = false;
    const wind = game.reg.windAt({ x: this.pos.x, y: this.pos.y + 1, z: this.pos.z });
    if (wind) {
      const k = wind.strength * (this.crouching ? 1.1 : 5.6);
      ex += wind.dir.x * k;
      ez += wind.dir.z * k;
      this.gusted = wind.strength > 0.3;
      if (gustDouses(wind.strength, this.crouching) && (torch.lit || torch.vulnerable)) game.torchEvent(torch.douse('wind'));
    }
    if (water && depth > 0.2) {
      const k = clamp01(depth / 1.0);
      ex += water.current.x * k;
      ez += water.current.z * k;
    }

    // --- mode transitions ---------------------------------------------------
    if (this.mode === 'walk' || this.mode === 'swim') {
      if (depth > SWIM_DEPTH && this.mode === 'walk') this.mode = 'swim';
      else if (depth < SWIM_DEPTH - 0.2 && this.mode === 'swim') this.mode = 'walk';
    }
    if ((this.mode === 'walk' || this.mode === 'swim') && this.climbCooldown <= 0 && this.stamina > 4 && !this.crouching) {
      const zone = game.reg.climbAt(this.pos);
      if (zone) {
        const toward = -(wx * zone.nx + wz * zone.nz);
        if (toward > 0.35 || (!this.grounded && this.mode === 'walk' && this.vel.y < 1)) {
          this.mode = 'climb';
          this.climb = zone;
          this.vel.set(0, 0, 0);
          this.airSpeed = 0;
          game.sfx('rope', this.pos, 0.6);
        }
      }
    }

    // --- move ---------------------------------------------------------------
    let dx = 0;
    let dy = 0;
    let dz = 0;
    const relighting = torch.vulnerable;
    this.sprinting = false;

    if (this.mode === 'mantle') {
      this.mantleT += dt / this.mantleDur;
      const t = clamp01(this.mantleT);
      const up = clamp01(t / 0.65);
      const fw = clamp01((t - 0.45) / 0.55);
      const es = (k: number): number => k * k * (3 - 2 * k);
      this.pos.set(
        lerp(this.mantleFrom.x, this.mantleTo.x, es(fw)),
        lerp(this.mantleFrom.y, this.mantleTo.y, es(up)),
        lerp(this.mantleFrom.z, this.mantleTo.z, es(fw)),
      );
      this.vel.set(0, 0, 0);
      if (t >= 1) {
        this.mode = 'walk';
        this.grounded = true;
        this.mantleCooldown = 0.25;
      }
      this.syncBody(false);
      this.afterMove(dt, 0, drainMult);
      return;
    }

    if (this.mode === 'climb' && this.climb) {
      const z = this.climb;
      const tx = -z.nz;
      const tz = z.nx;
      // Lateral input relative to the wall, so A/D follow the view.
      const lateral = wx * tx + wz * tz;
      const vy = z.line ? clamp((z.y1 - 0.05 - this.pos.y) * 6, -2, 2) : mz * 2.3 * speedMultiplier(ratio);
      const press = z.line ? 0 : 0.6;
      const side = (z.line ? 2.1 : 1.4) * speedMultiplier(ratio);
      dx = (tx * lateral * side - z.nx * press) * dt;
      dz = (tz * lateral * side - z.nz * press) * dt;
      dy = vy * dt;
      const moving = Math.abs(mz) > 0.1 || Math.abs(lateral) > 0.1;
      this.useStamina((moving ? 9 : 2.5) * drainMult * dt);
      if (moving) {
        this.stride += Math.abs(vy) * dt + Math.abs(lateral) * dt;
        if (this.stride > 1.1) {
          this.stride = 0;
          game.sfx('rope', this.pos, 0.35);
        }
      }
      const out = !game.reg.climbAt(this.pos, 0.3) || game.reg.climbAt(this.pos, 0.3) !== z;
      if (this.jumpBuffer > 0) {
        this.jumpBuffer = 0;
        this.leaveClimb();
        this.vel.set(z.nx * 3.4, 4.6, z.nz * 3.4);
      } else if (this.stamina <= 0 || out) {
        this.leaveClimb();
      } else if (!z.line && this.pos.y >= z.y1 - 0.12 && mz > 0 && z.topOut) {
        this.startMantle(this.pos.x - z.nx * 0.95, z.y1 + 0.03, this.pos.z - z.nz * 0.95);
        this.climb = null;
        this.syncBody(false);
        return;
      } else if (this.grounded && (mz < -0.1 || z.line)) {
        this.leaveClimb();
      }
      if (this.mode === 'climb') {
        const res = this.moveKcc(dx, dy, dz);
        this.pos.x += res.x;
        this.pos.y += res.y;
        this.pos.z += res.z;
        this.pos.y = Math.min(this.pos.y, z.y1 + 0.05);
        this.grounded = this.kcc.computedGrounded();
        this.syncBody(false);
        this.afterMove(dt, 0, drainMult);
        return;
      }
    }

    if (this.mode === 'swim' && water) {
      const sp = 2.7 * speedMultiplier(ratio);
      this.vel.x = damp(this.vel.x, wx * sp, 4, dt);
      this.vel.z = damp(this.vel.z, wz * sp, 4, dt);
      const sinking = this.stamina <= 0;
      const targetY = water.surface - (sinking ? 2.2 : 1.32);
      this.vel.y = damp(this.vel.y, clamp((targetY - this.pos.y) * 4, -3, 2.2), 6, dt);
      if (wl > 0.1) this.useStamina(4.5 * drainMult * dt);
      else this.useStamina(1.2 * drainMult * dt);
      if (sinking) game.damage(DAMAGE.drownPerSec * dt, 'drowned');
      if (this.jumpBuffer > 0 || wl > 0.3) {
        if (this.tryMantle(wx, wz, wl, 2.0)) {
          this.jumpBuffer = 0;
          this.syncBody(false);
          return;
        }
      }
      const res = this.moveKcc((this.vel.x + ex) * dt, this.vel.y * dt, (this.vel.z + ez) * dt);
      this.pos.x += res.x;
      this.pos.y += res.y;
      this.pos.z += res.z;
      this.grounded = false;
      this.airSpeed = 0;
      this.stride += Math.hypot(res.x, res.z);
      if (this.stride > 1.6) {
        this.stride = 0;
        game.sfx('step_water', this.pos, 0.7);
        game.noise('splash', this.pos, 0.5);
      }
      this.syncBody(false);
      this.afterMove(dt, Math.hypot(res.x, res.z) / dt, drainMult);
      return;
    }

    // Walking, running, jumping, falling.
    const canSprint = input.sprint && mz > 0.1 && !this.crouching && !relighting && this.stamina > 0 && depth < 0.9;
    let speed = this.crouching ? CROUCH : canSprint ? SPRINT : WALK;
    speed *= speedMultiplier(ratio);
    if (relighting) speed *= 0.45;
    if (depth > 0.3) speed *= lerp(1, 0.5, clamp01(depth / 1.2));
    this.sprinting = canSprint && wl > 0.1 && this.grounded;
    if (this.sprinting) this.useStamina(12 * drainMult * dt);

    const accel = this.grounded ? 14 : 2.6;
    this.vel.x = damp(this.vel.x, wx * speed, accel, dt);
    this.vel.z = damp(this.vel.z, wz * speed, accel, dt);
    this.vel.y = Math.max(-45, this.vel.y - GRAVITY * dt);

    if (this.grounded) this.coyote = 0.11;
    else this.coyote = Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && !relighting && this.stamina >= 5) {
      if (this.crouching && this.headroom()) {
        this.crouchToggle = false;
        this.crouching = false;
        this.setHeight(STAND_HEIGHT);
      }
      if (!this.crouching) {
        this.vel.y = JUMP_SPEED * jumpMultiplier(ratio);
        this.jumpBuffer = 0;
        this.coyote = 0;
        this.grounded = false;
        this.useStamina(10 * drainMult);
        game.sfx('jump', this.pos, 0.6);
        game.noise('jump', this.pos);
      }
    }

    // Ledge grab while airborne.
    if (!this.grounded && this.mantleCooldown <= 0 && this.vel.y < 3.5 && (input.jumpHeld || mz > 0.3) && this.stamina >= 6) {
      if (this.tryMantle(wx, wz, wl, 2.25)) {
        this.syncBody(false);
        return;
      }
    }

    if (this.noclip) {
      const f = this.forward;
      const sp = input.sprint ? 30 : 10;
      this.pos.addScaledVector(f, mz * sp * dt);
      this.pos.x += cos * mx * sp * dt;
      this.pos.z += -sin * mx * sp * dt;
      this.vel.set(0, 0, 0);
      this.syncBody(true);
      this.afterMove(dt, 0, drainMult);
      return;
    }

    const wasGrounded = this.grounded;
    const fallSpeed = -this.vel.y;
    dx = (this.vel.x + ex) * dt;
    dy = this.vel.y * dt;
    dz = (this.vel.z + ez) * dt;
    const res = this.moveKcc(dx, dy, dz);
    this.pos.x += res.x;
    this.pos.y += res.y;
    this.pos.z += res.z;
    this.grounded = this.kcc.computedGrounded();
    // Lose the speed a wall took away. Climbing a slope also shortens the horizontal
    // step (to about cos^2 of the slope), and that must NOT bleed speed or stairs stall.
    const kx = Math.abs(dx) > 1e-5 ? Math.abs(res.x / dx) : 1;
    const kz = Math.abs(dz) > 1e-5 ? Math.abs(res.z / dz) : 1;
    if (kx < 0.3) this.vel.x *= clamp01(kx);
    if (kz < 0.3) this.vel.z *= clamp01(kz);
    if (this.vel.y > 0 && res.y < dy * 0.5) this.vel.y = 0;
    this.pushBlocks(wx, wz, wl);

    if (!this.grounded) {
      this.airSpeed = Math.max(this.airSpeed, fallSpeed);
    } else {
      if (!wasGrounded && this.airSpeed > 3.5) this.land(this.airSpeed, depth);
      this.airSpeed = 0;
      // No standing downward speed: snap-to-ground keeps the feet down on descents, and a
      // constant push into the floor turns into a push back down every slope.
      this.vel.y = 0;
    }
    this.syncBody(false);
    this.afterMove(dt, Math.hypot(res.x, res.z) / dt, drainMult);
  }

  private moveKcc(dx: number, dy: number, dz: number): { x: number; y: number; z: number } {
    const held = this.held?.body ?? null;
    this.kcc.computeColliderMovement(
      this.collider,
      { x: dx, y: dy, z: dz },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      GROUPS.player,
      held ? (c: RAPIER.Collider) => c.parent()?.handle !== held.handle : undefined,
    );
    return this.kcc.computedMovement();
  }

  /** Lean on a stone block and it slides, slowly. */
  private pushBlocks(wx: number, wz: number, wl: number): void {
    if (wl < 0.2 || !this.grounded) return;
    const n = this.kcc.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const c = this.kcc.computedCollision(i);
      if (!c || !c.collider) continue;
      const meta = this.game.physics.getMeta(c.collider);
      if (meta?.kind !== 'block') continue;
      const nrm = c.normal1;
      if (Math.abs(nrm.y) > 0.5) continue;
      // Push along the dominant horizontal axis of the contact, only if the player is walking into it.
      const into = -(wx * nrm.x + wz * nrm.z);
      if (into < 0.45) continue;
      const body = c.collider.parent();
      if (!body) continue;
      const ax = Math.abs(nrm.x) > Math.abs(nrm.z);
      const s = 1.25 * speedMultiplier(this.loadRatio);
      const v = body.linvel();
      body.setLinvel({ x: ax ? -Math.sign(nrm.x) * s : 0, y: v.y, z: ax ? 0 : -Math.sign(nrm.z) * s }, true);
      this.useStamina(5 * (1 / 60));
      (meta.owner as { pushed?: () => void } | undefined)?.pushed?.();
    }
  }

  private headroom(): boolean {
    const hit = this.game.physics.raycast(
      { x: this.pos.x, y: this.pos.y + CROUCH_HEIGHT - 0.1, z: this.pos.z },
      { x: 0, y: 1, z: 0 },
      STAND_HEIGHT - CROUCH_HEIGHT + 0.15,
      RAY.ground,
      this.held?.body,
    );
    return hit === null;
  }

  private leaveClimb(): void {
    this.mode = 'walk';
    this.climb = null;
    this.climbCooldown = 0.45;
    this.vel.set(0, 0, 0);
  }

  private startMantle(x: number, y: number, z: number): void {
    this.mode = 'mantle';
    this.mantleFrom.copy(this.pos);
    this.mantleTo.set(x, y, z);
    this.mantleT = 0;
    this.mantleDur = 0.34 + 0.16 * Math.max(0, y - this.pos.y);
    this.vel.set(0, 0, 0);
    this.airSpeed = 0;
    this.useStamina(8 * staminaDrainMultiplier(this.loadRatio));
    this.game.sfx('mantle', this.pos, 0.7);
  }

  /** Look for a ledge in front and pull up onto it. */
  private tryMantle(wx: number, wz: number, wl: number, reach: number): boolean {
    const ph = this.game.physics;
    let fx = wx;
    let fz = wz;
    if (wl < 0.2) {
      fx = -Math.sin(this.yaw);
      fz = -Math.cos(this.yaw);
    } else {
      fx /= wl;
      fz /= wl;
    }
    const p = this.pos;
    const ex = this.held?.body;
    // A wall in front at chest height...
    const wall = ph.raycast({ x: p.x, y: p.y + 0.9, z: p.z }, { x: fx, y: 0, z: fz }, 0.8, RAY.ground, ex)
      ?? ph.raycast({ x: p.x, y: p.y + 0.35, z: p.z }, { x: fx, y: 0, z: fz }, 0.8, RAY.ground, ex);
    if (!wall || Math.abs(wall.normal.y) > 0.4) return false;
    // ...with a flat top within reach...
    const top = ph.raycast({ x: p.x + fx * (wall.distance + 0.3), y: p.y + reach + 0.3, z: p.z + fz * (wall.distance + 0.3) }, { x: 0, y: -1, z: 0 }, reach + 0.3, RAY.ground, ex);
    if (!top || top.normal.y < 0.7) return false;
    const rise = top.point.y - p.y;
    if (rise < 0.55 || rise > reach) return false;
    // ...and room to crouch on it.
    if (ph.raycast({ x: top.point.x, y: top.point.y + 0.08, z: top.point.z }, { x: 0, y: 1, z: 0 }, CROUCH_HEIGHT, RAY.ground, ex)) return false;
    if (ph.raycast({ x: p.x, y: top.point.y + 0.4, z: p.z }, { x: fx, y: 0, z: fz }, wall.distance + 0.3, RAY.ground, ex)) return false;
    // And nothing overhead on the way up.
    if (ph.raycast({ x: p.x, y: p.y + this.height, z: p.z }, { x: 0, y: 1, z: 0 }, Math.max(0.05, rise - this.height + 1.2), RAY.ground, ex)) return false;
    this.startMantle(top.point.x + fx * 0.15, top.point.y + 0.03, top.point.z + fz * 0.15);
    return true;
  }

  private land(speed: number, depth: number): void {
    const game = this.game;
    const soft = depth > 0.6 ? clamp01(depth / 2) : 0;
    const impact = speed * (1 - soft * 0.8);
    this.landDip = Math.min(0.35, impact * 0.025);
    if (impact > 5) {
      game.sfx('land', this.pos, clamp01(impact / 14));
      game.noise('land', this.pos, clamp(impact / 9, 0.5, 1.6));
      game.particles.emit('dust', this.pos, 6, { spread: 0.3 });
    }
    const dmg = fallDamage(impact);
    if (dmg > 0) game.damage(dmg, 'fell');
    if (fallDouses(impact) && (game.run.torch.lit || game.run.torch.vulnerable)) game.torchEvent(game.run.torch.douse('fall'));
  }

  private useStamina(n: number): void {
    if (n <= 0) return;
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaDelay = 0.8;
  }

  /** Spend stamina from outside (throwing, kicking). */
  spend(n: number): void {
    this.useStamina(n * staminaDrainMultiplier(this.loadRatio));
  }

  private afterMove(dt: number, speed: number, drainMult: number): void {
    void drainMult;
    const game = this.game;
    this.speed = speed;
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);
    if (this.staminaDelay <= 0) this.stamina = Math.min(100, this.stamina + (this.crouching || speed < 0.5 ? 24 : 18) * dt);

    // Footsteps: sound for the player, noise for the crawlers.
    if (this.grounded && this.mode === 'walk' && speed > 0.6) {
      this.stride += speed * dt;
      const len = this.crouching ? 1.5 : this.sprinting ? 2.6 : 2.1;
      if (this.stride >= len) {
        this.stride = 0;
        const ground = game.physics.raycast({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z }, { x: 0, y: -1, z: 0 }, 0.9, RAY.ground, this.held?.body);
        this.surface = this.waterDepth > 0.15 ? 'water' : (ground?.meta?.surface ?? 'stone');
        const vol = this.crouching ? 0.22 : this.sprinting ? 0.9 : 0.55;
        game.sfx(`step_${this.surface}` as 'step_stone', this.pos, vol, 0.9 + Math.random() * 0.2);
        game.noise(this.crouching ? 'stepCrouch' : this.sprinting ? 'stepSprint' : 'stepWalk', this.pos, this.waterDepth > 0.3 ? 1.3 : 1);
        if (this.waterDepth > 0.15) game.particles.emit('splash', { x: this.pos.x, y: this.pos.y + this.waterDepth, z: this.pos.z }, 5, { spread: 0.2, speed: 0.5 });
      }
    }
    this.bob += speed * dt * (this.grounded ? 1 : 0);

    // Carried prop follows a point in front of the camera.
    if (this.held) {
      const h = this.held;
      this.updateEye(1);
      _a.copy(this.eye).addScaledVector(this.forward, 1.05);
      _a.y -= 0.28;
      const t = h.body.translation();
      _b.set(_a.x - t.x, _a.y - t.y, _a.z - t.z);
      if (_b.length() > 2.6) {
        this.dropHeld();
      } else {
        h.body.setLinvel({ x: _b.x * 16, y: _b.y * 16, z: _b.z * 16 }, true);
        const av = h.body.angvel();
        h.body.setAngvel({ x: av.x * 0.8, y: av.y * 0.8, z: av.z * 0.8 }, true);
      }
    }

    // Falling out of the world.
    if (this.pos.y < game.killY()) {
      const scene = game.scenes.current;
      game.die('died', scene === 'jungle' ? 'The gorge kept you.' : game.scenes.isDark(this.pos.y, scene) ? 'You fell into the dark.' : 'It was a long way down.');
    }
  }

  grab(prop: Prop): void {
    if (this.held) this.dropHeld();
    this.held = prop;
    prop.setHeld(true);
    this.game.sfx('drop', this.pos, 0.5, 1.4);
  }

  dropHeld(): void {
    const h = this.held;
    if (!h) return;
    this.held = null;
    h.setHeld(false);
    h.body.setLinvel({ x: this.vel.x, y: 0, z: this.vel.z }, true);
  }

  throwHeld(): void {
    const h = this.held;
    if (!h) return;
    this.held = null;
    h.setHeld(false);
    const power = 14 / (1 + h.mass / 9);
    const f = this.forward;
    h.body.setLinvel({ x: f.x * power + this.vel.x, y: f.y * power + 1.6, z: f.z * power + this.vel.z }, true);
    h.body.setAngvel({ x: Math.random() * 6 - 3, y: Math.random() * 6 - 3, z: Math.random() * 6 - 3 }, true);
    h.thrown = true;
    this.spend(4);
    this.game.sfx('throw', this.pos, 0.8);
  }

  /** Knock the player around (trap hits). */
  knock(x: number, y: number, z: number): void {
    this.vel.x += x;
    this.vel.y = Math.max(this.vel.y, y);
    this.vel.z += z;
    this.grounded = false;
    if (this.mode === 'climb') this.leaveClimb();
  }

  kill(): void {
    if (this.held) this.dropHeld();
    this.mode = 'dead';
    this.vel.set(0, 0, 0);
  }

  private updateEye(alpha: number): void {
    const x = lerp(this.prevPos.x, this.pos.x, alpha);
    const y = lerp(this.prevPos.y, this.pos.y, alpha);
    const z = lerp(this.prevPos.z, this.pos.z, alpha);
    this.eye.set(x, y + this.eyeH - this.landDip, z);
    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** Place the camera. Called every rendered frame with the physics interpolation factor. */
  frame(dt: number, alpha: number, camera: THREE.PerspectiveCamera): void {
    const targetEye = this.mode === 'dead' ? 0.35 : this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeH = damp(this.eyeH, targetEye, this.mode === 'dead' ? 3 : 12, dt);
    this.landDip = damp(this.landDip, 0, 9, dt);
    this.updateEye(alpha);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.shakeT += dt * 38;
    const s = this.shake * this.shake;
    const bobAmt = this.grounded && this.mode === 'walk' ? Math.min(1, this.speed / 5) : 0;
    const by = Math.sin(this.bob * 2.9) * 0.035 * bobAmt;
    const bx = Math.cos(this.bob * 1.45) * 0.025 * bobAmt;
    camera.position.set(
      this.eye.x + bx * Math.cos(this.yaw) + Math.sin(this.shakeT * 1.3) * s * 0.07,
      this.eye.y + by + Math.sin(this.shakeT * 1.7 + 1) * s * 0.07,
      this.eye.z - bx * Math.sin(this.yaw) + Math.sin(this.shakeT * 1.1 + 2) * s * 0.07,
    );
    const roll = this.mode === 'dead' ? 0.9 : Math.sin(this.shakeT) * s * 0.02 + (this.gusted ? 0.03 : 0);
    camera.rotation.set(this.pitch + Math.sin(this.shakeT * 0.9) * s * 0.02, this.yaw, roll, 'YXZ');
  }

  /** Was hit: brief invulnerability so one blade does not hit three times. */
  canBeHit(): boolean {
    if (this.hurtCooldown > 0) return false;
    this.hurtCooldown = 0.6;
    return true;
  }
}
