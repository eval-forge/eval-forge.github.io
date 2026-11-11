/**
 * Procedural WebAudio: every sound is synthesised from oscillators and noise.
 * Buses: master → (music, sfx, ambience) with a compressor at the end.
 */
import * as THREE from 'three';

type V3 = { x: number; y: number; z: number };

export type Surface = 'stone' | 'wood' | 'grass' | 'water' | 'metal';
export type MusicMood = 'calm' | 'tense' | 'dusk' | 'night' | 'off';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private crackleBuf!: AudioBuffer;
  private volumes = { master: 0.8, music: 0.6, sfx: 0.9 };

  // continuous layers
  private torchGain: GainNode | null = null;
  private jungleGain: GainNode | null = null;
  private insectGain: GainNode | null = null;
  private dungeonGain: GainNode | null = null;
  private duskGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private riverGain: GainNode | null = null;
  private riverPanner: PannerNode | null = null;

  // schedulers
  private birdT = 0;
  private dripT = 0;
  private groanT = 5;
  private heartT = 0;
  private heartRate = 0; // beats per second, 0 = off
  private heartVol = 0;
  private mood: MusicMood = 'off';
  private musicNext = 0;
  private chordIdx = 0;
  private drumNext = 0;
  private outdoor = 1; // 0..1 how much jungle ambience
  private day = 1; // 0..1 daylight

  get ready() {
    return !!this.ctx;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.music = ctx.createGain();
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.amb.connect(this.master);
    this.applyVolumes();
    this.white = this.noiseBuffer(2, 'white');
    this.brown = this.noiseBuffer(4, 'brown');
    this.crackleBuf = this.makeCrackle(3);
    this.startLayers();
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.volumes = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.music.gain.setTargetAtTime(this.volumes.music * 0.5, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(this.volumes.sfx * 0.8, t, 0.05);
  }

  private noiseBuffer(seconds: number, kind: 'white' | 'brown'): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  private makeCrackle(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.04;
    // sparse pops
    for (let k = 0; k < seconds * 18; k++) {
      const at = Math.floor(Math.random() * (n - 400));
      const amp = 0.3 + Math.random() * 0.7;
      const len = 40 + Math.floor(Math.random() * 300);
      for (let j = 0; j < len; j++) d[at + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / (len * 0.25));
    }
    return buf;
  }

  private src(buf: AudioBuffer, loop = false): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    if (loop) s.loopStart = 0;
    return s;
  }

  private panner(p: V3, ref = 4, max = 60): PannerNode {
    const pn = this.ctx!.createPanner();
    pn.panningModel = 'equalpower';
    pn.distanceModel = 'inverse';
    pn.refDistance = ref;
    pn.maxDistance = max;
    pn.rolloffFactor = 1.2;
    pn.positionX.value = p.x;
    pn.positionY.value = p.y;
    pn.positionZ.value = p.z;
    return pn;
  }

  /** Route to sfx bus, optionally positional. */
  private out(node: AudioNode, at?: V3, ref = 4, bus?: GainNode) {
    const target = bus ?? this.sfx;
    if (at) {
      const p = this.panner(at, ref);
      node.connect(p);
      p.connect(target);
    } else node.connect(target);
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private burst(opts: { at?: V3; dur: number; filter: BiquadFilterType; freq: number; q?: number; gain: number; attack?: number; freqEnd?: number; buf?: AudioBuffer; delay?: number; ref?: number }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (opts.delay ?? 0);
    const s = this.src(opts.buf ?? this.white);
    const f = this.ctx.createBiquadFilter();
    f.type = opts.filter;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.dur);
    f.Q.value = opts.q ?? 1;
    const g = this.ctx.createGain();
    this.env(g, t, opts.attack ?? 0.003, opts.gain, opts.dur);
    s.connect(f);
    f.connect(g);
    this.out(g, opts.at, opts.ref);
    s.start(t, Math.random() * 1.5);
    s.stop(t + opts.dur + 0.1);
  }

  private tone(opts: { at?: V3; type: OscillatorType; freq: number; freqEnd?: number; dur: number; gain: number; attack?: number; delay?: number; bus?: GainNode; ref?: number }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (opts.delay ?? 0);
    const o = this.ctx.createOscillator();
    o.type = opts.type;
    o.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) o.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.dur);
    const g = this.ctx.createGain();
    this.env(g, t, opts.attack ?? 0.005, opts.gain, opts.dur);
    o.connect(g);
    this.out(g, opts.at, opts.ref, opts.bus);
    o.start(t);
    o.stop(t + opts.dur + (opts.attack ?? 0.005) + 0.05);
  }

  // ------------------------------------------------------------ listener

  updateListener(cam: THREE.Camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = cam.getWorldPosition(new THREE.Vector3());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02);
      l.forwardY.setTargetAtTime(f.y, t, 0.02);
      l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.setTargetAtTime(u.x, t, 0.02);
      l.upY.setTargetAtTime(u.y, t, 0.02);
      l.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      (l as any).setPosition(p.x, p.y, p.z);
      (l as any).setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  // ------------------------------------------------------------ one-shots

  tick(volume: number, urgent: boolean, alt: boolean) {
    const f = urgent ? (alt ? 2600 : 2100) : alt ? 2000 : 1700;
    this.burst({ dur: 0.04, filter: 'bandpass', freq: f, q: 9, gain: 0.5 * volume });
    this.tone({ type: 'sine', freq: f * 0.5, freqEnd: f * 0.45, dur: 0.05, gain: 0.18 * volume });
  }

  footstep(surface: Surface, loud: number, at?: V3) {
    const g = 0.12 + loud * 0.5;
    switch (surface) {
      case 'grass':
        this.burst({ at, dur: 0.12, filter: 'highpass', freq: 1800, gain: g * 0.5 });
        this.burst({ at, dur: 0.08, filter: 'lowpass', freq: 400, gain: g * 0.4 });
        break;
      case 'wood':
        this.tone({ at, type: 'triangle', freq: 180 + Math.random() * 40, freqEnd: 110, dur: 0.09, gain: g * 0.7 });
        this.burst({ at, dur: 0.05, filter: 'bandpass', freq: 1200, q: 3, gain: g * 0.4 });
        break;
      case 'water':
        this.burst({ at, dur: 0.25, filter: 'bandpass', freq: 900, freqEnd: 2600, q: 1.5, gain: g * 0.9 });
        break;
      case 'metal':
        this.tone({ at, type: 'square', freq: 820, freqEnd: 600, dur: 0.06, gain: g * 0.2 });
        break;
      default:
        this.burst({ at, dur: 0.07, filter: 'bandpass', freq: 650 + Math.random() * 200, q: 1.2, gain: g * 0.8 });
        this.burst({ at, dur: 0.03, filter: 'highpass', freq: 3000, gain: g * 0.2 });
    }
  }

  land(intensity: number, surface: Surface) {
    this.tone({ type: 'sine', freq: 90, freqEnd: 40, dur: 0.18, gain: 0.3 + intensity * 0.5 });
    this.footstep(surface, Math.min(1, intensity + 0.3));
  }

  creak(at?: V3, intensity = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 90 + Math.random() * 70;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * (1.3 + Math.random() * 0.4), t + 0.25);
    o.frequency.linearRampToValueAtTime(base * 0.9, t + 0.5);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 22 + Math.random() * 14;
    const lg = this.ctx.createGain();
    lg.gain.value = base * 0.15;
    lfo.connect(lg);
    lg.connect(o.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 5;
    const g = this.ctx.createGain();
    this.env(g, t, 0.05, 0.22 * intensity, 0.5);
    o.connect(f);
    f.connect(g);
    this.out(g, at);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.7);
    lfo.stop(t + 0.7);
  }

  snap(at?: V3) {
    this.burst({ at, dur: 0.09, filter: 'highpass', freq: 1400, gain: 0.9, ref: 6 });
    this.burst({ at, dur: 0.05, filter: 'bandpass', freq: 3200, q: 4, gain: 0.5, delay: 0.03, ref: 6 });
    this.tone({ at, type: 'triangle', freq: 140, freqEnd: 60, dur: 0.2, gain: 0.5, ref: 6 });
  }

  crunch(at?: V3, big = 1) {
    this.burst({ at, dur: 0.35 * big, filter: 'lowpass', freq: 900, gain: 0.8 * big, ref: 6 });
    this.tone({ at, type: 'sine', freq: 70, freqEnd: 35, dur: 0.4 * big, gain: 0.7 * big, ref: 6 });
    for (let i = 0; i < 6; i++) this.burst({ at, dur: 0.04, filter: 'bandpass', freq: 1200 + Math.random() * 2400, q: 6, gain: 0.25 * big, delay: 0.1 + Math.random() * 0.5, ref: 6 });
  }

  thud(at?: V3, gain = 0.6) {
    this.tone({ at, type: 'sine', freq: 85, freqEnd: 38, dur: 0.25, gain });
    this.burst({ at, dur: 0.08, filter: 'lowpass', freq: 600, gain: gain * 0.6 });
  }

  clink(at?: V3, gain = 0.4) {
    this.tone({ at, type: 'sine', freq: 1900 + Math.random() * 900, dur: 0.18, gain: gain * 0.4 });
    this.tone({ at, type: 'sine', freq: 3100 + Math.random() * 900, dur: 0.12, gain: gain * 0.25 });
  }

  shatter(at?: V3) {
    for (let i = 0; i < 10; i++) this.burst({ at, dur: 0.06 + Math.random() * 0.05, filter: 'bandpass', freq: 1500 + Math.random() * 3500, q: 5, gain: 0.35, delay: Math.random() * 0.25, ref: 5 });
    this.thud(at, 0.4);
  }

  splash(at?: V3, big = 1) {
    this.burst({ at, dur: 0.5 * big, filter: 'bandpass', freq: 700, freqEnd: 2400, q: 0.8, gain: 0.7 * big });
    this.burst({ at, dur: 0.25, filter: 'highpass', freq: 3000, gain: 0.3 * big, delay: 0.05 });
  }

  pickup() {
    this.tone({ type: 'sine', freq: 1046, dur: 0.12, gain: 0.25 });
    this.tone({ type: 'sine', freq: 1568, dur: 0.18, gain: 0.2, delay: 0.07 });
  }

  stash(n: number) {
    const notes = [523, 659, 784, 1046, 1318];
    for (let i = 0; i < Math.min(5, n + 2); i++) this.tone({ type: 'triangle', freq: notes[i], dur: 0.25, gain: 0.22, delay: i * 0.08 });
  }

  denied() {
    this.tone({ type: 'square', freq: 180, freqEnd: 140, dur: 0.15, gain: 0.12 });
  }

  click() {
    this.tone({ type: 'triangle', freq: 900, dur: 0.04, gain: 0.15 });
  }

  dartWhoosh(at?: V3) {
    this.burst({ at, dur: 0.18, filter: 'bandpass', freq: 3500, freqEnd: 900, q: 2, gain: 0.6, ref: 3 });
  }

  dartHit(at?: V3) {
    this.burst({ at, dur: 0.05, filter: 'bandpass', freq: 1800, q: 3, gain: 0.5, ref: 3 });
    this.tone({ at, type: 'triangle', freq: 400, freqEnd: 250, dur: 0.1, gain: 0.3, ref: 3 });
  }

  bladeWhoosh(at?: V3) {
    this.burst({ at, dur: 0.35, filter: 'bandpass', freq: 500, freqEnd: 1400, q: 2.5, gain: 0.5, ref: 4 });
  }

  hurt() {
    this.tone({ type: 'sawtooth', freq: 220, freqEnd: 120, dur: 0.18, gain: 0.18 });
    this.burst({ dur: 0.12, filter: 'lowpass', freq: 800, gain: 0.3 });
  }

  torchIgnite() {
    this.burst({ dur: 0.6, filter: 'bandpass', freq: 400, freqEnd: 2200, q: 1.2, gain: 0.55, attack: 0.15 });
  }

  torchOut() {
    this.burst({ dur: 0.7, filter: 'highpass', freq: 2500, freqEnd: 5000, gain: 0.35 });
  }

  strike() {
    // flint strike during relighting
    this.burst({ dur: 0.04, filter: 'highpass', freq: 4000, gain: 0.4 });
  }

  windGust(strength: number) {
    this.burst({ dur: 2.2, filter: 'bandpass', freq: 300, freqEnd: 900, q: 0.8, gain: 0.5 * strength, attack: 0.5, buf: this.brown });
    this.burst({ dur: 1.8, filter: 'highpass', freq: 1500, gain: 0.12 * strength, attack: 0.4 });
  }

  rumble(seconds: number, intensity = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.src(this.brown, true);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 140;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9 * intensity, t + seconds * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    s.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    s.start(t);
    s.stop(t + seconds + 0.1);
    this.tone({ type: 'sine', freq: 38, freqEnd: 30, dur: seconds, gain: 0.5 * intensity, attack: seconds * 0.3 });
  }

  /** A looping stone-grinding sound; returns a stop function. */
  grindLoop(at: V3, gain = 0.5): () => void {
    if (!this.ctx) return () => {};
    const t = this.ctx.currentTime;
    const s = this.src(this.brown, true);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 280;
    f.Q.value = 1.4;
    const am = this.ctx.createGain();
    am.gain.value = 0.6;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 7;
    const lg = this.ctx.createGain();
    lg.gain.value = 0.4;
    lfo.connect(lg);
    lg.connect(am.gain);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.3);
    s.connect(f);
    f.connect(am);
    am.connect(g);
    this.out(g, at, 8);
    s.start(t);
    lfo.start(t);
    return () => {
      if (!this.ctx) return;
      const e = this.ctx.currentTime;
      g.gain.cancelScheduledValues(e);
      g.gain.setValueAtTime(g.gain.value, e);
      g.gain.linearRampToValueAtTime(0.0001, e + 0.4);
      s.stop(e + 0.5);
      lfo.stop(e + 0.5);
    };
  }

  stoneGrind(at: V3, seconds: number, gain = 0.5) {
    const stop = this.grindLoop(at, gain);
    setTimeout(stop, seconds * 1000);
  }

  // guardian calls
  roar(at: V3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 1.6);
    const o2 = this.ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.setValueAtTime(73, t);
    o2.frequency.exponentialRampToValueAtTime(44, t + 1.6);
    const f1 = this.ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 420;
    f1.Q.value = 3;
    const f2 = this.ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 950;
    f2.Q.value = 4;
    const g = this.ctx.createGain();
    this.env(g, t, 0.25, 0.9, 1.5);
    o.connect(f1);
    o2.connect(f1);
    o.connect(f2);
    f1.connect(g);
    f2.connect(g);
    this.out(g, at, 10);
    o.start(t);
    o2.start(t);
    o.stop(t + 1.9);
    o2.stop(t + 1.9);
    this.burst({ at, dur: 1.4, filter: 'lowpass', freq: 500, gain: 0.5, attack: 0.2, buf: this.brown, ref: 10 });
  }

  screech(at: V3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const car = this.ctx.createOscillator();
    car.type = 'sawtooth';
    car.frequency.setValueAtTime(1300, t);
    car.frequency.exponentialRampToValueAtTime(700, t + 0.7);
    const mod = this.ctx.createOscillator();
    mod.frequency.value = 85;
    const mg = this.ctx.createGain();
    mg.gain.setValueAtTime(900, t);
    mg.gain.linearRampToValueAtTime(200, t + 0.7);
    mod.connect(mg);
    mg.connect(car.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 2;
    const g = this.ctx.createGain();
    this.env(g, t, 0.02, 0.45, 0.75);
    car.connect(f);
    f.connect(g);
    this.out(g, at, 8);
    car.start(t);
    mod.start(t);
    car.stop(t + 0.9);
    mod.stop(t + 0.9);
    for (let i = 0; i < 8; i++) this.burst({ at, dur: 0.02, filter: 'highpass', freq: 3000, gain: 0.3, delay: 0.75 + i * 0.05, ref: 6 });
  }

  skitter(at: V3) {
    for (let i = 0; i < 5; i++) this.burst({ at, dur: 0.015, filter: 'bandpass', freq: 2500 + Math.random() * 1500, q: 5, gain: 0.25, delay: i * 0.035, ref: 5 });
  }

  whisper(at: V3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.src(this.white);
    const f1 = this.ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.setValueAtTime(1100, t);
    f1.frequency.linearRampToValueAtTime(1600, t + 1.6);
    f1.Q.value = 6;
    const f2 = this.ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.setValueAtTime(2600, t);
    f2.frequency.linearRampToValueAtTime(2100, t + 1.6);
    f2.Q.value = 8;
    const trem = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lg = this.ctx.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg);
    lg.connect(trem.gain);
    const g = this.ctx.createGain();
    this.env(g, t, 0.4, 0.55, 1.4);
    const delay = this.ctx.createDelay();
    delay.delayTime.value = 0.23;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.4;
    s.connect(f1);
    s.connect(f2);
    f1.connect(trem);
    f2.connect(trem);
    trem.connect(g);
    g.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    this.out(g, at, 6);
    this.out(delay, at, 6);
    s.start(t);
    lfo.start(t);
    s.stop(t + 2);
    lfo.stop(t + 2);
  }

  heavyStep(at: V3) {
    this.tone({ at, type: 'sine', freq: 55, freqEnd: 32, dur: 0.35, gain: 0.7, ref: 6 });
    this.burst({ at, dur: 0.12, filter: 'lowpass', freq: 300, gain: 0.5, ref: 6 });
  }

  /** Set heartbeat rate (beats/sec, 0 = off) and volume. */
  setHeartbeat(rate: number, vol: number) {
    this.heartRate = rate;
    this.heartVol = vol;
  }

  private beat() {
    this.tone({ type: 'sine', freq: 60, freqEnd: 38, dur: 0.14, gain: 0.7 * this.heartVol });
    this.tone({ type: 'sine', freq: 52, freqEnd: 34, dur: 0.14, gain: 0.5 * this.heartVol, delay: 0.19 });
  }

  // ------------------------------------------------------------ continuous layers

  private startLayers() {
    const ctx = this.ctx!;
    // torch crackle
    {
      const s = this.src(this.crackleBuf, true);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      this.torchGain = ctx.createGain();
      this.torchGain.gain.value = 0;
      s.connect(hp);
      hp.connect(this.torchGain);
      const roar = this.src(this.brown, true);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 300;
      const rg = ctx.createGain();
      rg.gain.value = 0.25;
      roar.connect(lp);
      lp.connect(rg);
      rg.connect(this.torchGain);
      this.torchGain.connect(this.sfx);
      s.start();
      roar.start();
    }
    // jungle bed: leaves/wind
    {
      const s = this.src(this.brown, true);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 600;
      f.Q.value = 0.5;
      this.jungleGain = ctx.createGain();
      this.jungleGain.gain.value = 0;
      s.connect(f);
      f.connect(this.jungleGain);
      this.jungleGain.connect(this.amb);
      s.start();
    }
    // insects / cicadas
    {
      const s = this.src(this.white, true);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 5600;
      f.Q.value = 6;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 26;
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg);
      lg.connect(am.gain);
      this.insectGain = ctx.createGain();
      this.insectGain.gain.value = 0;
      s.connect(f);
      f.connect(am);
      am.connect(this.insectGain);
      this.insectGain.connect(this.amb);
      s.start();
      lfo.start();
    }
    // dungeon drone
    {
      const s = this.src(this.brown, true);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 90;
      this.dungeonGain = ctx.createGain();
      this.dungeonGain.gain.value = 0;
      s.connect(f);
      f.connect(this.dungeonGain);
      const o = ctx.createOscillator();
      o.frequency.value = 41;
      const og = ctx.createGain();
      og.gain.value = 0.15;
      o.connect(og);
      og.connect(this.dungeonGain);
      this.dungeonGain.connect(this.amb);
      s.start();
      o.start();
    }
    // dusk rumble bed
    {
      const s = this.src(this.brown, true);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 70;
      this.duskGain = ctx.createGain();
      this.duskGain.gain.value = 0;
      s.connect(f);
      f.connect(this.duskGain);
      this.duskGain.connect(this.amb);
      s.start();
    }
    // wind (cliffs)
    {
      const s = this.src(this.white, true);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 500;
      f.Q.value = 0.7;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      s.connect(f);
      f.connect(this.windGain);
      this.windGain.connect(this.amb);
      s.start();
    }
    // river (positional)
    {
      const s = this.src(this.white, true);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1400;
      this.riverGain = ctx.createGain();
      this.riverGain.gain.value = 0.0;
      this.riverPanner = this.panner({ x: 0, y: 0, z: 134 }, 6, 80);
      s.connect(f);
      f.connect(this.riverGain);
      this.riverGain.connect(this.riverPanner);
      this.riverPanner.connect(this.amb);
      s.start();
    }
  }

  /** Per-frame update of continuous layers and schedulers. */
  update(dt: number, s: { torchLevel: number; outdoor: number; dungeon: number; daylight: number; dusk: number; wind: number; riverPos?: V3 | null; inWater?: boolean }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = 0.25;
    this.torchGain!.gain.setTargetAtTime(s.torchLevel * 0.35, t, 0.1);
    this.outdoor = s.outdoor;
    this.day = s.daylight;
    this.jungleGain!.gain.setTargetAtTime(0.12 * s.outdoor * (0.4 + 0.6 * s.daylight), t, k);
    this.insectGain!.gain.setTargetAtTime(0.03 * s.outdoor * (0.6 + 0.6 * (1 - s.daylight)), t, k);
    this.dungeonGain!.gain.setTargetAtTime(0.35 * s.dungeon, t, k);
    this.duskGain!.gain.setTargetAtTime(0.6 * s.dusk, t, k);
    this.windGain!.gain.setTargetAtTime(0.08 * s.wind, t, k);
    if (s.riverPos && this.riverPanner) {
      this.riverPanner.positionX.setTargetAtTime(s.riverPos.x, t, 0.05);
      this.riverPanner.positionY.setTargetAtTime(s.riverPos.y, t, 0.05);
      this.riverPanner.positionZ.setTargetAtTime(s.riverPos.z, t, 0.05);
      this.riverGain!.gain.setTargetAtTime(0.25 * s.outdoor, t, k);
    } else this.riverGain!.gain.setTargetAtTime(0, t, k);

    // birds by day outdoors
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 0.8 + Math.random() * 3;
      if (s.outdoor > 0.3 && s.daylight > 0.3) this.bird(s.outdoor * s.daylight);
    }
    // drips and groans underground
    this.dripT -= dt;
    if (this.dripT <= 0) {
      this.dripT = 1 + Math.random() * 3;
      if (s.dungeon > 0.3) {
        const f = 1400 + Math.random() * 1600;
        this.tone({ type: 'sine', freq: f, freqEnd: f * 1.6, dur: 0.07, gain: 0.12 * s.dungeon, bus: this.amb });
      }
    }
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = 9 + Math.random() * 14;
      if (s.dungeon > 0.3 || s.dusk > 0.2) this.tone({ type: 'sawtooth', freq: 48 + Math.random() * 20, freqEnd: 36, dur: 2.5, gain: 0.08, attack: 0.8, bus: this.amb });
    }
    // heartbeat
    if (this.heartRate > 0) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 1 / this.heartRate;
        this.beat();
      }
    }
    this.updateMusic();
  }

  private bird(level: number) {
    const base = 2000 + Math.random() * 2200;
    const n = 2 + Math.floor(Math.random() * 4);
    const pan = { x: (Math.random() - 0.5) * 60, y: 8 + Math.random() * 10, z: (Math.random() - 0.5) * 60 };
    const kind = Math.random();
    for (let i = 0; i < n; i++) {
      const f = base * (kind < 0.5 ? 1 + i * 0.08 : 1 - i * 0.05);
      this.tone({ type: 'sine', freq: f, freqEnd: f * (kind < 0.3 ? 1.4 : 0.75), dur: 0.08 + Math.random() * 0.06, gain: 0.05 * level, delay: i * (0.11 + Math.random() * 0.05), bus: this.amb });
    }
    void pan;
  }

  // ------------------------------------------------------------ music

  setMood(m: MusicMood) {
    if (m === this.mood) return;
    this.mood = m;
    if (this.ctx) this.musicNext = this.ctx.currentTime + 0.1;
  }

  private updateMusic() {
    if (!this.ctx || this.mood === 'off') return;
    const t = this.ctx.currentTime;
    const lookahead = 0.3;
    // chords
    if (this.musicNext < t + lookahead) {
      const at = Math.max(t, this.musicNext);
      const prog = PROGRESSIONS[this.mood];
      const chord = prog[this.chordIdx % prog.length];
      this.chordIdx++;
      const len = this.mood === 'dusk' ? 3.2 : this.mood === 'night' ? 4 : 6;
      for (const midi of chord) this.pad(midiHz(midi), at, len, this.mood === 'calm' ? 0.05 : 0.07);
      this.musicNext = at + len;
    }
    // drums in the final minute and at night
    if (this.mood === 'dusk' || this.mood === 'night') {
      const bpm = this.mood === 'dusk' ? 104 : 88;
      const beat = 60 / bpm;
      if (this.drumNext < t) this.drumNext = t + 0.05;
      while (this.drumNext < t + lookahead) {
        const at = this.drumNext;
        const step = Math.round(at / beat) % 8;
        if (step === 0 || step === 3 || step === 6) this.drum(at, step === 0 ? 1 : 0.6);
        if (this.mood === 'dusk' && (step === 2 || step === 5 || step === 7)) this.drum(at, 0.3, true);
        this.drumNext += beat;
      }
    }
  }

  private pad(freq: number, at: number, len: number, gain: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = this.mood === 'calm' ? 900 : 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + len * 0.35);
    g.gain.linearRampToValueAtTime(gain * 0.8, at + len * 0.75);
    g.gain.linearRampToValueAtTime(0.0001, at + len + 1.2);
    for (const d of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = this.mood === 'calm' ? 'triangle' : 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = d;
      o.connect(f);
      o.start(at);
      o.stop(at + len + 1.3);
    }
    f.connect(g);
    g.connect(this.music);
  }

  private drum(at: number, v: number, high = false) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(high ? 180 : 95, at);
    o.frequency.exponentialRampToValueAtTime(high ? 90 : 42, at + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.6 * v, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    o.connect(g);
    g.connect(this.music);
    o.start(at);
    o.stop(at + 0.4);
    const s = this.src(this.white);
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = high ? 2500 : 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, at);
    ng.gain.linearRampToValueAtTime(0.25 * v, at + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    s.connect(nf);
    nf.connect(ng);
    ng.connect(this.music);
    s.start(at);
    s.stop(at + 0.1);
  }
}

function midiHz(m: number) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// D dorian-ish for calm, darker minor for tense, clusters for dusk/night
const PROGRESSIONS: Record<Exclude<MusicMood, 'off'>, number[][]> = {
  calm: [
    [50, 57, 62, 65],
    [48, 55, 60, 64],
    [46, 53, 58, 62],
    [45, 52, 57, 60],
  ],
  tense: [
    [45, 52, 57, 60],
    [46, 53, 58, 61],
    [44, 51, 56, 59],
    [45, 52, 57, 63],
  ],
  dusk: [
    [45, 51, 57, 58],
    [44, 50, 56, 57],
    [46, 52, 57, 59],
    [43, 49, 55, 56],
  ],
  night: [
    [38, 44, 50, 51],
    [37, 43, 49, 50],
  ],
};
