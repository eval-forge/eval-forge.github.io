import { Satchel, loadoutFor, placeLoot, type Loadout, type LootSpotDef, type PlacedRelic, type UpgradeLevels } from '../core/economy';
import { newTorch, type Torch, type TorchConfig } from '../core/torch';
import { newNoiseMeter, type NoiseMeter } from '../core/traps';
import { newProgress, type Progress } from '../core/unlock';
import type { SceneId } from '../core/types';

export interface RunStats {
  relicsFound: number; relicsDropped: number; damageTaken: number; trapsSprung: number; deepest: SceneId; torchesPlaced: number;
}

/**
 * Everything about the run in progress. Scenes are thrown away and rebuilt as they stream, so any
 * fact that has to survive that (taken relics, fallen planks, kicked walls) lives here.
 */
export class RunState {
  /** Game seconds since dawn. */
  time = 0;
  readonly progress: Progress = newProgress();
  readonly loadout: Loadout;
  readonly satchel: Satchel;
  readonly torch: Torch;
  readonly torchCfg: TorchConfig;
  ropes: number;
  readonly placed: PlacedRelic[];
  readonly taken = new Set<string>();
  /** Rope planks and floor tiles that have dropped, as "pieceId:index". */
  readonly fallen = new Set<string>();
  readonly blockPos = new Map<string, { x: number; y: number; z: number }>();
  readonly sconces = new Set<string>();
  readonly pickups = new Set<string>();
  /** Free-form one-shot facts ("boulder:crown", "rope:cliffs"). */
  readonly flags = new Set<string>();
  readonly spawnedProps = new Set<SceneId>();
  readonly visited = new Set<SceneId>();
  readonly noise: NoiseMeter = newNoiseMeter();
  readonly stats: RunStats = { relicsFound: 0, relicsDropped: 0, damageTaken: 0, trapsSprung: 0, deepest: 'jungle', torchesPlaced: 0 };
  /** The player has been through the Great Door, so stepping back out ends the run. */
  wasInside = false;
  /** Sundial puzzle state. */
  dialAngle = 2.4;
  dialSolved = false;
  /** Ghost recording: x, y, z triples sampled at a fixed step. */
  ghost: number[] = [];
  /** Map cells the player has seen, as "floor:cx:cz". */
  readonly mapSeen = new Set<string>();

  constructor(readonly seed: number, upgrades: UpgradeLevels, spots: LootSpotDef[]) {
    this.loadout = loadoutFor(upgrades);
    this.satchel = new Satchel(this.loadout.capacity);
    this.torch = newTorch(this.loadout.spareTorches, this.loadout.flasks);
    this.torchCfg = { burnTime: this.loadout.burnTime, maxRadius: this.loadout.torchRadius };
    this.ropes = this.loadout.ropes;
    this.placed = placeLoot(spots, seed);
  }
}
