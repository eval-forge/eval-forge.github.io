/** Tileable value noise and fbm used by the texture generators and terrain. */
import { mulberry32 } from '../logic/rng';

export class TileNoise {
  private perm: Float32Array;
  constructor(seed = 1, private size = 256) {
    const r = mulberry32(seed);
    this.perm = new Float32Array(size * size);
    for (let i = 0; i < this.perm.length; i++) this.perm[i] = r();
  }

  /** Periodic value noise; `period` lattice cells across the tile. */
  noise(x: number, y: number, period: number): number {
    const p = Math.max(1, Math.round(period));
    const fx = x * p;
    const fy = y * p;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const s = this.size;
    const g = (a: number, b: number) => this.perm[(((a % p) + p) % p % s) + (((((b % p) + p) % p) % s) * s)];
    const v00 = g(ix, iy);
    const v10 = g(ix + 1, iy);
    const v01 = g(ix, iy + 1);
    const v11 = g(ix + 1, iy + 1);
    return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
  }

  fbm(x: number, y: number, period: number, octaves = 4, gain = 0.5): number {
    let a = 0.5;
    let sum = 0;
    let norm = 0;
    let p = period;
    for (let i = 0; i < octaves; i++) {
      sum += a * this.noise(x, y, p);
      norm += a;
      a *= gain;
      p *= 2;
    }
    return sum / norm;
  }
}

/** Non-periodic smooth 2D noise for world-space use (terrain, placement). */
export class WorldNoise {
  private perm: Uint8Array;
  private vals: Float32Array;
  constructor(seed = 7) {
    const r = mulberry32(seed);
    this.perm = new Uint8Array(512);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.vals[i] = r() * 2 - 1;
  }
  private h(x: number, y: number) {
    return this.vals[this.perm[(this.perm[x & 255] + y) & 511]];
  }
  noise(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const tx = x - ix;
    const ty = y - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = this.h(ix, iy);
    const b = this.h(ix + 1, iy);
    const c = this.h(ix, iy + 1);
    const d = this.h(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  fbm(x: number, y: number, octaves = 4): number {
    let a = 1;
    let f = 1;
    let s = 0;
    let n = 0;
    for (let i = 0; i < octaves; i++) {
      s += a * this.noise(x * f + i * 17.3, y * f - i * 9.1);
      n += a;
      a *= 0.5;
      f *= 2.03;
    }
    return s / n;
  }
}
