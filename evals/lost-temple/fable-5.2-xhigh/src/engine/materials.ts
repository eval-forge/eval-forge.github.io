/**
 * Material library.
 *
 * Every surface exists in two variants:
 *   outdoor  - lit by everything (sun, sky hemisphere, torches),
 *   dungeon  - the sun, hemisphere and ambient terms are compiled OUT of the
 *              shader. A dungeon surface can only be lit by point lights.
 * Zone C is built exclusively from dungeon variants, which is what makes
 * "zero ambient light underground" a property of the shaders rather than of
 * careful light placement.
 */
import * as THREE from 'three';
import type { TexKey, TextureLibrary } from './textures';

interface MatDef {
  kind: 'lambert' | 'standard' | 'phong';
  tex?: TexKey;
  color?: number;
  /** World metres covered by one texture tile (used by geometry builders for UVs). */
  scale?: number;
  rough?: number;
  metal?: number;
  side?: THREE.Side;
  alphaTest?: number;
  transparent?: boolean;
  opacity?: number;
  vertexColors?: boolean;
  sway?: number;
  depthWrite?: boolean;
  shininess?: number;
  /** Shade both faces with the stored normal (cards whose normals point at the sky). */
  keepNormal?: boolean;
}

const DEFS: Record<string, MatDef> = {
  templeStone: { kind: 'lambert', tex: 'temple', scale: 4, vertexColors: true },
  mossStone: { kind: 'lambert', tex: 'moss', scale: 4, vertexColors: true },
  flagstone: { kind: 'lambert', tex: 'flag', scale: 5, vertexColors: true },
  hallFloor: { kind: 'lambert', tex: 'hall', scale: 4, vertexColors: true },
  naveFloor: { kind: 'lambert', tex: 'nave', scale: 4, vertexColors: true },
  sanctumFloor: { kind: 'lambert', tex: 'sanctum', scale: 4.5, vertexColors: true },
  roofStone: { kind: 'lambert', tex: 'roof', scale: 4, vertexColors: true },
  pillar: { kind: 'lambert', tex: 'temple', scale: 3, color: 0xf2ead8, vertexColors: true },
  darkPillar: { kind: 'lambert', tex: 'dungeonWall', scale: 3, vertexColors: true },
  dungeonWall: { kind: 'lambert', tex: 'dungeonWall', scale: 4, vertexColors: true },
  dungeonFloor: { kind: 'lambert', tex: 'dungeonFloor', scale: 4, vertexColors: true },
  vaultFloor: { kind: 'lambert', tex: 'vaultFloor', scale: 4, vertexColors: true },
  causeway: { kind: 'lambert', tex: 'causeway', scale: 3, vertexColors: true },
  rock: { kind: 'lambert', tex: 'rock', scale: 6, vertexColors: true },
  terrain: { kind: 'lambert', tex: 'ground', scale: 7, vertexColors: true },
  wood: { kind: 'lambert', tex: 'wood', scale: 2, vertexColors: true },
  bark: { kind: 'lambert', tex: 'bark', scale: 2.5 },
  rope: { kind: 'lambert', color: 0x8a6f44 },
  cloth: { kind: 'lambert', color: 0x9a8460 },
  bone: { kind: 'lambert', color: 0xd8cfb4 },
  clay: { kind: 'lambert', color: 0xa8643c },
  paper: { kind: 'lambert', color: 0xd8c690 },
  scarab: { kind: 'lambert', color: 0x120d0a },
  foliage: { kind: 'lambert', color: 0xffffff, vertexColors: true, sway: 0.12 },
  leafCard: { kind: 'lambert', tex: 'leaf', alphaTest: 0.42, side: THREE.DoubleSide, sway: 0.2, keepNormal: true },
  vineCard: { kind: 'lambert', tex: 'vine', alphaTest: 0.4, side: THREE.DoubleSide, sway: 0.04 },
  gold: { kind: 'standard', tex: 'gold', rough: 0.36, metal: 0.55 },
  bronze: { kind: 'standard', tex: 'bronze', rough: 0.5, metal: 0.45 },
  iron: { kind: 'standard', color: 0x4a4a52, rough: 0.6, metal: 0.4 },
  silver: { kind: 'standard', color: 0xc9c9d2, rough: 0.32, metal: 0.5 },
  jade: { kind: 'standard', color: 0x3f9a6a, rough: 0.3, metal: 0 },
  obsidian: { kind: 'standard', color: 0x17171d, rough: 0.14, metal: 0.1 },
  ruby: { kind: 'standard', color: 0xb31229, rough: 0.14, metal: 0.15 },
  turquoise: { kind: 'standard', color: 0x2aa6a0, rough: 0.35, metal: 0 },
  crystal: { kind: 'standard', color: 0xcfe6ee, rough: 0.07, metal: 0.05, transparent: true, opacity: 0.82 },
  moonstone: { kind: 'standard', color: 0xe9e9f5, rough: 0.22, metal: 0 },
  guardianStone: { kind: 'lambert', tex: 'dungeonWall', scale: 2, color: 0xb8b4ac },
  guardianChitin: { kind: 'standard', color: 0x2a211c, rough: 0.35, metal: 0.1 },
  guardianShade: { kind: 'lambert', color: 0x050507, transparent: true, opacity: 0.9 },
  ghost: { kind: 'lambert', color: 0xbfd8ff, transparent: true, opacity: 0.3, depthWrite: false },
  hand: { kind: 'lambert', color: 0xb98a66 },
  char: { kind: 'lambert', color: 0x1a1512 },
  water: { kind: 'phong', tex: 'water', color: 0x3f8f88, transparent: true, opacity: 0.74, shininess: 90, depthWrite: false, scale: 6 },
  darkWater: { kind: 'lambert', tex: 'water', color: 0x2f5a58, transparent: true, opacity: 0.6, depthWrite: false, scale: 6 },
};

/** `lights_fragment_begin` with the sun, hemisphere and ambient terms removed. */
function dungeonLightsChunk(): string {
  let src = THREE.ShaderChunk.lights_fragment_begin;
  const before = src;
  src = src.replace(/NUM_DIR_LIGHTS/g, '0');
  src = src.replace(/NUM_HEMI_LIGHTS/g, '0');
  src = src.replace(
    'vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );',
    'vec3 irradiance = vec3( 0.0 );',
  );
  if (src === before || !src.includes('vec3 irradiance = vec3( 0.0 );')) {
    // If three.js ever renames these, fail loudly instead of silently leaking daylight underground.
    throw new Error('Dungeon shader patch did not apply: three.js lights_fragment_begin changed.');
  }
  return src;
}

const SWAY_PARS = /* glsl */ `
uniform float uTime;
uniform float uSway;
`;
const SWAY_VERT = /* glsl */ `
#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    vec3 swayBase = instanceMatrix[3].xyz;
  #else
    vec3 swayBase = modelMatrix[3].xyz;
  #endif
  float swayPhase = swayBase.x * 0.37 + swayBase.z * 0.29;
  float swayK = max(position.y, 0.0) * uSway;
  transformed.x += sin(uTime * 1.3 + swayPhase) * swayK;
  transformed.z += cos(uTime * 1.05 + swayPhase * 1.7) * swayK * 0.7;
}
`;

export class Materials {
  private cache = new Map<string, THREE.Material>();
  /** Shared clock uniform for vegetation sway. */
  readonly time = { value: 0 };
  private readonly dungeonChunk = dungeonLightsChunk();

  constructor(private readonly textures: TextureLibrary) {}

  /** Metres per texture tile for a material (geometry builders scale UVs with this). */
  scaleOf(key: string): number {
    return DEFS[key]?.scale ?? 2;
  }

  has(key: string): boolean {
    return key in DEFS;
  }

  get(key: string, dungeon = false): THREE.Material {
    const id = dungeon ? `${key}|d` : key;
    let m = this.cache.get(id);
    if (!m) {
      m = this.build(key, dungeon);
      this.cache.set(id, m);
    }
    return m;
  }

  /**
   * Variant for things held in front of the camera. It always passes the depth
   * test (and still writes depth), so a hand-held object never clips into a wall.
   * Draw order between such parts is set with `renderOrder`.
   *
   * Point lights are compiled out too: the torch light sits a hand's width from
   * the torch and would burn it white. Whoever holds the object sets `emissive`
   * instead (black by default, so an unlit hand underground is truly black).
   */
  viewModel(key: string, dungeon: boolean, slot = ''): THREE.MeshLambertMaterial | THREE.MeshStandardMaterial {
    // `slot` gives a part its own instance (own emissive); the shader program is still shared.
    const id = `${key}|vm${slot}${dungeon ? '|d' : ''}`;
    let m = this.cache.get(id);
    if (!m) {
      const mat = this.build(key, dungeon, true) as THREE.MeshLambertMaterial;
      mat.depthFunc = THREE.AlwaysDepth;
      mat.emissive.setRGB(0, 0, 0);
      mat.emissiveMap = mat.map;
      mat.name += ':vm';
      m = mat;
      this.cache.set(id, m);
    }
    return m as THREE.MeshLambertMaterial;
  }

  /** Swap every material on an object tree to the variant for its surroundings. */
  applyZone(root: THREE.Object3D, dungeon: boolean): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const key = mesh.userData.matKey as string | undefined;
      if (mesh.isMesh && key) mesh.material = this.get(key, dungeon);
    });
  }

  /**
   * Materials that tint by vertex colour render black on geometry that has no
   * colour attribute. Give such geometry a white one.
   */
  prep<T extends THREE.BufferGeometry>(geometry: T, key: string): T {
    if (DEFS[key]?.vertexColors && !geometry.getAttribute('color')) {
      const n = geometry.getAttribute('position').count;
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
    return geometry;
  }

  /** Create a mesh that remembers its material key so it can change zone later. */
  mesh(geometry: THREE.BufferGeometry, key: string, dungeon = false): THREE.Mesh {
    const m = new THREE.Mesh(this.prep(geometry, key), this.get(key, dungeon));
    m.userData.matKey = key;
    return m;
  }

  private build(key: string, dungeon: boolean, held = false): THREE.Material {
    const def = DEFS[key];
    if (!def) throw new Error(`Unknown material "${key}"`);
    const common = {
      color: def.color ?? 0xffffff,
      map: def.tex ? this.textures.get(def.tex) : null,
      side: def.side ?? THREE.FrontSide,
      alphaTest: def.alphaTest ?? 0,
      transparent: def.transparent ?? false,
      opacity: def.opacity ?? 1,
      vertexColors: def.vertexColors ?? false,
      depthWrite: def.depthWrite ?? true,
      // Dungeon surfaces take no fog either: nothing may tint true black.
      fog: !dungeon,
    };
    let mat: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial | THREE.MeshPhongMaterial;
    if (def.kind === 'standard') {
      mat = new THREE.MeshStandardMaterial({ ...common, roughness: def.rough ?? 0.8, metalness: def.metal ?? 0 });
    } else if (def.kind === 'phong' && !dungeon && !held) {
      mat = new THREE.MeshPhongMaterial({ ...common, shininess: def.shininess ?? 30, specular: 0x666666 });
    } else {
      mat = new THREE.MeshLambertMaterial(common);
    }
    mat.name = dungeon ? `${key}:dungeon` : key;
    const sway = def.sway ?? 0;
    let chunk = dungeon ? this.dungeonChunk : THREE.ShaderChunk.lights_fragment_begin;
    if (held) chunk = chunk.replace(/NUM_POINT_LIGHTS/g, '0');
    const time = this.time;
    const keepNormal = def.keepNormal ?? false;
    if (dungeon || held || sway > 0 || keepNormal) {
      mat.onBeforeCompile = (shader) => {
        if (keepNormal) {
          const src = THREE.ShaderChunk.normal_fragment_begin;
          const patched = src.replace('normal *= faceDirection;', '');
          if (patched === src) throw new Error('Card patch did not apply: three.js normal_fragment_begin changed.');
          shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', patched);
        }
        if (dungeon || held) {
          if (!shader.fragmentShader.includes('#include <lights_fragment_begin>')) {
            throw new Error(`Light patch: ${key} has no lights_fragment_begin include`);
          }
          shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
        }
        if (sway > 0) {
          shader.uniforms.uTime = time;
          shader.uniforms.uSway = { value: sway };
          shader.vertexShader = SWAY_PARS + shader.vertexShader.replace('#include <begin_vertex>', SWAY_VERT);
        }
      };
      mat.customProgramCacheKey = () => `${dungeon ? 'dungeon' : 'sky'}|${held ? 'held' : 'world'}|${sway}|${keepNormal ? 'card' : ''}`;
    }
    return mat;
  }

  /** A lit material for a one-off texture (murals), with the same zone rules as everything else. */
  fromTexture(id: string, tex: THREE.Texture, dungeon: boolean): THREE.Material {
    const key = `tex:${id}${dungeon ? '|d' : ''}`;
    let m = this.cache.get(key);
    if (!m) {
      const mat = new THREE.MeshLambertMaterial({ map: tex, fog: !dungeon });
      mat.name = key;
      if (dungeon) {
        const chunk = this.dungeonChunk;
        mat.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
        };
        mat.customProgramCacheKey = () => 'dungeon|0';
      }
      m = mat;
      this.cache.set(key, m);
    }
    return m;
  }

  /** All material keys (for the warm-up compile). */
  keys(): string[] {
    return Object.keys(DEFS);
  }

  /** Every dungeon-variant material created so far (used by the darkness audit). */
  dungeonMaterials(): THREE.Material[] {
    return [...this.cache.entries()].filter(([k]) => k.endsWith('|d')).map(([, m]) => m);
  }
}
