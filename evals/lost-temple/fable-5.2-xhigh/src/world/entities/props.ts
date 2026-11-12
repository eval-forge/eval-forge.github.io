/** Loose things: grabbable props, pushable stone blocks, pressure plates. */
import * as THREE from 'three';
import { clamp } from '../../core/rng';
import type { SceneId, Vec3Like } from '../../core/scenes';
import { PressurePlate } from '../../core/traps';
import { GROUPS, RAPIER, type Interactable } from '../../engine/physics';
import type { Game } from '../../game/game';
import { removeFrom, type Entity, type Weighted } from '../registry';

/** A scene-specific bit of behaviour without its own class. */
export class Fn implements Entity {
  constructor(private readonly f: { step?: (dt: number) => void; frame?: (dt: number) => void; dispose?: () => void }) {}
  step(dt: number): void {
    this.f.step?.(dt);
  }
  frame(dt: number): void {
    this.f.frame?.(dt);
  }
  dispose(): void {
    this.f.dispose?.();
  }
}

export type PropKind = 'rock' | 'skull' | 'pot' | 'sandbag' | 'rubble';

export interface PropRecord {
  id: string;
  kind: PropKind;
  mass: number;
  scene: SceneId;
  x: number;
  y: number;
  z: number;
  /** Used up (left on a pedestal). */
  consumed?: boolean;
}

const PROP_NAME: Record<PropKind, string> = {
  rock: 'Rock', skull: 'Skull', pot: 'Clay pot', sandbag: 'Sandbag', rubble: 'Rubble',
};
const PROP_MAT: Record<PropKind, string> = {
  rock: 'rock', skull: 'bone', pot: 'clay', sandbag: 'cloth', rubble: 'templeStone',
};

function propGeometry(kind: PropKind, size: number): THREE.BufferGeometry {
  switch (kind) {
    case 'skull': {
      const g = new THREE.SphereGeometry(size, 10, 8);
      g.scale(0.85, 0.95, 1.05);
      return g;
    }
    case 'pot': {
      const pts = [0.0, 0.55, 0.9, 1.0, 0.8, 0.5, 0.6].map((r, i) => new THREE.Vector2(r * size, (i / 6) * size * 2 - size));
      return new THREE.LatheGeometry(pts, 12);
    }
    case 'sandbag': {
      const g = new THREE.SphereGeometry(size, 10, 8);
      g.scale(1.25, 0.6, 0.9);
      return g;
    }
    default: {
      const g = new THREE.IcosahedronGeometry(size, 1);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const k = 0.82 + 0.3 * Math.abs(Math.sin(p.getX(i) * 12.9 + p.getY(i) * 78.2 + p.getZ(i) * 37.7));
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
      }
      g.computeVertexNormals();
      return g;
    }
  }
}

/** Radius of a prop of this kind and mass (denser things are smaller). */
export function propSize(kind: PropKind, mass: number): number {
  const density = kind === 'skull' ? 1100 : kind === 'pot' ? 500 : kind === 'sandbag' ? 1300 : 2400;
  return clamp(Math.cbrt((3 * mass) / (4 * Math.PI * density)) * 1.55, 0.12, 0.34);
}

export class Prop implements Entity, Interactable {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh: THREE.Mesh;
  readonly mass: number;
  readonly name: string;
  held = false;
  thrown = false;
  consumed = false;
  private readonly weighted: Weighted;
  private pvx = 0;
  private pvy = 0;
  private pvz = 0;
  private quiet = 0.5;
  private dark = false;

  constructor(
    private readonly game: Game,
    readonly rec: PropRecord,
    parent: THREE.Object3D,
    dark: boolean,
  ) {
    this.mass = rec.mass;
    this.name = PROP_NAME[rec.kind];
    const size = propSize(rec.kind, rec.mass);
    const w = game.physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(rec.x, rec.y + size, rec.z).setLinearDamping(0.15).setAngularDamping(2.6).setCcdEnabled(true),
    );
    this.collider = w.createCollider(
      RAPIER.ColliderDesc.ball(size * 0.9).setMass(rec.mass).setFriction(0.9).setRestitution(0.15).setCollisionGroups(GROUPS.prop),
      this.body,
    );
    game.physics.setMeta(this.collider, { interact: this, kind: 'prop', owner: this, surface: 'stone' });
    this.mesh = game.mats.mesh(propGeometry(rec.kind, size), PROP_MAT[rec.kind], dark);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.dark = dark;
    parent.add(this.mesh);
    this.weighted = { body: this.body, mass: rec.mass, half: size };
    game.reg.weights.push(this.weighted);
    this.frame();
  }

  prompt(): string | null {
    if (this.held || this.consumed) return null;
    return `Pick up ${this.name} (${this.mass.toFixed(1)} kg)`;
  }

  interact(): void {
    if (!this.consumed) this.game.player.grab(this);
  }

  setHeld(h: boolean): void {
    this.held = h;
    this.collider.setCollisionGroups(h ? GROUPS.held : GROUPS.prop);
    this.body.setGravityScale(h ? 0 : 1, true);
    this.quiet = 0.3;
    if (!h) this.game.scenes.adoptProp(this);
  }

  setZone(dark: boolean): void {
    if (dark === this.dark) return;
    this.dark = dark;
    this.game.mats.applyZone(this.mesh, dark);
  }

  /** Leave the prop sitting on a pedestal for good. */
  consume(at: Vec3Like): void {
    this.consumed = true;
    this.rec.consumed = true;
    this.rec.x = at.x;
    this.rec.y = at.y;
    this.rec.z = at.z;
    this.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    this.body.setTranslation({ x: at.x, y: at.y + propSize(this.rec.kind, this.mass) * 0.8, z: at.z }, true);
    this.collider.setCollisionGroups(GROUPS.debris);
    removeFrom(this.game.reg.weights, this.weighted);
  }

  step(dt: number): void {
    if (this.consumed) return;
    const v = this.body.linvel();
    this.quiet = Math.max(0, this.quiet - dt);
    if (!this.held && this.quiet <= 0) {
      const dv = Math.hypot(v.x - this.pvx, v.y - this.pvy, v.z - this.pvz);
      if (dv > 3.2) {
        const p = this.body.translation();
        const k = clamp(dv / 9, 0.35, 1.5) * clamp(this.mass / 4, 0.5, 1.4);
        this.game.sfx('thud', p, clamp(k, 0.3, 1), 1.3 - Math.min(0.6, this.mass / 20));
        this.game.noise('impact', p, k);
        this.game.particles.emit('dust', p, 5, { spread: 0.15 });
        this.thrown = false;
        this.quiet = 0.12;
      }
    }
    this.pvx = v.x;
    this.pvy = v.y;
    this.pvz = v.z;
    const t = this.body.translation();
    if (t.y < this.game.killY() - 30) {
      // Lost down a pit: park it out of the way.
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      this.body.sleep();
    }
  }

  frame(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  /** Write the current position back to the run record. */
  save(scene: SceneId): void {
    const t = this.body.translation();
    this.rec.scene = scene;
    this.rec.x = t.x;
    this.rec.y = t.y - propSize(this.rec.kind, this.mass);
    this.rec.z = t.z;
  }

  dispose(): void {
    if (this.game.player.held === this) this.game.player.held = null;
    removeFrom(this.game.reg.weights, this.weighted);
    this.game.physics.removeBody(this.body);
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

/** A heavy stone cube the player can lean on and slide. Holds pressure plates down. */
export class PushBlock implements Entity {
  readonly body: RAPIER.RigidBody;
  readonly mesh: THREE.Mesh;
  private readonly weighted: Weighted;
  private grindT = 0;
  private readonly home: Vec3Like;

  constructor(
    private readonly game: Game,
    private readonly key: string,
    x: number,
    y: number,
    z: number,
    readonly size: number,
    parent: THREE.Object3D,
    dark: boolean,
  ) {
    this.home = { x, y: y + size / 2, z };
    const saved = game.run.get<Vec3Like | null>(key, null);
    const p = saved ?? this.home;
    const w = game.physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).lockRotations().setLinearDamping(6).setCanSleep(true),
    );
    const c = w.createCollider(
      RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2).setMass(420).setFriction(0.6).setCollisionGroups(GROUPS.prop),
      this.body,
    );
    game.physics.setMeta(c, { kind: 'block', owner: this, surface: 'stone' });
    const g = new THREE.BoxGeometry(size, size, size);
    this.mesh = game.mats.mesh(g, 'templeStone', dark);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // A carved band so it reads as "the thing you push".
    const band = game.mats.mesh(new THREE.BoxGeometry(size * 1.02, size * 0.16, size * 1.02), 'bronze', dark);
    band.position.y = size * 0.22;
    this.mesh.add(band);
    parent.add(this.mesh);
    this.weighted = { body: this.body, mass: 420, half: size / 2 };
    game.reg.weights.push(this.weighted);
    this.frame();
  }

  /** Called by the player controller each step it is pushing. */
  pushed(): void {
    this.grindT -= 1 / 60;
    if (this.grindT <= 0) {
      this.grindT = 0.45;
      const t = this.body.translation();
      this.game.sfx('grind', t, 0.7, 0.9 + Math.random() * 0.2);
      this.game.noise('block', t);
      this.game.particles.emit('dust', { x: t.x, y: t.y - this.size / 2, z: t.z }, 4, { spread: this.size / 2 });
    }
  }

  reset(): void {
    this.body.setTranslation(this.home, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  frame(): void {
    const t = this.body.translation();
    this.mesh.position.set(t.x, t.y, t.z);
  }

  dispose(): void {
    const t = this.body.translation();
    this.game.run.set(this.key, { x: t.x, y: t.y, z: t.z });
    removeFrom(this.game.reg.weights, this.weighted);
    this.game.physics.removeBody(this.body);
    this.mesh.removeFromParent();
  }
}

/** A floor plate that sums the mass standing on it. */
export class Plate implements Entity {
  readonly logic: PressurePlate;
  private readonly mesh: THREE.Mesh;
  private sink = 0;

  constructor(
    private readonly game: Game,
    private readonly x0: number,
    private readonly z0: number,
    private readonly x1: number,
    private readonly z1: number,
    private readonly y: number,
    thresholdKg: number,
    latch: boolean,
    private readonly onChange: (pressed: boolean) => void,
    parent: THREE.Object3D,
    dark: boolean,
    mat = 'bronze',
  ) {
    this.logic = new PressurePlate(thresholdKg, latch);
    const g = new THREE.BoxGeometry(x1 - x0 - 0.1, 0.09, z1 - z0 - 0.1);
    this.mesh = game.mats.mesh(g, mat, dark);
    this.mesh.position.set((x0 + x1) / 2, y + 0.025, (z0 + z1) / 2);
    this.mesh.receiveShadow = true;
    parent.add(this.mesh);
  }

  get pressed(): boolean {
    return this.logic.pressed;
  }

  /** Kilograms currently on the plate. */
  load(): number {
    let kg = 0;
    const g = this.game;
    if (g.player.alive && g.player.over(this.x0, this.z0, this.x1, this.z1, this.y, 0.3, 0.05)) kg += g.player.mass;
    for (const w of g.reg.weights) {
      const t = w.body.translation();
      if (t.x < this.x0 || t.x > this.x1 || t.z < this.z0 || t.z > this.z1) continue;
      if (t.y - w.half > this.y + 0.35 || t.y < this.y - 0.2) continue;
      kg += w.mass;
    }
    return kg;
  }

  step(dt: number): void {
    const ev = this.logic.update(this.load(), dt);
    if (ev) {
      this.game.sfx('plate', this.mesh.position, 0.9, ev === 'pressed' ? 1 : 1.25);
      this.onChange(ev === 'pressed');
    }
  }

  frame(dt: number): void {
    const target = this.logic.pressed ? 1 : 0;
    this.sink += (target - this.sink) * Math.min(1, dt * 14);
    this.mesh.position.y = this.y + 0.025 - this.sink * 0.06;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}
