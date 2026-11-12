/** The DOM side of the game: HUD, menus, map, debug overlay. */
import type { Game, GameState, ToastKind, UiBridge } from '../game/game';
import { DebugOverlay } from './debug';
import { Hud } from './hud';
import { MapView } from './map';
import { Menus } from './menus';

export class Ui implements UiBridge {
  private readonly hud: Hud;
  private readonly menus: Menus;
  private readonly map: MapView;
  private readonly debug: DebugOverlay;

  constructor(
    private readonly game: Game,
    root: HTMLElement,
  ) {
    this.hud = new Hud(game);
    this.map = new MapView(game);
    this.menus = new Menus(game);
    this.debug = new DebugOverlay(game);
    root.append(this.hud.root, this.map.root, this.menus.root, this.debug.root);
    // If the browser refused the pointer lock (Esc was just pressed), a click takes it.
    game.canvas.addEventListener('click', () => {
      if (game.state === 'playing' && !game.input.locked && !game.autoplay) game.input.requestLock();
    });
  }

  toast(text: string, kind: ToastKind): void {
    this.hud.toast(text, kind);
  }

  banner(title: string, sub: string): void {
    this.hud.banner(title, sub);
  }

  hurt(amount: number): void {
    this.hud.hurt(amount);
  }

  stateChanged(state: GameState, prev: GameState): void {
    if (state === 'playing' && prev !== 'paused') this.hud.reset();
    this.hud.setVisible(state === 'playing' || state === 'ending' || state === 'paused');
    this.menus.onState(state);
  }

  frame(dt: number): void {
    this.hud.update(dt);
    this.map.update(dt);
    this.menus.update(dt);
    this.debug.update(dt);
  }
}
