/**
 * Meta progression: save format, high scores, shop, settings, ghost. Pure (storage is
 * injected by the caller).
 */
import type { Outcome } from './economy';

export type UpgradeId = 'torch' | 'fuel' | 'rope' | 'satchel' | 'boots';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  costs: number[]; // cost of level 1, 2, ...
  describe: (level: number) => string;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'torch',
    name: 'Better Torch',
    costs: [600, 1500, 3200],
    describe: (l) => ['Radius 9 m, gusts are a gamble', 'Radius 11 m, 30% gust resistance', 'Radius 13 m, 60% gust resistance', 'Radius 15 m, 80% gust resistance'][l],
  },
  {
    id: 'fuel',
    name: 'More Fuel',
    costs: [400, 1000, 2200],
    describe: (l) => ['300 s of burn, 2 spare torches', '360 s, +1 oil flask', '420 s, +2 flasks, +1 spare torch', '480 s, +3 flasks, +1 spare torch'][l],
  },
  {
    id: 'rope',
    name: 'Rope',
    costs: [800, 2000],
    describe: (l) => ['No rope', 'Safety line: survive one fatal fall per run', 'Two catches per run, faster vine climbing, no climbing stamina'][l],
  },
  {
    id: 'satchel',
    name: 'Bigger Satchel',
    costs: [500, 1400, 3000],
    describe: (l) => ['Holds 18 kg', 'Holds 26 kg', 'Holds 34 kg', 'Holds 44 kg'][l],
  },
  {
    id: 'boots',
    name: 'Trail Boots',
    costs: [450, 1200],
    describe: (l) => ['Standard stamina', '+25% stamina, faster recovery', '+50% stamina, faster recovery, quieter steps'][l],
  },
];

export const UPGRADE_BY_ID: Record<UpgradeId, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as any;

export interface ScoreEntry {
  haul: number;
  outcome: Outcome;
  timeSurvived: number; // seconds of the run
  relics: number;
  date: string; // ISO
  deepest: string; // deepest scene reached
}

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
}

export interface GhostData {
  haul: number;
  /** Flattened samples at GHOST_HZ: x, y, z, yaw. */
  samples: number[];
}

export const GHOST_HZ = 5;

export interface SaveData {
  version: 1;
  bank: number;
  totalEarned: number;
  runs: number;
  upgrades: Record<UpgradeId, number>;
  highScores: ScoreEntry[];
  settings: Settings;
  ghost: GhostData | null;
}

export function defaultSettings(): Settings {
  return {
    fov: 75,
    sensitivity: 1.0,
    invertY: false,
    masterVolume: 0.8,
    musicVolume: 0.6,
    sfxVolume: 0.9,
    quality: 'medium',
    showFps: false,
  };
}

export function defaultSave(): SaveData {
  return {
    version: 1,
    bank: 0,
    totalEarned: 0,
    runs: 0,
    upgrades: { torch: 0, fuel: 0, rope: 0, satchel: 0, boots: 0 },
    highScores: [],
    settings: defaultSettings(),
    ghost: null,
  };
}

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** Parse and validate a save string. Anything malformed falls back to defaults field by field. */
export function parseSave(raw: string | null | undefined): SaveData {
  const d = defaultSave();
  if (!raw) return d;
  let o: any;
  try {
    o = JSON.parse(raw);
  } catch {
    return d;
  }
  if (!o || typeof o !== 'object') return d;
  const s = defaultSave();
  s.bank = Math.floor(num(o.bank, 0, 0));
  s.totalEarned = Math.floor(num(o.totalEarned, 0, 0));
  s.runs = Math.floor(num(o.runs, 0, 0));
  if (o.upgrades && typeof o.upgrades === 'object') {
    for (const u of UPGRADES) s.upgrades[u.id] = Math.floor(num(o.upgrades[u.id], 0, 0, u.costs.length));
  }
  if (Array.isArray(o.highScores)) {
    s.highScores = o.highScores
      .filter((e: any) => e && typeof e.haul === 'number')
      .map((e: any) => ({
        haul: Math.floor(num(e.haul, 0, 0)),
        outcome: (['escaped', 'caught', 'killed', 'sealed', 'abandoned'].includes(e.outcome) ? e.outcome : 'escaped') as Outcome,
        timeSurvived: num(e.timeSurvived, 0, 0),
        relics: Math.floor(num(e.relics, 0, 0)),
        date: typeof e.date === 'string' ? e.date : new Date(0).toISOString(),
        deepest: typeof e.deepest === 'string' ? e.deepest : 'jungle',
      }))
      .slice(0, MAX_SCORES);
    sortScores(s.highScores);
  }
  if (o.settings && typeof o.settings === 'object') {
    const t = o.settings;
    s.settings = {
      fov: num(t.fov, d.settings.fov, 55, 110),
      sensitivity: num(t.sensitivity, d.settings.sensitivity, 0.1, 4),
      invertY: !!t.invertY,
      masterVolume: num(t.masterVolume, d.settings.masterVolume, 0, 1),
      musicVolume: num(t.musicVolume, d.settings.musicVolume, 0, 1),
      sfxVolume: num(t.sfxVolume, d.settings.sfxVolume, 0, 1),
      quality: ['low', 'medium', 'high'].includes(t.quality) ? t.quality : d.settings.quality,
      showFps: !!t.showFps,
    };
  }
  if (o.ghost && Array.isArray(o.ghost.samples) && typeof o.ghost.haul === 'number') {
    const samples = o.ghost.samples.filter((x: unknown) => typeof x === 'number');
    if (samples.length % 4 === 0) s.ghost = { haul: o.ghost.haul, samples };
  }
  return s;
}

export function serializeSave(s: SaveData): string {
  return JSON.stringify(s);
}

export const MAX_SCORES = 10;

export function sortScores(list: ScoreEntry[]) {
  list.sort((a, b) => b.haul - a.haul || (a.outcome === 'escaped' ? -1 : 1) - (b.outcome === 'escaped' ? -1 : 1) || a.timeSurvived - b.timeSurvived);
}

/** Insert a score; returns the new save and the 0-based rank (or -1 if it didn't place). */
export function addScore(save: SaveData, e: ScoreEntry): { save: SaveData; rank: number } {
  const list = [...save.highScores, e];
  sortScores(list);
  const trimmed = list.slice(0, MAX_SCORES);
  const rank = trimmed.indexOf(e);
  return { save: { ...save, highScores: trimmed }, rank };
}

/** Bank a run's haul. */
export function bankHaul(save: SaveData, haul: number): SaveData {
  return { ...save, bank: save.bank + Math.max(0, Math.floor(haul)), totalEarned: save.totalEarned + Math.max(0, Math.floor(haul)), runs: save.runs + 1 };
}

export function upgradeCost(save: SaveData, id: UpgradeId): number | null {
  const def = UPGRADE_BY_ID[id];
  const lvl = save.upgrades[id];
  if (lvl >= def.costs.length) return null;
  return def.costs[lvl];
}

export type BuyResult = { ok: true; save: SaveData } | { ok: false; reason: 'maxed' | 'funds' };

export function buyUpgrade(save: SaveData, id: UpgradeId): BuyResult {
  const cost = upgradeCost(save, id);
  if (cost === null) return { ok: false, reason: 'maxed' };
  if (save.bank < cost) return { ok: false, reason: 'funds' };
  return {
    ok: true,
    save: { ...save, bank: save.bank - cost, upgrades: { ...save.upgrades, [id]: save.upgrades[id] + 1 } },
  };
}

/** Stamina stats from the boots upgrade. */
export function staminaStats(bootsLevel: number) {
  const l = Math.max(0, Math.min(2, bootsLevel));
  return { max: 100 * [1, 1.25, 1.5][l], regen: [16, 20, 24][l], quietSteps: l >= 2 };
}

/** Rope catches per run. */
export function ropeCatches(ropeLevel: number): number {
  return Math.max(0, Math.min(2, ropeLevel));
}

/** Keep a ghost if it beat the stored one (only escaped runs are worth chasing). */
export function maybeStoreGhost(save: SaveData, haul: number, escaped: boolean, samples: number[]): SaveData {
  if (!escaped || samples.length < 8) return save;
  if (save.ghost && save.ghost.haul >= haul) return save;
  // keep it small: round to centimetres / centiradians
  const rounded = samples.map((v) => Math.round(v * 100) / 100);
  return { ...save, ghost: { haul, samples: rounded } };
}
