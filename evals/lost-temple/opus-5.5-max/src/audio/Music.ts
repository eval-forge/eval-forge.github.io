/**
 * Procedural score with three layers: a calm drone with sparse pentatonic plucks, a tense
 * pulse for the last minute and the night, and a chase layer with drums when a guardian has
 * you. A lookahead scheduler places notes on the audio clock.
 */
import { AudioEngine } from './AudioEngine';

const A_MINOR_PENT = [0, 3, 5, 7, 10];

export class Music {
  private started = false;
  private nextBeat = 0;
  private beat = 0;
  private bpm = 72;
  private pad: { osc: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private delay: DelayNode | null = null;
  private delayIn: GainNode | null = null;
  calm = 1;
  tension = 0;
  chase = 0;
  underground = false;
  enabled = true;

  constructor(private a: AudioEngine) {}

  private start() {
    if (this.started || !this.a.ready || !this.a.ctx) return;
    this.started = true;
    const ctx = this.a.ctx;
    const t = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain);
    gain.connect(this.a.music);
    const osc: OscillatorNode[] = [];
    for (const [f, d] of [[55, -6], [55, 7], [82.4, 0], [110, 4]] as [number, number][]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = d;
      const og = ctx.createGain();
      og.gain.value = 0.12;
      o.connect(og);
      og.connect(filter);
      o.start(t);
      osc.push(o);
    }
    this.pad = { osc, filter, gain };
    // feedback delay for plucks
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 60 / this.bpm * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 1800;
    const din = ctx.createGain();
    din.gain.value = 0.5;
    din.connect(delay);
    delay.connect(dl);
    dl.connect(fb);
    fb.connect(delay);
    dl.connect(this.a.music);
    this.delay = delay;
    this.delayIn = din;
    this.nextBeat = t + 0.2;
  }

  private pluck(t: number, freq: number, vol: number, dur = 1.2, type: OscillatorType = 'triangle') {
    const ctx = this.a.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.a.music);
    if (this.delayIn) g.connect(this.delayIn);
    o.start(t);
    o.stop(t + dur + 0.05);
    setTimeout(() => g.disconnect(), (dur + 1) * 1000);
  }

  private drum(t: number, f0: number, f1: number, vol: number, dur: number, noise = 0) {
    const ctx = this.a.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.a.music);
    o.start(t);
    o.stop(t + dur + 0.02);
    if (noise > 0) {
      const s = this.a.noiseSource('white');
      const hf = ctx.createBiquadFilter();
      hf.type = 'highpass';
      hf.frequency.value = 3000;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(noise, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      s.connect(hf);
      hf.connect(ng);
      ng.connect(this.a.music);
      s.start(t, Math.random(), 0.1);
    }
    setTimeout(() => g.disconnect(), (dur + 1) * 1000);
  }

  update() {
    if (!this.enabled) return;
    this.start();
    if (!this.started || !this.a.ctx || !this.pad) return;
    const ctx = this.a.ctx;
    const now = ctx.currentTime;
    const tension = Math.max(this.tension, this.chase * 0.8);
    this.bpm = 72 + tension * 40 + this.chase * 20;
    // pad: darker underground, opens with tension
    this.pad.filter.frequency.setTargetAtTime(this.underground ? 260 + tension * 500 : 480 + tension * 900, now, 0.5);
    this.pad.gain.gain.setTargetAtTime(0.16 + tension * 0.1, now, 0.6);
    const root = tension > 0.5 ? 51.9 : 55; // drop a semitone when tense
    for (let i = 0; i < this.pad.osc.length; i++) {
      const base = [root, root, root * 1.498, root * 2][i];
      this.pad.osc[i].frequency.setTargetAtTime(base, now, 1.2);
    }
    if (this.delay) this.delay.delayTime.setTargetAtTime((60 / this.bpm) * 0.75, now, 0.5);

    const spb = 60 / this.bpm / 2; // eighth notes
    while (this.nextBeat < now + 0.25) {
      const t = this.nextBeat;
      const b = this.beat;
      // calm plucks: sparse pentatonic
      if (b % 4 === 0 && Math.random() < 0.45 * (1 - tension * 0.6)) {
        const deg = A_MINOR_PENT[Math.floor(Math.random() * 5)];
        const oct = Math.random() < 0.5 ? 2 : 4;
        this.pluck(t, 110 * oct * Math.pow(2, deg / 12), 0.08);
      }
      // tense pulse
      if (tension > 0.05) {
        if (b % 2 === 0) this.pluck(t, root * 2, 0.06 * tension, 0.25, 'sawtooth');
        if (b % 16 === 8) this.pluck(t, root * 2 * Math.pow(2, 1 / 12), 0.07 * tension, 1.5, 'sawtooth');
        if (b % 8 === 0) this.drum(t, 70, 40, 0.25 * tension, 0.5);
      }
      // chase drums
      if (this.chase > 0.05) {
        const c = this.chase;
        if (b % 4 === 0 || b % 8 === 3) this.drum(t, 110, 45, 0.5 * c, 0.25);
        if (b % 4 === 2) this.drum(t, 220, 160, 0.18 * c, 0.12, 0.15 * c);
        if (b % 2 === 1) this.drum(t, 400, 300, 0.05 * c, 0.05, 0.08 * c);
      }
      this.beat++;
      this.nextBeat += spb;
    }
  }

  stop() {
    if (!this.pad || !this.a.ctx) return;
    this.pad.gain.gain.setTargetAtTime(0, this.a.ctx.currentTime, 0.4);
  }
}
