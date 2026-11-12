/**
 * F3 overlay: FPS and frame time, physics bodies and colliders, the current and loaded scenes,
 * pending builds, draw calls and triangles, guardian states and the player's position. With
 * "Show FPS" on in the settings, a one-line version stays up even when the overlay is closed.
 */
export interface DebugInfo {
  fps: number;
  frameMs: number;
  worstMs: number;
  /** CPU time of the update half of the frame and of the render call (smoothed). */
  updateMs: number;
  renderMs: number;
  physicsMs: number;
  bodies: number;
  colliders: number;
  scene: string;
  loaded: string[];
  pending: number;
  buildMs: number;
  calls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  props: number;
  guardians: string[];
  pos: [number, number, number];
  mode: string;
  remaining: number;
  torch: string;
  light: string;
  seed: number;
}

export class DebugOverlay {
  root: HTMLPreElement;
  full = false;
  fpsOnly = false;
  private t = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('pre');
    this.root.id = 'debug';
    this.root.classList.add('hidden');
    parent.appendChild(this.root);
  }

  toggle() {
    this.full = !this.full;
    this.refreshVisibility();
  }

  setFpsOnly(on: boolean) {
    this.fpsOnly = on;
    this.refreshVisibility();
  }

  hide() {
    this.root.classList.add('hidden');
  }

  refreshVisibility() {
    this.root.classList.toggle('hidden', !(this.full || this.fpsOnly));
  }

  update(dt: number, info: () => DebugInfo) {
    if (!this.full && !this.fpsOnly) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const d = info();
    if (!this.full) {
      this.root.textContent = `${d.fps.toFixed(0)} fps  ${d.frameMs.toFixed(1)} ms`;
      return;
    }
    const lines = [
      `FPS ${d.fps.toFixed(1)}   frame ${d.frameMs.toFixed(2)} ms (worst ${d.worstMs.toFixed(1)})`,
      `cpu: update ${d.updateMs.toFixed(2)} ms (physics ${d.physicsMs.toFixed(2)})   render call ${d.renderMs.toFixed(2)} ms`,
      `bodies ${d.bodies}   colliders ${d.colliders}   props ${d.props}`,
      `scene ${d.scene}   loaded [${d.loaded.join(', ')}]   building ${d.pending} (${d.buildMs.toFixed(1)} ms)`,
      `draw calls ${d.calls}   triangles ${(d.triangles / 1000).toFixed(1)}k   programs ${d.programs}   geometries ${d.geometries}   textures ${d.textures}`,
      `pos ${d.pos.map((v) => v.toFixed(1)).join(', ')}   ${d.mode}`,
      `time left ${d.remaining.toFixed(1)} s   torch ${d.torch}   ${d.light}`,
      `seed ${d.seed}`,
      'guardians:',
      ...(d.guardians.length ? d.guardians.map((g) => '  ' + g) : ['  (none yet)']),
    ];
    this.root.textContent = lines.join('\n');
  }
}
