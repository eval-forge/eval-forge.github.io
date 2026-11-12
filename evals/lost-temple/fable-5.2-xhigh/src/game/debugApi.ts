/**
 * `window.__lt`: a small scripting surface for automated playtests and for
 * poking at the game from the console. Nothing in the game depends on it.
 */
import { RELIC_BY_ID, type KeyItemId, type RelicId } from '../core/economy';
import { SCENES, type SceneId } from '../core/scenes';
import type { Flag } from '../core/unlock';
import type { Action } from '../engine/input';
import { sceneAt } from '../world/layout';
import type { Game } from './game';

export interface WalkOpts {
  /** Seconds of game time before giving up. */
  timeout?: number;
  sprint?: boolean;
  crouch?: boolean;
  /** Arrival radius in metres. */
  tol?: number;
  /** Hop when stuck (default true). */
  hop?: boolean;
  /** Hold jump the whole way (bridges with missing planks). */
  jump?: boolean;
}

export function installDebugApi(game: Game): void {
  const api = {
    game,

    state() {
      const run = game.run;
      const p = game.player;
      const r = game.renderer;
      return {
        state: game.state,
        scene: game.scenes.current,
        zone: SCENES[game.scenes.current].zone,
        loaded: [...game.scenes.loaded.keys()],
        building: game.scenes.buildingId,
        pos: { x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2) },
        yaw: +p.yaw.toFixed(3),
        mode: p.mode,
        grounded: p.grounded,
        health: +run.health.toFixed(1),
        stamina: +p.stamina.toFixed(1),
        time: +run.time.toFixed(2),
        remaining: +run.clock.remaining.toFixed(2),
        dark: run.clock.isDark,
        doorGap: +run.clock.doorGap.toFixed(2),
        loot: run.satchel.value,
        weight: +run.satchel.weight.toFixed(2),
        relics: run.satchel.items.map((i) => i.relic),
        keys: [...run.satchel.keys],
        torch: { state: run.torch.state, fuel: +run.torch.fuel.toFixed(1), radius: +run.torch.radius.toFixed(2), flasks: run.torch.flasks, spares: run.torch.spares },
        flags: [...run.flags],
        entered: run.entered,
        outcome: run.outcome,
        epitaph: run.epitaph,
        result: game.result,
        outdoor: +game.outdoor.toFixed(3),
        prompt: game.prompt,
        held: p.held ? `${p.held.name} ${p.held.mass}` : null,
        fps: +game.fps.toFixed(1),
        frameMs: +game.frameMs.toFixed(2),
        bodies: game.physics.bodyCount,
        colliders: game.physics.colliderCount,
        joints: game.physics.jointCount,
        stepMs: +game.physics.stepMs.toFixed(2),
        calls: r.stats.calls,
        triangles: r.stats.triangles,
        programs: r.stats.programs,
        entities: game.scenes.entityCount,
        guardiansAwake: game.guardians.awakeCount,
        threat: +game.guardians.threat.toFixed(2),
        coins: game.meta.data.coins,
      };
    },

    start(opts: { seed?: number } = {}) {
      game.audio.enabled = false;
      game.startRun({ seed: opts.seed ?? 12345, auto: true });
    },

    /** Advance the game by simulated seconds, as fast as the CPU allows. */
    sim(seconds: number) {
      return game.simulate(Math.round(seconds * 60));
    },

    /** Walk in a straight line to (x, z). Returns whether it got there. */
    walkTo(x: number, z: number, opts: WalkOpts = {}) {
      const p = game.player;
      const tol = opts.tol ?? 0.5;
      const max = Math.round((opts.timeout ?? 25) * 60);
      let best = Infinity;
      let stuck = 0;
      let ok = false;
      game.input.script = { moveX: 0, moveZ: 1, sprint: opts.sprint ?? true, crouch: opts.crouch ?? false };
      game.simulate(max, () => {
        const dx = x - p.pos.x;
        const dz = z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < tol) {
          ok = true;
          return false;
        }
        p.yaw = Math.atan2(-dx, -dz);
        p.pitch = 0;
        if (opts.jump) game.input.press('jump');
        if (d < best - 0.02) {
          best = d;
          stuck = 0;
        } else if (++stuck % 45 === 44 && opts.hop !== false) {
          game.input.press('jump');
        }
        return stuck < 60 * 6;
      });
      game.input.script = null;
      game.simulate(4);
      return { ok, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), scene: game.scenes.current, state: game.state };
    },

    /** Walk through a list of [x, z] points. Stops at the first one it cannot reach. */
    route(points: [number, number][], opts: WalkOpts = {}) {
      let last = null;
      for (const [x, z] of points) {
        last = api.walkTo(x, z, opts);
        if (!last.ok) return { ...last, failedAt: [x, z] };
      }
      return last;
    },

    look(yaw: number, pitch = 0) {
      game.player.yaw = yaw;
      game.player.pitch = pitch;
      return game.refreshInteraction();
    },

    lookAt(x: number, y: number, z: number) {
      const e = game.player.eye;
      game.player.frame(0, 1, game.renderer.camera);
      const dx = x - e.x;
      const dy = y - e.y;
      const dz = z - e.z;
      game.player.yaw = Math.atan2(-dx, -dz);
      game.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      return game.refreshInteraction();
    },

    press(a: Action) {
      game.input.press(a);
      game.simulate(4);
      return game.prompt;
    },

    /** Look at a point and press E. Returns the prompt that was showing. */
    use(x: number, y: number, z: number) {
      const prompt = api.lookAt(x, y, z);
      game.input.press('interact');
      game.simulate(4);
      return prompt;
    },

    move(script: { moveX: number; moveZ: number; sprint?: boolean; crouch?: boolean } | null) {
      game.input.script = script ? { moveX: script.moveX, moveZ: script.moveZ, sprint: !!script.sprint, crouch: !!script.crouch } : null;
    },

    teleport(x: number, y: number, z: number, yaw = 0) {
      const id = sceneAt({ x, y, z }, null);
      if (id) {
        game.scenes.ensure(id);
        game.scenes.current = id;
      }
      game.player.teleport(x, y, z, yaw);
      game.simulate(2);
      return api.state().scene;
    },

    ensure(id: SceneId) {
      game.scenes.ensure(id);
    },

    setTime(t: number) {
      game.run.clock.jumpTo(t);
    },

    flag(f: Flag) {
      game.setFlag(f);
    },

    give(id: RelicId, scene: SceneId = 'vault') {
      if (!RELIC_BY_ID[id]) return false;
      return !!game.run.satchel.add(id, scene, `debug:${id}:${game.run.satchel.count}`);
    },

    giveKey(id: KeyItemId) {
      game.run.satchel.addKey(id);
    },

    torch(on: boolean) {
      const t = game.run.torch;
      if (on && !t.lit) {
        t.startRelight();
        game.simulate(110);
      } else if (!on && t.lit) {
        t.douse('manual');
      }
      return t.state;
    },

    /** Draw one frame and stop the loop (so a screenshot is cheap), or start it again. */
    freeze(on: boolean) {
      if (on) game.tick(0);
      game.frozen = on;
    },

    /** Draw a frame and return the 3D canvas as a JPEG data URL (no HUD). */
    capture(quality = 0.88) {
      game.tick(0);
      return game.canvas.toDataURL('image/jpeg', quality);
    },

    /** Switch graphics quality for this session without touching the save. */
    quality(q: 'low' | 'medium' | 'high') {
      game.meta.data.settings.quality = q;
      game.applySettings();
    },

    noclip(on: boolean) {
      game.player.noclip = on;
    },

    wake() {
      game.guardians.wakeAll();
    },

    guardians() {
      return game.guardians.info();
    },

    /**
     * Render the current view with the hand torch and sconce lights forced
     * off and read the frame back. Deep in Zone C every pixel must be zero.
     */
    darknessProbe() {
      const L = game.lighting;
      const torch = game.run.torch;
      const wasLit = torch.lit;
      if (wasLit) torch.douse('manual');
      game.torchRig.frame(1);
      game.tick(0);
      L.blackout();
      const flames: { visible: boolean }[] = [];
      game.renderer.scene.traverse((o) => {
        if ((o as { isSprite?: boolean }).isSprite && o.visible) {
          flames.push(o);
          o.visible = false;
        }
      });
      game.renderer.render(game.grade, game.time);
      const m = game.renderer.measureFrame();
      for (const f of flames) f.visible = true;
      if (wasLit) torch.state = 'lit';
      return { ...m, scene: game.scenes.current, y: +game.player.pos.y.toFixed(2), outdoor: game.outdoor, hiddenFlames: flames.length };
    },

    /** Read back the frame as it is (torch and all). */
    measure() {
      // Simulated time does not draw frames: let the torch light settle before measuring.
      game.torchRig.frame(1);
      game.tick(0);
      return game.renderer.measureFrame();
    },

    /** Sample real rendered frames for a while and report timings. */
    perf(frames = 120): Promise<{ frames: number; avgMs: number; p95Ms: number; maxMs: number; fps: number; calls: number; triangles: number; stepMs: number; buildMs: number }> {
      return new Promise((resolve) => {
        const times: number[] = [];
        let calls = 0;
        let tris = 0;
        let stepMs = 0;
        let buildMs = 0;
        let last = performance.now();
        const fn = (): void => {
          const now = performance.now();
          times.push(now - last);
          last = now;
          calls = Math.max(calls, game.renderer.stats.calls);
          tris = Math.max(tris, game.renderer.stats.triangles);
          stepMs = Math.max(stepMs, game.physics.stepMs);
          buildMs = Math.max(buildMs, game.scenes.buildMs);
          if (times.length >= frames + 1) {
            game.onFrame.delete(fn);
            times.shift();
            const sorted = times.slice().sort((a, b) => a - b);
            const avg = times.reduce((a, b) => a + b, 0) / times.length;
            resolve({
              frames: times.length,
              avgMs: +avg.toFixed(2),
              p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
              maxMs: +sorted[sorted.length - 1].toFixed(2),
              fps: +(1000 / avg).toFixed(1),
              calls,
              triangles: tris,
              stepMs: +stepMs.toFixed(2),
              buildMs: +buildMs.toFixed(2),
            });
          }
        };
        game.onFrame.add(fn);
      });
    },
  };
  (window as unknown as { __lt: typeof api }).__lt = api;
}
