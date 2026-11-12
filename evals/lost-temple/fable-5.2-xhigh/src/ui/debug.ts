/** F3 overlay: frame rate, physics counts, streaming state, render stats. */
import { formatClock } from '../core/clock';
import { gradeName } from '../core/sun';
import type { Game } from '../game/game';
import { el } from './dom';

export class DebugOverlay {
  readonly root = el('div', 'debug');
  private t = 0;
  private worst = 0;

  constructor(private readonly game: Game) {}

  update(dt: number): void {
    const game = this.game;
    if (this.root.classList.contains('on') !== game.debugOpen) this.root.classList.toggle('on', game.debugOpen);
    if (!game.debugOpen) return;
    this.worst = Math.max(this.worst, dt * 1000);
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const r = game.renderer;
    const ph = game.physics;
    const p = game.player.pos;
    const run = game.run;
    const sc = game.scenes;
    const lines = [
      `FPS ${game.fps.toFixed(0).padStart(3)}   frame ${game.frameMs.toFixed(1)} ms   worst ${this.worst.toFixed(0)} ms`,
      `physics  bodies ${ph.bodyCount}  colliders ${ph.colliderCount}  joints ${ph.jointCount}  step ${ph.stepMs.toFixed(2)} ms`,
      `scene    ${sc.current}   loaded [${[...sc.loaded.keys()].join(', ')}]${sc.buildingId ? `   building ${sc.buildingId} (${sc.buildMs.toFixed(1)} ms)` : ''}`,
      `render   calls ${r.stats.calls}  tris ${(r.stats.triangles / 1000).toFixed(0)}k  programs ${r.stats.programs}  geoms ${r.stats.geometries}  tex ${r.stats.textures}  quality ${r.qualityName}`,
      `entities ${sc.entityCount}   guardians awake ${game.guardians.awakeCount}/${game.guardians.list.length}   threat ${game.guardians.threat.toFixed(2)}`,
      `pos      ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}   mode ${game.player.mode}   outdoor ${game.outdoor.toFixed(2)}`,
      `clock    ${formatClock(run.clock.remaining)} left   day ${(run.clock.dayFraction * 100).toFixed(1)}%   grade ${gradeName(run.clock.dayFraction)}   door gap ${run.clock.doorGap.toFixed(2)} m`,
      `torch    ${run.torch.state}  fuel ${run.torch.fuel.toFixed(0)} s  radius ${run.torch.radius.toFixed(1)} m   audio voices ${game.audio.voiceCount}`,
      `flags    ${[...run.flags].join(' ') || '-'}`,
    ];
    this.root.textContent = lines.join('\n');
    this.worst = 0;
  }
}
