/**
 * Frame cost per zone, scene build cost and streaming hitches.
 *
 *   node playtest/perf.cjs            # software renderer (what CI has)
 *   LT_GPU=1 node playtest/perf.cjs   # let Chromium use the real GPU, if there is one
 *
 * Without a GPU the frame times are SwiftShader's and say nothing about a real
 * laptop; draw calls, triangles and the CPU-side numbers still mean something.
 */
const { open } = require('./lib.cjs');

const FRAMES = +(process.env.LT_FRAMES || 12);

// name, position, look-at, day fraction, torch
const SPOTS = [
  ['A jungle', [0.5, 1, 150], [0, 1.5, 130], 0.4, false],
  ['A courtyard', [0, 0.1, 30], [0, 4, -20], 0.5, false],
  ['A cliffs', [43.3, -2.5, -2], [43.3, -1, -30], 0.6, false],
  ['B halls', [0, 1.3, -24], [0, 3, -60], 0.5, false],
  ['B sanctum', [-36, 1.3, -44], [-49, 3, -51], 0.5, false],
  ['C catacombs', [29.5, -7.9, -86], [41, -6.5, -87], 0.5, true],
  ['C vault', [-43, -13.9, -91.5], [-60, -13, -90], 0.5, true],
  ['A courtyard, night, guardians out', [0, 0.1, 20], [0, 3, -20], 1.07, true],
];

(async () => {
  const { browser, page, errors } = await open({ gpu: !!process.env.LT_GPU });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const info = await ev(() => {
    const gl = __lt.game.renderer.gl.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', cores: navigator.hardwareConcurrency, size: `${innerWidth}x${innerHeight}` };
  });
  console.log(`renderer: ${info.gpu}\ncores: ${info.cores}, viewport ${info.size}\n`);

  // 1. Cost of building each scene from nothing (all in one go).
  const builds = await ev(() => {
    __lt.start();
    __lt.quality('high');
    const g = __lt.game;
    const out = {};
    for (const id of ['jungle', 'courtyard', 'cliffs', 'halls', 'sanctum', 'catacombs', 'vault']) {
      if (g.scenes.loaded.has(id)) g.scenes.unload(id);
      const t0 = performance.now();
      g.scenes.ensure(id);
      out[id] = Math.round(performance.now() - t0);
    }
    return out;
  });
  console.log('full scene build, ms (run at once; in play it is sliced into 5 ms pieces per frame):');
  console.log('  ' + Object.entries(builds).map(([k, v]) => `${k} ${v}`).join(', '));

  // 2. Streaming: walk the whole route and record the worst single streaming update.
  const hitches = await ev(() => {
    __lt.start();
    __lt.quality('high');
    const g = __lt.game;
    const update = g.scenes.update.bind(g.scenes);
    const log = [];
    let worst = 0;
    g.scenes.update = (dt) => {
      const before = new Set(g.scenes.loaded.keys());
      const t0 = performance.now();
      update(dt);
      const ms = performance.now() - t0;
      worst = Math.max(worst, ms);
      for (const id of g.scenes.loaded.keys()) if (!before.has(id)) log.push(`${id} ${ms.toFixed(1)}`);
    };
    const path = [[0.5, 1, 150], [0, 0.2, 100], [0, 0.2, 60], [0, 0.1, 30], [34, 0.1, 6], [0, 0.1, 0], [0, 1.3, -24], [0, 1.3, -50], [8, 1.3, -67], [-20, 1.3, -44], [-40, 1.3, -50],
      [16, -3.3, -86], [30, -7.9, -86], [0, -7.9, -91.5], [-25, -13.9, -91.5], [-52, -13.9, -94]];
    for (const p of path) {
      // The teleport builds the scene it lands in synchronously (the debug hook's doing, not
      // streaming). The neighbours it then wants are streamed in by the loop below.
      __lt.teleport(p[0], p[1], p[2]);
      for (let i = 0; i < 400 && (g.scenes.buildingId || i < 30); i++) g.scenes.update(1 / 60);
    }
    g.scenes.update = update;
    return { worst: +worst.toFixed(1), log };
  });
  console.log(`\nstreaming: worst single frame spent in the scene manager ${hitches.worst} ms`);
  console.log('  frame in which each scene finished and was uploaded, ms: ' + hitches.log.join(', '));

  // 3. Per zone: what a frame costs.
  for (const q of (process.env.LT_QUALITIES || 'high,medium,low').split(',')) {
    console.log(`\nquality ${q}`);
    console.log('  zone                                 calls   tris    bodies  step ms  sim ms/step  frame ms   fps');
    await ev((q) => { __lt.start(); __lt.quality(q); }, q);
    for (const [name, pos, look, f, torch] of SPOTS) {
      await ev(({ pos, look, f, torch }) => {
        __lt.setTime(f * 780);
        __lt.teleport(pos[0], pos[1], pos[2]);
        __lt.torch(torch);
        __lt.sim(0.5);
        __lt.lookAt(look[0], look[1], look[2]);
        __lt.game.run.health = 100;
      }, { pos, look, f, torch });
      await page.waitForTimeout(600);
      const sim = await ev(() => {
        const g = __lt.game;
        const t0 = performance.now();
        g.simulate(240);
        return (performance.now() - t0) / 240;
      });
      const p = await ev((n) => __lt.perf(n), FRAMES);
      const s = await ev(() => __lt.state());
      console.log(`  ${name.padEnd(36)} ${String(p.calls).padStart(5)} ${String(p.triangles).padStart(7)} ${String(s.bodies).padStart(7)} ${p.stepMs.toFixed(2).padStart(8)} ${sim.toFixed(2).padStart(12)} ${p.avgMs.toFixed(1).padStart(9)} ${p.fps.toFixed(1).padStart(6)}`);
      if (s.state !== 'playing') await ev((q) => { __lt.start(); __lt.quality(q); }, q);
    }
  }
  console.log('\nconsole errors:', errors.length, errors.slice(0, 3).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
