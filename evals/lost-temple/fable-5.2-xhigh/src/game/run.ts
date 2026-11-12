/** Everything that belongs to one run and is thrown away when it ends. */
import { DayClock } from '../core/clock';
import { Satchel, loadoutFor, rollLoot, type CarriedRelic, type GearLevels, type Loadout, type RelicId } from '../core/economy';
import { GhostRecorder } from '../core/ghost';
import type { Noise } from '../core/noise';
import type { Outcome } from '../core/save';
import type { SceneId, Vec3Like } from '../core/scenes';
import { TorchModel } from '../core/torch';
import type { Flag } from '../core/unlock';
import type { PropRecord } from '../world/entities/props';
import { lootSpots } from '../world/layout';

export interface DroppedRelic {
  id: number;
  item: CarriedRelic;
  pos: Vec3Like;
  scene: SceneId;
}

export class Run {
  readonly clock = new DayClock();
  readonly loadout: Loadout;
  readonly satchel: Satchel;
  readonly torch: TorchModel;
  readonly flags = new Set<Flag>();
  /** Which relic sits at each spot this run. */
  readonly loot: Map<string, RelicId>;
  /** Spots whose relic has been lifted. */
  readonly taken = new Set<string>();
  /** Free-form entity state that must survive a scene being streamed out. */
  readonly persist = new Map<string, unknown>();
  dropped: DroppedRelic[] = [];
  private nextDropId = 1;
  /** Every loose prop in the temple and where it was last seen. */
  readonly props = new Map<string, PropRecord>();
  /** Noises made since the guardians last thought. */
  noises: Noise[] = [];
  health = 100;
  /** The player has been through the great door at least once. */
  entered = false;
  outcome: Outcome | null = null;
  /** Why the run ended, for the results screen. */
  epitaph = '';
  relicsLifted = 0;
  deepest: SceneId = 'jungle';
  readonly visited = new Set<SceneId>(['jungle']);
  /** Map cells (4 m grid) the player has seen. */
  readonly explored = new Set<string>();
  ropes: number;
  readonly ghost = new GhostRecorder();
  /** Spare torches mounted in sconces (ids). */
  readonly litSconces = new Set<string>();
  damageTaken = 0;

  constructor(
    readonly seed: number,
    gear: GearLevels,
  ) {
    this.loadout = loadoutFor(gear);
    this.satchel = new Satchel(this.loadout.satchelCapacity);
    this.torch = new TorchModel(this.loadout.fuelCapacity, this.loadout.torchRadius, this.loadout.spareTorches);
    this.ropes = this.loadout.ropes;
    this.loot = rollLoot(seed, lootSpots());
  }

  get time(): number {
    return this.clock.t;
  }

  drop(item: CarriedRelic, pos: Vec3Like, scene: SceneId): DroppedRelic {
    const d: DroppedRelic = { id: this.nextDropId++, item, pos: { ...pos }, scene };
    this.dropped.push(d);
    return d;
  }

  undrop(id: number): void {
    this.dropped = this.dropped.filter((d) => d.id !== id);
  }

  get<T>(key: string, fallback: T): T {
    return this.persist.has(key) ? (this.persist.get(key) as T) : fallback;
  }

  set(key: string, value: unknown): void {
    this.persist.set(key, value);
  }
}
