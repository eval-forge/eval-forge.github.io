/**
 * Menus and screens: loading, main menu, pause, settings, outfitter (shop), high scores,
 * controls, and the end-of-run results. Plain DOM, styled by styles.css. The game talks to it
 * through a small host interface so the UI never touches the simulation.
 */
import type { SaveData, Settings, Quality } from '../logic/save';
import { SHOP, nextUpgradeCost, formatMoney, type UpgradeId } from '../logic/economy';
import type { EndReason } from '../game/RunState';

export interface UIHost {
  save: SaveData;
  startRun(): void;
  resume(): void;
  abandon(): void;
  applySettings(s: Settings): void;
  buy(id: UpgradeId): boolean;
  resetSave(): void;
}

export interface ResultsData {
  status: EndReason;
  cause: string;
  haul: number;
  lost: number;
  banked: number;
  carried: number;
  relics: number;
  types: number;
  time: number;
  rank: number;
  money: number;
  ghostSaved: boolean;
  best: number;
}

type ScreenId = 'loading' | 'menu' | 'pause' | 'settings' | 'shop' | 'scores' | 'controls' | 'results' | 'none';

const STATUS_TEXT: Record<EndReason, { title: string; good: boolean }> = {
  escaped: { title: 'You made it out', good: true },
  caught: { title: 'Caught', good: false },
  killed: { title: 'Dead in the temple', good: false },
  entombed: { title: 'Entombed', good: false },
  abandoned: { title: 'Run abandoned', good: false },
};

const CONTROLS: [string, string][] = [
  ['WASD', 'move'],
  ['Mouse', 'look'],
  ['Shift', 'sprint (stamina)'],
  ['C / Ctrl', 'crouch (quiet, ducks head-high blades)'],
  ['Space', 'jump, mantle a ledge'],
  ['Walk into vines', 'climb (Space to hop off)'],
  ['E', 'interact, stash a relic, swap on a pedestal'],
  ['F / Left click', 'grab; click again to throw'],
  ['Q / Right click', 'drop what you hold'],
  ['G', 'take the selected relic out of the satchel'],
  ['[ ] / wheel', 'select a satchel item'],
  ['T', 'light (2 s, vulnerable) or snuff the torch'],
  ['R', 'pour an oil flask into the torch'],
  ['V', 'kick (cracked walls, loose things)'],
  ['M / Tab', 'hand-drawn map'],
  ['Esc / P', 'pause'],
  ['F3', 'debug overlay'],
  ['Gamepad', 'sticks, A jump, B crouch, X interact, Y torch, RT grab, LT drop'],
];

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

export class UI {
  root: HTMLDivElement;
  current: ScreenId = 'none';
  private settingsBack: ScreenId = 'menu';
  private loadingBar: HTMLDivElement | null = null;
  private loadingText: HTMLDivElement | null = null;
  private lastResults: ResultsData | null = null;
  private clickToPlay: HTMLDivElement;

  constructor(parent: HTMLElement, private host: UIHost) {
    this.root = document.createElement('div');
    this.root.className = 'screen dim';
    parent.appendChild(this.root);
    this.clickToPlay = document.createElement('div');
    this.clickToPlay.id = 'clickToPlay';
    this.clickToPlay.textContent = 'Click to take control';
    this.clickToPlay.classList.add('hidden');
    parent.appendChild(this.clickToPlay);
  }

  private panel(html: string): HTMLDivElement {
    this.root.innerHTML = '';
    this.root.classList.remove('hidden');
    const p = document.createElement('div');
    p.className = 'panel';
    p.innerHTML = html;
    this.root.appendChild(p);
    return p;
  }

  private on(p: HTMLElement, sel: string, fn: (e: Event) => void, ev = 'click') {
    p.querySelector(sel)?.addEventListener(ev, fn);
  }

  hide() {
    this.current = 'none';
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
  }

  showClickToPlay(on: boolean) {
    this.clickToPlay.classList.toggle('hidden', !on);
  }

  // --- loading -------------------------------------------------------------

  loading(text: string, frac: number) {
    if (this.current !== 'loading') {
      this.current = 'loading';
      const p = this.panel(`<div class="title">THE LOST TEMPLE</div><div class="subtitle" id="ldText"></div><div class="loading-bar"><div id="ldBar"></div></div>`);
      this.loadingBar = p.querySelector('#ldBar');
      this.loadingText = p.querySelector('#ldText');
    }
    if (this.loadingText) this.loadingText.textContent = text;
    if (this.loadingBar) this.loadingBar.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  }

  // --- main menu ------------------------------------------------------------

  menu() {
    this.current = 'menu';
    const s = this.host.save;
    const best = s.highScores[0]?.haul ?? 0;
    const p = this.panel(`
      <div class="title">THE LOST TEMPLE</div>
      <div class="subtitle">Get in at dawn. Get out before dark. Everything you carry slows you down.</div>
      <div class="row"><span class="muted">Purse</span><span class="money">${formatMoney(s.money)}</span></div>
      <div class="row"><span class="muted">Runs</span><span>${s.runs}</span></div>
      <div class="row"><span class="muted">Best haul</span><span>${formatMoney(best)}</span></div>
      <div style="height:14px"></div>
      <div class="menu-buttons">
        <button class="btn" id="mStart">Begin the heist</button>
        <button class="btn" id="mShop">Outfitter</button>
        <button class="btn" id="mScores">High scores</button>
        <button class="btn" id="mSettings">Settings</button>
        <button class="btn" id="mControls">How to play</button>
      </div>
      ${s.runs === 0 ? '<p class="muted" style="font-size:14px;margin-top:16px">First time: the haul cart waits outside the great door. Anything you drop in it is yours, whatever happens below. Anything still on your back when the guardians catch you is gone.</p>' : ''}
    `);
    this.on(p, '#mStart', () => this.host.startRun());
    this.on(p, '#mShop', () => this.shop());
    this.on(p, '#mScores', () => this.scores());
    this.on(p, '#mSettings', () => this.settings('menu'));
    this.on(p, '#mControls', () => this.controls('menu'));
  }

  // --- pause ------------------------------------------------------------------

  pause() {
    this.current = 'pause';
    const p = this.panel(`
      <h2>Paused</h2>
      <div class="menu-buttons">
        <button class="btn" id="pResume">Resume</button>
        <button class="btn" id="pSettings">Settings</button>
        <button class="btn" id="pControls">Controls</button>
        <button class="btn" id="pAbandon">Abandon the run (keep banked loot)</button>
      </div>
      <p class="muted" style="font-size:13px;margin-top:14px">The clock is stopped while this is open.</p>
    `);
    this.on(p, '#pResume', () => this.host.resume());
    this.on(p, '#pSettings', () => this.settings('pause'));
    this.on(p, '#pControls', () => this.controls('pause'));
    this.on(p, '#pAbandon', () => {
      if (confirm('Abandon this run? Whatever you are carrying is lost; banked loot is kept.')) this.host.abandon();
    });
  }

  // --- settings ---------------------------------------------------------------

  settings(back: ScreenId) {
    this.current = 'settings';
    this.settingsBack = back;
    const s = { ...this.host.save.settings };
    const p = this.panel(`
      <h2>Settings</h2>
      <div class="row"><span>Field of view <span class="muted" id="vFov"></span></span><input type="range" id="sFov" min="50" max="110" step="1"></div>
      <div class="row"><span>Mouse sensitivity <span class="muted" id="vSens"></span></span><input type="range" id="sSens" min="0.1" max="4" step="0.05"></div>
      <div class="row"><span>Invert mouse Y</span><input type="checkbox" id="sInv"></div>
      <div class="row"><span>Master volume <span class="muted" id="vMaster"></span></span><input type="range" id="sMaster" min="0" max="1" step="0.01"></div>
      <div class="row"><span>Music volume <span class="muted" id="vMusic"></span></span><input type="range" id="sMusic" min="0" max="1" step="0.01"></div>
      <div class="row"><span>Effects volume <span class="muted" id="vSfx"></span></span><input type="range" id="sSfx" min="0" max="1" step="0.01"></div>
      <div class="row"><span>Graphics quality</span><select id="sQual"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
      <div class="row"><span>Show FPS</span><input type="checkbox" id="sFps"></div>
      <div class="row"><span>Ghost of your best run</span><input type="checkbox" id="sGhost"></div>
      <div style="height:12px"></div>
      <div class="menu-buttons"><button class="btn" id="sBack">Back</button></div>
      ${this.settingsBack === 'menu' ? '<div style="margin-top:18px;text-align:right"><button class="btn small" id="sReset">Erase all progress</button></div>' : ''}
    `);
    const q = <T extends HTMLElement>(id: string) => p.querySelector('#' + id) as T;
    const fov = q<HTMLInputElement>('sFov');
    const sens = q<HTMLInputElement>('sSens');
    const inv = q<HTMLInputElement>('sInv');
    const master = q<HTMLInputElement>('sMaster');
    const music = q<HTMLInputElement>('sMusic');
    const sfx = q<HTMLInputElement>('sSfx');
    const qual = q<HTMLSelectElement>('sQual');
    const fps = q<HTMLInputElement>('sFps');
    const ghost = q<HTMLInputElement>('sGhost');
    fov.value = String(s.fov);
    sens.value = String(s.sensitivity);
    inv.checked = s.invertY;
    master.value = String(s.masterVolume);
    music.value = String(s.musicVolume);
    sfx.value = String(s.sfxVolume);
    qual.value = s.quality;
    fps.checked = s.showFps;
    ghost.checked = s.showGhost;
    const labels = () => {
      q<HTMLSpanElement>('vFov').textContent = `${s.fov}°`;
      q<HTMLSpanElement>('vSens').textContent = s.sensitivity.toFixed(2);
      q<HTMLSpanElement>('vMaster').textContent = `${Math.round(s.masterVolume * 100)}%`;
      q<HTMLSpanElement>('vMusic').textContent = `${Math.round(s.musicVolume * 100)}%`;
      q<HTMLSpanElement>('vSfx').textContent = `${Math.round(s.sfxVolume * 100)}%`;
    };
    labels();
    const apply = () => {
      s.fov = Number(fov.value);
      s.sensitivity = Number(sens.value);
      s.invertY = inv.checked;
      s.masterVolume = Number(master.value);
      s.musicVolume = Number(music.value);
      s.sfxVolume = Number(sfx.value);
      s.quality = qual.value as Quality;
      s.showFps = fps.checked;
      s.showGhost = ghost.checked;
      labels();
      this.host.applySettings({ ...s });
    };
    for (const e of [fov, sens, master, music, sfx]) e.addEventListener('input', apply);
    for (const e of [inv, qual, fps, ghost]) e.addEventListener('change', apply);
    this.on(p, '#sBack', () => (this.settingsBack === 'pause' ? this.pause() : this.menu()));
    this.on(p, '#sReset', () => {
      if (confirm('Erase money, upgrades, high scores and the ghost? Settings are kept.')) {
        this.host.resetSave();
        this.menu();
      }
    });
  }

  // --- shop -------------------------------------------------------------------

  shop(after: ScreenId = 'menu') {
    this.current = 'shop';
    const s = this.host.save;
    const rows = SHOP.map((it) => {
      const lvl = s.upgrades[it.id] ?? 0;
      const cost = nextUpgradeCost(it.id, lvl);
      const now = it.describe(lvl);
      const next = cost === null ? 'fully upgraded' : `next: ${it.describe(lvl + 1)}`;
      const btn = cost === null ? '<button class="btn small" disabled>Maxed</button>' : `<button class="btn small" data-buy="${it.id}" ${s.money < cost ? 'disabled' : ''}>Buy ${formatMoney(cost)}</button>`;
      return `<div class="row"><div><div>${it.name} <span class="muted">(level ${lvl}/${it.prices.length})</span></div><div class="muted" style="font-size:13px">${now} · ${next}</div></div>${btn}</div>`;
    }).join('');
    const p = this.panel(`
      <h2>The Outfitter</h2>
      <div class="row"><span class="muted">Your purse</span><span class="money">${formatMoney(s.money)}</span></div>
      ${rows}
      <div style="height:12px"></div>
      <div class="menu-buttons">
        ${after === 'results' ? '<button class="btn" id="shStart">Back to the temple</button>' : ''}
        <button class="btn" id="shBack">${after === 'results' ? 'Main menu' : 'Back'}</button>
      </div>
    `);
    p.querySelectorAll<HTMLButtonElement>('button[data-buy]').forEach((b) =>
      b.addEventListener('click', () => {
        if (this.host.buy(b.dataset.buy as UpgradeId)) this.shop(after);
      }),
    );
    this.on(p, '#shStart', () => this.host.startRun());
    this.on(p, '#shBack', () => this.menu());
  }

  // --- high scores ------------------------------------------------------------

  scores() {
    this.current = 'scores';
    const hs = this.host.save.highScores;
    const rows = hs.length
      ? hs.map((h, i) => `<tr><td>${i + 1}</td><td>${formatMoney(h.haul)}</td><td>${STATUS_TEXT[h.status]?.title ?? h.status}</td><td>${h.relics}</td><td>${fmtTime(h.time)}</td><td class="muted">${h.date}</td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">No runs yet. The temple is waiting.</td></tr>';
    const p = this.panel(`
      <h2>High scores</h2>
      <table class="scores"><tr><th>#</th><th>Haul</th><th>Ending</th><th>Relics</th><th>Time</th><th>Date</th></tr>${rows}</table>
      <div style="height:14px"></div>
      <div class="menu-buttons"><button class="btn" id="hsBack">Back</button></div>
    `);
    this.on(p, '#hsBack', () => this.menu());
  }

  // --- controls ---------------------------------------------------------------

  controls(back: ScreenId) {
    this.current = 'controls';
    const p = this.panel(`
      <h2>How to play</h2>
      <p style="margin-top:0">Cross the jungle and the gorge, open the great door, and work down through the halls, the sanctum and the catacombs to the deep vault. Loot only counts once it is in the <b>haul cart</b> outside the door, or on your back when you walk away at the cart. At dark the guardians wake below and the door starts to close. The sundial in the corner is your only clock.</p>
      <div class="controls">${CONTROLS.map(([k, v]) => `<div><b>${k}</b> ${v}</div>`).join('')}</div>
      <div style="height:14px"></div>
      <div class="menu-buttons"><button class="btn" id="cBack">Back</button></div>
    `);
    this.on(p, '#cBack', () => (back === 'pause' ? this.pause() : this.menu()));
  }

  // --- results ----------------------------------------------------------------

  results(r: ResultsData) {
    this.current = 'results';
    this.lastResults = r;
    const st = STATUS_TEXT[r.status];
    const p = this.panel(`
      <div class="result-status ${st.good ? 'good' : 'bad'}">${st.title}</div>
      <div class="subtitle">${r.cause}</div>
      <div class="row"><span>Haul (banked${r.status === 'escaped' ? ' + carried out' : ''})</span><span class="money">${formatMoney(r.haul)}</span></div>
      ${r.lost > 0 ? `<div class="row"><span>Lost with you</span><span style="color:var(--red)">${formatMoney(r.lost)}</span></div>` : ''}
      <div class="row"><span class="muted">Relics found</span><span>${r.relics} (${r.types} kinds)</span></div>
      <div class="row"><span class="muted">Time in the temple</span><span>${fmtTime(r.time)}</span></div>
      ${r.rank >= 0 ? `<div class="row"><span class="muted">High score table</span><span style="color:var(--gold)">#${r.rank + 1}</span></div>` : ''}
      ${r.ghostSaved ? '<div class="row"><span class="muted">Ghost</span><span>your best run will walk beside you next time</span></div>' : ''}
      <div class="row"><span class="muted">Purse</span><span class="money">${formatMoney(r.money)}</span></div>
      <div style="height:14px"></div>
      <div class="menu-buttons">
        <button class="btn" id="rAgain">Go again</button>
        <button class="btn" id="rShop">Outfitter</button>
        <button class="btn" id="rScores">High scores</button>
        <button class="btn" id="rMenu">Main menu</button>
      </div>
    `);
    this.on(p, '#rAgain', () => this.host.startRun());
    this.on(p, '#rShop', () => this.shop('results'));
    this.on(p, '#rScores', () => this.scores());
    this.on(p, '#rMenu', () => this.menu());
  }
}
