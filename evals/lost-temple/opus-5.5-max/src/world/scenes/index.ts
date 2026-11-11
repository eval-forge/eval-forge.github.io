import type * as THREE from 'three';
import type { SceneDef } from '../SceneDef';
import type { SceneId } from '../../logic/unlocks';
import { jungle } from './jungle';
import { courtyard } from './courtyard';
import { cliffs } from './cliffs';
import { halls } from './halls';
import { sanctum } from './sanctum';
import { catacombs } from './catacombs';
import { vault } from './vault';

export const SCENES: Record<SceneId, SceneDef> = { jungle, courtyard, cliffs, halls, sanctum, catacombs, vault };

/** Membership test order: the deeper, enclosed scenes win where volumes overlap. */
export const SCENE_PRIORITY: SceneId[] = ['vault', 'catacombs', 'sanctum', 'halls', 'cliffs', 'courtyard', 'jungle'];

/** Scenes whose static layout feeds the guardians' navmesh (guardians never leave the temple). */
export const NAV_SCENES: SceneId[] = ['halls', 'sanctum', 'catacombs', 'vault'];

/** Which scene a point is in; falls back to `prev` in the cracks between volumes. */
export function sceneAt(p: THREE.Vector3, prev: SceneId | null = null): SceneId | null {
  for (const id of SCENE_PRIORITY) {
    for (const b of SCENES[id].boxes) if (b.containsPoint(p)) return id;
  }
  return prev;
}

export function isDarkScene(id: SceneId | null): boolean {
  return !!id && SCENES[id].env === 'dark';
}
