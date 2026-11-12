import * as THREE from 'three';
import { DAY_LENGTH } from '../core/clock';
import {
  GUARDIANS, catches, newMind, stepGuardian, wakeDelay, type GuardianKind, type HeardNoise, type Mind, type Percept,
} from '../core/guardianFsm';
import type { SceneId, V3 } from '../core/types';
import type { Game } from '../game/Game';
import type { GuardianSpawn } from '../world/types';
import { SCONCE_RADIUS } from './TorchRig';

export interface NoiseEvent { pos: V3; radius: number; }

/** Points near the Great Door that guardians patrol once their sweep reaches it. */
const DOOR_PATROL: [number, number, number][] = [[0, 0, -11], [-9, 0, -30], [9, 0, -30], [0, 0, -47], [0, 0, -14], [0, 0, -62]];

class Guardian {
  readonly mind: Mind;
  readonly pos = new THREE.Vector3();
  yaw: number;
  readonly mesh = new THREE.Group();
  private path: V3[] = [];
  private pathI = 0;
  private repathT = 0;
  private lastGoal: V3 | null = null;
  private losT: number;
  private los = false;
  private callT: number;
  private anim = 0;
  private parts: THREE.Object3D[] = [];
  private wakeAt: number;
  arrived = false;
  readonly kind: GuardianKind;

  constructor(private game: Game, readonly spawn: GuardianSpawn, readonly scene: SceneId, readonly index: number) {
    this.kind = spawn.kind;
    this.mind = newMind(spawn.kind);
    this.pos.set(...spawn.pos);
    this.yaw = spawn.yaw;
    this.losT = (index * 0.037) % 0.15;
    this.callT = 4 + index * 1.3;
    this.wakeAt = DAY_LENGTH + wakeDelay(scene) + (index % 3) * 1.5;
    this.build();
  }

  private build(): void {
    const { mats } = this.game;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, part = false) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      this.mesh.add(m);
      if (part) this.parts.push(m);
      return m;
    };
    if (this.kind === 'sentinel') {
      const stone = mats.solid(0x8a8272, 0.95);
      const dark = mats.solid(0x2a2620, 1);
      add(new THREE.BoxGeometry(1.1, 1.3, 0.7), stone, 0, 1.55, 0);
      add(new THREE.BoxGeometry(0.8, 0.5, 0.6), stone, 0, 0.75, 0);
      add(new THREE.BoxGeometry(0.7, 0.7, 0.66), stone, 0, 2.55, 0.03);
      add(new THREE.BoxGeometry(1.0, 0.2, 0.8), stone, 0, 3.0, 0);
      add(new THREE.BoxGeometry(0.5, 0.1, 0.08), dark, 0, 2.62, 0.36);
      add(new THREE.BoxGeometry(0.3, 0.14, 0.08), dark, 0, 2.36, 0.36);
      for (const s of [-1, 1]) {
        const arm = add(new THREE.BoxGeometry(0.34, 1.3, 0.4), stone, s * 0.75, 1.5, 0, true);
        arm.geometry.translate(0, -0.5, 0); arm.position.y = 2.1;
        const leg = add(new THREE.BoxGeometry(0.4, 0.8, 0.45), stone, s * 0.3, 0.4, 0, true);
        leg.geometry.translate(0, -0.4, 0); leg.position.y = 0.8;
      }
    } else if (this.kind === 'crawler') {
      const shell = mats.solid(0x3a2c24, 0.5, 0.2);
      const pale = mats.solid(0xb8a890, 0.8);
      const body = add(new THREE.SphereGeometry(0.5, 10, 8), shell, 0, 0.5, 0);
      body.scale.set(1, 0.55, 1.7);
      const head = add(new THREE.SphereGeometry(0.28, 8, 6), pale, 0, 0.5, 0.85);
      head.scale.set(1, 0.7, 1.1);
      for (const s of [-1, 1]) {
        add(new THREE.ConeGeometry(0.05, 0.4, 5), pale, s * 0.12, 0.42, 1.12).rotation.x = Math.PI / 2;
        for (let i = 0; i < 4; i++) {
          const leg = add(new THREE.BoxGeometry(0.9, 0.07, 0.07), pale, s * 0.65, 0.42, 0.55 - i * 0.38, true);
          leg.rotation.z = s * -0.45;
          leg.userData.side = s; leg.userData.i = i;
        }
      }
    } else {
      // The Shade is a hole in the picture: pure black, unlit, so it only ever shows as a silhouette.
      const black = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.94, fog: false });
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.3, 9, 1, true), black);
      body.position.y = 1.15; body.material.side = THREE.DoubleSide;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), black);
      head.position.y = 2.3; head.scale.set(0.9, 1.25, 0.9);
      this.mesh.add(body, head);
      for (const s of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1.5, 5), black);
        arm.position.set(s * 0.5, 1.5, 0.2); arm.rotation.set(0.5, 0, s * 0.5);
        this.mesh.add(arm); this.parts.push(arm);
      }
    }
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  get awake(): boolean { return this.mind.state !== 'dormant' && this.mind.state !== 'waking'; }

  update(dt: number, noises: NoiseEvent[]): boolean {
    const { game } = this;
    const pl = game.player;
    const eye = { x: this.pos.x, y: this.pos.y + (this.kind === 'crawler' ? 0.6 : 2.2), z: this.pos.z };
    const pc = pl.center;
    const dx = pc.x - this.pos.x, dz = pc.z - this.pos.z, dy = pc.y - (this.pos.y + 1);
    const dist = Math.hypot(dx, dy * 1.2, dz);

    // Line of sight is a physics raycast, refreshed on a short stagger.
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.15;
      this.los = dist < 45 && game.physics.lineOfSight(eye, pc);
    }
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    const hd = Math.hypot(dx, dz) || 1;
    const facing = (dx * fwdX + dz * fwdZ) / hd > 0.5;

    // Loudest noise relative to distance.
    let heard: HeardNoise | null = null, bestRatio = 0;
    for (const n of noises) {
      const d = Math.hypot(n.pos.x - this.pos.x, (n.pos.y - this.pos.y) * 1.5, n.pos.z - this.pos.z);
      const ratio = n.radius / Math.max(0.5, d);
      if (ratio > bestRatio) { bestRatio = ratio; heard = { pos: n.pos, radius: n.radius, dist: d }; }
    }

    // Standing in light?
    const torchR = game.torch.radius;
    let inLight = false, lightPos: V3 | null = null;
    if (torchR > 0 && dist < torchR && this.los) { inLight = true; lightPos = pl.pos; }
    else {
      for (const s of game.torch.litSconces) {
        if (s.distanceTo(this.pos) < SCONCE_RADIUS * 0.8) { inLight = true; lightPos = s; break; }
      }
    }

    const p: Percept = {
      dt, wake: game.run.time >= this.wakeAt, enraged: game.run.progress.doorSealed,
      selfPos: this.pos, playerPos: { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z }, dist, los: this.los, facing,
      torchLit: torchR > 0, lightRadius: torchR, inLight, lightPos, noise: heard, arrived: this.arrived,
    };
    const before = this.mind.state;
    stepGuardian(this.mind, p);
    if (before !== this.mind.state) this.onState(before);
    this.arrived = false;

    this.move(dt);
    this.animate(dt);

    // Calls
    if (this.awake) {
      this.callT -= dt;
      if (this.callT <= 0) {
        this.callT = (this.mind.state === 'chase' ? 3 : 7) + Math.random() * 4;
        game.audio.play(this.kind === 'sentinel' ? 'sentinelCall' : this.kind === 'crawler' ? 'crawlerCall' : 'shadeCall', { pos: this.pos, vol: 1, range: 55 });
      }
    }
    return catches(this.mind, p) && Math.abs(dy) < 2.2 && this.los;
  }

  private onState(before: string): void {
    const { game } = this;
    if (this.mind.state === 'waking') {
      game.audio.play(this.kind === 'sentinel' ? 'grind' : this.kind === 'crawler' ? 'crawlerCall' : 'shadeCall', { pos: this.pos, vol: 1, range: 60 });
    }
    if (this.mind.state === 'chase' && before !== 'chase') {
      game.audio.play(this.kind === 'sentinel' ? 'sentinelCall' : this.kind === 'crawler' ? 'crawlerCall' : 'shadeCall', { pos: this.pos, vol: 1, rate: 1.25, range: 60 });
    }
    this.lastGoal = null;
  }

  private move(dt: number): void {
    const { game } = this;
    const m = this.mind;
    if (m.speed <= 0 || m.goalKind === 'none') return;
    let goal: V3 | null = m.goal;
    if (m.goalKind === 'sweep') {
      const sw = this.spawn.sweep;
      const i = m.sweepIndex;
      const pt = i < sw.length ? sw[i] : DOOR_PATROL[(i * 5 + this.index * 3) % DOOR_PATROL.length];
      goal = { x: pt[0], y: pt[1], z: pt[2] };
    }
    if (!goal) return;

    // Replan when the goal moves or on a timer. This is navmesh A* plus funnel, not homing.
    this.repathT -= dt;
    const moved = !this.lastGoal || Math.hypot(goal.x - this.lastGoal.x, goal.z - this.lastGoal.z) > 1.2;
    if (moved || this.repathT <= 0) {
      this.repathT = moved ? 0.35 : 1.2;
      this.lastGoal = { ...goal };
      const target = game.nav.clampPoint(goal.x, goal.y, goal.z);
      const res = target ? game.nav.findPath(this.pos, target) : null;
      if (res && res.points.length > 1) { this.path = res.points; this.pathI = 1; }
      else {
        this.path = []; this.pathI = 0;
        // Cut off: treat it as reached so the state machine moves on instead of stalling.
        if (!res) this.arrived = true;
      }
    }
    if (this.pathI >= this.path.length) { this.arrived = true; return; }

    let budget = m.speed * dt;
    while (budget > 0 && this.pathI < this.path.length) {
      const wp = this.path[this.pathI];
      const ddx = wp.x - this.pos.x, ddz = wp.z - this.pos.z;
      const d = Math.hypot(ddx, ddz);
      if (d < 0.05) { this.pathI++; continue; }
      const step = Math.min(d, budget);
      this.pos.x += (ddx / d) * step; this.pos.z += (ddz / d) * step;
      budget -= step;
      const want = Math.atan2(ddx, ddz);
      let dy = want - this.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * Math.min(1, dt * (this.kind === 'sentinel' ? 4 : 10));
      if (step >= d - 1e-6) this.pathI++;
    }
    const h = game.nav.sampleHeight(this.pos.x, this.pos.z, this.pos.y);
    if (h !== null) this.pos.y += (h - this.pos.y) * Math.min(1, dt * 12);
    if (this.pathI >= this.path.length) this.arrived = true;
    this.anim += m.speed * dt;

    if (this.kind === 'sentinel') {
      // Each footfall is felt.
      const before = Math.floor((this.anim - m.speed * dt) / 1.5), now = Math.floor(this.anim / 1.5);
      if (now !== before) {
        game.audio.play('stomp', { pos: this.pos, vol: 0.9, range: 40 });
        const d = this.pos.distanceTo(game.player.pos);
        if (d < 14) game.shake(0.12 * (1 - d / 14));
      }
    } else if (this.kind === 'crawler') {
      const before = Math.floor((this.anim - m.speed * dt) / 0.9), now = Math.floor(this.anim / 0.9);
      if (now !== before) game.audio.play('skitter', { pos: this.pos, vol: 0.6, range: 26 });
    }
  }

  private animate(dt: number): void {
    const { game } = this;
    const st = this.mind.state;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    if (st === 'waking') {
      this.mesh.position.x += (Math.random() - 0.5) * 0.05;
      this.mesh.position.z += (Math.random() - 0.5) * 0.05;
    }
    const a = this.anim;
    if (this.kind === 'sentinel') {
      const sw = this.awake ? Math.sin((a / 1.5) * Math.PI) * 0.5 : 0;
      this.parts[0].rotation.x = sw; this.parts[2].rotation.x = -sw;
      this.parts[1].rotation.x = -sw; this.parts[3].rotation.x = sw;
    } else if (this.kind === 'crawler') {
      for (const leg of this.parts) {
        const ph = a * 7 + leg.userData.i * 1.6 + (leg.userData.side > 0 ? Math.PI : 0);
        leg.rotation.y = this.awake ? Math.sin(ph) * 0.5 : 0;
        leg.rotation.z = leg.userData.side * (-0.45 + (this.awake ? Math.max(0, Math.cos(ph)) * 0.25 : 0.3));
      }
      this.mesh.position.y += this.awake ? 0 : -0.15;
    } else {
      const t = game.run.time;
      this.mesh.position.y += this.awake ? 0.08 + Math.sin(t * 2.3 + this.index) * 0.07 : -1.6;
      this.mesh.scale.set(1 + Math.sin(t * 3.1) * 0.04, 1 + Math.sin(t * 2.2 + 1) * 0.05, 1 + Math.cos(t * 2.7) * 0.04);
      this.parts[0].rotation.x = 0.5 + Math.sin(t * 1.9) * 0.3; this.parts[1].rotation.x = 0.5 + Math.cos(t * 1.7) * 0.3;
    }
    // Hidden while the scene it stands in is streamed out (nothing would occlude it).
    this.mesh.visible = game.world.isLoadedAt(this.pos.x, this.pos.y, this.pos.z);
    void dt;
  }
}

/** All guardians in the temple. They exist for the whole run and path on the global navmesh. */
export class Guardians {
  list: Guardian[] = [];
  private group = new THREE.Group();
  private noises: NoiseEvent[] = [];
  /** Distance to the nearest awake guardian (Infinity if none). Drives the heartbeat. */
  nearest = Infinity;
  awakeCount = 0;

  constructor(private game: Game) { game.scene.add(this.group); }

  reset(spawns: { scene: SceneId; spawn: GuardianSpawn }[]): void {
    for (const g of this.list) { g.mesh.removeFromParent(); g.mesh.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); }); }
    this.list = spawns.map((s, i) => new Guardian(this.game, s.spawn, s.scene, i));
    for (const g of this.list) this.group.add(g.mesh);
    this.noises.length = 0;
    this.nearest = Infinity; this.awakeCount = 0;
  }

  hear(n: NoiseEvent): void { this.noises.push(n); }

  fixedUpdate(dt: number): void {
    const { game } = this;
    let nearest = Infinity, awake = 0;
    let caughtBy: Guardian | null = null;
    for (const g of this.list) {
      const caught = g.update(dt, this.noises);
      if (g.awake) {
        awake++;
        nearest = Math.min(nearest, g.pos.distanceTo(game.player.pos));
        if (caught && !caughtBy) caughtBy = g;
      }
    }
    this.noises.length = 0;
    this.nearest = nearest; this.awakeCount = awake;
    if (caughtBy && !game.player.dead && !game.godMode) {
      game.player.dead = true;
      game.audio.play('caught');
      game.endRun('caught', `the ${GUARDIANS[caughtBy.kind].name}`);
    }
  }

  /** Debug and test helper. */
  describe(): { kind: string; state: string; x: number; y: number; z: number }[] {
    return this.list.map((g) => ({ kind: g.kind, state: g.mind.state, x: +g.pos.x.toFixed(1), y: +g.pos.y.toFixed(1), z: +g.pos.z.toFixed(1) }));
  }
}
