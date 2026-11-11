import type * as THREE from 'three';
import type { Physics } from './Physics';
import type { Audio } from './Audio';
import type { Player } from '../entities/Player';
import type { World } from '../world/World';
import type { Sky } from '../world/Sky';
import type { TorchSystem } from '../entities/Torch';
import type { GuardianSystem } from '../entities/Guardians';
import type { HUD } from '../ui/HUD';
import type { Satchel } from '../logic/economy';
import type { UnlockFlags } from '../logic/unlocks';
import type { Upgrades } from '../logic/economy';
import type { Input } from './Input';
import type { NavGraph } from '../nav/NavGraph';
import type { Carry } from '../entities/Loot';

export interface NoiseEvent { pos: [number, number, number]; loudness: number; t: number }

/** Shared game context. Filled in by Game before anything uses it. */
export interface GameCtx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  physics: Physics;
  audio: Audio;
  input: Input;
  player: Player;
  world: World;
  sky: Sky;
  torch: TorchSystem;
  guardians: GuardianSystem;
  hud: HUD;
  nav: NavGraph;
  carry: Carry;
  satchel: Satchel;
  flags: UnlockFlags;
  upgrades: Upgrades;
  elapsed: number;
  time: number; // real seconds since run start incl. pauses excluded
  seed: number;
  running: boolean;
  noises: NoiseEvent[];
  relicsFound: number;
  stats: { kills: string | null };
  noise(pos: [number, number, number], loudness: number): void;
  damage(amount: number, cause: string): void;
  kill(cause: string): void;
  toast(msg: string, secs?: number): void;
  setFlag(name: keyof UnlockFlags): void;
}

export const G = {} as GameCtx;
