import { SCENE_INFO } from '../core/types';
import type { Game } from '../game/Game';
import { el } from './dom';

/** F3 overlay: frame rate, physics body count, current scene, and the numbers that prove the dark is dark. */
export class DebugOverlay {
  private root: HTMLElement;
  visible = false;
  private t = 0;
  fps = 0;
  low = 0;

  constructor(private game: Game) {
    this.root = el('pre', 'debug', document.getElementById('ui'));
    this.root.style.display = 'none';
  }

  toggle(): void { this.visible = !this.visible; this.root.style.display = this.visible ? '' : 'none'; }

  /** Average FPS and the 1% low over the recent window. */
  measure(): { fps: number; low: number; ms: number } {
    const ft = this.game.frameTimes;
    if (!ft.length) return { fps: 0, low: 0, ms: 0 };
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    const sorted = [...ft].sort((a, b) => b - a);
    const worst = sorted.slice(0, Math.max(1, Math.round(ft.length * 0.01)));
    const w = worst.reduce((a, b) => a + b, 0) / worst.length;
    return { fps: 1000 / avg, low: 1000 / w, ms: avg };
  }

  update(dt: number): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const m = this.measure();
    this.fps = m.fps; this.low = m.low;
    if (!this.visible) return;
    const g = this.game, info = g.renderer.info, p = g.player.pos, w = g.world;
    const s = SCENE_INFO[w.current];
    this.root.textContent = [
      `FPS ${m.fps.toFixed(0)}  (1% low ${m.low.toFixed(0)}, ${m.ms.toFixed(1)} ms)`,
      `physics bodies ${g.physics.bodyCount}  colliders ${g.physics.colliderCount}`,
      `scene ${s.name} [${w.current}]  zone ${s.zone}`,
      `loaded ${[...w.loaded.keys()].join(', ')}${w.streaming ? `  streaming ${w.streaming} (${w.lastBuildMs.toFixed(1)} ms)` : ''}`,
      `draw calls ${info.render.calls}  triangles ${info.render.triangles}  textures ${info.memory.textures}`,
      `time ${g.run.time.toFixed(1)} s  state ${g.state}`,
      `ambient ${g.sky.ambientIntensity.toFixed(3)}  sun ${g.sky.sun.intensity.toFixed(3)}  torch radius ${g.torch.radius.toFixed(1)} m`,
      `player ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}  hp ${g.player.health.toFixed(0)}  sta ${g.player.stamina.toFixed(0)}`,
      `guardians awake ${g.guardians.awakeCount}/${g.guardians.list.length}  nearest ${isFinite(g.guardians.nearest) ? g.guardians.nearest.toFixed(1) + ' m' : 'none'}`,
      `interactables ${g.interactables.length}  props ${g.props.list.length}  noise ${g.run.noise.level.toFixed(2)}`,
    ].join('\n');
  }
}
