/** All scene layouts, plus the things derived from them: the navmesh and the loot spots. */
import type { LootSpot } from '../../core/economy';
import { NavMesh, type NavObstacleDef, type NavRectDef } from '../../core/navmesh';
import { SCENE_ORDER, type SceneId, type Vec3Like } from '../../core/scenes';
import { catacombsLayout } from './catacombs';
import { cliffsLayout } from './cliffs';
import { courtyardLayout } from './courtyard';
import { hallsLayout } from './halls';
import { jungleLayout } from './jungle';
import { sanctumLayout } from './sanctum';
import { regionContains, type GuardianSpawnDef, type RelicSpotDef, type SceneLayout } from './types';
import { vaultLayout } from './vault';

export const AGENT_RADIUS = 0.45;

let cache: Record<SceneId, SceneLayout> | null = null;

export function layouts(): Record<SceneId, SceneLayout> {
  if (!cache) {
    cache = {
      jungle: jungleLayout(),
      courtyard: courtyardLayout(),
      cliffs: cliffsLayout(),
      halls: hallsLayout(),
      sanctum: sanctumLayout(),
      catacombs: catacombsLayout(),
      vault: vaultLayout(),
    };
  }
  return cache;
}

/** One navmesh for the whole temple, built from pure layout data. */
export function buildNavMesh(): NavMesh {
  const rects: NavRectDef[] = [];
  const obstacles: NavObstacleDef[] = [];
  const all = layouts();
  for (const id of SCENE_ORDER) {
    const l = all[id];
    for (const f of l.floors) if (f.nav) rects.push(f);
    for (const o of l.obstacles) obstacles.push(o);
  }
  return new NavMesh(rects, obstacles, AGENT_RADIUS);
}

export function allSpots(): RelicSpotDef[] {
  const all = layouts();
  return SCENE_ORDER.flatMap((id) => all[id].spots);
}

export function lootSpots(): LootSpot[] {
  return allSpots().map((s) => ({ id: s.id, scene: s.scene, tier: s.tier, fixed: s.fixed }));
}

export function allGuardianSpawns(): GuardianSpawnDef[] {
  const all = layouts();
  return SCENE_ORDER.flatMap((id) => all[id].guardians);
}

/** Which scene is a point in? `prefer` wins ties so the answer does not flicker at seams. */
export function sceneAt(p: Vec3Like, prefer: SceneId | null = null): SceneId | null {
  const all = layouts();
  if (prefer) {
    for (const r of all[prefer].regions) if (regionContains(r, p, 0.75)) return prefer;
  }
  for (const id of SCENE_ORDER) {
    for (const r of all[id].regions) if (regionContains(r, p)) return id;
  }
  return null;
}

/** Scenes a guardian passes through on its way out, in order. */
export const SWEEP_NEXT: Partial<Record<SceneId, SceneId>> = {
  vault: 'catacombs',
  catacombs: 'halls',
  sanctum: 'halls',
  halls: 'courtyard',
  cliffs: 'courtyard',
};

/** The full list of sweep waypoints from a scene to the great door. */
export function sweepRoute(from: SceneId): Vec3Like[] {
  const all = layouts();
  const out: Vec3Like[] = [];
  let cur: SceneId | undefined = from;
  let guard = 0;
  while (cur && guard++ < 8) {
    out.push(...all[cur].sweep);
    cur = SWEEP_NEXT[cur];
  }
  return out;
}

export { type SceneLayout, type RelicSpotDef, type GuardianSpawnDef } from './types';
