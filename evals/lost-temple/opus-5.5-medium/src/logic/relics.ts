export type Zone = 'A' | 'B' | 'C';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'unique' | 'key';

export interface RelicType {
  id: string;
  name: string;
  base: number;
  weight: number;
  rarity: Rarity;
  zones: Zone[];
  shape: 'figurine' | 'necklace' | 'bell' | 'mask' | 'dagger' | 'scroll' | 'chalice' | 'crown' | 'urn' | 'scarab' | 'ingot' | 'skull' | 'gem' | 'idol' | 'disc' | 'key';
  color: number;
}

export const ZONE_MULTIPLIER: Record<Zone, number> = { A: 1.0, B: 1.6, C: 2.5 };

export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 10, uncommon: 6, rare: 3, epic: 1.2, unique: 0, key: 0,
};

export const RELICS: RelicType[] = [
  { id: 'figurine', name: 'Clay Figurine', base: 40, weight: 1.0, rarity: 'common', zones: ['A', 'B'], shape: 'figurine', color: 0xa86a3c },
  { id: 'necklace', name: 'Jade Bead Necklace', base: 60, weight: 0.4, rarity: 'common', zones: ['A', 'B'], shape: 'necklace', color: 0x3fae6a },
  { id: 'bell', name: 'Bronze Bell', base: 80, weight: 2.5, rarity: 'common', zones: ['A', 'B', 'C'], shape: 'bell', color: 0xb07a2a },
  { id: 'woodmask', name: 'Carved Wooden Mask', base: 110, weight: 1.8, rarity: 'uncommon', zones: ['A', 'B'], shape: 'mask', color: 0x7a4a22 },
  { id: 'dagger', name: 'Obsidian Dagger', base: 120, weight: 1.2, rarity: 'uncommon', zones: ['A', 'B', 'C'], shape: 'dagger', color: 0x1a1420 },
  { id: 'scroll', name: 'Ancient Scroll', base: 130, weight: 0.3, rarity: 'uncommon', zones: ['B', 'C'], shape: 'scroll', color: 0xd8c79a },
  { id: 'chalice', name: 'Silver Chalice', base: 150, weight: 2.0, rarity: 'uncommon', zones: ['B', 'C'], shape: 'chalice', color: 0xc8ccd4 },
  { id: 'crown', name: 'Feathered Crown', base: 200, weight: 1.5, rarity: 'rare', zones: ['A', 'B'], shape: 'crown', color: 0xd2a630 },
  { id: 'urn', name: 'Gem-Studded Urn', base: 240, weight: 6.0, rarity: 'uncommon', zones: ['B', 'C'], shape: 'urn', color: 0x6a3a8a },
  { id: 'jademask', name: 'Jade Death Mask', base: 280, weight: 3.0, rarity: 'rare', zones: ['B', 'C'], shape: 'mask', color: 0x2f9e78 },
  { id: 'scarab', name: 'Ruby Scarab', base: 320, weight: 0.8, rarity: 'rare', zones: ['C'], shape: 'scarab', color: 0xc0182a },
  { id: 'ingot', name: 'Gold Ingot', base: 360, weight: 9.0, rarity: 'uncommon', zones: ['C'], shape: 'ingot', color: 0xe8b830 },
  { id: 'skull', name: 'Emerald Skull', base: 480, weight: 5.0, rarity: 'rare', zones: ['C'], shape: 'skull', color: 0x1fbf6a },
  { id: 'sapphire', name: 'Star Sapphire', base: 600, weight: 0.6, rarity: 'epic', zones: ['C'], shape: 'gem', color: 0x2a4ae0 },
  { id: 'sarcmask', name: 'Royal Sarcophagus Mask', base: 750, weight: 7.0, rarity: 'epic', zones: ['C'], shape: 'mask', color: 0xe0b030 },
  { id: 'idol', name: 'Golden Idol', base: 900, weight: 8.0, rarity: 'unique', zones: ['B'], shape: 'idol', color: 0xf0c040 },
  { id: 'sundisc', name: 'Sun-Disc', base: 100, weight: 3.0, rarity: 'key', zones: ['A'], shape: 'disc', color: 0xf0a020 },
  { id: 'bronzekey', name: 'Bronze Key', base: 50, weight: 1.0, rarity: 'key', zones: ['C'], shape: 'key', color: 0xa0702a },
];

export const RELIC_BY_ID: Record<string, RelicType> = Object.fromEntries(RELICS.map((r) => [r.id, r]));

/** Value of a relic found in a given zone: deeper is worth more. */
export function relicValue(type: RelicType, zone: Zone): number {
  return Math.round(type.base * ZONE_MULTIPLIER[zone]);
}

/** Relic types eligible for random loot spots in a zone (no uniques/keys). */
export function lootPool(zone: Zone): RelicType[] {
  return RELICS.filter((r) => r.zones.includes(zone) && RARITY_WEIGHT[r.rarity] > 0);
}

/** Weighted random pick by rarity. `r` in [0,1). */
export function pickRelic(zone: Zone, r: number): RelicType {
  const pool = lootPool(zone);
  const total = pool.reduce((s, t) => s + RARITY_WEIGHT[t.rarity], 0);
  let x = r * total;
  for (const t of pool) {
    x -= RARITY_WEIGHT[t.rarity];
    if (x < 0) return t;
  }
  return pool[pool.length - 1];
}

/** Expected value of one random loot spot in a zone. */
export function expectedSpotValue(zone: Zone): number {
  const pool = lootPool(zone);
  const total = pool.reduce((s, t) => s + RARITY_WEIGHT[t.rarity], 0);
  return pool.reduce((s, t) => s + (RARITY_WEIGHT[t.rarity] / total) * relicValue(t, zone), 0);
}
