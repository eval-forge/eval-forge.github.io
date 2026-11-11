/**
 * The day clock: dawn → darkness in DAY_SECONDS, then the great door's final window.
 * Also the sun's path and the colour-grading keyframes. Pure.
 */

export const DAY_SECONDS = 780; // 13 minutes: 06:00 → 19:00
export const FINAL_WINDOW = 75; // door closing time after darkness
export const START_HOUR = 6;
export const END_HOUR = 19;
export const LATE_THRESHOLD = 120;
export const CRITICAL_THRESHOLD = 60;
export const MAX_ELEVATION_DEG = 72;

export type ClockPhase = 'day' | 'late' | 'critical' | 'dark' | 'sealed';

export function phaseFor(elapsed: number): ClockPhase {
  const left = DAY_SECONDS - elapsed;
  if (left > LATE_THRESHOLD) return 'day';
  if (left > CRITICAL_THRESHOLD) return 'late';
  if (left > 0) return 'critical';
  if (-left < FINAL_WINDOW) return 'dark';
  return 'sealed';
}

const PHASE_ORDER: ClockPhase[] = ['day', 'late', 'critical', 'dark', 'sealed'];

/** Seconds between HUD clock ticks: 1 s normally, speeding up to 0.25 s in the last 2 minutes. */
export function tickInterval(timeLeft: number): number {
  if (timeLeft > LATE_THRESHOLD) return 1.0;
  if (timeLeft <= 0) return 0.25;
  const f = 1 - timeLeft / LATE_THRESHOLD; // 0 → 1
  return 1.0 + (0.25 - 1.0) * f;
}

/** Tick loudness 0..1: quiet, then ramps up over the last 2 minutes. */
export function tickVolume(timeLeft: number): number {
  if (timeLeft > LATE_THRESHOLD) return 0.25;
  if (timeLeft <= 0) return 1.0;
  return 0.25 + 0.75 * (1 - timeLeft / LATE_THRESHOLD);
}

export function gameHour(elapsed: number): number {
  return START_HOUR + ((END_HOUR - START_HOUR) * elapsed) / DAY_SECONDS;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function formatHour(elapsed: number): string {
  const h = gameHour(elapsed);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

export type ClockEvent = { type: 'phase'; phase: ClockPhase } | { type: 'tick'; volume: number; urgent: boolean };

export class RunClock {
  elapsed = 0;
  phase: ClockPhase = 'day';
  private tickAcc = 0;

  constructor(startElapsed = 0) {
    this.elapsed = startElapsed;
    this.phase = phaseFor(startElapsed);
  }

  get timeLeft(): number {
    return DAY_SECONDS - this.elapsed;
  }

  /** 0 = door fully open, 1 = fully closed. */
  get doorClosure(): number {
    const after = this.elapsed - DAY_SECONDS;
    if (after <= 0) return 0;
    return Math.min(1, after / FINAL_WINDOW);
  }

  get doorTimeLeft(): number {
    return Math.max(0, DAY_SECONDS + FINAL_WINDOW - this.elapsed);
  }

  /** Advance time; returns phase transitions (in order) and clock ticks. */
  update(dt: number): ClockEvent[] {
    const events: ClockEvent[] = [];
    this.elapsed += dt;
    this.collectPhases(events);
    this.tickAcc += dt;
    const iv = tickInterval(this.timeLeft);
    if (this.tickAcc >= iv && this.phase !== 'sealed') {
      this.tickAcc = this.tickAcc % iv;
      events.push({ type: 'tick', volume: tickVolume(this.timeLeft), urgent: this.timeLeft <= LATE_THRESHOLD });
    }
    return events;
  }

  /** Jump the clock forward (the Sun Idol's curse). */
  advance(seconds: number): ClockEvent[] {
    const events: ClockEvent[] = [];
    this.elapsed += seconds;
    this.collectPhases(events);
    return events;
  }

  private collectPhases(events: ClockEvent[]) {
    const next = phaseFor(this.elapsed);
    if (next !== this.phase) {
      const from = PHASE_ORDER.indexOf(this.phase);
      const to = PHASE_ORDER.indexOf(next);
      for (let i = from + 1; i <= to; i++) events.push({ type: 'phase', phase: PHASE_ORDER[i] });
      this.phase = next;
    }
  }
}

// ---------------------------------------------------------------- sun path

export interface SunState {
  /** Unit vector pointing from the ground toward the sun (or moon at night). */
  dir: [number, number, number];
  elevationDeg: number;
  /** True when the light is the moon (sun below the horizon). */
  isMoon: boolean;
  /** Day fraction 0 (dawn) … 1 (darkness). Can exceed 1 at night. */
  p: number;
}

/**
 * Sun path: rises in the east (+x), crosses due south (+z) at 12:30 with 72° elevation,
 * sets in the west (−x) at darkness.
 */
export function sunAt(elapsed: number): SunState {
  const p = elapsed / DAY_SECONDS;
  if (p <= 1) {
    const cp = Math.max(0, p);
    const el = MAX_ELEVATION_DEG * Math.sin(Math.PI * (0.03 + 0.97 * cp));
    const a = Math.PI * cp;
    return { dir: sphericalDir(a, el), elevationDeg: el, isMoon: false, p };
  }
  // night: moon high in the south-east, cold and dim
  const el = 38;
  const a = Math.PI * 0.35;
  return { dir: sphericalDir(a, el), elevationDeg: el, isMoon: true, p };
}

function sphericalDir(azimuthParam: number, elDeg: number): [number, number, number] {
  const el = (elDeg * Math.PI) / 180;
  const c = Math.cos(el);
  return [Math.cos(azimuthParam) * c, Math.sin(el), Math.sin(azimuthParam) * c];
}

// ---------------------------------------------------------------- grading

export interface Grade {
  sunColor: [number, number, number];
  sunIntensity: number;
  hemiSky: [number, number, number];
  hemiGround: [number, number, number];
  hemiIntensity: number;
  skyTop: [number, number, number];
  skyHorizon: [number, number, number];
  fog: [number, number, number];
  fogDensity: number;
  exposure: number;
  saturation: number;
  contrast: number;
  tint: [number, number, number];
}

type Key = { p: number; g: Grade };

const hex = (h: number): [number, number, number] => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

const KEYS: Key[] = [
  { p: 0.0, g: { sunColor: hex(0xffb88a), sunIntensity: 2.0, hemiSky: hex(0x9fb0d8), hemiGround: hex(0x5a4436), hemiIntensity: 0.85, skyTop: hex(0x5d74a8), skyHorizon: hex(0xf2b394), fog: hex(0xc9a99a), fogDensity: 0.0085, exposure: 0.95, saturation: 0.92, contrast: 1.0, tint: [1.05, 0.96, 0.95] } },
  { p: 0.18, g: { sunColor: hex(0xffe6c8), sunIntensity: 2.6, hemiSky: hex(0xb8d0f0), hemiGround: hex(0x5a5038), hemiIntensity: 0.95, skyTop: hex(0x4a82c8), skyHorizon: hex(0xbfd6e8), fog: hex(0xb6c6c8), fogDensity: 0.0055, exposure: 1.0, saturation: 1.0, contrast: 1.0, tint: [1.0, 1.0, 1.0] } },
  { p: 0.5, g: { sunColor: hex(0xfff6ea), sunIntensity: 3.0, hemiSky: hex(0xc0d8f8), hemiGround: hex(0x605a40), hemiIntensity: 1.0, skyTop: hex(0x3a76c8), skyHorizon: hex(0xc8e0f0), fog: hex(0xc0d2d8), fogDensity: 0.0045, exposure: 1.0, saturation: 1.04, contrast: 1.02, tint: [1.0, 1.0, 0.99] } },
  { p: 0.78, g: { sunColor: hex(0xffd8a0), sunIntensity: 2.6, hemiSky: hex(0xb0c4e0), hemiGround: hex(0x5a4a34), hemiIntensity: 0.9, skyTop: hex(0x4670b0), skyHorizon: hex(0xe8c898), fog: hex(0xc4b49a), fogDensity: 0.0055, exposure: 1.0, saturation: 1.05, contrast: 1.04, tint: [1.04, 0.99, 0.94] } },
  { p: 0.92, g: { sunColor: hex(0xff7a38), sunIntensity: 2.2, hemiSky: hex(0x8a78a8), hemiGround: hex(0x4a2a20), hemiIntensity: 0.7, skyTop: hex(0x34386c), skyHorizon: hex(0xff7442), fog: hex(0xa4604a), fogDensity: 0.0075, exposure: 0.98, saturation: 1.12, contrast: 1.1, tint: [1.12, 0.92, 0.84] } },
  { p: 1.0, g: { sunColor: hex(0xc03a22), sunIntensity: 0.6, hemiSky: hex(0x4a3a6a), hemiGround: hex(0x2a1814), hemiIntensity: 0.3, skyTop: hex(0x181a3a), skyHorizon: hex(0x9a3a30), fog: hex(0x3e2428), fogDensity: 0.011, exposure: 0.92, saturation: 1.0, contrast: 1.12, tint: [1.1, 0.88, 0.9] } },
  { p: 1.06, g: { sunColor: hex(0x8090c8), sunIntensity: 0.35, hemiSky: hex(0x26304e), hemiGround: hex(0x0a0c12), hemiIntensity: 0.18, skyTop: hex(0x04060e), skyHorizon: hex(0x0e1626), fog: hex(0x080c14), fogDensity: 0.014, exposure: 0.88, saturation: 0.6, contrast: 1.08, tint: [0.84, 0.95, 1.16] } },
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function gradeAt(elapsed: number): Grade {
  const p = elapsed / DAY_SECONDS;
  if (p <= KEYS[0].p) return KEYS[0].g;
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i];
    const b = KEYS[i + 1];
    if (p <= b.p) {
      const t = (p - a.p) / (b.p - a.p);
      const s = t * t * (3 - 2 * t);
      const out: any = {};
      for (const k of Object.keys(a.g) as (keyof Grade)[]) {
        const av = a.g[k] as any;
        const bv = b.g[k] as any;
        out[k] = Array.isArray(av) ? lerp3(av as [number, number, number], bv, s) : lerp(av, bv, s);
      }
      return out as Grade;
    }
  }
  return KEYS[KEYS.length - 1].g;
}
