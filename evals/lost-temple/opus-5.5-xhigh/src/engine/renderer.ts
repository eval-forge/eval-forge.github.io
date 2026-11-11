/**
 * Renderer, quality presets and the post chain: scene → colour grade → output
 * (ACES tone mapping + sRGB). The grade is purely multiplicative so black stays black.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality } from '../logic/meta';

export interface QualityPreset {
  pixelRatio: number;
  sunShadow: number;
  torchShadow: number;
  msaa: number;
  vegetation: number;
  shadowType: THREE.ShadowMapType;
}

export function preset(q: Quality): QualityPreset {
  const dpr = window.devicePixelRatio || 1;
  switch (q) {
    case 'low':
      return { pixelRatio: Math.min(dpr, 1) * 0.75, sunShadow: 1024, torchShadow: 256, msaa: 0, vegetation: 0.45, shadowType: THREE.PCFShadowMap };
    case 'high':
      return { pixelRatio: Math.min(dpr, 1.5), sunShadow: 2048, torchShadow: 1024, msaa: 4, vegetation: 1, shadowType: THREE.PCFShadowMap };
    default:
      return { pixelRatio: Math.min(dpr, 1), sunShadow: 2048, torchShadow: 512, msaa: 2, vegetation: 0.75, shadowType: THREE.PCFShadowMap };
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uExposure: { value: 1 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uVignette: { value: 0.35 },
    uWater: { value: 0 },
    uHurt: { value: 0 },
    uFade: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uExposure;
    uniform vec3 uTint;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uWater;
    uniform float uHurt;
    uniform float uFade;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = max(tex.rgb, 0.0) * uExposure * uTint;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(mix(vec3(l), c, uSaturation), 0.0);
      // contrast around 18% grey in a multiplicative form: 0 stays 0
      c = pow(c / 0.18, vec3(uContrast)) * 0.18;
      // underwater: multiplicative teal + blur-free darkening
      c *= mix(vec3(1.0), vec3(0.35, 0.7, 0.75), uWater);
      // damage: drain non-red channels at the edges
      vec2 d = vUv - 0.5;
      float r = dot(d, d);
      float vig = 1.0 - uVignette * smoothstep(0.08, 0.55, r);
      c *= vig;
      c *= mix(vec3(1.0), vec3(1.0, 0.35, 0.3), uHurt * smoothstep(0.02, 0.4, r));
      c *= uFade;
      gl_FragColor = vec4(c, tex.a);
    }`,
};

export class Renderer {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  grade: ShaderPass;
  private renderPass: RenderPass;
  q: QualityPreset;

  constructor(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: Quality) {
    this.q = preset(quality);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(this.q.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.q.shadowType;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false; // count every pass of the composer, reset per frame

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.q.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.q.pixelRatio);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(quality: Quality) {
    this.q = preset(quality);
    this.renderer.setPixelRatio(this.q.pixelRatio);
    this.composer.setPixelRatio(this.q.pixelRatio);
    this.renderer.shadowMap.type = this.q.shadowType;
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const cam = this.renderPass.camera as THREE.PerspectiveCamera;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }

  render() {
    this.renderer.info.reset();
    this.composer.render();
  }

  get info() {
    return this.renderer.info;
  }
}
