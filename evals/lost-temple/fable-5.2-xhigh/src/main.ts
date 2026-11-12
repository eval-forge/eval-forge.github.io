/** Boot: physics (WASM), game, UI, first frame. */
import './ui/style.css';
import { installDebugApi } from './game/debugApi';
import { Game } from './game/game';
import { Ui } from './ui/ui';

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const root = document.getElementById('ui') as HTMLElement;
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
    storage.getItem('lostTemple.probe');
  } catch {
    storage = null; // private mode / blocked: the game runs, it just forgets
  }
  const game = await Game.create(canvas, storage);
  game.ui = new Ui(game, root);
  installDebugApi(game);
  game.boot();
  document.getElementById('boot')?.remove();
}

main().catch((err: unknown) => {
  console.error(err);
  const boot = document.getElementById('boot');
  if (boot) {
    boot.style.whiteSpace = 'pre-wrap';
    boot.style.padding = '2em';
    boot.textContent = `The temple failed to rise.\n\n${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}`;
  }
});
