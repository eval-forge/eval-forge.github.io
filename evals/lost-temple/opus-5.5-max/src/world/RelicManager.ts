/**
 * Relics and other loose objects (sandbags, pots). Records persist for the whole run; physics
 * bodies exist only while their scene is loaded or while the player holds them.
 */
import * as THREE from 'three';
import { RAPIER, type Physics } from '../physics/Physics';
import { GROUP_PROP } from '../config';
import type { SceneId } from '../logic/unlocks';
import { RELICS, makeRelic, rollCondition, rollRelicType, type RelicId, type RelicInstance, type Zone, type Rarity } from '../logic/economy';
import { Rng, hashString } from '../logic/rng';
import type { RelicModels, ModelId } from '../render/relicMeshes';

export type RecordState = 'world' | 'satchel' | 'banked' | 'held' | 'lost';

export interface RelicRecord {
  uid: string;
  inst: RelicInstance | null; // null for counterweights
  model: ModelId;
  mass: number;
  state: RecordState;
  scene: SceneId;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Last place it rested, for rescue if it falls out of the world. */
  safePos: THREE.Vector3;
  label: string;
}

export interface LiveObject {
  rec: RelicRecord;
  body: RAPIER.RigidBody;
  obj: THREE.Object3D;
}

export interface SpawnOpts {
  type?: RelicId;
  minRarity?: Rarity;
  maxRarity?: Rarity;
  rotY?: number;
}

const _q = new THREE.Quaternion();

export class RelicManager {
  records = new Map<string, RelicRecord>();
  live = new Map<string, LiveObject>();
  private byHandle = new Map<number, LiveObject>();
  group = new THREE.Group();
  /** Callback to find which scene a point is in. */
  sceneAt: (p: THREE.Vector3) => SceneId | null = () => null;
  onLost: (rec: RelicRecord) => void = () => {};
  /** Called whenever a body is created for a record (the game styles zone C objects). */
  onSpawn: (live: LiveObject) => void = () => {};

  constructor(private physics: Physics, private models: RelicModels, private seed: number) {
    this.group.name = 'relics';
  }

  /** Create (once per run) a relic record at a spawn point. */
  relicSpawn(id: string, scene: SceneId, zone: Zone, pos: [number, number, number], o: SpawnOpts = {}): RelicRecord {
    const existing = this.records.get(id);
    if (existing) return existing;
    const rng = new Rng(hashString(`${this.seed}:${id}`));
    const type = o.type ?? rollRelicType(zone, rng, o.minRarity ?? 'common', o.maxRarity ?? 'legendary');
    const inst = makeRelic(id, type, zone, rollCondition(rng));
    const half = this.models.half(type);
    const p = new THREE.Vector3(pos[0], pos[1] + half[1] + 0.01, pos[2]);
    const rec: RelicRecord = {
      uid: id,
      inst,
      model: type,
      mass: inst.weight,
      state: 'world',
      scene,
      pos: p,
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, o.rotY ?? rng.next() * Math.PI * 2, 0)),
      safePos: p.clone(),
      label: RELICS[type].name,
    };
    this.records.set(id, rec);
    return rec;
  }

  /** A counterweight (sandbag, pot): can be carried and placed, not stashed. */
  weightSpawn(id: string, scene: SceneId, model: ModelId, mass: number, pos: [number, number, number], rotY = 0): RelicRecord {
    const existing = this.records.get(id);
    if (existing) return existing;
    const half = this.models.half(model);
    const p = new THREE.Vector3(pos[0], pos[1] + half[1] + 0.01, pos[2]);
    const rec: RelicRecord = {
      uid: id,
      inst: null,
      model,
      mass,
      state: 'world',
      scene,
      pos: p,
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
      safePos: p.clone(),
      label: model === 'pot' ? `Clay pot (${mass} kg)` : `Sandbag (${mass} kg)`,
    };
    this.records.set(id, rec);
    return rec;
  }

  private spawnBody(rec: RelicRecord): LiveObject {
    const half = this.models.half(rec.model);
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(rec.pos.x, rec.pos.y, rec.pos.z)
      .setRotation({ x: rec.quat.x, y: rec.quat.y, z: rec.quat.z, w: rec.quat.w })
      .setCcdEnabled(true)
      .setLinearDamping(0.05)
      .setAngularDamping(0.5)
      .setCanSleep(true);
    const body = this.physics.world.createRigidBody(bd);
    const cd = RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2])
      .setMass(rec.mass)
      .setFriction(0.8)
      .setRestitution(0.05)
      .setCollisionGroups(GROUP_PROP)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(Math.max(60, rec.mass * 70));
    const col = this.physics.world.createCollider(cd, body);
    this.physics.setOwner(col, { kind: rec.inst ? 'relic' : 'weight', uid: rec.uid, surface: rec.inst ? 'metal' : 'sand' });
    const obj = this.models.make(rec.model);
    obj.position.copy(rec.pos);
    obj.quaternion.copy(rec.quat);
    this.group.add(obj);
    const live: LiveObject = { rec, body, obj };
    this.physics.addSync(body, obj);
    this.live.set(rec.uid, live);
    this.byHandle.set(body.handle, live);
    this.onSpawn(live);
    return live;
  }

  private despawn(live: LiveObject) {
    const t = live.body.translation();
    const r = live.body.rotation();
    live.rec.pos.set(t.x, t.y, t.z);
    live.rec.quat.set(r.x, r.y, r.z, r.w);
    this.physics.removeBody(live.body);
    live.obj.removeFromParent();
    this.live.delete(live.rec.uid);
    this.byHandle.delete(live.body.handle);
  }

  loadScene(scene: SceneId) {
    for (const rec of this.records.values()) {
      if (rec.state === 'world' && rec.scene === scene && !this.live.has(rec.uid)) this.spawnBody(rec);
    }
  }

  unloadScene(scene: SceneId) {
    for (const live of [...this.live.values()]) {
      if (live.rec.state === 'world' && live.rec.scene === scene) this.despawn(live);
    }
  }

  ofBody(b: RAPIER.RigidBody | null | undefined): LiveObject | undefined {
    return b ? this.byHandle.get(b.handle) : undefined;
  }

  /** Remove from the world into the satchel (caller checks capacity). */
  stash(uid: string) {
    const live = this.live.get(uid);
    if (live) this.despawn(live);
    const rec = this.records.get(uid);
    if (rec) rec.state = 'satchel';
  }

  /** Take an object out of the satchel into the world at a position (to be grabbed). */
  pull(uid: string, pos: THREE.Vector3, scene: SceneId): LiveObject | null {
    const rec = this.records.get(uid);
    if (!rec) return null;
    rec.state = 'held';
    rec.scene = scene;
    rec.pos.copy(pos);
    rec.safePos.copy(pos);
    return this.spawnBody(rec);
  }

  setHeld(uid: string, held: boolean) {
    const rec = this.records.get(uid);
    if (!rec) return;
    if (held) rec.state = 'held';
    else if (rec.state === 'held') rec.state = 'world';
  }

  bank(uid: string) {
    const rec = this.records.get(uid);
    if (rec) rec.state = 'banked';
  }

  /** Remove a live object entirely (stashed into the cart from the hands, etc). */
  removeLive(uid: string) {
    const live = this.live.get(uid);
    if (live) this.despawn(live);
  }

  /** Track which scene each moving object is in; rescue objects that fall out of the world. */
  fixedUpdate() {
    for (const live of this.live.values()) {
      const b = live.body;
      if (b.isSleeping()) continue;
      const t = b.translation();
      const p = new THREE.Vector3(t.x, t.y, t.z);
      const v = b.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (live.rec.state === 'world') {
        const s = this.sceneAt(p);
        if (s) live.rec.scene = s;
        if (speed < 0.2) live.rec.safePos.copy(p);
      }
      if (t.y < -70) {
        if (live.rec.inst && live.rec.state !== 'held') {
          // lost into the abyss
          live.rec.state = 'lost';
          this.despawn(live);
          this.onLost(live.rec);
          return;
        }
        b.setTranslation({ x: live.rec.safePos.x, y: live.rec.safePos.y + 0.3, z: live.rec.safePos.z }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  /** Total mass of world objects whose centres lie in a box (for plates and pedestals). */
  massInBox(min: THREE.Vector3, max: THREE.Vector3, exceptHeld = true): number {
    let m = 0;
    for (const live of this.live.values()) {
      if (exceptHeld && live.rec.state === 'held') continue;
      const t = live.body.translation();
      if (t.x >= min.x && t.x <= max.x && t.y >= min.y && t.y <= max.y && t.z >= min.z && t.z <= max.z) m += live.rec.mass;
    }
    return m;
  }

  heldRecords(): RelicRecord[] {
    return [...this.records.values()].filter((r) => r.state === 'held');
  }

  dispose() {
    for (const live of [...this.live.values()]) this.despawn(live);
    this.group.removeFromParent();
    this.records.clear();
  }

  /** For tests/debug: a world-space quaternion from yaw. */
  static yaw(y: number) {
    return _q.setFromEuler(new THREE.Euler(0, y, 0)).clone();
  }
}
