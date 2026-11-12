import * as THREE from 'three';
import { rectPoly as R, rampPoly as RP, type NavPolyDef } from '../logic/navmesh';
import type { GuardianKind } from '../logic/guardianFSM';
import type { SceneDef } from './SceneBase';
import { jungle } from './scenes/jungle';
import { courtyard } from './scenes/courtyard';
import { cliffs } from './scenes/cliffs';
import { halls } from './scenes/halls';
import { sanctum } from './scenes/sanctum';
import { catacombs } from './scenes/catacombs';
import { vault } from './scenes/vault';
import type { SceneId } from '../logic/economy';

/** Lookup order matters: more specific (deeper) bounds first. */
export const SCENES: SceneDef[] = [vault, catacombs, sanctum, halls, cliffs, courtyard, jungle];
export const SCENE_BY_ID = Object.fromEntries(SCENES.map((s) => [s.id, s])) as Record<SceneId, SceneDef>;

/** Where guardians head when sweeping: just inside the great door. */
export const DOOR_INSIDE = new THREE.Vector3(0, 0, 3);

/**
 * Temple navmesh: hand-authored convex rectangles that share edges exactly at
 * every opening. Walls are 1 m thick, so rectangles stop 0.6 m short of them.
 */
export const NAV_POLYS: NavPolyDef[] = [
  // ---- broken halls (y 0)
  R(-29.4, -13.4, 29.4, 5.4, 0, { tag: 'vestibule' }),
  R(-2.8, 5.4, 2.8, 8.4, 0, { tag: 'door' }),
  R(-11.4, -20, 11.4, -13.4, 0, { tag: 'pitSouth' }),
  R(18.6, -48.6, 23.4, -13.4, 0, { tag: 'eastAisle' }),
  R(-11.4, -48.6, 11.4, -40, 0, { tag: 'pitNorth' }),
  R(-11.4, -61.4, 29.4, -48.6, 0, { tag: 'northHall' }),
  R(-27, -15.6, -21, -13.4, 0, { tag: 'crackedWall', gate: 'wallKicked' }),
  R(-29.4, -52, -12.6, -15.6, 0, { tag: 'westWing' }),
  R(-25, -61.4, -12.6, -52, 0, { tag: 'westWing2' }),
  RP(-29, -52, -25, -70, 'z', 0, -12, { tag: 'servantStair' }),
  R(-2.8, -63.6, 2.8, -61.4, 0, { tag: 'sanctumGate' }),
  // ---- sanctum (y 0)
  R(-24.4, -98, 24.4, -63.6, 0, { tag: 'sanctum' }),
  R(-24.4, -111.4, -13, -98, 0, { tag: 'sanctumW' }),
  R(-7, -111.4, 24.4, -98, 0, { tag: 'sanctumE' }),
  RP(-13, -98, -7, -112, 'z', 0, -12, { tag: 'sealStair' }),
  // ---- catacombs (y -12)
  R(-13, -118, -7, -112, -12, { tag: 'landing' }),
  R(-17.4, -133.4, 1.4, -118, -12, { tag: 'ossuary' }),
  R(-6, -152, -2, -133.4, -12, { tag: 'crumble' }),
  R(-9.4, -163.4, 5.4, -152, -12, { tag: 'junction' }),
  R(5.4, -159.6, 26, -156.4, -12, { tag: 'darts' }),
  RP(26, -159.6, 28, -156.4, 'x', -12, -13.4, { tag: 'floodSteps' }),
  R(28, -171.4, 39.4, -146.6, -13.4, { tag: 'flooded' }),
  R(-24.6, -159.6, -9.4, -156.4, -12, { tag: 'blades' }),
  R(-37.4, -167.4, -24.6, -148.6, -12, { tag: 'reliquary' }),
  R(-29, -148.6, -25, -70, -12, { tag: 'passage' }),
  RP(-29, -167.4, -25, -190, 'z', -12, -20, { tag: 'passageRamp' }),
  R(-3, -176, 3, -163.4, -12, { tag: 'vaultApproach' }),
  RP(-3, -176, 3, -188, 'z', -12, -20, { tag: 'vaultRamp' }),
  // ---- vault (y -20)
  R(-13.4, -215.4, 13.4, -188, -20, { tag: 'vault' }),
  R(13.4, -208, 14.6, -200, -20, { tag: 'lairArch' }),
  R(14.6, -213.4, 33.4, -194.6, -20, { tag: 'lair' }),
  R(-30.4, -199.4, -23, -190, -20, { tag: 'westLedge' }),
  R(-23, -197, -13.4, -193, -20, { tag: 'drawbridge', gate: 'drawbridgeLowered' }),
];

export interface GuardianSpawn { kind: GuardianKind; scene: 'vault' | 'catacombs' | 'sanctum' | 'halls'; pos: THREE.Vector3 }
export const GUARDIAN_SPAWNS: GuardianSpawn[] = [
  { kind: 'sentinel', scene: 'vault', pos: new THREE.Vector3(22, -20, -207) },
  { kind: 'crawler', scene: 'vault', pos: new THREE.Vector3(28, -20, -200) },
  { kind: 'shade', scene: 'vault', pos: new THREE.Vector3(31, -20, -209) },
  { kind: 'crawler', scene: 'catacombs', pos: new THREE.Vector3(-2, -12, -160) },
  { kind: 'shade', scene: 'catacombs', pos: new THREE.Vector3(-34, -12, -158) },
  { kind: 'sentinel', scene: 'sanctum', pos: new THREE.Vector3(-18, 0, -80) },
  { kind: 'crawler', scene: 'halls', pos: new THREE.Vector3(20, 0, -55) },
];

export function sceneAt(p: THREE.Vector3): SceneDef | null {
  for (const s of SCENES) {
    for (const b of s.bounds) {
      if (p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z) return s;
    }
  }
  return null;
}
