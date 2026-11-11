import type * as THREE from 'three';
import type { LootSpotDef } from '../core/economy';
import type { GuardianKind } from '../core/guardianFsm';
import type { NavRect } from '../core/navmesh';
import type { SceneId } from '../core/types';
import type { SceneBuilder } from '../engine/builder';
import type { Game } from '../game/Game';

export interface Bounds { x1: number; x2: number; z1: number; z2: number; y1?: number; y2?: number; }

export interface GuardianSpawn {
  kind: GuardianKind;
  pos: [number, number, number];
  yaw: number;
  /** Waypoints swept in order, ending at the Great Door. */
  sweep: [number, number, number][];
}

/** A rectangle drawn on the hand-drawn map. floor 0 is ground level, 1 is underground. */
export interface MapShape { x1: number; z1: number; x2: number; z2: number; kind?: 'room' | 'path' | 'water' | 'pit' | 'bridge'; }

export interface SceneDef {
  id: SceneId;
  bounds: Bounds[];
  nav: NavRect[];
  loot: LootSpotDef[];
  guardians: GuardianSpawn[];
  map: MapShape[];
  /** Builds geometry and set pieces. Yields between chunks so streaming never stalls a frame. */
  build(game: Game, b: SceneBuilder): Generator<void, void, void>;
}

export interface Interactable {
  pos: THREE.Vector3;
  /** Max distance from the camera. */
  range: number;
  /** Text shown on the HUD, or null to hide (not currently usable). */
  prompt(): string | null;
  act(): void;
  /** Lower sorts first when several are in view. */
  priority?: number;
  /** The thing is itself a wall (its centre is inside solid stone), so skip the line-of-sight test. */
  solid?: boolean;
}

export interface Climbable {
  x1: number; x2: number; y1: number; y2: number; z1: number; z2: number;
  /** Unit XZ vector pointing away from the wall, toward the climber. */
  nx: number; nz: number;
}

export interface WaterVolume {
  x1: number; x2: number; z1: number; z2: number;
  surfaceY: number;
  /** Ignore the volume when the player's feet are below this (e.g. a floor under the pool). */
  minY: number;
  flowX: number; flowZ: number;
}

export interface WindZone { x1: number; x2: number; z1: number; z2: number; y1: number; y2: number; dx: number; dz: number; strength: number; }
