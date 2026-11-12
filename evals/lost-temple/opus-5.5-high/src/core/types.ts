import type * as THREE from 'three';
import type { Physics, RAPIER } from '../world/Physics';
import type { Materials } from '../world/Materials';
import type { TextureBank } from '../world/Textures';
import type { PropSystem } from '../entities/Props';
import type { RunState } from './RunState';
import type { SconceLights } from '../entities/Torch';
import type { Player } from '../entities/Player';
import type { AudioSystem } from '../audio/Audio';
import type { Flag } from '../logic/unlocks';
import type { SceneId } from '../logic/economy';

export interface Interactable {
  pos: THREE.Vector3;
  radius: number;
  /** Text for the HUD prompt, or null when not currently usable. */
  prompt(): string | null;
  act(): void;
}

/** What scene runtimes and traps can reach. Implemented by Game. */
export interface SceneCtx {
  scene: THREE.Scene;
  physics: Physics;
  mats: Materials;
  tex: TextureBank;
  props: PropSystem;
  sconces: SconceLights;
  player: Player;
  audio: AudioSystem;
  run(): RunState;
  time(): number;
  remaining(): number;
  isNight(): boolean;
  sunlit(p: THREE.Vector3): boolean;
  damage(amount: number, cause: string, knock?: THREE.Vector3): void;
  kill(cause: string): void;
  noise(p: THREE.Vector3, radius: number): void;
  message(text: string, seconds?: number): void;
  shake(amount: number): void;
  groundCollider(): RAPIER.Collider | null;
  setFlag(f: Flag): void;
  /** Player body + satchel + held object, kg. */
  playerMass(): number;
  currentScene(): SceneId | null;
  playerCenter(): THREE.Vector3;
  torchLit(): boolean;
  escape(): void;
}

export interface SceneRuntime {
  interactables: Interactable[];
  update(dt: number): void;
  detach(): void;
}
