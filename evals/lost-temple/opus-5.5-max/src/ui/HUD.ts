/**
 * The in-run HUD: sundial clock, health/stamina/load/fuel bars, carried and banked loot with the
 * satchel list, gear counts, interaction prompt, toasts, zone banner, and the screen-edge pulse,
 * damage flash and fades. Text is written at 10 Hz; the pulse and bars move every frame.
 */
import { SundialHUD } from './SundialHUD';
import { formatMoney } from '../logic/economy';
import type { ToastKind } from '../world/SceneDef';

export interface HudItem {
  label: string;
  value: number;
  weight: number;
}

export interface HudState {
  health: number; // 0..1
  stamina: number; // 0..1
  exhausted: boolean;
  weight: number;
  capacity: number;
  heldMass: number;
  fuel: number; // 0..1
  torchLit: boolean;
  relighting: boolean;
  spareTorches: number;
  oilFlasks: number;
  ropes: number;
  keys: string[];
  carried: number;
  banked: number;
  items: HudItem[];
  selected: number;
  heldLabel: string | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, id?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (id) e.id = id;
  if (cls) e.className = cls;
  parent.appendChild(e);
  return e;
}

export class HUD {
  root: HTMLDivElement;
  dial: SundialHUD;
  private crosshair: HTMLDivElement;
  private prompt: HTMLDivElement;
  private toasts: HTMLDivElement;
  private bars: Record<'health' | 'stamina' | 'weight' | 'fuel', { box: HTMLDivElement; fill: HTMLElement; label: HTMLLabelElement }>;
  private carried: HTMLDivElement;
  private banked: HTMLDivElement;
  private items: HTMLDivElement;
  private inventory: HTMLDivElement;
  private zone: HTMLDivElement;
  private edge: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private fadeEl: HTMLDivElement;
  private textT = 0;
  private lastPrompt = '';
  private zoneT = 0;
  private flashT = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', parent, 'hud');
    this.root.classList.add('hidden');
    this.edge = el('div', this.root, 'edge');
    this.flashEl = el('div', this.root, 'flash');
    this.dial = new SundialHUD(this.root);
    this.crosshair = el('div', this.root, 'crosshair');
    this.prompt = el('div', this.root, 'prompt');
    this.toasts = el('div', this.root, 'toasts');
    const bars = el('div', this.root, 'bars');
    const mk = (k: 'health' | 'stamina' | 'weight' | 'fuel', text: string) => {
      const box = el('div', bars, undefined, 'bar ' + k);
      const fill = el('i', box);
      const label = el('label', box);
      label.textContent = text;
      return { box, fill, label };
    };
    this.bars = { health: mk('health', 'HEALTH'), stamina: mk('stamina', 'STAMINA'), weight: mk('weight', 'LOAD'), fuel: mk('fuel', 'TORCH') };
    const loot = el('div', this.root, 'loot');
    this.carried = el('div', loot, undefined, 'carried');
    this.banked = el('div', loot, undefined, 'banked');
    this.items = el('div', loot, undefined, 'items');
    this.inventory = el('div', this.root, 'inventory');
    this.zone = el('div', this.root, 'zoneName');
    this.fadeEl = el('div', this.root, 'fade');
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }

  toast(text: string, kind: ToastKind = 'info', seconds = 4.5) {
    const t = el('div', this.toasts, undefined, 'toast ' + kind);
    t.textContent = text;
    while (this.toasts.children.length > 5) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      t.style.opacity = '0';
      window.setTimeout(() => t.remove(), 600);
    }, seconds * 1000);
  }

  clearToasts() {
    this.toasts.innerHTML = '';
  }

  setPrompt(text: string | null, progress = 0) {
    const t = text ?? '';
    const key = t + '|' + (progress > 0 ? Math.round(progress * 20) : 0);
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    if (!t) {
      this.prompt.textContent = '';
      return;
    }
    if (progress > 0) {
      const n = 12;
      const k = Math.round(progress * n);
      this.prompt.textContent = `${t}\n${'■'.repeat(k)}${'□'.repeat(n - k)}`;
      this.prompt.style.whiteSpace = 'pre-line';
    } else {
      this.prompt.textContent = t;
      this.prompt.style.whiteSpace = 'pre-line';
    }
  }

  setCrosshair(active: boolean) {
    this.crosshair.classList.toggle('active', active);
  }

  zoneBanner(name: string, sub: string) {
    this.zone.innerHTML = '';
    this.zone.append(document.createTextNode(name));
    const s = document.createElement('small');
    s.textContent = sub;
    this.zone.appendChild(s);
    this.zone.style.opacity = '1';
    this.zoneT = 3.2;
  }

  damageFlash(strength = 1) {
    this.flashEl.style.transition = 'none';
    this.flashEl.style.opacity = String(Math.min(1, 0.35 + strength * 0.5));
    this.flashT = 0.05;
  }

  /** 0 = clear, 1 = black. */
  fade(to: number, seconds = 0.8, color = '#000') {
    this.fadeEl.style.transition = `opacity ${seconds}s`;
    this.fadeEl.style.background = color;
    this.fadeEl.style.opacity = String(to);
  }

  /** Per frame: bars, pulse, banner timing. Text at 10 Hz. */
  update(dt: number, s: HudState, edgeAmp: number) {
    const w = (b: { fill: HTMLElement }, f: number) => {
      b.fill.style.width = `${Math.max(0, Math.min(1, f)) * 100}%`;
    };
    w(this.bars.health, s.health);
    w(this.bars.stamina, s.stamina);
    const load = (s.weight + s.heldMass) / Math.max(1, s.capacity);
    w(this.bars.weight, load);
    w(this.bars.fuel, s.fuel);
    this.bars.stamina.box.style.opacity = s.exhausted ? '0.55' : '1';
    this.bars.fuel.fill.style.filter = s.torchLit ? 'none' : 'grayscale(1) brightness(0.6)';
    this.edge.style.opacity = edgeAmp.toFixed(3);
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.flashEl.style.transition = 'opacity 0.5s';
        this.flashEl.style.opacity = '0';
      }
    }
    if (this.zoneT > 0) {
      this.zoneT -= dt;
      if (this.zoneT <= 0) this.zone.style.opacity = '0';
    }
    this.textT -= dt;
    if (this.textT > 0) return;
    this.textT = 0.1;
    this.bars.weight.label.textContent = `LOAD ${(s.weight + s.heldMass).toFixed(1)} / ${s.capacity} kg`;
    this.bars.weight.fill.style.background = load > 1 ? 'linear-gradient(#d0503a, #8a2416)' : '';
    this.bars.fuel.label.textContent = s.relighting ? 'TORCH  striking flint…' : s.torchLit ? `TORCH ${Math.round(s.fuel * 100)}%` : `TORCH (out) ${Math.round(s.fuel * 100)}%`;
    this.bars.stamina.label.textContent = s.exhausted ? 'STAMINA  winded' : 'STAMINA';
    this.carried.textContent = formatMoney(s.carried);
    this.carried.title = 'Carried (lost if you are caught)';
    this.banked.textContent = `banked in the cart ${formatMoney(s.banked)}`;
    // satchel list
    this.items.innerHTML = '';
    if (s.heldLabel) {
      const d = document.createElement('div');
      d.textContent = `in hand: ${s.heldLabel}`;
      d.style.color = '#f1e6cf';
      this.items.appendChild(d);
    }
    const max = 7;
    s.items.slice(0, max).forEach((it, i) => {
      const d = document.createElement('div');
      d.textContent = `${it.label}  ${formatMoney(it.value)}  ${it.weight.toFixed(1)} kg`;
      if (i === s.selected) d.className = 'sel';
      this.items.appendChild(d);
    });
    if (s.items.length > max) {
      const d = document.createElement('div');
      d.textContent = `+${s.items.length - max} more`;
      this.items.appendChild(d);
    }
    if (s.items.length) {
      const d = document.createElement('div');
      d.textContent = '[ ] or wheel select · G take out';
      d.style.opacity = '0.6';
      d.style.fontSize = '11px';
      this.items.appendChild(d);
    }
    // gear
    const parts: string[] = [];
    parts.push(`Spare torches ${s.spareTorches}`);
    parts.push(`Oil flasks ${s.oilFlasks}`);
    if (s.ropes > 0) parts.push(`Ropes ${s.ropes}`);
    let html = parts.join(' · ');
    if (s.keys.length) html += `<br><span class="key">${s.keys.join(' · ')}</span>`;
    this.inventory.innerHTML = html;
  }
}
