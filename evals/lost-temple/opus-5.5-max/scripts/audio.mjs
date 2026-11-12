// Is the procedural audio making sound at all? The headless browser cannot listen, so this taps
// the mixer buses with analysers: the ambience and music buses carry signal in the jungle by day,
// each sound the prompt lists puts signal on the effects bus, and the final-minute cues fire
// (tense music, the red edge pulse, a rumble that shakes the camera). It says nothing about
// whether it sounds good.
// Usage: node scripts/audio.mjs
import { launch, startRun, st, wait } from './playtest-lib.mjs';
const { browser, page, errors } = await launch({ width: 320, height: 180 });
// the debug start skips the menu click, which is where the game creates its audio context
// (browsers only allow sound after a user gesture), so do what that click does first
await page.evaluate(() => window.lostTemple.game.audio.resume());
await startRun(page, 99);
let fails = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!ok) fails++;
};
const ctxState = await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.noGuardians();
  const a = lt.game.audio;
  const mk = (bus) => {
    const an = a.ctx.createAnalyser();
    an.fftSize = 32768; // about 0.7 s of history, so slow frames cannot skip a short sound
    bus.connect(an);
    return an;
  };
  window.__an = { amb: mk(a.amb), music: mk(a.music), sfx: mk(a.sfx) };
  return a.ctx.state;
});
check('the audio context is running', ctxState === 'running', ctxState);
const level = (bus, ms) =>
  page.evaluate(
    ([bus, ms]) =>
      new Promise((res) => {
        const an = window.__an[bus];
        const buf = new Float32Array(an.fftSize);
        let peak = 0;
        let sum = 0;
        let n = 0;
        const t0 = performance.now();
        const read = () => {
          an.getFloatTimeDomainData(buf);
          for (let i = 0; i < buf.length; i += 4) {
            const v = buf[i];
            if (Math.abs(v) > peak) peak = Math.abs(v);
            sum += v * v;
            n++;
          }
          if (performance.now() - t0 > ms) res({ peak: +peak.toFixed(4), rms: +Math.sqrt(sum / Math.max(1, n)).toFixed(5) });
          else setTimeout(read, 150);
        };
        read();
      }),
    [bus, ms],
  );
await wait(page, 3000);
const amb = await level('amb', 3000);
const music = await level('music', 3000);
check('jungle ambience by day is audible', amb.rms > 1e-4, JSON.stringify(amb));
check('the music is playing', music.rms > 1e-4, JSON.stringify(music));
const quiet = await level('sfx', 1500);
console.log('effects bus with nothing triggered:', JSON.stringify(quiet));
const names = ['tick', 'heartbeat', 'woodCreak', 'woodSnap', 'plankCrack', 'stoneGrind', 'rumble', 'torchLight', 'torchOut', 'sentinel', 'crawler', 'shadow', 'gong', 'dartFire', 'crumble', 'debris', 'splash', 'chime', 'caught'];
const silent = [];
const peaks = {};
for (const name of names) {
  // tap this effect's own voice: on the shared bus a long sound (the rumble, a guardian call)
  // would still be ringing while the next one is measured
  await page.evaluate((n) => {
    const a = window.lostTemple.game.audio;
    const voice = a.voice;
    const caps = [];
    a.voice = (...args) => {
      const v = voice.apply(a, args);
      caps.push(v);
      return v;
    };
    try {
      window.lostTemple.game.sfx.play(n, null, 1);
    } finally {
      a.voice = voice;
    }
    const an = a.ctx.createAnalyser();
    an.fftSize = 32768;
    for (const v of caps) v.out.connect(an);
    window.__an.fx = an;
  }, name);
  const l = await level('fx', 900);
  peaks[name] = l.peak;
  if (l.peak < 0.01) silent.push(name);
}
console.log('peaks', JSON.stringify(peaks));
check('every listed effect makes sound', silent.length === 0, silent.length ? 'silent: ' + silent.join(', ') : `${names.length} effects`);
for (const loop of ['torch', 'grind', 'wind', 'river']) {
  // tap the loop's own voice (wind and river play on the ambience bus, the others on the
  // effects bus, and a bus would also carry the previous loop's fade-out)
  await page.evaluate((k) => {
    const a = window.lostTemple.game.audio;
    const voice = a.voice;
    let captured = null;
    a.voice = (...args) => (captured = voice.apply(a, args));
    try {
      window.__loop = window.lostTemple.game.sfx.loop(k, null, 1);
    } finally {
      a.voice = voice;
    }
    const an = a.ctx.createAnalyser();
    an.fftSize = 32768;
    captured.out.connect(an);
    window.__an.loop = an;
  }, loop);
  const l = await level('loop', 1500);
  await page.evaluate(() => window.__loop?.stop());
  check(`the ${loop} loop makes sound`, l.rms > 1e-4, JSON.stringify(l));
}
// the final minute
await page.evaluate(() => {
  const lt = window.lostTemple;
  lt.speed(2);
  lt.setTime(61.2);
  // the shake decays within a second or so of game time: record its peak every frame
  window.__maxShake = 0;
  const watch = () => {
    window.__maxShake = Math.max(window.__maxShake, lt.game.run.player.shake);
    requestAnimationFrame(watch);
  };
  watch();
});
let s = await st(page);
for (let i = 0; i < 40 && s.remaining > 59.3; i++) {
  await wait(page, 250);
  s = await st(page);
}
const cues = await page.evaluate(() => {
  const g = window.lostTemple.game;
  return {
    tension: g.music.tension,
    edge: +(g.hud.edge.style.opacity || 0),
    shake: +window.__maxShake.toFixed(2),
    dusk: +g.amb.dusk.toFixed(2),
    toast: [...document.querySelectorAll('#toasts > *, .toast')].map((e) => e.textContent).join(' | '),
  };
});
check('at one minute the music turns tense', cues.tension >= 0.8, JSON.stringify(cues.tension));
check('at one minute the screen edges pulse', cues.edge > 0, 'edge opacity ' + cues.edge);
// (the rumble adds 1.1 to the shake; at this test's game speed the first frame's decay halves it before anything can read it)
check('at one minute the temple rumbles and shakes the view', cues.shake > 0.3 && /shudders/.test(cues.toast), `peak shake ${cues.shake}, toasts "${cues.toast}"`);
check('dusk rumbles are building in the ambience', cues.dusk > 0.5, 'dusk ' + cues.dusk);
console.log(fails ? `AUDIO: ${fails} FAILED` : 'AUDIO: ALL PASS');
console.log('errors:', errors.length ? errors.slice(0, 20).join('\n') : 'none');
await browser.close();
process.exit(fails ? 1 : 0);
