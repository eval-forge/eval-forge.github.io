/**
 * The expedition map (M): a parchment sketch that fills in as you explore. Outdoor
 * ground is revealed in a radius around where you've walked; interior rooms appear once
 * you've been near them. Landmarks are inked in as you discover them.
 */
import { FLOORS, BRIDGE, RIVER, GORGE, SUNDIAL, CAMP, DOOR, LEDGES, FALLEN_TREE, SUN_SEAL, VAULT_DOOR, IDOL, KICK_WALL, DRAWBRIDGE, FLOOD } from '../world/layout';
import { parchmentCanvas } from '../engine/textures';
import { exposureAt } from '../world/query';
import type { Game } from '../game/Game';
import type { RunState } from '../game/RunState';

const X0 = -86;
const X1 = 96;
const Z0 = -146; // north (top)
const Z1 = 196; // south (bottom)
const CELL = 4;

export class MapView {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private paper: HTMLCanvasElement | null = null;
  private cells = new Set<string>();
  private run: RunState | null = null;
  private open = false;
  private redrawT = 0;

  constructor(private game: Game, parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'mapview hidden';
    this.canvas = document.createElement('canvas');
    this.root.appendChild(this.canvas);
    const legend = document.createElement('div');
    legend.className = 'map-legend';
    legend.textContent = 'M  close map    ·    North is up    ·    the map fills in as you explore';
    this.root.appendChild(legend);
    parent.appendChild(this.root);
    this.ctx = this.canvas.getContext('2d')!;
  }

  setOpen(on: boolean) {
    this.open = on;
    this.root.classList.toggle('hidden', !on);
    if (on) this.draw();
  }

  /** Mark the area around the player as seen. */
  reveal(x: number, z: number) {
    if (this.run !== this.game.run) {
      this.run = this.game.run;
      this.cells.clear();
    }
    const p = this.game.player.pos;
    const exp = exposureAt(p.x, p.y, p.z);
    const r = exp === 'outdoor' ? 16 : exp === 'ruins' ? 11 : 6;
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const rc = Math.ceil(r / CELL);
    for (let i = -rc; i <= rc; i++) {
      for (let j = -rc; j <= rc; j++) {
        if ((i * i + j * j) * CELL * CELL <= r * r) this.cells.add(`${cx + i},${cz + j}`);
      }
    }
  }

  private seen(x: number, z: number) {
    return this.cells.has(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  }

  private rectSeen(x0: number, z0: number, x1: number, z1: number) {
    for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++) {
      for (let z = Math.floor(z0 / CELL); z <= Math.floor(z1 / CELL); z++) {
        if (this.cells.has(`${x},${z}`)) return true;
      }
    }
    return false;
  }

  update(dt: number) {
    if (!this.open) return;
    this.redrawT -= dt;
    if (this.redrawT <= 0) {
      this.redrawT = 0.25;
      this.draw();
    }
  }

  private draw() {
    const H = Math.min(window.innerHeight * 0.9, 1000);
    const W = H * ((X1 - X0) / (Z1 - Z0)) * 1.25;
    if (this.canvas.width !== Math.round(W) || this.canvas.height !== Math.round(H)) {
      this.canvas.width = Math.round(W);
      this.canvas.height = Math.round(H);
      this.paper = parchmentCanvas(this.canvas.width, this.canvas.height);
    }
    const c = this.ctx;
    const sx = (W - 40) / (X1 - X0);
    const sz = (H - 40) / (Z1 - Z0);
    const mx = (x: number) => 20 + (x - X0) * sx;
    const mz = (z: number) => 20 + (z - Z0) * sz;
    c.drawImage(this.paper!, 0, 0);
    const ink = 'rgba(60,40,22,';

    // revealed outdoor ground (wash)
    c.fillStyle = 'rgba(110,130,70,0.28)';
    for (const k of this.cells) {
      const [i, j] = k.split(',').map(Number);
      const x = i * CELL;
      const z = j * CELL;
      if (z < 0.3 && !(x > 41)) continue; // interiors are drawn as rooms
      c.fillRect(mx(x), mz(z), CELL * sx + 0.6, CELL * sz + 0.6);
    }

    // river and gorge
    if (this.rectSeen(-60, RIVER.z0, 60, RIVER.z1)) {
      c.fillStyle = 'rgba(70,110,140,0.45)';
      c.fillRect(mx(-60), mz(RIVER.z0), 120 * sx, (RIVER.z1 - RIVER.z0) * sz);
    }
    if (this.rectSeen(-60, GORGE.z0, 60, GORGE.z1)) {
      c.fillStyle = 'rgba(40,30,20,0.55)';
      c.fillRect(mx(-60), mz(GORGE.z0), 120 * sx, (GORGE.z1 - GORGE.z0) * sz);
      c.strokeStyle = ink + '0.9)';
      c.lineWidth = 2;
      c.setLineDash([3, 2]);
      c.beginPath();
      c.moveTo(mx(BRIDGE.x), mz(BRIDGE.zSouth));
      c.lineTo(mx(BRIDGE.x), mz(BRIDGE.zNorth));
      c.stroke();
      c.setLineDash([]);
      c.beginPath();
      c.moveTo(mx(FALLEN_TREE.x), mz(FALLEN_TREE.zSouth));
      c.lineTo(mx(FALLEN_TREE.x), mz(FALLEN_TREE.zNorth));
      c.stroke();
    }
    // cliff ledges
    c.fillStyle = 'rgba(120,100,80,0.6)';
    for (const l of LEDGES) if (this.rectSeen(l.x0, l.z0, l.x1, l.z1)) c.fillRect(mx(l.x0), mz(l.z0), (l.x1 - l.x0) * sx, (l.z1 - l.z0) * sz);

    // interior rooms
    for (const f of FLOORS) {
      if (f.kind === 'open') continue;
      const visited = this.game.run.visitedFloors.has(f.id);
      if (!visited && !this.rectSeen(f.x0, f.z0, f.x1, f.z1)) continue;
      const dark = f.exposure === 'dungeon';
      const deep = f.y0 < -1;
      c.fillStyle = dark ? (deep ? 'rgba(70,52,40,0.45)' : 'rgba(80,60,45,0.4)') : 'rgba(150,125,90,0.45)';
      c.fillRect(mx(f.x0), mz(f.z0), (f.x1 - f.x0) * sx, (f.z1 - f.z0) * sz);
      c.strokeStyle = ink + (visited ? '0.9)' : '0.45)');
      c.lineWidth = visited ? 1.5 : 1;
      c.strokeRect(mx(f.x0), mz(f.z0), (f.x1 - f.x0) * sx, (f.z1 - f.z0) * sz);
    }

    // landmarks
    const mark = (x: number, z: number, label: string, always = false, sym = '✕') => {
      if (!always && !this.seen(x, z)) return;
      c.fillStyle = ink + '0.95)';
      c.font = 'bold 13px Georgia, serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(sym, mx(x), mz(z));
      c.font = 'italic 12px Georgia, serif';
      c.textAlign = 'left';
      c.fillText(label, mx(x) + 8, mz(z));
    };
    mark(CAMP.x, CAMP.z, 'Camp', true, '△');
    mark(DOOR.x, DOOR.z, 'Great door', true, '▬');
    mark(SUNDIAL.x, SUNDIAL.z, 'Sundial', false, '◎');
    mark(SUN_SEAL.x, SUN_SEAL.z, 'Sun Seal');
    mark(IDOL.x, IDOL.z, 'Idol');
    mark(KICK_WALL.x, KICK_WALL.z, 'Cracked wall');
    mark(VAULT_DOOR.x, VAULT_DOOR.z, 'Vault door');
    mark(DRAWBRIDGE.x, (DRAWBRIDGE.zHinge + DRAWBRIDGE.zFar) / 2, 'Drawbridge');
    mark((FLOOD.x0 + FLOOD.x1) / 2, (FLOOD.z0 + FLOOD.z1) / 2, 'Flooded');

    // the player
    const p = this.game.player;
    const px = mx(p.pos.x);
    const pz = mz(p.pos.z);
    c.save();
    c.translate(px, pz);
    c.rotate(-p.yaw);
    c.fillStyle = 'rgba(160,30,20,0.95)';
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6, 6);
    c.lineTo(0, 3);
    c.lineTo(-6, 6);
    c.closePath();
    c.fill();
    c.restore();

    // compass
    c.fillStyle = ink + '0.9)';
    c.font = 'bold 16px Georgia, serif';
    c.textAlign = 'center';
    c.fillText('N', W - 34, 34);
    c.beginPath();
    c.moveTo(W - 34, 42);
    c.lineTo(W - 39, 58);
    c.lineTo(W - 29, 58);
    c.closePath();
    c.fill();
  }
}
