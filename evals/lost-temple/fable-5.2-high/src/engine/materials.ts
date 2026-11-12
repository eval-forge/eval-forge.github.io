import * as THREE from 'three';
import { DARK_DEPTH } from '../core/sun';
import { flameTex, foliage, glyphStone, ironwork, masonry, mottled, softDot, wood } from './textures';

/**
 * How a surface responds to sky light (hemisphere ambient and the sun/moon).
 *  sky:  normal.
 *  fade: sky light fades out with depth, reaching zero at DARK_DEPTH. Used on the stairs down.
 *  dark: receives no sky light at all, whatever the global lights are doing. Used for all of Zone C,
 *        so the dungeons are lit by torches and nothing else.
 */
export type Gate = 'sky' | 'fade' | 'dark';

export type MatName =
  | 'stone' | 'stoneMoss' | 'floor' | 'rock' | 'dirt' | 'grass' | 'wood' | 'bark' | 'gold' | 'glyph'
  | 'rubble' | 'bone' | 'roof' | 'iron' | 'crypt' | 'cryptFloor' | 'rope' | 'clay' | 'jade';

interface Def { scale: number; make: () => THREE.MeshStandardMaterial; }

function gateExpr(gate: Gate): string {
  if (gate === 'dark') return '0.0';
  return `clamp((vWorldY - (${DARK_DEPTH.toFixed(1)})) / 7.0, 0.0, 1.0)`;
}

/** Patch a standard material so sky light is gated. Returns false if the shader chunk did not match. */
export function applyGate(mat: THREE.MeshStandardMaterial, gate: Gate): boolean {
  if (gate === 'sky') return true;
  let ok = true;
  mat.onBeforeCompile = (shader) => {
    const expr = gateExpr(gate);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
    const needle = 'getDirectionalLightInfo( directionalLight, directLight );';
    let chunk = THREE.ShaderChunk.lights_fragment_begin;
    if (!chunk.includes(needle)) { ok = false; console.warn('sky gate: directional light chunk not found'); }
    chunk = chunk.replace(needle, `${needle}\n\t\tdirectLight.color *= skyGate;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
      .replace('#include <lights_fragment_begin>',
        `float skyGate = ${expr};\n${chunk}\n#if defined( RE_IndirectDiffuse )\n\tirradiance *= skyGate;\n#endif`);
  };
  mat.customProgramCacheKey = () => `gate-${gate}`;
  return ok;
}

export class Materials {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  private defs: Record<MatName, Def>;
  private tex = new Map<string, THREE.Texture>();

  constructor() {
    const std = (pair: { map: THREE.Texture; bump: THREE.Texture }, rough: number, bumpScale: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      () => new THREE.MeshStandardMaterial({ map: pair.map, bumpMap: pair.bump, bumpScale, roughness: rough, metalness: 0, vertexColors: true, ...extra });
    const lazy = <T,>(f: () => T) => { let v: T | undefined; return () => (v ??= f()); };

    const stone = lazy(() => masonry({ base: [168, 152, 124], mortar: [72, 64, 52], cols: 3, rows: 5, moss: 0.36, seed: 11 }));
    const stoneMoss = lazy(() => masonry({ base: [150, 142, 112], mortar: [60, 62, 44], cols: 3, rows: 5, moss: 0.62, seed: 23 }));
    const floor = lazy(() => masonry({ base: [150, 140, 120], mortar: [58, 54, 44], cols: 2, rows: 2, moss: 0.3, seed: 37, rough: 0.35 }));
    const crypt = lazy(() => masonry({ base: [118, 112, 104], mortar: [34, 32, 30], cols: 4, rows: 6, seed: 41, rough: 0.4 }));
    const cryptFloor = lazy(() => masonry({ base: [104, 100, 94], mortar: [30, 28, 26], cols: 3, rows: 3, seed: 53, rough: 0.45 }));
    const roof = lazy(() => masonry({ base: [128, 116, 96], mortar: [52, 46, 38], cols: 2, rows: 3, moss: 0.2, seed: 61 }));
    const rock = lazy(() => mottled([104, 96, 84], [140, 130, 112], [78, 82, 60], 71, 30, 256, 0.09));
    const rubble = lazy(() => mottled([96, 90, 80], [128, 118, 100], [62, 58, 52], 83, 12));
    const dirt = lazy(() => mottled([92, 70, 46], [120, 96, 62], [60, 50, 34], 91, 18));
    const grass = lazy(() => mottled([58, 96, 40], [86, 124, 52], [44, 72, 30], 97, 14));
    const bark = lazy(() => mottled([70, 52, 36], [96, 74, 50], [44, 34, 24], 101, 9, 256, 0.3));
    const planks = lazy(() => wood([150, 108, 66], 113));
    const glyph = lazy(() => glyphStone([150, 132, 100], 127));
    const iron = lazy(() => ironwork(137));
    const plain = lazy(() => mottled([200, 200, 200], [230, 230, 230], [170, 170, 170], 131, 20, 128));

    this.defs = {
      stone: { scale: 3, make: () => std(stone(), 0.95, 2.2)() },
      stoneMoss: { scale: 3, make: () => std(stoneMoss(), 0.97, 2.2)() },
      floor: { scale: 4, make: () => std(floor(), 0.92, 2.0)() },
      crypt: { scale: 3, make: () => std(crypt(), 0.78, 2.4)() },
      cryptFloor: { scale: 3.5, make: () => std(cryptFloor(), 0.7, 2.2)() },
      roof: { scale: 4, make: () => std(roof(), 0.95, 2)() },
      rock: { scale: 7, make: () => std(rock(), 0.98, 3)() },
      rubble: { scale: 2.5, make: () => std(rubble(), 1, 3)() },
      dirt: { scale: 4, make: () => std(dirt(), 1, 1.5)() },
      grass: { scale: 5, make: () => std(grass(), 1, 1.2)() },
      bark: { scale: 2, make: () => std(bark(), 1, 2.5)() },
      wood: { scale: 1.6, make: () => std(planks(), 0.85, 0.9)() },
      rope: { scale: 0.5, make: () => std(bark(), 1, 1, { color: 0xc8a878 })() },
      glyph: { scale: 2.4, make: () => std(glyph(), 0.9, 2.6)() },
      gold: { scale: 2, make: () => std(plain(), 0.38, 0.6, { color: 0xf0c038, metalness: 0.35 })() },
      iron: { scale: 1.5, make: () => std(iron(), 0.6, 2.4, { metalness: 0.25 })() },
      bone: { scale: 1.5, make: () => std(plain(), 0.8, 0.8, { color: 0xd8d0b8 })() },
      clay: { scale: 1.5, make: () => std(plain(), 0.9, 1.0, { color: 0xa8623c })() },
      jade: { scale: 1.5, make: () => std(plain(), 0.3, 0.5, { color: 0x3fa672 })() },
    };
  }

  /** World metres per texture repeat. */
  scaleOf(name: MatName): number { return this.defs[name].scale; }

  get(name: MatName, gate: Gate = 'sky'): THREE.MeshStandardMaterial {
    const key = `${name}|${gate}`;
    let m = this.cache.get(key);
    if (!m) {
      m = this.defs[name].make();
      m.name = key;
      applyGate(m, gate);
      this.cache.set(key, m);
    }
    return m;
  }

  /** A plain coloured material for props (relics, guardians). Cached by parameters. */
  solid(color: number, rough = 0.6, metal = 0, emissive = 0x000000, gate: Gate = 'sky'): THREE.MeshStandardMaterial {
    const key = `solid|${color}|${rough}|${metal}|${emissive}|${gate}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive });
      applyGate(m, gate);
      this.cache.set(key, m);
    }
    return m;
  }

  texture(kind: 'bush' | 'fern' | 'vine' | 'grass' | 'canopy' | 'flame' | 'dust' | 'ember'): THREE.Texture {
    let t = this.tex.get(kind);
    if (!t) {
      if (kind === 'flame') t = flameTex();
      else if (kind === 'dust') t = softDot('rgba(200,190,170,0.9)', 'rgba(160,150,130,0.35)');
      else if (kind === 'ember') t = softDot('rgba(255,220,150,1)', 'rgba(255,120,30,0.5)');
      else t = foliage(kind, { bush: 3, fern: 5, vine: 7, grass: 9, canopy: 13 }[kind]);
      this.tex.set(kind, t);
    }
    return t;
  }

  /** Alpha-tested double-sided card material for vegetation. */
  card(kind: 'bush' | 'fern' | 'vine' | 'grass' | 'canopy', gate: Gate = 'sky'): THREE.MeshStandardMaterial {
    const key = `card|${kind}|${gate}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: this.texture(kind), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
      applyGate(m, gate);
      this.cache.set(key, m);
    }
    return m;
  }

  /** Flat-shaded leafy mass for tree canopies (tinted per vertex). */
  canopy(): THREE.MeshStandardMaterial {
    let m = this.cache.get('canopy');
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0x4c8a3c, roughness: 1, metalness: 0, vertexColors: true, flatShading: true });
      this.cache.set('canopy', m);
    }
    return m;
  }

  water(gate: Gate): THREE.MeshStandardMaterial {
    const key = `water|${gate}`;
    let m = this.cache.get(key);
    if (!m) {
      const bump = this.get('rock').bumpMap!.clone();
      bump.needsUpdate = true;
      m = new THREE.MeshStandardMaterial({
        color: gate === 'dark' ? 0x0c1a1c : 0x2a5a5c, roughness: 0.08, metalness: 0.2, transparent: true,
        opacity: gate === 'dark' ? 0.82 : 0.72, bumpMap: bump, bumpScale: 0.6, depthWrite: false,
      });
      applyGate(m, gate);
      this.cache.set(key, m);
    }
    return m;
  }

  all(): THREE.Material[] { return [...this.cache.values()]; }
}
