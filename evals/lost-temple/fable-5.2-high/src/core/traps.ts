import { clamp01 } from './types';

// --- Damage numbers ------------------------------------------------------------
export const DMG = {
  dart: 15,
  blade: 40,
  debris: 30,
  scarabPerSecond: 14,
  spikes: 35,
  drownPerSecond: 0,
} as const;

/** Falls shorter than this are free. */
export const SAFE_FALL = 4.5;
export function fallDamage(height: number): number {
  return height <= SAFE_FALL ? 0 : Math.round((height - SAFE_FALL) * 11);
}

/** A boulder barely moving just shoves you; at full roll it is lethal. */
export function boulderDamage(speed: number): number {
  return speed < 1.5 ? 0 : Math.min(100, Math.round(speed * 14));
}

// --- Rope bridge planks ----------------------------------------------------------
export const PLANK_CRACK_DELAY = 0.8;
export const PLANK_DROP_DELAY = 0.5;

/** intact → (stepped on) stressed → cracked → dropped. Once stressed it never recovers. */
export type PlankState = 'intact' | 'stressed' | 'cracked' | 'dropped';
export interface Plank { state: PlankState; timer: number; }
export type PlankEvent = 'creak' | 'crack' | 'drop';

export function newPlank(): Plank { return { state: 'intact', timer: 0 }; }

export function stepPlank(p: Plank, loaded: boolean, dt: number): PlankEvent | null {
  switch (p.state) {
    case 'intact':
      if (loaded) { p.state = 'stressed'; p.timer = PLANK_CRACK_DELAY; return 'creak'; }
      return null;
    case 'stressed':
      p.timer -= dt;
      if (p.timer <= 0) { p.state = 'cracked'; p.timer = PLANK_DROP_DELAY; return 'crack'; }
      return null;
    case 'cracked':
      p.timer -= dt;
      if (p.timer <= 0) { p.state = 'dropped'; p.timer = 0; return 'drop'; }
      return null;
    default:
      return null;
  }
}

/** How long you can stand on one plank before it is gone. */
export const PLANK_LIFETIME = PLANK_CRACK_DELAY + PLANK_DROP_DELAY;

// --- Crumbling floor tiles -------------------------------------------------------
export const CRUMBLE_DELAY = 0.7;
export type TileState = 'solid' | 'shaking' | 'fallen';
export interface Tile { state: TileState; timer: number; }
export type TileEvent = 'shake' | 'fall';

export function newTile(): Tile { return { state: 'solid', timer: 0 }; }

export function stepTile(t: Tile, loaded: boolean, dt: number): TileEvent | null {
  if (t.state === 'solid') {
    if (loaded) { t.state = 'shaking'; t.timer = CRUMBLE_DELAY; return 'shake'; }
  } else if (t.state === 'shaking') {
    t.timer -= dt;
    if (t.timer <= 0) { t.state = 'fallen'; return 'fall'; }
  }
  return null;
}

// --- Pressure plates -------------------------------------------------------------
/** Minimum mass in kg that pushes a plate down. The player counts as 75 + satchel. */
export const PLATE_THRESHOLD = 40;

export interface Plate { pressed: boolean; threshold: number; }
export type PlateEvent = 'pressed' | 'released';

export function newPlate(threshold = PLATE_THRESHOLD): Plate { return { pressed: false, threshold }; }

/** Feed the total mass resting on the plate each tick. */
export function stepPlate(p: Plate, massOnPlate: number): PlateEvent | null {
  const down = massOnPlate >= p.threshold;
  if (down && !p.pressed) { p.pressed = true; return 'pressed'; }
  if (!down && p.pressed) { p.pressed = false; return 'released'; }
  return null;
}

// --- Trapped pedestals -------------------------------------------------------------
export const SWAP_TOLERANCE = 0.2;

export type SwapResult = 'safe' | 'tooLight' | 'tooHeavy' | 'noCounterweight';

/**
 * Lifting a relic off a trapped pedestal. Safe only if an object within ±20% of the relic's
 * weight goes down in its place.
 */
export function pedestalSwap(relicWeight: number, counterWeight: number | null, tolerance = SWAP_TOLERANCE): SwapResult {
  if (counterWeight === null) return 'noCounterweight';
  const lo = relicWeight * (1 - tolerance), hi = relicWeight * (1 + tolerance);
  if (counterWeight < lo) return 'tooLight';
  if (counterWeight > hi) return 'tooHeavy';
  return 'safe';
}

export function swapTriggersTrap(result: SwapResult): boolean { return result !== 'safe'; }

// --- Dart launchers ------------------------------------------------------------------
export const DART_COOLDOWN = 1.6;
export const DART_SPEED = 26;
/** Darts fly at chest height above the corridor floor. */
export const DART_HEIGHT = 1.25;

export interface DartTrap { cooldown: number; }
export function newDartTrap(): DartTrap { return { cooldown: 0 }; }

/** Returns true on the tick a volley fires. Holding the plate down re-fires after the cooldown. */
export function stepDartTrap(d: DartTrap, platePressed: boolean, dt: number): boolean {
  d.cooldown = Math.max(0, d.cooldown - dt);
  if (platePressed && d.cooldown <= 0) { d.cooldown = DART_COOLDOWN; return true; }
  return false;
}

/** A dart passes over a crouching player. feetY and headY are the player's capsule extents. */
export function dartHits(dartY: number, feetY: number, headY: number, horizontalDist: number, radius = 0.4): boolean {
  return horizontalDist <= radius && dartY >= feetY && dartY <= headY;
}

// --- Swinging blades --------------------------------------------------------------------
/** Pendulum angle in radians at time t. */
export function bladeAngle(t: number, period: number, amplitude: number, phase = 0): number {
  return amplitude * Math.sin((2 * Math.PI * t) / period + phase);
}

// --- Sanctum noise and falling debris -----------------------------------------------------
export const NOISE = {
  walkStep: 0.03,
  runStep: 0.11,
  jump: 0.1,
  land: 0.22,
  hardLand: 0.4,
  throwImpact: 0.35,
  kick: 0.5,
  trap: 0.4,
  crouchStep: 0,
} as const;

export const NOISE_DECAY = 0.085;
/** Each threshold crossed (rising) drops this many chunks. */
export const DEBRIS_THRESHOLDS: [number, number][] = [[0.45, 1], [0.7, 2], [0.95, 4]];

export interface NoiseMeter { level: number; }
export function newNoiseMeter(): NoiseMeter { return { level: 0 }; }

/** Add a noise. Returns how many debris chunks the unstable ceiling sheds because of it. */
export function addNoise(m: NoiseMeter, amount: number): number {
  const before = m.level;
  m.level = clamp01(m.level + amount);
  let drops = 0;
  for (const [th, n] of DEBRIS_THRESHOLDS) if (before < th && m.level >= th) drops += n;
  // Staying pinned at the top keeps bringing the roof down.
  if (before >= 0.95 && amount >= 0.1) drops += 2;
  return drops;
}

export function decayNoise(m: NoiseMeter, dt: number): void {
  m.level = Math.max(0, m.level - NOISE_DECAY * dt);
}

// --- Scarabs --------------------------------------------------------------------------------
/** Scarabs only swarm in shadow. */
export function scarabDamage(inBand: boolean, sunlit: boolean, dt: number): number {
  return inBand && !sunlit ? DMG.scarabPerSecond * dt : 0;
}

// --- Wind gusts on the cliffs ------------------------------------------------------------------
export const GUST_PERIOD = 11;
export const GUST_LENGTH = 3.2;

/** Gust strength 0..1 at time t: calm, a short warning build-up, then a blast. */
export function gustStrength(t: number): number {
  const p = ((t % GUST_PERIOD) + GUST_PERIOD) % GUST_PERIOD;
  const start = GUST_PERIOD - GUST_LENGTH;
  if (p < start - 1.5) return 0.08;
  if (p < start) return 0.08 + 0.3 * ((p - (start - 1.5)) / 1.5);
  const k = (p - start) / GUST_LENGTH;
  return 0.38 + 0.62 * Math.sin(Math.PI * k);
}
