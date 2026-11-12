// Headless progression test: drives the critical path with simulated input.
// Usage: node scripts/progression.mjs [url] [outDir]   (dev server must be running)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] ?? 'http://localhost:5173/?debug=1';
const out = process.argv[3] ?? 'playtest-out';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('lostTemple.profile.v1', JSON.stringify({ settings: { quality: 'low' } })));
await page.goto(url);
await page.waitForFunction(() => window.__game);
const E = (src) => page.evaluate(`(() => { const G = window.__game; ${src} })()`);
const st = () => E('return G.stats()');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); };
const shot = async (n) => { await page.waitForTimeout(800); await page.screenshot({ path: `${out}/prog-${n}.png` }); };

await E('G.startRun()');
// 1. rope bridge over the gorge
await E('G.tp([0, 0.3, 129], 0); G.hold("forward"); G.simulate(7); G.hold("forward", false);');
let s = await st();
check('cross gorge rope bridge', s.pos[2] < 108 && s.pos[1] > -3 && s.mode === 'play', s.pos);
await shot('1-bridge');
// 2. great door
await E('G.tp([0, 0.3, 12.5], 0); G.simulate(0.3);');
s = await st();
check('door prompt', /heave/.test(s.prompt ?? ''), s.prompt);
await E('G.hold("interact"); G.simulate(0.1); G.hold("interact", false); G.simulate(10);');
s = await st();
check('door opened flag', !!s.flags.doorOpened);
await E('G.hold("forward"); G.simulate(5); G.hold("forward", false);');
s = await st();
check('walk through door into halls', s.scene === 'halls', s.pos);
await shot('2-door');
// 3. sundial
await E('G.tp([0, 0.3, 48.5], Math.PI); G.simulate(0.3);');
s = await st();
check('sundial prompt', /sundial/.test(s.prompt ?? ''), s.prompt);
for (let i = 0; i < 13; i++) {
  s = await st();
  if (s.flags.sundialSolved) break;
  await E('G.hold("interact"); G.simulate(0.1); G.hold("interact", false); G.simulate(0.2);');
}
s = await st();
check('sundial solved', !!s.flags.sundialSolved);
await E('G.simulate(1.5); G.tp([0, 0.3, 55.3], Math.PI); G.simulate(0.5); const d = G.props.props.get("sundisc").body.translation(); G.lookAt(d.x, d.y, d.z); G.simulate(0.05);');
s = await st();
check('sun-disc prompt', /Sun-disc/.test(s.prompt ?? ''), s.prompt);
await E('G.hold("interact"); G.simulate(0.1); G.hold("interact", false);');
s = await st();
check('took sun-disc', !!s.flags.hasSunDisc);
await shot('3-sundial');
// 4. push the block onto the plate
await E('G.tp([10.2, 0.3, -54], -Math.PI / 2); G.player.pitch = 0; G.hold("forward"); G.simulate(14); G.hold("forward", false); G.simulate(1);');
s = await st();
check('block holds sanctum gate', !!s.flags.sanctumGateHeld, { player: s.pos, block: await E('const b = G.props.props.get("h_block"); return b && b.body.translation();') });
await shot('4-block');
// 5. set the sun-disc into the seal
await E('G.tp([-10, 0.3, -100.6], Math.PI); G.simulate(0.3); G.lookAt(-10, 0.5, -103); G.simulate(0.05);');
s = await st();
check('seal prompt', /seal/.test(s.prompt ?? ''), s.prompt);
await E('G.hold("interact"); G.simulate(0.1); G.hold("interact", false); G.simulate(8);');
s = await st();
check('seal open', !!s.flags.sealOpen);
await shot('5-seal');
// 5b. down the seal stairs into the catacombs
await E('G.tp([-10, 0.3, -99.3], 0); G.player.pitch = 0; G.hold("forward"); G.simulate(6); G.hold("forward", false);');
s = await st();
check('descend seal stairs to catacombs', s.scene === 'catacombs' && s.pos[1] < -11, s.pos);
await shot('5b-stairs');
// 5c. crumbling corridor (may legitimately drop you into the pit below)
await E('G.tp([-4, -11.7, -133], 0); G.player.pitch = 0; G.hold("sprint"); G.hold("forward"); G.simulate(5); G.hold("forward", false); G.hold("sprint", false);');
s = await st();
console.log('INFO crumbling corridor sprint ->', JSON.stringify(s.pos.map((v) => +v.toFixed(1))), s.mode);
// 5d. flooded chamber: water drowns the torch; key on the island
await E('G.runState.health = 100; G.tp([31, -13.1, -158], -Math.PI / 2); G.simulate(1.2);');
s = await st();
check('wading drowns the torch', !s.torch.lit, s.torch);
await E('const k = G.props.props.get("c_key"); const t = k.body.translation(); G.tp([t.x - 1.4, t.y, t.z], -Math.PI / 2); G.simulate(0.4); const t2 = k.body.translation(); G.lookAt(t2.x, t2.y, t2.z); G.simulate(0.05);');
s = await st();
check('obsidian key prompt', /Obsidian Key/.test(s.prompt ?? ''), s.prompt);
await E('G.hold("interact"); G.simulate(0.1); G.hold("interact", false);');
s = await st();
check('took obsidian key', !!s.flags.hasObsidianKey);
await E('G.tp([22, -11.7, -158], -Math.PI / 2); G.simulate(0.2); G.hold("relight"); G.simulate(0.1); G.hold("relight", false); G.simulate(3);');
s = await st();
check('relight torch out of the water', s.torch.lit, { torch: s.torch, pos: s.pos });
// 5e. vault door
await E('G.tp([0, -11.7, -172.5], 0); G.simulate(0.3); G.lookAt(0, -11, -176); G.simulate(0.05);');
s = await st();
check('vault door prompt', /unlock the vault/.test(s.prompt ?? ''), s.prompt);
await E('G.hold("interact"); G.simulate(0.1); G.hold("interact", false); G.simulate(6); G.hold("forward"); G.simulate(6); G.hold("forward", false);');
s = await st();
check('vault opened and entered', !!s.flags.vaultOpen && s.scene === 'vault', s.pos);
await shot('5e-vault');
// 5f. drawbridge lever (shortcut)
await E('G.tp([-9.8, -19.7, -199.5], Math.PI / 2); G.simulate(0.3); G.lookAt(-11.5, -19.2, -199.5); G.simulate(0.05);');
s = await st();
check('drawbridge lever prompt', /drawbridge/.test(s.prompt ?? ''), s.prompt);
await E('G.hold("interact"); G.simulate(0.1); G.hold("interact", false); G.simulate(5);');
s = await st();
check('drawbridge lowered', !!s.flags.drawbridgeLowered);
await E('G.tp([-16, -19.7, -195], Math.PI / 2); G.player.pitch = 0; G.hold("forward"); G.simulate(3); G.hold("forward", false);');
s = await st();
check('cross drawbridge to the west ledge', s.pos[0] < -22 && s.pos[1] > -21, s.pos);
// 5g. kick the cracked wall from the west wing side
await E('G.tp([-24, 0.3, -16.6], Math.PI); G.simulate(0.3); G.lookAt(-24, 1.2, -14.5); G.simulate(0.05);');
s = await st();
check('cracked wall prompt', /kick|wall/i.test(s.prompt ?? ''), s.prompt);
for (let i = 0; i < 4; i++) await E('G.hold("interact"); G.simulate(0.1); G.hold("interact", false); G.simulate(0.8);');
s = await st();
check('cracked wall kicked open', !!s.flags.wallKicked);
// map
await E('G.hold("map"); G.simulate(0.05); G.hold("map", false);');
await shot('map');
await E('G.hold("map"); G.simulate(0.05); G.hold("map", false);');
// 6. trapped pedestal in the vault: take the crown without a swap
await E('G.tp([-6, -19.7, -206.5], 0); G.simulate(0.3); G.lookAt(-6, -18.6, -209); G.simulate(0.05);');
s = await st();
check('crown prompt', /Sun Crown/.test(s.prompt ?? ''), s.prompt);
const hp0 = s.health;
await E('G.hold("interact"); G.simulate(0.1); G.hold("interact", false); G.simulate(4);');
s = await st();
check('pedestal trap fires darts', s.health < hp0 || s.mode !== 'play', { hp: s.health, carried: s.carried });
await shot('6-pedestal');
// 7. escape through the great door with the haul
await E('G.runState.health = 100; G.tp([0, 0.3, 13], 0); G.simulate(0.3);');
s = await st();
const bank0 = await E('return G.profile.bank');
check('escape prompt', /leave the temple/.test(s.prompt ?? ''), s.prompt);
await E('G.hold("interact"); G.simulate(0.1); G.hold("interact", false);');
s = await st();
const bank1 = await E('return G.profile.bank');
check('escaped and banked', s.outcome === 'escaped' && bank1 > bank0, { outcome: s.outcome, bank0, bank1 });
await shot('7-results');
console.log(`\n${pass} passed, ${fail} failed`);
console.log('errors:', errors.slice(0, 20));
await browser.close();
