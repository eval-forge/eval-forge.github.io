// Key progression: solve the sundial with the real sun, take the Sun-Disc, set it into the
// sanctum seal, and check the catacomb stairs open. Usage: node scripts/progression.mjs [secondsLeft]
import { launch, startRun, st, wait, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
const timeLeft = Number(process.argv[2] || 520);
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 480, height: 270 });
await startRun(page, 2024);
await page.evaluate((t) => {
  const lt = window.lostTemple;
  lt.setTime(t);
  lt.speed(3);
}, timeLeft);
const lookAt = (target) =>
  page.evaluate((t) => {
    const lt = window.lostTemple;
    const cam = lt.game.camera.position;
    const dx = t[0] - cam.x, dy = t[1] - cam.y, dz = t[2] - cam.z;
    lt.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  }, target);
const prompt = () => page.evaluate(() => document.getElementById('prompt')?.textContent || '');

// 1. the sundial
await page.evaluate(() => window.lostTemple.teleport([0, 0.7, 33.0], 0));
await wait(page, 1500);
await lookAt([0, 1.0, 30]);
await wait(page, 600);
console.log('dial prompt:', JSON.stringify(await prompt()));
const shadow = await page.evaluate(() => {
  const g = window.lostTemple.game;
  let a = null;
  g.run.scenes.forEachProp?.((p) => {
    if (p.id === 'sundial') a = p.shadowAngle();
  });
  return a;
});
console.log('gnomon shadow angle (rad):', shadow);
let solved = false;
for (let i = 0; i < 13 && !solved; i++) {
  await page.evaluate(() => window.lostTemple.press('interact'));
  // the ring turns for 0.6 s and the Eye must then hold the shadow for 1 s, all in game time:
  // wait on the game clock, not the wall clock (software rendering runs at 2 to 5 FPS)
  const r0 = (await st(page)).remaining;
  for (let k = 0; k < 60; k++) {
    await wait(page, 250);
    const s = await st(page);
    solved = s.flags.includes('sundialSolved');
    if (solved || r0 - s.remaining > 2.4) break;
  }
  console.log(`turn ${i + 1}: solved=${solved}`);
}
await shot(page, 'prog-1-sundial');
// 2. the disc rises from the north face of the plinth
await wait(page, 2500);
await page.evaluate(() => window.lostTemple.teleport([0, 0.7, 25], Math.PI));
await wait(page, 1200);
await lookAt([0, 1.2, 26.5]);
await wait(page, 600);
console.log('disc prompt:', JSON.stringify(await prompt()));
await page.evaluate(() => window.lostTemple.press('interact'));
await wait(page, 1000);
let s = await st(page);
console.log('items:', s.items);
await shot(page, 'prog-2-disc');
// 3. the seal in the sanctum
await page.evaluate(() => window.lostTemple.teleport([-12.5, 0.1, -92.6], Math.PI));
await wait(page, 2500);
await lookAt([-12.5, 1.1, -94.5]);
await wait(page, 600);
console.log('seal prompt:', JSON.stringify(await prompt()));
await page.evaluate(() => window.lostTemple.press('interact'));
await wait(page, 4000);
s = await st(page);
console.log('flags:', s.flags, 'items:', s.items);
await shot(page, 'prog-3-seal');
console.log(s.flags.includes('sealOpen') ? 'PROGRESSION: PASS' : 'PROGRESSION: FAIL');
console.log('errors:', errors.length ? errors.slice(0, 20).join('\n') : 'none');
await browser.close();
