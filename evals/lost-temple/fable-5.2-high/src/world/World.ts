import * as THREE from 'three';
import type { LootSpotDef } from '../core/economy';
import type { NavRect } from '../core/navmesh';
import { SCENE_INFO, SCENE_ORDER, type SceneId, type Zone } from '../core/types';
import { neighbours } from '../core/unlock';
import { SceneBuilder } from '../engine/builder';
import type { Game } from '../game/Game';
import { SCENES } from './scenes';
import type { GuardianSpawn, SceneDef } from './types';

interface Building { id: SceneId; sb: SceneBuilder; gen: Generator<void, void, void>; }

/**
 * Streams the seven scenes in and out around the player. The scene you are in and its graph
 * neighbours stay loaded; the rest are disposed. Builds are generators run a few milliseconds per
 * frame, so walking across a boundary never shows a loading screen or drops a frame.
 */
export class World {
  readonly defs: Record<SceneId, SceneDef> = SCENES;
  readonly loaded = new Map<SceneId, SceneBuilder>();
  private building: Building | null = null;
  private queue: SceneId[] = [];
  current: SceneId = 'jungle';
  private backdrop = new THREE.Group();
  /** Milliseconds per frame the streamer may spend building. */
  budgetMs = 5;
  lastBuildMs = 0;

  constructor(private game: Game) {
    // Distant mountain the temple is cut into. Always present above ground.
    const mat = game.mats.get('rock');
    const add = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.7), 3));
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx / 14, uv.getY(i) * sy / 14);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, z); m.rotation.y = ry;
      this.backdrop.add(m);
    };
    // Every block sits on y = 0 so none of them cuts across a stairwell on its way underground.
    add(0, 40, -151, 150, 80, 100); add(-50, 55, -190, 110, 110, 90, 0.3); add(60, 49, -180, 100, 98, 80, -0.25);
    add(-98, 24, -70, 60, 48, 150, 0.1); add(0, 80, -230, 90, 160, 70);
    game.scene.add(this.backdrop);
  }

  allNav(): NavRect[] { return SCENE_ORDER.flatMap((id) => this.defs[id].nav); }
  allLoot(): LootSpotDef[] { return SCENE_ORDER.flatMap((id) => this.defs[id].loot); }
  allGuardians(): { scene: SceneId; spawn: GuardianSpawn }[] {
    return SCENE_ORDER.flatMap((id) => this.defs[id].guardians.map((spawn) => ({ scene: id, spawn })));
  }

  /** Which scene contains a point. Scenes can overlap in plan, so bounds carry heights. */
  sceneAt(x: number, y: number, z: number): SceneId | null {
    // Deepest first so underground volumes win over the rooms above them.
    for (let i = SCENE_ORDER.length - 1; i >= 0; i--) {
      const id = SCENE_ORDER[i];
      for (const b of this.defs[id].bounds) {
        if (x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2 && y >= (b.y1 ?? -Infinity) && y <= (b.y2 ?? Infinity)) return id;
      }
    }
    return null;
  }

  isLoadedAt(x: number, y: number, z: number): boolean {
    const id = this.sceneAt(x, y, z);
    return id !== null && this.loaded.has(id);
  }

  get zone(): Zone { return SCENE_INFO[this.current].zone; }

  private wanted(): SceneId[] { return [this.current, ...neighbours(this.current)]; }

  private begin(id: SceneId): Building {
    const { game } = this;
    const def = this.defs[id];
    const sb = new SceneBuilder(game.physics, game.mats, id);
    const zone = SCENE_INFO[id].zone;
    sb.gate = zone === 'C' ? 'dark' : 'sky';
    const inner = def.build(game, sb);
    const relics = game.relics;
    const self = this;
    function* run(): Generator<void, void, void> {
      yield* inner;
      yield;
      relics.buildScene(id, sb);
      yield;
      sb.finish();
      game.scene.add(sb.group);
      self.loaded.set(id, sb);
      game.props.restoreScene(id);
      game.run.spawnedProps.add(id);
      if (game.run.progress.night) for (const p of sb.pieces) p.onNight?.();
    }
    return { id, sb, gen: run() };
  }

  private finishNow(bld: Building): void { while (!bld.gen.next().done) { /* run to completion */ } }

  private unload(id: SceneId): void {
    const sb = this.loaded.get(id);
    if (!sb) return;
    this.game.props.stashScene(id, this.defs[id].bounds);
    sb.dispose();
    this.loaded.delete(id);
  }

  /** Throw every scene away without stashing anything. Call before replacing the run state. */
  clear(): void {
    if (this.building) { this.building.sb.dispose(); this.building = null; }
    for (const id of [...this.loaded.keys()]) { this.loaded.get(id)!.dispose(); this.loaded.delete(id); }
    this.queue = [];
  }

  /** Start of a run: build the first scenes up front (the only wait in a run). */
  start(scene: SceneId): void {
    this.clear();
    this.current = scene;
    for (const id of this.wanted()) this.finishNow(this.begin(id));
  }

  /** Make sure a scene (and neighbours) exists right now. Used by teleports in debug and tests. */
  ensure(scene: SceneId): void {
    this.current = scene;
    if (this.building && this.wanted().includes(this.building.id)) { this.finishNow(this.building); this.building = null; }
    for (const id of this.wanted()) if (!this.loaded.has(id)) this.finishNow(this.begin(id));
  }

  update(dt: number): void {
    const { game } = this;
    const p = game.player.pos;
    const at = this.sceneAt(p.x, p.y, p.z);
    if (at && at !== this.current) {
      this.current = at;
      game.run.visited.add(at);
      game.hud.sceneBanner(SCENE_INFO[at].name, SCENE_INFO[at].zone);
    }
    const want = this.wanted();
    // The scene you are standing in must exist. Normally it was streamed in while you approached.
    if (!this.loaded.has(this.current)) {
      if (this.building?.id === this.current) { this.finishNow(this.building); this.building = null; }
      else this.finishNow(this.begin(this.current));
    }
    for (const id of [...this.loaded.keys()]) if (!want.includes(id)) this.unload(id);
    if (this.building && !want.includes(this.building.id)) { this.building.sb.dispose(); this.building = null; }
    this.queue = want.filter((id) => !this.loaded.has(id) && this.building?.id !== id);

    // Time-sliced streaming.
    const t0 = performance.now();
    while (performance.now() - t0 < this.budgetMs) {
      if (!this.building) {
        const next = this.queue.shift();
        if (!next) break;
        this.building = this.begin(next);
      }
      if (this.building.gen.next().done) this.building = null;
    }
    this.lastBuildMs = performance.now() - t0;

    for (const sb of this.loaded.values()) sb.update(dt);
    this.backdrop.visible = this.zone !== 'C';
  }

  fixedUpdate(dt: number): void { for (const sb of this.loaded.values()) sb.fixedUpdate(dt); }

  onNight(): void { for (const sb of this.loaded.values()) for (const p of sb.pieces) p.onNight?.(); }

  get streaming(): SceneId | null { return this.building?.id ?? null; }
}
