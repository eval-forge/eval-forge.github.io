import * as THREE from 'three';
import { RAPIER, type Physics } from '../world/Physics';
import type { Materials } from '../world/Materials';
import { relicMesh, propMesh } from './RelicMeshes';
import { RELIC_BY_ID, type SceneId } from '../logic/economy';
import type { RunState } from '../core/RunState';

export type PropKind = 'relic' | 'rock' | 'sandbag' | 'block' | 'oil' | 'spare';

export interface PropDef {
  id: string;
  kind: PropKind;
  pos: [number, number, number];
  rotY?: number;
  relicId?: string;
  /** Scene the relic was originally found in (fixes its value). */
  origin: SceneId;
  mass?: number;
  /** half-extents for blocks/rocks/sandbags */
  size?: [number, number, number];
  /** Starts asleep and frozen until touched (relics on pedestals). */
  sleeping?: boolean;
}

export interface Prop {
  def: PropDef;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  obj: THREE.Object3D;
  mass: number;
  owner: SceneId;
  lastVel: THREE.Vector3;
  label: string;
}

interface Saved { def: PropDef; owner: SceneId; pos: [number, number, number]; quat: [number, number, number, number]; removed?: boolean }

/** Every grabbable dynamic object: relics, rocks, sandbags, push-blocks, pickups. */
export class PropSystem {
  props = new Map<string, Prop>();
  held: Prop | null = null;
  private dropCounter = 0;
  onImpact: (p: Prop, speed: number) => void = () => {};

  constructor(private scene: THREE.Scene, private physics: Physics, private mats: Materials, private run: () => RunState) {}

  private key(id: string) { return 'prop:' + id; }

  /** Spawn authored props for a scene (respecting persistence) and any dropped props owned by it. */
  attachScene(scene: SceneId, defs: PropDef[]) {
    const run = this.run();
    for (const d of defs) {
      const saved = run.entities.get(this.key(d.id)) as Saved | undefined;
      if (saved) continue; // handled below (it may now be owned by another scene)
      this.spawn(d, scene);
    }
    for (const [k, v] of run.entities) {
      if (!k.startsWith('prop:')) continue;
      const s = v as Saved;
      if (s.owner !== scene || s.removed || this.props.has(s.def.id)) continue;
      this.spawn(s.def, scene, s);
    }
  }

  /** Save + remove every prop owned by a scene. */
  detachScene(scene: SceneId) {
    for (const p of [...this.props.values()]) {
      if (p.owner !== scene || p === this.held) continue;
      this.save(p);
      this.despawn(p);
    }
  }

  private save(p: Prop, removed = false) {
    const t = p.body.translation(), q = p.body.rotation();
    this.run().entities.set(this.key(p.def.id), { def: p.def, owner: p.owner, pos: [t.x, t.y, t.z], quat: [q.x, q.y, q.z, q.w], removed } satisfies Saved);
  }

  spawn(def: PropDef, owner: SceneId, saved?: Saved): Prop {
    let obj: THREE.Object3D;
    let half: THREE.Vector3;
    let mass = def.mass ?? 1;
    let label = def.kind as string;
    if (def.kind === 'relic') {
      const r = relicMesh(def.relicId!, this.mats);
      obj = r.obj; half = r.half;
      mass = RELIC_BY_ID[def.relicId!].weight;
      label = RELIC_BY_ID[def.relicId!].name;
    } else {
      const s = def.size ?? [0.2, 0.2, 0.2];
      half = new THREE.Vector3(...s);
      obj = propMesh(def.kind, half, this.mats);
      if (def.kind === 'rock') label = 'Rock';
      if (def.kind === 'sandbag') label = 'Sandbag';
      if (def.kind === 'block') label = 'Stone block';
      if (def.kind === 'oil') { label = 'Oil flask'; mass = 0.6; half = new THREE.Vector3(0.07, 0.11, 0.07); }
      if (def.kind === 'spare') { label = 'Spare torch'; mass = 0.8; half = new THREE.Vector3(0.3, 0.05, 0.05); }
    }
    const pos = saved?.pos ?? def.pos;
    const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos[0], pos[1], pos[2]).setLinearDamping(0.15).setAngularDamping(0.6).setCcdEnabled(def.kind === 'relic');
    if (saved) bd.setRotation({ x: saved.quat[0], y: saved.quat[1], z: saved.quat[2], w: saved.quat[3] });
    else if (def.rotY) { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, def.rotY, 0)); bd.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }); }
    if (def.sleeping) bd.setSleeping(true);
    const body = this.physics.world.createRigidBody(bd);
    let cd: RAPIER.ColliderDesc;
    if (def.kind === 'rock') cd = RAPIER.ColliderDesc.ball((half.x + half.y + half.z) / 3 * 0.92);
    else cd = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z);
    const vol = def.kind === 'rock' ? (4 / 3) * Math.PI * Math.pow((half.x + half.y + half.z) / 3 * 0.92, 3) : 8 * half.x * half.y * half.z;
    cd.setDensity(mass / Math.max(vol, 1e-4)).setFriction(def.kind === 'block' ? 0.9 : 0.7).setRestitution(0.1);
    const collider = this.physics.world.createCollider(cd, body);
    if (def.kind === 'block') body.setEnabledRotations(false, false, false, true);
    const prop: Prop = { def, body, collider, obj, mass, owner, lastVel: new THREE.Vector3(), label };
    this.physics.tag(collider, { kind: def.kind === 'block' ? 'block' : 'prop', ref: prop });
    this.scene.add(obj);
    this.props.set(def.id, prop);
    this.sync(prop);
    return prop;
  }

  despawn(p: Prop) {
    if (this.held === p) this.held = null;
    this.scene.remove(p.obj);
    this.physics.removeBody(p.body);
    this.props.delete(p.def.id);
  }

  /** Remove for good (taken into the satchel). */
  take(p: Prop) {
    this.save(p, true);
    this.despawn(p);
  }

  /** Spawn a new prop (e.g. a relic dropped from the satchel). */
  drop(def: Omit<PropDef, 'id'>, owner: SceneId, vel?: THREE.Vector3): Prop {
    const id = `drop${++this.dropCounter}_${Date.now() % 100000}`;
    const p = this.spawn({ ...def, id }, owner);
    if (vel) p.body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    this.save(p);
    return p;
  }

  propOf(c: RAPIER.Collider | null | undefined): Prop | null {
    const info = this.physics.infoOf(c);
    return info && (info.kind === 'prop' || info.kind === 'block') ? (info.ref as Prop) : null;
  }

  sync(p: Prop) {
    const t = p.body.translation(), q = p.body.rotation();
    p.obj.position.set(t.x, t.y, t.z);
    p.obj.quaternion.set(q.x, q.y, q.z, q.w);
  }

  /** Sum of prop mass whose centre sits inside the box. */
  massIn(min: THREE.Vector3, max: THREE.Vector3, excludeHeld = true): number {
    let m = 0;
    for (const p of this.props.values()) {
      if (excludeHeld && p === this.held) continue;
      const t = p.body.translation();
      if (t.x >= min.x && t.x <= max.x && t.y >= min.y && t.y <= max.y && t.z >= min.z && t.z <= max.z) m += p.mass;
    }
    return m;
  }

  propsIn(min: THREE.Vector3, max: THREE.Vector3): Prop[] {
    const out: Prop[] = [];
    for (const p of this.props.values()) {
      const t = p.body.translation();
      if (t.x >= min.x && t.x <= max.x && t.y >= min.y && t.y <= max.y && t.z >= min.z && t.z <= max.z) out.push(p);
    }
    return out;
  }

  canLift(p: Prop) { return p.def.kind !== 'block' && p.mass <= 30; }

  grab(p: Prop) {
    if (!this.canLift(p)) return false;
    this.held = p;
    p.body.wakeUp();
    p.body.setGravityScale(0, true);
    return true;
  }

  release(): Prop | null {
    const p = this.held;
    if (!p) return null;
    p.body.setGravityScale(1, true);
    this.held = null;
    return p;
  }

  throwHeld(dir: THREE.Vector3, base: THREE.Vector3) {
    const p = this.release();
    if (!p) return null;
    const sp = Math.max(3, Math.min(14, 14 / Math.sqrt(Math.max(p.mass, 1))));
    p.body.setLinvel({ x: dir.x * sp + base.x, y: dir.y * sp + base.y + 1.5, z: dir.z * sp + base.z }, true);
    p.body.setAngvel({ x: Math.random() * 4 - 2, y: Math.random() * 4 - 2, z: Math.random() * 4 - 2 }, true);
    return p;
  }

  /** Per-frame: carry spring for the held prop, mesh sync, impact detection, fall-out cleanup. */
  update(dt: number, holdTarget: THREE.Vector3) {
    if (this.held) {
      const p = this.held;
      const t = p.body.translation();
      const dx = holdTarget.x - t.x, dy = holdTarget.y - t.y, dz = holdTarget.z - t.z;
      const k = 14 / Math.max(1, Math.sqrt(p.mass) * 0.6);
      let vx = dx * k, vy = dy * k, vz = dz * k;
      const sp = Math.hypot(vx, vy, vz), mx = 12;
      if (sp > mx) { vx *= mx / sp; vy *= mx / sp; vz *= mx / sp; }
      p.body.setLinvel({ x: vx, y: vy, z: vz }, true);
      const av = p.body.angvel();
      p.body.setAngvel({ x: av.x * 0.8, y: av.y * 0.8, z: av.z * 0.8 }, true);
      // dropped automatically if it gets snagged far away
      if (Math.hypot(dx, dy, dz) > 2.5) this.release();
    }
    for (const p of this.props.values()) {
      this.sync(p);
      const v = p.body.linvel();
      const cur = new THREE.Vector3(v.x, v.y, v.z);
      const dv = cur.distanceTo(p.lastVel);
      if (p !== this.held && dv > 3.2 && p.lastVel.length() > 2.5) this.onImpact(p, dv);
      p.lastVel.copy(cur);
      if (p.body.translation().y < -90) { this.save(p, true); this.despawn(p); }
    }
  }

  /** Re-home props to whichever scene they now sit in. */
  rehome(sceneAt: (p: THREE.Vector3) => SceneId | null) {
    for (const p of this.props.values()) {
      const t = p.body.translation();
      const s = sceneAt(new THREE.Vector3(t.x, t.y, t.z));
      if (s) p.owner = s;
    }
  }

  clear() {
    for (const p of [...this.props.values()]) this.despawn(p);
    this.held = null;
  }
}
