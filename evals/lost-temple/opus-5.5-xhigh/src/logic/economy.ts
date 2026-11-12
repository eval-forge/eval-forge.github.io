/**
 * Loot economy: relic table, zone value, rarity rolls, satchel, carry penalties and
 * run settlement. Pure: no DOM / Three / Rapier.
 */
import { Rng } from '../core/rng';

export type ZoneId = 'A' | 'B' | 'C';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type RelicShape =
  | 'bowl' | 'ring' | 'flute' | 'blade' | 'beads' | 'scroll' | 'chalice' | 'crown'
  | 'ingot' | 'urn' | 'eagle' | 'mask' | 'scepter' | 'heart' | 'skull' | 'jaguar'
  | 'chest' | 'statue' | 'idol';

export interface RelicDef {
  id: string;
  name: string;
  base: number;
  weight: number; // kg
  rarity: Rarity;
  zones: ZoneId[];
  shape: RelicShape;
  color: number;
  unique?: boolean;
}

export const RELICS: RelicDef[] = [
  { id: 'clay_bowl', name: 'Painted Clay Bowl', base: 40, weight: 1.5, rarity: 'common', zones: ['A', 'B', 'C'], shape: 'bowl', color: 0xb5653a },
  { id: 'bronze_bangle', name: 'Bronze Bangle', base: 60, weight: 0.4, rarity: 'common', zones: ['A', 'B', 'C'], shape: 'ring', color: 0xb0793a },
  { id: 'bone_flute', name: 'Bone Flute', base: 80, weight: 0.3, rarity: 'common', zones: ['A', 'B', 'C'], shape: 'flute', color: 0xe8dcc0 },
  { id: 'obsidian_blade', name: 'Obsidian Blade', base: 90, weight: 0.8, rarity: 'common', zones: ['A', 'B', 'C'], shape: 'blade', color: 0x1c1a24 },
  { id: 'jade_beads', name: 'Jade Bead Necklace', base: 120, weight: 0.3, rarity: 'common', zones: ['A', 'B', 'C'], shape: 'beads', color: 0x3fa57a },
  { id: 'scroll_case', name: 'Sealed Scroll Case', base: 150, weight: 1.0, rarity: 'uncommon', zones: ['A', 'B', 'C'], shape: 'scroll', color: 0x8a5a2b },
  { id: 'silver_chalice', name: 'Silver Chalice', base: 180, weight: 1.8, rarity: 'uncommon', zones: ['A', 'B', 'C'], shape: 'chalice', color: 0xc8ccd4 },
  { id: 'feather_crown', name: 'Quetzal Feather Crown', base: 220, weight: 1.2, rarity: 'uncommon', zones: ['A', 'B', 'C'], shape: 'crown', color: 0x2fae8e },
  { id: 'gold_ingot', name: 'Temple Gold Ingot', base: 260, weight: 8.0, rarity: 'uncommon', zones: ['B', 'C'], shape: 'ingot', color: 0xe0b23a },
  { id: 'gem_urn', name: 'Gem-Studded Urn', base: 300, weight: 6.0, rarity: 'uncommon', zones: ['B', 'C'], shape: 'urn', color: 0x6e4a8a },
  { id: 'eagle_statuette', name: 'Gold Eagle Statuette', base: 380, weight: 5.5, rarity: 'rare', zones: ['A', 'B', 'C'], shape: 'eagle', color: 0xe3b440 },
  { id: 'jade_mask', name: 'Jade Death Mask', base: 400, weight: 3.5, rarity: 'rare', zones: ['B', 'C'], shape: 'mask', color: 0x2f9a6a },
  { id: 'sun_mask', name: 'Golden Sun Mask', base: 450, weight: 4.0, rarity: 'rare', zones: ['A', 'B', 'C'], shape: 'mask', color: 0xf0c040 },
  { id: 'serpent_scepter', name: 'Serpent Scepter', base: 500, weight: 2.5, rarity: 'rare', zones: ['B', 'C'], shape: 'scepter', color: 0x3a8a5a },
  { id: 'ruby_heart', name: 'Ruby Heart', base: 650, weight: 0.9, rarity: 'epic', zones: ['B', 'C'], shape: 'heart', color: 0xc0182a },
  { id: 'crystal_skull', name: 'Crystal Skull', base: 700, weight: 4.5, rarity: 'epic', zones: ['C'], shape: 'skull', color: 0xcfe8f4 },
  { id: 'jaguar_idol', name: 'Golden Jaguar Idol', base: 900, weight: 9.0, rarity: 'epic', zones: ['C'], shape: 'jaguar', color: 0xe8b030 },
  { id: 'gem_chest', name: 'Chest of Gems', base: 1100, weight: 14.0, rarity: 'legendary', zones: ['C'], shape: 'chest', color: 0x7a4a22 },
  { id: 'gold_statue', name: 'Gold Ancestor Statue', base: 1400, weight: 18.0, rarity: 'legendary', zones: ['C'], shape: 'statue', color: 0xe6b836 },
  { id: 'sun_idol', name: 'The Sun Idol', base: 2000, weight: 7.5, rarity: 'legendary', zones: ['B'], shape: 'idol', color: 0xffc83a, unique: true },
];

export const RELIC_BY_ID: Record<string, RelicDef> = Object.fromEntries(RELICS.map((r) => [r.id, r]));

export const ZONE_MULT: Record<ZoneId, number> = { A: 1.0, B: 1.6, C: 2.6 };
export const RARITY_WEIGHT: Record<Rarity, number> = { common: 50, uncommon: 28, rare: 15, epic: 6, legendary: 1 };
export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export function round5(v: number): number {
  return Math.round(v / 5) * 5;
}

/** A relic's value depends on where it was found: deeper zones pay more. */
export function relicValue(def: RelicDef, zone: ZoneId): number {
  return round5(def.base * ZONE_MULT[zone]);
}

export interface SlotRoll {
  zone: ZoneId;
  /** Lowest rarity this slot can produce (e.g. exposed cliff ledges are rare-weighted). */
  minRarity?: Rarity;
  /** Legendary items only roll where this is set (the deep vault). */
  allowLegendary?: boolean;
  /** Fixed relic id (unique placements such as the Sun Idol). */
  fixed?: string;
  /** Max weight for this slot (keeps tiny shelves from holding statues). */
  maxWeight?: number;
}

/** Pick a relic for a slot. Deterministic for a given RNG state. */
export function rollRelic(rng: Rng, slot: SlotRoll): RelicDef {
  if (slot.fixed) return RELIC_BY_ID[slot.fixed];
  const minIdx = slot.minRarity ? RARITY_ORDER.indexOf(slot.minRarity) : 0;
  const pool = RELICS.filter(
    (r) =>
      !r.unique &&
      r.zones.includes(slot.zone) &&
      RARITY_ORDER.indexOf(r.rarity) >= minIdx &&
      (slot.allowLegendary || r.rarity !== 'legendary') &&
      (slot.maxWeight === undefined || r.weight <= slot.maxWeight),
  );
  if (pool.length === 0) return RELICS[0];
  return rng.weighted(pool, (r) => RARITY_WEIGHT[r.rarity]);
}

/** Mean value of a slot across its pool (used for the design table and tests). */
export function expectedSlotValue(slot: SlotRoll): number {
  if (slot.fixed) return relicValue(RELIC_BY_ID[slot.fixed], slot.zone);
  const minIdx = slot.minRarity ? RARITY_ORDER.indexOf(slot.minRarity) : 0;
  const pool = RELICS.filter(
    (r) =>
      !r.unique &&
      r.zones.includes(slot.zone) &&
      RARITY_ORDER.indexOf(r.rarity) >= minIdx &&
      (slot.allowLegendary || r.rarity !== 'legendary') &&
      (slot.maxWeight === undefined || r.weight <= slot.maxWeight),
  );
  let tw = 0;
  let tv = 0;
  for (const r of pool) {
    const w = RARITY_WEIGHT[r.rarity];
    tw += w;
    tv += w * relicValue(r, slot.zone);
  }
  return tw > 0 ? tv / tw : 0;
}

/** A relic instance that exists in a run. */
export interface RelicInstance {
  uid: string; // slot id or generated id
  defId: string;
  zone: ZoneId; // zone where it was found (sets value)
  value: number;
  weight: number;
}

export function makeInstance(uid: string, def: RelicDef, zone: ZoneId): RelicInstance {
  return { uid, defId: def.id, zone, value: relicValue(def, zone), weight: def.weight };
}

export const SATCHEL_CAPACITY_BY_LEVEL = [18, 26, 34, 44];

export function satchelCapacity(level: number): number {
  return SATCHEL_CAPACITY_BY_LEVEL[Math.max(0, Math.min(SATCHEL_CAPACITY_BY_LEVEL.length - 1, level))];
}

export class Satchel {
  items: RelicInstance[] = [];
  constructor(public capacity: number) {}

  weight(): number {
    let w = 0;
    for (const it of this.items) w += it.weight;
    return Math.round(w * 100) / 100;
  }
  value(): number {
    let v = 0;
    for (const it of this.items) v += it.value;
    return v;
  }
  canAdd(r: { weight: number }): boolean {
    return this.weight() + r.weight <= this.capacity + 1e-6;
  }
  add(r: RelicInstance): boolean {
    if (!this.canAdd(r)) return false;
    this.items.push(r);
    return true;
  }
  removeLast(): RelicInstance | undefined {
    return this.items.pop();
  }
  remove(uid: string): RelicInstance | undefined {
    const i = this.items.findIndex((x) => x.uid === uid);
    if (i < 0) return undefined;
    return this.items.splice(i, 1)[0];
  }
  clear(): RelicInstance[] {
    const out = this.items;
    this.items = [];
    return out;
  }
}

/** Movement speed multiplier from carried weight. Never below 0.55 from the satchel alone. */
export function speedMultiplier(weight: number, capacity: number): number {
  const f = capacity > 0 ? Math.min(1, Math.max(0, weight / capacity)) : 1;
  return 1 - 0.45 * f;
}

/** Stamina drain multiplier from carried weight (heavier = drains faster). */
export function staminaDrainMultiplier(weight: number, capacity: number): number {
  const f = capacity > 0 ? Math.max(0, weight / capacity) : 1;
  return 1 + 1.5 * f;
}

/** Extra penalty for a heavy object in the hands (two-handed carry). */
export function handsSpeedMultiplier(handWeight: number): number {
  if (handWeight <= 2) return 1;
  return Math.max(0.45, 1 - (handWeight - 2) * 0.03);
}

export type Outcome = 'escaped' | 'caught' | 'killed' | 'sealed' | 'abandoned';

export interface Settlement {
  outcome: Outcome;
  escaped: boolean;
  haul: number;
  securedValue: number;
  carriedValue: number;
  lostValue: number;
  relicsOut: number;
}

/**
 * Settle a run. Loot already carried out the door (the stash) always counts because it
 * left the temple. What you were carrying only counts if you escaped.
 */
export function settleRun(outcome: Outcome, stash: RelicInstance[], carried: RelicInstance[]): Settlement {
  const securedValue = stash.reduce((a, r) => a + r.value, 0);
  const carriedValue = carried.reduce((a, r) => a + r.value, 0);
  const escaped = outcome === 'escaped';
  return {
    outcome,
    escaped,
    haul: securedValue + (escaped ? carriedValue : 0),
    securedValue,
    carriedValue,
    lostValue: escaped ? 0 : carriedValue,
    relicsOut: stash.length + (escaped ? carried.length : 0),
  };
}
