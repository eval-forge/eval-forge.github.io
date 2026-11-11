import * as THREE from 'three';
import { Physics, RAPIER } from '../world/Physics';
import { TextureBank } from '../world/Textures';
import { Materials } from '../world/Materials';
import { SkyLighting } from '../world/SkyLighting';
import { SCENES, SCENE_BY_ID, NAV_POLYS, sceneAt } from '../world/layout';
import { buildStatic, attachScene, detachScene, type BuiltScene, type AttachedScene, type SceneDef } from '../world/SceneBase';
import { inAABB, type ClimbVolume, type WaterVolume } from '../world/LevelBuilder';
import { JUNGLE_START } from '../world/scenes/jungle';
import { PropSystem, type Prop } from '../entities/Props';
import { PlayerTorch, SconceLights } from '../entities/Torch';
import { Player } from '../entities/Player';
import { GuardianSystem, type NoiseEvent } from '../entities/Guardians';
import { AudioSystem } from '../audio/Audio';
import { Input } from './Input';
import { RunState } from './RunState';
import { loadProfile, saveProfile, type Profile } from './Save';
import type { SceneCtx, Interactable } from './types';
import { Hud } from '../ui/Hud';
import { MapView } from '../ui/MapView';
import { Menus, type MenuHost } from '../ui/Menus';
import { NavMesh } from '../logic/navmesh';
import { neighbours, nextObjective, type Flag } from '../logic/unlocks';
import {
  DAY_LENGTH, DOOR_CLOSE_TIME, crossedThresholds, tickInterval, tickVolume,
} from '../logic/countdown';
import {
  RELIC_BY_ID, SCENE_ZONE, relicValue, canCarry, speedMultiplier, staminaDrainMultiplier, gearStats, bankedHaul, insertScore,
  type SceneId, type RunOutcome,
} from '../logic/economy';
import {
  torchRadius, burn, submerged, windBlowsOut, fallBlowsOut, extinguish, canRelight, startRelight, tickRelight, addFuel,
  OIL_FLASK_FUEL, SPARE_TORCH_FUEL, SCONCE_RADIUS, RELIGHT_TIME,
} from '../logic/torch';
import { fallDamage } from '../logic/traps';
import { clamp } from '../logic/vec';

const STEP = 1 / 60;
const BODY_MASS = 75;
const SHADOWS = { low: [1024, 256], medium: [2048, 512], high: [4096, 1024] } as const;

/** Debug teleport spots (feet positions). */
const TP: Record<SceneId, [number, number, number, number]> = {
  jungle: [JUNGLE_START.x, JUNGLE_START.y, JUNGLE_START.z, 0],
  courtyard: [0, 0.3, 30, 0],
  cliffs: [58, 0.6, 40, -Math.PI / 2],
  halls: [0, 0.3, 0, 0],
  sanctum: [0, 0.3, -70, 0],
  catacombs: [-8, -11.7, -125, 0],
  vault: [0, -19.7, -195, 0],
};

const MAP_LABELS = [
  { x: 0, z: 200, y: 0, text: 'Camp' }, { x: 0, z: 157, y: 0, text: 'River' }, { x: 0, z: 118, y: 0, text: 'Gorge bridge' },
  { x: 0, z: 40, y: 0, text: 'Courtyard' }, { x: 0, z: 56, y: 0, text: 'Sundial' }, { x: 0, z: 11, y: 0, text: 'Great Door' },
  { x: 58, z: 50, y: 0, text: 'Cliff path' }, { x: 101, z: 38, y: 7, text: 'Spire' },
  { x: 0, z: -4, y: 0, text: 'Vestibule' }, { x: 0, z: -30, y: 0, text: 'Sun-tile pit' }, { x: 21, z: -30, y: 0, text: 'Boulder aisle' },
  { x: 8, z: -55, y: 0, text: 'North hall' }, { x: -21, z: -35, y: 0, text: 'West wing' }, { x: 0, z: -80, y: 0, text: 'Sanctum' },
  { x: -10, z: -104, y: 0, text: 'Seal' },
  { x: -8, z: -125, y: -12, text: 'Ossuary' }, { x: -4, z: -142, y: -12, text: 'Crumbling floor' }, { x: -2, z: -158, y: -12, text: 'Junction' },
  { x: 15, z: -155, y: -12, text: 'Darts' }, { x: 34, z: -150, y: -13, text: 'Flooded chamber' }, { x: -17, z: -155, y: -12, text: 'Blades' },
  { x: -31, z: -158, y: -12, text: 'Reliquary' }, { x: -27, z: -110, y: -12, text: 'Servants’ passage' }, { x: 0, z: -182, y: -12, text: 'Vault door' },
  { x: 0, z: -200, y: -20, text: 'Vault' }, { x: 24, z: -204, y: -20, text: 'Lair' }, { x: -24, z: -201, y: -20, text: 'Drawbridge' },
];

type Mode = 'menu' | 'play' | 'pause' | 'results';

export class Game implements SceneCtx, MenuHost {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  physics = new Physics();
  tex = new TextureBank();
  mats: Materials;
  props: PropSystem;
  sconces: SconceLights;
  player: Player;
  audio = new AudioSystem();
  input: Input;
  sky!: SkyLighting;
  torchFx!: PlayerTorch;
  guardians: GuardianSystem;
  nav = new NavMesh(NAV_POLYS);
  hud = new Hud();
  map = new MapView();
  menus: Menus;
  profile: Profile = loadProfile();
  mode: Mode = 'menu';

  private runState: RunState;
  private built = new Map<SceneId, BuiltScene>();
  private attached = new Map<SceneId, AttachedScene>();
  private unneededFor = new Map<SceneId, number>();
  private current: SceneDef = SCENE_BY_ID.jungle;
  private clock = 0;
  private acc = 0;
  private noises: NoiseEvent[] = [];
  private shakeAmt = 0;
  private nextTick = 0;
  private groundCol: RAPIER.Collider | null = null;
  private lastHurt = -10;
  private gustT = 3;
  private streamT = 0;
  private sampleT = 0;
  private outdoorSmooth = 1;
  private ambientSmooth = 1;
  private target: { prop?: Prop; inter?: Interactable } = {};
  private promptText: string | null = null;
  private pauseAt = 0;
  private debugOn = false;
  private fps = { frames: 0, t: 0, value: 0, worst: 0, frameMax: 0 };
  private ghost: THREE.Group;
  private ghostT = 0;
  private wasLocked = false;
  private lastFrame = performance.now();
  private realDt = 1 / 60;
  private quality: Profile['settings']['quality'];
  /** Per-scene FPS samples gathered while playing (for the self review). */
  fpsByScene: Record<string, { sum: number; n: number; min: number }> = {};

  constructor() {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    this.quality = this.profile.settings.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(this.profile.settings.fov, innerWidth / innerHeight, 0.05, 600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.scene.background = new THREE.Color(0x000000);
    this.input = new Input(canvas);
    this.mats = new Materials(this.tex);
    this.props = new PropSystem(this.scene, this.physics, this.mats, () => this.runState);
    this.sconces = new SconceLights(this.scene, this.tex);
    this.runState = new RunState(1, gearStats(this.profile.upgrades));
    this.player = new Player(this.physics, this.input, this.playerEnv());
    this.player.collider.setCollisionGroups((0x0002 << 16) | 0xffff);
    this.guardians = new GuardianSystem(this, this.nav);
    this.guardians.caught = (kind) => this.endRun('caught', kind === 'shade' ? 'a shade found you in the dark' : kind === 'crawler' ? 'a crawler dragged you down' : 'a stone sentinel crushed you');
    this.menus = new Menus(this);
    this.props.onImpact = (p, sp) => {
      const t = p.body.translation();
      const pos = new THREE.Vector3(t.x, t.y, t.z);
      this.audio.play(p.def.kind === 'relic' ? 'clunk' : 'thud', pos, Math.min(1, sp / 10));
      this.noise(pos, 6 + sp * 1.5);
    };
    const gm = new THREE.MeshBasicMaterial({ color: 0x9ad8ff, transparent: true, opacity: 0.22, depthWrite: false });
    this.ghost = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.0, 4, 10), gm);
    body.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), gm);
    head.position.y = 1.65;
    this.ghost.add(body, head);
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    this.input.onLockChange = (locked) => {
      if (locked) this.wasLocked = true;
      else if (this.mode === 'play' && this.wasLocked && !this.map.open) this.pause();
    };
    canvas.addEventListener('click', () => {
      this.audio.init();
      if (this.mode === 'play' && !this.input.locked) this.input.requestLock();
    });
    addEventListener('resize', () => this.resize());
  }

  // ------------------------------------------------------------------ boot

  async boot(status: (s: string) => void) {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    status('Weathering the stone…'); await frame();
    this.tex.generate(this.quality);
    const [sun, torch] = SHADOWS[this.quality];
    this.sky = new SkyLighting(this.scene, sun);
    this.torchFx = new PlayerTorch(this.scene, this.camera, this.mats, this.tex, torch);
    for (const def of SCENES) {
      status(`Raising ${def.name}…`); await frame();
      this.built.set(def.id, buildStatic(def, this.mats));
    }
    this.applySettings();
    this.resize();
    // attract mode: the camp, frozen behind the main menu
    this.resetWorld(1);
    this.updateStreaming(true);
    status('Lighting the torch…'); await frame();
    this.renderer.compile(this.scene, this.camera);
    document.getElementById('loading')!.style.display = 'none';
    this.menus.main();
    this.loop();
    if (new URLSearchParams(location.search).has('debug')) { this.debugOn = true; (window as any).__game = this; }
  }

  private resize() {
    const s = this.profile.settings;
    const pr = s.quality === 'low' ? 0.75 : s.quality === 'medium' ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  applySettings() {
    const s = this.profile.settings;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.input.sensitivity = s.sensitivity;
    this.audio.volumes.master = s.master; this.audio.volumes.music = s.music; this.audio.volumes.sfx = s.sfx;
    this.audio.applyVolumes();
    if (this.sky && s.quality !== this.quality) {
      this.quality = s.quality;
      const [sun, torch] = SHADOWS[s.quality];
      this.sky.setShadowSize(sun);
      this.torchFx.setShadowSize(torch);
      this.resize();
    }
  }

  uiClick() { this.audio.init(); this.audio.play('click', null, 0.5); }

  // ------------------------------------------------------------------ run lifecycle

  private resetWorld(seed: number) {
    for (const a of this.attached.values()) detachScene(a, this, this.physics);
    this.attached.clear();
    this.unneededFor.clear();
    this.props.clear();
    this.runState = new RunState(seed, gearStats(this.profile.upgrades));
    this.current = SCENE_BY_ID.jungle;
    this.player.teleport(JUNGLE_START.clone(), 0);
    this.player.pitch = 0;
    this.guardians.reset();
    this.noises = [];
    this.nextTick = 0;
    this.ghostT = 0;
    this.lastHurt = -10;
    this.outdoorSmooth = 1;
  }

  startRun() {
    this.audio.init();
    this.resetWorld((Math.random() * 1e9) | 0);
    this.updateStreaming(true);
    this.runState.scenesVisited.add('jungle');
    this.menus.hide();
    this.hud.show(true);
    this.mode = 'play';
    this.input.enabled = true;
    this.input.requestLock();
    this.hud.message('Dawn. Thirteen minutes of light. Find the temple, take what you can, and get out before the door seals.', 6);
  }

  pause() {
    if (this.mode !== 'play') return;
    this.mode = 'pause';
    this.pauseAt = this.clock;
    this.map.toggle(false);
    this.input.exitLock();
    this.menus.pause();
  }

  resume() {
    if (this.mode !== 'pause') return;
    this.menus.hide();
    this.mode = 'play';
    this.lastFrame = performance.now();
    this.input.requestLock();
  }

  abandon() {
    if (this.mode !== 'pause') return;
    this.endRun('killed', 'abandoned the expedition');
  }

  endRun(outcome: RunOutcome, cause = '') {
    if (this.mode !== 'play' && this.mode !== 'pause') return;
    const run = this.runState;
    run.outcome = outcome;
    run.deathCause = cause;
    if (this.props.held) this.props.release();
    const banked = bankedHaul(outcome, run.carried);
    const p = this.profile;
    p.bank += banked;
    p.runs++;
    const relics = run.carried.filter((c) => RELIC_BY_ID[c.relicId]?.rarity !== 'key').length;
    const { table, rank } = insertScore(p.scores, { value: banked, outcome, time: Math.round(run.elapsed), relics, date: new Date().toISOString().slice(0, 10) });
    p.scores = table;
    let newGhost = false;
    if (outcome === 'escaped' && banked >= p.ghostValue && run.ghost.length > 8) { p.ghost = run.ghost.slice(); p.ghostValue = banked; newGhost = true; }
    saveProfile(p);
    this.mode = 'results';
    this.map.toggle(false);
    this.hud.show(false);
    this.input.exitLock();
    this.audio.play(outcome === 'escaped' ? 'win' : outcome === 'caught' ? 'scream' : 'collapse', null, 0.9);
    this.audio.critical = false; this.audio.night = false;
    this.menus.results({ outcome, cause, carried: run.carried.slice(), banked, time: run.elapsed, rank, scenes: run.scenesVisited.size, newGhost });
  }

  // ------------------------------------------------------------------ SceneCtx

  run() { return this.runState; }
  time() { return this.clock; }
  remaining() { return DAY_LENGTH - this.runState.elapsed - this.runState.dayPenalty; }
  isNight() { return this.remaining() <= 0; }
  sunlit(p: THREE.Vector3): boolean {
    if (this.isNight() || this.sky.sunDir.y < 0.05) return false;
    const s = sceneAt(p);
    if (!s || s.exposure(p).outdoor <= 0) return false;
    const hit = this.physics.raycast(p, this.sky.sunDir, 120, null, (c) => {
      const k = this.physics.infoOf(c)?.kind;
      return k === 'static' || k === 'gate';
    });
    return !hit;
  }
  damage(amount: number, cause: string, knock?: THREE.Vector3) {
    if (this.mode !== 'play') return;
    const r = this.runState;
    if (amount < 30 && r.elapsed - this.lastHurt < 0.35) return; // brief grace so a dart volley can't stack-kill
    r.health -= amount;
    this.lastHurt = r.elapsed;
    this.hud.hurt();
    this.shake(Math.min(0.5, amount / 60));
    this.audio.play('hurt', null, 0.8);
    if (knock) this.player.external.add(knock);
    if (r.health <= 0) this.kill(cause);
  }
  kill(cause: string) { this.runState.health = 0; this.endRun('killed', cause); }
  noise(p: THREE.Vector3, radius: number) {
    this.noises.push({ pos: p.clone(), radius });
    const debris = (this as any).sanctumDebris;
    if (debris && this.current.id === 'sanctum' && p.distanceTo(this.player.feet) < 30) debris.addNoise(radius * 0.012);
  }
  message(text: string, seconds?: number) { this.hud.message(text, seconds); }
  shake(amount: number) { this.shakeAmt = Math.max(this.shakeAmt, amount); }
  groundCollider() { return this.groundCol; }
  setFlag(f: Flag) { this.runState.flags[f] = true; }
  playerMass() { return BODY_MASS + this.runState.carriedWeight + (this.props.held ? this.props.held.mass : 0); }
  currentScene() { return this.current.id; }
  playerCenter() { return this.player.center; }
  torchLit() { return this.runState.torch.lit; }
  escape() {
    if (this.mode !== 'play') return;
    this.endRun('escaped');
  }

  // ------------------------------------------------------------------ player environment

  private playerEnv() {
    const g = this;
    return {
      climbs: (): ClimbVolume[] => { const out: ClimbVolume[] = []; for (const a of g.attached.values()) out.push(...a.built.builder.climbs); return out; },
      waters: (): WaterVolume[] => { const out: WaterVolume[] = []; for (const a of g.attached.values()) out.push(...a.built.builder.waters); return out; },
      speedMult: () => speedMultiplier(g.loadWeight(), g.runState.gear.satchelCapacity),
      staminaDrainMult: () => staminaDrainMultiplier(g.loadWeight(), g.runState.gear.satchelCapacity),
      climbMult: () => g.runState.gear.climbSpeedMult,
      maxStamina: () => g.runState.gear.maxStamina,
      stamina: { get: () => g.runState.stamina, set: (v: number) => { g.runState.stamina = v; } },
      canAct: () => g.mode === 'play',
      ignoreCollider: (c: RAPIER.Collider) => !!g.props.held && c.handle === g.props.held.collider.handle,
      onLand: (h: number) => g.onLand(h),
      onStep: (loud: number, water: boolean) => {
        const f = g.player.feet;
        g.audio.play(water ? 'stepWater' : 'step', null, 0.25 + loud * 0.5);
        g.noise(f, (water ? 9 : 4) + loud * 12 * (1 + g.loadWeight() / g.runState.gear.satchelCapacity));
      },
      onJump: () => { g.audio.play('jump', null, 0.5); g.noise(g.player.feet, 7); },
      onGround: (c: RAPIER.Collider | null) => { g.groundCol = c; },
      onPush: (body: RAPIER.RigidBody, dir: THREE.Vector3) => {
        const n = body.numColliders();
        for (let i = 0; i < n; i++) {
          const p = g.props.propOf(body.collider(i));
          if (p && p.def.kind === 'block') {
            const v = body.linvel();
            const sp = 1.5 * g.player.slowFactor;
            body.setLinvel({ x: dir.x * sp, y: v.y, z: dir.z * sp }, true);
            g.runState.stamina = Math.max(0, g.runState.stamina - 6 * STEP);
            if (Math.random() < 0.06) { g.audio.play('grind', new THREE.Vector3(body.translation().x, body.translation().y, body.translation().z), 0.6); g.noise(g.player.feet, 10); }
            return true;
          }
        }
        return false;
      },
    };
  }

  private loadWeight() {
    const held = this.props.held;
    return this.runState.carriedWeight + (held && held.def.kind !== 'block' ? held.mass * 0.5 : 0);
  }

  private onLand(h: number) {
    const r = this.runState;
    if (h > 1.2) { this.audio.play('land', null, Math.min(1, h / 6)); this.noise(this.player.feet, 6 + h * 2); }
    const dmg = fallDamage(h, r.gear.safeFall);
    if (dmg > 0) this.damage(dmg, `fell ${h.toFixed(0)} m`);
    if (r.torch.lit && fallBlowsOut(h, r.gear.torchSurvivesFalls)) {
      r.torch = extinguish(r.torch);
      this.audio.play('torchOut', null, 0.8);
      this.message('The fall snuffed your torch. Press R to relight.');
    }
  }

  // ------------------------------------------------------------------ streaming

  private updateStreaming(force = false) {
    const c = this.player.center;
    const s = sceneAt(c);
    if (s && s !== this.current) {
      this.current = s;
      this.runState.scenesVisited.add(s.id);
      if (SCENE_ZONE[s.id] !== 'A') this.runState.enteredTemple = true;
    }
    const need = new Set<SceneId>([this.current.id, ...neighbours(this.current.id)]);
    for (const id of need) {
      this.unneededFor.delete(id);
      if (!this.attached.has(id)) this.attached.set(id, attachScene(SCENE_BY_ID[id], this.built.get(id)!, this, this.physics, this.runState.seed));
    }
    for (const [id, a] of this.attached) {
      if (need.has(id)) continue;
      const t = (this.unneededFor.get(id) ?? 0) + (force ? 99 : 0.25);
      this.unneededFor.set(id, t);
      if (t >= 4) {
        if (this.props.held && this.props.held.owner === id) this.props.held.owner = this.current.id;
        detachScene(a, this, this.physics);
        this.attached.delete(id);
        this.unneededFor.delete(id);
      }
    }
  }

  // ------------------------------------------------------------------ interaction

  private findTarget() {
    this.target = {};
    const eye = this.player.eye(), fwd = this.player.forward();
    const held = this.props.held;
    const hit = this.physics.raycast(eye, fwd, 3.0, this.player.collider, (c) => !held || c.handle !== held.collider.handle);
    const p = hit ? this.props.propOf(hit.collider) : null;
    if (p) { this.target.prop = p; return; }
    let best: Interactable | null = null, bestScore = Infinity;
    const c = this.player.center;
    for (const a of this.attached.values()) {
      for (const i of a.runtime.interactables) {
        const d = i.pos.distanceTo(c);
        if (d > i.radius) continue;
        if (hit && hit.distance + 0.6 < i.pos.distanceTo(eye) && d > 1.2) continue; // behind a wall
        const dir = i.pos.clone().sub(eye).normalize();
        const score = d - 1.5 * dir.dot(fwd);
        if (score < bestScore && i.prompt() !== null) { best = i; bestScore = score; }
      }
    }
    if (best) this.target.inter = best;
  }

  private propPrompt(p: Prop): string {
    const held = this.props.held;
    if (p.def.kind === 'relic') {
      const r = RELIC_BY_ID[p.def.relicId!];
      const v = relicValue(r.id, p.def.origin);
      const swap = held && held !== p ? ` · E: swap for the ${held.label.toLowerCase()}` : '';
      return `${r.name} — ${r.rarity === 'key' ? 'key item' : `${v} gold`}, ${r.weight} kg · E: take${swap ? '' : ' · F: lift'}${swap}`;
    }
    if (p.def.kind === 'oil') return 'Oil flask · E: refuel torch (+60 s)';
    if (p.def.kind === 'spare') return 'Spare torch · E: take';
    if (p.def.kind === 'block') return `Stone block (${Math.round(p.mass)} kg) · walk into it to push`;
    return `${p.label} (${p.mass.toFixed(1)} kg) · F: lift`;
  }

  private takeRelic(p: Prop, viaHand = false): boolean {
    const r = this.runState;
    const relic = RELIC_BY_ID[p.def.relicId!];
    if (!canCarry(r.carriedWeight, relic.weight, r.gear.satchelCapacity)) {
      this.audio.play('deny');
      this.message(`Your satchel can't take another ${relic.weight} kg. Drop something (Q) or buy a bigger satchel.`);
      return false;
    }
    if (viaHand && this.props.held === p) this.props.release();
    this.props.take(p);
    r.carried.push({ relicId: relic.id, value: relicValue(relic.id, p.def.origin), weight: relic.weight, foundIn: p.def.origin });
    if (relic.id === 'sundisc') this.setFlag('hasSunDisc');
    if (relic.id === 'obsidiankey') this.setFlag('hasObsidianKey');
    this.audio.play(relic.rarity === 'key' ? 'pickup' : 'coin', null, 0.8);
    this.message(relic.rarity === 'key' ? `You take the ${relic.name}.` : `${relic.name} — ${relicValue(relic.id, p.def.origin)} gold. It only counts if you carry it out.`, 2.5);
    return true;
  }

  private handleActions() {
    const inp = this.input, r = this.runState, held = this.props.held;
    const t = this.target;
    if (inp.pressed('interact')) {
      this.audio.init();
      if (held && held.def.kind === 'relic' && (!t.prop || t.prop === held)) this.takeRelic(held, true);
      else if (t.prop) {
        const p = t.prop;
        if (p.def.kind === 'relic') {
          const at = p.body.translation();
          const spot = new THREE.Vector3(at.x, at.y + 0.05, at.z);
          const swapWith = held && held !== p ? held : null;
          if (this.takeRelic(p) && swapWith) {
            // the weight swap: set the held object where the relic sat
            this.props.release();
            swapWith.body.setTranslation({ x: spot.x, y: spot.y + 0.1, z: spot.z }, true);
            swapWith.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            swapWith.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            swapWith.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
            this.message(`You swap in the ${swapWith.label.toLowerCase()}… and hold your breath.`, 2.5);
          }
        } else if (p.def.kind === 'oil') {
          this.props.take(p);
          r.torch = addFuel(r.torch, OIL_FLASK_FUEL);
          this.audio.play('pickup');
          this.message('Torch refuelled (+60 s).', 2);
        } else if (p.def.kind === 'spare') {
          this.props.take(p);
          r.spareTorches++;
          this.audio.play('pickup');
          this.message(`Spare torch (${r.spareTorches}).`, 2);
        }
      } else if (t.inter) t.inter.act();
    }
    if (inp.pressed('grab')) {
      if (held) this.props.release();
      else if (t.prop) {
        if (!this.props.grab(t.prop)) {
          this.audio.play('deny');
          this.message(t.prop.def.kind === 'block' ? 'Far too heavy to lift. Walk into it to push.' : 'Too heavy to lift.', 2);
        } else this.audio.play('pickup', null, 0.4);
      }
    }
    if (inp.pressed('throw') && held) {
      const v = this.player.vel;
      this.props.throwHeld(this.player.forward(), new THREE.Vector3(v.x, 0, v.z));
      this.audio.play('swoosh', null, 0.6);
    }
    if (inp.pressed('drop')) {
      const c = r.carried.pop();
      if (c) {
        const spot = this.player.eye().addScaledVector(this.player.forward(), 0.9);
        this.props.drop({ kind: 'relic', relicId: c.relicId, pos: [spot.x, spot.y, spot.z], origin: c.foundIn }, this.current.id, this.player.vel.clone().multiplyScalar(0.5));
        this.message(`Dropped the ${RELIC_BY_ID[c.relicId].name}.`, 2);
        this.audio.play('swoosh', null, 0.3);
      } else this.audio.play('deny', null, 0.4);
    }
    // torch
    if (inp.pressed('torch')) {
      if (r.torch.lit) { r.torch = extinguish(r.torch); this.audio.play('torchOut', null, 0.5); }
      else this.tryRelight();
    }
    if (inp.pressed('relight')) this.tryRelight();
    if (inp.pressed('map')) this.map.toggle();
    if (inp.pressed('debug')) this.debugOn = !this.debugOn;
    if (inp.pressed('pause')) this.pause();
  }

  private tryRelight() {
    const r = this.runState;
    if (r.torch.lit || r.torch.relighting > 0) return;
    const inWater = this.torchUnderwater();
    if (inWater) { this.audio.play('deny'); this.message('Get out of the water to relight.', 2); return; }
    if (r.torch.fuel <= 0) {
      if (r.spareTorches <= 0) { this.audio.play('deny'); this.message('No fuel and no spare torches. Find oil or a lit sconce.', 3); return; }
      r.spareTorches--;
      r.torch = addFuel(r.torch, SPARE_TORCH_FUEL);
      this.message('You light a spare torch.', 2);
    }
    if (canRelight(r.torch, false)) {
      r.torch = startRelight(r.torch);
      this.audio.play('relight', null, 0.7);
    }
  }

  private torchUnderwater(): boolean {
    const w = this.player.inWater;
    return submerged(w ? w.surface : null, this.player.feet.y, this.player.crouched);
  }

  // ------------------------------------------------------------------ simulation

  private step(dt: number) {
    const r = this.runState;
    const prevRem = this.remaining();
    r.elapsed += dt;
    const rem = this.remaining();

    // clock events
    for (const ph of crossedThresholds(prevRem, rem)) {
      if (ph === 'urgent') { this.message('Two minutes of daylight left. The shadows are getting long.', 4); this.audio.play('rumble', null, 0.4); }
      if (ph === 'critical') { this.audio.critical = true; this.message('ONE MINUTE. The temple begins to rumble.', 4); this.audio.play('rumble', null, 1); this.shake(0.4); }
      if (ph === 'night') { this.audio.night = true; this.message('The sun is down. Something below has woken. The great door is closing!', 5); this.audio.play('rumble', null, 1); this.shake(0.6); }
    }
    if (rem < 60 && rem > 0 && Math.random() < dt * 0.25) { this.shake(0.12); this.audio.play('rumble', null, 0.3); }
    this.nextTick -= dt;
    if (this.nextTick <= 0) { this.nextTick = tickInterval(rem); this.audio.tick(tickVolume(rem), rem <= 120); }
    if (rem <= -DOOR_CLOSE_TIME) {
      if (this.player.feet.z > 9.5 && SCENE_ZONE[this.current.id] === 'A') this.endRun('escaped');
      else this.endRun('sealed', 'the great door closed');
      return;
    }

    this.findTarget();
    this.promptText = this.target.prop ? this.propPrompt(this.target.prop) : this.target.inter ? this.target.inter.prompt() : null;
    this.handleActions();
    if (this.mode !== 'play') return;

    // torch logic
    const inWater = !!this.player.inWater;
    if (r.torch.relighting > 0) {
      r.torch = tickRelight(r.torch, dt, this.torchUnderwater());
      this.player.slowFactor = 0.55;
      if (r.torch.lit) this.audio.play('relight', null, 0.3);
    } else this.player.slowFactor = 1;
    const wasLit = r.torch.lit;
    r.torch = burn(r.torch, dt);
    if (wasLit && !r.torch.lit) {
      this.audio.play('torchOut');
      this.message(r.spareTorches > 0 ? 'Your torch burnt out. Press R to light a spare.' : 'Your torch burnt out, and you have no spares.', 4);
    }
    if (r.torch.lit && inWater && this.torchUnderwater()) {
      r.torch = extinguish(r.torch);
      this.audio.play('torchOut'); this.audio.play('splash', null, 0.6);
      this.message('The water drowned your torch. Climb out and press R.', 3);
    }
    // wind gusts on the cliffs
    const wind = this.current.wind?.(this.player.feet) ?? 0;
    if (wind > 0.3) {
      this.gustT -= dt;
      if (this.gustT <= 0) {
        this.gustT = 3 + Math.random() * 4;
        const dir = Math.random() < 0.5 ? 1 : -1;
        const k = this.player.crouched ? 0.3 : 1;
        this.player.external.add(new THREE.Vector3(0, 0, dir * wind * 4.2 * k));
        this.audio.play('gust', null, 0.5 + wind * 0.5);
        if (r.torch.lit && windBlowsOut(Math.random(), this.player.crouched, false)) {
          r.torch = extinguish(r.torch);
          this.audio.play('torchOut');
          this.message('A gust tore the flame from your torch. Crouch (C) in the wind.', 3);
        }
      }
    }

    // player, held prop, scene runtimes, physics
    this.player.update(dt);
    const holdTarget = this.player.eye().addScaledVector(this.player.forward(), 1.5);
    if (this.props.held) this.props.held.owner = this.current.id;
    this.props.update(dt, holdTarget);
    for (const a of this.attached.values()) a.runtime.update(dt);
    if (this.mode !== 'play') return;
    this.physics.step();

    // guardians
    const radius = r.torch.lit ? torchRadius(r.gear.torchRadius, r.torch.fuel, r.torch.capacity) : 0;
    const playerLit = (p: THREE.Vector3) => r.torch.lit || this.sconces.litAt(p, SCONCE_RADIUS) || (this.outdoorSmooth > 0.3 && rem > -10);
    const lightAt = (p: THREE.Vector3) => this.sconces.litAt(p, SCONCE_RADIUS) || (r.torch.lit && p.distanceTo(this.player.feet) < radius);
    this.guardians.update(dt, -rem, this.noises, { lit: r.torch.lit, radius }, playerLit, lightAt);
    this.noises.length = 0;
    if (this.mode !== 'play') return;

    // hazards
    const f = this.player.feet;
    for (const a of this.attached.values()) {
      for (const k of a.built.builder.kills) {
        if (inAABB(f, k)) { this.kill(k.cause === 'spikes' ? 'impaled on the pit spikes' : k.cause === 'abyss' ? 'fell into the abyss' : 'fell into the chasm'); return; }
      }
    }
    if (f.y < -70) { this.kill('fell into the dark'); return; }
    if (r.elapsed - this.lastHurt > 6 && r.health < 100) r.health = Math.min(100, r.health + 2 * dt);

    // periodic: streaming, ghost, exploration
    this.streamT -= dt;
    if (this.streamT <= 0) {
      this.streamT = 0.25;
      this.updateStreaming();
      this.props.rehome((p) => sceneAt(p)?.id ?? null);
    }
    this.sampleT -= dt;
    if (this.sampleT <= 0) {
      this.sampleT = 0.25;
      r.ghost.push(+f.x.toFixed(2), +f.y.toFixed(2), +f.z.toFixed(2), +this.player.yaw.toFixed(2));
      MapView.explore(r.explored, f.x, f.y, f.z, this.outdoorSmooth > 0.5 ? 14 : Math.max(6, radius));
    }
    this.ghostT += dt;
  }

  // ------------------------------------------------------------------ frame

  private loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    this.realDt = (now - this.lastFrame) / 1000;
    const frameDt = Math.min(0.1, this.realDt);
    this.lastFrame = now;
    this.clock += frameDt;
    this.frame(frameDt);
  };

  /** Advance one rendered frame (also callable from the headless playtest). */
  frame(frameDt: number) {
    this.input.pollGamepad(frameDt);
    if (this.mode === 'play') {
      const [lx, ly] = this.input.consumeLook();
      this.player.look(lx, this.profile.settings.invertY ? -ly : ly);
      this.acc += frameDt;
      let steps = 0;
      while (this.acc >= STEP && steps < 5 && this.mode === 'play') { this.step(STEP); this.acc -= STEP; steps++; }
      if (steps === 5) this.acc = 0;
      if (steps > 0) this.input.endFrame();
    } else {
      this.input.consumeLook();
      if (this.mode === 'pause' && this.clock - this.pauseAt > 0.35 && this.input.pressed('pause')) this.resume();
      this.input.endFrame();
    }
    this.render(frameDt);
  }

  private render(dt: number) {
    const r = this.runState;
    const rem = this.remaining();
    // camera
    const eye = this.player.eye();
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.2);
    const sh = this.shakeAmt * 0.12;
    this.camera.position.set(eye.x + (Math.random() - 0.5) * sh, eye.y + (Math.random() - 0.5) * sh, eye.z + (Math.random() - 0.5) * sh);
    if (this.mode === 'menu') {
      this.player.yaw = Math.sin(this.clock * 0.05) * 0.5;
      this.player.pitch = 0.08;
    }
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
    this.camera.updateMatrixWorld();

    // exposure: outdoor/ambient blend; zone C is pinned to exactly zero
    const e = this.current.exposure(eye);
    const k = Math.min(1, dt * 2.5);
    this.outdoorSmooth += (e.outdoor - this.outdoorSmooth) * k;
    this.ambientSmooth += (e.ambient - this.ambientSmooth) * k;
    if (e.outdoor === 0 && this.outdoorSmooth < 0.02) this.outdoorSmooth = 0;
    if (SCENE_ZONE[this.current.id] === 'C') this.outdoorSmooth = 0;
    this.sky.outdoor = this.outdoorSmooth;
    this.sky.ambient = this.ambientSmooth;
    this.sky.update(this.mode === 'menu' ? DAY_LENGTH - 60 : rem, this.player.feet, this.camera, this.clock, this.renderer);
    this.sky.sun.shadow.autoUpdate = this.outdoorSmooth > 0;

    // torch + sconces
    const radius = r.torch.lit ? torchRadius(r.gear.torchRadius, r.torch.fuel, r.torch.capacity) : 0;
    const relight = r.torch.relighting > 0 ? 1 - r.torch.relighting / RELIGHT_TIME : -1;
    const sway = Math.sin(this.player.bob) * 0.012;
    this.torchFx.update(dt, this.clock, this.camera, r.torch.lit, radius, relight, sway, this.mode !== 'menu');
    this.torchFx.light.shadow.autoUpdate = r.torch.lit && (this.outdoorSmooth < 0.7 || rem < 60);
    this.sconces.update(this.mode === 'play' ? dt : 0, this.clock, this.player.feet, SCONCE_RADIUS);

    // ghost of the best run
    const g = this.profile.ghost;
    if (g && this.profile.settings.showGhost && this.mode === 'play' && this.outdoorSmooth > 0.05) {
      const n = g.length / 4;
      const fi = this.ghostT / 0.25;
      const i = Math.min(n - 2, Math.floor(fi));
      if (i >= 0 && fi < n - 1) {
        const t = fi - i;
        this.ghost.visible = true;
        this.ghost.position.set(g[i * 4] + (g[i * 4 + 4] - g[i * 4]) * t, g[i * 4 + 1] + (g[i * 4 + 5] - g[i * 4 + 1]) * t, g[i * 4 + 2] + (g[i * 4 + 6] - g[i * 4 + 2]) * t);
        this.ghost.rotation.y = g[i * 4 + 3];
      } else this.ghost.visible = false;
    } else this.ghost.visible = false;

    // audio
    this.audio.setListener(eye, this.player.yaw);
    const gd = this.guardians.nearestActiveDist(this.player.feet);
    this.audio.update(dt, {
      zone: SCENE_ZONE[this.current.id], torchLit: r.torch.lit, torchFuel: r.torch.fuel, wind: this.current.wind?.(this.player.feet) ?? 0,
      dusk: clamp(1 - rem / 120, 0, 1), remaining: rem, guardianDist: gd, inMenu: this.mode !== 'play',
    });

    // HUD
    if (this.mode === 'play' || this.mode === 'pause') {
      const held = this.props.held;
      const objective = rem <= 0 ? 'NIGHT. Get out through the great door before it seals!' : rem < 120 ? 'Head for the great door. Now.' : nextObjective(r.flags);
      this.hud.update(dt, {
        remaining: rem, stamina: r.stamina, maxStamina: r.gear.maxStamina, weight: r.carriedWeight, capacity: r.gear.satchelCapacity,
        fuel: r.torch.fuel, fuelCap: r.torch.capacity, torchLit: r.torch.lit, relighting: r.torch.relighting, loot: r.carriedValue, health: r.health,
        spares: r.spareTorches, prompt: this.promptText, objective, scene: this.current.name, held: held ? held.label : null,
        danger: Number.isFinite(gd) ? clamp(1 - gd / 18, 0, 1) : 0,
        inDark: this.outdoorSmooth === 0 && !r.torch.lit,
      }, this.clock);
      document.getElementById('lockHint')!.style.display = this.mode === 'play' && !this.input.locked && !this.map.open ? 'block' : 'none';
      if (this.map.open) this.map.draw(r.explored, this.player.feet.x, this.player.feet.y, this.player.feet.z, this.player.yaw, MAP_LABELS);
    }

    this.renderer.render(this.scene, this.camera);

    // fps + debug
    const fp = this.fps;
    fp.frames++; fp.t += this.realDt; fp.frameMax = Math.max(fp.frameMax, this.realDt);
    if (fp.t >= 0.5) {
      fp.value = fp.frames / fp.t; fp.worst = fp.frameMax; fp.frames = 0; fp.t = 0; fp.frameMax = 0;
      if (this.mode === 'play') {
        const s = (this.fpsByScene[this.current.id] ??= { sum: 0, n: 0, min: Infinity });
        s.sum += fp.value; s.n++; s.min = Math.min(s.min, fp.value);
      }
    }
    const dbg = document.getElementById('debug')!;
    dbg.style.display = this.debugOn ? 'block' : 'none';
    if (this.debugOn && fp.frames === 0) {
      const info = this.renderer.info;
      const f = this.player.feet;
      dbg.textContent = [
        `FPS ${fp.value.toFixed(0)}  (worst frame ${(fp.worst * 1000).toFixed(0)} ms)`,
        `scene ${this.current.id} [${SCENE_ZONE[this.current.id]}]  attached: ${[...this.attached.keys()].join(', ')}`,
        `physics bodies ${this.physics.bodyCount()}  colliders ${this.physics.colliderCount()}  props ${this.props.props.size}`,
        `draw calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k  geos ${info.memory.geometries}  tex ${info.memory.textures}`,
        `pos ${f.x.toFixed(1)}, ${f.y.toFixed(1)}, ${f.z.toFixed(1)}  ${this.player.grounded ? 'ground' : 'air'}${this.player.climbing ? ' climb' : ''}${this.player.inWater ? ' water' : ''}`,
        `clock ${rem.toFixed(1)} s  outdoor ${this.outdoorSmooth.toFixed(2)}  hemi ${this.sky.hemi.intensity.toFixed(2)}  sun ${this.sky.sun.intensity.toFixed(2)}`,
        `guardians awake ${this.guardians.activeCount()}  nearest ${Number.isFinite(gd) ? gd.toFixed(1) : '-'} m`,
      ].join('\n');
    }
  }

  // ------------------------------------------------------------------ debug helpers (?debug=1 → window.__game)

  tp(where: SceneId | [number, number, number], yaw?: number) {
    const spot = Array.isArray(where) ? [...where, yaw ?? this.player.yaw] : TP[where];
    const p = new THREE.Vector3(spot[0], spot[1], spot[2]);
    this.player.teleport(p, spot[3]);
    this.updateStreaming(true);
    const hit = this.physics.raycast(p.clone().add(new THREE.Vector3(0, 1.2, 0)), new THREE.Vector3(0, -1, 0), 8, this.player.collider);
    if (hit) this.player.teleport(hit.point.add(new THREE.Vector3(0, 0.05, 0)), spot[3]);
    this.updateStreaming(true);
  }
  setRemaining(sec: number) { this.runState.elapsed = DAY_LENGTH - this.runState.dayPenalty - sec; }
  give(relicId: string) {
    const rel = RELIC_BY_ID[relicId];
    if (!rel) return;
    this.runState.carried.push({ relicId, value: relicValue(relicId, this.current.id), weight: rel.weight, foundIn: this.current.id });
    if (relicId === 'sundisc') this.setFlag('hasSunDisc');
    if (relicId === 'obsidiankey') this.setFlag('hasObsidianKey');
  }
  flag(f: Flag) { this.setFlag(f); }
  /** Run the fixed-step simulation for `sec` seconds without rendering (headless tests). */
  simulate(sec: number) {
    const n = Math.round(sec / STEP);
    for (let i = 0; i < n && this.mode === 'play'; i++) { this.clock += STEP; this.step(STEP); this.input.endFrame(); }
  }
  /** Turn the view to face a world point. */
  lookAt(x: number, y: number, z: number) {
    const e = this.player.eye();
    const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    this.player.yaw = Math.atan2(-dx, -dz);
    this.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
  /** Hold an action for the next simulate() call. */
  hold(a: Parameters<Input['press']>[0], down = true) { if (down) this.input.press(a); else this.input.release(a); }
  stats() {
    const f = this.player.feet;
    return {
      mode: this.mode, scene: this.current.id, pos: [f.x, f.y, f.z], remaining: this.remaining(), fps: this.fps.value, health: this.runState.health,
      torch: { ...this.runState.torch }, carried: this.runState.carried.length, haul: this.runState.carriedValue, flags: { ...this.runState.flags },
      bodies: this.physics.bodyCount(), attached: [...this.attached.keys()], hemi: this.sky.hemi.intensity, sun: this.sky.sun.intensity, outdoor: this.sky.outdoor,
      sky: this.sky.sky.visible, prompt: this.promptText, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles, guardians: this.guardians.activeCount(), outcome: this.runState.outcome,
    };
  }
}
