// Darkness: guardians wake deepest-first and hunt; the great door closes. Two scenarios:
//   inside  - hiding in the catacombs with a lit torch: expect a guardian to find you (caught),
//             or the door to shut on you (entombed)
//   outside - standing by the haul cart: expect the door to shut and the run to end as escaped
//   hall    - waiting in the entrance hall with a torch: expect the sweep to catch you
// Usage: node scripts/darkness.mjs inside|outside|hall
import { launch, startRun, st, wait, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
const mode = process.argv[2] || 'inside';
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 400, height: 225 });
await startRun(page, 99);
await page.evaluate((m) => {
  const lt = window.lostTemple;
  if (m === 'inside') {
    // as if the thief had come down through the seal and opened the vault: hide in the
    // catacombs with a burning torch
    for (const f of ['greatDoorOpen', 'sundialSolved', 'sealOpen', 'vaultDoorOpen', 'boneWallBroken']) lt.flag(f);
    lt.teleport([-20, -13.9, -66]);
    lt.light();
  } else if (m === 'hall') {
    // waiting just inside the great door with a burning torch: the sweep comes to you
    lt.flag('greatDoorOpen');
    lt.teleport([2, 0.1, -9], Math.PI);
    lt.light();
  } else {
    lt.teleport([-14, 0.2, 7.5], 0);
  }
  lt.setTime(4);
  lt.speed(4);
}, mode);
const t0 = Date.now();
let lastLine = '';
let sawWake = false;
let shotDone = false;
while (Date.now() - t0 < 600000) {
  await wait(page, 2000);
  const s = await st(page);
  if (s.state !== 'playing') {
    console.log('state ->', s.state);
    break;
  }
  const gs = s.guardians.map((g) => `${g.kind[0]}:${g.spawn}:${g.state}:${Math.hypot(g.pos[0] - s.pos[0], g.pos[1] - s.pos[1], g.pos[2] - s.pos[2]).toFixed(0)}m`).join(' ');
  if (s.guardians.some((g) => g.state !== 'dormant')) sawWake = true;
  const line = `rem ${s.remaining.toFixed(1)} flags[${s.flags.join(',')}] ${gs}`;
  if (line !== lastLine) console.log(line);
  lastLine = line;
  const near = s.guardians.some((g) => Math.hypot(g.pos[0] - s.pos[0], g.pos[2] - s.pos[2]) < 8);
  if (near && !shotDone) {
    await shot(page, `darkness-${mode}-guardian-near`);
    shotDone = true;
  }
}
await page.waitForFunction(() => window.lostTemple.state().state === 'results', null, { timeout: 60000 }).catch(() => console.log('!! no results screen'));
const s = await st(page);
console.log('woke:', sawWake, 'end:', s.state);
const resultsText = (await page.evaluate(() => document.querySelector('.screen')?.innerText || '')).replace(/\n+/g, ' | ');
console.log('results:', resultsText.slice(0, 400));
// what each scenario should end in
const expected = { outside: /^You made it out/, hall: /^Caught/, inside: /^(Caught|Entombed)/ }[mode];
const ok = sawWake && expected.test(resultsText);
console.log(`DARKNESS ${mode.toUpperCase()}: ${ok ? 'PASS' : 'FAIL'} (expected ${expected})`);
await shot(page, `darkness-${mode}-results`);
console.log('errors:', errors.length ? errors.filter((e) => !/ReadPixels/.test(e)).slice(0, 30).join('\n') : 'none');
await browser.close();
