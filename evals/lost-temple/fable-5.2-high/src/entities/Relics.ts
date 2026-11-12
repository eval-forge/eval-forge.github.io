import * as THREE from 'three';
import type { CarriedRelic, PlacedRelic } from '../core/economy';
import { pedestalSwap, swapTriggersTrap } from '../core/traps';
import { SCENE_INFO, type SceneId } from '../core/types';
import type { SceneBuilder, SetPiece } from '../engine/builder';
import type { Game } from '../game/Game';
import { makeRelicMesh, pedestal } from '../world/props';
import type { Interactable } from '../world/types';

const PEDESTAL_H = 1.0;

/** Relics sitting in the world, the trapped pedestals under some of them, and the satchel they go into. */
export class Relics {
  /** Trap id → what happens when a trapped relic is lifted carelessly. Registered by scenes. */
  readonly traps = new Map<string, () => void>();

  constructor(private game: Game) {}

  /** Put this scene's untaken relics (and their pedestals) into the scene being built. */
  buildScene(scene: SceneId, sb: SceneBuilder): void {
    const { game } = this;
    for (const pl of game.run.placed) {
      if (pl.spot.scene !== scene) continue;
      const [x, y, z] = pl.spot.pos;
      const onPedestal = !!pl.spot.pedestal || !!pl.spot.trap;
      if (onPedestal) pedestal(sb, x, y, z, PEDESTAL_H, !!pl.spot.trap);
      if (game.run.taken.has(pl.spot.id)) continue;
      const mesh = makeRelicMesh(pl.relic, game.mats, sb.gate);
      const top = y + (onPedestal ? PEDESTAL_H + 0.03 : 0.02);
      mesh.position.set(x, top + mesh.userData.halfHeight, z);
      mesh.rotation.y = (x * 1.7 + z * 0.9) % 6.28;
      sb.add(mesh);
      const inter: Interactable = {
        pos: mesh.position.clone(), range: 2.8, priority: 0,
        prompt: () => {
          const base = `Take ${pl.relic.name}  ·  ${pl.value} gold  ·  ${pl.relic.weight.toFixed(1)} kg`;
          if (!pl.spot.trap) return base;
          const held = game.player.held;
          return held ? `${base}\nSwap in the ${held.name} (${held.weight.toFixed(1)} kg)` : `${base}\nTrapped pedestal: carry something of equal weight to swap`;
        },
        act: () => this.take(pl, mesh, inter, top),
      };
      game.addInteractable(inter);
      sb.piece({ dispose: () => { game.removeInteractable(inter); mesh.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); }); } } as SetPiece);
    }
  }

  private take(pl: PlacedRelic, mesh: THREE.Object3D, inter: Interactable, top: number): void {
    const { game } = this;
    const run = game.run;
    if (run.taken.has(pl.spot.id)) return;
    if (!run.satchel.canAdd(pl.relic.weight)) {
      game.toast(`Too heavy. Satchel holds ${run.satchel.capacity} kg and you carry ${run.satchel.weight.toFixed(1)}. Drop something with G.`);
      game.audio.play('deny');
      return;
    }
    if (pl.spot.trap) {
      const held = game.player.held;
      const result = pedestalSwap(pl.relic.weight, held ? held.weight : null);
      if (held && result === 'safe') {
        // Set the counterweight down where the relic was.
        game.player.dropHeld();
        held.body.setTranslation({ x: pl.spot.pos[0], y: top + 0.2, z: pl.spot.pos[2] }, true);
        held.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        game.toast('The pedestal settles. Clean swap.');
        game.audio.play('click');
      } else {
        const why = result === 'noCounterweight' ? 'Nothing to take its weight!' : result === 'tooLight' ? 'Counterweight too light!' : 'Counterweight too heavy!';
        game.toast(`${why} The pedestal sinks...`);
        game.audio.play('trap');
        run.stats.trapsSprung++;
        game.emitNoise(mesh.position, 26, 0.3);
        const fire = this.traps.get(pl.spot.trap);
        if (fire) fire();
      }
    }
    run.taken.add(pl.spot.id);
    mesh.removeFromParent();
    game.removeInteractable(inter);
    this.stow({ relicId: pl.relic.id, value: pl.value, weight: pl.relic.weight, scene: pl.spot.scene }, true);
    run.stats.relicsFound++;
    if (SCENE_INFO[pl.spot.scene].depthRank > SCENE_INFO[run.stats.deepest].depthRank) run.stats.deepest = pl.spot.scene;
  }

  /** Put a relic in the satchel. Returns false if it does not fit. */
  stow(item: CarriedRelic, quiet = false): boolean {
    const { game } = this;
    if (!game.run.satchel.add(item)) {
      if (!quiet) { game.toast('Too heavy for the satchel. Drop something with G.'); game.audio.play('deny'); }
      return false;
    }
    game.audio.play('relic');
    game.hud.lootPop(item.value);
    return true;
  }

  nameOf(it: CarriedRelic): string { return relicName(it); }

  /** Drop the most recent relic out of the satchel as a physical object. */
  dropLast(): void {
    const { game } = this;
    const it = game.run.satchel.removeLast();
    if (!it) { game.toast('Satchel is empty'); return; }
    const p = game.player;
    const f = p.forward(new THREE.Vector3());
    const prop = game.props.spawn('relic', relicName(it), it.weight, p.pos.x + f.x * 0.7, p.pos.y + 1.1, p.pos.z + f.z * 0.7, it);
    prop.body.setLinvel({ x: f.x * 2.2, y: 1.2, z: f.z * 2.2 }, true);
    prop.thrown = true;
    game.run.stats.relicsDropped++;
    game.audio.play('throw', { vol: 0.4 });
    game.toast(`Dropped ${prop.name} (${it.weight.toFixed(1)} kg)`);
  }
}

import { RELIC_BY_ID } from '../core/economy';
function relicName(it: CarriedRelic): string { return RELIC_BY_ID[it.relicId].name; }
