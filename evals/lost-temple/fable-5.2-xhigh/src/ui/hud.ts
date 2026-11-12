/**
 * In-run HUD: the stone sundial clock, vitals, torch, satchel, prompts,
 * toasts, and the full-screen danger overlays. Plain DOM over the canvas.
 */
import { DOOR_CLOSE_TIME, WARN_PULSE_AT, WARN_TICK_AT, formatClock } from '../core/clock';
import { KEY_ITEMS } from '../core/economy';
import { clamp01 } from '../core/rng';
import { SCENES } from '../core/scenes';
import { sundialFaceCanvas } from '../engine/textures';
import type { Game, ToastKind } from '../game/game';
import { el, num, setClass, setText } from './dom';

const DIAL_PX = 118;

function bar(cls: string): { root: HTMLElement; fill: HTMLElement } {
  const root = el('div', `bar ${cls}`);
  const fill = el('i');
  root.appendChild(fill);
  return { root, fill };
}

function setBar(fill: HTMLElement, v: number): void {
  const s = `scaleX(${clamp01(v).toFixed(3)})`;
  if (fill.style.transform !== s) fill.style.transform = s;
}

export class Hud {
  readonly root = el('div', 'hud');
  private readonly dial = el('canvas');
  private readonly face = sundialFaceCanvas();
  private readonly clock = el('div', 'clock', '13:00');
  private readonly clockLabel = el('div', 'label', 'until dark');
  private readonly strain = el('div', 'strain');
  private readonly strainBar = bar('strainbar');
  private readonly objective = el('div', 'objective');
  private readonly objectiveText = el('span');
  private readonly toasts = el('div', 'toasts');
  private readonly bannerEl = el('div', 'banner');
  private readonly bannerTitle = el('div', 'title');
  private readonly bannerSub = el('div', 'sub');
  private readonly crosshair = el('div', 'crosshair');
  private readonly promptEl = el('div', 'prompt');
  private readonly promptText = el('span');
  private readonly hint = el('div', 'hint');
  private readonly health = bar('health');
  private readonly healthVal = el('span', 'val');
  private readonly stamina = bar('stamina');
  private readonly staminaVal = el('span', 'val');
  private readonly fuel = bar('fuel');
  private readonly torchState = el('span', 'st out', 'Torch out');
  private readonly torchTime = el('span');
  private readonly supplies = el('div', 'row');
  private readonly load = bar('load');
  private readonly loadVal = el('span', 'val');
  private readonly lootValue = el('span');
  private readonly lootWrap = el('div', 'loot-value');
  private readonly chips = el('div', 'chips');
  private readonly held = el('div', 'held shadowed');
  private readonly pulse = el('div', 'pulse');
  private readonly hurtEl = el('div', 'hurt');
  private readonly heavy = el('div', 'heavy');

  private dialT = 0;
  private bannerT = 0;
  private hurtLevel = 0;
  private lastLoot = -1;
  private chipKey = '';
  private objT = 0;
  private darkT = 0;
  private pulsePhase = 0;

  constructor(private readonly game: Game) {
    const r = this.root;
    r.append(this.pulse, this.hurtEl, this.heavy);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dial.width = this.dial.height = Math.round(DIAL_PX * dpr);
    const sd = el('div', 'sundial');
    this.strain.append(el('div', 'label', 'ceiling'), this.strainBar.root);
    sd.append(this.dial, this.clock, this.clockLabel, this.strain);
    r.appendChild(sd);

    this.objective.append(el('b', '', 'Objective'), this.objectiveText);
    r.append(this.objective, this.toasts);

    this.bannerEl.append(this.bannerTitle, this.bannerSub);
    r.append(this.bannerEl, this.crosshair);

    this.promptEl.append(el('span', 'key', 'E'), this.promptText);
    r.append(this.promptEl, this.hint, this.held);

    const vit = el('div', 'panel vitals');
    const hrow = el('div', 'row');
    hrow.append(el('span', 'name', 'Health'), this.health.root, this.healthVal);
    const srow = el('div', 'row');
    srow.append(el('span', 'name', 'Stamina'), this.stamina.root, this.staminaVal);
    vit.append(hrow, srow);
    r.appendChild(vit);

    const tb = el('div', 'panel torchbox');
    const ts = el('div', 'torch-state');
    ts.append(this.torchState, this.torchTime);
    const frow = el('div', 'row');
    frow.append(el('span', 'name', 'Fuel'), this.fuel.root);
    tb.append(ts, frow, this.supplies);
    r.appendChild(tb);

    const lb = el('div', 'panel lootbox');
    this.lootWrap.append(this.lootValue, el('small', '', 'coins'));
    const lrow = el('div', 'row');
    lrow.append(el('span', 'name', 'Satchel'), this.load.root, this.loadVal);
    lb.append(this.lootWrap, lrow, this.chips);
    r.appendChild(lb);
  }

  setVisible(on: boolean): void {
    setClass(this.root, 'on', on);
  }

  reset(): void {
    while (this.toasts.firstChild) this.toasts.removeChild(this.toasts.firstChild);
    this.bannerEl.classList.remove('on');
    this.hurtLevel = 0;
    this.lastLoot = -1;
    this.darkT = 0;
  }

  toast(text: string, kind: ToastKind): void {
    const t = el('div', `toast ${kind}`, text);
    this.toasts.appendChild(t);
    while (this.toasts.childElementCount > 5) this.toasts.removeChild(this.toasts.firstElementChild!);
    window.setTimeout(() => t.classList.add('out'), 4600);
    window.setTimeout(() => t.remove(), 5300);
  }

  banner(title: string, sub: string): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerEl.classList.add('on');
    this.bannerT = 3.6;
  }

  hurt(amount: number): void {
    this.hurtLevel = Math.min(1, this.hurtLevel + 0.12 + amount / 45);
  }

  update(dt: number): void {
    const game = this.game;
    if (!this.root.classList.contains('on')) return;
    const run = game.run;
    const clock = run.clock;
    const player = game.player;
    const torch = run.torch;

    // --- clock -----------------------------------------------------------
    this.dialT -= dt;
    if (this.dialT <= 0) {
      this.dialT = clock.isDark || clock.remaining <= WARN_TICK_AT ? 0.05 : 0.25;
      this.drawDial();
    }
    if (clock.isDark) {
      setText(this.clock, formatClock(clock.untilDoorShut));
      setText(this.clockLabel, 'door closing');
      setClass(this.clock, 'urgent', true);
    } else {
      setText(this.clock, formatClock(clock.remaining));
      setText(this.clockLabel, 'until dark');
      setClass(this.clock, 'warn', clock.remaining <= WARN_TICK_AT && clock.remaining > WARN_PULSE_AT);
      setClass(this.clock, 'urgent', clock.remaining <= WARN_PULSE_AT);
    }

    // --- vitals ----------------------------------------------------------
    setBar(this.health.fill, run.health / 100);
    setText(this.healthVal, `${Math.ceil(run.health)}`);
    setBar(this.stamina.fill, player.stamina / 100);
    setText(this.staminaVal, `${Math.round(player.stamina)}`);
    setClass(this.stamina.root, 'low', player.stamina < 25);

    // --- torch -----------------------------------------------------------
    setBar(this.fuel.fill, torch.fuelFraction);
    setClass(this.fuel.root, 'low', torch.fuelFraction < 0.2);
    const st = torch.lit ? 'lit' : torch.vulnerable ? 'strike' : 'out';
    if (!this.torchState.classList.contains(st)) this.torchState.className = `st ${st}`;
    setText(this.torchState, torch.lit ? 'Torch lit' : torch.vulnerable ? 'Striking the flint…' : torch.fuel <= 0 ? 'Torch dry' : 'Torch out  ·  F');
    setText(this.torchTime, `${formatClock(torch.fuel)} of flame`);
    setText(this.supplies, `Oil ×${torch.flasks}   ·   Spare torches ×${torch.spares}   ·   Rope ×${run.ropes}`);

    // --- satchel ---------------------------------------------------------
    const s = run.satchel;
    const carried = s.weight + (player.held ? player.held.mass : 0);
    setBar(this.load.fill, carried / s.capacity);
    const ratio = carried / s.capacity;
    setClass(this.load.root, 'heavy', ratio > 0.6 && ratio <= 0.85);
    setClass(this.load.root, 'over', ratio > 0.85);
    setText(this.loadVal, `${carried.toFixed(1)} / ${s.capacity} kg`);
    if (s.value !== this.lastLoot) {
      if (this.lastLoot >= 0 && s.value > this.lastLoot) {
        this.lootWrap.classList.remove('pop');
        void this.lootWrap.offsetWidth;
        this.lootWrap.classList.add('pop');
      }
      this.lastLoot = s.value;
      this.lootValue.textContent = num(s.value);
    }
    const key = `${s.count}|${s.keys.join(',')}`;
    if (key !== this.chipKey) {
      this.chipKey = key;
      while (this.chips.firstChild) this.chips.removeChild(this.chips.firstChild);
      if (s.count > 0) this.chips.appendChild(el('span', 'chip', `${s.count} relic${s.count === 1 ? '' : 's'}`));
      for (const k of s.keys) this.chips.appendChild(el('span', 'chip', KEY_ITEMS[k].name));
    }

    // --- prompt, held, hints ----------------------------------------------
    const prompt = game.state === 'playing' ? game.prompt : null;
    setClass(this.promptEl, 'on', !!prompt);
    setClass(this.crosshair, 'hot', !!prompt);
    if (prompt) setText(this.promptText, prompt);
    setClass(this.held, 'on', !!player.held);
    if (player.held) setText(this.held, `Carrying ${player.held.name} (${player.held.mass.toFixed(1)} kg)  ·  left click throws, right click or G drops`);

    this.objT -= dt;
    if (this.objT <= 0) {
      this.objT = 0.5;
      setText(this.objectiveText, game.objective());
    }

    const zone = SCENES[game.scenes.current].zone;
    const blind = zone === 'C' && game.outdoor < 0.05 && !torch.lit;
    this.darkT = blind ? this.darkT + dt : 0;
    let hint = '';
    if (blind && this.darkT > 1.2) {
      hint = torch.vulnerable ? 'Hold still. You are exposed while you strike it.' : torch.fuel > 0 ? 'Pitch black. F strikes your torch.' : 'Pitch black, and the torch is dry. R to refuel.';
    } else if (player.mode === 'climb') {
      hint = 'W / S to climb  ·  Space to let go';
    } else if (player.mode === 'swim') {
      hint = 'Swimming. Deep water puts the torch out.';
    }
    setClass(this.hint, 'on', hint !== '');
    if (hint) setText(this.hint, hint);

    const strain = game.sanctumStrain && game.scenes.current === 'sanctum' ? game.sanctumStrain() : -1;
    setClass(this.strain, 'on', strain >= 0);
    if (strain >= 0) setBar(this.strainBar.fill, strain);

    // --- banner ----------------------------------------------------------
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.bannerEl.classList.remove('on');
    }

    // --- overlays ----------------------------------------------------------
    // Last minute: the screen edges pulse with the clock.
    let pulse = 0;
    if (clock.pulsing || clock.isDark) {
      const rate = clock.isDark ? 2.4 : 1.2 + 1.4 * (1 - clock.remaining / WARN_PULSE_AT);
      this.pulsePhase += dt * rate * Math.PI * 2;
      const wave = 0.5 + 0.5 * Math.sin(this.pulsePhase);
      pulse = (0.25 + 0.55 * clock.dread) * (0.35 + 0.65 * wave);
      if (clock.isDark) pulse *= 0.55 + 0.45 * clamp01(clock.sinceDark / DOOR_CLOSE_TIME);
    }
    const threat = game.guardians.threat;
    pulse = Math.max(pulse, threat > 0.55 ? (threat - 0.55) * 1.2 * (0.6 + 0.4 * Math.sin(game.time * 9)) : 0);
    this.pulse.style.opacity = pulse.toFixed(3);
    this.hurtLevel = Math.max(0, this.hurtLevel - dt * 1.4);
    const lowHealth = run.health < 35 ? (1 - run.health / 35) * (0.35 + 0.15 * Math.sin(game.time * 5)) : 0;
    this.hurtEl.style.opacity = Math.min(1, this.hurtLevel + lowHealth).toFixed(3);
    this.heavy.style.opacity = (player.stamina < 12 ? 0.5 * (1 - player.stamina / 12) : 0).toFixed(3);
  }

  /** The stone sundial: a shadow hand sweeping from dawn (left) through noon (top) to dusk (right). */
  private drawDial(): void {
    const c = this.dial;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const clock = this.game.run.clock;
    const S = c.width;
    const R = S / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.translate(R, R);
    ctx.beginPath();
    ctx.arc(0, 0, R - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.face, -R, -R, S, S);
    const f = clamp01(clock.dayFraction);
    const dark = clock.isDark;
    const a = dark ? Math.PI * 2 + (Math.PI / 2) * clamp01(clock.sinceDark / DOOR_CLOSE_TIME) : Math.PI * (1 + f);

    // Night half of the dial.
    ctx.fillStyle = 'rgba(14, 16, 30, 0.72)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    // Daylight already spent.
    ctx.fillStyle = 'rgba(30, 22, 12, 0.5)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, Math.PI, dark ? Math.PI * 2 : a);
    ctx.closePath();
    ctx.fill();
    // Daylight left, warming to red at the end.
    if (!dark) {
      const warm = clamp01((f - 0.72) / 0.28);
      ctx.fillStyle = `rgba(255, ${Math.round(214 - 110 * warm)}, ${Math.round(120 - 90 * warm)}, ${0.2 + 0.14 * warm})`;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, a, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(10, 12, 28, 0.55)';
      ctx.fillRect(-R, -R, S, S);
    }
    // Dusk mark and door mark.
    ctx.strokeStyle = '#d2532c';
    ctx.lineWidth = S * 0.035;
    ctx.beginPath();
    ctx.moveTo(R * 0.72, 0);
    ctx.lineTo(R, 0);
    ctx.stroke();
    ctx.strokeStyle = '#8fa2d8';
    ctx.beginPath();
    ctx.moveTo(0, R * 0.78);
    ctx.lineTo(0, R);
    ctx.stroke();
    // The gnomon's shadow.
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(8, 6, 4, 0.9)';
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.075);
    ctx.lineTo(R * 0.9, 0);
    ctx.lineTo(0, R * 0.075);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(R, R);
    // Bronze boss and rim.
    const g = ctx.createRadialGradient(-R * 0.03, -R * 0.03, 1, 0, 0, R * 0.13);
    g.addColorStop(0, '#f1d58c');
    g.addColorStop(1, '#6e5320');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.12, 0, Math.PI * 2);
    ctx.fill();
    const urgent = !dark && clock.remaining <= WARN_PULSE_AT;
    const warn = !dark && clock.remaining <= WARN_TICK_AT;
    const beat = 0.5 + 0.5 * Math.sin(this.game.time * (urgent ? 9 : 4));
    ctx.lineWidth = S * 0.035;
    ctx.strokeStyle = dark ? `rgba(150, 170, 255, ${0.5 + 0.4 * beat})` : urgent ? `rgba(255, 70, 40, ${0.55 + 0.45 * beat})` : warn ? `rgba(255, 150, 70, ${0.5 + 0.3 * beat})` : '#5a4a2c';
    ctx.beginPath();
    ctx.arc(0, 0, R - S * 0.02, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
