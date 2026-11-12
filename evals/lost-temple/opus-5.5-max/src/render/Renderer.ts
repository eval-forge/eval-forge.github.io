/**
 * WebGL renderer with a half-float MSAA scene target and one full-screen pass that does
 * exposure, ACES tone mapping, split-tone grading, contrast, saturation, vignette and grain.
 * Every operation in the final pass maps black to black, so unlit areas stay at exactly 0.
 */
import * as THREE from 'three';
import { QUALITY } from '../config';
import type { Quality } from '../logic/save';
import type { GradeParams } from '../logic/sun';

const POST_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const POST_FRAG = `
precision highp float;
uniform sampler2D tScene;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb * uExposure;
  c = aces(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(uShadowTint, uHighlightTint, smoothstep(0.05, 0.75, l));
  // contrast as an S-curve blend: 0 stays 0, 1 stays 1
  vec3 s = c * c * (3.0 - 2.0 * c);
  c = mix(c, s, clamp(uContrast - 1.0, 0.0, 1.0) * 2.0);
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, uSaturation), 0.0);
  vec2 d = vUv - 0.5;
  d.x *= uResolution.x / uResolution.y;
  c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(d));
  // grain scaled by luminance (no noise in black)
  float g = hash(vUv * uResolution + fract(uTime) * 100.0) - 0.5;
  c += g * uGrain * l;
  c = clamp(c, 0.0, 1.0);
  gl_FragColor = vec4(toSRGB(c), 1.0);
}
`;

export class Renderer {
  gl: THREE.WebGLRenderer;
  target: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  post: THREE.ShaderMaterial;
  quality: Quality;
  private width = 1;
  private height = 1;

  constructor(public canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.info.autoReset = false;
    const q = QUALITY[quality];
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: q.msaa, depthBuffer: true });
    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tScene: { value: this.target.texture },
        uExposure: { value: 1 },
        uContrast: { value: 1.05 },
        uSaturation: { value: 1 },
        uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
        uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
        uVignette: { value: 0.3 },
        uGrain: { value: 0.05 },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post);
    quad.frustumCulled = false;
    this.postScene.add(quad);
    this.resize();
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    const cfg = QUALITY[q];
    this.target.dispose();
    this.target = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType, samples: cfg.msaa, depthBuffer: true });
    this.post.uniforms.tScene.value = this.target.texture;
    this.resize();
  }

  resize() {
    const cfg = QUALITY[this.quality];
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const pr = Math.min(window.devicePixelRatio || 1, cfg.pixelRatio);
    this.gl.setPixelRatio(pr);
    this.gl.setSize(w, h, false);
    this.width = Math.floor(w * pr);
    this.height = Math.floor(h * pr);
    this.target.setSize(this.width, this.height);
    (this.post.uniforms.uResolution.value as THREE.Vector2).set(this.width, this.height);
  }

  setGrade(g: GradeParams, extra: { grain?: number; exposureMul?: number } = {}) {
    const u = this.post.uniforms;
    u.uExposure.value = g.exposure * (extra.exposureMul ?? 1);
    u.uContrast.value = g.contrast;
    u.uSaturation.value = g.saturation;
    (u.uShadowTint.value as THREE.Vector3).set(...g.shadowTint);
    (u.uHighlightTint.value as THREE.Vector3).set(...g.highlightTint);
    u.uVignette.value = g.vignette;
    u.uGrain.value = extra.grain ?? 0.05;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number) {
    this.gl.info.reset();
    this.post.uniforms.uTime.value = time;
    this.gl.setRenderTarget(this.target);
    this.gl.render(scene, camera);
    this.gl.setRenderTarget(null);
    this.gl.render(this.postScene, this.postCam);
  }

  /** Read back the canvas centre region as RGBA (for the zero-light check). */
  readPixels(): Uint8Array {
    const gl = this.gl.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }
}
