import * as THREE from 'three';
import type { SceneId } from '../logic/unlocks';
import type { Zone } from '../logic/economy';
import type { NoiseEvent } from '../logic/noise';

export interface Climbable {
  id: string;
  box: THREE.Box3;
  /** Points away from the wall, toward the climber. */
  normal: THREE.Vector3;
  kind: 'vine' | 'rope';
  enabled: boolean;
  scene: SceneId;
}

export interface WaterVolume {
  box: THREE.Box3;
  surface: number;
  flow: THREE.Vector3;
  scene: SceneId;
}

export interface KillVolume {
  box: THREE.Box3;
  kind: 'abyss' | 'gorge' | 'spikes';
  respawn?: THREE.Vector3;
  scene: SceneId;
}

export interface WindZone {
  box: THREE.Box3;
  dir: THREE.Vector3;
  strength: number;
  scene: SceneId;
}

export interface Interactable {
  kind: 'interact';
  id: string;
  position: THREE.Vector3;
  /** Text to show, or null when not usable right now. */
  prompt(): string | null;
  interact(): void;
  /** Seconds the key must be held (0 = press). */
  holdTime?: number;
  /** Larger reach for big objects. */
  reach?: number;
  /** Keep firing while the key is held (cranks). */
  repeat?: boolean;
  /**
   * How close to the anchor a line-of-sight hit may land and still count as "hit the thing
   * itself" (anchors inside a solid object, like the haul cart). Default 0.9 m.
   */
  losSlack?: number;
}

export interface Prop {
  id: string;
  fixedUpdate?(dt: number): void;
  update?(dt: number): void;
  onNoise?(ev: NoiseEvent): void;
  dispose(): void;
}

export interface SpawnPoint {
  id: string;
  pos: THREE.Vector3;
  scene: SceneId;
}

export interface SceneVolume {
  box: THREE.Box3;
  zone: Zone;
  /** True for enclosed spaces where no sky light reaches (zone C rules). */
  dark: boolean;
}
