/**
 * Save data schema, defaults, validation/migration, high-score table and ghost track packing.
 * Pure logic (the localStorage access lives in the game layer), unit tested.
 */
import { defaultUpgrades, type Upgrades, type RunStatus, type UpgradeId } from './economy';

export const SAVE_KEY = 'lostTemple.save.v1';
export const SAVE_VERSION = 1;
export const MAX_HIGH_SCORES = 10;

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  fov: number;
  sensitivity: number;
  invertY: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  quality: Quality;
  showFps: boolean;
  showGhost: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  fov: 75,
  sensitivity: 1,
  invertY: false,
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.9,
  // medium is the mid-range-laptop preset (native resolution, 2x MSAA, 2048 sun shadows)
  quality: 'medium',
  showFps: false,
  showGhost: true,
};

export interface HighScore {
  haul: number;
  status: RunStatus;
  time: number; // seconds survived
  relics: number;
  date: string; // ISO date
}

export interface GhostTrack {
  /** Seconds between samples. */
  dt: number;
  /** Packed samples: x, y, z (decimetres) and yaw (centi-radians), as integers. */
  data: number[];
  haul: number;
}

export interface SaveData {
  version: number;
  money: number;
  totalEarned: number;
  runs: number;
  upgrades: Upgrades;
  settings: Settings;
  highScores: HighScore[];
  ghost: GhostTrack | null;
  seenIntro: boolean;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    money: 0,
    totalEarned: 0,
    runs: 0,
    upgrades: defaultUpgrades(),
    settings: { ...DEFAULT_SETTINGS },
    highScores: [],
    ghost: null,
    seenIntro: false,
  };
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

const STATUSES: RunStatus[] = ['escaped', 'caught', 'killed', 'entombed', 'abandoned'];

/** Parse and validate a save blob. Anything malformed falls back to defaults field by field. */
export function parseSave(json: string | null | undefined): SaveData {
  const d = defaultSave();
  if (!json) return d;
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    return d;
  }
  if (!raw || typeof raw !== 'object') return d;
  d.money = Math.floor(num(raw.money, 0, 0));
  d.totalEarned = Math.floor(num(raw.totalEarned, d.money, 0));
  d.runs = Math.floor(num(raw.runs, 0, 0));
  d.seenIntro = bool(raw.seenIntro, false);
  if (raw.upgrades && typeof raw.upgrades === 'object') {
    for (const k of Object.keys(d.upgrades) as UpgradeId[]) d.upgrades[k] = Math.floor(num(raw.upgrades[k], 0, 0, 3));
  }
  if (raw.settings && typeof raw.settings === 'object') {
    const s = raw.settings;
    d.settings = {
      fov: num(s.fov, DEFAULT_SETTINGS.fov, 50, 110),
      sensitivity: num(s.sensitivity, DEFAULT_SETTINGS.sensitivity, 0.1, 4),
      invertY: bool(s.invertY, DEFAULT_SETTINGS.invertY),
      masterVolume: num(s.masterVolume, DEFAULT_SETTINGS.masterVolume, 0, 1),
      musicVolume: num(s.musicVolume, DEFAULT_SETTINGS.musicVolume, 0, 1),
      sfxVolume: num(s.sfxVolume, DEFAULT_SETTINGS.sfxVolume, 0, 1),
      quality: s.quality === 'low' || s.quality === 'medium' || s.quality === 'high' ? s.quality : DEFAULT_SETTINGS.quality,
      showFps: bool(s.showFps, DEFAULT_SETTINGS.showFps),
      showGhost: bool(s.showGhost, DEFAULT_SETTINGS.showGhost),
    };
  }
  if (Array.isArray(raw.highScores)) {
    d.highScores = raw.highScores
      .filter((h: any) => h && typeof h === 'object')
      .map((h: any) => ({
        haul: Math.floor(num(h.haul, 0, 0)),
        status: STATUSES.includes(h.status) ? h.status : 'escaped',
        time: num(h.time, 0, 0),
        relics: Math.floor(num(h.relics, 0, 0)),
        date: typeof h.date === 'string' ? h.date : '',
      }))
      .sort((a: HighScore, b: HighScore) => b.haul - a.haul)
      .slice(0, MAX_HIGH_SCORES);
  }
  if (raw.ghost && typeof raw.ghost === 'object' && Array.isArray(raw.ghost.data)) {
    const data = raw.ghost.data.filter((n: unknown) => typeof n === 'number' && Number.isFinite(n));
    if (data.length % 4 === 0 && data.length > 0) d.ghost = { dt: num(raw.ghost.dt, 0.2, 0.05, 2), data, haul: num(raw.ghost.haul, 0, 0) };
  }
  return d;
}

export function serializeSave(s: SaveData): string {
  return JSON.stringify(s);
}

/** Insert a score, keep the table sorted (highest haul first) and capped. Returns the 0-based rank or -1. */
export function insertHighScore(list: HighScore[], entry: HighScore, max = MAX_HIGH_SCORES): { list: HighScore[]; rank: number } {
  const next = [...list, entry].sort((a, b) => b.haul - a.haul || a.time - b.time);
  const capped = next.slice(0, max);
  return { list: capped, rank: capped.indexOf(entry) };
}

// --- ghost track ------------------------------------------------------------

export class GhostRecorder {
  data: number[] = [];
  private acc = 0;
  constructor(public dt = 0.2, public maxSamples = 6000) {}

  update(dt: number, x: number, y: number, z: number, yaw: number) {
    this.acc += dt;
    while (this.acc >= this.dt) {
      this.acc -= this.dt;
      if (this.data.length / 4 >= this.maxSamples) return;
      this.data.push(Math.round(x * 10), Math.round(y * 10), Math.round(z * 10), Math.round(yaw * 100));
    }
  }

  track(haul: number): GhostTrack {
    return { dt: this.dt, data: [...this.data], haul };
  }
}

/** Interpolated ghost pose at time t (seconds since run start). */
export function samplePose(track: GhostTrack, t: number): { x: number; y: number; z: number; yaw: number } | null {
  const n = track.data.length / 4;
  if (n === 0) return null;
  const f = t / track.dt;
  const i = Math.floor(f);
  if (i >= n - 1) return null;
  if (i < 0) return null;
  const a = i * 4;
  const b = (i + 1) * 4;
  const k = f - i;
  const d = track.data;
  let ya = d[a + 3] / 100;
  let yb = d[b + 3] / 100;
  while (yb - ya > Math.PI) yb -= Math.PI * 2;
  while (yb - ya < -Math.PI) yb += Math.PI * 2;
  return {
    x: (d[a] + (d[b] - d[a]) * k) / 10,
    y: (d[a + 1] + (d[b + 1] - d[a + 1]) * k) / 10,
    z: (d[a + 2] + (d[b + 2] - d[a + 2]) * k) / 10,
    yaw: ya + (yb - ya) * k,
  };
}
