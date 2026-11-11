/**
 * Scene definitions and the per-scene runtime that a loaded scene owns.
 */
import * as THREE from 'three';
import { RAPIER, type Physics } from '../physics/Physics';
import { GROUP_STATIC } from '../config';
import type { Materials } from '../render/materials';
import type { SceneId, Flag } from '../logic/unlocks';
import type { Zone } from '../logic/economy';
import type { NoiseSource } from '../logic/noise';
import type { NavMesh } from '../logic/navmesh';
import type { Quality } from '../logic/save';
import type { RunState, EndReason } from '../game/RunState';
import type { LevelBuilder } from './LevelBuilder';
import type { Climbable, WaterVolume, KillVolume, WindZone, Interactable, Prop } from './types';
import type { Sfx } from '../audio/Sfx';
import type { Particles } from '../render/particles';
import type { RelicManager } from './RelicManager';
import type { Player } from '../entities/Player';
import type { Vegetation } from '../render/vegetation';
import type { RelicModels } from '../render/relicMeshes';

export type SceneEnv = 'outdoor' | 'interior' | 'dark';

export interface SceneDef {
  id: SceneId;
  zone: Zone;
  env: SceneEnv;
  /** Membership volumes; the first scene (in priority order) containing the camera wins. */
  boxes: THREE.Box3[];
  /** Static layout. Must be deterministic: it also runs in nav-only mode. */
  layout(b: LevelBuilder): void;
  /** Dynamic props, relics, traps. May yield to spread work over frames. */
  props?(ctx: SceneCtx, rt: SceneRuntime): Generator<void, void, void> | void;
  /** Guardian spawn points by id. */
  spawns?: Record<string, [number, number, number]>;
  /** Map drawing: rectangles of walkable space for the hand-drawn map. */
  mapRects?: [number, number, number, number][];
  /** Respawn point after being washed away / falling (scene-local). */
  respawn?: [number, number, number];
}

/** Services the game offers to scenes and props. */
export interface SceneCtx {
  physics: Physics;
  mats: Materials;
  run: RunState;
  sfx: Sfx;
  fx: Particles;
  relics: RelicManager;
  nav: NavMesh;
  quality: Quality;
  veg: Vegetation;
  models: RelicModels;
  root: THREE.Scene;
  player(): Player;
  noise(pos: THREE.Vector3, loudness: number, source: NoiseSource, byPlayer?: boolean): void;
  damage(amount: number, cause: string, reason?: EndReason): void;
  toast(text: string, kind?: ToastKind): void;
  shake(amount: number): void;
  /** Unit vector toward the sun (or moon at night). */
  sunDir: THREE.Vector3;
  /** True while the real sun is above the horizon and it is not yet dark. */
  sunUp(): boolean;
  /** Is this point in direct sunlight (ray toward the sun reaches the sky)? */
  litBySun(p: THREE.Vector3): boolean;
  setFlag(f: Flag): void;
  time(): number;
  /** Mark that the player did something worth remembering on the map. */
  mapMark(x: number, z: number, label: string): void;
  /** Haul cart: move everything carried into the cart. Returns the value banked. */
  bankAll(): number;
  /** Haul cart: end the run here, outside, with the banked loot. */
  leaveTemple(): void;
  /** Relics in the satchel plus the one in hand. */
  carriedCount(): number;
  /** Wake a dormant guardian standing at a spawn point right now (vault statue). */
  wakeEarly(spawn: string): void;
  /** True while the camera is in a zone C scene: nothing but fire may be visible then. */
  cameraDark(): boolean;
}

export type ToastKind = 'info' | 'good' | 'bad' | 'key' | 'warn';

export class SceneRuntime {
  group = new THREE.Group();
  body: RAPIER.RigidBody;
  props: Prop[] = [];
  interactables: Interactable[] = [];
  climbables: Climbable[] = [];
  waters: WaterVolume[] = [];
  kills: KillVolume[] = [];
  winds: WindZone[] = [];
  ready = false;
  private disposers: (() => void)[] = [];
  private bodies: RAPIER.RigidBody[] = [];

  constructor(public def: SceneDef, private physics: Physics) {
    this.group.name = 'scene:' + def.id;
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  addProp<T extends Prop>(p: T): T {
    this.props.push(p);
    return p;
  }
  addInteract(i: Interactable): Interactable {
    this.interactables.push(i);
    return i;
  }
  removeInteract(i: Interactable) {
    const k = this.interactables.indexOf(i);
    if (k >= 0) this.interactables.splice(k, 1);
  }
  /** Track a body so it is removed when the scene unloads. */
  trackBody(b: RAPIER.RigidBody): RAPIER.RigidBody {
    this.bodies.push(b);
    return b;
  }
  onDispose(fn: () => void) {
    this.disposers.push(fn);
  }
  /** Static cylinder collider for a tree trunk (vegetation is instanced, colliders are not). */
  addTreeCollider(ctx: SceneCtx, x: number, y: number, z: number, r: number, h: number) {
    ctx.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(x, y + h / 2, z).setCollisionGroups(GROUP_STATIC), this.body);
  }
  findProp<T extends Prop>(id: string): T | undefined {
    return this.props.find((p) => p.id === id) as T | undefined;
  }

  /** Copy builder volumes into the runtime. */
  adopt(b: LevelBuilder) {
    this.climbables.push(...b.climbables);
    this.waters.push(...b.waters);
    this.kills.push(...b.kills);
    this.winds.push(...b.winds);
  }

  dispose() {
    for (const p of this.props) {
      try {
        p.dispose();
      } catch (e) {
        console.warn('prop dispose', e);
      }
    }
    for (const fn of this.disposers) fn();
    for (const b of this.bodies) this.physics.removeBody(b);
    this.physics.removeBody(this.body);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !(m.userData.sharedGeo)) m.geometry.dispose();
    });
    this.group.removeFromParent();
    this.props = [];
    this.interactables = [];
  }
}

/** Small helper: a Box3 from min/max arrays. */
export function box3(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
}
