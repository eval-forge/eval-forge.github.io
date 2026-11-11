import { G } from '../core/ctx';
import type { Renderer } from '../core/Renderer';

export class Debug {
  el: HTMLDivElement;
  visible = false;
  private frames = 0;
  private acc = 0;
  fps = 0;
  ms = 0;
  constructor(parent: HTMLElement, private renderer: Renderer) {
    this.el = document.createElement('div');
    this.el.className = 'debug hidden';
    parent.appendChild(this.el);
  }
  set(v: boolean) { this.visible = v; this.el.classList.toggle('hidden', !v); }
  updMs = 0;
  renMs = 0;
  private lastT = performance.now();
  update(_dt: number) {
    const now = performance.now();
    this.frames++; this.acc += (now - this.lastT) / 1000;
    this.lastT = now;
    if (this.acc < 0.5) return;
    this.fps = this.frames / this.acc; this.ms = (this.acc / this.frames) * 1000;
    this.frames = 0; this.acc = 0;
    if (!this.visible || !G.player || !G.player.body || !G.world) return;
    const info = this.renderer.gl.info;
    void info;
    const p = G.player.position;
    const zone = G.world.current.zone;
    this.el.innerHTML = [
      `FPS ${this.fps.toFixed(0)} (${this.ms.toFixed(1)} ms · update ${this.updMs.toFixed(1)} · render ${this.renMs.toFixed(1)})`,
      `Physics bodies ${G.physics.bodyCount()} · colliders ${G.physics.colliderCount()}`,
      `Scene ${G.world.current.name} (zone ${zone})`,
      `Loaded: ${G.world.loadedNames().join(', ')}`,
      `Draw calls ${this.renderer.lastCalls} · tris ${(this.renderer.lastTris / 1000).toFixed(0)}k`,
      `Non-torch light ${G.sky.ambientSum.toFixed(3)}${zone === 'C' ? (G.sky.ambientSum === 0 ? ' ✔ true black' : ' ✘') : ''}`,
      `Torch r=${G.torch.radius.toFixed(1)}m fuel ${G.torch.fuel.toFixed(0)}s`,
      `Nav nodes ${G.nav.nodes.length} · guardians awake ${G.guardians.awakeCount()}/${G.guardians.list.length}`,
      `Pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} · t=${G.elapsed.toFixed(0)}s`,
    ].join('<br>');
  }
}
