import { NO_UPGRADES, type UpgradeLevels } from './economy';

export const SAVE_KEY = 'lost-temple-save-v1';
export const MAX_SCORES = 10;

export type Outcome = 'escaped' | 'caught' | 'killed' | 'entombed';

export interface Score {
  value: number;
  /** Game seconds from dawn to the end of the run. */
  time: number;
  relics: number;
  outcome: Outcome;
  /** ISO date. */
  date: string;
}

export interface Settings {
  fov: number;
  sensitivity: number;
  volume: number;
  quality: 'low' | 'medium' | 'high';
  invertY: boolean;
}

export interface GhostData { value: number; step: number; samples: number[]; }

export interface SaveData {
  version: 1;
  gold: number;
  upgrades: UpgradeLevels;
  scores: Score[];
  settings: Settings;
  ghost: GhostData | null;
  runs: number;
  seenIntro: boolean;
}

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; }

export function defaultSettings(): Settings {
  return { fov: 75, sensitivity: 1, volume: 0.8, quality: 'high', invertY: false };
}

export function defaultSave(): SaveData {
  return {
    version: 1, gold: 0, upgrades: { ...NO_UPGRADES }, scores: [], settings: defaultSettings(),
    ghost: null, runs: 0, seenIntro: false,
  };
}

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) =>
  typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** Load and sanitise. Anything missing or corrupt falls back to defaults rather than throwing. */
export function loadSave(storage: StorageLike | null): SaveData {
  const d = defaultSave();
  if (!storage) return d;
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return d;
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object') return d;
    d.gold = Math.floor(num(j.gold, 0, 0));
    for (const k of Object.keys(d.upgrades) as (keyof UpgradeLevels)[]) {
      d.upgrades[k] = Math.floor(num(j.upgrades?.[k], 0, 0, 3));
    }
    if (Array.isArray(j.scores)) {
      d.scores = j.scores
        .filter((s: any) => s && typeof s.value === 'number')
        .map((s: any): Score => ({
          value: num(s.value, 0, 0), time: num(s.time, 0, 0), relics: num(s.relics, 0, 0),
          outcome: s.outcome === 'escaped' ? 'escaped' : s.outcome ?? 'caught', date: String(s.date ?? ''),
        }))
        .slice(0, MAX_SCORES);
    }
    const s = j.settings ?? {};
    d.settings = {
      fov: num(s.fov, 75, 55, 110), sensitivity: num(s.sensitivity, 1, 0.2, 3), volume: num(s.volume, 0.8, 0, 1),
      quality: s.quality === 'low' || s.quality === 'medium' || s.quality === 'high' ? s.quality : 'high',
      invertY: !!s.invertY,
    };
    if (j.ghost && Array.isArray(j.ghost.samples)) {
      d.ghost = { value: num(j.ghost.value, 0, 0), step: num(j.ghost.step, 0.25, 0.05, 2), samples: j.ghost.samples.map((n: unknown) => num(n, 0)) };
    }
    d.runs = Math.floor(num(j.runs, 0, 0));
    d.seenIntro = !!j.seenIntro;
  } catch {
    return defaultSave();
  }
  return d;
}

export function writeSave(storage: StorageLike | null, data: SaveData): void {
  if (!storage) return;
  try { storage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage full or blocked: play on */ }
}

/**
 * Insert a finished run into the table. Sorted by value, then by faster time.
 * Returns the 0-based rank, or -1 if it did not make the table. Only escapes are ranked.
 */
export function addScore(data: SaveData, score: Score): number {
  if (score.outcome !== 'escaped') return -1;
  data.scores.push(score);
  data.scores.sort((a, b) => b.value - a.value || a.time - b.time);
  const rank = data.scores.indexOf(score);
  data.scores = data.scores.slice(0, MAX_SCORES);
  return rank < MAX_SCORES ? rank : -1;
}

/** Bank a finished run: gold, scores, run count. */
export function bankRun(data: SaveData, score: Score): number {
  data.runs += 1;
  if (score.outcome === 'escaped') data.gold += score.value;
  return addScore(data, score);
}
