import { DAY_LENGTH, formatTime } from '../core/clock';
import { UPGRADES, buyUpgrade, maxLevel, upgradeCost, type UpgradeId } from '../core/economy';
import type { Settings } from '../core/save';
import type { Game } from '../game/Game';
import { el, fmtGold } from './dom';

export type Screen = 'main' | 'pause' | 'settings' | 'shop' | 'scores' | 'help' | 'results';

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'], ['Mouse', 'Look'], ['Shift', 'Run (burns stamina)'], ['Space', 'Jump, mantle ledges, kick off vines'],
  ['C / Ctrl', 'Crouch: quiet, and steady in wind'], ['E', 'Interact: take, turn, pull, kick, place torch'],
  ['F', 'Light or stow the torch'], ['R', 'Pour an oil flask into the torch'], ['T', 'Swap to a spare torch'],
  ['G', 'Drop the last relic out of the satchel'], ['Left click', 'Throw what you are holding'], ['Right click / Q', 'Put it down'],
  ['M / Tab', 'Map'], ['Esc / P', 'Pause'], ['F3', 'Debug overlay'],
];

/** Main menu, pause, settings, shop, high scores, how to play and the results screen. */
export class Menus {
  private root: HTMLElement;
  private panel: HTMLElement;
  current: Screen | null = null;
  private back: Screen = 'main';

  constructor(private game: Game) {
    this.root = el('div', 'menu', document.getElementById('ui'));
    this.panel = el('div', 'panel', this.root);
  }

  hide(): void { this.root.style.display = 'none'; this.current = null; }

  show(screen: Screen): void {
    this.root.style.display = '';
    this.root.className = `menu menu-${screen}`;
    this.current = screen;
    this.panel.innerHTML = '';
    if (screen === 'main' || screen === 'pause' || screen === 'results') this.back = screen;
    this[screen]();
  }

  private button(parent: HTMLElement, label: string, fn: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', `btn ${cls}`, parent, label);
    b.addEventListener('click', () => { this.game.audio.resume(); this.game.audio.play('ui'); fn(); });
    return b;
  }

  private title(text: string, sub?: string): void {
    el('h1', '', this.panel, text);
    if (sub) el('p', 'sub', this.panel, sub);
  }

  private main(): void {
    const g = this.game;
    el('div', 'kicker', this.panel, 'A relic heist in one day');
    this.title('THE LOST TEMPLE', 'Arrive at dawn. Go as deep as you dare. Be out of the Great Door before the sun is gone, because at dark the guardians wake.');
    const col = el('div', 'col', this.panel);
    this.button(col, 'Begin the expedition', () => g.startRun(), 'primary');
    this.button(col, `Outfitter  ·  ${fmtGold(g.save.gold)} gold`, () => this.show('shop'));
    this.button(col, 'High scores', () => this.show('scores'));
    this.button(col, 'Settings', () => this.show('settings'));
    this.button(col, 'How to play', () => this.show('help'));
    el('p', 'foot', this.panel, `Expeditions so far: ${g.save.runs}${g.save.ghost ? `  ·  best haul ${fmtGold(g.save.ghost.value)} (its ghost runs beside you)` : ''}`);
  }

  private pause(): void {
    const g = this.game;
    this.title('Paused', g.objective());
    const col = el('div', 'col', this.panel);
    this.button(col, 'Resume', () => g.resume(), 'primary');
    this.button(col, 'Settings', () => this.show('settings'));
    this.button(col, 'How to play', () => this.show('help'));
    this.button(col, 'Abandon the expedition', () => g.toMenu(), 'danger');
    el('p', 'foot', this.panel, 'Abandoning loses everything in the satchel.');
  }

  private settings(): void {
    const g = this.game, s = g.save.settings;
    this.title('Settings');
    const grid = el('div', 'settings', this.panel);
    const slider = (label: string, key: 'fov' | 'sensitivity' | 'volume', min: number, max: number, step: number, fmt: (v: number) => string) => {
      const row = el('label', 'row', grid);
      el('span', 'name', row, label);
      const input = el('input', '', row); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(s[key]);
      const val = el('span', 'val', row, fmt(s[key]));
      input.addEventListener('input', () => { s[key] = Number(input.value); val.textContent = fmt(s[key]); g.applySettings(); });
      input.addEventListener('change', () => g.saveNow());
    };
    slider('Field of view', 'fov', 55, 110, 1, (v) => `${v}°`);
    slider('Mouse sensitivity', 'sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2));
    slider('Volume', 'volume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`);
    const qrow = el('label', 'row', grid);
    el('span', 'name', qrow, 'Graphics quality');
    const sel = el('select', '', qrow);
    for (const q of ['low', 'medium', 'high'] as Settings['quality'][]) { const o = el('option', '', sel, q[0].toUpperCase() + q.slice(1)); o.value = q; }
    sel.value = s.quality;
    el('span', 'val', qrow, '');
    sel.addEventListener('change', () => { s.quality = sel.value as Settings['quality']; g.applySettings(); g.saveNow(); });
    const irow = el('label', 'row', grid);
    el('span', 'name', irow, 'Invert vertical look');
    const cb = el('input', '', irow); cb.type = 'checkbox'; cb.checked = s.invertY;
    el('span', 'val', irow, '');
    cb.addEventListener('change', () => { s.invertY = cb.checked; g.saveNow(); });
    el('p', 'foot', this.panel, 'Quality changes shadow resolution and range, render scale and swarm size. Shadows stay on at every level. A gamepad works too: sticks move and look, A jumps, X interacts, Y is the torch.');
    this.button(el('div', 'col', this.panel), 'Back', () => this.show(this.back));
  }

  private shop(): void {
    const g = this.game;
    this.title('Outfitter', `You have ${fmtGold(g.save.gold)} gold. Gear is kept between expeditions.`);
    const list = el('div', 'shop', this.panel);
    for (const u of UPGRADES) {
      const lvl = g.save.upgrades[u.id as UpgradeId], cost = upgradeCost(u.id, lvl);
      const row = el('div', 'shop-row', list);
      const info = el('div', 'shop-info', row);
      el('div', 'shop-name', info, `${u.name}  ·  level ${lvl} / ${maxLevel(u.id)}`);
      el('div', 'shop-desc', info, `${u.desc} Now: ${u.levels[lvl]}.${cost !== null ? ` Next: ${u.levels[lvl + 1]}.` : ''}`);
      const b = this.button(row, cost === null ? 'Owned' : `Buy  ·  ${fmtGold(cost)}`, () => {
        if (buyUpgrade(g.save, u.id)) { g.audio.play('buy'); g.saveNow(); this.show('shop'); } else g.audio.play('deny');
      });
      b.disabled = cost === null || g.save.gold < cost;
    }
    this.button(el('div', 'col', this.panel), 'Back', () => this.show(this.back));
  }

  private scores(): void {
    const g = this.game;
    this.title('High scores', 'Only what was carried out of the Great Door counts.');
    const t = el('table', 'scores', this.panel);
    const head = el('tr', '', t);
    for (const h of ['#', 'Haul', 'Relics', 'Left the temple at', 'Date']) el('th', '', head, h);
    if (!g.save.scores.length) { const r = el('tr', '', t); const c = el('td', 'empty', r, 'Nobody has made it out yet.'); c.colSpan = 5; }
    g.save.scores.forEach((s, i) => {
      const r = el('tr', '', t);
      el('td', '', r, String(i + 1)); el('td', 'gold', r, fmtGold(s.value)); el('td', '', r, String(s.relics));
      el('td', '', r, `${formatTime(s.time)} after dawn`); el('td', '', r, s.date.slice(0, 10));
    });
    this.button(el('div', 'col', this.panel), 'Back', () => this.show(this.back));
  }

  private help(): void {
    this.title('How to play');
    const wrap = el('div', 'help', this.panel);
    const keys = el('div', 'keys', wrap);
    for (const [k, d] of CONTROLS) { const r = el('div', 'key-row', keys); el('span', 'key', r, k); el('span', '', r, d); }
    const tips = el('ul', 'tips', wrap);
    for (const t of [
      'The day is 13 minutes long. The stone sundial at the top of the screen is your only clock underground.',
      'Deeper relics are worth more and weigh more. Weight slows you and drains stamina faster.',
      'Trapped pedestals wear a gold ring. Carry a stone of about the same weight and swap it in.',
      'Below the sun seal there is no light at all except your torch. Water, wind gusts and long falls put it out.',
      'Leave spare torches in wall sconces to light your way back.',
      'Scarabs swarm wherever the hall floor is in shadow. The sunlit lanes move with the sun.',
      'At sunset the guardians wake in the deepest rooms and sweep toward the door. Sentinels see, crawlers hear, shades hate light.',
      'Only what you carry out through the Great Door is banked. Getting caught loses the lot.',
    ]) el('li', '', tips, t);
    this.button(el('div', 'col', this.panel), 'Back', () => this.show(this.back));
  }

  private results(): void {
    const g = this.game, r = g.lastResult;
    if (!r) { this.show('main'); return; }
    const titles = { escaped: 'You made it out', caught: 'The guardians took you', killed: 'The temple killed you', entombed: 'Sealed in the dark' } as const;
    const sub = r.outcome === 'escaped'
      ? (r.cause.startsWith('outside') ? 'Night fell with you still outside. You keep what you found out there.' : r.time >= DAY_LENGTH ? 'Under the falling door with the dark at your heels.' : r.time > DAY_LENGTH * 0.6 ? 'Out through the Great Door with the sun going down behind you.' : 'Out through the Great Door with daylight to spare.')
      : `Cause: ${r.cause}. Everything in the satchel is lost.`;
    this.root.classList.add(r.outcome === 'escaped' ? 'good' : 'bad');
    this.title(titles[r.outcome], sub);
    const stats = el('div', 'stats', this.panel);
    const stat = (k: string, v: string, cls = '') => { const s = el('div', `stat ${cls}`, stats); el('div', 'stat-v', s, v); el('div', 'stat-k', s, k); };
    stat('Haul banked', `${fmtGold(r.value)} gold`, 'big');
    stat(r.outcome === 'escaped' ? 'Time' : 'Lasted', `${formatTime(r.time)} after dawn`);
    stat('Relics found', `${r.found} of ${r.total}`);
    stat('Deepest find', r.deepest);
    if (r.outcome !== 'escaped') stat('Lost with you', `${fmtGold(r.lost)} gold`);
    stat('Damage taken', String(r.damage));
    stat('Traps sprung', String(r.traps));
    if (r.rank >= 0) el('p', 'rank', this.panel, `Rank ${r.rank + 1} on the high-score table.${r.best ? ' New best haul: its ghost will run beside you next time.' : ''}`);
    if (r.relics.length) {
      const list = el('div', 'relic-list', this.panel);
      for (const it of r.relics) { const row = el('div', `relic-row${r.outcome === 'escaped' ? '' : ' lost'}`, list); el('span', '', row, it.name); el('span', 'gold', row, `${fmtGold(it.value)}  ·  ${it.weight.toFixed(1)} kg`); }
    }
    const col = el('div', 'col wide', this.panel);
    this.button(col, 'Go again at dawn', () => g.startRun(), 'primary');
    this.button(col, `Outfitter  ·  ${fmtGold(r.gold)} gold`, () => this.show('shop'));
    this.button(col, 'High scores', () => this.show('scores'));
    this.button(col, 'Main menu', () => g.toMenu());
  }
}
