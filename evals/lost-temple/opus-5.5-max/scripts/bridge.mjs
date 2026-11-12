// Walk across the jungle rope bridge carrying nothing, then again heavy, and report how many
// planks cracked and dropped behind you and whether you made it across.
// Usage: node scripts/bridge.mjs [run|walk]
import { launch, startRun, st, wait, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
const gait = process.argv[2] || 'walk';
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 480, height: 270 });
await startRun(page, 31337);
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.teleport([2, 1.0, 81], 0);
});
await wait(page, 2000);
const planks = () =>
  page.evaluate(() => {
    let out = null;
    window.lostTemple.game.run.scenes.forEachProp((p) => {
      if (p.id === 'gorge' && p.planks) out = p.planks.map((k) => k.timer.state);
    });
    return out;
  });
console.log('planks before:', (await planks()).join(','));
if (gait === 'run') await page.evaluate(() => window.lostTemple.press('sprint', true));
await page.evaluate(() => window.lostTemple.move(0, 1));
for (let i = 0; i < 90; i++) {
  await wait(page, 700);
  const s = await st(page);
  if (process.env.LT_VERBOSE) console.log(JSON.stringify({ z: s.pos[2].toFixed(2), y: s.feet[1].toFixed(2), mode: s.mode, p: (await planks()).map((k) => k[0]).join('') }));
  // (no stopping for pictures mid-bridge: a plank you stand still on drops you)
  if (s.pos[2] < 60 || s.pos[1] < -5 || s.state !== 'playing') break;
}
await page.evaluate(() => {
  window.lostTemple.stop();
  window.lostTemple.release('sprint');
});
const s = await st(page);
const p = await planks();
const counts = p.reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {});
console.log('after:', JSON.stringify(counts), 'player z', s.pos[2].toFixed(1), 'y', s.pos[1].toFixed(1), 'health', s.health.toFixed(0), 'remaining', s.remaining.toFixed(0));
await page.evaluate(() => window.lostTemple.look(Math.PI, -0.25));
await wait(page, 1500);
await shot(page, `bridge-${gait}-behind`);
console.log(s.pos[2] < 62 ? 'CROSSED' : 'DID NOT CROSS');
console.log('errors:', errors.length ? errors.slice(0, 20).join('\n') : 'none');
await browser.close();
