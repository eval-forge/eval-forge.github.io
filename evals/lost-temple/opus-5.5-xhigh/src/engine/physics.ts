/**
 * Rapier wrapper: world setup, collision groups, a tag registry (collider → game object)
 * and query helpers. Scenes create colliders through an `Owner` so they can be removed
 * together when the scene streams out.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

export const GROUP = {
  STATIC: 0x0001,
  PLAYER: 0x0002,
  DYNAMIC: 0x0004,
  GUARDIAN: 0x0008,
  INTERACT: 0x0010,
  HELD: 0x0020,
  DEBRIS: 0x0040,
};

export function groups(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

export const G_STATIC = groups(GROUP.STATIC, 0xffff);
export const G_DYNAMIC = groups(GROUP.DYNAMIC, GROUP.STATIC | GROUP.PLAYER | GROUP.DYNAMIC | GROUP.GUARDIAN | GROUP.HELD | GROUP.DEBRIS);
export const G_DEBRIS = groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.PLAYER | GROUP.DYNAMIC | GROUP.DEBRIS);
export const G_HELD = groups(GROUP.HELD, GROUP.STATIC | GROUP.DYNAMIC | GROUP.GUARDIAN);
export const G_INTERACT = groups(GROUP.INTERACT, GROUP.INTERACT); // sensor; only explicit ray queries (membership 0xffff) see it
export const G_GUARDIAN = groups(GROUP.GUARDIAN, GROUP.PLAYER | GROUP.DYNAMIC | GROUP.HELD);
export const G_PLAYER = groups(GROUP.PLAYER, GROUP.STATIC | GROUP.DYNAMIC | GROUP.GUARDIAN | GROUP.DEBRIS);
/** What the player's character controller collides with. */
export const Q_PLAYER_MOVE = groups(0xffff, GROUP.STATIC | GROUP.DYNAMIC | GROUP.GUARDIAN);
/** Line of sight / sun rays: only solid level geometry and big dynamic things. */
export const Q_SOLID = groups(0xffff, GROUP.STATIC | GROUP.DYNAMIC);
/** Interaction ray: items, interactables and level geometry (to stop through walls). */
export const Q_INTERACT = groups(0xffff, GROUP.STATIC | GROUP.DYNAMIC | GROUP.INTERACT | GROUP.HELD);

export type TagKind =
  | 'static'
  | 'item'
  | 'plank'
  | 'tile'
  | 'block'
  | 'boulder'
  | 'debris'
  | 'guardian'
  | 'interact'
  | 'sunstone'
  | 'blade'
  | 'door';

export interface Tag {
  kind: TagKind;
  ref?: any;
  /** surface for footsteps */
  surface?: 'stone' | 'wood' | 'grass' | 'water' | 'metal';
}

export class Physics {
  world!: RAPIER.World;
  private tags = new Map<number, Tag>();
  ready = false;

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -14, z: 0 });
    this.world.timestep = 1 / 60;
    this.world.numSolverIterations = 6;
    // stiffer joint chains (the rope bridge) for little cost
    this.world.numInternalPgsIterations = 3;
    this.ready = true;
  }

  step() {
    this.world.step();
  }

  tag(c: RAPIER.Collider, t: Tag) {
    this.tags.set(c.handle, t);
  }

  tagOf(c: RAPIER.Collider | null | undefined): Tag | undefined {
    if (!c) return undefined;
    return this.tags.get(c.handle);
  }

  untag(c: RAPIER.Collider) {
    this.tags.delete(c.handle);
  }

  bodyCount(): number {
    return this.world.bodies.len();
  }

  colliderCount(): number {
    return this.world.colliders.len();
  }

  /** Ray cast; returns distance, point, normal and the collider. */
  ray(
    from: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    filterGroups = Q_SOLID,
    exclude?: RAPIER.Collider | null,
    excludeBody?: RAPIER.RigidBody | null,
    predicate?: (c: RAPIER.Collider) => boolean,
    includeSensors = false,
  ): { toi: number; point: THREE.Vector3; normal: THREE.Vector3; collider: RAPIER.Collider } | null {
    const r = new RAPIER.Ray({ x: from.x, y: from.y, z: from.z }, { x: dir.x, y: dir.y, z: dir.z });
    const flags = includeSensors ? (0 as RAPIER.QueryFilterFlags) : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const hit = this.world.castRayAndGetNormal(r, maxDist, true, flags, filterGroups, exclude ?? undefined, excludeBody ?? undefined, predicate);
    if (!hit) return null;
    const p = r.pointAt(hit.timeOfImpact);
    return {
      toi: hit.timeOfImpact,
      point: new THREE.Vector3(p.x, p.y, p.z),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
    };
  }

  /** True if nothing solid blocks the segment a→b. */
  clearLine(a: THREE.Vector3, b: THREE.Vector3, filterGroups = Q_SOLID, exclude?: RAPIER.Collider | null, excludeBody?: RAPIER.RigidBody | null): boolean {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return true;
    d.divideScalar(len);
    const hit = this.ray(a, d, len - 0.05, filterGroups, exclude, excludeBody);
    return !hit;
  }

  /** Sum the masses of dynamic bodies whose colliders overlap a box. */
  massInBox(center: THREE.Vector3, half: THREE.Vector3, exclude?: Set<number>): { mass: number; bodies: RAPIER.RigidBody[] } {
    const shape = new RAPIER.Cuboid(half.x, half.y, half.z);
    const seen = new Set<number>();
    const bodies: RAPIER.RigidBody[] = [];
    let mass = 0;
    this.world.intersectionsWithShape(
      { x: center.x, y: center.y, z: center.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      (c) => {
        const b = c.parent();
        if (b && b.isDynamic() && !seen.has(b.handle) && !(exclude && exclude.has(b.handle))) {
          seen.add(b.handle);
          bodies.push(b);
          mass += b.mass();
        }
        return true;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(0xffff, GROUP.DYNAMIC | GROUP.DEBRIS | GROUP.HELD),
    );
    return { mass, bodies };
  }
}

/** Groups colliders/bodies/joints created by one scene so they can be removed together. */
export class Owner {
  colliders: RAPIER.Collider[] = [];
  bodies: RAPIER.RigidBody[] = [];

  constructor(public physics: Physics, public name: string) {}

  get world() {
    return this.physics.world;
  }

  staticBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, tag: Tag = { kind: 'static' }, rot?: THREE.Quaternion, friction = 0.8): RAPIER.Collider {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setCollisionGroups(G_STATIC).setFriction(friction);
    if (rot) d.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    const c = this.world.createCollider(d);
    this.colliders.push(c);
    this.physics.tag(c, tag);
    return c;
  }

  staticCylinder(cx: number, cy: number, cz: number, halfH: number, r: number, tag: Tag = { kind: 'static' }, rot?: THREE.Quaternion): RAPIER.Collider {
    const d = RAPIER.ColliderDesc.cylinder(halfH, r).setTranslation(cx, cy, cz).setCollisionGroups(G_STATIC);
    if (rot) d.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    const c = this.world.createCollider(d);
    this.colliders.push(c);
    this.physics.tag(c, tag);
    return c;
  }

  /** Interaction-only box (hit only by the interaction ray). */
  interactBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, ref: any): RAPIER.Collider {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setCollisionGroups(G_INTERACT).setSensor(true);
    const c = this.world.createCollider(d);
    this.colliders.push(c);
    this.physics.tag(c, { kind: 'interact', ref });
    return c;
  }

  heightfield(nrows: number, ncols: number, heights: Float32Array, scale: { x: number; y: number; z: number }, cx: number, cz: number, tag: Tag): RAPIER.Collider {
    const d = RAPIER.ColliderDesc.heightfield(nrows, ncols, heights, scale).setTranslation(cx, 0, cz).setCollisionGroups(G_STATIC).setFriction(0.9);
    const c = this.world.createCollider(d);
    this.colliders.push(c);
    this.physics.tag(c, tag);
    return c;
  }

  body(desc: RAPIER.RigidBodyDesc): RAPIER.RigidBody {
    const b = this.world.createRigidBody(desc);
    this.bodies.push(b);
    return b;
  }

  collider(desc: RAPIER.ColliderDesc, parent?: RAPIER.RigidBody, tag?: Tag): RAPIER.Collider {
    const c = this.world.createCollider(desc, parent);
    this.colliders.push(c);
    if (tag) this.physics.tag(c, tag);
    return c;
  }

  removeBody(b: RAPIER.RigidBody) {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
    for (let k = 0; k < b.numColliders(); k++) {
      const c = b.collider(k);
      this.physics.untag(c);
      const ci = this.colliders.indexOf(c);
      if (ci >= 0) this.colliders.splice(ci, 1);
    }
    this.world.removeRigidBody(b);
  }

  removeCollider(c: RAPIER.Collider) {
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
    this.physics.untag(c);
    this.world.removeCollider(c, true);
  }

  /** Remove everything this owner created. */
  dispose() {
    for (const c of this.colliders) this.physics.untag(c);
    for (const b of this.bodies) {
      if (this.world.bodies.contains(b.handle)) this.world.removeRigidBody(b);
    }
    for (const c of this.colliders) {
      if (this.world.colliders.contains(c.handle)) this.world.removeCollider(c, false);
    }
    this.bodies = [];
    this.colliders = [];
  }
}
