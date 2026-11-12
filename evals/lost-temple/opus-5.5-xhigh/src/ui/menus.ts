/**
 * Menus: main menu, pause, settings, outfitter (shop), high scores, controls, results
 * and the loading veil. Plain DOM over the canvas.
 */
import { UPGRADES, upgradeCost, buyUpgrade, type Quality, type UpgradeId } from '../logic/meta';
import { formatClock } from '../logic/clock';
import { SCENES } from '../logic/unlocks';
import type { Game, RunReport } from '../game/Game';

type Screen = 'main' | 'pause' | 'settings' | 'shop' | 'scores' | 'controls' | 'results' | 'loading' | null;

const CONTROLS: [string, string, string][] = [
  ['Move / look', 'WASD / mouse', 'Left / right stick'],
  ['Sprint', 'Shift', 'LB or L3'],
  ['Jump / mantle a ledge', 'Space', 'A'],
  ['Crouch (dodge darts, sneak, brace in wind)', 'C or Ctrl', 'B'],
  ['Climb vines', 'Walk into them, Space at the top', 'Stick'],
  ['Interact / take / swap / use key / kick', 'E (some actions: hold E)', 'X'],
  ['Grab / release object in hands', 'F or right mouse', 'Y'],
  ['Throw held object', 'Left mouse', 'RT'],
  ['Drop last relic from satchel (or drop held)', 'Q', 'D-pad down'],
  ['Douse / relight torch (or light a spare)', 'T', 'RB'],
  ['Refuel torch with an oil flask', 'R', ''],
  ['Mount a spare torch in a sconce', 'E at a sconce', 'X'],
  ['Map', 'M', 'View'],
  ['Pause', 'Esc', 'Start'],
  ['Debug overlay / warp panel', 'F3 / F4', ''],
];

const OUTCOME_TITLE: Record<string, string> = {
  escaped: 'You made it out',
  caught: 'Caught',
  killed: 'Dead',
  sealed: 'Sealed inside',
  abandoned: 'Expedition abandoned',
};

export class Menus {
  private root: HTMLDivElement;
  private screen: Screen = null;
  private back: Screen = 'main';
  private panels = new Map<Exclude<Screen, null>, HTMLDivElement>();

  constructor(private game: Game, parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'menus';
    parent.appendChild(this.root);
    for (const s of ['main', 'pause', 'settings', 'shop', 'scores', 'controls', 'results', 'loading'] as const) {
      const d = document.createElement('div');
      d.className = `panel panel-${s} hidden`;
      this.root.appendChild(d);
      this.panels.set(s, d);
    }
    this.renderLoading('Waking the temple...');
    this.open('loading');
  }

  private open(s: Screen) {
    this.screen = s;
    for (const [k, d] of this.panels) d.classList.toggle('hidden', k !== s);
    this.root.classList.toggle('dim', s !== null && s !== 'loading');
    this.root.classList.toggle('hidden', s === null);
  }

  hideAll() {
    this.open(null);
  }

  // ------------------------------------------------------------ helpers

  private button(parent: HTMLElement, label: string, fn: () => void, cls = '') {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.onclick = () => {
      this.game.audio.start();
      this.game.audio.click();
      fn();
    };
    parent.appendChild(b);
    return b;
  }

  private header(p: HTMLElement, title: string, sub?: string) {
    p.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = title;
    p.appendChild(h);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'sub';
      s.textContent = sub;
      p.appendChild(s);
    }
  }

  // ------------------------------------------------------------ screens

  renderLoading(text: string) {
    const p = this.panels.get('loading')!;
    p.innerHTML = `<div class="loading"><div class="spinner"></div><div>${text}</div></div>`;
  }

  showLoading(text: string) {
    this.renderLoading(text);
    this.open('loading');
  }

  showMain() {
    const g = this.game;
    const p = this.panels.get('main')!;
    p.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'title';
    t.innerHTML = '<div class="t-small">a relic heist</div><h1>The Lost Temple</h1><div class="t-tag">Get in at dawn. Get out before dark.</div>';
    p.appendChild(t);
    const bank = document.createElement('div');
    bank.className = 'bank';
    bank.textContent = `Bank $${g.save.bank.toLocaleString()}   ·   ${g.save.runs} expedition${g.save.runs === 1 ? '' : 's'}`;
    p.appendChild(bank);
    const col = document.createElement('div');
    col.className = 'col';
    p.appendChild(col);
    this.button(col, 'Begin expedition', () => this.startRun(), 'primary');
    this.button(col, 'Outfitter (shop)', () => this.showShop('main'));
    this.button(col, 'High scores', () => this.showScores('main'));
    this.button(col, 'Settings', () => this.showSettings('main'));
    this.button(col, 'Controls', () => this.showControls('main'));
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Click the game to capture the mouse. Headphones recommended: the guardians are easier to hear than to see.';
    p.appendChild(hint);
    this.open('main');
  }

  startRun() {
    const g = this.game;
    this.showLoading('Hacking through the jungle...');
    g.audio.start();
    // let the veil paint before the synchronous scene build
    setTimeout(() => {
      g.newRun(true);
      this.hideAll();
    }, 40);
  }

  showPause() {
    const p = this.panels.get('pause')!;
    this.header(p, 'Paused');
    const g = this.game;
    const info = document.createElement('div');
    info.className = 'sub';
    info.textContent = `${SCENES[g.scenes.current].name}  ·  ${formatClock(Math.max(0, g.clock.timeLeft))} until dark  ·  carrying $${g.run.carriedValue()}  ·  secured $${g.run.stashValue()}`;
    p.appendChild(info);
    const col = document.createElement('div');
    col.className = 'col';
    p.appendChild(col);
    this.button(col, 'Resume', () => g.resume(), 'primary');
    this.button(col, 'Settings', () => this.showSettings('pause'));
    this.button(col, 'Controls', () => this.showControls('pause'));
    this.button(col, 'Abandon expedition (lose what you carry)', () => g.abandon(), 'danger');
    this.open('pause');
  }

  private backButton(p: HTMLElement, from: Screen) {
    this.button(p, 'Back', () => {
      if (from === 'pause') this.showPause();
      else if (from === 'results' && this.game.lastReport) this.showResults(this.game.lastReport);
      else this.showMain();
    });
  }

  showSettings(from: Screen) {
    const g = this.game;
    const s = g.settings;
    const p = this.panels.get('settings')!;
    this.header(p, 'Settings');
    const form = document.createElement('div');
    form.className = 'form';
    p.appendChild(form);
    const slider = (label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, on: (v: number) => void) => {
      const row = document.createElement('label');
      row.className = 'row';
      const l = document.createElement('span');
      l.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.min = String(min);
      inp.max = String(max);
      inp.step = String(step);
      inp.value = String(value);
      const v = document.createElement('span');
      v.className = 'val';
      v.textContent = fmt(value);
      inp.oninput = () => {
        const x = Number(inp.value);
        v.textContent = fmt(x);
        on(x);
      };
      row.append(l, inp, v);
      form.appendChild(row);
    };
    const check = (label: string, value: boolean, on: (v: boolean) => void) => {
      const row = document.createElement('label');
      row.className = 'row';
      const l = document.createElement('span');
      l.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = value;
      inp.onchange = () => on(inp.checked);
      row.append(l, inp, document.createElement('span'));
      form.appendChild(row);
    };
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    slider('Field of view', 60, 100, 1, s.fov, (v) => `${v}°`, (v) => g.updateSettings({ fov: v }));
    slider('Mouse sensitivity', 0.2, 3, 0.05, s.sensitivity, (v) => v.toFixed(2), (v) => g.updateSettings({ sensitivity: v }));
    check('Invert mouse Y', s.invertY, (v) => g.updateSettings({ invertY: v }));
    slider('Master volume', 0, 1, 0.01, s.masterVolume, pct, (v) => g.updateSettings({ masterVolume: v }));
    slider('Music volume', 0, 1, 0.01, s.musicVolume, pct, (v) => g.updateSettings({ musicVolume: v }));
    slider('Effects volume', 0, 1, 0.01, s.sfxVolume, pct, (v) => g.updateSettings({ sfxVolume: v }));
    const qrow = document.createElement('label');
    qrow.className = 'row';
    const ql = document.createElement('span');
    ql.textContent = 'Graphics quality';
    const sel = document.createElement('select');
    for (const q of ['low', 'medium', 'high'] as Quality[]) {
      const o = document.createElement('option');
      o.value = q;
      o.textContent = q === 'low' ? 'Low (0.75x res, 1k sun shadows)' : q === 'medium' ? 'Medium (2k sun, 512 torch shadows)' : 'High (2k sun, 1k torch, MSAA 4x)';
      if (q === s.quality) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => g.updateSettings({ quality: sel.value as Quality });
    qrow.append(ql, sel, document.createElement('span'));
    form.appendChild(qrow);
    check('Show FPS counter', s.showFps, (v) => g.updateSettings({ showFps: v }));
    const note = document.createElement('div');
    note.className = 'hint';
    note.textContent = 'Vegetation density follows the quality preset for scenes built after the change.';
    p.appendChild(note);
    this.backButton(p, from);
    this.open('settings');
  }

  showShop(from: Screen) {
    const g = this.game;
    const p = this.panels.get('shop')!;
    this.header(p, 'The Outfitter', `Bank $${g.save.bank.toLocaleString()}. Gear applies from your next expedition.`);
    const list = document.createElement('div');
    list.className = 'shop';
    p.appendChild(list);
    for (const u of UPGRADES) {
      const lvl = g.save.upgrades[u.id];
      const cost = upgradeCost(g.save, u.id);
      const row = document.createElement('div');
      row.className = 'shop-row';
      const pips = u.costs.map((_, i) => `<span class="pip ${i < lvl ? 'on' : ''}"></span>`).join('');
      row.innerHTML = `<div class="shop-name">${u.name} <span class="pips">${pips}</span></div><div class="shop-now">Now: ${u.describe(lvl)}</div>${cost !== null ? `<div class="shop-next">Next: ${u.describe(lvl + 1)}</div>` : '<div class="shop-next">Fully upgraded</div>'}`;
      if (cost !== null) {
        const b = this.button(row, `Buy  $${cost.toLocaleString()}`, () => this.buy(u.id, from), g.save.bank >= cost ? 'buy' : 'buy disabled');
        if (g.save.bank < cost) b.disabled = true;
      }
      list.appendChild(row);
    }
    this.backButton(p, from);
    this.open('shop');
  }

  private buy(id: UpgradeId, from: Screen) {
    const g = this.game;
    const r = buyUpgrade(g.save, id);
    if (r.ok) {
      g.setSave(r.save);
      g.audio.stash(2);
    } else g.audio.denied();
    this.showShop(from);
  }

  showScores(from: Screen) {
    const g = this.game;
    const p = this.panels.get('scores')!;
    this.header(p, 'High Scores', `Total earned $${g.save.totalEarned.toLocaleString()} over ${g.save.runs} expedition${g.save.runs === 1 ? '' : 's'}`);
    const t = document.createElement('table');
    t.className = 'scores';
    t.innerHTML = '<tr><th>#</th><th>Haul</th><th>Outcome</th><th>Time</th><th>Relics out</th><th>Deepest</th><th>Date</th></tr>';
    g.save.highScores.forEach((e, i) => {
      const tr = document.createElement('tr');
      tr.className = 'o-' + e.outcome;
      tr.innerHTML = `<td>${i + 1}</td><td>$${e.haul.toLocaleString()}</td><td>${e.outcome}</td><td>${formatClock(e.timeSurvived)}</td><td>${e.relics}</td><td>${e.deepest}</td><td>${new Date(e.date).toLocaleDateString()}</td>`;
      t.appendChild(tr);
    });
    if (!g.save.highScores.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="7" class="empty">No expeditions yet.</td>';
      t.appendChild(tr);
    }
    p.appendChild(t);
    this.backButton(p, from);
    this.open('scores');
  }

  showControls(from: Screen) {
    const p = this.panels.get('controls')!;
    this.header(p, 'Controls');
    const t = document.createElement('table');
    t.className = 'controls';
    t.innerHTML = '<tr><th>Action</th><th>Keyboard / mouse</th><th>Gamepad</th></tr>' + CONTROLS.map(([a, k, pad]) => `<tr><td>${a}</td><td>${k}</td><td>${pad}</td></tr>`).join('');
    p.appendChild(t);
    const tips = document.createElement('div');
    tips.className = 'hint';
    tips.innerHTML =
      'Loot only counts once you carry it out of the great door (it is stashed at camp automatically). Heavy loot slows you and drains stamina.<br>' +
      'Trapped pedestals are weight plates: hold something of similar weight (F) and press E on the relic to swap it.<br>' +
      'At darkness the guardians wake deepest-first and the door closes 75 s later. Sentinels see torchlight, crawlers hear noise, shades fear light.';
    p.appendChild(tips);
    this.backButton(p, from);
    this.open('controls');
  }

  showResults(r: RunReport) {
    const g = this.game;
    const p = this.panels.get('results')!;
    const s = r.settlement;
    this.header(p, OUTCOME_TITLE[r.outcome] ?? r.outcome, r.cause);
    p.classList.toggle('won', s.escaped);
    const box = document.createElement('div');
    box.className = 'results';
    const rows: [string, string][] = [
      ['Secured at camp', `$${s.securedValue.toLocaleString()}`],
      [s.escaped ? 'Carried out' : 'Lost with you', `${s.escaped ? '+' : '−'}$${s.carriedValue.toLocaleString()}`],
      ['Haul', `$${s.haul.toLocaleString()}`],
      ['Relics carried out', String(s.relicsOut)],
      ['Relics found', String(r.relicsFound)],
      ['Time in the jungle', formatClock(r.time)],
      ['Deepest scene', SCENES[r.deepest].name],
      ['Bank', `$${r.bankBefore.toLocaleString()} → $${r.bankAfter.toLocaleString()}`],
    ];
    box.innerHTML = rows.map(([a, b], i) => `<div class="rrow ${i === 2 ? 'big' : ''}"><span>${a}</span><span>${b}</span></div>`).join('');
    if (r.rank >= 0) box.innerHTML += `<div class="rank">New high score: #${r.rank + 1}</div>`;
    if (r.newGhost) box.innerHTML += `<div class="rank">Your route is saved as the ghost to beat.</div>`;
    p.appendChild(box);
    const col = document.createElement('div');
    col.className = 'row-buttons';
    p.appendChild(col);
    this.button(col, 'Next expedition', () => this.startRun(), 'primary');
    this.button(col, 'Outfitter', () => this.showShop('results'));
    this.button(col, 'High scores', () => this.showScores('results'));
    this.button(col, 'Main menu', () => {
      g.newRun(false);
      this.showMain();
    });
    this.open('results');
  }
}
