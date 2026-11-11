export type SceneId = 'jungle' | 'courtyard' | 'cliffs' | 'halls' | 'sanctum' | 'catacombs' | 'vault';
export type Zone = 'A' | 'B' | 'C';
export interface V3 { x: number; y: number; z: number; }

export const SCENE_ORDER: SceneId[] = ['jungle', 'courtyard', 'cliffs', 'halls', 'sanctum', 'catacombs', 'vault'];

export interface SceneInfo { name: string; zone: Zone; depthMult: number; depthRank: number; }

/** depthRank orders scenes by how deep they are (used for guardian wake order and loot scaling). */
export const SCENE_INFO: Record<SceneId, SceneInfo> = {
  jungle: { name: 'Jungle Approach', zone: 'A', depthMult: 1.0, depthRank: 0 },
  courtyard: { name: 'Temple Courtyard', zone: 'A', depthMult: 1.0, depthRank: 1 },
  cliffs: { name: 'Outer Cliffs', zone: 'A', depthMult: 1.3, depthRank: 2 },
  halls: { name: 'Broken Halls', zone: 'B', depthMult: 1.6, depthRank: 3 },
  sanctum: { name: 'Collapsed Sanctum', zone: 'B', depthMult: 1.8, depthRank: 4 },
  catacombs: { name: 'Lower Catacombs', zone: 'C', depthMult: 2.4, depthRank: 5 },
  vault: { name: 'Deep Vault', zone: 'C', depthMult: 3.2, depthRank: 6 },
};

export const ZONE_RANK: Record<Zone, number> = { A: 0, B: 1, C: 2 };

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
