import { initRapier } from './core/Physics';
import { Game } from './core/Game';
import './style.css';

async function boot() {
  const app = document.getElementById('app')!;
  const status = document.getElementById('boot-status');
  try {
    await initRapier();
    status?.remove();
    new Game(app);
  } catch (e) {
    console.error(e);
    if (status) status.textContent = 'Failed to start: ' + (e as Error).message;
  }
}
boot();
