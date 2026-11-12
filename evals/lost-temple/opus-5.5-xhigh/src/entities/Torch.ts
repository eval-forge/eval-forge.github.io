/**
 * The player's torch (view model, flame, shadow-casting point light, fuel, flicker,
 * relight animation) and wall sconces (a fixed pool of 6 non-shadow point lights assigned
 * to the nearest burning sconces / fires each frame).
 */
import * as THREE from 'three';
import { flameMaterial, surface, tinted, setExposure } from '../engine/materials';
import { gustBlowoutChance, fallBlowsOut, OIL_FLASK_FUEL, SCONCE_BURN, type TorchEvent } from '../logic/torch';
import type { Game } from '../game/Game';
import type { Exposure } from '../engine/materials';

export interface FlameSource {
  id: string;
  pos: THREE.Vector3;
  /** Burning right now? */
  lit(): boolean;
  /** 0..1 strength (sconces fade near the end). */
  strength(): number;
  radius: number;
  flame?: THREE.Mesh;
}

const POOL = 6;
const UP = new THREE.Vector3(0, 1, 0);

export class TorchSystem {
  light: THREE.PointLight;
  model = new THREE.Group();
  private flame: THREE.Mesh;
  private flameMat: THREE.ShaderMaterial;
  private stick: THREE.Mesh;
  private head: THREE.Mesh;
  pool: THREE.PointLight[] = [];
  sources = new Map<string, FlameSource>();
  private flick = 1;
  private flickT = 0;
  private sway = 0;
  private relightPhase = 0;
  private strikeT = 0;
  /** World position of the flame this frame. */
  flamePos = new THREE.Vector3();
  private sconceFlameMat: THREE.ShaderMaterial;
  private shadowFlip = false;

  constructor(private game: Game) {
    const l = new THREE.PointLight(0xffa860, 0, 10, 1.7);
    l.castShadow = true;
    l.shadow.mapSize.set(game.quality.torchShadow, game.quality.torchShadow);
    l.shadow.bias = -0.003;
    l.shadow.normalBias = 0.03;
    l.shadow.camera.near = 0.12;
    l.shadow.camera.far = 14;
    this.light = l;
    game.scene.add(l);
    for (let i = 0; i < POOL; i++) {
      const p = new THREE.PointLight(0xff9a50, 0, 12, 1.7);
      p.castShadow = false;
      this.pool.push(p);
      game.scene.add(p);
    }
    // view model: held in the right hand, parented to the camera
    this.stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.62, 7), surface('wood', 'outdoor'));
    this.stick.position.set(0, -0.12, 0);
    this.head = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.13, 7), tinted(0x3a2a1c, 'outdoor', 1));
    this.head.position.set(0, 0.2, 0);
    this.flameMat = flameMaterial();
    this.flame = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.2), this.flameMat);
    this.flame.position.set(0, 0.34, 0);
    this.flame.renderOrder = 5;
    this.model.add(this.stick, this.head, this.flame);
    this.model.position.set(0.36, -0.36, -0.62);
    this.model.rotation.set(0.25, 0, -0.18);
    game.camera.add(this.model);
    this.sconceFlameMat = flameMaterial();
  }

  get state() {
    return this.game.run.torch;
  }

  /** A flame mesh for sconces / braziers (shared animated material). */
  makeFlame(scale = 1): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.26 * scale, 0.5 * scale), this.sconceFlameMat);
    m.renderOrder = 5;
    m.userData.billboard = true;
    return m;
  }

  addSource(s: FlameSource) {
    this.sources.set(s.id, s);
  }

  removeSource(id: string) {
    this.sources.delete(id);
  }

  setShadowSize(n: number) {
    this.light.shadow.mapSize.set(n, n);
    if (this.light.shadow.map) {
      this.light.shadow.map.dispose();
      (this.light.shadow as any).map = null;
    }
  }

  // ------------------------------------------------------------ actions

  handle(ev: TorchEvent[]) {
    const g = this.game;
    for (const e of ev) {
      switch (e.type) {
        case 'out':
          g.audio.torchOut();
          g.fx.dust(this.flamePos.clone(), 0.15);
          if (e.reason === 'water') g.toast('Your torch hisses out in the water.', 'warn');
          else if (e.reason === 'wind') g.toast('A gust blows your torch out!', 'warn');
          else if (e.reason === 'fall') g.toast('The fall knocked your torch out.', 'warn');
          else if (e.reason === 'fuel') g.toast(g.run.spares > 0 ? 'Your torch burnt out. T to light a spare.' : 'Your torch burnt out. No spares left.', 'warn');
          break;
        case 'lit':
          g.audio.torchIgnite();
          break;
        case 'relightStart':
          this.relightPhase = 0;
          this.strikeT = 0;
          break;
        case 'relightFailed':
          g.audio.denied();
          g.toast(e.why === 'wet' ? 'The torch is soaked. Give it a moment to dry.' : 'No fuel. Find oil, or use a spare torch.', 'warn');
          break;
        case 'lowFuel':
          g.toast('Torch is running low (R uses an oil flask).', 'warn');
          break;
      }
    }
  }

  /** T: douse a lit torch, or start relighting a dark one. */
  toggle() {
    const g = this.game;
    const s = this.state;
    if (s.lit) {
      this.handle(s.douse('player'));
      return;
    }
    if (s.relighting) return;
    if (g.player.torchUnderwater) {
      g.toast('Not under water.', 'warn');
      return;
    }
    if (s.fuel <= 0) {
      if (g.run.spares > 0) {
        g.run.spares--;
        s.replaceWithSpare();
        g.toast('You light a fresh spare torch.');
      } else if (g.run.oil > 0) {
        this.refuel();
      }
    }
    // standing at a burning sconce: light it instantly from the flame
    const near = this.nearestLit(g.player.eye(), 1.8);
    if (near && s.fuel > 0 && s.wet <= 0) {
      s.lit = true;
      g.audio.torchIgnite();
      return;
    }
    this.handle(s.startRelight());
  }

  refuel() {
    const g = this.game;
    if (g.run.oil <= 0) {
      g.toast('No oil flasks.', 'warn');
      g.audio.denied();
      return;
    }
    if (this.state.fuel >= this.state.stats.maxFuel - 5) {
      g.toast('The torch is already soaked in oil.');
      return;
    }
    g.run.oil--;
    this.state.addFuel(OIL_FLASK_FUEL);
    g.audio.splash(undefined, 0.2);
    g.toast(`Oil added (+${OIL_FLASK_FUEL} s).`);
  }

  nearestLit(p: THREE.Vector3, within: number): FlameSource | null {
    let best: FlameSource | null = null;
    let bd = within;
    for (const s of this.sources.values()) {
      if (!s.lit()) continue;
      const d = s.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** Player fell hard / swam / got hit by wind: maybe the torch goes out. */
  onLand(impact: number) {
    if (this.state.lit && fallBlowsOut(impact)) this.handle(this.state.douse('fall'));
  }

  gust(strength: number) {
    if (!this.state.lit) return;
    const p = gustBlowoutChance(strength, this.state.stats.gustResist);
    if (Math.random() < p) this.handle(this.state.douse('wind'));
  }

  // ------------------------------------------------------------ per frame

  update(dt: number, time: number, exposure: Exposure) {
    const g = this.game;
    const s = this.state;
    if (g.player.torchUnderwater && (s.lit || s.relighting)) this.handle(s.douse('water'));
    this.handle(s.update(dt));

    // flicker: smoothed noise
    this.flickT -= dt;
    if (this.flickT <= 0) {
      this.flickT = 0.05 + Math.random() * 0.08;
      this.flick = 0.82 + Math.random() * 0.3;
    }
    const f = (this.light.userData.f ?? 1) + ((this.flick - (this.light.userData.f ?? 1)) * Math.min(1, dt * 18));
    this.light.userData.f = f;

    // view model animation
    const pl = g.player;
    const moving = pl.moving && pl.grounded ? 1 : 0;
    this.sway += dt * (pl.sprinting ? 11 : 7) * moving;
    const bobX = Math.sin(this.sway) * 0.012 * moving;
    const bobY = Math.abs(Math.cos(this.sway)) * 0.016 * moving;
    let tx = 0.36 + bobX;
    let ty = -0.36 + bobY - pl.landKick * 0.05;
    let rz = -0.18;
    if (s.relighting) {
      // bring the torch in front and strike flint against it
      this.relightPhase = Math.min(1, this.relightPhase + dt * 3);
      tx = 0.36 - 0.24 * this.relightPhase;
      ty = -0.36 + 0.08 * this.relightPhase;
      rz = -0.18 + 0.3 * this.relightPhase;
      this.strikeT -= dt;
      if (this.strikeT <= 0) {
        this.strikeT = 0.32 + Math.random() * 0.15;
        g.audio.strike();
        const wp = new THREE.Vector3();
        this.head.getWorldPosition(wp);
        g.fx.spark(wp, 10);
      }
    } else this.relightPhase = Math.max(0, this.relightPhase - dt * 3);
    this.model.position.set(tx, ty, -0.62);
    this.model.rotation.z = rz + Math.sin(time * 1.3) * 0.01;
    this.model.visible = !pl.dead && !g.ui.mapOpen;
    setExposure(this.stick, exposure);
    setExposure(this.head, exposure);

    // flame + light
    const radius = s.radius;
    const prog = s.relighting ? s.relightProgress : 1;
    this.flame.visible = s.lit || (s.relighting && prog > 0.8);
    const flameScale = s.lit ? 0.55 + 0.45 * (radius / s.stats.maxRadius) : (prog - 0.8) * 3;
    this.flame.scale.setScalar(Math.max(0.05, flameScale) * (0.95 + 0.1 * f));
    this.flameMat.uniforms.uTime.value = time;
    this.flameMat.uniforms.uIntensity.value = 0.55 + 0.12 * f;
    this.model.updateMatrixWorld(true);
    const pq = new THREE.Quaternion();
    this.model.getWorldQuaternion(pq);
    // cylindrical billboard: upright in the world, turned toward the camera
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pl.yaw);
    this.flame.quaternion.copy(pq.invert().multiply(yawQ));
    this.flame.getWorldPosition(this.flamePos);
    this.flamePos.y += 0.05;
    // put the light a little in front of the flame so the torch stick doesn't shadow the world
    const lp = this.flamePos.clone().add(new THREE.Vector3(0, 0.12, 0));
    this.light.position.copy(lp);
    // outdoors in daylight the torch adds nothing the sun doesn't: skip its 6-face shadow pass
    const daylightOutside = exposure === 'outdoor' && g.sky.sunUp && g.sky.skyFactor > 0.9;
    if (s.lit && !daylightOutside) {
      const outdoorsDay = exposure === 'outdoor' ? 0.7 : 1;
      this.light.intensity = 9 * f * outdoorsDay * (0.5 + 0.5 * Math.min(1, radius / 6));
      this.light.distance = radius * 1.35;
      this.light.shadow.camera.far = Math.max(2, radius * 1.4);
      // the 6-face cube shadow is the most expensive pass: refresh it at 30 Hz
      this.light.shadow.autoUpdate = false;
      this.shadowFlip = !this.shadowFlip;
      if (this.shadowFlip) this.light.shadow.needsUpdate = true;
    } else {
      this.light.intensity = 0;
      this.light.shadow.autoUpdate = false;
    }

    // sconces: animate flames and assign the light pool to the nearest burning ones
    this.sconceFlameMat.uniforms.uTime.value = time;
    const eye = pl.eye();
    const lit: { s: FlameSource; d: number }[] = [];
    for (const src of this.sources.values()) {
      const on = src.lit();
      if (src.flame) {
        src.flame.visible = on;
        if (on) src.flame.quaternion.setFromAxisAngle(UP, pl.yaw);
      }
      if (on) lit.push({ s: src, d: src.pos.distanceTo(eye) });
    }
    lit.sort((a, b) => a.d - b.d);
    for (let i = 0; i < POOL; i++) {
      const L = this.pool[i];
      const e = lit[i];
      if (e && e.d < 45) {
        const sf = 0.85 + 0.15 * Math.sin(time * 13 + i * 7) * Math.sin(time * 7.3 + i);
        L.position.copy(e.s.pos).add(new THREE.Vector3(0, 0.25, 0));
        L.intensity = 7 * sf * e.s.strength();
        L.distance = e.s.radius;
      } else L.intensity = 0;
    }
  }

  /** Light level 0..1 at a point from all flames (for guardians). */
  lightAt(p: THREE.Vector3): number {
    let best = 0;
    const s = this.state;
    if (s.lit) {
      const d = p.distanceTo(this.flamePos);
      best = Math.max(best, 1 - d / Math.max(0.1, s.radius));
    }
    for (const src of this.sources.values()) {
      if (!src.lit()) continue;
      const d = p.distanceTo(src.pos);
      best = Math.max(best, (1 - d / (src.radius * 0.8)) * src.strength());
    }
    return Math.max(0, Math.min(1, best));
  }

  /** Burn sconces down. */
  tickSconces(dt: number) {
    const run = this.game.run;
    for (const [id, left] of run.sconces) {
      const n = left - dt;
      if (n <= 0) run.sconces.delete(id);
      else run.sconces.set(id, n);
    }
  }

  static sconceStrength(left: number) {
    return Math.min(1, left / (SCONCE_BURN * 0.15));
  }
}
