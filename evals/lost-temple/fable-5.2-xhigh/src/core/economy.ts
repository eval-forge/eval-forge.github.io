/**
 * Relics, loot rolls, the satchel and the shop. Pure rules.
 * Unit-tested in tests/economy.test.ts.
 */
import { Rng, clamp01 } from './rng';
import { SCENES, type SceneId } from './scenes';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'unique';

export type RelicId =
  | 'clay_bowl' | 'coin_stack' | 'bone_flute' | 'obsidian_dagger' | 'painted_scroll' | 'silver_censer'
  | 'jade_mask' | 'turquoise_serpent' | 'sun_idol' | 'ruby_scarab' | 'gem_urn'
  | 'gold_mask' | 'crystal_skull' | 'moonstone_orb' | 'royal_crown' | 'gold_jaguar' | 'emperor_coffer'
  | 'dawn_idol';

export type KeyItemId = 'sun_disc' | 'serpent_key';

export interface RelicDef {
  id: RelicId;
  name: string;
  /** Value before the depth multiplier. */
  base: number;
  /** Kilograms. */
  weight: number;
  rarity: Rarity;
  /** 1 = can appear anywhere, 2 = cliffs / Zone B / Zone C, 3 = Zone C only. */
  tier: 1 | 2 | 3;
  /** Never rolled: placed by hand at a fixed spot. */
  fixedOnly?: boolean;
  blurb: string;
}

export const RELICS: RelicDef[] = [
  { id: 'clay_bowl', name: 'Clay Offering Bowl', base: 40, weight: 1.0, rarity: 'common', tier: 1, blurb: 'Fired clay, still stained with something.' },
  { id: 'coin_stack', name: 'Bronze Coin Stack', base: 60, weight: 0.6, rarity: 'common', tier: 1, blurb: 'Green with age. Spends fine.' },
  { id: 'bone_flute', name: 'Carved Bone Flute', base: 90, weight: 0.3, rarity: 'common', tier: 1, blurb: 'Three holes. Do not play it here.' },
  { id: 'obsidian_dagger', name: 'Obsidian Dagger', base: 130, weight: 0.8, rarity: 'common', tier: 1, blurb: 'Volcanic glass, knapped to a razor.' },
  { id: 'painted_scroll', name: 'Painted Scroll', base: 170, weight: 0.2, rarity: 'uncommon', tier: 1, blurb: 'Bark paper. Light as a rumour.' },
  { id: 'silver_censer', name: 'Silver Censer', base: 240, weight: 1.8, rarity: 'uncommon', tier: 1, blurb: 'Smells faintly of copal.' },
  { id: 'jade_mask', name: 'Jade Mask', base: 320, weight: 2.5, rarity: 'uncommon', tier: 2, blurb: 'Mosaic jade with shell eyes.' },
  { id: 'turquoise_serpent', name: 'Turquoise Serpent', base: 420, weight: 1.5, rarity: 'rare', tier: 2, blurb: 'Two heads. Neither looks pleased.' },
  { id: 'sun_idol', name: 'Sun-God Idol', base: 480, weight: 4.0, rarity: 'uncommon', tier: 2, blurb: 'Squat, gold, heavier than it looks.' },
  { id: 'ruby_scarab', name: 'Ruby Scarab', base: 560, weight: 0.4, rarity: 'rare', tier: 2, blurb: 'A thumb of red fire.' },
  { id: 'gem_urn', name: 'Gem-Studded Urn', base: 620, weight: 6.0, rarity: 'rare', tier: 2, blurb: 'Someone important is still inside.' },
  { id: 'gold_mask', name: 'Golden Death Mask', base: 700, weight: 3.0, rarity: 'uncommon', tier: 3, blurb: 'The face of a king who did not smile.' },
  { id: 'crystal_skull', name: 'Crystal Skull', base: 850, weight: 2.2, rarity: 'rare', tier: 3, blurb: 'Cold even through the glove.' },
  { id: 'moonstone_orb', name: 'Moonstone Orb', base: 1000, weight: 1.2, rarity: 'rare', tier: 3, blurb: 'Milk-white, perfectly round.' },
  { id: 'royal_crown', name: 'Crown of the Serpent King', base: 1300, weight: 3.5, rarity: 'epic', tier: 3, blurb: 'Feathers long gone, gold very much not.' },
  { id: 'gold_jaguar', name: 'Golden Jaguar', base: 1700, weight: 12.0, rarity: 'epic', tier: 3, blurb: 'A solid gold cat the size of a dog.' },
  { id: 'emperor_coffer', name: "Emperor's Coffer", base: 2400, weight: 16.0, rarity: 'legendary', tier: 3, fixedOnly: true, blurb: 'A chest that takes both arms and most of your sense.' },
  { id: 'dawn_idol', name: 'The Dawn Idol', base: 2000, weight: 8.0, rarity: 'unique', tier: 2, fixedOnly: true, blurb: 'The reason the temple was built. It knows when it is lifted.' },
];

export const RELIC_BY_ID: Record<RelicId, RelicDef> = Object.fromEntries(RELICS.map((r) => [r.id, r])) as Record<
  RelicId,
  RelicDef
>;

export interface KeyItemDef {
  id: KeyItemId;
  name: string;
  weight: number;
  blurb: string;
}

export const KEY_ITEMS: Record<KeyItemId, KeyItemDef> = {
  sun_disc: { id: 'sun_disc', name: 'Sun Disc', weight: 1.5, blurb: 'Fits a sun-shaped socket somewhere below.' },
  serpent_key: { id: 'serpent_key', name: 'Serpent Key', weight: 0.5, blurb: 'A bronze key coiled like a snake.' },
};

export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 10,
  uncommon: 6,
  rare: 3,
  epic: 1.5,
  legendary: 0.5,
  unique: 0,
};

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#c9c2ae',
  uncommon: '#7fd08a',
  rare: '#6cb6ff',
  epic: '#c88bff',
  legendary: '#ffb648',
  unique: '#ff6b5a',
};

const round5 = (v: number): number => Math.round(v / 5) * 5;

/** What a relic is worth when found in a given scene. Deeper is worth more. */
export function relicValue(id: RelicId, scene: SceneId): number {
  return round5(RELIC_BY_ID[id].base * SCENES[scene].mult);
}

// ---------------------------------------------------------------------------
// Loot roll
// ---------------------------------------------------------------------------

export interface LootSpot {
  id: string;
  scene: SceneId;
  /** Highest relic tier that may roll here. */
  tier: 1 | 2 | 3;
  /** If set, this relic always sits here. */
  fixed?: RelicId;
}

/** Relative weight of a relic rolling at a spot of the given tier. */
export function rollWeight(relic: RelicDef, spotTier: number): number {
  if (relic.fixedOnly || relic.tier > spotTier) return 0;
  const gap = spotTier - relic.tier;
  const tierBias = gap === 0 ? 3 : gap === 1 ? 0.8 : 0.15;
  return RARITY_WEIGHT[relic.rarity] * tierBias;
}

/** Deterministically assign a relic to every spot. */
export function rollLoot(seed: number, spots: readonly LootSpot[]): Map<string, RelicId> {
  const rng = new Rng(seed ^ 0x51ed270b);
  const out = new Map<string, RelicId>();
  for (const spot of spots) {
    if (spot.fixed) {
      out.set(spot.id, spot.fixed);
      continue;
    }
    const weights = RELICS.map((r) => rollWeight(r, spot.tier));
    out.set(spot.id, RELICS[rng.weighted(weights)].id);
  }
  return out;
}

/** Expected value of one rolled spot (used by tests and DESIGN numbers). */
export function expectedSpotValue(spot: LootSpot): number {
  if (spot.fixed) return relicValue(spot.fixed, spot.scene);
  let total = 0;
  let sum = 0;
  for (const r of RELICS) {
    const w = rollWeight(r, spot.tier);
    total += w;
    sum += w * relicValue(r.id, spot.scene);
  }
  return total > 0 ? sum / total : 0;
}

// ---------------------------------------------------------------------------
// Satchel and load
// ---------------------------------------------------------------------------

export interface CarriedRelic {
  relic: RelicId;
  value: number;
  weight: number;
  scene: SceneId;
  spotId: string;
}

export class Satchel {
  items: CarriedRelic[] = [];
  keys: KeyItemId[] = [];
  /** Extra kilograms that are not relics (key items). */
  private keyWeight = 0;

  constructor(public capacity: number) {}

  get relicWeight(): number {
    let w = 0;
    for (const it of this.items) w += it.weight;
    return w;
  }

  get weight(): number {
    return this.relicWeight + this.keyWeight;
  }

  get value(): number {
    let v = 0;
    for (const it of this.items) v += it.value;
    return v;
  }

  get count(): number {
    return this.items.length;
  }

  get loadRatio(): number {
    return clamp01(this.weight / this.capacity);
  }

  get free(): number {
    return Math.max(0, this.capacity - this.weight);
  }

  canFit(weight: number): boolean {
    return this.weight + weight <= this.capacity + 1e-6;
  }

  /** Returns false (and takes nothing) if the relic would overfill the satchel. */
  add(relic: RelicId, scene: SceneId, spotId: string): CarriedRelic | null {
    const def = RELIC_BY_ID[relic];
    if (!this.canFit(def.weight)) return null;
    const item: CarriedRelic = { relic, value: relicValue(relic, scene), weight: def.weight, scene, spotId };
    this.items.push(item);
    return item;
  }

  /** Put back a relic that was dropped earlier (keeps the value it was found at). */
  addCarried(item: CarriedRelic): boolean {
    if (!this.canFit(item.weight)) return false;
    this.items.push(item);
    return true;
  }

  /** Drop the most recently taken relic. */
  dropLast(): CarriedRelic | null {
    return this.items.pop() ?? null;
  }

  /** Drop the heaviest relic (panic button). */
  dropHeaviest(): CarriedRelic | null {
    if (this.items.length === 0) return null;
    let best = 0;
    for (let i = 1; i < this.items.length; i++) if (this.items[i].weight > this.items[best].weight) best = i;
    return this.items.splice(best, 1)[0];
  }

  addKey(id: KeyItemId): void {
    if (this.keys.includes(id)) return;
    this.keys.push(id);
    this.keyWeight += KEY_ITEMS[id].weight;
  }

  hasKey(id: KeyItemId): boolean {
    return this.keys.includes(id);
  }

  useKey(id: KeyItemId): boolean {
    const i = this.keys.indexOf(id);
    if (i < 0) return false;
    this.keys.splice(i, 1);
    this.keyWeight = Math.max(0, this.keyWeight - KEY_ITEMS[id].weight);
    return true;
  }

  clear(): void {
    this.items = [];
    this.keys = [];
    this.keyWeight = 0;
  }
}

/** Move speed multiplier for a load ratio 0..1. A full satchel nearly halves you. */
export function speedMultiplier(ratio: number): number {
  const r = clamp01(ratio);
  return 1 - 0.45 * Math.pow(r, 1.5);
}

/** Stamina drain multiplier for a load ratio 0..1. */
export function staminaDrainMultiplier(ratio: number): number {
  return 1 + 1.2 * clamp01(ratio);
}

/** Jump velocity multiplier for a load ratio 0..1. */
export function jumpMultiplier(ratio: number): number {
  return 1 - 0.15 * clamp01(ratio);
}

// ---------------------------------------------------------------------------
// Shop / gear
// ---------------------------------------------------------------------------

export type GearId = 'torch' | 'fuel' | 'satchel' | 'rope' | 'spares' | 'soles';

export interface GearDef {
  id: GearId;
  name: string;
  blurb: string;
  /** Price of tier 1, tier 2, ... */
  prices: number[];
  /** Stat value at tier 0 (base), 1, 2, ... */
  values: number[];
  unit: string;
}

export const GEAR: Record<GearId, GearDef> = {
  torch: {
    id: 'torch', name: 'Bright Torch', blurb: 'Resin-soaked head. Throws light further.',
    prices: [400, 1200], values: [13, 16, 19], unit: 'm radius',
  },
  fuel: {
    id: 'fuel', name: 'Oil Reservoir', blurb: 'A bigger brass well in the handle.',
    prices: [300, 900], values: [210, 300, 420], unit: 's of flame',
  },
  satchel: {
    id: 'satchel', name: 'Satchel', blurb: 'More leather, more straps, more greed.',
    prices: [500, 1500], values: [20, 28, 36], unit: 'kg',
  },
  rope: {
    id: 'rope', name: 'Rope', blurb: 'Rig a climbing line at iron anchor rings.',
    prices: [350, 800], values: [0, 1, 2], unit: 'ropes per run',
  },
  spares: {
    id: 'spares', name: 'Spare Torches', blurb: 'For sconces, or for when the first one dies.',
    prices: [250, 600], values: [1, 2, 3], unit: 'spare torches',
  },
  soles: {
    id: 'soles', name: 'Soft Soles', blurb: 'Felted boots. Crawlers hear you from much closer.',
    prices: [700], values: [1, 0.6], unit: '× footstep noise',
  },
};

export const GEAR_ORDER: GearId[] = ['torch', 'fuel', 'satchel', 'rope', 'spares', 'soles'];

export type GearLevels = Record<GearId, number>;

export const baseGear = (): GearLevels => ({ torch: 0, fuel: 0, satchel: 0, rope: 0, spares: 0, soles: 0 });

export function gearValue(levels: GearLevels, id: GearId): number {
  const def = GEAR[id];
  const lvl = Math.min(Math.max(levels[id] ?? 0, 0), def.values.length - 1);
  return def.values[lvl];
}

export function gearMaxed(levels: GearLevels, id: GearId): boolean {
  return (levels[id] ?? 0) >= GEAR[id].prices.length;
}

/** Price of the next tier, or null if maxed. */
export function nextPrice(levels: GearLevels, id: GearId): number | null {
  if (gearMaxed(levels, id)) return null;
  return GEAR[id].prices[levels[id] ?? 0];
}

/** Try to buy the next tier. Returns the new coin balance, or null if not possible. */
export function buyGear(coins: number, levels: GearLevels, id: GearId): number | null {
  const price = nextPrice(levels, id);
  if (price === null || coins < price) return null;
  levels[id] = (levels[id] ?? 0) + 1;
  return coins - price;
}

/** Everything a run needs to know about the gear you own. */
export interface Loadout {
  torchRadius: number;
  fuelCapacity: number;
  satchelCapacity: number;
  ropes: number;
  spareTorches: number;
  footstepNoise: number;
}

export function loadoutFor(levels: GearLevels): Loadout {
  return {
    torchRadius: gearValue(levels, 'torch'),
    fuelCapacity: gearValue(levels, 'fuel'),
    satchelCapacity: gearValue(levels, 'satchel'),
    ropes: gearValue(levels, 'rope'),
    spareTorches: gearValue(levels, 'spares'),
    footstepNoise: gearValue(levels, 'soles'),
  };
}
