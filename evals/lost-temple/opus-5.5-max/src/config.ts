/** Shared tuning constants for the game layer. Logic constants live in src/logic/*. */

export const FIXED_DT = 1 / 60;
export const MAX_STEPS_PER_FRAME = 4;
export const WORLD_GRAVITY = -12;

/** Collision group bits (Rapier interaction groups: membership << 16 | filter). */
export const G = {
  STATIC: 1 << 0,
  PLAYER: 1 << 1,
  PROP: 1 << 2,
  DEBRIS: 1 << 3,
  GUARDIAN: 1 << 4,
  SENSOR: 1 << 5,
  HAZARD: 1 << 6,
  DART: 1 << 7,
  HELD: 1 << 8,
  RAYONLY: 1 << 9,
} as const;

export const ALL = 0xffff;

export function groups(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

/** Static world: collides with everything. */
export const GROUP_STATIC = groups(G.STATIC, ALL);
/** Player capsule: blocked by static, props, settled debris, guardians. */
export const GROUP_PLAYER = groups(G.PLAYER, G.STATIC | G.PROP | G.GUARDIAN);
/** Loose props (relics, pots, blocks, planks). */
export const GROUP_PROP = groups(G.PROP, G.STATIC | G.PLAYER | G.PROP | G.DEBRIS | G.GUARDIAN | G.HAZARD | G.DART | G.HELD | G.SENSOR);
/** Held objects do not collide with the player that holds them. */
export const GROUP_HELD = groups(G.HELD, G.STATIC | G.PROP | G.DEBRIS | G.GUARDIAN | G.HAZARD | G.SENSOR);
/** Falling debris: hits the world and props but not the (kinematic) player; damage is checked by distance. */
export const GROUP_DEBRIS = groups(G.DEBRIS, G.STATIC | G.PROP | G.DEBRIS | G.HAZARD | G.HELD | G.SENSOR);
/** Hazards (boulder, blades) push props and debris, pass through the player and guardians. */
export const GROUP_HAZARD = groups(G.HAZARD, G.STATIC | G.PROP | G.DEBRIS | G.HELD);
export const GROUP_DART = groups(G.DART, G.STATIC | G.PROP);
export const GROUP_GUARDIAN = groups(G.GUARDIAN, G.STATIC | G.PLAYER | G.PROP | G.HELD);
/** Sensors detect props, debris, held objects. */
export const GROUP_SENSOR = groups(G.SENSOR, G.PROP | G.DEBRIS | G.HELD);
/** Colliders that only block rays (roof slabs for sunlight tests, etc.): only RAYONLY queries see them. */
export const GROUP_RAYONLY = groups(G.RAYONLY, G.RAYONLY);
/** Query groups for sunlight tests: the static world plus ray-only blockers. */
export const SUNLIGHT_QUERY = groups(G.RAYONLY, G.STATIC | G.RAYONLY);

export const QUALITY = {
  low: { pixelRatio: 0.75, shadowMap: 1024, torchShadow: 256, msaa: 0, vegetation: 0.45, grass: 0.35, shadowRange: 34 },
  medium: { pixelRatio: 1, shadowMap: 2048, torchShadow: 512, msaa: 2, vegetation: 0.75, grass: 0.7, shadowRange: 40 },
  high: { pixelRatio: 1.5, shadowMap: 2048, torchShadow: 512, msaa: 4, vegetation: 1, grass: 1, shadowRange: 46 },
} as const;

export const DEBUG = typeof location !== 'undefined' && /[?&]debug\b/.test(location.search);
