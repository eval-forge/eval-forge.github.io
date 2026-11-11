/**
 * Loot economy: relic table, zone multipliers, satchel, banking, run settlement,
 * shop upgrades and the gear they produce. Pure logic, unit tested.
 */
import { Rng } from './rng';

export type Zone = 'A' | 'B' | 'C';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'unique';

export type RelicId =
  | 'clayIdol'
  | 'coinPouch'
  | 'scrollCase'
  | 'jadeFigurine'
  | 'silverChalice'
  | 'obsidianDagger'
  | 'sunTablet'
  | 'serpentBracelet'
  | 'goldMask'
  | 'goldenScarab'
  | 'gemUrn'
  | 'featheredCrown'
  | 'moonMirror'
  | 'goldIngot'
  | 'goldenSkull'
  | 'emeraldEye'
  | 'condorStatuette'
  | 'sunIdol'
  | 'templeHeart';

export interface RelicType {
  id: RelicId;
  name: string;
  base: number;
  weight: number;
  rarity: Rarity;
  zones: Zone[];
  /** Only placed by fixed spawns, never rolled at random. */
  fixedOnly?: boolean;
  blurb: string;
}

export const RELICS: Record<RelicId, RelicType> = {
  clayIdol: { id: 'clayIdol', name: 'Clay Votive Idol', base: 60, weight: 1.5, rarity: 'common', zones: ['A', 'B'], blurb: 'A squat figure pressed from river clay.' },
  coinPouch: { id: 'coinPouch', name: 'Bronze Coin Pouch', base: 90, weight: 2.0, rarity: 'common', zones: ['A', 'B', 'C'], blurb: 'Green with age, still heavy with coin.' },
  scrollCase: { id: 'scrollCase', name: 'Carved Scroll Case', base: 110, weight: 1.0, rarity: 'common', zones: ['A', 'B'], blurb: 'Bone tube sealed with resin.' },
  jadeFigurine: { id: 'jadeFigurine', name: 'Jade Figurine', base: 220, weight: 1.2, rarity: 'uncommon', zones: ['A', 'B', 'C'], blurb: 'A crouching jaguar in milky jade.' },
  silverChalice: { id: 'silverChalice', name: 'Silver Chalice', base: 240, weight: 1.8, rarity: 'uncommon', zones: ['A', 'B'], blurb: 'Tarnished black, rings like a bell.' },
  obsidianDagger: { id: 'obsidianDagger', name: 'Obsidian Dagger', base: 180, weight: 0.8, rarity: 'uncommon', zones: ['B', 'C'], blurb: 'Volcanic glass, still sharp.' },
  sunTablet: { id: 'sunTablet', name: 'Sun Tablet', base: 320, weight: 7.5, rarity: 'uncommon', zones: ['B', 'C'], blurb: 'A stone calendar of the temple days.' },
  serpentBracelet: { id: 'serpentBracelet', name: 'Serpent Bracelet', base: 380, weight: 0.4, rarity: 'uncommon', zones: ['B', 'C'], blurb: 'Gold coiled into a biting snake.' },
  goldMask: { id: 'goldMask', name: 'Gold-Leaf Mask', base: 420, weight: 2.5, rarity: 'uncommon', zones: ['B', 'C'], blurb: 'A priest’s face, hammered thin.' },
  goldenScarab: { id: 'goldenScarab', name: 'Golden Scarab', base: 520, weight: 0.6, rarity: 'rare', zones: ['B', 'C'], blurb: 'Wings of beaten gold.' },
  gemUrn: { id: 'gemUrn', name: 'Gem-Studded Urn', base: 640, weight: 6.0, rarity: 'rare', zones: ['B', 'C'], blurb: 'Studded with garnet and turquoise.' },
  featheredCrown: { id: 'featheredCrown', name: 'Feathered Crown', base: 760, weight: 2.2, rarity: 'rare', zones: ['A', 'C'], blurb: 'Gold band, quetzal plumes long since dust.' },
  moonMirror: { id: 'moonMirror', name: 'Moon Mirror', base: 820, weight: 3.5, rarity: 'rare', zones: ['C'], blurb: 'Polished obsidian that holds no reflection.' },
  goldIngot: { id: 'goldIngot', name: 'Gold Ingot', base: 900, weight: 12.0, rarity: 'rare', zones: ['C'], blurb: 'Temple treasury bullion. Very heavy.' },
  goldenSkull: { id: 'goldenSkull', name: 'Golden Skull', base: 1100, weight: 4.5, rarity: 'rare', zones: ['C'], blurb: 'A high priest, gilded.' },
  emeraldEye: { id: 'emeraldEye', name: 'Emerald Eye', base: 1400, weight: 0.3, rarity: 'legendary', zones: ['C'], blurb: 'Fist-sized and flawless.' },
  condorStatuette: { id: 'condorStatuette', name: 'Condor Statuette', base: 1500, weight: 9.0, rarity: 'legendary', zones: ['A', 'C'], blurb: 'Wings spread, cast in solid gold.' },
  sunIdol: { id: 'sunIdol', name: 'The Sun Idol', base: 2400, weight: 8.0, rarity: 'unique', zones: ['B'], fixedOnly: true, blurb: 'The temple’s heart of day.' },
  templeHeart: { id: 'templeHeart', name: 'Heart of the Temple', base: 4000, weight: 15.0, rarity: 'unique', zones: ['C'], fixedOnly: true, blurb: 'It is warm to the touch.' },
};

export const RELIC_IDS = Object.keys(RELICS) as RelicId[];

export const ZONE_MULTIPLIER: Record<Zone, number> = { A: 1.0, B: 1.6, C: 2.5 };
export const RARITY_WEIGHT: Record<Rarity, number> = { common: 50, uncommon: 30, rare: 15, legendary: 5, unique: 0 };
export const CONDITION_MIN = 0.85;
export const CONDITION_MAX = 1.15;

/** Value of one relic, rounded to the nearest 5. */
export function relicValue(type: RelicId, zone: Zone, condition = 1): number {
  const c = Math.min(CONDITION_MAX, Math.max(CONDITION_MIN, condition));
  const raw = RELICS[type].base * ZONE_MULTIPLIER[zone] * c;
  return Math.round(raw / 5) * 5;
}

export function rollCondition(rng: Rng): number {
  return rng.range(CONDITION_MIN, CONDITION_MAX);
}

export function relicsForZone(zone: Zone): RelicType[] {
  return RELIC_IDS.map((id) => RELICS[id]).filter((r) => !r.fixedOnly && r.zones.includes(zone));
}

const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'legendary', 'unique'];

/** Random relic type for a spawn point in a zone, optionally limited to a rarity band. */
export function rollRelicType(zone: Zone, rng: Rng, minRarity: Rarity = 'common', maxRarity: Rarity = 'legendary'): RelicId {
  const lo = RARITY_ORDER.indexOf(minRarity);
  const hi = RARITY_ORDER.indexOf(maxRarity);
  let pool = relicsForZone(zone).filter((r) => {
    const i = RARITY_ORDER.indexOf(r.rarity);
    return i >= lo && i <= hi;
  });
  if (pool.length === 0) pool = relicsForZone(zone);
  return rng.weighted(pool, (r) => RARITY_WEIGHT[r.rarity]).id;
}

/** Expected value of one random spawn in a zone (average condition), used by docs and tests. */
export function expectedSpawnValue(zone: Zone): number {
  const pool = relicsForZone(zone);
  let wsum = 0;
  let vsum = 0;
  for (const r of pool) {
    const w = RARITY_WEIGHT[r.rarity];
    wsum += w;
    vsum += w * r.base * ZONE_MULTIPLIER[zone];
  }
  return wsum > 0 ? vsum / wsum : 0;
}

export interface RelicInstance {
  uid: string;
  type: RelicId;
  zone: Zone;
  value: number;
  weight: number;
}

export function makeRelic(uid: string, type: RelicId, zone: Zone, condition: number): RelicInstance {
  return { uid, type, zone, value: relicValue(type, zone, condition), weight: RELICS[type].weight };
}

export class Satchel {
  items: RelicInstance[] = [];
  constructor(public capacity: number) {}

  get weight(): number {
    let w = 0;
    for (const it of this.items) w += it.weight;
    return Math.round(w * 100) / 100;
  }
  get value(): number {
    let v = 0;
    for (const it of this.items) v += it.value;
    return v;
  }
  /** Fraction of capacity used (can exceed 1 only through held objects, never through the satchel). */
  get loadFraction(): number {
    return this.capacity > 0 ? this.weight / this.capacity : 1;
  }
  canAdd(r: { weight: number }): boolean {
    return this.weight + r.weight <= this.capacity + 1e-6;
  }
  add(r: RelicInstance): boolean {
    if (!this.canAdd(r)) return false;
    this.items.push(r);
    return true;
  }
  remove(uid: string): RelicInstance | undefined {
    const i = this.items.findIndex((it) => it.uid === uid);
    if (i < 0) return undefined;
    return this.items.splice(i, 1)[0];
  }
  clear(): RelicInstance[] {
    const out = this.items;
    this.items = [];
    return out;
  }
  /** Items sorted by value per kilogram, best first (used for the HUD list). */
  byDensity(): RelicInstance[] {
    return [...this.items].sort((a, b) => b.value / b.weight - a.value / a.weight);
  }
}

/** Ledger for one run: what is carried, what has been banked at the cart. */
export class LootLedger {
  banked: RelicInstance[] = [];
  found = new Set<string>();
  constructor(public satchel: Satchel) {}

  get bankedValue(): number {
    return this.banked.reduce((s, r) => s + r.value, 0);
  }
  get carriedValue(): number {
    return this.satchel.value;
  }
  noteFound(uid: string) {
    this.found.add(uid);
  }
  /** Move everything in the satchel to the bank. Returns the value banked. */
  bankAll(): number {
    const items = this.satchel.clear();
    this.banked.push(...items);
    return items.reduce((s, r) => s + r.value, 0);
  }
}

export type RunStatus = 'escaped' | 'caught' | 'killed' | 'entombed' | 'abandoned';

export interface Settlement {
  status: RunStatus;
  haul: number;
  lost: number;
  success: boolean;
}

/**
 * Settle a run. Only loot carried out of the door counts. If you are outside when the run
 * ends (escaped), whatever you carry is outside too. Otherwise carried loot is lost.
 */
export function settleRun(status: RunStatus, bankedValue: number, carriedValue: number, outside: boolean): Settlement {
  const success = status === 'escaped';
  if (success && outside) return { status, haul: bankedValue + carriedValue, lost: 0, success };
  if (status === 'abandoned') return { status, haul: bankedValue, lost: carriedValue, success: false };
  return { status, haul: bankedValue, lost: carriedValue, success };
}

// ---------------------------------------------------------------------------
// Shop and gear

export type UpgradeId = 'satchel' | 'torch' | 'fuel' | 'rope' | 'boots' | 'spareTorch' | 'oilFlask';

export interface ShopItem {
  id: UpgradeId;
  name: string;
  prices: number[];
  describe: (level: number) => string;
}

export const SATCHEL_CAPACITY = [20, 30, 42, 56];
export const TORCH_RADIUS_MUL = [1, 1.25, 1.5];
export const TORCH_GUST_RESIST = [0, 0.3, 0.6];
export const FUEL_MUL = [1, 1.4, 1.8];
export const ROPES = [0, 1, 2, 3];
export const STAMINA_MUL = [1, 1.25, 1.5];
export const SPARE_TORCHES = [1, 2, 3];
export const OIL_FLASKS = [1, 2, 3];

export const SHOP: ShopItem[] = [
  { id: 'satchel', name: 'Satchel', prices: [1500, 4000, 9000], describe: (l) => `Carry ${SATCHEL_CAPACITY[l]} kg` },
  { id: 'torch', name: 'Torch', prices: [1200, 4500], describe: (l) => `Light radius x${TORCH_RADIUS_MUL[l].toFixed(2)}, gust resistance ${Math.round(TORCH_GUST_RESIST[l] * 100)}%` },
  { id: 'fuel', name: 'Fuel reservoir', prices: [1000, 3000], describe: (l) => `Fuel capacity x${FUEL_MUL[l].toFixed(1)}` },
  { id: 'rope', name: 'Rope coils', prices: [700, 1800, 3500], describe: (l) => `${ROPES[l]} rope${ROPES[l] === 1 ? '' : 's'} per run` },
  { id: 'boots', name: 'Boots', prices: [2000, 5000], describe: (l) => `Stamina x${STAMINA_MUL[l].toFixed(2)}` },
  { id: 'spareTorch', name: 'Spare torches', prices: [600, 1600], describe: (l) => `Start with ${SPARE_TORCHES[l]} spare torch${SPARE_TORCHES[l] === 1 ? '' : 'es'}` },
  { id: 'oilFlask', name: 'Oil flasks', prices: [500, 1400], describe: (l) => `Start with ${OIL_FLASKS[l]} oil flask${OIL_FLASKS[l] === 1 ? '' : 's'}` },
];

export type Upgrades = Record<UpgradeId, number>;

export function defaultUpgrades(): Upgrades {
  return { satchel: 0, torch: 0, fuel: 0, rope: 0, boots: 0, spareTorch: 0, oilFlask: 0 };
}

export function shopItem(id: UpgradeId): ShopItem {
  const it = SHOP.find((s) => s.id === id);
  if (!it) throw new Error(`unknown upgrade ${id}`);
  return it;
}

/** Price of the next level, or null when maxed. */
export function nextUpgradeCost(id: UpgradeId, level: number): number | null {
  const it = shopItem(id);
  return level < it.prices.length ? it.prices[level] : null;
}

export interface PurchaseResult {
  ok: boolean;
  money: number;
  upgrades: Upgrades;
  reason?: 'maxed' | 'funds';
}

export function purchase(money: number, upgrades: Upgrades, id: UpgradeId): PurchaseResult {
  const level = upgrades[id] ?? 0;
  const cost = nextUpgradeCost(id, level);
  if (cost === null) return { ok: false, money, upgrades, reason: 'maxed' };
  if (money < cost) return { ok: false, money, upgrades, reason: 'funds' };
  return { ok: true, money: money - cost, upgrades: { ...upgrades, [id]: level + 1 } };
}

export interface Gear {
  satchelCapacity: number;
  torchRadiusMul: number;
  gustResist: number;
  fuelCapacity: number;
  ropes: number;
  staminaMax: number;
  spareTorches: number;
  oilFlasks: number;
}

export const BASE_FUEL = 100;
export const BASE_STAMINA = 100;

function at<T>(arr: T[], i: number): T {
  return arr[Math.max(0, Math.min(arr.length - 1, i | 0))];
}

export function gearFromUpgrades(u: Upgrades): Gear {
  return {
    satchelCapacity: at(SATCHEL_CAPACITY, u.satchel),
    torchRadiusMul: at(TORCH_RADIUS_MUL, u.torch),
    gustResist: at(TORCH_GUST_RESIST, u.torch),
    fuelCapacity: BASE_FUEL * at(FUEL_MUL, u.fuel),
    ropes: at(ROPES, u.rope),
    staminaMax: BASE_STAMINA * at(STAMINA_MUL, u.boots),
    spareTorches: at(SPARE_TORCHES, u.spareTorch),
    oilFlasks: at(OIL_FLASKS, u.oilFlask),
  };
}

export function formatMoney(v: number): string {
  return '$' + Math.round(v).toLocaleString('en-US');
}
