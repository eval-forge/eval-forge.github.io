/**
 * Input: keyboard + mouse (pointer lock) + gamepad, merged into one action state.
 * `pressed(a)` is true for exactly one frame after a press.
 */
export type Action =
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'interact'
  | 'grab'
  | 'throw'
  | 'drop'
  | 'torch'
  | 'map'
  | 'pause'
  | 'debug'
  | 'warp'
  | 'refuel';

const KEYMAP: Record<string, Action> = {
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyC: 'crouch',
  ControlLeft: 'crouch',
  ControlRight: 'crouch',
  KeyE: 'interact',
  KeyF: 'grab',
  KeyQ: 'drop',
  KeyT: 'torch',
  KeyR: 'refuel',
  KeyM: 'map',
  Escape: 'pause',
  F3: 'debug',
  F4: 'warp',
};

export class Input {
  moveX = 0; // strafe -1..1
  moveY = 0; // forward -1..1
  lookDX = 0;
  lookDY = 0;
  private keys = new Set<string>();
  private held = new Set<Action>();
  private down = new Set<Action>();
  private mouseButtons = new Set<number>();
  locked = false;
  gamepadActive = false;
  private padPrev = new Set<Action>();
  onPointerLockChange: ((locked: boolean) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3' || e.code === 'F4' || (e.code === 'Space' && this.locked) || e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = KEYMAP[e.code];
      if (a) {
        if (!this.held.has(a)) this.down.add(a);
        this.held.add(a);
      }
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
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouseButtons.add(e.button);
      if (e.button === 0) {
        this.down.add('throw');
        this.held.add('throw');
      }
      if (e.button === 2) {
        this.down.add('grab');
      }
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseButtons.delete(e.button);
      if (e.button === 0) this.held.delete('throw');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // clamp huge spikes some browsers emit on lock
      const dx = Math.max(-250, Math.min(250, e.movementX));
      const dy = Math.max(-250, Math.min(250, e.movementY));
      this.lookDX += dx;
      this.lookDY += dy;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.keys.clear();
        this.held.clear();
      }
      this.onPointerLockChange?.(this.locked);
    });
  }

  requestLock() {
    if (document.pointerLockElement !== this.canvas) {
      const p: any = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Call once per frame before reading. */
  poll() {
    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    this.pollGamepad((gx, gy, lx, ly, pad) => {
      if (Math.abs(gx) > 0.15 || Math.abs(gy) > 0.15) {
        mx = gx;
        my = -gy;
        this.gamepadActive = true;
      }
      if (Math.abs(lx) > 0.12 || Math.abs(ly) > 0.12) {
        this.lookDX += lx * 14;
        this.lookDY += ly * 10;
        this.gamepadActive = true;
      }
      for (const a of pad) {
        if (!this.padPrev.has(a)) this.down.add(a);
        this.held.add(a);
      }
      for (const a of this.padPrev) if (!pad.has(a) && !this.keyHolds(a)) this.held.delete(a);
      this.padPrev = pad;
    });
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.moveX = mx;
    this.moveY = my;
  }

  private keyHolds(a: Action) {
    return Object.entries(KEYMAP).some(([k, v]) => v === a && this.keys.has(k));
  }

  private pollGamepad(cb: (mx: number, my: number, lx: number, ly: number, pad: Set<Action>) => void) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && Array.from(pads).find((p) => p && p.connected);
    if (!gp) return;
    const b = (i: number) => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
    const pad = new Set<Action>();
    if (b(0)) pad.add('jump');
    if (b(1)) pad.add('crouch');
    if (b(2)) pad.add('interact');
    if (b(3)) pad.add('grab');
    if (b(4) || b(10)) pad.add('sprint');
    if (b(5)) pad.add('torch');
    if (b(7)) pad.add('throw');
    if (b(13)) pad.add('drop');
    if (b(8)) pad.add('map');
    if (b(9)) pad.add('pause');
    const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
    cb(dz(gp.axes[0] ?? 0), dz(gp.axes[1] ?? 0), dz(gp.axes[2] ?? 0), dz(gp.axes[3] ?? 0), pad);
  }

  isHeld(a: Action): boolean {
    return this.held.has(a);
  }

  pressed(a: Action): boolean {
    return this.down.has(a);
  }

  keyHeld(code: string): boolean {
    return this.keys.has(code);
  }

  /** Call at the end of the frame. */
  endFrame() {
    this.down.clear();
    this.lookDX = 0;
    this.lookDY = 0;
  }

  /** Synthetic control for automated playtests. */
  simulate(a: Action, on: boolean) {
    if (on) {
      if (!this.held.has(a)) this.down.add(a);
      this.held.add(a);
    } else this.held.delete(a);
  }

  simulateKey(code: string, on: boolean) {
    if (on) this.keys.add(code);
    else this.keys.delete(code);
  }
}
