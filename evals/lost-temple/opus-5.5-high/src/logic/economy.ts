import { clamp } from './vec';
import { pickWeighted } from './rng';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'key';
export type Zone = 'A' | 'B' | 'C';
export type SceneId = 'jungle' | 'courtyard' | 'cliffs' | 'halls' | 'sanctum' | 'catacombs' | 'vault';

export interface RelicType {
  id: string;
  name: string;
  base: number;
  weight: number;
  rarity: Rarity;
  zones: Zone[];
  /** Visual archetype for the procedural mesh builder. */
  shape: 'figurine' | 'ring' | 'beads' | 'bowl' | 'flute' | 'dagger' | 'scroll' | 'mirror' | 'mask' | 'urn' | 'serpent' | 'chalice' | 'crown' | 'skull' | 'tablet' | 'idol' | 'heart' | 'disc' | 'key';
  color: number;
}

export const RELICS: RelicType[] = [
  { id: 'figurine', name: 'Clay Figurine', base: 40, weight: 0.8, rarity: 'common', zones: ['A', 'B'], shape: 'figurine', color: 0xa0603a },
  { id: 'bangle', name: 'Bronze Bangle', base: 55, weight: 0.3, rarity: 'common', zones: ['A', 'B'], shape: 'ring', color: 0xb08040 },
  { id: 'beads', name: 'Jade Bead Necklace', base: 80, weight: 0.4, rarity: 'common', zones: ['A', 'B', 'C'], shape: 'beads', color: 0x3fa070 },
  { id: 'bowl', name: 'Painted Bowl', base: 65, weight: 1.2, rarity: 'common', zones: ['A', 'B'], shape: 'bowl', color: 0xc07a50 },
  { id: 'flute', name: 'Bone Flute', base: 110, weight: 0.3, rarity: 'uncommon', zones: ['A', 'B', 'C'], shape: 'flute', color: 0xe8dcc0 },
  { id: 'dagger', name: 'Obsidian Dagger', base: 140, weight: 1.0, rarity: 'uncommon', zones: ['B', 'C'], shape: 'dagger', color: 0x202028 },
  { id: 'scroll', name: 'Ritual Scroll', base: 170, weight: 0.5, rarity: 'uncommon', zones: ['B', 'C'], shape: 'scroll', color: 0xd8c08a },
  { id: 'mirror', name: 'Silver Mirror', base: 210, weight: 1.5, rarity: 'uncommon', zones: ['A', 'B', 'C'], shape: 'mirror', color: 0xd0d8e0 },
  { id: 'mask', name: 'Jaguar Mask', base: 380, weight: 2.5, rarity: 'rare', zones: ['A', 'B', 'C'], shape: 'mask', color: 0xd4a020 },
  { id: 'urn', name: 'Gem-studded Urn', base: 520, weight: 5.0, rarity: 'rare', zones: ['B', 'C'], shape: 'urn', color: 0x6a4a8a },
  { id: 'serpent', name: 'Feathered Serpent Idol', base: 460, weight: 3.0, rarity: 'rare', zones: ['B', 'C'], shape: 'serpent', color: 0x2a9a8a },
  { id: 'chalice', name: 'Gold Chalice', base: 480, weight: 2.0, rarity: 'rare', zones: ['A', 'C'], shape: 'chalice', color: 0xf0c040 },
  { id: 'crown', name: 'Sun Crown', base: 850, weight: 3.5, rarity: 'epic', zones: ['C'], shape: 'crown', color: 0xffc830 },
  { id: 'skull', name: 'Ruby Skull', base: 1050, weight: 4.5, rarity: 'epic', zones: ['C'], shape: 'skull', color: 0xc01830 },
  { id: 'tablet', name: 'Emerald Tablet', base: 950, weight: 6.0, rarity: 'epic', zones: ['C'], shape: 'tablet', color: 0x20b050 },
  { id: 'idol', name: 'Golden Idol', base: 2400, weight: 7.0, rarity: 'legendary', zones: ['B'], shape: 'idol', color: 0xffd040 },
  { id: 'heart', name: 'Heart of the Temple', base: 4000, weight: 9.0, rarity: 'legendary', zones: ['C'], shape: 'heart', color: 0xe02040 },
  { id: 'sundisc', name: 'Sun-disc', base: 0, weight: 2.0, rarity: 'key', zones: ['A'], shape: 'disc', color: 0xffb020 },
  { id: 'obsidiankey', name: 'Obsidian Key', base: 0, weight: 0.5, rarity: 'key', zones: ['C'], shape: 'key', color: 0x302838 },
];

export const RELIC_BY_ID: Record<string, RelicType> = Object.fromEntries(RELICS.map((r) => [r.id, r]));

export const SCENE_ZONE: Record<SceneId, Zone> = {
  jungle: 'A', courtyard: 'A', cliffs: 'A', halls: 'B', sanctum: 'B', catacombs: 'C', vault: 'C',
};

export const ZONE_MULT: Record<Zone, number> = { A: 1.0, B: 1.75, C: 3.0 };
export const SCENE_BONUS: Record<SceneId, number> = {
  jungle: 1, courtyard: 1, cliffs: 1.25, halls: 1, sanctum: 1.15, catacombs: 1, vault: 1.25,
};

/** Value of a relic found in a given scene. Deeper = worth more. */
export function relicValue(relicId: string, scene: SceneId): number {
  const r = RELIC_BY_ID[relicId];
  if (!r) throw new Error(`unknown relic ${relicId}`);
  return Math.round(r.base * ZONE_MULT[SCENE_ZONE[scene]] * SCENE_BONUS[scene]);
}

export const RARITY_WEIGHTS: Record<Zone, Partial<Record<Rarity, number>>> = {
  A: { common: 60, uncommon: 30, rare: 10 },
  B: { common: 40, uncommon: 35, rare: 20, epic: 5 },
  C: { common: 15, uncommon: 30, rare: 35, epic: 20 },
};

/** Roll a random loose relic for a zone, respecting each type's allowed zones. */
export function rollRelic(rand: () => number, zone: Zone): RelicType {
  const weights = RARITY_WEIGHTS[zone];
  const rarities = Object.keys(weights) as Rarity[];
  const rarity = pickWeighted(rand, rarities, rarities.map((k) => weights[k]!));
  let pool = RELICS.filter((r) => r.rarity === rarity && r.zones.includes(zone));
  if (pool.length === 0) pool = RELICS.filter((r) => r.zones.includes(zone) && r.rarity !== 'legendary' && r.rarity !== 'key');
  return pool[Math.floor(rand() * pool.length)];
}

// ---------------------------------------------------------------- carrying

export interface CarriedRelic { relicId: string; value: number; weight: number; foundIn: SceneId }

export function totalWeight(items: { weight: number }[]): number {
  return items.reduce((s, i) => s + i.weight, 0);
}
export function totalValue(items: { value: number }[]): number {
  return items.reduce((s, i) => s + i.value, 0);
}
export function loadFraction(weight: number, capacity: number): number {
  return clamp(weight / capacity, 0, 1);
}
/** Movement speed multiplier from load. Full satchel = 60% speed. */
export function speedMultiplier(weight: number, capacity: number): number {
  const L = loadFraction(weight, capacity);
  return 1 - 0.4 * Math.pow(L, 1.3);
}
/** Stamina drain multiplier from load. Full satchel drains 2.6x. */
export function staminaDrainMultiplier(weight: number, capacity: number): number {
  return 1 + 1.6 * loadFraction(weight, capacity);
}
export function canCarry(currentWeight: number, extra: number, capacity: number): boolean {
  return currentWeight + extra <= capacity + 1e-9;
}

export type RunOutcome = 'escaped' | 'caught' | 'killed' | 'sealed';
/** Only loot carried out the door counts. */
export function bankedHaul(outcome: RunOutcome, carried: { value: number }[]): number {
  return outcome === 'escaped' ? totalValue(carried) : 0;
}

// ---------------------------------------------------------------- shop

export interface Upgrades { torch: number; fuel: number; rope: number; satchel: number; spares: number; boots: number }
export const DEFAULT_UPGRADES: Upgrades = { torch: 0, fuel: 0, rope: 0, satchel: 0, spares: 0, boots: 0 };

export interface ShopItem { id: keyof Upgrades; name: string; desc: string; prices: number[] }
export const SHOP: ShopItem[] = [
  { id: 'torch', name: 'Better torch', desc: 'Torch radius 8 m → 10 m → 12 m', prices: [600, 1500] },
  { id: 'fuel', name: 'Fuel reservoir', desc: 'Torch fuel 180 s → 260 s → 340 s', prices: [500, 1200] },
  { id: 'rope', name: 'Rope', desc: 'Safe fall +4 m, climb 40% faster, torch survives falls', prices: [800] },
  { id: 'satchel', name: 'Bigger satchel', desc: 'Capacity 12 → 18 → 25 → 34 kg', prices: [700, 1600, 3200] },
  { id: 'spares', name: 'Spare torch', desc: '+1 spare torch at the start of every run (max 3)', prices: [300, 300, 300] },
  { id: 'boots', name: 'Trail boots', desc: 'Stamina 100 → 125', prices: [900] },
];

export function nextPrice(item: ShopItem, level: number): number | null {
  return level < item.prices.length ? item.prices[level] : null;
}

export function buy(bank: number, upgrades: Upgrades, id: keyof Upgrades): { bank: number; upgrades: Upgrades } | null {
  const item = SHOP.find((s) => s.id === id);
  if (!item) return null;
  const price = nextPrice(item, upgrades[id]);
  if (price === null || price > bank) return null;
  return { bank: bank - price, upgrades: { ...upgrades, [id]: upgrades[id] + 1 } };
}

export interface GearStats {
  torchRadius: number; fuelCapacity: number; satchelCapacity: number; spareTorches: number;
  safeFall: number; climbSpeedMult: number; torchSurvivesFalls: boolean; maxStamina: number;
}
export function gearStats(u: Upgrades): GearStats {
  return {
    torchRadius: [8, 10, 12][u.torch] ?? 12,
    fuelCapacity: [180, 260, 340][u.fuel] ?? 340,
    satchelCapacity: [12, 18, 25, 34][u.satchel] ?? 34,
    spareTorches: Math.min(3, u.spares) + 1,
    safeFall: u.rope ? 10 : 6,
    climbSpeedMult: u.rope ? 1.4 : 1,
    torchSurvivesFalls: u.rope > 0,
    maxStamina: u.boots ? 125 : 100,
  };
}

// ---------------------------------------------------------------- high scores

export interface ScoreEntry { value: number; outcome: RunOutcome; time: number; relics: number; date: string }
export function insertScore(table: ScoreEntry[], e: ScoreEntry, max = 10): { table: ScoreEntry[]; rank: number } {
  const t = [...table, e].sort((a, b) => b.value - a.value || a.time - b.time);
  const rank = t.indexOf(e);
  const out = t.slice(0, max);
  return { table: out, rank: rank < max ? rank : -1 };
}
