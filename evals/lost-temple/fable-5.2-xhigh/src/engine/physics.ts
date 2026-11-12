/** Thin wrapper over the Rapier world: groups, queries, and a collider -> owner registry. */
import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3Like } from '../core/scenes';

export { RAPIER };

/** Collision group bits. */
export const G = {
  WORLD: 1,
  PLAYER: 2,
  PROP: 4,
  HELD: 8,
  ROPE: 16,
  GUARDIAN: 32,
  INTERACT: 64,
  /** Carried by every collider's filter so query rays can reach it. Nothing is a member. */
  QUERY: 128,
} as const;

const pack = (member: number, filter: number): number => ((member & 0xffff) << 16) | (filter & 0xffff);

export const GROUPS = {
  world: pack(G.WORLD, G.WORLD | G.PLAYER | G.PROP | G.HELD | G.GUARDIAN | G.QUERY),
  player: pack(G.PLAYER, G.WORLD | G.PROP | G.GUARDIAN),
  prop: pack(G.PROP, G.WORLD | G.PLAYER | G.PROP | G.HELD | G.GUARDIAN | G.QUERY),
  held: pack(G.HELD, G.WORLD | G.PROP | G.QUERY),
  rope: pack(G.ROPE, 0),
  guardian: pack(G.GUARDIAN, G.PLAYER | G.PROP | G.QUERY),
  /** Non-solid things you can look at and press E on. */
  interact: pack(G.INTERACT, G.QUERY),
  /** Debris that should fall through nothing but not shove the player around. */
  debris: pack(G.PROP, G.WORLD | G.PROP | G.QUERY),
};

/** Ray masks: which members a query may hit. */
export const RAY = {
  solidWorld: pack(G.QUERY, G.WORLD),
  sight: pack(G.QUERY, G.WORLD),
  interact: pack(G.QUERY, G.WORLD | G.PROP | G.INTERACT),
  ground: pack(G.QUERY, G.WORLD | G.PROP),
  everything: pack(G.QUERY, G.WORLD | G.PROP | G.INTERACT | G.GUARDIAN),
};

export type Surface = 'stone' | 'wood' | 'dirt' | 'grass' | 'water' | 'metal';

export interface ColliderMeta {
  /** Object that handles E / prompts for this collider. */
  interact?: Interactable;
  surface?: Surface;
  /** Free-form tag: 'block', 'plank', 'prop', 'boulder', 'tile'... */
  kind?: string;
  /** Back-pointer to the owning entity. */
  owner?: unknown;
}

export interface Interactable {
  /** Text for the HUD prompt, or null to hide it. */
  prompt(): string | null;
  interact(): void;
}

export interface RayHit {
  collider: RAPIER.Collider;
  distance: number;
  point: Vec3Like;
  normal: Vec3Like;
  meta: ColliderMeta | undefined;
}

export class Physics {
  readonly world: RAPIER.World;
  private meta = new Map<number, ColliderMeta>();
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  /** Wall-clock milliseconds spent in the last step. */
  stepMs = 0;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    this.world.timestep = 1 / 60;
    this.world.numSolverIterations = 6;
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  get gravity(): number {
    return this.world.gravity.y;
  }

  get bodyCount(): number {
    return this.world.bodies.len();
  }

  get colliderCount(): number {
    return this.world.colliders.len();
  }

  get jointCount(): number {
    return this.world.impulseJoints.len();
  }

  step(): void {
    const t0 = performance.now();
    this.world.step();
    this.stepMs = performance.now() - t0;
  }

  setMeta(collider: RAPIER.Collider, meta: ColliderMeta): void {
    this.meta.set(collider.handle, meta);
  }

  getMeta(collider: RAPIER.Collider | null | undefined): ColliderMeta | undefined {
    return collider ? this.meta.get(collider.handle) : undefined;
  }

  metaOf(handle: number): ColliderMeta | undefined {
    return this.meta.get(handle);
  }

  /** Remove a body with all its colliders and forget their metadata. */
  removeBody(body: RAPIER.RigidBody | null | undefined): void {
    if (!body || !this.world.bodies.contains(body.handle)) return;
    for (let i = 0; i < body.numColliders(); i++) this.meta.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  removeCollider(collider: RAPIER.Collider | null | undefined): void {
    if (!collider || !this.world.colliders.contains(collider.handle)) return;
    this.meta.delete(collider.handle);
    this.world.removeCollider(collider, true);
  }

  removeJoint(joint: RAPIER.ImpulseJoint | null | undefined): void {
    if (!joint || !this.world.impulseJoints.contains(joint.handle)) return;
    this.world.removeImpulseJoint(joint, true);
  }

  /** Cast a ray. `dir` need not be normalised; `maxDist` is in metres. */
  raycast(
    origin: Vec3Like,
    dir: Vec3Like,
    maxDist: number,
    groups: number = RAY.solidWorld,
    excludeBody?: RAPIER.RigidBody,
    includeSensors = false,
  ): RayHit | null {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-9) return null;
    this.ray.origin.x = origin.x;
    this.ray.origin.y = origin.y;
    this.ray.origin.z = origin.z;
    this.ray.dir.x = dir.x / len;
    this.ray.dir.y = dir.y / len;
    this.ray.dir.z = dir.z / len;
    const flags = includeSensors ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, flags, groups, undefined, excludeBody);
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      collider: hit.collider,
      distance: d,
      point: { x: origin.x + this.ray.dir.x * d, y: origin.y + this.ray.dir.y * d, z: origin.z + this.ray.dir.z * d },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      meta: this.meta.get(hit.collider.handle),
    };
  }

  /** Is the straight segment a -> b free of solid world geometry? */
  clearLine(a: Vec3Like, b: Vec3Like, groups: number = RAY.sight): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-4) return true;
    return this.raycast(a, { x: dx, y: dy, z: dz }, dist - 0.05, groups) === null;
  }

  /** Height of the first solid surface below a point, or null. */
  groundBelow(p: Vec3Like, maxDist = 50, groups: number = RAY.solidWorld): number | null {
    const hit = this.raycast(p, { x: 0, y: -1, z: 0 }, maxDist, groups);
    return hit ? hit.point.y : null;
  }
}
