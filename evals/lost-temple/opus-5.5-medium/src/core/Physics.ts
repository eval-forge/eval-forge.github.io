import RAPIER from '@dimforge/rapier3d-compat';

export type RapierNS = typeof RAPIER;
export let R: RapierNS = RAPIER;

export async function initRapier(): Promise<void> {
  await RAPIER.init();
  R = RAPIER;
}

export interface ColliderTag {
  kind: 'static' | 'plank' | 'tile' | 'pushable' | 'prop' | 'relic' | 'door' | 'blade' | 'boulder' | 'debris' | 'water' | 'player' | 'gate';
  ref?: unknown;
}

export const STEP = 1 / 60;

export class Physics {
  world: InstanceType<RapierNS['World']>;
  tags = new Map<number, ColliderTag>();
  private acc = 0;
  stepsLastFrame = 0;

  constructor() {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.integrationParameters.numSolverIterations = 6;
  }

  tag(c: RAPIER.Collider, t: ColliderTag) { this.tags.set(c.handle, t); }
  tagOf(c: RAPIER.Collider | null | undefined): ColliderTag | undefined { return c ? this.tags.get(c.handle) : undefined; }

  removeBody(b: RAPIER.RigidBody | null) {
    if (!b) return;
    for (let i = 0; i < b.numColliders(); i++) this.tags.delete(b.collider(i).handle);
    this.world.removeRigidBody(b);
  }

  /** Advance with a fixed step. Returns number of steps taken. */
  step(dt: number, onStep: (h: number) => void): number {
    this.acc = Math.min(this.acc + dt, STEP * 4);
    let n = 0;
    while (this.acc >= STEP) {
      onStep(STEP);
      this.world.step();
      this.acc -= STEP;
      n++;
    }
    this.stepsLastFrame = n;
    return n;
  }

  get alpha() { return this.acc / STEP; }

  bodyCount(): number { return this.world.bodies.len(); }
  colliderCount(): number { return this.world.colliders.len(); }

  /** Raycast; returns distance and collider, excluding a collider (e.g. the player's). */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, exclude?: RAPIER.Collider | null, solid = true): { toi: number; collider: RAPIER.Collider } | null {
    const ray = new R.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRay(ray, max, solid, undefined, undefined, exclude ?? undefined, undefined, (c) => {
      const t = this.tags.get(c.handle);
      return !(t && (t.kind === 'water' || t.kind === 'player'));
    });
    if (!hit) return null;
    return { toi: hit.timeOfImpact, collider: hit.collider };
  }

  rayNormal(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, exclude?: RAPIER.Collider | null) {
    const ray = new R.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRayAndGetNormal(ray, max, true, undefined, undefined, exclude ?? undefined, undefined, (c) => {
      const t = this.tags.get(c.handle);
      return !(t && (t.kind === 'water' || t.kind === 'player'));
    });
    if (!hit) return null;
    return { toi: hit.timeOfImpact, collider: hit.collider, normal: hit.normal };
  }
}
