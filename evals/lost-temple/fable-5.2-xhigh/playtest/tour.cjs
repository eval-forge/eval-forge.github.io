/**
 * Teleport to a list of viewpoints and screenshot each one, at a few times of
 * day. A fast way to eyeball every scene.  node playtest/tour.cjs [filter]
 */
const { open, view } = require('./lib.cjs');

// name, [x, y, z], lookAt [x, y, z], time of day (0..1 of daylight; >1 = night), torch?
const VIEWS = [
  ['01-jungle-camp', [0.5, 1, 160], [0, 1.5, 140], 0.25],
  ['02-jungle-river', [3, 1.2, 131], [0, 0, 120], 0.3],
  ['03-jungle-bridge', [0, 0.2, 96], [0, 0, 80], 0.35],
  ['04-jungle-plaza', [0, 0.2, 60], [0, 3, 42], 0.4],
  ['05-court-entry', [0, 0.1, 37], [0, 3, -20], 0.45],
  ['06-court-sundial', [3, 0.1, 18], [0, 1, 10], 0.5],
  ['07-court-west', [-10, 0.1, 6], [-30, 0, -10], 0.5],
  ['08-court-east', [10, 0.1, 10], [31, 2, 6], 0.55],
  ['09-cliffs-top', [34, 0.1, 6], [44, -1, -8], 0.55],
  ['10-cliffs-ledge', [43.3, -2.5, -2], [43.3, -1, -30], 0.6],
  ['11-cliffs-spire', [42.6, -2.5, -30], [56, -2, -34.4], 0.6],
  ['12-halls-entry', [0, 1.3, -24], [0, 3, -60], 0.5],
  ['13-halls-nave', [0, 1.3, -35], [0, 2, -62], 0.5],
  ['14-halls-puzzle', [-10, 1.3, -37], [-22, 1.5, -46], 0.5],
  ['15-halls-blades', [-11.5, 1.3, -51], [-11.5, 2.5, -62], 0.5],
  ['16-halls-east', [16.5, 1.3, -34], [16.5, 5, -60], 0.5],
  ['17-halls-seal', [8, 1.3, -67], [16, 3, -73], 0.6],
  ['18-sanctum', [-36, 1.3, -44], [-49, 3, -51], 0.5],
  ['19-sanctum-west', [-45, 1.3, -60], [-62, 3, -50], 0.62],
  ['20-cata-stair', [16, -3.3, -86], [16, -1, -75], 0.5, true],
  ['21-cata-ossuary', [29.5, -7.9, -86], [41, -6.5, -87], 0.5, true],
  ['22-cata-darts', [26, -7.9, -91.5], [2, -7, -91.5], 0.5, true],
  ['23-cata-flooded', [35, -7.9, -101], [36, -8.5, -114], 0.5, true],
  ['24-cata-crumble', [42.5, -7.9, -87], [52, -8, -87], 0.5, true],
  ['25-cata-chapel', [53, -7.9, -87], [58.6, -7, -88], 0.5, true],
  ['26-cata-gate', [0, -7.9, -91.5], [-9, -6.5, -91.5], 0.5, true],
  ['27-vault-chasm', [-25, -13.9, -91.5], [-40, -14, -91.5], 0.5, true],
  ['28-vault-hall', [-43, -13.9, -91.5], [-60, -13, -90], 0.5, true],
  ['29-vault-lair', [-61, -13.9, -97.5], [-70, -13, -92], 0.5, true],
  ['30-vault-well', [-59, -13.9, -76.5], [-46, -9, -76.5], 0.5, true],
  ['31-court-dusk', [0, 0.1, 30], [0, 4, -20], 0.93],
  ['32-court-night', [0, 0.1, 30], [0, 4, 41], 1.04],
  ['33-jungle-noon', [0.5, 1, 150], [0, 1.5, 130], 0.5],
  ['34-halls-late', [0, 1.3, -35], [0, 2, -62], 0.8],
];

(async () => {
  const filter = process.argv[2];
  const { browser, page, errors } = await open();
  const quality = process.env.LT_QUALITY || 'medium';
  const begin = () => page.evaluate((q) => {
    __lt.start();
    __lt.quality(q);
    // Record what hurts the player on the way round.
    window.__dmg = [];
    const g = __lt.game;
    const damage = g.damage.bind(g);
    g.damage = (n, cause) => { window.__dmg.push(`${cause}:${n.toFixed(1)}`); damage(n, cause); };
  }, quality);
  await begin();
  for (const [name, pos, look, f, torch] of VIEWS) {
    if (filter && !name.includes(filter)) continue;
    const info = await page.evaluate(({ pos, look, f, torch }) => {
      __lt.setTime(f * 780);
      __lt.teleport(pos[0], pos[1], pos[2]);
      __lt.sim(0.4);
      __lt.torch(!!torch);
      __lt.lookAt(look[0], look[1], look[2]);
      __lt.sim(0.05);
      __lt.lookAt(look[0], look[1], look[2]);
      const s = __lt.state();
      return { scene: s.scene, pos: s.pos, health: s.health, dmg: window.__dmg.splice(0).join(' ') };
    }, { pos, look, f, torch });
    await page.waitForTimeout(500);
    await view(page, name);
    const s = await page.evaluate(() => { const s = __lt.state(); return { calls: s.calls, tris: s.triangles, state: s.state }; });
    console.log(name, JSON.stringify(info), JSON.stringify(s));
    if (s.state !== 'playing') await begin();
  }
  console.log('errors', errors.length, errors.slice(0, 6).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
