/**
 * WebGL renderer plus one post pass. The scene is drawn into an HDR target,
 * then a single full-screen shader applies the time-of-day grade, tone maps
 * and converts to sRGB.
 */
import * as THREE from 'three';
import type { Quality } from '../core/save';

export interface GradeParams {
  tint: { r: number; g: number; b: number };
  saturation: number;
  contrast: number;
  exposure: number;
  lift: number;
  vignette: number;
  /** 0..1 blue-green wash while the camera is under water. */
  underwater: number;
  /** 1 = normal, 0 = black (fades). */
  fade: number;
}

export const NEUTRAL_GRADE: GradeParams = {
  tint: { r: 1, g: 1, b: 1 },
  saturation: 1,
  contrast: 1,
  exposure: 1,
  lift: 0,
  vignette: 0.35,
  underwater: 0,
  fade: 1,
};

export interface QualityPreset {
  pixelRatio: number;
  sunShadow: number;
  torchShadow: number;
  softShadows: boolean;
  msaa: number;
  vegetation: number;
  shafts: boolean;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 0.8, sunShadow: 1024, torchShadow: 256, softShadows: false, msaa: 0, vegetation: 0.45, shafts: false },
  medium: { pixelRatio: 1, sunShadow: 2048, torchShadow: 512, softShadows: false, msaa: 2, vegetation: 0.75, shafts: true },
  high: { pixelRatio: 1.5, sunShadow: 2048, torchShadow: 512, softShadows: true, msaa: 4, vegetation: 1, shafts: true },
};

const GRADE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const GRADE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec3 uTint;
uniform float uSaturation;
uniform float uContrast;
uniform float uExposure;
uniform float uLift;
uniform float uVignette;
uniform float uUnderwater;
uniform float uFade;
uniform float uTime;
varying vec2 vUv;

// Narkowicz ACES fit.
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  vec2 uv = vUv;
  if (uUnderwater > 0.0) {
    uv += uUnderwater * 0.006 * vec2(sin(uv.y * 38.0 + uTime * 2.3), cos(uv.x * 31.0 + uTime * 1.9));
  }
  vec3 c = texture2D(tScene, uv).rgb * uExposure;
  c *= uTint;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = aces(c);
  // Contrast pivots on mid grey; black stays black for contrast >= 1.
  c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
  c += uLift * (1.0 - c);
  vec2 q = vUv - 0.5;
  float r2 = dot(q, q);
  c *= 1.0 - uVignette * smoothstep(0.1, 0.62, r2);
  // Purely multiplicative: black stays black under water too.
  c = mix(c, c * vec3(0.3, 0.72, 0.85), uUnderwater);
  c *= uFade;
  gl_FragColor = vec4(toSRGB(c), 1.0);
}
`;

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  quality: QualityPreset = QUALITY.high;
  qualityName: Quality = 'high';
  private target: THREE.WebGLRenderTarget;
  private readonly post = new THREE.Scene();
  private readonly postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly grade: THREE.ShaderMaterial;
  /** Stats of the last frame (scene + shadow passes). */
  stats = { calls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0 };

  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace; // the grade pass does the sRGB encode
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.info.autoReset = false;
    this.gl.setClearColor(0x000000, 1);
    this.camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.08, 900);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.target = this.makeTarget(2, 2);
    this.grade = new THREE.ShaderMaterial({
      vertexShader: GRADE_VERT,
      fragmentShader: GRADE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uSaturation: { value: 1 },
        uContrast: { value: 1 },
        uExposure: { value: 1 },
        uLift: { value: 0 },
        uVignette: { value: 0.35 },
        uUnderwater: { value: 0 },
        uFade: { value: 1 },
        uTime: { value: 0 },
      },
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    tri.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    const quad = new THREE.Mesh(tri, this.grade);
    quad.frustumCulled = false;
    this.post.add(quad);
    this.resize();
  }

  private makeTarget(w: number, h: number): THREE.WebGLRenderTarget {
    const t = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true,
      samples: this.quality.msaa,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    return t;
  }

  setQuality(name: Quality): void {
    this.qualityName = name;
    this.quality = QUALITY[name];
    this.gl.shadowMap.type = this.quality.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.gl.shadowMap.needsUpdate = true;
    this.resize(true);
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  resize(force = false): void {
    const w = Math.max(2, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(2, this.canvas.clientHeight || window.innerHeight);
    // The preset caps the device pixel ratio rather than multiplying it: a 2x laptop
    // panel at "medium" renders CSS pixels, not four times as many.
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    const pw = Math.max(2, Math.floor(w * pr));
    const ph = Math.max(2, Math.floor(h * pr));
    this.gl.setPixelRatio(1);
    this.gl.setSize(pw, ph, false);
    if (force || this.target.width !== pw || this.target.height !== ph || this.target.samples !== this.quality.msaa) {
      this.target.dispose();
      this.target = this.makeTarget(pw, ph);
      this.grade.uniforms.tScene.value = this.target.texture;
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(g: GradeParams, time: number): void {
    const gl = this.gl;
    gl.info.reset();
    gl.setRenderTarget(this.target);
    gl.clear();
    gl.render(this.scene, this.camera);
    this.stats.calls = gl.info.render.calls;
    this.stats.triangles = gl.info.render.triangles;
    this.stats.programs = gl.info.programs?.length ?? 0;
    this.stats.geometries = gl.info.memory.geometries;
    this.stats.textures = gl.info.memory.textures;
    const u = this.grade.uniforms;
    (u.uTint.value as THREE.Vector3).set(g.tint.r, g.tint.g, g.tint.b);
    u.uSaturation.value = g.saturation;
    u.uContrast.value = g.contrast;
    u.uExposure.value = g.exposure;
    u.uLift.value = g.lift;
    u.uVignette.value = g.vignette;
    u.uUnderwater.value = g.underwater;
    u.uFade.value = g.fade;
    u.uTime.value = time;
    gl.setRenderTarget(null);
    gl.render(this.post, this.postCam);
  }

  /**
   * Read back the final frame and report how bright it is. Used by the
   * darkness probe: in Zone C with the torch out this must be all zeros.
   */
  measureFrame(): { max: number; mean: number; lit: number; pixels: number } {
    const gl = this.gl.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let max = 0;
    let sum = 0;
    let lit = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const v = Math.max(buf[i], buf[i + 1], buf[i + 2]);
      if (v > max) max = v;
      if (v > 0) lit++;
      sum += v;
    }
    return { max, mean: sum / (w * h), lit, pixels: w * h };
  }
}
