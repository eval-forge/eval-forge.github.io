import { DEFAULT_UPGRADES, type Upgrades, type ScoreEntry } from '../logic/economy';

export interface Settings { fov: number; sensitivity: number; master: number; music: number; sfx: number; quality: 'low' | 'medium' | 'high'; showGhost: boolean; invertY: boolean }
export const DEFAULT_SETTINGS: Settings = { fov: 75, sensitivity: 1, master: 0.8, music: 0.6, sfx: 0.9, quality: 'medium', showGhost: true, invertY: false };

export interface Profile {
  version: 1;
  bank: number;
  upgrades: Upgrades;
  scores: ScoreEntry[];
  settings: Settings;
  runs: number;
  /** Best escaped run's path: flat [x,y,z,yaw]*N sampled every 0.25 s. */
  ghost: number[] | null;
  ghostValue: number;
}

const KEY = 'lostTemple.profile.v1';

export function loadProfile(): Profile {
  const base: Profile = { version: 1, bank: 0, upgrades: { ...DEFAULT_UPGRADES }, scores: [], settings: { ...DEFAULT_SETTINGS }, runs: 0, ghost: null, ghostValue: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Profile>;
    return { ...base, ...p, upgrades: { ...DEFAULT_UPGRADES, ...(p.upgrades ?? {}) }, settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } };
  } catch {
    return base;
  }
}

export function saveProfile(p: Profile) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage full or blocked */ }
}

export function resetProfile() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
