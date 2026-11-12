// Click through the menus like a player: outfitter purchase, settings, start a run from the
// button, pause with Escape, resume, abandon, results, high scores, back to the menu.
import { launch, st, wait, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 1280, height: 720 });
page.on('dialog', (d) => d.accept());
const fail = [];
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) fail.push(what);
};
// money for the shop
await page.evaluate(() => {
  const g = window.lostTemple.game;
  g.save.money = 5000;
  g.ui.menu();
});
await page.click('#mShop');
await wait(page, 300);
await shot(page, 'menu-shop');
const buyable = await page.$$eval('button[data-buy]:not([disabled])', (bs) => bs.map((b) => b.getAttribute('data-buy')));
console.log('buyable:', buyable);
const before = await page.evaluate(() => window.lostTemple.game.save.money);
await page.click(`button[data-buy="${buyable.includes('satchel') ? 'satchel' : buyable[0]}"]`);
await wait(page, 300);
const after = await page.evaluate(() => ({ money: window.lostTemple.game.save.money, up: window.lostTemple.game.save.upgrades }));
check(after.money < before, `outfitter purchase (${before} -> ${after.money}, upgrades ${JSON.stringify(after.up)})`);
await page.click('#shBack');
await wait(page, 200);
// settings
await page.click('#mSettings');
await wait(page, 200);
await page.$eval('#sFov', (el) => {
  el.value = '95';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.selectOption('#sQual', 'low');
await wait(page, 200);
await shot(page, 'menu-settings');
await page.click('#sBack');
await wait(page, 200);
const set = await page.evaluate(() => window.lostTemple.game.save.settings);
check(set.fov === 95 && set.quality === 'low', `settings saved (fov ${set.fov}, quality ${set.quality})`);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lostTemple.save.v1') || '{}'));
check(stored.settings?.fov === 95, 'settings persisted to localStorage');
// start from the button
await page.click('#mStart');
await page.waitForFunction(() => window.lostTemple.state().state === 'playing', null, { timeout: 180000 });
check(true, 'run started from the menu button');
await wait(page, 1500);
const gear = await page.evaluate(() => ({ cap: window.lostTemple.game.run.state.satchel.capacity }));
console.log('satchel capacity this run:', gear.cap);
// pause with Escape
await page.keyboard.press('Escape');
await wait(page, 800);
let s = await st(page);
check(s.state === 'paused', `Escape pauses (state ${s.state})`);
await shot(page, 'menu-pause');
const remA = s.remaining;
await wait(page, 1500);
s = await st(page);
check(Math.abs(s.remaining - remA) < 0.01, 'clock stops while paused');
await page.click('#pResume');
await wait(page, 800);
s = await st(page);
check(s.state === 'playing', `resume (state ${s.state})`);
// abandon
await page.keyboard.press('Escape');
await wait(page, 800);
await page.click('#pAbandon');
await page.waitForFunction(() => window.lostTemple.state().state === 'results', null, { timeout: 30000 }).catch(() => {});
s = await st(page);
check(s.state === 'results', `abandon leads to results (state ${s.state})`);
await shot(page, 'menu-results');
await page.click('#rScores');
await wait(page, 300);
await shot(page, 'menu-scores');
const rows = await page.$$eval('table.scores tr', (r) => r.length);
check(rows >= 2, `high score table has rows (${rows})`);
await page.click('#hsBack');
await wait(page, 300);
s = await st(page);
console.log('state after scores back:', s.state);
console.log(fail.length ? `MENUS: ${fail.length} FAILED` : 'MENUS: ALL PASS');
console.log('errors:', errors.length ? errors.slice(0, 20).join('\n') : 'none');
await browser.close();
