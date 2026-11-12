// Walk the way in and the way out on foot, steering along the game's own navmesh paths, and
// report every place the thief gets stuck (geometry that blocks a route the navmesh says is
// open). Gates are opened by flags first; guardians are off and damage is ignored.
// Usage: node scripts/route.mjs [in|out|both]
import { launch, startRun, st, wait, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
const which = process.argv[2] || 'both';
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 320, height: 180 });
await startRun(page, 777);
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.noGuardians();
  lt.god(true);
  lt.speed(2);
  lt.setTime(780);
});
const F = -14;
const V = -24;
let stuckTotal = 0;
const openGates = () =>
  page.evaluate(() => {
    for (const f of ['sealOpen', 'vaultDoorOpen', 'aqueductOpen', 'drawbridgeLowered', 'greatDoorOpen']) window.lostTemple.flag(f);
  });


async function walk(name, from, goals) {
  console.log(`== ${name}`);
  await page.evaluate((p) => window.lostTemple.teleport(p), from);
  await wait(page, 3000);
  for (const goal of goals) {
    if (goal === 'kickBoneWall') {
      // the Bone Wall only breaks from the Bone Wing side: three kicks
      await page.evaluate(() => {
        const lt = window.lostTemple;
        lt.stop();
        lt.teleport([28, -13.9, -87.0], Math.PI);
        lt.look(Math.PI, -0.1);
      });
      await wait(page, 1500);
      for (let k = 0; k < 6; k++) {
        if ((await st(page)).flags.includes('boneWallBroken')) break;
        await page.evaluate(() => window.lostTemple.press('kick'));
        await wait(page, 1500);
      }
      const broken = (await st(page)).flags.includes('boneWallBroken');
      console.log(broken ? '  kicked the Bone Wall down' : '  the Bone Wall would not break');
      if (!broken) stuckTotal++;
      continue;
    }
    if (goal === 'waitBoulder') {
      // the plate on the aqueduct landing has let the boulder go: step into the alcove and wait
      // for it to roll down and smash, which opens the upper ramp (to the guardians' paths too)
      await page.evaluate(() => {
        const lt = window.lostTemple;
        lt.stop();
        lt.teleport([32.3, -19.9, -110.5], -Math.PI / 2);
      });
      let cleared = false;
      for (let k = 0; k < 40 && !cleared; k++) {
        await wait(page, 750);
        cleared = await page.evaluate(() => {
          let out = false;
          window.lostTemple.game.run.scenes.forEachProp((p) => {
            if (p.id === 'aqueductBoulder') out = p.released && !p.body;
          });
          return out;
        });
      }
      console.log(cleared ? '  the boulder rolled down the upper ramp and smashed' : '  the boulder never came down');
      if (!cleared) stuckTotal++;
      continue;
    }
    const path = await page.evaluate((g) => {
      const lt = window.lostTemple;
      const f = lt.game.run.player.feet;
      return lt.game.nav.findPath([f.x, f.y, f.z], g);
    }, goal);
    if (!path) {
      console.log(`  no navmesh path to ${goal}`);
      stuckTotal++;
      continue;
    }
    console.log(`  to [${goal.map((v) => v.toFixed(0))}]: ${path.length} waypoints`);
    for (let i = 1; i < path.length; i++) {
      const wp = path[i];
      let best = Infinity;
      let since = 0;
      for (let tick = 0; tick < 400; tick++) {
        const s = await page.evaluate((wp) => {
          const lt = window.lostTemple;
          const pl = lt.game.run.player;
          const dx = wp[0] - pl.pos.x;
          const dz = wp[2] - pl.pos.z;
          lt.look(Math.atan2(-dx, -dz), 0);
          lt.move(0, 1);
          return { d: Math.hypot(dx, dz), dy: wp[1] - pl.feetY, pos: [pl.pos.x, pl.feetY, pl.pos.z], mode: pl.mode };
        }, wp);
        if (s.d < 0.8 && Math.abs(s.dy) < 2) break;
        if (s.d < best - 0.25) {
          best = s.d;
          since = 0;
        } else if (++since > 14) {
          stuckTotal++;
          console.log(`  STUCK at [${s.pos.map((v) => v.toFixed(1))}] heading for [${wp.map((v) => v.toFixed(1))}] (${s.mode})`);
          await shot(page, `route-stuck-${stuckTotal}`);
          await page.evaluate((wp) => window.lostTemple.teleport([wp[0], wp[1] + 0.1, wp[2]]), wp);
          await wait(page, 1200);
          break;
        }
        await wait(page, 200);
      }
    }
    const s = await st(page);
    console.log(`  reached [${s.feet.map((v) => v.toFixed(1))}] scene ${s.scene}`);
  }
  await page.evaluate(() => window.lostTemple.stop());
}

// the closed seal is part of the sanctum floor: walk straight across it
await page.evaluate(() => window.lostTemple.teleport([-17, 0.1, -95.2], Math.PI));
await wait(page, 3000);
await page.evaluate(() => {
  window.lostTemple.look(0, 0);
  window.lostTemple.move(0, 1);
});
for (let i = 0; i < 60; i++) {
  await wait(page, 200);
  if ((await st(page)).pos[2] < -105) break;
}
await page.evaluate(() => window.lostTemple.stop());
const zSeal = (await st(page)).pos[2];
console.log(zSeal < -105 ? `walked across the closed seal (z ${zSeal.toFixed(1)})` : `STUCK on the closed seal at z ${zSeal.toFixed(1)}`);
if (zSeal >= -105) stuckTotal++;
await openGates();

if (which === 'in' || which === 'both') {
  // from the top of the seal stairs to the heart of the vault
  await walk('way in: seal stairs to the vault', [-17, -0.4, -102.6], [
    [6, F, -69],
    [6, F, -104],
    [-20, F, -99],
    [-28, V, -124],
    [-6, V, -126],
  ]);
}
if (which === 'out' || which === 'both') {
  // the escape: aqueduct (its plate drops the boulder down the upper ramp), Bone Wing, Bone Stair,
  // inner halls, drawbridge, entrance hall, door
  await walk('way out: vault to the great door', [-6, V + 0.1, -126], [
    [22, V, -122],
    [29, -20, -110.5],
    'waitBoulder',
    [29, F, -93],
    'kickBoneWall',
    [28, 0, -50],
    [11, 0, -32],
    [0, 0, -12],
    [0, 0, -4],
  ]);
}
await page.evaluate(() => window.lostTemple.stop());
console.log(stuckTotal ? `ROUTE: stuck ${stuckTotal} time(s)` : 'ROUTE: walked through without getting stuck');
console.log('errors:', errors.length ? errors.slice(0, 20).join('\n') : 'none');
await browser.close();
