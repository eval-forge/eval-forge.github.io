/**
 * Debug overlay (F3): FPS, frame time, physics bodies / colliders, current and loaded
 * scenes, draw calls, guardian states, exposure. F4 opens a warp / time-skip panel.
 * The "show FPS" setting shows a minimal FPS counter on its own.
 */
import { SCENE_ORDER, SCENES } from '../logic/unlocks';
import { formatClock } from '../logic/clock';
import type { Game } from '../game/Game';

export class DebugOverlay {
  private root: HTMLDivElement;
  private warpPanel: HTMLDivElement;
  private fpsOnly = false;
  private on = false;
  private t = 0;

  constructor(private game: Game, parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'debug hidden';
    parent.appendChild(this.root);
    this.warpPanel = document.createElement('div');
    this.warpPanel.className = 'warp hidden';
    parent.appendChild(this.warpPanel);
    const title = document.createElement('div');
    title.className = 'warp-title';
    title.textContent = 'F4  Debug: warp / time';
    this.warpPanel.appendChild(title);
    const btn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = (e) => {
        e.stopPropagation();
        if (game.state !== 'playing' && game.state !== 'paused') return;
        fn();
      };
      this.warpPanel.appendChild(b);
      return b;
    };
    for (const s of SCENE_ORDER) btn(SCENES[s].name, () => game.warp(s));
    btn('+60 s', () => game.skipTime(60));
    btn('To 2:00 left', () => game.skipTime(Math.max(0, game.clock.timeLeft - 120)));
    btn('To 0:30 left', () => game.skipTime(Math.max(0, game.clock.timeLeft - 30)));
    btn('To darkness', () => game.skipTime(Math.max(0, game.clock.timeLeft + 0.1)));
    btn('Unlock all gates', () => game.unlockAll());
    btn('Refill torch', () => {
      game.run.torch.addFuel(9999);
      game.run.torch.lit = true;
    });
  }

  setFpsOnly(on: boolean) {
    this.fpsOnly = on;
    this.refreshVisibility();
  }

  toggle() {
    this.on = !this.on;
    this.refreshVisibility();
  }

  toggleWarp() {
    const hidden = this.warpPanel.classList.toggle('hidden');
    if (!hidden) this.game.input.exitLock();
  }

  private refreshVisibility() {
    this.root.classList.toggle('hidden', !this.on && !this.fpsOnly);
    this.root.classList.toggle('mini', !this.on && this.fpsOnly);
  }

  update(dt: number) {
    if (!this.on && !this.fpsOnly) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const g = this.game;
    if (!this.on) {
      this.root.textContent = `${g.fps.toFixed(0)} FPS`;
      return;
    }
    const info = g.renderer.info;
    const p = g.player.pos;
    const loaded = [...g.scenes.loaded.values()].map((h) => (h.ready ? h.id : h.id + '*')).join(', ');
    const lines = [
      `FPS ${g.fps.toFixed(1)}   frame ${g.frameMs.toFixed(1)} ms`,
      `physics bodies ${g.physics.bodyCount()}   colliders ${g.physics.colliderCount()}`,
      `scene ${g.scenes.current} (${SCENES[g.scenes.current].zone})   exposure ${g.exposure}`,
      `loaded ${loaded}   pending ${g.scenes.pendingCount}   build ${g.scenes.lastBuildMs.toFixed(1)} ms`,
      `draw calls ${info.render.calls}   tris ${(info.render.triangles / 1000).toFixed(0)}k   geos ${info.memory.geometries}   tex ${info.memory.textures}`,
      `pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}   ${g.player.grounded ? 'grounded' : 'air'}${g.player.climbing ? ' climbing' : ''}${g.player.swimming ? ' swimming' : ''}`,
      `clock ${g.clock.phase} ${formatClock(Math.max(0, g.clock.timeLeft))}   sun ${g.sky.sunUp ? 'up' : 'down'} sky ${g.sky.skyFactor.toFixed(2)}`,
      `torch ${g.run.torch.lit ? 'lit' : 'out'} r ${g.run.torch.radius.toFixed(1)} fuel ${g.run.torch.fuel.toFixed(0)}`,
      `guardians ${g.guardians.debugStates() || '-'}`,
      `items live ${g.items.live.size}   fx darts ${g.fx.darts.length} debris ${g.fx.debris.length}`,
    ];
    this.root.textContent = lines.join('\n');
  }
}
