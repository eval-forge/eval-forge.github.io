import { DAY_LENGTH, formatClock, clockPhase, doorClosedFraction, DOOR_CLOSE_TIME } from '../logic/countdown';

const $ = (id: string) => document.getElementById(id)!;

export interface HudState {
  remaining: number;
  stamina: number; maxStamina: number;
  weight: number; capacity: number;
  fuel: number; fuelCap: number; torchLit: boolean; relighting: number;
  loot: number; health: number;
  spares: number;
  prompt: string | null;
  objective: string;
  scene: string;
  held: string | null;
  danger: number;
  inDark: boolean;
}

/** The in-run HUD: sundial clock, bars, loot, prompts, messages, screen-edge effects. */
export class Hud {
  private dial: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private msgTimer = 0;
  private flash = 0;
  private pulse = 0;
  private lastLoot = -1;
  private sceneTimer = 0;
  private lastScene = '';

  constructor() {
    this.dial = $('sundial') as HTMLCanvasElement;
    this.dctx = this.dial.getContext('2d')!;
  }

  show(v: boolean) { $('hud').style.display = v ? 'block' : 'none'; }

  message(text: string, seconds = 3.5) {
    const m = $('message');
    m.textContent = text;
    m.style.opacity = '1';
    this.msgTimer = seconds;
  }

  hurt() { this.flash = 1; }

  update(dt: number, s: HudState, time: number) {
    this.drawDial(s.remaining, time);
    const phase = clockPhase(s.remaining);
    ($('clockText')).textContent = s.remaining > 0 ? formatClock(s.remaining) : `DOOR ${Math.max(0, Math.ceil(DOOR_CLOSE_TIME + s.remaining))}s`;
    $('clockText').className = phase;
    const bar = (id: string, f: number) => { ($(id) as HTMLElement).style.width = `${Math.max(0, Math.min(1, f)) * 100}%`; };
    bar('staminaFill', s.stamina / s.maxStamina);
    bar('fuelFill', s.fuel / s.fuelCap);
    bar('weightFill', s.weight / s.capacity);
    bar('healthFill', s.health / 100);
    $('fuelLabel').textContent = s.relighting > 0 ? 'RELIGHTING…' : s.torchLit ? `TORCH ${Math.ceil(s.fuel)}s` : s.fuel > 0 ? 'TORCH OUT · R to relight' : 'NO FUEL';
    $('weightLabel').textContent = `SATCHEL ${s.weight.toFixed(1)} / ${s.capacity} kg`;
    $('spares').textContent = `Spare torches: ${s.spares}`;
    if (s.loot !== this.lastLoot) {
      $('lootValue').textContent = `${s.loot.toLocaleString()}`;
      if (this.lastLoot >= 0 && s.loot > this.lastLoot) { $('loot').classList.remove('bump'); void ($('loot') as HTMLElement).offsetWidth; $('loot').classList.add('bump'); }
      this.lastLoot = s.loot;
    }
    const prompt = $('prompt');
    prompt.textContent = s.prompt ?? '';
    prompt.style.opacity = s.prompt ? '1' : '0';
    $('held').textContent = s.held ? `Holding: ${s.held}  ·  F/LMB drop · RMB throw` : '';
    $('objective').textContent = s.objective;
    if (s.scene !== this.lastScene) {
      this.lastScene = s.scene;
      const t = $('sceneTitle');
      t.textContent = s.scene;
      t.style.opacity = '1';
      this.sceneTimer = 3;
    }
    if (this.sceneTimer > 0) { this.sceneTimer -= dt; if (this.sceneTimer <= 0) $('sceneTitle').style.opacity = '0'; }
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) $('message').style.opacity = '0'; }
    // screen-edge pulse in the last minute / at night, damage flash, danger vignette
    const crit = phase === 'critical' || phase === 'night';
    this.pulse += dt * (phase === 'night' ? 5 : 3.2);
    const pulseA = crit ? (0.35 + 0.35 * Math.sin(this.pulse)) * (phase === 'night' ? 1 : 0.8) : 0;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    const edge = $('edge') as HTMLElement;
    const red = Math.min(1, pulseA + this.flash * 0.8 + s.danger * 0.25);
    edge.style.boxShadow = `inset 0 0 ${120 + red * 120}px ${30 + red * 60}px rgba(${crit || this.flash > 0 ? 160 : 80},0,0,${red})`;
    ($('crosshair') as HTMLElement).style.opacity = s.prompt ? '1' : '0.5';
  }

  private drawDial(remaining: number, time: number) {
    const c = this.dctx, W = this.dial.width, H = this.dial.height, cx = W / 2, cy = H / 2, R = W / 2 - 6;
    c.clearRect(0, 0, W, H);
    // stone disc
    const g = c.createRadialGradient(cx - 10, cy - 12, 4, cx, cy, R);
    g.addColorStop(0, '#b8a882'); g.addColorStop(0.75, '#8a7a5a'); g.addColorStop(1, '#5a4c36');
    c.fillStyle = g;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    c.lineWidth = 3; c.strokeStyle = '#3a3020'; c.stroke();
    // carved hour marks (13 for 13 minutes)
    c.strokeStyle = '#3e3424'; c.lineWidth = 2;
    for (let i = 0; i < 13; i++) {
      const a = -Math.PI / 2 + (i / 13) * Math.PI * 2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78);
      c.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92);
      c.stroke();
    }
    // the last two minutes carved red
    c.strokeStyle = 'rgba(150,30,20,0.85)'; c.lineWidth = 7;
    c.beginPath(); c.arc(cx, cy, R * 0.86, -Math.PI / 2 - (120 / DAY_LENGTH) * Math.PI * 2, -Math.PI / 2); c.stroke();
    // sun glyph at noon
    // elapsed wedge (shade) and shadow hand
    const f = Math.max(0, Math.min(1, 1 - remaining / DAY_LENGTH));
    c.fillStyle = 'rgba(30,20,10,0.38)';
    c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R * 0.74, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); c.closePath(); c.fill();
    const a = -Math.PI / 2 + f * Math.PI * 2;
    const urgent = remaining <= 120;
    c.strokeStyle = remaining <= 0 ? '#100808' : urgent ? (Math.sin(time * 10) > 0 ? '#2a0806' : '#4a1008') : '#1e160c';
    c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8); c.stroke();
    // gnomon
    c.fillStyle = '#c89a40';
    c.beginPath(); c.arc(cx, cy, 6, 0, Math.PI * 2); c.fill();
    if (remaining <= 0) {
      c.fillStyle = `rgba(0,0,0,${0.35 + 0.35 * doorClosedFraction(remaining)})`;
      c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    }
  }
}
