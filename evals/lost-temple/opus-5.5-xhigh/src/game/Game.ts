/**
 * The game: owns the engine pieces, the run, the fixed-step simulation loop, player
 * actions, the clock and its consequences (ticks, dusk, darkness, the closing door),
 * win/lose and the meta save. Scenes and entities talk to the world through this class.
 */
import * as THREE from 'three';
import { RAPIER, Physics, Q_INTERACT, type Tag } from '../engine/physics';
import { Renderer, type QualityPreset } from '../engine/renderer';
import { AudioEngine, type Surface, type MusicMood } from '../engine/audio';
import { Input } from '../engine/input';
import { tinted, setExposure, type Exposure } from '../engine/materials';
import { Sky } from '../world/sky';
import { SceneManager, type SceneHandle } from '../world/SceneManager';
import { SPAWN, DOOR, CAMP, FLOORS, sceneAt } from '../world/layout';
import { exposureAt, floorAt } from '../world/query';
import { buildNavMesh } from '../world/build';
import { VEG_LAYER } from '../world/nature';
import { jungle } from '../world/scenes/jungle';
import { courtyard } from '../world/scenes/courtyard';
import { cliffs } from '../world/scenes/cliffs';
import { halls } from '../world/scenes/halls';
import { sanctum } from '../world/scenes/sanctum';
import { catacombs } from '../world/scenes/catacombs';
import { vault } from '../world/scenes/vault';
import { Player, type PlayerEnv } from '../entities/Player';
import { TorchSystem } from '../entities/Torch';
import { Items, itemLabel } from '../entities/Items';
import { Effects } from '../entities/Effects';
import { Guardians } from '../entities/Guardians';
import type { Interactable, PedestalInfo } from '../entities/Interactables';
import { RunState } from './RunState';
import { RunClock, DAY_SECONDS, FINAL_WINDOW, type ClockEvent } from '../logic/clock';
import { speedMultiplier, settleRun, RELIC_BY_ID, type Outcome, type Settlement } from '../logic/economy';
import { parseSave, serializeSave, addScore, bankHaul, maybeStoreGhost, staminaStats, GHOST_HZ, type SaveData, type Settings } from '../logic/meta';
import { streamingSet, SCENES, type SceneId } from '../logic/unlocks';
import type { InstabilityMeter } from '../logic/traps';
import type { GuardianKind } from '../logic/guardians';
import type { NavMesh } from '../logic/navmesh';
import { Hud } from '../ui/hud';
import { Menus } from '../ui/menus';
import { MapView } from '../ui/mapview';
import { DebugOverlay } from '../ui/debug';

export type GameState = 'menu' | 'loading' | 'playing' | 'paused' | 'ending' | 'results';
export type ToastKind = 'info' | 'good' | 'warn' | 'danger';

const SAVE_KEY = 'lost-temple-save-v1';
const FIXED = 1 / 60;

type NoiseFn = (x: number, y: number, z: number, loud: number) => void;

/** Keyed handler list so a scene can register and later remove its handler. */
export class HandlerRegistry<F> {
  private map = new Map<string, F>();
  add(id: string, fn: F) {
    this.map.set(id, fn);
  }
  remove(id: string) {
    this.map.delete(id);
  }
  values() {
    return this.map.values();
  }
}

/** Debug / playtest teleport targets (feet positions). */
export const WARPS: Record<SceneId, { x: number; y: number; z: number; yaw: number }> = {
  jungle: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, yaw: 0 },
  courtyard: { x: 6, y: 0.1, z: 16, yaw: 0 },
  cliffs: { x: 44.5, y: 0.1, z: 32, yaw: 0 },
  halls: { x: 0, y: 0.1, z: -8, yaw: 0 },
  sanctum: { x: 0, y: 0.1, z: -68, yaw: 0 },
  catacombs: { x: -50, y: -9.9, z: -48, yaw: Math.PI / 2 },
  vault: { x: -8, y: -13.9, z: -90, yaw: 0 },
};

interface Target {
  kind: 'item' | 'interact';
  uid?: string;
  it?: Interactable;
  key: string;
}

export interface RunReport {
  settlement: Settlement;
  outcome: Outcome;
  cause: string;
  time: number;
  relicsFound: number;
  deepest: SceneId;
  rank: number;
  bankBefore: number;
  bankAfter: number;
  newGhost: boolean;
}

export class Game {
  // engine
  physics: Physics;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: Renderer;
  audio = new AudioEngine();
  input: Input;
  sky: Sky;
  quality: QualityPreset;
  nav: NavMesh;
  // persistent
  save: SaveData;
  // run
  run!: RunState;
  clock = new RunClock(0);
  player: Player;
  torch: TorchSystem;
  items: Items;
  fx: Effects;
  guardians: Guardians;
  scenes: SceneManager;
  // world hooks
  state: GameState = 'menu';
  exposure: Exposure = 'outdoor';
  pedestals = new Map<string, PedestalInfo>();
  blockBody: RAPIER.RigidBody | null = null;
  sanctumMeter: InstabilityMeter | null = null;
  riverPos: THREE.Vector3 | null = null;
  onNoiseHandlers = new HandlerRegistry<NoiseFn>();
  private standHandlers = new Set<(tag: Tag, c: RAPIER.Collider) => void>();
  ui = { mapOpen: false };
  // ui
  hud: Hud;
  menus: Menus;
  map: MapView;
  debug: DebugOverlay;
  // loop
  private acc = 0;
  private last = 0;
  time = 0;
  frameMs = 0;
  fps = 60;
  private fpsAcc = 0;
  private fpsN = 0;
  private hurt = 0;
  private water = 0;
  private fade = 1;
  private fadeTarget = 1;
  private altTick = false;
  private rumbleT = 0;
  private ghostT = 0;
  private ghostMesh: THREE.Mesh | null = null;
  private target: Target | null = null;
  private holdT = 0;
  private holdUsed = false;
  private hadLock = false;
  private endT = 0;
  private pendingReport: RunReport | null = null;
  private pushT = 0;
  private stashCheckT = 0;
  lastReport: RunReport | null = null;
  /** Automated playtests drive the game without pointer lock. */
  autopilot = false;
  private skipRender = false;
  private menuOrbit = 0;

  static async create(root: HTMLElement): Promise<Game> {
    const physics = new Physics();
    await physics.init();
    return new Game(root, physics);
  }

  constructor(private root: HTMLElement, physics: Physics) {
    this.physics = physics;
    this.save = this.loadSave();
    const s = this.save.settings;
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    root.appendChild(canvas);
    this.camera = new THREE.PerspectiveCamera(s.fov, window.innerWidth / window.innerHeight, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';
    this.camera.layers.enable(VEG_LAYER);
    this.scene.add(this.camera);
    this.renderer = new Renderer(canvas, this.scene, this.camera, s.quality);
    this.quality = this.renderer.q;
    this.input = new Input(canvas);
    this.sky = new Sky(this.scene, this.quality.sunShadow);
    this.sky.sun.shadow.camera.layers.enable(VEG_LAYER);
    this.nav = buildNavMesh();

    const env = this.playerEnv();
    this.player = new Player(physics, this.input, env);
    this.run = new RunState(1, this.save);
    this.torch = new TorchSystem(this);
    this.items = new Items(this);
    this.fx = new Effects(this);
    this.guardians = new Guardians(this, this.nav);
    this.scenes = new SceneManager(this, { jungle, courtyard, cliffs, halls, sanctum, catacombs, vault });

    this.hud = new Hud(this, root);
    this.map = new MapView(this, root);
    this.debug = new DebugOverlay(this, root);
    this.menus = new Menus(this, root);
    this.applySettings();

    this.input.onPointerLockChange = (locked) => {
      if (locked) this.hadLock = true;
      if (!locked && this.state === 'playing' && this.hadLock && !this.autopilot) this.pause();
    };
    canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.locked && !this.autopilot) this.input.requestLock();
    });
    this.last = performance.now();
  }

  // ================================================================== save / settings

  private loadSave(): SaveData {
    try {
      return parseSave(localStorage.getItem(SAVE_KEY));
    } catch {
      return parseSave(null);
    }
  }

  persist() {
    try {
      localStorage.setItem(SAVE_KEY, serializeSave(this.save));
    } catch {
      /* storage unavailable: the run still works, it just isn't remembered */
    }
  }

  get settings(): Settings {
    return this.save.settings;
  }

  applySettings() {
    const s = this.settings;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    if (this.renderer.q !== this.quality || (this.renderer as any)._qname !== s.quality) {
      this.renderer.setQuality(s.quality);
      (this.renderer as any)._qname = s.quality;
      this.quality = this.renderer.q;
      this.sky.setShadowSize(this.quality.sunShadow);
      this.torch.setShadowSize(this.quality.torchShadow);
    }
    this.debug.setFpsOnly(s.showFps);
  }

  updateSettings(patch: Partial<Settings>) {
    this.save = { ...this.save, settings: { ...this.save.settings, ...patch } };
    this.persist();
    this.applySettings();
  }

  setSave(s: SaveData) {
    this.save = s;
    this.persist();
  }

  // ================================================================== player environment

  private playerEnv(): PlayerEnv {
    const game = this;
    const wind = new THREE.Vector3();
    return {
      speedMult() {
        const run = game.run;
        return speedMultiplier(run.satchel.weight(), run.satchel.capacity) * game.items.handSpeedMult();
      },
      canSprint() {
        return game.items.handWeight() <= 2;
      },
      relighting() {
        return game.run.torch.relighting;
      },
      get staminaMax() {
        return staminaStats(game.run.save.upgrades.boots).max;
      },
      get staminaRegen() {
        return staminaStats(game.run.save.upgrades.boots).regen;
      },
      get climbFast() {
        return game.run.save.upgrades.rope >= 2;
      },
      get quietSteps() {
        return staminaStats(game.run.save.upgrades.boots).quietSteps;
      },
      vines() {
        const out = [];
        for (const h of game.scenes.handles()) out.push(...h.vines);
        return out;
      },
      waters() {
        const out = [];
        for (const h of game.scenes.handles()) out.push(...h.waters);
        return out;
      },
      wind() {
        wind.set(0, 0, 0);
        const p = game.player.pos;
        for (const h of game.scenes.handles()) {
          for (const w of h.winds) {
            if (p.x >= w.x0 && p.x <= w.x1 && p.z >= w.z0 && p.z <= w.z1 && p.y >= w.y0 && p.y <= w.y1) {
              wind.x += w.dir[0] * w.strength * 3.2;
              wind.z += w.dir[1] * w.strength * 3.2;
            }
          }
        }
        if (game.player.crouching) wind.multiplyScalar(0.35);
        return wind;
      },
      onStep(surface: Surface, loud: number, pos: THREE.Vector3) {
        const run = game.run;
        const load = run.satchel.weight() / Math.max(1, run.satchel.capacity) + game.items.handWeight() / 20;
        const l = Math.min(1, loud * (1 + load * 0.6));
        game.audio.footstep(surface, l);
        game.noise(pos.x, pos.y, pos.z, l);
      },
      onLand(impact: number, surface: Surface, pos: THREE.Vector3) {
        game.audio.land(Math.min(1, impact / 14), surface);
        game.noise(pos.x, pos.y, pos.z, Math.min(1, impact / 16));
        game.torch.onLand(impact);
        game.fx.shake = Math.max(game.fx.shake, Math.min(0.5, impact / 40));
      },
      onDamage(amount: number, source: string) {
        game.onPlayerDamage(amount, source);
      },
      onPush(body: RAPIER.RigidBody, dir: THREE.Vector3) {
        game.onPlayerPush(body, dir);
      },
      onStandOn(c: RAPIER.Collider) {
        const tag = game.physics.tagOf(c);
        if (!tag) return;
        for (const fn of game.standHandlers) fn(tag, c);
      },
      onSplash(pos: THREE.Vector3, big: boolean) {
        game.audio.splash(pos, big ? 1 : 0.5);
        game.noise(pos.x, pos.y, pos.z, big ? 0.6 : 0.3);
      },
    };
  }

  // ================================================================== hooks used by scenes / entities

  toast(msg: string, kind: ToastKind = 'info') {
    this.hud.toast(msg, kind);
  }

  /** A noise the guardians (and the unstable sanctum roof) can hear. 0..1 */
  noise(x: number, y: number, z: number, loud: number) {
    if (loud <= 0) return;
    this.guardians.noise({ x, y, z, loudness: loud });
    for (const fn of this.onNoiseHandlers.values()) fn(x, y, z, loud);
  }

  hurtFlash(n: number) {
    this.hurt = Math.max(this.hurt, Math.min(1, n));
  }

  /** Called every physics step for the collider the player stands on. */
  onStand(fn: (tag: Tag, c: RAPIER.Collider) => void): () => void {
    this.standHandlers.add(fn);
    return () => this.standHandlers.delete(fn);
  }

  onSceneLoaded(_h: SceneHandle) {
    /* hook for the debug overlay / playtests */
  }

  onSceneChanged(s: SceneId) {
    this.run.visit(s);
    if (this.state === 'playing') this.hud.sceneBanner(SCENES[s].name, SCENES[s].zone);
  }

  /** A relic just left a pedestal; `loadAfter` is what's still on the plate. */
  onPedestalLift(id: string, _relicWeight: number, loadAfter: number) {
    const info = this.pedestals.get(id);
    if (!info) return;
    let fired = false;
    if (info.logic) {
      this.audio.click();
      fired = info.logic.onRelicLifted(loadAfter) === 'fire';
      if (fired) this.run.pedestalFired.add(id);
    }
    if (id === 'idol') {
      this.startCollapse(fired);
      return;
    }
    if (!info.logic) return;
    if (!fired) {
      this.toast('The plate settles under the new weight. Nothing happens.', 'good');
      return;
    }
    switch (info.trap) {
      case 'darts': {
        const chest = new THREE.Vector3(this.player.pos.x, this.player.feetY + 1.25, this.player.pos.z);
        this.fx.volleyAt(info.dartSources, chest);
        this.toast('Click! The plate rises... darts!', 'danger');
        break;
      }
      case 'collapse':
        if (this.run.vaultCollapseT < 0) {
          this.run.vaultCollapseT = 0;
          this.toast('The vault ceiling groans and starts to give way!', 'danger');
          this.audio.rumble(4, 1);
        }
        break;
      default:
        break;
    }
  }

  private startCollapse(fired: boolean) {
    const run = this.run;
    if (run.flags.idolTaken) return;
    run.flags.idolTaken = true;
    run.collapseT = fired ? 3 : 0;
    this.handleClock(this.clock.advance(fired ? 90 : 45));
    this.audio.rumble(5, 1);
    this.fx.shake = 0.7;
    this.toast(fired ? 'The plate snaps up. The whole sanctum heaves, and the sun lurches across the sky!' : 'The Sun Idol is free. The sanctum begins to collapse, and the sun lurches across the sky!', 'danger');
  }

  caught(kind: GuardianKind) {
    if (this.state !== 'playing') return;
    const names: Record<GuardianKind, string> = { sentinel: 'A Stone Sentinel', crawler: 'A Crawler', shade: 'A Shade' };
    this.audio.roar(this.player.eye());
    this.endRun('caught', `${names[kind]} caught you.`);
  }

  /** Put everything carried into the camp stash. */
  stashAtCamp() {
    const { n, value } = this.items.stashCarried();
    if (n > 0) {
      this.audio.stash(n);
      this.toast(`Secured ${n} relic${n > 1 ? 's' : ''} at camp (+$${value}). Stash: $${this.run.stashValue()}`, 'good');
    }
  }

  private onPlayerDamage(amount: number, source: string) {
    this.audio.hurt();
    this.hurtFlash(Math.min(1, 0.35 + amount / 40));
    this.fx.shake = Math.max(this.fx.shake, Math.min(0.6, amount / 60));
    if (this.player.health > 0 || this.state !== 'playing') return;
    if ((source === 'fall' || source === 'abyss') && this.run.ropeCatches > 0) {
      this.ropeCatch();
      return;
    }
    const why: Record<string, string> = {
      fall: 'The fall killed you.',
      abyss: 'You fell into the abyss.',
      drowned: 'You drowned.',
      dart: 'Poisoned darts brought you down.',
      blade: 'A swinging blade cut you down.',
      boulder: 'Crushed by the boulder.',
      debris: 'Buried by falling stone.',
      spikes: 'Impaled on the pit spikes.',
    };
    this.endRun('killed', why[source] ?? 'You died.');
  }

  private ropeCatch() {
    const run = this.run;
    run.ropeCatches--;
    const p = this.player;
    p.dead = false;
    p.health = 35;
    const s = p.lastSafe;
    p.teleport(s.x, s.y + 0.05, s.z);
    this.audio.snap();
    this.fx.shake = 0.5;
    this.toast(`Your safety line catches you! (${run.ropeCatches} catch${run.ropeCatches === 1 ? '' : 'es'} left)`, 'warn');
  }

  private onPlayerPush(body: RAPIER.RigidBody, dir: THREE.Vector3) {
    if (body === this.blockBody) {
      // shoulder the stone block: slow, heavy, noisy
      if (this.player.stamina > 2) {
        const v = body.linvel();
        const speed = 1.15;
        body.setLinvel({ x: dir.x * speed, y: v.y, z: dir.z * speed }, true);
        this.player.stamina = Math.max(0, this.player.stamina - 0.12);
        this.pushT -= FIXED;
        if (this.pushT <= 0) {
          this.pushT = 0.9;
          const t = body.translation();
          this.audio.stoneGrind(t, 0.9, 0.35);
          this.noise(t.x, t.y, t.z, 0.3);
        }
      }
      return;
    }
    const m = body.mass();
    if (m > 200) return;
    const k = Math.min(m, 25) * 0.05;
    body.applyImpulse({ x: dir.x * k, y: 0, z: dir.z * k }, true);
  }

  // ================================================================== run lifecycle

  /** Start a fresh expedition (also used for the menu backdrop). */
  newRun(play: boolean) {
    this.state = 'loading';
    this.ui.mapOpen = false;
    this.map.setOpen(false);
    this.scenes.unloadAll();
    this.items.clear();
    this.fx.clear();
    this.guardians.clear();
    this.pedestals.clear();
    this.blockBody = null;
    this.sanctumMeter = null;
    this.riverPos = null;
    this.standHandlers.clear();
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    this.run = new RunState(seed, this.save);
    this.clock = new RunClock(0);
    this.player.reset(staminaStats(this.save.upgrades.boots).max);
    this.player.frozen = false;
    this.player.pitch = 0;
    this.player.teleport(SPAWN.x, SPAWN.y, SPAWN.z, SPAWN.yaw);
    this.scenes.setCurrent('jungle');
    this.scenes.loadSync(streamingSet('jungle'));
    this.guardians.reset();
    this.run.visit('jungle');
    this.target = null;
    this.hurt = 0;
    this.endT = 0;
    this.pendingReport = null;
    this.audio.setHeartbeat(0, 0);
    this.buildGhost();
    this.acc = 0;
    if (play) {
      this.state = 'playing';
      this.fade = 0;
      this.fadeTarget = 1;
      this.hud.show(true);
      this.hud.sceneBanner(SCENES.jungle.name, 'A');
      this.audio.setMood('calm');
      this.toast('Dawn. You have until dark (13 minutes). Loot only counts once it is out of the great door.', 'info');
      setTimeout(() => this.state === 'playing' && this.toast('Your torch is unlit to save fuel. T lights it (and douses it).', 'info'), 4500);
      if (!this.autopilot) this.input.requestLock();
    } else {
      this.state = 'menu';
      this.fade = 1;
      this.hud.show(false);
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitLock();
    this.menus.showPause();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.menus.hideAll();
    if (!this.autopilot) this.input.requestLock();
  }

  /** Give up the run from the pause menu. */
  abandon() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.menus.hideAll();
    this.endRun('abandoned', 'You abandoned the expedition.');
  }

  endRun(outcome: Outcome, cause = '') {
    if (this.state !== 'playing' || this.run.ended) return;
    const run = this.run;
    run.ended = true;
    if (outcome !== 'escaped' && outcome !== 'abandoned') this.player.dead = true;
    this.player.frozen = true;
    if (this.items.held) this.items.releaseHeld(false);
    const carried = run.carriedRelics();
    const settlement = settleRun(outcome, run.stash, carried);
    const bankBefore = this.save.bank;
    let save = bankHaul(this.save, settlement.haul);
    const entry = {
      haul: settlement.haul,
      outcome,
      timeSurvived: Math.round(run.time),
      relics: settlement.relicsOut,
      date: new Date().toISOString(),
      deepest: SCENES[run.deepest].name,
    };
    const ranked = addScore(save, entry);
    save = ranked.save;
    const before = save.ghost;
    save = maybeStoreGhost(save, settlement.haul, settlement.escaped, run.ghost);
    this.setSave(save);
    this.pendingReport = {
      settlement,
      outcome,
      cause,
      time: run.time,
      relicsFound: run.relicsFound,
      deepest: run.deepest,
      rank: ranked.rank,
      bankBefore,
      bankAfter: save.bank,
      newGhost: save.ghost !== before,
    };
    this.state = 'ending';
    this.endT = 0;
    this.fadeTarget = 0;
    this.input.exitLock();
    this.audio.setHeartbeat(0, 0);
    this.audio.setMood(settlement.escaped ? 'calm' : 'off');
    if (outcome === 'caught' || outcome === 'killed' || outcome === 'sealed') this.fx.shake = 0.6;
  }

  private finishEnding() {
    this.state = 'results';
    this.lastReport = this.pendingReport;
    this.hud.show(false);
    this.map.setOpen(false);
    this.ui.mapOpen = false;
    if (this.lastReport) this.menus.showResults(this.lastReport);
  }

  // ================================================================== clock

  private handleClock(events: ClockEvent[]) {
    for (const e of events) {
      if (e.type === 'tick') {
        this.altTick = !this.altTick;
        this.audio.tick(e.volume, e.urgent, this.altTick);
        this.hud.tickPulse(e.urgent);
        continue;
      }
      switch (e.phase) {
        case 'late':
          this.toast('Two minutes until dark. The sundial ticks faster.', 'warn');
          break;
        case 'critical':
          this.toast('One minute to darkness! The temple trembles.', 'danger');
          this.audio.rumble(4, 0.8);
          this.fx.shake = Math.max(this.fx.shake, 0.4);
          break;
        case 'dark':
          this.toast(`Darkness. The great door is closing: ${FINAL_WINDOW} seconds!`, 'danger');
          this.audio.rumble(6, 1);
          this.fx.shake = Math.max(this.fx.shake, 0.6);
          break;
        case 'sealed':
          this.onDoorSealed();
          break;
        default:
          break;
      }
    }
  }

  private playerInside(): boolean {
    const p = this.player.pos;
    const s = sceneAt(p.x, p.y, p.z) ?? this.scenes.current;
    return SCENES[s].zone !== 'A' || p.z < 0.3;
  }

  private onDoorSealed() {
    this.run.flags.greatDoorClosed = true;
    this.audio.thud(new THREE.Vector3(DOOR.x, 1, DOOR.z), 1);
    this.audio.rumble(3, 1);
    if (this.playerInside()) {
      this.endRun('sealed', 'The great door sealed you inside the temple.');
    } else {
      this.stashAtCamp();
      this.endRun('escaped', 'Night fell with you safely outside.');
    }
  }

  private musicMood(): MusicMood {
    const ph = this.clock.phase;
    if (ph === 'dark' || ph === 'sealed') return 'night';
    if (ph === 'critical') return 'dusk';
    if (ph === 'late' || this.exposure === 'dungeon') return 'tense';
    return 'calm';
  }

  // ================================================================== interaction

  private findTarget(): Target | null {
    const p = this.player;
    if (p.dead) return null;
    const eye = p.eye();
    const dir = p.lookDir();
    const held = this.items.held;
    const hit = this.physics.ray(eye, dir, 2.7, Q_INTERACT, p.collider, held?.body ?? null, undefined, true);
    if (!hit) return null;
    const tag = this.physics.tagOf(hit.collider);
    if (!tag) return null;
    if (tag.kind === 'item' && typeof tag.ref === 'string') {
      if (held && held.st.uid === tag.ref) return null;
      return { kind: 'item', uid: tag.ref, key: 'item:' + tag.ref };
    }
    if (tag.kind === 'interact' && tag.ref) return { kind: 'interact', it: tag.ref as Interactable, key: 'it:' + hit.collider.handle };
    return null;
  }

  private itemPrompt(uid: string): string | null {
    const li = this.items.live.get(uid);
    if (!li) return null;
    const st = li.st;
    const label = itemLabel(st);
    const held = this.items.held;
    switch (st.kind) {
      case 'oil':
      case 'spareTorch':
      case 'boneKey':
      case 'sunDisc':
        return `${label}\nE  Take`;
      case 'relic': {
        const lines = [label];
        if (st.pedestal && held) lines.push(`E  Swap with what you hold (${held.st.weight.toFixed(1)} kg)`);
        else if (this.run.satchel.canAdd(st.relic!)) lines.push('E  Put in satchel     F  Carry in hands');
        else lines.push('Too heavy for the satchel.   F  Carry in hands');
        if (st.pedestal && this.pedestals.get(st.pedestal)?.trap && !held) lines.push('The pedestal is a weight plate...');
        return lines.join('\n');
      }
      default:
        return st.weight > 30 ? `${label}\nFar too heavy to lift` : `${label}\nF  Grab`;
    }
  }

  private updateInteraction(dt: number) {
    const inp = this.input;
    const t = this.findTarget();
    if (!t || !this.target || t.key !== this.target.key) {
      this.holdT = 0;
      this.holdUsed = false;
    }
    this.target = t;
    let prompt: string | null = null;
    let progress = -1;
    if (t?.kind === 'item') {
      prompt = this.itemPrompt(t.uid!);
      if (inp.pressed('interact')) this.items.interact(t.uid!);
    } else if (t?.kind === 'interact' && t.it) {
      const it = t.it;
      prompt = it.prompt(this);
      if (prompt && it.hold) {
        if (inp.isHeld('interact') && !this.holdUsed) {
          this.holdT += dt;
          progress = Math.min(1, this.holdT / it.hold);
          if (this.holdT >= it.hold) {
            this.holdUsed = true;
            it.use(this);
          }
        } else if (!inp.isHeld('interact')) {
          this.holdT = 0;
          this.holdUsed = false;
        }
      } else if (prompt && inp.pressed('interact')) it.use(this);
    }
    if (!prompt) {
      const held = this.items.held;
      if (held) prompt = `Holding: ${itemLabel(held.st)}\nF  Drop     LMB  Throw`;
    }
    this.hud.setPrompt(prompt, progress);

    // hands
    if (inp.pressed('grab')) {
      if (this.items.held) this.items.releaseHeld(true);
      else if (t?.kind === 'item') this.items.grab(t.uid!);
    }
    if (inp.pressed('throw') && this.items.held) this.items.throwHeld();
    if (inp.pressed('drop')) {
      if (this.items.held) this.items.releaseHeld(false);
      else this.items.dropFromSatchel();
    }
    if (inp.pressed('torch')) this.torch.toggle();
    if (inp.pressed('refuel')) this.torch.refuel();
  }

  // ================================================================== ghost

  private buildGhost() {
    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
      this.ghostMesh = null;
    }
    if (!this.save.ghost) return;
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 1.1, 4, 8), tinted(0x9fc8ff, 'outdoor', 0.6, 0, { transparent: true, opacity: 0.28 }));
    m.material.depthWrite = false;
    m.castShadow = false;
    m.receiveShadow = false;
    m.renderOrder = 2;
    this.ghostMesh = m;
    this.scene.add(m);
  }

  private updateGhost(dt: number) {
    const run = this.run;
    this.ghostT += dt;
    if (this.ghostT >= 1 / GHOST_HZ) {
      this.ghostT -= 1 / GHOST_HZ;
      const f = this.player.feet();
      if (run.ghost.length < 4 * GHOST_HZ * 60 * 20) run.ghost.push(f.x, f.y, f.z, this.player.yaw);
    }
    const g = this.save.ghost;
    const m = this.ghostMesh;
    if (!g || !m) return;
    const n = g.samples.length / 4;
    const ft = run.time * GHOST_HZ;
    const i = Math.floor(ft);
    if (i >= n - 1) {
      m.visible = false;
      return;
    }
    const k = ft - i;
    const s = g.samples;
    const x = s[i * 4] + (s[i * 4 + 4] - s[i * 4]) * k;
    const y = s[i * 4 + 1] + (s[i * 4 + 5] - s[i * 4 + 1]) * k;
    const z = s[i * 4 + 2] + (s[i * 4 + 6] - s[i * 4 + 2]) * k;
    m.position.set(x, y + 0.88, z);
    m.visible = m.position.distanceTo(this.player.pos) > 1.2;
    setExposure(m, exposureAt(x, y + 0.5, z));
  }

  // ================================================================== debug helpers

  warp(s: SceneId) {
    const w = WARPS[s];
    this.scenes.setCurrent(s);
    this.scenes.loadSync(streamingSet(s));
    this.player.teleport(w.x, w.y, w.z, w.yaw);
    this.player.pitch = 0;
    this.run.visit(s);
  }

  skipTime(seconds: number) {
    this.handleClock(this.clock.advance(seconds));
  }

  /** Run `seconds` of game time at 60 Hz without rendering (automated playtests). */
  advance(seconds: number) {
    const n = Math.round(seconds * 60);
    this.skipRender = true;
    try {
      for (let i = 0; i < n; i++) this.frame(1 / 60);
    } finally {
      this.skipRender = false;
    }
  }

  unlockAll() {
    const f = this.run.flags;
    f.greatDoorOpen = true;
    f.sundialSolved = true;
    f.hasSunDisc = true;
    f.sunSealOpen = true;
    f.hasBoneKey = true;
    f.vaultDoorOpen = true;
    f.kickWallBroken = true;
    f.drawbridgeDown = true;
    this.toast('Debug: all gates unlocked (reload scenes to see doors move).', 'warn');
  }

  // ================================================================== frame

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      this.frameMs = performance.now() - now;
    };
    requestAnimationFrame(loop);
  }

  frame(dt: number) {
    this.time += dt;
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsN / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    const inp = this.input;
    inp.poll();
    if (inp.pressed('debug')) this.debug.toggle();
    if (inp.pressed('warp')) this.debug.toggleWarp();

    if (this.state === 'playing') this.playFrame(dt);
    else if (this.state === 'ending') {
      this.endT += dt;
      this.simulate(dt * 0.35);
      this.commonFrame(dt * 0.35);
      if (this.endT > 1.8) this.finishEnding();
    } else if (this.state === 'menu') {
      this.menuFrame(dt);
    } else {
      // paused / results / loading: keep rendering the frozen world
      this.commonFrame(0);
    }

    // post / grade
    this.fade += (this.fadeTarget - this.fade) * Math.min(1, dt * (this.fadeTarget > this.fade ? 1.6 : 2.2));
    const g = this.sky.grade;
    const u = this.renderer.grade.uniforms;
    if (g) {
      // underground the grade loses the sky's colour cast
      const sf = this.sky.skyFactor;
      u.uExposure.value = g.exposure * sf + 1.0 * (1 - sf);
      u.uSaturation.value = g.saturation * sf + 0.95 * (1 - sf);
      u.uContrast.value = g.contrast * sf + 1.06 * (1 - sf);
      u.uTint.value.set(g.tint[0] * sf + (1 - sf), g.tint[1] * sf + (1 - sf), g.tint[2] * sf + (1 - sf));
    }
    this.hurt = Math.max(0, this.hurt - dt * 1.4);
    this.water += ((this.player.eyeUnderwater ? 1 : 0) - this.water) * Math.min(1, dt * 6);
    u.uHurt.value = this.hurt;
    u.uWater.value = this.water;
    u.uFade.value = this.fade;
    if (!this.skipRender) this.renderer.render();
    this.hud.update(dt);
    this.map.update(dt);
    this.debug.update(dt);
    inp.endFrame();
  }

  private simulate(dt: number) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED && steps < 4) {
      this.fixedStep(FIXED);
      this.acc -= FIXED;
      steps++;
    }
    if (steps === 4) this.acc = 0;
  }

  private fixedStep(dt: number) {
    this.player.fixedUpdate(dt);
    this.items.fixedUpdate(dt);
    this.fx.fixedUpdate(dt);
    for (const h of this.scenes.handles()) for (const f of h.fixed) f(dt);
    if (this.state === 'playing') this.guardians.fixedUpdate(dt);
    this.physics.step();
  }

  private playFrame(dt: number) {
    const inp = this.input;
    const p = this.player;
    const run = this.run;
    if (inp.pressed('pause')) {
      this.pause();
      return;
    }
    if (inp.pressed('map')) {
      this.ui.mapOpen = !this.ui.mapOpen;
      this.map.setOpen(this.ui.mapOpen);
    }
    if (inp.locked || inp.gamepadActive || this.autopilot) p.look(inp.lookDX, inp.lookDY, this.settings.sensitivity, this.settings.invertY);

    run.time += dt;
    this.handleClock(this.clock.update(dt));
    if (this.state !== 'playing') return;

    this.simulate(dt);
    if (this.state !== 'playing') return;
    this.updateInteraction(dt);

    // map: floors you've stood on
    const fl = floorAt(p.pos.x, p.feetY + 0.3, p.pos.z);
    if (fl) run.visitedFloors.add(fl.id);
    this.map.reveal(p.pos.x, p.pos.z);

    // falling out of the world
    if (p.pos.y < -58) {
      p.health = 0;
      this.onPlayerDamage(0, 'abyss');
      if (this.state !== 'playing') return;
    }

    // auto-stash: stepping outside the great door (or near the camp) secures your loot
    this.stashCheckT -= dt;
    if (this.stashCheckT <= 0) {
      this.stashCheckT = 0.25;
      const outsideDoor = p.pos.z > 0.6 && p.pos.z < 14 && Math.abs(p.pos.x) < 12 && p.feetY > -1;
      const atCamp = Math.hypot(p.pos.x - CAMP.x, p.pos.z - CAMP.z) < 6;
      if ((outsideDoor || atCamp) && run.carriedValue() > 0) this.stashAtCamp();
    }

    // the closing door: don't let the slab crush the player into the floor
    const closure = this.clock.doorClosure;
    if (closure > 0.86 && Math.abs(p.pos.x - DOOR.x) < 3.3 && Math.abs(p.pos.z - DOOR.z) < 1.0) {
      const out = p.pos.z > DOOR.z ? 1 : -1;
      p.teleport(p.pos.x, Math.max(0, p.feetY), DOOR.z + out * 1.6);
    }

    // dusk effects and darkness
    const tl = this.clock.timeLeft;
    if (tl <= 60 && tl > -FINAL_WINDOW) {
      this.rumbleT -= dt;
      if (this.rumbleT <= 0) {
        this.rumbleT = 7 + Math.random() * 6;
        this.audio.rumble(2.5, tl > 0 ? 0.5 : 0.8);
        this.fx.shake = Math.max(this.fx.shake, tl > 0 ? 0.25 : 0.35);
      }
      this.fx.shake = Math.max(this.fx.shake, tl > 0 ? 0.03 : 0.05);
    }
    if (this.clock.elapsed >= DAY_SECONDS) this.guardians.checkWaves(this.clock.elapsed);
    this.audio.setMood(this.musicMood());
    this.torch.tickSconces(dt);
    this.updateGhost(dt);
    if (p.dead && this.state === 'playing') this.endRun('killed', 'You died.');
    this.commonFrame(dt);
  }

  private menuFrame(dt: number) {
    // slow pan over the jungle at dawn behind the menu
    this.menuOrbit += dt * 0.05;
    const p = this.player;
    p.yaw = Math.sin(this.menuOrbit) * 0.6;
    p.pitch = 0.04 + Math.sin(this.menuOrbit * 0.7) * 0.03;
    this.commonFrame(dt);
  }

  /** Per-frame visuals shared by every state. */
  private commonFrame(dt: number) {
    const p = this.player;
    const eye = p.eye();
    this.scenes.update(dt, p.pos);
    this.exposure = exposureAt(eye.x, eye.y, eye.z);
    const underground = this.exposure === 'dungeon';
    this.sky.update(Math.max(dt, 0.0001), this.clock.elapsed, p.pos, underground, this.time);
    for (const h of this.scenes.handles()) for (const u of h.update) u(dt, this.time);
    this.items.update(dt);
    this.fx.update(dt);
    this.guardians.update(dt, this.time);
    this.torch.update(dt, this.time, this.exposure);

    // camera
    const cam = this.camera;
    p.landKick = Math.max(0, p.landKick - dt * 3);
    const bobAmt = p.grounded && p.moving && !p.climbing ? (p.sprinting ? 0.05 : 0.03) : 0;
    const bob = Math.sin(p.bob * 2) * bobAmt;
    cam.position.set(eye.x, eye.y + bob - p.landKick * 0.12, eye.z);
    const sh = this.fx.shake;
    this.fx.shake = Math.max(0, sh - dt * 0.9);
    cam.position.x += (Math.random() - 0.5) * sh * 0.12;
    cam.position.y += (Math.random() - 0.5) * sh * 0.12;
    cam.position.z += (Math.random() - 0.5) * sh * 0.12;
    cam.rotation.set(p.pitch + (Math.random() - 0.5) * sh * 0.015, p.yaw, Math.sin(p.bob) * bobAmt * 0.15);
    const fovWant = this.settings.fov + (p.sprinting ? 5 : 0);
    if (Math.abs(cam.fov - fovWant) > 0.05) {
      cam.fov += (fovWant - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
    }

    // audio
    if (this.audio.ready) {
      const ts = this.run.torch;
      const g = this.sky.grade;
      const wind = this.playerWindStrength();
      this.audio.update(dt, {
        torchLevel: ts.lit ? Math.min(1, ts.radius / ts.stats.maxRadius) : 0,
        outdoor: this.exposure === 'outdoor' ? 1 : 0,
        dungeon: underground ? 1 : 0,
        daylight: g ? Math.min(1, g.sunIntensity / 2.6) * this.sky.skyFactor : 1,
        dusk: Math.max(0, Math.min(1, (this.clock.elapsed / DAY_SECONDS - 0.85) / 0.15)),
        wind,
        riverPos: this.riverPos,
        inWater: p.eyeUnderwater,
      });
      this.audio.updateListener(cam);
    }
  }

  private playerWindStrength(): number {
    const p = this.player.pos;
    let s = 0;
    for (const h of this.scenes.handles()) {
      for (const w of h.winds) {
        if (p.x >= w.x0 && p.x <= w.x1 && p.z >= w.z0 && p.z <= w.z1 && p.y >= w.y0 && p.y <= w.y1) s = Math.max(s, w.strength);
      }
    }
    return s;
  }

  // ================================================================== info for the HUD / debug

  get carriedWeight(): number {
    return this.run.satchel.weight() + this.items.handWeight();
  }

  relicName(defId: string) {
    return RELIC_BY_ID[defId]?.name ?? defId;
  }

  floorsVisited(): string[] {
    return FLOORS.filter((f) => this.run.visitedFloors.has(f.id)).map((f) => f.id);
  }
}
