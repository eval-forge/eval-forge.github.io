/**
 * The hand-drawn map (M / Tab): two parchment sheets drawn in code, one for the surface and the
 * temple halls, one for everything below. Ink only shows where you have been: a reveal mask is
 * stamped around you as you walk. Places you used (doors, the sundial, sconces, the key) get an
 * inked cross and a label. The game keeps running while the map is open.
 */
import type { SceneId } from '../logic/unlocks';
import { SCENE_INFO } from '../logic/unlocks';
import { SCENES } from '../world/scenes';

type SheetId = 'surface' | 'below';

interface Sheet {
  id: SheetId;
  title: string;
  scenes: SceneId[];
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  ppm: number;
  w: number;
  h: number;
  parchment: HTMLCanvasElement;
  ink: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  comp: HTMLCanvasElement;
  dirty: boolean;
}

interface Mark {
  sheet: SheetId;
  x: number;
  z: number;
  label: string;
}

const BELOW: SceneId[] = ['catacombs', 'vault'];

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Small deterministic RNG for the paper and the wobbly ink. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export class MapView {
  root: HTMLDivElement;
  private view: HTMLCanvasElement;
  private sheets: Record<SheetId, Sheet>;
  private marks: Mark[] = [];
  visible = false;
  private drawT = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'map';
    this.root.classList.add('hidden');
    this.view = document.createElement('canvas');
    this.root.appendChild(this.view);
    parent.appendChild(this.root);
    this.sheets = {
      surface: this.makeSheet('surface', 'The Temple Grounds', ['jungle', 'courtyard', 'cliffs', 'halls', 'sanctum'], -68, -116, 102, 196, 2.4),
      below: this.makeSheet('below', 'Below the Temple', BELOW, -40, -162, 42, -52, 7),
    };
  }

  private makeSheet(id: SheetId, title: string, scenes: SceneId[], x0: number, z0: number, x1: number, z1: number, ppm: number): Sheet {
    const w = Math.round((x1 - x0) * ppm);
    const h = Math.round((z1 - z0) * ppm);
    const s: Sheet = { id, title, scenes, x0, z0, x1, z1, ppm, w, h, parchment: canvas(w, h), ink: canvas(w, h), mask: canvas(w, h), comp: canvas(w, h), dirty: true };
    this.paintParchment(s);
    this.paintInk(s);
    return s;
  }

  private px(s: Sheet, x: number, z: number): [number, number] {
    return [(x - s.x0) * s.ppm, (z - s.z0) * s.ppm];
  }

  private paintParchment(s: Sheet) {
    const g = s.parchment.getContext('2d')!;
    const r = rng(s.id === 'surface' ? 91 : 37);
    g.fillStyle = '#d8c296';
    g.fillRect(0, 0, s.w, s.h);
    // blotches
    for (let i = 0; i < 260; i++) {
      const x = r() * s.w;
      const y = r() * s.h;
      const rad = 6 + r() * 40;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const dark = r() < 0.6;
      gr.addColorStop(0, dark ? 'rgba(120,85,40,0.08)' : 'rgba(255,245,215,0.10)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // fibres
    g.strokeStyle = 'rgba(110,80,40,0.07)';
    g.lineWidth = 1;
    for (let i = 0; i < 500; i++) {
      const x = r() * s.w;
      const y = r() * s.h;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 18, y + (r() - 0.5) * 4);
      g.stroke();
    }
    // a coffee ring
    g.strokeStyle = 'rgba(110,70,30,0.18)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(s.w * 0.78, s.h * 0.86, Math.min(s.w, s.h) * 0.09, 0.3, 5.6);
    g.stroke();
    // darkened, singed edges
    const edge = g.createRadialGradient(s.w / 2, s.h / 2, Math.min(s.w, s.h) * 0.32, s.w / 2, s.h / 2, Math.hypot(s.w, s.h) * 0.55);
    edge.addColorStop(0, 'rgba(80,50,20,0)');
    edge.addColorStop(1, 'rgba(70,40,15,0.55)');
    g.fillStyle = edge;
    g.fillRect(0, 0, s.w, s.h);
    // ragged border cut-outs
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 160; i++) {
      const side = i % 4;
      const t = r();
      const x = side === 0 ? t * s.w : side === 1 ? s.w : side === 2 ? t * s.w : 0;
      const y = side === 0 ? 0 : side === 1 ? t * s.h : side === 2 ? s.h : t * s.h;
      g.beginPath();
      g.arc(x, y, 2 + r() * 7, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    // title and compass (always visible: they are written on the sheet, not discovered)
    g.fillStyle = 'rgba(60,38,18,0.85)';
    g.font = `italic ${Math.round(Math.max(16, s.w * 0.06))}px Georgia, serif`;
    g.textAlign = 'center';
    g.fillText(s.title, s.w / 2, Math.max(26, s.h * 0.035));
    const cx = s.w - 34;
    const cy = 50;
    g.strokeStyle = 'rgba(60,38,18,0.8)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx, cy + 18);
    g.lineTo(cx, cy - 18);
    g.moveTo(cx - 12, cy);
    g.lineTo(cx + 12, cy);
    g.stroke();
    g.fillStyle = 'rgba(60,38,18,0.85)';
    g.beginPath();
    g.moveTo(cx, cy - 22);
    g.lineTo(cx - 5, cy - 10);
    g.lineTo(cx + 5, cy - 10);
    g.closePath();
    g.fill();
    g.font = 'bold 12px Georgia, serif';
    g.fillText('N', cx, cy - 26);
  }

  /** Wobbly ink line between two map points. */
  private inkLine(g: CanvasRenderingContext2D, r: () => number, ax: number, ay: number, bx: number, by: number) {
    const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 10));
    g.beginPath();
    g.moveTo(ax + (r() - 0.5) * 1.2, ay + (r() - 0.5) * 1.2);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      g.lineTo(ax + (bx - ax) * t + (r() - 0.5) * 1.6, ay + (by - ay) * t + (r() - 0.5) * 1.6);
    }
    g.stroke();
  }

  private paintInk(s: Sheet) {
    const g = s.ink.getContext('2d')!;
    const r = rng(s.id === 'surface' ? 5 : 11);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const P = (x: number, z: number) => this.px(s, x, z);
    // features first, so walkable areas sit on top
    if (s.id === 'surface') {
      // the gorge, cross-hatched
      const [gx0, gy0] = P(-62, 64);
      const [gx1, gy1] = P(97, 78);
      g.strokeStyle = 'rgba(55,35,18,0.55)';
      g.lineWidth = 1;
      for (let x = gx0; x < gx1; x += 6) this.inkLine(g, r, x, gy0, x + 10, gy1);
      g.lineWidth = 2;
      this.inkLine(g, r, gx0, gy0, gx1, gy0);
      this.inkLine(g, r, gx0, gy1, gx1, gy1);
      // the river, wavy lines
      g.strokeStyle = 'rgba(40,70,90,0.7)';
      g.lineWidth = 1.2;
      for (let k = 0; k < 5; k++) {
        const z = 115.5 + k * 3.2;
        g.beginPath();
        for (let x = -62; x <= 62; x += 2) {
          const [px, py] = P(x, z + Math.sin(x * 0.4 + k) * 0.6);
          if (x === -62) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.stroke();
      }
      // the trail through the jungle
      g.strokeStyle = 'rgba(70,45,20,0.6)';
      g.setLineDash([4, 5]);
      g.lineWidth = 1.5;
      g.beginPath();
      for (let z = 186; z >= 80; z -= 2) {
        const [px, py] = P(Math.sin(z * 0.035) * 6, z);
        if (z === 186) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
      g.setLineDash([]);
      // rope bridge and the fallen tree
      g.strokeStyle = 'rgba(60,38,18,0.9)';
      g.lineWidth = 2;
      let [ax, ay] = P(1, 63);
      let [bx, by] = P(1, 79);
      this.inkLine(g, r, ax, ay, bx, by);
      [ax, ay] = P(3, 63);
      [bx, by] = P(3, 79);
      this.inkLine(g, r, ax, ay, bx, by);
      g.lineWidth = 3;
      [ax, ay] = P(-40, 57.5);
      [bx, by] = P(-40, 84);
      this.inkLine(g, r, ax, ay, bx, by);
      // sundial and the great door
      const [sx, sy] = P(0, 30);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(sx, sy, 4.2 * s.ppm, 0, Math.PI * 2);
      g.stroke();
    }
    // walkable areas of every scene on this sheet
    for (const id of s.scenes) {
      const def = SCENES[id];
      for (const [x0, z0, x1, z1] of def.mapRects ?? []) {
        const [ax, ay] = P(x0, z0);
        const [bx, by] = P(x1, z1);
        g.fillStyle = s.id === 'below' ? 'rgba(90,60,30,0.16)' : 'rgba(120,90,45,0.12)';
        g.fillRect(ax, ay, bx - ax, by - ay);
        g.strokeStyle = 'rgba(52,32,14,0.9)';
        g.lineWidth = s.id === 'below' ? 2 : 1.6;
        this.inkLine(g, r, ax, ay, bx, ay);
        this.inkLine(g, r, bx, ay, bx, by);
        this.inkLine(g, r, bx, by, ax, by);
        this.inkLine(g, r, ax, by, ax, ay);
      }
      // scene name at its largest area
      const rects = def.mapRects ?? [];
      if (rects.length) {
        const big = [...rects].sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]))[0];
        const [cx, cy] = P((big[0] + big[2]) / 2, (big[1] + big[3]) / 2);
        g.fillStyle = 'rgba(48,28,10,0.9)';
        g.font = `italic ${s.id === 'below' ? 15 : 13}px Georgia, serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(SCENE_INFO[id].name, cx, cy);
      }
    }
  }

  reset() {
    for (const s of Object.values(this.sheets)) {
      s.mask.getContext('2d')!.clearRect(0, 0, s.w, s.h);
      s.dirty = true;
    }
    this.marks = [];
  }

  private sheetFor(scene: SceneId | null): Sheet {
    return scene && BELOW.includes(scene) ? this.sheets.below : this.sheets.surface;
  }

  /** Stamp the area around the player as explored. */
  reveal(x: number, z: number, scene: SceneId | null) {
    const s = this.sheetFor(scene);
    const g = s.mask.getContext('2d')!;
    const [px, py] = this.px(s, x, z);
    const rad = (s.id === 'below' ? 9 : 15) * s.ppm;
    const gr = g.createRadialGradient(px, py, rad * 0.35, px, py, rad);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    s.dirty = true;
  }

  mark(x: number, z: number, label: string, scene: SceneId | null) {
    const sheet = this.sheetFor(scene).id;
    if (this.marks.some((m) => m.sheet === sheet && m.label === label && Math.hypot(m.x - x, m.z - z) < 3)) return;
    this.marks.push({ sheet, x, z, label });
  }

  toggle(force?: boolean) {
    this.visible = force ?? !this.visible;
    this.root.classList.toggle('hidden', !this.visible);
    this.drawT = 0;
  }

  update(dt: number, px: number, pz: number, yaw: number, scene: SceneId | null) {
    if (!this.visible) return;
    this.drawT -= dt;
    if (this.drawT > 0) return;
    this.drawT = 0.1;
    const sheets = [this.sheets.surface, this.sheets.below];
    const H = Math.min(window.innerHeight * 0.86, 820);
    const gap = 26;
    const widths = sheets.map((s) => (s.w / s.h) * H);
    let total = widths[0] + widths[1] + gap;
    const maxW = window.innerWidth * 0.94;
    const k = total > maxW ? maxW / total : 1;
    const h = H * k;
    total *= k;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.view.width = Math.round(total * dpr);
    this.view.height = Math.round(h * dpr);
    this.view.style.width = `${total}px`;
    this.view.style.height = `${h}px`;
    const g = this.view.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, total, h);
    const here = this.sheetFor(scene);
    let ox = 0;
    sheets.forEach((s, i) => {
      const w = widths[i] * k;
      if (s.dirty) {
        const c = s.comp.getContext('2d')!;
        c.globalCompositeOperation = 'source-over';
        c.clearRect(0, 0, s.w, s.h);
        c.drawImage(s.ink, 0, 0);
        c.globalCompositeOperation = 'destination-in';
        c.drawImage(s.mask, 0, 0);
        c.globalCompositeOperation = 'source-over';
        s.dirty = false;
      }
      g.save();
      g.translate(ox, 0);
      g.globalAlpha = s === here ? 1 : 0.82;
      g.drawImage(s.parchment, 0, 0, w, h);
      g.drawImage(s.comp, 0, 0, w, h);
      g.globalAlpha = 1;
      const sc = w / s.w;
      // marks
      for (const m of this.marks) {
        if (m.sheet !== s.id) continue;
        const [mx, my] = this.px(s, m.x, m.z);
        const x = mx * sc;
        const y = my * sc;
        g.strokeStyle = 'rgba(150,30,20,0.9)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x - 4, y - 4);
        g.lineTo(x + 4, y + 4);
        g.moveTo(x + 4, y - 4);
        g.lineTo(x - 4, y + 4);
        g.stroke();
        g.fillStyle = 'rgba(120,25,15,0.95)';
        g.font = 'italic 11px Georgia, serif';
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.fillText(m.label, x + 7, y);
      }
      // the player
      if (s === here) {
        const [ppx, ppy] = this.px(s, px, pz);
        const x = ppx * sc;
        const y = ppy * sc;
        const fx = -Math.sin(yaw);
        const fy = -Math.cos(yaw);
        g.fillStyle = 'rgba(170,25,15,0.95)';
        g.beginPath();
        g.moveTo(x + fx * 10, y + fy * 10);
        g.lineTo(x - fx * 5 + fy * 5.5, y - fy * 5 - fx * 5.5);
        g.lineTo(x - fx * 5 - fy * 5.5, y - fy * 5 + fx * 5.5);
        g.closePath();
        g.fill();
      }
      g.restore();
      ox += w + gap * k;
    });
    g.fillStyle = 'rgba(241,230,207,0.75)';
    g.font = 'italic 12px Georgia, serif';
    g.textAlign = 'center';
    g.fillText('M or Tab to close. The temple does not wait while you read.', total / 2, h - 8);
  }
}
