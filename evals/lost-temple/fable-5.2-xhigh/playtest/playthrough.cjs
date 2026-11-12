/**
 * A scripted run of the whole game through the debug API: jungle, bridge,
 * great door, sundial puzzle, catacomb seal, Serpent Key, vault gate, vault,
 * escape stair, kicked wall, drawbridge and back out of the door.
 *
 * It only uses what a player has: walking, looking, and the action keys.
 * (Time is simulated faster than real time; nothing is teleported or flagged.)
 *
 *   node playtest/playthrough.cjs            (with the game served on :5173)
 */
const { open, view } = require('./lib.cjs');

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const trailX = (z) => 7.5 * Math.sin((z - 96) * 0.052) * smooth(96, 108, z) * (1 - smooth(146, 160, z));

const Y_T = 1.2;
const Y_C = -8;
const Y_V = -14;

(async () => {
  const t0 = Date.now();
  let s0;
  const { browser, page, errors } = await open();
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const failures = [];
  const check = (ok, what, extra = '') => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '  ' + extra : ''}`);
    if (!ok) failures.push(what);
    return ok;
  };

  await ev((seed) => {
    __lt.start({ seed });
    __lt.quality('low');
    window.__log = [];
    const g = __lt.game;
    const damage = g.damage.bind(g);
    g.damage = (n, cause) => { window.__log.push(`dmg ${n.toFixed(1)} ${cause}`); damage(n, cause); };
    const toast = g.toast.bind(g);
    g.toast = (text, kind) => { window.__log.push(`toast ${text}`); toast(text, kind); };
  }, 4242);

  const brief = async (label) => {
    const s = await ev(() => {
      const s = __lt.state();
      return {
        scene: s.scene, pos: [s.pos.x, s.pos.y, s.pos.z], hp: s.health, t: s.time, left: s.remaining, loot: s.loot, kg: s.weight,
        relics: s.relics.length, keys: s.keys, flags: s.flags, torch: `${s.torch.state}/${s.torch.fuel}`, state: s.state, log: window.__log.splice(0),
      };
    });
    console.log(`-- ${label}: ${JSON.stringify(s)}`);
    return s;
  };
  const route = async (label, pts, opts = {}) => {
    const r = await ev(({ pts, opts }) => __lt.route(pts, opts), { pts, opts });
    check(r && r.ok, `walk: ${label}`, r && !r.ok ? JSON.stringify(r) : '');
    if (!(r && r.ok)) {
      // A bot that is lost just walks into the scenery: stop here and show where.
      await brief('STUCK');
      await view(page, 'play-stuck');
      console.log(`\nFAILED at "${label}" (and ${failures.length - 1} earlier)`);
      console.log('console errors:', errors.length, errors.slice(0, 5).join('\n'));
      await browser.close();
      process.exit(1);
    }
    return true;
  };
  const use = (x, y, z) => ev(({ x, y, z }) => __lt.use(x, y, z), { x, y, z });
  const sim = (s) => ev((s) => __lt.sim(s), s);
  const flag = (f) => ev((f) => __lt.state().flags.includes(f), f);

  // ------------------------------------------------------------ the jungle
  const trail = [];
  for (let z = 156; z >= 128; z -= 4) trail.push([trailX(z), z]);
  await route('camp to the river', trail, { timeout: 40 });
  // The stepping stones, south to north (same placement as the scene builder).
  const sx = trailX(121);
  const stones = [4.3, 2.6, 0.9, -0.9, -2.7, -4.4].map((o, j) => [sx + Math.sin((5 - j) * 2.4) * 0.45, 121 + o]);
  await route('over the stepping stones', [[sx, 126.4], ...stones, [trailX(114.5), 114.5]], { sprint: false, tol: 0.35, timeout: 20 });
  s0 = await brief('north bank');
  check(s0.pos[1] > -0.5, 'crossed the river dry', `y=${s0.pos[1]}`);
  const rest = [];
  for (let z = 112; z >= 98; z -= 4) rest.push([trailX(z), z]);
  await route('on to the gorge', rest, { timeout: 40 });
  await brief('at the gorge');
  await route('across the rope bridge', [[0, 93.2], [0, 90], [0, 86], [0, 82], [0, 78.6]], { sprint: false, timeout: 25 });
  await route('to the great door', [[0, 70], [0, 56], [0, 44]]);
  await route('through the great door', [[0, 38]]);
  let s = await brief('courtyard');
  check(s.scene === 'courtyard', 'entered the courtyard');

  // ---------------------------------------------------------- the sundial
  await route('to the sundial', [[1.5, 20], [0, 15.4]]);
  let solved = false;
  let turns = 0;
  const prompt = await ev(() => __lt.lookAt(0, 0.6, 11.5));
  console.log('   prompt:', JSON.stringify(prompt));
  for (; turns < 70 && !solved; turns++) {
    await ev(() => { __lt.lookAt(0, 0.6, 11.5); __lt.press('interact'); __lt.sim(1.05); });
    solved = await ev(() => __lt.game.run.get('sundial.solved', false));
  }
  check(solved, 'sundial solved by turning the ring', `(${turns} turns)`);
  await sim(1.6);
  await route('step onto the dial', [[0, 13.0]], { tol: 0.4, sprint: false });
  const discPrompt = await use(0, 0.67, 10.68);
  console.log('   prompt:', JSON.stringify(discPrompt));
  check(await flag('sunDisc'), 'Sun Disc taken');
  // A couple of courtyard relics on the way.
  await route('to the mural relic', [[0, 16], [-5.5, 35.8]]);
  await use(-6.5, 0.35, 37.2);
  s = await brief('courtyard looted');
  check(s.relics >= 1, 'picked up a relic');

  // ------------------------------------------------------- the broken halls
  await route('up the temple steps', [[0, 20], [7, 16], [7, 3], [0, -6], [0, -15], [0, -21.5], [0, -27]]);
  s = await brief('halls entry');
  check(s.scene === 'halls', 'entered the halls');
  // Early morning: the whole nave is in shade and the scarabs own it. Take the blade corridor.
  await route('west gallery to the blade corridor', [[-11.5, -30], [-11.5, -50.5]]);
  for (const zb of [-54.2, -57, -59.8]) {
    await route(`up to the blade at z=${zb}`, [[-11.5, zb + 1.3]], { sprint: false, tol: 0.25 });
    const waited = await ev((zb) => {
      // Watch the blade like a player would: go when the head is out in its wall slot and still moving away.
      const g = __lt.game;
      const blade = g.scenes.loaded.get('halls').entities.find((e) => e.pivot && e.wMax !== undefined && Math.abs(e.pivot.z - zb) < 0.1);
      let prev = blade.tip().x;
      let steps = 0;
      g.simulate(600, () => {
        const x = blade.tip().x;
        const out = Math.abs(x + 11.5);
        const going = out > Math.abs(prev + 11.5);
        prev = x;
        steps++;
        return !(out > 1.7 && going);
      });
      return steps;
    }, zb);
    await route(`past the blade at z=${zb} (waited ${(waited / 60).toFixed(2)}s)`, [[-11.5, zb - 1.3]], { tol: 0.3 });
  }
  s = await brief('north hall');
  check(s.hp > 99, 'no blade touched the bot', `hp ${s.hp}`);
  await route('to the catacomb seal', [[-11.5, -66], [10, -67], [16, -70.4]]);
  console.log('   prompt:', JSON.stringify(await use(16, Y_T + 2.6, -72.25)));
  check(await flag('sealOpen'), 'Sun Disc set in the seal');
  await sim(5);

  // ----------------------------------------------------------- catacombs
  await ev(() => __lt.press('torch'));
  await sim(2.5);
  s = await brief('torch');
  check(s.torch.startsWith('lit'), 'torch lit with the F key', s.torch);
  await route('down the seal stair', [[16, -75], [16, -86], [27, -86], [31, -87]], { sprint: false, timeout: 40 });
  s = await brief('ossuary');
  check(s.scene === 'catacombs', 'entered the catacombs');
  await view(page, 'play-ossuary');
  await route('north corridor to the flooded chamber', [[35, -92], [35, -99.5]], { sprint: false });
  await route('wade the causeway to the island', [[35, -105.5], [29.5, -105.5], [29.5, -120.5], [36, -120.5], [36, -117.6], [36, -115.5]], { sprint: false, timeout: 60 });
  s = await brief('island');
  console.log('   prompt:', JSON.stringify(await use(36, -7.34, -114)));
  check(await flag('serpentKey'), 'Serpent Key taken');
  if (!s.torch.startsWith('lit')) {
    await ev(() => __lt.press('torch'));
    await sim(2.5);
  }
  await route('back across the causeway', [[36, -120.5], [29.5, -120.5], [29.5, -105.5], [35, -105.5], [35, -99.5], [35, -92]], { sprint: false, timeout: 60 });
  s = await brief('back in the ossuary');
  if (!s.torch.startsWith('lit')) {
    await ev(() => __lt.press('torch'));
    await sim(2.5);
    s = await brief('relit');
    check(s.torch.startsWith('lit'), 'torch relit after the water');
  }
  await route('dart corridor, crouched under the darts', [[29, -91.5], [25, -91.5], [3, -91.5]], { crouch: true, sprint: false, timeout: 60 });
  await route('to the vault gate', [[-6.6, -91.5]], { sprint: false });
  s = await brief('gate room');
  console.log('   prompt:', JSON.stringify(await use(-8.4, Y_C + 1.4, -91.5)));
  check(await flag('vaultGate'), 'vault gate unlocked with the Serpent Key');
  await sim(5);

  // --------------------------------------------------------------- vault
  await route('down the vault stair', [[-11, -91.5], [-23, -91.5], [-26.5, -91.5]], { sprint: false, timeout: 40 });
  s = await brief('chasm, east bank');
  check(s.scene === 'vault', 'entered the vault');
  await view(page, 'play-chasm');
  await route('across the chasm bridge', [[-28.4, -91.5], [-32, -91.5], [-36.6, -91.5], [-39, -91.5]], { sprint: false, timeout: 30 });
  await route('into the treasure hall', [[-43.5, -91.5]], { sprint: false });
  s = await brief('treasure hall');
  await view(page, 'play-vault');
  // Loot: a plinth relic (no trap) and one from the open floor.
  await route('to the south-east plinth', [[-45.6, -99.4]], { sprint: false });
  console.log('   prompt:', JSON.stringify(await use(-45.6, Y_V + 0.95, -100.6)));
  await route('to the north-west plinth', [[-47, -92], [-55.4, -84.2]], { sprint: false });
  console.log('   prompt:', JSON.stringify(await use(-56.5, Y_V + 0.95, -83)));
  s = await brief('vault looted');
  check(s.relics >= 2, 'vault relics in the satchel', `${s.relics} relics, ${s.loot} coins, ${s.kg} kg`);
  await route('to the stair lever', [[-56.4, -81.6]], { sprint: false });
  console.log('   prompt:', JSON.stringify(await use(-56.4, Y_V + 1.1, -80.5)));
  check(await flag('escapeStair'), 'escape stair lever pulled');
  await sim(5);

  // ---------------------------------------------------------- the way out
  await route('up the escape stair', [
    [-59, -80.6], [-59, -76.5], [-45, -76.5], [-45, -73], [-59, -73], [-59, -69.5], [-45, -69.5], [-45, -64],
  ], { sprint: false, timeout: 60 });
  s = await brief('sanctum');
  check(s.scene === 'sanctum', 'came up into the sanctum');
  await route('to the cracked wall', [[-41, -58], [-41, -44], [-48, -38.4]]);
  console.log('   prompt:', JSON.stringify(await use(-48, Y_T + 1.5, -36)));
  await sim(0.6);
  console.log('   prompt:', JSON.stringify(await use(-48, Y_T + 1.5, -36)));
  check(await flag('wallKicked'), 'cracked wall kicked out (two kicks)');
  await sim(2);
  await route('along the terrace to the winch', [[-48, -33], [-48, -12], [-42, -10], [-33.6, -10]]);
  console.log('   prompt:', JSON.stringify(await use(-33.3, 1.0, -8.7)));
  check(await flag('drawbridge'), 'drawbridge lowered');
  await sim(6);
  await route('over the drawbridge and across the courtyard', [[-30, -10], [-22, -10], [-16, -2], [-6, 20], [0, 36]]);
  s = await brief('at the door');
  const carried = s.loot;
  await route('into the doorway', [[0, 41], [0, 43.6]]);
  // Stepping over the threshold ends the run, so this last walk never "arrives".
  await ev(() => __lt.walkTo(0, 47, { timeout: 4 }));
  // The fade to the results screen runs on real frames, not simulated ones.
  await page.waitForFunction(() => __lt.state().state === 'results', null, { timeout: 30000 }).catch(() => {});
  const end = await ev(() => {
    const s = __lt.state();
    return { state: s.state, outcome: s.outcome, result: s.result, coins: s.coins, time: s.time, scores: __lt.game.meta.data.scores, log: window.__log.splice(0) };
  });
  console.log('-- end:', JSON.stringify(end));
  check(end.outcome === 'escaped', 'run ended as an escape', String(end.outcome));
  check(end.state === 'results', 'results screen showing', end.state);
  check(end.result && end.result.haul === carried && carried > 0, 'haul banked equals the loot carried out', `${end.result && end.result.haul} vs ${carried}`);
  check(end.scores.length >= 1 && end.scores[0].haul === carried, 'high-score table has the run');
  const saved = await ev(() => Object.keys(localStorage).map((k) => `${k}:${localStorage.getItem(k).length}b`));
  check(saved.length > 0, 'save written to localStorage', saved.join(' '));

  console.log(`\n${failures.length ? 'FAILED: ' + failures.join(' | ') : 'PLAYTHROUGH PASSED'}  (game time ${end.time}s, wall ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  console.log('console errors:', errors.length, errors.slice(0, 5).join('\n'));
  await browser.close();
  process.exit(failures.length || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
