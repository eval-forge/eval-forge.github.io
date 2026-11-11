import type * as THREE from 'three';

/**
 * Procedural WebAudio. Every sound is synthesised from oscillators and noise.
 * One-shots are positional (stereo pan + distance falloff relative to the listener).
 */
export class AudioSystem {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private amb!: GainNode;
  private noiseBuf!: AudioBuffer;
  private brownBuf!: AudioBuffer;
  private listener = { x: 0, y: 0, z: 0, yaw: 0 };
  volumes = { master: 0.8, music: 0.6, sfx: 0.9 };
  // ambience layers
  private jungle?: { gain: GainNode; birds: number };
  private wind?: { gain: GainNode; filter: BiquadFilterNode };
  private drone?: { gain: GainNode; oscs: OscillatorNode[]; filter: BiquadFilterNode };
  private crackle?: { gain: GainNode };
  private cave?: { gain: GainNode };
  private nextBird = 0;
  private nextDrip = 0;
  private nextCrackle = 0;
  private musicStep = 0;
  private nextBeat = 0;
  private heartNext = 0;
  critical = false;
  night = false;

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.connect(this.master);
    this.amb = ctx.createGain(); this.amb.connect(this.master);
    this.applyVolumes();
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this.startAmbience();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfx.gain.value = this.volumes.sfx;
    this.music.gain.value = this.volumes.music * 0.5;
    this.amb.gain.value = this.volumes.sfx * 0.8;
  }

  setListener(p: THREE.Vector3, yaw: number) { this.listener.x = p.x; this.listener.y = p.y; this.listener.z = p.z; this.listener.yaw = yaw; }

  private noiseSrc(brown = false, loop = true): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = brown ? this.brownBuf : this.noiseBuf;
    s.loop = loop;
    s.loopStart = Math.random();
    return s;
  }

  private startAmbience() {
    const ctx = this.ctx!;
    // jungle: rustling leaves + insects
    {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(this.amb);
      const n = this.noiseSrc(); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.5;
      const lg = ctx.createGain(); lg.gain.value = 0.05;
      n.connect(f).connect(lg).connect(g); n.start();
      // cicada: high band noise with tremolo
      const n2 = this.noiseSrc(); const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 6200; f2.Q.value = 6;
      const trem = ctx.createGain(); trem.gain.value = 0.0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 23; const lfoG = ctx.createGain(); lfoG.gain.value = 0.05;
      lfo.connect(lfoG).connect(trem.gain); lfo.start();
      n2.connect(f2).connect(trem).connect(g); n2.start();
      this.jungle = { gain: g, birds: 0 };
    }
    // wind
    {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(this.amb);
      const n = this.noiseSrc(true); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      n.connect(f).connect(g); n.start();
      this.wind = { gain: g, filter: f };
    }
    // underground: low cave tone
    {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(this.amb);
      const n = this.noiseSrc(true); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 120;
      n.connect(f).connect(g); n.start();
      this.cave = { gain: g };
    }
    // torch crackle hiss
    {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(this.sfx);
      const n = this.noiseSrc(); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
      const lg = ctx.createGain(); lg.gain.value = 0.015;
      n.connect(f).connect(lg).connect(g); n.start();
      this.crackle = { gain: g };
    }
    // music drone pad
    {
      const g = ctx.createGain(); g.gain.value = 0.0; g.connect(this.music);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.connect(g);
      const oscs: OscillatorNode[] = [];
      for (const [fr, type, det] of [[55, 'sawtooth', 0], [82.4, 'triangle', 4], [110, 'sawtooth', -6], [130.8, 'sine', 0]] as const) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = fr; o.detune.value = det;
        const og = ctx.createGain(); og.gain.value = type === 'sine' ? 0.12 : 0.05;
        o.connect(og).connect(f); o.start(); oscs.push(o);
      }
      this.drone = { gain: g, oscs, filter: f };
    }
  }

  /** Per-frame ambience mix. env: 0 outside, 1 ruins, 2 dungeon. */
  update(dt: number, opts: { zone: 'A' | 'B' | 'C'; torchLit: boolean; torchFuel: number; wind: number; dusk: number; remaining: number; guardianDist: number; inMenu: boolean }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sm = (p: AudioParam, v: number, tc = 0.5) => p.setTargetAtTime(v, t, tc);
    const out = opts.zone === 'A' ? 1 : opts.zone === 'B' ? 0.45 : 0;
    const day = Math.max(0, 1 - opts.dusk);
    sm(this.jungle!.gain.gain, opts.inMenu ? 0.4 : out * (0.3 + 0.7 * day));
    sm(this.wind!.gain.gain, (opts.inMenu ? 0.1 : out * 0.15 + opts.wind * 0.6) + (opts.zone === 'B' ? 0.05 : 0));
    sm(this.wind!.filter.frequency, 300 + opts.wind * 900);
    sm(this.cave!.gain.gain, opts.zone === 'C' ? 0.35 : opts.zone === 'B' ? 0.1 : 0);
    sm(this.crackle!.gain.gain, opts.torchLit && !opts.inMenu ? (opts.zone === 'C' ? 1 : 0.5) : 0, 0.1);
    // drone music: calmer by day; darker, louder and pulsing in the critical minute / at night
    const musicLvl = opts.inMenu ? 0.5 : opts.zone === 'C' ? 0.45 : 0.25;
    sm(this.drone!.gain.gain, this.critical || this.night ? 0.8 : musicLvl, 1.5);
    sm(this.drone!.filter.frequency, this.critical || this.night ? 1400 : 500, 1);
    if (this.drone) {
      const shift = this.critical || this.night ? 0.943 : 1; // drop a semitone
      this.drone.oscs.forEach((o, i) => sm(o.frequency, [55, 82.4, 110, 130.8][i] * shift * (this.night && i === 3 ? 0.94 : 1), 2));
    }
    // birds by day outside
    if (!opts.inMenu && out > 0.4 && day > 0.2 && t > this.nextBird) { this.nextBird = t + 1.5 + Math.random() * 4; this.bird(); }
    // cave drips
    if (!opts.inMenu && opts.zone === 'C' && t > this.nextDrip) { this.nextDrip = t + 1 + Math.random() * 3.5; this.drip(); }
    // torch crackle pops
    if (!opts.inMenu && opts.torchLit && t > this.nextCrackle) { this.nextCrackle = t + 0.05 + Math.random() * 0.25; this.pop(opts.zone === 'C' ? 0.07 : 0.035); }
    // percussion pulse when critical/night
    if ((this.critical || this.night) && !opts.inMenu && t > this.nextBeat) {
      this.nextBeat = t + (this.night ? 0.45 : 0.6);
      this.musicStep++;
      this.drum(this.musicStep % 4 === 0 ? 1 : 0.5);
    }
    // heartbeat when guardians are near
    if (!opts.inMenu && opts.guardianDist < 18 && t > this.heartNext) {
      const k = 1 - opts.guardianDist / 18;
      this.heartNext = t + 1.0 - k * 0.55;
      this.heartbeat(0.4 + k * 0.6);
    }
  }

  private env(g: GainNode, t0: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  private spatial(pos?: THREE.Vector3 | null, vol = 1): AudioNode | null {
    if (!this.ctx) return null;
    const g = this.ctx.createGain();
    let v = vol;
    const pan = this.ctx.createStereoPanner();
    if (pos) {
      const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
      const d = Math.hypot(dx, dy, dz);
      v *= 1 / (1 + (d / 6) * (d / 6) * 0.35);
      if (d < 0.01) v *= 1;
      // right vector of the listener
      const rx = Math.cos(this.listener.yaw), rz = -Math.sin(this.listener.yaw);
      pan.pan.value = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.8 : 0;
    }
    if (v < 0.003) return null;
    g.gain.value = v;
    g.connect(pan).connect(this.sfx);
    return g;
  }

  private bird() {
    const ctx = this.ctx!, t = ctx.currentTime;
    const out = this.spatial(null, 0.05 + Math.random() * 0.05);
    if (!out) return;
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 1800 + Math.random() * 2000;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const g = ctx.createGain();
      const t0 = t + i * (0.09 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base, t0);
      o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.8), t0 + 0.08);
      this.env(g, t0, 0.01, 1, 0.09);
      o.connect(g).connect(pan).connect(out);
      o.start(t0); o.stop(t0 + 0.15);
    }
  }

  private drip() {
    const ctx = this.ctx!, t = ctx.currentTime;
    const out = this.spatial(null, 0.08);
    if (!out) return;
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain();
    const f = 900 + Math.random() * 900;
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.8, t + 0.05);
    this.env(g, t, 0.003, 1, 0.12);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.2);
  }

  private pop(vol: number) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const s = this.noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500 + Math.random() * 3000; f.Q.value = 2;
    const g = ctx.createGain(); this.env(g, t, 0.001, vol * (0.5 + Math.random()), 0.03);
    s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random(), 0.06);
  }

  private drum(vol: number) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g = ctx.createGain(); this.env(g, t, 0.005, 0.5 * vol, 0.35);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.4);
  }

  heartbeat(vol: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [dt, v] of [[0, 1], [0.16, 0.7]] as const) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(60, t + dt); o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.12);
      const g = ctx.createGain(); this.env(g, t + dt, 0.01, 0.6 * vol * v, 0.16);
      o.connect(g).connect(this.sfx); o.start(t + dt); o.stop(t + dt + 0.25);
    }
  }

  /** The sundial clock tick. */
  tick(vol: number, urgent: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this.noiseSrc(false, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = urgent ? 2600 : 1800; f.Q.value = 8;
    const g = ctx.createGain(); this.env(g, t, 0.001, vol, 0.05);
    s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random(), 0.08);
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = urgent ? 1200 : 800;
    const g2 = ctx.createGain(); this.env(g2, t, 0.001, vol * 0.08, 0.03);
    o.connect(g2).connect(this.sfx); o.start(t); o.stop(t + 0.05);
  }

  /** One-shot sound by name. */
  play(name: string, pos?: THREE.Vector3 | null, vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this.spatial(pos ?? null, vol);
    if (!out) return;
    const noise = (dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack = 0.005, brown = false, fEnd?: number) => {
      const s = this.noiseSrc(brown, false);
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
      if (fEnd) f.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
      const g = ctx.createGain(); this.env(g, t, attack, peak, dur);
      s.connect(f).connect(g).connect(out); s.start(t, Math.random(), dur + attack + 0.1);
    };
    const tone = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number, attack = 0.005, delay = 0) => {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t + delay); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + delay + dur);
      const g = ctx.createGain(); this.env(g, t + delay, attack, peak, dur);
      o.connect(g).connect(out); o.start(t + delay); o.stop(t + delay + attack + dur + 0.05);
    };
    switch (name) {
      case 'step': noise(0.08, 'lowpass', 700, 1, 0.25); break;
      case 'stepWater': noise(0.18, 'bandpass', 900, 0.8, 0.3, 0.01); break;
      case 'jump': noise(0.06, 'lowpass', 500, 1, 0.15); break;
      case 'land': noise(0.15, 'lowpass', 300, 1, 0.5, 0.003, true); break;
      case 'creak': {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(140 + Math.random() * 60, t);
        o.frequency.linearRampToValueAtTime(90 + Math.random() * 60, t + 0.35);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 28; const lg = ctx.createGain(); lg.gain.value = 30; lfo.connect(lg).connect(o.frequency);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 3;
        const g = ctx.createGain(); this.env(g, t, 0.03, 0.25, 0.35);
        o.connect(f).connect(g).connect(out); o.start(t); lfo.start(t); o.stop(t + 0.45); lfo.stop(t + 0.45);
        break;
      }
      case 'snap': noise(0.12, 'highpass', 1200, 1, 0.9, 0.001); tone('square', 300, 60, 0.08, 0.15); break;
      case 'crumble': noise(0.6, 'lowpass', 900, 0.7, 0.45, 0.02, true, 200); for (let i = 0; i < 4; i++) noise(0.05, 'bandpass', 800 + i * 400, 3, 0.2, 0.001); break;
      case 'grind': noise(1.2, 'lowpass', 250, 2, 0.6, 0.15, true, 140); tone('sawtooth', 48, 40, 1.2, 0.08, 0.2); break;
      case 'thud': noise(0.25, 'lowpass', 180, 1, 0.8, 0.002, true); tone('sine', 70, 35, 0.25, 0.4); break;
      case 'clunk': noise(0.12, 'bandpass', 500, 2, 0.6, 0.001); tone('square', 180, 90, 0.1, 0.12); break;
      case 'click': tone('square', 1400, 900, 0.03, 0.15, 0.001); noise(0.04, 'bandpass', 2200, 4, 0.3, 0.001); break;
      case 'tick': noise(0.03, 'highpass', 3000, 1, 0.3, 0.001); break;
      case 'dart': noise(0.25, 'bandpass', 3000, 2, 0.45, 0.005, false, 900); break;
      case 'swoosh': noise(0.35, 'bandpass', 600, 1.5, 0.35, 0.08, false, 2200); break;
      case 'hit': noise(0.12, 'lowpass', 1200, 1, 0.8, 0.001); tone('triangle', 200, 80, 0.12, 0.3); break;
      case 'hurt': tone('sawtooth', 220, 110, 0.25, 0.25, 0.01); noise(0.2, 'bandpass', 900, 1, 0.3); break;
      case 'splash': noise(0.5, 'bandpass', 1400, 0.6, 0.6, 0.01, false, 400); break;
      case 'pickup': tone('sine', 660, 990, 0.12, 0.25); tone('sine', 990, 1320, 0.18, 0.2, 0.005, 0.08); break;
      case 'coin': tone('triangle', 1320, 1760, 0.2, 0.25); tone('triangle', 1760, 2640, 0.3, 0.2, 0.005, 0.07); break;
      case 'deny': tone('square', 160, 120, 0.15, 0.15); break;
      case 'torchOut': noise(0.6, 'lowpass', 2500, 0.7, 0.5, 0.02, false, 200); break;
      case 'relight': noise(0.08, 'highpass', 3000, 1, 0.6, 0.001); noise(0.9, 'bandpass', 900, 0.6, 0.35, 0.2, false, 2000); break;
      case 'gust': noise(2.2, 'bandpass', 400, 0.6, 0.9, 0.6, true, 1200); break;
      case 'rumble': noise(1.6, 'lowpass', 110, 1, 1.0, 0.25, true, 50); tone('sine', 40, 28, 1.6, 0.4, 0.3); break;
      case 'boulder': noise(2.5, 'lowpass', 160, 1, 1.0, 0.1, true, 90); break;
      case 'kick': noise(0.2, 'lowpass', 400, 1, 0.9, 0.002, true); tone('sine', 90, 40, 0.2, 0.4); break;
      case 'collapse': noise(3.5, 'lowpass', 400, 0.7, 1.0, 0.05, true, 60); tone('sine', 45, 25, 3, 0.6, 0.1); break;
      case 'door': noise(4, 'lowpass', 200, 2, 0.8, 0.3, true, 120); tone('sawtooth', 38, 32, 4, 0.1, 0.4); break;
      case 'growl': {
        // stone sentinel: low detuned saws with a rough grind
        for (const d of [0, 7, -9]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(52, t); o.frequency.linearRampToValueAtTime(40, t + 1.4); o.detune.value = d * 10; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; const g = ctx.createGain(); this.env(g, t, 0.25, 0.25, 1.2); o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 1.6); }
        noise(1.4, 'lowpass', 300, 3, 0.4, 0.2, true);
        break;
      }
      case 'chitter': {
        // crawler: fast clicks
        for (let i = 0; i < 9; i++) {
          const d = i * 0.045 + Math.random() * 0.02;
          const s = this.noiseSrc(false, false); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3000 + Math.random() * 2500; f.Q.value = 10;
          const g = ctx.createGain(); this.env(g, t + d, 0.001, 0.6, 0.025);
          s.connect(f).connect(g).connect(out); s.start(t + d, Math.random(), 0.05);
        }
        tone('sawtooth', 900, 1400, 0.3, 0.05, 0.02);
        break;
      }
      case 'whisper': {
        // shade: breathy formant sweep
        const s = this.noiseSrc(false, false);
        const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 12;
        f1.frequency.setValueAtTime(500, t); f1.frequency.linearRampToValueAtTime(1500, t + 0.8); f1.frequency.linearRampToValueAtTime(700, t + 1.6);
        const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 10;
        f2.frequency.setValueAtTime(2400, t); f2.frequency.linearRampToValueAtTime(1100, t + 1.6);
        const g = ctx.createGain(); this.env(g, t, 0.4, 1.4, 1.2);
        s.connect(f1).connect(g); s.connect(f2).connect(g); g.connect(out); s.start(t, Math.random(), 2);
        break;
      }
      case 'scream': tone('sawtooth', 600, 200, 0.9, 0.3, 0.02); noise(0.9, 'bandpass', 1200, 2, 0.4); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.4, 0.25, 0.01, i * 0.12)); break;
      default: noise(0.1, 'lowpass', 800, 1, 0.3);
    }
  }
}
