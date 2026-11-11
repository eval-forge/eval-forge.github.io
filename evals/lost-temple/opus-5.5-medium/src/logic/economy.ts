import { RELIC_BY_ID, relicValue, Zone } from './relics';

export interface CarriedRelic {
  typeId: string;
  zone: Zone;
  value: number;
  weight: number;
  uid: number;
}

let uidCounter = 1;
export function makeCarried(typeId: string, zone: Zone): CarriedRelic {
  const t = RELIC_BY_ID[typeId];
  if (!t) throw new Error('unknown relic ' + typeId);
  return { typeId, zone, value: relicValue(t, zone), weight: t.weight, uid: uidCounter++ };
}

export class Satchel {
  items: CarriedRelic[] = [];
  constructor(public capacity: number) {}
  get weight(): number { return this.items.reduce((s, i) => s + i.weight, 0); }
  get value(): number { return this.items.reduce((s, i) => s + i.value, 0); }
  canAdd(weight: number): boolean { return this.weight + weight <= this.capacity + 1e-9; }
  add(item: CarriedRelic): boolean {
    if (!this.canAdd(item.weight)) return false;
    this.items.push(item);
    return true;
  }
  remove(uid: number): CarriedRelic | undefined {
    const i = this.items.findIndex((x) => x.uid === uid);
    if (i < 0) return undefined;
    return this.items.splice(i, 1)[0];
  }
  has(typeId: string): boolean { return this.items.some((i) => i.typeId === typeId); }
  takeType(typeId: string): CarriedRelic | undefined {
    const it = this.items.find((i) => i.typeId === typeId);
    return it ? this.remove(it.uid) : undefined;
  }
  /** Loot value excluding keys that never leave the temple. */
  get bankableValue(): number { return this.value; }
  clear() { this.items = []; }
}

/** Fraction of capacity in use, 0..1 (clamped). */
export function loadFraction(weight: number, capacity: number): number {
  if (capacity <= 0) return 1;
  return Math.max(0, Math.min(1, weight / capacity));
}

/** Movement speed multiplier from carried weight. 1 when empty, 0.5 at full load. */
export function speedFactor(weight: number, capacity: number): number {
  const f = loadFraction(weight, capacity);
  return 1 - 0.5 * Math.pow(f, 1.2);
}

/** Stamina drain multiplier from carried weight. 1 when empty, 2.5 at full load. */
export function staminaDrainFactor(weight: number, capacity: number): number {
  return 1 + 1.5 * loadFraction(weight, capacity);
}

/** Jump height multiplier. */
export function jumpFactor(weight: number, capacity: number): number {
  return 1 - 0.35 * loadFraction(weight, capacity);
}

/** Result of a run. Only escaping banks loot. */
export function settleRun(escaped: boolean, carriedValue: number): number {
  return escaped ? Math.max(0, Math.round(carriedValue)) : 0;
}

export type UpgradeId = 'torch' | 'fuel' | 'satchel' | 'rope' | 'boots';
export interface UpgradeDef { id: UpgradeId; name: string; desc: string; prices: number[] }

export const UPGRADES: UpgradeDef[] = [
  { id: 'torch', name: 'Pitch-Soaked Torch', desc: 'Bigger light radius and slower burn per level.', prices: [400, 1100, 2400] },
  { id: 'fuel', name: 'Oil Flasks', desc: '+1 spare fuel flask at the start of each run per level.', prices: [300, 800, 1800] },
  { id: 'satchel', name: 'Bigger Satchel', desc: 'Carry capacity 20 → 28 → 36 → 45 kg.', prices: [500, 1300, 3000] },
  { id: 'rope', name: 'Climbing Rope', desc: 'Saves you from one fatal fall per level per run.', prices: [600, 1500] },
  { id: 'boots', name: 'Jungle Boots', desc: '+20% stamina per level and quieter footsteps.', prices: [350, 900] },
];

export type Upgrades = Record<UpgradeId, number>;
export const NO_UPGRADES: Upgrades = { torch: 0, fuel: 0, satchel: 0, rope: 0, boots: 0 };

export function upgradePrice(id: UpgradeId, currentLevel: number): number | null {
  const d = UPGRADES.find((u) => u.id === id)!;
  return currentLevel < d.prices.length ? d.prices[currentLevel] : null;
}

export function buyUpgrade(bank: number, ups: Upgrades, id: UpgradeId): { bank: number; ups: Upgrades } | null {
  const p = upgradePrice(id, ups[id]);
  if (p === null || bank < p) return null;
  return { bank: bank - p, ups: { ...ups, [id]: ups[id] + 1 } };
}

export function satchelCapacity(level: number): number {
  return [20, 28, 36, 45][Math.max(0, Math.min(3, level))];
}

export function staminaMax(bootsLevel: number): number {
  return 100 * (1 + 0.2 * bootsLevel);
}

export interface ScoreEntry { value: number; time: number; relics: number; date: string; escaped: boolean }

export function insertHighScore(table: ScoreEntry[], entry: ScoreEntry, max = 10): ScoreEntry[] {
  const t = [...table, entry].sort((a, b) => b.value - a.value || a.time - b.time);
  return t.slice(0, max);
}
