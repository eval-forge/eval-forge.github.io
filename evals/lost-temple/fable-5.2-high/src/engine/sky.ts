import * as THREE from 'three';
import { DAY_LENGTH } from '../core/clock';
import { gradeAt, skyExposure, sunDirection, type Grade } from '../core/sun';
import type { Zone } from '../core/types';

const MOON_DIR = new THREE.Vector3(0.35, 0.8, 0.5).normalize();
// The grade is authored in friendly 0..3 numbers; these scale it to three's physical light units.
const SUN_GAIN = 1.5, AMBIENT_GAIN = 2.3;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 0.0);
  gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
  gl_Position.z = gl_Position.w;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight; uniform float uTime;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(vec3(i, 1.0)), b = hash(vec3(i + vec2(1, 0), 1.0)), c = hash(vec3(i + vec2(0, 1), 1.0)), d = hash(vec3(i + vec2(1, 1), 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(clamp(h * 1.25 + 0.04, 0.0, 1.0), 0.55));
  col = mix(col, uHorizon * 0.55, clamp(-h * 5.0, 0.0, 1.0));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  // Halo and disc.
  col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 60.0) * 0.5 + smoothstep(0.9993, 0.9997, sd) * 6.0) * (1.0 - uNight * 0.7);
  // Drifting cloud wisps.
  if (d.y > 0.02) {
    vec2 uv = d.xz / (d.y + 0.25) * 1.6 + vec2(uTime * 0.004, 0.0);
    float c = noise(uv * 1.3) * 0.6 + noise(uv * 3.1) * 0.3 + noise(uv * 7.0) * 0.1;
    float cl = smoothstep(0.52, 0.8, c) * smoothstep(0.02, 0.3, d.y);
    col = mix(col, mix(uHorizon, vec3(1.0), 0.55) * (1.0 - uNight * 0.85) + uSunColor * 0.12, cl * 0.55);
  }
  // Stars.
  if (uNight > 0.01 && d.y > 0.0) {
    vec3 g = floor(d * 190.0);
    float s = step(0.9965, hash(g));
    col += vec3(0.8, 0.85, 1.0) * s * uNight * (0.5 + 0.5 * sin(uTime * 2.0 + hash(g + 1.0) * 30.0)) * smoothstep(0.0, 0.25, d.y);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Sky dome, the single shadow-casting sun/moon light, hemisphere ambient and fog. Reads the
 * colour grade from core/sun every frame and scales sky light by how exposed the player is,
 * which is exactly zero in Zone C.
 */
export class Sky {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly dome: THREE.Mesh;
  readonly fog: THREE.FogExp2;
  grade: Grade = gradeAt(0);
  /** Smoothed exposure actually applied, for the debug overlay and tests. */
  ambientExposure = 1;
  sunExposure = 1;
  /** Final hemisphere intensity this frame. */
  ambientIntensity = 0;
  private uniforms: Record<string, THREE.IUniform>;
  private shadowRange = 46;
  private dir = new THREE.Vector3();
  private bg = new THREE.Color();

  constructor(private scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0x88aacc, 0.01);
    scene.fog = this.fog;
    this.uniforms = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() }, uNight: { value: 0 }, uTime: { value: 0 },
    };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false }));
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);
    this.setShadowQuality(2048, 46);
  }

  setShadowQuality(size: number, range: number): void {
    this.shadowRange = range;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as any;
    }
    const c = this.sun.shadow.camera;
    c.left = -range; c.right = range; c.top = range; c.bottom = -range; c.near = 1; c.far = 260;
    c.updateProjectionMatrix();
  }

  update(t: number, dt: number, camera: THREE.Camera, zone: Zone, playerY: number, renderer: THREE.WebGLRenderer): void {
    const g = (this.grade = gradeAt(t));
    const target = skyExposure(zone, playerY);
    // Ease between zones so walking through a doorway is not a light switch. Zone C snaps to zero.
    const k = Math.min(1, dt * 2.5);
    this.ambientExposure = zone === 'C' ? 0 : this.ambientExposure + (target.ambient - this.ambientExposure) * k;
    this.sunExposure = zone === 'C' ? 0 : this.sunExposure + (target.sun - this.sunExposure) * k;

    // Sun by day, moon by night, with a dip to nothing in between.
    const sd = sunDirection(t);
    const night = t >= DAY_LENGTH;
    let lightScale: number;
    if (!night) { this.dir.set(sd.x, sd.y, sd.z); lightScale = Math.min(1, Math.max(0, sd.y / 0.06)); }
    else { this.dir.copy(MOON_DIR); lightScale = Math.min(1, Math.max(0, (t - DAY_LENGTH - 2) / 8)); }
    this.sun.color.setRGB(g.sunColor[0], g.sunColor[1], g.sunColor[2]);
    this.sun.intensity = g.sunIntensity * SUN_GAIN * lightScale * this.sunExposure;

    // Shadow frustum follows the camera, snapped to texels so shadows do not crawl as you walk.
    const texel = (this.shadowRange * 2) / this.sun.shadow.mapSize.x;
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.dir).normalize();
    const up = new THREE.Vector3().crossVectors(this.dir, right).normalize();
    const cp = camera.position;
    const rx = Math.round(cp.dot(right) / texel) * texel, uy = Math.round(cp.dot(up) / texel) * texel, fz = cp.dot(this.dir);
    const centre = new THREE.Vector3().addScaledVector(right, rx).addScaledVector(up, uy).addScaledVector(this.dir, fz);
    this.sun.target.position.copy(centre);
    this.sun.position.copy(centre).addScaledVector(this.dir, 130);
    this.sun.target.updateMatrixWorld();
    this.sun.shadow.autoUpdate = this.sun.intensity > 0.001;

    this.hemi.color.setRGB(g.ambSky[0], g.ambSky[1], g.ambSky[2]);
    this.hemi.groundColor.setRGB(g.ambGround[0], g.ambGround[1], g.ambGround[2]);
    this.ambientIntensity = g.ambIntensity * AMBIENT_GAIN * this.ambientExposure;
    this.hemi.intensity = this.ambientIntensity;

    const underground = zone === 'C';
    this.dome.visible = !underground;
    if (underground) {
      this.bg.setRGB(0, 0, 0);
      this.fog.color.setRGB(0, 0, 0);
      this.fog.density = 0.012;
    } else {
      this.fog.color.setRGB(g.fog[0], g.fog[1], g.fog[2]).multiplyScalar(0.25 + 0.75 * this.ambientExposure);
      this.fog.density = g.fogDensity;
      this.bg.copy(this.fog.color);
      this.dome.position.copy(cp);
      this.dome.scale.setScalar(900);
      (this.uniforms.uTop.value as THREE.Color).setRGB(g.skyTop[0], g.skyTop[1], g.skyTop[2]);
      (this.uniforms.uHorizon.value as THREE.Color).setRGB(g.skyHorizon[0], g.skyHorizon[1], g.skyHorizon[2]);
      (this.uniforms.uSunDir.value as THREE.Vector3).set(sd.x, sd.y, sd.z);
      (this.uniforms.uSunColor.value as THREE.Color).setRGB(g.sunColor[0], g.sunColor[1], g.sunColor[2]);
      this.uniforms.uNight.value = Math.min(1, Math.max(0, (t - DAY_LENGTH * 0.985) / (DAY_LENGTH * 0.05)));
      this.uniforms.uTime.value = t;
    }
    this.scene.background = this.bg;
    renderer.toneMappingExposure = underground ? 1.0 : g.exposure;
  }
}
