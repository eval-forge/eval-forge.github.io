import { parchmentCanvas } from '../world/Textures';
import { NAV_POLYS } from '../world/layout';
import { mulberry32 } from '../logic/rng';

/**
 * Hand-drawn exploration map. The world is split into 4 m cells; cells near the
 * player are marked explored and drawn in wobbly ink. Two sheets: surface/ruins
 * and the underground.
 */
const CELL = 4;
export class MapView {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private paper: HTMLCanvasElement;
  open = false;

  constructor() {
    this.el = document.getElementById('map')!;
    this.canvas = document.getElementById('mapCanvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.paper = parchmentCanvas(this.canvas.width, this.canvas.height);
  }

  toggle(v?: boolean) {
    this.open = v ?? !this.open;
    this.el.style.display = this.open ? 'flex' : 'none';
  }

  static key(x: number, y: number, z: number) {
    const layer = y < -6 ? 1 : 0;
    return `${layer}:${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
  }

  /** Mark cells around the player as explored. */
  static explore(set: Set<string>, x: number, y: number, z: number, radius: number) {
    const r = Math.ceil(radius / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const layer = y < -6 ? 1 : 0;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (i * i + j * j > r * r) continue;
      set.add(`${layer}:${cx + i}:${cz + j}`);
    }
  }

  draw(explored: Set<string>, px: number, py: number, pz: number, yaw: number, labels: { x: number; z: number; y: number; text: string }[]) {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    c.drawImage(this.paper, 0, 0);
    const under = py < -6;
    // world window per sheet
    const view = under ? { x0: -45, x1: 45, z0: -222, z1: -45 } : { x0: -50, x1: 120, z0: -118, z1: 212 };
    const sx = (W - 60) / (view.x1 - view.x0), sz = (H - 60) / (view.z1 - view.z0);
    const s = Math.min(sx, sz);
    const ox = 30 + ((W - 60) - (view.x1 - view.x0) * s) / 2, oz = 30 + ((H - 60) - (view.z1 - view.z0) * s) / 2;
    const tx = (x: number) => ox + (x - view.x0) * s;
    const tz = (z: number) => oz + (z - view.z0) * s;
    const layer = under ? 1 : 0;
    // explored cells as faint wash
    c.fillStyle = 'rgba(120,90,50,0.18)';
    for (const k of explored) {
      const [l, i, j] = k.split(':').map(Number);
      if (l !== layer) continue;
      c.fillRect(tx(i * CELL), tz(j * CELL), CELL * s + 0.5, CELL * s + 0.5);
    }
    // ink outlines of known floors (navmesh rects + outdoor regions) clipped to explored cells
    const rand = mulberry32(5);
    c.strokeStyle = 'rgba(50,30,15,0.85)';
    c.lineWidth = 1.6;
    const wobbleRect = (x0: number, z0: number, x1: number, z1: number) => {
      c.beginPath();
      const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i];
        const wx = tx(x) + (rand() - 0.5) * 1.6, wz = tz(z) + (rand() - 0.5) * 1.6;
        if (i === 0) c.moveTo(wx, wz); else c.lineTo(wx, wz);
      }
      c.stroke();
    };
    const known = (x: number, z: number, y: number) => explored.has(MapView.key(x, y, z));
    const outdoor: [number, number, number, number][] = under ? [] : [[-30, 95, 30, 208], [-45, 10, 45, 95], [45, 12, 70, 90], [70, 12, 97, 14.5], [56, 12, 103, 14], [97, 26.4, 105, 35], [70, 30, 97, 32.2]];
    for (const r of outdoor) if (known((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, 0) || known(r[0] + 2, r[1] + 2, 0) || known(r[2] - 2, r[3] - 2, 0)) wobbleRect(r[0], r[1], r[2], r[3]);
    for (const p of NAV_POLYS) {
      const xs = p.verts.map((v) => v.x), zs = p.verts.map((v) => v.z);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const y = p.y0;
      if ((y < -6) !== under) continue;
      let seen = false;
      for (let x = x0 + 1; x < x1 && !seen; x += CELL) for (let z = z0 + 1; z < z1 && !seen; z += CELL) if (known(x, z, y)) seen = true;
      if (seen) wobbleRect(x0, z0, x1, z1);
    }
    c.fillStyle = 'rgba(60,35,15,0.9)';
    c.font = 'italic 13px Georgia, serif';
    for (const l of labels) {
      if ((l.y < -6) !== under || !known(l.x, l.z, l.y)) continue;
      c.fillText(l.text, tx(l.x) - c.measureText(l.text).width / 2, tz(l.z));
    }
    // player arrow
    c.save();
    c.translate(tx(px), tz(pz));
    c.rotate(-yaw);
    c.fillStyle = '#8a1a10';
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 3); c.lineTo(-6, 7); c.closePath(); c.fill();
    c.restore();
    c.fillStyle = 'rgba(60,35,15,0.9)';
    c.font = 'bold 18px Georgia, serif';
    c.fillText(under ? 'Beneath the Temple' : 'The Approach & the Ruins', 30, 26);
  }
}
