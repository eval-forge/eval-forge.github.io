/**
 * Streams scenes in and out around the player: the scene you are in plus every scene physically
 * next to it stay loaded. Builds are generators advanced under a per-frame time budget, so a
 * neighbour appears over a few frames while you walk toward it; leaving a neighbourhood starts
 * a grace timer before the scene is disposed. Prop state lives in RunState, so nothing resets
 * when you walk back. The guardians' navmesh does not stream: it is built once per run.
 */
import type * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import type { Materials } from '../render/materials';
import { LevelBuilder } from './LevelBuilder';
import { SceneRuntime, type SceneCtx } from './SceneDef';
import { SCENES, NAV_SCENES, sceneAt } from './scenes';
import { physicalNeighbours, type SceneId } from '../logic/unlocks';
import { buildNavPolys, type WalkRect, type ObstacleBox, type RampRect } from '../logic/navbuild';
import { NavMesh } from '../logic/navmesh';
import type { Climbable, Interactable, KillVolume, WaterVolume, WindZone, Prop } from './types';
import type { NoiseEvent } from '../logic/noise';

const UNLOAD_GRACE = 4;

interface Job {
  id: SceneId;
  gen: Generator<void, void, void>;
}

export class SceneManager {
  runtimes = new Map<SceneId, SceneRuntime>();
  current: SceneId | null = null;
  climbables: Climbable[] = [];
  waters: WaterVolume[] = [];
  kills: KillVolume[] = [];
  winds: WindZone[] = [];
  /** Milliseconds spent building this frame (debug overlay). */
  buildMs = 0;
  onEnter: (id: SceneId, prev: SceneId | null) => void = () => {};
  private jobs: Job[] = [];
  private grace = new Map<SceneId, number>();
  private darkCtxObj: SceneCtx | null = null;

  constructor(private ctx: SceneCtx, private physics: Physics, private mats: Materials, private root: THREE.Scene) {}

  /** The whole temple's navmesh from nav-only layout passes (no meshes, no colliders). */
  static buildNav(): NavMesh {
    const walks: WalkRect[] = [];
    const obstacles: ObstacleBox[] = [];
    const ramps: RampRect[] = [];
    for (const id of NAV_SCENES) {
      const b = new LevelBuilder(null, id, true);
      SCENES[id].layout(b);
      walks.push(...b.navWalks);
      obstacles.push(...b.navObstacles);
      ramps.push(...b.navRamps);
    }
    return new NavMesh(buildNavPolys(walks, obstacles, ramps));
  }

  /** Scene context handed to dark (zone C) scenes: same services, zone C materials. */
  ctxFor(id: SceneId): SceneCtx {
    if (SCENES[id].env !== 'dark') return this.ctx;
    if (!this.darkCtxObj) {
      const c = Object.create(this.ctx) as SceneCtx;
      c.mats = this.mats.darkView;
      this.darkCtxObj = c;
    }
    return this.darkCtxObj;
  }

  isReady(id: SceneId): boolean {
    return !!this.runtimes.get(id)?.ready;
  }

  get loadedIds(): SceneId[] {
    return [...this.runtimes.keys()];
  }

  get pending(): number {
    return this.jobs.length;
  }

  load(id: SceneId) {
    if (this.runtimes.has(id)) return;
    const rt = new SceneRuntime(SCENES[id], this.physics);
    rt.group.visible = false;
    this.root.add(rt.group);
    this.runtimes.set(id, rt);
    this.jobs.push({ id, gen: this.build(id, rt) });
  }

  private *build(id: SceneId, rt: SceneRuntime): Generator<void, void, void> {
    const def = SCENES[id];
    const sctx = this.ctxFor(id);
    const b = new LevelBuilder({ physics: this.physics, mats: sctx.mats }, id);
    def.layout(b);
    yield;
    yield* b.finish(rt.group, rt.body);
    rt.adopt(b);
    rt.group.visible = true;
    yield;
    const p = def.props?.(sctx, rt);
    if (p) yield* p;
    this.ctx.relics.loadScene(id);
    rt.ready = true;
  }

  unload(id: SceneId) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    const job = this.jobs.find((j) => j.id === id);
    if (job) {
      job.gen.return();
      this.jobs = this.jobs.filter((j) => j !== job);
    }
    this.ctx.relics.unloadScene(id);
    rt.dispose();
    this.runtimes.delete(id);
    this.refresh();
  }

  unloadAll() {
    for (const id of [...this.runtimes.keys()]) this.unload(id);
    this.current = null;
    this.grace.clear();
    this.darkCtxObj = null;
  }

  /** Track the player's scene, keep its neighbourhood loaded, advance builds. */
  update(pos: THREE.Vector3, dt: number, budgetMs: number) {
    const id = sceneAt(pos, this.current);
    if (id && id !== this.current) {
      const prev = this.current;
      this.current = id;
      this.onEnter(id, prev);
    }
    if (this.current) {
      const want = new Set<SceneId>([this.current, ...physicalNeighbours(this.current)]);
      for (const w of want) {
        this.load(w);
        this.grace.delete(w);
      }
      for (const rid of [...this.runtimes.keys()]) {
        if (want.has(rid)) continue;
        const t = (this.grace.get(rid) ?? 0) + dt;
        if (t >= UNLOAD_GRACE) {
          this.grace.delete(rid);
          this.unload(rid);
        } else this.grace.set(rid, t);
      }
    }
    this.pump(budgetMs);
  }

  /** Run pending builds for up to `budgetMs` (the current scene first). */
  pump(budgetMs: number) {
    const t0 = performance.now();
    if (this.jobs.length > 1) {
      const cur = this.current;
      this.jobs.sort((a, b) => Number(b.id === cur) - Number(a.id === cur));
    }
    while (this.jobs.length) {
      const job = this.jobs[0];
      const r = job.gen.next();
      if (r.done) {
        this.jobs.shift();
        this.refresh();
      }
      if (performance.now() - t0 >= budgetMs) break;
    }
    this.buildMs = performance.now() - t0;
  }

  finishAll() {
    this.pump(Infinity);
  }

  /** Rebuild the merged volume lists after a scene finishes building or unloads. */
  private refresh() {
    this.climbables = [];
    this.waters = [];
    this.kills = [];
    this.winds = [];
    for (const rt of this.runtimes.values()) {
      this.climbables.push(...rt.climbables);
      this.waters.push(...rt.waters);
      this.kills.push(...rt.kills);
      this.winds.push(...rt.winds);
    }
  }

  forEachInteractable(fn: (i: Interactable) => void) {
    for (const rt of this.runtimes.values()) if (rt.ready) for (const i of rt.interactables) fn(i);
  }

  forEachProp(fn: (p: Prop) => void) {
    for (const rt of this.runtimes.values()) if (rt.ready) for (const p of rt.props) fn(p);
  }

  findProp<T extends Prop>(id: string): T | undefined {
    for (const rt of this.runtimes.values()) {
      const p = rt.findProp<T>(id);
      if (p) return p;
    }
    return undefined;
  }

  fixedUpdate(dt: number) {
    for (const rt of this.runtimes.values()) {
      if (!rt.ready) continue;
      for (const p of rt.props) {
        if (!p.fixedUpdate) continue;
        try {
          p.fixedUpdate(dt);
        } catch (e) {
          console.error('prop fixedUpdate', p.id, e);
        }
      }
    }
  }

  frameUpdate(dt: number) {
    for (const rt of this.runtimes.values()) {
      if (!rt.ready) continue;
      for (const p of rt.props) {
        if (!p.update) continue;
        try {
          p.update(dt);
        } catch (e) {
          console.error('prop update', p.id, e);
        }
      }
    }
  }

  noise(ev: NoiseEvent) {
    for (const rt of this.runtimes.values()) {
      if (!rt.ready) continue;
      for (const p of rt.props) p.onNoise?.(ev);
    }
  }

  get propCount(): number {
    let n = 0;
    for (const rt of this.runtimes.values()) n += rt.props.length;
    return n;
  }
}
