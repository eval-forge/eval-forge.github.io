/**
 * Shared Playwright harness for the browser-level playtests.
 * Usage: node playtest/<script>.cjs   (with `npm run dev` running on :5173)
 */
const { chromium } = require('playwright');
const path = require('path');

const URL = process.env.LT_URL || 'http://localhost:5173/';
const SHOTS = path.join(__dirname, 'shots');

async function open({ width = 1280, height = 720, gpu = false } = {}) {
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'];
  if (gpu) args.length = 0;
  const browser = await chromium.launch({ args });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__lt && window.__lt.game.state === 'menu', null, { timeout: 120000 });
  return { browser, page, errors };
}

/** Freeze the game on a freshly drawn frame, capture it, let it run again. */
async function shot(page, name) {
  await page.evaluate(() => __lt.freeze(true));
  await page.waitForTimeout(120);
  try {
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), timeout: 60000 });
  } finally {
    await page.evaluate(() => __lt.freeze(false));
  }
}
/** The 3D canvas only (no HUD), read straight from WebGL: fast and reliable in headless. */
async function view(page, name) {
  const url = await page.evaluate(() => __lt.capture());
  require('fs').writeFileSync(path.join(SHOTS, `${name}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
}

const lt = (page, fn, arg) => page.evaluate(fn, arg);

module.exports = { open, shot, view, lt, SHOTS };
