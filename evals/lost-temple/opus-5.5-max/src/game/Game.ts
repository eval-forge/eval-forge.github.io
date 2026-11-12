/**
 * The game: boots the engine, owns the menus, and runs one heist at a time. A run is a fresh
 * Rapier world, a RunState, the streamed scenes, the player, the torch, the guardians and the
 * ghost. The loop is a fixed 60 Hz simulation (player, props, relics, physics, clock, torch)
 * plus a per-frame update (input actions, interactions, streaming, guardians, sun and sky,
 * audio, HUD), then one render.
 */
import * as THREE from 'three';
import { initPhysics, Physics, RAPIER } from '../physics/Physics';
import { FIXED_DT, MAX_STEPS_PER_FRAME, G, groups, DEBUG, SUNLIGHT_QUERY } from '../config';
import { Input } from '../core/Input';
import { Renderer } from '../render/Renderer';
import { Lighting } from '../render/Lighting';
import { Sky } from '../render/Sky';
import { Materials } from '../render/materials';
import { buildTextures, flameTexture, softDotTexture } from '../render/textures';
import { Particles } from '../render/particles';
import { Vegetation } from '../render/vegetation';
import { RelicModels } from '../render/relicMeshes';
import { AudioEngine } from '../audio/AudioEngine';
import { Sfx, type SfxName, type LoopHandle } from '../audio/Sfx';
import { Music } from '../audio/Music';
import { Ambience, type AmbEnv } from '../audio/Ambience';
import { RunState, type EndReason } from './RunState';
import { Atmosphere } from './Atmosphere';
import { Player, type PlayerHost } from '../entities/Player';
import { Torch } from '../entities/Torch';
import { GuardianDirector, type DirectorHost } from '../entities/GuardianDirector';
import type { Guardian } from '../entities/Guardian';
import { Ghost } from '../entities/Ghost';
import { SceneManager } from '../world/SceneManager';
import { RelicManager, type LiveObject } from '../world/RelicManager';
import { SCENES, sceneAt, isDarkScene } from '../world/scenes';
import type { SceneCtx, SceneEnv, ToastKind } from '../world/SceneDef';
import type { Interactable, KillVolume } from '../world/types';
import { Sconce, SlidingSlab, type BreakableWall } from '../world/props/mechanisms';
import { NavMesh } from '../logic/navmesh';
import { SCENE_INFO, type SceneId, type Flag } from '../logic/unlocks';
import { gearFromUpgrades, settleRun, RELICS, purchase, formatMoney, defaultUpgrades, type UpgradeId } from '../logic/economy';
import { parseSave, serializeSave, SAVE_KEY, insertHighScore, GhostRecorder, type SaveData, type Settings } from '../logic/save';
import { edgePulse, type ClockEvent } from '../logic/countdown';
import { footstepLoudness, landingLoudness, impactLoudness, type NoiseEvent, type NoiseSource, type MoveMode } from '../logic/noise';
import { fallSnuffsTorch, type TorchEvent } from '../logic/torch';
import { heartbeat } from '../logic/guardians';
import { HUD, type HudState } from '../ui/HUD';
import { UI, type ResultsData, type UIHost } from '../ui/UI';
import { MapView } from '../ui/MapView';
import { DebugOverlay, type DebugInfo } from '../ui/DebugOverlay';
import { jungleHeight, RIVER_Z } from '../world/scenes/jungle';
import { PLAZA } from '../world/scenes/courtyard';

type GameState = 'boot' | 'menu' | 'loading' | 'playing' | 'paused' | 'ending' | 'results';

const OUTSIDE: SceneId[] = ['jungle', 'courtyard', 'cliffs'];
const DOOR_POS = new THREE.Vector3(0, 3.5, -1);
const STEP_SURFACES = new Set(['stone', 'dirt', 'grass', 'wood', 'water', 'metal', 'sand', 'rope', 'vine', 'bone']);
const GUARDIAN_NAMES: Record<string, string> = { sentinel: 'stone sentinel', crawler: 'crawler', shadow: 'shadow' };

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

interface Run {
  state: RunState;
  physics: Physics;
  relics: RelicManager;
  scenes: SceneManager;
  player: Player;
  torch: Torch;
  director: GuardianDirector;
  ghost: Ghost | null;
  recorder: GhostRecorder;
  ctx: SceneCtx;
}

export class Game implements UIHost {
  save: SaveData;
  state: GameState = 'boot';
  canvas: HTMLCanvasElement;
  renderer!: Renderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  lighting!: Lighting;
  sky!: Sky;
  atmo!: Atmosphere;
  mats!: Materials;
  models!: RelicModels;
  veg!: Vegetation;
  fx!: Particles;
  nav!: NavMesh;
  audio = new AudioEngine();
  sfx: Sfx;
  music: Music;
  amb: Ambience;
  input: Input;
  ui: UI;
  hud: HUD;
  map: MapView;
  debug: DebugOverlay;
  run: Run | null = null;

  private acc = 0;
  private last = 0;
  private time = 0;
  private fpsFrames = 0;
  private fpsT = 0;
  fps = 0;
  private frameMs = 0;
  private worstMs = 0;
  /** Smoothed CPU time of the simulation/update part of a frame, and of the render call. */
  private updMs = 0;
  private rndMs = 0;
  /** Debug only: game seconds per real second (headless tests run slow software rendering). */
  private timeScale = 1;
  /** Adaptive quality: a sustained low frame rate early in a session steps the preset down once or twice. */
  private perfT = 0;
  private perfFrames = 0;
  private perfDrops = 0;
  private perfWatch = 0;
  private worstT = 0;
  private camDark = false;
  private camEnv: SceneEnv = 'outdoor';
  private camScene: SceneId | null = null;
  private litSconces: { id: string; pos: THREE.Vector3; radius: number; prop: Sconce }[] = [];
  private pendingGusts: number[] = [];
  private gust = 0;
  private gustPhase = 0;
  private gustT = 3;
  private inWind = false;
  private windLoop: LoopHandle | null = null;
  private doorLoop: LoopHandle | null = null;
  private beatT = 0;
  private chaseSmooth = 0;
  private revealT = 0;
  private holdT = 0;
  private holdTarget: Interactable | null = null;
  private holdFired = false;
  private target: Interactable | null = null;
  private infoTarget: Interactable | null = null;
  private lookObj: LiveObject | null = null;
  private selected = 0;
  private kickCd = 0;
  private thrownAt = new Map<number, number>();
  private impactAt = new Map<number, number>();
  private wasLocked = false;
  private firstHallsHint = false;
  private firstDarkHint = false;
  private god = false;
  private headless = false;

  constructor(private parent: HTMLElement) {
    this.save = this.loadSave();
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game';
    parent.appendChild(this.canvas);
    this.camera = new THREE.PerspectiveCamera(this.save.settings.fov, window.innerWidth / window.innerHeight, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.sfx = new Sfx(this.audio);
    this.music = new Music(this.audio);
    this.amb = new Ambience(this.audio, this.sfx);
    this.input = new Input(this.canvas);
    this.hud = new HUD(parent);
    this.map = new MapView(parent);
    this.debug = new DebugOverlay(parent);
    this.ui = new UI(parent, this);
    this.headless = /HeadlessChrome/.test(navigator.userAgent) || /[?&]headless\b/.test(location.search);
  }

  // ---------------------------------------------------------------------------
  // boot

  async boot() {
    this.ui.loading('Waking the physics engine', 0.05);
    await nextFrame();
    await initPhysics();
    const q = this.save.settings.quality;
    this.ui.loading('Carving stone and growing the jungle (procedural textures)', 0.2);
    await nextFrame();
    const tex = buildTextures(q);
    this.ui.loading('Mixing pigments', 0.55);
    await nextFrame();
    this.mats = new Materials(tex, flameTexture(), softDotTexture());
    this.models = new RelicModels(this.mats);
    this.veg = new Vegetation(this.mats);
    this.fx = new Particles(softDotTexture());
    this.scene.add(this.fx.group);
    this.renderer = new Renderer(this.canvas, q);
    this.lighting = new Lighting(this.scene, q);
    this.sky = new Sky();
    this.atmo = new Atmosphere(this.scene, this.lighting, this.sky, this.renderer);
    this.ui.loading('Surveying the temple for the guardians (navmesh)', 0.75);
    await nextFrame();
    this.nav = SceneManager.buildNav();
    this.applySettings(this.save.settings, false);
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pauseGame();
    });
    this.canvas.addEventListener('click', () => {
      this.audio.resume();
      if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
    });
    this.input.onLockChange = (locked) => {
      if (locked) this.wasLocked = true;
      else if (this.wasLocked && this.state === 'playing') this.pauseGame();
    };
    this.resize();
    if (DEBUG) this.installDebugApi();
    this.state = 'menu';
    this.ui.menu();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private resize() {
    this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera.updateProjectionMatrix();
    this.renderer?.resize();
  }

  // ---------------------------------------------------------------------------
  // save data

  private loadSave(): SaveData {
    try {
      return parseSave(localStorage.getItem(SAVE_KEY));
    } catch {
      return parseSave(null);
    }
  }

  private persist() {
    try {
      localStorage.setItem(SAVE_KEY, serializeSave(this.save));
    } catch {
      /* storage blocked: progress lives for this session only */
    }
  }

  applySettings(s: Settings, persist = true) {
    const prevQ = this.save.settings.quality;
    this.save.settings = s;
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.debug.setFpsOnly(s.showFps);
    if (this.renderer && s.quality !== prevQ) {
      this.renderer.setQuality(s.quality);
      this.lighting.setQuality(s.quality);
    }
    if (persist) this.persist();
  }

  buy(id: UpgradeId): boolean {
    this.audio.resume();
    const r = purchase(this.save.money, this.save.upgrades, id);
    if (!r.ok) {
      this.sfx.play('deny');
      return false;
    }
    this.save.money = r.money;
    this.save.upgrades = r.upgrades;
    this.persist();
    this.sfx.play('stash', null, 0.8);
    return true;
  }

  resetSave() {
    const settings = this.save.settings;
    this.save = parseSave(null);
    this.save.settings = settings;
    this.save.upgrades = defaultUpgrades();
    this.persist();
  }

  // ---------------------------------------------------------------------------
  // run lifecycle

  startRun() {
    this.audio.resume();
    if (this.state === 'loading') return;
    this.input.requestLock();
    void this.beginRun();
  }

  private async beginRun(seedOverride?: number) {
    this.disposeRun();
    this.state = 'loading';
    this.hud.show(false);
    this.map.toggle(false);
    this.ui.loading('Breaking camp at dawn', 0.05);
    await nextFrame();
    const qs = new URLSearchParams(location.search);
    const seed = seedOverride ?? (qs.has('seed') ? Number(qs.get('seed')) | 0 : (Date.now() ^ (Math.random() * 1e9)) & 0x7fffffff);
    const gear = gearFromUpgrades(this.save.upgrades);
    const state = new RunState(seed, gear);
    const physics = new Physics();
    const relics = new RelicManager(physics, this.models, seed);
    this.scene.add(relics.group);
    relics.sceneAt = (p) => sceneAt(p, null);
    relics.onLost = (rec) => this.toast(`The ${rec.label} tumbles into the depths. Gone.`, 'bad');
    relics.onSpawn = (live) => this.mats.applyDark(live.obj, isDarkScene(live.rec.scene));
    this.resetNavGates(state);

    // the run object is assembled in steps: ctx and player reference each other through closures
    const run = { state, physics, relics } as Run;
    this.run = run;
    run.ctx = this.makeCtx(run);
    run.scenes = new SceneManager(run.ctx, physics, this.mats, this.scene);
    run.scenes.onEnter = (id, prev) => this.onEnterScene(id, prev);
    const spawn = new THREE.Vector3(0, jungleHeight(0, 174) + 0.05, 174);
    run.player = new Player(this.playerHost(run), this.camera, spawn);
    run.player.yaw = 0;
    run.player.pitch = -0.04;
    run.torch = new Torch(this.mats, this.lighting, this.camera, this.sfx, this.fx);
    run.director = new GuardianDirector(this.directorHost(run));
    run.director.setup();
    run.recorder = new GhostRecorder();
    run.ghost = this.save.ghost ? new Ghost(this.mats, this.scene, this.save.ghost) : null;
    physics.onImpact = (e) => this.onImpact(e);

    // stream in the start and its neighbours before the first frame
    run.scenes.update(run.player.pos, 0, 0);
    const total = Math.max(1, run.scenes.pending);
    while (run.scenes.pending > 0) {
      run.scenes.pump(30);
      this.ui.loading('Clearing the jungle path (building scenes)', 0.15 + 0.7 * (1 - run.scenes.pending / total));
      await nextFrame();
      if (this.run !== run) return;
    }
    this.ui.loading('Lighting the lamps (compiling shaders)', 0.9);
    await nextFrame();
    this.atmo.update(state.clock.elapsed, state.clock.dayFrac, 'outdoor', run.player.pos, 0);
    run.player.updateCamera(1, 0, this.save.settings.fov);
    try {
      this.renderer.gl.compile(this.scene, this.camera);
    } catch (e) {
      console.warn('precompile', e);
    }
    this.map.reset();
    this.map.mark(0, 176, 'camp', 'jungle');
    this.hud.clearToasts();
    this.hud.fade(1, 0);
    this.hud.show(true);
    this.ui.hide();
    this.state = 'playing';
    this.acc = 0;
    this.selected = 0;
    this.firstHallsHint = false;
    this.firstDarkHint = false;
    this.music.enabled = true;
    window.setTimeout(() => this.hud.fade(0, 1.6), 50);
    this.toast('Dawn. The temple lies north, past the river and the gorge. Back by dark.', 'info', 7);
    if (this.save.runs === 0) this.toast('Loot only counts once it is in the haul cart by the great door.', 'warn', 9);
    if (!this.input.locked && !this.headless) this.ui.showClickToPlay(true);
  }

  private resetNavGates(st: RunState) {
    const f = (x: Flag) => st.unlock.flags.has(x);
    const gates: Record<string, boolean> = {
      seal: f('sealOpen'),
      vaultDoor: f('vaultDoorOpen'),
      boneWall: f('boneWallBroken'),
      portcullis: f('lairOpen'),
      aqueduct: f('aqueductOpen'),
      drawbridge: f('drawbridgeLowered'),
      nave: !f('naveBlocked'),
      boulderRamp: false,
    };
    for (const [g, open] of Object.entries(gates)) this.nav.setGate(g, open);
  }

  private disposeRun() {
    const run = this.run;
    if (!run) return;
    this.run = null;
    try {
      run.scenes?.unloadAll();
      run.director?.dispose();
      run.relics?.dispose();
      run.player?.dispose();
      run.torch?.dispose();
      run.ghost?.dispose();
      run.physics?.dispose();
    } catch (e) {
      console.warn('dispose run', e);
    }
    this.windLoop?.stop();
    this.windLoop = null;
    this.doorLoop?.stop();
    this.doorLoop = null;
    this.fx.clear();
    this.amb.stopAll();
    this.music.stop();
    this.litSconces = [];
    this.thrownAt.clear();
    this.impactAt.clear();
    this.target = this.infoTarget = this.holdTarget = null;
    this.lookObj = null;
  }

  resume() {
    if (this.state !== 'paused') return;
    this.audio.resume();
    this.audio.setPaused(false);
    this.ui.hide();
    this.hud.show(true);
    this.state = 'playing';
    this.last = performance.now();
    this.input.requestLock();
  }

  private pauseGame() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.setPaused(true);
    this.map.toggle(false);
    this.input.exitLock();
    this.ui.showClickToPlay(false);
    this.ui.pause();
  }

  abandon() {
    if (!this.run) return;
    this.ui.hide();
    this.audio.setPaused(false);
    this.state = 'playing';
    this.endRun('abandoned', 'You turned back and left the temple to the jungle.');
  }

  // ---------------------------------------------------------------------------
  // the scene context: services offered to scenes and props

  private makeCtx(run: Run): SceneCtx {
    const game = this;
    const ctx: SceneCtx = {
      physics: run.physics,
      mats: this.mats,
      run: run.state,
      sfx: this.sfx,
      fx: this.fx,
      relics: run.relics,
      nav: this.nav,
      quality: this.save.settings.quality,
      veg: this.veg,
      models: this.models,
      root: this.scene,
      sunDir: this.atmo.sunDir,
      player: () => run.player,
      noise: (pos, loudness, source, byPlayer = false) => game.noise(pos, loudness, source, byPlayer),
      damage: (amount, cause, reason) => game.damage(amount, cause, reason),
      toast: (text, kind) => game.toast(text, kind),
      shake: (a) => {
        if (run.player) run.player.shake = Math.min(2, run.player.shake + a);
      },
      sunUp: () => game.atmo.sunUp(run.state.clock.isDark),
      litBySun: (p) => game.litBySun(p),
      setFlag: (f) => game.setFlag(f),
      time: () => run.state.time,
      mapMark: (x, z, label) => game.map.mark(x, z, label, run.scenes?.current ?? null),
      bankAll: () => game.bankAll(),
      leaveTemple: () => game.endRun('escaped', 'You hitched up the cart and walked away from the temple with your haul.'),
      carriedCount: () => run.state.satchel.items.length + (game.heldRelic() ? 1 : 0),
      wakeEarly: (spawn) => run.director?.wakeEarly(spawn),
      cameraDark: () => game.camDark,
    };
    return ctx;
  }

  private setFlag(f: Flag) {
    const run = this.run;
    if (!run) return;
    run.state.unlock.flags.add(f);
    // keep the guardians' map in step even when the prop's scene is not loaded
    const gate: Partial<Record<Flag, [string, boolean]>> = {
      lairOpen: ['portcullis', true],
      sealOpen: ['seal', true],
      vaultDoorOpen: ['vaultDoor', true],
      boneWallBroken: ['boneWall', true],
      aqueductOpen: ['aqueduct', true],
      drawbridgeLowered: ['drawbridge', true],
      naveBlocked: ['nave', false],
    };
    const g = gate[f];
    if (g) this.nav.setGate(g[0], g[1]);
  }

  litBySun(p: THREE.Vector3): boolean {
    const run = this.run;
    if (!run || !this.atmo.sunUp(run.state.clock.isDark)) return false;
    const d = this.atmo.sunDir;
    const o = p.clone().addScaledVector(d, 0.06);
    return !run.physics.raycast(o, d, 260, SUNLIGHT_QUERY);
  }

  noise(pos: THREE.Vector3, loudness: number, source: NoiseSource, byPlayer = false) {
    const run = this.run;
    if (!run || loudness <= 0) return;
    const ev: NoiseEvent = { x: pos.x, y: pos.y, z: pos.z, loudness, source, byPlayer };
    run.scenes.noise(ev);
    run.director.noise(ev);
  }

  toast(text: string, kind: ToastKind = 'info', seconds = 4.5) {
    this.hud.toast(text, kind, seconds);
  }

  damage(amount: number, cause: string, reason: EndReason = 'killed') {
    const run = this.run;
    if (!run || run.state.ended || this.god || amount <= 0) return;
    const st = run.state;
    st.health -= amount;
    st.sinceDamage = 0;
    this.hud.damageFlash(amount / 40);
    run.player.shake = Math.min(2, run.player.shake + amount / 35);
    this.sfx.play('hurt', null, Math.min(1, 0.5 + amount / 60));
    if (st.health <= 0) {
      st.health = 0;
      this.endRun(reason, `Killed by ${cause}.`);
    }
  }

  // ---------------------------------------------------------------------------
  // player host

  private playerHost(run: Run): PlayerHost {
    const game = this;
    return {
      physics: run.physics,
      run: run.state,
      input: this.input,
      climbables: () => run.scenes.climbables,
      waters: () => run.scenes.waters,
      kills: () => run.scenes.kills,
      loadFraction: () => game.loadFraction(),
      footstep: (mode, surface, pos) => game.footstep(mode, surface, pos),
      landed: (speed, pos) => game.landed(speed, pos),
      killVolume: (k) => game.killVolume(k),
      stepOn: (c, mass) => {
        const o = run.physics.ownerOf(c);
        const fn = o?.onStep;
        if (typeof fn === 'function') (fn as (m: number) => void)(mass);
      },
      windAccel: (pos, out) => game.windAccel(pos, out),
      toast: (text, kind) => game.toast(text, kind as ToastKind),
      grabbed: (body) => game.onGrabbed(body),
      released: (body, thrown) => game.onReleased(body, thrown),
    };
  }

  loadFraction(): number {
    const run = this.run;
    if (!run) return 0;
    const held = run.player?.held?.mass ?? 0;
    return (run.state.satchel.weight + held) / Math.max(1, run.state.satchel.capacity);
  }

  private surfaceAt(surface: string, pos: THREE.Vector3): SfxName {
    let s = surface;
    if (s === 'stone') {
      const sc = this.run?.scenes.current;
      if (sc === 'jungle') s = Math.sin(pos.x * 0.7) * Math.cos(pos.z * 0.6) > 0.1 ? 'grass' : 'dirt';
      else if (sc === 'courtyard') {
        const onPlaza = pos.x > PLAZA.x0 && pos.x < PLAZA.x1 && pos.z > PLAZA.z0 && pos.z < PLAZA.z1;
        if (!onPlaza) s = 'grass';
      } else if (sc === 'cliffs') s = 'dirt';
    }
    if (!STEP_SURFACES.has(s)) s = 'stone';
    return ('step_' + s) as SfxName;
  }

  private footstep(mode: MoveMode, surface: string, pos: THREE.Vector3) {
    const vol = mode === 'sprint' ? 0.9 : mode === 'walk' ? 0.55 : 0.18;
    this.sfx.play(this.surfaceAt(surface, pos), pos, vol, 0.92 + Math.random() * 0.16);
    const loud = footstepLoudness(mode, this.loadFraction());
    if (loud > 0.05) this.noise(pos, loud, 'footstep', true);
  }

  private landed(speed: number, pos: THREE.Vector3) {
    const run = this.run;
    if (!run) return;
    this.sfx.play('land', pos, Math.min(1, speed / 10));
    this.noise(pos, landingLoudness(speed), 'landing', true);
    run.player.dip(Math.min(0.3, speed * 0.02));
    if (speed > 11) this.damage((speed - 11) * 9, 'a bad fall');
    if (fallSnuffsTorch(speed) && run.state.torch.lit) this.onTorchEvents(run.state.torch.extinguish('fall'));
  }

  private killVolume(k: KillVolume) {
    const run = this.run;
    if (!run || run.state.ended) return;
    const pl = run.player;
    if (k.kind === 'abyss') {
      this.sfx.play('whoosh', null, 1);
      this.endRun('killed', 'You fell into the dark and did not stop falling.');
      return;
    }
    const respawn = k.respawn ?? (SCENES[k.scene].respawn ? new THREE.Vector3(...SCENES[k.scene].respawn!) : null);
    if (k.kind === 'gorge') {
      this.sfx.play('splash', pl.pos, 1);
      if (pl.held) pl.release(false);
      this.onTorchEvents(run.state.torch.extinguish('water'));
      this.damage(20, 'the gorge');
      if (run.state.ended) return;
      for (const ev of run.state.clock.advance(25)) this.onClock(ev);
      this.toast('The river drags you back to the south rim. Soaked, bruised, and half a minute gone.', 'bad', 6);
    } else {
      this.sfx.play('spikes', pl.pos, 1);
      this.damage(45, 'the spikes');
      if (run.state.ended) return;
      this.toast('Spikes! You haul yourself out of the pit.', 'bad');
    }
    if (respawn) pl.teleport(respawn);
  }

  private windAccel(pos: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    const run = this.run;
    if (!run) return out;
    for (const w of run.scenes.winds) {
      if (!w.box.containsPoint(pos)) continue;
      out.addScaledVector(w.dir, w.strength * (0.25 + 0.75 * this.gust));
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // director host

  private directorHost(run: Run): DirectorHost {
    const game = this;
    return {
      physics: run.physics,
      nav: this.nav,
      mats: this.mats,
      root: this.scene,
      sfx: this.sfx,
      seed: run.state.seed,
      player: () => run.player,
      playerLightRadius: () => run.state.torch.radius,
      playerInLight: () => {
        const p = run.player.pos;
        return game.litSconces.some((s) => s.pos.distanceTo(p) < s.radius);
      },
      isLoadedAt: (p) => {
        const id = sceneAt(p, null);
        return !!id && run.scenes.isReady(id);
      },
      torchFlame: () => (run.state.torch.lit ? run.torch.flamePos : null),
      litSconces: () => game.litSconces,
      douseSconce: (id) => game.litSconces.find((s) => s.id === id)?.prop.douse(),
      openLair: () => game.setFlag('lairOpen'),
      caught: (g) => game.caught(g),
      toast: (text, kind) => game.toast(text, kind),
      shake: (a) => {
        run.player.shake = Math.min(2, run.player.shake + a);
      },
    };
  }

  private caught(g: Guardian) {
    const run = this.run;
    if (!run || run.state.ended || this.god) return;
    const pl = run.player;
    const dx = g.pos.x - pl.pos.x;
    const dz = g.pos.z - pl.pos.z;
    pl.yaw = Math.atan2(-dx, -dz);
    pl.pitch = g.kind === 'crawler' ? -0.35 : 0.25;
    pl.shake = 1.6;
    this.sfx.play('caught', null, 1);
    this.sfx.play(g.kind, g.eye, 1.6, 0.8);
    this.endRun('caught', `A ${GUARDIAN_NAMES[g.kind]} caught you in the ${SCENE_INFO[run.scenes.current ?? 'halls'].name.toLowerCase()}.`);
    run.director.enabled = false;
  }

  // ---------------------------------------------------------------------------
  // relics, satchel and the cart

  /** The relic record in the player's hands, if it is a relic (not a sandbag). */
  heldRelic(): LiveObject | null {
    const run = this.run;
    const h = run?.player?.held;
    if (!run || !h) return null;
    const live = run.relics.ofBody(h.body);
    return live && live.rec.inst ? live : null;
  }

  private onGrabbed(body: RAPIER.RigidBody) {
    const run = this.run;
    if (!run) return;
    const live = run.relics.ofBody(body);
    if (!live) return;
    run.relics.setHeld(live.rec.uid, true);
    this.discover(live);
    this.sfx.play('pickup', live.obj.position, 0.6);
  }

  private onReleased(body: RAPIER.RigidBody, thrown: boolean) {
    const run = this.run;
    if (!run) return;
    const live = run.relics.ofBody(body);
    if (live) run.relics.setHeld(live.rec.uid, false);
    if (thrown) {
      this.thrownAt.set(body.handle, run.state.time);
      this.sfx.play('whoosh', null, 0.5, 1.3);
    }
  }

  private discover(live: LiveObject) {
    const run = this.run!;
    const inst = live.rec.inst;
    if (!inst || run.state.ledger.found.has(inst.uid)) return;
    run.state.ledger.noteFound(inst.uid);
    run.state.relicsFound++;
    run.state.relicTypesFound.add(inst.type);
    const r = RELICS[inst.type];
    this.toast(`${r.name}: ${formatMoney(inst.value)}, ${r.weight} kg (${r.rarity}). ${r.blurb}`, r.rarity === 'common' ? 'info' : 'good', 5);
  }

  private stash(live: LiveObject) {
    const run = this.run!;
    const inst = live.rec.inst;
    if (!inst) {
      this.toast(`${live.rec.label} will not fit in a satchel. Carry it.`, 'warn');
      return;
    }
    const sat = run.state.satchel;
    if (!sat.canAdd(inst)) {
      this.sfx.play('deny');
      this.toast(`Satchel full: ${sat.weight.toFixed(1)} of ${sat.capacity} kg. Carry it by hand, or bank what you have.`, 'warn');
      return;
    }
    this.discover(live);
    const pl = run.player;
    if (pl.held && pl.held.body.handle === live.body.handle) pl.forgetHeld();
    sat.add(inst);
    run.relics.stash(inst.uid);
    this.sfx.play('stash', pl.pos, 0.8);
    this.toast(`Stashed: ${RELICS[inst.type].name} (${formatMoney(inst.value)})`, 'good', 2.5);
  }

  private pullSelected() {
    const run = this.run!;
    const pl = run.player;
    const items = run.state.satchel.byDensity();
    if (!items.length) return;
    if (pl.held) {
      this.toast('Your hands are full.', 'warn', 2);
      return;
    }
    const it = items[Math.min(this.selected, items.length - 1)];
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = pl.lookDir(new THREE.Vector3());
    const pos = eye.addScaledVector(dir, 0.9);
    run.state.satchel.remove(it.uid);
    const live = run.relics.pull(it.uid, pos, run.scenes.current ?? 'jungle');
    if (live) pl.grab(live.body);
    this.selected = Math.max(0, Math.min(this.selected, items.length - 2));
  }

  private bankAll(): number {
    const run = this.run;
    if (!run) return 0;
    let v = 0;
    const held = this.heldRelic();
    if (held && held.rec.inst) {
      run.state.ledger.banked.push(held.rec.inst);
      v += held.rec.inst.value;
      run.player.forgetHeld();
      run.relics.removeLive(held.rec.uid);
      run.relics.bank(held.rec.uid);
    }
    const uids = run.state.satchel.items.map((i) => i.uid);
    v += run.state.ledger.bankAll();
    for (const u of uids) run.relics.bank(u);
    return v;
  }

  private onImpact(e: { collider: RAPIER.Collider; other: RAPIER.Collider; force: number; point: THREE.Vector3 }) {
    const run = this.run;
    if (!run) return;
    const owner = run.physics.ownerOf(e.collider);
    if (!owner || (owner.kind !== 'relic' && owner.kind !== 'weight')) return;
    const body = e.collider.parent();
    if (!body) return;
    const t = run.state.time;
    if (t - (this.impactAt.get(body.handle) ?? -9) < 0.15) return;
    this.impactAt.set(body.handle, t);
    const impulse = e.force * FIXED_DT;
    const loud = impactLoudness(impulse);
    this.sfx.play(owner.kind === 'relic' ? 'impactMetal' : 'impact', e.point, Math.min(1, impulse / 18), 0.85 + Math.random() * 0.3);
    const thrown = t - (this.thrownAt.get(body.handle) ?? -99) < 3;
    if (loud > 0.08) this.noise(e.point, thrown ? Math.max(0.6, loud) : loud, thrown ? 'decoy' : 'impact', false);
    if (thrown) this.thrownAt.delete(body.handle);
  }

  // ---------------------------------------------------------------------------
  // clock, torch, door

  private onClock(ev: ClockEvent) {
    const run = this.run;
    if (!run) return;
    switch (ev.type) {
      case 'tick':
        this.sfx.play('tick', null, ev.volume);
        break;
      case 'finalTwoMinutes':
        this.toast('Two minutes until dark. The ticking quickens.', 'warn', 6);
        break;
      case 'finalMinute': {
        this.toast('One minute! The temple shudders. Get to the door.', 'bad', 6);
        this.sfx.play('rumble', null, 1);
        run.player.shake = Math.min(2, run.player.shake + 1.1);
        if (this.camEnv !== 'outdoor') {
          for (let i = 0; i < 4; i++) this.fx.dustBurst(run.player.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 3.5, (Math.random() - 0.5) * 8)), 30, 3, true);
        }
        break;
      }
      case 'darkness': {
        this.setFlag('darkness');
        this.setFlag('lairOpen');
        // the temple lets its keepers out: the chasm drawbridge drops so they can reach the door
        const bridgeWasUp = !run.state.flag('drawbridgeLowered');
        this.setFlag('drawbridgeLowered');
        this.sfx.play('gong', null, 1);
        this.sfx.play('rumble', null, 1);
        run.player.shake = Math.min(2, run.player.shake + 0.8);
        const doorOpen = run.state.flag('greatDoorOpen');
        this.toast(doorOpen ? 'Darkness. Something wakes below. The great door is closing: 90 seconds.' : 'Darkness. The temple wakes. Its door never opened for you.', 'bad', 8);
        if (bridgeWasUp) this.toast('Chains rattle in the halls: the chasm drawbridge is coming down for them.', 'warn', 7);
        if (doorOpen) this.doorLoop = this.sfx.loop('grind', DOOR_POS, 1.2);
        break;
      }
      case 'doorShut': {
        this.setFlag('doorShut');
        this.doorLoop?.stop();
        this.doorLoop = null;
        this.sfx.play('thunk', DOOR_POS, 1.5);
        if (this.isOutside()) this.endRun('escaped', 'Night took the temple. You watched the great door seal itself, then walked back to camp.');
        else this.endRun('entombed', 'The great door ground shut with you on the wrong side of it.');
        break;
      }
      default:
        break;
    }
  }

  private onTorchEvents(evs: TorchEvent[]) {
    const run = this.run;
    if (!run) return;
    const at = run.torch.flamePos;
    for (const e of evs) {
      switch (e.type) {
        case 'out': {
          this.sfx.play('torchOut', at, 1);
          this.fx.sparks(at, 8);
          const why: Record<string, string> = {
            water: 'The water snuffs your torch.',
            wind: 'A gust tears the flame off your torch!',
            fall: 'The fall knocks your torch out.',
            fuel: 'Your torch gutters out of fuel.',
          };
          if (e.reason !== 'snuffed') this.toast(why[e.reason] + (run.state.torch.fuel > 0 || run.state.torch.spareTorches > 0 ? ' T to relight.' : ''), 'bad');
          break;
        }
        case 'lit':
          this.sfx.play('torchLight', at, 0.9);
          break;
        case 'relightFail':
          this.sfx.play('deny');
          this.toast(e.reason === 'water' ? 'You cannot strike a light in the water.' : 'No fuel and no spare torches left.', 'warn');
          break;
        case 'lowFuel':
          this.toast(`Torch fuel is low. ${run.state.torch.oilFlasks > 0 ? 'R to pour in an oil flask.' : 'Find a sconce, or hurry.'}`, 'warn');
          break;
        case 'refuel':
          this.sfx.play('flask', at, 0.8);
          this.toast(`Oil flask poured: +${Math.round(e.amount)} fuel.`, 'good', 2.5);
          break;
        case 'freshTorch':
          this.toast('You light one of your spare torches.', 'info', 3);
          break;
        default:
          break;
      }
    }
  }

  private updateDoor() {
    const run = this.run!;
    const clock = run.state.clock;
    if (!clock.isDark) return;
    const door = run.scenes.findProp<SlidingSlab>('greatDoor');
    if (!door) return;
    door.hold = true;
    door.setOpen(run.state.flag('greatDoorOpen') ? 1 - clock.doorClosure : 0);
  }

  isOutside(): boolean {
    const run = this.run;
    if (!run) return false;
    const s = sceneAt(run.player.feet, run.scenes.current);
    return !!s && OUTSIDE.includes(s);
  }

  // ---------------------------------------------------------------------------
  // ending

  endRun(reason: EndReason, cause: string) {
    const run = this.run;
    if (!run || run.state.ended) return;
    const st = run.state;
    const outside = reason === 'escaped' || this.isOutside();
    const held = this.heldRelic();
    const carried = st.ledger.carriedValue + (held?.rec.inst?.value ?? 0);
    const banked = st.ledger.bankedValue;
    st.ended = true;
    st.endReason = reason;
    st.endCause = cause;
    const res = settleRun(reason, banked, carried, outside);
    run.player.mode = reason === 'escaped' || reason === 'abandoned' ? 'frozen' : 'dead';
    if (reason !== 'escaped') run.player.dip(0.5);
    const s = this.save;
    s.money += res.haul;
    s.totalEarned += res.haul;
    s.runs++;
    const entry = { haul: res.haul, status: reason, time: st.time, relics: st.relicsFound, date: new Date().toISOString().slice(0, 10) };
    const ins = insertHighScore(s.highScores, entry);
    s.highScores = ins.list;
    let ghostSaved = false;
    if (reason === 'escaped' && res.haul > 0 && res.haul >= (s.ghost?.haul ?? 0)) {
      s.ghost = run.recorder.track(res.haul);
      ghostSaved = true;
    }
    this.persist();
    this.doorLoop?.stop();
    this.doorLoop = null;
    if (reason === 'escaped') this.sfx.play('chime', null, 1);
    else if (reason === 'entombed') this.sfx.play('rumble', null, 1);
    else if (reason === 'killed') this.sfx.play('thunk', null, 0.8);
    this.state = 'ending';
    this.map.toggle(false);
    this.hud.setPrompt(null);
    this.hud.fade(1, reason === 'escaped' ? 2.2 : 1.4, reason === 'caught' || reason === 'killed' ? '#1a0000' : '#000');
    const data: ResultsData = {
      status: reason,
      cause,
      haul: res.haul,
      lost: res.lost,
      banked,
      carried,
      relics: st.relicsFound,
      types: st.relicTypesFound.size,
      time: st.time,
      rank: ins.rank,
      money: s.money,
      ghostSaved,
      best: s.highScores[0]?.haul ?? 0,
    };
    window.setTimeout(() => {
      if (this.run !== run) return;
      this.state = 'results';
      this.input.exitLock();
      this.ui.showClickToPlay(false);
      this.hud.show(false);
      this.disposeRun();
      this.ui.results(data);
    }, reason === 'escaped' ? 2600 : 2000);
  }

  // ---------------------------------------------------------------------------
  // the loop

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const tStart = performance.now();
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(0.1, Math.max(0, raw)) * this.timeScale;
    this.time += dt;
    this.fpsFrames++;
    this.fpsT += raw;
    if (this.fpsT >= 0.5) {
      this.fps = this.fpsFrames / this.fpsT;
      this.frameMs = (this.fpsT / this.fpsFrames) * 1000;
      this.fpsFrames = 0;
      this.fpsT = 0;
    }
    this.worstT -= raw;
    if (raw * 1000 > this.worstMs || this.worstT <= 0) {
      this.worstMs = raw * 1000;
      this.worstT = 2;
    }
    this.input.poll(raw);
    const run = this.run;
    if (this.input.pressed('debug')) this.debug.toggle();
    if (run && (this.state === 'playing' || this.state === 'ending')) {
      if (this.state === 'playing') this.handleMeta();
      if (this.state === 'playing' || this.state === 'ending') {
        if (this.state === 'playing') run.player.frameUpdate(dt, this.input);
        this.acc += dt;
        let steps = 0;
        const maxSteps = MAX_STEPS_PER_FRAME * Math.ceil(this.timeScale);
        while (this.acc >= FIXED_DT && steps < maxSteps) {
          this.fixedStep(FIXED_DT);
          this.acc -= FIXED_DT;
          steps++;
          if (!this.run) break;
        }
        if (steps >= maxSteps) this.acc = 0;
        if (this.run) this.update(dt, this.acc / FIXED_DT);
      }
    }
    const tRender = performance.now();
    if (this.run && this.state !== 'results') this.renderer.render(this.scene, this.camera, this.time);
    else if (this.renderer && this.state !== 'paused') {
      this.renderer.gl.setRenderTarget(null);
      this.renderer.gl.clear();
    }
    const tEnd = performance.now();
    this.updMs += (tRender - tStart - this.updMs) * 0.1;
    this.rndMs += (tEnd - tRender - this.rndMs) * 0.1;
    this.watchPerformance(raw);
    this.debug.update(dt, () => this.debugInfo());
    this.input.endFrame();
  }

  /**
   * If the first minutes of play run well under 60 FPS (a 5 second window averaging below 45),
   * step the graphics preset down (high to medium to low), at most twice per session, and say so.
   * Skipped in headless runs, where software rendering would always trip it.
   */
  private watchPerformance(raw: number) {
    if (this.headless || this.state !== 'playing' || this.perfDrops >= 2 || document.hidden) {
      this.perfT = 0;
      this.perfFrames = 0;
      return;
    }
    this.perfWatch += raw;
    if (this.perfWatch > 240) return; // only judge the first four minutes
    this.perfT += raw;
    this.perfFrames++;
    if (this.perfT < 5) return;
    const fps = this.perfFrames / this.perfT;
    this.perfT = 0;
    this.perfFrames = 0;
    if (fps >= 45) return;
    const q = this.save.settings.quality;
    const next = q === 'high' ? 'medium' : q === 'medium' ? 'low' : null;
    if (!next) return;
    this.perfDrops++;
    this.applySettings({ ...this.save.settings, quality: next });
    this.toast(`Running at ${fps.toFixed(0)} FPS: graphics lowered to ${next}. Change it in Settings.`, 'info', 6);
  }

  /** Pause, map, the click-to-play hint. */
  private handleMeta() {
    if (this.input.pressed('pause')) {
      this.pauseGame();
      return;
    }
    if (this.input.pressed('map')) this.map.toggle();
    this.ui.showClickToPlay(!this.input.locked && !this.headless);
  }

  private fixedStep(dt: number) {
    const run = this.run!;
    const st = run.state;
    st.time += dt;
    if (!st.ended) for (const ev of st.clock.update(dt)) this.onClock(ev);
    if (!this.run) return;
    const pl = run.player;
    pl.slow = st.torch.isRelighting ? 0.55 : 1;
    pl.fixedUpdate(dt);
    run.scenes.fixedUpdate(dt);
    run.relics.fixedUpdate();
    run.physics.step();
    const lf = this.loadFraction();
    st.stamina.update(dt, lf);
    st.sinceDamage += dt;
    if (st.sinceDamage > 6 && st.health < 100 && !st.ended) st.health = Math.min(100, st.health + 2.5 * dt);
    const tev = st.torch.update(dt, { submerged: pl.torchSubmerged, gusts: this.pendingGusts.splice(0), crouched: pl.crouching, rand: Math.random });
    if (tev.length) this.onTorchEvents(tev);
    if (!st.ended) {
      const f = pl.feet;
      run.recorder.update(dt, f.x, f.y, f.z, pl.yaw);
    }
  }

  private update(dt: number, alpha: number) {
    const run = this.run!;
    const st = run.state;
    const pl = run.player;
    if (this.state === 'playing') {
      this.handleActions(dt);
      this.updateInteraction(dt);
    } else this.hud.setPrompt(null);
    run.scenes.update(pl.pos, dt, 4);
    run.scenes.frameUpdate(dt);
    this.gatherSconces(run);
    run.director.update(dt, st.clock.isDark ? -st.clock.remaining : null);
    if (!this.run) return;
    this.updateDoor();
    this.updateWind(dt);
    pl.updateCamera(alpha, dt, this.save.settings.fov);

    // where the camera is decides the lighting rules
    const camPos = this.camera.position;
    this.camScene = sceneAt(camPos, run.scenes.current);
    const env: SceneEnv = this.camScene ? SCENES[this.camScene].env : 'outdoor';
    const wasDark = this.camDark;
    this.camEnv = env;
    this.camDark = env === 'dark';
    if (wasDark !== this.camDark) for (const live of run.relics.live.values()) this.mats.applyDark(live.obj, isDarkScene(live.rec.scene));
    this.atmo.update(st.clock.elapsed, st.clock.dayFrac, env, pl.pos, st.time);
    const viewAmb = this.camDark ? 0 : (env === 'interior' ? 0.16 : 0.1 + 0.5 * Math.min(1, this.atmo.sunIntensity / 3.4)) * (1 - 0.75 * this.atmo.night);
    run.torch.update(dt, st.torch, pl.mode !== 'dead', viewAmb);
    run.torch.assignSconces(this.litSconces, camPos);
    this.fx.update(dt, (p) => this.lightAt(p));
    this.mats.update(st.time);
    run.physics.syncMeshes();
    run.ghost?.update(st.time, this.save.settings.showGhost && !st.ended);
    this.updateAudio(dt);

    // HUD
    const rem = st.clock.remaining;
    const ep = edgePulse(rem);
    let edge = st.clock.doorShut ? 0 : ep.amp * (0.55 + 0.45 * Math.sin(this.time * Math.PI * 2 * ep.hz));
    if (st.health < 40) edge = Math.max(edge, (1 - st.health / 40) * 0.5 * (0.7 + 0.3 * Math.sin(this.time * 6)));
    this.hud.update(dt, this.hudState(), edge);
    this.hud.dial.update(st.clock, this.time, this.camDark);
    this.revealT -= dt;
    if (this.revealT <= 0) {
      this.revealT = 0.25;
      this.map.reveal(pl.pos.x, pl.pos.z, run.scenes.current);
    }
    this.map.update(dt, pl.pos.x, pl.pos.z, pl.yaw, run.scenes.current);
  }

  private gatherSconces(run: Run) {
    const list: { id: string; pos: THREE.Vector3; radius: number; prop: Sconce }[] = [];
    run.scenes.forEachProp((p) => {
      if (p instanceof Sconce && p.lit) list.push({ id: p.id, pos: p.pos, radius: p.radius, prop: p });
    });
    this.litSconces = list;
  }

  /** 0..1 light at a point, for dust: fire anywhere, plus daylight outside zone C. */
  private lightAt(p: THREE.Vector3): number {
    const run = this.run;
    if (!run) return 0;
    let best = 0;
    const r = run.state.torch.radius;
    if (r > 0) best = Math.max(best, 1 - p.distanceTo(run.torch.flamePos) / r);
    for (const s of this.litSconces) best = Math.max(best, 1 - p.distanceTo(s.pos) / s.radius);
    if (!this.camDark && !isDarkScene(sceneAt(p, null))) best = Math.max(best, this.camEnv === 'outdoor' ? 0.25 + 0.6 * Math.min(1, this.atmo.sunIntensity / 3) : 0.3);
    return Math.max(0, Math.min(1, best));
  }

  private updateWind(dt: number) {
    const run = this.run!;
    const pl = run.player;
    this.inWind = run.scenes.winds.some((w) => w.box.containsPoint(pl.pos));
    // gusts: a slow swell every few seconds; the start of each one can blow out the torch
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = 3.5 + Math.random() * 5;
      this.gustPhase = 1;
      if (this.inWind) {
        let s = 0;
        for (const w of run.scenes.winds) if (w.box.containsPoint(pl.pos)) s = Math.max(s, w.strength);
        this.pendingGusts.push(Math.min(1, (s / 6) * (0.6 + Math.random() * 0.5)));
        this.sfx.play('whoosh', pl.pos.clone().add(new THREE.Vector3(3, 1, 0)), 0.6, 0.6);
      }
    }
    if (this.gustPhase > 0) this.gustPhase = Math.max(0, this.gustPhase - dt / 1.8);
    const target = this.gustPhase > 0 ? Math.sin(this.gustPhase * Math.PI) : 0;
    this.gust += (target - this.gust) * Math.min(1, dt * 4);
    if (this.inWind && !this.windLoop) this.windLoop = this.sfx.loop('wind', null, 0.5);
    if (!this.inWind && this.windLoop) {
      this.windLoop.stop();
      this.windLoop = null;
    }
    this.windLoop?.setGain(0.25 + this.gust * 0.6);
  }

  private updateAudio(dt: number) {
    const run = this.run!;
    const st = run.state;
    this.audio.updateListener(this.camera);
    const scene = run.scenes.current;
    const env: AmbEnv = scene === 'jungle' ? 'jungle' : scene === 'courtyard' ? 'courtyard' : scene === 'cliffs' ? 'cliffs' : this.camDark ? 'dungeon' : 'interior';
    this.amb.env = env;
    this.amb.night = this.atmo.night;
    const rem = st.clock.remaining;
    this.amb.dusk = rem <= 0 ? 1 : rem < 180 ? 1 - rem / 180 : 0;
    this.amb.windStrength = this.inWind ? this.gust : 0;
    const riverDist = scene === 'jungle' ? Math.abs(this.camera.position.z - RIVER_Z) : 200;
    this.amb.update(dt, this.camera.position, riverDist);
    this.audio.setReverb(env === 'dungeon' ? 0.45 : env === 'interior' ? 0.28 : 0.04);
    this.music.tension = rem <= 0 ? 1 : rem <= 60 ? 0.85 : rem <= 120 ? 0.35 : 0;
    this.chaseSmooth += (run.director.chase - this.chaseSmooth) * Math.min(1, dt * (run.director.chase > this.chaseSmooth ? 3 : 0.4));
    this.music.chase = this.chaseSmooth;
    this.music.underground = this.camDark;
    this.music.update();
    // heartbeat when a waking guardian is close
    const hb = heartbeat(run.director.nearestDist);
    this.beatT -= dt;
    if (hb.bpm > 0 && this.beatT <= 0 && !st.ended) {
      this.beatT = 60 / hb.bpm;
      this.sfx.play('heartbeat', null, hb.volume);
    }
  }

  // ---------------------------------------------------------------------------
  // actions and interaction

  private handleActions(dt: number) {
    const run = this.run!;
    const pl = run.player;
    const st = run.state;
    const inp = this.input;
    if (pl.mode === 'dead' || pl.mode === 'frozen') return;
    this.kickCd = Math.max(0, this.kickCd - dt);
    // torch
    if (inp.pressed('torch')) {
      if (st.torch.lit) {
        this.onTorchEvents(st.torch.snuff());
        this.sfx.play('torchOut', run.torch.flamePos, 0.4);
      } else if (!st.torch.isRelighting) {
        const ev = st.torch.startRelight(pl.torchSubmerged);
        this.onTorchEvents(ev);
        if (ev.some((e) => e.type === 'relightStart')) this.noise(pl.pos, 0.25, 'voice', true);
      }
    }
    if (inp.pressed('refuel')) {
      const ev = st.torch.useOilFlask();
      if (!ev.length) this.toast(st.torch.oilFlasks <= 0 ? 'No oil flasks left.' : 'The torch is already full.', 'info', 2);
      this.onTorchEvents(ev);
    }
    // satchel selection
    const n = st.satchel.items.length;
    if (n > 0) {
      if (inp.pressed('cycleNext')) this.selected = (this.selected + 1) % n;
      if (inp.pressed('cyclePrev')) this.selected = (this.selected - 1 + n) % n;
    }
    this.selected = Math.max(0, Math.min(this.selected, Math.max(0, n - 1)));
    if (inp.pressed('pull')) this.pullSelected();
    // grab / throw / drop
    if (inp.pressed('grab')) {
      if (pl.held) pl.release(true);
      else if (st.torch.isRelighting) this.toast('Both hands are busy with the flint.', 'info', 2);
      else if (this.lookObj) pl.grab(this.lookObj.body);
    }
    if (inp.pressed('drop') && pl.held) pl.release(false);
    // kick
    if (inp.pressed('kick') && this.kickCd <= 0) this.kick();
  }

  private kick() {
    const run = this.run!;
    const pl = run.player;
    if (!run.state.stamina.spend(8)) {
      this.toast('Too winded to kick.', 'info', 1.5);
      return;
    }
    this.kickCd = 0.6;
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = pl.lookDir(new THREE.Vector3());
    // aim a little low: kicks land at knee height
    const from = new THREE.Vector3(pl.pos.x, pl.feetY + 0.7, pl.pos.z);
    const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    let hit = run.physics.raycast(from, flat, 1.6, groups(G.PLAYER, G.STATIC | G.PROP), pl.collider);
    if (!hit) hit = run.physics.raycast(eye, dir, 1.8, groups(G.PLAYER, G.STATIC | G.PROP), pl.collider);
    pl.dip(0.05);
    if (hit) {
      const owner = run.physics.ownerOf(hit.collider);
      if (owner?.kind === 'breakable') {
        (owner.wall as BreakableWall).kick();
        return;
      }
      const b = hit.collider.parent();
      if (b && b.isDynamic()) {
        const m = b.mass();
        const k = Math.min(m, 40) * 4.5;
        b.applyImpulseAtPoint({ x: flat.x * k, y: 1.2 + k * 0.15, z: flat.z * k }, { x: hit.point.x, y: hit.point.y, z: hit.point.z }, true);
        this.sfx.play('kick', hit.point, 0.8);
        this.noise(hit.point, 0.5, 'kick', true);
        return;
      }
      this.sfx.play('kick', hit.point, 0.6, 0.8);
      this.noise(hit.point, 0.35, 'kick', true);
      return;
    }
    if (this.target && this.target.prompt()?.startsWith('V')) this.target.interact();
    else this.sfx.play('whoosh', null, 0.3, 1.5);
  }

  private updateInteraction(dt: number) {
    const run = this.run!;
    const pl = run.player;
    const inp = this.input;
    if (pl.mode === 'dead' || pl.mode === 'frozen') {
      this.hud.setPrompt(null);
      return;
    }
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    // loose object under the crosshair
    this.lookObj = null;
    const hit = run.physics.raycast(eye, dir, 2.7, groups(G.PLAYER, G.STATIC | G.PROP), pl.collider, pl.held?.body);
    if (hit) {
      const b = hit.collider.parent();
      if (b && b.isDynamic()) this.lookObj = run.relics.ofBody(b) ?? null;
    }
    // best interactable along the view
    let best: Interactable | null = null;
    let bestScore = Infinity;
    let info: Interactable | null = null;
    let infoScore = Infinity;
    const v = new THREE.Vector3();
    run.scenes.forEachInteractable((it) => {
      v.subVectors(it.position, eye);
      const d = v.length();
      const reach = it.reach ?? 2.2;
      if (d > reach) return;
      const along = v.dot(dir);
      if (along < 0.05) return;
      const lateral = Math.sqrt(Math.max(0, d * d - along * along));
      if (lateral > Math.max(0.5, d * 0.36)) return;
      const p = it.prompt();
      if (!p) return;
      const score = lateral + d * 0.2;
      const actionable = /^(E|Hold E|V)\s/.test(p);
      if (actionable && score < bestScore) {
        best = it;
        bestScore = score;
      } else if (!actionable && score < infoScore) {
        info = it;
        infoScore = score;
      }
    });
    // line of sight for the winner (a wall between you and a lever does not count)
    const los = (it: Interactable | null) => {
      if (!it) return null;
      const to = it.position.clone().sub(eye);
      const d = to.length();
      const h = run.physics.raycast(eye, to.normalize(), d, groups(G.PLAYER, G.STATIC), pl.collider);
      if (!h || h.toi >= d - 0.45) return it;
      // the ray struck something: fine if that something is the object the anchor sits in
      return h.point.distanceTo(it.position) <= (it.losSlack ?? 0.9) ? it : null;
    };
    this.target = los(best);
    this.infoTarget = los(info);

    // what E does, in priority order
    const t = this.target as Interactable | null;
    const look = this.lookObj;
    const heldRelic = this.heldRelic();
    let prompt: string | null = null;
    if (t) prompt = t.prompt();
    else if (look && !pl.held) {
      const rec = look.rec;
      if (rec.inst) {
        const r = RELICS[rec.inst.type];
        prompt = `${r.name}  ${formatMoney(rec.inst.value)}  ${r.weight} kg\nE  stash in satchel    F / click  pick up`;
      } else prompt = `${rec.label}\nF / click  pick up`;
    } else if (pl.held) {
      prompt = heldRelic ? 'E  stash it    click  throw    Q / right click  drop' : 'click  throw    Q / right click  drop';
    }
    const extra = this.infoTarget && this.infoTarget !== t ? this.infoTarget.prompt() : null;
    if (extra && (!prompt || !t)) prompt = prompt ? `${prompt}\n${extra}` : extra;
    this.hud.setCrosshair(!!t || !!look);

    // E: press, hold, repeat
    let progress = 0;
    if (t && t.holdTime && t.holdTime > 0) {
      if (inp.isHeld('interact')) {
        if (this.holdTarget !== t) {
          this.holdTarget = t;
          this.holdT = 0;
          this.holdFired = false;
        }
        if (!this.holdFired) {
          this.holdT += dt;
          progress = Math.min(1, this.holdT / t.holdTime);
          if (this.holdT >= t.holdTime) {
            t.interact();
            if (t.repeat) this.holdT = 0;
            else this.holdFired = true;
          }
        }
      } else {
        this.holdTarget = null;
        this.holdT = 0;
        this.holdFired = false;
      }
    } else if (inp.pressed('interact')) {
      if (t) t.interact();
      else if (heldRelic) this.stash(heldRelic);
      else if (look) {
        if (look.rec.inst) this.stash(look);
        else this.toast(`${look.rec.label}: pick it up with F or a click.`, 'info', 2);
      }
    }
    if (!t || !t.holdTime) {
      this.holdTarget = null;
      this.holdT = 0;
    }
    this.hud.setPrompt(prompt, progress);
  }

  private hudState(): HudState {
    const run = this.run!;
    const st = run.state;
    const items = st.satchel.byDensity();
    const held = run.player.held;
    const heldLive = held ? run.relics.ofBody(held.body) : undefined;
    const keys: string[] = [];
    if (st.unlock.items.has('sunDisc')) keys.push('Sun-Disc');
    if (st.unlock.items.has('serpentKey')) keys.push('Serpent Key');
    const heldVal = heldLive?.rec.inst?.value ?? 0;
    return {
      health: st.health / 100,
      stamina: st.stamina.fraction,
      exhausted: st.stamina.exhausted,
      weight: st.satchel.weight,
      capacity: st.satchel.capacity,
      heldMass: held?.mass ?? 0,
      fuel: st.torch.fuelFraction,
      torchLit: st.torch.lit,
      relighting: st.torch.isRelighting,
      spareTorches: st.torch.spareTorches,
      oilFlasks: st.torch.oilFlasks,
      ropes: st.ropes,
      keys,
      carried: st.satchel.value + heldVal,
      banked: st.ledger.bankedValue,
      items: items.map((i) => ({ label: RELICS[i.type].name, value: i.value, weight: i.weight })),
      selected: this.selected,
      heldLabel: heldLive ? (heldLive.rec.inst ? `${heldLive.rec.label} (${formatMoney(heldVal)})` : heldLive.rec.label) : null,
    };
  }

  // ---------------------------------------------------------------------------
  // scene entry

  private onEnterScene(id: SceneId, prev: SceneId | null) {
    const run = this.run;
    if (!run) return;
    const info = SCENE_INFO[id];
    const zoneText = info.zone === 'A' ? 'Zone A · the surface' : info.zone === 'B' ? 'Zone B · the temple' : 'Zone C · beneath';
    if (!run.state.scenesVisited.has(id) || prev === null) this.hud.zoneBanner(info.name, zoneText);
    run.state.scenesVisited.add(id);
    if (id === 'halls' && !this.firstHallsHint && !run.state.torch.lit) {
      this.firstHallsHint = true;
      this.toast('It is dim inside. T lights your torch (it takes a moment).', 'info', 6);
    }
    if (isDarkScene(id) && !this.firstDarkHint) {
      this.firstDarkHint = true;
      this.toast('No sky down here. Only the sundial and the ticking tell the time.', 'warn', 6);
    }
  }

  // ---------------------------------------------------------------------------
  // debug

  private debugInfo(): DebugInfo {
    const run = this.run;
    const info = this.renderer?.gl.info;
    const pl = run?.player;
    const st = run?.state;
    return {
      fps: this.fps,
      frameMs: this.frameMs,
      worstMs: this.worstMs,
      updateMs: this.updMs,
      renderMs: this.rndMs,
      physicsMs: run?.physics.stepTime ?? 0,
      bodies: run?.physics.bodyCount ?? 0,
      colliders: run?.physics.colliderCount ?? 0,
      scene: run?.scenes.current ?? '-',
      loaded: run ? run.scenes.loadedIds.map((id) => (run.scenes.isReady(id) ? id : id + '*')) : [],
      pending: run?.scenes.pending ?? 0,
      buildMs: run?.scenes.buildMs ?? 0,
      calls: info?.render.calls ?? 0,
      triangles: info?.render.triangles ?? 0,
      programs: info?.programs?.length ?? 0,
      geometries: info?.memory.geometries ?? 0,
      textures: info?.memory.textures ?? 0,
      props: run?.scenes.propCount ?? 0,
      guardians: run ? run.director.guardians.map((g) => `${g.kind.padEnd(8)} ${g.spawn.padEnd(11)} ${String(g.state).padEnd(11)} ${g.pos.distanceTo(run.player.pos).toFixed(1)} m`) : [],
      pos: pl ? [pl.pos.x, pl.feetY, pl.pos.z] : [0, 0, 0],
      mode: pl ? `${pl.mode}${pl.crouching ? ' crouch' : ''}${pl.sprinting ? ' sprint' : ''}${pl.grounded ? '' : ' air'}` : '-',
      remaining: st?.clock.remaining ?? 0,
      torch: st ? `${st.torch.lit ? 'lit' : 'out'} r=${st.torch.radius.toFixed(1)} fuel=${st.torch.fuel.toFixed(0)}` : '-',
      light: `camera env ${this.camEnv}${this.camDark ? ' (zone C rules)' : ''}`,
      seed: st?.seed ?? 0,
    };
  }

  private installDebugApi() {
    const game = this;
    const api = {
      game,
      THREE,
      state: () => {
        const run = game.run;
        if (!run) return { state: game.state };
        const st = run.state;
        return {
          state: game.state,
          scene: run.scenes.current,
          loaded: run.scenes.loadedIds,
          ready: run.scenes.loadedIds.filter((i) => run.scenes.isReady(i)),
          pos: run.player.pos.toArray(),
          feet: run.player.feet.toArray(),
          mode: run.player.mode,
          remaining: st.clock.remaining,
          health: st.health,
          stamina: st.stamina.value,
          carried: st.satchel.value,
          banked: st.ledger.bankedValue,
          satchel: st.satchel.items.map((i) => i.type),
          torch: { lit: st.torch.lit, fuel: st.torch.fuel, radius: st.torch.radius },
          flags: [...st.unlock.flags],
          items: [...st.unlock.items],
          guardians: run.director.guardians.map((g) => ({ kind: g.kind, spawn: g.spawn, state: g.state, pos: g.pos.toArray() })),
          ended: st.ended,
          endReason: st.endReason,
          camDark: game.camDark,
          fps: game.fps,
        };
      },
      start: (seed?: number) => game.beginRun(seed),
      fps: () => game.fps,
      frameMs: () => game.frameMs,
      speed: (k: number) => {
        game.timeScale = Math.max(0.1, Math.min(8, k));
      },
      cpu: () => ({ updateMs: game.updMs, renderMs: game.rndMs, info: game.debugInfo() }),
      setTime: (secondsLeft: number) => game.run?.state.clock.setRemaining(secondsLeft),
      advance: (s: number) => {
        const run = game.run;
        if (!run) return;
        for (const ev of run.state.clock.advance(s)) game.onClock(ev);
      },
      teleport: (where: SceneId | [number, number, number], yaw?: number) => {
        const run = game.run;
        if (!run) return;
        let p: THREE.Vector3;
        if (Array.isArray(where)) p = new THREE.Vector3(...where);
        else {
          const r = SCENES[where].respawn;
          p = r ? new THREE.Vector3(...r) : new THREE.Vector3(0, 0, 0);
        }
        run.player.teleport(p, yaw);
        run.scenes.update(run.player.pos, 0, 0);
        run.scenes.finishAll();
      },
      finishLoading: () => game.run?.scenes.finishAll(),
      look: (yaw: number, pitch = 0) => {
        const pl = game.run?.player;
        if (!pl) return;
        pl.yaw = yaw;
        pl.pitch = pitch;
      },
      move: (x: number, y: number) => game.input.setMove(x, y),
      stop: () => game.input.clearForced(),
      press: (a: Parameters<Input['inject']>[0], hold = false) => game.input.inject(a, hold),
      release: (a: Parameters<Input['release']>[0]) => game.input.release(a),
      give: (item: string) => {
        const run = game.run;
        if (!run) return;
        if (item === 'sunDisc' || item === 'serpentKey') run.state.unlock.items.add(item);
        else if (item === 'money') {
          game.save.money += 20000;
          game.persist();
        } else if (item === 'oil') run.state.torch.oilFlasks += 3;
        else if (item === 'torch') run.state.torch.spareTorches += 3;
        else if (item === 'rope') run.state.ropes += 2;
      },
      flag: (f: Flag) => game.setFlag(f),
      light: () => {
        const run = game.run;
        if (!run) return;
        run.state.torch.relighting = 0;
        run.state.torch.lit = true;
      },
      snuff: () => {
        const run = game.run;
        if (run) run.state.torch.snuff();
      },
      god: (on = true) => {
        game.god = on;
      },
      noGuardians: () => {
        if (game.run) game.run.director.enabled = false;
      },
      quality: (q: Settings['quality']) => game.applySettings({ ...game.save.settings, quality: q }),
      /** Count lit pixels in the WebGL canvas (must be 0 in zone C with no fire). */
      litPixels: () => {
        game.renderer.render(game.scene, game.camera, game.time);
        const px = game.renderer.readPixels();
        let lit = 0;
        let max = 0;
        for (let i = 0; i < px.length; i += 4) {
          const m = Math.max(px[i], px[i + 1], px[i + 2]);
          if (m > 0) lit++;
          if (m > max) max = m;
        }
        return { lit, max, total: px.length / 4 };
      },
    };
    (window as any).lostTemple = api;
  }
}
