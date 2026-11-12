import * as THREE from 'three';
import { mulberry32 } from '../logic/rng';

/** Procedural canvas textures. Everything is drawn in code. */

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

/** Tileable value noise sampled on a grid. */
function valueNoise(size: number, cells: number, seed: number): Float32Array {
  const rnd = mulberry32(seed);
  const g = new Float32Array(cells * cells).map(() => rnd());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * cells, fy = (y / size) * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[(y0 % cells) * cells + (x0 % cells)], b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
    const c = g[((y0 + 1) % cells) * cells + (x0 % cells)], d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
    out[y * size + x] = (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  }
  return out;
}

function fbm(size: number, seed: number, octaves = 4, base = 4): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, base << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function toTexture(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type RGB = [number, number, number];
function paint(size: number, f: (x: number, y: number, i: number) => RGB): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const [r, g, b] = f(x, y, i);
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const S = 256;

function masonry(seed: number, base: RGB, moss: number): HTMLCanvasElement {
  const n = fbm(S, seed, 5, 4);
  const m = fbm(S, seed + 7, 4, 2);
  const rnd = mulberry32(seed);
  const rows = 4, rowH = S / rows;
  const tint: number[] = [];
  for (let i = 0; i < 64; i++) tint.push(0.8 + rnd() * 0.35);
  return paint(S, (x, y, i) => {
    const row = Math.floor(y / rowH);
    const off = (row % 2) * (S / 4);
    const bw = S / 2;
    const col = Math.floor(((x + off) % S) / bw);
    const lx = ((x + off) % bw), ly = y % rowH;
    const mortar = lx < 3 || ly < 3 ? 1 : 0;
    const t = tint[(row * 4 + col) % 64];
    let k = (0.65 + 0.5 * n[i]) * t;
    if (mortar) k *= 0.45;
    let [r, g, b] = base.map((v) => v * k) as RGB;
    const mv = Math.max(0, m[i] - (1 - moss)) / Math.max(0.001, moss);
    if (moss > 0 && mv > 0) {
      const mm = Math.min(1, mv * 1.6);
      r = r * (1 - mm) + 60 * mm * (0.6 + n[i]);
      g = g * (1 - mm) + 95 * mm * (0.6 + n[i]);
      b = b * (1 - mm) + 35 * mm * (0.6 + n[i]);
    }
    return [r, g, b];
  });
}

function rough(seed: number, base: RGB, contrast = 0.6, cracks = true): HTMLCanvasElement {
  const n = fbm(S, seed, 6, 4);
  const v = fbm(S, seed + 3, 3, 8);
  return paint(S, (_x, _y, i) => {
    let k = 1 - contrast / 2 + contrast * n[i];
    if (cracks && Math.abs(v[i] - 0.5) < 0.012) k *= 0.5;
    return base.map((c) => Math.min(255, c * k)) as RGB;
  });
}

function wood(seed: number): HTMLCanvasElement {
  const n = fbm(S, seed, 4, 4);
  return paint(S, (x, y, i) => {
    const grain = 0.5 + 0.5 * Math.sin((x * 0.15 + n[i] * 10));
    const plank = (y % 64) < 2 ? 0.5 : 1;
    const k = (0.6 + 0.3 * grain + 0.2 * n[i]) * plank;
    return [120 * k, 80 * k, 45 * k];
  });
}

function ground(seed: number): HTMLCanvasElement {
  const n = fbm(S, seed, 6, 4);
  const g = fbm(S, seed + 9, 4, 3);
  const rnd = mulberry32(seed);
  const c = paint(S, (_x, _y, i) => {
    const k = 0.6 + 0.6 * n[i];
    const gr = Math.min(1, Math.max(0, (g[i] - 0.35) * 2.2));
    return [(78 * (1 - gr) + 52 * gr) * k, (60 * (1 - gr) + 82 * gr) * k, (38 * (1 - gr) + 30 * gr) * k];
  });
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(30,45,20,0.6)' : 'rgba(120,100,70,0.4)';
    ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  return c;
}

function leaves(seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(S);
  const rnd = mulberry32(seed);
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 22, a = rnd() * Math.PI;
    const g = 70 + rnd() * 70;
    ctx.fillStyle = `rgb(${20 + rnd() * 30},${g},${15 + rnd() * 25})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.38, a, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,30,5,0.5)';
    ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke();
  }
  return c;
}

function fern(seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(S);
  const rnd = mulberry32(seed);
  ctx.clearRect(0, 0, S, S);
  for (let f = 0; f < 7; f++) {
    const bx = S / 2 + (rnd() - 0.5) * 40, ang = -Math.PI / 2 + (rnd() - 0.5) * 1.6;
    const len = S * (0.55 + rnd() * 0.4);
    ctx.strokeStyle = 'rgb(40,80,25)'; ctx.lineWidth = 3;
    const ex = bx + Math.cos(ang) * len, ey = S + Math.sin(ang) * len;
    ctx.beginPath(); ctx.moveTo(bx, S); ctx.lineTo(ex, ey); ctx.stroke();
    for (let k = 0.1; k < 1; k += 0.07) {
      const px = bx + (ex - bx) * k, py = S + (ey - S) * k, l = 26 * (1 - k * 0.8);
      ctx.fillStyle = `rgb(${30 + rnd() * 20},${90 + rnd() * 50},${25})`;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(px + Math.cos(ang + s * 1.2) * l * 0.5, py + Math.sin(ang + s * 1.2) * l * 0.5, l * 0.55, 4, ang + s * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return c;
}

function bark(seed: number): HTMLCanvasElement {
  const n = fbm(S, seed, 5, 4);
  return paint(S, (x, _y, i) => {
    const s = 0.6 + 0.4 * Math.abs(Math.sin(x * 0.2 + n[i] * 8));
    const k = s * (0.6 + 0.5 * n[i]);
    return [85 * k, 66 * k, 48 * k];
  });
}

function rope(): HTMLCanvasElement {
  return paint(64, (x, y) => {
    const k = 0.7 + 0.3 * Math.sin((x + y) * 0.8);
    return [150 * k, 120 * k, 75 * k];
  });
}

function metal(seed: number, base: RGB): HTMLCanvasElement { return rough(seed, base, 0.35, false); }

export interface TextureSet {
  stone: THREE.Texture; mossStone: THREE.Texture; darkStone: THREE.Texture; caveRock: THREE.Texture;
  cliff: THREE.Texture; ground: THREE.Texture; plaza: THREE.Texture; wood: THREE.Texture; leaves: THREE.Texture;
  fern: THREE.Texture; bark: THREE.Texture; rope: THREE.Texture; bronze: THREE.Texture; gold: THREE.Texture;
}

let cached: TextureSet | null = null;
export function textures(): TextureSet {
  if (cached) return cached;
  cached = {
    stone: toTexture(masonry(11, [170, 150, 120], 0)),
    mossStone: toTexture(masonry(12, [150, 140, 110], 0.55)),
    darkStone: toTexture(masonry(13, [95, 88, 80], 0.0)),
    caveRock: toTexture(rough(14, [90, 82, 74], 0.8)),
    cliff: toTexture(rough(15, [130, 118, 100], 0.9)),
    ground: toTexture(ground(16)),
    plaza: toTexture(masonry(17, [160, 148, 125], 0.3)),
    wood: toTexture(wood(18)),
    leaves: toTexture(leaves(19)),
    fern: toTexture(fern(20)),
    bark: toTexture(bark(21)),
    rope: toTexture(rope()),
    bronze: toTexture(metal(22, [150, 100, 50])),
    gold: toTexture(metal(23, [230, 180, 60])),
  };
  return cached;
}

/** Material palette shared across scenes. No emissive anywhere (zone C must be truly dark). */
export interface Mats {
  stone: THREE.MeshStandardMaterial; mossStone: THREE.MeshStandardMaterial; darkStone: THREE.MeshStandardMaterial;
  cave: THREE.MeshStandardMaterial; cliff: THREE.MeshStandardMaterial; ground: THREE.MeshStandardMaterial;
  plaza: THREE.MeshStandardMaterial; wood: THREE.MeshStandardMaterial; leaves: THREE.MeshStandardMaterial;
  fern: THREE.MeshStandardMaterial; bark: THREE.MeshStandardMaterial; rope: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial; gold: THREE.MeshStandardMaterial; iron: THREE.MeshStandardMaterial;
  bone: THREE.MeshStandardMaterial; cloth: THREE.MeshStandardMaterial; water: THREE.MeshStandardMaterial;
  marker: THREE.MeshStandardMaterial; crackedStone: THREE.MeshStandardMaterial; sunTile: THREE.MeshStandardMaterial;
}

let mats: Mats | null = null;
export function materials(): Mats {
  if (mats) return mats;
  const t = textures();
  const std = (map: THREE.Texture | null, color = 0xffffff, rough = 0.92, metal = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ map, color, roughness: rough, metalness: metal, ...(map ? { bumpMap: map, bumpScale: 1.2 } : {}), ...extra });
  mats = {
    stone: std(t.stone),
    mossStone: std(t.mossStone),
    darkStone: std(t.darkStone),
    cave: std(t.caveRock),
    cliff: std(t.cliff),
    ground: std(t.ground, 0xffffff, 1),
    plaza: std(t.plaza),
    wood: std(t.wood, 0xffffff, 0.85),
    leaves: new THREE.MeshStandardMaterial({ map: t.leaves, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, transparent: false }),
    fern: new THREE.MeshStandardMaterial({ map: t.fern, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }),
    bark: std(t.bark),
    rope: std(t.rope, 0xffffff, 1),
    bronze: std(t.bronze, 0xffffff, 0.45, 0.8),
    gold: std(t.gold, 0xffffff, 0.3, 1),
    iron: std(null, 0x3a3a40, 0.55, 0.9),
    bone: std(null, 0xd8ceb4, 0.8),
    cloth: std(null, 0x8a7350, 1),
    water: new THREE.MeshStandardMaterial({ color: 0x2c5a55, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.78, depthWrite: false }),
    marker: std(null, 0xc8b070, 0.6),
    crackedStone: std(t.darkStone, 0xb09080),
    sunTile: std(t.plaza, 0xf0d8a0),
  };
  return mats;
}
