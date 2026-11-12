/**
 * The HUD clock: a carved stone dial, always on screen. The sun disc rides the rim at the real
 * sun's hour angle (the same arc the world's sun follows) and the gnomon's shadow points the
 * other way. An amber wedge marks the last minute (sunset to darkness) and a red wedge the
 * door's closing window. The remaining time is carved underneath. Underground this dial and
 * the ticking are the only ways to tell the time.
 */
import { DAY_LENGTH, DOOR_CLOSE_TIME, formatClock, phaseLabel, type DayClock } from '../logic/countdown';
import { sunTheta } from '../logic/sun';

const W = 150;
const H = 172;
const CX = 75;
const CY = 72;
const R = 62;

/** Canvas angle (0 = right, clockwise positive) of the sun at a given elapsed time. */
function sunAngle(elapsed: number): number {
  return sunTheta(elapsed) - Math.PI;
}

export class SundialHUD {
  canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private face: HTMLCanvasElement;
  private lastKey = '';
  private scale: number;

  constructor(parent: HTMLElement) {
    this.scale = Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)));
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'sundial';
    this.canvas.width = W * this.scale;
    this.canvas.height = H * this.scale;
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.face = this.drawFace();
  }

  /** The static stone face: weathered disc, hour marks along the sun's arc, the two wedges. */
  private drawFace(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = W * this.scale;
    c.height = H * this.scale;
    const g = c.getContext('2d')!;
    g.scale(this.scale, this.scale);
    // stone disc with a speckled texture
    const grad = g.createRadialGradient(CX - 14, CY - 18, 6, CX, CY, R + 4);
    grad.addColorStop(0, '#8d8068');
    grad.addColorStop(0.7, '#6a5f4c');
    grad.addColorStop(1, '#3d362b');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(CX, CY, R + 4, 0, Math.PI * 2);
    g.fill();
    let s = 1234567;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 420; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * (R + 2);
      g.fillStyle = rnd() < 0.5 ? 'rgba(30,24,16,0.28)' : 'rgba(220,206,170,0.16)';
      g.fillRect(CX + Math.cos(a) * d, CY + Math.sin(a) * d, 1 + rnd(), 1 + rnd());
    }
    // a chip out of the rim
    g.fillStyle = 'rgba(20,16,10,0.5)';
    g.beginPath();
    g.arc(CX + R * 0.86, CY + R * 0.42, 6, 0, Math.PI * 2);
    g.fill();
    // carved rim
    g.strokeStyle = 'rgba(25,20,14,0.85)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(CX, CY, R - 9, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(230,214,176,0.25)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(CX, CY, R - 7.5, 0, Math.PI * 2);
    g.stroke();
    // wedges: last minute (sunset to darkness) and the door's closing window
    const aSunset = sunAngle(DAY_LENGTH - 60);
    const aDark = sunAngle(DAY_LENGTH);
    const aShut = sunAngle(DAY_LENGTH + DOOR_CLOSE_TIME);
    const wedge = (a0: number, a1: number, col: string) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(CX, CY, R + 2, a0, a1);
      g.arc(CX, CY, R - 10, a1, a0, true);
      g.closePath();
      g.fill();
    };
    wedge(aSunset, aDark, 'rgba(232,150,40,0.85)');
    wedge(aDark, aShut, 'rgba(190,30,20,0.9)');
    // hour marks: 12 along the day arc, carved
    const a0 = sunAngle(0);
    for (let i = 0; i <= 12; i++) {
      const a = a0 + ((aSunset - a0) * i) / 12;
      const long = i % 3 === 0;
      g.strokeStyle = 'rgba(25,20,14,0.9)';
      g.lineWidth = long ? 2.2 : 1.3;
      g.beginPath();
      g.moveTo(CX + Math.cos(a) * (R - 9), CY + Math.sin(a) * (R - 9));
      g.lineTo(CX + Math.cos(a) * (R - (long ? 20 : 15)), CY + Math.sin(a) * (R - (long ? 20 : 15)));
      g.stroke();
    }
    // glyphs: sun at noon, moon in the night wedge
    g.fillStyle = 'rgba(25,20,14,0.85)';
    g.font = '11px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const aNoon = sunAngle((DAY_LENGTH - 60) / 2);
    g.fillText('☉', CX + Math.cos(aNoon) * (R - 27), CY + Math.sin(aNoon) * (R - 27));
    // lower half: the underworld, carved bands
    g.strokeStyle = 'rgba(25,20,14,0.5)';
    g.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.arc(CX, CY, R - 26 - k * 7, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    }
    // centre boss
    g.fillStyle = '#4a4134';
    g.beginPath();
    g.arc(CX, CY, 6, 0, Math.PI * 2);
    g.fill();
    // plaque under the dial
    g.fillStyle = 'rgba(16,12,8,0.72)';
    g.strokeStyle = 'rgba(232,178,74,0.35)';
    g.lineWidth = 1;
    roundRect(g, 18, 140, 114, 30, 4);
    g.fill();
    g.stroke();
    return c;
  }

  /** Redraw when the visible state changes (second boundary, pulse phase). */
  update(clock: DayClock, time: number, underground: boolean) {
    const rem = clock.remaining;
    const pulse = rem <= 60 ? Math.floor(time * 6) : 0;
    const key = `${Math.ceil(rem)}|${pulse}|${underground ? 1 : 0}|${Math.round(clock.elapsed * 2)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.face, 0, 0);
    g.scale(this.scale, this.scale);

    const a = sunAngle(clock.elapsed);
    const night = rem <= 0;
    // final-minute glow on the rim
    if (rem <= 60) {
      const k = 0.5 + 0.5 * Math.sin(time * (rem <= 0 ? 9 : 6));
      g.strokeStyle = `rgba(220,40,20,${0.35 + 0.45 * k})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(CX, CY, R + 3, 0, Math.PI * 2);
      g.stroke();
    }
    // the gnomon's shadow, opposite the sun; it fades as the sun sinks
    const sunUp = !night && rem > 60;
    const shadowLen = R - 14;
    const sa = a + Math.PI;
    g.strokeStyle = night ? 'rgba(10,8,6,0.35)' : 'rgba(18,14,10,0.85)';
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(CX, CY);
    g.lineTo(CX + Math.cos(sa) * shadowLen * (sunUp ? 1 : 0.55), CY + Math.sin(sa) * shadowLen * (sunUp ? 1 : 0.55));
    g.stroke();
    // gnomon: a small raised triangle toward the sun
    g.fillStyle = '#2a241c';
    g.beginPath();
    g.moveTo(CX + Math.cos(a) * 14, CY + Math.sin(a) * 14);
    g.lineTo(CX + Math.cos(a + 1.9) * 5, CY + Math.sin(a + 1.9) * 5);
    g.lineTo(CX + Math.cos(a - 1.9) * 5, CY + Math.sin(a - 1.9) * 5);
    g.closePath();
    g.fill();
    // the sun (or the moon after dark) on the rim
    const sx = CX + Math.cos(a) * (R - 3);
    const sy = CY + Math.sin(a) * (R - 3);
    if (!night) {
      const sg = g.createRadialGradient(sx, sy, 1, sx, sy, 9);
      const warm = rem < 120 ? '255,120,40' : '255,214,120';
      sg.addColorStop(0, `rgba(${warm},1)`);
      sg.addColorStop(0.5, `rgba(${warm},0.7)`);
      sg.addColorStop(1, `rgba(${warm},0)`);
      g.fillStyle = sg;
      g.beginPath();
      g.arc(sx, sy, 9, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = 'rgba(200,215,255,0.9)';
      g.beginPath();
      g.arc(sx, sy, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(40,30,25,1)';
      g.beginPath();
      g.arc(sx + 2.2, sy - 1.2, 4.2, 0, Math.PI * 2);
      g.fill();
    }
    // carved readout
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (!night) {
      g.fillStyle = rem <= 60 ? '#ff5a3a' : rem <= 120 ? '#ffb040' : '#f1e6cf';
      g.font = 'bold 19px Georgia, serif';
      g.fillText(formatClock(rem), CX, 151);
      g.fillStyle = 'rgba(185,171,142,0.95)';
      g.font = 'italic 10px Georgia, serif';
      g.fillText(underground ? 'until dark  (no sky here)' : `until dark  ·  ${phaseLabel(clock.phase)}`, CX, 164);
    } else if (!clock.doorShut) {
      g.fillStyle = '#ff4a30';
      g.font = 'bold 15px Georgia, serif';
      g.fillText(`DOOR ${formatClock(DOOR_CLOSE_TIME + rem)}`, CX, 151);
      g.fillStyle = 'rgba(255,180,160,0.95)';
      g.font = 'italic 10px Georgia, serif';
      g.fillText('night: the great door closes', CX, 164);
    } else {
      g.fillStyle = '#c03020';
      g.font = 'bold 15px Georgia, serif';
      g.fillText('SEALED', CX, 155);
    }
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
