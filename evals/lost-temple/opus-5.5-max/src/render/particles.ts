/**
 * Pooled CPU particles: dust (lit by the environment, so it is invisible in the dark),
 * embers and sparks (self-lit, only near flames), and water splashes.
 */
import * as THREE from 'three';

const MAX = 1600;

interface Pool {
  points: THREE.Points;
  pos: Float32Array;
  col: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  base: Float32Array; // base colour
  grav: Float32Array;
  drag: Float32Array;
  lit: Uint8Array; // 1 = needs external light
  next: number;
}

function makePool(tex: THREE.Texture, additive: boolean, size: number): Pool {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  for (let i = 0; i < MAX; i++) pos[i * 3 + 1] = -9999;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({
    size,
    map: tex,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    sizeAttenuation: true,
    fog: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  return {
    points,
    pos,
    col,
    vel: new Float32Array(MAX * 3),
    life: new Float32Array(MAX),
    maxLife: new Float32Array(MAX),
    base: new Float32Array(MAX * 3),
    grav: new Float32Array(MAX),
    drag: new Float32Array(MAX),
    lit: new Uint8Array(MAX),
    next: 0,
  };
}

export class Particles {
  dust: Pool;
  glow: Pool;
  /** Small glowing points for the torch in your hand (it sits half a metre from the eye). */
  fine: Pool;
  group = new THREE.Group();
  private tmp = new THREE.Vector3();

  constructor(dotTex: THREE.Texture) {
    this.dust = makePool(dotTex, false, 0.09);
    this.glow = makePool(dotTex, true, 0.07);
    this.fine = makePool(dotTex, true, 0.022);
    this.group.add(this.dust.points, this.glow.points, this.fine.points);
  }

  private emit(p: Pool, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number, grav: number, drag: number, lit: boolean) {
    const i = p.next;
    p.next = (p.next + 1) % MAX;
    p.pos[i * 3] = x;
    p.pos[i * 3 + 1] = y;
    p.pos[i * 3 + 2] = z;
    p.vel[i * 3] = vx;
    p.vel[i * 3 + 1] = vy;
    p.vel[i * 3 + 2] = vz;
    p.life[i] = life;
    p.maxLife[i] = life;
    p.base[i * 3] = r;
    p.base[i * 3 + 1] = g;
    p.base[i * 3 + 2] = b;
    p.grav[i] = grav;
    p.drag[i] = drag;
    p.lit[i] = lit ? 1 : 0;
  }

  /** Falling dust and grit (lit by environment). */
  dustBurst(c: THREE.Vector3, n: number, spread = 1, down = false) {
    for (let k = 0; k < n; k++) {
      const s = 0.55 + Math.random() * 0.25;
      this.emit(this.dust, c.x + (Math.random() - 0.5) * spread, c.y + (Math.random() - 0.5) * spread * 0.4, c.z + (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * 0.6, down ? -0.5 - Math.random() * 2 : Math.random() * 0.8, (Math.random() - 0.5) * 0.6,
        1.2 + Math.random() * 1.8, s * 0.95, s * 0.85, s * 0.7, down ? 6 : 0.3, 1.2, true);
    }
  }

  /** Slow motes drifting in sun shafts. */
  mote(c: THREE.Vector3, spread: number) {
    this.emit(this.dust, c.x + (Math.random() - 0.5) * spread, c.y + (Math.random() - 0.5) * spread, c.z + (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * 0.08, (Math.random() - 0.3) * 0.06, (Math.random() - 0.5) * 0.08, 4 + Math.random() * 3, 1, 0.95, 0.85, 0, 0.1, true);
  }

  splash(c: THREE.Vector3, n: number) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 2.5;
      this.emit(this.dust, c.x, c.y + 0.05, c.z, Math.cos(a) * sp * 0.5, 2 + Math.random() * 3, Math.sin(a) * sp * 0.5, 0.6 + Math.random() * 0.4, 0.75, 0.85, 0.9, 12, 0.5, true);
    }
  }

  embers(c: THREE.Vector3, n: number, wind?: THREE.Vector3, near = false) {
    for (let k = 0; k < n; k++) {
      this.emit(near ? this.fine : this.glow, c.x + (Math.random() - 0.5) * 0.08, c.y + Math.random() * 0.1, c.z + (Math.random() - 0.5) * 0.08,
        (Math.random() - 0.5) * 0.4 + (wind?.x ?? 0) * 0.3, 0.6 + Math.random() * 0.9, (Math.random() - 0.5) * 0.4 + (wind?.z ?? 0) * 0.3,
        0.5 + Math.random() * 0.8, 1.6, 0.7 + Math.random() * 0.3, 0.2, -0.5, 0.8, false);
    }
  }

  sparks(c: THREE.Vector3, n: number, near = false) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      this.emit(near ? this.fine : this.glow, c.x, c.y, c.z, Math.cos(a) * sp, 1 + Math.random() * 3, Math.sin(a) * sp, 0.25 + Math.random() * 0.35, 2, 1.4, 0.6, 9.8, 0.5, false);
    }
  }

  /** lightAt returns 0..1 environmental light at a point (0 in the dark beyond torches). */
  update(dt: number, lightAt: (p: THREE.Vector3) => number) {
    for (const p of [this.dust, this.glow, this.fine]) {
      let any = false;
      for (let i = 0; i < MAX; i++) {
        if (p.life[i] <= 0) continue;
        any = true;
        p.life[i] -= dt;
        const j = i * 3;
        if (p.life[i] <= 0) {
          p.pos[j + 1] = -9999;
          continue;
        }
        const d = Math.exp(-p.drag[i] * dt);
        p.vel[j] *= d;
        p.vel[j + 1] = p.vel[j + 1] * d - p.grav[i] * dt;
        p.vel[j + 2] *= d;
        p.pos[j] += p.vel[j] * dt;
        p.pos[j + 1] += p.vel[j + 1] * dt;
        p.pos[j + 2] += p.vel[j + 2] * dt;
        const t = p.life[i] / p.maxLife[i];
        let k = Math.min(1, t * 3) * Math.min(1, (1 - t) * 8 + 0.2);
        if (p.lit[i]) {
          this.tmp.set(p.pos[j], p.pos[j + 1], p.pos[j + 2]);
          k *= lightAt(this.tmp);
        }
        p.col[j] = p.base[j] * k;
        p.col[j + 1] = p.base[j + 1] * k;
        p.col[j + 2] = p.base[j + 2] * k;
      }
      if (any) {
        (p.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (p.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      }
    }
  }

  clear() {
    for (const p of [this.dust, this.glow, this.fine]) {
      p.life.fill(0);
      for (let i = 0; i < MAX; i++) p.pos[i * 3 + 1] = -9999;
      (p.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
