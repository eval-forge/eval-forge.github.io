/**
 * Procedural textures drawn on canvases at startup. Nothing is loaded from disk.
 * Each texture can also produce a normal map derived from its height channel.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';

type RGB = [number, number, number];

// ------------------------------------------------------------ tileable value noise

class Noise2 {
  private p: Float32Array;
  constructor(private size: number, seed: number) {
    const rng = new Rng(seed);
    this.p = new Float32Array(size * size);
    for (let i = 0; i < this.p.length; i++) this.p[i] = rng.next();
  }
  private v(x: number, y: number) {
    const s = this.size;
    return this.p[(((y % s) + s) % s) * s + (((x % s) + s) % s)];
  }
  /** Smooth tileable value noise; x,y in lattice units. */
  get(x: number, y: number) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const w = yf * yf * (3 - 2 * yf);
    const a = this.v(xi, yi);
    const b = this.v(xi + 1, yi);
    const c = this.v(xi, yi + 1);
    const d = this.v(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  }
}

/** Fractal noise over a tile of `px` pixels with `base` lattice cells across (tileable). */
function fbmField(px: number, base: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(px * px);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = base << o;
    const n = new Noise2(cells, seed + o * 101);
    const scale = cells / px;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) out[y * px + x] += n.get(x * scale, y * scale) * amp;
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export interface TexPair {
  map: THREE.CanvasTexture;
  normal?: THREE.CanvasTexture;
}

function makeCanvas(px: number) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  return c;
}

function finishTexture(canvas: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Normal map from a height field (Sobel), tileable. */
function normalFromHeight(h: Float32Array, px: number, strength: number): THREE.CanvasTexture {
  const c = makeCanvas(px);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  const at = (x: number, y: number) => h[((y + px) % px) * px + ((x + px) % px)];
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength;
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength;
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * px + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(c, false);
}

function writeRGB(img: ImageData, i: number, c: RGB) {
  img.data[i * 4] = Math.max(0, Math.min(255, c[0]));
  img.data[i * 4 + 1] = Math.max(0, Math.min(255, c[1]));
  img.data[i * 4 + 2] = Math.max(0, Math.min(255, c[2]));
  img.data[i * 4 + 3] = 255;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------ generators

/** Temple masonry: offset stone blocks with mortar, per-block tint, chips and optional moss. */
function masonry(px: number, rows: number, cols: number, base: RGB, mortar: RGB, moss: number, seed: number): { canvas: HTMLCanvasElement; height: Float32Array } {
  const c = makeCanvas(px);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  const rng = new Rng(seed);
  const n1 = fbmField(px, 8, 5, seed);
  const n2 = fbmField(px, 4, 4, seed + 7);
  const height = new Float32Array(px * px);
  const rowH = px / rows;
  const tints: number[] = [];
  for (let i = 0; i < rows * cols * 2; i++) tints.push(rng.range(-0.12, 0.12));
  for (let y = 0; y < px; y++) {
    const r = Math.floor(y / rowH);
    const offset = (r % 2) * 0.5;
    for (let x = 0; x < px; x++) {
      const colW = px / cols;
      const fx = x / colW + offset;
      const cidx = Math.floor(fx);
      const lx = fx - cidx;
      const ly = (y - r * rowH) / rowH;
      const edge = Math.min(lx * colW, (1 - lx) * colW, ly * rowH, (1 - ly) * rowH);
      const noise = n1[y * px + x];
      const mortarW = 2.2 + n2[y * px + x] * 2.5;
      const i = y * px + x;
      const tint = tints[(r * cols + (((cidx % cols) + cols) % cols)) % tints.length];
      if (edge < mortarW) {
        const m = mix(mortar, [mortar[0] * 0.7, mortar[1] * 0.7, mortar[2] * 0.7], noise);
        writeRGB(img, i, m);
        height[i] = 0.1 + noise * 0.1;
      } else {
        const bevel = Math.min(1, (edge - mortarW) / 5);
        let col: RGB = [base[0] * (1 + tint), base[1] * (1 + tint), base[2] * (1 + tint)];
        col = mix(col, [col[0] * 0.62, col[1] * 0.62, col[2] * 0.62], Math.pow(noise, 1.5));
        // chips / pits
        if (noise > 0.72) col = mix(col, [col[0] * 0.7, col[1] * 0.7, col[2] * 0.7], (noise - 0.72) * 3);
        // moss favours the top of each block
        if (moss > 0) {
          const m = Math.max(0, n2[i] * 1.6 - 0.75 + (1 - ly) * 0.25) * moss;
          col = mix(col, [58, 82, 38], Math.min(1, m));
        }
        writeRGB(img, i, col);
        height[i] = 0.5 + bevel * 0.35 + noise * 0.25;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, height };
}

/** Rough natural rock / cliff. */
function rock(px: number, base: RGB, dark: RGB, seed: number, moss = 0): { canvas: HTMLCanvasElement; height: Float32Array } {
  const c = makeCanvas(px);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  const n = fbmField(px, 4, 6, seed);
  const n2 = fbmField(px, 16, 3, seed + 3);
  const nm = fbmField(px, 3, 4, seed + 9);
  const height = new Float32Array(px * px);
  for (let i = 0; i < px * px; i++) {
    const v = n[i] * 0.75 + n2[i] * 0.25;
    // strata
    const y = Math.floor(i / px);
    const strata = Math.sin(y * 0.09 + n[i] * 6) * 0.5 + 0.5;
    let col = mix(dark, base, Math.min(1, v * 1.2 + strata * 0.15));
    if (moss > 0) col = mix(col, [52, 78, 36], Math.max(0, nm[i] * 1.8 - 0.9) * moss);
    writeRGB(img, i, col);
    height[i] = v;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, height };
}

/** Large floor slabs. */
function slabs(px: number, n: number, base: RGB, seed: number, dirt: number): { canvas: HTMLCanvasElement; height: Float32Array } {
  const c = makeCanvas(px);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  const rng = new Rng(seed);
  const f = fbmField(px, 8, 5, seed);
  const d = fbmField(px, 3, 4, seed + 5);
  const height = new Float32Array(px * px);
  const cell = px / n;
  const tints: number[] = [];
  for (let i = 0; i < n * n; i++) tints.push(rng.range(-0.1, 0.1));
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const lx = x - cx * cell;
      const ly = y - cy * cell;
      const edge = Math.min(lx, cell - lx, ly, cell - ly);
      const i = y * px + x;
      const t = tints[cy * n + cx];
      let col: RGB = [base[0] * (1 + t), base[1] * (1 + t), base[2] * (1 + t)];
      col = mix(col, [col[0] * 0.65, col[1] * 0.65, col[2] * 0.65], f[i]);
      col = mix(col, [70, 58, 40], Math.max(0, d[i] * 1.5 - 0.7) * dirt);
      if (edge < 2.5) {
        col = [col[0] * 0.45, col[1] * 0.45, col[2] * 0.45];
        height[i] = 0.1;
      } else height[i] = 0.55 + f[i] * 0.3 + Math.min(1, edge / 6) * 0.15;
      writeRGB(img, i, col);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, height };
}

/** Wood planks. */
function wood(px: number, base: RGB, seed: number): { canvas: HTMLCanvasElement; height: Float32Array } {
  const c = makeCanvas(px);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  const n = fbmField(px, 4, 4, seed);
  const height = new Float32Array(px * px);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const i = y * px + x;
      const grain = Math.sin((x * 0.15 + n[i] * 18) * 1.0) * 0.5 + 0.5;
      const plank = Math.floor(y / (px / 4));
      const seam = (y % (px / 4)) < 2 ? 0.45 : 1;
      let col: RGB = [base[0] * (0.8 + plank * 0.06), base[1] * (0.8 + plank * 0.05), base[2] * (0.8 + plank * 0.04)];
      col = mix(col, [col[0] * 0.6, col[1] * 0.55, col[2] * 0.5], grain * 0.6);
      col = [col[0] * seam, col[1] * seam, col[2] * seam];
      writeRGB(img, i, col);
      height[i] = grain * 0.4 + (seam < 1 ? 0 : 0.5);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, height };
}

/** Jungle ground: soil, leaf litter and grass. */
function ground(px: number, seed: number): { canvas: HTMLCanvasElement; height: Float32Array } {
  const c = makeCanvas(px);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  const n = fbmField(px, 6, 6, seed);
  const g = fbmField(px, 3, 4, seed + 1);
  const rng = new Rng(seed);
  const height = new Float32Array(px * px);
  for (let i = 0; i < px * px; i++) {
    const soil: RGB = [86, 66, 44];
    const grass: RGB = [62, 98, 40];
    let col = mix(soil, grass, Math.min(1, Math.max(0, g[i] * 1.8 - 0.55)));
    col = mix(col, [col[0] * 0.6, col[1] * 0.6, col[2] * 0.6], n[i]);
    if (rng.next() < 0.02) col = mix(col, [120, 100, 50], 0.5); // litter speckles
    writeRGB(img, i, col);
    height[i] = n[i];
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, height };
}

/** Alpha-tested leaf card: several leaves on transparent background. */
function leafCard(px: number, seed: number, color: RGB, fronds: boolean): HTMLCanvasElement {
  const c = makeCanvas(px);
  const ctx = c.getContext('2d')!;
  const rng = new Rng(seed);
  ctx.clearRect(0, 0, px, px);
  const draw = (x: number, y: number, len: number, ang: number, w: number, shade: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const grd = ctx.createLinearGradient(0, 0, len, 0);
    const r = Math.floor(color[0] * shade);
    const g = Math.floor(color[1] * shade);
    const b = Math.floor(color[2] * shade);
    grd.addColorStop(0, `rgb(${r * 0.7},${g * 0.7},${b * 0.7})`);
    grd.addColorStop(1, `rgb(${r},${g},${b})`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.5, -w, len, 0);
    ctx.quadraticCurveTo(len * 0.5, w, 0, 0);
    ctx.fill();
    ctx.strokeStyle = `rgba(20,40,10,0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
    ctx.restore();
  };
  if (fronds) {
    // a palm-like frond: central stem with many thin leaflets
    ctx.strokeStyle = 'rgb(70,90,40)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px * 0.5, px);
    ctx.lineTo(px * 0.5, 0);
    ctx.stroke();
    for (let y = px * 0.95; y > px * 0.03; y -= 6) {
      const l = (px * 0.42) * Math.sin(((px - y) / px) * Math.PI) + 8;
      draw(px * 0.5, y, l, -Math.PI + 0.35 + rng.range(-0.1, 0.1), 3.5, rng.range(0.8, 1.1));
      draw(px * 0.5, y, l, -0.35 + rng.range(-0.1, 0.1), 3.5, rng.range(0.8, 1.1));
    }
  } else {
    for (let i = 0; i < 26; i++) {
      const x = rng.range(px * 0.15, px * 0.85);
      const y = rng.range(px * 0.15, px * 0.85);
      draw(x, y, rng.range(px * 0.18, px * 0.3), rng.range(0, Math.PI * 2), rng.range(px * 0.05, px * 0.09), rng.range(0.75, 1.15));
    }
  }
  return c;
}

/** Grass tuft card. */
function grassCard(px: number, seed: number): HTMLCanvasElement {
  const c = makeCanvas(px);
  const ctx = c.getContext('2d')!;
  const rng = new Rng(seed);
  for (let i = 0; i < 46; i++) {
    const x = rng.range(px * 0.1, px * 0.9);
    const h = rng.range(px * 0.4, px * 0.98);
    const bend = rng.range(-px * 0.15, px * 0.15);
    const g = Math.floor(rng.range(80, 140));
    ctx.strokeStyle = `rgb(${Math.floor(g * 0.5)},${g},${Math.floor(g * 0.3)})`;
    ctx.lineWidth = rng.range(1.5, 3);
    ctx.beginPath();
    ctx.moveTo(x, px);
    ctx.quadraticCurveTo(x + bend * 0.3, px - h * 0.6, x + bend, px - h);
    ctx.stroke();
  }
  return c;
}

/** Glyph sheet: 12 carved sun glyphs in a 4×3 grid, white on transparent. */
function glyphSheet(px: number): HTMLCanvasElement {
  const c = makeCanvas(px);
  const ctx = c.getContext('2d')!;
  const cell = px / 4;
  ctx.fillStyle = 'rgb(150,140,120)';
  ctx.fillRect(0, 0, px, px);
  ctx.strokeStyle = 'rgb(40,32,24)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const cx = (i % 4) * cell + cell / 2;
    const cy = Math.floor(i / 4) * cell + cell / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, cell * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    const rays = 3 + (i % 5);
    for (let r = 0; r < rays; r++) {
      const a = (r / rays) * Math.PI * 2 + i * 0.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * cell * 0.22, Math.sin(a) * cell * 0.22);
      ctx.lineTo(Math.cos(a) * cell * (0.34 + (i % 3) * 0.03), Math.sin(a) * cell * (0.34 + (i % 3) * 0.03));
      ctx.stroke();
    }
    // a different inner mark per glyph
    ctx.beginPath();
    if (i % 3 === 0) {
      ctx.moveTo(-cell * 0.08, 0);
      ctx.lineTo(cell * 0.08, 0);
    } else if (i % 3 === 1) {
      ctx.arc(0, 0, cell * 0.05, 0, Math.PI * 2);
    } else {
      ctx.moveTo(0, -cell * 0.08);
      ctx.lineTo(0, cell * 0.08);
    }
    ctx.stroke();
    ctx.restore();
  }
  return c;
}

/** Water ripple normal map (tileable). */
function waterNormal(px: number, seed: number): THREE.CanvasTexture {
  const h = fbmField(px, 8, 4, seed);
  return normalFromHeight(h, px, 2.5);
}

// ------------------------------------------------------------ library

export interface TextureLibrary {
  templeWall: TexPair;
  templeWallMoss: TexPair;
  dungeonWall: TexPair;
  floorSlab: TexPair;
  dungeonFloor: TexPair;
  rock: TexPair;
  rockMoss: TexPair;
  wood: TexPair;
  ground: TexPair;
  bark: TexPair;
  leaves: THREE.CanvasTexture;
  palm: THREE.CanvasTexture;
  grass: THREE.CanvasTexture;
  glyphs: THREE.CanvasTexture;
  waterNormal: THREE.CanvasTexture;
  sandbag: TexPair;
}

let lib: TextureLibrary | null = null;

export function textures(): TextureLibrary {
  if (lib) return lib;
  const pair = (r: { canvas: HTMLCanvasElement; height: Float32Array }, px: number, strength: number): TexPair => ({
    map: finishTexture(r.canvas),
    normal: normalFromHeight(r.height, px, strength),
  });
  const P = 256;
  lib = {
    templeWall: pair(masonry(P, 4, 2, [176, 158, 124], [92, 82, 66], 0, 11), P, 3),
    templeWallMoss: pair(masonry(P, 4, 2, [160, 150, 118], [80, 76, 58], 1, 12), P, 3),
    dungeonWall: pair(masonry(P, 4, 2, [128, 118, 104], [60, 54, 46], 0, 13), P, 3.5),
    floorSlab: pair(slabs(P, 2, [168, 152, 120], 14, 0.6), P, 2.5),
    dungeonFloor: pair(slabs(P, 2, [116, 106, 92], 15, 0.3), P, 2.5),
    rock: pair(rock(P, [150, 136, 116], [70, 62, 54], 16), P, 4),
    rockMoss: pair(rock(P, [138, 130, 108], [62, 60, 48], 17, 1), P, 4),
    wood: pair(wood(P, [130, 92, 56], 18), P, 2),
    ground: pair(ground(P, 19), P, 2),
    bark: pair(rock(P, [104, 82, 60], [52, 40, 30], 20), P, 3),
    leaves: finishTexture(leafCard(256, 21, [70, 130, 50], false)),
    palm: finishTexture(leafCard(256, 22, [80, 140, 60], true)),
    grass: finishTexture(grassCard(128, 23)),
    glyphs: finishTexture(glyphSheet(256)),
    waterNormal: waterNormal(256, 24),
    sandbag: pair(rock(128, [170, 150, 110], [120, 100, 70], 25), 128, 2),
  };
  for (const t of [lib.leaves, lib.palm, lib.grass]) {
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  }
  return lib;
}

/** Parchment background for the hand-drawn map. */
export function parchmentCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const px = 256;
  const f = fbmField(px, 6, 5, 77);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = f[(y % px) * px + (x % px)];
      const ex = Math.min(x, w - x, y, h - y) / 40;
      const burn = Math.max(0, 1 - Math.min(1, ex));
      const col: RGB = mix([226, 206, 160], [176, 146, 98], n * 0.8 + burn * 0.6);
      writeRGB(img, y * w + x, col);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
