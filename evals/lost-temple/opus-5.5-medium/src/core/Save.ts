import { NO_UPGRADES, ScoreEntry, Upgrades } from '../logic/economy';

export interface Settings {
  fov: number;
  sensitivity: number;
  volume: number;
  music: number;
  quality: 'low' | 'medium' | 'high';
  invertY: boolean;
  showDebug: boolean;
}

export const DEFAULT_SETTINGS: Settings = { fov: 75, sensitivity: 1, volume: 0.8, music: 0.5, quality: 'medium', invertY: false, showDebug: false };

export interface SaveData {
  bank: number;
  upgrades: Upgrades;
  scores: ScoreEntry[];
  runs: number;
  bestGhost: number[] | null; // flat [t,x,y,z, ...]
  bestGhostValue: number;
}

const KEY_SETTINGS = 'lostTemple.settings.v1';
const KEY_SAVE = 'lostTemple.save.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ }
}

export const Save = {
  settings: read<Settings>(KEY_SETTINGS, DEFAULT_SETTINGS),
  data: read<SaveData>(KEY_SAVE, { bank: 0, upgrades: { ...NO_UPGRADES }, scores: [], runs: 0, bestGhost: null, bestGhostValue: 0 }),
  saveSettings() { write(KEY_SETTINGS, this.settings); },
  saveData() { write(KEY_SAVE, this.data); },
  reset() {
    this.data = { bank: 0, upgrades: { ...NO_UPGRADES }, scores: [], runs: 0, bestGhost: null, bestGhostValue: 0 };
    this.saveData();
  },
};
Save.data.upgrades = { ...NO_UPGRADES, ...Save.data.upgrades };
