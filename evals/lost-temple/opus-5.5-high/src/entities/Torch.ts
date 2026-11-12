import * as THREE from 'three';
import { flicker } from '../logic/torch';
import type { Materials } from '../world/Materials';
import type { TextureBank } from '../world/Textures';

function flameSprite(tex: THREE.Texture, scale: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  s.scale.set(scale * 0.6, scale, 1);
  return s;
}

/** The player's torch: a view-model stick + flame, and a shadow-casting point light. */
export class PlayerTorch {
  light: THREE.PointLight;
  view: THREE.Group;
  private flame: THREE.Sprite;
  private flame2: THREE.Sprite;
  private stick: THREE.Mesh;
  private embers: THREE.Points;
  private emberData: { p: THREE.Vector3; v: THREE.Vector3; life: number }[] = [];
  radius = 8;
  litAmount = 1;
  relightProgress = 0;

  constructor(scene: THREE.Scene, camera: THREE.Camera, mats: Materials, tex: TextureBank, shadowSize: number) {
    this.light = new THREE.PointLight(0xff9a48, 0, 8, 2);
    this.light.castShadow = shadowSize > 0;
    this.light.shadow.mapSize.set(Math.max(shadowSize, 64), Math.max(shadowSize, 64));
    this.light.shadow.camera.near = 0.15;
    this.light.shadow.bias = -0.002;
    this.light.shadow.normalBias = 0.03;
    scene.add(this.light);

    this.view = new THREE.Group();
    const stickMat = new THREE.MeshBasicMaterial({ color: 0x2a1c10, map: mats.get('bark').map, fog: false }); // unlit: the flame sits right on it
    this.stick = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.022, 0.62, 8), stickMat);
    this.stick.rotation.x = -0.35;
    this.stick.position.set(0, -0.12, 0);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.1, 8), new THREE.MeshBasicMaterial({ color: 0x4a2a14, fog: false }));
    wrap.position.set(0, 0.17, 0.06);
    wrap.rotation.x = -0.35;
    this.view.add(this.stick, wrap);
    this.flame = flameSprite(tex.flame, 0.32);
    this.flame.position.set(0, 0.26, 0.08);
    this.flame2 = flameSprite(tex.flame, 0.2);
    this.flame2.position.set(0.01, 0.24, 0.08);
    this.view.add(this.flame, this.flame2);
    // embers
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    this.embers = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffa040, size: 0.005, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.embers.frustumCulled = false;
    this.view.add(this.embers);
    for (let i = 0; i < 24; i++) this.emberData.push({ p: new THREE.Vector3(0, 0.3, 0.1), v: new THREE.Vector3(), life: Math.random() });
    this.view.position.set(0.36, -0.4, -0.62);
    this.view.traverse((o) => { o.castShadow = false; o.renderOrder = 10; });
    camera.add(this.view);
  }

  setShadowSize(s: number) {
    this.light.castShadow = s > 0;
    if (s > 0) {
      this.light.shadow.mapSize.set(s, s);
      this.light.shadow.map?.dispose();
      (this.light.shadow as any).map = null;
    }
  }

  /**
   * lit: torch burning. radius: current radius from fuel curve. relight: 0..1 animation progress (or -1).
   */
  update(dt: number, time: number, camera: THREE.Camera, lit: boolean, radius: number, relight: number, sway: number, visible = true) {
    this.radius = radius;
    this.litAmount += ((lit ? 1 : 0) - this.litAmount) * Math.min(1, dt * (lit ? 4 : 20));
    const f = flicker(time);
    const r = Math.max(0.01, radius * f);
    this.light.distance = r;
    this.light.intensity = lit ? 22 * Math.pow(Math.max(radius, 1) / 8, 1.6) * f * this.litAmount : 0;
    // light sits at the torch head in world space
    const head = new THREE.Vector3(0.36, -0.1, -0.55);
    head.applyMatrix4(camera.matrixWorld);
    this.light.position.copy(head);
    this.light.shadow.camera.far = Math.max(1, r);

    this.view.visible = visible;
    const s = 0.75 + 0.25 * f;
    this.flame.visible = this.flame2.visible = lit;
    this.flame.scale.set(0.085 * s * (radius / 8 * 0.4 + 0.6), 0.15 * s * (radius / 8 * 0.4 + 0.6), 1);
    this.flame2.scale.set(0.05 * s, 0.09 * (2 - s), 1);
    this.flame.material.rotation = Math.sin(time * 7) * 0.08;
    // relight animation: bring the torch up to the face and strike
    const bob = Math.sin(time * 1.7) * 0.01 + sway;
    if (relight >= 0) {
      const k = Math.sin(relight * Math.PI);
      this.view.position.set(0.36 - k * 0.2, -0.4 + k * 0.15 + Math.sin(relight * 40) * 0.01 * k, -0.62);
      this.view.rotation.z = k * 0.6;
    } else {
      this.view.position.set(0.36, -0.4 + bob, -0.62);
      this.view.rotation.z = 0;
    }
    // embers
    const pos = this.embers.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.emberData.length; i++) {
      const e = this.emberData[i];
      e.life -= dt * 1.5;
      if (e.life <= 0) {
        e.life = 0.6 + Math.random() * 0.6;
        e.p.set((Math.random() - 0.5) * 0.03, 0.27, 0.08);
        e.v.set((Math.random() - 0.5) * 0.04, 0.06 + Math.random() * 0.08, (Math.random() - 0.5) * 0.03);
      }
      e.p.addScaledVector(e.v, dt);
      pos.setXYZ(i, e.p.x, lit ? e.p.y : -100, e.p.z);
    }
    pos.needsUpdate = true;
  }
}

/** A wall sconce somewhere in the world. */
export interface Sconce { id: string; pos: THREE.Vector3; burn: number; flame?: THREE.Sprite }

/**
 * Fixed pool of sconce lights (no shadows). The pool size never changes so
 * shader programs never recompile; unused lights sit at intensity 0.
 */
export class SconceLights {
  lights: THREE.PointLight[] = [];
  sconces: Sconce[] = [];
  constructor(private scene: THREE.Scene, private tex: TextureBank, count = 4) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xff9040, 0, 7, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
  }

  register(s: Sconce) {
    if (this.sconces.includes(s)) return;
    this.sconces.push(s);
    if (!s.flame) {
      s.flame = flameSprite(this.tex.flame, 0.5);
      s.flame.position.copy(s.pos).add(new THREE.Vector3(0, 0.28, 0));
      this.scene.add(s.flame);
    }
  }
  unregister(s: Sconce) {
    this.sconces = this.sconces.filter((x) => x !== s);
    if (s.flame) { this.scene.remove(s.flame); s.flame = undefined; }
  }

  /** Is a point lit by any burning sconce? */
  litAt(p: THREE.Vector3, radius: number): boolean {
    for (const s of this.sconces) if (s.burn > 0 && s.pos.distanceTo(p) < radius) return true;
    return false;
  }

  update(dt: number, time: number, focus: THREE.Vector3, radius: number) {
    for (const s of this.sconces) {
      if (s.burn > 0) s.burn = Math.max(0, s.burn - dt);
      if (s.flame) {
        s.flame.visible = s.burn > 0;
        const f = flicker(time + s.pos.x);
        s.flame.scale.set(0.3 * f, 0.5 * f, 1);
      }
    }
    const lit = this.sconces.filter((s) => s.burn > 0).sort((a, b) => a.pos.distanceToSquared(focus) - b.pos.distanceToSquared(focus));
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const s = lit[i];
      if (s && s.pos.distanceTo(focus) < 60) {
        const f = flicker(time * 1.1 + i * 3.1);
        const fade = Math.min(1, s.burn / 20);
        l.position.copy(s.pos).add(new THREE.Vector3(0, 0.3, 0));
        l.distance = radius * f;
        l.intensity = 16 * f * fade;
      } else {
        l.intensity = 0;
      }
    }
  }
}
