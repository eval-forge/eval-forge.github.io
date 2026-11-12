import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

/** Collision group bits. */
export const G = {
  STATIC: 1,   // level geometry, doors, kinematic set pieces
  PLAYER: 2,
  SOLID: 4,    // dynamic bodies the player collides with: planks, blocks, boulder, floor tiles
  SMALL: 8,    // loose props the player walks through: rocks, dropped relics, debris
} as const;

export const groups = (membership: number, filter: number) => ((membership << 16) | filter) >>> 0;

export const CG = {
  STATIC: groups(G.STATIC, 0xffff),
  PLAYER: groups(G.PLAYER, G.STATIC | G.SOLID),
  SOLID: groups(G.SOLID, 0xffff),
  SMALL: groups(G.SMALL, G.STATIC | G.SOLID | G.SMALL),
  /** Query filter: only level geometry. */
  Q_STATIC: groups(0xffff, G.STATIC),
  /** Query filter: anything you could stand on. */
  Q_WALK: groups(0xffff, G.STATIC | G.SOLID),
  Q_ALL: groups(0xffff, G.STATIC | G.SOLID | G.SMALL),
};

export const FIXED_DT = 1 / 60;

export interface RayHit { dist: number; point: THREE.Vector3; normal: THREE.Vector3; collider: RAPIER.Collider; }

interface Synced { body: RAPIER.RigidBody; obj: THREE.Object3D; }

export class Physics {
  world!: RAPIER.World;
  private synced: Synced[] = [];
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  static async create(): Promise<Physics> {
    await RAPIER.init();
    const p = new Physics();
    p.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    p.world.timestep = FIXED_DT;
    return p;
  }

  step(): void {
    this.world.step();
  }

  /** Copy dynamic body transforms onto their meshes. */
  syncMeshes(): void {
    for (const s of this.synced) {
      const t = s.body.translation(), r = s.body.rotation();
      s.obj.position.set(t.x, t.y, t.z);
      s.obj.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  addSync(body: RAPIER.RigidBody, obj: THREE.Object3D): void { this.synced.push({ body, obj }); }

  removeSync(body: RAPIER.RigidBody): void {
    const i = this.synced.findIndex((s) => s.body === body);
    if (i >= 0) this.synced.splice(i, 1);
  }

  removeBody(body: RAPIER.RigidBody | null | undefined): void {
    if (!body) return;
    this.removeSync(body);
    if (this.world.bodies.contains(body.handle)) this.world.removeRigidBody(body);
  }

  get bodyCount(): number { return this.world.bodies.len(); }
  get colliderCount(): number { return this.world.colliders.len(); }

  raycast(origin: THREE.Vector3 | { x: number; y: number; z: number }, dir: THREE.Vector3 | { x: number; y: number; z: number },
    maxDist: number, filter: number = CG.Q_STATIC, excludeBody?: RAPIER.RigidBody): RayHit | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, filter, undefined, excludeBody);
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      dist: d,
      point: new THREE.Vector3(origin.x + dir.x * d, origin.y + dir.y * d, origin.z + dir.z * d),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
    };
  }

  /** Clear line between two points against level geometry? */
  lineOfSight(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, filter: number = CG.Q_STATIC): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    this.ray.origin = { x: a.x, y: a.y, z: a.z };
    this.ray.dir = { x: dx / len, y: dy / len, z: dz / len };
    return this.world.castRay(this.ray, len - 0.05, true, undefined, filter) === null;
  }
}
