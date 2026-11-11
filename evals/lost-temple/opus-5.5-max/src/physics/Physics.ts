/**
 * Rapier wrapper: world, fixed stepping, body-to-mesh sync, owner lookup for colliders,
 * ray and shape queries, and impact events.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { WORLD_GRAVITY, FIXED_DT } from '../config';

export type R = typeof RAPIER;
export { RAPIER };

export interface SyncEntry {
  body: RAPIER.RigidBody;
  obj: THREE.Object3D;
  /** Local offset of the mesh relative to the body (applied in body space). */
  offset?: THREE.Vector3;
}

export interface ColliderOwner {
  kind: string;
  [k: string]: unknown;
}

export interface ImpactEvent {
  collider: RAPIER.Collider;
  other: RAPIER.Collider;
  force: number;
  point: THREE.Vector3;
}

let initPromise: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Physics {
  world: RAPIER.World;
  events: RAPIER.EventQueue;
  private syncs = new Set<SyncEntry>();
  owners = new Map<number, ColliderOwner>();
  onImpact: (e: ImpactEvent) => void = () => {};
  stepTime = 0;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: WORLD_GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    this.world.numSolverIterations = 6;
    this.events = new RAPIER.EventQueue(true);
  }

  get bodyCount(): number {
    let n = 0;
    this.world.forEachRigidBody(() => n++);
    return n;
  }
  get colliderCount(): number {
    let n = 0;
    this.world.forEachCollider(() => n++);
    return n;
  }

  step() {
    const t0 = performance.now();
    this.world.step(this.events);
    this.events.drainContactForceEvents((ev) => {
      const c1 = this.world.getCollider(ev.collider1());
      const c2 = this.world.getCollider(ev.collider2());
      if (!c1 || !c2) return;
      const mag = ev.totalForceMagnitude();
      const p = c1.translation();
      this.onImpact({ collider: c1, other: c2, force: mag, point: new THREE.Vector3(p.x, p.y, p.z) });
    });
    this.events.drainCollisionEvents(() => {});
    this.stepTime = performance.now() - t0;
  }

  addSync(body: RAPIER.RigidBody, obj: THREE.Object3D, offset?: THREE.Vector3): SyncEntry {
    const e: SyncEntry = { body, obj, offset };
    this.syncs.add(e);
    return e;
  }
  removeSync(e: SyncEntry | null | undefined) {
    if (e) this.syncs.delete(e);
  }

  /** Copy body transforms to their meshes. */
  syncMeshes() {
    for (const s of this.syncs) {
      if (!s.body.isValid()) {
        this.syncs.delete(s);
        continue;
      }
      if (s.body.isSleeping() && !s.body.isKinematic()) continue;
      const t = s.body.translation();
      const r = s.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      s.obj.quaternion.copy(_q);
      if (s.offset) {
        _v.copy(s.offset).applyQuaternion(_q);
        s.obj.position.set(t.x + _v.x, t.y + _v.y, t.z + _v.z);
      } else s.obj.position.set(t.x, t.y, t.z);
    }
  }

  setOwner(c: RAPIER.Collider, owner: ColliderOwner) {
    this.owners.set(c.handle, owner);
  }
  ownerOf(c: RAPIER.Collider | null | undefined): ColliderOwner | undefined {
    return c ? this.owners.get(c.handle) : undefined;
  }

  removeBody(b: RAPIER.RigidBody | null | undefined) {
    if (!b || !b.isValid()) return;
    for (let i = 0; i < b.numColliders(); i++) this.owners.delete(b.collider(i).handle);
    this.world.removeRigidBody(b);
  }

  removeCollider(c: RAPIER.Collider | null | undefined) {
    if (!c || !c.isValid()) return;
    this.owners.delete(c.handle);
    this.world.removeCollider(c, true);
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, groups?: number, exclude?: RAPIER.Collider, excludeBody?: RAPIER.RigidBody, predicate?: (c: RAPIER.Collider) => boolean) {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups, exclude, excludeBody, predicate);
    if (!hit) return null;
    const p = ray.pointAt(hit.timeOfImpact);
    return { collider: hit.collider, toi: hit.timeOfImpact, point: new THREE.Vector3(p.x, p.y, p.z), normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) };
  }

  /** True if nothing blocks the segment from a to b (static world only by default). */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3, groups: number): boolean {
    _v.subVectors(b, a);
    const d = _v.length();
    if (d < 1e-4) return true;
    _v.divideScalar(d);
    const ray = new RAPIER.Ray({ x: a.x, y: a.y, z: a.z }, { x: _v.x, y: _v.y, z: _v.z });
    const hit = this.world.castRay(ray, d - 0.05, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups);
    return !hit;
  }

  /** Sweep a small ball along a ray (friendlier aiming for interactions). */
  sphereCast(origin: THREE.Vector3, dir: THREE.Vector3, radius: number, maxDist: number, groups?: number, excludeBody?: RAPIER.RigidBody, predicate?: (c: RAPIER.Collider) => boolean) {
    const shape = new RAPIER.Ball(radius);
    const hit = this.world.castShape(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: dir.x, y: dir.y, z: dir.z },
      shape,
      0,
      maxDist,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups,
      undefined,
      excludeBody,
      predicate,
    );
    if (!hit) return null;
    return { collider: hit.collider, toi: hit.time_of_impact };
  }

  /** Colliders overlapping a box. */
  overlapBox(center: THREE.Vector3, half: THREE.Vector3, rot: THREE.Quaternion | null, groups: number | undefined, cb: (c: RAPIER.Collider) => void, includeSensors = false) {
    const shape = new RAPIER.Cuboid(half.x, half.y, half.z);
    const r = rot ? { x: rot.x, y: rot.y, z: rot.z, w: rot.w } : { x: 0, y: 0, z: 0, w: 1 };
    this.world.intersectionsWithShape(
      { x: center.x, y: center.y, z: center.z },
      r,
      shape,
      (c) => {
        cb(c);
        return true;
      },
      includeSensors ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups,
    );
  }

  overlapBall(center: THREE.Vector3, radius: number, groups: number | undefined, cb: (c: RAPIER.Collider) => void) {
    const shape = new RAPIER.Ball(radius);
    this.world.intersectionsWithShape(
      { x: center.x, y: center.y, z: center.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      (c) => {
        cb(c);
        return true;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups,
    );
  }

  dispose() {
    this.syncs.clear();
    this.owners.clear();
    this.world.free();
    this.events.free();
  }
}
