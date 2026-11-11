/**
 * Material factory. Every lit material is patched so the directional light (sun/moon)
 * and the ambient/hemisphere irradiance are scaled by per-"exposure class" uniforms:
 *
 *   outdoor  — sun 1, sky 1           (Zone A)
 *   ruins    — sun 1, sky 0.45        (Zone B, partly roofed)
 *   dungeon  — sun 0, sky 0           (Zone C: only flames can light it)
 *
 * This is what guarantees true black outside the torch radius underground: those
 * fragments receive no light term except point lights.
 */
import * as THREE from 'three';
import { textures } from './textures';

export type Exposure = 'outdoor' | 'ruins' | 'dungeon';

const SKY: Record<Exposure, { direct: { value: number }; ambient: { value: number } }> = {
  outdoor: { direct: { value: 1 }, ambient: { value: 1 } },
  ruins: { direct: { value: 1 }, ambient: { value: 0.45 } },
  dungeon: { direct: { value: 0 }, ambient: { value: 0 } },
};

/** Live uniform values (the dungeon class is always 0 and is never changed). */
export function skyUniforms(e: Exposure) {
  return SKY[e];
}

const PATCHED_BEGIN = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= uSkyDirect;',
);

if (PATCHED_BEGIN === THREE.ShaderChunk.lights_fragment_begin) {
  // eslint-disable-next-line no-console
  console.warn('[materials] could not patch lights_fragment_begin: sky mask inactive');
}

export function applySkyMask<T extends THREE.Material>(mat: T, exposure: Exposure): T {
  const u = SKY[exposure];
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSkyDirect = u.direct;
    shader.uniforms.uSkyAmbient = u.ambient;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSkyDirect;\nuniform float uSkyAmbient;')
      .replace('#include <lights_fragment_begin>', PATCHED_BEGIN)
      .replace(
        '#include <lights_fragment_maps>',
        '#if defined( RE_IndirectDiffuse )\n\tirradiance *= uSkyAmbient;\n#endif\n#include <lights_fragment_maps>',
      );
  };
  // same source for all exposures → shared programs; uniforms are per material
  mat.customProgramCacheKey = () => 'skymask1';
  (mat as any).userData.exposure = exposure;
  return mat;
}

const cache = new Map<string, THREE.Material>();

export interface MatOptions {
  color?: number;
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  normalScale?: number;
  roughness?: number;
  metalness?: number;
  repeat?: [number, number];
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  side?: THREE.Side;
  emissive?: number;
  emissiveIntensity?: number;
  flatShading?: boolean;
  vertexColors?: boolean;
}

/** Cached standard material for a given key + exposure class. */
export function standard(key: string, exposure: Exposure, opts: MatOptions): THREE.MeshStandardMaterial {
  const k = `${key}|${exposure}`;
  const hit = cache.get(k);
  if (hit) return hit as THREE.MeshStandardMaterial;
  if (exposure === 'dungeon' && opts.emissive) {
    // nothing in the dungeon glows on its own
    opts = { ...opts, emissive: 0, emissiveIntensity: 0 };
  }
  const m = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xffffff,
    map: opts.map ?? null,
    normalMap: opts.normalMap ?? null,
    roughness: opts.roughness ?? 0.9,
    metalness: opts.metalness ?? 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    alphaTest: opts.alphaTest ?? 0,
    side: opts.side ?? THREE.FrontSide,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    flatShading: opts.flatShading ?? false,
    vertexColors: opts.vertexColors ?? false,
  });
  if (opts.normalMap && opts.normalScale !== undefined) m.normalScale.set(opts.normalScale, opts.normalScale);
  applySkyMask(m, exposure);
  m.userData.matKey = key;
  m.userData.matOpts = opts;
  cache.set(k, m);
  return m;
}

/** The same material for another exposure class (for things that move between zones). */
export function variant(mat: THREE.Material, exposure: Exposure): THREE.Material {
  const key = mat.userData?.matKey as string | undefined;
  if (!key || mat.userData.exposure === exposure) return mat;
  return standard(key, exposure, mat.userData.matOpts as MatOptions);
}

/** Swap every mesh under `obj` to the given exposure class. */
export function setExposure(obj: THREE.Object3D, exposure: Exposure) {
  if (obj.userData.exposure === exposure) return;
  obj.userData.exposure = exposure;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (Array.isArray(m.material)) m.material = m.material.map((x) => variant(x, exposure));
    else m.material = variant(m.material, exposure);
  });
}

/** Named surface materials used by the level builders (world-space UVs, 1 tile ≈ 2 m). */
export function surface(name: SurfaceName, exposure: Exposure): THREE.MeshStandardMaterial {
  const T = textures();
  switch (name) {
    case 'templeWall':
      return standard('templeWall', exposure, { map: T.templeWall.map, normalMap: T.templeWall.normal, normalScale: 0.9, roughness: 0.92 });
    case 'templeWallMoss':
      return standard('templeWallMoss', exposure, { map: T.templeWallMoss.map, normalMap: T.templeWallMoss.normal, normalScale: 0.9, roughness: 0.95 });
    case 'dungeonWall':
      return standard('dungeonWall', exposure, { map: T.dungeonWall.map, normalMap: T.dungeonWall.normal, normalScale: 1.1, roughness: 0.9 });
    case 'floor':
      return standard('floor', exposure, { map: T.floorSlab.map, normalMap: T.floorSlab.normal, normalScale: 0.8, roughness: 0.88 });
    case 'dungeonFloor':
      return standard('dungeonFloor', exposure, { map: T.dungeonFloor.map, normalMap: T.dungeonFloor.normal, normalScale: 0.9, roughness: 0.85 });
    case 'rock':
      return standard('rock', exposure, { map: T.rock.map, normalMap: T.rock.normal, normalScale: 1.2, roughness: 0.95 });
    case 'rockMoss':
      return standard('rockMoss', exposure, { map: T.rockMoss.map, normalMap: T.rockMoss.normal, normalScale: 1.2, roughness: 0.95 });
    case 'wood':
      return standard('wood', exposure, { map: T.wood.map, normalMap: T.wood.normal, normalScale: 0.7, roughness: 0.8 });
    case 'ground':
      return standard('ground', exposure, { map: T.ground.map, normalMap: T.ground.normal, normalScale: 0.8, roughness: 0.97 });
    case 'bark':
      return standard('bark', exposure, { map: T.bark.map, normalMap: T.bark.normal, normalScale: 1, roughness: 0.95 });
    case 'ceiling':
      return standard('ceiling', exposure, { map: T.dungeonWall.map, normalMap: T.dungeonWall.normal, color: 0x9a9080, roughness: 0.95 });
    case 'iron':
      return standard('iron', exposure, { color: 0x3a3632, roughness: 0.55, metalness: 0.7 });
    case 'gold':
      return standard('gold', exposure, { color: 0xe8b84a, roughness: 0.32, metalness: 1 });
    case 'rope':
      return standard('rope', exposure, { color: 0x9c8058, roughness: 1 });
    case 'bone':
      return standard('bone', exposure, { color: 0xd8ccb0, roughness: 0.8 });
    case 'sand':
      return standard('sand', exposure, { map: T.sandbag.map, normalMap: T.sandbag.normal, color: 0xc0a878, roughness: 1 });
  }
}

export type SurfaceName =
  | 'templeWall'
  | 'templeWallMoss'
  | 'dungeonWall'
  | 'floor'
  | 'dungeonFloor'
  | 'rock'
  | 'rockMoss'
  | 'wood'
  | 'ground'
  | 'bark'
  | 'ceiling'
  | 'iron'
  | 'gold'
  | 'rope'
  | 'bone'
  | 'sand';

/** Plain colour material, cached by colour/roughness/metalness and exposure. */
export function tinted(color: number, exposure: Exposure, roughness = 0.8, metalness = 0, extra: Partial<MatOptions> = {}): THREE.MeshStandardMaterial {
  const key = `tint:${color.toString(16)}:${roughness}:${metalness}:${extra.transparent ? 't' : ''}${extra.opacity ?? ''}:${extra.flatShading ? 'f' : ''}`;
  return standard(key, exposure, { color, roughness, metalness, ...extra });
}

/** Unlit additive material for flames (the light source itself). */
export function flameMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        float sway = sin(uTime * 9.0 + p.y * 6.0) * 0.03 * uv.y + sin(uTime * 13.0) * 0.015 * uv.y;
        p.x += sway;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uIntensity;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      void main() {
        vec2 uv = vUv;
        float n = noise(vec2(uv.x * 4.0, uv.y * 3.0 - uTime * 4.0)) * 0.6 + noise(vec2(uv.x * 9.0, uv.y * 6.0 - uTime * 7.0)) * 0.4;
        float width = (1.0 - uv.y) * 0.55 + 0.05;
        float d = abs(uv.x - 0.5) / width;
        float shape = smoothstep(1.0, 0.2, d + n * 0.55 * uv.y) * smoothstep(1.0, 0.55, uv.y + n * 0.25) * smoothstep(0.0, 0.12, uv.y);
        vec3 col = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.4), smoothstep(0.2, 0.9, shape));
        col = mix(col, vec3(1.0, 1.0, 0.85), smoothstep(0.85, 1.0, shape) * (1.0 - uv.y));
        gl_FragColor = vec4(col * shape * 2.2 * uIntensity, shape * uIntensity);
      }`,
  });
}
