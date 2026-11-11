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
