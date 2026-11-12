// Trap checks in one run. Damage is recorded instead of applied, so one test can walk into
// every trap: the halls urn pedestal (swap in a sandbag: nothing; lift the sandbag back off:
// darts), a crumbling aisle tile, a dart-corridor plate, the swinging blades (standing and
// crouched), the Sun Idol (the sanctum falls in) and the vault boulder.
// Usage: node scripts/traps.mjs
import { launch, startRun, st, wait, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 480, height: 270 });
await startRun(page, 4242);
let fails = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!ok) fails++;
};
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.noGuardians();
  lt.speed(2);
  const g = lt.game;
  window.__dmg = [];
  g.damage = (a, c) => window.__dmg.push([Math.round(a), c]);
});
const takeDamage = () => page.evaluate(() => window.__dmg.splice(0));
const lookAt = (t) =>
  page.evaluate((t) => {
    const lt = window.lostTemple;
    const cam = lt.game.camera.position;
    const dx = t[0] - cam.x, dy = t[1] - cam.y, dz = t[2] - cam.z;
    lt.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  }, t);
const prompt = () => page.evaluate(() => document.getElementById('prompt')?.textContent || '');
const prop = (id, fn) => page.evaluate(([id, fn]) => {
  let out = null;
  window.lostTemple.game.run.scenes.forEachProp((p) => {
    if (p.id === id) out = new Function('p', 'return ' + fn)(p);
  });
  return out;
}, [id, fn]);
const objects = () =>
  page.evaluate(() =>
    [...window.lostTemple.game.run.relics.live.values()].map((l) => {
      const t = l.body.translation();
      return { uid: l.rec.uid, model: l.rec.model, mass: l.rec.mass, state: l.rec.state, pos: [t.x, t.y, t.z], handle: l.body.handle };
    }),
  );
const heldHandle = () => page.evaluate(() => window.lostTemple.game.run.player.held?.body.handle ?? null);

// ---- 1. the urn pedestal in the broken halls ----
await page.evaluate(() => window.lostTemple.teleport([-15.6, 0.1, -48.4], Math.PI / 2));
await wait(page, 2500);
let objs = await objects();
const urn = objs.find((o) => o.uid === 'h5');
const bags = objs.filter((o) => o.model === 'sandbag').sort((a, b) => Math.abs(a.mass - urn.mass) - Math.abs(b.mass - urn.mass));
const bag = bags[0];
console.log(`urn ${urn.mass.toFixed(2)} kg; closest sandbag ${bag.uid} ${bag.mass} kg at ${bag.pos.map((v) => v.toFixed(1))}`);
await page.evaluate((p) => window.lostTemple.teleport([p[0] + 1.4, 0.1, p[2]], Math.PI / 2), bag.pos);
for (let i = 0; i < 6 && (await heldHandle()) !== bag.handle; i++) {
  await wait(page, 800);
  const now = (await objects()).find((o) => o.uid === bag.uid);
  await lookAt(now.pos);
  await wait(page, 500);
  if (!/Sandbag/.test(await prompt())) continue;
  await page.evaluate(() => window.lostTemple.press('grab'));
  await wait(page, 800);
}
check('grab the sandbag', (await heldHandle()) === bag.handle);
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.teleport([0, 0.1, -40.9], 0);
  lt.game.run.player.held?.body.setTranslation({ x: 0, y: 1.6, z: -41.4 }, true);
});
await wait(page, 900);
await lookAt([0, 1.5, -42]);
await wait(page, 700);
const swapPrompt = await prompt();
check('swap prompt shows', /Swap/.test(swapPrompt), JSON.stringify(swapPrompt));
await page.evaluate(() => window.lostTemple.press('interact'));
await wait(page, 2500);
check('swap leaves the trap armed', (await prop('urnPedestal', 'p.fired')) === false);
check('holding the urn after the swap', (await heldHandle()) === urn.handle);
await shot(page, 'traps-1-swapped');
await page.evaluate(() => window.lostTemple.press('drop'));
await wait(page, 900);
await lookAt([0, 1.55, -42]);
await wait(page, 400);
await page.evaluate(() => window.lostTemple.press('grab'));
await wait(page, 2500);
const dmgUrn = await takeDamage();
check('lifting the sandbag back off fires the trap', (await prop('urnPedestal', 'p.fired')) === true);
check('the darts hit the thief at the pedestal', dmgUrn.length > 0, JSON.stringify(dmgUrn));
await shot(page, 'traps-2-darts');
await page.evaluate(() => window.lostTemple.press('drop'));

// ---- 2. crumbling aisle ----
await page.evaluate(() => window.lostTemple.teleport([-13, 0.1, -56.75], 0));
let tiles = [];
for (let i = 0; i < 20; i++) {
  await wait(page, 500);
  tiles = await prop('aisle', "p.tiles.map((t) => (t ? t.timer.state : 'gone'))");
  if (tiles.some((t) => t === 'fallen' || t === 'gone')) break;
}
check('a tile you stand on breaks', tiles.some((t) => t === 'fallen' || t === 'gone'), tiles.join(','));
await wait(page, 2500);
const tileY = await prop('aisle', 'p.tiles[4] ? p.tiles[4].body.translation().y : null');
const dmgPit = await takeDamage();
check('and you drop onto the spikes below', dmgPit.some((d) => /spikes/.test(d[1])), `${JSON.stringify(dmgPit)}, tile y ${tileY === null ? 'removed' : tileY.toFixed(2)}`);

// ---- 3. dart corridor plates (catacombs): standing on one, then walking across another ----
await page.evaluate(() => window.lostTemple.teleport([-12.5, -13.9, -99.8], -Math.PI / 2));
await wait(page, 2500);
const dmgPlate = await takeDamage();
check('a dart-corridor plate fires on the thief standing on it', dmgPlate.length > 0, JSON.stringify(dmgPlate));
await page.evaluate(() => window.lostTemple.teleport([-14.4, -13.9, -98.2], Math.PI / 2));
await wait(page, 2500);
await takeDamage();
await page.evaluate(() => window.lostTemple.move(0, 1));
for (let i = 0; i < 40; i++) {
  await wait(page, 250);
  if ((await st(page)).pos[0] < -17.6) break;
}
await page.evaluate(() => window.lostTemple.stop());
await wait(page, 600);
const xEnd = (await st(page)).pos[0];
check('the corridor is open under the seal stairs', xEnd < -17.6, 'x ' + xEnd.toFixed(2));
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.light();
  lt.look(Math.PI / 2, 0);
});
await wait(page, 1500);
await shot(page, 'traps-corridor-west');
const dmgWalk = await takeDamage();
check('walking across a plate costs a dart or a few, not a pincushion', dmgWalk.length >= 1 && dmgWalk.length <= 4, JSON.stringify(dmgWalk));

// ---- 4. swinging blades: chest-high over the halls beam, head-high around the vault dais ----
await page.evaluate(() => window.lostTemple.teleport([-11, 0.1, -26.5], 0));
await wait(page, 3500);
const dmgStand = await takeDamage();
check('a halls blade cuts a standing thief', dmgStand.some((d) => /blade/.test(d[1])), JSON.stringify(dmgStand));
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.teleport([-9, -23.9, -130], 0);
  lt.press('crouch', true);
});
await wait(page, 4500);
const s4 = await st(page);
const dmgCrouch = await takeDamage();
check('crouching ducks under a head-high vault blade', !dmgCrouch.some((d) => /blade/.test(d[1])), `${JSON.stringify(dmgCrouch)} feet y ${s4.feet[1].toFixed(2)}`);
await page.evaluate(() => window.lostTemple.release('crouch'));
await wait(page, 4500);
const dmgVaultStand = await takeDamage();
check('standing up there gets you cut', dmgVaultStand.some((d) => /blade/.test(d[1])), JSON.stringify(dmgVaultStand));

// ---- 5. the Sun Idol ----
await page.evaluate(() => window.lostTemple.teleport([0, 0.6, -86.4], 0));
await wait(page, 2500);
objs = await objects();
const idol = objs.find((o) => o.uid === 'sunIdol');
await lookAt(idol.pos);
await wait(page, 500);
await page.evaluate(() => window.lostTemple.press('grab'));
await wait(page, 1500);
let s5 = await st(page);
check('taking the idol sets idolTaken', s5.flags.includes('idolTaken'));
await wait(page, 6000);
const collapsed = await prop('sanctumCeiling', 'p.collapsed.size');
const dmgIdol = await takeDamage();
check('the sanctum ceiling comes down', collapsed > 0, `${collapsed} sections; damage ${JSON.stringify(dmgIdol)}`);
await shot(page, 'traps-3-collapse');
await page.evaluate(() => window.lostTemple.press('drop'));

// ---- 6. the vault boulder ----
await page.evaluate(() => window.lostTemple.teleport([29, -19.9, -110.5], Math.PI));
await wait(page, 4000);
const b0 = await prop('aqueductBoulder', '({ x: p.start.x, y: p.start.y, z: p.start.z })');
const b1 = await prop('aqueductBoulder', 'p.body ? p.body.translation() : null');
const dmgBoulder = await takeDamage();
const moved = b0 && (!b1 || Math.hypot(b1.x - b0.x, b1.z - b0.z) > 1);
check('the plate releases the boulder and it rolls', !!moved, `from ${b0 && b0.z.toFixed(1)} to ${b1 ? b1.z.toFixed(1) : 'smashed'}; damage ${JSON.stringify(dmgBoulder)}`);

console.log(fails ? `TRAPS: ${fails} FAILED` : 'TRAPS: ALL PASS');
console.log('errors:', errors.length ? errors.slice(0, 20).join('\n') : 'none');
await browser.close();
process.exit(fails ? 1 : 0);
