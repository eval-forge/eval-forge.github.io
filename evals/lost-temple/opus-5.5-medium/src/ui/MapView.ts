import { G } from '../core/ctx';

/** Hand-drawn style map that fills in as you explore. */
export class MapView {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  visible = false;
  private markT = 0;
  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map hidden';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }
  toggle() { this.visible = !this.visible; this.canvas.classList.toggle('hidden', !this.visible); }
  hide() { this.visible = false; this.canvas.classList.add('hidden'); }

  update(dt: number) {
    this.markT -= dt;
    if (this.markT <= 0) {
      this.markT = 0.4;
      const r = G.world.current.zone === 'A' ? 16 : Math.max(5, G.torch.radius * 0.9);
      G.nav.markSeen(G.player.position, r);
    }
    if (this.visible) this.draw();
  }

  private draw() {
    const W = Math.min(window.innerWidth * 0.9, 900), H = window.innerHeight * 0.9;
    if (this.canvas.width !== Math.round(W)) { this.canvas.width = Math.round(W); this.canvas.height = Math.round(H); }
    const c = this.ctx;
    // parchment
    c.fillStyle = '#e4d2a8'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(120,80,30,${0.03 + (i % 5) * 0.01})`; c.beginPath(); c.arc((i * 137) % W, (i * 89) % H, 30 + (i * 13) % 60, 0, Math.PI * 2); c.fill(); }
    const minX = -48, maxX = 115, minZ = -432, maxZ = 14;
    const s = Math.min((W - 40) / (maxX - minX), (H - 60) / (maxZ - minZ));
    const ox = 20 + ((W - 40) - (maxX - minX) * s) / 2, oy = 40;
    const tx = (x: number) => ox + (x - minX) * s, ty = (z: number) => oy + (z - minZ) * s;
    // explored cells, shaded by depth
    for (const n of G.nav.nodes) {
      if (!n.seen) continue;
      const depth = Math.max(0, Math.min(1, -n.y / 16));
      c.fillStyle = `rgba(${90 - depth * 50},${60 - depth * 30},${30},${0.55})`;
      c.fillRect(tx(n.x - 0.5), ty(n.z - 0.5), Math.max(1, s), Math.max(1, s));
    }
    // ink border & labels
    c.strokeStyle = '#4a3418'; c.lineWidth = 3; c.strokeRect(6, 6, W - 12, H - 12);
    c.fillStyle = '#3a2810'; c.font = 'italic 20px Georgia, serif';
    c.fillText('The Lost Temple — explorer\'s map', 20, 30);
    c.font = 'italic 12px Georgia, serif';
    const labels: [string, number, number][] = [['Jungle', -30, -10], ['Gorge', -30, -84], ['Courtyard', -30, -120], ['Cliffs', 70, -115], ['Great Door', 4, -172], ['Broken Halls', -16, -200], ['Sanctum', -16, -255], ['Catacombs', -16, -320], ['Deep Vault', -16, -395], ['Lair', -42, -395], ['Tunnel', 28, -300]];
    for (const [t, x, z] of labels) {
      const seen = G.nav.nodes.some((n) => n.seen && Math.abs(n.x - x) < 15 && Math.abs(n.z - z) < 15);
      if (seen) c.fillText(t, tx(x), ty(z));
    }
    // player
    const p = G.player.position;
    c.save(); c.translate(tx(p.x), ty(p.z)); c.rotate(-G.player.yaw);
    c.fillStyle = '#a01010'; c.beginPath(); c.moveTo(0, -8); c.lineTo(5, 6); c.lineTo(-5, 6); c.closePath(); c.fill();
    c.restore();
    c.font = '12px Georgia, serif'; c.fillStyle = '#3a2810';
    c.fillText('M to close', W - 90, H - 16);
  }
}
