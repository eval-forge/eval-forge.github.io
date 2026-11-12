import * as THREE from 'three';
import { G } from './ctx';
import { Physics } from './Physics';
import { Renderer } from './Renderer';
import { Input, PAD } from './Input';
import { Audio } from './Audio';
import { Save, Settings } from './Save';
import { Player } from '../entities/Player';
import { TorchSystem } from '../entities/Torch';
import { GuardianSystem } from '../entities/Guardians';
import { Carry, dropRelicFromSatchel } from '../entities/Loot';
import { World } from '../world/World';
import { Sky } from '../world/Sky';
import { NavGraph } from '../nav/NavGraph';
import { HUD } from '../ui/HUD';
import { Menus, RunResult } from '../ui/Menus';
import { MapView } from '../ui/MapView';
import { Debug } from '../ui/Debug';
import { Ghost } from '../ghost/Ghost';
import { Satchel, satchelCapacity, settleRun, insertHighScore, makeCarried } from '../logic/economy';
import { INITIAL_FLAGS, UnlockFlags } from '../logic/unlocks';
import { DAY_LENGTH, phaseAt, tickInterval, tickVolume, Phase } from '../logic/countdown';
import { RELIC_BY_ID } from '../logic/relics';
import { Jungle } from '../world/scenes/jungle';
import { Courtyard } from '../world/scenes/courtyard';
import { Cliffs } from '../world/scenes/cliffs';
import { Halls } from '../world/scenes/halls';
import { Sanctum } from '../world/scenes/sanctum';
import { Catacombs } from '../world/scenes/catacombs';
import { Vault } from '../world/scenes/vault';
import { Tunnel } from '../world/scenes/tunnel';
import { jungleHeight } from '../world/scenes/jungle';

type State = 'menu' | 'loading' | 'playing' | 'paused' | 'results';

export class Game {
  renderer: Renderer;
  camera: THREE.PerspectiveCamera;
  input: Input;
  audio = new Audio();
  hud: HUD;
  menus: Menus;
  map: MapView;
  debug: Debug;
  ghost: Ghost | null = null;
  state: State = 'menu';
  private last = performance.now();
  private tickAcc = 0;
  private lastPhase: Phase = 'normal';
  private wasInside = false;
  private enteredTemple = false;
  private hadLock = false;
  private loadingEl: HTMLDivElement;
  private deathCause: string | null = null;
  private sanctumRef: Sanctum | null = null;

  constructor(private container: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.className = 'game';
    container.appendChild(canvas);
    this.renderer = new Renderer(canvas);
    this.camera = new THREE.PerspectiveCamera(Save.settings.fov, window.innerWidth / window.innerHeight, 0.05, 3200);
    this.input = new Input(canvas);
    const ui = document.createElement('div');
    ui.className = 'ui';
    container.appendChild(ui);
    this.hud = new HUD(ui);
    this.map = new MapView(ui);
    this.debug = new Debug(ui, this.renderer);
    this.loadingEl = document.createElement('div');
    this.loadingEl.className = 'loading hidden';
    this.loadingEl.innerHTML = '<div>Cutting a path through the jungle...</div>';
    ui.appendChild(this.loadingEl);
    this.menus = new Menus(ui, {
      play: () => this.startRun(),
      resume: () => this.resume(),
      abandon: () => this.endRun(false, 'You abandoned the run. The jungle keeps what you carried.'),
      applySettings: (s) => this.applySettings(s),
    });
    G.audio = this.audio;
    G.input = this.input;
    G.camera = this.camera;
    G.hud = this.hud;
    this.wireCtx();
    this.applySettings(Save.settings);
    window.addEventListener('resize', () => this.onResize());
    canvas.addEventListener('click', () => { if (this.state === 'playing' && !this.input.locked) this.input.lock(); });
    document.addEventListener('pointerlockchange', () => {
      if (this.input.locked) this.hadLock = true;
      else if (this.state === 'playing' && this.hadLock) this.pause();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'paused' && this.menus.state === 'pause') { /* browser needs a click to relock */ }
      if (e.code === 'KeyP' && this.state === 'playing') this.pause();
    });
    this.menus.showMain();
    this.onResize();
    requestAnimationFrame(() => this.frame());
    (window as unknown as { __lt: unknown }).__lt = this.debugApi();
  }

  private wireCtx() {
    G.noise = (pos, loudness) => {
      G.noises.push({ pos, loudness, t: G.time });
      this.sanctumRef?.debris.hear(pos, loudness);
    };
    G.damage = (amount, cause) => {
      if (!G.running) return;
      G.player.hurt(amount);
      this.audio.hurt();
      if (G.player.health <= 0) {
        const msg: Record<string, string> = { fall: 'The fall broke you.', dart: 'Poisoned darts found their mark.', blade: 'A swinging blade cut you down.', boulder: 'Crushed by a rolling boulder.', debris: 'Buried by falling stone.' };
        G.kill(msg[cause] ?? 'You succumbed to your wounds.');
      }
    };
    G.kill = (cause) => { if (G.running) { this.deathCause = cause; this.endRun(false, cause); } };
    G.toast = (msg, secs = 3) => this.hud.toast(msg, secs);
    G.setFlag = (name: keyof UnlockFlags) => { G.flags = { ...G.flags, [name]: true }; };
  }

  applySettings(s: Settings) {
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.audio.setVolume(s.volume, s.music);
    this.renderer.setQuality(s.quality);
    if (G.sky) G.sky.setShadowQuality(s.quality);
    if (G.torch) G.torch.light.shadow.mapSize.setScalar(s.quality === 'low' ? 256 : s.quality === 'medium' ? 512 : 1024);
    this.debug.set(s.showDebug);
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.resize();
  }

  private disposeRun() {
    if (G.physics) { try { G.physics.world.free(); } catch { /* already freed */ } }
    if (G.scene) {
      G.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
  }

  async startRun() {
    this.audio.init();
    this.menus.hide();
    this.loadingEl.classList.remove('hidden');
    this.state = 'loading';
    await new Promise((r) => setTimeout(r, 30));
    this.disposeRun();
    const t0 = performance.now();

    G.seed = (Date.now() * 2654435761) >>> 0;
    G.upgrades = { ...Save.data.upgrades };
    G.physics = new Physics();
    G.satchel = new Satchel(satchelCapacity(G.upgrades.satchel));
    G.flags = { ...INITIAL_FLAGS };
    G.elapsed = 0; G.time = 0; G.relicsFound = 0; G.noises = [];
    G.stats = { kills: null };
    const scene = new THREE.Scene();
    G.scene = scene;
    scene.add(this.camera);
    G.sky = new Sky(scene, this.renderer);
    G.sky.setShadowQuality(Save.settings.quality);
    G.torch = new TorchSystem(scene, this.camera, G.upgrades.torch, G.upgrades.fuel);
    G.torch.light.shadow.mapSize.setScalar(Save.settings.quality === 'low' ? 256 : Save.settings.quality === 'medium' ? 512 : 1024);
    G.guardians = new GuardianSystem(scene);
    G.nav = new NavGraph();
    G.carry = new Carry();
    G.player = new Player();
    const sanctum = new Sanctum();
    const vault = new Vault();
    const courtyard = new Courtyard();
    this.sanctumRef = sanctum;
    const chunks = [new Jungle(), courtyard, new Cliffs(), new Halls(), sanctum, new Catacombs(), vault, new Tunnel()];
    G.world = new World(chunks);
    G.world.buildAll();
    G.world.loadAll();
    const start = new THREE.Vector3(0, jungleHeight(0, 5) + 1.2, 5);
    G.player.spawn(start, 0);
    G.physics.world.step();
    G.nav.bake(chunks);
    // Initially closed doors block the guardians' graph
    G.nav.setBlocked(new THREE.Box3(new THREE.Vector3(-2, -1, -236.5), new THREE.Vector3(2, 4, -234.5)), true);
    G.nav.setBlocked(new THREE.Box3(new THREE.Vector3(-2.5, -1, -287), new THREE.Vector3(2.5, 5, -284.5)), true);
    G.nav.setBlocked(new THREE.Box3(new THREE.Vector3(18, -1, -192), new THREE.Vector3(19.5, 4, -188)), true);
    vault.setup();
    this.spawnGuardians();
    // Leave-the-temple interaction at the great door (outside)
    courtyard.interactables.push({
      pos: new THREE.Vector3(0, 1.5, -173.6), radius: 2.6,
      label: () => (this.enteredTemple && G.player.position.z > -175.5 ? `Leave the temple with your haul (${G.satchel.value.toLocaleString()} gold) — ends the run` : null),
      act: () => this.endRun(true, 'You walked out into the daylight with your haul.'),
    });
    G.world.current = chunks[0];
    G.world.stream(true);
    this.ghost = new Ghost(scene);
    this.tickAcc = 0; this.lastPhase = 'normal'; this.wasInside = false; this.enteredTemple = false; this.deathCause = null;
    G.running = true;
    console.info(`[lost-temple] run built in ${(performance.now() - t0).toFixed(0)} ms, nav nodes ${G.nav.nodes.length} (bake ${G.nav.bakeMs.toFixed(0)} ms)`);
    this.loadingEl.classList.add('hidden');
    this.hud.show(true);
    this.state = 'playing';
    this.input.lock();
    this.last = performance.now();
    this.hud.toast('Dawn. The temple lies beyond the gorge. Get in, get rich, get out before dark.', 6);
    this.hud.toast('Click to capture the mouse. Tab: satchel · M: map · Esc: pause', 6);
  }

  private spawnGuardians() {
    const gs = G.guardians;
    gs.add('sentinel', new THREE.Vector3(-42, -14, -397), 'lair', Math.PI / 2);
    gs.add('sentinel', new THREE.Vector3(-42, -14, -413), 'lair', Math.PI / 2);
    gs.add('crawler', new THREE.Vector3(-30, -14, -405), 'lair');
    gs.add('shade', new THREE.Vector3(-35, -14, -418), 'lair');
    gs.add('crawler', new THREE.Vector3(10, -14, -390), 'vault');
    gs.add('sentinel', new THREE.Vector3(-4, -14, -358), 'catacombs', Math.PI);
    gs.add('shade', new THREE.Vector3(0, -14, -310), 'catacombs');
    gs.add('crawler', new THREE.Vector3(24, -6.7, -310), 'tunnel');
    gs.add('sentinel', new THREE.Vector3(14, 0, -270), 'sanctum', -Math.PI / 2);
    gs.add('crawler', new THREE.Vector3(-14, 0, -252), 'sanctum');
    gs.add('shade', new THREE.Vector3(-12, 0, -228), 'halls');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.unlock();
    this.map.hide();
    this.menus.showPause();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.menus.hide();
    this.state = 'playing';
    this.input.lock();
    this.last = performance.now();
  }

  endRun(escaped: boolean, cause: string) {
    if (!G.running) return;
    G.running = false;
    const value = G.satchel.value;
    const banked = settleRun(escaped, value);
    const items = G.satchel.items.map((i) => `${RELIC_BY_ID[i.typeId].name} — ${i.value} gold`);
    Save.data.runs++;
    Save.data.bank += banked;
    let newBest = false;
    if (escaped) {
      const prevTop = Save.data.scores[0]?.value ?? 0;
      Save.data.scores = insertHighScore(Save.data.scores, { value, time: Math.round(G.elapsed), relics: G.satchel.items.length, date: new Date().toLocaleDateString(), escaped });
      newBest = value > prevTop && value > 0;
      if (newBest) this.ghost?.saveIfBest(value);
    }
    Save.saveData();
    const r: RunResult = { escaped, cause, value, time: G.elapsed, relics: G.relicsFound, items, banked, newBest };
    this.state = 'results';
    this.input.unlock();
    this.hud.show(false);
    this.map.hide();
    if (G.carry.held) G.carry.drop();
    if (!escaped) this.audio.rumble(0.6, 2);
    this.menus.showResults(r);
  }

  private frame() {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.input.pollGamepad();
    const tu = performance.now();
    if (this.state === 'playing') this.update(dt);
    const tr = performance.now();
    this.debug.updMs = this.debug.updMs * 0.9 + (tr - tu) * 0.1;
    if (this.state === 'paused' && this.input.padHit(PAD.START)) this.resume();
    if (G.scene && (this.state === 'playing' || this.state === 'paused' || this.state === 'results')) {
      this.renderer.grade.uniforms.time.value = now / 1000;
      this.renderer.render(G.scene, this.camera);
      this.debug.renMs = this.debug.renMs * 0.9 + (performance.now() - tr) * 0.1;
    }
    this.debug.update(dt);
    this.input.endFrame();
  }

  private update(dt: number) {
    const inp = this.input;
    G.elapsed += dt;
    G.time += dt;
    G.noises = G.noises.filter((n) => G.time - n.t < 0.3);

    if (inp.hit('Escape') || inp.padHit(PAD.START)) { this.pause(); return; }
    if (inp.hit('F3')) { Save.settings.showDebug = !Save.settings.showDebug; this.debug.set(Save.settings.showDebug); Save.saveSettings(); }
    if (inp.hit('KeyM') || inp.padHit(PAD.BACK)) this.map.toggle();

    G.player.look(dt);
    G.physics.step(dt, (h) => { G.player.step(h); G.carry.step(); });
    G.player.updateCamera(this.camera, dt);
    G.world.update(dt);
    G.carry.update();
    G.guardians.update(dt);
    if (!G.running) return;
    G.torch.update(dt);
    G.sky.update(G.elapsed, dt);

    // Interaction
    const eye = G.player.eye, fwd = G.player.forward;
    const it = G.world.pickInteractable(eye, fwd);
    let prompt = it ? it.label() : null;
    if (!prompt && !G.carry.held) { const t = G.carry.target(); if (t) prompt = t.interact.label(); }
    if (!prompt && G.carry.held) prompt = `Holding ${G.carry.held.name}: G drop · Left click throw`;
    this.hud.setPrompt(prompt);
    if ((inp.hit('KeyE') || inp.padHit(PAD.X)) && it) it.act();
    if (inp.hit('KeyQ') || inp.padHit(PAD.DOWN)) dropRelicFromSatchel();

    this.updateClock(dt);
    this.checkExit();

    // Audio
    const zone = G.world.current.zone;
    const hb = Math.max(0, Math.min(1, 1 - G.guardians.nearest / 22));
    this.audio.update(dt, {
      outdoor: zone === 'A' ? 1 : zone === 'B' ? 0.5 : 0,
      underground: zone === 'C' ? 1 : 0,
      wind: G.world.windAt(G.player.position),
      dayness: G.sky.dayness,
      danger: hb,
      heartbeat: hb,
      phase: phaseAt(G.elapsed),
      torchLit: G.torch.lit,
    });
    this.audio.setListener(this.camera.position, fwd);

    // Grading uniforms for the edge pulse and damage
    const ph = phaseAt(G.elapsed);
    const u = this.renderer.grade.uniforms;
    u.pulse.value = ph === 'critical' ? 0.35 + 0.35 * Math.sin(G.time * 5) : ph === 'dark' ? 0.5 + 0.4 * Math.sin(G.time * 7) : 0;
    u.damage.value = Math.max(0, G.player.hurtFlash) + (G.player.health < 30 ? 0.3 : 0);
    u.vignette.value = zone === 'C' ? 0.5 : 0.35;

    this.hud.update(dt);
    this.map.update(dt);
    if (this.ghost) { this.ghost.record(G.elapsed, G.player.position, dt); this.ghost.update(G.elapsed, zone === 'C'); }
  }

  private updateClock(dt: number) {
    const ph = phaseAt(G.elapsed);
    this.tickAcc += dt;
    if (this.tickAcc >= tickInterval(G.elapsed) && ph !== 'sealed') {
      this.tickAcc = 0;
      this.audio.tick(tickVolume(G.elapsed));
    }
    if (ph !== this.lastPhase) {
      if (ph === 'urgent') this.hud.toast('Two minutes of daylight left. The sundial ticks faster...', 4);
      if (ph === 'critical') { this.hud.toast('ONE MINUTE! The temple rumbles. Get to the great door!', 5); this.audio.rumble(1, 4); }
      if (ph === 'dark') {
        this.hud.toast('Darkness falls. The guardians wake. The great door is closing!', 5);
        this.audio.doorBoom();
      }
      if (ph === 'sealed') {
        G.flags = { ...G.flags, greatDoorOpen: false };
        this.audio.doorBoom();
        if (this.isInside()) G.kill('The great door ground shut. You are sealed inside with the guardians.');
        else this.endRun(true, 'You stand outside as the great door seals behind you. You made it!');
      }
      this.lastPhase = ph;
    }
    if (ph === 'critical' && Math.random() < dt * 0.15) this.audio.rumble(0.5, 2);
  }

  private isInside(): boolean {
    const p = G.player.position;
    return p.z < -177.2;
  }

  private checkExit() {
    const inside = this.isInside();
    if (inside) this.enteredTemple = true;
    const outside = G.player.position.z > -175.2;
    if (this.wasInside && outside) {
      const ph = phaseAt(G.elapsed);
      if (ph === 'critical' || ph === 'dark') { this.endRun(true, 'You burst out of the great door as darkness falls!'); return; }
      this.hud.toast('Back in the daylight. Press E at the door to leave for good, or head back in for more.', 4);
    }
    if (inside) this.wasInside = true;
    else if (outside) this.wasInside = false;
  }

  /** Small API for automated testing / debugging from the console. */
  private debugApi() {
    return {
      G,
      game: this,
      teleport: (x: number, y: number, z: number, yaw?: number) => { G.player.teleport(new THREE.Vector3(x, y, z)); if (yaw !== undefined) G.player.yaw = yaw; G.world.current = G.world.chunkAt(G.player.position) ?? G.world.current; G.world.stream(true); },
      setTime: (t: number) => { G.elapsed = t; },
      look: (yaw: number, pitch: number) => { G.player.yaw = yaw; G.player.pitch = pitch; },
      give: (id: string, zone: 'A' | 'B' | 'C' = 'A') => G.satchel.add(makeCarried(id, zone)),
      flag: (f: keyof UnlockFlags) => G.setFlag(f),
      /** Run the game synchronously for `sec` seconds at 60 Hz with `keys` held (no rendering). */
      sim: (sec: number, keys: string[] = [], tap: string[] = []) => {
        const n = Math.round(sec * 60);
        for (let i = 0; i < n && this.state === 'playing'; i++) {
          this.input.keys = new Set(keys);
          if (i === 0) for (const k of [...keys, ...tap]) this.input.pressed.add(k);
          this.update(1 / 60);
          this.input.endFrame();
        }
        this.input.keys = new Set();
        return { pos: G.player.position.toArray().map((v) => +v.toFixed(2)), scene: G.world.current.id, state: this.state, hp: +G.player.health.toFixed(0), t: +G.elapsed.toFixed(1) };
      },
    };
  }
}
