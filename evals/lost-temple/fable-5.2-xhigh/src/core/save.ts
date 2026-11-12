/**
 * Meta progression: coins, gear, settings, high scores and the best-run ghost.
 * Written through a tiny storage interface so tests can use a fake.
 * Unit-tested in tests/save.test.ts.
 */
import { baseGear, buyGear, type GearId, type GearLevels } from './economy';
import type { GhostData } from './ghost';

export const SAVE_KEY = 'lostTemple.v1';
export const MAX_SCORES = 10;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  fov: number;
  sensitivity: number;
  volume: number;
  musicVolume: number;
  quality: Quality;
  invertY: boolean;
  showGhost: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  fov: 78,
  sensitivity: 1,
  volume: 0.8,
  musicVolume: 0.6,
  quality: 'medium',
  invertY: false,
  showGhost: true,
};

export type Outcome = 'escaped' | 'caught' | 'died' | 'entombed' | 'abandoned';

export interface ScoreEntry {
  /** Coins banked (0 unless escaped). */
  haul: number;
  /** Value that was in the satchel when the run ended (lost unless escaped). */
  carried: number;
  /** Seconds from dawn to the end of the run. */
  time: number;
  relics: number;
  outcome: Outcome;
  /** ISO date. */
  date: string;
  /** Deepest scene name reached. */
  deepest: string;
}

export interface MetaSave {
  v: 1;
  coins: number;
  gear: GearLevels;
  settings: Settings;
  scores: ScoreEntry[];
  ghost: GhostData | null;
  runs: number;
  escapes: number;
  bestHaul: number;
  seenIntro: boolean;
}

export function freshSave(): MetaSave {
  return {
    v: 1,
    coins: 0,
    gear: baseGear(),
    settings: { ...DEFAULT_SETTINGS },
    scores: [],
    ghost: null,
    runs: 0,
    escapes: 0,
    bestHaul: 0,
    seenIntro: false,
  };
}

const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Parse and sanitise a stored blob. Anything broken falls back to defaults. */
export function parseSave(raw: string | null): MetaSave {
  const out = freshSave();
  if (!raw) return out;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return out;
  }
  if (!data || typeof data !== 'object' || data.v !== 1) return out;
  out.coins = Math.floor(num(data.coins, 0, 0, 1e9));
  const gear = (data.gear ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(out.gear) as GearId[]) out.gear[k] = Math.floor(num(gear[k], 0, 0, 5));
  const s = (data.settings ?? {}) as Record<string, unknown>;
  out.settings = {
    fov: num(s.fov, DEFAULT_SETTINGS.fov, 55, 110),
    sensitivity: num(s.sensitivity, DEFAULT_SETTINGS.sensitivity, 0.1, 4),
    volume: num(s.volume, DEFAULT_SETTINGS.volume, 0, 1),
    musicVolume: num(s.musicVolume, DEFAULT_SETTINGS.musicVolume, 0, 1),
    quality: s.quality === 'low' || s.quality === 'medium' || s.quality === 'high' ? s.quality : DEFAULT_SETTINGS.quality,
    invertY: s.invertY === true,
    showGhost: s.showGhost !== false,
  };
  if (Array.isArray(data.scores)) {
    out.scores = (data.scores as ScoreEntry[])
      .filter((e) => e && typeof e.haul === 'number' && typeof e.time === 'number')
      .slice(0, MAX_SCORES);
  }
  const ghost = data.ghost as GhostData | null | undefined;
  if (ghost && Array.isArray(ghost.samples) && typeof ghost.step === 'number') out.ghost = ghost;
  out.runs = Math.floor(num(data.runs, 0, 0, 1e9));
  out.escapes = Math.floor(num(data.escapes, 0, 0, 1e9));
  out.bestHaul = Math.floor(num(data.bestHaul, 0, 0, 1e9));
  out.seenIntro = data.seenIntro === true;
  return out;
}

/** Sort order of the table: banked haul first, then faster time. */
export function compareScores(a: ScoreEntry, b: ScoreEntry): number {
  if (b.haul !== a.haul) return b.haul - a.haul;
  if (b.carried !== a.carried) return b.carried - a.carried;
  return a.time - b.time;
}

export class MetaStore {
  data: MetaSave;

  constructor(private readonly storage: StorageLike | null) {
    this.data = this.read();
  }

  private read(): MetaSave {
    if (!this.storage) return freshSave();
    try {
      return parseSave(this.storage.getItem(SAVE_KEY));
    } catch {
      return freshSave();
    }
  }

  save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // Storage full or blocked: the game still runs, it just forgets.
    }
  }

  /**
   * Record a finished run. Only an escape banks coins.
   * Returns the 0-based rank in the table, or -1 if it did not place.
   */
  recordRun(entry: ScoreEntry, ghost: GhostData | null = null): number {
    const d = this.data;
    d.runs++;
    if (entry.outcome === 'escaped') {
      d.escapes++;
      d.coins += entry.haul;
      if (entry.haul > d.bestHaul || (!d.ghost && ghost)) {
        if (ghost) d.ghost = ghost;
      }
      d.bestHaul = Math.max(d.bestHaul, entry.haul);
    }
    d.scores.push(entry);
    d.scores.sort(compareScores);
    d.scores = d.scores.slice(0, MAX_SCORES);
    this.save();
    return d.scores.indexOf(entry);
  }

  buy(id: GearId): boolean {
    const left = buyGear(this.data.coins, this.data.gear, id);
    if (left === null) return false;
    this.data.coins = left;
    this.save();
    return true;
  }

  updateSettings(patch: Partial<Settings>): void {
    Object.assign(this.data.settings, patch);
    this.save();
  }

  reset(): void {
    const settings = this.data.settings;
    this.data = freshSave();
    this.data.settings = settings;
    this.save();
  }
}
