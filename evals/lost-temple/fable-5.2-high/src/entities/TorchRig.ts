import * as THREE from 'three';
import { flicker, isLit, placeSpare, startRelight, stepTorch, stow, torchRadius, useFlask, useSpare, RELIGHT_TIME } from '../core/torch';
import type { Game } from '../game/Game';

const SCONCE_POOL = 4;
export const SCONCE_RADIUS = 8;

/**
 * The torch in your hand: the mesh, the flame, and the one shadow-casting point light. Also owns a
 * fixed pool of plain point lights that get handed to whichever lit sconces are nearest, so the
 * number of lights in the scene never changes and shaders never recompile mid-run.
 */
export class TorchRig {
  readonly light: THREE.PointLight;
  private pool: THREE.PointLight[] = [];
  private sconces: THREE.Vector3[] = [];
  private view = new THREE.Group();
  private flame: THREE.Sprite;
  private head: THREE.Mesh;
  private stick: THREE.Mesh;
  private crackleT = 0;
  /** Current light radius in metres, 0 when not burning. */
  radius = 0;
  private shown = 0;

  constructor(private game: Game) {
    this.light = new THREE.PointLight(0xffa550, 0, 12, 1.6);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.camera.near = 0.15;
    this.light.shadow.camera.far = 16;
    this.light.shadow.bias = -0.006;
    this.light.shadow.normalBias = 0.05;
    game.scene.add(this.light);
    for (let i = 0; i < SCONCE_POOL; i++) {
      const l = new THREE.PointLight(0xff9a48, 0, SCONCE_RADIUS, 1.6);
      game.scene.add(l);
      this.pool.push(l);
    }
    // First-person torch.
    // Unlit materials driven by hand: the point light sits centimetres away and would bleach them.
    this.stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.5, 6), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
    const stick = this.stick;
    this.head = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.038, 0.13, 8), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
    this.head.position.y = 0.3;
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: game.mats.texture('flame'), transparent: true, depthWrite: false, fog: false }));
    this.flame.position.y = 0.47;
    this.view.add(stick, this.head, this.flame);
    this.view.position.set(0.34, -0.34, -0.6);
    this.view.rotation.set(0.25, 0, -0.18);
    game.camera.add(this.view);
  }

  setQuality(shadowSize: number): void {
    this.light.castShadow = shadowSize > 0;
    if (shadowSize > 0 && this.light.shadow.mapSize.x !== shadowSize) {
      this.light.shadow.mapSize.set(shadowSize, shadowSize);
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null as any;
    }
  }

  reset(): void { this.sconces.length = 0; this.shown = 0; }

  addSconce(p: THREE.Vector3): void { if (!this.sconces.includes(p)) this.sconces.push(p); }
  removeSconce(p: THREE.Vector3): void { const i = this.sconces.indexOf(p); if (i >= 0) this.sconces.splice(i, 1); }
  /** Lit sconces currently loaded. Guardians read this. */
  get litSconces(): readonly THREE.Vector3[] { return this.sconces; }

  placeSpare(): boolean {
    if (!placeSpare(this.game.run.torch)) return false;
    this.game.run.stats.torchesPlaced++;
    return true;
  }

  /** F: light it, or put it away. */
  toggle(): void {
    const { game } = this;
    const t = game.run.torch;
    if (t.state === 'lit' || t.state === 'relighting') { stow(t); game.audio.play('douse', { vol: 0.4 }); return; }
    if (game.player.busyHands) { game.toast('Your hands are busy'); return; }
    if (t.state === 'dead') {
      if (t.flasks > 0) { useFlask(t); game.toast('Poured a flask of oil in'); }
      else if (t.spares > 0) { useSpare(t); game.toast('Switched to a spare torch'); }
      else { game.toast('The torch is spent and you have nothing to feed it'); game.audio.play('deny'); return; }
    }
    if (startRelight(t)) game.audio.play('strike');
  }

  flask(): void {
    const { game } = this;
    if (useFlask(game.run.torch)) { game.audio.play('flask'); game.toast('Fuel topped up'); }
    else game.toast(game.run.torch.flasks > 0 ? 'The torch is already full' : 'No oil flasks');
  }

  spare(): void {
    const { game } = this;
    if (useSpare(game.run.torch)) { game.audio.play('pickup'); game.toast('Switched to a spare torch. Light it with F.'); }
    else game.toast('No spare torches');
  }

  update(dt: number): void {
    const { game } = this;
    const run = game.run;
    const t = run.torch;
    for (const ev of stepTorch(t, dt, run.torchCfg)) {
      if (ev === 'lit') game.audio.play('ignite');
      else if (ev === 'died') { game.audio.play('douse'); game.toast('Your torch has burned out'); }
      else if (ev === 'low') game.toast('Torch fuel is running low');
    }
    // Hands full of wall or water: the torch cannot stay up.
    if ((t.state === 'relighting') && game.player.busyHands) stow(t);

    this.radius = torchRadius(t, run.torchCfg);
    const lit = isLit(t);
    const fl = lit ? flicker(run.time, t.fuel) : 0;
    // Ease the visible radius so shrinking fuel closes in smoothly.
    this.shown += (this.radius - this.shown) * Math.min(1, dt * (this.radius > this.shown ? 5 : 2.5));
    const r = Math.max(0.01, this.shown);
    this.light.distance = r * (0.97 + (fl - 1) * 0.25);
    this.light.intensity = lit ? 7.5 * r * fl : 0;
    this.light.shadow.camera.far = Math.max(1, r + 0.5);
    this.light.shadow.autoUpdate = lit;
    const cam = game.camera;
    // Keep the light inside the player's capsule so it can never end up behind a wall.
    const j = lit ? 0.035 : 0;
    this.light.position.set(cam.position.x + Math.sin(run.time * 9.3) * j, cam.position.y + 0.12 + Math.sin(run.time * 12.7) * j, cam.position.z + Math.cos(run.time * 8.1) * j);

    // View model
    const show = t.state === 'lit' || t.state === 'relighting' || t.state === 'out' || t.state === 'dead';
    this.view.visible = show && !game.player.busyHands;
    let bobY = -0.34;
    if (t.state === 'relighting') {
      // Strike and catch: the torch dips out of view and comes back up.
      const k = 1 - t.relightT / RELIGHT_TIME;
      bobY = -0.34 - Math.sin(k * Math.PI) * 0.16;
      this.view.rotation.x = 0.25 + Math.sin(k * Math.PI * 5) * 0.12;
    } else this.view.rotation.x = 0.25;
    this.view.position.y = bobY + Math.sin(run.time * 1.8) * 0.006;
    this.flame.visible = lit;
    if (lit) {
      const s = (0.15 + 0.08 * Math.min(1, t.fuel / 0.35)) * fl;
      this.flame.scale.set(s, s * 1.5, 1);
    }
    // Lit by its own flame, otherwise by whatever sky light reaches the player (none in Zone C).
    const day = Math.min(1, game.sky.ambientIntensity / 1.3);
    const glow = lit ? 0.8 * fl : day * 0.75;
    (this.stick.material as THREE.MeshBasicMaterial).color.setRGB(0.2 * glow, 0.115 * glow, 0.06 * glow);
    (this.head.material as THREE.MeshBasicMaterial).color.setRGB(lit ? 0.5 * fl : 0.04 * day, lit ? 0.14 * fl : 0.03 * day, lit ? 0.03 : 0.02 * day);
    if (lit) {
      this.crackleT -= dt;
      if (this.crackleT <= 0) { this.crackleT = 0.08 + Math.random() * 0.35; game.audio.play('crackle', { vol: 0.25 + Math.random() * 0.2 }); }
    }

    // Hand the pooled lights to the nearest lit sconces.
    const near = this.sconces.map((p) => ({ p, d: p.distanceToSquared(cam.position) })).sort((a, b) => a.d - b.d);
    for (let i = 0; i < SCONCE_POOL; i++) {
      const l = this.pool[i], s = near[i];
      if (s && s.d < 60 * 60) {
        l.position.copy(s.p);
        l.intensity = 34 * (1 + Math.sin(run.time * 11 + i * 2.1) * 0.06 + Math.sin(run.time * 27 + i) * 0.04);
      } else l.intensity = 0;
    }
  }
}
