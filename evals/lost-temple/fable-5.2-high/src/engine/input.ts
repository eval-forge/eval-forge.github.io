export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'run' | 'crouch' | 'jump' | 'interact' | 'torch' | 'drop' | 'flask' | 'spare'
  | 'map' | 'pause' | 'throw' | 'release' | 'debug';

const KEYMAP: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC', 'ControlLeft'], jump: ['Space'], interact: ['KeyE'], torch: ['KeyF'],
  drop: ['KeyG'], flask: ['KeyR'], spare: ['KeyT'], map: ['KeyM', 'Tab'], pause: ['Escape', 'KeyP'],
  throw: ['Mouse0'], release: ['Mouse2', 'KeyQ'], debug: ['F3', 'Backquote'],
};

// Standard gamepad mapping.
const PADMAP: Partial<Record<Action, number[]>> = {
  jump: [0], crouch: [1], interact: [2], torch: [3], release: [4], throw: [5, 7], run: [6, 10], pause: [9], map: [8],
  flask: [12], spare: [13], drop: [14],
};

/** Keyboard, mouse (pointer lock) and gamepad folded into one action state. */
export class Input {
  private down = new Set<string>();
  private hits = new Set<string>();
  private padDown = new Set<Action>();
  private padHits = new Set<Action>();
  private padAxes = [0, 0, 0, 0];
  private mdx = 0;
  private mdy = 0;
  locked = false;
  /** Set true to let tests drive the game without pointer lock. */
  virtualLock = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  padConnected = false;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'F3'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.hits.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => { const c = `Mouse${e.button}`; this.down.add(c); this.hits.add(c); });
    window.addEventListener('mouseup', (e) => this.down.delete(`Mouse${e.button}`));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mdx += e.movementX; this.mdy += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
  }

  requestLock(): void {
    try { const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* headless */ }
  }
  exitLock(): void { if (document.pointerLockElement) document.exitPointerLock(); }

  get active(): boolean { return this.locked || this.virtualLock; }

  /** Read the gamepad. Call once at the start of a frame. */
  poll(): void {
    this.padHits.clear();
    const pad = navigator.getGamepads?.().find((g) => g && g.connected) ?? null;
    this.padConnected = !!pad;
    if (!pad) { this.padDown.clear(); this.padAxes = [0, 0, 0, 0]; return; }
    const dz = (v: number) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
    this.padAxes = [dz(pad.axes[0] ?? 0), dz(pad.axes[1] ?? 0), dz(pad.axes[2] ?? 0), dz(pad.axes[3] ?? 0)];
    for (const [a, btns] of Object.entries(PADMAP) as [Action, number[]][]) {
      const on = btns.some((b) => pad.buttons[b]?.pressed);
      if (on && !this.padDown.has(a)) this.padHits.add(a);
      if (on) this.padDown.add(a); else this.padDown.delete(a);
    }
  }

  held(a: Action): boolean { return KEYMAP[a].some((k) => this.down.has(k)) || this.padDown.has(a); }
  /** True once on the frame the action was pressed. */
  hit(a: Action): boolean { return KEYMAP[a].some((k) => this.hits.has(k)) || this.padHits.has(a); }

  moveX(): number { return (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0) + this.padAxes[0]; }
  moveZ(): number { return (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0) - this.padAxes[1]; }

  /** Mouse delta in pixels plus right-stick look, consumed on read. */
  look(dt: number): { dx: number; dy: number } {
    const out = { dx: this.mdx + this.padAxes[2] * 900 * dt, dy: this.mdy + this.padAxes[3] * 700 * dt };
    this.mdx = 0; this.mdy = 0;
    return out;
  }

  endFrame(): void { this.hits.clear(); }

  // --- test hooks ---
  press(code: string): void { this.down.add(code); this.hits.add(code); }
  release(code: string): void { this.down.delete(code); }
  releaseAll(): void { this.down.clear(); }
}
