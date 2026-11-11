import * as THREE from 'three';
import { mulberry32 } from '../logic/rng';

/** Procedural canvas textures. Everything is painted at runtime, no image files. */

// ---------------------------------------------------------------- noise
function makeNoise(seed: number) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h: number, x: number, y: number) => {
    const u = (h & 1) ? x : -x, v = (h & 2) ? y : -y;
    return u + v;
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  /** 2D gradient noise, tileable with period `per`. Range about -1..1. */
  return (x: number, y: number, per = 256): number => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X0 = ((xi % per) + per) % per, Y0 = ((yi % per) + per) % per;
    const X1 = (X0 + 1) % per, Y1 = (Y0 + 1) % per;
    const aa = perm[(perm[X0 & 255] + Y0) & 255], ab = perm[(perm[X0 & 255] + Y1) & 255];
    const ba = perm[(perm[X1 & 255] + Y0) & 255], bb = perm[(perm[X1 & 255] + Y1) & 255];
    const u = fade(xf), v = fade(yf);
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 0.7;
  };
}
const noise = makeNoise(1337);
/** Tileable fBm over a canvas of size `size` with base frequency `freq` cells. */
function fbm(x: number, y: number, size: number, freq: number, oct = 4): number {
  let a = 0.5, f = freq, s = 0, n = 0;
  for (let o = 0; o < oct; o++) {
    s += a * noise((x / size) * f, (y / size) * f, f);
    n += a; a *= 0.5; f *= 2;
  }
  return s / n;
}

export const exportedNoise = { noise, fbm };

type RGB = [number, number, number];
const hex = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

export interface TexSet { map: THREE.Texture; bump?: THREE.Texture; rough?: THREE.Texture }

/** Paint a texture by a per-pixel function returning [r,g,b,height]. Produces color + bump maps. */
function paint(size: number, fn: (x: number, y: number) => [number, number, number, number], alphaFn?: (x: number, y: number) => number): TexSet {
  const c = canvas(size), b = canvas(size);
  const ctx = c.getContext('2d')!, bctx = b.getContext('2d')!;
  const img = ctx.createImageData(size, size), bimg = bctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, bl, h] = fn(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = bl; img.data[i + 3] = alphaFn ? alphaFn(x, y) : 255;
      const hv = Math.max(0, Math.min(255, h * 255));
      bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = hv; bimg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  bctx.putImageData(bimg, 0, 0);
  return { map: toTexture(c), bump: toTexture(b, false) };
}

/** Masonry: rows of blocks with mortar joints, per-block tint, grain and chips. */
function masonry(size: number, base: number, mortar: number, rows: number, cols: number, opts: { moss?: number; dark?: number; seed?: number; jitter?: number } = {}): TexSet {
  const rand = mulberry32(opts.seed ?? 7);
  const tints: number[] = [];
  for (let i = 0; i < rows * cols * 2; i++) tints.push(rand());
  const bc = hex(base), mc = hex(mortar), moss: RGB = [70, 96, 40];
  const rh = size / rows, cw = size / cols;
  return paint(size, (x, y) => {
    const row = Math.floor(y / rh);
    const off = (row % 2) * cw * 0.5 + (opts.jitter ?? 0) * (tints[row] - 0.5) * cw;
    const xx = (x + off + size) % size;
    const col = Math.floor(xx / cw);
    const lx = xx - col * cw, ly = y - row * rh;
    const edge = Math.min(lx, cw - lx, ly, rh - ly);
    const t = tints[(row * cols + col) % tints.length];
    const n = fbm(x, y, size, 8, 4);
    const fine = fbm(x, y, size, 64, 2);
    let c: RGB = mix(bc, [bc[0] * 0.75, bc[1] * 0.72, bc[2] * 0.7], t * 0.8 + n * 0.4);
    c = mix(c, [c[0] * 1.15, c[1] * 1.12, c[2] * 1.08], Math.max(0, fine) * 0.6);
    let h = 0.7 + n * 0.2 + fine * 0.1;
    const joint = 3 + n * 2;
    if (edge < joint) { const k = 1 - edge / joint; c = mix(c, mc, k * 0.9); h -= k * 0.6; }
    if (opts.moss) {
      const m = fbm(x + 100, y + 50, size, 4, 5) + (1 - y / size) * 0.15;
      const mk = Math.max(0, Math.min(1, (m - (0.15 - opts.moss * 0.4)) * 5));
      c = mix(c, mix(moss, [40, 70, 30], fine * 0.5 + 0.5), mk * 0.85);
      h += mk * 0.05;
    }
    if (opts.dark) c = mix(c, [c[0] * 0.5, c[1] * 0.5, c[2] * 0.52], opts.dark);
    return [c[0], c[1], c[2], h];
  });
}

function ground(size: number, a: number, b: number, c2: number, freq: number, seed = 0): TexSet {
  const A = hex(a), B = hex(b), C = hex(c2);
  return paint(size, (x, y) => {
    const n = fbm(x + seed, y, size, freq, 5);
    const m = fbm(x, y + seed, size, freq * 4, 3);
    let c = mix(A, B, Math.max(0, Math.min(1, n * 1.5 + 0.5)));
    c = mix(c, C, Math.max(0, m) * 0.6);
    const pebble = fbm(x * 1.0, y * 1.0, size, 48, 2);
    if (pebble > 0.32) c = mix(c, [150, 140, 120], (pebble - 0.32) * 3);
    return [c[0], c[1], c[2], 0.5 + n * 0.3 + pebble * 0.3];
  });
}

function planks(size: number): TexSet {
  const rand = mulberry32(31);
  const tints = Array.from({ length: 16 }, () => rand());
  return paint(size, (x, y) => {
    const n = 4, w = size / n;
    const i = Math.floor(x / w);
    const lx = x - i * w;
    const t = tints[i];
    const grain = Math.sin((y / size) * 60 + fbm(x, y, size, 4, 3) * 12 + t * 10) * 0.5 + 0.5;
    let c: RGB = mix([120, 82, 48], [86, 58, 34], grain * 0.6 + t * 0.4);
    let h = 0.6 + grain * 0.2;
    if (lx < 2 || lx > w - 2) { c = mix(c, [40, 26, 16], 0.8); h = 0.2; }
    const knot = fbm(x * 2, y * 2, size, 6, 2);
    if (knot > 0.45) c = mix(c, [60, 40, 22], (knot - 0.45) * 4);
    return [c[0], c[1], c[2], h];
  });
}

function bark(size: number): TexSet {
  return paint(size, (x, y) => {
    const n = fbm(x * 3, y * 0.4, size, 6, 4);
    const ridge = Math.abs(Math.sin((x / size) * Math.PI * 14 + n * 6));
    const c = mix([88, 70, 52], [48, 38, 28], ridge * 0.8);
    const m = fbm(x, y, size, 5, 3);
    const cc = m > 0.2 ? mix(c, [64, 90, 44], (m - 0.2) * 2) : c;
    return [cc[0], cc[1], cc[2], 1 - ridge * 0.7];
  });
}

function rock(size: number, base = 0x7a7064): TexSet {
  const B = hex(base);
  return paint(size, (x, y) => {
    const n = fbm(x, y, size, 4, 6);
    const crack = Math.abs(fbm(x + 33, y + 77, size, 6, 3));
    let c = mix(B, [B[0] * 0.6, B[1] * 0.6, B[2] * 0.6], Math.max(0, n + 0.3));
    let h = 0.5 + n * 0.5;
    if (crack < 0.03) { c = mix(c, [30, 26, 22], 0.7); h = 0.1; }
    const strata = Math.sin((y / size) * 40 + n * 4) * 0.5 + 0.5;
    c = mix(c, [c[0] * 1.1, c[1] * 1.05, c[2] * 1.0], strata * 0.3);
    return [c[0], c[1], c[2], h];
  });
}

function carved(size: number, base: number): TexSet {
  // glyph relief panels: repeating stylised glyph shapes with mortar border
  const B = hex(base);
  const c = canvas(size), ctx = c.getContext('2d')!;
  const bump = canvas(size), bctx = bump.getContext('2d')!;
  const stone = masonry(size, base, 0x5a5040, 2, 2, { seed: 11 });
  ctx.drawImage((stone.map as THREE.CanvasTexture).image as HTMLCanvasElement, 0, 0);
  bctx.fillStyle = '#b4b4b4';
  bctx.fillRect(0, 0, size, size);
  const rand = mulberry32(99);
  const cell = size / 4;
  ctx.lineCap = bctx.lineCap = 'round';
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const cx = gx * cell + cell / 2, cy = gy * cell + cell / 2;
      const kind = Math.floor(rand() * 5);
      for (const [g, col, w] of [[ctx, `rgba(${B[0] * 0.45},${B[1] * 0.42},${B[2] * 0.38},0.9)`, 6], [bctx, '#303030', 6]] as const) {
        g.strokeStyle = col; g.lineWidth = w;
        g.beginPath();
        if (kind === 0) { g.arc(cx, cy, cell * 0.3, 0, Math.PI * 2); g.moveTo(cx - cell * 0.1, cy); g.arc(cx, cy, cell * 0.1, Math.PI, Math.PI * 3); }
        else if (kind === 1) { g.moveTo(cx - cell * 0.3, cy + cell * 0.3); g.lineTo(cx, cy - cell * 0.3); g.lineTo(cx + cell * 0.3, cy + cell * 0.3); g.closePath(); g.moveTo(cx, cy - cell * 0.05); g.lineTo(cx, cy + cell * 0.2); }
        else if (kind === 2) { for (let k = 0; k < 3; k++) { g.moveTo(cx - cell * 0.3, cy - cell * 0.2 + k * cell * 0.2); g.quadraticCurveTo(cx, cy - cell * 0.35 + k * cell * 0.2, cx + cell * 0.3, cy - cell * 0.2 + k * cell * 0.2); } }
        else if (kind === 3) { g.ellipse(cx, cy, cell * 0.32, cell * 0.18, 0, 0, Math.PI * 2); g.moveTo(cx + cell * 0.08, cy); g.arc(cx, cy, cell * 0.08, 0, Math.PI * 2); }
        else { g.rect(cx - cell * 0.28, cy - cell * 0.28, cell * 0.56, cell * 0.56); g.moveTo(cx - cell * 0.28, cy); g.lineTo(cx + cell * 0.28, cy); g.moveTo(cx, cy - cell * 0.28); g.lineTo(cx, cy + cell * 0.28); }
        g.stroke();
      }
    }
  }
  return { map: toTexture(c), bump: toTexture(bump, false) };
}

function leaves(size: number, tint: number): TexSet {
  // alpha-tested leaf cluster card
  const T = hex(tint);
  const c = canvas(size), ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  const rand = mulberry32(5 + tint);
  for (let i = 0; i < 70; i++) {
    const x = size * (0.1 + rand() * 0.8), y = size * (0.1 + rand() * 0.8);
    const a = rand() * Math.PI * 2, l = size * (0.08 + rand() * 0.1), w = l * 0.38;
    const k = 0.6 + rand() * 0.5;
    ctx.fillStyle = `rgb(${T[0] * k | 0},${T[1] * k | 0},${T[2] * k | 0})`;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.ellipse(0, 0, l, w, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(20,40,10,0.5)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-l, 0); ctx.lineTo(l, 0); ctx.stroke();
    ctx.restore();
  }
  return { map: toTexture(c, true, false) };
}

function fern(size: number): TexSet {
  const c = canvas(size), ctx = c.getContext('2d')!;
  const rand = mulberry32(77);
  for (let f = 0; f < 5; f++) {
    const ang = -Math.PI / 2 + (f - 2) * 0.35;
    const len = size * (0.38 + rand() * 0.1);
    const bx = size / 2, by = size;
    ctx.strokeStyle = '#2f4a1c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(bx, by);
    const ex = bx + Math.cos(ang) * len * 2.2, ey = by + Math.sin(ang) * len * 2.2;
    ctx.quadraticCurveTo(bx + Math.cos(ang) * len, by + Math.sin(ang) * len * 1.6, ex, ey); ctx.stroke();
    for (let i = 1; i < 18; i++) {
      const t = i / 18;
      const px = bx + (ex - bx) * t, py = by + (ey - by) * t + Math.sin(t * Math.PI) * 20;
      const l = (1 - t) * size * 0.12 + 4;
      for (const s of [-1, 1]) {
        ctx.fillStyle = `rgb(${50 + rand() * 30 | 0},${100 + rand() * 50 | 0},${30 + rand() * 20 | 0})`;
        ctx.save(); ctx.translate(px, py); ctx.rotate(ang + s * 1.2);
        ctx.beginPath(); ctx.ellipse(l / 2, 0, l / 2, 3.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
  }
  return { map: toTexture(c, true, false) };
}

function vines(size: number): TexSet {
  const c = canvas(size), ctx = c.getContext('2d')!;
  const rand = mulberry32(21);
  for (let v = 0; v < 9; v++) {
    let x = rand() * size;
    ctx.strokeStyle = '#3b4a22'; ctx.lineWidth = 3 + rand() * 3;
    ctx.beginPath(); ctx.moveTo(x, 0);
    for (let y = 0; y <= size; y += 8) { x += (rand() - 0.5) * 6; ctx.lineTo(x, y); }
    ctx.stroke();
    for (let y = 0; y < size; y += 10 + rand() * 10) {
      ctx.fillStyle = `rgb(${40 + rand() * 30 | 0},${90 + rand() * 50 | 0},${30 + rand() * 20 | 0})`;
      const lx = x + (rand() - 0.5) * 40;
      ctx.beginPath(); ctx.ellipse(lx, y, 7, 4, rand() * 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  return { map: toTexture(c, true, true) };
}

function waterNormal(size: number): THREE.Texture {
  const c = canvas(size), ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const h = (x: number, y: number) => fbm(x, y, size, 6, 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
    const i = (y * size + x) * 4;
    img.data[i] = 128 + dx * 600; img.data[i + 1] = 128 + dy * 600; img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}

function metal(size: number, base: number): TexSet {
  const B = hex(base);
  return paint(size, (x, y) => {
    const n = fbm(x, y, size, 10, 3);
    const c = mix(B, [Math.min(255, B[0] * 1.3), Math.min(255, B[1] * 1.3), Math.min(255, B[2] * 1.2)], n * 0.5 + 0.5);
    return [c[0], c[1], c[2], 0.5 + n * 0.2];
  });
}

export function flameTexture(): THREE.Texture {
  const s = 128, c = canvas(s), ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s * 0.62, 2, s / 2, s * 0.55, s * 0.45);
  g.addColorStop(0, 'rgba(255,255,220,1)');
  g.addColorStop(0.25, 'rgba(255,210,90,0.95)');
  g.addColorStop(0.55, 'rgba(255,110,20,0.6)');
  g.addColorStop(1, 'rgba(120,20,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(s / 2, s * 0.05);
  ctx.bezierCurveTo(s * 0.85, s * 0.45, s * 0.8, s * 0.95, s / 2, s * 0.95);
  ctx.bezierCurveTo(s * 0.2, s * 0.95, s * 0.15, s * 0.45, s / 2, s * 0.05);
  ctx.fill();
  return toTexture(c, true, false);
}

export function softDot(color = '255,255,255'): THREE.Texture {
  const s = 64, c = canvas(s), ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, `rgba(${color},1)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return toTexture(c, true, false);
}

export function parchmentCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = fbm(x, y, 256, 6, 4);
    const edge = Math.min(x, y, w - x, h - y) / 40;
    const k = Math.min(1, edge);
    const i = (y * w + x) * 4;
    img.data[i] = (222 + n * 40) * (0.7 + 0.3 * k);
    img.data[i + 1] = (200 + n * 36) * (0.68 + 0.32 * k);
    img.data[i + 2] = (150 + n * 30) * (0.6 + 0.4 * k);
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** All shared texture sets, generated once at boot. */
export class TextureBank {
  sets: Record<string, TexSet> = {};
  water!: THREE.Texture;
  flame!: THREE.Texture;
  dot!: THREE.Texture;

  generate(quality: 'low' | 'medium' | 'high') {
    const S = quality === 'low' ? 256 : 512;
    const s = 256;
    this.sets.sandstone = masonry(S, 0xb8a47e, 0x6e6250, 6, 3, { seed: 3, jitter: 0.3 });
    this.sets.mossy = masonry(S, 0xa09878, 0x5a5444, 6, 3, { seed: 4, moss: 0.6, jitter: 0.3 });
    this.sets.flag = masonry(S, 0xa89878, 0x5c5242, 4, 4, { seed: 5, moss: 0.25 });
    this.sets.dungeon = masonry(S, 0x6c645a, 0x2c2822, 7, 3, { seed: 6, dark: 0.2, jitter: 0.2 });
    this.sets.dungeonFloor = masonry(S, 0x5e584e, 0x26221c, 4, 4, { seed: 8, dark: 0.15 });
    this.sets.carved = carved(S, 0xb0a07a);
    this.sets.carvedDark = carved(s, 0x6c645a);
    this.sets.dirt = ground(s, 0x6a5038, 0x4a3826, 0x7a6a3a, 6, 10);
    this.sets.jungle = ground(S, 0x4a5a26, 0x3a3420, 0x5e6e2c, 5, 40);
    this.sets.riverbed = ground(s, 0x5a5444, 0x3a3a30, 0x6a6450, 8, 70);
    this.sets.rock = rock(S);
    this.sets.cliff = rock(S, 0x8a7a68);
    this.sets.wood = planks(s);
    this.sets.bark = bark(s);
    this.sets.leaves = leaves(s, 0x3f7a2a);
    this.sets.leaves2 = leaves(s, 0x5a8a30);
    this.sets.fern = fern(s);
    this.sets.vines = vines(s);
    this.sets.gold = metal(128, 0xc89a30);
    this.sets.bronze = metal(128, 0x8a6030);
    this.sets.iron = metal(128, 0x3a3836);
    this.water = waterNormal(256);
    this.flame = flameTexture();
    this.dot = softDot();
  }
}
