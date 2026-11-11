/** Pure trap rules. Runtime code measures the world; these functions decide. */

export const PEDESTAL_TOLERANCE = 0.15;
export const PEDESTAL_GRACE = 0.6; // seconds to restore the weight before the trap fires

/** True when the mass on a pedestal has drifted outside tolerance of its original mass. */
export function pedestalTriggered(originalMass: number, currentMass: number, tolerance = PEDESTAL_TOLERANCE): boolean {
  if (originalMass <= 0) return false;
  return Math.abs(currentMass - originalMass) > originalMass * tolerance;
}

export interface PedestalState { original: number; armed: boolean; fired: boolean; unbalancedFor: number }
export function newPedestal(originalMass: number): PedestalState {
  return { original: originalMass, armed: true, fired: false, unbalancedFor: 0 };
}
/** Advance a pedestal given the mass currently on it. Fires once after the grace period. */
export function tickPedestal(p: PedestalState, currentMass: number, dt: number): { state: PedestalState; fire: boolean } {
  if (!p.armed || p.fired) return { state: p, fire: false };
  if (!pedestalTriggered(p.original, currentMass)) return { state: { ...p, unbalancedFor: 0 }, fire: false };
  const t = p.unbalancedFor + dt;
  if (t >= PEDESTAL_GRACE) return { state: { ...p, unbalancedFor: t, fired: true }, fire: true };
  return { state: { ...p, unbalancedFor: t }, fire: false };
}

// ---------------------------------------------------------------- planks / crumbling floors
export const PLANK_CRACK_AT = 0.45;
export const PLANK_DROP_AT = 0.9;
export const CRUMBLE_SHAKE_AT = 0.15;
export const CRUMBLE_DROP_AT = 0.7;

export type CrackStage = 'intact' | 'cracking' | 'dropped';
export interface CrackState { loadTime: number; stage: CrackStage }
export const newCrack = (): CrackState => ({ loadTime: 0, stage: 'intact' });

/**
 * Planks/crumble tiles accumulate time while loaded and do NOT recover when
 * you step off: once cracking, they will drop. That is what stops you from
 * standing still on them.
 */
export function tickCrack(s: CrackState, loaded: boolean, dt: number, crackAt: number, dropAt: number): { state: CrackState; event: 'crack' | 'drop' | null } {
  if (s.stage === 'dropped') return { state: s, event: null };
  if (!loaded && s.stage === 'intact') return { state: s, event: null };
  const t = s.loadTime + dt;
  if (s.stage === 'intact' && t >= crackAt) {
    if (t >= dropAt) return { state: { loadTime: t, stage: 'dropped' }, event: 'drop' };
    return { state: { loadTime: t, stage: 'cracking' }, event: 'crack' };
  }
  if (s.stage === 'cracking' && t >= dropAt) return { state: { loadTime: t, stage: 'dropped' }, event: 'drop' };
  return { state: { ...s, loadTime: t }, event: null };
}

// ---------------------------------------------------------------- pressure plates
export interface PlateState { pressed: boolean; heldFor: number }
export const newPlate = (): PlateState => ({ pressed: false, heldFor: 0 });
/** Plate is pressed when the mass on it reaches the threshold. Returns edge events. */
export function tickPlate(p: PlateState, mass: number, threshold: number, dt: number): { state: PlateState; event: 'down' | 'up' | null } {
  const down = mass >= threshold;
  if (down && !p.pressed) return { state: { pressed: true, heldFor: 0 }, event: 'down' };
  if (!down && p.pressed) return { state: { pressed: false, heldFor: 0 }, event: 'up' };
  return { state: { pressed: down, heldFor: down ? p.heldFor + dt : 0 }, event: null };
}

// ---------------------------------------------------------------- dart launchers
export const DART_COOLDOWN = 1.2;
export const DART_SPEED = 24;
export const DART_DAMAGE = 12;
export interface DartLauncher { cooldown: number }
export function tickDart(l: DartLauncher, triggered: boolean, dt: number): { state: DartLauncher; fire: boolean } {
  const c = Math.max(0, l.cooldown - dt);
  if (triggered && c === 0) return { state: { cooldown: DART_COOLDOWN }, fire: true };
  return { state: { cooldown: c }, fire: false };
}

// ---------------------------------------------------------------- damage table
export const DAMAGE = {
  dart: DART_DAMAGE,
  blade: 35,
  boulder: 60,
  debris: 20,
  spikes: 1000,
  abyss: 1000,
} as const;

/** Fall damage: nothing up to safeFall metres, then 12 per metre. */
export function fallDamage(height: number, safeFall: number): number {
  return height <= safeFall ? 0 : Math.round((height - safeFall) * 12);
}

/** Pendulum blade angle (radians) at time t. */
export function bladeAngle(t: number, amplitude: number, period: number, phase: number): number {
  return amplitude * Math.sin((2 * Math.PI * t) / period + phase);
}

/** Debris: instability rises with noise and decays; falling rock when it crosses the threshold. */
export const INSTABILITY_THRESHOLD = 1;
export function tickInstability(level: number, noise: number, dt: number): { level: number; drop: boolean } {
  let l = Math.max(0, level - 0.12 * dt) + noise;
  if (l >= INSTABILITY_THRESHOLD) return { level: l - 0.6, drop: true };
  return { level: l, drop: false };
}

/** Sun tiles are solid only while sunlit. */
export function sunTileSolid(sunlit: boolean, isNight: boolean): boolean {
  return sunlit && !isNight;
}
