/** Scenery with rules attached: water, vines, ropes, sconces, light shafts. */
import * as THREE from 'three';
import type { SceneId, Vec3Like } from '../../core/scenes';
import { SCONCE_RADIUS } from '../../core/torch';
import { GROUPS, RAPIER, type Interactable } from '../../engine/physics';
import type { Game } from '../../game/game';
import type { LoadedScene } from '../kit';
import { removeFrom, type ClimbZone, type Entity, type SconceRef, type WaterVolume } from '../registry';

/** A sheet of water plus the volume the player wades and swims in. */
export class Water implements Entity {
  private readonly vol: WaterVolume;
  private readonly mesh: THREE.Mesh;

  constructor(
    private readonly game: Game,
    parent: THREE.Object3D,
    scene: SceneId,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    surface: number,
    current: Vec3Like,
    dark: boolean,
  ) {
    this.vol = { x0, z0, x1, z1, surface, current, scene };
    game.reg.water.push(this.vol);
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
    g.rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0)) / 6, (uv.getY(i) * (z1 - z0)) / 6);
    this.mesh = game.mats.mesh(g, dark ? 'darkWater' : 'water', dark);
    this.mesh.position.set((x0 + x1) / 2, surface, (z0 + z1) / 2);
    this.mesh.receiveShadow = !dark;
    this.mesh.renderOrder = 5;
    parent.add(this.mesh);
  }

  dispose(): void {
    removeFrom(this.game.reg.water, this.vol);
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

/**
 * Vines on a wall face. `nx, nz` is the outward normal; the strip runs from
 * `a` to `b` along the wall and from y0 to y1.
 */
export class Vines implements Entity {
  private readonly zone: ClimbZone;
  private readonly mesh: THREE.Mesh;

  constructor(
    private readonly game: Game,
    parent: THREE.Object3D,
    /** Centre of the strip on the wall face. */
    cx: number,
    cz: number,
    width: number,
    y0: number,
    y1: number,
    nx: number,
    nz: number,
    topOut = true,
  ) {
    const tx = -nz;
    const tz = nx;
    const hw = width / 2;
    const depth = 0.75;
    const ax = cx - tx * hw;
    const az = cz - tz * hw;
    const bx = cx + tx * hw;
    const bz = cz + tz * hw;
    this.zone = {
      x0: Math.min(ax, bx, ax + nx * depth, bx + nx * depth) - 0.05,
      x1: Math.max(ax, bx, ax + nx * depth, bx + nx * depth) + 0.05,
      z0: Math.min(az, bz, az + nz * depth, bz + nz * depth) - 0.05,
      z1: Math.max(az, bz, az + nz * depth, bz + nz * depth) + 0.05,
      y0,
      y1,
      nx,
      nz,
      topOut,
    };
    game.reg.climbs.push(this.zone);
    // A few overlapping leaf cards hung just off the wall.
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const strips = Math.max(2, Math.round(width / 0.7));
    const h = y1 - y0;
    for (let i = 0; i < strips; i++) {
      const u0 = (i / strips) * width - hw;
      const u1 = u0 + width / strips + 0.25;
      const off = 0.05 + (i % 3) * 0.035;
      const top = y1 + 0.25 - (i % 2) * 0.2;
      const bot = y0 - 0.1 + ((i * 7) % 5) * 0.12;
      const base = pos.length / 3;
      for (const [u, y] of [[u0, bot], [u1, bot], [u1, top], [u0, top]] as const) {
        pos.push(cx + tx * u + nx * off, y, cz + tz * u + nz * off);
        nor.push(nx, 0, nz);
      }
      uv.push(0, 0, 1, 0, 1, h / 2.2, 0, h / 2.2);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, game.mats.get('vineCard'));
    this.mesh.receiveShadow = true;
    parent.add(this.mesh);
  }

  dispose(): void {
    removeFrom(this.game.reg.climbs, this.zone);
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

/**
 * Two iron rings. With a rope from the shop you can rig a hand-line between
 * them and shuffle across the gap.
 */
export class RopeLine implements Entity, Interactable {
  private zone: ClimbZone | null = null;
  private rope: THREE.Mesh | null = null;
  private readonly group = new THREE.Group();

  constructor(
    private readonly game: Game,
    private readonly scene: LoadedScene,
    private readonly key: string,
    private readonly a: Vec3Like,
    private readonly b: Vec3Like,
    private readonly dark: boolean,
  ) {
    for (const p of [a, b]) {
      const post = game.mats.mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.2, 6), 'iron', dark);
      post.position.set(p.x, p.y + 1.1, p.z);
      post.castShadow = true;
      const ring = game.mats.mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 10), 'iron', dark);
      ring.position.set(p.x, p.y + 2.1, p.z);
      this.group.add(post, ring);
      const c = game.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.35, 1.1, 0.35).setTranslation(p.x, p.y + 1.1, p.z).setCollisionGroups(GROUPS.interact),
        scene.body,
      );
      game.physics.setMeta(c, { interact: this, kind: 'ropeAnchor' });
    }
    scene.group.add(this.group);
    if (game.run.get(key, false)) this.rig();
  }

  private rig(): void {
    const { a, b, game } = this;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const g = new THREE.CylinderGeometry(0.03, 0.03, len, 5);
    g.rotateX(Math.PI / 2);
    const rope = game.mats.mesh(g, 'rope', this.dark);
    rope.position.set((a.x + b.x) / 2, a.y + 2.05, (a.z + b.z) / 2);
    rope.rotation.y = Math.atan2(dx, dz);
    this.group.add(rope);
    this.rope = rope;
    // The climber hangs just beside the line, feet a little below bank level.
    const nx = -dz / len;
    const nz = dx / len;
    const pad = 0.45;
    this.zone = {
      x0: Math.min(a.x, b.x) - Math.abs(nx) * pad - (Math.abs(dx) / len) * 0.2,
      x1: Math.max(a.x, b.x) + Math.abs(nx) * pad + (Math.abs(dx) / len) * 0.2,
      z0: Math.min(a.z, b.z) - Math.abs(nz) * pad - (Math.abs(dz) / len) * 0.2,
      z1: Math.max(a.z, b.z) + Math.abs(nz) * pad + (Math.abs(dz) / len) * 0.2,
      y0: a.y - 0.25 + 1.2,
      y1: a.y + 0.12,
      nx,
      nz,
      topOut: false,
      line: true,
    };
    game.reg.climbs.push(this.zone);
  }

  prompt(): string | null {
    if (this.zone) return 'Hand-line rigged: step off the edge and shuffle across';
    const n = this.game.run.ropes;
    return n > 0 ? `Rig a hand-line across the gap (${n} rope${n > 1 ? 's' : ''} left)` : 'An iron ring. A rope from the shop could be tied here.';
  }

  interact(): void {
    if (this.zone) return;
    const game = this.game;
    if (game.run.ropes <= 0) {
      game.sfx('deny');
      return;
    }
    game.run.ropes--;
    game.run.set(this.key, true);
    game.sfx('rope', this.a, 1);
    game.sfx('lever', this.a, 0.6);
    game.toast('Hand-line rigged.', 'good');
    this.rig();
  }

  dispose(): void {
    if (this.zone) removeFrom(this.game.reg.climbs, this.zone);
    this.group.removeFromParent();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

let flameMat: THREE.SpriteMaterial | null = null;
/** A flame billboard. The flame is the one thing underground that is allowed to glow: it is the light. */
export function flameSprite(game: Game, size = 0.5): THREE.Sprite {
  if (!flameMat) {
    flameMat = new THREE.SpriteMaterial({
      map: game.textures.get('flame'),
      color: new THREE.Color(2.2, 1.5, 0.8),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      fog: false,
    });
  }
  const s = new THREE.Sprite(flameMat);
  s.scale.set(size * 0.7, size, 1);
  return s;
}

/** A wall bracket that takes a spare torch. A lit sconce burns for the rest of the run and holds shades off. */
export class Sconce implements Entity, Interactable {
  private readonly ref: SconceRef;
  private readonly group = new THREE.Group();
  private flame: THREE.Sprite | null = null;
  private stick: THREE.Mesh | null = null;
  private t = Math.random() * 10;

  /** `at` is the bracket position on the wall; (nx, nz) points into the room. */
  constructor(
    private readonly game: Game,
    scene: LoadedScene,
    private readonly id: string,
    at: Vec3Like,
    nx: number,
    nz: number,
    private readonly dark: boolean,
  ) {
    const bracket = game.mats.mesh(new THREE.BoxGeometry(0.12, 0.3, 0.12), 'iron', dark);
    bracket.position.set(at.x + nx * 0.08, at.y, at.z + nz * 0.08);
    const cup = game.mats.mesh(new THREE.CylinderGeometry(0.09, 0.06, 0.12, 8), 'iron', dark);
    cup.position.set(at.x + nx * 0.28, at.y + 0.05, at.z + nz * 0.28);
    this.group.add(bracket, cup);
    scene.group.add(this.group);
    this.ref = { pos: { x: at.x + nx * 0.4, y: at.y + 0.55, z: at.z + nz * 0.4 }, lit: false, radius: SCONCE_RADIUS };
    game.reg.sconces.push(this.ref);
    const c = game.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(0.4).setTranslation(at.x + nx * 0.3, at.y + 0.2, at.z + nz * 0.3).setCollisionGroups(GROUPS.interact),
      scene.body,
    );
    game.physics.setMeta(c, { interact: this, kind: 'sconce' });
    if (game.run.litSconces.has(id)) this.light(false);
  }

  private light(announce: boolean): void {
    const game = this.game;
    this.ref.lit = true;
    const p = this.ref.pos;
    const stick = game.mats.mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.55, 6), 'wood', this.dark);
    stick.position.set(p.x, p.y - 0.3, p.z);
    const flame = flameSprite(game, 0.5);
    flame.position.set(p.x, p.y + 0.12, p.z);
    this.group.add(stick, flame);
    this.stick = stick;
    this.flame = flame;
    if (announce) {
      game.sfx('torchLit', p);
      game.toast('Torch mounted. It will burn until dawn. Shades will not cross its light.', 'good');
    }
  }

  prompt(): string | null {
    if (this.ref.lit) return null;
    const n = this.game.run.torch.spares;
    return n > 0 ? `Mount a spare torch in the sconce (${n} left)` : 'An empty sconce. You have no spare torch.';
  }

  interact(): void {
    if (this.ref.lit) return;
    if (!this.game.run.torch.takeSpare()) {
      this.game.sfx('deny');
      return;
    }
    this.game.run.litSconces.add(this.id);
    this.light(true);
  }

  frame(dt: number): void {
    if (!this.flame) return;
    this.t += dt;
    const k = 0.5 + 0.06 * Math.sin(this.t * 17) + 0.05 * Math.sin(this.t * 29.3);
    this.flame.scale.set(k * 0.7, k, 1);
  }

  dispose(): void {
    removeFrom(this.game.reg.sconces, this.ref);
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}

const SHAFT_VERT = /* glsl */ `
attribute float aH;
varying float vH;
void main() {
  vH = aH;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SHAFT_FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
varying float vH;
void main() {
  gl_FragColor = vec4(uColor * uOpacity * mix(0.25, 1.0, vH), 1.0);
}
`;

/**
 * A visible beam under a roof opening. The prism is rebuilt every frame along
 * the real light direction, so it lands exactly on the sunlit patch the shadow
 * map draws. Zone B only; it fades out with the sun.
 */
export class LightShaft implements Entity {
  private readonly mesh: THREE.Mesh;
  private readonly pos: THREE.BufferAttribute;
  private readonly mat: THREE.ShaderMaterial;

  constructor(
    private readonly game: Game,
    parent: THREE.Object3D,
    private readonly x0: number,
    private readonly z0: number,
    private readonly x1: number,
    private readonly z1: number,
    private readonly top: number,
    private readonly floor: number,
    private readonly strength = 1,
  ) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(8 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('aH', new THREE.BufferAttribute(new Float32Array([1, 1, 1, 1, 0, 0, 0, 0]), 1));
    // Four side faces only.
    g.setIndex([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      uniforms: { uColor: { value: new THREE.Vector3(1, 0.9, 0.7) }, uOpacity: { value: 0 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    parent.add(this.mesh);
  }

  frame(): void {
    const game = this.game;
    const L = game.lighting;
    const d = L.lightDir;
    const on = game.renderer.quality.shafts && L.sun.intensity > 0.05 && d.y > 0.12;
    this.mesh.visible = on;
    if (!on) return;
    const k = (this.top - this.floor) / d.y;
    const ox = -d.x * k;
    const oz = -d.z * k;
    const { x0, x1, z0, z1, top, floor } = this;
    const a = this.pos.array as Float32Array;
    const corners = [x0, z0, x1, z0, x1, z1, x0, z1];
    for (let i = 0; i < 4; i++) {
      a[i * 3] = corners[i * 2];
      a[i * 3 + 1] = top;
      a[i * 3 + 2] = corners[i * 2 + 1];
      a[(i + 4) * 3] = corners[i * 2] + ox;
      a[(i + 4) * 3 + 1] = floor;
      a[(i + 4) * 3 + 2] = corners[i * 2 + 1] + oz;
    }
    this.pos.needsUpdate = true;
    const c = L.sun.color;
    (this.mat.uniforms.uColor.value as THREE.Vector3).set(c.r, c.g, c.b);
    this.mat.uniforms.uOpacity.value = 0.035 * this.strength * Math.min(3, L.sun.intensity) * Math.min(1, d.y * 2.5);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
