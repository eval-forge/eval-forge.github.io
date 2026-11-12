/**
 * Entry point: build the game, boot it, and show a readable error instead of a black screen
 * when WebGL or WebAssembly is missing.
 */
import './ui/styles.css';
import { Game } from './game/Game';

function showFatal(err: unknown) {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'fatal';
  const msg = err instanceof Error ? err.message : String(err);
  box.innerHTML =
    '<h2>The temple would not open</h2>' +
    '<p>Something failed while starting the game. The Lost Temple needs a browser with WebGL 2 and WebAssembly ' +
    '(a recent Chrome, Edge or Firefox).</p>';
  const pre = document.createElement('pre');
  pre.textContent = msg;
  box.appendChild(pre);
  document.body.appendChild(box);
}

const app = document.getElementById('app');
if (!app) {
  showFatal(new Error('missing #app element'));
} else {
  try {
    const game = new Game(app);
    game.boot().catch(showFatal);
  } catch (e) {
    showFatal(e);
  }
}
