import { hash2 } from '../core/rng';
import { SCENE_INFO, SCENE_ORDER } from '../core/types';
import type { Game } from '../game/Game';
import { el } from './dom';

const X0 = -92, X1 = 44, Z0 = -142, Z1 = 130;

/**
 * The explorer's own map: parchment, ink, and only the parts they have actually walked near.
 * Underground rooms are inked in a different colour because they sit under the ones above.
 */
export class MapView {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private open = false;
  private scanT = 0;
  private drawT = 0;

  constructor(private game: Game) {
    this.root = el('div', 'mapview', document.getElementById('ui'));
    this.canvas = el('canvas', '', this.root);
    this.canvas.width = 560; this.canvas.height = 1000;
    this.ctx = this.canvas.getContext('2d')!;
    el('div', 'map-cap', this.root, 'M to close  ·  brown ink: above ground  ·  blue ink: below');
    this.root.style.display = 'none';
  }

  reset(): void { this.open = false; this.root.style.display = 'none'; }
  toggle(): void { this.open = !this.open; this.root.style.display = this.open ? '' : 'none'; this.drawT = 0; }

  private px(x: number): number { return ((x - X0) / (X1 - X0)) * this.canvas.width; }
  private pz(z: number): number { return ((z - Z0) / (Z1 - Z0)) * this.canvas.height; }

  update(dt: number): void {
    const { game } = this;
    if (game.state !== 'playing') { if (this.open) this.reset(); return; }
    // Reveal shapes of the current scene as the player comes near them.
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.4;
      const p = game.player.pos, id = game.world.current;
      game.world.defs[id].map.forEach((s, i) => {
        const dx = Math.max(s.x1 - p.x, 0, p.x - s.x2), dz = Math.max(s.z1 - p.z, 0, p.z - s.z2);
        if (Math.hypot(dx, dz) < 9) game.run.mapSeen.add(`${id}:${i}`);
      });
    }
    if (!this.open) return;
    this.drawT -= dt;
    if (this.drawT > 0) return;
    this.drawT = 0.15;
    this.draw();
  }

  /** A slightly wobbly ink line, so nothing looks ruled. */
  private wobble(x1: number, y1: number, x2: number, y2: number, seed: number): void {
    const g = this.ctx, len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(2, Math.round(len / 14));
    g.moveTo(x1 + (hash2(seed, 1) - 0.5) * 2.4, y1 + (hash2(seed, 2) - 0.5) * 2.4);
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      g.lineTo(x1 + (x2 - x1) * k + (hash2(seed + i, 3) - 0.5) * 2.6, y1 + (y2 - y1) * k + (hash2(seed + i, 4) - 0.5) * 2.6);
    }
  }

  private draw(): void {
    const g = this.ctx, { game } = this, w = this.canvas.width, h = this.canvas.height;
    g.fillStyle = '#d9c79a'; g.fillRect(0, 0, w, h);
    // Stains and fibres.
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(${110 + hash2(i, 5) * 40},${80 + hash2(i, 6) * 30},40,${0.03 + hash2(i, 7) * 0.05})`;
      g.beginPath(); g.arc(hash2(i, 8) * w, hash2(i, 9) * h, 10 + hash2(i, 10) * 60, 0, 7); g.fill();
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const id of SCENE_ORDER) {
      const def = game.world.defs[id], under = SCENE_INFO[id].zone === 'C';
      const ink = under ? '40,60,110' : '70,44,22';
      let any = false, lx = 0, lz = 0;
      def.map.forEach((s, i) => {
        if (!game.run.mapSeen.has(`${id}:${i}`)) return;
        any = true;
        const x1 = this.px(s.x1), x2 = this.px(s.x2), y1 = this.pz(s.z1), y2 = this.pz(s.z2), seed = i * 37 + SCENE_INFO[id].depthRank * 211;
        lx = (x1 + x2) / 2; lz = Math.min(lz || y1, y1);
        const kind = s.kind ?? 'room';
        g.fillStyle = kind === 'water' ? 'rgba(60,110,150,0.28)' : kind === 'pit' ? `rgba(${ink},0.3)` : kind === 'bridge' ? 'rgba(120,80,30,0.45)' : `rgba(${ink},0.09)`;
        g.fillRect(x1, y1, x2 - x1, y2 - y1);
        if (kind === 'pit') {                                   // hatching
          g.strokeStyle = `rgba(${ink},0.45)`; g.lineWidth = 1; g.beginPath();
          for (let k = x1 - (y2 - y1); k < x2; k += 6) { g.moveTo(Math.max(x1, k), y1 + Math.max(0, x1 - k)); g.lineTo(Math.min(x2, k + (y2 - y1)), y1 + Math.min(y2 - y1, x2 - k)); }
          g.stroke();
        }
        g.strokeStyle = `rgba(${ink},${kind === 'path' ? 0.5 : 0.9})`; g.lineWidth = kind === 'room' ? 2.4 : 1.4;
        if (under) g.setLineDash([7, 4]); else g.setLineDash([]);
        g.beginPath();
        this.wobble(x1, y1, x2, y1, seed); this.wobble(x2, y1, x2, y2, seed + 50); this.wobble(x2, y2, x1, y2, seed + 100); this.wobble(x1, y2, x1, y1, seed + 150);
        g.stroke();
      });
      g.setLineDash([]);
      if (any) {
        g.fillStyle = `rgba(${ink},0.95)`; g.font = 'italic 15px Georgia, serif'; g.textAlign = 'center';
        g.fillText(SCENE_INFO[id].name, Math.min(w - 70, Math.max(70, lx)), lz - 6);
      }
    }
    // The Great Door, once seen.
    if (game.run.mapSeen.has('courtyard:0')) {
      g.fillStyle = '#8a2a16'; g.font = 'bold 13px Georgia, serif'; g.textAlign = 'center';
      g.fillRect(this.px(-2), this.pz(-8), this.px(2) - this.px(-2), 5);
      g.fillText('Great Door', this.px(0), this.pz(-8) + 20);
    }
    const ghost = game.ghostPos();
    if (ghost) { g.fillStyle = 'rgba(90,120,170,0.75)'; g.beginPath(); g.arc(this.px(ghost.x), this.pz(ghost.z), 4, 0, 7); g.fill(); }
    // You.
    const p = game.player;
    g.save(); g.translate(this.px(p.pos.x), this.pz(p.pos.z)); g.rotate(-p.yaw);
    g.fillStyle = '#b0200c'; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill();
    g.restore();
    // Compass.
    g.strokeStyle = 'rgba(70,44,22,0.8)'; g.fillStyle = 'rgba(70,44,22,0.9)'; g.lineWidth = 1.5; g.font = 'bold 14px Georgia, serif';
    g.beginPath(); g.moveTo(w - 40, 60); g.lineTo(w - 40, 24); g.lineTo(w - 45, 34); g.moveTo(w - 40, 24); g.lineTo(w - 35, 34); g.stroke();
    g.fillText('N', w - 40, 18);
  }
}
