/**
 * Every light in the game. The set is fixed (1 sun/moon, 1 hemisphere, 1 torch,
 * 3 sconce lights) so shaders compile once and never again during a run.
 */
import * as THREE from 'three';
import type { Vec3Like } from '../core/scenes';
import type { Celestial, SkyLook } from '../core/sun';
import type { QualityPreset } from './renderer';

export const SCONCE_LIGHTS = 3;
const SUN_HALF = 46;
const SUN_DIST = 130;

export interface SconceLight {
  pos: Vec3Like;
  radius: number;
  /** 0..1 flicker-scaled brightness. */
  level: number;
}

export class Lighting {
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly torch = new THREE.PointLight(0xffd2a0, 0, 13, 1.2);
  readonly sconces: THREE.PointLight[] = [];
  readonly fog = new THREE.FogExp2(0xffffff, 0.006);
  /** Unit vector toward the sun or moon. */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private torchShadowWanted = true;
  private torchShadowOn = false;

  constructor(private readonly scene: THREE.Scene) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -SUN_HALF;
    cam.right = SUN_HALF;
    cam.top = SUN_HALF;
    cam.bottom = -SUN_HALF;
    cam.near = 1;
    cam.far = SUN_DIST * 2;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.torch.castShadow = true;
    this.torch.shadow.mapSize.set(512, 512);
    this.torch.shadow.camera.near = 0.12;
    this.torch.shadow.camera.far = 24;
    this.torch.shadow.bias = -0.004;
    this.torch.shadow.normalBias = 0.03;
    scene.add(this.torch);

    for (let i = 0; i < SCONCE_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffbc80, 0, 9, 1.5);
      l.castShadow = false;
      scene.add(l);
      this.sconces.push(l);
    }
    scene.fog = this.fog;
  }

  applyQuality(q: QualityPreset): void {
    if (this.sun.shadow.mapSize.x !== q.sunShadow) {
      this.sun.shadow.mapSize.set(q.sunShadow, q.sunShadow);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (this.torch.shadow.mapSize.x !== q.torchShadow) {
      this.torch.shadow.mapSize.set(q.torchShadow, q.torchShadow);
      this.torch.shadow.map?.dispose();
      this.torch.shadow.map = null;
    }
  }

  /**
   * Sun / moon / sky light for this frame.
   * @param outdoor 0..1 scale on everything that comes from the sky (0 deep underground).
   */
  updateSky(look: SkyLook, cel: Celestial, focus: Vec3Like, outdoor: number): void {
    this.lightDir.set(cel.dir.x, cel.dir.y, cel.dir.z).normalize();
    this.sun.color.setRGB(look.sunColor.r, look.sunColor.g, look.sunColor.b);
    this.sun.intensity = look.sunIntensity * outdoor;
    this.hemi.color.setRGB(look.hemiSky.r, look.hemiSky.g, look.hemiSky.b);
    this.hemi.groundColor.setRGB(look.hemiGround.r, look.hemiGround.g, look.hemiGround.b);
    this.hemi.intensity = look.hemiIntensity * outdoor;
    this.fog.color.setRGB(look.fog.r * outdoor, look.fog.g * outdoor, look.fog.b * outdoor);
    this.fog.density = look.fogDensity * outdoor;

    // Snap the shadow frustum to texel steps in light space so shadow edges do not swim.
    const d = this.lightDir;
    this.right.set(0, 1, 0).cross(d);
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    this.up.copy(d).cross(this.right).normalize();
    const texel = (SUN_HALF * 2) / this.sun.shadow.mapSize.x;
    const f = this.tmp.set(focus.x, focus.y, focus.z);
    const rx = Math.round(f.dot(this.right) / texel) * texel;
    const ry = Math.round(f.dot(this.up) / texel) * texel;
    const rz = f.dot(d);
    f.set(0, 0, 0).addScaledVector(this.right, rx).addScaledVector(this.up, ry).addScaledVector(d, rz);
    this.sun.target.position.copy(f);
    this.sun.position.copy(f).addScaledVector(d, SUN_DIST);
    this.sun.target.updateMatrixWorld();
    // One shadow-casting light at a time after dark: where the torch is throwing shadows, the
    // faint moon does not also get a shadow pass.
    const active = outdoor > 0.001 && this.sun.intensity > 0.001 && !(cel.isMoon && this.torchShadowOn);
    this.sun.shadow.intensity = active ? 1 : 0;
    this.sun.shadow.autoUpdate = active;
    if (active) this.sun.shadow.needsUpdate = true;
  }

  /**
   * The hand torch.
   * @param shadows false under open sky, where the sun or moon casts the shadows instead
   */
  setTorch(pos: Vec3Like, radius: number, intensity: number, shadows: boolean): void {
    this.torch.position.set(pos.x, pos.y, pos.z);
    this.torch.distance = Math.max(0.5, radius);
    this.torch.intensity = radius > 0 ? intensity : 0;
    const on = this.torch.intensity > 0 && shadows && this.torchShadowWanted;
    this.torchShadowOn = on;
    this.torch.shadow.intensity = on ? 1 : 0;
    this.torch.shadow.autoUpdate = on;
    if (on) this.torch.shadow.needsUpdate = true;
  }

  setTorchShadows(on: boolean): void {
    this.torchShadowWanted = on;
  }

  /** Assign the pool to the given (already nearest-first) sconces. */
  setSconces(list: readonly SconceLight[]): void {
    for (let i = 0; i < this.sconces.length; i++) {
      const l = this.sconces[i];
      const s = list[i];
      if (s) {
        l.position.set(s.pos.x, s.pos.y, s.pos.z);
        l.distance = s.radius;
        l.intensity = 9 * s.level;
      } else {
        l.intensity = 0;
      }
    }
  }

  /** Everything off (used by the darkness probe and by menus). */
  blackout(): void {
    this.torch.intensity = 0;
    for (const l of this.sconces) l.intensity = 0;
  }
}
