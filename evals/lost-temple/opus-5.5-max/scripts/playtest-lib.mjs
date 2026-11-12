/**
 * Shared helpers for the headless play tests. Chromium runs WebGL 2 through SwiftShader
 * (software rendering), so frame rates measured here are far below a real GPU; the scripts
 * report them for comparison between zones, and also the JS-side frame cost.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

// Playwright is not a project dependency (the game does not need it); use a local copy if one
// is installed, otherwise the global one.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const req = createRequire(import.meta.url);
  const root = execSync('npm root -g').toString().trim();
  ({ chromium } = req(root + '/playwright'));
}

export const URL_BASE = process.env.LT_URL || 'http://localhost:5173/';

export async function launch({ width = 1280, height = 720, query = 'debug&headless' } = {}) {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text());
  });
  await page.goto(URL_BASE + '?' + query);
  await page.waitForFunction(() => window.lostTemple && window.lostTemple.state().state === 'menu', null, { timeout: 120000 });
  return { browser, page, errors };
}

export async function startRun(page, seed = 1234) {
  await page.evaluate((s) => window.lostTemple.start(s), seed);
  await page.waitForFunction(() => window.lostTemple.state().state === 'playing', null, { timeout: 180000 });
}

export const st = (page) => page.evaluate(() => window.lostTemple.state());

export async function wait(page, ms) {
  await page.waitForTimeout(ms);
}

/** Average FPS over a window of real time (the game's own counter). */
export async function sampleFps(page, ms = 3000) {
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await page.waitForTimeout(250);
    samples.push(await page.evaluate(() => ({ fps: window.lostTemple.fps(), ms: window.lostTemple.frameMs() })));
  }
  const fps = samples.reduce((a, s) => a + s.fps, 0) / samples.length;
  const frameMs = samples.reduce((a, s) => a + s.ms, 0) / samples.length;
  return { fps, frameMs };
}

export async function shot(page, name) {
  const dir = process.env.LT_SHOTS || 'shots';
  await page.screenshot({ path: `${dir}/${name}.png` });
}
