/**
 * Shared materials. Every material is non-emissive unless it is explicitly a light source
 * (flames) or a zone A/B effect (sunstone glow, light shafts). Zone C materials never glow.
 */
import * as THREE from 'three';
import type { TextureLibrary, TexSet } from './textures';

export type MatKey =
  | 'sandstone'
  | 'sandstoneMoss'
  | 'floor'
  | 'floorMoss'
  | 'plaster'
  | 'dungeon'
  | 'dungeonFloor'
  | 'rock'
  | 'rockMoss'
  | 'ground'
  | 'wood'
  | 'darkWood'
  | 'rope'
  | 'bark'
  | 'leaf'
  | 'leafDark'
  | 'grass'
  | 'gold'
  | 'bronze'
  | 'silver'
  | 'jade'
  | 'obsidian'
  | 'bone'
  | 'burlap'
  | 'clay'
  | 'glyphs'
  | 'glyphsDark'
  | 'iron'
  | 'gemRed'
  | 'gemBlue'
  | 'turquoise'
  | 'cloth'
  | 'ghost';

/** Inject world-space moss on up-facing surfaces into a standard material. */
function addMoss(mat: THREE.MeshStandardMaterial, strength: number, color = new THREE.Color(0.16, 0.26, 0.07)) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.mossStrength = { value: strength };
    shader.uniforms.mossColor = { value: color };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMossPos;\nvarying vec3 vMossNormal;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvec4 mossWP = modelMatrix * vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nmossWP = modelMatrix * instanceMatrix * vec4(transformed, 1.0);\n#endif\nvMossPos = mossWP.xyz;\nvMossNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vMossPos;
varying vec3 vMossNormal;
uniform float mossStrength;
uniform vec3 mossColor;
float mossHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mossNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mossHash(i), mossHash(i + vec2(1.0, 0.0)), f.x), mix(mossHash(i + vec2(0.0, 1.0)), mossHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  float up = clamp(vMossNormal.y, 0.0, 1.0);
  float n = mossNoise(vMossPos.xz * 0.45 + vMossPos.y * 0.2) * 0.6 + mossNoise(vMossPos.xz * 1.7) * 0.4;
  float side = (1.0 - abs(vMossNormal.y)) * smoothstep(0.55, 0.85, mossNoise(vMossPos.xy * 0.6 + vMossPos.zy * 0.6)) * 0.55;
  float m = clamp(smoothstep(0.42, 0.78, up * 0.75 + n * 0.55 - 0.1) + side * smoothstep(1.5, -0.5, vMossPos.y - floor(vMossPos.y / 12.0) * 12.0), 0.0, 1.0) * mossStrength;
  diffuseColor.rgb = mix(diffuseColor.rgb, mossColor * (0.6 + n * 0.6), m);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'moss' + strength.toFixed(2);
}

function std(set: TexSet | null, o: THREE.MeshStandardMaterialParameters & { repeat?: number } = {}): THREE.MeshStandardMaterial {
  const { repeat, ...rest } = o;
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...rest });
  if (set) {
    m.map = set.map;
    if (set.normal) {
      m.normalMap = set.normal;
      m.normalScale = new THREE.Vector2(1, 1);
    }
    if (set.rough) m.roughnessMap = set.rough;
  }
  return m;
}

export class Materials {
  private mats = new Map<MatKey, THREE.Material>();
  flame!: THREE.SpriteMaterial;
  water!: THREE.MeshStandardMaterial;
  waterDark!: THREE.MeshStandardMaterial;
  sunstoneLit!: THREE.MeshStandardMaterial;
  sunstoneDim!: THREE.MeshStandardMaterial;
  shaft!: THREE.ShaderMaterial;
  dust!: THREE.PointsMaterial;

  constructor(public tex: TextureLibrary, flameTex: THREE.Texture, dotTex: THREE.Texture) {
    const t = tex;
    const vc = { vertexColors: true };
    const sand = std(t.sandstone, { ...vc, roughness: 0.9 });
    const sandMoss = std(t.sandstone, { ...vc, roughness: 0.92 });
    addMoss(sandMoss, 0.85);
    const floor = std(t.floorTiles, { ...vc, roughness: 0.88 });
    const floorMoss = std(t.floorTiles, { ...vc, roughness: 0.9 });
    addMoss(floorMoss, 0.9);
    const rock = std(t.rock, { ...vc, roughness: 0.95 });
    const rockMoss = std(t.rock, { ...vc, roughness: 0.95 });
    addMoss(rockMoss, 0.8);
    this.mats.set('sandstone', sand);
    this.mats.set('sandstoneMoss', sandMoss);
    this.mats.set('floor', floor);
    this.mats.set('floorMoss', floorMoss);
    this.mats.set('plaster', std(t.plaster, { ...vc, roughness: 0.92 }));
    this.mats.set('dungeon', std(t.dungeon, { ...vc, roughness: 0.75, color: 0xd8d2c8 }));
    this.mats.set('dungeonFloor', std(t.dungeon, { ...vc, roughness: 0.7, color: 0xb8b0a4 }));
    this.mats.set('rock', rock);
    this.mats.set('rockMoss', rockMoss);
    this.mats.set('ground', std(t.ground, { ...vc, roughness: 0.97 }));
    this.mats.set('wood', std(t.wood, { ...vc, roughness: 0.8 }));
    this.mats.set('darkWood', std(t.wood, { ...vc, roughness: 0.85, color: 0x6a5a48 }));
    this.mats.set('rope', std(t.rope, { ...vc, roughness: 0.95 }));
    this.mats.set('bark', std(t.bark, { ...vc, roughness: 0.95 }));
    this.mats.set('leaf', std(t.leaf, { ...vc, roughness: 0.75, side: THREE.DoubleSide }));
    this.mats.set('leafDark', std(t.leaf, { ...vc, roughness: 0.8, color: 0x8aa080, side: THREE.DoubleSide }));
    this.mats.set('grass', std(null, { ...vc, roughness: 0.8, side: THREE.DoubleSide }));
    this.mats.set('gold', std(t.gold, { ...vc, metalness: 1, roughness: 0.32, color: 0xffd27a }));
    this.mats.set('bronze', std(t.gold, { ...vc, metalness: 0.9, roughness: 0.45, color: 0x9a6a3a }));
    this.mats.set('silver', std(t.gold, { ...vc, metalness: 1, roughness: 0.38, color: 0xb8b8c0 }));
    this.mats.set('jade', std(t.jade, { ...vc, roughness: 0.3 }));
    this.mats.set('obsidian', std(null, { ...vc, roughness: 0.12, metalness: 0.2, color: 0x141018 }));
    this.mats.set('bone', std(t.bone, { ...vc, roughness: 0.8 }));
    this.mats.set('burlap', std(t.burlap, { ...vc, roughness: 1 }));
    this.mats.set('clay', std(t.clay, { ...vc, roughness: 0.85 }));
    this.mats.set('glyphs', std(t.glyphs, { ...vc, roughness: 0.9 }));
    this.mats.set('glyphsDark', std(t.glyphs, { ...vc, roughness: 0.8, color: 0x8a8478 }));
    this.mats.set('iron', std(null, { ...vc, roughness: 0.5, metalness: 0.85, color: 0x50504e }));
    this.mats.set('gemRed', std(null, { ...vc, roughness: 0.08, metalness: 0.1, color: 0xa01828 }));
    this.mats.set('gemBlue', std(null, { ...vc, roughness: 0.08, metalness: 0.1, color: 0x1a50b0 }));
    this.mats.set('turquoise', std(null, { ...vc, roughness: 0.35, color: 0x3aa8a0 }));
    this.mats.set('cloth', std(t.burlap, { ...vc, roughness: 1, color: 0xb04a2a }));
    this.mats.set('ghost', new THREE.MeshStandardMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0.32, roughness: 0.6, depthWrite: false }));

    this.flame = new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(2.2, 1.6, 1.0) });

    const wn = t.water.normal!.clone();
    wn.needsUpdate = true;
    this.water = new THREE.MeshStandardMaterial({ color: 0x2a4a40, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.82, normalMap: wn, normalScale: new THREE.Vector2(0.6, 0.6), depthWrite: false });
    const wn2 = t.water.normal!.clone();
    wn2.needsUpdate = true;
    this.waterDark = new THREE.MeshStandardMaterial({ color: 0x18242a, roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.88, normalMap: wn2, normalScale: new THREE.Vector2(0.4, 0.4), depthWrite: false });

    this.sunstoneLit = new THREE.MeshStandardMaterial({ map: t.sunstone.map, normalMap: t.sunstone.normal, color: 0xffe2a0, emissive: new THREE.Color(1.0, 0.62, 0.2), emissiveIntensity: 0.9, roughness: 0.35, transparent: false });
    this.sunstoneDim = new THREE.MeshStandardMaterial({ map: t.sunstone.map, color: 0x8a7a60, roughness: 0.4, transparent: true, opacity: 0.28, depthWrite: false });

    this.shaft = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 0.9, 0.7) }, uIntensity: { value: 0.3 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; varying vec3 vWorld; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uIntensity; uniform float uTime; varying vec2 vUv; varying vec3 vWorld;
        void main(){ float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x); float fall = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
        float mote = 0.75 + 0.25 * sin(vWorld.y * 3.0 + uTime * 0.7 + vWorld.x * 2.0);
        gl_FragColor = vec4(uColor * uIntensity * edge * fall * mote, 1.0); }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.dust = new THREE.PointsMaterial({ map: dotTex, size: 0.06, transparent: true, depthWrite: false, opacity: 0.6, color: 0xd8c8a8 });
  }

  get(k: MatKey): THREE.Material {
    const m = this.mats.get(k);
    if (!m) throw new Error('material ' + k);
    return m;
  }

  /** Animate water normal maps. */
  update(t: number) {
    if (this.water.normalMap) this.water.normalMap.offset.set(t * 0.03, t * 0.017);
    if (this.waterDark.normalMap) this.waterDark.normalMap.offset.set(t * 0.008, -t * 0.006);
    this.shaft.uniforms.uTime.value = t;
  }

  all(): THREE.Material[] {
    return [...this.mats.values(), this.water, this.waterDark, this.sunstoneLit, this.sunstoneDim, this.shaft, this.flame, this.dust];
  }
}
