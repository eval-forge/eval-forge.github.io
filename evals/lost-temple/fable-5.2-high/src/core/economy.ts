import { Rng } from './rng';
import { SCENE_INFO, ZONE_RANK, clamp01, type SceneId, type Zone } from './types';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'unique';

export interface RelicType {
  id: string;
  name: string;
  baseValue: number;
  /** kilograms */
  weight: number;
  rarity: Rarity;
  /** Shallowest zone this relic can appear in. */
  minZone: Zone;
  /** If set, the relic only ever appears in these scenes. */
  onlyIn?: SceneId[];
  /** Which procedural mesh recipe to use. */
  shape: 'figurine' | 'pouch' | 'flute' | 'frog' | 'mask' | 'gem' | 'scroll' | 'mirror' | 'skull' | 'urn'
    | 'idol' | 'dagger' | 'serpent' | 'sceptre' | 'ingot' | 'disc' | 'crown';
  color: number;
}

export const RELICS: RelicType[] = [
  { id: 'votive', name: 'Clay Votive Figurine', baseValue: 40, weight: 0.4, rarity: 'common', minZone: 'A', shape: 'figurine', color: 0xb5714a },
  { id: 'pouch', name: 'Bronze Coin Pouch', baseValue: 60, weight: 0.6, rarity: 'common', minZone: 'A', shape: 'pouch', color: 0x9a6a3a },
  { id: 'flute', name: 'Carved Bone Flute', baseValue: 80, weight: 0.3, rarity: 'common', minZone: 'A', shape: 'flute', color: 0xe6dcc0 },
  { id: 'frog', name: 'Jade Frog', baseValue: 120, weight: 0.8, rarity: 'uncommon', minZone: 'A', shape: 'frog', color: 0x3fa672 },
  { id: 'serpentMask', name: 'Feathered Serpent Mask', baseValue: 180, weight: 1.2, rarity: 'uncommon', minZone: 'A', shape: 'mask', color: 0xc9483a },
  { id: 'opal', name: 'Storm Opal', baseValue: 420, weight: 0.5, rarity: 'rare', minZone: 'A', onlyIn: ['cliffs'], shape: 'gem', color: 0x8fd3e8 },
  { id: 'codex', name: 'Painted Codex Scroll', baseValue: 150, weight: 0.2, rarity: 'uncommon', minZone: 'B', shape: 'scroll', color: 0xd9c48a },
  { id: 'mirror', name: 'Silver Sun Mirror', baseValue: 220, weight: 1.5, rarity: 'uncommon', minZone: 'B', shape: 'mirror', color: 0xc9d0d6 },
  { id: 'mosaicSkull', name: 'Turquoise Mosaic Skull', baseValue: 300, weight: 1.8, rarity: 'rare', minZone: 'B', shape: 'skull', color: 0x35b5b0 },
  { id: 'urn', name: 'Gem-studded Urn', baseValue: 380, weight: 3.5, rarity: 'rare', minZone: 'B', shape: 'urn', color: 0xa8763a },
  { id: 'jaguarIdol', name: 'Golden Jaguar Idol', baseValue: 900, weight: 6.0, rarity: 'unique', minZone: 'B', onlyIn: ['sanctum'], shape: 'idol', color: 0xe8b830 },
  { id: 'dagger', name: 'Obsidian Dagger', baseValue: 260, weight: 0.7, rarity: 'uncommon', minZone: 'C', shape: 'dagger', color: 0x2a2630 },
  { id: 'burialMask', name: 'Jade Burial Mask', baseValue: 520, weight: 2.2, rarity: 'rare', minZone: 'C', shape: 'mask', color: 0x58b88a },
  { id: 'rubySerpent', name: 'Ruby-eyed Serpent', baseValue: 640, weight: 4.0, rarity: 'rare', minZone: 'C', shape: 'serpent', color: 0xb89030 },
  { id: 'crystalSkull', name: 'Crystal Skull', baseValue: 800, weight: 2.5, rarity: 'epic', minZone: 'C', shape: 'skull', color: 0xd8f0f4 },
  { id: 'sceptre', name: "King's Sceptre", baseValue: 950, weight: 3.0, rarity: 'epic', minZone: 'C', shape: 'sceptre', color: 0xe0b040 },
  { id: 'ingot', name: 'Gold Ingot', baseValue: 700, weight: 7.0, rarity: 'rare', minZone: 'C', onlyIn: ['vault'], shape: 'ingot', color: 0xf0c030 },
  { id: 'calendar', name: 'Golden Sun Calendar', baseValue: 1100, weight: 9.0, rarity: 'epic', minZone: 'C', onlyIn: ['vault'], shape: 'disc', color: 0xe8b020 },
  { id: 'crown', name: 'Crown of the Sun King', baseValue: 1600, weight: 4.5, rarity: 'legendary', minZone: 'C', onlyIn: ['vault'], shape: 'crown', color: 0xffd040 },
];

export const RELIC_BY_ID: Record<string, RelicType> = Object.fromEntries(RELICS.map((r) => [r.id, r]));

export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 10, uncommon: 6, rare: 3, epic: 1.5, legendary: 0.5, unique: 0,
};

/** A relic is worth more the deeper it is found. */
export function relicValue(relicId: string, scene: SceneId): number {
  const r = RELIC_BY_ID[relicId];
  if (!r) throw new Error(`unknown relic ${relicId}`);
  return Math.round(r.baseValue * SCENE_INFO[scene].depthMult);
}

/** Relic types that may be rolled into a random loot spot in a scene. */
export function eligibleRelics(scene: SceneId): RelicType[] {
  const zr = ZONE_RANK[SCENE_INFO[scene].zone];
  return RELICS.filter((r) => {
    if (r.rarity === 'unique') return false;
    if (r.onlyIn) return r.onlyIn.includes(scene);
    const rr = ZONE_RANK[r.minZone];
    // A scene draws from its own zone's relics and the zone just above it.
    return rr <= zr && rr >= zr - 1;
  });
}

export function rollRelic(scene: SceneId, rng: Rng, rich = false): RelicType {
  const pool = eligibleRelics(scene);
  return rng.weighted(pool, (r) => {
    let w = RARITY_WEIGHT[r.rarity];
    // "Rich" spots (trapped pedestals, hard to reach ledges) skew toward the rare end.
    if (rich) w = r.rarity === 'common' ? w * 0.1 : r.rarity === 'uncommon' ? w * 0.5 : w * 2.5;
    // Scene exclusives should actually show up where they belong.
    if (r.onlyIn) w *= 2.5;
    return w;
  });
}

export interface LootSpotDef {
  id: string;
  scene: SceneId;
  pos: [number, number, number];
  /** Place a specific relic instead of rolling. */
  fixed?: string;
  rich?: boolean;
  /** Sits on a pedestal (purely visual unless trapped). */
  pedestal?: boolean;
  /** Id of the trap fired if the relic is lifted without a counterweight. */
  trap?: string;
}

export interface PlacedRelic { spot: LootSpotDef; relic: RelicType; value: number; }

export function placeLoot(spots: readonly LootSpotDef[], seed: number): PlacedRelic[] {
  const rng = new Rng(seed);
  return spots.map((spot) => {
    const relic = spot.fixed ? RELIC_BY_ID[spot.fixed] : rollRelic(spot.scene, rng, !!spot.rich || !!spot.trap);
    return { spot, relic, value: relicValue(relic.id, spot.scene) };
  });
}

export function lootValueByZone(placed: readonly PlacedRelic[]): Record<Zone, number> {
  const out: Record<Zone, number> = { A: 0, B: 0, C: 0 };
  for (const p of placed) out[SCENE_INFO[p.spot.scene].zone] += p.value;
  return out;
}

// --- Satchel and encumbrance -------------------------------------------------

export interface CarriedRelic { relicId: string; value: number; weight: number; scene: SceneId; }

export class Satchel {
  items: CarriedRelic[] = [];
  constructor(public capacity: number) {}
  get weight(): number { return this.items.reduce((s, i) => s + i.weight, 0); }
  get value(): number { return this.items.reduce((s, i) => s + i.value, 0); }
  get ratio(): number { return loadRatio(this.weight, this.capacity); }
  canAdd(weight: number): boolean { return this.weight + weight <= this.capacity + 1e-6; }
  add(item: CarriedRelic): boolean {
    if (!this.canAdd(item.weight)) return false;
    this.items.push(item);
    return true;
  }
  /** Drop the most recently taken relic. */
  removeLast(): CarriedRelic | null { return this.items.pop() ?? null; }
  clear(): void { this.items.length = 0; }
}

export function loadRatio(load: number, capacity: number): number {
  return capacity <= 0 ? 1 : clamp01(load / capacity);
}

/** Movement speed multiplier from carried weight: 1 when empty, 0.45 at a full satchel. */
export function speedFactor(load: number, capacity: number): number {
  return 1 - 0.55 * Math.pow(loadRatio(load, capacity), 1.3);
}

/** Stamina drain multiplier from carried weight: 1 when empty, 2.5 at a full satchel. */
export function staminaDrainFactor(load: number, capacity: number): number {
  return 1 + 1.5 * loadRatio(load, capacity);
}

/** What the run pays out. Only an escape banks anything. */
export function bankedValue(outcome: 'escaped' | 'caught' | 'killed' | 'entombed', satchel: Satchel): number {
  return outcome === 'escaped' ? satchel.value : 0;
}

// --- Shop --------------------------------------------------------------------

export type UpgradeId = 'torch' | 'fuel' | 'rope' | 'satchel';

export interface UpgradeDef { id: UpgradeId; name: string; desc: string; costs: number[]; levels: string[]; }

export const UPGRADES: UpgradeDef[] = [
  { id: 'torch', name: 'Pitch Torch', desc: 'Wider light and a slower burn.', costs: [600, 1800],
    levels: ['11 m radius, 4:00 burn', '13 m radius, 5:20 burn', '15 m radius, 7:00 burn'] },
  { id: 'fuel', name: 'Oil Flasks', desc: 'Start each run with spare fuel.', costs: [400, 1200],
    levels: ['No spare flasks', '1 flask', '2 flasks'] },
  // One level: there is exactly one anchor ring in the temple (outer cliffs), so a second rope would buy nothing.
  { id: 'rope', name: 'Climbing Rope', desc: 'Tie it off at the iron ring on the outer cliffs to reach the shelf below.', costs: [800],
    levels: ['No rope', '1 rope'] },
  { id: 'satchel', name: 'Satchel', desc: 'Carry more before the weight drags you down.', costs: [900, 2600],
    levels: ['12 kg', '18 kg', '26 kg'] },
];

export type UpgradeLevels = Record<UpgradeId, number>;

export const NO_UPGRADES: UpgradeLevels = { torch: 0, fuel: 0, rope: 0, satchel: 0 };

export function maxLevel(id: UpgradeId): number {
  return UPGRADES.find((u) => u.id === id)!.costs.length;
}

/** Cost of the next level, or null if maxed. */
export function upgradeCost(id: UpgradeId, currentLevel: number): number | null {
  const u = UPGRADES.find((x) => x.id === id)!;
  return currentLevel < u.costs.length ? u.costs[currentLevel] : null;
}

export function buyUpgrade(wallet: { gold: number; upgrades: UpgradeLevels }, id: UpgradeId): boolean {
  const cost = upgradeCost(id, wallet.upgrades[id]);
  if (cost === null || wallet.gold < cost) return false;
  wallet.gold -= cost;
  wallet.upgrades[id] += 1;
  return true;
}

export interface Loadout {
  torchRadius: number; burnTime: number; flasks: number; spareTorches: number; ropes: number; capacity: number;
}

export function loadoutFor(levels: UpgradeLevels): Loadout {
  return {
    torchRadius: [11, 13, 15][levels.torch] ?? 15,
    burnTime: [240, 320, 420][levels.torch] ?? 420,
    flasks: levels.fuel,
    spareTorches: 1,
    ropes: levels.rope,
    capacity: [12, 18, 26][levels.satchel] ?? 26,
  };
}
