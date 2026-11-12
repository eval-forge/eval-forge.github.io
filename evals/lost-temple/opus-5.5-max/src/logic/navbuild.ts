/**
 * Builds navmesh polygons from level geometry: walkable rectangles are rasterized on a 0.5 m
 * grid, obstacles (dilated by the agent radius) are cut out, and the remaining cells are
 * greedily merged into rectangles. Ramps are added as sloped rectangles.
 */
import type { NavPoly } from './navmesh';

export interface WalkRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
  scene: string;
  gate?: string | null;
}

export interface ObstacleBox {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
}

export interface RampRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Height at the low end of `axis` (x0 or z0) and at the high end (x1 or z1). */
  yStart: number;
  yEnd: number;
  axis: 'x' | 'z';
  scene: string;
  gate?: string | null;
}

export interface NavBuildOptions {
  cell: number;
  agentRadius: number;
  agentHeight: number;
  stepHeight: number;
  maxRect: number;
}

export const DEFAULT_NAV_OPTIONS: NavBuildOptions = { cell: 0.5, agentRadius: 0.45, agentHeight: 1.9, stepHeight: 0.45, maxRect: 6 };

type Poly = Omit<NavPoly, 'id'>;

export function buildNavPolys(walks: WalkRect[], obstacles: ObstacleBox[], ramps: RampRect[], options: Partial<NavBuildOptions> = {}): NavPoly[] {
  const o = { ...DEFAULT_NAV_OPTIONS, ...options };
  const out: Poly[] = [];
  const groups = new Map<string, WalkRect[]>();
  for (const w of walks) {
    const k = `${w.scene}|${w.y.toFixed(2)}|${w.gate ?? ''}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(w);
  }
  const gateRects = walks.filter((w) => w.gate);

  for (const [, rects] of groups) {
    const y = rects[0].y;
    const scene = rects[0].scene;
    const gate = rects[0].gate ?? null;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.x0);
      minZ = Math.min(minZ, r.z0);
      maxX = Math.max(maxX, r.x1);
      maxZ = Math.max(maxZ, r.z1);
    }
    const c = o.cell;
    const gx0 = Math.floor(minX / c + 1e-6);
    const gz0 = Math.floor(minZ / c + 1e-6);
    const nx = Math.ceil(maxX / c - 1e-6) - gx0;
    const nz = Math.ceil(maxZ / c - 1e-6) - gz0;
    if (nx <= 0 || nz <= 0) continue;
    const grid = new Uint8Array(nx * nz);
    const cxOf = (i: number) => (gx0 + i + 0.5) * c;
    const czOf = (j: number) => (gz0 + j + 0.5) * c;
    for (const r of rects) {
      const i0 = Math.max(0, Math.floor(r.x0 / c - gx0 + 1e-6));
      const i1 = Math.min(nx, Math.ceil(r.x1 / c - gx0 - 1e-6));
      const j0 = Math.max(0, Math.floor(r.z0 / c - gz0 + 1e-6));
      const j1 = Math.min(nz, Math.ceil(r.z1 / c - gz0 - 1e-6));
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) {
          const x = cxOf(i);
          const z = czOf(j);
          if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) grid[j * nx + i] = 1;
        }
    }
    // Gates carve their area out of the ordinary floor at the same height.
    if (!gate) {
      for (const gr of gateRects) {
        if (gr.scene !== scene || Math.abs(gr.y - y) > 0.05) continue;
        for (let j = 0; j < nz; j++)
          for (let i = 0; i < nx; i++) {
            const x = cxOf(i);
            const z = czOf(j);
            if (x > gr.x0 && x < gr.x1 && z > gr.z0 && z < gr.z1) grid[j * nx + i] = 0;
          }
      }
    }
    // Obstacles in the agent's height band, dilated by its radius.
    for (const ob of obstacles) {
      if (ob.y0 >= y + o.agentHeight || ob.y1 <= y + o.stepHeight) continue;
      const x0 = ob.x0 - o.agentRadius;
      const x1 = ob.x1 + o.agentRadius;
      const z0 = ob.z0 - o.agentRadius;
      const z1 = ob.z1 + o.agentRadius;
      if (x1 < minX || x0 > maxX || z1 < minZ || z0 > maxZ) continue;
      const i0 = Math.max(0, Math.floor(x0 / c - gx0));
      const i1 = Math.min(nx, Math.ceil(x1 / c - gx0));
      const j0 = Math.max(0, Math.floor(z0 / c - gz0));
      const j1 = Math.min(nz, Math.ceil(z1 / c - gz0));
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) {
          const x = cxOf(i);
          const z = czOf(j);
          if (x > x0 && x < x1 && z > z0 && z < z1) grid[j * nx + i] = 0;
        }
    }
    // Greedy merge into rectangles.
    const maxCells = Math.max(1, Math.round(o.maxRect / c));
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        if (grid[j * nx + i] !== 1) continue;
        let w = 1;
        while (i + w < nx && w < maxCells && grid[j * nx + i + w] === 1) w++;
        let h = 1;
        outer: while (j + h < nz && h < maxCells) {
          for (let k = 0; k < w; k++) if (grid[(j + h) * nx + i + k] !== 1) break outer;
          h++;
        }
        for (let jj = 0; jj < h; jj++) for (let ii = 0; ii < w; ii++) grid[(j + jj) * nx + i + ii] = 2;
        const x0 = (gx0 + i) * c;
        const z0 = (gz0 + j) * c;
        const x1 = x0 + w * c;
        const z1 = z0 + h * c;
        out.push({ x0, z0, x1, z1, a: 0, b: 0, c: y, scene, gate, enabled: true, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 });
      }
  }

  for (const r of ramps) {
    let a = 0;
    let b = 0;
    let cc = 0;
    if (r.axis === 'x') {
      a = (r.yEnd - r.yStart) / (r.x1 - r.x0);
      cc = r.yStart - a * r.x0;
    } else {
      b = (r.yEnd - r.yStart) / (r.z1 - r.z0);
      cc = r.yStart - b * r.z0;
    }
    out.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, a, b, c: cc, scene: r.scene, gate: r.gate ?? null, enabled: true, cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2 });
  }
  return out.map((p, i) => ({ ...p, id: i }));
}
