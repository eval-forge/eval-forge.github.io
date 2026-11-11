/**
 * First-person player: Rapier kinematic character controller with run / crouch / jump,
 * stamina, health, vine climbing, ledge mantling, swimming, fall damage and pushing.
 */
import * as THREE from 'three';
import { RAPIER, Physics, G_PLAYER, Q_PLAYER_MOVE, GROUP, groups } from '../engine/physics';
import type { Input } from '../engine/input';
import type { VineDef } from '../world/layout';
import { fallDamage } from '../logic/traps';
import type { Surface } from '../engine/audio';

export const RADIUS = 0.35;
export const HH_STAND = 0.55; // capsule half-height (total 1.8 m)
export const HH_CROUCH = 0.2; // total 1.1 m
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 0.95;
const GRAVITY = 20;

export interface WaterVolume {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  surface: number;
  bottom: number;
}

export interface PlayerEnv {
  speedMult(): number;
  canSprint(): boolean;
  relighting(): boolean;
  staminaMax: number;
  staminaRegen: number;
  climbFast: boolean;
  quietSteps: boolean;
  vines(): VineDef[];
  waters(): WaterVolume[];
  wind(): THREE.Vector3;
  onStep(surface: Surface, loudness: number, pos: THREE.Vector3): void;
  onLand(impact: number, surface: Surface, pos: THREE.Vector3): void;
  onDamage(amount: number, source: string): void;
  onPush(body: RAPIER.RigidBody, dir: THREE.Vector3): void;
  onStandOn(c: RAPIER.Collider): void;
  onSplash(pos: THREE.Vector3, big: boolean): void;
}

export class Player {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  ctrl: RAPIER.KinematicCharacterController;
  /** capsule centre */
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  crouching = false;
  grounded = false;
  private coyote = 0;
  private airborneMaxFall = 0;
  stamina = 100;
  private staminaIdle = 0;
  health = 100;
  private sinceHurt = 10;
  breath = 15;
  climbing: VineDef | null = null;
  mantle: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null = null;
  swimming = false;
  wading = 0; // water depth at feet
  eyeUnderwater = false;
  torchUnderwater = false;
  sprinting = false;
  moving = false;
  lastSafe = new THREE.Vector3();
  private safeT = 0;
  private stepAcc = 0;
  groundCollider: RAPIER.Collider | null = null;
  surface: Surface = 'stone';
  dead = false;
  frozen = false;
  bob = 0;
  landKick = 0;
  externalVel = new THREE.Vector3();

  constructor(private physics: Physics, private input: Input, private env: PlayerEnv) {
    const w = physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 5, 0));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(HH_STAND, RADIUS).setCollisionGroups(G_PLAYER).setFriction(0), this.body);
    physics.tag(this.collider, { kind: 'static' });
    this.ctrl = w.createCharacterController(0.03);
    this.ctrl.enableAutostep(0.45, 0.2, true);
    this.ctrl.enableSnapToGround(0.35);
    this.ctrl.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.ctrl.setMinSlopeSlideAngle((58 * Math.PI) / 180);
    // pushing / weighing on dynamic bodies is done explicitly (Game.onPlayerPush, the
    // bridge's stand handler): the controller's own impulses make jointed chains explode
    this.ctrl.setApplyImpulsesToDynamicBodies(false);
    this.ctrl.setCharacterMass(70);
    this.ctrl.setSlideEnabled(true);
  }

  get hh() {
    return this.crouching ? HH_CROUCH : HH_STAND;
  }

  get feetY() {
    return this.pos.y - this.hh - RADIUS;
  }

  get height() {
    return (this.hh + RADIUS) * 2;
  }

  feet(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.feetY, this.pos.z);
  }

  eye(out = new THREE.Vector3()) {
    const e = this.crouching ? EYE_CROUCH : EYE_STAND;
    return out.set(this.pos.x, this.feetY + e, this.pos.z);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  lookDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  teleport(feetX: number, feetY: number, feetZ: number, yaw?: number) {
    this.pos.set(feetX, feetY + this.hh + RADIUS + 0.02, feetZ);
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.vel.set(0, 0, 0);
    this.airborneMaxFall = 0;
    this.climbing = null;
    this.mantle = null;
    if (yaw !== undefined) this.yaw = yaw;
    this.lastSafe.set(feetX, feetY, feetZ);
  }

  reset(stamMax: number) {
    this.health = 100;
    this.stamina = stamMax;
    this.breath = 15;
    this.dead = false;
    this.crouching = false;
    this.collider.setShape(new RAPIER.Capsule(HH_STAND, RADIUS));
    this.vel.set(0, 0, 0);
    this.climbing = null;
    this.mantle = null;
    this.swimming = false;
  }

  look(dx: number, dy: number, sens: number, invert: boolean) {
    const k = 0.0022 * sens;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invert ? -1 : 1);
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  damage(n: number, source: string) {
    if (this.dead || n <= 0) return;
    this.health = Math.max(0, this.health - n);
    this.sinceHurt = 0;
    this.env.onDamage(n, source);
  }

  private moveFilter = (c: RAPIER.Collider) => {
    // ignore sensors (handled by flags) and anything not solid for the player
    return !c.isSensor();
  };

  private setCrouch(on: boolean) {
    if (on === this.crouching) return;
    if (!on) {
      // need headroom to stand
      const head = new THREE.Vector3(this.pos.x, this.feetY + 1.05, this.pos.z);
      const up = new THREE.Vector3(0, 1, 0);
      for (const [ox, oz] of [
        [0, 0],
        [0.25, 0],
        [-0.25, 0],
        [0, 0.25],
        [0, -0.25],
      ]) {
        const from = head.clone().add(new THREE.Vector3(ox, 0, oz));
        if (this.physics.ray(from, up, 0.8, groups(0xffff, GROUP.STATIC | GROUP.DYNAMIC), this.collider)) return;
      }
    }
    const feet = this.feetY;
    this.crouching = on;
    this.collider.setShape(new RAPIER.Capsule(this.hh, RADIUS));
    this.pos.y = feet + this.hh + RADIUS;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
  }

  private inWater(): { w: WaterVolume; depth: number } | null {
    const fy = this.feetY;
    for (const w of this.env.waters()) {
      if (this.pos.x >= w.x0 && this.pos.x <= w.x1 && this.pos.z >= w.z0 && this.pos.z <= w.z1 && fy < w.surface) {
        return { w, depth: w.surface - fy };
      }
    }
    return null;
  }

  private findVine(): VineDef | null {
    const p = this.pos;
    const fwd = this.forward();
    for (const v of this.env.vines()) {
      const m = 0.45;
      if (p.x < v.x0 - m || p.x > v.x1 + m || p.z < v.z0 - m || p.z > v.z1 + m) continue;
      if (this.feetY > v.y1 + 0.2 || p.y < v.y0 - 0.5) continue;
      // facing the wall (opposite the vine normal)
      if (fwd.x * -v.n[0] + fwd.z * -v.n[1] < 0.2) continue;
      return v;
    }
    return null;
  }

  /** Try to find a ledge to mantle onto. */
  private tryMantle(): boolean {
    const fwd = this.forward();
    const feet = this.feet();
    const wallHit = this.physics.ray(feet.clone().add(new THREE.Vector3(0, 0.55, 0)), fwd, 0.95, groups(0xffff, GROUP.STATIC | GROUP.DYNAMIC), this.collider);
    const wallHit2 = this.physics.ray(feet.clone().add(new THREE.Vector3(0, 1.2, 0)), fwd, 0.95, groups(0xffff, GROUP.STATIC | GROUP.DYNAMIC), this.collider);
    const hit = wallHit ?? wallHit2;
    if (!hit || Math.abs(hit.normal.y) > 0.5) return false;
    const reach = hit.toi + 0.45;
    const start = feet.clone().addScaledVector(fwd, reach).add(new THREE.Vector3(0, 2.45, 0));
    const top = this.physics.ray(start, new THREE.Vector3(0, -1, 0), 2.0, groups(0xffff, GROUP.STATIC | GROUP.DYNAMIC), this.collider);
    if (!top || top.normal.y < 0.7) return false;
    const h = top.point.y - feet.y;
    if (h < 0.45 || h > 2.2) return false;
    // clearance for a crouched capsule at the target
    const center = top.point.clone().add(new THREE.Vector3(0, HH_CROUCH + RADIUS + 0.06, 0));
    const blocked = this.physics.world.intersectionWithShape(
      { x: center.x, y: center.y, z: center.z },
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Capsule(HH_CROUCH, RADIUS - 0.02),
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(0xffff, GROUP.STATIC | GROUP.DYNAMIC),
      this.collider,
    );
    if (blocked) return false;
    if (this.stamina < 6) return false;
    this.stamina -= 6;
    // mantle into a crouch, then stand if there's room
    this.setCrouch(true);
    const to = top.point.clone().add(new THREE.Vector3(0, this.hh + RADIUS + 0.05, 0));
    this.mantle = { from: this.pos.clone(), to, t: 0, dur: 0.42 + h * 0.08 };
    this.vel.set(0, 0, 0);
    this.climbing = null;
    return true;
  }

  fixedUpdate(dt: number) {
    if (this.dead || this.frozen) return;
    const inp = this.input;
    this.sinceHurt += dt;
    if (this.sinceHurt > 8 && this.health < 100) this.health = Math.min(100, this.health + 2 * dt);

    // ------------------------------------------------ mantling animation
    if (this.mantle) {
      const m = this.mantle;
      m.t += dt;
      const t = Math.min(1, m.t / m.dur);
      // up first, then over
      const up = Math.min(1, t / 0.6);
      const over = Math.max(0, (t - 0.35) / 0.65);
      const p = new THREE.Vector3(
        m.from.x + (m.to.x - m.from.x) * over,
        m.from.y + (m.to.y - m.from.y) * (1 - (1 - up) * (1 - up)),
        m.from.z + (m.to.z - m.from.z) * over,
      );
      this.pos.copy(p);
      this.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      if (t >= 1) {
        this.mantle = null;
        this.grounded = true;
        this.setCrouch(false);
      }
      return;
    }

    // ------------------------------------------------ water state
    const water = this.inWater();
    const eyeY = this.feetY + (this.crouching ? EYE_CROUCH : EYE_STAND);
    this.wading = water ? water.depth : 0;
    const wasSwimming = this.swimming;
    this.swimming = !!water && water.depth > 1.15;
    this.eyeUnderwater = !!water && eyeY < water.w.surface - 0.05;
    this.torchUnderwater = !!water && eyeY - 0.35 < water.w.surface;
    if (this.swimming && !wasSwimming && this.vel.y < -4) this.env.onSplash(this.feet(), true);
    if (this.eyeUnderwater) {
      this.breath = Math.max(0, this.breath - dt);
      if (this.breath <= 0) this.damage(12 * dt, 'drowned');
    } else this.breath = Math.min(15, this.breath + dt * 4);

    // ------------------------------------------------ crouch
    const wantCrouch = inp.isHeld('crouch') && !this.swimming && !this.climbing;
    this.setCrouch(wantCrouch);

    // ------------------------------------------------ input → wish velocity
    const fwd = this.forward();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3().addScaledVector(fwd, inp.moveY).addScaledVector(right, inp.moveX);
    if (wish.lengthSq() > 1) wish.normalize();
    this.moving = wish.lengthSq() > 0.01;
    const relight = this.env.relighting();
    const canSprint = !this.crouching && !relight && this.env.canSprint() && inp.moveY > 0.3 && this.stamina > 1 && !this.swimming;
    this.sprinting = canSprint && inp.isHeld('sprint') && this.moving;
    let speed = this.crouching ? 2.1 : this.sprinting ? 6.9 : 4.3;
    speed *= this.env.speedMult();
    if (relight) speed *= 0.4;
    if (this.wading > 0.35 && !this.swimming) speed *= 0.62;
    if (this.swimming) speed = 2.7 * Math.max(0.6, this.env.speedMult());

    // stamina
    const stamMax = this.env.staminaMax;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - 15 * dt * (2 - this.env.speedMult()));
      this.staminaIdle = 0;
    } else if (this.climbing) {
      if (!this.env.climbFast) this.stamina = Math.max(0, this.stamina - 6 * dt * (2 - this.env.speedMult()));
      this.staminaIdle = 0;
    } else {
      this.staminaIdle += dt;
      if (this.staminaIdle > 0.7) this.stamina = Math.min(stamMax, this.stamina + this.env.staminaRegen * dt);
    }

    // ------------------------------------------------ climbing
    if (!this.climbing && !this.swimming) {
      const v = this.findVine();
      if (v && (inp.moveY > 0.3 || (!this.grounded && inp.isHeld('jump'))) && this.stamina > 3) {
        this.climbing = v;
        this.vel.set(0, 0, 0);
      }
    }
    if (this.climbing) {
      const v = this.climbing;
      const climbSpeed = this.env.climbFast ? 3.0 : 2.1;
      const lateral = new THREE.Vector3(-v.n[1], 0, v.n[0]); // along the wall
      // map strafe to "right" relative to the view
      const latSign = right.dot(lateral) >= 0 ? 1 : -1;
      const move = new THREE.Vector3()
        .addScaledVector(lateral, inp.moveX * latSign * 1.6)
        .add(new THREE.Vector3(0, inp.moveY * climbSpeed, 0))
        // hug the wall
        .add(new THREE.Vector3(-v.n[0] * 0.6, 0, -v.n[1] * 0.6));
      const pressJump = inp.pressed('jump');
      let leave = false;
      if (pressJump) {
        // at the top: mantle; otherwise push off
        if (!this.tryMantle()) {
          this.vel.set(v.n[0] * 4.5, 5, v.n[1] * 4.5);
          leave = true;
        }
      }
      if (this.mantle) return;
      if (this.stamina <= 0) leave = true;
      // reached the top of the vine: auto mantle
      if (!leave && this.feetY > v.y1 - 1.4 && inp.moveY > 0.3) {
        if (this.tryMantle()) return;
      }
      const stillOn = this.pos.x >= v.x0 - 0.7 && this.pos.x <= v.x1 + 0.7 && this.pos.z >= v.z0 - 0.7 && this.pos.z <= v.z1 + 0.7 && this.feetY <= v.y1 + 0.1 && this.pos.y >= v.y0 - 0.2;
      if (!stillOn || inp.isHeld('crouch')) leave = true;
      if (leave) {
        this.climbing = null;
      } else {
        this.applyMove(move.multiplyScalar(dt), dt, false);
        this.airborneMaxFall = 0;
        this.vel.set(0, 0, 0);
        this.stepSounds(dt, move.length() * 0.3, 'grass');
        return;
      }
    }

    // ------------------------------------------------ horizontal velocity
    const target = wish.multiplyScalar(speed);
    const accel = this.grounded || this.swimming ? 38 : 7;
    const dv = new THREE.Vector3(target.x - this.vel.x, 0, target.z - this.vel.z);
    const maxDv = accel * dt;
    if (dv.length() > maxDv) dv.setLength(maxDv);
    this.vel.x += dv.x;
    this.vel.z += dv.z;

    // ------------------------------------------------ vertical
    if (this.swimming) {
      const up = (inp.isHeld('jump') ? 1 : 0) - (inp.isHeld('crouch') ? 1 : 0);
      const buoy = water ? Math.min(1, (water.depth - 1.2) * 1.5) : 0;
      this.vel.y += (up * 9 + buoy * 4 - 3) * dt;
      this.vel.y *= Math.exp(-3 * dt);
      this.vel.y = Math.max(-3, Math.min(3, this.vel.y));
      // climb out at the edge
      if (inp.pressed('jump') && water && water.depth < 1.9) this.tryMantle();
      if (this.mantle) return;
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.wading > 0.3) this.vel.y = Math.max(this.vel.y, -6);
      if (this.grounded) this.coyote = 0.12;
      else this.coyote -= dt;
      if (inp.pressed('jump') && !relight) {
        if (!this.tryMantle()) {
          if (this.coyote > 0 && this.stamina >= 6) {
            this.vel.y = this.crouching ? 4.5 : 6.4;
            this.stamina -= 6;
            this.coyote = 0;
            this.grounded = false;
          }
        } else return;
      }
    }

    // wind / knockback
    const wind = this.env.wind();
    const ext = this.externalVel;
    const disp = new THREE.Vector3((this.vel.x + wind.x + ext.x) * dt, (this.vel.y + ext.y) * dt, (this.vel.z + wind.z + ext.z) * dt);
    ext.multiplyScalar(Math.exp(-4 * dt));
    if (ext.lengthSq() < 0.01) ext.set(0, 0, 0);
    const fallSpeed = -this.vel.y;
    const wasGrounded = this.grounded;
    this.applyMove(disp, dt, true);

    if (!this.grounded) this.airborneMaxFall = Math.max(this.airborneMaxFall, fallSpeed);
    if (this.grounded) {
      if (!wasGrounded && this.airborneMaxFall > 3) {
        const impact = this.airborneMaxFall;
        const inWater = this.wading > 0.8;
        if (!inWater) {
          const dmg = fallDamage(impact);
          if (dmg > 0) this.damage(dmg, 'fall');
        }
        this.landKick = Math.min(1, impact / 14);
        this.env.onLand(impact, inWater ? 'water' : this.surface, this.feet());
      }
      this.airborneMaxFall = 0;
      if (this.vel.y < 0) this.vel.y = 0;
    }

    // footsteps
    if (this.grounded && this.moving) {
      const spd = Math.hypot(this.vel.x, this.vel.z);
      const surf: Surface = this.wading > 0.15 ? 'water' : this.surface;
      this.stepSounds(dt, spd, surf);
    }

    // last safe position (for the rope)
    this.safeT += dt;
    if (this.grounded && this.safeT > 0.4) {
      this.safeT = 0;
      const tag = this.physics.tagOf(this.groundCollider);
      if (tag && tag.kind === 'static' && this.wading < 0.3) this.lastSafe.copy(this.feet());
    }
  }

  private stepSounds(dt: number, spd: number, surf: Surface) {
    const stride = this.sprinting ? 2.3 : this.crouching ? 1.1 : 1.75;
    this.stepAcc += spd * dt;
    this.bob += spd * dt * 2.2;
    if (this.stepAcc >= stride) {
      this.stepAcc = 0;
      let loud = this.sprinting ? 0.4 : this.crouching ? 0.05 : 0.17;
      if (this.env.quietSteps) loud *= 0.7;
      if (surf === 'water') loud += 0.12;
      if (surf === 'wood') loud += 0.05;
      this.env.onStep(surf, loud, this.feet());
    }
  }

  private applyMove(disp: THREE.Vector3, dt: number, collectCollisions: boolean) {
    this.ctrl.computeColliderMovement(this.collider, { x: disp.x, y: disp.y, z: disp.z }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, Q_PLAYER_MOVE, this.moveFilter);
    const m = this.ctrl.computedMovement();
    this.grounded = this.ctrl.computedGrounded();
    this.pos.x += m.x;
    this.pos.y += m.y;
    this.pos.z += m.z;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    // hitting a ceiling kills upward velocity
    if (disp.y > 0 && m.y < disp.y * 0.5) this.vel.y = Math.min(this.vel.y, 0);
    if (!collectCollisions) return;
    this.groundCollider = null;
    const n = this.ctrl.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const c = this.ctrl.computedCollision(i);
      if (!c || !c.collider) continue;
      const normal = c.normal1;
      if (normal.y > 0.6) {
        this.groundCollider = c.collider;
        this.env.onStandOn(c.collider);
      } else if (Math.abs(normal.y) < 0.4) {
        const b = c.collider.parent();
        if (b && b.isDynamic()) this.env.onPush(b, new THREE.Vector3(-normal.x, 0, -normal.z));
      }
    }
    // ground probe for surface + standing triggers even if no collision event this step
    if (this.grounded && !this.groundCollider) {
      const hit = this.physics.ray(this.feet().add(new THREE.Vector3(0, 0.1, 0)), new THREE.Vector3(0, -1, 0), 0.4, Q_PLAYER_MOVE, this.collider);
      if (hit) {
        this.groundCollider = hit.collider;
        this.env.onStandOn(hit.collider);
      }
    }
    const tag = this.physics.tagOf(this.groundCollider);
    if (tag?.surface) this.surface = tag.surface;
    else if (tag?.kind === 'plank') this.surface = 'wood';
    else if (this.groundCollider) this.surface = 'stone';
  }
}
