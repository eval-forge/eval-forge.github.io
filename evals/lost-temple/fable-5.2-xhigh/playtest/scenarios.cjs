/**
 * Targeted checks of single systems in the running game: the Zone C darkness
 * probe, nightfall and the guardian sweep, being caught, the closing door,
 * trapped pedestals, the torch, crumbling floors, plank bridges, the boulder,
 * the block puzzle, the listening ceiling, climbing, the drawbridge, sconces, scene memory,
 * the sanctum collapse, menus and the save, carrying and throwing, the ghost,
 * a (faked) gamepad, and finally real keyboard, mouse and audio. Unlike playthrough.cjs these teleport and set the clock to get
 * where they need to be.
 *
 *   node playtest/scenarios.cjs [name-filter]
 */
const { open, view } = require('./lib.cjs');

const Y_T = 1.2;
const Y_C = -8;
const Y_V = -14;

(async () => {
  const filter = process.argv[2];
  const { browser, page, errors } = await open();
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const failures = [];
  const check = (ok, what, extra = '') => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '  ' + extra : ''}`);
    if (!ok) failures.push(what);
    return ok;
  };
  const fresh = (seed = 7) => ev((seed) => {
    __lt.start({ seed });
    __lt.quality('low');
    Object.assign(window, { Y_T: 1.2, Y_C: -8, Y_V: -14 });
    window.__log = [];
    const g = __lt.game;
    if (!g.__tapped) {
      g.__tapped = true;
      const damage = g.damage.bind(g);
      g.damage = (n, cause) => { window.__log.push(`dmg ${n.toFixed(1)} ${cause}`); damage(n, cause); };
      const toast = g.toast.bind(g);
      g.toast = (text, kind) => { window.__log.push(`toast ${text}`); toast(text, kind); };
    }
  }, seed);
  const log = () => ev(() => window.__log.splice(0));
  const scenarios = {};

  // ------------------------------------------------------------------ dark
  scenarios.darkness = async () => {
    await fresh();
    await ev(() => __lt.quality('medium'));
    const spots = [
      ['catacomb stair, lower flight', [24, Y_C + 1.6, -86]], ['ossuary', [35, Y_C + 0.1, -87]], ['dart corridor', [15, Y_C + 0.1, -91.5]],
      ['crypt', [14, Y_C + 0.1, -99]], ['flooded chamber island', [36, -8.1, -113]], ['bone chapel', [56, Y_C + 0.1, -84]],
      ['gate room', [-3, Y_C + 0.1, -91.5]], ['vault stair', [-17, -11, -91.5]], ['chasm, east bank', [-26, Y_V + 0.1, -91.5]],
      ['treasure hall', [-52, Y_V + 0.1, -94]], ["guardians' lair", [-70, Y_V + 0.1, -92]], ['escape stair, bottom', [-59, Y_V + 0.1, -76.5]],
    ];
    let worst = 0;
    for (const f of [0.5, 0.2]) {
      for (const [name, p] of spots) {
        const r = await ev(({ p, f }) => {
          __lt.setTime(f * 780);
          __lt.teleport(p[0], p[1], p[2]);
          __lt.sim(0.4);
          let max = 0;
          let lit = 0;
          let flames = 0;
          for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            for (const pitch of [0, 0.9, -0.9]) {
              __lt.look(yaw, pitch);
              const m = __lt.darknessProbe();
              max = Math.max(max, m.max);
              lit += m.lit;
              flames = Math.max(flames, m.hiddenFlames);
            }
          }
          const s = __lt.state();
          return { max, lit, flames, scene: s.scene, y: s.pos.y, outdoor: s.outdoor };
        }, { p, f });
        worst = Math.max(worst, r.max);
        if (f === 0.5 || r.max > 0) console.log(`    ${name.padEnd(28)} day ${f}  max ${r.max}  lit px ${r.lit}  scene ${r.scene}  y ${r.y}  outdoor ${r.outdoor}`);
      }
    }
    check(worst === 0, 'Zone C renders pure black with the torch out (12 spots x 12 views x 2 times of day)', `brightest pixel value ${worst}/255`);
    // And with the torch: something is lit, the far corners are not.
    const lit = await ev(() => {
      __lt.teleport(35, -7.9, -87);
      __lt.torch(true);
      __lt.sim(0.5);
      __lt.look(Math.PI / 2, 0);
      const m = __lt.measure();
      return { max: m.max, frac: m.lit / m.pixels };
    });
    check(lit.max > 120 && lit.frac < 0.98, 'torch lights the ossuary but not all of it', JSON.stringify(lit));
    await view(page, 'scn-torch-ossuary');
  };

  // ----------------------------------------------------------------- night
  scenarios.night = async () => {
    await fresh();
    const pre = await ev(() => {
      __lt.teleport(0, 0.1, 30);
      __lt.sim(0.5);
      __lt.setTime(655);
      __lt.sim(1);
      const c = __lt.game.run.clock;
      const a = { remaining: c.remaining, pulsing: c.pulsing, phase: c.phase };
      __lt.setTime(722);
      __lt.sim(1);
      const b = { remaining: c.remaining, pulsing: c.pulsing, phase: c.phase };
      return { a, b, entered: __lt.state().entered };
    });
    check(pre.entered, 'run counts as "inside" after walking in');
    check(!pre.a.pulsing && pre.b.pulsing, 'screen-edge pulse starts in the last 60 s', JSON.stringify(pre));
    const rows = await ev(() => {
      __lt.setTime(779.5);
      const out = [];
      for (let i = 0; i <= 11; i++) {
        __lt.sim(i === 0 ? 1 : 5);
        const s = __lt.state();
        const g = __lt.guardians();
        const awake = g.filter((x) => x.state !== 'dormant');
        const by = {};
        for (const x of awake) by[x.scene] = (by[x.scene] || 0) + 1;
        out.push({ t: +(s.time - 780).toFixed(1), dark: s.dark, awake: s.guardiansAwake, gap: s.doorGap, where: by, state: s.state, outcome: s.outcome, flags: s.flags.includes('sealsBroken') });
        if (s.state !== 'playing') break;
      }
      return out;
    });
    for (const r of rows) console.log('    ', JSON.stringify(r));
    check(rows[0].dark && rows[0].awake >= 3, 'darkness falls and the vault guardians wake first', `awake ${rows[0].awake}`);
    check(rows[0].flags, 'the temple breaks its own seals at dark (so guardians can pass)');
    const awakeSeries = rows.map((r) => r.awake);
    check(awakeSeries.every((v, i) => i === 0 || v >= awakeSeries[i - 1]) && Math.max(...awakeSeries) >= 11, 'guardians wake in waves, deepest first', awakeSeries.join(','));
    check(rows.some((r) => r.gap > 0.5 && r.gap < 4.5), 'the great door is closing', rows.map((r) => r.gap).join(','));
    const end = await ev(() => {
      __lt.sim(12);
      const s = __lt.state();
      return { state: s.state, outcome: s.outcome, epitaph: s.epitaph, gap: s.doorGap };
    });
    console.log('    ', JSON.stringify(end));
    check(end.outcome === 'entombed' || end.outcome === 'caught', 'staying inside ends the run (entombed, or caught first)', String(end.outcome));
  };

  scenarios.sweep = async () => {
    // Stand outside the door, out of reach, and watch where the guardians go.
    await fresh();
    const rows = await ev(() => {
      __lt.teleport(0, 0.1, 30);
      __lt.sim(0.3);
      __lt.teleport(0, 0.1, 43.2); // on the threshold: inside for the rules, unreachable for guardians
      __lt.setTime(780);
      const out = [];
      for (let i = 0; i < 11; i++) {
        __lt.sim(5);
        const g = __lt.guardians();
        const by = {};
        let minZ = 1e9;
        let maxZ = -1e9;
        for (const x of g) {
          if (x.state === 'dormant') continue;
          by[`${x.type[0]}@${x.scene}`] = (by[`${x.type[0]}@${x.scene}`] || 0) + 1;
          minZ = Math.min(minZ, x.z);
          maxZ = Math.max(maxZ, x.z);
        }
        out.push({ t: (i + 1) * 5, by, maxZ: +maxZ.toFixed(1), states: [...new Set(g.map((x) => x.state))].join('/'), outcome: __lt.state().outcome });
        if (__lt.state().state !== 'playing') break;
      }
      return out;
    });
    for (const r of rows) console.log('    ', JSON.stringify(r));
    const last = rows[rows.length - 1];
    check(Object.keys(last.by).some((k) => k.endsWith('@courtyard') || k.endsWith('@halls')), 'guardians path out of the depths toward the door', JSON.stringify(last.by));
    check(rows.some((r) => Object.keys(r.by).some((k) => k.startsWith('s'))) && rows.some((r) => Object.keys(r.by).some((k) => k.startsWith('c'))), 'more than one guardian type is on the move');
  };

  scenarios.caught = async () => {
    await fresh();
    const r = await ev(() => {
      __lt.teleport(0, 0.1, 30);
      __lt.sim(0.3);
      __lt.give('jade_mask');
      __lt.give('ruby_scarab');
      const carried = __lt.state().loot;
      __lt.setTime(781);
      __lt.wake();
      __lt.teleport(0, 0.1, -8); // in front of the two gate sentinels
      let t = 0;
      while (t < 40 && __lt.state().state === 'playing') {
        __lt.sim(1);
        t++;
      }
      const s = __lt.state();
      return { carried, t, outcome: s.outcome, epitaph: s.epitaph, haul: s.result && s.result.haul, lost: s.result && s.result.carried, threat: s.threat };
    });
    console.log('    ', JSON.stringify(r));
    check(r.outcome === 'caught', 'a guardian catches a player who stands still', `${r.outcome} after ${r.t}s`);
    check(r.haul === 0 && r.lost === r.carried && r.carried > 0, 'caught = run and loot lost', `haul ${r.haul}, carried ${r.lost}`);
  };

  scenarios.door = async () => {
    await fresh();
    const r = await ev(() => {
      __lt.teleport(0, 0.1, 30);
      __lt.sim(0.3);
      __lt.give('jade_mask');
      __lt.setTime(780 + 42); // gap ~1.56 m: too low to walk under, enough to crouch under
      __lt.teleport(0, 0.1, 38.5);
      __lt.sim(0.3);
      const gap = __lt.state().doorGap;
      const standing = __lt.walkTo(0, 43, { timeout: 3, hop: false });
      const s1 = __lt.state();
      const crouched = s1.state === 'playing' ? __lt.walkTo(0, 46, { timeout: 5, crouch: true, sprint: false, hop: false }) : null;
      const s2 = __lt.state();
      return { gap, standing: standing.ok, z1: s1.pos.z, crouched: crouched && crouched.z, outcome: s2.outcome, haul: s2.result && s2.result.haul };
    });
    console.log('    ', JSON.stringify(r));
    check(!r.standing && r.z1 < 41.5, 'half-closed door blocks a standing player', `gap ${r.gap}, got to z=${r.z1}`);
    check(r.outcome === 'escaped' && r.haul > 0, 'crouching under the closing door still escapes with the loot', `${r.outcome}, haul ${r.haul}`);
  };

  // ------------------------------------------------------------- drawbridge
  scenarios.drawbridge = async () => {
    await fresh();
    const r = await ev(() => {
      const g = __lt.game;
      const p = g.player;
      __lt.setTime(215);
      // The terrace landing west of the canal, beside the winch.
      __lt.teleport(-33.6, 0.3, -10);
      __lt.sim(1);
      const blocked = __lt.walkTo(-22, -10, { timeout: 4, hop: false });
      __lt.teleport(-33.6, 0.3, -10);
      __lt.sim(0.5);
      __lt.use(-33.3, 1.0, -8.7);
      __lt.sim(6);
      let deck = null;
      g.physics.world.forEachCollider((c) => {
        if (g.physics.getMeta(c)?.kind === 'drawbridge') deck = c.parent();
      });
      const q = deck.rotation();
      let crossings = 0;
      let stalledAt = null;
      for (let i = 0; i < 12 && !stalledAt; i++) {
        for (const x of [-22, -32]) {
          const w = __lt.walkTo(x, -10, { sprint: i % 2 === 0, hop: false, timeout: 12 });
          if (w.ok) crossings++;
          else stalledAt = stalledAt ?? w;
        }
      }
      return { blocked, flag: g.hasFlag('drawbridge'), level: Math.abs(q.z) < 1e-6, fixed: deck.isFixed(), crossings, stalledAt, y: +p.pos.y.toFixed(2) };
    });
    check(!r.blocked.ok && r.blocked.x < -29, 'with the deck up there is no way over the canal', `stopped at x ${r.blocked.x}`);
    check(r.flag && r.level, 'the winch lowers the deck level');
    check(r.fixed, 'once down, the deck is static ground');
    check(r.crossings === 24, 'twelve crossings each way, walking and sprinting, without a stall', `${r.crossings} of 24${r.stalledAt ? ' stalled at ' + JSON.stringify(r.stalledAt) : ''}`);
  };

  // ----------------------------------------------------------------- traps
  scenarios.pedestal = async () => {
    await fresh();
    const bare = await ev(() => {
      __lt.teleport(29.3, 0.1, 22, Math.PI / 2);
      __lt.sim(0.4);
      const prompt = __lt.use(30.95, 1.25, 22);
      __lt.sim(2.5);
      const s = __lt.state();
      return { prompt, relics: s.relics, hp: s.health, sunk: __lt.game.run.get('sunk:courtyard.alcove', false), log: window.__log.splice(0) };
    });
    console.log('    bare hands:', JSON.stringify(bare));
    check(bare.relics.includes('silver_censer'), 'took the censer off its pedestal');
    check(bare.sunk && bare.log.some((l) => l.includes('pedestal sinks')), 'empty pedestal sinks and fires its trap');
    check(bare.log.some((l) => l.startsWith('dmg')), 'the alcove darts hit a player who stays put', bare.log.filter((l) => l.startsWith('dmg')).join(' | '));

    await fresh();
    const swap = await ev(() => {
      // Pick up the 2 kg rock lying nearby and swap it for the 1.8 kg censer.
      __lt.teleport(26.5, 0.1, 20.4);
      __lt.sim(0.6);
      const rock = __lt.game.scenes.loaded.get('courtyard').entities.find((e) => e.rec && e.rec.id === 'courtyard.rockA');
      const rp = rock.body.translation();
      const p1 = __lt.use(rp.x, rp.y, rp.z);
      const held = __lt.state().held;
      __lt.walkTo(29.3, 22, { sprint: false });
      const p2 = __lt.use(30.95, 1.25, 22);
      __lt.sim(2.5);
      const s = __lt.state();
      return { p1, held, p2, relics: s.relics, hp: s.health, heldAfter: s.held, sunk: __lt.game.run.get('sunk:courtyard.alcove', false), log: window.__log.splice(0) };
    });
    console.log('    weight swap:', JSON.stringify(swap));
    check(!!swap.held, 'picked up a loose rock', String(swap.held));
    check(swap.relics.includes('silver_censer') && !swap.sunk && swap.hp === 100 && !swap.heldAfter, 'equal-weight swap takes the relic and leaves the trap asleep');
  };

  scenarios.torch = async () => {
    await fresh();
    const r = await ev(() => {
      const g = __lt.game;
      const t = g.run.torch;
      __lt.teleport(35, -7.9, -87);
      __lt.sim(0.3);
      const out = { start: t.state };
      __lt.press('torch');
      out.striking = t.state;
      out.vulnerable = t.vulnerable;
      let n = 0;
      while (t.state !== 'lit' && n < 400) { g.simulate(1); n++; }
      out.relightSeconds = +(n / 60).toFixed(2);
      out.full = { fuel: +t.fuel.toFixed(1), radius: +t.radius.toFixed(2), bright: +t.brightness.toFixed(2) };
      const f0 = t.fuel;
      __lt.sim(10);
      out.burnPerSec = +((f0 - t.fuel) / 10).toFixed(3);
      out.curve = [1, 0.6, 0.35, 0.2, 0.1, 0.03].map((k) => { t.fuel = t.capacity * k; return `${k}:${t.radius.toFixed(1)}m/${t.brightness.toFixed(2)}`; });
      t.fuel = 2;
      __lt.sim(4);
      out.burnedOut = t.state;
      out.stock = t.flasks + t.spares;
      __lt.press('refuel');
      __lt.sim(0.5);
      out.afterRefuel = { fuel: +t.fuel.toFixed(1), stock: t.flasks + t.spares, state: t.state };
      __lt.press('torch');
      __lt.sim(3);
      out.relit = t.state;
      // Deep water puts it out.
      __lt.teleport(41, -8.6, -110);
      __lt.sim(1.5);
      out.inWater = { state: t.state, mode: __lt.state().mode };
      out.log = window.__log.splice(0);
      return out;
    });
    console.log('    ', JSON.stringify(r));
    check(r.striking === 'relighting' && r.vulnerable && r.relightSeconds > 0.8 && r.relightSeconds < 4, 'lighting is a short vulnerable animation', `${r.relightSeconds}s`);
    check(r.burnPerSec > 0, 'fuel burns', `${r.burnPerSec}/s`);
    check(r.burnedOut === 'out', 'torch dies when the fuel is gone');
    console.log('    radius/brightness by fuel fraction:', r.curve.join('  '));
    check(r.afterRefuel.fuel > 50 && r.afterRefuel.stock === r.stock - 1, 'R spends a flask or a spare torch to refuel', JSON.stringify(r.afterRefuel));
    check(r.relit === 'lit', 'and it can be relit');
    check(r.inWater.state === 'out', 'swimming puts the torch out', JSON.stringify(r.inWater));
  };

  scenarios.wind = async () => {
    await fresh();
    const r = await ev(() => {
      const t = __lt.game.run.torch;
      __lt.teleport(43.3, -2.5, -2);
      __lt.sim(0.3);
      __lt.torch(true);
      __lt.teleport(42.6, -2.5, -30); // the windy traverse
      let n = 0;
      while (t.lit && n < 60 * 14) { __lt.game.simulate(1); n++; }
      return { state: t.state, seconds: +(n / 60).toFixed(1), log: window.__log.splice(0) };
    });
    console.log('    ', JSON.stringify(r));
    check(r.state !== 'lit', 'a cliff gust blows the torch out', `after ${r.seconds}s`);
  };

  scenarios.fall = async () => {
    await fresh();
    const r = await ev(() => {
      const t = __lt.game.run.torch;
      __lt.teleport(0, 0.1, 30);
      __lt.sim(0.3);
      __lt.torch(true);
      __lt.teleport(0, 6.5, 30);
      __lt.sim(2);
      const s = __lt.state();
      return { state: t.state, hp: s.health, log: window.__log.splice(0) };
    });
    console.log('    ', JSON.stringify(r));
    check(r.state !== 'lit' && r.hp < 100, 'a hard fall hurts and knocks the torch out', `hp ${r.hp}, torch ${r.state}`);
  };

  scenarios.crumble = async () => {
    await fresh();
    const r = await ev(() => {
      __lt.teleport(41.2, -7.9, -87);
      __lt.sim(0.3);
      __lt.torch(true);
      __lt.walkTo(45.5, -87, { sprint: false, timeout: 8, hop: false });
      const bodies0 = __lt.state().bodies;
      __lt.sim(2.5); // stop to admire the view
      const s = __lt.state();
      return { y: s.pos.y, hp: s.health, state: s.state, bodies0, bodies: s.bodies, log: window.__log.splice(0) };
    });
    console.log('    dawdling:', JSON.stringify(r));
    check(r.y < -9 || r.state !== 'playing', 'the crumbling floor drops a player who stops on it', `y=${r.y}, hp ${r.hp}`);
    await fresh();
    const q = await ev(() => {
      __lt.teleport(41.2, -7.9, -87);
      __lt.sim(0.3);
      const fast = __lt.walkTo(52.8, -87, { sprint: true, timeout: 6, hop: false });
      const s = __lt.state();
      return { ok: fast.ok, y: s.pos.y, hp: s.health };
    });
    console.log('    sprinting:', JSON.stringify(q));
    check(q.ok && q.y > -8.2, 'a sprint gets across before it goes', `y=${q.y}`);
  };

  scenarios.boulder = async () => {
    await fresh();
    const r = await ev(() => {
      const g = __lt.game;
      __lt.teleport(16.5, Y_T + 3.6, -56.4);
      __lt.sim(0.4);
      const b = g.scenes.loaded.get('halls').entities.find((e) => e.push && e.r !== undefined && e.release) || null;
      const prompt = __lt.use(16.5, Y_T + 3.5 + 1.25, -57.4);
      const p0 = b ? { ...b.body.translation() } : null;
      // Run for it: down the ramp and off to the side.
      const run = __lt.route([[16.5, -50], [16.5, -37], [16.5, -33.5], [3, -29]], { timeout: 12 });
      let vmax = 0;
      for (let i = 0; i < 40; i++) {
        __lt.sim(0.25);
        const v = b.body.linvel();
        vmax = Math.max(vmax, Math.hypot(v.x, v.y, v.z));
      }
      const p1 = b ? { ...b.body.translation() } : null;
      const s = __lt.state();
      return { prompt, found: !!b, p0, p1, vmax: +vmax.toFixed(1), rest: b && b.state, run: run && run.ok, hp: s.health, relics: s.relics, log: window.__log.splice(0) };
    }).catch((e) => ({ error: String(e) }));
    console.log('    ', JSON.stringify(r));
    check(!r.error && r.relics && r.relics.length === 1, 'took the relic the boulder guards');
    check(r.log && r.log.some((l) => l.includes('pedestal sinks')), 'its pedestal trap fired');
    if (check(r.found, 'found the boulder entity')) {
      check(r.p1.z > r.p0.z + 18, 'the boulder rolls the whole ramp', `z ${r.p0.z.toFixed(1)} -> ${r.p1.z.toFixed(1)}, top speed ${r.vmax} m/s, ends ${r.rest}`);
      check(r.hp === 100, 'a player who runs and sidesteps is not hurt', `hp ${r.hp}`);
    }
    // And the other way: stand on the ramp and wait for it.
    await fresh();
    const q = await ev(() => {
      __lt.teleport(16.5, Y_T + 3.6, -56.4);
      __lt.sim(0.4);
      __lt.use(16.5, Y_T + 3.5 + 1.25, -57.4);
      __lt.walkTo(16.5, -50, { timeout: 4 });
      __lt.sim(6);
      const s = __lt.state();
      return { hp: s.health, state: s.state, outcome: s.outcome, epitaph: s.epitaph, log: window.__log.splice(0) };
    });
    console.log('    ', JSON.stringify(q));
    check(q.hp === 0 && q.outcome === 'died' && /boulder/i.test(q.epitaph || ''), 'standing in its path is fatal', q.epitaph || '');
  };

  scenarios.bridge = async () => {
    const find = `(id) => __lt.game.scenes.loaded.get(id).entities.find((e) => e.timers && e.joints && e.planks)`;
    // 1. Jungle gorge bridge: dawdle on a plank and it goes.
    await fresh();
    const a = await ev((find) => {
      const g = __lt.game;
      __lt.teleport(0, 0.2, 94);
      __lt.sim(0.5);
      const br = eval(find)('jungle');
      const joints0 = g.physics.jointCount;
      const bodies0 = g.physics.bodyCount;
      const sag0 = Math.min(...br.bodies.map((b) => b.translation().y));
      __lt.walkTo(0, 88.6, { timeout: 6, sprint: false, tol: 0.3 });
      const on = br.plankAt(g.player.pos);
      const y0 = g.player.pos.y;
      const sagLoaded = Math.min(...br.bodies.map((b) => b.translation().y));
      const states = [];
      for (let i = 0; i < 8; i++) {
        __lt.sim(0.25);
        states.push(br.timers[on].state);
      }
      const bodies1 = g.physics.bodyCount;
      __lt.sim(3);
      const s = __lt.state();
      return { joints: br.joints.length, joints0, bodies0, bodies1, sag0: +sag0.toFixed(2), sagLoaded: +sagLoaded.toFixed(2), on, y0: +y0.toFixed(2), states, enabled: br.colliders[on].isEnabled(), y: s.pos.y, hp: s.health, state: s.state, epitaph: s.epitaph, log: window.__log.splice(0) };
    }, find);
    console.log('    ', JSON.stringify(a));
    check(a.joints === 13, 'the gorge bridge is 12 planks on 13 revolute joints', `${a.joints} joints, ${a.joints0} in the world`);
    check(a.sagLoaded < a.sag0 - 0.02, 'it sags under the player', `lowest plank ${a.sag0} -> ${a.sagLoaded}`);
    check(a.states.includes('cracking') || a.states.includes('broken'), 'a plank cracks when you stand on it', a.states.join(','));
    check(!a.enabled && a.bodies1 > a.bodies0, 'then breaks and tumbles away as a free body', `bodies ${a.bodies0} -> ${a.bodies1}`);
    check(a.y < -3 || a.state !== 'playing', 'and the player goes down with it', `y=${a.y} ${a.state} ${a.epitaph || ''}`);

    // 2. Cross it without stopping: it tears loose behind you.
    await fresh();
    const b = await ev((find) => {
      const g = __lt.game;
      __lt.teleport(0, 0.2, 94);
      __lt.sim(0.5);
      const br = eval(find)('jungle');
      const joints0 = g.physics.jointCount;
      const w = __lt.walkTo(0, 77.5, { timeout: 8 });
      __lt.sim(3);
      const lowest = Math.min(...br.bodies.map((b) => b.translation().y));
      return { ok: w.ok, joints0, joints1: g.physics.jointCount, lowest: +lowest.toFixed(1), snapped: br.snapped, broken: br.timers.filter((t) => t.state === 'broken').length, log: window.__log.splice(0) };
    }, find);
    console.log('    ', JSON.stringify(b));
    check(b.ok && b.broken >= 10, 'a sprint gets across, shedding every plank it touched', `${b.broken} of 12 planks gone`);
    check(b.snapped && b.joints1 === b.joints0 - 1 && b.log.some((l) => l.includes('tears loose')), 'the near anchor lets go once you are across', `joints ${b.joints0} -> ${b.joints1}`);
    check(b.lowest < -4, 'and the span swings down into the gorge', `lowest plank y=${b.lowest}`);

    // 3. Cliff bridge: rotten planks break, sound ones hold.
    await fresh();
    const c = await ev((find) => {
      const g = __lt.game;
      __lt.teleport(43.4, -2.4, -34.4);
      __lt.sim(0.6);
      const br = eval(find)('cliffs');
      if (!br) return { error: 'no bridge in cliffs', loaded: [...g.scenes.loaded.keys()] };
      const L = br.segLen;
      const xOf = (i) => br.a.x + (i + 0.5) * L;
      const w1 = __lt.walkTo(xOf(1), -34.4, { timeout: 5, sprint: false, tol: 0.2 });
      const on = br.plankAt(g.player.pos);
      __lt.sim(3);
      const sound = { state: br.timers[1].state, on, y: +g.player.pos.y.toFixed(2) };
      const w2 = __lt.walkTo(xOf(2), -34.4, { timeout: 5, sprint: false, tol: 0.2 });
      __lt.sim(2.5);
      const s = __lt.state();
      return { w1: w1.ok, w2: w2.ok, sound, rotten: br.timers[2].state, y: s.pos.y, hp: s.health, state: s.state, epitaph: s.epitaph, log: window.__log.splice(0) };
    }, find);
    console.log('    ', JSON.stringify(c));
    if (check(!c.error, 'found the cliff bridge', c.error || '')) {
      check(c.sound.state === 'intact' && c.sound.on === 1, 'a sound plank holds for as long as you like', `state ${c.sound.state}`);
      check(c.rotten === 'broken', 'a rotten one gives way', `state ${c.rotten}, y=${c.y} ${c.state} ${c.epitaph || ''}`);
    }
  };

  scenarios.puzzle = async () => {
    await fresh();
    const r = await ev(() => {
      const g = __lt.game;
      __lt.setTime(390); // noon: the puzzle room is lit and the scarabs stay in the walls
      __lt.teleport(-21, Y_T + 0.1, -35.6);
      __lt.sim(0.5);
      const blocks = g.scenes.loaded.get('halls').entities.filter((e) => e.pushed && e.size);
      const at = (b) => { const t = b.body.translation(); return [+t.x.toFixed(2), +t.z.toFixed(2)]; };
      const start = blocks.map(at);
      // Block A: straight north onto plate A.
      const a = __lt.walkTo(-21, -45.3, { timeout: 20, sprint: false, hop: false, tol: 0.25 });
      const flagsA = __lt.state().flags.includes('sanctumDoor');
      // Block B: east along z -41.5, then north onto plate B.
      __lt.route([[-21, -43], [-18.6, -43], [-18.6, -41.5]], { timeout: 8, sprint: false });
      const b1 = __lt.walkTo(-12.7, -41.5, { timeout: 16, sprint: false, hop: false, tol: 0.25 });
      __lt.route([[-13.6, -39.6], [-11.5, -39.6]], { timeout: 8, sprint: false });
      const b2 = __lt.walkTo(-11.5, -45.3, { timeout: 16, sprint: false, hop: false, tol: 0.25 });
      __lt.sim(1);
      const s = __lt.state();
      // The door is in the west wall: walk through it into the sanctum.
      const through = __lt.route([[-11.5, -43.5], [-22, -44], [-30, -44], [-38, -44]], { timeout: 14, sprint: false });
      return { n: blocks.length, start, end: blocks.map(at), a: a.ok, flagsA, b1: b1.ok, b2: b2.ok, flags: s.flags, hp: s.health, through: through && through.ok, scene: __lt.state().scene, log: window.__log.splice(0) };
    });
    console.log('    ', JSON.stringify(r));
    check(r.n === 2 && r.end[0][1] < r.start[0][1] - 6, 'leaning on a stone block slides it', `block A z ${r.start[0][1]} -> ${r.end[0][1]}`);
    check(!r.flagsA, 'one plate alone does not open the door');
    check(r.flags.includes('sanctumDoor') && r.log.some((l) => l.includes('Both plates hold')), 'both blocks on both plates open the sanctum door', `block B ${r.start[1]} -> ${r.end[1]}`);
    check(r.through && r.scene === 'sanctum', 'and the player can walk through it into the sanctum', r.scene);
  };

  scenarios.ceiling = async () => {
    await fresh();
    const r = await ev(() => {
      const g = __lt.game;
      __lt.setTime(390);
      __lt.teleport(-40, Y_T + 0.1, -62);
      __lt.sim(0.5);
      const field = g.scenes.loaded.get('sanctum').entities.find((e) => e.blocks && e.pending && e.drop);
      // Creep first: crouched, slow.
      __lt.route([[-56, -62], [-56, -56]], { timeout: 30, sprint: false, crouch: true });
      const quiet = { strain: +g.sanctumStrain().toFixed(2), fallen: field.blocks.length + field.pending.length };
      // Now make a racket: sprint laps and jumps under the cracked roof.
      let peak = 0;
      for (let lap = 0; lap < 4; lap++) {
        for (const [x, z] of [[-62, -58], [-52, -64], [-62, -64], [-54, -56]]) {
          __lt.walkTo(x, z, { timeout: 6, jump: true });
          peak = Math.max(peak, g.sanctumStrain());
        }
      }
      __lt.sim(2);
      const s = __lt.state();
      return { quiet, peak: +peak.toFixed(2), fallen: field.blocks.length + field.pending.length, hp: s.health, state: s.state, log: window.__log.splice(0) };
    });
    console.log('    ', JSON.stringify(r));
    check(r.quiet.fallen === 0 && r.quiet.strain < 0.5, 'creeping through the sanctum keeps the ceiling up', `strain ${r.quiet.strain}`);
    check(r.fallen > 0, 'sprinting and jumping brings masonry down', `${r.fallen} chunks, peak strain ${r.peak}, hp ${r.hp}`);
  };

  scenarios.climb = async () => {
    await fresh();
    const r = await ev(() => {
      const g = __lt.game;
      // Vines on the cliff ledge below the courtyard's east edge.
      __lt.teleport(43.6, -2.5, 1.4);
      __lt.sim(0.5);
      const y0 = g.player.pos.y;
      const modes = new Set();
      g.input.script = { moveX: 0, moveZ: 1, sprint: false, crouch: false };
      const st0 = g.player.stamina;
      g.simulate(60 * 7, () => {
        g.player.yaw = Math.PI / 2; // face west, into the rock
        g.player.pitch = 0.5;
        modes.add(g.player.mode);
        return true;
      });
      g.input.script = null;
      g.simulate(20);
      const s = __lt.state();
      // Mantle: jump at the 1.6 m stone block in the puzzle room and haul up onto it.
      __lt.setTime(390);
      __lt.teleport(-21, Y_T + 0.1, -35.9);
      __lt.sim(0.4);
      const m = new Set();
      g.input.script = { moveX: 0, moveZ: 1, sprint: false, crouch: false };
      let top = -99;
      g.simulate(60 * 3, () => {
        g.player.yaw = 0;
        g.player.pitch = 0;
        if (g.player.grounded && g.player.mode === 'walk') g.input.press('jump');
        m.add(g.player.mode);
        top = Math.max(top, g.player.pos.y);
        return g.player.pos.y < Y_T + 1.55 || g.player.mode !== 'walk';
      });
      g.input.script = null;
      g.simulate(20);
      return { y0: +y0.toFixed(2), y1: s.pos.y, x1: s.pos.x, modes: [...modes], staminaUsed: +(st0 - s.stamina).toFixed(1), mantle: [...m], top: +top.toFixed(2), yEnd: +g.player.pos.y.toFixed(2) };
    });
    console.log('    ', JSON.stringify(r));
    check(r.modes.includes('climb') && r.y1 > r.y0 + 2.2, 'vines carry the player up the cliff to the courtyard', `y ${r.y0} -> ${r.y1}, stamina spent ${r.staminaUsed}`);
    check(r.mantle.includes('mantle') && r.yEnd > 1.2 + 1.5, 'a jump at a chest-high ledge turns into a mantle onto it', `y ${r.yEnd}`);
  };

  scenarios.sconce = async () => {
    await fresh();
    const r = await ev(() => {
      const g = __lt.game;
      __lt.teleport(30.2, Y_C + 0.1, -82.4);
      __lt.sim(0.5);
      const spares0 = g.run.torch.spares;
      const dark = __lt.darknessProbe().max;
      const prompt = __lt.use(28.4, Y_C + 2.3, -82.4);
      __lt.sim(1);
      g.tick(0.5);
      g.tick(0.5);
      __lt.look(Math.PI / 2, 0.3);
      const m = __lt.measure();
      const again = __lt.lookAt(28.4, Y_C + 2.3, -82.4);
      return { prompt, spares0, spares1: g.run.torch.spares, lit: [...g.run.litSconces], dark, max: m.max, litPx: m.lit, again, torch: g.run.torch.state };
    });
    console.log('    ', JSON.stringify(r));
    check(/sconce|mount|spare/i.test(r.prompt || ''), 'the sconce offers to take a spare torch', JSON.stringify(r.prompt));
    check(r.spares1 === r.spares0 - 1 && r.lit.length === 1, 'mounting one spends a spare', `${r.spares0} -> ${r.spares1}`);
    check(r.dark === 0 && r.max > 40 && r.torch !== 'lit', 'and it lights the room with the hand torch still out', `brightest pixel ${r.dark} -> ${r.max}, ${r.litPx} px lit`);
  };

  scenarios.memory = async () => {
    // Scene state survives streaming: unload a scene, come back, and what you broke is still broken.
    await fresh();
    const r = await ev(() => {
      const g = __lt.game;
      __lt.setTime(390);
      // Take a relic in the halls and shove a block.
      __lt.teleport(0, Y_T + 0.1, -46.3);
      __lt.sim(0.4);
      const stocked = g.scenes.loaded.get('halls').entities.filter((e) => e.spot && e.top && e.model);
      const pick = stocked.find((e) => e.spot.id.endsWith('nave')) || stocked[0];
      const spotId = pick.spot.id;
      if (!spotId.endsWith('nave')) __lt.teleport(pick.top.x, Y_T + 0.1, pick.top.z + 1.6);
      const took = __lt.use(pick.top.x, pick.top.y + 0.15, pick.top.z);
      __lt.teleport(-21, Y_T + 0.1, -35.6);
      __lt.sim(0.3);
      __lt.walkTo(-21, -41, { timeout: 10, sprint: false, hop: false, tol: 0.25 });
      const block = g.scenes.loaded.get('halls').entities.find((e) => e.pushed && e.size);
      const bz = +block.body.translation().z.toFixed(2);
      // Break the catacomb floor behind us.
      __lt.teleport(41.3, Y_C + 0.1, -87);
      __lt.sim(0.4);
      const cross = __lt.walkTo(53, -87, { timeout: 6 });
      __lt.sim(3);
      const floor = g.scenes.loaded.get('catacombs').entities.find((e) => e.tiles && e.countZ);
      const broken0 = floor.tiles.filter((t) => t.timer.state === 'broken').length;
      // Go a long way away and let both scenes unload.
      __lt.teleport(0.5, 1, 150);
      for (let i = 0; i < 12; i++) g.scenes.update(1);
      const away = [...g.scenes.loaded.keys()];
      // Come back.
      __lt.teleport(-21, Y_T + 0.1, -35.6);
      __lt.sim(0.4);
      const halls = g.scenes.loaded.get('halls');
      const block2 = halls.entities.find((e) => e.pushed && e.size);
      const bz2 = +block2.body.translation().z.toFixed(2);
      const again = halls.entities.find((e) => e.spot && e.spot.id === spotId);
      const relicBack = !again || again.model !== null;
      const relics = __lt.state().relics;
      __lt.teleport(54, Y_C + 0.1, -87);
      __lt.sim(0.4);
      const floor2 = g.scenes.loaded.get('catacombs').entities.find((e) => e.tiles && e.countZ);
      const broken1 = floor2.tiles.filter((t) => t.timer.state === 'broken').length;
      // Walk back onto where the floor used to be.
      __lt.walkTo(47, -87, { timeout: 5, sprint: false, hop: false });
      __lt.sim(1.5);
      const s = __lt.state();
      return { took, spotId, relics, bz, bz2, cross: cross.ok, broken0, away, relicBack, broken1, y: s.pos.y, state: s.state, epitaph: s.epitaph };
    });
    console.log('    ', JSON.stringify(r));
    check(r.relics.length === 1 && !r.away.includes('halls') && !r.away.includes('catacombs'), 'both scenes unloaded behind the player', r.away.join(','));
    check(!r.relicBack, 'a taken relic does not respawn when its scene streams back in');
    check(Math.abs(r.bz - r.bz2) < 0.05 && r.bz < -39, 'a pushed block is where it was left', `z ${r.bz} -> ${r.bz2}`);
    check(r.broken0 > 0 && r.broken1 === r.broken0, 'crumbled tiles stay crumbled', `${r.broken0} -> ${r.broken1}`);
    check(r.y < -9.5 || r.state !== 'playing', 'and the hole they left is a real hole', `y=${r.y} ${r.state} ${r.epitaph || ''}`);
  };

  scenarios.collapse = async () => {
    await fresh();
    const r = await ev(() => {
      __lt.teleport(-49, Y_T + 1.0, -53.2);
      __lt.sim(0.6);
      const prompt = __lt.use(-49, Y_T + 0.9 + 1.25, -51);
      const s0 = __lt.state();
      const out = { prompt, relics: s0.relics, flags0: s0.flags, steps: [] };
      for (let i = 0; i < 8; i++) {
        __lt.sim(2);
        const s = __lt.state();
        out.steps.push({ t: (i + 1) * 2, hp: s.health, bodies: s.bodies, buried: s.flags.includes('doorBuried'), state: s.state });
      }
      out.log = window.__log.splice(0);
      return out;
    });
    console.log('    ', JSON.stringify(r).slice(0, 1500));
    check(r.relics.includes('dawn_idol'), 'took the Dawn Idol', String(r.prompt));
    check(r.steps.some((s) => s.buried), 'the collapse buries the door back to the halls');
    check(r.log.some((l) => l.startsWith('toast')), 'collapse is announced', r.log.filter((l) => l.startsWith('toast')).join(' | '));
  };

  scenarios.weight = async () => {
    await fresh();
    const r = await ev(() => {
      const p = __lt.game.player;
      const run = (label) => {
        __lt.teleport(-15, 0.1, 30, 0);
        __lt.sim(0.5);
        p.stamina = 100;
        const z0 = p.pos.z;
        __lt.game.input.script = { moveX: 0, moveZ: 1, sprint: true, crouch: false };
        __lt.game.simulate(180, () => { p.yaw = 0; return true; });
        __lt.game.input.script = null;
        return { label, metres: +(z0 - p.pos.z).toFixed(2), stamina: +p.stamina.toFixed(1), kg: __lt.state().weight };
      };
      const a = run('empty');
      __lt.give('gold_jaguar');
      const b = run('gold jaguar');
      return { a, b, cap: __lt.game.run.satchel.capacity };
    });
    console.log('    ', JSON.stringify(r));
    check(r.b.metres < r.a.metres * 0.9, 'a heavy satchel slows the sprint', `${r.a.metres} m vs ${r.b.metres} m in 3 s`);
    check(r.b.stamina < r.a.stamina - 3, 'and drains stamina faster', `${r.a.stamina} vs ${r.b.stamina}`);
  };

  // ------------------------------------------------------------- streaming
  scenarios.streaming = async () => {
    await fresh();
    const r = await ev(() => {
      const g = __lt.game;
      const seen = [];
      let worstBuild = 0;
      const sample = (label) => {
        const s = __lt.state();
        seen.push(`${label}: ${s.scene} [${s.loaded.join(',')}]${s.building ? ' building ' + s.building : ''} bodies ${s.bodies}`);
      };
      const walk = (pts, label) => {
        for (const [x, z] of pts) {
          g.input.script = null;
          __lt.walkTo(x, z, { timeout: 30 });
          worstBuild = Math.max(worstBuild, g.scenes.buildMs);
        }
        sample(label);
      };
      sample('camp');
      __lt.teleport(0, 0.2, 60);
      __lt.sim(1);
      walk([[0, 44], [0, 30]], 'courtyard');
      walk([[7, 16], [7, 3], [0, -6], [0, -15], [0, -27]], 'halls');
      __lt.flag('sealOpen');
      __lt.sim(4);
      walk([[-11.5, -30]], 'west gallery');
      __lt.teleport(16, 1.3, -70);
      __lt.sim(1);
      walk([[16, -75], [16, -86], [27, -86], [31, -87]], 'catacombs');
      __lt.flag('vaultGate');
      __lt.teleport(3, -7.9, -91.5);
      __lt.sim(4);
      walk([[-6, -91.5], [-23, -91.5], [-26.5, -91.5]], 'vault');
      return { seen, worstBuild };
    });
    for (const l of r.seen) console.log('    ', l);
    const sets = r.seen.map((l) => l.match(/\[(.*?)\]/)[1]);
    check(new Set(sets).size >= 4, 'scenes stream in and out as the player moves', `${new Set(sets).size} different loaded sets`);
    check(!sets[sets.length - 1].includes('jungle') && !sets[0].includes('vault'), 'far scenes are unloaded (no jungle in the vault, no vault at camp)');
  };

  // -------------------------------------------------------------- menus/save
  scenarios.menus = async () => {
    await ev(() => { localStorage.clear(); });
    await page.reload();
    await page.waitForFunction(() => window.__lt && window.__lt.game.state === 'menu', null, { timeout: 120000 });
    const texts = async () => ev(() => [...document.querySelectorAll('.menus button')].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()));
    const click = async (label) => {
      const ok = await ev((label) => {
        const b = [...document.querySelectorAll('.menus button')].find((b) => b.offsetParent !== null && b.textContent.trim().toLowerCase().includes(label.toLowerCase()));
        if (b) b.click();
        return !!b;
      }, label);
      await page.waitForTimeout(250);
      return ok;
    };
    const main = await texts();
    console.log('    main menu:', main.join(' | '));
    check(main.length >= 5, 'main menu has its buttons');
    // Bank a run so there are coins to spend.
    await fresh();
    await ev(() => {
      __lt.teleport(0, 0.1, 30);
      __lt.sim(0.3);
      __lt.give('crystal_skull');
      __lt.give('royal_crown');
      __lt.walkTo(0, 43.6, {});
      __lt.walkTo(0, 47, { timeout: 4 });
    });
    await page.waitForFunction(() => __lt.state().state === 'results', null, { timeout: 30000 }).catch(() => {});
    const res = await ev(() => ({ state: __lt.state().state, coins: __lt.state().coins, text: document.querySelector('.menus').innerText.slice(0, 400) }));
    console.log('    results:', JSON.stringify(res));
    check(res.state === 'results' && res.coins > 0, 'results screen after an escape, coins banked', `${res.coins} coins`);
    console.log('    results buttons:', (await texts()).join(' | '));
    check(await click('outfitter'), 'open the outfitter from the results screen');
    const shop = await texts();
    console.log('    shop:', shop.join(' | '));
    const before = await ev(() => ({ coins: __lt.game.meta.data.coins, gear: { ...__lt.game.meta.data.gear } }));
    const bought = await ev(() => {
      const b = [...document.querySelectorAll('.menus button')].find((b) => b.offsetParent !== null && /buy|\d+\s*coins/i.test(b.textContent) && !b.disabled);
      if (b) b.click();
      return b ? b.textContent.trim() : null;
    });
    await page.waitForTimeout(200);
    const after = await ev(() => ({ coins: __lt.game.meta.data.coins, gear: { ...__lt.game.meta.data.gear } }));
    console.log('    bought:', bought, JSON.stringify(before), '->', JSON.stringify(after));
    check(bought && after.coins < before.coins && JSON.stringify(after.gear) !== JSON.stringify(before.gear), 'buying gear spends coins and raises a gear level');
    await page.reload();
    await page.waitForFunction(() => window.__lt && window.__lt.game.state === 'menu', null, { timeout: 120000 });
    const persisted = await ev(() => ({ coins: __lt.game.meta.data.coins, gear: { ...__lt.game.meta.data.gear }, scores: __lt.game.meta.data.scores.length, runs: __lt.game.meta.data.runs }));
    console.log('    after reload:', JSON.stringify(persisted));
    check(persisted.coins === after.coins && JSON.stringify(persisted.gear) === JSON.stringify(after.gear) && persisted.scores >= 1, 'coins, gear and scores survive a page reload (localStorage)');
    check(await click('score'), 'open the high-score table');
    const table = await ev(() => document.querySelector('.menus').innerText.slice(0, 300));
    console.log('    scores card:', JSON.stringify(table));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check(await click('settings'), 'open settings');
    const settings = await ev(() => [...document.querySelectorAll('.menus input, .menus select')].filter((e) => e.offsetParent !== null).map((e) => `${e.tagName.toLowerCase()}${e.type ? ':' + e.type : ''}`));
    console.log('    settings controls:', settings.join(' '));
    check(settings.length >= 5, 'settings has FOV, sensitivity, volume and quality controls', `${settings.length} controls`);
    const fov = await ev(() => {
      const r = [...document.querySelectorAll('.menus input[type=range]')][0];
      r.value = '95';
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
      return { setting: __lt.game.meta.data.settings.fov, camera: __lt.game.renderer.camera.fov };
    });
    check(fov.setting === 95 && Math.abs(fov.camera - 95) < 0.01, 'the FOV slider drives the camera', JSON.stringify(fov));
    await page.keyboard.press('Escape');
    // Pause and resume.
    await fresh();
    const pause = await ev(() => {
      const g = __lt.game;
      g.pause();
      const a = g.state;
      const t0 = g.run.time;
      g.tick(0.5);
      const frozen = g.run.time === t0;
      g.resume();
      return { a, frozen, b: g.state };
    });
    check(pause.a === 'paused' && pause.frozen && pause.b === 'playing', 'pause stops the clock, resume restarts it', JSON.stringify(pause));
    const overlay = await ev(() => {
      __lt.press('debug');
      __lt.game.tick(0.016);
      const d = document.querySelector('.debug');
      const text = d ? d.innerText : '';
      __lt.press('map');
      __lt.game.tick(0.016);
      const m = document.querySelector('.mapview');
      return { debug: text.slice(0, 200), map: !!m && getComputedStyle(m).display !== 'none' };
    });
    console.log('    debug overlay:', JSON.stringify(overlay.debug));
    check(/fps/i.test(overlay.debug) && /bod/i.test(overlay.debug) && /scene/i.test(overlay.debug), 'debug overlay shows FPS, physics bodies and the current scene');
    check(overlay.map, 'the map opens');
  };

  scenarios.carry = async () => {
    await fresh();
    const r = await ev(() => {
      const g = __lt.game;
      __lt.teleport(26.5, 0.1, 20.4);
      __lt.sim(0.6);
      const rock = g.scenes.loaded.get('courtyard').entities.find((e) => e.rec && e.rec.id === 'courtyard.rockA');
      const p0 = { ...rock.body.translation() };
      __lt.use(p0.x, p0.y, p0.z);
      const held = __lt.state().held;
      // Carry it a few metres: it should travel with the player.
      __lt.walkTo(22, 16, { sprint: false });
      const carried = { ...rock.body.translation() };
      const heard = [];
      const stop = g.listenNoise((n) => heard.push(n.kind));
      __lt.look(Math.PI / 2, 0.25); // face west, aim a little up
      __lt.press('throw');
      const v = rock.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      __lt.sim(2.5);
      stop();
      for (let i = 0; i < 20 && Math.hypot(rock.body.linvel().x, rock.body.linvel().z) > 0.15; i++) __lt.sim(0.5);
      const p1 = { ...rock.body.translation() };
      const s = __lt.state();
      // Pick it up again and just put it down.
      const walk = __lt.walkTo(p1.x + 1.3, p1.z, { sprint: false, timeout: 10, tol: 0.3 });
      const p2 = { ...rock.body.translation() };
      const prompt2 = __lt.use(p2.x, p2.y, p2.z);
      const again = __lt.state().held;
      __lt.press('drop');
      __lt.sim(0.5);
      return { held, carriedDist: +Math.hypot(carried.x - p0.x, carried.z - p0.z).toFixed(1), speed: +speed.toFixed(1), flew: +Math.hypot(p1.x - carried.x, p1.z - carried.z).toFixed(1), heldAfter: s.held, heard: [...new Set(heard)], again, dropped: __lt.state().held, prompt2 };
    });
    console.log('    ', JSON.stringify(r));
    check(!!r.held && r.carriedDist > 3, 'a grabbed prop is carried with the player', `${r.held}, moved ${r.carriedDist} m`);
    check(r.speed > 5 && r.flew > 3 && !r.heldAfter, 'left mouse throws it', `${r.speed} m/s, landed ${r.flew} m away`);
    check(r.heard.length > 0, 'where it lands makes noise the guardians can hear', r.heard.join(','));
    check(!!r.again && !r.dropped, 'it can be picked up again and dropped');
  };

  scenarios.ghost = async () => {
    await fresh(21);
    const r = await ev(() => {
      const g = __lt.game;
      g.meta.data.ghost = null;
      // A short "best run": in through the door, grab a relic, back out.
      __lt.route([[0.5, 150], [0, 140]], { timeout: 10 });
      __lt.teleport(0, 0.1, 44);
      __lt.walkTo(0, 36, { timeout: 6 });
      __lt.give('jade_mask');
      __lt.walkTo(0, 46, { timeout: 6 });
      for (let i = 0; i < 30 && g.state !== 'results'; i++) g.tick(0.1);
      const d = g.meta.data.ghost;
      return { state: g.state, outcome: g.result && g.result.outcome, samples: d ? d.samples.length / 3 : 0, haul: d && d.haul };
    });
    console.log('    ', JSON.stringify(r));
    check(r.outcome === 'escaped' && r.samples > 5, 'an escape records a ghost of the run', `${r.samples} samples, haul ${r.haul}`);
    await fresh(22);
    const q = await ev(() => {
      const g = __lt.game;
      const seen = [];
      for (let i = 0; i < 6; i++) {
        __lt.sim(1);
        g.tick(0.016);
        seen.push(g.ghost.visible ? [+g.ghost.position.x.toFixed(1), +g.ghost.position.z.toFixed(1)] : null);
      }
      return { seen, show: g.meta.data.settings.showGhost };
    });
    console.log('    ', JSON.stringify(q));
    const pts = q.seen.filter(Boolean);
    check(pts.length >= 4 && pts[0][1] > pts[pts.length - 1][1], 'the next run shows that ghost walking the same path', JSON.stringify(pts));
  };

  scenarios.gamepad = async () => {
    await fresh();
    const r = await ev(() => {
      const g = __lt.game;
      const pad = { connected: true, axes: [0, -1, 0.6, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      const real = navigator.getGamepads;
      navigator.getGamepads = () => [pad];
      const z0 = g.player.pos.z;
      const yaw0 = g.player.yaw;
      for (let i = 0; i < 30; i++) g.tick(1 / 30);
      const walked = z0 - g.player.pos.z;
      const turned = g.player.yaw - yaw0;
      pad.axes = [0, 0, 0, 0];
      for (let i = 0; i < 10; i++) g.tick(1 / 30);
      const y0 = g.player.pos.y;
      pad.buttons[0] = { pressed: true, value: 1 }; // A: jump
      let rose = 0;
      for (let i = 0; i < 8; i++) {
        g.tick(1 / 30);
        rose = Math.max(rose, g.player.pos.y - y0);
      }
      pad.buttons[0] = { pressed: false, value: 0 };
      for (let i = 0; i < 30; i++) g.tick(1 / 30);
      pad.buttons[3] = { pressed: true, value: 1 }; // Y: torch
      g.tick(1 / 30);
      pad.buttons[3] = { pressed: false, value: 0 };
      pad.buttons[9] = { pressed: true, value: 1 }; // Start: pause
      for (let i = 0; i < 3; i++) g.tick(1 / 30);
      const state = g.state;
      navigator.getGamepads = real;
      g.resume();
      return { walked: +walked.toFixed(2), turned: +turned.toFixed(2), torch: g.run.torch.state, rose: +rose.toFixed(2), state };
    });
    console.log('    ', JSON.stringify(r));
    check(r.walked > 1.5, 'left stick walks', `${r.walked} m in a second`);
    check(Math.abs(r.turned) > 0.3, 'right stick looks', `${r.turned} rad`);
    check(r.torch === 'relighting' || r.torch === 'lit', 'Y strikes the torch', r.torch);
    check(r.rose > 0.5, 'A jumps', `rose ${r.rose} m`);
    check(r.state === 'paused', 'Start pauses', r.state);
  };

  // ------------------------------------------------- real input, real audio
  scenarios.input = async () => {
    // Everything above drives the game through the script hooks with sound off.
    // This one goes in the front door: real clicks, real keys, audio running.
    await page.reload();
    await page.waitForFunction(() => window.__lt && window.__lt.game.state === 'menu', null, { timeout: 120000 });
    await page.getByRole('button', { name: /enter the temple/i }).click();
    await page.waitForFunction(() => __lt.game.state === 'playing', null, { timeout: 30000 });
    await ev(() => __lt.quality('low'));
    await page.mouse.click(640, 360);
    await page.waitForTimeout(400);
    const a = await ev(() => {
      const g = __lt.game;
      return { locked: document.pointerLockElement === g.canvas, audio: g.audio.enabled, ctx: g.audio.ctx ? g.audio.ctx.state : 'none', z: g.player.pos.z, yaw: g.player.yaw, auto: g.autoplay };
    });
    console.log('    after clicking in:', JSON.stringify(a));
    check(a.audio && a.ctx === 'running', 'the click unlocks WebAudio', a.ctx);
    check(a.locked, 'the click captures the mouse (pointer lock)');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(3000);
    await page.keyboard.up('KeyW');
    // Headless Chromium invents its own mouse deltas under pointer lock, so hand the page one known event.
    await ev(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 140, movementY: -30 })));
    await page.waitForTimeout(900);
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(1500);
    const b = await ev(() => {
      const g = __lt.game;
      return { z: g.player.pos.z, yaw: g.player.yaw, pitch: g.player.pitch, torch: g.run.torch.state, time: g.run.time };
    });
    console.log('    after W, mouse, F:', JSON.stringify(b));
    check(b.z < a.z - 0.8, 'holding W walks north', `z ${a.z.toFixed(1)} -> ${b.z.toFixed(1)} in ${b.time.toFixed(1)} s of game time`);
    check(b.yaw < a.yaw - 0.1 && b.pitch > 0.02, 'a mouse movement turns the view', `yaw ${a.yaw.toFixed(3)} -> ${b.yaw.toFixed(3)}, pitch ${b.pitch.toFixed(3)}`);
    check(b.torch === 'lit' || b.torch === 'relighting', 'F strikes the torch', b.torch);
    // Losing the mouse (Esc in a real browser) pauses; Resume takes it back.
    await ev(() => document.exitPointerLock());
    await page.waitForTimeout(700);
    const c = await ev(() => ({ state: __lt.game.state, buttons: [...document.querySelectorAll('.menus button')].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()) }));
    console.log('    after losing the mouse:', JSON.stringify(c));
    check(c.state === 'paused' && c.buttons.some((t) => /resume/i.test(t)), 'losing pointer lock pauses and shows the pause menu', c.buttons.join(', '));
    await page.getByRole('button', { name: /resume/i }).click();
    await page.waitForTimeout(700);
    const d = await ev(() => ({ state: __lt.game.state, locked: !!document.pointerLockElement }));
    check(d.state === 'playing' && d.locked, 'Resume returns to the game with the mouse captured', JSON.stringify(d));
    // The rest of the day with the mixer live. (Mouse released: this headless browser leaks
    // under pointer lock even on an empty page.)
    await ev(() => { __lt.game.autoplay = true; document.exitPointerLock(); });
    const stops = [
      ['last two minutes', 665, [0, 0.1, 30]], ['last minute', 725, [0, 0.1, 30]], ['in the halls', 730, [0, 1.3, -30]],
      ['in the catacombs', 735, [35, -7.9, -87]], ['nightfall underground', 781, [35, -7.9, -87]], ['night in the vault', 800, [-52, -13.9, -94]],
    ];
    const heard = [];
    let peak = 0;
    for (const [name, t, p] of stops) {
      await ev(({ t, p }) => {
        const g = __lt.game;
        if (!g.__voices) {
          g.__voices = 0;
          g.onFrame.add(() => { g.__voices = Math.max(g.__voices, g.audio.voiceCount); });
        }
        __lt.setTime(t);
        __lt.teleport(p[0], p[1], p[2]);
        g.__voices = 0;
      }, { t, p });
      await page.waitForTimeout(1600);
      const s = await ev(() => {
        const g = __lt.game;
        const st = g.audio.lastState;
        return { voices: g.__voices, state: g.state, ctx: g.audio.ctx.state, danger: st ? +st.danger.toFixed(2) : null, dungeon: st ? +st.dungeon.toFixed(2) : null, night: st ? +st.night.toFixed(2) : null, threat: st ? +st.threat.toFixed(2) : null };
      });
      peak = Math.max(peak, s.voices);
      heard.push(`${name.padEnd(22)} peak voices ${s.voices}, danger ${s.danger}, dungeon ${s.dungeon}, night ${s.night}, threat ${s.threat}, ${s.state}`);
      if (s.state !== 'playing') break;
    }
    console.log('    ' + heard.join('\n    '));
    check(peak > 0, 'one-shot voices are playing through the day', `peak ${peak} at once`);
    check(errors.length === 0, 'dusk, nightfall and the dungeon with no errors from the audio graph', errors.slice(0, 2).join(' | '));
  };

  for (const [name, fn] of Object.entries(scenarios)) {
    if (filter && !name.includes(filter)) continue;
    console.log(`\n== ${name}`);
    try {
      await fn();
    } catch (e) {
      check(false, `${name} threw`, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e));
    }
  }
  console.log(`\n${failures.length ? 'FAILED: ' + failures.join(' | ') : 'ALL SCENARIOS PASSED'}`);
  console.log('console errors:', errors.length, errors.slice(0, 5).join('\n'));
  await browser.close();
  process.exit(failures.length || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
