/**
 * Every texture in the game is painted here onto a canvas at boot.
 * No image files exist in this project.
 */
import * as THREE from 'three';
import { Rng, clamp01, hash2, lerp } from '../core/rng';

type Px = (u: number, v: number, x: number, y: number) => [number, number, number, number?];

/** Value noise that tiles with the given period. */
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const w = (n: number): number => ((n % period) + period) % period;
  const h = (a: number, b: number): number => hash2(hash2(w(a), w(b)), seed) / 4294967296;
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Tiling fbm in [0,1]. `period` is the number of base cells across the texture. */
function tfbm(u: number, v: number, period: number, octaves: number, seed: number): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let p = period;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tileNoise(u * p, v * p, p, seed + i * 13);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

function paint(size: number, fn: Px): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  let i = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = fn(x / size, y / size, x, y);
      d[i++] = Math.max(0, Math.min(255, c[0] * 255));
      d[i++] = Math.max(0, Math.min(255, c[1] * 255));
      d[i++] = Math.max(0, Math.min(255, c[2] * 255));
      d[i++] = (c[3] ?? 1) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function toTexture(canvas: HTMLCanvasElement, repeat = true, aniso = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

type V3 = [number, number, number];
const mix3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

interface BlockOpts {
  size: number;
  /** Rows of blocks down the texture. */
  rows: number;
  /** Blocks across in each row (average). */
  cols: number;
  base: V3;
  dark: V3;
  mortar: V3;
  mortarW: number;
  moss?: V3;
  mossAmount?: number;
  seed: number;
  /** Per-block brightness variation. */
  vary: number;
  grit: number;
  /** Offset alternate rows (running bond). */
  bond: boolean;
  streak?: number;
}

/** Ashlar / brick / tile patterns with mortar, per-block tint, grit and optional moss. */
function blocks(o: BlockOpts): HTMLCanvasElement {
  const { rows, cols, seed } = o;
  return paint(o.size, (u, v) => {
    const row = Math.floor(v * rows);
    const fv = v * rows - row;
    const shift = o.bond ? (row % 2) * 0.5 + (hash2(row, seed) / 4294967296) * 0.2 : 0;
    const cu = u * cols + shift;
    const col = Math.floor(cu);
    const fu = cu - col;
    const id = hash2(hash2(((col % cols) + cols) % cols, row), seed);
    const tintK = 1 + ((id & 255) / 255 - 0.5) * o.vary;
    const hueK = ((id >> 8) & 255) / 255;
    // Distance to the nearest joint, in block units.
    const edge = Math.min(fu, 1 - fu) * (rows / cols) < Math.min(fv, 1 - fv) ? Math.min(fu, 1 - fu) * (rows / cols) : Math.min(fv, 1 - fv);
    const n1 = tfbm(u, v, 8, 4, seed + 1);
    const n2 = tfbm(u, v, 32, 3, seed + 2);
    const speck = tfbm(u, v, 96, 2, seed + 3);
    let c = mix3(o.dark, o.base, clamp01(0.25 + n1 * 0.9));
    c = mul3(c, tintK * (0.9 + n2 * 0.2));
    // Slight warm/cool shift per block.
    c = [c[0] * (0.97 + hueK * 0.06), c[1], c[2] * (1.03 - hueK * 0.06)];
    c = mul3(c, 1 - o.grit * (speck > 0.62 ? (speck - 0.62) * 1.1 : 0));
    // Chipped, darker edges then mortar.
    const wobble = o.mortarW * (0.75 + n2 * 0.6);
    const bevel = clamp01((edge - wobble) / (o.mortarW * 2.2));
    c = mul3(c, 0.72 + 0.28 * bevel);
    if (edge < wobble) c = mix3(o.mortar, c, clamp01(edge / wobble) * 0.35);
    if (o.streak) {
      const s = tfbm(u * 3, v * 0.35, 12, 3, seed + 9);
      c = mul3(c, 1 - o.streak * clamp01((s - 0.45) * 2.4));
    }
    if (o.moss && o.mossAmount) {
      const m = tfbm(u, v, 6, 4, seed + 5) * 0.7 + (1 - bevel) * 0.25 + tfbm(u, v, 40, 2, seed + 6) * 0.2;
      const k = clamp01((m - (1 - o.mossAmount)) * 4);
      c = mix3(c, mul3(o.moss, 0.75 + n2 * 0.4), k * 0.7);
    }
    return [c[0], c[1], c[2]];
  });
}

function rockTex(seed: number, base: V3, dark: V3): HTMLCanvasElement {
  return paint(512, (u, v) => {
    const strata = tfbm(u * 0.5, v * 3, 8, 4, seed);
    const n = tfbm(u, v, 12, 5, seed + 3);
    const crack = Math.abs(tfbm(u, v, 6, 3, seed + 7) - 0.5);
    let c = mix3(dark, base, clamp01(strata * 0.7 + n * 0.5));
    c = mul3(c, 0.8 + n * 0.35);
    if (crack < 0.02) c = mul3(c, 0.55 + crack * 20);
    return c;
  });
}

function groundTex(seed: number): HTMLCanvasElement {
  // Greyscale-ish detail that multiplies the terrain's vertex colours.
  return paint(512, (u, v) => {
    const n = tfbm(u, v, 10, 5, seed);
    const fine = tfbm(u, v, 64, 3, seed + 4);
    const k = 0.62 + n * 0.5 + (fine - 0.5) * 0.35;
    return [k * 1.02, k, k * 0.94];
  });
}

function woodTex(seed: number): HTMLCanvasElement {
  const base: V3 = [0.46, 0.32, 0.19];
  const dark: V3 = [0.23, 0.15, 0.09];
  return paint(256, (u, v) => {
    const plank = Math.floor(u * 4);
    const fu = u * 4 - plank;
    const grain = tfbm(u * 2 + plank * 0.37, v * 0.18, 16, 4, seed + plank);
    const rings = Math.sin((grain * 9 + v * 3) * Math.PI * 2) * 0.5 + 0.5;
    let c = mix3(dark, base, clamp01(0.3 + grain * 0.5 + rings * 0.25));
    c = mul3(c, 0.85 + (hash2(plank, seed) / 4294967296) * 0.3);
    const gap = Math.min(fu, 1 - fu);
    if (gap < 0.03) c = mul3(c, 0.35 + gap * 15);
    return c;
  });
}

function barkTex(seed: number): HTMLCanvasElement {
  return paint(256, (u, v) => {
    const ridges = Math.abs(tfbm(u * 2, v * 0.3, 10, 4, seed) - 0.5) * 2;
    const n = tfbm(u, v, 24, 3, seed + 2);
    const k = 0.55 + ridges * 0.5 + n * 0.2;
    const moss = clamp01((tfbm(u, v, 5, 3, seed + 8) - 0.55) * 4);
    const c = mix3([0.56 * k, 0.45 * k, 0.33 * k], [0.3, 0.37, 0.2], moss * 0.55);
    return c;
  });
}

function metalTex(seed: number, base: V3): HTMLCanvasElement {
  return paint(128, (u, v) => {
    const n = tfbm(u, v, 8, 4, seed);
    const scratch = tfbm(u * 6, v * 0.4, 16, 2, seed + 3);
    const k = 0.78 + n * 0.3 + (scratch - 0.5) * 0.16;
    return mul3(base, k);
  });
}

/** Alpha-tested leaf cluster for ferns, bushes and canopy cards. */
function leafTex(seed: number): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(seed);
  ctx.clearRect(0, 0, size, size);
  const frond = (x: number, y: number, ang: number, len: number, w: number): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const g = 86 + rng.int(0, 44);
    const grad = ctx.createLinearGradient(0, 0, 0, -len);
    grad.addColorStop(0, `rgb(${36 + rng.int(0, 16)},${g - 26},${24 + rng.int(0, 12)})`);
    grad.addColorStop(1, `rgb(${72 + rng.int(0, 34)},${g + 20},${42 + rng.int(0, 22)})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(w, -len * 0.5, 0, -len);
    ctx.quadraticCurveTo(-w, -len * 0.5, 0, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(24,44,18,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -len);
    ctx.stroke();
    ctx.restore();
  };
  for (let i = 0; i < 26; i++) {
    const a = (rng.next() - 0.5) * 2.4;
    frond(size / 2 + (rng.next() - 0.5) * 60, size - 4, a, 110 + rng.next() * 130, 14 + rng.next() * 16);
  }
  return canvas;
}

/** A hanging vine strip: stem with leaves, alpha-tested. */
function vineTex(seed: number): HTMLCanvasElement {
  const w = 128;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(seed);
  for (let s = 0; s < 3; s++) {
    const x0 = 24 + s * 40 + rng.range(-8, 8);
    ctx.strokeStyle = `rgb(${50 + rng.int(0, 20)},${60 + rng.int(0, 20)},${24})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let y = 0; y <= h; y += 8) {
      const x = x0 + Math.sin(y * 0.03 + s * 2) * 9;
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let y = 6; y < h; y += 14 + rng.int(0, 10)) {
      const x = x0 + Math.sin(y * 0.03 + s * 2) * 9;
      const dir = rng.chance(0.5) ? 1 : -1;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(dir * (0.6 + rng.next() * 0.9));
      ctx.fillStyle = `rgb(${52 + rng.int(0, 28)},${92 + rng.int(0, 40)},${36 + rng.int(0, 24)})`;
      ctx.beginPath();
      ctx.ellipse(0, -11, 6 + rng.next() * 3, 13 + rng.next() * 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  return canvas;
}

function softDot(inner: string, outer: string): HTMLCanvasElement {
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return canvas;
}

function flameTex(): HTMLCanvasElement {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s * 0.62, 2, s / 2, s * 0.55, s * 0.48);
  g.addColorStop(0, 'rgba(255,250,220,1)');
  g.addColorStop(0.25, 'rgba(255,200,90,0.95)');
  g.addColorStop(0.6, 'rgba(255,110,20,0.5)');
  g.addColorStop(1, 'rgba(120,20,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(s / 2, 4);
  ctx.bezierCurveTo(s * 0.95, s * 0.5, s * 0.8, s * 0.98, s / 2, s * 0.98);
  ctx.bezierCurveTo(s * 0.2, s * 0.98, s * 0.05, s * 0.5, s / 2, 4);
  ctx.fill();
  return canvas;
}

function waterTex(seed: number): HTMLCanvasElement {
  return paint(256, (u, v) => {
    const a = tfbm(u, v, 6, 4, seed);
    const b = tfbm(u + 0.37, v + 0.11, 12, 3, seed + 5);
    const ripple = Math.abs(a - b);
    const k = clamp01(1 - ripple * 6);
    const hi = k * k * k;
    return [0.55 + hi * 0.45, 0.75 + hi * 0.25, 0.78 + hi * 0.22, 1];
  });
}

/** The sundial face: twelve glyph stones round a ring, drawn in world-up orientation. */
export function sundialFaceCanvas(): HTMLCanvasElement {
  const s = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#9c8f76';
  ctx.fillRect(0, 0, s, s);
  const img = ctx.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (hash2(i, 77) / 4294967296 - 0.5) * 26;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  ctx.translate(s / 2, s / 2);
  ctx.strokeStyle = '#4a4032';
  ctx.lineWidth = 5;
  for (const r of [70, 150, 236]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r0 = i % 4 === 0 ? 150 : 205;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * 236, Math.sin(a) * 236);
    ctx.stroke();
  }
  // Rays from the centre.
  ctx.fillStyle = '#5a4c38';
  for (let i = 0; i < 12; i++) {
    ctx.save();
    ctx.rotate((i / 12) * Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(-9, -72);
    ctx.lineTo(0, -142);
    ctx.lineTo(9, -72);
    ctx.fill();
    ctx.restore();
  }
  return canvas;
}

/** A small set of carved pictograms used on murals, seals and the sundial ring. */
export type Glyph = 'sun' | 'serpent' | 'moon' | 'eye' | 'hand' | 'door' | 'skull' | 'wave' | 'key' | 'flame' | 'block' | 'arrow';

export function drawGlyph(ctx: CanvasRenderingContext2D, g: Glyph, x: number, y: number, r: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, r * 0.14);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (g) {
    case 'sun':
      ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.stroke();
      }
      break;
    case 'serpent':
      ctx.moveTo(-r, r * 0.5);
      ctx.bezierCurveTo(-r * 0.5, -r * 1.2, 0, r * 1.4, r * 0.45, -r * 0.2);
      ctx.bezierCurveTo(r * 0.6, -r * 0.7, r * 0.95, -r * 0.7, r, -r * 0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.98, -r * 0.4, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'moon':
      ctx.arc(0, 0, r * 0.8, 0.4, Math.PI * 2 - 0.4);
      ctx.arc(r * 0.35, 0, r * 0.62, Math.PI * 2 - 0.9, 0.9, true);
      ctx.fill();
      break;
    case 'eye':
      ctx.moveTo(-r, 0);
      ctx.quadraticCurveTo(0, -r * 0.9, r, 0);
      ctx.quadraticCurveTo(0, r * 0.9, -r, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'hand':
      ctx.rect(-r * 0.4, -r * 0.1, r * 0.8, r * 0.9);
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.3 + i * r * 0.2, -r * 0.1);
        ctx.lineTo(-r * 0.3 + i * r * 0.2, -r * 0.9);
        ctx.stroke();
      }
      break;
    case 'door':
      ctx.moveTo(-r * 0.6, r);
      ctx.lineTo(-r * 0.6, -r * 0.5);
      ctx.lineTo(0, -r);
      ctx.lineTo(r * 0.6, -r * 0.5);
      ctx.lineTo(r * 0.6, r);
      ctx.stroke();
      break;
    case 'skull':
      ctx.arc(0, -r * 0.2, r * 0.65, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-r * 0.25, -r * 0.25, r * 0.15, 0, Math.PI * 2);
      ctx.arc(r * 0.25, -r * 0.25, r * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.25, r * 0.5);
      ctx.lineTo(-r * 0.25, r * 0.9);
      ctx.moveTo(0, r * 0.5);
      ctx.lineTo(0, r * 0.9);
      ctx.moveTo(r * 0.25, r * 0.5);
      ctx.lineTo(r * 0.25, r * 0.9);
      ctx.stroke();
      break;
    case 'wave':
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(-r, k * r * 0.5);
        ctx.bezierCurveTo(-r * 0.5, k * r * 0.5 - r * 0.4, 0, k * r * 0.5 + r * 0.4, r, k * r * 0.5 - r * 0.1);
        ctx.stroke();
      }
      break;
    case 'key':
      ctx.arc(-r * 0.5, 0, r * 0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, 0);
      ctx.lineTo(r, 0);
      ctx.moveTo(r * 0.6, 0);
      ctx.lineTo(r * 0.6, r * 0.4);
      ctx.moveTo(r * 0.9, 0);
      ctx.lineTo(r * 0.9, r * 0.4);
      ctx.stroke();
      break;
    case 'flame':
      ctx.moveTo(0, -r);
      ctx.bezierCurveTo(r * 0.9, -r * 0.1, r * 0.6, r, 0, r);
      ctx.bezierCurveTo(-r * 0.6, r, -r * 0.9, -r * 0.1, 0, -r);
      ctx.stroke();
      break;
    case 'block':
      ctx.rect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.7);
      ctx.lineTo(r * 0.7, r * 0.7);
      ctx.moveTo(r * 0.7, -r * 0.7);
      ctx.lineTo(-r * 0.7, r * 0.7);
      ctx.stroke();
      break;
    case 'arrow':
      ctx.moveTo(-r, 0);
      ctx.lineTo(r, 0);
      ctx.moveTo(r * 0.4, -r * 0.5);
      ctx.lineTo(r, 0);
      ctx.lineTo(r * 0.4, r * 0.5);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

/** A carved mural panel: a row of glyphs on weathered stone. `dark` picks dungeon tones. */
export function muralTexture(glyphs: Glyph[], dark = false, accent: Glyph | null = null): THREE.CanvasTexture {
  const w = 128 * glyphs.length;
  const h = 160;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = dark ? '#6a6660' : '#a8997c';
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (hash2(i, 311) / 4294967296 - 0.5) * 30;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = dark ? '#3c3a36' : '#6e5f48';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  glyphs.forEach((g, i) => {
    const hot = accent !== null && g === accent;
    drawGlyph(ctx, g, 64 + i * 128, h / 2, 40, hot ? '#8a2f1c' : dark ? '#2e2c28' : '#4c3f2e');
  });
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export type TexKey =
  | 'temple' | 'moss' | 'flag' | 'hall' | 'nave' | 'sanctum' | 'dungeonWall' | 'dungeonFloor' | 'vaultFloor' | 'causeway'
  | 'rock' | 'ground' | 'wood' | 'bark' | 'gold' | 'bronze' | 'leaf' | 'vine' | 'dot' | 'flame' | 'water' | 'roof';

export class TextureLibrary {
  private cache = new Map<TexKey, THREE.Texture>();

  get(key: TexKey): THREE.Texture {
    let t = this.cache.get(key);
    if (!t) {
      t = this.make(key);
      this.cache.set(key, t);
    }
    return t;
  }

  /** Paint everything up front so nothing hitches mid-run. */
  warm(): void {
    const keys: TexKey[] = [
      'temple', 'moss', 'flag', 'hall', 'nave', 'sanctum', 'dungeonWall', 'dungeonFloor', 'vaultFloor', 'causeway',
      'rock', 'ground', 'wood', 'bark', 'gold', 'bronze', 'leaf', 'vine', 'dot', 'flame', 'water', 'roof',
    ];
    for (const k of keys) this.get(k);
  }

  private make(key: TexKey): THREE.Texture {
    switch (key) {
      case 'temple':
        return toTexture(blocks({
          size: 512, rows: 4, cols: 3, base: [0.74, 0.66, 0.52], dark: [0.5, 0.43, 0.33], mortar: [0.26, 0.22, 0.17],
          mortarW: 0.028, seed: 11, vary: 0.22, grit: 0.5, bond: true, streak: 0.22,
          moss: [0.33, 0.37, 0.21], mossAmount: 0.3,
        }));
      case 'moss':
        return toTexture(blocks({
          size: 512, rows: 4, cols: 3, base: [0.62, 0.6, 0.48], dark: [0.38, 0.38, 0.3], mortar: [0.18, 0.2, 0.12],
          mortarW: 0.03, seed: 23, vary: 0.2, grit: 0.5, bond: true, streak: 0.3,
          moss: [0.29, 0.36, 0.19], mossAmount: 0.6,
        }));
      case 'roof':
        return toTexture(blocks({
          size: 512, rows: 2, cols: 2, base: [0.6, 0.55, 0.46], dark: [0.36, 0.32, 0.27], mortar: [0.2, 0.18, 0.14],
          mortarW: 0.02, seed: 29, vary: 0.16, grit: 0.6, bond: false, streak: 0.35,
          moss: [0.3, 0.35, 0.2], mossAmount: 0.4,
        }));
      case 'flag':
        return toTexture(blocks({
          size: 512, rows: 5, cols: 4, base: [0.7, 0.65, 0.54], dark: [0.48, 0.44, 0.36], mortar: [0.27, 0.3, 0.19],
          mortarW: 0.04, seed: 37, vary: 0.26, grit: 0.6, bond: true,
          moss: [0.32, 0.38, 0.2], mossAmount: 0.36,
        }));
      case 'hall':
        return toTexture(blocks({
          size: 512, rows: 4, cols: 4, base: [0.66, 0.6, 0.5], dark: [0.44, 0.39, 0.32], mortar: [0.22, 0.2, 0.16],
          mortarW: 0.022, seed: 41, vary: 0.2, grit: 0.55, bond: false,
          moss: [0.33, 0.37, 0.22], mossAmount: 0.22,
        }));
      case 'nave':
        return toTexture(blocks({
          size: 512, rows: 4, cols: 4, base: [0.6, 0.52, 0.42], dark: [0.36, 0.3, 0.24], mortar: [0.14, 0.11, 0.08],
          mortarW: 0.03, seed: 43, vary: 0.24, grit: 0.7, bond: false, streak: 0.2,
        }));
      case 'sanctum':
        return toTexture(blocks({
          size: 512, rows: 3, cols: 3, base: [0.72, 0.63, 0.47], dark: [0.47, 0.4, 0.3], mortar: [0.25, 0.2, 0.14],
          mortarW: 0.02, seed: 47, vary: 0.18, grit: 0.45, bond: false,
          moss: [0.34, 0.37, 0.23], mossAmount: 0.18,
        }));
      case 'dungeonWall':
        return toTexture(blocks({
          size: 512, rows: 6, cols: 4, base: [0.56, 0.54, 0.52], dark: [0.3, 0.29, 0.29], mortar: [0.12, 0.12, 0.12],
          mortarW: 0.03, seed: 53, vary: 0.28, grit: 0.7, bond: true, streak: 0.4,
        }));
      case 'dungeonFloor':
        return toTexture(blocks({
          size: 512, rows: 5, cols: 5, base: [0.5, 0.48, 0.46], dark: [0.27, 0.26, 0.26], mortar: [0.09, 0.09, 0.09],
          mortarW: 0.035, seed: 59, vary: 0.3, grit: 0.8, bond: true,
        }));
      case 'vaultFloor':
        return toTexture(blocks({
          size: 512, rows: 4, cols: 4, base: [0.55, 0.5, 0.42], dark: [0.3, 0.27, 0.23], mortar: [0.5, 0.4, 0.16],
          mortarW: 0.016, seed: 61, vary: 0.22, grit: 0.5, bond: false,
        }));
      case 'causeway':
        return toTexture(blocks({
          size: 512, rows: 3, cols: 3, base: [0.74, 0.72, 0.66], dark: [0.52, 0.5, 0.46], mortar: [0.2, 0.2, 0.2],
          mortarW: 0.03, seed: 67, vary: 0.2, grit: 0.4, bond: false,
        }));
      case 'rock':
        return toTexture(rockTex(71, [0.6, 0.56, 0.5], [0.3, 0.28, 0.26]));
      case 'ground':
        return toTexture(groundTex(73));
      case 'wood':
        return toTexture(woodTex(79));
      case 'bark':
        return toTexture(barkTex(83));
      case 'gold':
        return toTexture(metalTex(89, [1.0, 0.82, 0.42]));
      case 'bronze':
        return toTexture(metalTex(97, [0.72, 0.52, 0.3]));
      case 'leaf': {
        const t = toTexture(leafTex(101), false);
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        return t;
      }
      case 'vine': {
        const t = toTexture(vineTex(103), true);
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.RepeatWrapping;
        return t;
      }
      case 'dot':
        return toTexture(softDot('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), false, 1);
      case 'flame':
        return toTexture(flameTex(), false, 1);
      case 'water':
        return toTexture(waterTex(107));
    }
  }
}
