/**
 * All sound is synthesised here with WebAudio: no samples, no files.
 * One-shots are built from two primitives (a filtered noise burst and a
 * swept oscillator); ambience, heartbeat, torch crackle and the two music
 * layers are small schedulers driven from `update()`.
 */
import type { Vec3Like } from '../core/scenes';

export type Sfx =
  | 'tick' | 'tickUrgent' | 'step_stone' | 'step_wood' | 'step_dirt' | 'step_grass' | 'step_water' | 'step_metal'
  | 'jump' | 'land' | 'creak' | 'snap' | 'grind' | 'grindLong' | 'dart' | 'dartHit' | 'blade' | 'boulder'
  | 'relic' | 'relicBig' | 'key' | 'flint' | 'torchLit' | 'torchOut' | 'splash' | 'gust' | 'doorSlam' | 'debris'
  | 'crack' | 'sentinel' | 'crawler' | 'shade' | 'wake' | 'hurt' | 'death' | 'ui' | 'buy' | 'deny' | 'unlock'
  | 'win' | 'lose' | 'lever' | 'scarab' | 'rope' | 'mantle' | 'gong' | 'rumble' | 'drip' | 'pour' | 'thud' | 'plate' | 'bird'
  | 'kick' | 'drop' | 'throw';

export interface AmbientState {
  /** 0..1 how much open sky is overhead (1 in Zone A, less in B, 0 in C). */
  outdoor: number;
  /** 0..1 jungle life (Zone A by day). */
  jungle: number;
  /** 0..1 night. */
  night: number;
  /** 0..1 closeness to running water. */
  river: number;
  /** 0..1 wind strength. */
  wind: number;
  /** 0..1 underground. */
  dungeon: number;
  torchLit: boolean;
  /** 0..1 low rumble (last minute, collapse). */
  rumble: number;
  /** 0..1 guardian threat: drives the heartbeat. */
  threat: number;
  /** 0..1 crossfade from the calm music layer to the danger layer. */
  danger: number;
  underwater: boolean;
  /** 0..1 reverb send. */
  reverb: number;
  /** 0..1 dusk: deep rumbles roll in. */
  dusk: number;
}

interface NoiseOpts {
  dur: number;
  type?: BiquadFilterType;
  freq?: number;
  freq2?: number;
  q?: number;
  gain?: number;
  attack?: number;
  delay?: number;
}
interface ToneOpts {
  dur: number;
  type?: OscillatorType;
  f0: number;
  f1?: number;
  gain?: number;
  attack?: number;
  delay?: number;
  vibrato?: number;
  vibratoRate?: number;
}

const PENTA = [0, 3, 5, 7, 10];
const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private reverbIn!: GainNode;
  private reverbSend!: GainNode;
  private lowpass!: BiquadFilterNode;
  private white!: AudioBuffer;
  private voices = 0;
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private lyaw = 0;
  private volume = 0.8;
  private musicVolume = 0.6;
  private loops: Record<string, GainNode> = {};
  private timers = { bird: 2, cricket: 0, crackle: 0, heart: 0, drip: 3, beat: 0, duskRumble: 6 };
  private beatIndex = 0;
  private chordRoot = 50;
  private state: AmbientState | null = null;
  private pulse: GainNode | null = null;
  /** Set false to keep the context but play nothing (headless tests). */
  enabled = true;

  /** Create the context. Safe to call more than once; must be called from a user gesture to be audible. */
  unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      try {
        const AC: typeof AudioContext =
          window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.build();
      } catch {
        this.ctx = null;
        this.enabled = false;
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  private build(): void {
    const c = this.ctx!;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.lowpass = c.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 20000;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    this.lowpass.connect(comp);
    comp.connect(this.master);
    this.master.connect(c.destination);

    this.sfx = c.createGain();
    this.sfx.connect(this.lowpass);
    this.ambBus = c.createGain();
    this.ambBus.connect(this.lowpass);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);

    // White noise source material.
    const len = c.sampleRate * 2;
    this.white = c.createBuffer(1, len, c.sampleRate);
    const d = this.white.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // A generated impulse response: stone room.
    const irLen = Math.floor(c.sampleRate * 2.2);
    const ir = c.createBuffer(2, irLen, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        const t = i / irLen;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 400 ? i / 400 : 1);
      }
    }
    const conv = c.createConvolver();
    conv.buffer = ir;
    this.reverbIn = c.createGain();
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.1;
    this.sfx.connect(this.reverbIn);
    this.reverbIn.connect(this.reverbSend);
    this.reverbSend.connect(conv);
    conv.connect(this.lowpass);

    // Continuous beds, all silent until update() opens them.
    this.loops.wind = this.noiseLoop('bandpass', 420, 0.5, this.ambBus);
    this.loops.insects = this.noiseLoop('bandpass', 5200, 9, this.ambBus, 17);
    this.loops.river = this.noiseLoop('bandpass', 620, 0.45, this.ambBus);
    this.loops.drone = this.noiseLoop('lowpass', 95, 0.7, this.ambBus);
    this.loops.rumble = this.noiseLoop('lowpass', 55, 1.2, this.ambBus, 0.6);
    this.loops.hiss = this.noiseLoop('bandpass', 1500, 0.8, this.ambBus);
    this.loops.under = this.noiseLoop('lowpass', 260, 2.5, this.ambBus);

    // Danger-layer pad: two detuned saws a semitone apart through a low filter.
    const pad = c.createGain();
    pad.gain.value = 0;
    const pf = c.createBiquadFilter();
    pf.type = 'lowpass';
    pf.frequency.value = 320;
    for (const f of [midi(38), midi(39) * 1.003, midi(45)]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(pf);
      o.start();
    }
    pf.connect(pad);
    pad.connect(this.musicBus);
    this.loops.dangerPad = pad;

    // Calm-layer pad: soft fifths.
    const calm = c.createGain();
    calm.gain.value = 0;
    const cf = c.createBiquadFilter();
    cf.type = 'lowpass';
    cf.frequency.value = 700;
    for (const f of [midi(50), midi(57) * 1.002, midi(62) * 0.998]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(cf);
      o.start();
    }
    cf.connect(calm);
    calm.connect(this.musicBus);
    this.loops.calmPad = calm;
  }

  private noiseLoop(type: BiquadFilterType, freq: number, q: number, out: AudioNode, amHz = 0): GainNode {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.white;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(f);
    if (amHz > 0) {
      const am = c.createGain();
      am.gain.value = 0.5;
      const lfo = c.createOscillator();
      lfo.frequency.value = amHz;
      const depth = c.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth);
      depth.connect(am.gain);
      lfo.start();
      f.connect(am);
      am.connect(g);
    } else {
      f.connect(g);
    }
    g.connect(out);
    src.start();
    return g;
  }

  setVolumes(volume: number, music: number): void {
    this.volume = volume;
    this.musicVolume = music;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
    this.musicBus.gain.setTargetAtTime(music, this.ctx.currentTime, 0.05);
  }

  setListener(p: Vec3Like, yaw: number): void {
    this.lx = p.x;
    this.ly = p.y;
    this.lz = p.z;
    this.lyaw = yaw;
  }

  /** Per-shot output node: distance attenuation and stereo pan for positioned sounds. */
  private out(vol: number, pos?: Vec3Like, range = 30): AudioNode | null {
    const c = this.ctx;
    if (!c || !this.enabled || c.state !== 'running' || this.voices > 48) return null;
    let g = vol;
    let pan = 0;
    if (pos) {
      const dx = pos.x - this.lx;
      const dy = pos.y - this.ly;
      const dz = pos.z - this.lz;
      const d = Math.hypot(dx, dy, dz);
      if (d >= range) return null;
      const k = 1 - d / range;
      g *= k * k;
      if (d > 0.5) {
        // Right vector of a camera with yaw (YXZ order): (cos yaw, 0, -sin yaw).
        pan = Math.max(-1, Math.min(1, ((dx * Math.cos(this.lyaw) - dz * Math.sin(this.lyaw)) / d) * 0.85));
      }
    }
    if (g < 0.003) return null;
    const gain = c.createGain();
    gain.gain.value = g;
    if (pan !== 0 && typeof c.createStereoPanner === 'function') {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p);
      p.connect(this.sfx);
    } else {
      gain.connect(this.sfx);
    }
    return gain;
  }

  private noise(out: AudioNode, o: NoiseOpts): void {
    const c = this.ctx!;
    const t0 = c.currentTime + (o.delay ?? 0);
    const src = c.createBufferSource();
    src.buffer = this.white;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 1000, t0);
    if (o.freq2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freq2), t0 + o.dur);
    f.Q.value = o.q ?? 1;
    const g = c.createGain();
    const peak = o.gain ?? 0.5;
    const a = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(a + 0.01, o.dur));
    src.connect(f);
    f.connect(g);
    g.connect(out);
    this.voices++;
    src.onended = () => {
      this.voices--;
    };
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + o.dur + 0.05);
  }

  private tone(out: AudioNode, o: ToneOpts): void {
    const c = this.ctx!;
    const t0 = c.currentTime + (o.delay ?? 0);
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t0 + o.dur);
    if (o.vibrato) {
      const l = c.createOscillator();
      l.frequency.value = o.vibratoRate ?? 6;
      const lg = c.createGain();
      lg.gain.value = o.vibrato;
      l.connect(lg);
      lg.connect(osc.frequency);
      l.start(t0);
      l.stop(t0 + o.dur + 0.05);
    }
    const g = c.createGain();
    const peak = o.gain ?? 0.4;
    const a = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(a + 0.01, o.dur));
    osc.connect(g);
    g.connect(out);
    this.voices++;
    osc.onended = () => {
      this.voices--;
    };
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  /** Play a one-shot. `pos` makes it positional; `vol` and `pitch` scale it. */
  play(name: Sfx, o: { pos?: Vec3Like; vol?: number; pitch?: number; range?: number } = {}): void {
    if (!this.ctx || !this.enabled) return;
    const v = o.vol ?? 1;
    const p = o.pitch ?? 1;
    const out = this.out(v, o.pos, o.range ?? 32);
    if (!out) return;
    const r = (a: number, b: number): number => a + Math.random() * (b - a);
    switch (name) {
      case 'tick':
        this.noise(out, { dur: 0.03, type: 'bandpass', freq: 2400, q: 3, gain: 0.5 });
        this.tone(out, { dur: 0.07, type: 'triangle', f0: 620 * p, f1: 420 * p, gain: 0.28 });
        break;
      case 'tickUrgent':
        this.noise(out, { dur: 0.035, type: 'bandpass', freq: 3000, q: 3, gain: 0.7 });
        this.tone(out, { dur: 0.09, type: 'square', f0: 780 * p, f1: 500 * p, gain: 0.2 });
        this.tone(out, { dur: 0.12, type: 'sine', f0: 120, f1: 70, gain: 0.35 });
        break;
      case 'step_stone':
        this.noise(out, { dur: 0.09, type: 'lowpass', freq: r(700, 1000) * p, q: 1, gain: 0.5 });
        this.tone(out, { dur: 0.06, f0: 120, f1: 70, gain: 0.3 });
        break;
      case 'step_wood':
        this.tone(out, { dur: 0.09, type: 'triangle', f0: r(170, 230) * p, f1: 110, gain: 0.55 });
        this.noise(out, { dur: 0.05, type: 'bandpass', freq: 900, q: 1.5, gain: 0.3 });
        break;
      case 'step_dirt':
        this.noise(out, { dur: 0.11, type: 'lowpass', freq: r(380, 520) * p, q: 0.7, gain: 0.55 });
        break;
      case 'step_grass':
        this.noise(out, { dur: 0.13, type: 'bandpass', freq: r(2400, 3600) * p, q: 0.8, gain: 0.3, attack: 0.02 });
        this.noise(out, { dur: 0.08, type: 'lowpass', freq: 400, gain: 0.3 });
        break;
      case 'step_water':
        this.noise(out, { dur: 0.22, type: 'bandpass', freq: r(900, 1500), freq2: 500, q: 1.2, gain: 0.5, attack: 0.02 });
        break;
      case 'step_metal':
        this.tone(out, { dur: 0.16, type: 'square', f0: r(900, 1200), f1: 800, gain: 0.12 });
        this.noise(out, { dur: 0.05, type: 'highpass', freq: 2500, gain: 0.3 });
        break;
      case 'jump':
        this.noise(out, { dur: 0.12, type: 'bandpass', freq: 500, freq2: 1100, q: 0.9, gain: 0.25, attack: 0.03 });
        break;
      case 'land':
        this.tone(out, { dur: 0.16, f0: 110, f1: 45, gain: 0.7 });
        this.noise(out, { dur: 0.14, type: 'lowpass', freq: 700, gain: 0.55 });
        break;
      case 'creak':
        this.tone(out, { dur: r(0.35, 0.6), type: 'sawtooth', f0: r(160, 230) * p, f1: r(240, 330) * p, gain: 0.12, attack: 0.08, vibrato: 18, vibratoRate: 23 });
        this.noise(out, { dur: 0.4, type: 'bandpass', freq: 1300, q: 6, gain: 0.08, attack: 0.1 });
        break;
      case 'snap':
        this.noise(out, { dur: 0.07, type: 'highpass', freq: 1800, gain: 0.9, attack: 0.001 });
        this.tone(out, { dur: 0.12, type: 'square', f0: 420 * p, f1: 90, gain: 0.4, attack: 0.001 });
        this.noise(out, { dur: 0.3, type: 'bandpass', freq: 700, q: 1, gain: 0.3, delay: 0.03 });
        break;
      case 'grind':
        this.noise(out, { dur: 0.5, type: 'lowpass', freq: 260 * p, q: 3, gain: 0.7, attack: 0.08 });
        this.noise(out, { dur: 0.45, type: 'bandpass', freq: 1900, q: 5, gain: 0.07, attack: 0.1 });
        break;
      case 'grindLong':
        this.noise(out, { dur: 2.6, type: 'lowpass', freq: 220 * p, q: 4, gain: 0.75, attack: 0.3 });
        this.noise(out, { dur: 2.4, type: 'bandpass', freq: 1500, q: 6, gain: 0.07, attack: 0.3 });
        this.tone(out, { dur: 2.5, type: 'sawtooth', f0: 42, f1: 36, gain: 0.25, attack: 0.3 });
        break;
      case 'dart':
        this.noise(out, { dur: 0.16, type: 'bandpass', freq: 3200, freq2: 900, q: 2.5, gain: 0.5, attack: 0.005 });
        break;
      case 'dartHit':
        this.tone(out, { dur: 0.07, type: 'triangle', f0: 900, f1: 300, gain: 0.3, attack: 0.001 });
        this.noise(out, { dur: 0.04, type: 'highpass', freq: 3000, gain: 0.3 });
        break;
      case 'blade':
        this.noise(out, { dur: 0.42, type: 'bandpass', freq: 500, freq2: 2600, q: 2, gain: 0.5, attack: 0.18 });
        break;
      case 'boulder':
        this.noise(out, { dur: 1.1, type: 'lowpass', freq: 130, q: 2, gain: 1, attack: 0.15 });
        this.tone(out, { dur: 1.0, type: 'sawtooth', f0: 38, f1: 30, gain: 0.4, attack: 0.1 });
        break;
      case 'relic':
        for (const [i, n] of [76, 81, 88].entries()) this.tone(out, { dur: 0.7, f0: midi(n) * p, gain: 0.16, delay: i * 0.07, attack: 0.004 });
        this.tone(out, { dur: 0.5, type: 'triangle', f0: midi(64) * p, gain: 0.1 });
        break;
      case 'relicBig':
        for (const [i, n] of [64, 71, 76, 83, 88].entries()) this.tone(out, { dur: 1.4, f0: midi(n), gain: 0.15, delay: i * 0.09, attack: 0.004 });
        this.tone(out, { dur: 1.6, type: 'triangle', f0: midi(40), gain: 0.25, attack: 0.02 });
        break;
      case 'key':
        this.tone(out, { dur: 0.25, type: 'square', f0: 1568, gain: 0.07 });
        this.tone(out, { dur: 0.3, type: 'square', f0: 2093, gain: 0.07, delay: 0.09 });
        this.noise(out, { dur: 0.04, type: 'highpass', freq: 4000, gain: 0.25 });
        break;
      case 'flint':
        this.noise(out, { dur: 0.05, type: 'highpass', freq: 3500, gain: 0.7, attack: 0.001 });
        this.tone(out, { dur: 0.04, type: 'square', f0: 2600, f1: 1400, gain: 0.12 });
        break;
      case 'torchLit':
        this.noise(out, { dur: 0.6, type: 'bandpass', freq: 500, freq2: 1600, q: 0.7, gain: 0.55, attack: 0.05 });
        break;
      case 'torchOut':
        this.noise(out, { dur: 0.5, type: 'bandpass', freq: 2400, freq2: 300, q: 0.8, gain: 0.45, attack: 0.01 });
        break;
      case 'splash':
        this.noise(out, { dur: 0.5, type: 'bandpass', freq: 1300, freq2: 400, q: 0.7, gain: 0.8, attack: 0.01 });
        this.noise(out, { dur: 0.7, type: 'highpass', freq: 3000, gain: 0.2, attack: 0.05, delay: 0.05 });
        break;
      case 'gust':
        this.noise(out, { dur: 2.4, type: 'bandpass', freq: 300, freq2: 900, q: 0.8, gain: 0.9, attack: 0.9 });
        this.noise(out, { dur: 2.2, type: 'bandpass', freq: 1400, freq2: 2600, q: 3, gain: 0.12, attack: 1.0 });
        break;
      case 'doorSlam':
        this.tone(out, { dur: 1.2, f0: 70, f1: 28, gain: 1, attack: 0.002 });
        this.noise(out, { dur: 0.9, type: 'lowpass', freq: 500, gain: 0.9, attack: 0.002 });
        this.noise(out, { dur: 1.6, type: 'lowpass', freq: 120, gain: 0.5, delay: 0.1 });
        break;
      case 'debris':
        this.noise(out, { dur: 0.5, type: 'lowpass', freq: 600, q: 1, gain: 0.9, attack: 0.003 });
        this.tone(out, { dur: 0.35, f0: 85, f1: 38, gain: 0.7 });
        this.noise(out, { dur: 0.6, type: 'bandpass', freq: 1800, q: 1, gain: 0.15, delay: 0.08 });
        break;
      case 'crack':
        this.noise(out, { dur: 0.12, type: 'highpass', freq: 1200, gain: 0.7, attack: 0.001 });
        this.noise(out, { dur: 0.5, type: 'bandpass', freq: 450, q: 2, gain: 0.3, delay: 0.05 });
        break;
      case 'sentinel':
        this.tone(out, { dur: 1.5, type: 'sawtooth', f0: 62 * p, f1: 44 * p, gain: 0.5, attack: 0.25, vibrato: 4, vibratoRate: 9 });
        this.noise(out, { dur: 1.4, type: 'lowpass', freq: 240, q: 5, gain: 0.5, attack: 0.3 });
        break;
      case 'crawler':
        for (let i = 0; i < 9; i++) {
          this.noise(out, { dur: 0.025, type: 'bandpass', freq: r(2600, 4200) * p, q: 6, gain: 0.55, delay: i * r(0.035, 0.06), attack: 0.001 });
        }
        this.tone(out, { dur: 0.5, type: 'square', f0: 190 * p, f1: 320 * p, gain: 0.05, vibrato: 60, vibratoRate: 41 });
        break;
      case 'shade':
        this.noise(out, { dur: 1.8, type: 'bandpass', freq: 700 * p, freq2: 1500 * p, q: 9, gain: 0.5, attack: 0.6 });
        this.tone(out, { dur: 1.7, f0: 330 * p, f1: 262 * p, gain: 0.07, attack: 0.5, vibrato: 9, vibratoRate: 5 });
        break;
      case 'wake':
        this.noise(out, { dur: 1.6, type: 'lowpass', freq: 300, q: 4, gain: 0.8, attack: 0.4 });
        this.tone(out, { dur: 1.8, type: 'sawtooth', f0: 40, f1: 85, gain: 0.4, attack: 0.5 });
        break;
      case 'hurt':
        this.tone(out, { dur: 0.22, type: 'sawtooth', f0: 210, f1: 120, gain: 0.3 });
        this.noise(out, { dur: 0.12, type: 'lowpass', freq: 900, gain: 0.6 });
        break;
      case 'death':
        this.tone(out, { dur: 1.6, type: 'sawtooth', f0: 160, f1: 40, gain: 0.4 });
        this.noise(out, { dur: 1.2, type: 'lowpass', freq: 400, freq2: 60, gain: 0.7 });
        break;
      case 'ui':
        this.tone(out, { dur: 0.06, type: 'triangle', f0: 660 * p, gain: 0.18 });
        break;
      case 'buy':
        this.tone(out, { dur: 0.3, f0: midi(79), gain: 0.2 });
        this.tone(out, { dur: 0.45, f0: midi(84), gain: 0.2, delay: 0.08 });
        this.noise(out, { dur: 0.05, type: 'highpass', freq: 5000, gain: 0.2 });
        break;
      case 'deny':
        this.tone(out, { dur: 0.18, type: 'square', f0: 140, f1: 110, gain: 0.16 });
        break;
      case 'unlock':
        this.tone(out, { dur: 0.1, type: 'square', f0: 300, f1: 180, gain: 0.25 });
        this.noise(out, { dur: 0.08, type: 'bandpass', freq: 2200, q: 3, gain: 0.5, delay: 0.08 });
        this.tone(out, { dur: 0.6, f0: 90, f1: 60, gain: 0.5, delay: 0.12 });
        break;
      case 'win':
        for (const [i, n] of [62, 66, 69, 74, 78].entries()) this.tone(out, { dur: 1.2, type: 'triangle', f0: midi(n), gain: 0.2, delay: i * 0.12 });
        break;
      case 'lose':
        for (const [i, n] of [57, 56, 52, 45].entries()) this.tone(out, { dur: 1.4, type: 'sawtooth', f0: midi(n), gain: 0.12, delay: i * 0.22 });
        break;
      case 'lever':
        this.tone(out, { dur: 0.12, type: 'square', f0: 240, f1: 130, gain: 0.3 });
        this.noise(out, { dur: 0.1, type: 'bandpass', freq: 1700, q: 3, gain: 0.5, delay: 0.1 });
        break;
      case 'scarab':
        for (let i = 0; i < 6; i++) this.noise(out, { dur: 0.02, type: 'highpass', freq: r(4500, 7000), gain: 0.3, delay: i * r(0.02, 0.05), attack: 0.001 });
        break;
      case 'rope':
        this.tone(out, { dur: 0.3, type: 'sawtooth', f0: r(90, 120), f1: r(130, 160), gain: 0.12, attack: 0.05, vibrato: 10, vibratoRate: 30 });
        break;
      case 'mantle':
        this.noise(out, { dur: 0.25, type: 'bandpass', freq: 700, q: 0.8, gain: 0.3, attack: 0.08 });
        break;
      case 'gong':
        for (const f of [82, 123.5, 164.8, 221, 311]) this.tone(out, { dur: 4, f0: f, f1: f * 0.992, gain: 0.22, attack: 0.004 });
        this.noise(out, { dur: 0.6, type: 'bandpass', freq: 900, q: 1, gain: 0.25 });
        break;
      case 'rumble':
        this.noise(out, { dur: 3.2, type: 'lowpass', freq: 70, q: 2, gain: 1, attack: 0.8 });
        this.tone(out, { dur: 3, type: 'sine', f0: 34, f1: 27, gain: 0.6, attack: 0.8 });
        break;
      case 'drip':
        this.tone(out, { dur: 0.09, f0: r(1300, 1900), f1: 700, gain: 0.2, attack: 0.001 });
        break;
      case 'pour':
        this.noise(out, { dur: 0.9, type: 'bandpass', freq: 800, freq2: 2200, q: 2, gain: 0.35, attack: 0.1 });
        break;
      case 'thud':
        this.tone(out, { dur: 0.2, f0: 95 * p, f1: 45, gain: 0.6 });
        this.noise(out, { dur: 0.1, type: 'lowpass', freq: 500, gain: 0.4 });
        break;
      case 'plate':
        this.tone(out, { dur: 0.08, type: 'square', f0: 180, f1: 120, gain: 0.22 });
        this.noise(out, { dur: 0.25, type: 'lowpass', freq: 300, q: 2, gain: 0.5, delay: 0.03 });
        break;
      case 'bird': {
        const base = r(1900, 3600);
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          this.tone(out, { dur: r(0.05, 0.12), f0: base * r(0.9, 1.15), f1: base * r(1.1, 1.5), gain: 0.07, delay: i * r(0.09, 0.16), attack: 0.01 });
        }
        break;
      }
      case 'kick':
        this.tone(out, { dur: 0.25, f0: 130, f1: 40, gain: 0.9, attack: 0.001 });
        this.noise(out, { dur: 0.6, type: 'lowpass', freq: 800, gain: 0.8, attack: 0.002 });
        break;
      case 'drop':
        this.tone(out, { dur: 0.1, f0: 160, f1: 80, gain: 0.3 });
        break;
      case 'throw':
        this.noise(out, { dur: 0.18, type: 'bandpass', freq: 700, freq2: 1800, q: 1.2, gain: 0.3, attack: 0.05 });
        break;
    }
  }

  /** Drive the continuous layers. Call once per frame. */
  update(dt: number, s: AmbientState): void {
    this.state = s;
    const c = this.ctx;
    if (!c || !this.enabled || c.state !== 'running') return;
    const t = c.currentTime;
    const set = (name: string, v: number, tc = 0.4): void => {
      this.loops[name]?.gain.setTargetAtTime(Math.max(0, v), t, tc);
    };
    const day = 1 - s.night;
    set('wind', 0.05 * s.outdoor + 0.3 * s.wind * s.outdoor);
    set('insects', 0.035 * s.jungle * day);
    set('river', 0.4 * s.river);
    set('drone', 0.5 * s.dungeon + 0.12 * s.night * s.outdoor);
    set('rumble', 0.9 * s.rumble, 0.25);
    set('hiss', s.torchLit ? 0.035 : 0, 0.15);
    set('under', s.underwater ? 0.6 : 0, 0.1);
    set('dangerPad', 0.11 * s.danger, 1.2);
    set('calmPad', 0.05 * (1 - s.danger), 1.5);
    this.lowpass.frequency.setTargetAtTime(s.underwater ? 520 : 20000, t, 0.08);
    this.reverbSend.gain.setTargetAtTime(0.05 + 0.6 * s.reverb, t, 0.5);

    const T = this.timers;
    // Birds by day, crickets by night.
    T.bird -= dt;
    if (T.bird <= 0) {
      T.bird = 0.6 + Math.random() * 3.2;
      if (s.jungle * day > 0.15) this.play('bird', { vol: s.jungle * day * (0.4 + Math.random() * 0.6) });
    }
    T.cricket -= dt;
    if (T.cricket <= 0) {
      T.cricket = 0.42 + Math.random() * 0.1;
      if (s.night * s.outdoor > 0.2) {
        const out = this.out(0.05 * s.night * s.outdoor);
        if (out) for (let i = 0; i < 3; i++) this.tone(out, { dur: 0.03, f0: 4300, gain: 0.5, delay: i * 0.045, attack: 0.004 });
      }
    }
    // Torch crackle.
    T.crackle -= dt;
    if (T.crackle <= 0) {
      T.crackle = 0.04 + Math.random() * 0.22;
      if (s.torchLit) {
        const out = this.out(0.1 + Math.random() * 0.12);
        if (out) this.noise(out, { dur: 0.02 + Math.random() * 0.03, type: 'highpass', freq: 1200 + Math.random() * 2500, gain: 0.6, attack: 0.001 });
      }
    }
    // Drips underground.
    T.drip -= dt;
    if (T.drip <= 0) {
      T.drip = 1.5 + Math.random() * 5;
      if (s.dungeon > 0.5) this.play('drip', { vol: 0.5 + Math.random() * 0.5 });
    }
    // Deep rumbles roll in at dusk.
    T.duskRumble -= dt;
    if (T.duskRumble <= 0) {
      T.duskRumble = 7 + Math.random() * 9;
      if (s.dusk > 0.05) this.play('rumble', { vol: 0.35 + 0.6 * s.dusk });
    }
    // Heartbeat: faster and louder as a guardian closes in.
    T.heart -= dt;
    if (T.heart <= 0) {
      const bpm = 62 + 95 * s.threat;
      T.heart = 60 / bpm;
      if (s.threat > 0.03) {
        const out = this.out(0.25 + 0.75 * s.threat);
        if (out) {
          this.tone(out, { dur: 0.13, f0: 62, f1: 40, gain: 0.9, attack: 0.004 });
          this.tone(out, { dur: 0.11, f0: 54, f1: 36, gain: 0.6, attack: 0.004, delay: Math.min(0.2, T.heart * 0.32) });
        }
      }
    }
    this.music(dt, s);
  }

  /** Generative score: a slow pentatonic layer by day, a driving ostinato when the clock runs out. */
  private music(dt: number, s: AmbientState): void {
    this.timers.beat -= dt;
    if (this.timers.beat > 0) return;
    const danger = s.danger;
    const bpm = 76 + 68 * danger;
    this.timers.beat += 60 / bpm / 2; // eighth notes
    if (this.timers.beat < -0.5) this.timers.beat = 0;
    const i = this.beatIndex++;
    if (i % 32 === 0) this.chordRoot = [50, 48, 53, 45][Math.floor(i / 32) % 4];
    const root = this.chordRoot;
    const g = this.musicBus;
    const calm = 1 - danger;
    if (calm > 0.05 && s.dungeon < 0.9) {
      // Plucked pentatonic notes, sparse.
      if (Math.random() < 0.3) {
        const n = root + 12 + PENTA[Math.floor(Math.random() * PENTA.length)] + (Math.random() < 0.3 ? 12 : 0);
        this.tone(g, { dur: 1.6, type: 'triangle', f0: midi(n), gain: 0.09 * calm, attack: 0.01 });
        this.tone(g, { dur: 0.8, type: 'sine', f0: midi(n) * 2, gain: 0.025 * calm, attack: 0.01 });
      }
      if (i % 16 === 0) this.tone(g, { dur: 3.2, type: 'sine', f0: midi(root - 12), gain: 0.14 * calm, attack: 0.3 });
    } else if (calm > 0.05 && i % 16 === 0) {
      // Underground the day score thins to a single low bowed note.
      this.tone(g, { dur: 4, type: 'sine', f0: midi(root - 12), gain: 0.1 * calm, attack: 1.2 });
    }
    if (danger > 0.05) {
      const bass = [0, 0, 1, 0, 0, 0, 3, 1][i % 8];
      this.tone(g, { dur: 0.18, type: 'sawtooth', f0: midi(38 + bass), gain: 0.2 * danger, attack: 0.005 });
      if (i % 4 === 0) this.noise(g, { dur: 0.12, type: 'lowpass', freq: 160, gain: 0.5 * danger, attack: 0.002 });
      if (i % 8 === 4) this.noise(g, { dur: 0.06, type: 'highpass', freq: 4000, gain: 0.12 * danger, attack: 0.002 });
      if (i % 16 === 14) this.tone(g, { dur: 0.5, type: 'square', f0: midi(62), f1: midi(63), gain: 0.05 * danger });
    }
  }

  /** Short screen-shaking sub pulse (boulder pass, door slam). */
  thump(vol = 1): void {
    const out = this.out(vol);
    if (out) this.tone(out, { dur: 0.5, f0: 48, f1: 26, gain: 0.9, attack: 0.004 });
  }

  /** Silence the beds (menus, results). */
  hush(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const k of Object.keys(this.loops)) this.loops[k].gain.setTargetAtTime(0, t, 0.3);
    this.pulse = null;
  }

  get voiceCount(): number {
    return this.voices;
  }

  get lastState(): AmbientState | null {
    return this.state;
  }
}
