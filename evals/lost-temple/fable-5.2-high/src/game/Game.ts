import * as THREE from 'three';
import {
  DAY_LENGTH, dreadLevel, eventsBetween, tickInterval, tickVolume, timeLeft,
} from '../core/clock';
import { bankedValue } from '../core/economy';
import { NavMesh } from '../core/navmesh';
import { bankRun, loadSave, writeSave, type Outcome, type SaveData, type Score } from '../core/save';
import { addNoise, decayNoise } from '../core/traps';
import { SCENE_INFO, type SceneId, type V3 } from '../core/types';
import { fallNight } from '../core/unlock';
import { AudioSys } from '../engine/audio';
import { Input } from '../engine/input';
import { Materials } from '../engine/materials';
import { FIXED_DT, Physics } from '../engine/physics';
import { Sky } from '../engine/sky';
import { Guardians } from '../entities/Guardians';
import { Player } from '../entities/Player';
import { Props } from '../entities/Props';
import { Relics } from '../entities/Relics';
import { TorchRig } from '../entities/TorchRig';
import { DebugOverlay } from '../ui/debug';
import { Hud } from '../ui/hud';
import { MapView } from '../ui/map';
import { Menus } from '../ui/menus';
import { World } from '../world/World';
import { JUNGLE_START } from '../world/scenes/jungle';
import type { DebrisField, PushBlock } from '../world/setpieces';
import type { Climbable, Interactable, WaterVolume, WindZone } from '../world/types';
import { RunState } from './RunState';

export type GameState = 'menu' | 'playing' | 'paused' | 'results';

export interface Quality { shadowSize: number; shadowRange: number; torchShadow: number; pixelRatio: number; scarabs: number; }

const QUALITY: Record<SaveData['settings']['quality'], Quality> = {
  low: { shadowSize: 1024, shadowRange: 32, torchShadow: 256, pixelRatio: 1, scarabs: 60 },
  medium: { shadowSize: 2048, shadowRange: 40, torchShadow: 512, pixelRatio: 1.25, scarabs: 110 },
  high: { shadowSize: 2048, shadowRange: 46, torchShadow: 512, pixelRatio: 2, scarabs: 160 },
};

export interface RunResult {
  outcome: Outcome; cause: string; value: number; lost: number; time: number; rank: number;
  relics: { name: string; value: number; weight: number }[]; found: number; total: number;
  deepest: string; damage: number; traps: number; gold: number; best: boolean;
}

const GHOST_STEP = 0.5;

/** Owns everything and runs the frame. Simulation is a fixed 60 Hz step; rendering is whatever the display gives. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly mats = new Materials();
  readonly audio = new AudioSys();
  readonly input: Input;
  readonly sky: Sky;
  readonly world: World;
  readonly player: Player;
  readonly torch: TorchRig;
  readonly props: Props;
  readonly relics: Relics;
  readonly guardians: Guardians;
  readonly hud: Hud;
  readonly menus: Menus;
  readonly map: MapView;
  readonly debug: DebugOverlay;
  save: SaveData;
  run: RunState;
  nav: NavMesh;
  quality: Quality = QUALITY.high;
  state: GameState = 'menu';
  godMode = false;
  shakeAmount = 0;
  /** Seconds of real time per game second multiplier, for tests. */
  timeScale = 1;

  readonly interactables: Interactable[] = [];
  readonly climbables: Climbable[] = [];
  readonly waters: WaterVolume[] = [];
  readonly winds: WindZone[] = [];
  readonly pushables = new Map<number, PushBlock>();
  readonly groundTriggers = new Map<number, () => void>();
  sanctumDebris: DebrisField | null = null;

  private acc = 0;
  private last = 0;
  private tickT = 1;
  private rumbleT = 0;
  private navT = 0;
  private ghostT = 0;
  private ghostMesh: THREE.Mesh;
  private menuT = 0;
  private fovKick = 0;
  lastResult: RunResult | null = null;
  /** Rolling frame times in ms, newest last. */
  readonly frameTimes: number[] = [];

  private constructor(readonly canvas: HTMLCanvasElement, readonly physics: Physics) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 1200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.input = new Input(canvas);
    this.save = loadSave(typeof localStorage !== 'undefined' ? localStorage : null);
    this.sky = new Sky(this.scene);
    this.world = new World(this);
    this.run = new RunState(1, this.save.upgrades, this.world.allLoot());
    this.nav = new NavMesh(this.world.allNav());
    this.player = new Player(this);
    this.torch = new TorchRig(this);
    this.props = new Props(this);
    this.relics = new Relics(this);
    this.guardians = new Guardians(this);
    this.hud = new Hud(this);
    this.map = new MapView(this);
    this.debug = new DebugOverlay(this);
    this.menus = new Menus(this);

    // Ghost of the best run: a lit, translucent figure, so it is invisible in the dark like everything else.
    const gg = new THREE.CapsuleGeometry(0.3, 1.1, 4, 8);
    this.ghostMesh = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.28, roughness: 1, depthWrite: false }));
    this.ghostMesh.visible = false;
    this.scene.add(this.ghostMesh);

    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.input.virtualLock) this.pause();
      else if (locked && this.state === 'paused') this.resume();
    };
    window.addEventListener('resize', () => this.resize());
    this.applySettings();
    this.resize();
    this.prepareRun();
    this.menus.show('main');
  }

  static async create(canvas: HTMLCanvasElement): Promise<Game> {
    const physics = await Physics.create();
    return new Game(canvas, physics);
  }

  // -------------------------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------------------------
  applySettings(): void {
    const s = this.save.settings;
    const q = (this.quality = QUALITY[s.quality]);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.sky.setShadowQuality(q.shadowSize, q.shadowRange);
    this.torch?.setQuality(q.torchShadow);
    this.audio.setVolume(s.volume);
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  saveNow(): void { writeSave(typeof localStorage !== 'undefined' ? localStorage : null, this.save); }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------------------------
  // Run lifecycle
  // -------------------------------------------------------------------------------------------
  /** Build a fresh run at dawn. Used for the menu backdrop and for every new run. */
  prepareRun(seed = (Date.now() & 0x7fffffff) || 1): void {
    this.world.clear();
    this.props.reset();
    this.interactables.length = 0; this.climbables.length = 0; this.waters.length = 0; this.winds.length = 0;
    this.pushables.clear(); this.groundTriggers.clear(); this.relics.traps.clear();
    this.sanctumDebris = null;
    this.run = new RunState(seed, this.save.upgrades, this.world.allLoot());
    this.nav = new NavMesh(this.world.allNav());
    this.syncNav();
    this.torch.reset();
    this.player.reset(JUNGLE_START[0], JUNGLE_START[1], JUNGLE_START[2], 0);
    this.world.start('jungle');
    this.run.visited.add('jungle');
    this.guardians.reset(this.world.allGuardians());
    this.acc = 0; this.tickT = 1; this.rumbleT = 0; this.ghostT = 0; this.shakeAmount = 0;
    this.hud.reset();
    this.map.reset();
    this.lastResult = null;
  }

  startRun(seed?: number): void {
    this.audio.resume();
    this.prepareRun(seed);
    this.state = 'playing';
    this.menus.hide();
    this.hud.setVisible(true);
    if (!this.input.virtualLock) this.input.requestLock();
    this.hud.sceneBanner(SCENE_INFO.jungle.name, 'A');
    this.toast(this.save.runs === 0
      ? 'Dawn. Follow the trail to the temple. Everything you carry out of the Great Door before dark is yours.'
      : 'Dawn again. The mountain has reset its traps.');
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.releaseAll();
    this.menus.show('pause');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.menus.hide();
    this.last = performance.now();
    if (!this.input.locked && !this.input.virtualLock) this.input.requestLock();
  }

  toMenu(): void {
    this.state = 'menu';
    this.input.exitLock();
    this.hud.setVisible(false);
    this.prepareRun();
    this.menus.show('main');
  }

  /** The run is over, one way or another. */
  endRun(outcome: Outcome, cause: string): void {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    const run = this.run;
    const value = bankedValue(outcome, run.satchel);
    const score: Score = { value, time: run.time, relics: outcome === 'escaped' ? run.satchel.items.length : 0, outcome, date: new Date().toISOString() };
    const rank = bankRun(this.save, score);
    let best = false;
    if (outcome === 'escaped' && value > 0 && (!this.save.ghost || value >= this.save.ghost.value)) {
      this.save.ghost = { value, step: GHOST_STEP, samples: run.ghost.map((n) => Math.round(n * 10) / 10) };
      best = true;
    }
    this.save.seenIntro = true;
    this.saveNow();
    this.lastResult = {
      outcome, cause, value, lost: outcome === 'escaped' ? 0 : run.satchel.value, time: run.time, rank,
      relics: run.satchel.items.map((i) => ({ name: this.relics.nameOf(i), value: i.value, weight: i.weight })),
      found: run.stats.relicsFound, total: run.placed.length, deepest: SCENE_INFO[run.stats.deepest].name,
      damage: Math.round(run.stats.damageTaken), traps: run.stats.trapsSprung, gold: this.save.gold, best,
    };
    this.state = 'results';
    this.input.releaseAll();
    this.input.exitLock();
    this.audio.play(outcome === 'escaped' ? 'win' : 'lose');
    this.hud.setVisible(false);
    this.menus.show('results');
  }

  // -------------------------------------------------------------------------------------------
  // Services used by entities and set pieces
  // -------------------------------------------------------------------------------------------
  toast(msg: string): void { this.hud.toast(msg); }
  shake(n: number): void { this.shakeAmount = Math.min(1.5, Math.max(this.shakeAmount, n)); }
  addInteractable(i: Interactable): void { this.interactables.push(i); }
  removeInteractable(i: Interactable): void { const k = this.interactables.indexOf(i); if (k >= 0) this.interactables.splice(k, 1); }

  /** A sound in the world. Guardians hear it; in the sanctum it also loads the unstable ceiling. */
  emitNoise(pos: V3, radius: number, sanctumNoise = 0): void {
    this.guardians.hear({ pos: { x: pos.x, y: pos.y, z: pos.z }, radius });
    const d = this.sanctumDebris;
    if (sanctumNoise > 0 && d && d.inside(pos.x, pos.z) && pos.y > -2) {
      const drops = addNoise(this.run.noise, sanctumNoise);
      if (drops > 0) { d.drop(drops, pos); this.hud.flashNoise(); }
    }
  }

  waterAt(x: number, y: number, z: number): WaterVolume | null {
    for (const w of this.waters) if (x >= w.x1 && x <= w.x2 && z >= w.z1 && z <= w.z2 && y >= w.minY && y <= w.surfaceY + 3) return w;
    return null;
  }

  windAt(x: number, y: number, z: number): WindZone | null {
    for (const w of this.winds) if (x >= w.x1 && x <= w.x2 && z >= w.z1 && z <= w.z2 && y >= w.y1 && y <= w.y2) return w;
    return null;
  }

  climbableAt(x: number, y: number, z: number): Climbable | null {
    for (const c of this.climbables) if (x >= c.x1 && x <= c.x2 && z >= c.z1 && z <= c.z2 && y >= c.y1 - 0.3 && y <= c.y2 + 0.6) return c;
    return null;
  }

  /** Push the unlock flags into the navmesh so guardians respect shut doors and missing bridges. */
  syncNav(): void {
    const p = this.run.progress, n = this.nav;
    n.setTagEnabled('portcullis', (p.portcullisOpen || p.night) && !p.rubblePlug);
    n.setTagEnabled('seal', p.sealOpen || p.night);
    n.setTagEnabled('vaultDoor', p.vaultOpen || p.night);
    n.setTagEnabled('drawbridge', p.drawbridgeDown || p.night);
    n.setTagEnabled('chasmBridge', p.chasmBridgeIntact);
    n.setTagEnabled('kickEast', p.kickEast);
    n.setTagEnabled('kickSmuggler', p.kickSmuggler);
  }

  /** Once through the Great Door the only way to be outside again is to end the run. */
  get inside(): boolean { return this.run.wasInside; }

  /** One-line reminder of what to do next, for the HUD. */
  objective(): string {
    const p = this.run.progress, left = timeLeft(this.run.time);
    if (p.doorSealed) return 'The Great Door is sealed. Survive if you can.';
    if (left <= 0) return 'RUN. The Great Door is closing.';
    if (!this.run.dialSolved) return 'Reach the temple courtyard and solve the sundial.';
    if (!p.hasSunDisc) return 'Lift the Sun Disc from the sundial.';
    if (!this.run.wasInside) return 'Enter the temple through the Great Door.';
    if (!p.portcullisOpen && !this.run.visited.has('sanctum')) return 'Halls: weigh down the floor plate to hold the portcullis open.';
    if (!p.sealOpen) return 'Sanctum: set the Sun Disc into the seal to go deeper, or take your loot and leave.';
    if (!p.hasSerpentKey) return 'Catacombs: the Serpent Key is on the island in the flooded chamber.';
    if (!p.vaultOpen) return 'Use the Serpent Key on the vault door past the chasm.';
    return 'Take what you can carry and get out through the Great Door before dark.';
  }

  // -------------------------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------------------------
  private fixedUpdate(dt: number): void {
    const run = this.run;
    const prev = run.time;
    run.time += dt;
    for (const ev of eventsBetween(prev, run.time)) this.onClock(ev);

    this.player.fixedUpdate(dt);
    this.world.fixedUpdate(dt);
    this.props.fixedUpdate();
    this.guardians.fixedUpdate(dt);
    this.physics.step();
    this.physics.syncMeshes();
    decayNoise(run.noise, dt);

    this.navT -= dt;
    if (this.navT <= 0) { this.navT = 0.2; this.syncNav(); }

    // The clock you can hear.
    const left = timeLeft(run.time);
    const iv = tickInterval(left);
    if (iv > 0) {
      this.tickT -= dt;
      if (this.tickT <= 0) { this.tickT += iv; this.audio.play('tick', { vol: tickVolume(left) }); }
    }
    if (left <= 60 && !run.progress.doorSealed) {
      this.rumbleT -= dt;
      if (this.rumbleT <= 0) {
        this.rumbleT = left > 0 ? 2.5 + left / 20 : 1.8;
        this.audio.play('rumble', { vol: 0.5 + dreadLevel(left) * 0.5 });
        this.shake(0.12 + dreadLevel(left) * 0.22);
      }
    }

    // Escape: walking back out through the Great Door ends the run with whatever you carry.
    const p = this.player.pos;
    if (p.z < -9 && Math.abs(p.x) < 15) run.wasInside = true;
    if (run.wasInside && p.z > -5.7 && p.y > -2 && p.y < 4 && Math.abs(p.x) < 24 && !this.player.dead) this.endRun('escaped', 'out through the Great Door');

    this.ghostT -= dt;
    if (this.ghostT <= 0) { this.ghostT += GHOST_STEP; run.ghost.push(p.x, p.y, p.z); }
  }

  private onClock(ev: string): void {
    const run = this.run;
    if (ev === 'twoMinutes') { this.toast('Two minutes of daylight left. The clock is running faster.'); this.audio.play('gong', { vol: 0.5 }); }
    else if (ev === 'oneMinute') { this.toast('ONE MINUTE. The mountain is starting to shake.'); this.audio.play('rumble', { vol: 1 }); this.shake(0.5); }
    else if (ev === 'darkness') {
      fallNight(run.progress);
      this.syncNav();
      this.world.onNight();
      this.audio.play('gong', { vol: 1 }); this.audio.play('rumble', { vol: 1 });
      this.shake(0.9);
      this.toast(this.inside ? 'Darkness. The guardians are awake and the Great Door is coming down. Under a minute. Duck under it if you must.' : 'Darkness. The Great Door is closing.');
    } else if (ev === 'doorSealed') {
      run.progress.doorSealed = true;
      this.audio.play('thud', { vol: 1 }); this.shake(0.8);
      if (!this.inside) this.endRun('escaped', 'outside when the door sealed');
      else this.toast('The Great Door has sealed. There is no way out now.');
    } else if (ev === 'entombed') {
      if (!this.player.dead) { this.player.dead = true; this.endRun('entombed', 'sealed inside the mountain'); }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------
  start(): void {
    this.last = performance.now();
    const loop = (now: number) => { requestAnimationFrame(loop); this.frame(now); };
    requestAnimationFrame(loop);
  }

  /** Advance the simulation by hand, one 60 Hz frame at a time with no rendering. Tests use it. */
  simulate(seconds: number): void {
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps && this.state === 'playing'; i++) {
      this.handleActions();
      this.fixedUpdate(FIXED_DT);
      this.player.update(FIXED_DT);
      this.torch.update(FIXED_DT);
      this.world.update(FIXED_DT);
      this.input.endFrame();
    }
  }

  /** One-shot key actions that are not part of moving the player. */
  private handleActions(): void {
    const inp = this.input;
    if (!inp.active) return;
    if (inp.hit('pause')) { if (inp.virtualLock) this.pause(); else inp.exitLock(); }
    if (inp.hit('torch')) this.torch.toggle();
    if (inp.hit('flask')) this.torch.flask();
    if (inp.hit('spare')) this.torch.spare();
    if (inp.hit('drop')) this.relics.dropLast();
    if (inp.hit('map')) this.map.toggle();
  }

  frame(now: number): void {
    const raw = (now - this.last) / 1000;
    this.last = now;
    if (raw > 0) { this.frameTimes.push(raw * 1000); if (this.frameTimes.length > 240) this.frameTimes.shift(); }
    const dt = Math.min(0.05, Math.max(0, raw));
    const inp = this.input;
    inp.poll();
    if (inp.hit('debug')) this.debug.toggle();

    if (this.state === 'playing') {
      this.handleActions();
      this.acc += dt * this.timeScale;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < 5 && this.state === 'playing') { this.fixedUpdate(FIXED_DT); this.acc -= FIXED_DT; steps++; }
      if (steps === 5) this.acc = 0;
      this.player.update(dt);
      this.torch.update(dt);
    } else if (this.state === 'menu') {
      // Slow drift over the trailhead behind the menu.
      this.menuT += dt;
      const a = Math.sin(this.menuT * 0.07) * 0.5;
      this.camera.position.set(JUNGLE_START[0] + Math.sin(a) * 3, 3.2 + Math.sin(this.menuT * 0.11) * 0.4, JUNGLE_START[2] + 4);
      this.camera.rotation.set(0.06, a * 0.5, 0, 'YXZ');
      this.torch.update(dt);
    } else if (this.state === 'paused' && inp.hit('pause') && inp.virtualLock) this.resume();

    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.6);
    this.world.update(dt);
    const zone = this.world.zone;
    this.sky.update(this.run.time, dt, this.camera, zone, this.player.pos.y, this.renderer);

    // A little extra field of view at a sprint.
    const want = this.state === 'playing' && this.player.running ? 5 : 0;
    this.fovKick += (want - this.fovKick) * Math.min(1, dt * 6);
    const fov = this.save.settings.fov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    this.updateGhost();
    const left = timeLeft(this.run.time);
    const playing = this.state === 'playing';
    this.audio.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, this.player.yaw);
    this.audio.update(dt, {
      zone, night: this.run.time >= DAY_LENGTH, dread: playing ? dreadLevel(left) * (this.run.progress.doorSealed ? 0.4 : 1) : 0,
      wind: playing ? this.player.wind : 0, torchLit: this.torch.radius > 0, inWater: playing && this.player.waterDepth > 0.25,
      guardianDist: playing ? this.guardians.nearest : Infinity,
      mood: this.state === 'results' ? 'silent' : left <= 0 ? 'night' : left <= 60 ? 'urgent' : 'explore',
      paused: this.state === 'paused',
    });
    this.hud.update(dt);
    this.map.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.debug.update(dt);
    inp.endFrame();
  }

  private updateGhost(): void {
    const g = this.save.ghost;
    if (!g || this.state !== 'playing' || g.samples.length < 6) { this.ghostMesh.visible = false; return; }
    const f = this.run.time / g.step, i = Math.floor(f), n = g.samples.length / 3;
    if (i + 1 >= n) { this.ghostMesh.visible = false; return; }
    const k = f - i, s = g.samples;
    const x = s[i * 3] + (s[i * 3 + 3] - s[i * 3]) * k, y = s[i * 3 + 1] + (s[i * 3 + 4] - s[i * 3 + 1]) * k, z = s[i * 3 + 2] + (s[i * 3 + 5] - s[i * 3 + 2]) * k;
    this.ghostMesh.position.set(x, y + 0.9, z);
    this.ghostMesh.visible = Math.hypot(x - this.player.pos.x, z - this.player.pos.z) > 1.5;
  }

  /** Where the ghost of the best run is right now, for the map. */
  ghostPos(): V3 | null {
    return this.ghostMesh.visible ? { x: this.ghostMesh.position.x, y: this.ghostMesh.position.y - 0.9, z: this.ghostMesh.position.z } : null;
  }

  /** Debug and test helper: put the player somewhere and make sure the scene around them exists. */
  teleport(x: number, y: number, z: number): SceneId | null {
    const id = this.world.sceneAt(x, y, z);
    if (id) this.world.ensure(id);
    this.player.teleport(x, y, z);
    return id;
  }
}
