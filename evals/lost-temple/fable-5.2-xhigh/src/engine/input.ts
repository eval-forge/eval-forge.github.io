/** Keyboard, mouse (pointer lock) and gamepad folded into one set of actions. */

export type Action =
  | 'jump' | 'crouch' | 'interact' | 'throw' | 'drop' | 'dropRelic' | 'torch' | 'refuel' | 'map' | 'pause' | 'debug';

const KEY_ACTIONS: Record<string, Action> = {
  Space: 'jump',
  KeyC: 'crouch',
  KeyE: 'interact',
  KeyG: 'drop',
  KeyQ: 'dropRelic',
  KeyF: 'torch',
  KeyR: 'refuel',
  KeyM: 'map',
  Tab: 'map',
  Escape: 'pause',
  KeyP: 'pause',
  F3: 'debug',
};

/** Standard-mapping gamepad buttons. */
const PAD_ACTIONS: Record<number, Action> = {
  0: 'jump', // A
  1: 'crouch', // B
  2: 'interact', // X
  3: 'torch', // Y
  4: 'dropRelic', // LB
  5: 'drop', // RB
  7: 'throw', // RT
  8: 'map', // Back
  9: 'pause', // Start
  12: 'refuel', // D-pad up
};

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<Action>();
  private mouseDX = 0;
  private mouseDY = 0;
  private padPrev: boolean[] = [];
  private padHeld: boolean[] = [];
  private padLookX = 0;
  private padLookY = 0;
  private padMoveX = 0;
  private padMoveZ = 0;
  private padSprint = false;
  locked = false;
  /** True once any gamepad input has been seen. */
  gamepadActive = false;
  /** Scripted input for automated playtests (overrides devices when set). */
  script: { moveX: number; moveZ: number; sprint: boolean; crouch: boolean } | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;
  /** Called on the first user gesture (to unlock audio). */
  onGesture: (() => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      this.onGesture?.();
      if (!this.locked) return;
      if (e.button === 0) this.pressed.add('throw');
      if (e.button === 2) this.pressed.add('drop');
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.keys.clear();
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
    });
  }

  private keyDown(e: KeyboardEvent): void {
    this.onGesture?.();
    if (e.code === 'Tab' || e.code === 'F3' || (this.locked && e.code === 'Space')) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    const a = KEY_ACTIONS[e.code];
    if (a) this.pressed.add(a);
  }

  requestLock(): void {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      // Pointer lock is unavailable (headless / embedded): the game still runs.
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** Read the gamepad. Call once per frame. */
  poll(): void {
    this.padLookX = this.padLookY = this.padMoveX = this.padMoveZ = 0;
    this.padSprint = false;
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const dz = (v: number): number => {
        const a = Math.abs(v);
        return a < 0.16 ? 0 : (Math.sign(v) * (a - 0.16)) / 0.84;
      };
      const mx = dz(pad.axes[0] ?? 0);
      const mz = dz(pad.axes[1] ?? 0);
      const lx = dz(pad.axes[2] ?? 0);
      const ly = dz(pad.axes[3] ?? 0);
      if (mx || mz || lx || ly) this.gamepadActive = true;
      this.padMoveX = mx;
      this.padMoveZ = -mz;
      this.padLookX = lx;
      this.padLookY = ly;
      this.padSprint = !!pad.buttons[6]?.pressed || !!pad.buttons[10]?.pressed;
      pad.buttons.forEach((b, i) => {
        const was = this.padPrev[i] ?? false;
        if (b.pressed && !was) {
          this.gamepadActive = true;
          this.onGesture?.();
          const a = PAD_ACTIONS[i];
          if (a) this.pressed.add(a);
        }
        this.padPrev[i] = b.pressed;
        this.padHeld[i] = b.pressed;
      });
      break;
    }
  }

  /** Strafe axis: -1 left .. +1 right. */
  get moveX(): number {
    if (this.script) return this.script.moveX;
    let v = this.padMoveX;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) v += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) v -= 1;
    return Math.max(-1, Math.min(1, v));
  }

  /** Forward axis: -1 back .. +1 forward. */
  get moveZ(): number {
    if (this.script) return this.script.moveZ;
    let v = this.padMoveZ;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) v += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) v -= 1;
    return Math.max(-1, Math.min(1, v));
  }

  get sprint(): boolean {
    if (this.script) return this.script.sprint;
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.padSprint;
  }

  get crouchHeld(): boolean {
    if (this.script) return this.script.crouch;
    return this.keys.has('ControlLeft') || this.keys.has('ControlRight');
  }

  get jumpHeld(): boolean {
    return this.keys.has('Space') || this.padHeld[0] === true;
  }

  /** E (or pad X) is being held down. */
  get interactHeld(): boolean {
    return this.keys.has('KeyE') || this.padHeld[2] === true;
  }

  /** Mouse look delta in pixels since the last call (cleared on read). */
  takeMouse(): { dx: number; dy: number } {
    const out = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = this.mouseDY = 0;
    return out;
  }

  /** Right-stick look rate, -1..1 on each axis. */
  get padLook(): { x: number; y: number } {
    return { x: this.padLookX, y: this.padLookY };
  }

  /** Consume a one-shot action. */
  take(a: Action): boolean {
    if (!this.pressed.has(a)) return false;
    this.pressed.delete(a);
    return true;
  }

  /** Inject an action (automated playtests, on-screen buttons). */
  press(a: Action): void {
    this.pressed.add(a);
  }

  clearPressed(): void {
    this.pressed.clear();
  }
}
