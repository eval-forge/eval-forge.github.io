export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'sprint'
  | 'interact' | 'grab' | 'throw' | 'drop' | 'torch' | 'relight' | 'map' | 'pause' | 'debug';

const KEYS: Record<string, Action> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', KeyC: 'crouch', ControlLeft: 'crouch', ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyE: 'interact', KeyF: 'grab', KeyQ: 'drop', KeyT: 'torch', KeyR: 'relight', KeyM: 'map', Escape: 'pause', KeyP: 'pause', F3: 'debug', Backquote: 'debug',
};

/** Keyboard + mouse + pointer lock + gamepad, folded into one action map. */
export class Input {
  private down = new Set<Action>();
  private pressedQ = new Set<Action>();
  private releasedQ = new Set<Action>();
  lookX = 0;
  lookY = 0;
  moveX = 0; // analog from gamepad
  moveY = 0;
  locked = false;
  sensitivity = 1;
  enabled = true;
  rawKeys = new Set<string>();
  private padPrev: boolean[] = [];
  gamepadActive = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.rawKeys.add(e.code);
      const a = KEYS[e.code];
      if (!a || e.repeat) return;
      this.press(a);
    });
    window.addEventListener('keyup', (e) => {
      this.rawKeys.delete(e.code);
      const a = KEYS[e.code];
      if (a) this.release(a);
    });
    window.addEventListener('blur', () => { this.down.clear(); this.rawKeys.clear(); });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.press('grab');
      if (e.button === 2) this.press('throw');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.release('grab');
      if (e.button === 2) this.release('throw');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX * 0.0022 * this.sensitivity;
      this.lookY += e.movementY * 0.0022 * this.sensitivity;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.onLockChange(this.locked);
    });
    window.addEventListener('gamepadconnected', () => { this.gamepadActive = true; });
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* headless or denied */ }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  press(a: Action) { if (!this.down.has(a)) this.pressedQ.add(a); this.down.add(a); }
  release(a: Action) { if (this.down.has(a)) this.releasedQ.add(a); this.down.delete(a); }
  isDown(a: Action) { return this.enabled && this.down.has(a); }
  pressed(a: Action) { const p = this.pressedQ.has(a); this.pressedQ.delete(a); return this.enabled && p; }
  released(a: Action) { const p = this.releasedQ.has(a); this.releasedQ.delete(a); return this.enabled && p; }

  /** Call once per frame after the game consumed input. */
  endFrame() { this.pressedQ.clear(); this.releasedQ.clear(); this.lookX = 0; this.lookY = 0; }

  consumeLook(): [number, number] { const r: [number, number] = [this.lookX, this.lookY]; this.lookX = 0; this.lookY = 0; return r; }

  /** Poll the first gamepad (standard mapping). */
  pollGamepad(dt: number) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    if (!gp) { this.moveX = this.moveY = 0; return; }
    this.gamepadActive = true;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    this.moveX = dz(gp.axes[0] ?? 0);
    this.moveY = dz(gp.axes[1] ?? 0);
    const rx = dz(gp.axes[2] ?? 0), ry = dz(gp.axes[3] ?? 0);
    this.lookX += rx * 2.6 * dt * this.sensitivity;
    this.lookY += ry * 2.0 * dt * this.sensitivity;
    const map: [number, Action][] = [[0, 'jump'], [1, 'crouch'], [2, 'interact'], [3, 'torch'], [4, 'drop'], [5, 'relight'], [6, 'throw'], [7, 'grab'], [9, 'pause'], [10, 'sprint'], [8, 'map']];
    for (const [i, a] of map) {
      const b = !!gp.buttons[i]?.pressed;
      if (b && !this.padPrev[i]) this.press(a);
      if (!b && this.padPrev[i]) this.release(a);
      this.padPrev[i] = b;
    }
  }
}
