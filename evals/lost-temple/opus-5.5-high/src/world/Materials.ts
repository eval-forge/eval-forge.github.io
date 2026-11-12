import * as THREE from 'three';
import { TextureBank } from './Textures';

export type MatKey =
  | 'sandstone' | 'mossy' | 'flag' | 'dungeon' | 'dungeonFloor' | 'carved' | 'carvedDark'
  | 'dirt' | 'jungle' | 'riverbed' | 'rock' | 'cliff' | 'wood' | 'bark' | 'leaves' | 'leaves2'
  | 'fern' | 'vines' | 'gold' | 'bronze' | 'iron' | 'water' | 'sunTile' | 'rope' | 'bone' | 'cloth' | 'dark';

/** Metres covered by one texture repeat, per material. */
export const TEX_SCALE: Partial<Record<MatKey, number>> = {
  sandstone: 3, mossy: 3, flag: 4, dungeon: 3, dungeonFloor: 3.5, carved: 3, carvedDark: 3,
  dirt: 4, jungle: 6, riverbed: 4, rock: 6, cliff: 8, wood: 1.6, bark: 2, vines: 3, gold: 1, bronze: 1, iron: 1,
};

export class Materials {
  private cache = new Map<string, THREE.Material>();
  constructor(public tex: TextureBank) {}

  get(key: MatKey): THREE.MeshStandardMaterial {
    let m = this.cache.get(key) as THREE.MeshStandardMaterial | undefined;
    if (m) return m;
    m = this.make(key);
    m.name = key;
    this.cache.set(key, m);
    return m;
  }

  private std(set: string, rough = 0.9, bumpScale = 1.2, extra: THREE.MeshStandardMaterialParameters = {}) {
    const s = this.tex.sets[set];
    return new THREE.MeshStandardMaterial({ map: s.map, bumpMap: s.bump, bumpScale, roughness: rough, metalness: 0, ...extra });
  }

  private make(key: MatKey): THREE.MeshStandardMaterial {
    const T = this.tex;
    switch (key) {
      case 'leaves': case 'leaves2': case 'fern': case 'vines':
        return new THREE.MeshStandardMaterial({ map: T.sets[key].map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 });
      case 'gold': return this.std('gold', 0.3, 0.3, { metalness: 0.9, color: 0xffe0a0 });
      case 'bronze': return this.std('bronze', 0.45, 0.3, { metalness: 0.8 });
      case 'iron': return this.std('iron', 0.6, 0.4, { metalness: 0.7 });
      case 'water':
        return new THREE.MeshStandardMaterial({
          color: 0x1d3a3a, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.78,
          normalMap: T.water, normalScale: new THREE.Vector2(0.6, 0.6), depthWrite: false,
        });
      case 'sunTile':
        // Sunstone. Its emissive is driven per-tile at runtime (only in zone B; never in zone C).
        return this.std('carved', 0.7, 1, { color: 0xe8c890 });
      case 'rope': return new THREE.MeshStandardMaterial({ color: 0x8a7048, roughness: 1 });
      case 'bone': return new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.8 });
      case 'cloth': return new THREE.MeshStandardMaterial({ color: 0x8a3a24, roughness: 1 });
      case 'dark': return new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
      case 'rock': return this.std('rock', 0.95, 2);
      case 'cliff': return this.std('cliff', 0.95, 2.5);
      case 'dirt': return this.std('dirt', 1, 1.5);
      case 'jungle': return this.std('jungle', 1, 1.5);
      case 'riverbed': return this.std('riverbed', 0.9, 1.5);
      case 'wood': return this.std('wood', 0.85, 1);
      case 'bark': return this.std('bark', 0.95, 2);
      default: return this.std(key, 0.88, 1.6);
    }
  }

  /** A material for a solid colour (relics etc.). Cached by colour+params. */
  color(c: number, metal = 0, rough = 0.6): THREE.MeshStandardMaterial {
    const k = `c${c}_${metal}_${rough}`;
    let m = this.cache.get(k) as THREE.MeshStandardMaterial | undefined;
    if (!m) { m = new THREE.MeshStandardMaterial({ color: c, metalness: metal, roughness: rough }); this.cache.set(k, m); }
    return m;
  }

  all(): THREE.Material[] { return [...this.cache.values()]; }
}
