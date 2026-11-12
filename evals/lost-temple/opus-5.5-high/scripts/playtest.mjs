// Headless playtest: boots the game, starts a run, walks, visits every scene,
// checks lighting rules, triggers night, records stats + screenshots.
// Usage: node scripts/playtest.mjs [url] [outDir]   (dev server must be running)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const url = process.argv[2] ?? 'http://localhost:5173/?debug=1';
const out = process.argv[3] ?? 'playtest-out';
const quality = process.env.QUALITY ?? 'low';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 960), height: Number(process.env.H ?? 540) } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
await page.addInitScript((q) => localStorage.setItem('lostTemple.profile.v1', JSON.stringify({ settings: { quality: q } })), quality);
await page.goto(url);
await page.waitForFunction(() => window.__game);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/00-menu.png` });

const g = (fn, arg) => page.evaluate(fn, arg);
const log = (label, st) => console.log(label.padEnd(18), JSON.stringify({ scene: st.scene, pos: st.pos.map((v) => +v.toFixed(2)), hp: +st.health.toFixed(0), fps: +st.fps.toFixed(1), calls: st.calls, tris: st.tris, hemi: +st.hemi.toFixed(3), sun: +st.sun.toFixed(3), sky: st.sky, bodies: st.bodies, prompt: st.prompt, mode: st.mode, outcome: st.outcome, guardians: st.guardians }));

await g(() => window.__game.startRun());
// walk north from camp for 12 s
await g(() => { const G = window.__game; G.hold('forward'); G.simulate(12); G.hold('forward', false); });
log('walk 12s', await g(() => window.__game.stats()));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/01-walk.png` });

const results = {};
for (const s of (process.env.SPOTS ?? 'jungle,courtyard,cliffs,halls,sanctum,catacombs,vault').split(',')) {
  await g((s) => { const G = window.__game; G.tp(s); G.simulate(1); }, s);
  await page.waitForTimeout(Number(process.env.WAIT ?? 2500));
  const st = await g(() => window.__game.stats());
  results[s] = st;
  log(s, st);
  await page.screenshot({ path: `${out}/${s}.png` });
}
// zone C must have zero ambient/sun and no sky
const c = results.catacombs, v = results.vault;
console.log('ZONE C ZERO AMBIENT:', c && v && c.hemi === 0 && c.sun === 0 && !c.sky && v.hemi === 0 && v.sun === 0 && !v.sky);
// night: guardians wake deepest first
await g(() => { const G = window.__game; G.tp('vault'); G.setRemaining(1); G.simulate(4); });
log('night +3s', await g(() => window.__game.stats()));
await g(() => window.__game.simulate(30));
log('night +33s', await g(() => window.__game.stats()));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/night-vault.png` });
fs.writeFileSync(`${out}/stats.json`, JSON.stringify(results, null, 2));
console.log('errors:', errors.slice(0, 30));
await browser.close();
