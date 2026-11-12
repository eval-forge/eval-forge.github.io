/**
 * The explorer's map: parchment and ink, drawn in code, filled in only where
 * you have actually been. Floor plans come from the same layout data the
 * world is built from, clipped to the 4 m cells the player has seen.
 */
import { hash2 } from '../core/rng';
import { SCENES, SCENE_ORDER, type SceneId } from '../core/scenes';
import type { Game } from '../game/game';
import { layouts } from '../world/layout';
import { JUNGLE, jungleTrailX } from '../world/layout/jungle';
import { el } from './dom';

const W = 980;
const HGT = 700;
const CELL = 4;

/** World rectangle -> a box on the parchment. */
interface Frame {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  px: number;
  py: number;
  scale: number;
}

// The temple (everything north of the great door) and the approach, side by side.
const TEMPLE: Frame = { x0: -84, z0: -128, x1: 64, z1: 46, px: 40, py: 76, scale: 3.42 };
const APPROACH: Frame = { x0: -46, z0: 42, x1: 46, z1: 176, px: 596, py: 150, scale: 3.6 };

const rnd = (a: number, b: number): number => hash2(a | 0, b | 0) / 4294967296;

export class MapView {
  readonly root = el('div', 'mapview');
  private readonly canvas = el('canvas');
  private readonly paper: HTMLCanvasElement;
  private t = 0;

  constructor(private readonly game: Game) {
    this.canvas.width = W;
    this.canvas.height = HGT;
    this.root.appendChild(this.canvas);
    this.paper = this.makePaper();
  }

  update(dt: number): void {
    const open = this.game.mapOpen && this.game.state === 'playing';
    if (this.root.classList.contains('on') !== open) {
      this.root.classList.toggle('on', open);
      this.t = 0;
    }
    if (!open) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.2;
    this.draw();
  }

  private makePaper(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = HGT;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#d8c592';
    ctx.fillRect(0, 0, W, HGT);
    // Stains and fibres.
    for (let i = 0; i < 260; i++) {
      const x = rnd(i, 1) * W;
      const y = rnd(i, 2) * HGT;
      const r = 14 + rnd(i, 3) * 90;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd(i, 4) < 0.6;
      g.addColorStop(0, dark ? 'rgba(120, 88, 40, 0.07)' : 'rgba(255, 244, 206, 0.09)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.strokeStyle = 'rgba(90, 64, 30, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 500; i++) {
      const x = rnd(i, 7) * W;
      const y = rnd(i, 8) * HGT;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd(i, 9) - 0.5) * 30, y + (rnd(i, 10) - 0.5) * 6);
      ctx.stroke();
    }
    // Burnt edges.
    const edge = ctx.createRadialGradient(W / 2, HGT / 2, HGT * 0.42, W / 2, HGT / 2, HGT * 0.82);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(70, 40, 12, 0.6)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, HGT);
    ctx.strokeStyle = '#4a3418';
    ctx.lineWidth = 3;
    ctx.strokeRect(14, 14, W - 28, HGT - 28);
    ctx.lineWidth = 1;
    ctx.strokeRect(20, 20, W - 40, HGT - 40);

    ctx.fillStyle = '#3a2610';
    ctx.textAlign = 'center';
    ctx.font = 'italic 34px Georgia, serif';
    ctx.fillText('The Lost Temple', W / 2, 58);
    ctx.font = 'italic 13px Georgia, serif';
    ctx.fillText('drawn as walked, by one who means to walk back out', W / 2, 76);

    // Compass rose.
    const cx = W - 86;
    const cy = 92;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#3a2610';
    ctx.fillStyle = '#3a2610';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -34);
      ctx.lineTo(5, 0);
      ctx.lineTo(-5, 0);
      ctx.closePath();
      if (i === 3) ctx.fill();
      else ctx.stroke();
    }
    ctx.font = 'bold 15px Georgia, serif';
    ctx.fillText('N', 0, -40);
    ctx.restore();

    // Legend.
    ctx.textAlign = 'left';
    ctx.font = 'italic 13px Georgia, serif';
    const lx = 610;
    let ly = HGT - 118;
    const legend: [string, string][] = [
      ['#8c2f1c', '×  relic seen, not taken'],
      ['#b5651d', '●  torch you mounted'],
      ['#23324e', '▒  below ground (no light)'],
      ['#8c2f1c', '➤  you'],
    ];
    for (const [col, text] of legend) {
      ctx.fillStyle = col;
      ctx.fillText(text, lx, ly);
      ly += 19;
    }
    ctx.fillStyle = '#3a2610';
    ctx.fillText('M or Tab closes the map. The sun keeps moving while you read it.', lx - 170, HGT - 30);
    return c;
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const game = this.game;
    const run = game.run;
    const all = layouts();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.paper, 0, 0);
    const seen = run.explored;

    // ---- the approach: trail, river, gorge ------------------------------
    {
      const F = APPROACH;
      const X = (x: number): number => F.px + (x - F.x0) * F.scale;
      const Z = (z: number): number => F.py + (z - F.z0) * F.scale;
      const cellSeen = (x: number, z: number): boolean => seen.has(`0:${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`);
      // Ground wash where explored.
      ctx.fillStyle = 'rgba(96, 120, 60, 0.20)';
      for (let cz = Math.floor(F.z0 / CELL); cz <= Math.floor(F.z1 / CELL); cz++) {
        for (let cx = Math.floor(F.x0 / CELL); cx <= Math.floor(F.x1 / CELL); cx++) {
          if (!seen.has(`0:${cx}:${cz}`)) continue;
          const j = rnd(cx * 31 + 5, cz * 17 + 3) * 1.5;
          ctx.fillRect(X(cx * CELL) - j, Z(cz * CELL) - j, CELL * F.scale + j * 2, CELL * F.scale + j * 2);
        }
      }
      // River and gorge bands.
      const band = (z0: number, z1: number, fill: string, label: string): void => {
        let any = false;
        ctx.fillStyle = fill;
        for (let x = F.x0; x < F.x1; x += CELL) {
          if (!cellSeen(x + 2, (z0 + z1) / 2)) continue;
          any = true;
          ctx.fillRect(X(x), Z(z0), CELL * F.scale + 0.5, (z1 - z0) * F.scale);
        }
        if (any) {
          ctx.fillStyle = '#3a2610';
          ctx.font = 'italic 12px Georgia, serif';
          ctx.textAlign = 'left';
          ctx.fillText(label, X(F.x1) + 6, Z((z0 + z1) / 2) + 4);
        }
      };
      band(JUNGLE.riverZ - JUNGLE.riverHalf, JUNGLE.riverZ + JUNGLE.riverHalf, 'rgba(60, 110, 140, 0.45)', 'river');
      band(JUNGLE.gorgeZ - JUNGLE.gorgeHalf, JUNGLE.gorgeZ + JUNGLE.gorgeHalf, 'rgba(50, 36, 20, 0.5)', 'gorge');
      // The bridge.
      if (cellSeen(0, JUNGLE.gorgeZ)) {
        ctx.strokeStyle = '#5a3c18';
        ctx.lineWidth = 4;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(X(0), Z(JUNGLE.bridgeNorthZ));
        ctx.lineTo(X(0), Z(JUNGLE.bridgeSouthZ));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // The trail, dotted, as far as it has been walked.
      ctx.fillStyle = '#5a3c18';
      for (let z = 46; z < 172; z += 2.2) {
        const x = jungleTrailX(z);
        if (!cellSeen(x, z)) continue;
        if (Math.abs(z - JUNGLE.gorgeZ) < JUNGLE.gorgeHalf) continue;
        ctx.beginPath();
        ctx.arc(X(x) + (rnd(z * 10, 3) - 0.5) * 2, Z(z), 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (cellSeen(JUNGLE.spawn.x, JUNGLE.spawn.z)) this.label(ctx, 'camp', X(JUNGLE.spawn.x) + 10, Z(JUNGLE.spawn.z) + 4, 12, 'left');
      this.label(ctx, 'The Approach', X(0), Z(F.z0) - 34, 17, 'center');
      // The compound wall and the great door.
      if (cellSeen(0, 46)) {
        ctx.strokeStyle = '#3a2610';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(X(-34), Z(43));
        ctx.lineTo(X(-4), Z(43));
        ctx.moveTo(X(4), Z(43));
        ctx.lineTo(X(34), Z(43));
        ctx.stroke();
        this.label(ctx, 'the great door', X(0), Z(43) - 7, 12, 'center');
      }
      this.marks(ctx, 'jungle', X, Z, seen);
    }

    // ---- the temple: floor plans from layout data ------------------------
    const F = TEMPLE;
    const X = (x: number): number => F.px + (x - F.x0) * F.scale;
    const Z = (z: number): number => F.py + (z - F.z0) * F.scale;
    const pieces: { x0: number; z0: number; x1: number; z1: number; level: number; edges: number }[] = [];
    for (const id of SCENE_ORDER) {
      if (id === 'jungle') continue;
      const level = SCENES[id].zone === 'C' ? 1 : 0;
      for (const f of all[id].floors) {
        const cx0 = Math.floor(f.x0 / CELL);
        const cx1 = Math.floor((f.x1 - 1e-6) / CELL);
        const cz0 = Math.floor(f.z0 / CELL);
        const cz1 = Math.floor((f.z1 - 1e-6) / CELL);
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cz = cz0; cz <= cz1; cz++) {
            if (!seen.has(`${level}:${cx}:${cz}`)) continue;
            const x0 = Math.max(f.x0, cx * CELL);
            const x1 = Math.min(f.x1, (cx + 1) * CELL);
            const z0 = Math.max(f.z0, cz * CELL);
            const z1 = Math.min(f.z1, (cz + 1) * CELL);
            if (x1 - x0 < 0.01 || z1 - z0 < 0.01) continue;
            // Which sides of this piece are real edges of the floor rect (bit 0 W, 1 E, 2 N, 3 S)?
            const edges = (x0 === f.x0 ? 1 : 0) | (x1 === f.x1 ? 2 : 0) | (z0 === f.z0 ? 4 : 0) | (z1 === f.z1 ? 8 : 0);
            pieces.push({ x0, z0, x1, z1, level, edges });
          }
        }
      }
    }
    // Walls first: ink along true floor edges. Fills then erase the half that
    // falls inside a neighbouring floor, so doorways stay open.
    ctx.lineCap = 'round';
    for (const p of pieces) {
      if (!p.edges) continue;
      ctx.strokeStyle = p.level ? '#1a2238' : '#3a2610';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      const w = (a: number, b: number): number => (rnd(a * 13.7 + 1, b * 9.1 + 2) - 0.5) * 1.3;
      const seg = (ax: number, az: number, bx: number, bz: number): void => {
        ctx.moveTo(X(ax) + w(ax, az), Z(az) + w(az, ax));
        ctx.lineTo(X(bx) + w(bx, bz), Z(bz) + w(bz, bx));
      };
      if (p.edges & 1) seg(p.x0, p.z0, p.x0, p.z1);
      if (p.edges & 2) seg(p.x1, p.z0, p.x1, p.z1);
      if (p.edges & 4) seg(p.x0, p.z0, p.x1, p.z0);
      if (p.edges & 8) seg(p.x0, p.z1, p.x1, p.z1);
      ctx.stroke();
    }
    for (const p of pieces) {
      ctx.fillStyle = p.level ? '#9aa3b4' : '#e6d7aa';
      ctx.fillRect(X(p.x0), Z(p.z0), (p.x1 - p.x0) * F.scale + 0.6, (p.z1 - p.z0) * F.scale + 0.6);
    }
    // Hatching on the underground floors.
    ctx.strokeStyle = 'rgba(26, 34, 56, 0.28)';
    ctx.lineWidth = 1;
    for (const p of pieces) {
      if (!p.level) continue;
      const x = X(p.x0);
      const y = Z(p.z0);
      const w = (p.x1 - p.x0) * F.scale;
      const h = (p.z1 - p.z0) * F.scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.beginPath();
      for (let d = -h; d < w; d += 5) {
        ctx.moveTo(x + d, y + h);
        ctx.lineTo(x + d + h, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Names, once visited.
    const names: [SceneId, number, number][] = [
      ['courtyard', 0, 34],
      ['cliffs', 47, 6],
      ['halls', -2, -30],
      ['sanctum', -55, -32],
      ['catacombs', 26, -121],
      ['vault', -50, -108],
    ];
    for (const [id, x, z] of names) {
      if (run.visited.has(id)) this.label(ctx, SCENES[id].name, X(x), Z(z), 14, 'center', SCENES[id].zone === 'C' ? '#1a2238' : '#3a2610');
    }
    if (seen.has(`0:0:${Math.floor(40 / CELL)}`)) {
      ctx.strokeStyle = '#8c2f1c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(X(-3), Z(41));
      ctx.lineTo(X(3), Z(41));
      ctx.stroke();
      this.label(ctx, 'great door', X(0), Z(41) + 15, 12, 'center', '#8c2f1c');
    }
    if (seen.has(`0:0:${Math.floor(10 / CELL)}`)) {
      ctx.strokeStyle = '#3a2610';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(X(0), Z(10), 3.4 * F.scale, 0, Math.PI * 2);
      ctx.moveTo(X(0), Z(10));
      ctx.lineTo(X(0) + 8, Z(10) - 6);
      ctx.stroke();
    }
    for (const id of SCENE_ORDER) if (id !== 'jungle') this.marks(ctx, id, X, Z, seen);

    // Mounted torches.
    ctx.fillStyle = '#b5651d';
    for (const s of game.reg.sconces) {
      if (!s.lit) continue;
      ctx.beginPath();
      ctx.arc(X(s.pos.x), Z(s.pos.z), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // You.
    const p = game.player.pos;
    const inApproach = p.z > 43;
    const fr = inApproach ? APPROACH : TEMPLE;
    const mx = fr.px + (p.x - fr.x0) * fr.scale;
    const my = fr.py + (p.z - fr.z0) * fr.scale;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(-game.player.yaw);
    ctx.fillStyle = '#8c2f1c';
    ctx.strokeStyle = '#f4e6c0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Relic spots the player has seen but not emptied. */
  private marks(ctx: CanvasRenderingContext2D, id: SceneId, X: (x: number) => number, Z: (z: number) => number, seen: Set<string>): void {
    const run = this.game.run;
    const level = SCENES[id].zone === 'C' ? 1 : 0;
    ctx.strokeStyle = '#8c2f1c';
    ctx.lineWidth = 1.8;
    for (const s of layouts()[id].spots) {
      if (run.taken.has(s.id) || !run.loot.has(s.id)) continue;
      if (!seen.has(`${level}:${Math.floor(s.pos.x / CELL)}:${Math.floor(s.pos.z / CELL)}`)) continue;
      const x = X(s.pos.x);
      const y = Z(s.pos.z);
      ctx.beginPath();
      ctx.moveTo(x - 3.5, y - 3.5);
      ctx.lineTo(x + 3.5, y + 3.5);
      ctx.moveTo(x + 3.5, y - 3.5);
      ctx.lineTo(x - 3.5, y + 3.5);
      ctx.stroke();
    }
  }

  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, align: CanvasTextAlign, color = '#3a2610'): void {
    ctx.font = `italic ${size}px Georgia, serif`;
    ctx.textAlign = align;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(232, 216, 170, 0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}
