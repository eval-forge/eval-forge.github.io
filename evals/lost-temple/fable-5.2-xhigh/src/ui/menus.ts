/**
 * Menus: main, pause, results, shop, high scores, settings, how to play.
 * A small stack of cards over a veil; mouse, keyboard and gamepad all work.
 */
import { formatClock } from '../core/clock';
import { GEAR, GEAR_ORDER, RARITY_COLOR, RELIC_BY_ID, gearMaxed, gearValue, nextPrice, type GearId } from '../core/economy';
import type { Outcome, Quality, Settings } from '../core/save';
import type { Game, GameState } from '../game/game';
import { button, clear, el, num } from './dom';

type Card = 'main' | 'pause' | 'results' | 'shop' | 'scores' | 'settings' | 'help';

const OUTCOME_HEAD: Record<Outcome, string> = {
  escaped: 'You got out',
  caught: 'Caught',
  died: 'Dead',
  entombed: 'Entombed',
  abandoned: 'Abandoned',
};

export class Menus {
  readonly root = el('div', 'menus');
  private readonly cards = new Map<Card, HTMLElement>();
  private stack: Card[] = [];
  private padPrev: boolean[] = [];
  private padAxisT = 0;

  constructor(private readonly game: Game) {
    for (const id of ['main', 'pause', 'results', 'shop', 'scores', 'settings', 'help'] as Card[]) {
      const c = el('div', `card${id === 'scores' || id === 'help' || id === 'shop' ? ' wide' : ''}`);
      this.cards.set(id, c);
      this.root.appendChild(c);
    }
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.stack.length > 1) {
        e.preventDefault();
        this.back();
      }
    });
  }

  onState(state: GameState): void {
    switch (state) {
      case 'menu':
        this.open('main', true);
        break;
      case 'paused':
        this.open('pause', true);
        break;
      case 'results':
        this.open('results', true);
        break;
      default:
        this.stack = [];
        this.render();
        break;
    }
  }

  private open(card: Card, reset = false): void {
    if (reset) this.stack = [];
    this.stack.push(card);
    this.render();
  }

  private back(): void {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.render();
    } else if (this.game.state === 'paused') {
      this.game.resume();
    }
  }

  private render(): void {
    const top = this.stack[this.stack.length - 1];
    this.root.classList.toggle('on', !!top);
    this.root.classList.toggle('veil', !!top);
    for (const [id, c] of this.cards) c.classList.toggle('on', id === top);
    if (!top) return;
    const c = this.cards.get(top)!;
    clear(c);
    switch (top) {
      case 'main':
        this.buildMain(c);
        break;
      case 'pause':
        this.buildPause(c);
        break;
      case 'results':
        this.buildResults(c);
        break;
      case 'shop':
        this.buildShop(c);
        break;
      case 'scores':
        this.buildScores(c);
        break;
      case 'settings':
        this.buildSettings(c);
        break;
      case 'help':
        this.buildHelp(c);
        break;
    }
    const first = c.querySelector<HTMLElement>('button.primary') ?? c.querySelector<HTMLElement>('button');
    first?.focus({ preventScroll: true });
  }

  private ui(): void {
    this.game.audio.unlock();
    this.game.sfx('ui');
  }

  private nav(label: string, card: Card, cls = ''): HTMLButtonElement {
    return button(label, () => {
      this.ui();
      this.open(card);
    }, cls);
  }

  private backButton(): HTMLElement {
    const row = el('div', 'btns');
    row.appendChild(button('Back', () => {
      this.ui();
      this.back();
    }));
    return row;
  }

  // ------------------------------------------------------------------ main

  private buildMain(c: HTMLElement): void {
    const d = this.game.meta.data;
    c.appendChild(el('h1', '', 'The Lost Temple'));
    c.appendChild(el('div', 'tag', 'One day. One door. Take what you can carry and be outside before dark.'));
    const purse = el('div', 'purse');
    purse.innerHTML = `Purse <b>${num(d.coins)}</b> coins &nbsp;·&nbsp; Best haul <b>${num(d.bestHaul)}</b> &nbsp;·&nbsp; ${d.escapes} escape${d.escapes === 1 ? '' : 's'} in ${d.runs} run${d.runs === 1 ? '' : 's'}`;
    c.appendChild(purse);
    const b = el('div', 'btns');
    b.append(
      button('Enter the temple', () => {
        this.ui();
        this.game.startRun();
      }, 'primary'),
      this.nav('Outfitter', 'shop'),
      this.nav('High scores', 'scores'),
      this.nav('Settings', 'settings'),
      this.nav('How to play', 'help'),
    );
    c.appendChild(b);
    c.appendChild(el('div', 'tag', 'WASD move · mouse look · E interact · F torch · full list under How to play'));
  }

  private buildPause(c: HTMLElement): void {
    const run = this.game.run;
    c.appendChild(el('h2', '', 'Paused'));
    c.appendChild(el('div', 'tag', run.clock.isDark ? `The door shuts in ${formatClock(run.clock.untilDoorShut)}.` : `${formatClock(run.clock.remaining)} of daylight left. The sun does not wait for you, but this menu does.`));
    const b = el('div', 'btns');
    b.append(
      button('Resume', () => {
        this.ui();
        this.game.resume();
      }, 'primary'),
      this.nav('Settings', 'settings'),
      this.nav('How to play', 'help'),
      button('Abandon the run', () => {
        this.ui();
        this.game.abandon();
      }, 'danger'),
    );
    c.appendChild(b);
  }

  // --------------------------------------------------------------- results

  private buildResults(c: HTMLElement): void {
    const r = this.game.result;
    if (!r) return;
    const escaped = r.outcome === 'escaped';
    c.appendChild(el('h1', `result-head ${escaped ? 'escaped' : 'lost'}`, OUTCOME_HEAD[r.outcome]));
    c.appendChild(el('div', 'epitaph', r.epitaph));
    const stats = el('div', 'stats');
    const stat = (n: string, l: string): void => {
      const s = el('div', 'stat');
      s.append(el('div', 'n', n), el('div', 'l', l));
      stats.appendChild(s);
    };
    stat(num(r.haul), 'coins banked');
    stat(formatClock(r.time), 'time inside the day');
    stat(`${r.relics.length} / ${r.relicsLifted}`, 'relics out / lifted');
    stat(r.deepest, 'deepest reached');
    c.appendChild(stats);

    if (r.relics.length > 0) {
      const t = el('table', 'grid');
      const head = el('tr');
      for (const h of ['Relic', 'Found in', 'Weight', 'Value']) head.appendChild(el('th', h === 'Weight' || h === 'Value' ? 'num' : '', h));
      t.appendChild(head);
      for (const it of r.relics.slice().sort((a, b) => b.value - a.value)) {
        const def = RELIC_BY_ID[it.relic];
        const tr = el('tr');
        const name = el('td', '', def.name);
        name.style.color = RARITY_COLOR[def.rarity];
        tr.append(name, el('td', 'muted', it.scene), el('td', 'num', `${it.weight.toFixed(1)} kg`), el('td', `num ${escaped ? 'gold' : 'bad'}`, escaped ? num(it.value) : `−${num(it.value)}`));
        t.appendChild(tr);
      }
      c.appendChild(t);
    }
    const line = el('div', 'tag');
    if (escaped) {
      line.textContent =
        r.haul === 0
          ? 'Out alive with empty pockets. The temple is unimpressed.'
          : `${r.newBest ? 'A new best haul. ' : ''}${r.rank >= 0 ? `Number ${r.rank + 1} on the table. ` : ''}Purse: ${num(r.coins)} coins.`;
    } else {
      line.textContent = r.carried > 0 ? `${num(r.carried)} coins of relics stayed in the temple. Only what leaves through the door counts.` : 'Nothing lost but the day.';
    }
    c.appendChild(line);
    const b = el('div', 'btns rowed');
    b.append(
      button('Run again', () => {
        this.ui();
        this.game.startRun();
      }, 'primary'),
      this.nav('Outfitter', 'shop'),
      this.nav('High scores', 'scores'),
      button('Main menu', () => {
        this.ui();
        this.game.toMenu();
      }),
    );
    c.appendChild(b);
  }

  // ------------------------------------------------------------------ shop

  private buildShop(c: HTMLElement): void {
    const meta = this.game.meta;
    c.appendChild(el('h2', '', 'Outfitter'));
    const purse = el('div', 'purse');
    purse.innerHTML = `Purse <b>${num(meta.data.coins)}</b> coins`;
    c.appendChild(purse);
    const t = el('table', 'grid');
    const head = el('tr');
    for (const h of ['Gear', 'Now', 'Next', 'Price', '']) head.appendChild(el('th', h === 'Price' ? 'num' : '', h));
    t.appendChild(head);
    for (const id of GEAR_ORDER) {
      const def = GEAR[id];
      const lvl = meta.data.gear[id] ?? 0;
      const maxed = gearMaxed(meta.data.gear, id);
      const price = nextPrice(meta.data.gear, id);
      const tr = el('tr');
      const name = el('td');
      name.append(el('div', 'gold', def.name), el('div', 'muted', def.blurb));
      const now = el('td', '', `${gearValue(meta.data.gear, id)} ${def.unit}`);
      const next = el('td', maxed ? 'muted' : 'good', maxed ? 'best there is' : `${def.values[lvl + 1]} ${def.unit}`);
      const cost = el('td', 'num', price === null ? '' : num(price));
      const act = el('td', 'num');
      const buy = button(maxed ? 'Owned' : 'Buy', () => this.buy(id), 'small');
      buy.disabled = maxed || price === null || meta.data.coins < price;
      act.appendChild(buy);
      tr.append(name, now, next, cost, act);
      t.appendChild(tr);
    }
    c.appendChild(t);
    c.appendChild(el('div', 'tag', 'Gear is kept between runs. Coins only come from relics carried out through the great door.'));
    c.appendChild(this.backButton());
  }

  private buy(id: GearId): void {
    const game = this.game;
    game.audio.unlock();
    if (game.meta.buy(id)) game.sfx('buy');
    else game.sfx('deny');
    this.render();
  }

  // ---------------------------------------------------------------- scores

  private buildScores(c: HTMLElement): void {
    const d = this.game.meta.data;
    c.appendChild(el('h2', '', 'High scores'));
    if (d.scores.length === 0) {
      c.appendChild(el('div', 'tag', 'No runs yet. The table is as empty as your purse.'));
    } else {
      const t = el('table', 'grid');
      const head = el('tr');
      for (const h of ['#', 'Banked', 'Carried', 'Time', 'Relics', 'Fate', 'Deepest', 'Date']) head.appendChild(el('th', ['Banked', 'Carried', 'Time', 'Relics'].includes(h) ? 'num' : '', h));
      t.appendChild(head);
      const mine = this.game.result ? this.game.result.rank : -1;
      d.scores.forEach((s, i) => {
        const tr = el('tr', i === mine ? 'me' : '');
        tr.append(
          el('td', 'muted', `${i + 1}`),
          el('td', 'num gold', num(s.haul)),
          el('td', 'num', num(s.carried)),
          el('td', 'num', formatClock(s.time)),
          el('td', 'num', `${s.relics}`),
          el('td', s.outcome === 'escaped' ? 'good' : 'bad', OUTCOME_HEAD[s.outcome]),
          el('td', '', s.deepest),
          el('td', 'muted', s.date.slice(0, 10)),
        );
        t.appendChild(tr);
      });
      c.appendChild(t);
    }
    c.appendChild(el('div', 'tag', d.ghost ? `A ghost of your best run (${num(d.ghost.haul)} coins) walks the temple. Toggle it in Settings.` : 'Escape once and a ghost of your best run will walk the temple with you.'));
    c.appendChild(this.backButton());
  }

  // -------------------------------------------------------------- settings

  private buildSettings(c: HTMLElement): void {
    const game = this.game;
    const s = game.meta.data.settings;
    c.appendChild(el('h2', '', 'Settings'));
    const apply = (patch: Partial<Settings>): void => {
      game.meta.updateSettings(patch);
      game.applySettings();
    };
    const slider = (label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, set: (v: number) => void): void => {
      const row = el('label', 'setting');
      const input = el('input');
      input.type = 'range';
      input.min = `${min}`;
      input.max = `${max}`;
      input.step = `${step}`;
      input.value = `${value}`;
      const v = el('span', 'v', fmt(value));
      input.addEventListener('input', () => {
        const n = parseFloat(input.value);
        v.textContent = fmt(n);
        set(n);
      });
      row.append(el('span', '', label), input, v);
      c.appendChild(row);
    };
    slider('Field of view', 60, 110, 1, s.fov, (v) => `${v}°`, (v) => apply({ fov: v }));
    slider('Mouse sensitivity', 0.2, 3, 0.05, s.sensitivity, (v) => v.toFixed(2), (v) => apply({ sensitivity: v }));
    slider('Volume', 0, 1, 0.01, s.volume, (v) => `${Math.round(v * 100)}%`, (v) => apply({ volume: v }));
    slider('Music', 0, 1, 0.01, s.musicVolume, (v) => `${Math.round(v * 100)}%`, (v) => apply({ musicVolume: v }));

    const qrow = el('label', 'setting');
    const sel = el('select');
    for (const q of ['low', 'medium', 'high'] as Quality[]) {
      const o = el('option', '', q[0].toUpperCase() + q.slice(1));
      o.value = q;
      o.selected = s.quality === q;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => apply({ quality: sel.value as Quality }));
    qrow.append(el('span', '', 'Graphics quality'), sel, el('span', 'v'));
    c.appendChild(qrow);

    const check = (label: string, value: boolean, set: (v: boolean) => void): void => {
      const row = el('label', 'setting');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = value;
      input.addEventListener('change', () => set(input.checked));
      const wrap = el('span');
      wrap.appendChild(input);
      row.append(el('span', '', label), wrap, el('span', 'v'));
      c.appendChild(row);
    };
    check('Invert look Y', s.invertY, (v) => apply({ invertY: v }));
    check('Show best-run ghost', s.showGhost, (v) => apply({ showGhost: v }));
    c.appendChild(el('div', 'tag', 'Quality changes shadow resolution, soft shadows, anti-aliasing, resolution scale and vegetation density (vegetation applies as scenes stream in).'));

    const b = el('div', 'btns rowed');
    let armed = false;
    const reset = button('Erase save', () => {
      if (!armed) {
        armed = true;
        reset.textContent = 'Really erase?';
        return;
      }
      game.meta.reset();
      game.sfx('deny');
      this.render();
    }, 'danger');
    b.append(
      button('Back', () => {
        this.ui();
        this.back();
      }, 'primary'),
      reset,
    );
    c.appendChild(b);
  }

  // ------------------------------------------------------------------ help

  private buildHelp(c: HTMLElement): void {
    c.appendChild(el('h2', '', 'How to play'));
    const rules = el('ul', 'rules');
    const items = [
      'The day lasts thirteen minutes. The stone sundial at the top of the screen is the only clock you can trust once you are underground.',
      'The <b>great door</b> is the only way in and the only way out. Only relics you carry out through it are banked. Stepping out ends the run.',
      'Relics weigh what they weigh. A heavy satchel slows you, shortens your jump and drains stamina faster. <kbd>Q</kbd> drops the last one.',
      'Some relics rest on <b>weighted pedestals</b>. Lift one bare-handed and the trap fires. Carry something of about the same weight (within a quarter) and press <kbd>E</kbd> to swap it.',
      'Below the halls there is <b>no light at all</b> except your torch. It burns fuel, it shrinks as it runs low, and water, wind or a hard landing will put it out. Relighting takes a moment and leaves you exposed.',
      'Spare torches can be mounted in wall sconces. They burn all night and Shades will not cross their light.',
      'At dark the guardians wake, deepest first, and sweep toward the door, which is already closing. Sentinels see torchlight. Crawlers hear footsteps. Shades fear light.',
      'Shadows in the roofless halls are not empty by day. The sundial in the courtyard reads the real sun.',
    ];
    for (const i of items) {
      const li = el('li');
      li.innerHTML = i;
      rules.appendChild(li);
    }
    c.appendChild(rules);
    const t = el('table', 'grid');
    const head = el('tr');
    for (const h of ['Action', 'Keyboard and mouse', 'Gamepad']) head.appendChild(el('th', '', h));
    t.appendChild(head);
    const rows: [string, string, string][] = [
      ['Move / look', 'W A S D / mouse', 'Left stick / right stick'],
      ['Sprint', 'Shift', 'LT or L3'],
      ['Jump, mantle, let go of a climb', 'Space', 'A'],
      ['Crouch', 'C (toggle) or Ctrl (hold)', 'B'],
      ['Interact, take, grab, swap', 'E (hold E on the sundial ring)', 'X'],
      ['Throw what you carry', 'Left mouse', 'RT'],
      ['Drop what you carry', 'Right mouse or G', 'RB'],
      ['Drop last relic', 'Q', 'LB'],
      ['Torch: strike / douse', 'F', 'Y'],
      ['Refuel torch (oil, then a spare)', 'R', 'D-pad up'],
      ['Map', 'M or Tab', 'Back'],
      ['Pause', 'Esc or P', 'Start'],
      ['Debug overlay', 'F3', ''],
    ];
    for (const r of rows) {
      const tr = el('tr');
      tr.append(el('td', '', r[0]), el('td', 'gold', r[1]), el('td', 'muted', r[2]));
      t.appendChild(tr);
    }
    c.appendChild(t);
    c.appendChild(this.backButton());
  }

  // --------------------------------------------------------------- gamepad

  /** Gamepad navigation of whatever card is open. */
  update(dt: number): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      this.padPrev.length = 0;
      return;
    }
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) return;
    const pressed = (i: number): boolean => {
      const now = !!pad!.buttons[i]?.pressed;
      const was = this.padPrev[i] ?? false;
      this.padPrev[i] = now;
      return now && !was;
    };
    const card = this.cards.get(top)!;
    const items = [...card.querySelectorAll<HTMLElement>('button:not(:disabled), input, select')];
    const cur = items.indexOf(document.activeElement as HTMLElement);
    const ay = pad.axes[1] ?? 0;
    const ax = pad.axes[0] ?? 0;
    this.padAxisT -= dt;
    let dy = 0;
    let dx = 0;
    if (pressed(12)) dy = -1;
    if (pressed(13)) dy = 1;
    if (pressed(14)) dx = -1;
    if (pressed(15)) dx = 1;
    if (this.padAxisT <= 0) {
      if (Math.abs(ay) > 0.6) {
        dy = Math.sign(ay);
        this.padAxisT = 0.22;
      } else if (Math.abs(ax) > 0.6) {
        dx = Math.sign(ax);
        this.padAxisT = 0.12;
      }
    }
    if (dy !== 0 && items.length > 0) {
      const next = items[(Math.max(0, cur) + dy + items.length) % items.length];
      next.focus({ preventScroll: false });
      this.game.sfx('ui', undefined, 0.5);
    }
    const active = document.activeElement as HTMLElement | null;
    if (dx !== 0 && active) {
      if (active instanceof HTMLInputElement && active.type === 'range') {
        const step = parseFloat(active.step || '1') * (active.max && parseFloat(active.max) > 10 ? 2 : 2);
        active.value = `${parseFloat(active.value) + dx * step}`;
        active.dispatchEvent(new Event('input'));
      } else if (active instanceof HTMLSelectElement) {
        active.selectedIndex = Math.max(0, Math.min(active.options.length - 1, active.selectedIndex + dx));
        active.dispatchEvent(new Event('change'));
      }
    }
    if (pressed(0) && active) {
      if (active instanceof HTMLInputElement && active.type === 'checkbox') {
        active.checked = !active.checked;
        active.dispatchEvent(new Event('change'));
      } else {
        active.click();
      }
    }
    if (pressed(1)) this.back();
  }
}
