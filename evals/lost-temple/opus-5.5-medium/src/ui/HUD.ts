import { G } from '../core/ctx';
import { DAY_LENGTH, fmtClock, phaseAt, timeLeft, doorOpenFraction } from '../logic/countdown';
import { RELIC_BY_ID } from '../logic/relics';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

export class HUD {
  root: HTMLDivElement;
  private dial: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private clock: HTMLDivElement;
  private haul: HTMLDivElement;
  private scene: HTMLDivElement;
  private prompt: HTMLDivElement;
  private toasts: HTMLDivElement;
  private bars: Record<string, { fill: HTMLDivElement; label: HTMLDivElement }> = {};
  private relight: HTMLDivElement;
  private inv: HTMLDivElement;
  private items: HTMLDivElement;
  private dialT = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud hidden', parent);
    const tl = el('div', 'hud-tl', this.root);
    this.dial = el('canvas', 'dial', tl);
    this.dial.width = this.dial.height = 150;
    this.dctx = this.dial.getContext('2d')!;
    this.clock = el('div', 'clock', tl);
    const tr = el('div', 'hud-tr', this.root);
    this.haul = el('div', 'haul', tr);
    this.scene = el('div', 'scene', tr);
    this.items = el('div', 'items', tr);
    const bl = el('div', 'hud-bl', this.root);
    for (const [k, name] of [['health', 'Health'], ['stamina', 'Stamina'], ['fuel', 'Torch'], ['weight', 'Load']] as const) {
      const row = el('div', 'bar-row', bl);
      const label = el('div', 'bar-label', row, name);
      const bar = el('div', 'bar ' + k, row);
      const fill = el('div', 'fill', bar);
      this.bars[k] = { fill, label };
    }
    el('div', 'crosshair', this.root);
    this.prompt = el('div', 'prompt', this.root);
    this.toasts = el('div', 'toasts', this.root);
    this.relight = el('div', 'relight hidden', this.root, '<div class="fill"></div><span>Lighting torch...</span>');
    this.inv = el('div', 'inventory hidden', this.root);
  }

  show(v: boolean) { this.root.classList.toggle('hidden', !v); }

  toast(msg: string, secs = 3) {
    const t = el('div', 'toast', this.toasts, msg);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
    setTimeout(() => t.classList.add('fade'), secs * 1000);
    setTimeout(() => t.remove(), secs * 1000 + 600);
  }

  setPrompt(text: string | null) {
    this.prompt.textContent = text ? `[E] ${text}` : '';
    this.prompt.style.opacity = text ? '1' : '0';
  }

  private setBar(k: string, frac: number, text: string, warn = false) {
    const b = this.bars[k];
    b.fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    b.label.textContent = text;
    b.fill.parentElement!.classList.toggle('warn', warn);
  }

  update(dt: number) {
    const p = G.player, t = G.torch, s = G.satchel;
    this.setBar('health', p.health / 100, `Health`, p.health < 35);
    this.setBar('stamina', p.stamina / p.staminaMax, 'Stamina', p.stamina < 20);
    this.setBar('fuel', t.fuelFrac, `Torch ${t.lit ? '' : '(out) '}· ${t.spares} spare · ${t.flasks} oil`, t.fuelFrac < 0.25);
    this.setBar('weight', s.weight / s.capacity, `Load ${s.weight.toFixed(1)} / ${s.capacity} kg`, s.weight / s.capacity > 0.8);
    this.haul.innerHTML = `<b>${s.value.toLocaleString()}</b> <small>gold carried</small>`;
    const ph = phaseAt(G.elapsed);
    this.scene.textContent = `${G.world.current.name} · Zone ${G.world.current.zone}`;
    const keys = s.items.filter((i) => RELIC_BY_ID[i.typeId].rarity === 'key').map((i) => RELIC_BY_ID[i.typeId].name);
    this.items.textContent = `${s.items.length} relics${keys.length ? ' · ' + keys.join(', ') : ''}${G.carry.held ? ' · holding ' + G.carry.held.name : ''}`;
    const left = timeLeft(G.elapsed);
    if (ph === 'dark') this.clock.innerHTML = `<span class="dark">DARKNESS</span><br><small>door closing ${Math.round(doorOpenFraction(G.elapsed) * 100)}%</small>`;
    else if (ph === 'sealed') this.clock.innerHTML = `<span class="dark">SEALED</span>`;
    else this.clock.innerHTML = `${fmtClock(left)}<br><small>until dark</small>`;
    this.clock.className = 'clock ' + ph;
    if (t.relightProgress >= 0) { this.relight.classList.remove('hidden'); (this.relight.firstChild as HTMLDivElement).style.width = `${t.relightProgress * 100}%`; }
    else this.relight.classList.add('hidden');
    const showInv = G.input.down('Tab');
    this.inv.classList.toggle('hidden', !showInv);
    if (showInv) {
      this.inv.innerHTML = '<h3>Satchel</h3>' + (s.items.length ? s.items.map((i) => `<div><span>${RELIC_BY_ID[i.typeId].name}</span><span>${i.value} g · ${i.weight} kg</span></div>`).join('') : '<div>Empty</div>') + '<p>Q drops the last relic</p>';
    }
    this.dialT -= dt;
    if (this.dialT <= 0) { this.dialT = 0.1; this.drawDial(); }
  }

  /** Stone sundial: the gnomon's shadow sweeps toward the dark sector as time runs out. */
  private drawDial() {
    const c = this.dctx, W = 150, cx = 75, cy = 75, r = 64;
    c.clearRect(0, 0, W, W);
    const ph = phaseAt(G.elapsed);
    // stone face
    const grad = c.createRadialGradient(cx - 15, cy - 15, 10, cx, cy, r);
    grad.addColorStop(0, '#b9ab8d'); grad.addColorStop(1, '#6f6450');
    c.fillStyle = grad;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.lineWidth = 4; c.strokeStyle = '#3d362b'; c.stroke();
    // sky band: day arc from left (dawn) over the top to right (dusk)
    const start = Math.PI, end = Math.PI * 2;
    c.lineWidth = 9;
    c.strokeStyle = '#d9b860';
    c.beginPath(); c.arc(cx, cy, r - 12, start, start + (end - start) * (1 - 120 / DAY_LENGTH)); c.stroke();
    c.strokeStyle = '#c9662e';
    c.beginPath(); c.arc(cx, cy, r - 12, start + (end - start) * (1 - 120 / DAY_LENGTH), start + (end - start) * (1 - 60 / DAY_LENGTH)); c.stroke();
    c.strokeStyle = '#8f1f14';
    c.beginPath(); c.arc(cx, cy, r - 12, start + (end - start) * (1 - 60 / DAY_LENGTH), end); c.stroke();
    // night (bottom half)
    c.fillStyle = 'rgba(20,20,40,0.55)';
    c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r - 3, 0, Math.PI); c.fill();
    // hour marks
    c.strokeStyle = '#2e281f'; c.lineWidth = 2;
    for (let i = 0; i <= 12; i++) {
      const a = start + (i / 12) * Math.PI;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * (r - 20), cy + Math.sin(a) * (r - 20)); c.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); c.stroke();
    }
    // the sun hand / shadow
    const prog = Math.min(1.08, G.elapsed / DAY_LENGTH);
    const a = start + prog * Math.PI;
    c.strokeStyle = ph === 'critical' || ph === 'dark' ? '#ff4020' : '#201a12';
    c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10)); c.stroke();
    c.fillStyle = '#3d362b';
    c.beginPath(); c.arc(cx, cy, 7, 0, Math.PI * 2); c.fill();
    if (ph === 'critical' || ph === 'dark') {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
      c.strokeStyle = `rgba(255,60,20,${0.4 + 0.5 * pulse})`; c.lineWidth = 5;
      c.beginPath(); c.arc(cx, cy, r + 1, 0, Math.PI * 2); c.stroke();
    }
  }
}
