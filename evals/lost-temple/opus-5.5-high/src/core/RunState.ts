import type { Flags } from '../logic/unlocks';
import type { CarriedRelic, GearStats, SceneId } from '../logic/economy';
import { newTorch, type TorchState } from '../logic/torch';

/** Everything that belongs to one run. Thrown away when the run ends. */
export class RunState {
  flags: Flags = {};
  carried: CarriedRelic[] = [];
  torch: TorchState;
  spareTorches: number;
  health = 100;
  stamina: number;
  elapsed = 0;
  /** Seconds removed from the day by the sanctum collapse. */
  dayPenalty = 0;
  relicsSeen = new Set<string>();
  /** Persisted state of streamed-out entities, keyed by entity id. */
  entities = new Map<string, any>();
  sundialStep = 0;
  outcome: 'escaped' | 'caught' | 'killed' | 'sealed' | null = null;
  deathCause = '';
  scenesVisited = new Set<SceneId>();
  enteredTemple = false;
  ghost: number[] = [];
  explored = new Set<string>();

  constructor(public seed: number, public gear: GearStats) {
    this.torch = newTorch(gear.fuelCapacity);
    this.spareTorches = gear.spareTorches;
    this.stamina = gear.maxStamina;
  }

  get carriedWeight() { return this.carried.reduce((s, c) => s + c.weight, 0); }
  get carriedValue() { return this.carried.reduce((s, c) => s + c.value, 0); }
  has(relicId: string) { return this.carried.some((c) => c.relicId === relicId); }
}
