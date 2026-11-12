/**
 * Noise: what the player and the world emit, who hears it, and how it strains the unstable
 * sanctum ceiling. Pure logic, unit tested.
 */

export type NoiseSource = 'footstep' | 'landing' | 'impact' | 'trap' | 'snap' | 'kick' | 'machine' | 'voice' | 'decoy';

export interface NoiseEvent {
  x: number;
  y: number;
  z: number;
  loudness: number; // 0..~1.5
  source: NoiseSource;
  /** True when the player made the noise directly (footsteps, landings, kicks). */
  byPlayer: boolean;
}

export type MoveMode = 'sprint' | 'walk' | 'crouch';

export function footstepLoudness(mode: MoveMode, loadFraction: number): number {
  const base = mode === 'sprint' ? 0.95 : mode === 'walk' ? 0.38 : 0.04;
  return base * (1 + 0.35 * Math.max(0, Math.min(1, loadFraction)));
}

/** Seconds between footsteps for each mode. */
export function footstepInterval(mode: MoveMode): number {
  return mode === 'sprint' ? 0.32 : mode === 'walk' ? 0.5 : 0.7;
}

export function landingLoudness(impactSpeed: number): number {
  return Math.max(0.2, Math.min(1.5, impactSpeed / 8));
}

export function impactLoudness(impulse: number): number {
  return Math.max(0.05, Math.min(1.5, impulse / 40));
}

/** Range at which a listener with the given acuity (metres per unit loudness) hears a noise. */
export function hearingRange(loudness: number, acuity: number): number {
  return loudness * acuity;
}

export function hears(ev: NoiseEvent, lx: number, ly: number, lz: number, acuity: number): boolean {
  const d = Math.hypot(ev.x - lx, (ev.y - ly) * 1.5, ev.z - lz); // floors muffle vertical sound
  return d <= hearingRange(ev.loudness, acuity);
}

export interface CeilingSection {
  id: number;
  x: number;
  z: number;
  strain: number;
  threshold: number;
  state: 'stable' | 'warning' | 'collapsed';
  warn: number;
}

export const STRAIN_RADIUS = 14;
export const STRAIN_DECAY = 0.05;
export const WARNING_TIME = 1.0;

/** The unstable half of the sanctum ceiling. Noise adds strain; past a threshold a section falls. */
export class CeilingStrain {
  sections: CeilingSection[] = [];

  constructor(defs: { x: number; z: number; threshold: number }[]) {
    this.sections = defs.map((d, i) => ({ id: i, x: d.x, z: d.z, strain: 0, threshold: d.threshold, state: 'stable', warn: 0 }));
  }

  addNoise(ev: { x: number; z: number; loudness: number }) {
    for (const s of this.sections) {
      if (s.state !== 'stable') continue;
      const d = Math.hypot(ev.x - s.x, ev.z - s.z);
      const k = Math.max(0, 1 - d / STRAIN_RADIUS);
      s.strain += ev.loudness * k;
    }
  }

  /** Force a section into its warning phase (collapse sequence). */
  trigger(id: number) {
    const s = this.sections[id];
    if (s && s.state === 'stable') {
      s.state = 'warning';
      s.warn = WARNING_TIME;
    }
  }

  /** Returns sections entering warning and sections collapsing this frame. */
  update(dt: number): { warnings: CeilingSection[]; collapses: CeilingSection[] } {
    const warnings: CeilingSection[] = [];
    const collapses: CeilingSection[] = [];
    for (const s of this.sections) {
      if (s.state === 'stable') {
        s.strain = Math.max(0, s.strain - STRAIN_DECAY * dt);
        if (s.strain >= s.threshold) {
          s.state = 'warning';
          s.warn = WARNING_TIME;
          warnings.push(s);
        }
      } else if (s.state === 'warning') {
        s.warn -= dt;
        if (s.warn <= 0) {
          s.state = 'collapsed';
          collapses.push(s);
        }
      }
    }
    return { warnings, collapses };
  }

  get remaining(): number {
    return this.sections.filter((s) => s.state !== 'collapsed').length;
  }
}
