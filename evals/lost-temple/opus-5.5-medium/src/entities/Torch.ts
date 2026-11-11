import * as THREE from 'three';
import { G } from '../core/ctx';
import { torchStats, torchRadius, burn, extinguishCheck, flicker, TorchStats, FLASK_FUEL, RELIGHT_TIME, ExtinguishCause } from '../logic/torch';
import type { Sconce } from '../world/SceneChunk';
import { PAD } from '../core/Input';

const SCONCE_POOL = 4;
const SCONCE_BURN = 360;
const SCONCE_RADIUS = 9;

function makeFlame(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.07 * scale, 0.26 * scale, 7), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.04 * scale, 0.16 * scale, 6), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  outer.position.y = 0.12 * scale; inner.position.y = 0.08 * scale;
  g.add(outer, inner);
  return g;
}

/**
 * The player's torch: the only light underground. Dynamic point light with flicker and
 * shadows, fuel-driven radius, can be blown out, relit, and spare torches can be placed in sconces.
 */
export class TorchSystem {
  stats: TorchStats;
  fuel: number;
  lit = false;
  spares = 1;
  flasks = 0;
  relightProgress = -1;
  light: THREE.PointLight;
  private sconceLights: THREE.PointLight[] = [];
  private litSconces: Sconce[] = [];
  viewModel = new THREE.Group();
  private flame: THREE.Group;
  private t = 0;
  radius = 0;
  lastOutCause: ExtinguishCause = null;
  enabledByPlayer = false;

  constructor(scene: THREE.Scene, camera: THREE.Camera, level: number, flasks: number) {
    this.stats = torchStats(level);
    this.fuel = this.stats.capacity;
    this.flasks = flasks;
    this.light = new THREE.PointLight(0xffa04a, 0, 12, 1.6);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.camera.near = 0.15;
    this.light.shadow.camera.far = 16;
    this.light.shadow.bias = -0.004;
    scene.add(this.light);
    for (let i = 0; i < SCONCE_POOL; i++) {
      const l = new THREE.PointLight(0xff9a40, 0, SCONCE_RADIUS, 1.6);
      l.castShadow = false;
      scene.add(l);
      this.sconceLights.push(l);
    }
    // First-person torch model
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.55, 8), new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 1 }));
    stick.position.y = -0.2;
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 1 }));
    wrap.position.y = 0.08;
    this.flame = makeFlame(1.3);
    this.flame.position.y = 0.12;
    this.viewModel.add(stick, wrap, this.flame);
    this.viewModel.position.set(0.32, -0.3, -0.55);
    this.viewModel.rotation.set(0.15, 0, -0.25);
    camera.add(this.viewModel);
    this.viewModel.traverse((o) => { o.castShadow = false; });
  }

  get fuelFrac() { return this.fuel / this.stats.capacity; }

  toggle() {
    if (this.lit) { this.lit = false; this.enabledByPlayer = false; return; }
    if (this.fuel <= 0) { G.toast(this.spares > 0 ? 'Out of fuel. Press R to light a spare torch.' : 'Out of fuel.'); G.audio.denied(); return; }
    this.startRelight();
  }

  startRelight() {
    if (this.lit || this.relightProgress >= 0) return;
    if (this.fuel <= 0) {
      if (this.spares > 0) { this.spares--; this.fuel = this.stats.capacity; G.toast('You light a fresh torch.'); }
      else { G.toast('No fuel and no spare torches.'); G.audio.denied(); return; }
    }
    if (G.player.inWater && G.player.waterDepth > 1.2) { G.toast("Can't light it in deep water."); return; }
    this.relightProgress = 0;
  }

  extinguish(cause: ExtinguishCause) {
    if (!this.lit) return;
    this.lit = false;
    this.lastOutCause = cause;
    G.audio.hiss();
    const msg = cause === 'water' ? 'The water drowned your torch!' : cause === 'wind' ? 'A gust blew your torch out!' : 'The fall knocked your torch out!';
    G.toast(msg + ' Press R to relight.');
  }

  useFlask() {
    if (this.flasks <= 0) { G.audio.denied(); return; }
    if (this.fuel >= this.stats.capacity - 1) { G.toast('Torch is already full.'); return; }
    this.flasks--;
    this.fuel = Math.min(this.stats.capacity, this.fuel + FLASK_FUEL);
    G.toast('You soak the torch with oil.');
    G.audio.splash();
  }

  placeInSconce(s: Sconce) {
    if (this.spares <= 0 || s.lit) return;
    this.spares--;
    s.lit = true;
    s.fuel = SCONCE_BURN;
    s.flame.visible = true;
    if (s.flame.children.length === 0) { const f = makeFlame(1.6); s.flame.add(f); }
    this.litSconces.push(s);
    if (this.litSconces.length > SCONCE_POOL) {
      const old = this.litSconces.shift()!;
      old.lit = false; old.flame.visible = false;
    }
    G.audio.ignite();
    G.toast('Torch placed. It will light your way back.');
  }

  /** Is a point inside any light right now (torch, sconce, sun)? Used by the shade. */
  pointLit(p: THREE.Vector3, sunCheck = true): boolean {
    if (this.lit && p.distanceTo(this.light.position) < this.radius * 0.75) return true;
    for (const s of this.litSconces) if (s.lit && p.distanceTo(s.pos) < SCONCE_RADIUS * 0.7) return true;
    if (sunCheck && G.sky.exposure > 0 && G.sky.sunVec.y > 0.05) return G.sky.sunlit(p);
    return false;
  }

  /** Effective "how visible the player is" radius for guardians. */
  get visibleRadius() { return this.lit ? this.radius : 0; }

  update(dt: number) {
    this.t += dt;
    const inp = G.input;
    if (inp.hit('KeyF') || inp.padHit(PAD.Y)) this.toggle();
    if (inp.hit('KeyT') || inp.padHit(PAD.UP)) this.useFlask();
    // Hold R to relight
    if ((inp.hit('KeyR') || inp.padHit(PAD.LB)) && !this.lit) this.startRelight();
    if (this.relightProgress >= 0) {
      if (G.player.inWater && G.player.waterDepth > 1.2) {
        this.relightProgress = -1; G.player.slowFactor = 1;
      } else {
        this.relightProgress += dt / RELIGHT_TIME;
        G.player.slowFactor = 0.25;
        if (Math.random() < 0.3) G.audio.footstep('dirt', 0.15);
        if (this.relightProgress >= 1) {
          this.relightProgress = -1;
          G.player.slowFactor = 1;
          this.lit = true;
          this.enabledByPlayer = true;
          G.audio.ignite();
        }
      }
    } else G.player.slowFactor = 1;

    // Fuel
    this.fuel = burn(this.fuel, dt, this.stats, this.lit);
    if (this.lit && this.fuel <= 0) {
      this.lit = false;
      G.toast(this.spares > 0 ? 'Your torch burned out. Press R to light a spare.' : this.flasks > 0 ? 'Your torch burned out. T to add oil, then R.' : 'Your torch burned out!');
      G.audio.hiss();
    }

    // Extinguish checks
    if (this.lit) {
      const tp = this.light.position;
      const surf = G.world.waterSurfaceAt(tp);
      const wind = G.world.windAt(G.player.position);
      const cause = extinguishCheck({
        waterDepthAtTorch: surf !== null && tp.y < surf ? surf - tp.y : 0,
        windGust: wind,
        fallSpeed: G.player.landingSpeed,
        crouchingInWater: G.player.inWater && G.player.crouching && G.player.waterDepth > 0.5,
      }, Math.random() / Math.max(dt, 1e-4));
      if (cause) this.extinguish(cause);
    }
    G.player.landingSpeed = 0;

    // Light
    this.radius = this.lit ? torchRadius(this.fuel, this.stats) : 0;
    const fl = flicker(this.t);
    const cam = G.camera;
    const wp = new THREE.Vector3();
    this.flame.getWorldPosition(wp);
    // Light sits slightly in front of the flame so the hand does not shadow everything
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.light.position.copy(wp).addScaledVector(fwd, 0.15);
    this.light.position.y += 0.05 + Math.sin(this.t * 9) * 0.01;
    this.light.distance = this.radius * 1.35;
    this.light.intensity = this.lit ? (4 + this.radius * 1.6) * fl : 0;
    this.light.shadow.camera.far = Math.max(1, this.radius * 1.4);
    this.light.shadow.autoUpdate = this.lit;
    this.flame.visible = this.lit;
    const s = 0.8 + 0.4 * (this.radius / this.stats.maxRadius);
    this.flame.scale.set(s * fl, s * (0.9 + 0.3 * Math.sin(this.t * 17)), s * fl);
    // lower torch while relighting
    this.viewModel.position.y = this.relightProgress >= 0 ? -0.45 + this.relightProgress * 0.15 : -0.3;

    // Sconces
    for (const sc of this.litSconces) {
      sc.fuel -= dt;
      if (sc.fuel <= 0 && sc.lit) { sc.lit = false; sc.flame.visible = false; }
    }
    this.litSconces = this.litSconces.filter((x) => x.lit);
    for (let i = 0; i < SCONCE_POOL; i++) {
      const l = this.sconceLights[i];
      const sc = this.litSconces[i];
      if (sc && sc.mesh.parent && (sc.mesh.parent as THREE.Object3D).parent) {
        l.position.copy(sc.pos);
        l.intensity = (10 * Math.min(1, sc.fuel / 30)) * flicker(this.t, i * 3);
        sc.flame.scale.setScalar(flicker(this.t, i));
      } else l.intensity = 0;
    }
  }
}
