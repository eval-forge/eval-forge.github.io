/**
 * In-game HUD: the stone sundial countdown (the only clock in Zone C), loot carried /
 * secured, health, stamina, torch fuel, breath, inventory counts, the interaction
 * prompt with hold progress, toasts, the scene banner and the red edge pulse at dusk.
 */
import { DAY_SECONDS, FINAL_WINDOW, gameHour, formatClock, LATE_THRESHOLD, CRITICAL_THRESHOLD } from '../logic/clock';
import { staminaStats } from '../logic/meta';
import type { Game, ToastKind } from '../game/Game';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

interface Bar {
  root: HTMLDivElement;
  fill: HTMLDivElement;
  label: HTMLSpanElement;
}

export class Hud {
  root: HTMLDivElement;
  private dial: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private dialLabel: HTMLDivElement;
  private dialSub: HTMLDivElement;
  private carried: HTMLDivElement;
  private secured: HTMLDivElement;
  private weight: HTMLDivElement;
  private bars: Record<'health' | 'stamina' | 'fuel' | 'breath', Bar>;
  private inv: HTMLDivElement;
  private prompt: HTMLDivElement;
  private promptText: HTMLDivElement;
  private promptBar: HTMLDivElement;
  private relight: HTMLDivElement;
  private relightFill: HTMLDivElement;
  private toasts: HTMLDivElement;
  private banner: HTMLDivElement;
  private edge: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private pulse = 0;
  private bannerT = 0;
  private dialT = 0;
  private lastPrompt = '';

  constructor(private game: Game, parent: HTMLElement) {
    const root = el('div', 'hud hidden', parent);
    this.root = root;
    this.edge = el('div', 'edge-pulse', root);

    // sundial
    const dialBox = el('div', 'dial-box', root);
    this.dial = el('canvas', 'dial', dialBox);
    this.dial.width = 180;
    this.dial.height = 180;
    this.dctx = this.dial.getContext('2d')!;
    this.dialLabel = el('div', 'dial-label', dialBox);
    this.dialSub = el('div', 'dial-sub', dialBox);

    // loot
    const loot = el('div', 'loot', root);
    this.carried = el('div', 'loot-carried', loot);
    this.secured = el('div', 'loot-secured', loot);
    this.weight = el('div', 'loot-weight', loot);

    // bars
    const bars = el('div', 'bars', root);
    const mk = (name: string, cls: string): Bar => {
      const r = el('div', 'bar ' + cls, bars);
      const label = el('span', 'bar-label', r, name);
      const track = el('div', 'bar-track', r);
      const fill = el('div', 'bar-fill', track);
      return { root: r, fill, label };
    };
    this.bars = { health: mk('Health', 'b-health'), stamina: mk('Stamina', 'b-stamina'), fuel: mk('Torch', 'b-fuel'), breath: mk('Breath', 'b-breath') };
    this.inv = el('div', 'inv', root);

    this.crosshair = el('div', 'crosshair', root);
    this.prompt = el('div', 'prompt', root);
    this.promptText = el('div', 'prompt-text', this.prompt);
    const pb = el('div', 'prompt-bar', this.prompt);
    this.promptBar = el('div', 'prompt-bar-fill', pb);
    this.relight = el('div', 'relight hidden', root);
    el('div', 'relight-text', this.relight, 'Striking flint...');
    const rt = el('div', 'relight-track', this.relight);
    this.relightFill = el('div', 'relight-fill', rt);
    this.toasts = el('div', 'toasts', root);
    this.banner = el('div', 'banner', root);
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
    if (!on) {
      this.toasts.innerHTML = '';
      this.setPrompt(null, -1);
    }
  }

  toast(msg: string, kind: ToastKind) {
    const t = el('div', 'toast t-' + kind, this.toasts, msg);
    while (this.toasts.children.length > 5) this.toasts.firstChild!.remove();
    const life = kind === 'danger' ? 6000 : kind === 'warn' ? 5000 : 4200;
    setTimeout(() => t.classList.add('fade'), life);
    setTimeout(() => t.remove(), life + 700);
  }

  sceneBanner(name: string, zone: string) {
    const zn: Record<string, string> = { A: 'Zone A · Outdoors', B: 'Zone B · Broken ruins', C: 'Zone C · The dark below' };
    this.banner.innerHTML = `<div class="banner-zone">${zn[zone] ?? ''}</div><div class="banner-name">${name}</div>`;
    this.banner.classList.add('on');
    this.bannerT = 3.2;
  }

  tickPulse(urgent: boolean) {
    this.pulse = urgent ? 1 : 0.5;
  }

  setPrompt(text: string | null, progress: number) {
    const t = text ?? '';
    if (t !== this.lastPrompt) {
      this.lastPrompt = t;
      this.promptText.innerHTML = t
        .split('\n')
        .map((l, i) => `<div class="${i === 0 ? 'p-title' : 'p-line'}">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/^([A-Z]{1,4}|Hold E|LMB)\s{2}/, '<b>$1</b> ')}</div>`)
        .join('');
    }
    this.prompt.classList.toggle('on', !!text);
    this.promptBar.parentElement!.style.display = progress >= 0 ? 'block' : 'none';
    this.promptBar.style.width = `${Math.max(0, progress) * 100}%`;
    this.crosshair.classList.toggle('active', !!text);
  }

  update(dt: number) {
    if (this.root.classList.contains('hidden')) return;
    const g = this.game;
    const run = g.run;
    const clock = g.clock;
    const p = g.player;

    // loot
    const cv = run.carriedValue();
    const n = run.carriedRelics().length;
    this.carried.textContent = `Carrying $${cv.toLocaleString()}${n ? `  (${n} relic${n > 1 ? 's' : ''})` : ''}`;
    this.secured.textContent = `Secured at camp $${run.stashValue().toLocaleString()}`;
    const sw = run.satchel.weight();
    const hw = g.items.handWeight();
    const cap = run.satchel.capacity;
    const frac = sw / cap;
    this.weight.textContent = `Satchel ${sw.toFixed(1)} / ${cap} kg${hw > 0 ? `  ·  hands ${hw.toFixed(1)} kg` : ''}`;
    this.weight.className = 'loot-weight' + (frac > 0.75 || hw > 6 ? ' heavy' : '');

    // bars
    const setBar = (b: Bar, f: number, txt?: string, warn = false) => {
      b.fill.style.width = `${Math.max(0, Math.min(1, f)) * 100}%`;
      if (txt !== undefined) b.label.textContent = txt;
      b.root.classList.toggle('warn', warn);
    };
    setBar(this.bars.health, p.health / 100, 'Health', p.health < 35);
    const sm = staminaStats(run.save.upgrades.boots).max;
    setBar(this.bars.stamina, p.stamina / sm, 'Stamina', p.stamina < 15);
    const ts = run.torch;
    const fuelTxt = ts.lit ? `Torch ${Math.ceil(ts.fuel)}s · ${ts.radius.toFixed(1)} m` : ts.relighting ? 'Torch (lighting)' : ts.fuel <= 0 ? 'Torch (burnt out)' : 'Torch (out)';
    setBar(this.bars.fuel, ts.fuel / ts.stats.maxFuel, fuelTxt, ts.fuelFraction < 0.2 || !ts.lit);
    this.bars.breath.root.style.display = p.eyeUnderwater || p.breath < 14.9 ? '' : 'none';
    setBar(this.bars.breath, p.breath / 15, 'Breath', p.breath < 5);

    // inventory line
    const keys: string[] = [];
    if (run.flags.hasSunDisc && !run.flags.sunSealOpen) keys.push('<span class="key">Sun Disc</span>');
    if (run.flags.hasBoneKey && !run.flags.vaultDoorOpen) keys.push('<span class="key">Bone Key</span>');
    const rope = run.save.upgrades.rope > 0 ? `  ·  Rope catches ${run.ropeCatches}` : '';
    this.inv.innerHTML = `Spare torches ${run.spares}  ·  Oil flasks ${run.oil}${rope}${keys.length ? '  ·  ' + keys.join(' ') : ''}`;

    // relight
    this.relight.classList.toggle('hidden', !ts.relighting);
    if (ts.relighting) this.relightFill.style.width = `${ts.relightProgress * 100}%`;

    // banner
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.classList.remove('on');
    }

    // edge pulse: ≤ 60 s to darkness, stronger once the door is closing
    const tl = clock.timeLeft;
    let edge = 0;
    if (tl <= CRITICAL_THRESHOLD) {
      const rate = tl > 0 ? 1.2 + (1 - tl / CRITICAL_THRESHOLD) * 1.6 : 2.6;
      const w = 0.5 + 0.5 * Math.sin(g.time * Math.PI * 2 * rate);
      edge = (tl > 0 ? 0.35 + 0.45 * (1 - tl / CRITICAL_THRESHOLD) : 0.85) * (0.45 + 0.55 * w);
    }
    this.edge.style.opacity = edge.toFixed(3);

    // sundial (redrawn at ~20 Hz)
    this.pulse = Math.max(0, this.pulse - dt * 4);
    this.dialT -= dt;
    if (this.dialT <= 0) {
      this.dialT = 0.05;
      this.drawDial();
    }
    this.dial.style.transform = `scale(${1 + this.pulse * 0.035})`;
    if (tl > 0) {
      this.dialLabel.textContent = formatClock(tl);
      this.dialSub.textContent = tl <= LATE_THRESHOLD ? 'until darkness!' : 'until darkness';
      this.dialLabel.className = 'dial-label' + (tl <= CRITICAL_THRESHOLD ? ' crit' : tl <= LATE_THRESHOLD ? ' late' : '');
    } else {
      const dl = clock.doorTimeLeft;
      this.dialLabel.textContent = dl > 0 ? formatClock(dl) : 'SEALED';
      this.dialSub.textContent = dl > 0 ? 'the door is closing' : '';
      this.dialLabel.className = 'dial-label crit';
    }
  }

  private drawDial() {
    const c = this.dctx;
    const W = 180;
    const cx = W / 2;
    const cy = W / 2 + 18;
    const R = 78;
    const clock = this.game.clock;
    const tl = clock.timeLeft;
    c.clearRect(0, 0, W, W);
    // stone disc
    const grd = c.createRadialGradient(cx - 20, cy - 30, 10, cx, cy, R + 6);
    grd.addColorStop(0, '#9d9483');
    grd.addColorStop(0.7, '#6f675a');
    grd.addColorStop(1, '#3e3a33');
    c.fillStyle = grd;
    c.beginPath();
    c.arc(cx, cy, R, Math.PI, 0);
    c.lineTo(cx + R, cy + 6);
    c.lineTo(cx - R, cy + 6);
    c.closePath();
    c.fill();
    // weathering speckles (deterministic)
    c.fillStyle = 'rgba(30,26,20,0.25)';
    for (let i = 0; i < 70; i++) {
      const a = Math.PI + ((i * 97) % 100) / 100 * Math.PI;
      const r = ((i * 61) % 100) / 100 * (R - 4);
      c.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.6, 1.6);
    }
    // rim
    c.strokeStyle = tl <= CRITICAL_THRESHOLD ? `rgba(200,40,30,${0.6 + 0.4 * this.pulse})` : '#2c2924';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(cx, cy, R, Math.PI, 0);
    c.stroke();
    // hour lines 6..19, carved
    c.lineWidth = 1.4;
    for (let h = 6; h <= 19; h++) {
      const a = Math.PI + ((h - 6) / 13) * Math.PI;
      const inner = h % 3 === 0 ? R * 0.55 : R * 0.72;
      c.strokeStyle = 'rgba(28,24,20,0.85)';
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      c.lineTo(cx + Math.cos(a) * (R - 5), cy + Math.sin(a) * (R - 5));
      c.stroke();
      if (h % 3 === 0 || h === 19) {
        c.fillStyle = 'rgba(35,30,24,0.9)';
        c.font = 'bold 10px Georgia, serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const lr = R * 0.43;
        c.fillText(String(h), cx + Math.cos(a) * lr, cy + Math.sin(a) * lr);
      }
    }
    // the last two hours glow ochre, the final minutes red
    const arc = (h0: number, h1: number, col: string) => {
      c.strokeStyle = col;
      c.lineWidth = 6;
      c.beginPath();
      c.arc(cx, cy, R - 9, Math.PI + ((h0 - 6) / 13) * Math.PI, Math.PI + ((h1 - 6) / 13) * Math.PI);
      c.stroke();
    };
    arc(19 - LATE_THRESHOLD / 60, 19, 'rgba(160,110,40,0.55)');
    arc(19 - CRITICAL_THRESHOLD / 60, 19, 'rgba(170,40,30,0.7)');
    // gnomon shadow (the sun's hour)
    const hour = gameHour(Math.min(clock.elapsed, DAY_SECONDS));
    if (tl > 0) {
      const a = Math.PI + ((hour - 6) / 13) * Math.PI;
      c.strokeStyle = 'rgba(12,10,8,0.85)';
      c.lineWidth = 5;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8));
      c.stroke();
      c.lineCap = 'butt';
    } else {
      // night: the dial is dark; a red wedge shows the door closing
      c.fillStyle = 'rgba(10,8,12,0.55)';
      c.beginPath();
      c.arc(cx, cy, R, Math.PI, 0);
      c.fill();
      const f = Math.min(1, -tl / FINAL_WINDOW);
      c.fillStyle = 'rgba(180,30,25,0.65)';
      c.beginPath();
      c.moveTo(cx, cy);
      c.arc(cx, cy, R - 4, Math.PI, Math.PI + f * Math.PI);
      c.closePath();
      c.fill();
    }
    // gnomon
    c.fillStyle = '#2a2621';
    c.beginPath();
    c.moveTo(cx - 5, cy + 4);
    c.lineTo(cx + 5, cy + 4);
    c.lineTo(cx, cy - 16);
    c.closePath();
    c.fill();
  }
}
