// Supplies left in the temple: walk up to each oil flask and spare torch, take it, and check the
// torch gear counts go up. Usage: node scripts/supplies.mjs
import { launch, startRun, st, wait, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 480, height: 270 });
await startRun(page, 99);
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.noGuardians();
  lt.god(true);
});
const F = -14;
const V = -24;
const caches = [
  ['hallsOil', 'oil', [-15.8, 0, -36.2]],
  ['sanctumTorch', 'torch', [-20.4, 0, -84.6]],
  ['footTorch', 'torch', [-12, F, -73.5]],
  ['ossuaryOil', 'oil', [8.5, F, -72]],
  ['anteOil', 'oil', [-31, V, -122.6]],
];
const gear = () => page.evaluate(() => {
  const t = window.lostTemple.game.run.state.torch;
  return { oil: t.oilFlasks, torches: t.spareTorches };
});
let fails = 0;
for (const [id, kind, p] of caches) {
  const before = await gear();
  // stand 1.3 m south of it and look down at it
  await page.evaluate((p) => window.lostTemple.teleport([p[0], p[1] + 0.1, p[2] + 1.3], 0), p);
  await wait(page, 2500);
  let promptText = '';
  for (let i = 0; i < 4 && !/Take the/.test(promptText); i++) {
    await page.evaluate((p) => {
      const lt = window.lostTemple;
      const cam = lt.game.camera.position;
      const dx = p[0] - cam.x, dy = p[1] + 0.25 - cam.y, dz = p[2] - cam.z;
      lt.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    }, p);
    await wait(page, 600);
    promptText = await page.evaluate(() => document.getElementById('prompt')?.textContent || '');
  }
  await shot(page, 'supply-' + id);
  await page.evaluate(() => window.lostTemple.press('interact'));
  await wait(page, 800);
  const after = await gear();
  const ok = kind === 'oil' ? after.oil === before.oil + 1 : after.torches === before.torches + 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: prompt ${JSON.stringify(promptText.split('\n').pop())}, gear ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  if (!ok) fails++;
}
console.log(fails ? `SUPPLIES: ${fails} FAILED` : 'SUPPLIES: ALL PASS');
console.log('errors:', errors.length ? errors.slice(0, 20).join('\n') : 'none');
await browser.close();
process.exit(fails ? 1 : 0);
