// Walk across the jungle rope bridge and report how many planks cracked and dropped behind you
// and whether you made it across. `flood` does the catacomb plank bridge over the flooded
// chamber's channel instead: walk over it with a lit torch, then (in a fresh run) stop on it.
// Usage: node scripts/bridge.mjs [run|walk|flood]
import { launch, startRun, st, wait, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
const gait = process.argv[2] || 'walk';
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 480, height: 270 });
await startRun(page, 31337);
if (gait === 'flood') {
  const F = -14;
  let fails = 0;
  const check = (name, ok, extra = '') => {
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
    if (!ok) fails++;
  };
  const planks = () =>
    page.evaluate(() => {
      let out = null;
      window.lostTemple.game.run.scenes.forEachProp((p) => {
        if (p.id === 'floodPlanks' && p.planks) out = p.planks.map((k) => k.timer.state);
      });
      return out;
    });
  const lit = () => page.evaluate(() => window.lostTemple.game.run.state.torch.lit);
  const setup = (p) =>
    page.evaluate(
      ([p]) => {
        const lt = window.lostTemple;
        lt.noGuardians();
        lt.god(true);
        lt.teleport(p, 0);
        lt.look(0, 0);
        lt.light();
      },
      [p],
    );
  // 1. walk straight over from the near steps to the far ones
  await setup([-4, F + 0.1, -100.4]);
  await wait(page, 3000);
  console.log('planks before:', (await planks()).join(','));
  await page.evaluate(() => window.lostTemple.move(0, 1));
  let s = await st(page);
  for (let i = 0; i < 80; i++) {
    await wait(page, 300);
    s = await st(page);
    if (s.pos[2] < -111 || s.mode === 'swim') break;
  }
  await page.evaluate(() => window.lostTemple.stop());
  await wait(page, 2500);
  s = await st(page);
  const after = await planks();
  check('walk over the plank bridge with the torch still lit', s.pos[2] < -110 && (await lit()), `z ${s.pos[2].toFixed(2)}, feet y ${s.feet[1].toFixed(2)}, mode ${s.mode}`);
  check('its planks crack and drop behind you', after.filter((k) => k !== 'intact').length >= 4, after.join(','));
  await page.evaluate(() => window.lostTemple.look(Math.PI, -0.3));
  await wait(page, 1200);
  await shot(page, 'bridge-flood-behind');
  // 2. a fresh run: stop on the second plank
  await startRun(page, 4321);
  await setup([-4, F + 1.0, -103.4]);
  await wait(page, 3000);
  await page.evaluate(() => window.lostTemple.move(0, 1));
  for (let i = 0; i < 40; i++) {
    await wait(page, 150);
    if ((await st(page)).pos[2] < -105.4) break;
  }
  await page.evaluate(() => window.lostTemple.stop());
  const stoodAt = (await st(page)).pos[2];
  await wait(page, 5000);
  s = await st(page);
  check('stop on it and it drops you into the channel, torch and all', (s.mode === 'swim' || s.feet[1] < F + 0.3) && !(await lit()), `stopped at z ${stoodAt.toFixed(2)}; now feet y ${s.feet[1].toFixed(2)}, mode ${s.mode}, planks ${(await planks()).join(',')}`);
  console.log(fails ? `FLOOD BRIDGE: ${fails} FAILED` : 'FLOOD BRIDGE: ALL PASS');
  console.log('errors:', errors.length ? errors.slice(0, 20).join('\n') : 'none');
  await browser.close();
  process.exit(fails ? 1 : 0);
}
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
