/**
 * Procedural textures drawn on canvases at startup. Albedo maps are sRGB; normal maps are
 * derived from the same height field with a Sobel filter. Nothing is loaded from disk.
 */
import * as THREE from 'three';
import { TileNoise } from './noise';
import { mulberry32 } from '../logic/rng';

export interface TexSet {
  map: THREE.Texture;
  normal?: THREE.Texture;
  rough?: THREE.Texture;
}

type RGB = [number, number, number];

function mkCanvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return { c, ctx };
}

function toTexture(canvas: HTMLCanvasElement, srgb: boolean, anisotropy = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Build albedo (and optional normal/roughness) from per-pixel functions. */
function generate(
  size: number,
  fn: (u: number, v: number, x: number, y: number) => { rgb: RGB; h: number; r?: number },
  normalStrength = 2.5,
  withRough = false,
): TexSet {
  const { c, ctx } = mkCanvas(size);
  const img = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const rough = withRough ? new Uint8ClampedArray(size * size * 4) : null;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = fn(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, o.rgb[0] * 255));
      img.data[i + 1] = Math.max(0, Math.min(255, o.rgb[1] * 255));
      img.data[i + 2] = Math.max(0, Math.min(255, o.rgb[2] * 255));
      img.data[i + 3] = 255;
      height[y * size + x] = o.h;
      if (rough) {
        const rv = Math.max(0, Math.min(255, (o.r ?? 0.8) * 255));
        rough[i] = rv;
        rough[i + 1] = rv;
        rough[i + 2] = rv;
        rough[i + 3] = 255;
      }
    }
  ctx.putImageData(img, 0, 0);
  const set: TexSet = { map: toTexture(c, true) };
  if (normalStrength > 0) set.normal = heightToNormal(height, size, normalStrength);
  if (rough) {
    const r = mkCanvas(size);
    r.ctx.putImageData(new ImageData(rough, size, size), 0, 0);
    set.rough = toTexture(r.c, false);
  }
  return set;
}

function heightToNormal(h: Float32Array, size: number, strength: number): THREE.Texture {
  const { c, ctx } = mkCanvas(size);
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength;
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength;
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const sstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Periodic running-bond masonry: each row has blocks whose widths sum to the tile width. */
interface MasonryRow {
  shift: number;
  edges: number[];
}
function masonryLayout(size: number, rows: number, minW: number, maxW: number, seed: number): MasonryRow[] {
  const r = mulberry32(seed);
  const out: MasonryRow[] = [];
  for (let i = 0; i < rows; i++) {
    const ws: number[] = [];
    let sum = 0;
    while (sum < size) {
      const w = minW + r() * (maxW - minW);
      ws.push(w);
      sum += w;
    }
    const k = size / sum;
    const edges: number[] = [];
    let acc = 0;
    for (const w of ws) {
      acc += w * k;
      edges.push(acc);
    }
    edges[edges.length - 1] = size;
    out.push({ shift: r() * size, edges });
  }
  return out;
}
function masonryAt(layout: MasonryRow[], x: number, y: number, size: number) {
  const rows = layout.length;
  const rowH = size / rows;
  const row = Math.min(rows - 1, Math.floor(y / rowH));
  const ly = y - row * rowH;
  const R = layout[row];
  const xs = (x + R.shift) % size;
  let i = 0;
  while (i < R.edges.length - 1 && R.edges[i] <= xs) i++;
  const x0 = i === 0 ? 0 : R.edges[i - 1];
  const x1 = R.edges[i];
  // distances across the wrap seam are handled by treating 0 and size as the same edge
  const dEdge = Math.min(xs - x0, x1 - xs, ly, rowH - ly);
  return { id: row * 97 + i, d: dEdge, row };
}

export interface TextureLibrary {
  sandstone: TexSet;
  floorTiles: TexSet;
  dungeon: TexSet;
  rock: TexSet;
  bark: TexSet;
  wood: TexSet;
  ground: TexSet;
  gold: TexSet;
  water: TexSet;
  rope: TexSet;
  bone: TexSet;
  burlap: TexSet;
  clay: TexSet;
  jade: TexSet;
  glyphs: TexSet;
  sunstone: TexSet;
  leaf: TexSet;
  plaster: TexSet;
}

export function buildTextures(quality: 'low' | 'medium' | 'high'): TextureLibrary {
  const S = quality === 'low' ? 256 : 512;
  const s2 = quality === 'low' ? 128 : 256;
  const n = new TileNoise(11);
  const n2 = new TileNoise(23);
  const rnd = mulberry32(5);
  const wallLayout = masonryLayout(512, 8, 90, 210, 17);
  const dungeonLayout = masonryLayout(512, 10, 60, 150, 29);

  // --- sandstone masonry (temple walls) ------------------------------------
  const sandstone = generate(
    S,
    (u, v, x, y) => {
      const sx = (x / S) * 512;
      const sy = (y / S) * 512;
      const m = masonryAt(wallLayout, sx, sy, 512);
      const br = mulberry32(m.id * 31 + 7)();
      const grain = n.fbm(u, v, 24, 4);
      const big = n2.fbm(u, v, 4, 3);
      const mortar = 1 - sstep(1.5, 5, m.d);
      const edge = 1 - sstep(3, 16, m.d);
      let col: RGB = mix3([0.74, 0.6, 0.42], [0.82, 0.7, 0.5], br);
      col = mix3(col, [0.62, 0.5, 0.36], big * 0.5);
      col = col.map((c) => c * (0.82 + grain * 0.32)) as RGB;
      col = col.map((c) => c * (1 - edge * 0.18)) as RGB;
      // chips and cracks
      const crack = Math.abs(n.noise(u + br, v * 1.7, 18) - 0.5) < 0.012 && br > 0.55 ? 1 : 0;
      col = mix3(col, [0.33, 0.27, 0.2], Math.max(mortar * 0.85, crack * 0.7));
      const h = (1 - mortar) * (0.75 + grain * 0.25) - edge * 0.15 - crack * 0.4;
      return { rgb: col, h, r: 0.85 + mortar * 0.1 };
    },
    3,
  );

  // --- floor slabs -------------------------------------------------------------
  const floorTiles = generate(
    S,
    (u, v, x, y) => {
      const t = 4;
      const fx = u * t;
      const fy = v * t;
      const ix = Math.floor(fx + (Math.floor(fy) % 2) * 0.5);
      const iy = Math.floor(fy);
      const lx = fx + (Math.floor(fy) % 2) * 0.5 - ix;
      const ly = fy - iy;
      const d = Math.min(lx, 1 - lx, ly, 1 - ly) * (S / t);
      const br = mulberry32(ix * 131 + iy * 17 + 3)();
      const grain = n.fbm(u, v, 20, 4);
      const wear = n2.fbm(u, v, 6, 3);
      const mortar = 1 - sstep(1.5, 4.5, d);
      let col: RGB = mix3([0.6, 0.54, 0.45], [0.72, 0.64, 0.52], br);
      col = col.map((c) => c * (0.8 + grain * 0.35) * (0.9 + wear * 0.2)) as RGB;
      col = mix3(col, [0.25, 0.22, 0.18], mortar * 0.9);
      return { rgb: col, h: (1 - mortar) * (0.8 + grain * 0.2), r: 0.8 };
    },
    3,
  );

  // --- dungeon stone (zone C) ----------------------------------------------------
  const dungeon = generate(
    S,
    (u, v, x, y) => {
      const sx = (x / S) * 512;
      const sy = (y / S) * 512;
      const m = masonryAt(dungeonLayout, sx, sy, 512);
      const br = mulberry32(m.id * 17 + 3)();
      const grain = n.fbm(u, v, 30, 4);
      const stain = n2.fbm(u, v, 5, 3);
      const mortar = 1 - sstep(1.5, 5, m.d);
      const bulge = sstep(0, 22, m.d);
      let col: RGB = mix3([0.36, 0.34, 0.31], [0.46, 0.43, 0.38], br);
      col = col.map((c) => c * (0.75 + grain * 0.4)) as RGB;
      col = mix3(col, [0.2, 0.22, 0.18], stain * stain * 0.6);
      col = mix3(col, [0.12, 0.11, 0.1], mortar * 0.9);
      return { rgb: col, h: (1 - mortar) * (0.6 + bulge * 0.3 + grain * 0.2), r: 0.65 + stain * 0.3 };
    },
    4,
    true,
  );

  // --- rock (cliffs, gorge, boulders) --------------------------------------------
  const rock = generate(
    S,
    (u, v) => {
      const f = n.fbm(u, v, 6, 5, 0.55);
      const r2 = 1 - Math.abs(n2.fbm(u, v, 8, 4) * 2 - 1);
      const strata = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 14 + f * 6);
      let col: RGB = mix3([0.36, 0.33, 0.29], [0.56, 0.52, 0.46], f);
      col = mix3(col, [0.46, 0.4, 0.32], strata * 0.25);
      col = col.map((c) => c * (0.8 + r2 * 0.3)) as RGB;
      return { rgb: col, h: f * 0.7 + r2 * 0.4 + strata * 0.1 };
    },
    5,
  );

  // --- bark -------------------------------------------------------------------
  const bark = generate(
    s2,
    (u, v) => {
      const f = n.fbm(u * 1, v, 4, 3);
      const streak = n2.fbm(u, v * 0.125, 24, 3);
      const ridges = Math.abs(Math.sin((u * 18 + f * 3) * Math.PI));
      let col: RGB = mix3([0.22, 0.17, 0.12], [0.38, 0.31, 0.22], streak);
      col = col.map((c) => c * (0.7 + ridges * 0.4)) as RGB;
      return { rgb: col, h: ridges * 0.8 + streak * 0.2 };
    },
    4,
  );

  // --- wood planks --------------------------------------------------------------
  const wood = generate(
    s2,
    (u, v) => {
      const ring = Math.sin((v * 6 + n.fbm(u, v, 3, 3) * 4) * Math.PI * 2) * 0.5 + 0.5;
      const fiber = n2.fbm(u * 0.25, v, 64, 2);
      let col: RGB = mix3([0.36, 0.25, 0.15], [0.52, 0.38, 0.24], ring * 0.6 + fiber * 0.4);
      const knot = sstep(0.06, 0.0, Math.hypot(((u * 2) % 1) - 0.6, v - 0.4) - 0.0);
      col = mix3(col, [0.2, 0.13, 0.08], knot * 0.6);
      return { rgb: col, h: fiber * 0.6 + ring * 0.2 };
    },
    2,
  );

  // --- jungle ground --------------------------------------------------------------
  const ground = generate(
    S,
    (u, v) => {
      const f = n.fbm(u, v, 8, 5);
      const leaves = n2.fbm(u, v, 32, 2);
      const blot = sstep(0.55, 0.7, n.fbm(u + 0.3, v + 0.7, 12, 3));
      let col: RGB = mix3([0.22, 0.17, 0.1], [0.33, 0.26, 0.16], f);
      col = mix3(col, [0.2, 0.26, 0.1], leaves * 0.6);
      col = mix3(col, [0.42, 0.3, 0.14], blot * 0.5);
      return { rgb: col, h: f * 0.6 + leaves * 0.4 };
    },
    3,
  );

  // --- gold ------------------------------------------------------------------------
  const gold = generate(
    s2,
    (u, v) => {
      const f = n.fbm(u, v, 8, 4);
      const col = mix3([0.78, 0.55, 0.16], [1.0, 0.8, 0.36], f);
      return { rgb: col, h: f * 0.3, r: 0.25 + f * 0.25 };
    },
    1,
    true,
  );

  // --- water normal map -------------------------------------------------------------
  const water = generate(
    s2,
    (u, v) => {
      const f = n.fbm(u, v, 6, 5, 0.55);
      return { rgb: [0.1, 0.2, 0.22], h: f };
    },
    6,
  );

  // --- rope -----------------------------------------------------------------------------
  const rope = generate(
    128,
    (u, v) => {
      const s = Math.sin((u * 8 + v * 8) * Math.PI * 2) * 0.5 + 0.5;
      const f = n.fbm(u, v, 16, 2);
      const col = mix3([0.4, 0.31, 0.18], [0.66, 0.54, 0.34], s * 0.7 + f * 0.3);
      return { rgb: col, h: s };
    },
    3,
  );

  // --- bone ----------------------------------------------------------------------------
  const bone = generate(
    s2,
    (u, v) => {
      const f = n.fbm(u, v, 10, 4);
      const pores = n2.noise(u, v, 64) > 0.82 ? 1 : 0;
      let col: RGB = mix3([0.72, 0.66, 0.54], [0.86, 0.8, 0.68], f);
      col = mix3(col, [0.45, 0.4, 0.32], pores * 0.6);
      return { rgb: col, h: f - pores * 0.3 };
    },
    2,
  );

  // --- burlap (sandbags) -----------------------------------------------------------------
  const burlap = generate(
    128,
    (u, v) => {
      const wx = Math.sin(u * Math.PI * 2 * 24) * 0.5 + 0.5;
      const wy = Math.sin(v * Math.PI * 2 * 24) * 0.5 + 0.5;
      const f = n.fbm(u, v, 8, 3);
      const col = mix3([0.45, 0.36, 0.22], [0.62, 0.52, 0.34], (wx * wy) * 0.6 + f * 0.4);
      return { rgb: col, h: wx * wy };
    },
    2,
  );

  // --- terracotta -------------------------------------------------------------------------
  const clay = generate(
    s2,
    (u, v) => {
      const f = n.fbm(u, v, 8, 4);
      const band = sstep(0.45, 0.5, Math.abs(Math.sin(v * Math.PI * 6)));
      let col: RGB = mix3([0.55, 0.3, 0.18], [0.7, 0.42, 0.26], f);
      col = mix3(col, [0.22, 0.12, 0.08], band * 0.5);
      return { rgb: col, h: f * 0.4 };
    },
    1,
  );

  // --- jade -------------------------------------------------------------------------------
  const jade = generate(
    s2,
    (u, v) => {
      const f = n.fbm(u, v, 4, 5, 0.6);
      const vein = 1 - sstep(0.0, 0.05, Math.abs(f - 0.5));
      const col = mix3(mix3([0.15, 0.45, 0.3], [0.45, 0.75, 0.55], f), [0.85, 0.95, 0.85], vein * 0.6);
      return { rgb: col, h: f * 0.2, r: 0.3 };
    },
    0.5,
    true,
  );

  // --- carved glyph panels -----------------------------------------------------------------
  const glyphs = (() => {
    const mask = mkCanvas(S);
    mask.ctx.fillStyle = '#000';
    mask.ctx.fillRect(0, 0, S, S);
    drawGlyphs(mask.ctx, S, mulberry32(99));
    const m = mask.ctx.getImageData(0, 0, S, S).data;
    return generate(
      S,
      (u, v, x, y) => {
        const k = m[(y * S + x) * 4] / 255;
        const grain = n.fbm(u, v, 24, 4);
        let col: RGB = [0.7 * (0.85 + grain * 0.3), 0.6 * (0.85 + grain * 0.3), 0.44 * (0.85 + grain * 0.3)];
        col = mix3(col, [0.28, 0.22, 0.15], k * 0.8);
        return { rgb: col, h: grain * 0.2 - k * 0.6 };
      },
      3,
    );
  })();

  // --- sunstone (glows when sunlit, translucent when not) -------------------------------------
  const sunstone = generate(
    s2,
    (u, v) => {
      const f = n.fbm(u, v, 6, 4);
      const facet = Math.abs(Math.sin((u + v * 0.6) * Math.PI * 8 + f * 4));
      const col = mix3([0.85, 0.6, 0.2], [1.0, 0.86, 0.45], facet * 0.6 + f * 0.4);
      return { rgb: col, h: facet * 0.5 };
    },
    2,
  );

  // --- leaf / foliage tint noise ------------------------------------------------------------------
  const leaf = generate(
    s2,
    (u, v) => {
      const f = n.fbm(u, v, 12, 4);
      const vein = 1 - sstep(0, 0.04, Math.abs(Math.sin((u * 10 + v * 3) * Math.PI)) * 0.5);
      let col: RGB = mix3([0.16, 0.32, 0.08], [0.32, 0.5, 0.14], f);
      col = mix3(col, [0.4, 0.55, 0.2], vein * 0.2);
      return { rgb: col, h: f * 0.3 + vein * 0.2 };
    },
    1.5,
  );

  // --- old plaster (painted inner walls of the halls) ------------------------------------------------
  const plaster = generate(
    S,
    (u, v) => {
      const f = n.fbm(u, v, 6, 5);
      const flake = sstep(0.58, 0.62, n2.fbm(u, v, 10, 4));
      const band = v > 0.42 && v < 0.5 ? 1 : 0;
      let col: RGB = mix3([0.72, 0.62, 0.48], [0.8, 0.72, 0.58], f);
      col = mix3(col, [0.55, 0.22, 0.14], band * (1 - flake) * 0.8);
      col = mix3(col, [0.6, 0.5, 0.38], flake * 0.7);
      return { rgb: col, h: f * 0.3 - flake * 0.4 };
    },
    2,
  );

  void rnd;
  return { sandstone, floorTiles, dungeon, rock, bark, wood, ground, gold, water, rope, bone, burlap, clay, jade, glyphs, sunstone, leaf, plaster };
}

/** Carved glyphs in a 4x4 grid, white strokes on the given context. */
export function drawGlyphs(g: CanvasRenderingContext2D, S: number, r: () => number) {
  const cell = S / 4;
  g.strokeStyle = '#fff';
  g.lineWidth = S / 80;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let gy = 0; gy < 4; gy++)
    for (let gx = 0; gx < 4; gx++) {
      const k = Math.floor(r() * 6);
      g.save();
      g.translate(gx * cell + cell / 2, gy * cell + cell / 2);
      g.beginPath();
      g.rect(-cell * 0.42, -cell * 0.42, cell * 0.84, cell * 0.84);
      if (k === 0) {
        g.moveTo(cell * 0.25, 0);
        g.arc(0, 0, cell * 0.25, 0, Math.PI * 2);
        g.moveTo(cell * 0.08, 0);
        g.arc(0, 0, cell * 0.08, 0, Math.PI * 2);
      } else if (k === 1) {
        for (let t = 0; t < 30; t++) {
          const a = t * 0.5;
          const rr = t * cell * 0.011;
          if (t === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
      } else if (k === 2) {
        g.moveTo(cell * 0.3, 0);
        g.ellipse(0, 0, cell * 0.3, cell * 0.16, 0, 0, Math.PI * 2);
        g.moveTo(cell * 0.09, 0);
        g.arc(0, 0, cell * 0.09, 0, Math.PI * 2);
      } else if (k === 3) {
        g.moveTo(-cell * 0.3, cell * 0.25);
        g.lineTo(0, -cell * 0.3);
        g.lineTo(cell * 0.3, cell * 0.25);
        g.closePath();
      } else if (k === 4) {
        for (let i = -2; i <= 2; i++) {
          g.moveTo(i * cell * 0.12, -cell * 0.3);
          g.lineTo(i * cell * 0.12 + cell * 0.06, cell * 0.3);
        }
      } else {
        g.moveTo(-cell * 0.3, 0);
        for (let i = 0; i <= 12; i++) g.lineTo(-cell * 0.3 + i * cell * 0.05, Math.sin(i * 1.2) * cell * 0.15);
      }
      g.stroke();
      g.restore();
    }
}

/** Flame sprite texture for torches (radial gradient, additive). */
export function flameTexture(): THREE.Texture {
  const { c, ctx } = mkCanvas(128);
  const g = ctx.createRadialGradient(64, 80, 4, 64, 70, 60);
  g.addColorStop(0, 'rgba(255,250,220,1)');
  g.addColorStop(0.25, 'rgba(255,200,90,0.9)');
  g.addColorStop(0.55, 'rgba(255,110,20,0.45)');
  g.addColorStop(1, 'rgba(120,20,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(64, 2);
  ctx.bezierCurveTo(100, 50, 120, 90, 64, 126);
  ctx.bezierCurveTo(8, 90, 28, 50, 64, 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft round particle (dust, sparks, splashes). */
export function softDotTexture(): THREE.Texture {
  const { c, ctx } = mkCanvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
