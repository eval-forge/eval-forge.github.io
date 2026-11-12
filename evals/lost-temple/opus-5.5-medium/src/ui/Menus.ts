import { Save, Settings } from '../core/Save';
import { UPGRADES, upgradePrice, buyUpgrade, UpgradeId } from '../logic/economy';
import { fmtClock } from '../logic/countdown';

export interface MenuHandlers {
  play(): void;
  resume(): void;
  abandon(): void;
  applySettings(s: Settings): void;
}

export interface RunResult { escaped: boolean; cause: string; value: number; time: number; relics: number; items: string[]; banked: number; newBest: boolean }

const HELP = `
<h3>How to play</h3>
<p>Get in, grab what you can carry, and get out through the great door before dark. Only loot carried out counts.</p>
<table class="keys">
<tr><td>WASD / Mouse</td><td>Move / look</td></tr>
<tr><td>Shift</td><td>Run (stamina)</td></tr>
<tr><td>Space</td><td>Jump · mantle ledges (jump again in the air)</td></tr>
<tr><td>C / Ctrl</td><td>Crouch (quiet; dodges darts)</td></tr>
<tr><td>W at vines</td><td>Climb</td></tr>
<tr><td>E</td><td>Interact / take relic / swap on pedestal</td></tr>
<tr><td>G / Right mouse</td><td>Grab / drop object</td></tr>
<tr><td>Left mouse</td><td>Throw held object</td></tr>
<tr><td>Q</td><td>Drop last relic</td></tr>
<tr><td>F</td><td>Torch on/off · R relight · T add oil</td></tr>
<tr><td>Tab</td><td>Satchel · M map · F3 debug · Esc pause</td></tr>
</table>
<p>Gamepad: sticks move/look, A jump, B crouch, X interact, Y torch, LB relight, LT grab, RT throw, RB run, Start pause.</p>`;

export class Menus {
  root: HTMLDivElement;
  private panel: HTMLDivElement;
  state: 'main' | 'pause' | 'results' | 'none' = 'main';
  private back: () => void = () => this.showMain();
  constructor(parent: HTMLElement, private h: MenuHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    parent.appendChild(this.root);
    this.panel = document.createElement('div');
    this.panel.className = 'panel';
    this.root.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      e.stopPropagation();
      this.act(t.dataset.act!, t.dataset.arg);
    });
  }

  hide() { this.root.classList.add('hidden'); this.state = 'none'; }
  private open(html: string) { this.root.classList.remove('hidden'); this.panel.innerHTML = html; }

  private act(a: string, arg?: string) {
    switch (a) {
      case 'play': this.h.play(); break;
      case 'resume': this.h.resume(); break;
      case 'abandon': this.h.abandon(); break;
      case 'main': this.showMain(); break;
      case 'shop': this.showShop(); break;
      case 'scores': this.showScores(); break;
      case 'settings': this.showSettings(); break;
      case 'help': this.open(`<h2>How to play</h2>${HELP}<div class="btns"><button data-act="back">Back</button></div>`); break;
      case 'back': this.back(); break;
      case 'buy': {
        const r = buyUpgrade(Save.data.bank, Save.data.upgrades, arg as UpgradeId);
        if (r) { Save.data.bank = r.bank; Save.data.upgrades = r.ups; Save.saveData(); }
        this.showShop();
        break;
      }
      case 'reset': if (confirm('Erase bank, upgrades and high scores?')) { Save.reset(); this.showMain(); } break;
    }
  }

  showMain() {
    this.state = 'main';
    this.back = () => this.showMain();
    this.open(`
      <h1>THE LOST TEMPLE</h1>
      <p class="sub">Greed against the clock. Get out before dark.</p>
      <div class="btns col">
        <button data-act="play" class="big">Enter the jungle</button>
        <button data-act="shop">Outfitter (${Save.data.bank.toLocaleString()} gold)</button>
        <button data-act="scores">High scores</button>
        <button data-act="settings">Settings</button>
        <button data-act="help">How to play</button>
      </div>
      <p class="tiny">Runs: ${Save.data.runs} · Everything here is generated in code.</p>`);
  }

  showPause() {
    this.state = 'pause';
    this.back = () => this.showPause();
    this.open(`
      <h2>Paused</h2>
      <div class="btns col">
        <button data-act="resume" class="big">Resume</button>
        <button data-act="settings">Settings</button>
        <button data-act="help">Controls</button>
        <button data-act="abandon">Abandon run (lose everything)</button>
      </div>`);
  }

  showResults(r: RunResult) {
    this.state = 'results';
    this.back = () => this.showResults(r);
    const list = r.items.length ? `<ul class="loot">${r.items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '<p>No relics.</p>';
    this.open(`
      <h2 class="${r.escaped ? 'win' : 'lose'}">${r.escaped ? 'You escaped!' : 'You did not make it'}</h2>
      <p class="sub">${r.cause}</p>
      <div class="stats">
        <div><b>${r.value.toLocaleString()}</b><span>haul value${r.escaped ? '' : ' (lost)'}</span></div>
        <div><b>${fmtClock(r.time)}</b><span>time in the temple</span></div>
        <div><b>${r.relics}</b><span>relics found</span></div>
      </div>
      ${r.newBest ? '<p class="best">New high score! Your ghost will run with you next time.</p>' : ''}
      ${list}
      <p>Banked: <b>${r.banked.toLocaleString()}</b> gold · Total: <b>${Save.data.bank.toLocaleString()}</b></p>
      <div class="btns">
        <button data-act="play" class="big">Go again</button>
        <button data-act="shop">Outfitter</button>
        <button data-act="main">Main menu</button>
      </div>`);
  }

  showShop() {
    this.back = this.state === 'results' ? this.back : () => this.showMain();
    const rows = UPGRADES.map((u) => {
      const lvl = Save.data.upgrades[u.id];
      const price = upgradePrice(u.id, lvl);
      const btn = price === null ? '<span class="max">MAX</span>' : `<button data-act="buy" data-arg="${u.id}" ${Save.data.bank < price ? 'disabled' : ''}>${price.toLocaleString()} g</button>`;
      return `<div class="shop-row"><div><b>${u.name}</b> <span class="lvl">Lv ${lvl}/${u.prices.length}</span><br><small>${u.desc}</small></div>${btn}</div>`;
    }).join('');
    this.open(`<h2>Outfitter</h2><p class="sub">Bank: <b>${Save.data.bank.toLocaleString()}</b> gold</p>${rows}<div class="btns"><button data-act="back">Back</button></div>`);
  }

  showScores() {
    const rows = Save.data.scores.map((s, i) => `<tr><td>${i + 1}</td><td>${s.value.toLocaleString()}</td><td>${fmtClock(s.time)}</td><td>${s.relics}</td><td>${s.date}</td></tr>`).join('');
    this.open(`<h2>High scores</h2><table class="scores"><tr><th>#</th><th>Haul</th><th>Time</th><th>Relics</th><th>Date</th></tr>${rows || '<tr><td colspan="5">No escapes yet.</td></tr>'}</table>
      <div class="btns"><button data-act="back">Back</button><button data-act="reset" class="danger">Reset save</button></div>`);
  }

  showSettings() {
    const s = Save.settings;
    this.open(`<h2>Settings</h2>
      <label>Field of view <input type="range" id="s-fov" min="60" max="100" value="${s.fov}"><span>${s.fov}</span></label>
      <label>Mouse sensitivity <input type="range" id="s-sens" min="0.2" max="3" step="0.1" value="${s.sensitivity}"><span>${s.sensitivity}</span></label>
      <label>Master volume <input type="range" id="s-vol" min="0" max="1" step="0.05" value="${s.volume}"><span>${s.volume}</span></label>
      <label>Music volume <input type="range" id="s-mus" min="0" max="1" step="0.05" value="${s.music}"><span>${s.music}</span></label>
      <label>Graphics quality <select id="s-q"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <label>Invert Y <input type="checkbox" id="s-inv" ${s.invertY ? 'checked' : ''}></label>
      <label>Debug overlay (F3) <input type="checkbox" id="s-dbg" ${s.showDebug ? 'checked' : ''}></label>
      <div class="btns"><button data-act="back">Done</button></div>`);
    (this.panel.querySelector('#s-q') as HTMLSelectElement).value = s.quality;
    const upd = () => {
      const g = (id: string) => this.panel.querySelector('#' + id) as HTMLInputElement;
      s.fov = +g('s-fov').value; s.sensitivity = +g('s-sens').value; s.volume = +g('s-vol').value; s.music = +g('s-mus').value;
      s.quality = (this.panel.querySelector('#s-q') as HTMLSelectElement).value as Settings['quality'];
      s.invertY = g('s-inv').checked; s.showDebug = g('s-dbg').checked;
      this.panel.querySelectorAll('label').forEach((l) => { const i = l.querySelector('input[type=range]') as HTMLInputElement | null; const sp = l.querySelector('span'); if (i && sp) sp.textContent = i.value; });
      Save.saveSettings();
      this.h.applySettings(s);
    };
    this.panel.querySelectorAll('input,select').forEach((e) => e.addEventListener('input', upd));
  }
}
