import { Physics } from './world/Physics';
import { Game } from './core/Game';

const status = (s: string) => { const el = document.getElementById('loadText'); if (el) el.textContent = s; };

(async () => {
  try {
    status('Waking the physics…');
    await Physics.init();
    const game = new Game();
    await game.boot(status);
  } catch (e) {
    console.error(e);
    status(`Failed to start: ${(e as Error).message}`);
  }
})();
