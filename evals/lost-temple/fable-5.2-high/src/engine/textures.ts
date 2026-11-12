import * as THREE from 'three';
import { Rng, fbm2 } from '../core/rng';

/** Every texture in the game is painted here on a canvas. Nothing is loaded from disk. */

type RGB = [number, number, number];

interface Pair { map: THREE.CanvasTexture; bump: THREE.CanvasTexture; }

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function finish(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Tileable fbm: blends four offsets so the texture wraps without seams. */
function tfbm(x: number, y: number, period: number, oct: number, seed: number): number {
  const u = x / period, v = y / period;
  const a = fbm2(x, y, oct, seed), b = fbm2(x - period, y, oct, seed);
  const c = fbm2(x, y - period, oct, seed), d = fbm2(x - period, y - period, oct, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Fill colour and height canvases per pixel from a shader-like function. */
function paint(size: number, fn: (x: number, y: number) => { c: RGB; h: number }): Pair {
  const [cc, cx] = canvas(size), [hc, hx] = canvas(size);
  const ci = cx.createImageData(size, size), hi = hx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { c, h } = fn(x, y);
      const i = (y * size + x) * 4;
      ci.data[i] = c[0]; ci.data[i + 1] = c[1]; ci.data[i + 2] = c[2]; ci.data[i + 3] = 255;
      const hv = Math.max(0, Math.min(255, h * 255));
      hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = hv; hi.data[i + 3] = 255;
    }
  }
  cx.putImageData(ci, 0, 0);
  hx.putImageData(hi, 0, 0);
  return { map: finish(cc, true), bump: finish(hc, false) };
}

const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

interface MasonryOpts { base: RGB; mortar: RGB; cols: number; rows: number; moss?: number; mossColor?: RGB; seed: number; rough?: number; }

/** Cut stone blocks in running bond with mortar joints, chips, stains and optional moss. */
export function masonry(o: MasonryOpts, size = 256): Pair {
  const bw = size / o.cols, bh = size / o.rows;
  const rng = new Rng(o.seed);
  const tint: number[] = [];
  for (let i = 0; i < o.cols * o.rows; i++) tint.push(0.8 + rng.next() * 0.38);
  const mossC = o.mossColor ?? [62, 92, 40];
  return paint(size, (x, y) => {
    const row = Math.floor(y / bh);
    const off = row % 2 ? bw / 2 : 0;
    const xx = (x + off) % size;
    const col = Math.floor(xx / bw);
    const fx = xx - col * bw, fy = y - row * bh;
    const edge = Math.min(fx, bw - fx, fy, bh - fy);
    const n = tfbm(x / 14, y / 14, size / 14, 4, o.seed);
    const fine = tfbm(x / 3, y / 3, size / 3, 2, o.seed + 5);
    const jointW = 2.2 + n * 2.5;
    let c: RGB, h: number;
    if (edge < jointW) {
      c = scale(o.mortar, 0.7 + fine * 0.5);
      h = 0.15 + fine * 0.1;
    } else {
      const k = tint[row * o.cols + col] * (0.82 + n * 0.3 + (fine - 0.5) * (o.rough ?? 0.25));
      c = scale(o.base, k);
      h = 0.6 + n * 0.25 + (fine - 0.5) * 0.25 + Math.min(1, (edge - jointW) / 5) * 0.12;
    }
    if (o.moss) {
      const m = tfbm(x / 40, y / 40, size / 40, 3, o.seed + 31) + (edge < jointW ? 0.12 : 0) - fy / bh * 0.04;
      const amt = Math.max(0, Math.min(1, (m - (1 - o.moss)) * 6));
      if (amt > 0) { c = mixc(c, scale(mossC, 0.7 + fine * 0.6), amt * 0.85); h += amt * 0.08; }
    }
    return { c, h };
  });
}

/** Mottled natural surface: rock, dirt, grass. */
export function mottled(a: RGB, b: RGB, c2: RGB, seed: number, freq = 24, size = 256, strata = 0): Pair {
  return paint(size, (x, y) => {
    const n = tfbm(x / freq, y / freq, size / freq, 5, seed);
    const m = tfbm(x / (freq * 0.3), y / (freq * 0.3), size / (freq * 0.3), 3, seed + 9);
    let c = mixc(a, b, Math.max(0, Math.min(1, (n - 0.3) * 2.2)));
    c = mixc(c, c2, Math.max(0, Math.min(1, (m - 0.55) * 3)));
    let h = n * 0.7 + m * 0.3;
    if (strata) {
      const s = Math.sin((y + n * 40) * strata) * 0.5 + 0.5;
      c = scale(c, 0.85 + s * 0.2);
      h += s * 0.15;
    }
    return { c: scale(c, 0.85 + m * 0.3), h };
  });
}

/** Planks with grain running along U. */
export function wood(base: RGB, seed: number, planks = 4, size = 256): Pair {
  const ph = size / planks;
  const rng = new Rng(seed);
  const tint = Array.from({ length: planks }, () => 0.75 + rng.next() * 0.4);
  return paint(size, (x, y) => {
    const p = Math.floor(y / ph), fy = y - p * ph;
    // Tileable along U only; the dark joints between planks hide the seam along V.
    const u = x / size, gy = (y + p * 37) / 3;
    const g = fbm2(x / 60, gy, 3, seed + p) * (1 - u) + fbm2((x - size) / 60, gy, 3, seed + p) * u;
    const knot = tfbm(x / 22, y / 22, size / 22, 2, seed + 77);
    const gap = Math.min(fy, ph - fy) < 1.6;
    const k = gap ? 0.35 : tint[p] * (0.86 + g * 0.26) * (knot > 0.72 ? 0.8 : 1);
    return { c: scale(base, k), h: gap ? 0.1 : 0.5 + g * 0.2 };
  });
}

/** Riveted iron: a lattice of flat bars over a dark recessed plate. */
export function ironwork(seed: number, size = 128): Pair {
  const cell = size / 4;
  return paint(size, (x, y) => {
    const fx = Math.abs((x % cell) - cell / 2), fy = Math.abs((y % cell) - cell / 2);
    const bar = Math.min(fx, fy) < cell * 0.17;
    const rivet = Math.hypot(fx, fy) < cell * 0.1;
    const n = tfbm(x / 9, y / 9, size / 9, 3, seed);
    const k = (rivet ? 1.25 : bar ? 0.95 : 0.34) * (0.8 + n * 0.4);
    return { c: scale([122, 118, 116], k), h: rivet ? 1 : bar ? 0.7 : 0.15 };
  });
}

/** Stone carved with a band of glyphs. */
export function glyphStone(base: RGB, seed: number, size = 256): Pair {
  const [cc, cx] = canvas(size), [hc, hx] = canvas(size);
  const rng = new Rng(seed);
  const bg = mottled(base, scale(base, 0.8), scale(base, 1.1), seed, 20, size);
  cx.drawImage(bg.map.image as HTMLCanvasElement, 0, 0);
  hx.drawImage(bg.bump.image as HTMLCanvasElement, 0, 0);
  const draw = (ctx: CanvasRenderingContext2D, style: string) => {
    ctx.strokeStyle = style; ctx.lineWidth = 5; ctx.lineCap = 'square'; ctx.lineJoin = 'miter';
    const cell = size / 4;
    const r2 = new Rng(seed + 3);
    for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
      const ox = gx * cell + cell / 2, oy = gy * cell + cell / 2, s = cell * 0.32;
      ctx.beginPath();
      const kind = r2.int(0, 4);
      if (kind === 0) { // square spiral
        let px = ox - s, py = oy - s; ctx.moveTo(px, py);
        const steps: [number, number][] = [[2, 0], [0, 2], [-1.5, 0], [0, -1.4], [1, 0], [0, 0.8]];
        for (const [dx, dy] of steps) { px += dx * s; py += dy * s; ctx.lineTo(px, py); }
      } else if (kind === 1) { // sun
        ctx.arc(ox, oy, s * 0.45, 0, Math.PI * 2);
        for (let a = 0; a < 8; a++) { const an = (a * Math.PI) / 4; ctx.moveTo(ox + Math.cos(an) * s * 0.65, oy + Math.sin(an) * s * 0.65); ctx.lineTo(ox + Math.cos(an) * s, oy + Math.sin(an) * s); }
      } else if (kind === 2) { // stepped pyramid
        ctx.moveTo(ox - s, oy + s); ctx.lineTo(ox - s, oy + s * 0.3); ctx.lineTo(ox - s * 0.5, oy + s * 0.3); ctx.lineTo(ox - s * 0.5, oy - s * 0.4);
        ctx.lineTo(ox + s * 0.5, oy - s * 0.4); ctx.lineTo(ox + s * 0.5, oy + s * 0.3); ctx.lineTo(ox + s, oy + s * 0.3); ctx.lineTo(ox + s, oy + s);
      } else if (kind === 3) { // serpent wave
        ctx.moveTo(ox - s, oy);
        for (let i = 0; i <= 8; i++) ctx.lineTo(ox - s + (i / 8) * 2 * s, oy + Math.sin(i * 1.6) * s * 0.6);
      } else { // eye
        ctx.ellipse(ox, oy, s, s * 0.5, 0, 0, Math.PI * 2); ctx.moveTo(ox + s * 0.25, oy); ctx.arc(ox, oy, s * 0.25, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
    ctx.lineWidth = 4;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(0, (i * size) / 4); ctx.lineTo(size, (i * size) / 4); ctx.stroke(); }
  };
  void rng;
  draw(cx, 'rgba(20,16,12,0.7)');
  draw(hx, 'rgb(20,20,20)');
  return { map: finish(cc, true), bump: finish(hc, false) };
}

/** Leaf card with alpha for bushes, ferns, vines and grass. */
export function foliage(kind: 'bush' | 'fern' | 'vine' | 'grass' | 'canopy', seed: number, size = 256): THREE.CanvasTexture {
  const [c, x] = canvas(size);
  const rng = new Rng(seed);
  x.clearRect(0, 0, size, size);
  const leaf = (px: number, py: number, len: number, wid: number, ang: number, col: string) => {
    x.save(); x.translate(px, py); x.rotate(ang);
    x.fillStyle = col;
    x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(len * 0.5, -wid, len, 0); x.quadraticCurveTo(len * 0.5, wid, 0, 0); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, 0); x.lineTo(len, 0); x.stroke();
    x.restore();
  };
  const green = (l: number) => `rgb(${Math.floor(28 + l * 50)},${Math.floor(70 + l * 90)},${Math.floor(22 + l * 36)})`;
  if (kind === 'bush' || kind === 'canopy') {
    const n = kind === 'canopy' ? 150 : 70;
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * size * 0.4;
      const px = size / 2 + Math.cos(a) * r, py = size / 2 + Math.sin(a) * r * (kind === 'bush' ? 0.85 : 1);
      leaf(px, py, rng.range(22, 44), rng.range(7, 13), a + rng.range(-0.8, 0.8), green(rng.next()));
    }
  } else if (kind === 'fern') {
    for (let f = 0; f < 7; f++) {
      const base = -Math.PI / 2 + (f - 3) * 0.33;
      let px = size / 2, py = size - 4, ang = base;
      for (let s = 0; s < 16; s++) {
        const nx = px + Math.cos(ang) * 14, ny = py + Math.sin(ang) * 14;
        x.strokeStyle = green(0.2); x.lineWidth = 2; x.beginPath(); x.moveTo(px, py); x.lineTo(nx, ny); x.stroke();
        const l = 22 * (1 - s / 18);
        leaf(nx, ny, l, 4, ang + 1.1, green(0.3 + rng.next() * 0.6));
        leaf(nx, ny, l, 4, ang - 1.1, green(0.3 + rng.next() * 0.6));
        px = nx; py = ny; ang += (f - 3) * 0.035;
      }
    }
  } else if (kind === 'vine') {
    for (let s = 0; s < 3; s++) {
      const sx = size * (0.25 + s * 0.25);
      x.strokeStyle = 'rgb(52,62,28)'; x.lineWidth = 5;
      x.beginPath(); x.moveTo(sx, 0);
      for (let y = 0; y <= size; y += 8) x.lineTo(sx + Math.sin(y / 20 + s * 2) * 12, y);
      x.stroke();
      for (let y = 4; y < size; y += 9) {
        const px = sx + Math.sin(y / 20 + s * 2) * 12;
        leaf(px, y, rng.range(16, 30), rng.range(6, 10), rng.chance(0.5) ? rng.range(-0.5, 0.9) : Math.PI - rng.range(-0.5, 0.9), green(rng.next()));
      }
    }
  } else {
    for (let i = 0; i < 46; i++) {
      const bx = rng.range(size * 0.1, size * 0.9), h = rng.range(size * 0.4, size * 0.98), lean = rng.range(-36, 36);
      x.strokeStyle = green(rng.next()); x.lineWidth = rng.range(3, 6);
      x.beginPath(); x.moveTo(bx, size); x.quadraticCurveTo(bx + lean * 0.3, size - h * 0.6, bx + lean, size - h); x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = kind === 'vine' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = kind === 'vine' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

/** Soft round sprite for flames, dust and motes. */
export function softDot(inner: string, outer: string, size = 64): THREE.CanvasTexture {
  const [c, x] = canvas(size);
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.4, outer); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Flame shape: teardrop gradient. */
export function flameTex(size = 64): THREE.CanvasTexture {
  const [c, x] = canvas(size);
  const g = x.createRadialGradient(size / 2, size * 0.68, 1, size / 2, size * 0.6, size * 0.48);
  g.addColorStop(0, 'rgba(255,250,210,1)'); g.addColorStop(0.3, 'rgba(255,190,70,0.95)');
  g.addColorStop(0.65, 'rgba(240,90,20,0.55)'); g.addColorStop(1, 'rgba(120,20,0,0)');
  x.fillStyle = g;
  x.beginPath(); x.moveTo(size / 2, 2); x.bezierCurveTo(size * 0.95, size * 0.45, size * 0.85, size * 0.98, size / 2, size * 0.98);
  x.bezierCurveTo(size * 0.15, size * 0.98, size * 0.05, size * 0.45, size / 2, 2); x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
