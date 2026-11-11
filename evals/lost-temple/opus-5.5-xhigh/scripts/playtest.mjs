/**
 * Automated headless playtest: builds nothing, serves ./dist with `vite preview`, drives
 * the game through window.__game, takes screenshots of every scene, measures frame
 * times and checks that Zone C is truly black outside the torch.
 *
 *   npm run build && npm run playtest
 *
 * Headless Chromium renders WebGL with SwiftShader (CPU), so the FPS figures it reports
 * are a lower bound, not what a GPU gets.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const OUT = 'playtest-output';
mkdirSync(OUT, { recursive: true });
const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => {
  server.stdout.on('data', (d) => d.toString().includes(String(PORT)) && res());
  setTimeout(res, 8000);
});

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const report = { scenes: {}, checks: {}, errors };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const g = (fn, arg) => page.evaluate(fn, arg);
async function shot(path) {
  const t = Date.now();
  try {
    await page.screenshot({ path, timeout: 120000 });
  } catch (e) {
    errors.push(`[screenshot] ${path}: ${e.message.split('\n')[0]}`);
  }
  report.shotMs = (report.shotMs ?? []).concat(Date.now() - t);
}

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
await sleep(1500);
await shot(`${OUT}/00-menu.png`);

// start a run without pointer lock
await g(() => {
  const game = window.__game;
  game.autopilot = true;
  game.menus.hideAll();
  game.newRun(true);
});
await sleep(2500);
await shot(`${OUT}/01-jungle-start.png`);

async function sample(label, ms = 3000) {
  await g(() => {
    window.__fpsSamples = [];
    window.__fpsTimer = setInterval(() => window.__fpsSamples.push(window.__game.frameMs), 100);
  });
  const t0 = await g(() => ({ frames: window.__game.time }));
  await sleep(ms);
  const s = await g(() => {
    clearInterval(window.__fpsTimer);
    const game = window.__game;
    const info = game.renderer.info.render;
    return {
      fps: game.fps,
      cpuFrameMs: window.__fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, window.__fpsSamples.length),
      drawCalls: info.calls,
      triangles: info.triangles,
      bodies: game.physics.bodyCount(),
      colliders: game.physics.colliderCount(),
      scene: game.scenes.current,
      loaded: [...game.scenes.loaded.keys()],
      exposure: game.exposure,
      state: game.state,
      pos: game.player.pos.toArray().map((v) => +v.toFixed(2)),
    };
  });
  report.scenes[label] = s;
  return s;
}

console.log('jungle', await sample('jungle'));

// ---- bridge physics: walk north across it (simulated at 60 Hz without rendering)
report.checks.bridge = await g(() => {
  const game = window.__game;
  game.player.teleport(0, 0.1, 101.5, 0);
  game.player.pitch = -0.2;
  game.input.simulateKey('KeyW', true);
  const track = [];
  for (let i = 0; i < 12; i++) {
    game.advance(0.5);
    track.push(+game.player.pos.z.toFixed(1));
  }
  game.input.simulateKey('KeyW', false);
  game.advance(10);
  return { track, z: game.player.pos.z, broken: game.run.brokenPlanks.size, collapsed: game.run.bridgeCollapsed, state: game.state, health: game.player.health, scene: game.scenes.current };
});
console.log('bridge', report.checks.bridge);
await shot(`${OUT}/02-after-bridge.png`);

// ---- courtyard: stone block onto the plate opens the great door
await g(() => {
  const game = window.__game;
  if (game.state !== 'playing') {
    game.menus.hideAll();
    game.newRun(true);
  }
  game.warp('courtyard');
  game.advance(1);
});
await sleep(1500);
await shot(`${OUT}/03-courtyard.png`);
console.log('courtyard', await sample('courtyard'));
report.checks.greatDoor = await g(() => {
  const game = window.__game;
  const b = game.blockBody;
  if (!b) return { error: 'no block body' };
  // push it the real way: stand east of it and walk west into it
  const t = b.translation();
  game.player.teleport(t.x + 1.7, 0.05, t.z, Math.PI / 2);
  game.input.simulateKey('KeyW', true);
  game.advance(6);
  game.input.simulateKey('KeyW', false);
  const after = b.translation();
  const pushed = t.x - after.x;
  if (!game.run.flags.greatDoorOpen) {
    b.setTranslation({ x: 8, y: 1.2, z: 10 }, true);
    game.advance(2);
  }
  return { pushedMetres: +pushed.toFixed(2), greatDoorOpen: game.run.flags.greatDoorOpen };
});
console.log('door', report.checks.greatDoor);

// ---- loot: take a courtyard relic, carry it out of the door, it gets stashed
report.checks.loot = await g(() => {
  const game = window.__game;
  const li = [...game.items.live.values()].find((l) => l.st.kind === 'relic' && l.st.scene === 'courtyard' && !l.st.pedestal);
  if (!li) return { error: 'no loose courtyard relic' };
  game.items.interact(li.st.uid);
  const carried = game.run.carriedValue();
  game.player.teleport(0, 0.05, 6, 0);
  game.advance(1);
  return { carried, stash: game.run.stashValue(), carriedAfter: game.run.carriedValue() };
});
console.log('loot', report.checks.loot);

// ---- every scene
await g(() => window.__game.unlockAll());
for (const s of ['cliffs', 'halls', 'sanctum', 'catacombs', 'vault']) {
  await g((s) => window.__game.warp(s), s);
  await sleep(3500);
  await shot(`${OUT}/10-${s}.png`);
  console.log(s, await sample(s));
}

// ---- the expedition map after the tour (it only shows what has been seen)
await g(() => {
  const game = window.__game;
  game.ui.mapOpen = true;
  game.map.setOpen(true);
});
await sleep(800);
await shot(`${OUT}/15-map.png`);
await g(() => {
  const game = window.__game;
  game.ui.mapOpen = false;
  game.map.setOpen(false);
});

// ---- Zone C: torch out, sconces out → the frame must be pure black
async function readFrame() {
  return g(() => {
    const game = window.__game;
    game.renderer.render();
    const gl = game.renderer.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let nonBlack = 0;
    let max = 0;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const m = Math.max(px[i], px[i + 1], px[i + 2]);
      if (m > 0) nonBlack++;
      if (m > max) max = m;
      sum += m;
    }
    return { w, h, nonBlackFraction: nonBlack / (w * h), max, mean: sum / (w * h) };
  });
}
await g(() => {
  const game = window.__game;
  game.warp('catacombs');
  game.run.sconces.clear();
  game.run.torch.douse('player');
  game.player.pitch = 0;
});
await sleep(4000);
report.checks.zoneC_torchOut = await readFrame();
await shot(`${OUT}/20-catacombs-torch-out.png`);
await g(() => {
  const game = window.__game;
  game.run.torch.lit = true;
});
await sleep(1500);
report.checks.zoneC_torchLit = await readFrame();
await shot(`${OUT}/21-catacombs-torch-lit.png`);
await g(() => {
  const game = window.__game;
  game.warp('vault');
  game.run.sconces.clear();
  game.run.torch.douse('player');
});
await sleep(4000);
report.checks.vault_torchOut = await readFrame();
console.log('zone C', report.checks.zoneC_torchOut, report.checks.zoneC_torchLit, report.checks.vault_torchOut);

// ---- darkness: guardians wake deepest-first, the door seals you in
await g(() => {
  const game = window.__game;
  game.run.torch.lit = true;
  game.warp('halls');
  game.skipTime(game.clock.timeLeft - 50);
  game.advance(1);
});
await sleep(2500);
await shot(`${OUT}/30-halls-last-minute.png`);
report.checks.lastMinute = await g(() => ({ phase: window.__game.clock.phase, timeLeft: window.__game.clock.timeLeft }));
report.checks.waves = await g(() => {
  const game = window.__game;
  game.skipTime(game.clock.timeLeft + 0.2);
  const out = [];
  for (let t = 0; t < 50; t += 5) {
    game.advance(5);
    out.push({ t: +(game.clock.elapsed - 780).toFixed(1), awake: game.guardians.awakeCount(), states: game.guardians.debugStates() });
  }
  return out;
});
console.log('waves', report.checks.waves);
await shot(`${OUT}/31-halls-dark.png`);
report.checks.sealed = await g(() => {
  const game = window.__game;
  game.player.teleport(0, 0.05, -20, 0);
  game.skipTime(40);
  game.advance(3);
  return { state: game.state, outcome: game.lastReport?.outcome, haul: game.lastReport?.settlement.haul, inside: game.player.pos.z };
});
await sleep(1500);
await shot(`${OUT}/32-results.png`);
console.log('sealed', report.checks.sealed);

// ---- guardians hunt: night in the vault with a lit torch
report.checks.hunt = await g(() => {
  const game = window.__game;
  game.menus.hideAll();
  game.newRun(true);
  game.unlockAll();
  game.warp('vault');
  game.run.torch.lit = true;
  game.skipTime(game.clock.timeLeft + 0.5);
  const log = [];
  for (let i = 0; i < 12 && game.state === 'playing'; i++) {
    game.advance(2.5);
    const near = Math.min(...game.guardians.list.map((x) => x.pos.distanceTo(game.player.feet())));
    log.push({ t: (i + 1) * 2.5, nearest: +near.toFixed(1), states: game.guardians.debugStates() });
  }
  game.advance(2.5);
  return { log, state: game.state, outcome: game.lastReport?.outcome ?? game.run.ended };
});
console.log('hunt', JSON.stringify(report.checks.hunt));

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log('errors', errors.slice(0, 30));
await browser.close();
server.kill();
process.exit(0);
