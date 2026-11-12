/** Keyboard, mouse (pointer lock) and gamepad input. */
export class Input {
  keys = new Set<string>();
  pressed = new Set<string>(); // edge-triggered this frame
  mouseDX = 0;
  mouseDY = 0;
  mouseButtons = new Set<number>();
  mousePressed = new Set<number>();
  locked = false;
  sensitivity = 1;
  invertY = false;
  // Gamepad state
  padMove = { x: 0, y: 0 };
  padLook = { x: 0, y: 0 };
  padButtons: boolean[] = [];
  padPressed = new Set<number>();
  padConnected = false;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code) && this.locked) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Clamp large spikes some browsers produce on pointer-lock re-entry
      const mx = Math.abs(e.movementX) > 400 ? 0 : e.movementX;
      const my = Math.abs(e.movementY) > 400 ? 0 : e.movementY;
      this.mouseDX += mx;
      this.mouseDY += my;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouseButtons.add(e.button);
      this.mousePressed.add(e.button);
    });
    document.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    document.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
    window.addEventListener('gamepadconnected', () => (this.padConnected = true));
  }

  lock() {
    try {
      const p = (this.canvas as HTMLCanvasElement).requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* ignore */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code: string) { return this.keys.has(code); }
  hit(code: string) { return this.pressed.has(code); }
  padDown(i: number) { return !!this.padButtons[i]; }
  padHit(i: number) { return this.padPressed.has(i); }

  pollGamepad() {
    this.padPressed.clear();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && Array.from(pads).find((p) => p && p.connected);
    if (!gp) { this.padMove.x = this.padMove.y = this.padLook.x = this.padLook.y = 0; return; }
    this.padConnected = true;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    this.padMove.x = dz(gp.axes[0] ?? 0);
    this.padMove.y = dz(gp.axes[1] ?? 0);
    this.padLook.x = dz(gp.axes[2] ?? 0);
    this.padLook.y = dz(gp.axes[3] ?? 0);
    gp.buttons.forEach((b, i) => {
      const d = b.pressed || b.value > 0.5;
      if (d && !this.padButtons[i]) this.padPressed.add(i);
      this.padButtons[i] = d;
    });
  }

  endFrame() {
    this.pressed.clear();
    this.mousePressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}

/** Standard gamepad mapping indices. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
