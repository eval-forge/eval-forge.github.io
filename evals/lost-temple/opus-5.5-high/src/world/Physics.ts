import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

export type ColliderKind = 'static' | 'prop' | 'plank' | 'crumble' | 'sunTile' | 'gate' | 'blade' | 'boulder' | 'debris' | 'player' | 'block';

export interface ColliderInfo {
  kind: ColliderKind;
  /** Owning runtime object (Prop, Plank, Tile...). */
  ref?: unknown;
  scene?: string;
}

export interface BoxDesc {
  pos: THREE.Vector3;
  half: THREE.Vector3;
  quat?: THREE.Quaternion;
  friction?: number;
}

export interface RayHit { point: THREE.Vector3; normal: THREE.Vector3; distance: number; collider: RAPIER.Collider; info?: ColliderInfo }

export class Physics {
  world: RAPIER.World;
  info = new Map<number, ColliderInfo>();
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    this.world.timestep = 1 / 60;
  }

  static async init() { await RAPIER.init(); }

  step() { this.world.step(); }

  tag(c: RAPIER.Collider, info: ColliderInfo) { this.info.set(c.handle, info); return c; }
  infoOf(c: RAPIER.Collider | null | undefined): ColliderInfo | undefined { return c ? this.info.get(c.handle) : undefined; }

  fixedBody(): RAPIER.RigidBody {
    return this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  addBox(body: RAPIER.RigidBody, b: BoxDesc, info: ColliderInfo = { kind: 'static' }): RAPIER.Collider {
    const d = RAPIER.ColliderDesc.cuboid(b.half.x, b.half.y, b.half.z)
      .setTranslation(b.pos.x, b.pos.y, b.pos.z)
      .setFriction(b.friction ?? 0.8);
    if (b.quat) d.setRotation({ x: b.quat.x, y: b.quat.y, z: b.quat.z, w: b.quat.w });
    return this.tag(this.world.createCollider(d, body), info);
  }

  removeBody(b: RAPIER.RigidBody | null | undefined) {
    if (!b) return;
    const n = b.numColliders();
    for (let i = 0; i < n; i++) this.info.delete(b.collider(i).handle);
    this.world.removeRigidBody(b);
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, max: number, exclude?: RAPIER.Collider | null, predicate?: (c: RAPIER.Collider) => boolean): RayHit | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(this.ray, max, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, exclude ?? undefined, undefined, predicate);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distance: t,
      collider: hit.collider,
      info: this.info.get(hit.collider.handle),
    };
  }

  /** Fast boolean line-of-sight test against static geometry only. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3, exclude?: RAPIER.Collider | null): boolean {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-3) return true;
    d.divideScalar(len);
    const hit = this.raycast(a, d, len - 0.05, exclude, (c) => {
      const k = this.info.get(c.handle)?.kind;
      return k === 'static' || k === 'gate' || k === 'crumble' || k === 'block';
    });
    return !hit;
  }

  bodyCount(): number { return this.world.bodies.len(); }
  colliderCount(): number { return this.world.colliders.len(); }
}
