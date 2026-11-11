import './style.css';
import { Game } from './game/Game';
import { DAY_LENGTH } from './core/clock';

declare global { interface Window { __lt?: Record<string, unknown>; } }

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const loading = document.getElementById('loading')!;
  try {
    const game = await Game.create(canvas);
    loading.remove();
    game.start();
    // Console and test hook. Nothing in the game itself depends on it.
    window.__lt = {
      game,
      DAY_LENGTH,
      /** Start a run without pointer lock (headless browsers cannot lock the pointer). */
      start: (seed?: number) => { game.input.virtualLock = true; game.startRun(seed); },
      teleport: (x: number, y: number, z: number) => game.teleport(x, y, z),
      setTime: (t: number) => { game.run.time = t; },
      simulate: (s: number) => game.simulate(s),
      god: (on = true) => { game.godMode = on; },
      look: (yaw: number, pitch = 0) => { game.player.yaw = yaw; game.player.pitch = pitch; },
      press: (code: string) => game.input.press(code),
      release: (code: string) => game.input.release(code),
    };
  } catch (err) {
    loading.textContent = `The temple failed to open: ${(err as Error).message}`;
    throw err;
  }
}

void boot();
