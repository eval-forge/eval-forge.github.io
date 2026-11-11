/**
 * Everything about one run that must survive scene streaming: flags, every item's
 * position, the satchel, the stash, broken planks, crumbled tiles, lit sconces, etc.
 * Scenes read it when they build and write to it while they are loaded.
 */
import { Rng } from '../core/rng';
import { RELIC_SLOTS, PROPS, BONE_KEY } from '../world/layout';
import { rollRelic, makeInstance, Satchel, satchelCapacity, type RelicInstance } from '../logic/economy';
import { defaultFlags, type RunFlags, type SceneId, SCENE_DEPTH } from '../logic/unlocks';
import { TorchState, torchStats } from '../logic/torch';
import { ropeCatches, type SaveData } from '../logic/meta';

export type ItemKind = 'relic' | 'sandbag' | 'rock' | 'pot' | 'oil' | 'spareTorch' | 'boneKey' | 'sunDisc' | 'debris';

export interface ItemState {
  uid: string;
  kind: ItemKind;
  relic?: RelicInstance;
  weight: number;
  scene: SceneId;
  pos: [number, number, number];
  quat: [number, number, number, number];
  /** Pedestal this item started on (relic slots). */
  pedestal?: string;
  /** Picked up, consumed, stashed or destroyed: no longer in the world. */
  gone: boolean;
}

export class RunState {
  readonly rng: Rng;
  flags: RunFlags = defaultFlags();
  items = new Map<string, ItemState>();
  satchel: Satchel;
  stash: RelicInstance[] = [];
  handUid: string | null = null;
  oil: number;
  spares: number;
  ropeCatches: number;
  torch: TorchState;
  brokenPlanks = new Set<number>();
  bridgeCollapsed = false;
  crumbled = new Set<string>();
  /** sconce id → seconds of burn left (only lit sconces are present). */
  sconces = new Map<string, number>();
  /** pedestal id → trap fired. */
  pedestalFired = new Set<string>();
  boulderSpent = false;
  blockPos: [number, number, number] | null = null;
  sundialGlyph = -1;
  sundialFailures = 0;
  visitedFloors = new Set<string>();
  visitedScenes = new Set<SceneId>();
  relicsFound = 0;
  deepest: SceneId = 'jungle';
  ghost: number[] = [];
  collapseT = -1; // seconds since the Sun Idol was taken (−1: not started)
  vaultCollapseT = -1;
  ended = false;
  time = 0; // real seconds played

  constructor(public seed: number, public save: SaveData) {
    this.rng = new Rng(seed);
    const u = save.upgrades;
    this.satchel = new Satchel(satchelCapacity(u.satchel));
    const ts = torchStats(u.torch, u.fuel);
    this.torch = new TorchState(ts, false); // you light it (T) when the daylight runs out
    this.oil = ts.startOilFlasks;
    this.spares = ts.startSpareTorches;
    this.ropeCatches = ropeCatches(u.rope);
    this.populate();
  }

  private populate() {
    for (const s of RELIC_SLOTS) {
      const def = rollRelic(this.rng, s.roll);
      const inst = makeInstance(s.id, def, s.roll.zone);
      this.items.set(s.id, {
        uid: s.id,
        kind: 'relic',
        relic: inst,
        weight: inst.weight,
        scene: s.scene,
        pos: [s.x, s.y, s.z],
        quat: [0, 0, 0, 1],
        pedestal: s.pedestal ? s.id : undefined,
        gone: false,
      });
    }
    for (const p of PROPS) {
      this.items.set(p.id, { uid: p.id, kind: p.kind, weight: p.weight, scene: p.scene, pos: [p.x, p.y, p.z], quat: [0, 0, 0, 1], gone: false });
    }
    this.items.set('bone_key', { uid: 'bone_key', kind: 'boneKey', weight: 0.4, scene: 'catacombs', pos: [BONE_KEY.x, BONE_KEY.y, BONE_KEY.z], quat: [0, 0, 0, 1], gone: false });
  }

  /** Add a new world item (e.g. a dropped relic or the Sun Disc). */
  addItem(s: Omit<ItemState, 'gone'>): ItemState {
    const it: ItemState = { ...s, gone: false };
    this.items.set(it.uid, it);
    return it;
  }

  carriedRelics(): RelicInstance[] {
    const out = [...this.satchel.items];
    if (this.handUid) {
      const h = this.items.get(this.handUid);
      if (h?.relic) out.push(h.relic);
    }
    return out;
  }

  carriedValue(): number {
    return this.carriedRelics().reduce((a, r) => a + r.value, 0);
  }

  stashValue(): number {
    return this.stash.reduce((a, r) => a + r.value, 0);
  }

  visit(scene: SceneId) {
    this.visitedScenes.add(scene);
    if (SCENE_DEPTH[scene] > SCENE_DEPTH[this.deepest]) this.deepest = scene;
  }
}
