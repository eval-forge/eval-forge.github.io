/**
 * Top-level orchestration: owns every subsystem and the current Run, runs the
 * fixed-step loop, and turns rule events (clock, torch, flags, damage) into
 * sound, light and UI.
 *
 *   boot -> menu -> playing <-> paused
 *                      |-> ending -> results -> menu / playing
 */
import * as THREE from 'three';
import type { ClockEvent } from '../core/clock';
import { DAY_LENGTH } from '../core/clock';
import { RELIC_BY_ID, type CarriedRelic, type RelicId } from '../core/economy';
import { sampleGhost } from '../core/ghost';
import type { NavMesh } from '../core/navmesh';
import { noiseRadius, type Noise, type NoiseKind } from '../core/noise';
import { clamp01, damp, lerp, smoothstep } from '../core/rng';
import { MetaStore, type Outcome, type ScoreEntry, type StorageLike } from '../core/save';
import { SCENES, type SceneId, type Vec3Like } from '../core/scenes';
import { celestial, skyLook } from '../core/sun';
import type { TorchEvent } from '../core/torch';
import { ALL_GATES, gateOpen, type Flag } from '../core/unlock';
import { AudioEngine, type AmbientState, type Sfx } from '../engine/audio';
import { Input } from '../engine/input';
import { Lighting, type SconceLight } from '../engine/lighting';
import { Materials } from '../engine/materials';
import { Particles, type ParticleLight } from '../engine/particles';
import { Physics, RAY, type Interactable } from '../engine/physics';
import { NEUTRAL_GRADE, Renderer, type GradeParams } from '../engine/renderer';
import { Sky } from '../engine/sky';
import { TextureLibrary } from '../engine/textures';
import { DroppedRelicEnt } from '../world/entities/relics';
import { buildNavMesh, layouts, sceneAt } from '../world/layout';
import { JUNGLE, jungleHeight } from '../world/layout/jungle';
import { Registry } from '../world/registry';
import { SceneManager } from '../world/sceneManager';
import { Guardians } from './guardians';
import { Player } from './player';
import { Run } from './run';
import { TorchRig } from './torchRig';

export type GameState = 'boot' | 'menu' | 'playing' | 'paused' | 'ending' | 'results';
export type ToastKind = 'info' | 'good' | 'bad';

/** What the game needs from the DOM layer. Set by main.ts. */
export interface UiBridge {
  toast(text: string, kind: ToastKind): void;
  banner(title: string, sub: string): void;
  hurt(amount: number): void;
  stateChanged(state: GameState, prev: GameState): void;
  frame(dt: number): void;
}

const NULL_UI: UiBridge = {
  toast: () => undefined,
  banner: () => undefined,
  hurt: () => undefined,
  stateChanged: () => undefined,
  frame: () => undefined,
};

export interface RunResult {
  outcome: Outcome;
  epitaph: string;
  /** Coins banked. */
  haul: number;
  /** Value in the satchel at the end (lost unless escaped). */
  carried: number;
  time: number;
  relics: CarriedRelic[];
  relicsLifted: number;
  /** 0-based place in the high-score table, -1 if it did not place. */
  rank: number;
  deepest: string;
  coins: number;
  newBest: boolean;
}

const H = 1 / 60;
const MAX_STEPS = 4;
const INTERACT_REACH = 2.7;
const DOOR_Z = 41;
const EXIT_Z = 44.5;

const EPITAPH: Record<string, string> = {
  fell: 'The fall broke you.',
  drowned: 'The water kept you.',
};

export class Game {
  readonly renderer: Renderer;
  readonly textures = new TextureLibrary();
  readonly mats: Materials;
  readonly audio = new AudioEngine();
  readonly input: Input;
  readonly particles: Particles;
  readonly lighting: Lighting;
  readonly sky = new Sky();
  readonly nav: NavMesh = buildNavMesh();
  readonly meta: MetaStore;
  readonly reg = new Registry();
  run: Run;
  readonly player: Player;
  readonly scenes: SceneManager;
  readonly guardians: Guardians;
  readonly torchRig: TorchRig;

  ui: UiBridge = NULL_UI;
  state: GameState = 'boot';
  /** What the crosshair is on (only things that currently have a prompt). */
  interactTarget: Interactable | null = null;
  prompt: string | null = null;
  /** Set by the sanctum while it is loaded: 0..1 how close the ceiling is to coming down. */
  sanctumStrain: (() => number) | null = null;
  result: RunResult | null = null;
  /** Automated play: no pointer lock, no pausing on focus loss. */
  autoplay = false;
  mapOpen = false;
  debugOpen = false;
  fps = 60;
  frameMs = 16.7;
  /** 0..1: how much of the sky-lit world exists for the camera (0 deep in Zone C). */
  outdoor = 1;
  /** Seconds of real time since boot. */
  time = 0;
  readonly grade: GradeParams = { ...NEUTRAL_GRADE, tint: { r: 1, g: 1, b: 1 } };

  private acc = 0;
  private last = 0;
  private fade = 0;
  private endT = 0;
  private sinceHurt = 99;
  private hurtSfxT = 0;
  private exploreT = 0;
  private readonly noiseListeners = new Set<(n: Noise) => void>();
  private readonly ghost: THREE.Group;
  private ghostDark = false;
  private readonly ambient: AmbientState = {
    outdoor: 1, jungle: 0, night: 0, river: 0, wind: 0, dungeon: 0, torchLit: false,
    rumble: 0, threat: 0, danger: 0, underwater: false, reverb: 0, dusk: 0,
  };
  private readonly sconcePool: SconceLight[] = [];
  private readonly partLights: ParticleLight[] = [];
  private rumbleKick = 0;
  private running = false;
  /** Debug: stop ticking and drawing (the last frame stays on screen). */
  frozen = false;
  /** Extra per-frame hooks (debug API, perf sampling). */
  readonly onFrame = new Set<(dt: number) => void>();

  static async create(canvas: HTMLCanvasElement, storage: StorageLike | null): Promise<Game> {
    const physics = await Physics.create();
    return new Game(canvas, physics, storage);
  }

  private constructor(
    readonly canvas: HTMLCanvasElement,
    readonly physics: Physics,
    storage: StorageLike | null,
  ) {
    this.renderer = new Renderer(canvas);
    this.mats = new Materials(this.textures);
    this.input = new Input(canvas);
    this.particles = new Particles(this.renderer.scene);
    this.lighting = new Lighting(this.renderer.scene);
    this.renderer.scene.add(this.sky.mesh);
    this.meta = new MetaStore(storage);
    this.run = new Run(1, this.meta.data.gear);
    this.player = new Player(this);
    this.scenes = new SceneManager(this);
    this.scenes.isDark = (_y, scene) => SCENES[scene].zone === 'C';
    this.guardians = new Guardians(this);
    this.torchRig = new TorchRig(this);
    this.ghost = this.buildGhost();
    this.renderer.scene.add(this.ghost);

    this.input.onGesture = () => this.audio.unlock();
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.autoplay) this.pause();
    };
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing' && !this.autoplay) this.pause();
    });
    this.applySettings();
    this.syncGates();
  }

  // ------------------------------------------------------------------ boot

  /** Paint textures, build the backdrop, start the frame loop. */
  boot(): void {
    this.textures.warm();
    this.toMenu();
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    }
  }

  resize(): void {
    this.renderer.resize();
    this.particles.setViewport(this.renderer.gl.domElement.height, this.meta.data.settings.fov);
  }

  applySettings(): void {
    const s = this.meta.data.settings;
    if (this.renderer.qualityName !== s.quality || this.state === 'boot') this.renderer.setQuality(s.quality);
    this.renderer.setFov(s.fov);
    this.lighting.applyQuality(this.renderer.quality);
    this.audio.setVolumes(s.volume, s.musicVolume);
    this.particles.setViewport(this.renderer.gl.domElement.height, s.fov);
  }

  private setState(next: GameState): void {
    const prev = this.state;
    if (prev === next) return;
    this.state = next;
    this.ui.stateChanged(next, prev);
  }

  // ------------------------------------------------------------- lifecycle

  private freshWorld(seed: number): void {
    if (this.player.held) this.player.dropHeld();
    this.scenes.reset();
    this.particles.clear();
    this.sanctumStrain = null;
    this.noiseListeners.clear();
    this.run = new Run(seed, this.meta.data.gear);
    this.syncGates();
    this.guardians.reset();
    this.torchRig.reset();
    this.interactTarget = null;
    this.prompt = null;
    this.mapOpen = false;
    this.sinceHurt = 99;
    this.rumbleKick = 0;
    this.acc = 0;
  }

  /** Main menu: the courtyard as a slowly turning backdrop. */
  toMenu(): void {
    this.freshWorld(7);
    this.result = null;
    this.player.reset(0, 0.05, 14, 0);
    this.scenes.ensure('courtyard');
    this.scenes.current = 'courtyard';
    this.fade = 1;
    this.input.releaseLock();
    this.input.script = null;
    this.setState('menu');
  }

  startRun(opts: { seed?: number; auto?: boolean } = {}): void {
    this.autoplay = !!opts.auto;
    this.freshWorld(opts.seed ?? ((Math.random() * 0x7fffffff) | 0) + 1);
    this.result = null;
    const { x, z } = JUNGLE.spawn;
    this.player.reset(x, jungleHeight(x, z) + 0.05, z, 0);
    this.scenes.ensure('jungle');
    this.scenes.current = 'jungle';
    this.fade = 0;
    this.input.clearPressed();
    this.input.takeMouse();
    this.audio.unlock();
    this.setState('playing');
    if (!this.autoplay) this.input.requestLock();
    this.ui.banner('Jungle Approach', 'Dawn. Thirteen minutes until dark.');
    if (!this.meta.data.seenIntro) {
      this.meta.data.seenIntro = true;
      this.meta.save();
      this.toast('The great door is the only way in and the only way out. Be outside it before dark.', 'info');
    }
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.input.releaseLock();
    this.audio.hush();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.input.clearPressed();
    this.input.takeMouse();
    this.setState('playing');
    if (!this.autoplay) this.input.requestLock();
  }

  abandon(): void {
    if (this.state !== 'paused' && this.state !== 'playing') return;
    this.endRun('abandoned', 'You walked away with empty hands.');
  }

  // --------------------------------------------------------------- services

  sfx(name: Sfx, pos?: Vec3Like, vol = 1, pitch = 1, range?: number): void {
    this.audio.play(name, { pos, vol, pitch, range });
  }

  toast(text: string, kind: ToastKind = 'info'): void {
    this.ui.toast(text, kind);
  }

  shake(amount: number): void {
    this.player.shake = Math.max(this.player.shake, amount);
  }

  /** Something made a sound guardians (and the sanctum ceiling) can hear. */
  noise(kind: NoiseKind, pos: Vec3Like, scale = 1): void {
    if (this.state !== 'playing') return;
    const n: Noise = {
      pos: { x: pos.x, y: pos.y, z: pos.z },
      radius: noiseRadius(kind, scale, this.run.loadout.footstepNoise),
      kind,
      t: this.run.time,
    };
    this.run.noises.push(n);
    for (const fn of this.noiseListeners) fn(n);
  }

  listenNoise(fn: (n: Noise) => void): () => void {
    this.noiseListeners.add(fn);
    return () => this.noiseListeners.delete(fn);
  }

  hasFlag(flag: Flag): boolean {
    return this.run.flags.has(flag);
  }

  setFlag(flag: Flag): void {
    if (this.run.flags.has(flag)) return;
    this.run.flags.add(flag);
    this.syncGates();
  }

  private syncGates(): void {
    for (const g of ALL_GATES) this.nav.setGate(g, gateOpen(g, this.run.flags));
    // Guardians never leave the temple.
    this.nav.setGate('greatDoor', false);
  }

  killY(): number {
    return layouts()[this.scenes.current].killY;
  }

  /** Is this point in direct sunlight right now? (Sun-safe paths in the Broken Halls.) */
  isSunlit(p: Vec3Like): boolean {
    const f = this.run.clock.dayFraction;
    const cel = celestial(f);
    if (!cel.sunUp || cel.isMoon || cel.elevation < 0.07) return false;
    return this.physics.raycast(p, cel.dir, 140, RAY.solidWorld) === null;
  }

  damage(amount: number, cause: string): void {
    if (this.state !== 'playing' || !this.player.alive || amount <= 0) return;
    const run = this.run;
    run.health -= amount;
    run.damageTaken += amount;
    this.sinceHurt = 0;
    this.ui.hurt(amount);
    if (amount >= 4 || this.hurtSfxT <= 0) {
      this.hurtSfxT = 0.7;
      this.sfx('hurt', undefined, clamp01(0.4 + amount / 40));
      this.shake(clamp01(0.25 + amount / 60));
    }
    if (run.health <= 0) {
      run.health = 0;
      this.die('died', EPITAPH[cause] ?? cause);
    }
  }

  die(outcome: Outcome, epitaph: string): void {
    this.endRun(outcome, epitaph);
  }

  torchEvent(e: TorchEvent | null): void {
    if (!e) return;
    const p = this.player.pos;
    switch (e.type) {
      case 'lit':
        this.sfx('torchLit');
        break;
      case 'doused': {
        this.sfx('torchOut');
        const why: Record<string, string> = {
          water: 'The water took your flame.',
          wind: 'A gust blew your torch out. Crouch to shield it.',
          fall: 'The landing knocked your torch out.',
          empty: 'The torch has burned dry. R pours oil or swaps in a spare.',
          hit: 'Your torch went out.',
        };
        if (why[e.cause]) this.toast(why[e.cause], 'bad');
        break;
      }
      case 'relightStarted':
        this.sfx('flint');
        this.noise('flint', p);
        break;
      case 'low':
        this.toast('Your torch is burning low.', 'bad');
        break;
      default:
        break;
    }
    this.torchRig.onEvent(e);
  }

  onRelicTaken(relic: RelicId): void {
    const def = RELIC_BY_ID[relic];
    const s = this.run.satchel;
    if (relic === 'dawn_idol') this.toast('The Dawn Idol. The whole sanctum heard that.', 'bad');
    else if (s.loadRatio > 0.85) this.toast(`The ${def.name} makes ${s.weight.toFixed(1)} kg. You are slow and loud now.`, 'info');
  }

  onSceneLoaded(id: SceneId): void {
    const s = this.scenes.loaded.get(id);
    if (s) s.group.visible = this.outdoor > 0.001 || SCENES[id].zone === 'C';
  }

  onSceneChanged(_from: SceneId, to: SceneId): void {
    const run = this.run;
    if (this.state !== 'playing') return;
    const first = !run.visited.has(to);
    run.visited.add(to);
    if (SCENES[to].depth > SCENES[run.deepest].depth) run.deepest = to;
    if (first) {
      const sub: Record<SceneId, string> = {
        jungle: 'Zone A · open sky',
        courtyard: 'Zone A · the great door is behind you',
        cliffs: 'Zone A · mind the wind',
        halls: 'Zone B · the roof is gone, the shade is not empty',
        sanctum: 'Zone B · tread softly',
        catacombs: 'Zone C · no light but yours',
        vault: 'Zone C · the long way back starts here',
      };
      this.ui.banner(SCENES[to].name, sub[to]);
    }
  }

  // -------------------------------------------------------------- the loop

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const real = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    if (this.frozen) return;
    // The simulation never takes more than a tenth of a second in one bite; the
    // frame counter is fed the real interval so a slow machine reads as slow.
    this.tick(Math.min(0.1, real), real);
  };

  /** One rendered frame. Public so automated tests can drive time themselves. */
  tick(dt: number, real = dt): void {
    this.time += dt;
    if (real > 0) {
      this.frameMs = lerp(this.frameMs, Math.min(2000, real * 1000), 0.06);
      this.fps = 1000 / Math.max(0.01, this.frameMs);
    }
    this.input.poll();
    if (this.input.take('debug')) this.debugOpen = !this.debugOpen;
    this.mats.time.value = this.time;

    switch (this.state) {
      case 'playing':
        this.playFrame(dt);
        break;
      case 'ending':
        this.endingFrame(dt);
        break;
      case 'paused':
        if (this.input.take('pause')) this.resume();
        this.input.clearPressed();
        break;
      case 'menu':
        this.menuFrame(dt);
        this.input.clearPressed();
        break;
      default:
        this.input.clearPressed();
        break;
    }
    this.visuals(dt);
    for (const fn of this.onFrame) fn(dt);
    this.renderer.render(this.grade, this.time);
    this.ui.frame(dt);
  }

  private playFrame(dt: number): void {
    if (this.input.take('pause')) {
      this.pause();
      return;
    }
    if (this.input.take('map')) this.mapOpen = !this.mapOpen;
    this.fade = Math.min(1, this.fade + dt * 1.2);
    this.player.look(dt);
    this.acc += dt;
    let n = 0;
    while (this.acc >= H && n < MAX_STEPS && this.state === 'playing') {
      this.fixedStep();
      this.acc -= H;
      n++;
    }
    if (this.acc > H) this.acc = 0;
    this.finishFrame(dt, clamp01(this.acc / H));
    if (this.state === 'playing') {
      this.updateInteraction();
      this.handleActions();
      this.explore(dt);
    }
  }

  private endingFrame(dt: number): void {
    this.endT += dt;
    this.fade = Math.max(0, 1 - this.endT / 1.8);
    this.acc += dt;
    let n = 0;
    while (this.acc >= H && n < MAX_STEPS) {
      this.player.step(H);
      this.scenes.step(H);
      this.guardians.step(H);
      this.physics.step();
      this.acc -= H;
      n++;
    }
    if (this.acc > H) this.acc = 0;
    this.finishFrame(dt, clamp01(this.acc / H));
    this.input.clearPressed();
    if (this.endT >= 2.1) this.showResults();
  }

  private finishFrame(dt: number, alpha: number): void {
    this.scenes.update(dt);
    this.player.frame(dt, alpha, this.renderer.camera);
    this.scenes.frame(dt);
    this.guardians.frame(dt, alpha);
    this.torchRig.frame(dt);
    this.updateGhost();
  }

  private menuFrame(dt: number): void {
    // A slow day keeps turning behind the menu.
    const cycle = (this.time * 0.008) % 1;
    this.run.clock.t = (0.24 + 0.62 * cycle) * DAY_LENGTH;
    this.fade = Math.min(1, this.fade + dt);
    this.scenes.update(dt);
    this.scenes.frame(dt);
    const cam = this.renderer.camera;
    const a = this.time * 0.035 + 0.6;
    cam.position.set(Math.sin(a) * 16, 12.5 + Math.sin(this.time * 0.11) * 1.5, 14 + Math.cos(a) * 15);
    cam.lookAt(0, 3.4, -12);
    this.torchRig.frame(dt);
    this.ghost.visible = false;
  }

  /** One 60 Hz simulation step. */
  fixedStep(): void {
    const run = this.run;
    for (const e of run.clock.advance(H)) this.onClock(e);
    if (this.state !== 'playing') return;
    this.player.step(H);
    for (const e of run.torch.update(H)) this.torchEvent(e);
    this.scenes.step(H);
    this.guardians.step(H);
    this.physics.step();
    run.ghost.update(H, this.player.pos);

    this.sinceHurt += H;
    this.hurtSfxT = Math.max(0, this.hurtSfxT - H);
    if (this.sinceHurt > 9 && run.health < 100 && this.player.alive) run.health = Math.min(100, run.health + 1.5 * H);
    while (run.noises.length > 0 && run.time - run.noises[0].t > 1) run.noises.shift();

    // The great door: in once, out once.
    const p = this.player.pos;
    if (!run.entered && p.z < DOOR_Z - 1.5 && p.z > 20 && Math.abs(p.x) < 12) {
      run.entered = true;
      this.toast('You are inside. Stepping back out through the great door ends the run and banks the haul.', 'info');
    }
    if (run.entered && p.z > EXIT_Z && this.player.alive) {
      const left = run.clock.remaining;
      const epitaph = run.clock.isDark
        ? 'You slid out under the closing door.'
        : left < 120
          ? 'You walked out into the last of the light.'
          : left < 390
            ? 'You walked out with the afternoon to spare.'
            : 'You walked out before the day was half done.';
      this.endRun('escaped', epitaph);
    }
  }

  /**
   * Run the simulation synchronously, faster than real time (automated
   * playtests). Does everything a frame does except draw. `each` may return
   * false to stop early. Returns the number of steps taken.
   */
  simulate(steps: number, each?: (i: number) => boolean | void): number {
    let i = 0;
    while (i < steps && this.state === 'playing') {
      this.fixedStep();
      i++;
      if (i % 2 === 0) {
        this.scenes.update(2 * H);
        this.player.frame(2 * H, 1, this.renderer.camera);
        this.renderer.camera.updateMatrixWorld();
        if (this.state === 'playing') {
          this.updateInteraction();
          this.handleActions();
          this.explore(2 * H);
        }
      }
      if (each && each(i) === false) break;
    }
    return i;
  }

  /** Refresh what the crosshair is on right now (automated playtests). */
  refreshInteraction(): string | null {
    this.player.frame(0, 1, this.renderer.camera);
    this.updateInteraction();
    return this.prompt;
  }

  private onClock(e: ClockEvent): void {
    switch (e.type) {
      case 'tick':
        this.audio.play(e.urgent ? 'tickUrgent' : 'tick', { vol: e.volume });
        break;
      case 'twoMinutes':
        this.toast('Two minutes of daylight left.', 'bad');
        this.sfx('gong', undefined, 0.7);
        break;
      case 'oneMinute':
        this.toast('One minute. The temple is waking.', 'bad');
        this.sfx('rumble');
        this.shake(0.55);
        this.rumbleKick = 1;
        break;
      case 'darkness':
        this.toast('Darkness. The guardians wake and the great door is closing.', 'bad');
        this.setFlag('sealsBroken');
        this.sfx('gong', undefined, 1, 0.6);
        this.sfx('rumble');
        this.shake(0.9);
        this.rumbleKick = 1.5;
        break;
      case 'wave':
        this.guardians.wakeScene(e.scene);
        break;
      case 'doorClosed': {
        const inside = this.player.pos.z < DOOR_Z + 0.4;
        if (inside) this.endRun('entombed', 'The great door closed with you inside. The guardians are patient.');
        else this.endRun('escaped', 'The door slammed behind you.');
        break;
      }
    }
  }

  private endRun(outcome: Outcome, epitaph: string): void {
    const run = this.run;
    if (run.outcome || (this.state !== 'playing' && this.state !== 'paused')) return;
    run.outcome = outcome;
    run.epitaph = epitaph;
    const escaped = outcome === 'escaped';
    const carried = run.satchel.value;
    const haul = escaped ? carried : 0;
    const relics = run.satchel.items.slice();
    const entry: ScoreEntry = {
      haul,
      carried,
      time: run.time,
      relics: relics.length,
      outcome,
      date: new Date().toISOString(),
      deepest: SCENES[run.deepest].name,
    };
    const bestBefore = this.meta.data.bestHaul;
    const rank = this.meta.recordRun(entry, escaped ? run.ghost.finish(haul) : null);
    this.result = {
      outcome, epitaph, haul, carried, time: run.time, relics, relicsLifted: run.relicsLifted, rank,
      deepest: entry.deepest, coins: this.meta.data.coins, newBest: escaped && haul > bestBefore,
    };
    this.interactTarget = null;
    this.prompt = null;
    this.mapOpen = false;
    if (escaped) {
      this.sfx('win');
    } else if (outcome !== 'abandoned') {
      this.player.kill();
      this.sfx(outcome === 'caught' ? 'death' : 'lose');
      this.shake(1);
    }
    if (outcome === 'abandoned') {
      this.showResults();
    } else {
      this.endT = 0;
      this.setState('ending');
    }
  }

  private showResults(): void {
    this.input.releaseLock();
    this.input.script = null;
    this.audio.hush();
    this.setState('results');
  }

  // ------------------------------------------------------------ interaction

  private updateInteraction(): void {
    const p = this.player;
    if (!p.alive) {
      this.interactTarget = null;
      this.prompt = null;
      return;
    }
    const hit = this.physics.raycast(p.eye, p.forward, INTERACT_REACH, RAY.interact);
    const it = hit?.meta?.interact ?? null;
    const text = it ? it.prompt() : null;
    this.interactTarget = text !== null ? it : null;
    this.prompt = text;
  }

  private handleActions(): void {
    const input = this.input;
    const p = this.player;
    const torch = this.run.torch;
    if (input.take('interact')) {
      if (this.interactTarget) this.interactTarget.interact();
      else if (p.held) p.dropHeld();
    }
    if (input.take('throw') && p.held) p.throwHeld();
    if (input.take('drop') && p.held) p.dropHeld();
    if (input.take('dropRelic')) this.dropRelic();
    if (input.take('torch')) {
      if (!torch.lit && torch.fuel <= 0) {
        this.toast(torch.flasks + torch.spares > 0 ? 'The torch is dry. R to refuel.' : 'The torch is dry and you have nothing to feed it.', 'bad');
        this.sfx('deny');
      } else {
        this.torchEvent(torch.toggle());
      }
    }
    if (input.take('refuel')) {
      const full = torch.fuel >= torch.capacity - 1;
      const used = torch.refuel();
      if (used === 'flask') {
        this.sfx('pour');
        this.toast('Oil poured: +90 s of flame.', 'good');
      } else if (used === 'spare') {
        this.sfx('key', undefined, 0.6, 0.7);
        this.toast(torch.lit ? 'Fresh torch lit from the old one.' : 'Fresh torch in hand. F to light it.', 'good');
      } else {
        this.sfx('deny');
        this.toast(full ? 'The torch is already full.' : 'No oil flask and no spare torch.', 'bad');
      }
    }
  }

  private dropRelic(): void {
    const run = this.run;
    const p = this.player;
    const item = run.satchel.dropLast();
    if (!item) {
      this.toast('Your satchel is empty.', 'info');
      return;
    }
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const from = { x: p.pos.x, y: p.pos.y + 0.9, z: p.pos.z };
    const hit = this.physics.raycast(from, { x: fx, y: 0, z: fz }, 1.1, RAY.solidWorld);
    const d = hit ? Math.max(0, hit.distance - 0.35) : 0.75;
    const pos = { x: p.pos.x + fx * d, y: p.pos.y + 0.55, z: p.pos.z + fz * d };
    const scene = sceneAt(pos, this.scenes.current) ?? this.scenes.current;
    const rec = run.drop(item, pos, scene);
    const loaded = this.scenes.loaded.get(scene) ?? this.scenes.loaded.get(this.scenes.current);
    if (loaded) loaded.entities.push(new DroppedRelicEnt(this, loaded, rec, this.scenes.isDark(pos.y, loaded.id)));
    this.sfx('drop', pos);
    this.toast(`Dropped ${RELIC_BY_ID[item.relic].name} (−${item.value})`, 'info');
  }

  /** Mark the map cells around the player as seen. */
  private explore(dt: number): void {
    this.exploreT -= dt;
    if (this.exploreT > 0) return;
    this.exploreT = 0.35;
    const p = this.player.pos;
    const level = SCENES[this.scenes.current].zone === 'C' ? 1 : 0;
    const R = SCENES[this.scenes.current].zone === 'A' ? 13 : this.run.torch.lit || level === 0 ? 8 : 4;
    const C = 4;
    const x0 = Math.floor((p.x - R) / C);
    const x1 = Math.floor((p.x + R) / C);
    const z0 = Math.floor((p.z - R) / C);
    const z1 = Math.floor((p.z + R) / C);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const dx = (cx + 0.5) * C - p.x;
        const dz = (cz + 0.5) * C - p.z;
        if (dx * dx + dz * dz <= R * R) this.run.explored.add(`${level}:${cx}:${cz}`);
      }
    }
  }

  // ----------------------------------------------------------------- ghost

  private buildGhost(): THREE.Group {
    const g = new THREE.Group();
    const body = this.mats.mesh(new THREE.CapsuleGeometry(0.26, 0.9, 4, 10), 'ghost');
    body.position.y = 0.75;
    const head = this.mats.mesh(new THREE.SphereGeometry(0.2, 10, 8), 'ghost');
    head.position.y = 1.55;
    g.add(body, head);
    g.visible = false;
    g.name = 'ghost';
    return g;
  }

  private updateGhost(): void {
    const data = this.meta.data.ghost;
    const g = this.ghost;
    if (!data || !this.meta.data.settings.showGhost || this.state !== 'playing') {
      g.visible = false;
      return;
    }
    const p = sampleGhost(data, this.run.time);
    if (!p) {
      g.visible = false;
      return;
    }
    const scene = sceneAt(p, null);
    const loaded = scene ? this.scenes.loaded.get(scene) : undefined;
    g.visible = !!loaded && loaded.group.visible;
    if (!g.visible) return;
    const dark = scene !== null && SCENES[scene].zone === 'C';
    if (dark !== this.ghostDark) {
      this.ghostDark = dark;
      this.mats.applyZone(g, dark);
    }
    g.position.set(p.x, p.y, p.z);
  }

  // --------------------------------------------------------------- visuals

  private visuals(dt: number): void {
    const run = this.run;
    const f = run.clock.dayFraction;
    const look = skyLook(f);
    const cel = celestial(f);
    const cur = this.scenes.current;
    const zone = SCENES[cur].zone;
    const zoneC = zone === 'C';
    const cam = this.renderer.camera;
    const playing = this.state === 'playing' || this.state === 'ending' || this.state === 'paused' || this.state === 'results';
    const o = zoneC && playing ? smoothstep(-6.0, -4.2, this.player.pos.y) : 1;
    this.outdoor = o;

    for (const [id, s] of this.scenes.loaded) s.group.visible = o > 0.001 || SCENES[id].zone === 'C';
    const focus = this.state === 'menu' ? { x: 0, y: 0, z: 0 } : this.player.pos;
    this.lighting.updateSky(look, cel, focus, o);
    this.sky.update(look, cel, f, this.time, o);

    // Sconce pool: the nearest lit sconces get the three real lights.
    const lit = this.reg.sconces.filter((s) => s.lit);
    if (lit.length > 3) {
      const c = cam.position;
      lit.sort((a, b) => dist2sq(a.pos, c) - dist2sq(b.pos, c));
    }
    this.sconcePool.length = 0;
    for (let i = 0; i < Math.min(3, lit.length); i++) {
      const s = lit[i];
      const level = 0.86 + 0.09 * Math.sin(this.time * 11.3 + s.pos.x * 3.1) + 0.05 * Math.sin(this.time * 23.7 + s.pos.z * 1.7);
      this.sconcePool.push({ pos: s.pos, radius: s.radius, level });
    }
    this.lighting.setSconces(this.sconcePool);

    // Particles are lit on the CPU with the same lights.
    const pl = this.partLights;
    pl.length = 0;
    const T = this.lighting.torch;
    if (T.intensity > 0) {
      const k = Math.min(1, T.intensity / 30);
      pl.push({ pos: T.position, radius: T.distance, r: 1.0 * k, g: 0.62 * k, b: 0.32 * k });
    }
    for (const s of this.sconcePool) pl.push({ pos: s.pos, radius: s.radius, r: 0.9 * s.level, g: 0.55 * s.level, b: 0.28 * s.level });
    this.particles.lights = pl;
    const amb = this.particles.ambient;
    amb.r = Math.min(1.2, (look.hemiSky.r * look.hemiIntensity * 0.5 + look.sunColor.r * look.sunIntensity * 0.4) * o * 0.7);
    amb.g = Math.min(1.2, (look.hemiSky.g * look.hemiIntensity * 0.5 + look.sunColor.g * look.sunIntensity * 0.4) * o * 0.7);
    amb.b = Math.min(1.2, (look.hemiSky.b * look.hemiIntensity * 0.5 + look.sunColor.b * look.sunIntensity * 0.4) * o * 0.7);
    this.particles.update(dt);

    // Grade. Underground nothing may lift black: no lift, contrast never below 1.
    const g = this.grade;
    g.tint.r = lerp(1, look.tint.r, o);
    g.tint.g = lerp(1, look.tint.g, o);
    g.tint.b = lerp(1, look.tint.b, o);
    // Firelight alone: the filmic curve deepens dim orange toward red, so ease the saturation back underground.
    g.saturation = lerp(0.78, look.saturation, o);
    g.contrast = zoneC ? Math.max(1, lerp(1.04, look.contrast, o)) : look.contrast;
    g.exposure = lerp(1, look.exposure, o);
    g.lift = zoneC ? 0 : look.lift;
    g.vignette = lerp(0.5, 0.35, o);
    g.underwater = damp(g.underwater, this.player.underwater && playing ? 1 : 0, 12, dt);
    g.fade = this.state === 'results' ? 0.25 : this.fade;

    this.updateAudio(dt, f, zone, o);
  }

  private updateAudio(dt: number, f: number, zone: 'A' | 'B' | 'C', o: number): void {
    const a = this.ambient;
    const run = this.run;
    const p = this.player.pos;
    const cur = this.scenes.current;
    const cam = this.renderer.camera;
    this.audio.setListener(cam.position, this.state === 'menu' ? cam.rotation.y : this.player.yaw);
    if (this.state === 'paused' || this.state === 'results' || this.state === 'boot') return;
    const menu = this.state === 'menu';
    a.outdoor = zone === 'A' ? 1 : zone === 'B' ? 0.6 : o * 0.4;
    a.jungle = zone === 'A' ? (cur === 'jungle' ? 1 : cur === 'courtyard' ? 0.65 : 0.3) : zone === 'B' ? 0.15 : 0;
    a.night = smoothstep(0.93, 1.0, f);
    let river = 0;
    for (const w of this.reg.water) {
      const dx = Math.max(w.x0 - p.x, 0, p.x - w.x1);
      const dz = Math.max(w.z0 - p.z, 0, p.z - w.z1);
      const d = Math.hypot(dx, dz, Math.max(0, Math.abs(p.y - w.surface) - 3));
      const flowing = Math.hypot(w.current.x, w.current.z) > 0.1;
      river = Math.max(river, clamp01(1 - d / (flowing ? 26 : 9)) * (flowing ? 1 : 0.25));
    }
    a.river = menu ? 0 : river;
    const wind = this.reg.windAt({ x: p.x, y: p.y + 1, z: p.z });
    a.wind = menu ? 0.1 : Math.max(cur === 'cliffs' ? 0.35 : 0, wind ? wind.strength : 0);
    a.dungeon = zone === 'C' ? 1 - o * 0.6 : 0;
    a.torchLit = run.torch.lit && !menu;
    this.rumbleKick = Math.max(0, this.rumbleKick - dt * 0.25);
    const strain = this.sanctumStrain ? this.sanctumStrain() : 0;
    a.rumble = menu ? 0 : clamp01(run.clock.dread * 0.45 + this.rumbleKick * 0.5 + (cur === 'sanctum' ? strain * 0.5 : 0));
    a.threat = menu ? 0 : this.guardians.threat;
    a.danger = menu ? 0 : run.clock.dread;
    a.underwater = this.player.underwater && !menu;
    a.reverb = zone === 'C' ? 0.85 : zone === 'B' ? 0.4 : 0.06;
    a.dusk = menu ? 0 : clamp01((f - 0.74) / 0.2) * (zone === 'C' ? 0.5 : 1);
    this.audio.update(dt, a);
  }

  // ----------------------------------------------------------------- hints

  /** One line of guidance for the HUD, from where the run stands. */
  objective(): string {
    const run = this.run;
    const has = (fl: Flag): boolean => run.flags.has(fl);
    const p = this.player.pos;
    if (run.clock.isDark) return 'Get out. The great door is closing.';
    if (run.entered && p.z > DOOR_Z - 9 && p.z < EXIT_Z && Math.abs(p.x) < 8) return 'Stepping out through the great door ends the run and banks your haul.';
    if (run.clock.remaining < 150) return 'Head for the great door. Only what you carry out counts.';
    if (!run.entered) return 'Follow the trail north, cross the gorge, and go in through the great door.';
    if (has('doorBuried') && !has('wallKicked') && this.scenes.current === 'sanctum') return 'The way back is buried. Look for a cracked wall to kick through.';
    if (run.satchel.hasKey('sun_disc')) return 'The Sun Disc fits a sun-shaped seal at the far end of the Broken Halls.';
    if (run.satchel.hasKey('serpent_key')) return 'The Serpent Key opens the vault gate in the catacombs.';
    if (!has('sunDisc')) return 'The courtyard sundial hides something. Turn its ring to where the shadow falls.';
    if (has('vaultGate')) return 'The Deep Vault is open. The richest loot is the heaviest. Mind the way back.';
    if (has('sealOpen')) return 'The catacombs are open. Deeper means richer, and darker.';
    return 'Loot what you can carry. Deeper is richer. Be out before dark.';
  }
}

function dist2sq(a: Vec3Like, b: Vec3Like): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
