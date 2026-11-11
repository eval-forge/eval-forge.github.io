/**
 * Entry point: boot Rapier, build the game, show the menu over a dawn jungle backdrop.
 */
import './ui/styles.css';
import { Game } from './game/Game';

async function boot() {
  const app = document.getElementById('app')!;
  let game: Game;
  try {
    game = await Game.create(app);
  } catch (e) {
    app.innerHTML = `<div class="fatal">Could not start the game (WebGL or WebAssembly unavailable).<br><small>${String(e)}</small></div>`;
    throw e;
  }
  (window as any).__game = game;
  game.start();
  // build the menu backdrop after the loading veil has painted
  setTimeout(() => {
    game.newRun(false);
    game.menus.showMain();
  }, 30);
}

boot();
