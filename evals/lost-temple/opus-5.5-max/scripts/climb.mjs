// The optional cliffs on foot: mantle up three ledges, climb the vines onto the fourth and then
// up to the plateau. Then a throw: pick up a sandbag in the halls and fling it.
// Usage: node scripts/climb.mjs
import { launch, startRun, st, wait, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 480, height: 270 });
await startRun(page, 5150);
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.noGuardians();
  lt.god(true);
  lt.setTime(600);
});
let fails = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!ok) fails++;
};

/**
 * Stand at `from` facing `yaw` and walk at the face, leaning into the wind (it blows off the cliff,
 * toward +z), pressing jump once the face is within reach (or just walk on, for vines), until the
 * feet are above `minY`.
 */
async function ascend(name, from, yaw, minY, jump, lean = 0) {
  await page.evaluate(([p, y, lean]) => {
    const lt = window.lostTemple;
    lt.stop();
    lt.teleport(p, y);
    lt.look(y, 0.2);
    // lean into the wind while settling too: a gust can push a thief who stands still off a ledge
    if (lean) lt.move(lean, 0);
  }, [from, yaw, lean]);
  await wait(page, 1800);
  await page.evaluate((lean) => window.lostTemple.move(lean, 1), lean);
  let s = await st(page);
  let maxMode = s.mode;
  for (let i = 0; i < 45; i++) {
    if (jump) {
      const near = await page.evaluate(() => {
        const lt = window.lostTemple;
        const pl = lt.game.run.player;
        const fwd = pl.forward(new lt.THREE.Vector3());
        const hit = lt.game.run.physics.raycast(new lt.THREE.Vector3(pl.pos.x, pl.feetY + 1.0, pl.pos.z), fwd, 2, undefined, pl.collider);
        return pl.grounded && hit && hit.toi < pl.radius + 0.6;
      });
      if (near) await page.evaluate(() => window.lostTemple.press('jump'));
    }
    await wait(page, 250);
    s = await st(page);
    if (s.mode === 'climb' || s.mode === 'mantle') maxMode = s.mode;
    if (s.feet[1] > minY && s.mode === 'walk') break;
  }
  await page.evaluate(() => window.lostTemple.stop());
  await wait(page, 400);
  s = await st(page);
  check(name, s.feet[1] > minY, `feet y ${s.feet[1].toFixed(2)} (needs > ${minY}), went through ${maxMode}`);
  return s;
}

await page.evaluate(() => window.lostTemple.teleport([59, 0.1, 22], 0));
await wait(page, 3000);
// yaw 0 faces north (-z), PI/2 faces west (-x)
await ascend('mantle onto the first ledge (2.0 m)', [59, 0.1, 20.2], 0, 1.8, true);
await ascend('mantle onto the second ledge (4.2 m)', [57.2, 2.1, 17.0], Math.PI / 2, 4.0, true, 0.45);
await ascend('mantle onto the third ledge (6.3 m)', [51.2, 4.3, 16.9], Math.PI / 2, 6.1, true, 0.45);
await shot(page, 'climb-ledges');
await ascend('climb the vines onto the fourth ledge (11 m)', [44.8, 6.4, 17.0], Math.PI / 2, 10.8, false, 0.45);
await ascend('climb the vines up to the plateau (14 m)', [40, 11.1, 17.2], 0, 13.8, false);
await shot(page, 'climb-plateau');

// throw a sandbag in the halls
await page.evaluate(() => window.lostTemple.teleport([-16.2, 0.1, -48.2], Math.PI / 2));
await wait(page, 3000);
const bag = await page.evaluate(() => {
  for (const l of window.lostTemple.game.run.relics.live.values()) if (l.rec.uid === 'sandbag2') {
    const t = l.body.translation();
    return [t.x, t.y, t.z];
  }
  return null;
});
let held = false;
for (let i = 0; i < 5 && !held; i++) {
  await page.evaluate((p) => {
    const lt = window.lostTemple;
    const cam = lt.game.camera.position;
    const dx = p[0] - cam.x, dy = p[1] - cam.y, dz = p[2] - cam.z;
    lt.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  }, bag);
  await wait(page, 500);
  await page.evaluate(() => window.lostTemple.press('grab'));
  await wait(page, 700);
  held = await page.evaluate(() => !!window.lostTemple.game.run.player.held);
}
check('pick up a sandbag', held);
await page.evaluate(() => window.lostTemple.look(-Math.PI / 2, 0.25));
await wait(page, 600);
const bagPos = () =>
  page.evaluate(() => {
    for (const l of window.lostTemple.game.run.relics.live.values()) if (l.rec.uid === 'sandbag2') {
      const t = l.body.translation();
      return [t.x, t.y, t.z];
    }
    return null;
  });
const p0 = await bagPos();
await page.evaluate(() => window.lostTemple.press('grab'));
await wait(page, 2500);
const p1 = await bagPos();
const stillHeld = await page.evaluate(() => !!window.lostTemple.game.run.player.held);
const flight = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
check('click again throws it', !stillHeld && flight > 2.5, `flew ${flight.toFixed(1)} m`);

console.log(fails ? `CLIMB: ${fails} FAILED` : 'CLIMB: ALL PASS');
console.log('errors:', errors.length ? errors.slice(0, 20).join('\n') : 'none');
await browser.close();
process.exit(fails ? 1 : 0);
