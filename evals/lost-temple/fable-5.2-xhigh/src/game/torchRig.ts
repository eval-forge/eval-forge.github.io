/**
 * The torch in your hand: a small view model on the camera, the flame, and
 * the one shadow-casting point light that is the only illumination in Zone C.
 * `TorchModel` (core/torch) owns the rules; this turns them into light.
 */
import * as THREE from 'three';
import { damp } from '../core/rng';
import { SCENES } from '../core/scenes';
import type { TorchEvent } from '../core/torch';
import { RAY } from '../engine/physics';
import { flameSprite } from '../world/entities/env';
import type { Game } from './game';

/** Candela at full fuel. */
const TORCH_INTENSITY = 13;
/** Firelight on the hand and the torch itself (linear), scaled by how close each part is to the flame. */
const GLOW = new THREE.Color(1.0, 0.62, 0.3);

const _p = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();

export class TorchRig {
  private readonly group = new THREE.Group();
  private readonly flame: THREE.Sprite;
  private readonly flint = new THREE.Group();
  private readonly parts: { mesh: THREE.Mesh; key: string; glow: number }[] = [];
  private dark = false;
  private t = Math.random() * 10;
  private raise = 0.35;
  private flintT = 0;
  private emberT = 0;
  /** Smoothed brightness so lighting and dousing are not single-frame pops. */
  private level = 0;
  private radius = 0;
  /** Where the light actually is this frame. */
  readonly lightPos = new THREE.Vector3();

  constructor(private readonly game: Game) {
    const g = this.group;
    let order = 9000;
    const mk = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: string, x: number, y: number, z: number, glow: number): THREE.Mesh => {
      const m = new THREE.Mesh(game.mats.prep(geo, mat), game.mats.viewModel(mat, false, `${this.parts.length}`));
      m.position.set(x, y, z);
      m.castShadow = false;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.renderOrder = order++;
      this.parts.push({ mesh: m, key: mat, glow });
      parent.add(m);
      return m;
    };
    // Back to front as seen from the eye: sleeve, hand, shaft, wrapped head, charred tip.
    mk(g, new THREE.BoxGeometry(0.075, 0.3, 0.08), 'cloth', 0.01, -0.36, 0.035, 0.22);
    mk(g, new THREE.CylinderGeometry(0.02, 0.017, 0.52, 8), 'wood', 0, 0, 0, 0.5);
    mk(g, new THREE.BoxGeometry(0.07, 0.1, 0.08), 'hand', 0.004, -0.15, 0.004, 0.4);
    mk(g, new THREE.CylinderGeometry(0.043, 0.032, 0.13, 8), 'cloth', 0, 0.28, 0, 1.1);
    mk(g, new THREE.CylinderGeometry(0.028, 0.04, 0.04, 8), 'char', 0, 0.36, 0, 2.5);
    // The flame gets its own material: it must draw over the world like the rest of the rig.
    this.flame = flameSprite(game, 0.2);
    const fm = (this.flame.material as THREE.SpriteMaterial).clone();
    fm.depthTest = false;
    this.flame.material = fm;
    this.flame.renderOrder = 9100;
    this.flame.position.set(0, 0.44, 0);
    this.flame.visible = false;
    g.add(this.flame);
    // The other hand, with the flint, only shows while striking.
    mk(this.flint, new THREE.BoxGeometry(0.07, 0.08, 0.09), 'hand', 0, 0, 0, 0.45);
    mk(this.flint, new THREE.BoxGeometry(0.05, 0.035, 0.07), 'rock', 0, 0.05, 0, 0.45);
    this.flint.visible = false;
    g.add(this.flint);
    g.scale.setScalar(0.8);
    g.visible = false;
    game.renderer.camera.add(g);
  }

  reset(): void {
    this.level = 0;
    this.radius = 0;
    this.raise = 0.35;
    this.flame.visible = false;
    this.flint.visible = false;
  }

  onEvent(e: TorchEvent): void {
    const game = this.game;
    this.flame.getWorldPosition(_p);
    if (e.type === 'lit') game.particles.emit('ember', _p, 10, { spread: 0.05 });
    else if (e.type === 'doused') game.particles.emit('smoke', _p, 8, { spread: 0.05 });
  }

  frame(dt: number): void {
    const game = this.game;
    const torch = game.run.torch;
    const player = game.player;
    const inRun = game.state === 'playing' || game.state === 'ending' || game.state === 'paused';
    const g = this.group;
    g.visible = inRun && player.alive;
    if (!inRun) {
      this.level = 0;
      game.lighting.setTorch(player.eye, 0, 0, false);
      return;
    }
    this.t += dt;
    const lit = torch.lit;
    const striking = torch.vulnerable;

    const dark = SCENES[game.scenes.current].zone === 'C';
    if (dark !== this.dark) {
      this.dark = dark;
      this.parts.forEach((p, i) => (p.mesh.material = game.mats.viewModel(p.key, dark, `${i}`)));
    }

    // Pose: held up when lit, lowered when out, brought across the body to strike.
    this.raise = damp(this.raise, lit ? 1 : striking ? 0.8 : 0.3, 8, dt);
    const k = striking ? torch.relightProgress : 0;
    const bob = Math.sin(this.t * 1.7) * 0.004 + Math.min(1, player.speed / 6) * Math.sin(this.t * 9) * 0.006;
    g.position.set(0.27 - (striking ? 0.09 : 0), -0.44 + this.raise * 0.16 + bob, -0.52);
    g.rotation.set(-0.3 - (1 - this.raise) * 0.75, 0, 0.14 + (striking ? 0.3 : 0));
    this.flint.visible = striking;
    if (striking) {
      const strike = Math.abs(Math.sin(k * Math.PI * 4.5));
      this.flint.position.set(-0.17 + strike * 0.11, 0.3 - strike * 0.06, 0.03);
      this.flintT -= dt;
      if (this.flintT <= 0) {
        this.flintT = 0.34;
        this.flame.getWorldPosition(_p);
        game.sfx('flint', undefined, 0.8, 0.9 + Math.random() * 0.3);
        game.particles.emit('spark', _p, 7, { spread: 0.02, speed: 0.6 });
        game.noise('flint', player.pos, 0.7);
      }
    } else {
      this.flintT = 0;
    }

    const flick = 1 + 0.09 * Math.sin(this.t * 13.1) + 0.06 * Math.sin(this.t * 29.7 + 1.7) + 0.04 * Math.sin(this.t * 47.3 + 0.4);
    this.flame.visible = lit;
    if (lit) {
      const s = (0.16 + 0.1 * torch.brightness) * flick;
      this.flame.scale.set(s * 0.75, s * 1.25, 1);
      this.flame.position.set(Math.sin(this.t * 7.3) * 0.006, 0.44 + s * 0.3, 0);
      this.emberT -= dt;
      if (this.emberT <= 0) {
        this.emberT = 0.18 + Math.random() * 0.3;
        this.flame.getWorldPosition(_p);
        game.particles.emit('ember', _p, 1, { spread: 0.03 });
      }
    }

    // The light sits beside and ahead of the eye, pulled back if a wall is in the way.
    this.level = damp(this.level, lit ? torch.brightness : 0, lit ? 7 : 16, dt);
    const glow = this.level < 0.004 ? 0 : this.level * flick;
    for (const p of this.parts) {
      const m = p.mesh.material as THREE.MeshLambertMaterial;
      m.emissive.copy(m.color).multiply(GLOW).multiplyScalar(glow * p.glow);
    }
    if (lit) this.radius = torch.radius;
    const cam = game.renderer.camera;
    cam.matrixWorld.extractBasis(_r, _u, _f);
    const eye = player.eye;
    _p.set(0, 0, 0).addScaledVector(_r, 0.3).addScaledVector(_u, 0.1).addScaledVector(_f, -0.42);
    const len = _p.length();
    const hit = game.physics.raycast(eye, _p, len + 0.2, RAY.solidWorld);
    const reach = hit ? Math.max(0.04, hit.distance - 0.2) / len : 1;
    this.lightPos.copy(eye).addScaledVector(_p, Math.min(1, reach));
    this.lightPos.x += Math.sin(this.t * 17.3) * 0.012;
    this.lightPos.y += Math.sin(this.t * 21.1) * 0.012;
    const on = this.level > 0.004;
    // The flame casts shadows only where it is the light that matters: underground, on the
    // stairs down, and in the roofless halls after dark. Under open sky the sun or the moon
    // does that job, and six more shadow passes would buy nothing you could see.
    const zone = SCENES[game.scenes.current].zone;
    const shadows = zone === 'C' || game.outdoor < 0.999 || (zone === 'B' && game.run.clock.isDark);
    game.lighting.setTorch(this.lightPos, on ? this.radius * (0.97 + 0.03 * flick) : 0, TORCH_INTENSITY * this.level * flick, shadows);
  }
}
