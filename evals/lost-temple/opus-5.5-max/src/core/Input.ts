/**
 * Keyboard, mouse (pointer lock) and gamepad input mapped onto game actions.
 */

export type Action =
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'interact'
  | 'grab'
  | 'drop'
  | 'torch'
  | 'refuel'
  | 'kick'
  | 'map'
  | 'pause'
  | 'debug'
  | 'pull'
  | 'cycleNext'
  | 'cyclePrev';

const KEYMAP: Record<string, Action> = {
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyC: 'crouch',
  ControlLeft: 'crouch',
  KeyE: 'interact',
  KeyF: 'grab',
  KeyT: 'torch',
  KeyR: 'refuel',
  KeyV: 'kick',
  KeyM: 'map',
  Tab: 'map',
  KeyP: 'pause',
  F3: 'debug',
  Backquote: 'debug',
  KeyG: 'pull',
  BracketRight: 'cycleNext',
  BracketLeft: 'cyclePrev',
  KeyQ: 'drop',
};

export class Input {
  private keys = new Set<string>();
  private held = new Set<Action>();
  private pressedNow = new Set<Action>();
  private gpHeldPrev = new Set<Action>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  moveX = 0;
  moveY = 0;
  lookX = 0;
  lookY = 0;
  locked = false;
  usingGamepad = false;
  sensitivity = 1;
  invertY = false;
  enabled = true;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'F3' || (e.code === 'Space' && this.locked)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = KEYMAP[e.code];
      if (a) {
        this.held.add(a);
        this.pressedNow.add(a);
      }
      if (e.code === 'Escape') this.pressedNow.add('pause');
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const a = KEYMAP[e.code];
      if (a && !Object.entries(KEYMAP).some(([k, v]) => v === a && this.keys.has(k))) this.held.delete(a);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.held.clear();
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.held.add('grab');
        this.pressedNow.add('grab');
      } else if (e.button === 2) {
        this.held.add('drop');
        this.pressedNow.add('drop');
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.held.delete('grab');
      if (e.button === 2) this.held.delete('drop');
    });
    window.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.held.delete('grab');
        this.held.delete('drop');
      }
      this.onLockChange(this.locked);
    });
  }

  requestLock() {
    try {
      const r = (this.canvas as any).requestPointerLock?.({ unadjustedMovement: true });
      if (r && typeof r.catch === 'function') r.catch(() => (this.canvas as any).requestPointerLock?.());
    } catch {
      /* not available (headless); keyboard still works */
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isHeld(a: Action): boolean {
    return this.enabled && this.held.has(a);
  }

  pressed(a: Action): boolean {
    return this.enabled && this.pressedNow.has(a);
  }

  /** Inject an action (used by the debug API and touch-free tests). */
  inject(a: Action, hold = false) {
    this.pressedNow.add(a);
    if (hold) this.held.add(a);
  }
  release(a: Action) {
    this.held.delete(a);
  }
  setMove(x: number, y: number) {
    this.forcedMove = [x, y];
  }
  private forcedMove: [number, number] | null = null;

  /** Call once per frame before the game reads input; `frameDt` is the real frame time in seconds. */
  poll(frameDt = 1 / 60) {
    // Keyboard movement
    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    const k = 0.0022 * this.sensitivity;
    let lx = this.mouseDX * k;
    let ly = this.mouseDY * k * (this.invertY ? -1 : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;
    if (this.wheel > 0) this.pressedNow.add('cycleNext');
    if (this.wheel < 0) this.pressedNow.add('cyclePrev');
    this.wheel = 0;

    // Gamepad
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && Array.from(pads).find((p) => p && p.connected);
    const gpHeld = new Set<Action>();
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const ax = dz(gp.axes[0] ?? 0);
      const ay = dz(gp.axes[1] ?? 0);
      const rx = dz(gp.axes[2] ?? 0);
      const ry = dz(gp.axes[3] ?? 0);
      if (ax || ay || rx || ry) this.usingGamepad = true;
      mx += ax;
      my -= ay;
      // the right stick is a turn rate (up to 3 rad/s across, 2.4 rad/s up and down), so it turns
      // at the same speed at any frame rate
      const turn = Math.min(0.1, Math.max(0, frameDt));
      lx += rx * Math.abs(rx) * 3.0 * turn * this.sensitivity;
      ly += ry * Math.abs(ry) * 2.4 * turn * this.sensitivity * (this.invertY ? -1 : 1);
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      const map: [number, Action][] = [
        [0, 'jump'],
        [1, 'crouch'],
        [2, 'interact'],
        [3, 'torch'],
        [4, 'cyclePrev'],
        [5, 'cycleNext'],
        [6, 'drop'],
        [7, 'grab'],
        [8, 'map'],
        [9, 'pause'],
        [10, 'sprint'],
        [11, 'kick'],
        [12, 'refuel'],
        [13, 'pull'],
        [14, 'cyclePrev'],
        [15, 'cycleNext'],
      ];
      for (const [i, a] of map) if (b(i)) gpHeld.add(a);
      for (const a of gpHeld) {
        if (!this.gpHeldPrev.has(a)) this.pressedNow.add(a);
        this.usingGamepad = true;
      }
    }
    for (const a of this.gpHeldPrev) if (!gpHeld.has(a)) this.held.delete(a);
    for (const a of gpHeld) this.held.add(a);
    this.gpHeldPrev = gpHeld;

    if (this.forcedMove) {
      mx = this.forcedMove[0];
      my = this.forcedMove[1];
    }
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.moveX = this.enabled ? mx : 0;
    this.moveY = this.enabled ? my : 0;
    this.lookX = this.enabled ? lx : 0;
    this.lookY = this.enabled ? ly : 0;
  }

  /** Call at the end of each frame. */
  endFrame() {
    this.pressedNow.clear();
  }

  clearForced() {
    this.forcedMove = null;
  }
}
