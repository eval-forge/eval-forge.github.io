// Zone C must have zero ambient light: with the torch out and no sconce lit, every pixel of the
// 3D canvas is black (0,0,0). Checks several spots and view directions in the catacombs and
// the vault, at noon and at sunset, then lights the torch to prove the check can see light.
import { launch, startRun, st, wait, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 480, height: 270 });
await startRun(page, 4242);
await page.evaluate(() => {
  window.lostTemple.noGuardians();
  window.lostTemple.god(true);
});
const spots = [
  ['catacombs', 'catacombs'],
  ['catacombs-room', [6, -13.9, -69]],
  ['vault', 'vault'],
  ['vault-mid', [-8, -23.9, -135]],
];
let failures = 0;
for (const timeLeft of [420, 70]) {
  await page.evaluate((t) => window.lostTemple.setTime(t), timeLeft);
  for (const [name, where] of spots) {
    await page.evaluate((w) => {
      const lt = window.lostTemple;
      lt.teleport(w);
      lt.snuff();
    }, where);
    await wait(page, 1500);
    for (const [yaw, pitch] of [[0, 0], [1.6, 0.3], [3.1, -0.4], [-1.6, 0.6]]) {
      await page.evaluate(([y, p]) => window.lostTemple.look(y, p), [yaw, pitch]);
      await wait(page, 400);
      const s = await st(page);
      const r = await page.evaluate(() => window.lostTemple.litPixels());
      const ok = r.lit === 0;
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"} t-${timeLeft}s ${name} yaw ${yaw} feetY=${s.feet[1].toFixed(1)} scene=${s.scene} camDark=${s.camDark} litPixels=${r.lit}/${r.total} max=${r.max}`);
      if (!ok) await shot(page, `dark-fail-${name}-${timeLeft}-${yaw}`);
    }
  }
}
// sanity: the torch lights things
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.teleport('catacombs');
  lt.light();
  lt.look(0, -0.2);
});
await wait(page, 1500);
const lit = await page.evaluate(() => window.lostTemple.litPixels());
console.log(`torch lit: litPixels=${lit.lit}/${lit.total} max=${lit.max} (${lit.lit > 0 ? 'PASS' : 'FAIL'}: the check can see light)`);
if (!(lit.lit > 0)) failures++;
console.log(failures ? `ZONE C DARKNESS: ${failures} FAILURES` : 'ZONE C DARKNESS: ALL PASS');
console.log('errors:', errors.length ? errors.slice(0, 30).join('\n') : 'none');
await browser.close();
process.exit(failures ? 1 : 0);
