import * as THREE from 'three';
import { sunDirection, gradeKey } from '../logic/countdown';
import { clamp } from '../logic/vec';

interface Palette { sun: THREE.Color; sunI: number; sky: THREE.Color; ground: THREE.Color; hemiI: number; fog: THREE.Color; zenith: THREE.Color; horizon: THREE.Color; exposure: number }
const P = (sun: number, sunI: number, sky: number, ground: number, hemiI: number, fog: number, zenith: number, horizon: number, exposure: number): Palette => ({
  sun: new THREE.Color(sun), sunI, sky: new THREE.Color(sky), ground: new THREE.Color(ground), hemiI, fog: new THREE.Color(fog), zenith: new THREE.Color(zenith), horizon: new THREE.Color(horizon), exposure,
});
// dawn, noon, sunset, night
const PALETTES: Palette[] = [
  P(0xffa070, 1.6, 0xb89ab8, 0x5a4030, 0.75, 0xd8b0a0, 0x5a6aa0, 0xf0b090, 0.95),
  P(0xfff2dc, 3.2, 0xa8c8f0, 0x6a5838, 1.0, 0xb8cce0, 0x3a78d0, 0xc8dcf0, 1.0),
  P(0xff5a20, 1.8, 0xc07060, 0x4a2a1a, 0.6, 0xd06848, 0x3a3a70, 0xff8040, 0.95),
  P(0x000000, 0.0, 0x101828, 0x050505, 0.05, 0x04060a, 0x020308, 0x0a0e18, 0.85),
];

function blend(k: number): Palette {
  const i = Math.min(2, Math.floor(k));
  const t = clamp(k - i, 0, 1);
  const a = PALETTES[i], b = PALETTES[i + 1];
  return {
    sun: a.sun.clone().lerp(b.sun, t), sunI: a.sunI + (b.sunI - a.sunI) * t,
    sky: a.sky.clone().lerp(b.sky, t), ground: a.ground.clone().lerp(b.ground, t), hemiI: a.hemiI + (b.hemiI - a.hemiI) * t,
    fog: a.fog.clone().lerp(b.fog, t), zenith: a.zenith.clone().lerp(b.zenith, t), horizon: a.horizon.clone().lerp(b.horizon, t),
    exposure: a.exposure + (b.exposure - a.exposure) * t,
  };
}

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const skyFrag = /* glsl */ `
uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunColor; uniform float uNight; uniform float uTime;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
  col = mix(col, uHorizon * 0.35, clamp(-h * 5.0, 0.0, 1.0));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 900.0) * 18.0 + pow(s, 12.0) * 0.35 + pow(s, 3.0) * 0.12);
  // stars at night
  vec3 cell = floor(d * 220.0);
  float st = step(0.9975, hash(cell)) * uNight * smoothstep(0.0, 0.25, d.y);
  col += vec3(st) * (0.6 + 0.4 * sin(uTime * 3.0 + hash(cell) * 50.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Sun, sky, hemisphere and fog driven by the countdown clock.
 * `exposure` (0..1) scales all sky light for the zone the player is in:
 * zone C sets it to exactly 0 so the only light underground is fire.
 */
export class SkyLighting {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  fog: THREE.FogExp2;
  sunDir = new THREE.Vector3(0, 1, 0);
  palette: Palette = PALETTES[0];
  private skyMat: THREE.ShaderMaterial;
  /** 1 outside, partial in ruins, 0 underground. */
  outdoor = 1;
  /** Separate ambient factor for the roofed parts of zone B. */
  ambient = 1;
  dark = false;

  constructor(private scene: THREE.Scene, shadowSize: number) {
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const cam = this.sun.shadow.camera;
    cam.left = -45; cam.right = 45; cam.top = 45; cam.bottom = -45; cam.near = 1; cam.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    scene.add(this.hemi);

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false,
      uniforms: { uSunDir: { value: new THREE.Vector3() }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() }, uNight: { value: 0 }, uTime: { value: 0 } },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    this.fog = new THREE.FogExp2(0xffffff, 0.006);
    scene.fog = this.fog;
  }

  setShadowSize(s: number) {
    this.sun.shadow.mapSize.set(s, s);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as any).map = null;
  }

  update(remaining: number, focus: THREE.Vector3, camera: THREE.Camera, time: number, renderer: THREE.WebGLRenderer) {
    const d = sunDirection(remaining);
    this.sunDir.set(d.x, d.y, d.z);
    const pal = blend(gradeKey(remaining));
    this.palette = pal;
    const above = clamp(d.y * 8, 0, 1); // fade the sun out at the horizon
    const out = this.outdoor;

    // Sun: snap the shadow frustum to texels to avoid shimmering
    const sunI = pal.sunI * above * out;
    this.sun.intensity = sunI;
    this.sun.color.copy(pal.sun);
    this.sun.visible = true; // keep light count constant (no shader recompiles)
    const snap = 90 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.position.set(fx + d.x * 120, focus.y + d.y * 120, fz + d.z * 120);
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.target.updateMatrixWorld();

    this.hemi.color.copy(pal.sky);
    this.hemi.groundColor.copy(pal.ground);
    this.hemi.intensity = pal.hemiI * out * this.ambient;

    this.sky.position.copy(camera.position);
    this.sky.visible = out > 0.001;
    const u = this.skyMat.uniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uZenith.value.copy(pal.zenith);
    u.uHorizon.value.copy(pal.horizon);
    u.uSunColor.value.copy(pal.sun).multiplyScalar(above);
    u.uNight.value = clamp((gradeKeyNight(remaining)), 0, 1);
    u.uTime.value = time;

    // fog: outdoor palette fades to pure black underground
    this.fog.color.copy(pal.fog).multiplyScalar(out);
    this.fog.density = out > 0.5 ? 0.0055 : 0.02 + (1 - out) * 0.02;
    const bg = this.scene.background as THREE.Color | null;
    if (bg && (bg as any).isColor) bg.copy(this.fog.color);
    renderer.toneMappingExposure = pal.exposure;
    this.dark = out === 0;
  }
}

function gradeKeyNight(remaining: number) { return gradeKey(remaining) - 2; }
