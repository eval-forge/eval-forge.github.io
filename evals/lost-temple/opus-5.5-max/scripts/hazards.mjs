// The mechanics the other play tests do not reach, in one run: the halls' sunstone tiles (solid
// only while the sun is on them), noise bringing the sanctum ceiling down, the flooded chamber
// (the channel drowns the torch, swim it and climb onto the island, take the Serpent Key, open
// the serpent door with it), the torch knocked out by a hard landing and torn out by the cliff-top
// wind and relit, a gamepad, and the ghost: bank a relic, leave, start again and watch this run
// walk its route. Damage is recorded instead of applied and guardians are off.
// Usage: node scripts/hazards.mjs
import { launch, startRun, st, wait, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 480, height: 270 });
await startRun(page, 2468);
const F = -14;
const V = -24;
let fails = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!ok) fails++;
};
const prop = (id, fn) =>
  page.evaluate(
    ([id, fn]) => {
      let out = null;
      window.lostTemple.game.run.scenes.forEachProp((p) => {
        if (p.id === id) out = new Function('p', 'return ' + fn)(p);
      });
      return out;
    },
    [id, fn],
  );
const lookAt = (t) =>
  page.evaluate((t) => {
    const lt = window.lostTemple;
    const cam = lt.game.camera.position;
    const dx = t[0] - cam.x, dy = t[1] - cam.y, dz = t[2] - cam.z;
    lt.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  }, t);
const promptText = () => page.evaluate(() => (document.getElementById('prompt')?.textContent || '').replace(/\s+/g, ' ').trim());
const torchEvents = () => page.evaluate(() => window.__torch.splice(0));
const torch = () =>
  page.evaluate(() => {
    const t = window.lostTemple.game.run.state.torch;
    return { lit: t.lit, relighting: t.isRelighting, fuel: Math.round(t.fuel) };
  });
const gameTime = () => page.evaluate(() => window.lostTemple.game.run.state.time);
/** Is there a wall or ledge face right in front of the thief, about knee to waist high? */
const nearFace = () =>
  page.evaluate(() => {
    const lt = window.lostTemple;
    const pl = lt.game.run.player;
    const fwd = pl.forward(new lt.THREE.Vector3());
    const hit = lt.game.run.physics.raycast(new lt.THREE.Vector3(pl.pos.x, pl.feetY + 0.6, pl.pos.z), fwd, 2, undefined, pl.collider);
    return !!hit && hit.toi < pl.radius + 0.5;
  });

await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.noGuardians();
  const g = lt.game;
  window.__dmg = [];
  window.__kills = [];
  window.__torch = [];
  g.damage = (a, c) => window.__dmg.push([Math.round(a), c]);
  // falling into the chasm would end the run: record it and put the thief back on the halls floor
  g.killVolume = (k) => {
    window.__kills.push(k.kind);
    g.run.player.teleport(new lt.THREE.Vector3(0, 0.1, -17));
  };
  const orig = g.onTorchEvents.bind(g);
  g.onTorchEvents = (evs) => {
    for (const e of evs) window.__torch.push(e.type + (e.reason ? ':' + e.reason : ''));
    return orig(evs);
  };
});
const T = {};

// ---- 1. sunstone tiles over the halls chasm ----
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.speed(3);
  lt.teleport([0, 0.1, -17], Math.PI);
});
T.halls = await gameTime();
await wait(page, 3000);
const sweep = [];
for (const rem of [770, 720, 660, 600, 540, 480, 420, 360, 300, 240, 180, 120, 75]) {
  await page.evaluate((r) => window.lostTemple.setTime(r), rem);
  await wait(page, 2500);
  const lit = await prop('sunstones', 'p.stones.map((s) => s.lit)');
  sweep.push({ rem, lit });
  console.log(`  ${String(rem).padStart(3)} s left  ${lit.map((l) => (l ? '#' : '.')).join('')}`);
}
const litCounts = sweep.map((s) => s.lit.filter(Boolean).length);
const patterns = new Set(sweep.map((s) => s.lit.map((l) => (l ? 1 : 0)).join('')));
check('some sunstone tiles turn solid while the sun is on them', litCounts.some((n) => n > 0), 'lit per sample ' + litCounts.join(','));
check('which tiles are solid changes as the sun moves', patterns.size >= 3, `${patterns.size} different patterns`);
let pick = null;
for (const a of sweep) {
  for (let i = 0; i < a.lit.length && !pick; i++) {
    if (!a.lit[i]) continue;
    const b = sweep.find((s) => !s.lit[i]);
    if (b) pick = { i, on: a.rem, off: b.rem };
  }
}
if (pick) {
  const c = await prop('sunstones', `[p.stones[${pick.i}].center.x, p.stones[${pick.i}].center.z]`);
  await page.evaluate((r) => window.lostTemple.setTime(r), pick.on);
  await wait(page, 2500);
  const litNow = await prop('sunstones', `p.stones[${pick.i}].lit`);
  await page.evaluate((c) => window.lostTemple.teleport([c[0], 0.15, c[1]], Math.PI), c);
  await wait(page, 3000);
  let s = await st(page);
  const kills0 = await page.evaluate(() => window.__kills.length);
  check('a sunlit sunstone holds you up', litNow && s.feet[1] > -0.3 && kills0 === 0, `tile ${pick.i} lit ${litNow}, feet y ${s.feet[1].toFixed(2)}`);
  await shot(page, 'hazards-1-sunstone');
  await page.evaluate((r) => window.lostTemple.setTime(r), pick.off);
  let fell = false;
  for (let k = 0; k < 24 && !fell; k++) {
    await wait(page, 500);
    s = await st(page);
    fell = s.feet[1] < -1 || (await page.evaluate(() => window.__kills.length)) > kills0;
  }
  check('when the sun leaves it, the tile fades and drops you into the chasm', fell, `kills ${JSON.stringify(await page.evaluate(() => window.__kills))}`);
} else check('a tile that is lit at one time is dark at another', false);

// ---- 2. noise brings the sanctum ceiling down ----
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.setTime(560);
  lt.teleport([16, 0.1, -86], 0);
});
T.sanctum = await gameTime();
await wait(page, 3000);
const strain = () => prop('sanctumCeiling', "p.strain.sections.map((s) => (s.state === 'stable' ? +s.strain.toFixed(1) : s.state))");
const collapsed = () => prop('sanctumCeiling', 'p.collapsed.size');
async function pace(ms, how, stopWhen) {
  await page.evaluate((how) => {
    const lt = window.lostTemple;
    lt.press(how, true);
    lt.move(0, 1);
  }, how);
  const t0 = Date.now();
  let dir = 0;
  while (Date.now() - t0 < ms) {
    await page.evaluate((d) => window.lostTemple.look(d ? Math.PI : 0, 0), dir);
    dir ^= 1;
    await wait(page, 1500);
    if (stopWhen && (await stopWhen())) break;
  }
  await page.evaluate((how) => {
    const lt = window.lostTemple;
    lt.stop();
    lt.release(how);
  }, how);
}
const c0 = await collapsed();
await pace(15000, 'crouch');
const quiet = await strain();
check('crouch-walking under the cracked ceiling stays quiet', (await collapsed()) === c0 && quiet.every((v) => typeof v === 'number' && v < 3), 'strain ' + JSON.stringify(quiet));
const tLoud = await gameTime();
await pace(50000, 'sprint', async () => (await collapsed()) > c0);
await wait(page, 2500);
const loud = await strain();
const c1 = await collapsed();
check('sprinting under it brings a section down', c1 > c0, `${c1 - c0} section(s) after ${((await gameTime()) - tLoud).toFixed(1)} s of sprinting; strain ${JSON.stringify(loud)}`);
await shot(page, 'hazards-2-collapse');

// ---- 3. the flooded chamber ----
await page.evaluate((F) => {
  const lt = window.lostTemple;
  lt.speed(2);
  lt.teleport([9, F + 0.1, -102.6], 0);
  lt.look(0, 0);
  lt.light();
}, F);
await wait(page, 2500);
await torchEvents();
const t3 = await torch();
check('wading in the shallows keeps the torch lit', t3.lit, JSON.stringify(t3));
await page.evaluate(() => window.lostTemple.move(0, 1));
let swamOut = false;
let sawSwim = false;
let triedRelight = false;
for (let i = 0; i < 90 && !swamOut; i++) {
  await wait(page, 300);
  const s = await st(page);
  if (s.mode === 'swim') sawSwim = true;
  if (sawSwim && !triedRelight && !s.torch.lit) {
    await page.evaluate(() => window.lostTemple.press('torch'));
    triedRelight = true;
  }
  if (sawSwim && (await nearFace())) await page.evaluate(() => window.lostTemple.press('jump'));
  swamOut = s.feet[1] > F + 0.6 && s.mode === 'walk';
}
await page.evaluate(() => window.lostTemple.stop());
const ev3 = await torchEvents();
let s3 = await st(page);
check('swimming the channel drowns the torch', ev3.includes('out:water'), ev3.join(','));
check('no striking a light while you swim', ev3.includes('relightFail:water'), ev3.join(','));
check('swim the channel and climb out onto the island', swamOut, `feet y ${s3.feet[1].toFixed(2)}, mode ${s3.mode}, swam ${sawSwim}`);
if (!swamOut) await page.evaluate((F) => window.lostTemple.teleport([9, F + 0.9, -109.8], 0), F);
await wait(page, 1500);
// the mantle leaves you at the island's edge, up to 3 m short of the key: step up to it
await lookAt([9, F + 1.8, -112]);
await wait(page, 800);
for (let k = 0; k < 16 && !/Serpent Key/.test(await promptText()); k++) {
  await page.evaluate(() => window.lostTemple.move(0, 1));
  await wait(page, 250);
  await page.evaluate(() => window.lostTemple.stop());
  await lookAt([9, F + 1.8, -112]);
  await wait(page, 400);
}
const keyPrompt = await promptText();
await page.evaluate(() => window.lostTemple.press('interact'));
await wait(page, 1200);
s3 = await st(page);
check('take the Serpent Key from the island', s3.items.includes('serpentKey'), JSON.stringify(keyPrompt));
// relight on dry stone
const r0 = await gameTime();
await page.evaluate(() => window.lostTemple.press('torch'));
await wait(page, 400);
const mid = await torch();
let relit = false;
for (let k = 0; k < 40 && !relit; k++) {
  await wait(page, 300);
  relit = (await torch()).lit;
}
const r1 = await gameTime();
check('relighting on dry stone takes a couple of seconds', mid.relighting && !mid.lit && relit && r1 - r0 >= 2, `relighting ${mid.relighting}, lit after ${(r1 - r0).toFixed(1)} s of game time`);
await shot(page, 'hazards-3-island');
// the serpent door
await page.evaluate((V) => window.lostTemple.teleport([-23.6, V + 0.1, -126.6], -Math.PI / 2), V);
await wait(page, 2500);
await lookAt([-22.4, V + 1.3, -128.2]);
await wait(page, 800);
const doorPrompt = await promptText();
await page.evaluate(() => window.lostTemple.press('interact'));
await wait(page, 6000);
s3 = await st(page);
check('the Serpent Key opens the serpent door', s3.flags.includes('vaultDoorOpen'), JSON.stringify(doorPrompt));
await page.evaluate((V) => {
  const lt = window.lostTemple;
  lt.teleport([-24.5, V + 0.1, -125], -Math.PI / 2);
  lt.look(-Math.PI / 2, 0);
  lt.move(0, 1);
}, V);
for (let k = 0; k < 40; k++) {
  await wait(page, 300);
  if ((await st(page)).pos[0] > -18.5) break;
}
await page.evaluate(() => window.lostTemple.stop());
s3 = await st(page);
check('walk through the open serpent door into the vault', s3.pos[0] > -18.5, `x ${s3.pos[0].toFixed(2)}, scene ${s3.scene}`);

// ---- 4. a hard landing ----
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.teleport([0, 7.5, -70], 0);
  lt.light();
});
await wait(page, 3500);
const ev4 = await torchEvents();
const dmg4 = await page.evaluate(() => window.__dmg.splice(0));
check('a hard landing knocks the torch out (and hurts)', ev4.includes('out:fall') && dmg4.some((d) => /fall/.test(d[1])), `${ev4.join(',')} damage ${JSON.stringify(dmg4)}`);

// ---- 5. wind on the cliff top ----
const PLAT = [62, 14.3, -12];
await page.evaluate((p) => {
  const lt = window.lostTemple;
  lt.speed(4);
  lt.teleport(p, 0);
  lt.light();
}, PLAT);
await wait(page, 2500);
await torchEvents();
let windOut = false;
let maxDrift = 0;
const tW0 = await gameTime();
const tW = Date.now();
while (!windOut && Date.now() - tW < 150000) {
  await wait(page, 1500);
  const s = await st(page);
  const drift = Math.hypot(s.pos[0] - PLAT[0], s.pos[2] - PLAT[2]);
  maxDrift = Math.max(maxDrift, drift);
  const ev = await torchEvents();
  if (ev.includes('out:wind')) windOut = true;
  if (drift > 3 || s.feet[1] < 13) await page.evaluate((p) => window.lostTemple.teleport(p, 0), PLAT);
  if (!windOut && !(await torch()).lit) await page.evaluate(() => window.lostTemple.light());
}
check('a gust on the cliff top tears the flame off the torch', windOut, `after ${((await gameTime()) - tW0).toFixed(0)} s of game time`);
check('the gusts shove a thief who stands still', maxDrift > 0.5, `pushed up to ${maxDrift.toFixed(1)} m`);

// ---- 6. gamepad ----
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.speed(2);
  lt.stop();
  lt.teleport([0, 0.1, -66], 0);
  lt.look(0, 0);
  const pad = {
    id: 'Test pad (STANDARD GAMEPAD)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  window.__pad = pad;
  navigator.getGamepads = () => [pad];
});
await wait(page, 2000);
const g0 = await st(page);
await page.evaluate(() => {
  window.__pad.axes[1] = -1;
});
await wait(page, 2500);
await page.evaluate(() => {
  window.__pad.axes[1] = 0;
});
await wait(page, 600);
const g1 = await st(page);
check('gamepad left stick walks', g0.pos[2] - g1.pos[2] > 0.8, `moved ${(g0.pos[2] - g1.pos[2]).toFixed(2)} m forward`);
const yaw0 = await page.evaluate(() => window.lostTemple.game.run.player.yaw);
await page.evaluate(() => {
  window.__pad.axes[2] = 0.9;
});
await wait(page, 1500);
await page.evaluate(() => {
  window.__pad.axes[2] = 0;
});
const yaw1 = await page.evaluate(() => window.lostTemple.game.run.player.yaw);
check('gamepad right stick turns the view', Math.abs(yaw1 - yaw0) > 0.2, `yaw ${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)}`);
const y0 = (await st(page)).feet[1];
await page.evaluate(() => {
  window.__pad.buttons[0].pressed = true;
});
let yMax = y0;
for (let k = 0; k < 10; k++) {
  await wait(page, 150);
  yMax = Math.max(yMax, (await st(page)).feet[1]);
  if (k === 2)
    await page.evaluate(() => {
      window.__pad.buttons[0].pressed = false;
    });
}
check('gamepad A jumps', yMax - y0 > 0.25, `rose ${(yMax - y0).toFixed(2)} m`);
const tl0 = await torch();
await page.evaluate(() => {
  window.__pad.buttons[3].pressed = true;
});
await wait(page, 500);
await page.evaluate(() => {
  window.__pad.buttons[3].pressed = false;
});
await wait(page, 500);
const tl1 = await torch();
check('gamepad Y works the torch', tl1.lit !== tl0.lit || tl1.relighting !== tl0.relighting, `lit ${tl0.lit} -> ${tl1.lit}, relighting ${tl1.relighting}`);
await page.evaluate(() => {
  navigator.getGamepads = () => [];
});

// ---- 7. bank a relic, leave, and meet this run's ghost in the next one ----
// (relics only exist while their scene is streamed in: go to the courtyard first)
await page.evaluate(() => window.lostTemple.teleport([-14, 0.2, 8.5], 0));
await wait(page, 3000);
const court = await page.evaluate(() =>
  [...window.lostTemple.game.run.relics.live.values()]
    .filter((l) => l.rec.scene === 'courtyard' && l.rec.mass < 6 && l.rec.state !== 'banked')
    .map((l) => {
      const t = l.body.translation();
      return { uid: l.rec.uid, pos: [t.x, t.y, t.z] };
    }),
);
let stashed = false;
if (court.length) {
  const r = court[0];
  await page.evaluate((p) => window.lostTemple.teleport([p[0] + 1.4, p[1] + 0.3, p[2] + 0.2]), r.pos);
  await wait(page, 1500);
  const now = await page.evaluate((uid) => {
    const t = window.lostTemple.game.run.relics.live.get(uid).body.translation();
    return [t.x, t.y, t.z];
  }, r.uid);
  await lookAt(now);
  await wait(page, 800);
  await page.evaluate(() => window.lostTemple.press('interact'));
  await wait(page, 1200);
  stashed = (await st(page)).satchel.length > 0;
}
await page.evaluate(() => window.lostTemple.teleport([-14, 0.2, 6.7], 0));
await wait(page, 1500);
await lookAt([-14, 1.3, 4.5]);
await wait(page, 800);
await page.evaluate(() => window.lostTemple.press('interact'));
await wait(page, 1200);
const banked = (await st(page)).banked;
await page.evaluate(() => window.lostTemple.press('interact', true));
await page.waitForFunction(() => window.lostTemple.state().state !== 'playing', null, { timeout: 60000 }).catch(() => {});
await page.evaluate(() => window.lostTemple.release('interact'));
await page.waitForFunction(() => window.lostTemple.state().state === 'results', null, { timeout: 60000 }).catch(() => {});
const results = (await page.evaluate(() => document.querySelector('.screen')?.innerText || '')).replace(/\n+/g, ' | ');
const ghostLen = await page.evaluate(() => JSON.parse(localStorage.getItem('lostTemple.save.v1') || '{}').ghost?.data?.length ?? 0);
check('escaping with loot saves the run as the ghost', stashed && banked > 0 && ghostLen > 400 && /Ghost/.test(results), `stashed ${stashed}, banked $${banked}, ${ghostLen / 4} samples`);
await startRun(page, 1357);
await page.evaluate(() => window.lostTemple.speed(8));
const ghostAt = async (t) => {
  for (let k = 0; k < 200; k++) {
    const now = await gameTime();
    if (now >= t) break;
    await wait(page, 250);
  }
  return page.evaluate(() => {
    const g = window.lostTemple.game.run.ghost;
    return g ? { visible: g.obj.visible, pos: g.obj.position.toArray(), t: window.lostTemple.game.run.state.time } : null;
  });
};
const gh1 = await ghostAt(T.halls + 5);
const gh2 = await ghostAt(T.sanctum + 4);
await page.evaluate(() => window.lostTemple.speed(1));
const fmt = (g) => (g ? `${g.visible ? 'visible' : 'hidden'} at [${g.pos.map((v) => v.toFixed(1))}] t ${g.t.toFixed(1)}` : 'none');
check(
  'the next run replays the ghost along the same route at the same pace',
  !!gh1 && !!gh2 && gh1.visible && gh2.visible && Math.hypot(gh1.pos[0], gh1.pos[2] + 17) < 3 && Math.hypot(gh2.pos[0] - 16, gh2.pos[2] + 86) < 8,
  `${fmt(gh1)} (halls stop at [0,0,-17]); ${fmt(gh2)} (sanctum stop at [16,0,-86])`,
);

console.log(fails ? `HAZARDS: ${fails} FAILED` : 'HAZARDS: ALL PASS');
console.log('errors:', errors.length ? errors.slice(0, 20).join('\n') : 'none');
await browser.close();
process.exit(fails ? 1 : 0);
