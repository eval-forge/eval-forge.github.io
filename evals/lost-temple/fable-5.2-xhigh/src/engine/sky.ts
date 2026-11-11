/** Sky dome: gradient, sun and moon discs, stars, drifting clouds. Always centred on the camera. */
import * as THREE from 'three';
import type { Celestial, SkyLook } from '../core/sun';
import { sunDirection } from '../core/sun';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = viewMatrix * vec4(position, 0.0);
  gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
  gl_Position.z = gl_Position.w;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform float uSunVis;
uniform float uMoonVis;
uniform float uStars;
uniform float uTime;
uniform float uVis;
varying vec3 vDir;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec2(13.1, 7.7);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = pow(smoothstep(-0.04, 0.8, h), 0.55);
  vec3 col = mix(uHorizon, uTop, t);
  col = mix(col, uHorizon * 0.5, smoothstep(0.0, -0.3, h));

  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * uSunVis * (smoothstep(0.99925, 0.9997, sd) * 26.0 + pow(sd, 220.0) * 1.1 + pow(sd, 9.0) * 0.2);
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.72, 0.8, 1.0) * uMoonVis * (smoothstep(0.9989, 0.9993, md) * 1.5 + pow(md, 260.0) * 0.22);

  if (uStars > 0.002 && h > 0.0) {
    vec3 g = floor(d * 150.0);
    float s = hash3(g);
    float tw = 0.7 + 0.3 * sin(uTime * 2.1 + s * 60.0);
    col += vec3(step(0.9972, s)) * uStars * tw * smoothstep(0.0, 0.25, h) * 0.9;
  }

  vec2 cuv = d.xz / max(d.y + 0.2, 0.06) * 0.55 + vec2(uTime * 0.0045, uTime * 0.0017);
  float c = fbm(cuv * 1.7);
  float cover = smoothstep(0.5, 0.8, c) * smoothstep(0.02, 0.3, h);
  vec3 cloud = mix(uHorizon, uTop, 0.25) * 0.55 + uSunColor * uSunVis * (0.28 + 0.5 * pow(sd, 6.0)) + vec3(0.05, 0.06, 0.09) * uMoonVis;
  col = mix(col, cloud, cover * 0.8);

  gl_FragColor = vec4(col * uVis, 1.0);
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly u: Record<string, THREE.IUniform>;

  constructor() {
    this.u = {
      uTop: { value: new THREE.Vector3(0.2, 0.4, 0.8) },
      uHorizon: { value: new THREE.Vector3(0.7, 0.8, 0.9) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Vector3(1, 1, 1) },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunVis: { value: 1 },
      uMoonVis: { value: 0 },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uVis: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.u,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 18), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  /**
   * @param f day fraction (may exceed 1 at night)
   * @param outdoor 0..1: how much of the outside world is visible at all (0 deep in Zone C)
   */
  update(look: SkyLook, cel: Celestial, f: number, time: number, outdoor: number): void {
    const u = this.u;
    (u.uTop.value as THREE.Vector3).set(look.skyTop.r, look.skyTop.g, look.skyTop.b);
    (u.uHorizon.value as THREE.Vector3).set(look.skyHorizon.r, look.skyHorizon.g, look.skyHorizon.b);
    const sd = sunDirection(Math.min(f, 1));
    (u.uSunDir.value as THREE.Vector3).set(sd.x, sd.y, sd.z).normalize();
    (u.uSunColor.value as THREE.Vector3).set(look.sunColor.r, look.sunColor.g, look.sunColor.b);
    u.uSunVis.value = cel.isMoon ? 0 : Math.min(1, look.sunIntensity + 0.35);
    u.uMoonVis.value = cel.isMoon ? 1 : 0;
    if (cel.isMoon) (u.uMoonDir.value as THREE.Vector3).set(cel.dir.x, cel.dir.y, cel.dir.z);
    u.uStars.value = look.stars;
    u.uTime.value = time;
    u.uVis.value = outdoor;
    this.mesh.visible = outdoor > 0.001;
  }
}
