/** Scene metadata shared by rules, layouts and UI. Pure data. */

export type SceneId = 'jungle' | 'courtyard' | 'cliffs' | 'halls' | 'sanctum' | 'catacombs' | 'vault';
export type Zone = 'A' | 'B' | 'C';

export interface SceneMeta {
  id: SceneId;
  name: string;
  zone: Zone;
  /** 0 = shallowest. Used for guardian wave order and loot multipliers. */
  depth: number;
  /** Relic value multiplier: deeper finds are worth more. */
  mult: number;
  /** Graph neighbours that should be streamed in while the player is here. */
  neighbours: SceneId[];
  /** Does the sky reach this scene at all? */
  sky: 'open' | 'partial' | 'none';
}

export const SCENES: Record<SceneId, SceneMeta> = {
  jungle: {
    id: 'jungle', name: 'Jungle Approach', zone: 'A', depth: 0, mult: 1.0,
    neighbours: ['courtyard'], sky: 'open',
  },
  courtyard: {
    id: 'courtyard', name: 'Temple Courtyard', zone: 'A', depth: 1, mult: 1.0,
    neighbours: ['jungle', 'cliffs', 'halls', 'sanctum'], sky: 'open',
  },
  cliffs: {
    id: 'cliffs', name: 'Outer Cliffs', zone: 'A', depth: 2, mult: 1.5,
    neighbours: ['courtyard'], sky: 'open',
  },
  halls: {
    id: 'halls', name: 'Broken Halls', zone: 'B', depth: 3, mult: 1.6,
    neighbours: ['courtyard', 'sanctum', 'catacombs'], sky: 'partial',
  },
  sanctum: {
    id: 'sanctum', name: 'Collapsed Sanctum', zone: 'B', depth: 4, mult: 2.0,
    neighbours: ['halls', 'courtyard', 'vault'], sky: 'partial',
  },
  catacombs: {
    id: 'catacombs', name: 'Lower Catacombs', zone: 'C', depth: 5, mult: 2.6,
    neighbours: ['halls', 'vault'], sky: 'none',
  },
  vault: {
    id: 'vault', name: 'Deep Vault', zone: 'C', depth: 6, mult: 3.4,
    neighbours: ['catacombs', 'sanctum'], sky: 'none',
  },
};

export const SCENE_ORDER: SceneId[] = ['jungle', 'courtyard', 'cliffs', 'halls', 'sanctum', 'catacombs', 'vault'];

export const ZONE_NAME: Record<Zone, string> = {
  A: 'Outside',
  B: 'Roofless ruins',
  C: 'Dungeon',
};

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x: number, y: number, z: number): Vec3Like => ({ x, y, z });
export const dist3 = (a: Vec3Like, b: Vec3Like): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2 = (a: Vec3Like, b: Vec3Like): number => Math.hypot(a.x - b.x, a.z - b.z);
