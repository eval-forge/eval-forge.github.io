import { DAY_LENGTH, FINAL_WINDOW, dayFraction, doorClosedFraction, dreadLevel, formatTime, timeLeft } from '../core/clock';
import { LOW_FUEL } from '../core/torch';
import type { Zone } from '../core/types';
import type { Game } from '../game/Game';
import { el, fmtGold } from './dom';

interface Bar { root: HTMLElement; fill: HTMLElement; label: HTMLElement; }

/**
 * In-run overlay: the stone sundial clock, health, stamina, carried weight, torch fuel, loot
 * value, interaction prompt, toasts, and the screen-edge effects.
 */
export class Hud {
  private root: HTMLElement;
  private dial: HTMLCanvasElement;
  private dialCtx: CanvasRenderingContext2D;
  private dialTime: HTMLElement;
  private dialT = 0;
  private loot: HTMLElement;
  private lootSub: HTMLElement;
  private pops: HTMLElement;
  private health: Bar; private stamina: Bar; private weight: Bar; private fuel: Bar;
  private torchInfo: HTMLElement;
  private prompt: HTMLElement;
  private toasts: HTMLElement;
  private banner: HTMLElement;
  private bannerT = 0;
  private objective: HTMLElement;
  private noise: Bar;
  private noiseFlash = 0;
  private edge: HTMLElement; private hurt: HTMLElement; private dark: HTMLElement;
  private shownLoot = 0;
  private pulse = 0;
  private objT = 0;

  constructor(private game: Game) {
    const ui = document.getElementById('ui')!;
    this.edge = el('div', 'fx edge', ui);
    this.hurt = el('div', 'fx hurt', ui);
    this.dark = el('div', 'fx dark', ui);
    this.root = el('div', 'hud', ui);

    const top = el('div', 'hud-clock', this.root);
    this.dial = el('canvas', 'dial', top);
    this.dial.width = 168; this.dial.height = 112;
    this.dialCtx = this.dial.getContext('2d')!;
    this.dialTime = el('div', 'dial-time', top);

    const tr = el('div', 'hud-loot', this.root);
    this.loot = el('div', 'loot-value', tr, '0');
    this.lootSub = el('div', 'loot-sub', tr, 'gold carried');
    this.pops = el('div', 'loot-pops', tr);

    this.objective = el('div', 'hud-objective', this.root);

    const bl = el('div', 'hud-bars', this.root);
    this.health = this.bar(bl, 'Health', 'health');
    this.stamina = this.bar(bl, 'Stamina', 'stamina');
    this.weight = this.bar(bl, 'Load', 'weight');

    const br = el('div', 'hud-torch', this.root);
    this.fuel = this.bar(br, 'Torch', 'fuel');
    this.torchInfo = el('div', 'torch-info', br);

    this.noise = this.bar(el('div', 'hud-noise', this.root), 'Ceiling', 'noise');
    el('div', 'crosshair', this.root);
    this.prompt = el('div', 'prompt', this.root);
    this.toasts = el('div', 'toasts', this.root);
    this.banner = el('div', 'banner', this.root);
    this.setVisible(false);
  }

  private bar(parent: HTMLElement, name: string, cls: string): Bar {
    const root = el('div', `bar ${cls}`, parent);
    const label = el('div', 'bar-label', root, name);
    const track = el('div', 'bar-track', root);
    const fill = el('div', 'bar-fill', track);
    return { root, fill, label };
  }

  setVisible(v: boolean): void { this.root.style.display = v ? '' : 'none'; if (!v) { this.edge.style.opacity = '0'; this.hurt.style.opacity = '0'; this.dark.style.opacity = '0'; } }

  reset(): void {
    this.toasts.innerHTML = ''; this.pops.innerHTML = '';
    this.shownLoot = 0; this.bannerT = 0; this.banner.style.opacity = '0';
  }

  toast(msg: string): void {
    // The same line twice in a row is noise.
    const lastToast = this.toasts.lastElementChild as HTMLElement | null;
    if (lastToast && lastToast.textContent === msg && !lastToast.classList.contains('out')) return;
    const t = el('div', 'toast', this.toasts, msg);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild!.remove();
    setTimeout(() => t.classList.add('out'), 4200 + msg.length * 28);
    setTimeout(() => t.remove(), 5200 + msg.length * 28);
  }

  lootPop(value: number): void {
    const p = el('div', 'loot-pop', this.pops, `+${fmtGold(value)}`);
    setTimeout(() => p.remove(), 1500);
  }

  sceneBanner(name: string, zone: Zone): void {
    const sub = zone === 'A' ? 'Zone A  ·  open sky' : zone === 'B' ? 'Zone B  ·  broken roof' : 'Zone C  ·  no light but yours';
    this.banner.innerHTML = '';
    el('div', 'banner-name', this.banner, name);
    el('div', 'banner-zone', this.banner, sub);
    this.bannerT = 3.6;
  }

  flashNoise(): void { this.noiseFlash = 1; }

  private setBar(b: Bar, frac: number, text?: string): void {
    b.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})`;
    if (text !== undefined && b.label.textContent !== text) b.label.textContent = text;
  }

  /** The countdown, drawn as a weathered stone sundial whose shadow sweeps from dawn to dusk. */
  private drawDial(): void {
    const g = this.dialCtx, w = this.dial.width, h = this.dial.height;
    const t = this.game.run.time, left = timeLeft(t);
    const cx = w / 2, cy = h - 14, r = 78;
    g.clearRect(0, 0, w, h);
    // Stone half-disc.
    const grad = g.createRadialGradient(cx, cy, 6, cx, cy, r);
    const night = left <= 0;
    grad.addColorStop(0, night ? '#4a4038' : '#b9ad96'); grad.addColorStop(1, night ? '#26201c' : '#7d735f');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(cx - r, cy); g.arc(cx, cy, r, Math.PI, 0); g.lineTo(cx + r, cy + 9); g.lineTo(cx - r, cy + 9); g.closePath(); g.fill();
    g.strokeStyle = '#2d2620'; g.lineWidth = 3; g.stroke();
    // Chips and cracks so it reads as stone.
    g.strokeStyle = 'rgba(40,32,26,0.45)'; g.lineWidth = 1;
    for (const [a, l1, l2] of [[3.5, 0.55, 0.92], [4.4, 0.3, 0.6], [5.6, 0.62, 0.97], [4.05, 0.75, 0.98]]) {
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r * l1, cy + Math.sin(a) * r * l1); g.lineTo(cx + Math.cos(a + 0.07) * r * l2, cy + Math.sin(a + 0.07) * r * l2); g.stroke();
    }
    // The last two minutes are carved in red.
    const ang = (frac: number) => Math.PI + Math.PI * frac;
    g.strokeStyle = '#a02818'; g.lineWidth = 7;
    g.beginPath(); g.arc(cx, cy, r - 7, ang(1 - 120 / DAY_LENGTH), ang(1)); g.stroke();
    // Hour marks.
    for (let i = 0; i <= 12; i++) {
      const a = ang(i / 12), big = i % 3 === 0;
      g.strokeStyle = '#2d2620'; g.lineWidth = big ? 3 : 1.5;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - (big ? 17 : 11)), cy + Math.sin(a) * (r - (big ? 17 : 11))); g.lineTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3)); g.stroke();
    }
    // Shadow of the gnomon.
    const frac = dayFraction(t), a = ang(frac);
    g.fillStyle = night ? 'rgba(150,20,10,0.75)' : 'rgba(20,14,10,0.78)';
    g.beginPath(); g.moveTo(cx + Math.cos(a - 0.5 * Math.PI) * 5, cy + Math.sin(a - 0.5 * Math.PI) * 5);
    g.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6));
    g.lineTo(cx + Math.cos(a + 0.5 * Math.PI) * 5, cy + Math.sin(a + 0.5 * Math.PI) * 5); g.closePath(); g.fill();
    // Gnomon.
    g.fillStyle = '#3a3028';
    g.beginPath(); g.moveTo(cx - 7, cy + 2); g.lineTo(cx, cy - 20); g.lineTo(cx + 7, cy + 2); g.closePath(); g.fill();
    // After dark the door's closing is the only clock left.
    if (night) {
      const closed = doorClosedFraction(t);
      g.strokeStyle = '#e04020'; g.lineWidth = 5;
      g.beginPath(); g.arc(cx, cy, r - 16, Math.PI, Math.PI + Math.PI * closed); g.stroke();
    }
    const sealed = this.game.run.progress.doorSealed;
    this.dialTime.textContent = sealed ? 'SEALED' : night ? `DOOR ${formatTime(Math.max(0, FINAL_WINDOW + left))}` : formatTime(left);
    this.dialTime.className = `dial-time${left <= 120 ? ' late' : ''}${night ? ' night' : ''}`;
  }

  update(dt: number): void {
    const { game } = this;
    if (game.state !== 'playing') return;
    const run = game.run, pl = game.player;
    this.dialT -= dt;
    if (this.dialT <= 0) { this.dialT = 0.2; this.drawDial(); }

    // Loot counter rolls up.
    const v = run.satchel.value;
    this.shownLoot += (v - this.shownLoot) * Math.min(1, dt * 6);
    if (Math.abs(v - this.shownLoot) < 1) this.shownLoot = v;
    this.loot.textContent = fmtGold(this.shownLoot);
    this.lootSub.textContent = `gold carried  ·  ${run.satchel.items.length} relic${run.satchel.items.length === 1 ? '' : 's'}`;

    this.setBar(this.health, pl.health / 100);
    this.health.root.classList.toggle('low', pl.health < 35);
    this.setBar(this.stamina, pl.stamina / 100);
    const sw = run.satchel.weight;
    this.setBar(this.weight, sw / run.satchel.capacity, `Load  ${sw.toFixed(1)} / ${run.satchel.capacity} kg`);
    this.weight.root.classList.toggle('low', run.satchel.ratio > 0.8);

    const t = run.torch;
    const st = t.state === 'lit' ? 'burning' : t.state === 'relighting' ? 'lighting...' : t.state === 'out' ? 'OUT  ·  F to relight' : t.state === 'dead' ? 'spent' : 'stowed  ·  F to light';
    this.setBar(this.fuel, t.fuel, `Torch  ${Math.round(t.fuel * 100)}%  ·  ${st}`);
    this.fuel.root.classList.toggle('low', t.fuel < LOW_FUEL);
    const info = `Flasks ${t.flasks} (R)   Spare torches ${t.spares} (T)${run.ropes > 0 ? `   Ropes ${run.ropes}` : ''}`;
    if (this.torchInfo.textContent !== info) this.torchInfo.textContent = info;

    // Sanctum noise meter.
    const inSanctum = game.world.current === 'sanctum' && pl.pos.y > -2 && pl.pos.z < -66;
    this.noise.root.parentElement!.style.opacity = inSanctum || run.noise.level > 0.05 && game.world.current === 'sanctum' ? '1' : '0';
    this.setBar(this.noise, run.noise.level, run.noise.level > 0.7 ? 'Ceiling  ·  it is coming down' : run.noise.level > 0.35 ? 'Ceiling  ·  dust is falling' : 'Ceiling  ·  holding. Move quietly (C)');
    this.noiseFlash = Math.max(0, this.noiseFlash - dt * 1.5);
    this.noise.root.classList.toggle('low', run.noise.level > 0.45 || this.noiseFlash > 0);

    // Prompt.
    const text = pl.target ? pl.target.prompt() : pl.held ? `Holding ${pl.held.name} (${pl.held.weight.toFixed(1)} kg)\nLeft click: throw   Right click: put down` : null;
    if (text) {
      const lines = text.split('\n');
      const html = (pl.target ? '<span class="key">E</span> ' : '') + lines.map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
      if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
      this.prompt.style.opacity = '1';
    } else this.prompt.style.opacity = '0';

    this.objT -= dt;
    if (this.objT <= 0) { this.objT = 0.5; const o = game.objective(); if (this.objective.textContent !== o) this.objective.textContent = o; }

    if (this.bannerT > 0) { this.bannerT -= dt; this.banner.style.opacity = String(Math.min(1, this.bannerT / 0.8, (3.6 - this.bannerT) / 0.5)); }
    else this.banner.style.opacity = '0';

    // Screen edges: the last-minute pulse, pain, and a guardian breathing down your neck.
    const left = timeLeft(run.time);
    const dread = run.progress.doorSealed ? 0.5 : dreadLevel(left);
    this.pulse += dt * (2.2 + dread * 4.5);
    const near = game.guardians.nearest < 20 ? 1 - game.guardians.nearest / 20 : 0;
    const edge = Math.max(dread * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.pulse))), near * (0.5 + 0.5 * Math.sin(this.pulse * 1.7)));
    this.edge.style.opacity = edge.toFixed(3);
    this.hurt.style.opacity = Math.min(1, pl.hurtFlash + (pl.health < 35 ? (0.35 - pl.health / 100) * (0.6 + 0.4 * Math.sin(this.pulse * 1.3)) : 0)).toFixed(3);
    this.dark.style.opacity = pl.dead ? '0.85' : '0';
  }
}
