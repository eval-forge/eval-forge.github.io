/**
 * One pooled point-sprite system. Two draw calls: normal-blended "matter"
 * (dust, chips, splashes, leaves) and additive "fire" (sparks, embers).
 *
 * Matter particles are not self-lit: every frame their colour is multiplied by
 * the light that actually reaches them (sky outdoors, torch and sconces
 * underground), so in Zone C dust outside the torch radius is black.
 */
import * as THREE from 'three';
import type { Vec3Like } from '../core/scenes';

export type ParticleKind = 'dust' | 'chip' | 'splash' | 'leaf' | 'smoke' | 'spark' | 'ember' | 'drip' | 'scarab' | 'mote';

interface Preset {
  fire: boolean;
  color: [number, number, number];
  size: [number, number];
  life: [number, number];
  speed: [number, number];
  gravity: number;
  drag: number;
  /** Upward bias of the random direction. */
  up: number;
  grow: number;
}

const PRESETS: Record<ParticleKind, Preset> = {
  dust: { fire: false, color: [0.62, 0.56, 0.46], size: [0.25, 0.7], life: [0.8, 1.8], speed: [0.2, 1.4], gravity: -0.3, drag: 1.6, up: 0.5, grow: 1.2 },
  chip: { fire: false, color: [0.5, 0.47, 0.42], size: [0.06, 0.14], life: [0.6, 1.3], speed: [1.5, 5], gravity: -14, drag: 0.2, up: 0.8, grow: 0 },
  splash: { fire: false, color: [0.6, 0.8, 0.82], size: [0.07, 0.18], life: [0.4, 0.9], speed: [1.5, 4.5], gravity: -12, drag: 0.3, up: 1.6, grow: 0 },
  leaf: { fire: false, color: [0.3, 0.5, 0.18], size: [0.1, 0.2], life: [2.5, 5], speed: [0.2, 1], gravity: -0.9, drag: 0.8, up: 0.1, grow: 0 },
  smoke: { fire: false, color: [0.2, 0.2, 0.2], size: [0.2, 0.4], life: [1, 2], speed: [0.1, 0.5], gravity: 0.8, drag: 0.8, up: 1, grow: 1.5 },
  drip: { fire: false, color: [0.55, 0.7, 0.75], size: [0.05, 0.08], life: [0.8, 1.4], speed: [0, 0.2], gravity: -12, drag: 0, up: 0, grow: 0 },
  scarab: { fire: false, color: [0.07, 0.05, 0.04], size: [0.09, 0.15], life: [0.5, 1.1], speed: [1, 3], gravity: -6, drag: 2.5, up: 0.2, grow: 0 },
  mote: { fire: false, color: [0.9, 0.85, 0.7], size: [0.03, 0.06], life: [3, 6], speed: [0.02, 0.15], gravity: 0.02, drag: 0.5, up: 0, grow: 0 },
  spark: { fire: true, color: [1.0, 0.72, 0.3], size: [0.04, 0.09], life: [0.25, 0.7], speed: [1.5, 5], gravity: -9, drag: 0.6, up: 1, grow: 0 },
  ember: { fire: true, color: [1.0, 0.5, 0.15], size: [0.03, 0.06], life: [0.5, 1.3], speed: [0.2, 0.9], gravity: 1.2, drag: 0.8, up: 1.5, grow: 0 },
};

export interface ParticleLight {
  pos: Vec3Like;
  radius: number;
  /** Linear RGB already scaled by brightness. */
  r: number;
  g: number;
  b: number;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
}
`;
const FRAG = /* glsl */ `
precision mediump float;
varying vec4 vColor;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.18, length(q));
  if (a * vColor.a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}
`;

class Pool {
  readonly max: number;
  readonly points: THREE.Points;
  readonly pos: Float32Array;
  readonly col: Float32Array;
  readonly size: Float32Array;
  readonly vel: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly base: Float32Array; // rgb + size0
  readonly phys: Float32Array; // gravity, drag, grow
  count = 0;
  private cursor = 0;
  readonly material: THREE.ShaderMaterial;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.base = new Float32Array(max * 4);
    this.phys = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 21 : 20;
  }

  spawn(): number {
    // Reuse dead slots first, otherwise overwrite round-robin.
    for (let n = 0; n < this.max; n++) {
      const i = (this.cursor + n) % this.max;
      if (this.life[i] <= 0) {
        this.cursor = (i + 1) % this.max;
        return i;
      }
    }
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    return i;
  }
}

export class Particles {
  private readonly matter = new Pool(1400, false);
  private readonly fire = new Pool(500, true);
  /** Sky light on matter particles (linear RGB). Zero underground. */
  ambient = { r: 1, g: 1, b: 1 };
  lights: ParticleLight[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.matter.points, this.fire.points);
  }

  setViewport(heightPx: number, fovDeg: number): void {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.matter.material.uniforms.uScale.value = s;
    this.fire.material.uniforms.uScale.value = s;
  }

  emit(
    kind: ParticleKind,
    p: Vec3Like,
    count: number,
    o: { spread?: number; dir?: Vec3Like; speed?: number; color?: [number, number, number]; size?: number; life?: number } = {},
  ): void {
    const pr = PRESETS[kind];
    const pool = pr.fire ? this.fire : this.matter;
    const spread = o.spread ?? 0.15;
    for (let n = 0; n < count; n++) {
      const i = pool.spawn();
      const i3 = i * 3;
      pool.pos[i3] = p.x + (Math.random() - 0.5) * 2 * spread;
      pool.pos[i3 + 1] = p.y + (Math.random() - 0.5) * 2 * spread;
      pool.pos[i3 + 2] = p.z + (Math.random() - 0.5) * 2 * spread;
      let dx = Math.random() * 2 - 1;
      let dy = Math.random() * 2 - 1 + pr.up;
      let dz = Math.random() * 2 - 1;
      if (o.dir) {
        dx = dx * 0.45 + o.dir.x;
        dy = dy * 0.45 + o.dir.y;
        dz = dz * 0.45 + o.dir.z;
      }
      const l = Math.hypot(dx, dy, dz) || 1;
      const sp = (pr.speed[0] + Math.random() * (pr.speed[1] - pr.speed[0])) * (o.speed ?? 1);
      pool.vel[i3] = (dx / l) * sp;
      pool.vel[i3 + 1] = (dy / l) * sp;
      pool.vel[i3 + 2] = (dz / l) * sp;
      const life = (pr.life[0] + Math.random() * (pr.life[1] - pr.life[0])) * (o.life ?? 1);
      pool.life[i] = life;
      pool.maxLife[i] = life;
      const c = o.color ?? pr.color;
      const shade = 0.8 + Math.random() * 0.4;
      pool.base[i * 4] = c[0] * shade;
      pool.base[i * 4 + 1] = c[1] * shade;
      pool.base[i * 4 + 2] = c[2] * shade;
      pool.base[i * 4 + 3] = (pr.size[0] + Math.random() * (pr.size[1] - pr.size[0])) * (o.size ?? 1);
      pool.phys[i3] = pr.gravity;
      pool.phys[i3 + 1] = pr.drag;
      pool.phys[i3 + 2] = pr.grow;
    }
  }

  update(dt: number): void {
    this.step(this.matter, dt, true);
    this.step(this.fire, dt, false);
  }

  private step(pool: Pool, dt: number, lit: boolean): void {
    const { pos, vel, life, maxLife, col, size, base, phys } = pool;
    const lights = this.lights;
    const amb = this.ambient;
    let alive = 0;
    for (let i = 0; i < pool.max; i++) {
      if (life[i] <= 0) {
        if (size[i] !== 0) {
          size[i] = 0;
          col[i * 4 + 3] = 0;
        }
        continue;
      }
      life[i] -= dt;
      alive++;
      const i3 = i * 3;
      const drag = Math.max(0, 1 - phys[i3 + 1] * dt);
      vel[i3] *= drag;
      vel[i3 + 1] = vel[i3 + 1] * drag + phys[i3] * dt;
      vel[i3 + 2] *= drag;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      const k = Math.max(0, life[i] / maxLife[i]);
      const age = 1 - k;
      const fade = Math.min(1, k * 3) * Math.min(1, age * 8);
      let r = base[i * 4];
      let g = base[i * 4 + 1];
      let b = base[i * 4 + 2];
      if (lit) {
        let lr = amb.r;
        let lg = amb.g;
        let lb = amb.b;
        for (let j = 0; j < lights.length; j++) {
          const L = lights[j];
          const d = Math.hypot(pos[i3] - L.pos.x, pos[i3 + 1] - L.pos.y, pos[i3 + 2] - L.pos.z);
          if (d >= L.radius) continue;
          const w = 1 - d / L.radius;
          const f = (w * w) / (1 + d * d * 0.08);
          lr += L.r * f;
          lg += L.g * f;
          lb += L.b * f;
        }
        r *= lr;
        g *= lg;
        b *= lb;
      }
      col[i * 4] = r;
      col[i * 4 + 1] = g;
      col[i * 4 + 2] = b;
      col[i * 4 + 3] = fade * (lit ? 0.85 : 1);
      size[i] = base[i * 4 + 3] * (1 + phys[i3 + 2] * age);
    }
    pool.count = alive;
    const g = pool.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.matter.life.fill(0);
    this.fire.life.fill(0);
  }

  get alive(): number {
    return this.matter.count + this.fire.count;
  }
}
