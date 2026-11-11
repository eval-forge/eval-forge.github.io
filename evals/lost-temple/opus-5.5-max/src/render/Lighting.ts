/**
 * The fixed light rig: one shadow-casting directional light (sun, or moon at night), one
 * hemisphere fill for outdoor zones, the player's torch (point light with cube shadows) and a
 * small pool of point lights for placed sconce torches. The set never changes size, so shader
 * programs never recompile during a run.
 */
import * as THREE from 'three';
import { QUALITY } from '../config';
import type { Quality } from '../logic/save';

export const SCONCE_POOL = 3;

export class Lighting {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  torch: THREE.PointLight;
  pool: THREE.PointLight[] = [];
  private range = 40;
  private mapSize = 2048;
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();

  constructor(scene: THREE.Scene, quality: Quality) {
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x40382a, 0.6);
    scene.add(this.hemi);

    this.torch = new THREE.PointLight(0xffa860, 0, 11, 1.6);
    this.torch.castShadow = true;
    this.torch.shadow.bias = -0.004;
    this.torch.shadow.normalBias = 0.02;
    this.torch.shadow.camera.near = 0.08;
    this.torch.shadow.camera.far = 14;
    scene.add(this.torch);

    for (let i = 0; i < SCONCE_POOL; i++) {
      const l = new THREE.PointLight(0xff9a50, 0, 7, 1.6);
      l.castShadow = false;
      l.position.set(0, -1000, 0);
      scene.add(l);
      this.pool.push(l);
    }
    this.setQuality(quality);
  }

  setQuality(q: Quality) {
    const cfg = QUALITY[q];
    this.range = cfg.shadowRange;
    this.mapSize = cfg.shadowMap;
    this.sun.shadow.mapSize.set(cfg.shadowMap, cfg.shadowMap);
    this.torch.shadow.mapSize.set(cfg.torchShadow, cfg.torchShadow);
    const cam = this.sun.shadow.camera;
    cam.left = -this.range;
    cam.right = this.range;
    cam.top = this.range;
    cam.bottom = -this.range;
    cam.updateProjectionMatrix();
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as any;
    this.torch.shadow.map?.dispose();
    this.torch.shadow.map = null as any;
  }

  /** Aim the shadow-casting directional light from `dir` at `focus`, texel-snapped. */
  aimSun(dir: THREE.Vector3, focus: THREE.Vector3) {
    const d = dir.clone().normalize();
    this.right.set(0, 1, 0).cross(d);
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    this.up.copy(d).cross(this.right).normalize();
    const texel = (this.range * 2) / this.mapSize;
    const a = Math.round(focus.dot(this.right) / texel) * texel;
    const b = Math.round(focus.dot(this.up) / texel) * texel;
    const c = focus.dot(d);
    const t = new THREE.Vector3().addScaledVector(this.right, a).addScaledVector(this.up, b).addScaledVector(d, c);
    this.sun.target.position.copy(t);
    this.sun.position.copy(t).addScaledVector(d, 120);
    this.sun.target.updateMatrixWorld();
  }

  setSunEnabled(on: boolean) {
    this.sun.shadow.autoUpdate = on;
    if (!on) this.sun.intensity = 0;
  }
}
