/**
 * Ghost of the best run: a compact recording of where the player was.
 * Pure. Positions are stored as centimetre integers, sampled on a fixed step.
 */
import type { Vec3Like } from './scenes';

export interface GhostData {
  /** Seconds between samples. */
  step: number;
  /** Flat [x, y, z, x, y, z, ...] in centimetres. */
  samples: number[];
  haul: number;
}

export const GHOST_STEP = 0.5;

export class GhostRecorder {
  private samples: number[] = [];
  private acc = 0;

  constructor(private readonly step = GHOST_STEP) {}

  get length(): number {
    return this.samples.length / 3;
  }

  update(dt: number, pos: Vec3Like): void {
    this.acc += dt;
    if (this.samples.length === 0 || this.acc >= this.step) {
      if (this.samples.length) this.acc -= this.step;
      this.samples.push(Math.round(pos.x * 100), Math.round(pos.y * 100), Math.round(pos.z * 100));
    }
  }

  finish(haul: number): GhostData {
    return { step: this.step, samples: this.samples.slice(), haul };
  }
}

/** Interpolated ghost position at run time t, or null once the recording is over. */
export function sampleGhost(data: GhostData, t: number): Vec3Like | null {
  const n = data.samples.length / 3;
  if (n === 0 || t < 0) return null;
  const f = t / data.step;
  const i = Math.floor(f);
  if (i >= n - 1) return null;
  const k = f - i;
  const s = data.samples;
  const a = i * 3;
  const b = a + 3;
  return {
    x: (s[a] + (s[b] - s[a]) * k) / 100,
    y: (s[a + 1] + (s[b + 1] - s[a + 1]) * k) / 100,
    z: (s[a + 2] + (s[b + 2] - s[a + 2]) * k) / 100,
  };
}

export const ghostDuration = (data: GhostData): number => Math.max(0, data.samples.length / 3 - 1) * data.step;
