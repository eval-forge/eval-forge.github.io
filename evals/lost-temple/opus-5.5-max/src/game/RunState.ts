/** Everything that belongs to one run (one day at the temple). */
import { DayClock } from '../logic/countdown';
import { newUnlockState, type UnlockState } from '../logic/unlocks';
import { Satchel, LootLedger, type Gear, type RelicId } from '../logic/economy';
import { TorchState, BASE_TORCH, type TorchStats } from '../logic/torch';
import { Stamina } from '../logic/playerStats';
import { Rng } from '../logic/rng';

export type EndReason = 'escaped' | 'caught' | 'killed' | 'entombed' | 'abandoned';

export class RunState {
  rng: Rng;
  clock: DayClock;
  unlock: UnlockState;
  satchel: Satchel;
  ledger: LootLedger;
  torch: TorchState;
  stamina: Stamina;
  health = 100;
  sinceDamage = 99;
  ropes: number;
  ended = false;
  endReason: EndReason | null = null;
  endCause = '';
  /** Seconds of simulated play. */
  time = 0;
  relicTypesFound = new Set<RelicId>();
  relicsFound = 0;
  trapsTriggered = 0;
  scenesVisited = new Set<string>();
  /** Persistent per-run state of props, keyed by prop id. */
  world = new Map<string, unknown>();

  constructor(public seed: number, public gear: Gear) {
    this.rng = new Rng(seed);
    this.clock = new DayClock();
    this.unlock = newUnlockState();
    this.satchel = new Satchel(gear.satchelCapacity);
    this.ledger = new LootLedger(this.satchel);
    const stats: TorchStats = {
      ...BASE_TORCH,
      fuelCapacity: gear.fuelCapacity,
      maxRadius: BASE_TORCH.maxRadius * gear.torchRadiusMul,
      gustResist: gear.gustResist,
    };
    this.torch = new TorchState(stats, gear.spareTorches, gear.oilFlasks);
    this.stamina = new Stamina(gear.staminaMax);
    this.ropes = gear.ropes;
  }

  flag(f: Parameters<UnlockState['flags']['has']>[0]): boolean {
    return this.unlock.flags.has(f);
  }

  get(key: string): any {
    return this.world.get(key);
  }
  set(key: string, v: unknown) {
    this.world.set(key, v);
  }
}
