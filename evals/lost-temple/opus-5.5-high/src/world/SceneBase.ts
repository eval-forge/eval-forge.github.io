import * as THREE from 'three';
import type { SceneId, Zone } from '../logic/economy';
import { rollRelic, SCENE_ZONE } from '../logic/economy';
import { mulberry32, hashString } from '../logic/rng';
import type { SceneCtx, SceneRuntime, Interactable } from '../core/types';
import { LevelBuilder, type AABB } from './LevelBuilder';
import type { PropDef } from '../entities/Props';
import type { Sconce } from '../entities/Torch';
import { SCONCE_BURN } from '../logic/torch';
import type { Physics, RAPIER } from './Physics';
import type { Materials } from './Materials';
import { sconceMesh } from './decor';

export interface SconceSpot { id: string; pos: THREE.Vector3; normal: THREE.Vector3 }

export interface SceneDef {
  id: SceneId;
  name: string;
  zone: Zone;
  bounds: AABB[];
  /** outdoor: sun+sky multiplier, ambient: extra hemisphere factor for roofed areas. */
  exposure(p: THREE.Vector3): { outdoor: number; ambient: number };
  build(b: LevelBuilder): void;
  sconces: SconceSpot[];
  /** Authored props: fixed relics, supplies, rocks, blocks. */
  props(seed: number): PropDef[];
  /** Dynamic entities (traps, doors...). */
  spawn(ctx: SceneCtx, rt: RuntimeKit): void;
  /** Wind strength 0..1 at a point (cliffs). */
  wind?: (p: THREE.Vector3) => number;
}

export const box3 = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB => ({
  min: new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
  max: new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
});

export function inBounds(p: THREE.Vector3, bounds: AABB[]) {
  return bounds.some((b) => p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z);
}

/** Loose relic spawn points → rolled relic props for this run. */
export function looseRelics(scene: SceneId, seed: number, spots: [number, number, number][]): PropDef[] {
  const zone = SCENE_ZONE[scene];
  return spots.map((p, i) => {
    const rand = mulberry32(hashString(`${seed}:${scene}:${i}`));
    const r = rollRelic(rand, zone);
    return { id: `${scene}_loose${i}`, kind: 'relic', relicId: r.id, pos: p, origin: scene, rotY: rand() * 6 } as PropDef;
  });
}

interface Attachable { attach?(): void; detach?(): void; update?(dt: number): void }

/** Helper handed to SceneDef.spawn: registers entities that follow the scene's lifetime. */
export class RuntimeKit implements SceneRuntime {
  interactables: Interactable[] = [];
  private items: Attachable[] = [];
  private updaters: ((dt: number) => void)[] = [];
  private detachers: (() => void)[] = [];
  sconces: Sconce[] = [];
  constructor(public ctx: SceneCtx, public sceneId: SceneId) {}
  add<T extends Attachable>(a: T): T {
    this.items.push(a);
    a.attach?.();
    const i = a as unknown as Partial<Interactable>;
    if (typeof i.prompt === 'function' && typeof i.act === 'function' && i.pos) this.interactables.push(i as Interactable); // levers
    return a;
  }
  every(fn: (dt: number) => void) { this.updaters.push(fn); }
  onDetach(fn: () => void) { this.detachers.push(fn); }
  interact(i: Interactable) { this.interactables.push(i); return i; }
  object(o: THREE.Object3D) { this.ctx.scene.add(o); this.onDetach(() => this.ctx.scene.remove(o)); return o; }
  update(dt: number) { for (const a of this.items) a.update?.(dt); for (const u of this.updaters) u(dt); }
  detach() {
    for (const a of this.items) a.detach?.();
    for (const d of this.detachers) d();
    for (const s of this.sconces) {
      this.ctx.run().entities.set('sconce:' + s.id, { burn: s.burn, at: this.ctx.run().elapsed });
      this.ctx.sconces.unregister(s);
    }
    this.items = []; this.updaters = []; this.detachers = []; this.interactables = []; this.sconces = [];
  }

  /** Make the scene's sconces interactive and restore their burn state. */
  setupSconces(spots: SconceSpot[]) {
    const run = this.ctx.run();
    for (const sp of spots) {
      const saved = run.entities.get('sconce:' + sp.id) as { burn: number; at: number } | undefined;
      const burn = saved ? Math.max(0, saved.burn - (run.elapsed - saved.at)) : 0;
      const s: Sconce = { id: sp.id, pos: sp.pos.clone(), burn };
      this.sconces.push(s);
      this.ctx.sconces.register(s);
      this.interact({
        pos: sp.pos, radius: 2.2,
        prompt: () => {
          if (s.burn > 0) return null;
          return this.ctx.run().spareTorches > 0 ? `E: place a spare torch in the sconce (${this.ctx.run().spareTorches} left)` : 'Empty sconce (no spare torches)';
        },
        act: () => {
          const r = this.ctx.run();
          if (s.burn > 0 || r.spareTorches <= 0) { this.ctx.audio.play('deny'); return; }
          r.spareTorches--;
          s.burn = SCONCE_BURN;
          this.ctx.audio.play('relight', s.pos, 0.8);
          this.ctx.message('Torch placed. It will burn for 5 minutes.');
        },
      });
    }
  }
}

/** Cached static build of a scene. */
export interface BuiltScene {
  group: THREE.Group;
  builder: LevelBuilder;
}

export function buildStatic(def: SceneDef, mats: Materials): BuiltScene {
  const b = new LevelBuilder(mats);
  def.build(b);
  for (const s of def.sconces) sconceMesh(b, s.pos, s.normal);
  const group = b.finalize();
  group.name = def.id;
  return { group, builder: b };
}

export interface AttachedScene { def: SceneDef; built: BuiltScene; body: RAPIER.RigidBody; runtime: RuntimeKit }

export function attachScene(def: SceneDef, built: BuiltScene, ctx: SceneCtx, physics: Physics, seed: number): AttachedScene {
  ctx.scene.add(built.group);
  const body = physics.fixedBody();
  built.builder.createColliders(physics, body, def.id);
  const runtime = new RuntimeKit(ctx, def.id);
  runtime.setupSconces(def.sconces);
  def.spawn(ctx, runtime);
  ctx.props.attachScene(def.id, def.props(seed));
  return { def, built, body, runtime };
}

export function detachScene(a: AttachedScene, ctx: SceneCtx, physics: Physics) {
  a.runtime.detach();
  ctx.props.detachScene(a.def.id);
  physics.removeBody(a.body);
  ctx.scene.remove(a.built.group);
}
