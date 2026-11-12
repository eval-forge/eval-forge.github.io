/** Things that open: sliding gates, the kick wall, the drawbridge, levers, sockets, the sundial. */
import * as THREE from 'three';
import { clamp01 } from '../../core/rng';
import type { Vec3Like } from '../../core/scenes';
import { SUNDIAL_STEP, shadowAzimuth, sundialAligned, sundialReadable } from '../../core/sun';
import { GROUPS, RAPIER, type Interactable } from '../../engine/physics';
import type { Game } from '../../game/game';
import type { LoadedScene } from '../kit';
import type { Entity } from '../registry';

/**
 * A slab or portcullis that slides vertically. `isOpen` is polled, so the
 * gate simply follows the run's flags.
 */
export class Gate implements Entity {
  private readonly body: RAPIER.RigidBody;
  private t: number;
  private moving = false;
  private grindT = 0;

  /**
   * @param mesh visual, positioned at the closed pose
   * @param travel metres moved when fully open (negative sinks into the floor)
   */
  constructor(
    private readonly game: Game,
    parent: THREE.Object3D,
    private readonly mesh: THREE.Object3D,
    center: Vec3Like,
    half: Vec3Like,
    private readonly travel: number,
    private readonly isOpen: () => boolean,
    private readonly speed = 0.45,
    private readonly loud = true,
  ) {
    const w = game.physics.world;
    this.t = isOpen() ? 1 : 0;
    this.base = { ...center };
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y + this.travel * this.t, center.z));
    const c = w.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setCollisionGroups(GROUPS.world), this.body);
    game.physics.setMeta(c, { kind: 'gate', surface: 'stone' });
    this.meshBase = mesh.position.y;
    parent.add(mesh);
    this.frame();
  }

  private readonly base: Vec3Like;
  private readonly meshBase: number;

  /** 0 closed .. 1 open. */
  get openness(): number {
    return this.t;
  }

  step(dt: number): void {
    const target = this.isOpen() ? 1 : 0;
    if (this.t === target) {
      this.moving = false;
      return;
    }
    if (!this.moving) {
      this.moving = true;
      this.grindT = 0;
    }
    this.t = target > this.t ? Math.min(1, this.t + dt * this.speed) : Math.max(0, this.t - dt * this.speed);
    this.body.setNextKinematicTranslation({ x: this.base.x, y: this.base.y + this.travel * this.t, z: this.base.z });
    this.grindT -= dt;
    if (this.grindT <= 0 && this.loud) {
      this.grindT = 2.4;
      this.game.sfx('grindLong', this.base, 1);
      this.game.noise('door', this.base);
    }
    if (this.t === target && this.loud) this.game.sfx('thud', this.base, 1, 0.6);
  }

  frame(): void {
    this.mesh.position.y = this.meshBase + this.travel * this.t;
  }

  dispose(): void {
    this.game.physics.removeBody(this.body);
    this.mesh.removeFromParent();
    this.mesh.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

/** A grille of bronze bars as one mesh. */
export function barsMesh(game: Game, width: number, height: number, alongX: boolean, dark: boolean): THREE.Mesh {
  const n = Math.max(3, Math.round(width / 0.28));
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const push = (g: THREE.BufferGeometry): void => {
    const base = pos.length / 3;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
    uv.push(...(g.getAttribute('uv').array as Float32Array));
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    g.dispose();
  };
  for (let i = 0; i < n; i++) {
    const g = new THREE.CylinderGeometry(0.045, 0.045, height, 6);
    const o = -width / 2 + ((i + 0.5) / n) * width;
    g.translate(alongX ? o : 0, 0, alongX ? 0 : o);
    push(g);
  }
  for (const y of [-height * 0.3, height * 0.3]) {
    const g = new THREE.BoxGeometry(alongX ? width : 0.07, 0.1, alongX ? 0.07 : width);
    g.translate(0, y, 0);
    push(g);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const m = game.mats.mesh(geo, 'bronze', dark);
  m.castShadow = true;
  return m;
}

/** A plain stone slab mesh. */
export function slabMesh(game: Game, sx: number, sy: number, sz: number, mat: string, dark: boolean): THREE.Mesh {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const s = 1 / game.mats.scaleOf(mat);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(sx, sz) * s, uv.getY(i) * sy * s);
  const m = game.mats.mesh(g, mat, dark);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** An invisible interaction volume with a prompt. */
export class Trigger implements Entity, Interactable {
  private collider: RAPIER.Collider | null;

  constructor(
    private readonly game: Game,
    scene: LoadedScene,
    at: Vec3Like,
    half: Vec3Like,
    private readonly text: () => string | null,
    private readonly act: () => void,
  ) {
    this.collider = game.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(at.x, at.y, at.z).setCollisionGroups(GROUPS.interact),
      scene.body,
    );
    game.physics.setMeta(this.collider, { interact: this, kind: 'trigger' });
  }

  prompt(): string | null {
    return this.text();
  }

  interact(): void {
    this.act();
  }

  remove(): void {
    this.game.physics.removeCollider(this.collider);
    this.collider = null;
  }

  dispose(): void {
    this.collider = null;
  }
}

/** A bronze lever on a stone base. One pull, stays thrown. */
export class Lever implements Entity, Interactable {
  private readonly handle: THREE.Mesh;
  private readonly group = new THREE.Group();
  private t: number;

  constructor(
    private readonly game: Game,
    scene: LoadedScene,
    at: Vec3Like,
    yaw: number,
    private readonly label: string,
    private readonly isThrown: () => boolean,
    private readonly onPull: () => void,
    dark: boolean,
  ) {
    const base = game.mats.mesh(new THREE.BoxGeometry(0.5, 0.9, 0.4), 'templeStone', dark);
    base.position.y = 0.45;
    this.handle = game.mats.mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 6), 'bronze', dark);
    this.handle.geometry.translate(0, 0.4, 0);
    this.handle.position.y = 0.85;
    const knob = game.mats.mesh(new THREE.SphereGeometry(0.07, 8, 6), 'bronze', dark);
    knob.position.y = 0.8;
    this.handle.add(knob);
    this.group.add(base, this.handle);
    this.group.position.set(at.x, at.y, at.z);
    this.group.rotation.y = yaw;
    this.group.traverse((o) => {
      (o as THREE.Mesh).castShadow = true;
    });
    scene.group.add(this.group);
    this.t = isThrown() ? 1 : 0;
    const c = game.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.4, 0.8, 0.4).setTranslation(at.x, at.y + 0.8, at.z).setCollisionGroups(GROUPS.interact),
      scene.body,
    );
    game.physics.setMeta(c, { interact: this, kind: 'lever' });
    const solid = game.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, 0.45, 0.25).setTranslation(at.x, at.y + 0.45, at.z).setCollisionGroups(GROUPS.world),
      scene.body,
    );
    game.physics.setMeta(solid, { surface: 'stone' });
    this.frame(0);
  }

  prompt(): string | null {
    return this.isThrown() ? null : this.label;
  }

  interact(): void {
    if (this.isThrown()) return;
    this.game.sfx('lever', this.group.position);
    this.game.noise('door', this.group.position, 0.4);
    this.onPull();
  }

  frame(dt: number): void {
    const target = this.isThrown() ? 1 : 0;
    this.t += (target - this.t) * Math.min(1, dt * 8);
    this.handle.rotation.x = -0.7 + this.t * 1.4;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

/** A cracked section of wall that can be kicked out, from one side only. */
export class KickWall implements Entity, Interactable {
  private collider: RAPIER.Collider | null = null;
  private readonly mesh: THREE.Group;
  private readonly chunks: { body: RAPIER.RigidBody; mesh: THREE.Mesh }[] = [];
  private hits = 0;

  /** The wall fills the box; `out` is the direction the rubble flies (away from the kicker). */
  constructor(
    private readonly game: Game,
    private readonly scene: LoadedScene,
    private readonly x0: number,
    private readonly y0: number,
    private readonly z0: number,
    private readonly x1: number,
    private readonly y1: number,
    private readonly z1: number,
    private readonly out: Vec3Like,
    dark: boolean,
  ) {
    this.mesh = new THREE.Group();
    scene.group.add(this.mesh);
    if (game.hasFlag('wallKicked')) return;
    // Built from visibly separate, slightly rotated stones so it reads as "about to go".
    const nx = 4;
    const ny = 4;
    const sx = (x1 - x0) / nx;
    const sy = (y1 - y0) / ny;
    const sz = z1 - z0;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const m = slabMesh(game, sx * 0.96, sy * 0.96, sz * 0.8, 'mossStone', dark);
        m.position.set(x0 + (ix + 0.5) * sx, y0 + (iy + 0.5) * sy, (z0 + z1) / 2 + (((ix * 7 + iy * 3) % 5) - 2) * 0.03);
        m.rotation.set(0, (((ix + iy * 2) % 3) - 1) * 0.03, (((ix * 3 + iy) % 3) - 1) * 0.02);
        this.mesh.add(m);
      }
    }
    this.collider = game.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, sz / 2).setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).setCollisionGroups(GROUPS.world),
      scene.body,
    );
    game.physics.setMeta(this.collider, { interact: this, kind: 'kickwall', surface: 'stone' });
  }

  private onKickSide(): boolean {
    const p = this.game.player.pos;
    const cx = (this.x0 + this.x1) / 2;
    const cz = (this.z0 + this.z1) / 2;
    return (p.x - cx) * this.out.x + (p.z - cz) * this.out.z < 0;
  }

  prompt(): string | null {
    if (!this.collider) return null;
    return this.onKickSide() ? (this.hits === 0 ? 'Kick the cracked wall' : 'Kick it again') : 'Cracked masonry. It will not give from this side.';
  }

  interact(): void {
    if (!this.collider || !this.onKickSide()) return;
    const game = this.game;
    const c = { x: (this.x0 + this.x1) / 2, y: (this.y0 + this.y1) / 2, z: (this.z0 + this.z1) / 2 };
    this.hits++;
    game.player.spend(12);
    game.sfx('kick', c);
    game.shake(0.35);
    game.noise('impact', c, 1.4);
    game.particles.emit('dust', c, 16, { spread: 1 });
    if (this.hits < 2) {
      for (const m of this.mesh.children) m.position.addScaledVector(new THREE.Vector3(this.out.x, 0, this.out.z), 0.06 + Math.random() * 0.08);
      return;
    }
    // It goes: every stone becomes a body.
    game.physics.removeCollider(this.collider);
    this.collider = null;
    const w = game.physics.world;
    for (const child of [...this.mesh.children]) {
      const m = child as THREE.Mesh;
      const p = m.position;
      const body = w.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setLinvel(this.out.x * (3 + Math.random() * 4), 1 + Math.random() * 2.5, this.out.z * (3 + Math.random() * 4))
          .setAngvel({ x: Math.random() * 6 - 3, y: Math.random() * 6 - 3, z: Math.random() * 6 - 3 }),
      );
      const g = (m.geometry as THREE.BoxGeometry).parameters;
      w.createCollider(RAPIER.ColliderDesc.cuboid(g.width / 2, g.height / 2, g.depth / 2).setDensity(900).setCollisionGroups(GROUPS.debris), body);
      this.chunks.push({ body, mesh: m });
    }
    game.sfx('debris', c, 1);
    game.noise('debris', c);
    game.setFlag('wallKicked');
  }

  frame(): void {
    for (const c of this.chunks) {
      const t = c.body.translation();
      const r = c.body.rotation();
      c.mesh.position.set(t.x, t.y, t.z);
      c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  dispose(): void {
    for (const c of this.chunks) this.game.physics.removeBody(c.body);
    this.mesh.removeFromParent();
    this.mesh.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

/** A deck hinged at one end, lowered by a winch. */
export class Drawbridge implements Entity {
  private readonly body: RAPIER.RigidBody;
  private readonly mesh: THREE.Group;
  private t: number;
  private creak = 0;

  /** Hinge along Z at (hx, y); the deck extends `len` metres toward +X when down. */
  constructor(
    private readonly game: Game,
    parent: THREE.Object3D,
    private readonly hx: number,
    private readonly y: number,
    private readonly z0: number,
    private readonly z1: number,
    private readonly len: number,
    private readonly isDown: () => boolean,
    dark: boolean,
  ) {
    const w = game.physics.world;
    this.t = isDown() ? 1 : 0;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const c = w.createCollider(RAPIER.ColliderDesc.cuboid(len / 2, 0.12, (z1 - z0) / 2).setCollisionGroups(GROUPS.world), this.body);
    game.physics.setMeta(c, { kind: 'drawbridge', surface: 'wood' });
    this.mesh = new THREE.Group();
    const deck = slabMesh(game, len, 0.2, z1 - z0, 'wood', dark);
    this.mesh.add(deck);
    for (const dz of [-(z1 - z0) / 2 + 0.1, (z1 - z0) / 2 - 0.1]) {
      const beam = slabMesh(game, len, 0.3, 0.2, 'wood', dark);
      beam.position.set(0, -0.2, dz);
      this.mesh.add(beam);
    }
    parent.add(this.mesh);
    this.apply(true);
    if (this.t === 1) this.settle();
  }

  /**
   * Once the deck is down it stops being a moving platform and becomes plain static
   * ground. Rapier's character controller runs a separate "riding a kinematic body" path
   * on a kinematic floor, and on this deck that path would now and then swallow a whole
   * step of movement, leaving the player rooted mid-bridge until they jumped.
   */
  private settle(): void {
    this.apply(true);
    this.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
  }

  private apply(hard: boolean): void {
    const ang = (1 - this.t) * 1.38; // radians above horizontal
    const cx = this.hx + (Math.cos(ang) * this.len) / 2;
    const cy = this.y - 0.12 + (Math.sin(ang) * this.len) / 2;
    const cz = (this.z0 + this.z1) / 2;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang);
    if (hard) {
      this.body.setTranslation({ x: cx, y: cy, z: cz }, true);
      this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    }
    this.body.setNextKinematicTranslation({ x: cx, y: cy, z: cz });
    this.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    this.mesh.position.set(cx, cy, cz);
    this.mesh.quaternion.copy(q);
  }

  step(dt: number): void {
    const target = this.isDown() ? 1 : 0;
    if (this.t === target) return;
    this.t = Math.min(1, this.t + dt * 0.3);
    this.creak -= dt;
    if (this.creak <= 0) {
      this.creak = 0.7;
      this.game.sfx('creak', this.mesh.position, 1, 0.7);
    }
    if (this.t === 1) {
      this.game.sfx('doorSlam', this.mesh.position, 0.8);
      this.game.noise('door', this.mesh.position);
      this.game.shake(0.4);
      this.settle();
      return;
    }
    this.apply(false);
  }

  dispose(): void {
    this.game.physics.removeBody(this.body);
    this.mesh.removeFromParent();
    this.mesh.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

/**
 * The courtyard sundial. A bronze gnomon throws a real shadow; turning the
 * stone ring until its serpent sits in that shadow opens the centre stone.
 */
export class Sundial implements Entity, Interactable {
  private readonly ring: THREE.Group;
  private readonly cap: THREE.Mesh;
  private readonly fixed = new THREE.Group();
  private collider: RAPIER.Collider | null = null;
  /** Ring angle, same convention as shadowAzimuth (atan2(x, z)). */
  angle: number;
  private shown: number;
  private hold = 0;
  private solved: boolean;
  private repeat = 0;
  private capT: number;
  /** Where the Sun Disc stands once the niche is open. */
  readonly keyPos: Vec3Like;

  constructor(
    private readonly game: Game,
    private readonly scene: LoadedScene,
    private readonly cx: number,
    private readonly cz: number,
    private readonly y: number,
    private readonly onSolved: () => void,
  ) {
    this.solved = game.run.get('sundial.solved', false);
    this.angle = game.run.get('sundial.angle', Math.PI * 0.6);
    this.shown = this.angle;
    this.capT = this.solved ? 1 : 0;
    this.keyPos = { x: cx, y: y + 0.42, z: cz + 0.68 };
    const mats = game.mats;
    const world = game.physics.world;
    this.ring = new THREE.Group();
    const ringMesh = mats.mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.22, 48, 1, false), 'templeStone', false);
    ringMesh.position.y = 0.11;
    ringMesh.receiveShadow = true;
    ringMesh.castShadow = true;
    this.ring.add(ringMesh);
    // A pale, seamless face, so the gnomon's shadow is the only dark line on the dial.
    const face = mats.mesh(new THREE.CylinderGeometry(2.42, 2.42, 0.03, 40), 'bone', false);
    face.position.y = 0.235;
    face.receiveShadow = true;
    this.ring.add(face);
    // Twelve glyph stones; the serpent stone (local +Z) is bronze and taller.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const serpent = i === 0;
      const m = mats.mesh(new THREE.BoxGeometry(serpent ? 0.9 : 0.5, serpent ? 0.3 : 0.12, serpent ? 1.0 : 0.6), serpent ? 'bronze' : 'mossStone', false);
      m.position.set(Math.sin(a) * 2.85, 0.22 + (serpent ? 0.15 : 0.06), Math.cos(a) * 2.85);
      m.rotation.y = a;
      m.castShadow = true;
      m.receiveShadow = true;
      this.ring.add(m);
      if (serpent) {
        const s = mats.mesh(new THREE.TorusGeometry(0.26, 0.07, 6, 14, Math.PI * 1.6), 'jade', false);
        s.rotation.x = -Math.PI / 2;
        s.position.set(Math.sin(a) * 2.85, 0.56, Math.cos(a) * 2.85);
        this.ring.add(s);
      }
    }
    // Four push bars.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const bar = mats.mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6), 'wood', false);
      bar.position.set(Math.sin(a) * 3.45, 0.75, Math.cos(a) * 3.45);
      bar.castShadow = true;
      this.ring.add(bar);
    }
    this.ring.position.set(cx, y, cz);
    this.ring.rotation.y = this.angle;
    scene.group.add(this.ring);

    // The fixed heart of the dial: a plinth with a sealed niche, and the gnomon that throws the shadow.
    const plinth = mats.mesh(new THREE.BoxGeometry(1.1, 1.0, 1.1), 'templeStone', false);
    plinth.position.set(cx, y + 0.22 + 0.5, cz);
    const niche = mats.mesh(new THREE.BoxGeometry(0.62, 0.62, 0.04), 'char', false);
    niche.position.set(cx, y + 0.22 + 0.42, cz + 0.56);
    // A four-sided obelisk, thick enough that its shadow is several shadow-map texels wide at any quality.
    const gnomon = mats.mesh(new THREE.CylinderGeometry(0.16, 0.3, 4.8, 4), 'bronze', false);
    gnomon.position.set(cx, y + 1.22 + 2.4, cz);
    const finial = mats.mesh(new THREE.SphereGeometry(0.3, 12, 8), 'gold', false);
    finial.position.set(cx, y + 1.22 + 4.95, cz);
    for (const m of [plinth, niche, gnomon, finial]) {
      m.castShadow = m !== niche;
      m.receiveShadow = true;
      this.fixed.add(m);
    }
    scene.group.add(this.fixed);
    const solid = (desc: RAPIER.ColliderDesc): void => {
      game.physics.setMeta(world.createCollider(desc.setCollisionGroups(GROUPS.world), scene.body), { surface: 'stone' });
    };
    solid(RAPIER.ColliderDesc.cylinder(0.11, 3.4).setTranslation(cx, y + 0.11, cz));
    solid(RAPIER.ColliderDesc.cuboid(0.55, 0.5, 0.55).setTranslation(cx, y + 0.72, cz));
    solid(RAPIER.ColliderDesc.cylinder(2.4, 0.26).setTranslation(cx, y + 3.6, cz));

    // The niche cover: slides down into the dial when the ring is set right.
    this.cap = mats.mesh(new THREE.BoxGeometry(0.7, 0.7, 0.09), 'bronze', false);
    this.cap.castShadow = true;
    this.cap.receiveShadow = true;
    scene.group.add(this.cap);

    if (!this.solved) {
      this.collider = world.createCollider(
        RAPIER.ColliderDesc.cylinder(0.8, 3.75).setTranslation(cx, y + 0.8, cz).setCollisionGroups(GROUPS.interact),
        scene.body,
      );
      game.physics.setMeta(this.collider, { interact: this, kind: 'sundial' });
    }
    this.frame(0);
  }

  prompt(): string | null {
    if (this.solved) return null;
    const f = this.game.run.clock.dayFraction;
    if (!sundialReadable(f)) return 'The gnomon casts no readable shadow. The sun is too low.';
    return 'Hold E to turn the ring (crouch to turn it back)\nSet the bronze serpent in the gnomon\'s shadow';
  }

  interact(): void {
    this.turn();
    this.repeat = 0.3;
  }

  private turn(): void {
    if (this.solved) return;
    const dir = this.game.player.crouching ? -1 : 1;
    this.angle += dir * SUNDIAL_STEP;
    if (this.angle > Math.PI) this.angle -= Math.PI * 2;
    if (this.angle < -Math.PI) this.angle += Math.PI * 2;
    this.game.sfx('grind', { x: this.cx, y: this.y, z: this.cz }, 0.8, 1.1);
    this.game.noise('block', { x: this.cx, y: this.y, z: this.cz }, 0.6);
    this.hold = 0;
  }

  step(dt: number): void {
    if (this.solved) return;
    const game = this.game;
    // Holding E keeps the ring turning while you look at it.
    if (game.input.interactHeld && game.interactTarget === this) {
      this.repeat -= dt;
      if (this.repeat <= 0) {
        this.repeat = 0.16;
        this.turn();
      }
    }
    const f = game.run.clock.dayFraction;
    if (sundialReadable(f) && sundialAligned(this.angle, f)) {
      this.hold += dt;
      if (this.hold > 0.9) {
        this.solved = true;
        game.run.set('sundial.solved', true);
        game.run.set('sundial.angle', this.angle);
        game.physics.removeCollider(this.collider);
        this.collider = null;
        game.sfx('unlock', { x: this.cx, y: this.y, z: this.cz });
        game.sfx('gong', { x: this.cx, y: this.y, z: this.cz }, 0.6);
        game.toast('The serpent drinks the shadow. A niche opens in the dial.', 'good');
        this.onSolved();
      }
    } else {
      this.hold = 0;
    }
  }

  /** Debug / autoplay: snap the ring onto the shadow. */
  solveNow(): void {
    const f = this.game.run.clock.dayFraction;
    this.angle = Math.round(shadowAzimuth(f) / SUNDIAL_STEP) * SUNDIAL_STEP;
  }

  frame(dt: number): void {
    let d = this.angle - this.shown;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.shown += d * Math.min(1, dt * 7);
    this.ring.rotation.y = this.shown;
    this.capT = clamp01(this.capT + (this.solved ? dt * 0.7 : -dt));
    this.cap.position.set(this.cx, this.y + 0.22 + 0.42 - this.capT * 0.78, this.cz + 0.6);
  }

  dispose(): void {
    this.game.run.set('sundial.angle', this.angle);
    this.collider = null;
    for (const o of [this.ring, this.cap, this.fixed]) {
      o.removeFromParent();
      o.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
    }
  }
}
