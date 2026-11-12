/**
 * Streams scenes in and out around the player. The current scene and its
 * graph neighbours are kept loaded; builders are generators, run for a few
 * milliseconds per frame, so there is never a loading screen mid-run.
 */
import { SCENES, type SceneId } from '../core/scenes';
import type { Game } from '../game/game';
import { DroppedRelicEnt, RelicPickup } from './entities/relics';
import { Prop } from './entities/props';
import { SceneKit, disposeGroup, type LoadedScene } from './kit';
import { layouts, sceneAt } from './layout';
import type { Entity } from './registry';
import { BUILDERS } from './scenes';

const BUILD_BUDGET_MS = 5;
const UNLOAD_AFTER = 6;

export class SceneManager {
  readonly loaded = new Map<SceneId, LoadedScene>();
  current: SceneId = 'jungle';
  private building: { id: SceneId; kit: SceneKit; gen: Generator<void> } | null = null;
  private queue: SceneId[] = [];
  private readonly unwanted = new Map<SceneId, number>();
  /** Milliseconds spent building in the last frame (debug overlay). */
  buildMs = 0;
  /** Set by the game: is this position in true-dark dungeon space? */
  isDark: (y: number, scene: SceneId) => boolean = () => false;

  constructor(private readonly game: Game) {}

  get buildingId(): SceneId | null {
    return this.building?.id ?? null;
  }

  /** Throw everything away (new run). */
  reset(): void {
    this.abandonBuild();
    this.queue = [];
    for (const id of [...this.loaded.keys()]) this.unload(id, false);
    this.game.reg.clear();
    this.unwanted.clear();
    this.current = 'jungle';
  }

  /**
   * Drop a half-built scene, bodies and all. Just forgetting it would leave its
   * physics behind: an invisible second bridge under the real one, for a start.
   */
  private abandonBuild(): void {
    const b = this.building;
    if (!b) return;
    this.building = null;
    for (const e of b.kit.entities) e.dispose();
    this.game.physics.removeBody(b.kit.body);
    disposeGroup(b.kit.group);
  }

  private start(id: SceneId): { id: SceneId; kit: SceneKit; gen: Generator<void> } {
    const kit = new SceneKit(this.game, id, layouts()[id], SCENES[id].zone === 'C');
    return { id, kit, gen: BUILDERS[id](kit) };
  }

  private complete(b: { id: SceneId; kit: SceneKit }): void {
    const game = this.game;
    const scene = b.kit.finish();
    const run = game.run;
    // Relics, things the player dropped here, loose props.
    for (const spot of layouts()[b.id].spots) {
      const relic = run.loot.get(spot.id);
      if (relic) scene.entities.push(new RelicPickup(game, scene, spot, relic, this.isDark(spot.pos.y, b.id)));
    }
    for (const d of run.dropped) {
      if (d.scene === b.id) scene.entities.push(new DroppedRelicEnt(game, scene, d, this.isDark(d.pos.y, b.id)));
    }
    for (const rec of run.props.values()) {
      if (rec.scene !== b.id || rec.consumed) continue;
      if (game.player.held && game.player.held.rec === rec) continue;
      scene.entities.push(new Prop(game, rec, scene.group, this.isDark(rec.y, b.id)));
    }
    game.renderer.scene.add(scene.group);
    scene.group.updateMatrixWorld(true);
    this.loaded.set(b.id, scene);
    game.onSceneLoaded(b.id);
  }

  /** Build a scene right now, however long it takes (run start, teleports). */
  ensure(id: SceneId): void {
    if (this.loaded.has(id)) return;
    let b = this.building;
    if (b && b.id === id) this.building = null;
    else b = this.start(id);
    this.queue = this.queue.filter((q) => q !== id);
    while (!b.gen.next().done) {
      /* run to completion */
    }
    this.complete(b);
  }

  unload(id: SceneId, save = true): void {
    const scene = this.loaded.get(id);
    if (!scene) return;
    const game = this.game;
    for (const e of scene.entities) {
      if (e instanceof Prop) {
        if (game.player.held === e) continue; // travelling with the player
        if (save) e.save(id);
      }
      e.dispose();
    }
    scene.entities.length = 0;
    game.physics.removeBody(scene.body);
    game.renderer.scene.remove(scene.group);
    disposeGroup(scene.group);
    this.loaded.delete(id);
    this.unwanted.delete(id);
  }

  /** A prop that was just dropped belongs to whichever loaded scene it is in now. */
  adoptProp(prop: Prop): void {
    const t = prop.body.translation();
    const id = sceneAt(t, this.current) ?? this.current;
    const target = this.loaded.get(id) ?? this.loaded.get(this.current);
    if (!target) return;
    for (const s of this.loaded.values()) {
      const i = s.entities.indexOf(prop);
      if (i >= 0) {
        if (s === target) return;
        s.entities.splice(i, 1);
      }
    }
    target.entities.push(prop);
    target.group.add(prop.mesh);
    prop.rec.scene = target.id;
  }

  /** Keep a carried prop alive when its home scene unloads. */
  private detachHeld(scene: LoadedScene): void {
    const held = this.game.player.held;
    if (!held) return;
    const i = scene.entities.indexOf(held);
    if (i < 0) return;
    scene.entities.splice(i, 1);
    const home = this.loaded.get(this.current);
    if (home && home !== scene) {
      home.entities.push(held);
      home.group.add(held.mesh);
      held.rec.scene = home.id;
    }
  }

  addEntity(id: SceneId, e: Entity): void {
    (this.loaded.get(id) ?? this.loaded.get(this.current))?.entities.push(e);
  }

  removeEntity(scene: LoadedScene, e: Entity): void {
    const i = scene.entities.indexOf(e);
    if (i >= 0) scene.entities.splice(i, 1);
  }

  /** Streaming decisions. Call once per frame. */
  update(dt: number): void {
    const game = this.game;
    const here = sceneAt(game.player.pos, this.current);
    if (here && here !== this.current) {
      const from = this.current;
      this.current = here;
      game.onSceneChanged(from, here);
    }
    const wanted = new Set<SceneId>([this.current, ...SCENES[this.current].neighbours]);
    if (!this.loaded.has(this.current)) this.ensure(this.current);
    for (const id of wanted) {
      if (!this.loaded.has(id) && this.building?.id !== id && !this.queue.includes(id)) this.queue.push(id);
    }
    this.queue = this.queue.filter((id) => wanted.has(id));
    if (this.building && !wanted.has(this.building.id)) this.abandonBuild();

    // Time-sliced construction.
    const t0 = performance.now();
    while (performance.now() - t0 < BUILD_BUDGET_MS) {
      if (!this.building) {
        const next = this.queue.shift();
        if (!next) break;
        this.building = this.start(next);
      }
      if (this.building.gen.next().done) {
        this.complete(this.building);
        this.building = null;
        break; // uploading the batches is enough work for one frame
      }
    }
    this.buildMs = performance.now() - t0;

    // Unload what has not been wanted for a while.
    for (const id of [...this.loaded.keys()]) {
      if (wanted.has(id)) {
        this.unwanted.delete(id);
        continue;
      }
      const t = (this.unwanted.get(id) ?? 0) + dt;
      if (t > UNLOAD_AFTER) {
        this.detachHeld(this.loaded.get(id)!);
        this.unload(id);
      } else {
        this.unwanted.set(id, t);
      }
    }
  }

  step(dt: number): void {
    for (const scene of this.loaded.values()) {
      const list = scene.entities;
      for (let i = 0; i < list.length; i++) list[i].step?.(dt);
    }
  }

  frame(dt: number): void {
    for (const scene of this.loaded.values()) {
      if (!scene.group.visible) continue;
      const list = scene.entities;
      for (let i = 0; i < list.length; i++) list[i].frame?.(dt);
    }
  }

  get entityCount(): number {
    let n = 0;
    for (const s of this.loaded.values()) n += s.entities.length;
    return n;
  }
}
