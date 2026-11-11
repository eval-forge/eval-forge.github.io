/**
 * The temple's guardians. Each one is a pure state machine (core/guardianFsm)
 * driving a navmesh agent, with a procedural body and a voice.
 *
 *   Stone Sentinel  slow, sees a lit torch from far away, a little deaf
 *   Crawler         blind, fast, hunts footsteps and thrown things
 *   Shade           sees in the dark, cannot bear light
 *
 * They simulate on the navmesh whether or not their scene is streamed in, so
 * the sweep from the vault to the great door is real.
 */
import * as THREE from 'three';
import { GUARDIAN_SPECS, createBrain, think, wake, type Brain, type Decision, type GuardianType, type Percepts } from '../core/guardianFsm';
import { loudestHeard } from '../core/noise';
import { angleDiff, clamp01, damp } from '../core/rng';
import { SCENES, type SceneId, type Vec3Like } from '../core/scenes';
import { GROUPS, RAPIER, RAY } from '../engine/physics';
import { allGuardianSpawns, sceneAt, sweepRoute, type GuardianSpawnDef } from '../world/layout';
import type { Game } from './game';

const THINK = 0.12;
const EYE: Record<GuardianType, number> = { sentinel: 2.2, crawler: 0.45, shade: 1.7 };
const PATROL_SCENES: SceneId[] = ['courtyard', 'courtyard', 'halls'];

const _v = new THREE.Vector3();

interface Rig {
  root: THREE.Group;
  body: THREE.Object3D;
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  head: THREE.Object3D;
}

export class Guardian {
  readonly type: GuardianType;
  readonly brain: Brain;
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  yaw = 0;
  private heading = 0;
  scene: SceneId;
  private rect = -1;
  private path: Vec3Like[] = [];
  private pathI = 0;
  private goal: Vec3Like | null = null;
  private arrived = false;
  private speed = 0;
  private wantSpeed = 0;
  private moving = false;
  private readonly sweep: Vec3Like[];
  private sweepI = 0;
  private patrol: Vec3Like | null = null;
  private thinkT: number;
  private lastThink = 0;
  private readonly rig: Rig;
  private dark: boolean;
  private animT = Math.random() * 10;
  private stride = 0;
  private callT = 3 + Math.random() * 4;
  private orbit = Math.random() < 0.5 ? 1 : -1;
  private lightSrc: Vec3Like | null = null;
  private body: RAPIER.RigidBody | null = null;
  /** Distance to the player at the last think. */
  dist = 999;
  sees = false;

  constructor(
    private readonly game: Game,
    readonly def: GuardianSpawnDef,
    index: number,
  ) {
    this.type = def.type;
    this.brain = createBrain(def.type);
    this.pos.set(def.pos.x, def.pos.y, def.pos.z);
    this.prev.copy(this.pos);
    this.yaw = this.heading = def.facing;
    this.scene = def.scene;
    this.sweep = sweepRoute(def.scene);
    this.thinkT = (index % 6) * 0.02;
    this.rect = game.nav.locate(def.pos.x, def.pos.y, def.pos.z);
    this.dark = SCENES[def.scene].zone === 'C';
    this.rig = buildRig(game, def.type, this.dark);
    this.rig.root.visible = false;
    game.renderer.scene.add(this.rig.root);
    if (def.type === 'sentinel') {
      // A statue you cannot walk through. Kinematic, so it ignores walls and shoves loose props aside.
      const w = game.physics.world;
      this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y + 1.2, this.pos.z));
      const c = w.createCollider(RAPIER.ColliderDesc.capsule(0.75, 0.45).setCollisionGroups(GROUPS.guardian), this.body);
      game.physics.setMeta(c, { kind: 'guardian', surface: 'stone' });
    }
  }

  get awake(): boolean {
    return this.brain.state !== 'dormant';
  }

  wake(delay: number): void {
    if (!wake(this.brain)) return;
    this.brain.stateTime = -delay;
    this.lastThink = this.game.run.time;
  }

  // -------------------------------------------------------------- thinking

  private percepts(dt: number): Percepts {
    const game = this.game;
    const player = game.player;
    const run = game.run;
    const torch = run.torch;
    const eye = EYE[this.type];
    const px = player.pos.x;
    const py = player.centerY;
    const pz = player.pos.z;
    const dx = px - this.pos.x;
    const dy = py - (this.pos.y + Math.min(1, eye));
    const dz = pz - this.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    this.dist = dist;
    const present = player.alive && player.pos.z < 41.6 && game.state === 'playing';
    const loaded = game.scenes.loaded.has(this.scene);
    let los = false;
    if (present && loaded && dist < 60) {
      los = game.physics.clearLine({ x: this.pos.x, y: this.pos.y + eye, z: this.pos.z }, { x: player.eye.x, y: player.eye.y - 0.1, z: player.eye.z }, RAY.sight);
    }
    const toPlayer = Math.atan2(dx, dz);
    // Light: the hand torch and any mounted sconces.
    let playerSafe = torch.lit ? torch.shadeSafeRadius : 0;
    let playerLit = torch.lit;
    let selfInLight = false;
    this.lightSrc = null;
    for (const s of game.reg.sconces) {
      if (!s.lit) continue;
      const safe = s.radius * 0.8;
      const dp = Math.hypot(s.pos.x - px, s.pos.y - py, s.pos.z - pz);
      if (dp < safe) {
        playerLit = true;
        playerSafe = Math.max(playerSafe, safe - dp);
      }
      const ds = Math.hypot(s.pos.x - this.pos.x, s.pos.y - (this.pos.y + 1), s.pos.z - this.pos.z);
      if (ds < safe) {
        selfInLight = true;
        this.lightSrc = s.pos;
      }
    }
    if (torch.lit && los && dist < torch.shadeSafeRadius) {
      selfInLight = true;
      this.lightSrc = player.pos;
    }
    const spec = this.brain.spec;
    let heard: Percepts['heard'] = null;
    if (spec.hearing > 0) {
      const since = this.lastThink;
      let fresh = run.noises;
      if (fresh.length > 0 && fresh[0].t <= since) fresh = fresh.filter((n) => n.t > since);
      const h = loudestHeard(fresh, this.pos, spec.hearing);
      if (h) heard = { pos: h.noise.pos, loudness: h.loudness };
    }
    this.lastThink = run.time;
    return {
      dt,
      selfPos: this.pos,
      playerPos: { x: px, y: player.pos.y, z: pz },
      dist,
      lineOfSight: los,
      angleToPlayer: Math.abs(angleDiff(toPlayer, this.yaw)),
      playerLit,
      playerSafeRadius: playerSafe,
      selfInLight,
      heard,
      arrived: this.arrived,
      playerPresent: present,
    };
  }

  private think(dt: number): void {
    const game = this.game;
    const p = this.percepts(dt);
    const before = this.brain.state;
    const d = think(this.brain, p);
    this.sees = d.state === 'chase' || d.state === 'repelled';
    if (d.call) this.voice(d.call);
    if (before === 'waking' && d.state !== 'waking') {
      game.particles.emit('dust', { x: this.pos.x, y: this.pos.y + 1, z: this.pos.z }, 16, { spread: 0.6 });
    }
    if (d.caught) {
      const name = this.brain.spec.name;
      const how: Record<GuardianType, string> = {
        sentinel: `A ${name} closed its hand around you.`,
        crawler: `A ${name} heard you, and then it had you.`,
        shade: `The ${name} found you in the dark.`,
      };
      game.sfx(this.type, this.pos, 1, 0.8);
      game.die('caught', how[this.type]);
      return;
    }
    this.execute(d);
  }

  private voice(call: NonNullable<Decision['call']>): void {
    const game = this.game;
    const at = { x: this.pos.x, y: this.pos.y + 1, z: this.pos.z };
    switch (call) {
      case 'wake':
        game.sfx('wake', at, 1, this.type === 'sentinel' ? 0.7 : this.type === 'crawler' ? 1.4 : 1, 60);
        break;
      case 'alert':
        game.sfx(this.type, at, 1, 1.1, 55);
        break;
      case 'lost':
        game.sfx(this.type, at, 0.5, 0.75, 40);
        break;
      case 'hiss':
        game.sfx('shade', at, 0.9, 1.5, 40);
        break;
    }
    this.callT = 4 + Math.random() * 5;
  }

  private execute(d: Decision): void {
    const game = this.game;
    this.wantSpeed = d.speed;
    const m = d.move;
    switch (m.kind) {
      case 'none':
        this.path = [];
        this.pathI = 0;
        break;
      case 'sweep':
        this.setGoal(this.sweepTarget());
        break;
      case 'point':
        this.setGoal(m.pos);
        break;
      case 'holdEdge': {
        // Hover on the rim of the light, drifting round it.
        const ang = Math.atan2(this.pos.x - m.around.x, this.pos.z - m.around.z) + this.orbit * 0.3;
        this.setGoal({ x: m.around.x + Math.sin(ang) * m.radius, y: m.around.y, z: m.around.z + Math.cos(ang) * m.radius });
        if (Math.random() < 0.01) this.orbit = -this.orbit;
        break;
      }
      case 'fleeLight': {
        const src = this.lightSrc ?? game.player.pos;
        let ax = this.pos.x - src.x;
        let az = this.pos.z - src.z;
        const l = Math.hypot(ax, az) || 1;
        ax /= l;
        az /= l;
        this.setGoal({ x: this.pos.x + ax * 6, y: this.pos.y, z: this.pos.z + az * 6 });
        break;
      }
    }
  }

  /** Next waypoint on the way out to the great door; after that, patrol near it. */
  private sweepTarget(): Vec3Like {
    while (this.sweepI < this.sweep.length) {
      const w = this.sweep[this.sweepI];
      if (Math.hypot(w.x - this.pos.x, w.z - this.pos.z) < 1.6 && Math.abs(w.y - this.pos.y) < 2.5) this.sweepI++;
      else return w;
    }
    const p = this.patrol;
    if (!p || Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 1.6 || this.arrived) {
      const scene = PATROL_SCENES[Math.floor(Math.random() * PATROL_SCENES.length)];
      this.patrol = this.game.nav.pointInScene(scene, Math.random(), Math.random(), Math.random()) ?? { x: 0, y: 0, z: 30 };
    }
    return this.patrol!;
  }

  private setGoal(goal: Vec3Like): void {
    const g = this.goal;
    const same = g !== null && Math.hypot(g.x - goal.x, g.y - goal.y, g.z - goal.z) < 0.7;
    if (same && (this.arrived || this.pathI < this.path.length)) return;
    this.goal = { x: goal.x, y: goal.y, z: goal.z };
    const path = this.game.nav.findPath(this.pos, goal);
    if (!path || path.points.length < 2) {
      // Cut off (a closed gate) or already there.
      this.path = [];
      this.pathI = 0;
      this.arrived = true;
      if (!path && this.brain.state === 'sweep') {
        if (this.sweepI < this.sweep.length) this.sweepI++;
        else this.patrol = null;
      }
      return;
    }
    this.path = path.points;
    this.pathI = 1;
    this.arrived = false;
  }

  // ---------------------------------------------------------------- moving

  step(dt: number): void {
    this.prev.copy(this.pos);
    if (this.brain.state === 'dormant') return;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT += THINK;
      this.think(THINK);
    }
    const nav = this.game.nav;
    this.speed = damp(this.speed, this.pathI < this.path.length ? this.wantSpeed : 0, 6, dt);
    this.moving = false;
    if (this.pathI < this.path.length && this.speed > 0.01) {
      let left = this.speed * dt;
      while (left > 0 && this.pathI < this.path.length) {
        const t = this.path[this.pathI];
        const dx = t.x - this.pos.x;
        const dz = t.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-4) this.heading = Math.atan2(dx, dz);
        if (d <= left) {
          this.pos.x = t.x;
          this.pos.z = t.z;
          left -= d;
          this.pathI++;
        } else {
          this.pos.x += (dx / d) * left;
          this.pos.z += (dz / d) * left;
          left = 0;
        }
      }
      this.moving = true;
      if (this.pathI >= this.path.length) this.arrived = true;
      this.rect = nav.locateFrom(this.rect, this.pos.x, this.pos.y, this.pos.z);
      if (this.rect < 0) {
        const n = nav.nearest(this.pos.x, this.pos.y, this.pos.z);
        if (n) {
          this.rect = n.rect;
          this.pos.x = n.x;
          this.pos.z = n.z;
        }
      }
      if (this.rect >= 0) this.pos.y = damp(this.pos.y, nav.heightAt(this.rect, this.pos.x, this.pos.z), 18, dt);
      this.scene = sceneAt(this.pos, this.scene) ?? this.scene;
    }
    // Face the player when hunting by sight, otherwise the way it is going.
    const turn = this.type === 'sentinel' ? 2.6 : 7;
    this.yaw += angleDiff(this.heading, this.yaw) * Math.min(1, turn * dt);
    this.body?.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + 1.2, z: this.pos.z });

    // Voice and footfalls.
    const game = this.game;
    if (this.moving) {
      this.stride += this.speed * dt;
      const len = this.type === 'sentinel' ? 1.5 : this.type === 'crawler' ? 0.55 : 99;
      if (this.stride >= len) {
        this.stride = 0;
        if (this.type === 'sentinel') {
          game.sfx('thud', this.pos, 0.9, 0.7, 36);
          if (this.dist < 9) game.shake(0.22 * (1 - this.dist / 9));
        } else if (this.dist < 30) {
          game.sfx('scarab', this.pos, 0.5, 0.7 + Math.random() * 0.3, 26);
        }
      }
    }
    this.callT -= dt;
    if (this.callT <= 0 && this.brain.state !== 'waking') {
      this.callT = 5 + Math.random() * 6;
      if (this.dist < 55) game.sfx(this.type, { x: this.pos.x, y: this.pos.y + 1, z: this.pos.z }, 0.55, 0.9 + Math.random() * 0.2, 48);
    }
  }

  // --------------------------------------------------------------- drawing

  frame(dt: number, alpha: number): void {
    const game = this.game;
    const rig = this.rig;
    const loaded = game.scenes.loaded.get(this.scene);
    const state = this.brain.state;
    const visible = !!loaded && loaded.group.visible && !(this.type === 'shade' && state === 'dormant');
    rig.root.visible = visible;
    if (!visible) return;
    const dark = SCENES[this.scene].zone === 'C';
    if (dark !== this.dark) {
      this.dark = dark;
      game.mats.applyZone(rig.root, dark);
    }
    _v.lerpVectors(this.prev, this.pos, alpha);
    rig.root.position.copy(_v);
    rig.root.rotation.y = this.yaw;
    const move = clamp01(this.speed / 2);
    this.animT += dt * (this.type === 'crawler' ? 4 + this.speed * 5 : 1.2 + this.speed * 2.2);
    const t = this.animT;
    const waking = state === 'waking' ? clamp01(this.brain.stateTime / this.brain.spec.wakeTime) : state === 'dormant' ? 0 : 1;
    switch (this.type) {
      case 'sentinel': {
        const sw = Math.sin(t) * 0.55 * move;
        rig.legs[0].rotation.x = sw;
        rig.legs[1].rotation.x = -sw;
        rig.arms[0].rotation.x = -sw * 0.8 - 0.1 * waking;
        rig.arms[1].rotation.x = sw * 0.8 - 0.1 * waking;
        // Dormant: arms folded up across the chest.
        rig.arms[0].rotation.z = (1 - waking) * -0.5;
        rig.arms[1].rotation.z = (1 - waking) * 0.5;
        rig.body.position.y = Math.abs(Math.cos(t)) * 0.05 * move;
        const shudder = state === 'waking' ? Math.sin(game.time * 41) * 0.025 * (1 - waking) + Math.sin(game.time * 67) * 0.012 : 0;
        rig.body.rotation.z = shudder;
        rig.head.rotation.y = state === 'search' || state === 'investigate' ? Math.sin(game.time * 1.3) * 0.7 : 0;
        break;
      }
      case 'crawler': {
        for (let i = 0; i < rig.legs.length; i++) {
          const ph = t + (i % 2 ? Math.PI : 0) + Math.floor(i / 2) * 0.9;
          const curl = 1 - waking;
          rig.legs[i].rotation.y = Math.sin(ph) * 0.5 * (0.15 + move);
          rig.legs[i].rotation.z = (i % 2 ? -1 : 1) * (0.25 + curl * 0.9 + Math.max(0, Math.cos(ph)) * 0.25 * (0.15 + move));
        }
        rig.body.position.y = 0.3 * waking + 0.14 + Math.sin(t * 2) * 0.015;
        rig.body.rotation.z = Math.sin(t) * 0.05 * move;
        rig.head.rotation.y = Math.sin(game.time * 3.1) * 0.35;
        break;
      }
      case 'shade': {
        const repel = state === 'repelled' ? 1 : 0;
        rig.body.position.y = 0.18 + Math.sin(game.time * 1.7 + this.animT * 0.1) * 0.08;
        rig.body.rotation.z = Math.sin(game.time * 1.1) * 0.06;
        rig.body.scale.set(1 - repel * 0.12 + Math.sin(game.time * 9) * 0.03 * repel, waking * (1 + Math.sin(game.time * 2.3) * 0.03), 1 - repel * 0.12);
        rig.arms[0].rotation.x = -0.5 - move * 0.7 - repel * 0.4 + Math.sin(game.time * 2) * 0.1;
        rig.arms[1].rotation.x = -0.5 - move * 0.7 - repel * 0.4 + Math.cos(game.time * 2.2) * 0.1;
        rig.head.rotation.x = 0.15 + repel * 0.3;
        break;
      }
    }
  }

  dispose(): void {
    const game = this.game;
    game.renderer.scene.remove(this.rig.root);
    this.rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    game.physics.removeBody(this.body);
    this.body = null;
  }
}

export class Guardians {
  list: Guardian[] = [];
  /** 0..1 how close the nearest hunter is (drives the heartbeat). Smoothed. */
  threat = 0;

  constructor(private readonly game: Game) {}

  /** Throw the old guardians away and put a dormant set at the spawn points. */
  reset(): void {
    for (const g of this.list) g.dispose();
    this.list = allGuardianSpawns().map((def, i) => new Guardian(this.game, def, i));
    this.threat = 0;
  }

  wakeScene(scene: SceneId): void {
    let n = 0;
    for (const g of this.list) {
      if (g.def.scene !== scene || g.awake) continue;
      g.wake(n * 0.7);
      n++;
      this.game.sfx('grind', g.pos, 0.8, 0.8, 45);
    }
    if (n > 0 && this.game.scenes.current === scene) this.game.shake(0.4);
  }

  /** Debug: wake one of everything right now. */
  wakeAll(): void {
    for (const g of this.list) g.wake(0);
  }

  get awakeCount(): number {
    let n = 0;
    for (const g of this.list) if (g.awake) n++;
    return n;
  }

  step(dt: number): void {
    let threat = 0;
    for (const g of this.list) {
      g.step(dt);
      if (!g.awake || g.brain.state === 'waking') continue;
      const range = g.sees ? 30 : 20;
      threat = Math.max(threat, clamp01(1 - g.dist / range) * (g.sees ? 1 : 0.7));
    }
    this.threat = damp(this.threat, this.game.player.alive ? threat : 0, 3, dt);
  }

  frame(dt: number, alpha: number): void {
    for (const g of this.list) g.frame(dt, alpha);
  }

  info(): { id: string; type: GuardianType; state: string; scene: SceneId; x: number; y: number; z: number; dist: number }[] {
    return this.list.map((g) => ({
      id: `${g.def.scene}.${g.def.id}`,
      type: g.type,
      state: g.brain.state,
      scene: g.scene,
      x: +g.pos.x.toFixed(2),
      y: +g.pos.y.toFixed(2),
      z: +g.pos.z.toFixed(2),
      dist: +g.dist.toFixed(1),
    }));
  }
}

// ---------------------------------------------------------------- bodies

function part(game: Game, geo: THREE.BufferGeometry, mat: string, dark: boolean, x: number, y: number, z: number, shadow = true): THREE.Mesh {
  const m = game.mats.mesh(geo, mat, dark);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

/** A limb that swings from its top end. */
function limb(game: Game, w: number, h: number, d: number, mat: string, dark: boolean, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(part(game, new THREE.BoxGeometry(w, h, d), mat, dark, 0, -h / 2, 0));
  return g;
}

/** All models face +Z. */
function buildRig(game: Game, type: GuardianType, dark: boolean): Rig {
  const root = new THREE.Group();
  root.name = `guardian:${type}`;
  const body = new THREE.Group();
  root.add(body);
  const legs: THREE.Object3D[] = [];
  const arms: THREE.Object3D[] = [];
  let head: THREE.Object3D;
  const S = 'guardianStone';

  if (type === 'sentinel') {
    for (const s of [-1, 1]) {
      const leg = limb(game, 0.36, 1.05, 0.42, S, dark, s * 0.27, 1.05, 0);
      leg.add(part(game, new THREE.BoxGeometry(0.42, 0.16, 0.6), S, dark, 0, -1.0, 0.08));
      legs.push(leg);
      root.add(leg);
      const arm = limb(game, 0.28, 1.15, 0.32, S, dark, s * 0.74, 2.12, 0);
      arm.add(part(game, new THREE.BoxGeometry(0.36, 0.34, 0.4), S, dark, 0, -1.25, 0.02));
      arms.push(arm);
      body.add(arm);
    }
    body.add(part(game, new THREE.BoxGeometry(0.98, 0.95, 0.56), S, dark, 0, 1.55, 0));
    body.add(part(game, new THREE.BoxGeometry(1.42, 0.3, 0.64), S, dark, 0, 2.12, 0));
    body.add(part(game, new THREE.BoxGeometry(0.7, 0.22, 0.6), 'bronze', dark, 0, 1.02, 0)); // belt
    body.add(part(game, new THREE.CylinderGeometry(0.2, 0.2, 0.05, 12).rotateX(Math.PI / 2), 'gold', dark, 0, 1.62, 0.29)); // sun disc on the chest
    const h = new THREE.Group();
    h.position.set(0, 2.28, 0);
    h.add(part(game, new THREE.BoxGeometry(0.52, 0.56, 0.5), S, dark, 0, 0.3, 0));
    h.add(part(game, new THREE.BoxGeometry(0.78, 0.16, 0.56), S, dark, 0, 0.66, 0)); // headdress
    h.add(part(game, new THREE.BoxGeometry(0.44, 0.36, 0.06), 'bronze', dark, 0, 0.28, 0.27)); // mask
    for (const s of [-1, 1]) h.add(part(game, new THREE.BoxGeometry(0.1, 0.06, 0.03), 'obsidian', dark, s * 0.11, 0.34, 0.305, false));
    body.add(h);
    head = h;
  } else if (type === 'crawler') {
    const C = 'guardianChitin';
    const shell = new THREE.SphereGeometry(0.5, 12, 8);
    shell.scale(1.0, 0.45, 1.5);
    body.add(part(game, shell, C, dark, 0, 0, 0));
    const tail = new THREE.SphereGeometry(0.3, 10, 6);
    tail.scale(1, 0.5, 1.6);
    body.add(part(game, tail, C, dark, 0, 0.02, -0.85));
    const h = new THREE.Group();
    h.position.set(0, 0, 0.72);
    const skull = new THREE.SphereGeometry(0.26, 10, 8);
    skull.scale(1.1, 0.7, 1);
    h.add(part(game, skull, C, dark, 0, 0, 0.1));
    for (const s of [-1, 1]) {
      const fang = part(game, new THREE.ConeGeometry(0.05, 0.36, 6).rotateX(Math.PI / 2), 'bone', dark, s * 0.12, -0.05, 0.42);
      fang.rotation.y = -s * 0.35;
      h.add(fang);
    }
    body.add(h);
    head = h;
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? -1 : 1;
      const row = Math.floor(i / 2);
      const leg = new THREE.Group();
      leg.position.set(side * 0.42, 0, 0.42 - row * 0.45);
      const upper = part(game, new THREE.BoxGeometry(0.62, 0.07, 0.08), C, dark, side * 0.3, 0.12, 0);
      upper.rotation.z = side * 0.5;
      const lower = part(game, new THREE.BoxGeometry(0.07, 0.6, 0.07), C, dark, side * 0.6, -0.03, 0);
      lower.rotation.z = side * -0.25;
      leg.add(upper, lower);
      legs.push(leg);
      body.add(leg);
    }
    body.position.y = 0.44;
  } else {
    const M = 'guardianShade';
    const robe = new THREE.ConeGeometry(0.62, 2.0, 12, 4, true);
    const p = robe.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      // Ragged hem.
      if (p.getY(i) < -0.9) p.setY(i, p.getY(i) - Math.abs(Math.sin(i * 12.9898)) * 0.25);
    }
    robe.computeVertexNormals();
    body.add(part(game, robe, M, dark, 0, 1.05, 0, false));
    const h = new THREE.Group();
    h.position.set(0, 2.02, 0.02);
    const hood = new THREE.SphereGeometry(0.27, 10, 8);
    hood.scale(1, 1.15, 1.1);
    h.add(part(game, hood, M, dark, 0, 0, 0, false));
    for (const s of [-1, 1]) h.add(part(game, new THREE.SphereGeometry(0.03, 6, 4), 'moonstone', dark, s * 0.09, 0.02, 0.26, false));
    body.add(h);
    head = h;
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 0.3, 1.72, 0.05);
      arm.add(part(game, new THREE.CylinderGeometry(0.035, 0.05, 1.15, 6), M, dark, 0, -0.55, 0, false));
      for (let f = -1; f <= 1; f++) {
        const claw = part(game, new THREE.ConeGeometry(0.018, 0.28, 4), 'bone', dark, f * 0.045, -1.22, 0, false);
        claw.rotation.z = Math.PI + f * 0.2;
        arm.add(claw);
      }
      arms.push(arm);
      body.add(arm);
    }
  }
  return { root, body, legs, arms, head };
}
