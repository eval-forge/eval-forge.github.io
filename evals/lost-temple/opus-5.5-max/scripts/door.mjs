// The great door: push the east block onto the east plate, stand on the west plate, and check
// the door rises. Shows the push-block physics and the plate mass sums working together.
import { launch, startRun, st, wait, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 480, height: 270 });
await startRun(page, 5150);
const block = () =>
  page.evaluate(() => {
    let p = null;
    window.lostTemple.game.run.scenes.forEachProp((pr) => {
      if (pr.id === 'courtBlockE') p = pr.body.translation();
    });
    return p;
  });
const pushTo = async (axis, target, yaw, side) => {
  // stand behind the block on the far side from the target and walk into it
  for (let tries = 0; tries < 60; tries++) {
    const b = await block();
    const d = target - b[axis];
    if (Math.abs(d) < 0.25) break;
    const behind = axis === 'x' ? [b.x + side * 1.5, 0.2, b.z] : [b.x, 0.2, b.z + side * 1.5];
    await page.evaluate(([p, y]) => {
      const lt = window.lostTemple;
      lt.teleport(p, y);
      lt.move(0, 1);
    }, [behind, yaw]);
    await wait(page, Math.min(2500, 300 + Math.abs(d) * 500));
    await page.evaluate(() => window.lostTemple.move(0, 0));
    await wait(page, 300);
  }
};
const b0 = await block();
console.log('block start', b0);
// west along x to 6, then north along z to 7
await pushTo('x', 6, Math.PI / 2, +1);
console.log('after west push', await block());
await pushTo('z', 7, 0, +1);
const b1 = await block();
console.log('after north push', b1);
let s = await st(page);
console.log('flags so far', s.flags);
// stand on the west plate
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.teleport([-6, 0.2, 7], 0);
});
await wait(page, 3000);
s = await st(page);
console.log('flags', s.flags);
await page.evaluate(() => window.lostTemple.teleport([0, 0.2, 14], 0));
await wait(page, 6000);
await shot(page, 'door-open');
s = await st(page);
console.log(s.flags.includes('greatDoorOpen') ? 'DOOR: PASS' : 'DOOR: FAIL');
console.log('errors:', errors.length ? errors.slice(0, 20).join('\n') : 'none');
await browser.close();
