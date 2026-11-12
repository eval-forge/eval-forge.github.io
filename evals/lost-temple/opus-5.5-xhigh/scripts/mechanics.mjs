/**
 * Headless progression check: plays the puzzle / key / shortcut chain through the real
 * interaction path. For every step the player is teleported next to the thing, turned to
 * look at it, and E is pressed through the input system, so the interaction raycast,
 * prompts and hold timers are all exercised. Nothing sets a flag directly.
 *
 *   npm run build && node scripts/mechanics.mjs
 *
 * Writes playtest-output/mechanics.json and prints a pass/fail line per step.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const OUT = 'playtest-output';
mkdirSync(OUT, { recursive: true });
const PORT = 4180;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => {
  server.stdout.on('data', (d) => d.toString().includes(String(PORT)) && res());
  setTimeout(res, 8000);
});

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const g = (fn, arg) => page.evaluate(fn, arg);
const steps = [];
const step = (name, r) => {
  const pass = !!r?.pass;
  steps.push({ name, pass, ...r });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(r)}`);
};

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });

// ---------------------------------------------------------------- page-side helpers
await g(() => {
  const game = window.__game;
  game.autopilot = true;
  game.menus.hideAll();
  game.newRun(true);
  const V = (x, y, z) => ({ x, y, z });
  const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
  const T = {
    /** Interaction boxes within `r` metres (xz) of a point, with their current prompt. */
    interacts(x, z, r) {
      const out = [];
      game.physics.world.colliders.forEach((c) => {
        const tag = game.physics.tagOf(c);
        if (!tag || tag.kind !== 'interact') return;
        const t = c.translation();
        if (Math.hypot(t.x - x, t.z - z) > r) return;
        const he = c.halfExtents();
        out.push({ handle: c.handle, c: V(t.x, t.y, t.z), he: V(he.x, he.y, he.z), prompt: tag.ref.prompt(game) });
      });
      return out;
    },
    groundAt(x, y, z) {
      const THREE = game.player.pos.constructor;
      const hit = game.physics.ray(new THREE(x, y, z), new THREE(0, -1, 0), 8);
      return hit ? hit.point.y : null;
    },
    /** Stand `dist` metres from `target` along a horizontal direction and look at it. */
    standAndLook(target, dirX, dirZ, dist, eyeOverride) {
      const len = Math.hypot(dirX, dirZ) || 1;
      const fx = target.x + (dirX / len) * dist;
      const fz = target.z + (dirZ / len) * dist;
      const gy = T.groundAt(fx, target.y + 2.5, fz);
      if (gy === null) return false;
      game.player.teleport(fx, gy + 0.03, fz);
      game.advance(0.15);
      const p = game.player;
      const eye = p.eye();
      const d = sub(target, eye);
      p.yaw = Math.atan2(-d.x, -d.z);
      p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      game.advance(1 / 60);
      return true;
    },
    targetKey() {
      const t = game.findTarget();
      return t ? t.key : null;
    },
    /** Find a standing spot from which the interaction ray hits this collider handle. */
    approach(handle) {
      let c = null;
      game.physics.world.colliders.forEach((k) => {
        if (k.handle === handle) c = k;
      });
      if (!c) return { ok: false, why: 'collider gone' };
      const t = c.translation();
      const he = c.halfExtents();
      const target = V(t.x, t.y, t.z);
      for (const dist of [1.2, 1.6, 2.0]) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const dx = Math.cos(a);
          const dz = Math.sin(a);
          const reach = Math.abs(dx) * he.x + Math.abs(dz) * he.z + dist;
          if (!T.standAndLook(target, dx, dz, reach)) continue;
          if (T.targetKey() === 'it:' + handle) return { ok: true, at: game.player.pos.toArray().map((v) => +v.toFixed(2)) };
        }
      }
      return { ok: false, why: 'no spot where the interaction ray hits it' };
    },
    approachItem(uid) {
      const li = game.items.live.get(uid);
      if (!li) return { ok: false, why: 'item not live' };
      const t = li.body.translation();
      const target = V(t.x, t.y, t.z);
      const seen = {};
      for (const dist of [1.6, 2.1, 1.1]) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          if (!T.standAndLook(target, Math.cos(a), Math.sin(a), dist)) {
            seen.noGround = (seen.noGround ?? 0) + 1;
            continue;
          }
          const key = T.targetKey();
          if (key === 'item:' + uid) return { ok: true };
          seen[key] = (seen[key] ?? 0) + 1;
        }
      }
      return { ok: false, why: 'no spot where the interaction ray hits it', target: [t.x, t.y, t.z].map((v) => +v.toFixed(2)), seen };
    },
    /** Press E (and hold it for `hold` seconds). */
    pressE(hold = 0) {
      game.input.simulate('interact', true);
      game.advance(Math.max(1 / 60, hold + 0.1));
      game.input.simulate('interact', false);
      game.advance(0.1);
    },
    findItem(kind) {
      for (const [uid, li] of game.items.live) if (li.st.kind === kind) return uid;
      return null;
    },
    toasts() {
      return [...document.querySelectorAll('.toast')].map((e) => e.textContent).slice(-3);
    },
  };
  window.__T = T;
});

// ---------------------------------------------------------------- courtyard: sundial
await g(() => {
  window.__game.warp('courtyard');
  window.__game.advance(1);
});
step(
  'sundial: press the glyph the real shadow points at',
  await g(() => {
    const game = window.__game;
    const T = window.__T;
    const S = { x: 0, z: 36 };
    const sd = game.sky.sunDir;
    if (!game.sky.sunUp) return { pass: false, why: 'sun not up' };
    // the player's reasoning: the shadow points away from the sun; find the stone in that direction
    const shadowAng = Math.atan2(-sd.z, -sd.x);
    const stones = T.interacts(S.x, S.z, 4.2).filter((s) => s.prompt && s.prompt.includes('glyph'));
    let best = null;
    let bestD = 1e9;
    for (const s of stones) {
      const a = Math.atan2(s.c.z - S.z, s.c.x - S.x);
      const d = Math.abs(Math.atan2(Math.sin(a - shadowAng), Math.cos(a - shadowAng)));
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best) return { pass: false, why: 'no glyph stones found', count: stones.length };
    const ap = T.approach(best.handle);
    if (!ap.ok) return { pass: false, ...ap };
    T.pressE();
    game.advance(1.5);
    const disc = T.findItem('sunDisc');
    return { pass: game.run.flags.sundialSolved && !!disc, stones: stones.length, sunDir: [sd.x, sd.y, sd.z].map((v) => +v.toFixed(2)), solved: game.run.flags.sundialSolved, discSpawned: !!disc, toasts: T.toasts() };
  }),
);
step(
  'sun disc: pick it up',
  await g(() => {
    const game = window.__game;
    const T = window.__T;
    const uid = T.findItem('sunDisc');
    if (!uid) return { pass: false, why: 'no disc' };
    game.advance(2);
    const ap = T.approachItem(uid);
    if (!ap.ok) return { pass: false, ...ap };
    T.pressE();
    return { pass: game.run.flags.hasSunDisc, hasSunDisc: game.run.flags.hasSunDisc };
  }),
);

// ---------------------------------------------------------------- great door
step(
  'great door: push the stone block onto the plate',
  await g(() => {
    const game = window.__game;
    const b = game.blockBody;
    const t = b.translation();
    game.player.teleport(t.x + 1.7, 0.05, t.z, Math.PI / 2);
    game.player.pitch = 0;
    game.input.simulateKey('KeyW', true);
    let s = 0;
    while (!game.run.flags.greatDoorOpen && s < 20) {
      game.advance(0.5);
      s += 0.5;
    }
    game.input.simulateKey('KeyW', false);
    const a = b.translation();
    return { pass: game.run.flags.greatDoorOpen, seconds: s, pushedMetres: +(t.x - a.x).toFixed(2) };
  }),
);

// ---------------------------------------------------------------- halls: sun seal
await g(() => {
  window.__game.warp('halls');
  window.__game.advance(1.5);
});
step(
  'halls: set the Sun Disc into the Sun Seal',
  await g(() => {
    const game = window.__game;
    const T = window.__T;
    const seal = T.interacts(-24.6, -48, 3).find((s) => s.prompt && s.prompt.includes('Sun Disc'));
    if (!seal) return { pass: false, why: 'seal interact not found', near: T.interacts(-24.6, -48, 3).map((s) => s.prompt) };
    const ap = T.approach(seal.handle);
    if (!ap.ok) return { pass: false, ...ap };
    T.pressE();
    game.advance(3);
    return { pass: game.run.flags.sunSealOpen, sunSealOpen: game.run.flags.sunSealOpen, toasts: T.toasts() };
  }),
);
// ---------------------------------------------------------------- catacombs
await g(() => {
  window.__game.warp('catacombs');
  window.__game.advance(1.5);
});
step(
  'catacombs: water puts the torch out',
  await g(() => {
    const game = window.__game;
    const torch = game.run.torch;
    torch.lit = true;
    // the flooded chamber: x -78…-62, z -78…-60, surface -10.45
    game.player.teleport(-70, -12.6, -66);
    game.advance(2);
    return { pass: !torch.lit, swimming: game.player.swimming, torchLit: torch.lit, feetY: +game.player.feetY.toFixed(2) };
  }),
);
step(
  'catacombs: take the Bone Key from the flooded chamber',
  await g(() => {
    const game = window.__game;
    const T = window.__T;
    const uid = T.findItem('boneKey');
    if (!uid) return { pass: false, why: 'no bone key item live' };
    const ap = T.approachItem(uid);
    if (!ap.ok) return { pass: false, ...ap };
    T.pressE();
    return { pass: game.run.flags.hasBoneKey, hasBoneKey: game.run.flags.hasBoneKey };
  }),
);
step(
  'catacombs: relight the torch (vulnerable animation)',
  await g(() => {
    const game = window.__game;
    const torch = game.run.torch;
    // dunk a lit torch, climb out, and immediately try to relight it
    torch.lit = true;
    game.player.teleport(-70, -12.6, -66);
    game.advance(1);
    game.player.teleport(-50, -9.9, -48, Math.PI / 2);
    game.advance(0.2);
    if (torch.lit) return { pass: false, why: 'water did not put the torch out' };
    game.input.simulate('torch', true);
    game.advance(1 / 60);
    game.input.simulate('torch', false);
    game.advance(0.3);
    const refusedWhileWet = !torch.lit && !torch.relighting;
    game.advance(3.2); // dry off
    game.input.simulate('torch', true);
    game.advance(1 / 60);
    game.input.simulate('torch', false);
    game.advance(0.1);
    const relighting = torch.relighting;
    game.advance(0.5);
    const midway = torch.lit;
    game.advance(5);
    return { pass: refusedWhileWet && relighting && !midway && torch.lit, refusedWhileWet, relightingFlag: relighting, litHalfASecondIn: midway, litAfter: torch.lit };
  }),
);
step(
  'catacombs: turn the Bone Key in the vault door',
  await g(() => {
    const game = window.__game;
    const T = window.__T;
    game.player.teleport(-24, -13.9, -101, Math.PI / 2);
    game.advance(1.5);
    const door = T.interacts(-19, -101, 3).find((s) => s.prompt && s.prompt.includes('Bone Key'));
    if (!door) return { pass: false, why: 'vault door interact not found', near: T.interacts(-19, -101, 4).map((s) => s.prompt), scene: game.scenes.current, loaded: [...game.scenes.loaded.keys()] };
    const ap = T.approach(door.handle);
    if (!ap.ok) return { pass: false, ...ap };
    T.pressE();
    game.advance(3);
    return { pass: game.run.flags.vaultDoorOpen, vaultDoorOpen: game.run.flags.vaultDoorOpen };
  }),
);

// ---------------------------------------------------------------- vault: drawbridge
await g(() => {
  window.__game.warp('vault');
  window.__game.advance(1.5);
});
step(
  'vault: pull the drawbridge lever',
  await g(() => {
    const game = window.__game;
    const T = window.__T;
    const lever = T.interacts(5, -114.5, 2).find((s) => s.prompt && s.prompt.includes('lever'));
    if (!lever) return { pass: false, why: 'lever not found', near: T.interacts(5, -114.5, 3).map((s) => s.prompt) };
    const ap = T.approach(lever.handle);
    if (!ap.ok) return { pass: false, ...ap };
    T.pressE();
    game.advance(4);
    return { pass: game.run.flags.drawbridgeDown, drawbridgeDown: game.run.flags.drawbridgeDown };
  }),
);

// ---------------------------------------------------------------- sanctum: kick wall, idol
await g(() => {
  window.__game.warp('sanctum');
  window.__game.advance(1.5);
});
step(
  'sanctum: kick the cracked wall through (3 kicks, from the sanctum side)',
  await g(() => {
    const game = window.__game;
    const T = window.__T;
    const wall = T.interacts(20, -61, 2).find((s) => s.prompt);
    if (!wall) return { pass: false, why: 'kick wall not found' };
    // stand on the sanctum side (south of the wall is the halls; sanctum is z < -61)
    let ok = false;
    for (const d of [1.4, 1.8]) {
      T.standAndLook(wall.c, 0, -1, wall.he.z + d);
      if (T.targetKey() === 'it:' + wall.handle) {
        ok = true;
        break;
      }
    }
    if (!ok) return { pass: false, why: 'could not target the wall from the sanctum side' };
    const prompt = game.findTarget().it.prompt(game);
    for (let i = 0; i < 3; i++) T.pressE(0.45);
    game.advance(1);
    return { pass: game.run.flags.kickWallBroken, prompt, kickWallBroken: game.run.flags.kickWallBroken };
  }),
);
step(
  'sanctum: take the Sun Idol (collapse sequence + clock jump)',
  await g(() => {
    const game = window.__game;
    const T = window.__T;
    let uid = null;
    for (const [k, li] of game.items.live) if (li.st.relic && li.st.relic.defId === 'sun_idol') uid = k;
    if (!uid) return { pass: false, why: 'idol item not found', kinds: [...game.items.live.values()].slice(0, 5).map((l) => l.st) };
    const before = game.clock.timeLeft;
    const ap = T.approachItem(uid);
    if (!ap.ok) return { pass: false, ...ap };
    T.pressE();
    game.advance(0.5);
    const jump = before - game.clock.timeLeft;
    game.advance(8);
    return { pass: game.run.flags.idolTaken && jump > 30, idolTaken: game.run.flags.idolTaken, clockJumpSeconds: +jump.toFixed(1), archwayBlocked: game.run.flags.archwayBlocked, state: game.state, health: Math.round(game.player.health), carried: game.run.carriedValue() };
  }),
);


// ---------------------------------------------------------------- sun-stones over the day (fresh run)
step(
  'halls: sun-stones are solid only while sunlit (sampled across the day)',
  await g(() => {
    const game = window.__game;
    game.newRun(true);
    game.warp('halls');
    game.advance(1.5);
    const solidCount = () => {
      let n = 0;
      let total = 0;
      game.physics.world.colliders.forEach((c) => {
        const tag = game.physics.tagOf(c);
        if (tag && tag.kind === 'sunstone') {
          total++;
          if (c.isEnabled()) n++;
        }
      });
      return { n, total };
    };
    const samples = [];
    for (const left of [720, 600, 480, 360, 240, 120, 30]) {
      game.skipTime(Math.max(0, game.clock.timeLeft - left));
      game.advance(1.5);
      const c = solidCount();
      samples.push({ timeLeft: Math.round(game.clock.timeLeft), solid: c.n, of: c.total, sunElev: +game.sky.sunDir.y.toFixed(2) });
    }
    game.player.teleport(0, 0.1, -12); // stay clear of the waking guardians' paths for the sample
    game.skipTime(game.clock.timeLeft + 0.1);
    game.advance(2);
    const dark = solidCount();
    samples.push({ timeLeft: 'dark', solid: dark.n, of: dark.total });
    const counts = samples.slice(0, -1).map((s) => s.solid);
    const changes = new Set(counts).size > 1;
    return { pass: dark.total === 5 && dark.n === 0 && Math.max(...counts) > 0 && changes, samples };
  }),
);


// ---------------------------------------------------------------- traps (each on a fresh run)
step(
  'catacombs: crumbling floor drops out from under you',
  await g(() => {
    const game = window.__game;
    game.newRun(true);
    game.warp('catacombs');
    game.advance(1.5);
    const before = game.run.crumbled.size;
    game.player.teleport(-55.5, -10.05, -94);
    game.advance(3);
    return { pass: game.run.crumbled.size > before && game.player.feetY < -12, crumbled: game.run.crumbled.size - before, feetY: +game.player.feetY.toFixed(2), health: Math.round(game.player.health) };
  }),
);
step(
  'catacombs: dart corridor plate fires; crouching under the darts avoids them',
  await g(() => {
    const game = window.__game;
    game.newRun(true);
    game.warp('catacombs');
    game.advance(1.5);
    const shoot = (crouch) => {
      game.player.health = 100;
      game.player.teleport(-48, -9.95, -66.5, Math.PI / 2);
      game.advance(0.5);
      if (crouch) game.input.simulate('crouch', true);
      game.advance(0.4);
      game.player.teleport(-52, -9.95, -66.5, Math.PI / 2);
      let darts = 0;
      for (let i = 0; i < 90; i++) {
        game.advance(1 / 60);
        darts = Math.max(darts, game.fx.darts.length);
      }
      game.input.simulate('crouch', false);
      game.advance(0.3);
      return { darts, damage: Math.round(100 - game.player.health) };
    };
    const standing = shoot(false);
    game.advance(4);
    const crouched = shoot(true);
    return { pass: standing.darts > 0 && standing.damage > 0 && crouched.damage < standing.damage, standing, crouched };
  }),
);
step(
  'catacombs: rolling boulder is released by its plate',
  await g(() => {
    const game = window.__game;
    game.newRun(true);
    game.warp('catacombs');
    game.advance(1.5);
    let boulder = null;
    game.physics.world.colliders.forEach((c) => {
      const t = game.physics.tagOf(c);
      if (t && t.kind === 'boulder') boulder = c;
    });
    if (!boulder) return { pass: false, why: 'no boulder collider' };
    const b0 = boulder.translation();
    game.player.teleport(-37, -10.55, -101, -Math.PI / 2);
    game.advance(0.4);
    game.player.teleport(-30, -10.4, -101); // step off and run east
    let maxMove = 0;
    for (let i = 0; i < 8; i++) {
      game.advance(0.5);
      if (game.run.boulderSpent) break;
      const b = boulder.translation();
      maxMove = Math.max(maxMove, Math.hypot(b.x - b0.x, b.z - b0.z));
    }
    return { pass: maxMove > 2 || game.run.boulderSpent, boulderMovedMetres: +maxMove.toFixed(1), spent: game.run.boulderSpent };
  }),
);
step(
  'halls: swinging blades hurt',
  await g(() => {
    const game = window.__game;
    game.newRun(true);
    game.warp('halls');
    game.advance(1.5);
    game.player.health = 100;
    let cause = null;
    for (const z of [-21, -25.5, -30]) {
      game.player.teleport(27, 0.05, z);
      game.advance(2.5);
      if (game.player.health < 100) {
        cause = z;
        break;
      }
    }
    return { pass: game.player.health < 100, health: Math.round(game.player.health), hitAtZ: cause, state: game.state };
  }),
);
step(
  'halls: trapped relic, matching-weight swap does not fire; lifting without one does',
  await g(() => {
    const game = window.__game;
    const T = window.__T;
    game.newRun(true);
    game.warp('halls');
    game.advance(1.5);
    const relicOn = (pid) => {
      for (const [uid, li] of game.items.live) if (li.st.pedestal === pid && li.st.kind === 'relic') return uid;
      return null;
    };
    const trapped = [...game.pedestals.values()].filter((p) => p.trap === 'darts' && relicOn(p.id) && p.pos.y > -1);
    if (trapped.length < 2) return { pass: false, why: 'need two dart pedestals in the halls', found: trapped.map((p) => p.id) };
    // 1) proper swap on the first: spawn a sandbag of the same weight, grab it, E on the relic
    const pa = trapped[0];
    const ua = relicOn(pa.id);
    const wa = game.items.live.get(ua).st.weight;
    const THREE_V = game.player.pos.constructor;
    const bag = game.items.create('sandbag', 'test_bag', new THREE_V(pa.pos.x + 1.6, pa.pos.y - 0.3, pa.pos.z), wa);
    game.advance(0.8);
    const ap1 = T.approachItem('test_bag');
    if (!ap1.ok) return { pass: false, step: 'reach sandbag', ...ap1 };
    game.input.simulate('grab', true);
    game.advance(1 / 60);
    game.input.simulate('grab', false);
    game.advance(0.3);
    const holding = game.items.held && game.items.held.st.uid === 'test_bag';
    const ap2 = T.approachItem(ua);
    if (!ap2.ok) return { pass: false, step: 'reach relic', holding, ...ap2 };
    const dartsBefore = game.fx.darts.length;
    T.pressE();
    let dartsSwap = 0;
    for (let i = 0; i < 60; i++) {
      game.advance(1 / 60);
      dartsSwap = Math.max(dartsSwap, game.fx.darts.length - dartsBefore);
    }
    const tookA = !game.items.live.has(ua) || game.items.live.get(ua).st.gone;
    game.advance(3);
    // 2) greedy grab on the second
    const pb = trapped[1];
    const ub = relicOn(pb.id);
    const ap3 = T.approachItem(ub);
    if (!ap3.ok) return { pass: false, step: 'reach second relic', ...ap3 };
    T.pressE();
    let dartsGreedy = 0;
    for (let i = 0; i < 60; i++) {
      game.advance(1 / 60);
      dartsGreedy = Math.max(dartsGreedy, game.fx.darts.length);
    }
    return { pass: holding && tookA && dartsSwap === 0 && dartsGreedy > 0, holding, swapWeightKg: wa, tookFirst: tookA, dartsAfterSwap: dartsSwap, dartsAfterGreedyGrab: dartsGreedy };
  }),
);
step(
  'catacombs: mount a spare torch in a sconce',
  await g(() => {
    const game = window.__game;
    const T = window.__T;
    game.newRun(true);
    game.warp('catacombs');
    game.advance(1.5);
    const p = game.player.pos;
    const sc = T.interacts(p.x, p.z, 30).filter((s) => s.prompt && s.prompt.includes('spare torch'));
    if (!sc.length) return { pass: false, why: 'no empty sconce near the landing' };
    sc.sort((a, b) => Math.hypot(a.c.x - p.x, a.c.z - p.z) - Math.hypot(b.c.x - p.x, b.c.z - p.z));
    const spares = game.run.spares;
    const ap = T.approach(sc[0].handle);
    if (!ap.ok) return { pass: false, ...ap };
    T.pressE();
    return { pass: game.run.spares === spares - 1 && [...game.run.sconces.values()].some((v) => v > 0), sparesBefore: spares, sparesAfter: game.run.spares, litSconces: [...game.run.sconces.values()].filter((v) => v > 0).length };
  }),
);
step(
  'sanctum: noise brings down debris',
  await g(() => {
    const game = window.__game;
    game.newRun(true);
    game.warp('sanctum');
    game.advance(1.5);
    let maxDebris = 0;
    for (let i = 0; i < 12; i++) {
      const p = game.player.pos;
      game.noise(p.x, p.y, p.z, 1);
      game.advance(0.25);
      maxDebris = Math.max(maxDebris, game.fx.debris.length);
    }
    return { pass: maxDebris > 0, maxDebris, meter: game.sanctumMeter ? Math.round(game.sanctumMeter.value) : null };
  }),
);


// ---------------------------------------------------------------- climbing
const climb = (scene, feet, yaw, seconds) =>
  g(
    ({ scene, feet, yaw, seconds }) => {
      const game = window.__game;
      game.newRun(true);
      game.warp(scene);
      game.advance(1.5);
      game.player.teleport(feet[0], feet[1], feet[2], yaw);
      game.player.pitch = 0.3;
      game.advance(0.3);
      const y0 = game.player.feetY;
      game.input.simulateKey('KeyW', true);
      let climbed = false;
      let mantled = false;
      const track = [];
      for (let i = 0; i < seconds * 4; i++) {
        game.advance(0.25);
        climbed = climbed || !!game.player.climbing;
        mantled = mantled || !!game.player.mantle;
        if (i % 4 === 3) track.push(+game.player.feetY.toFixed(1));
      }
      game.input.simulateKey('KeyW', false);
      game.advance(0.5);
      return { y0: +y0.toFixed(2), y1: +game.player.feetY.toFixed(2), climbed, mantled, track, stamina: Math.round(game.player.stamina), state: game.state };
    },
    { scene, feet, yaw, seconds },
  );
{
  const r = await climb('halls', [-12, -7.95, -23.4], Math.PI, 14);
  step('halls pit: climb the vines out (8 m) and mantle over the top', { pass: r.climbed && r.mantled && r.y1 > -0.5, ...r });
}
{
  const r = await climb('cliffs', [43.6, -7.55, 65.5], Math.PI / 2, 14);
  step('cliffs: climb the vines from the lowest ledge back to the courtyard', { pass: r.climbed && r.y1 > -0.5, ...r });
}


// ---------------------------------------------------------------- ghost replay of the best escaped run
step(
  'ghost: an escaped run is saved and replayed as a ghost on the next run',
  await g(() => {
    const game = window.__game;
    game.newRun(true);
    game.player.teleport(0, 0.1, 168, 0);
    game.input.simulateKey('KeyW', true);
    game.advance(6);
    game.input.simulateKey('KeyW', false);
    const samples = game.run.ghost.length;
    game.endRun('escaped', 'test');
    game.advance(2.5);
    const stored = !!game.save.ghost;
    game.menus.hideAll();
    game.newRun(true);
    game.advance(0.5);
    const m = game.ghostMesh;
    if (!m) return { pass: false, samples, stored, why: 'no ghost mesh on the next run' };
    const a = m.position.clone();
    game.advance(3);
    const moved = m.position.distanceTo(a);
    return { pass: stored && m.visible && moved > 1, samples, stored, visible: m.visible, ghostMovedMetres: +moved.toFixed(1) };
  }),
);

writeFileSync(`${OUT}/mechanics.json`, JSON.stringify({ steps, errors }, null, 2));
console.log(`\n${steps.filter((s) => s.pass).length}/${steps.length} steps passed, ${errors.length} console errors`);
await browser.close();
server.kill();
process.exit(0);
