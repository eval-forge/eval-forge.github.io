// Visit every scene, settle, and report frame cost, draw calls, triangles and physics bodies.
// Usage: node scripts/tour.mjs [quality] [timeLeftSeconds]
import { launch, startRun, st, wait, sampleFps, shot } from './playtest-lib.mjs';
import fs from 'node:fs';
const quality = process.argv[2] || 'medium';
const timeLeft = process.argv[3] ? Number(process.argv[3]) : null;
fs.mkdirSync(process.env.LT_SHOTS || 'shots', { recursive: true });
const { browser, page, errors } = await launch({ width: 960, height: 540 });
await page.evaluate((q) => window.lostTemple.quality(q), quality);
await startRun(page);
await page.evaluate(() => {
  window.lostTemple.noGuardians();
  window.lostTemple.god(true);
});
if (timeLeft != null) await page.evaluate((t) => window.lostTemple.setTime(t), timeLeft);
const stops = [
  ['jungle', [0, null, 150], 0],
  ['jungle-bridge', 'jungle', 0],
  ['courtyard', [0, 0.1, 40], 0],
  ['cliffs', 'cliffs', -1.2],
  ['halls', 'halls', 0],
  ['sanctum', 'sanctum', 0],
  ['catacombs', 'catacombs', 0],
  ['vault', 'vault', 0],
];
const rows = [];
for (const [name, where, yaw] of stops) {
  await page.evaluate(
    ([w, y]) => {
      const lt = window.lostTemple;
      if (Array.isArray(w) && w[1] == null) {
        // ground height for the jungle trail
        w = [w[0], 2, w[2]];
      }
      lt.teleport(w, y);
      lt.finishLoading();
    },
    [where, yaw],
  );
  await wait(page, 2500);
  if (name === 'catacombs' || name === 'vault') {
    // light the torch for the picture (zone C is pitch black otherwise)
    await page.evaluate(() => window.lostTemple.light());
    await wait(page, 1200);
  }
  const f = await sampleFps(page, 2500);
  const c = await page.evaluate(() => window.lostTemple.cpu());
  const s = await st(page);
  await shot(page, `tour-${quality}-${name}`);
  rows.push({
    stop: name,
    scene: s.scene,
    loaded: s.loaded.join('+'),
    fps: f.fps.toFixed(1),
    updateMs: c.updateMs.toFixed(2),
    physicsMs: c.info.physicsMs.toFixed(2),
    renderCallMs: c.renderMs.toFixed(1),
    calls: c.info.calls,
    tris: (c.info.triangles / 1000).toFixed(0) + 'k',
    bodies: c.info.bodies,
    colliders: c.info.colliders,
    camDark: s.camDark,
  });
  console.log(JSON.stringify(rows[rows.length - 1]));
}
console.table(rows);
console.log('errors:', errors.length ? errors.slice(0, 30).join('\n') : 'none');
await browser.close();
