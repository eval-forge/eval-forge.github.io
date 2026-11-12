// Scripted short heist: pick up a courtyard relic with E, bank it in the haul cart, leave the
// temple, and check the results screen and the saved high score.
import { launch, startRun, st, wait, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 640, height: 360 });
await startRun(page, 777);

const lookAt = (target) =>
  page.evaluate((t) => {
    const lt = window.lostTemple;
    const cam = lt.game.camera.position;
    const dx = t[0] - cam.x, dy = t[1] - cam.y, dz = t[2] - cam.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    lt.look(yaw, pitch);
  }, target);

const relics = await page.evaluate(() => {
  const run = window.lostTemple.game.run;
  return [...run.relics.live.values()].map((l) => ({ uid: l.rec.uid, type: l.rec.type, scene: l.rec.scene, value: l.rec.value, mass: l.rec.mass, pos: l.body.translation() }));
});
const bySene = {};
for (const r of relics) bySene[r.scene] = (bySene[r.scene] || 0) + 1;
console.log('live relics by scene', bySene);
const court = relics.filter((r) => r.scene === 'courtyard' && r.mass < 6).sort((a, b) => Math.hypot(a.pos.x + 14, a.pos.z - 4.5) - Math.hypot(b.pos.x + 14, b.pos.z - 4.5));
if (!court.length) throw new Error('no courtyard relics');
const target = court[0];
console.log('target', target);

// stand next to it and pick it up
await page.evaluate((p) => {
  const lt = window.lostTemple;
  lt.teleport([p.x + 1.4, p.y + 0.3, p.z + 0.2]);
}, target.pos);
await wait(page, 1500);
const tp = await page.evaluate((uid) => window.lostTemple.game.run.relics.live.get(uid).body.translation(), target.uid);
await lookAt([tp.x, tp.y, tp.z]);
await wait(page, 800);
console.log('prompt:', await page.evaluate(() => document.getElementById('prompt')?.textContent));
await shot(page, 'heist-1-look');
await page.evaluate(() => window.lostTemple.press('interact'));
await wait(page, 1200);
let s = await st(page);
console.log('satchel', s.satchel, 'carried', s.carried);
if (!s.satchel.length) console.log('!! stash failed');

// to the cart
await page.evaluate(() => window.lostTemple.teleport([-14, 0.2, 6.7], 0));
await wait(page, 1500);
await lookAt([-14, 1.3, 4.5]);
await wait(page, 800);
console.log('cart prompt:', await page.evaluate(() => document.getElementById('prompt')?.textContent));
await page.evaluate(() => window.lostTemple.press('interact'));
await wait(page, 1200);
s = await st(page);
console.log('banked', s.banked, 'carried', s.carried);
await shot(page, 'heist-2-banked');
await wait(page, 600);
console.log('cart prompt after bank:', await page.evaluate(() => document.getElementById('prompt')?.textContent));
await page.evaluate(() => window.lostTemple.press('interact', true));
for (let i = 0; i < 40; i++) {
  await wait(page, 500);
  const ss = await st(page);
  if (ss.state !== 'playing') break;
}
await page.evaluate(() => window.lostTemple.release('interact'));
await page.waitForFunction(() => window.lostTemple.state().state === 'results', null, { timeout: 60000 }).catch(() => console.log('!! no results screen'));
await shot(page, 'heist-3-results');
console.log('results text:', (await page.evaluate(() => document.querySelector('.screen')?.innerText || '')).replace(/\n+/g, ' | ').slice(0, 600));
console.log('save:', await page.evaluate(() => localStorage.getItem('lostTemple.save.v1')?.slice(0, 400)));
console.log('errors:', errors.length ? errors.slice(0, 30).join('\n') : 'none');
await browser.close();
