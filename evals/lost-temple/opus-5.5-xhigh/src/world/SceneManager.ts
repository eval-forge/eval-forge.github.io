/**
 * Scene streaming. The current scene and its graph neighbours stay loaded; everything
 * else is unloaded (its dynamic state lives in RunState). Scene builders are generators
 * resumed under a per-frame time budget so neighbours appear without a hitch.
 */
import * as THREE from 'three';
import { Owner } from '../engine/physics';
import { sceneAt, REGIONS, type VineDef } from './layout';
import { streamingSet, SCENE_ORDER, type SceneId } from '../logic/unlocks';
import { disposeGroup } from './build';
import type { WaterVolume } from '../entities/Player';
import type { Game } from '../game/Game';

export interface SceneHandle {
  id: SceneId;
  group: THREE.Group;
  owner: Owner;
  update: ((dt: number, time: number) => void)[];
  fixed: ((dt: number) => void)[];
  dispose: (() => void)[];
  waters: WaterVolume[];
  vines: VineDef[];
  /** Wind volumes: strength 0..1 and direction. */
  winds: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; dir: [number, number]; strength: number }[];
  ready: boolean;
}

export interface SceneDef {
  id: SceneId;
  build(game: Game, h: SceneHandle): Generator<void, void, void>;
}

interface Pending {
  h: SceneHandle;
  gen: Generator<void, void, void>;
}

export class SceneManager {
  loaded = new Map<SceneId, SceneHandle>();
  private pending: Pending[] = [];
  private away = new Map<SceneId, number>();
  current: SceneId = 'jungle';
  budgetMs = 5;
  lastBuildMs = 0;

  constructor(private game: Game, private defs: Record<SceneId, SceneDef>) {}

  isLoaded(id: SceneId) {
    const h = this.loaded.get(id);
    return !!h && h.ready;
  }

  handles(): SceneHandle[] {
    return [...this.loaded.values()].filter((h) => h.ready);
  }

  private start(id: SceneId): Pending {
    const h: SceneHandle = {
      id,
      group: new THREE.Group(),
      owner: new Owner(this.game.physics, id),
      update: [],
      fixed: [],
      dispose: [],
      waters: [],
      vines: [],
      winds: [],
      ready: false,
    };
    h.group.name = 'scene:' + id;
    this.game.scene.add(h.group);
    this.loaded.set(id, h);
    const p = { h, gen: this.defs[id].build(this.game, h) };
    this.pending.push(p);
    return p;
  }

  private finish(p: Pending) {
    p.h.ready = true;
    this.pending.splice(this.pending.indexOf(p), 1);
    this.game.items.loadScene(p.h.id);
    this.game.onSceneLoaded(p.h);
  }

  /** Run a pending build to completion right now. */
  private complete(p: Pending) {
    for (;;) {
      const r = p.gen.next();
      if (r.done) break;
    }
    this.finish(p);
  }

  unload(id: SceneId) {
    const h = this.loaded.get(id);
    if (!h) return;
    const pi = this.pending.findIndex((p) => p.h === h);
    if (pi >= 0) this.pending.splice(pi, 1);
    if (h.ready) this.game.items.unloadScene(id);
    for (const d of h.dispose) d();
    const region = REGIONS.find((r) => r.scene === id);
    if (region) this.game.fx.clearDebrisIn((x, y, z) => sceneAt(x, y, z) === id);
    h.owner.dispose();
    this.game.scene.remove(h.group);
    disposeGroup(h.group);
    this.loaded.delete(id);
    this.away.delete(id);
  }

  unloadAll() {
    for (const id of [...this.loaded.keys()]) this.unload(id);
    this.pending = [];
  }

  /** Load a set of scenes synchronously (run start / warp). */
  loadSync(ids: Iterable<SceneId>) {
    for (const id of ids) {
      let p = this.pending.find((x) => x.h.id === id);
      if (!p && !this.loaded.has(id)) p = this.start(id);
      if (p) this.complete(p);
    }
  }

  setCurrent(id: SceneId) {
    this.current = id;
  }

  update(dt: number, pos: THREE.Vector3) {
    const s = sceneAt(pos.x, pos.y, pos.z);
    if (s && s !== this.current) {
      this.current = s;
      this.game.onSceneChanged(s);
    }
    const want = streamingSet(this.current);
    for (const id of SCENE_ORDER) {
      if (want.has(id)) {
        this.away.delete(id);
        if (!this.loaded.has(id)) this.start(id);
      } else if (this.loaded.has(id)) {
        const t = (this.away.get(id) ?? 0) + dt;
        this.away.set(id, t);
        if (t > 2.5) this.unload(id);
      }
    }
    // the scene you're standing in must exist now
    const cur = this.pending.find((p) => p.h.id === this.current);
    if (cur) this.complete(cur);
    // stream the rest under a time budget
    const t0 = performance.now();
    while (this.pending.length && performance.now() - t0 < this.budgetMs) {
      const p = this.pending[0];
      const r = p.gen.next();
      if (r.done) this.finish(p);
    }
    this.lastBuildMs = performance.now() - t0;
  }

  get pendingCount() {
    return this.pending.length;
  }
}
