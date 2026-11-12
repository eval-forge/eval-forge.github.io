/** Boot, start a run, take a few screenshots. */
const { open, shot } = require('./lib.cjs');

(async () => {
  const t0 = Date.now();
  const { browser, page, errors } = await open();
  console.log('booted in', Date.now() - t0, 'ms');
  await page.waitForTimeout(1500);
  const t1 = Date.now(); await shot(page, "menu"); console.log("shot ms", Date.now() - t1);
  console.log('menu', JSON.stringify(await page.evaluate(() => { const s = __lt.state(); return { state: s.state, loaded: s.loaded, calls: s.calls, tris: s.triangles, fps: s.fps, bodies: s.bodies }; })));
  await page.evaluate(() => __lt.start());
  await page.waitForTimeout(1500);
  await shot(page, 'start');
  console.log('start', JSON.stringify(await page.evaluate(() => __lt.state())));
  console.log('errors', errors.length, errors.slice(0, 5).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
