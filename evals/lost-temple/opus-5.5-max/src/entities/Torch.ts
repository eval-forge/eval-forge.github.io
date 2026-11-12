/**
 * The player's torch: a view model in the right hand, a flickering flame, the point light that
 * follows it (the only light in zone C besides sconces you light), the crackle loop, and the
 * assignment of the small sconce light pool to the nearest lit sconces.
 */
import * as THREE from 'three';
import type { Materials } from '../render/materials';
import type { Lighting } from '../render/Lighting';
import { SCONCE_POOL } from '../render/Lighting';
import type { Sfx, LoopHandle } from '../audio/Sfx';
import type { Particles } from '../render/particles';
import type { TorchState } from '../logic/torch';
import { torchIntensity } from '../logic/torch';
import { cylMesh } from '../world/props/util';

export const TORCH_LIGHT = 16;
export const SCONCE_LIGHT = 11;

export interface LitSconce {
  pos: THREE.Vector3;
  radius: number;
}

export class Torch {
  view = new THREE.Group();
  private head = new THREE.Object3D();
  private flames: THREE.Sprite[] = [];
  private headMesh: THREE.Mesh;
  private crackle: LoopHandle | null = null;
  private t = 0;
  private relightSpark = 0;
  /** World position of the flame this frame. */
  flamePos = new THREE.Vector3();
  flicker = 1;
  private lower = 0;

  /**
   * The hand-held torch is drawn unlit (basic materials scaled by the flame and the daylight):
   * the flame sits a hand's width from the wrap, and a real point light that close burns the
   * handle to white. In zone C the scale is the flame alone, so a dead torch is black too.
   */
  private viewMats: { mat: THREE.MeshBasicMaterial; base: THREE.Color }[] = [];

  constructor(private mats: Materials, private lighting: Lighting, camera: THREE.Camera, private sfx: Sfx, private fx: Particles) {
    const parts: [THREE.Mesh, number, THREE.Texture][] = [
      [cylMesh(mats, 'darkWood', 0.022, 0.03, 0.62, 8), 0x8a7458, mats.tex.wood.map],
      [cylMesh(mats, 'burlap', 0.05, 0.042, 0.16, 10, 0x5a4a3a), 0x9a8468, mats.tex.burlap.map],
      [cylMesh(mats, 'burlap', 0.046, 0.05, 0.07, 10, 0x2a1e16), 0x4a3a2c, mats.tex.burlap.map],
    ];
    const ys = [-0.18, 0.15, 0.25];
    parts.forEach(([m, hex, map], i) => {
      // bake a soft key light into the vertex colours so the unlit handle still reads as round
      const g = m.geometry as THREE.BufferGeometry;
      const nrm = g.getAttribute('normal');
      const cols = g.getAttribute('color') as THREE.BufferAttribute | undefined;
      const key = new THREE.Vector3(-0.6, 0.5, 0.6).normalize();
      if (cols) {
        for (let v = 0; v < nrm.count; v++) {
          const d = nrm.getX(v) * key.x + nrm.getY(v) * key.y + nrm.getZ(v) * key.z;
          const k = 0.45 + 0.55 * Math.max(0, d);
          cols.setXYZ(v, cols.getX(v) * k, cols.getY(v) * k, cols.getZ(v) * k);
        }
        cols.needsUpdate = true;
      }
      const base = new THREE.Color(hex);
      const mat = new THREE.MeshBasicMaterial({ map, color: base.clone(), vertexColors: !!cols, fog: false });
      this.viewMats.push({ mat, base });
      m.material = mat;
      m.position.y = ys[i];
      m.castShadow = false;
      m.receiveShadow = false;
      this.view.add(m);
    });
    this.headMesh = parts[2][0];
    this.head.position.set(0, 0.3, 0);
    this.view.add(this.head);
    for (let i = 0; i < 2; i++) {
      const s = new THREE.Sprite(mats.flame);
      s.scale.set(0.16, 0.26, 1);
      s.position.set(0, 0.36 + i * 0.03, 0);
      s.renderOrder = 10;
      this.flames.push(s);
      this.view.add(s);
    }
    this.view.position.set(0.3, -0.34, -0.55);
    this.view.rotation.set(0.25, 0, -0.18);
    camera.add(this.view);
  }

  /** Per-frame: flame look, light, crackle, sparks while relighting. */
  update(dt: number, st: TorchState, active: boolean, ambient = 0) {
    this.t += dt;
    const lit = st.lit && active;
    const relight = st.isRelighting && active;
    // the arm drops while you strike the flint, and when the torch is gone
    const lowerTarget = relight ? 0.18 : 0;
    this.lower += (lowerTarget - this.lower) * Math.min(1, dt * 8);
    this.view.position.y = -0.34 - this.lower;
    this.view.rotation.x = 0.25 + this.lower * 1.5 + (relight ? Math.sin(this.t * 22) * 0.05 : 0);
    this.view.visible = active;
    const f = 0.86 + Math.sin(this.t * 11.3) * 0.06 + Math.sin(this.t * 23.7 + 1.3) * 0.04 + (Math.random() - 0.5) * 0.06;
    this.flicker = f;
    const inten = lit ? torchIntensity(st.fuel, st.stats) : 0;
    for (let i = 0; i < this.flames.length; i++) {
      const s = this.flames[i];
      s.visible = lit;
      const k = (0.55 + 0.45 * inten) * (i === 0 ? 1 : 0.7);
      s.scale.set(0.15 * k * f, 0.27 * k * (2 - f), 1);
    }
    // the handle: daylight (none in zone C) plus the flame's own glow
    const glow = ambient + (lit ? (0.3 + 0.6 * inten) * f : 0) + (relight && this.relightSpark > 0.2 ? 0.25 : 0);
    for (const v of this.viewMats) v.mat.color.copy(v.base).multiplyScalar(Math.min(1.3, glow));
    this.head.getWorldPosition(this.flamePos);
    const L = this.lighting.torch;
    if (lit) {
      L.intensity = TORCH_LIGHT * inten * f;
      L.distance = Math.max(2, st.radius * 1.25);
      L.position.copy(this.flamePos);
      L.shadow.autoUpdate = true;
      if (Math.random() < dt * 5) this.fx.embers(this.flamePos.clone().add(new THREE.Vector3(0, 0.08, 0)), 1, undefined, true);
    } else {
      L.intensity = 0;
      // keep castShadow on (toggling it recompiles every shader); just stop re-rendering the cube map
      L.shadow.autoUpdate = false;
    }
    if (relight) {
      this.relightSpark -= dt;
      if (this.relightSpark <= 0) {
        this.relightSpark = 0.28 + Math.random() * 0.2;
        this.fx.sparks(this.flamePos, 6, true);
        this.sfx.play('click', this.flamePos, 0.35, 1.6 + Math.random() * 0.4);
      }
    }
    // crackle
    if (lit && !this.crackle) this.crackle = this.sfx.loop('torch', this.flamePos, 0.5);
    if (!lit && this.crackle) {
      this.crackle.stop();
      this.crackle = null;
    }
    if (this.crackle) {
      this.crackle.setPos(this.flamePos);
      this.crackle.setGain(0.25 + inten * 0.35);
    }
  }

  /** Give the light pool to the nearest lit sconces (within reach of the camera). */
  assignSconces(lit: LitSconce[], cam: THREE.Vector3) {
    const pool = this.lighting.pool;
    const sorted = lit.filter((s) => s.radius > 0 && s.pos.distanceTo(cam) < 34).sort((a, b) => a.pos.distanceToSquared(cam) - b.pos.distanceToSquared(cam));
    for (let i = 0; i < SCONCE_POOL; i++) {
      const l = pool[i];
      const s = sorted[i];
      if (!s) {
        l.intensity = 0;
        l.position.set(0, -1000, 0);
        continue;
      }
      const fl = 0.88 + Math.sin(this.t * 9.1 + i * 2.3) * 0.07 + Math.sin(this.t * 17.3 + i) * 0.05;
      l.position.set(s.pos.x, s.pos.y + 0.55, s.pos.z);
      l.distance = s.radius * 1.3;
      l.intensity = SCONCE_LIGHT * (s.radius / 7) * fl;
    }
  }

  dispose() {
    this.crackle?.stop();
    this.crackle = null;
    this.view.removeFromParent();
    this.lighting.torch.intensity = 0;
    for (const l of this.lighting.pool) l.intensity = 0;
  }
}
