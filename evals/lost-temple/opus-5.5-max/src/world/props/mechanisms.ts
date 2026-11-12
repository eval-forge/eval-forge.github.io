/**
 * Doors, plates, levers, push blocks, sconces and the other moving parts of the temple.
 */
import * as THREE from 'three';
import { RAPIER } from '../../physics/Physics';
import { GROUP_STATIC, GROUP_PROP, GROUP_DEBRIS, PLAYER_MASS_FOR_PLATES } from './constants';
import { PressurePlateLogic } from '../../logic/traps';
import { SconceFlame } from '../../logic/torch';
import type { Flag } from '../../logic/unlocks';
import type { SceneCtx, SceneRuntime } from '../SceneDef';
import type { Interactable, Prop } from '../types';
import { boxMesh, cylMesh, massInBox, playerOn, fixedBody, smooth01 } from './util';

// ---------------------------------------------------------------------------
// Push block

export class PushBlock implements Prop {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  private sync;
  private lastSound = 0;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, pos: [number, number, number], size: [number, number, number], mass: number, mat: 'sandstone' | 'dungeon' | 'sandstoneMoss' = 'sandstone') {
    const saved = ctx.run.get('block:' + id) as [number, number, number] | undefined;
    const p = saved ?? [pos[0], pos[1] + size[1] / 2, pos[2]];
    this.body = rt.trackBody(
      ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p[0], p[1], p[2]).lockRotations().setLinearDamping(3.5).setCanSleep(true)),
    );
    const c = ctx.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setMass(mass).setFriction(0.35).setCollisionGroups(GROUP_PROP),
      this.body,
    );
    ctx.physics.setOwner(c, { kind: 'pushBlock', surface: 'stone' });
    this.mesh = boxMesh(ctx.mats, mat, size[0], size[1], size[2], 0.5);
    rt.group.add(this.mesh);
    this.sync = ctx.physics.addSync(this.body, this.mesh);
    rt.onDispose(() => ctx.physics.removeSync(this.sync));
  }
  fixedUpdate() {
    const v = this.body.linvel();
    const sp = Math.hypot(v.x, v.z);
    const now = this.ctx.time();
    if (sp > 0.4 && now - this.lastSound > 0.55) {
      this.lastSound = now;
      const t = this.body.translation();
      this.ctx.sfx.play('stoneGrind', new THREE.Vector3(t.x, t.y, t.z), 0.35);
      this.ctx.noise(new THREE.Vector3(t.x, t.y, t.z), 0.5, 'machine', true);
    }
  }
  dispose() {
    const t = this.body.translation();
    this.ctx.run.set('block:' + this.id, [t.x, t.y, t.z]);
  }
}

// ---------------------------------------------------------------------------
// Pressure plate

export class PressurePlate implements Prop {
  logic: PressurePlateLogic;
  mesh: THREE.Mesh;
  private center: THREE.Vector3;
  private half: THREE.Vector3;
  load = 0;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, private x: number, private y: number, private z: number, private size: number, threshold: number, private onChange: (pressed: boolean) => void, latch = false) {
    this.logic = new PressurePlateLogic(threshold, { latch });
    this.mesh = boxMesh(ctx.mats, 'floor', size, 0.12, size, 0.5, 0xc8b89a);
    this.mesh.position.set(x, y + 0.06, z);
    rt.group.add(this.mesh);
    const frame = boxMesh(ctx.mats, 'sandstone', size + 0.3, 0.06, size + 0.3, 0.5, 0x8a7a64);
    frame.position.set(x, y + 0.01, z);
    rt.group.add(frame);
    this.center = new THREE.Vector3(x, y + 0.3, z);
    this.half = new THREE.Vector3(size / 2, 0.28, size / 2);
    if (latch && ctx.run.get('plate:' + id)) this.logic.update(1e6, 10);
  }
  get pressed() {
    return this.logic.pressed;
  }
  fixedUpdate(dt: number) {
    let load = massInBox(this.ctx.physics, this.center, this.half);
    const pl = this.ctx.player();
    const h = this.size / 2 + 0.15;
    if (playerOn(pl, this.x - h, this.z - h, this.x + h, this.z + h, this.y + 0.12, 0.45)) load += PLAYER_MASS_FOR_PLATES + this.ctx.run.satchel.weight;
    this.load = load;
    const before = this.logic.pressed;
    this.logic.update(load, dt);
    const after = this.logic.pressed;
    this.mesh.position.y = this.y + 0.06 - (after ? 0.07 : 0);
    if (after !== before) {
      this.ctx.sfx.play('stoneClick', this.mesh.position, 1);
      if (after) this.ctx.run.set('plate:' + this.id, true);
      this.onChange(after);
    }
  }
  dispose() {}
}

// ---------------------------------------------------------------------------
// Sliding slab door (great door, seal, serpent door, gates, portcullis)

export interface SlabOpts {
  id: string;
  /** Closed centre position. */
  pos: [number, number, number];
  size: [number, number, number];
  /** Offset from closed to open. */
  openOffset: [number, number, number];
  mat: 'sandstone' | 'glyphs' | 'glyphsDark' | 'dungeon' | 'iron' | 'bone' | 'darkWood';
  duration: number;
  /** Flag that opens it. */
  flag?: Flag;
  navGate?: string;
  sound?: 'stoneGrind' | 'gateOpen';
  bars?: boolean;
}

export class SlidingSlab implements Prop {
  body: RAPIER.RigidBody;
  obj: THREE.Object3D;
  open = 0;
  target = 0;
  id: string;
  private closed: THREE.Vector3;
  private offset: THREE.Vector3;
  private moving = false;
  private loop: { stop(): void; setPos(p: THREE.Vector3): void } | null = null;
  /** When set, the game drives the slab directly with setOpen (the great door closing at night). */
  hold = false;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, private o: SlabOpts) {
    this.id = o.id;
    this.closed = new THREE.Vector3(...o.pos);
    this.offset = new THREE.Vector3(...o.openOffset);
    // A fixed body that is teleported while it moves: Rapier's character controller sticks on
    // kinematic bodies you stand on (the closed seal is part of the sanctum floor).
    this.body = rt.trackBody(fixedBody(ctx.physics, o.pos[0], o.pos[1], o.pos[2]));
    if (o.bars) {
      // portcullis: one box collider, a visual group of bars spread along the gate's long side
      const g = new THREE.Group();
      const alongZ = o.size[2] > o.size[0];
      const span = alongZ ? o.size[2] : o.size[0];
      const n = Math.max(3, Math.round(span / 0.35));
      for (let i = 0; i < n; i++) {
        const u = -span / 2 + (i + 0.5) * (span / n);
        const bar = cylMesh(ctx.mats, 'iron', 0.05, 0.05, o.size[1], 6);
        bar.position.set(alongZ ? 0 : u, 0, alongZ ? u : 0);
        g.add(bar);
      }
      for (const y of [-o.size[1] * 0.3, o.size[1] * 0.3]) {
        const cross = boxMesh(ctx.mats, 'iron', alongZ ? 0.12 : span, 0.1, alongZ ? span : 0.12, 1);
        cross.position.y = y;
        g.add(cross);
      }
      this.obj = g;
    } else this.obj = boxMesh(ctx.mats, o.mat, o.size[0], o.size[1], o.size[2], 0.5);
    rt.group.add(this.obj);
    const c = ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(o.size[0] / 2, o.size[1] / 2, o.size[2] / 2).setCollisionGroups(GROUP_STATIC), this.body);
    ctx.physics.setOwner(c, { kind: 'door', surface: 'stone', noMantle: true });
    if (o.flag && ctx.run.flag(o.flag)) {
      this.open = this.target = 1;
    }
    this.apply();
    if (o.navGate) ctx.nav.setGate(o.navGate, this.open > 0.6);
  }
  setTarget(t: number) {
    if (t === this.target) return;
    this.target = t;
  }
  private apply() {
    const p = this.closed.clone().addScaledVector(this.offset, smooth01(this.open));
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.obj.position.copy(p);
  }
  fixedUpdate(dt: number) {
    if (this.hold) {
      this.loop?.stop();
      this.loop = null;
      this.moving = false;
      return;
    }
    if (this.o.flag && this.ctx.run.flag(this.o.flag)) this.target = 1;
    if (Math.abs(this.open - this.target) < 1e-4) {
      if (this.moving) {
        this.moving = false;
        this.loop?.stop();
        this.loop = null;
        this.ctx.sfx.play('thunk', this.obj.position, 1.2);
        this.ctx.shake(0.3);
      }
      return;
    }
    if (!this.moving) {
      this.moving = true;
      this.loop = this.ctx.sfx.loop('grind', this.obj.position, 0.9);
      this.ctx.noise(this.obj.position.clone(), 1.0, 'machine', true);
    }
    const step = dt / this.o.duration;
    this.open = this.open < this.target ? Math.min(this.target, this.open + step) : Math.max(this.target, this.open - step);
    this.apply();
    this.loop?.setPos(this.obj.position);
    if (this.o.navGate) this.ctx.nav.setGate(this.o.navGate, this.open > 0.6);
  }
  /** Directly set the opening (great door closing with the clock). */
  setOpen(v: number) {
    this.open = this.target = Math.max(0, Math.min(1, v));
    this.apply();
    if (this.o.navGate) this.ctx.nav.setGate(this.o.navGate, this.open > 0.3);
  }
  dispose() {
    this.loop?.stop();
  }
}

// ---------------------------------------------------------------------------
// Lever

export class Lever implements Prop {
  handle: THREE.Group;
  pulled = false;
  private anim = 0;
  interact: Interactable;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, pos: [number, number, number], rotY: number, label: string, private onPull: () => void, initiallyPulled = false) {
    const base = boxMesh(ctx.mats, 'sandstone', 0.6, 0.9, 0.5, 0.5);
    base.position.set(pos[0], pos[1] + 0.45, pos[2]);
    base.rotation.y = rotY;
    rt.group.add(base);
    this.handle = new THREE.Group();
    const stick = cylMesh(ctx.mats, 'darkWood', 0.04, 0.05, 1.0, 6);
    stick.position.y = 0.5;
    const knob = boxMesh(ctx.mats, 'bronze', 0.14, 0.14, 0.14, 1);
    knob.position.y = 1.0;
    this.handle.add(stick, knob);
    this.handle.position.set(pos[0], pos[1] + 0.85, pos[2]);
    this.handle.rotation.set(0, rotY, 0.6);
    rt.group.add(this.handle);
    this.pulled = initiallyPulled;
    if (this.pulled) this.handle.rotation.z = -0.6;
    this.interact = rt.addInteract({
      kind: 'interact',
      id,
      position: new THREE.Vector3(pos[0], pos[1] + 1.2, pos[2]),
      prompt: () => (this.pulled ? null : label),
      interact: () => {
        if (this.pulled) return;
        this.pulled = true;
        this.anim = 0.001;
        ctx.sfx.play('click', this.handle.position, 1);
        ctx.sfx.play('woodCreak', this.handle.position, 0.5);
        this.onPull();
      },
    });
  }
  update(dt: number) {
    if (this.anim > 0 && this.anim < 1) {
      this.anim = Math.min(1, this.anim + dt * 2.5);
      this.handle.rotation.z = 0.6 - 1.2 * smooth01(this.anim);
    }
  }
  dispose() {}
}

// ---------------------------------------------------------------------------
// Sconce: place a spare torch, relight your own torch from it

export class Sconce implements Prop {
  flame = new SconceFlame();
  lit = false;
  pos: THREE.Vector3;
  sprite: THREE.Sprite;
  stick: THREE.Mesh;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, pos: [number, number, number], rotY: number) {
    this.pos = new THREE.Vector3(...pos);
    const bracket = boxMesh(ctx.mats, 'iron', 0.3, 0.08, 0.3, 1);
    bracket.position.set(pos[0], pos[1] - 0.25, pos[2]);
    bracket.rotation.y = rotY;
    rt.group.add(bracket);
    const cup = cylMesh(ctx.mats, 'iron', 0.12, 0.07, 0.18, 8);
    cup.position.set(pos[0], pos[1] - 0.12, pos[2]);
    rt.group.add(cup);
    this.stick = cylMesh(ctx.mats, 'darkWood', 0.035, 0.03, 0.55, 6);
    this.stick.position.set(pos[0], pos[1] + 0.05, pos[2]);
    rt.group.add(this.stick);
    this.sprite = new THREE.Sprite(ctx.mats.flame);
    this.sprite.scale.set(0.45, 0.7, 1);
    this.sprite.position.set(pos[0], pos[1] + 0.55, pos[2]);
    rt.group.add(this.sprite);
    const saved = ctx.run.get('sconce:' + id) as number | undefined;
    if (saved !== undefined && saved > 0) {
      this.flame.remaining = saved;
      this.lit = true;
    }
    this.refresh();
    rt.addInteract({
      kind: 'interact',
      id,
      position: this.pos.clone(),
      prompt: () => {
        const torch = ctx.run.torch;
        if (!this.lit) {
          if (torch.spareTorches > 0) return 'E  Place a spare torch in the sconce';
          return 'Empty sconce (no spare torch)';
        }
        if (!torch.lit && !torch.isRelighting) return 'E  Light your torch from the sconce';
        return null;
      },
      interact: () => {
        const torch = ctx.run.torch;
        if (!this.lit) {
          if (!torch.takeSpare()) {
            ctx.sfx.play('deny');
            return;
          }
          this.flame = new SconceFlame();
          this.lit = true;
          ctx.sfx.play('torchLight', this.pos, 1);
          ctx.mapMark(this.pos.x, this.pos.z, 'sconce');
          this.refresh();
          return;
        }
        if (!torch.lit) {
          const ev = torch.lightFrom();
          if (ev.some((e) => e.type === 'lit')) ctx.sfx.play('torchLight', this.pos, 0.8);
        }
      },
    });
  }
  get radius() {
    return this.lit ? this.flame.radius : 0;
  }
  douse() {
    if (!this.lit) return;
    this.flame.douse();
    this.lit = false;
    this.ctx.sfx.play('torchOut', this.pos, 1);
    this.ctx.fx.sparks(this.pos, 20);
    this.refresh();
  }
  private refresh() {
    this.sprite.visible = this.lit;
    this.stick.visible = this.lit;
  }
  update(dt: number) {
    if (!this.lit) return;
    this.flame.update(dt);
    if (!this.flame.lit) {
      this.lit = false;
      this.refresh();
      return;
    }
    const t = this.ctx.time();
    const f = 0.85 + Math.sin(t * 13 + this.pos.x) * 0.08 + Math.sin(t * 29) * 0.05;
    this.sprite.scale.set(0.42 * f, 0.68 * f, 1);
    if (Math.random() < dt * 4) this.ctx.fx.embers(this.sprite.position, 1);
  }
  dispose() {
    this.ctx.run.set('sconce:' + this.id, this.lit ? this.flame.remaining : 0);
  }
}

// ---------------------------------------------------------------------------
// Drawbridge: hinged slab lowered by a lever on the inner side

export class Drawbridge implements Prop {
  body: RAPIER.RigidBody;
  obj: THREE.Group;
  angle: number;
  private target: number;
  private moving = false;
  private loop: { stop(): void } | null = null;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, private hinge: THREE.Vector3, private width: number, private length: number) {
    const lowered = ctx.run.flag('drawbridgeLowered');
    this.angle = lowered ? 0 : -Math.PI / 2;
    this.target = this.angle;
    // fixed and teleported while it swings down (the character controller sticks on kinematic decks)
    this.body = rt.trackBody(fixedBody(ctx.physics, hinge.x, hinge.y, hinge.z));
    const cd = RAPIER.ColliderDesc.cuboid(width / 2, 0.2, length / 2).setTranslation(0, -0.2, length / 2).setCollisionGroups(GROUP_STATIC);
    const c = ctx.physics.world.createCollider(cd, this.body);
    ctx.physics.setOwner(c, { kind: 'drawbridge', surface: 'wood' });
    this.obj = new THREE.Group();
    const n = Math.round(length / 0.5);
    for (let i = 0; i < n; i++) {
      const plank = boxMesh(ctx.mats, 'darkWood', width, 0.18, 0.46, 1, i % 2 ? 0xd0c0a8 : 0xffffff);
      plank.position.set(0, -0.1, 0.25 + i * 0.5);
      this.obj.add(plank);
    }
    for (const sx of [-1, 1]) {
      const beam = boxMesh(ctx.mats, 'iron', 0.12, 0.2, length, 1);
      beam.position.set((sx * width) / 2 - sx * 0.1, -0.28, length / 2);
      this.obj.add(beam);
    }
    rt.group.add(this.obj);
    this.apply();
    ctx.nav.setGate('drawbridge', lowered);
  }
  lower() {
    this.target = 0;
  }
  private apply() {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.angle);
    this.body.setTranslation({ x: this.hinge.x, y: this.hinge.y, z: this.hinge.z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.obj.position.copy(this.hinge);
    this.obj.quaternion.copy(q);
  }
  fixedUpdate(dt: number) {
    // lowered from elsewhere (the lever's flag, or the temple itself at darkness)
    if (this.target !== 0 && this.ctx.run.flag('drawbridgeLowered')) this.lower();
    if (Math.abs(this.angle - this.target) < 1e-4) {
      if (this.moving) {
        this.moving = false;
        this.loop?.stop();
        this.ctx.sfx.play('debris', this.hinge.clone().add(new THREE.Vector3(0, 0, this.length)), 0.8);
        this.ctx.shake(0.5);
        this.ctx.fx.dustBurst(this.hinge.clone().add(new THREE.Vector3(0, 0, this.length)), 30, 3);
        this.ctx.setFlag('drawbridgeLowered');
        this.ctx.nav.setGate('drawbridge', true);
      }
      return;
    }
    if (!this.moving) {
      this.moving = true;
      this.loop = this.ctx.sfx.loop('grind', this.hinge, 0.8);
      this.ctx.noise(this.hinge.clone(), 1.0, 'machine', true);
    }
    // accelerate like a falling bridge held by chains
    const speed = 0.25 + Math.abs(this.angle) * 0.0 + (1 - Math.abs(this.angle) / (Math.PI / 2)) * 1.2;
    this.angle = Math.min(this.target, this.angle + speed * dt);
    this.apply();
  }
  dispose() {
    this.loop?.stop();
  }
}

// ---------------------------------------------------------------------------
// Breakable wall (kicked from one side only)

export class BreakableWall implements Prop {
  body: RAPIER.RigidBody | null = null;
  group = new THREE.Group();
  kicks = 0;
  private debris: { body: RAPIER.RigidBody; mesh: THREE.Mesh; sync: unknown }[] = [];
  constructor(private ctx: SceneCtx, private rt: SceneRuntime, public id: string, private center: THREE.Vector3, private size: THREE.Vector3, private kickSide: THREE.Vector3, private flag: Flag, private navGate: string, private kicksNeeded = 3) {
    if (ctx.run.flag(flag)) {
      ctx.nav.setGate(navGate, true);
      return;
    }
    ctx.nav.setGate(navGate, false);
    this.body = rt.trackBody(fixedBody(ctx.physics, center.x, center.y, center.z));
    const c = ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setCollisionGroups(GROUP_STATIC), this.body);
    ctx.physics.setOwner(c, { kind: 'breakable', wall: this, noMantle: true });
    // stacked skull-and-bone bricks
    const bx = 0.5;
    const by = 0.35;
    const nx = Math.max(1, Math.round(Math.max(size.x, size.z) / bx));
    const ny = Math.round(size.y / by);
    const alongX = size.x >= size.z;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const off = (j % 2) * 0.25;
        const u = -Math.max(size.x, size.z) / 2 + (i + 0.5) * (Math.max(size.x, size.z) / nx) + off * (i === nx - 1 ? 0 : 1) * 0;
        const brick = boxMesh(ctx.mats, (i + j) % 3 === 0 ? 'bone' : 'dungeon', alongX ? bx * 0.96 : size.x, by * 0.94, alongX ? size.z : bx * 0.96, 1, 0xffffff - ((i * 7 + j * 13) % 5) * 0x0a0a0a);
        brick.position.set(alongX ? u : 0, -size.y / 2 + (j + 0.5) * by, alongX ? 0 : u);
        this.group.add(brick);
      }
    }
    // a crack mark on the kick side
    const crack = boxMesh(ctx.mats, 'obsidian', alongX ? 0.06 : 0.02, size.y * 0.7, alongX ? 0.02 : 0.06, 1);
    crack.position.copy(kickSide.clone().multiplyScalar((alongX ? size.z : size.x) / 2 + 0.01));
    crack.rotation.set(0, 0, 0.2);
    this.group.add(crack);
    this.group.position.copy(center);
    rt.group.add(this.group);
    rt.addInteract({
      kind: 'interact',
      id,
      position: center.clone(),
      reach: 2.6,
      prompt: () => {
        if (!this.body) return null;
        return this.onKickSide() ? `V  Kick the cracked wall (${this.kicks}/${this.kicksNeeded})` : 'Solid wall. Whatever is behind it, the cracks are on the other side.';
      },
      interact: () => {
        if (this.onKickSide()) this.kick();
      },
    });
  }
  onKickSide(): boolean {
    const p = this.ctx.player().pos;
    return new THREE.Vector3().subVectors(p, this.center).dot(this.kickSide) > 0;
  }
  kick(): boolean {
    if (!this.body || !this.onKickSide()) return false;
    this.kicks++;
    this.ctx.sfx.play('kick', this.center, 1);
    this.ctx.sfx.play('crumble', this.center, 0.8);
    this.ctx.fx.dustBurst(this.center, 20, 1.5);
    this.ctx.noise(this.center.clone(), 1.1, 'kick', true);
    this.ctx.shake(0.25);
    this.group.position.addScaledVector(this.kickSide, -0.03);
    if (this.kicks >= this.kicksNeeded) this.breakDown();
    return true;
  }
  private breakDown() {
    const ctx = this.ctx;
    ctx.physics.removeBody(this.body!);
    this.body = null;
    this.group.removeFromParent();
    ctx.sfx.play('wallBreak', this.center, 1.2);
    ctx.shake(0.8);
    ctx.fx.dustBurst(this.center, 60, 2.5);
    ctx.noise(this.center.clone(), 1.6, 'kick', true);
    ctx.setFlag(this.flag);
    ctx.nav.setGate(this.navGate, true);
    ctx.toast('The wall gives way. A shortcut!', 'good');
    // chunks fly away from the kicker
    for (let i = 0; i < 12; i++) {
      const s = 0.25 + Math.random() * 0.25;
      const p = this.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * this.size.x, (Math.random() - 0.5) * this.size.y, (Math.random() - 0.5) * this.size.z));
      const b = this.rt.trackBody(ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z)));
      ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(s / 2, s / 2, s / 2).setDensity(1800).setCollisionGroups(GROUP_DEBRIS), b);
      const v = this.kickSide.clone().multiplyScalar(-(2 + Math.random() * 3));
      b.setLinvel({ x: v.x + (Math.random() - 0.5) * 2, y: Math.random() * 2, z: v.z + (Math.random() - 0.5) * 2 }, true);
      const m = boxMesh(ctx.mats, i % 3 === 0 ? 'bone' : 'dungeon', s, s, s, 1);
      this.rt.group.add(m);
      const sync = ctx.physics.addSync(b, m);
      this.debris.push({ body: b, mesh: m, sync });
    }
  }
  dispose() {
    for (const d of this.debris) this.ctx.physics.removeSync(d.sync as never);
  }
}

// ---------------------------------------------------------------------------
// Crank: hold E repeatedly; noisy

export class Crank implements Prop {
  turns = 0;
  wheel: THREE.Group;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, pos: [number, number, number], rotY: number, private needed: number, private flag: Flag, private onTurn: (f: number) => void) {
    if (ctx.run.flag(flag)) this.turns = needed;
    const post = boxMesh(ctx.mats, 'dungeon', 0.5, 1.0, 0.5, 0.5);
    post.position.set(pos[0], pos[1] + 0.5, pos[2]);
    rt.group.add(post);
    this.wheel = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 6, 16), ctx.mats.get('iron'));
    (rim.geometry as THREE.BufferGeometry).setAttribute('color', new THREE.BufferAttribute(new Float32Array((rim.geometry as THREE.BufferGeometry).attributes.position.count * 3).fill(1), 3));
    rim.castShadow = true;
    this.wheel.add(rim);
    for (let i = 0; i < 4; i++) {
      const spoke = boxMesh(ctx.mats, 'iron', 0.8, 0.05, 0.05, 1);
      spoke.rotation.z = (i * Math.PI) / 4;
      this.wheel.add(spoke);
    }
    this.wheel.position.set(pos[0], pos[1] + 1.1, pos[2]);
    this.wheel.rotation.y = rotY;
    rt.group.add(this.wheel);
    rt.addInteract({
      kind: 'interact',
      id,
      position: new THREE.Vector3(pos[0], pos[1] + 1.1, pos[2]),
      holdTime: 0.4,
      repeat: true,
      prompt: () => (this.turns >= this.needed ? null : `Hold E  Turn the crank (${Math.round((this.turns / this.needed) * 100)}%). It is loud.`),
      interact: () => {
        if (this.turns >= this.needed) return;
        this.turns++;
        this.wheel.rotateZ(Math.PI / 6);
        ctx.sfx.play('crank', this.wheel.position, 1);
        ctx.noise(this.wheel.position.clone(), 1.2, 'machine', true);
        this.onTurn(this.turns / this.needed);
        if (this.turns >= this.needed) ctx.setFlag(this.flag);
      },
    });
    this.onTurn(this.turns / this.needed);
  }
  dispose() {}
}

// ---------------------------------------------------------------------------
// Key item pickup (Serpent Key)

export class KeyPickup implements Prop {
  obj: THREE.Object3D;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, item: 'serpentKey', pos: [number, number, number], label: string) {
    const taken = ctx.run.get('key:' + id);
    this.obj = ctx.models.make(item);
    this.obj.position.set(pos[0], pos[1] + 0.08, pos[2]);
    this.obj.rotation.set(0, 0.6, 0);
    rt.group.add(this.obj);
    if (taken) this.obj.visible = false;
    rt.addInteract({
      kind: 'interact',
      id,
      position: new THREE.Vector3(pos[0], pos[1] + 0.1, pos[2]),
      prompt: () => (this.obj.visible ? `E  Take the ${label}` : null),
      interact: () => {
        if (!this.obj.visible) return;
        this.obj.visible = false;
        ctx.run.set('key:' + id, true);
        ctx.run.unlock.items.add(item);
        ctx.sfx.play('chime', this.obj.position, 0.8);
        ctx.toast(`You have the ${label}.`, 'key');
        ctx.mapMark(pos[0], pos[2], 'key');
      },
    });
  }
  update() {
    if (this.obj.visible) this.obj.rotation.y += 0.01;
  }
  dispose() {}
}

// ---------------------------------------------------------------------------
// Supplies a luckless earlier thief left behind: an oil flask or a spare torch on a rotten bag

export class SupplyCache implements Prop {
  obj = new THREE.Group();
  private item = new THREE.Group();
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, kind: 'oil' | 'torch', pos: [number, number, number], rotY = 0) {
    const bag = boxMesh(ctx.mats, 'burlap', 0.46, 0.14, 0.32, 1, 0x9a8a70);
    bag.position.y = 0.07;
    bag.rotation.y = 0.3;
    this.obj.add(bag);
    if (kind === 'oil') {
      const jar = cylMesh(ctx.mats, 'clay', 0.07, 0.09, 0.2, 10);
      jar.position.y = 0.24;
      const neck = cylMesh(ctx.mats, 'clay', 0.035, 0.05, 0.07, 8);
      neck.position.y = 0.375;
      const plug = cylMesh(ctx.mats, 'cloth', 0.03, 0.03, 0.04, 6);
      plug.position.y = 0.43;
      this.item.add(jar, neck, plug);
    } else {
      const stick = cylMesh(ctx.mats, 'darkWood', 0.025, 0.03, 0.62, 6);
      stick.rotation.z = Math.PI / 2;
      stick.position.y = 0.17;
      const head = cylMesh(ctx.mats, 'burlap', 0.05, 0.05, 0.14, 8);
      head.rotation.z = Math.PI / 2;
      head.position.set(0.3, 0.17, 0);
      this.item.add(stick, head);
    }
    this.obj.add(this.item);
    this.obj.position.set(pos[0], pos[1], pos[2]);
    this.obj.rotation.y = rotY;
    rt.group.add(this.obj);
    if (ctx.run.get('supply:' + id)) this.item.visible = false;
    const label = kind === 'oil' ? 'oil flask' : 'spare torch';
    rt.addInteract({
      kind: 'interact',
      id,
      position: new THREE.Vector3(pos[0], pos[1] + 0.25, pos[2]),
      prompt: () => (this.item.visible ? `E  Take the ${label}` : null),
      interact: () => {
        if (!this.item.visible) return;
        this.item.visible = false;
        ctx.run.set('supply:' + id, true);
        if (kind === 'oil') ctx.run.torch.oilFlasks++;
        else ctx.run.torch.spareTorches++;
        ctx.sfx.play('pickup', new THREE.Vector3(pos[0], pos[1] + 0.2, pos[2]), 0.8);
        ctx.toast(kind === 'oil' ? 'A sealed oil flask. R pours it into your torch.' : 'A spare torch. When yours burns out, T lights it; E sets one in a sconce.', 'good');
      },
    });
  }
  dispose() {}
}

// ---------------------------------------------------------------------------
// Haul cart (banking)

export class HaulCart implements Prop {
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, pos: [number, number, number], rotY: number, private actions: { bank(): number; leave(): void; carriedCount(): number }) {
    const g = new THREE.Group();
    const bed = boxMesh(ctx.mats, 'wood', 2.2, 0.8, 1.3, 1);
    bed.position.y = 0.95;
    g.add(bed);
    const inner = boxMesh(ctx.mats, 'darkWood', 2.0, 0.1, 1.1, 1, 0x605040);
    inner.position.y = 1.32;
    g.add(inner);
    for (const [x, z] of [[-0.75, 0.72], [0.75, 0.72], [-0.75, -0.72], [0.75, -0.72]]) {
      const w = cylMesh(ctx.mats, 'darkWood', 0.45, 0.45, 0.12, 12);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.45, z);
      g.add(w);
    }
    const handle = boxMesh(ctx.mats, 'wood', 0.08, 0.08, 1.4, 1);
    handle.position.set(1.5, 1.0, 0);
    handle.rotation.y = Math.PI / 2;
    g.add(handle);
    // burlap sacks with banked loot
    for (let i = 0; i < 3; i++) {
      const sack = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), ctx.mats.get('burlap'));
      (sack.geometry as THREE.BufferGeometry).setAttribute('color', new THREE.BufferAttribute(new Float32Array((sack.geometry as THREE.BufferGeometry).attributes.position.count * 3).fill(1), 3));
      sack.scale.set(1, 0.7, 0.9);
      sack.position.set(-0.5 + i * 0.5, 1.5, (i % 2) * 0.2 - 0.1);
      sack.castShadow = true;
      sack.visible = false;
      sack.name = 'sack' + i;
      g.add(sack);
    }
    g.position.set(pos[0], pos[1], pos[2]);
    g.rotation.y = rotY;
    rt.group.add(g);
    const body = rt.trackBody(fixedBody(ctx.physics, pos[0], pos[1] + 0.9, pos[2], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0))));
    ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1.1, 0.9, 0.65).setCollisionGroups(GROUP_STATIC), body);
    const sacks = () => {
      const n = ctx.run.ledger.banked.length;
      for (let i = 0; i < 3; i++) {
        const s = g.getObjectByName('sack' + i);
        if (s) s.visible = n > i * 3;
      }
    };
    sacks();
    rt.addInteract({
      kind: 'interact',
      id: id + ':bank',
      position: new THREE.Vector3(pos[0], pos[1] + 1.3, pos[2]),
      reach: 3.2,
      losSlack: 1.5,
      prompt: () => {
        const n = this.actions.carriedCount();
        if (n > 0) return `E  Bank ${n} relic${n === 1 ? '' : 's'} in the haul cart`;
        return null;
      },
      holdTime: 0,
      interact: () => {
        const n = this.actions.carriedCount();
        if (n > 0) {
          const v = this.actions.bank();
          ctx.sfx.play('cart', new THREE.Vector3(...pos), 1);
          ctx.toast(`Banked ${v.toLocaleString()} in the cart. It is safe now.`, 'good');
          sacks();
        }
      },
    });
    rt.addInteract({
      kind: 'interact',
      id: id + ':leave',
      position: new THREE.Vector3(pos[0], pos[1] + 1.3, pos[2]),
      reach: 3.2,
      losSlack: 1.5,
      holdTime: 1.5,
      prompt: () => (this.actions.carriedCount() > 0 ? null : 'Hold E  Leave the temple for good (end the run)'),
      interact: () => this.actions.leave(),
    });
  }
  dispose() {}
}

// ---------------------------------------------------------------------------
// Rope anchor (Eagle's Nest): throw a rope over a beam to make a climbable rope

export class RopeAnchor implements Prop {
  rope: THREE.Mesh;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, top: [number, number, number], bottomY: number, normal: [number, number, number]) {
    const h = top[1] - bottomY;
    this.rope = cylMesh(ctx.mats, 'rope', 0.035, 0.035, h, 6);
    this.rope.position.set(top[0], bottomY + h / 2, top[2]);
    rt.group.add(this.rope);
    const climb = {
      id: id + ':climb',
      box: new THREE.Box3(new THREE.Vector3(top[0] - 0.4, bottomY, top[2] - 0.4), new THREE.Vector3(top[0] + 0.4, top[1] + 0.2, top[2] + 0.4)),
      normal: new THREE.Vector3(...normal).normalize(),
      kind: 'rope' as const,
      enabled: false,
      scene: rt.def.id,
    };
    rt.climbables.push(climb);
    const set = () => {
      const on = ctx.run.flag('nestRope');
      this.rope.visible = on;
      climb.enabled = on;
    };
    set();
    rt.addInteract({
      kind: 'interact',
      id,
      position: new THREE.Vector3(top[0], bottomY + 1.4, top[2]),
      reach: 3,
      prompt: () => {
        if (ctx.run.flag('nestRope')) return null;
        return ctx.run.ropes > 0 ? `E  Throw a rope over the beam (${ctx.run.ropes} left)` : 'A sturdy beam far overhead. A rope would reach it (buy rope in the shop).';
      },
      interact: () => {
        if (ctx.run.flag('nestRope') || ctx.run.ropes <= 0) {
          ctx.sfx.play('deny');
          return;
        }
        ctx.run.ropes--;
        ctx.setFlag('nestRope');
        ctx.sfx.play('whoosh', this.rope.position, 1);
        set();
        ctx.toast('The rope holds. Climb it.', 'good');
      },
    });
  }
  dispose() {}
}

export { GROUP_PROP };
