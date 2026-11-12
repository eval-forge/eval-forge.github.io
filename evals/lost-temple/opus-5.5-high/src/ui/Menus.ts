import { SHOP, buy, nextPrice, RELIC_BY_ID, type RunOutcome, type CarriedRelic } from '../logic/economy';
import { saveProfile, resetProfile, loadProfile, type Profile, type Settings } from '../core/Save';
import { formatClock } from '../logic/countdown';

export interface MenuHost {
  profile: Profile;
  startRun(): void;
  resume(): void;
  abandon(): void;
  applySettings(): void;
  uiClick(): void;
}

export interface RunResult {
  outcome: RunOutcome;
  cause: string;
  carried: CarriedRelic[];
  banked: number;
  time: number;
  rank: number;
  scenes: number;
  newGhost: boolean;
}

const OUTCOME_TEXT: Record<RunOutcome, string> = {
  escaped: 'You staggered out through the great door with your haul.',
  caught: 'The temple’s guardians caught you. The haul stays with them.',
  killed: 'The temple claimed another fool.',
  sealed: 'The great door sealed shut with you on the wrong side of it.',
};

/** All full-screen menus: main, pause, settings, shop, scores, controls, results. */
export class Menus {
  private root = document.getElementById('menu')!;
  current = '';

  constructor(private host: MenuHost) {}

  hide() { this.root.style.display = 'none'; this.root.innerHTML = ''; this.current = ''; }

  private panel(name: string, html: string) {
    this.current = name;
    this.root.style.display = 'flex';
    this.root.innerHTML = `<div class="panel">${html}</div>`;
    return this.root.firstElementChild as HTMLElement;
  }

  private on(el: HTMLElement, id: string, fn: () => void) {
    const b = el.querySelector<HTMLElement>(`#${id}`);
    b?.addEventListener('click', () => { this.host.uiClick(); fn(); });
  }

  main() {
    const p = this.host.profile;
    const el = this.panel('main', `
      <h1>The Lost Temple</h1>
      <div class="sub">One day of light. One door out. Take what you can carry.</div>
      <div class="bank">Bank: ${p.bank.toLocaleString()} gold · Runs: ${p.runs}</div>
      <button id="mStart">Start expedition</button>
      <button id="mShop">Outfitter (shop)</button>
      <button id="mScores">High scores</button>
      <button id="mSettings">Settings</button>
      <button id="mControls">Controls</button>`);
    this.on(el, 'mStart', () => this.host.startRun());
    this.on(el, 'mShop', () => this.shop());
    this.on(el, 'mScores', () => this.scores());
    this.on(el, 'mSettings', () => this.settings(() => this.main()));
    this.on(el, 'mControls', () => this.controls(() => this.main()));
  }

  pause() {
    const el = this.panel('pause', `
      <h2>Paused</h2>
      <div class="sub">The sun waits for no one — except right now.</div>
      <button id="pResume">Resume</button>
      <button id="pSettings">Settings</button>
      <button id="pControls">Controls</button>
      <button id="pAbandon">Abandon run (haul lost)</button>`);
    this.on(el, 'pResume', () => this.host.resume());
    this.on(el, 'pSettings', () => this.settings(() => this.pause()));
    this.on(el, 'pControls', () => this.controls(() => this.pause()));
    this.on(el, 'pAbandon', () => this.host.abandon());
  }

  settings(back: () => void) {
    const s = this.host.profile.settings;
    const slider = (key: keyof Settings, label: string, min: number, max: number, step: number, fmt: (v: number) => string) => `
      <div class="row"><label>${label}</label><input type="range" id="s_${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}"><span class="val" id="v_${key}">${fmt(s[key] as number)}</span></div>`;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const el = this.panel('settings', `
      <h2>Settings</h2>
      ${slider('fov', 'Field of view', 60, 100, 1, (v) => `${v}°`)}
      ${slider('sensitivity', 'Mouse sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2))}
      ${slider('master', 'Master volume', 0, 1, 0.01, pct)}
      ${slider('music', 'Music volume', 0, 1, 0.01, pct)}
      ${slider('sfx', 'Effects volume', 0, 1, 0.01, pct)}
      <div class="row"><label>Graphics quality</label><select id="s_quality">
        <option value="low">Low (1k shadows, 0.75× res)</option><option value="medium">Medium (2k shadows)</option><option value="high">High (4k shadows, full res)</option></select></div>
      <div class="row"><label>Invert mouse Y</label><input type="checkbox" id="s_invertY" ${s.invertY ? 'checked' : ''}></div>
      <div class="row"><label>Show best-run ghost</label><input type="checkbox" id="s_showGhost" ${s.showGhost ? 'checked' : ''}></div>
      <div class="sub" style="margin:6px 0 0;font-size:13px">Texture resolution follows quality after a reload; shadows and resolution change immediately.</div>
      <button id="sBack">Back</button>
      <button id="sReset" style="font-size:13px;opacity:.7">Wipe all progress</button>`);
    const sel = el.querySelector<HTMLSelectElement>('#s_quality')!;
    sel.value = s.quality;
    sel.addEventListener('change', () => { s.quality = sel.value as Settings['quality']; this.commit(); });
    for (const key of ['fov', 'sensitivity', 'master', 'music', 'sfx'] as const) {
      const inp = el.querySelector<HTMLInputElement>(`#s_${key}`)!;
      const val = el.querySelector<HTMLElement>(`#v_${key}`)!;
      inp.addEventListener('input', () => {
        (s as any)[key] = parseFloat(inp.value);
        val.textContent = key === 'fov' ? `${s.fov}°` : key === 'sensitivity' ? s.sensitivity.toFixed(2) : pct(s[key]);
        this.commit();
      });
    }
    for (const key of ['invertY', 'showGhost'] as const) {
      const inp = el.querySelector<HTMLInputElement>(`#s_${key}`)!;
      inp.addEventListener('change', () => { s[key] = inp.checked; this.commit(); });
    }
    this.on(el, 'sBack', back);
    this.on(el, 'sReset', () => {
      if (!confirm('Wipe bank, upgrades, scores and ghost?')) return;
      resetProfile();
      Object.assign(this.host.profile, loadProfile());
      this.host.applySettings();
      back();
    });
  }

  private commit() { saveProfile(this.host.profile); this.host.applySettings(); }

  shop() {
    const p = this.host.profile;
    const items = SHOP.map((it) => {
      const lvl = p.upgrades[it.id];
      const price = nextPrice(it, lvl);
      const pips = '◆'.repeat(lvl) + '◇'.repeat(it.prices.length - lvl);
      return `<div class="shopItem"><div class="info"><div class="name">${it.name} <span class="pips">${pips}</span></div><div class="desc">${it.desc}</div></div>
        <button id="buy_${it.id}" ${price === null || price > p.bank ? 'disabled' : ''}>${price === null ? 'Maxed' : `Buy · ${price}`}</button></div>`;
    }).join('');
    const el = this.panel('shop', `<h2>Outfitter</h2><div class="bank">Bank: ${p.bank.toLocaleString()} gold</div>${items}<button id="shBack">Back</button>`);
    for (const it of SHOP) {
      this.on(el, `buy_${it.id}`, () => {
        const r = buy(p.bank, p.upgrades, it.id);
        if (!r) return;
        p.bank = r.bank; p.upgrades = r.upgrades;
        saveProfile(p);
        this.shop();
      });
    }
    this.on(el, 'shBack', () => this.main());
  }

  scores() {
    const rows = this.host.profile.scores.map((s, i) => `<tr><td>${i + 1}</td><td>${s.value.toLocaleString()}</td><td>${s.outcome}</td><td>${s.relics}</td><td>${formatClock(s.time)}</td><td>${s.date}</td></tr>`).join('');
    const el = this.panel('scores', `<h2>High scores</h2>
      <table><tr><th>#</th><th>Banked</th><th>Outcome</th><th>Relics</th><th>Time</th><th>Date</th></tr>${rows || '<tr><td colspan="6">No expeditions yet. Go get rich or die trying.</td></tr>'}</table>
      <button id="scBack">Back</button>`);
    this.on(el, 'scBack', () => this.main());
  }

  controls(back: () => void) {
    const k = [
      ['W A S D / arrows', 'Move'], ['Mouse', 'Look (click the game to lock the pointer)'], ['Space', 'Jump · mantle a ledge · jump off vines'],
      ['Shift', 'Sprint (drains stamina; heavier satchel drains more)'], ['C / Ctrl', 'Crouch (quiet; shields the torch from wind)'],
      ['W into vines', 'Climb'], ['E', 'Take relic into satchel · use / interact'], ['F / Left mouse', 'Grab, carry and drop objects'],
      ['Right mouse', 'Throw the held object'], ['Q', 'Drop the last relic from your satchel (for pedestal swaps)'],
      ['T', 'Douse / light the torch'], ['R', 'Relight the torch (or light a spare when it is spent)'], ['M', 'Hand-drawn map'],
      ['Esc / P', 'Pause'], ['F3 / `', 'Debug overlay (FPS, physics bodies, scene)'],
      ['Gamepad', 'Sticks move/look · A jump · B crouch · X use · Y torch · RT grab · LT throw · LB drop · RB relight'],
    ];
    const el = this.panel('controls', `<h2>Controls</h2><table class="keys">${k.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table><button id="cBack">Back</button>`);
    this.on(el, 'cBack', back);
  }

  results(r: RunResult) {
    const title = r.outcome === 'escaped' ? 'Escaped!' : r.outcome === 'caught' ? 'Caught' : r.outcome === 'sealed' ? 'Sealed in' : 'Dead';
    const list = r.carried.filter((c) => RELIC_BY_ID[c.relicId]?.rarity !== 'key').map((c) => `<tr><td>${RELIC_BY_ID[c.relicId]?.name ?? c.relicId}</td><td>${c.foundIn}</td><td>${c.weight.toFixed(1)} kg</td><td>${c.value}</td></tr>`).join('');
    const total = r.carried.reduce((s, c) => s + c.value, 0);
    const el = this.panel('results', `
      <h1>${title}</h1>
      <div class="outcome">${OUTCOME_TEXT[r.outcome]}${r.cause ? ` (${r.cause})` : ''}</div>
      <div class="big">${r.banked > 0 ? `+${r.banked.toLocaleString()} gold banked` : `Haul lost: ${total.toLocaleString()} gold`}</div>
      <div class="sub">Time in the temple: ${formatClock(r.time)} · Areas explored: ${r.scenes}/7 ${r.rank >= 0 && r.banked > 0 ? `· High score #${r.rank + 1}` : ''}${r.newGhost ? ' · new best ghost saved' : ''}</div>
      <table><tr><th>Relic</th><th>Found in</th><th>Weight</th><th>Value</th></tr>${list || '<tr><td colspan="4">Empty satchel.</td></tr>'}</table>
      <div class="bank" style="margin-top:12px">Bank: ${this.host.profile.bank.toLocaleString()} gold</div>
      <div class="btnRow"><button id="rAgain">Another expedition</button><button id="rShop">Outfitter</button><button id="rMenu">Main menu</button></div>`);
    this.on(el, 'rAgain', () => this.host.startRun());
    this.on(el, 'rShop', () => this.shop());
    this.on(el, 'rMenu', () => this.main());
  }
}
