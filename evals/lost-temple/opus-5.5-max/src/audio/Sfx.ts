/**
 * Every sound effect, synthesized on the fly: filtered noise bursts, oscillators with pitch
 * sweeps, FM bells. One-shots can be positioned in 3D; loops return a handle.
 */
import * as THREE from 'three';
import { AudioEngine, setPannerPos, startSrc, type Voice } from './AudioEngine';

export type SfxName =
  | 'step_stone' | 'step_dirt' | 'step_grass' | 'step_wood' | 'step_water' | 'step_metal' | 'step_sand' | 'step_rope' | 'step_vine' | 'step_bone'
  | 'land' | 'stoneClick' | 'stoneGrind' | 'woodCreak' | 'woodSnap' | 'plankCrack' | 'splash' | 'dartFire' | 'dartHit'
  | 'blade' | 'rumble' | 'crumble' | 'debris' | 'impact' | 'impactMetal' | 'pickup' | 'stash' | 'cart' | 'kick' | 'wallBreak'
  | 'chime' | 'torchLight' | 'torchOut' | 'flask' | 'crank' | 'tick' | 'heartbeat' | 'hurt' | 'gong' | 'sentinel'
  | 'crawler' | 'shadow' | 'deny' | 'swing' | 'spikes' | 'gateOpen' | 'whoosh' | 'thunk' | 'click' | 'drip' | 'birds' | 'caught';

export interface LoopHandle {
  setPos(p: THREE.Vector3): void;
  setGain(g: number): void;
  setRate?(r: number): void;
  stop(): void;
}

const NULL_LOOP: LoopHandle = { setPos() {}, setGain() {}, setRate() {}, stop() {} };

export class Sfx {
  private last = new Map<string, number>();
  constructor(public a: AudioEngine) {}

  private get ctx() {
    return this.a.ctx!;
  }

  private ok(name: string, minGap = 0.03): boolean {
    if (!this.a.ready || !this.a.ctx || this.a.ctx.state !== 'running') return false;
    const t = this.a.now;
    const l = this.last.get(name) ?? -1;
    if (t - l < minGap) return false;
    this.last.set(name, t);
    return true;
  }

  private noise(v: Voice, t: number, o: { kind?: 'white' | 'brown' | 'pink'; type?: BiquadFilterType; f0: number; f1?: number; q?: number; dur: number; vol: number; attack?: number; curve?: number }) {
    const ctx = this.ctx;
    const src = this.a.noiseSource(o.kind ?? 'white');
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    const at = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol, t + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(v.out);
    startSrc(src, t, o.dur + 0.05);
  }

  private tone(v: Voice, t: number, o: { type?: OscillatorType; f0: number; f1?: number; dur: number; vol: number; attack?: number; detune?: number }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const at = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol, t + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g);
    g.connect(v.out);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  /** FM bell / chime. */
  private bell(v: Voice, t: number, freq: number, dur: number, vol: number, ratio = 3.5, index = 2) {
    const ctx = this.ctx;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * ratio;
    mg.gain.setValueAtTime(freq * index, t);
    mg.gain.exponentialRampToValueAtTime(1, t + dur);
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g);
    g.connect(v.out);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  play(name: SfxName, pos?: THREE.Vector3 | null, vol = 1, pitch = 1) {
    if (!this.ok(name + (pos ? Math.round(pos.x) + ',' + Math.round(pos.z) : ''), name === 'tick' ? 0.05 : 0.025)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const r = () => 0.85 + Math.random() * 0.3;
    const big = name === 'rumble' || name === 'debris' || name === 'wallBreak' || name === 'gong';
    const v = this.a.voice('sfx', pos ?? null, { ref: big ? 8 : 2.5, rolloff: big ? 0.6 : 1.1 });
    v.out.gain.value = vol;
    const p = pitch;
    switch (name) {
      case 'step_stone':
        this.noise(v, t, { f0: 900 * p * r(), q: 1.2, dur: 0.09, vol: 0.32 });
        this.tone(v, t, { f0: 120 * p, f1: 70, dur: 0.07, vol: 0.18 });
        break;
      case 'step_bone':
        this.noise(v, t, { f0: 2600 * r(), q: 3, dur: 0.06, vol: 0.25 });
        this.noise(v, t + 0.02, { f0: 1500 * r(), q: 4, dur: 0.05, vol: 0.18 });
        break;
      case 'step_dirt':
      case 'step_sand':
        this.noise(v, t, { kind: 'pink', type: 'lowpass', f0: 700 * r(), dur: 0.12, vol: 0.35 });
        break;
      case 'step_grass':
        this.noise(v, t, { f0: 2800 * r(), f1: 1200, q: 0.7, dur: 0.14, vol: 0.18, attack: 0.02 });
        this.noise(v, t, { kind: 'pink', type: 'lowpass', f0: 400, dur: 0.1, vol: 0.2 });
        break;
      case 'step_wood':
        this.tone(v, t, { type: 'triangle', f0: 190 * p * r(), f1: 120, dur: 0.12, vol: 0.3 });
        this.noise(v, t, { f0: 600, q: 2, dur: 0.07, vol: 0.18 });
        break;
      case 'step_rope':
      case 'step_vine':
        this.noise(v, t, { f0: 1800 * r(), f1: 900, q: 1, dur: 0.18, vol: 0.14, attack: 0.03 });
        break;
      case 'step_water':
        this.noise(v, t, { f0: 1200 * r(), f1: 400, q: 0.8, dur: 0.22, vol: 0.32, attack: 0.01 });
        this.tone(v, t + 0.02, { f0: 500 * r(), f1: 900, dur: 0.06, vol: 0.05 });
        break;
      case 'step_metal':
        this.bell(v, t, 1800 * r(), 0.12, 0.08, 1.41, 1);
        break;
      case 'land':
        this.tone(v, t, { f0: 90, f1: 40, dur: 0.22, vol: 0.5 });
        this.noise(v, t, { kind: 'brown', type: 'lowpass', f0: 500, dur: 0.2, vol: 0.5 });
        break;
      case 'stoneClick':
        this.noise(v, t, { f0: 1600, q: 5, dur: 0.05, vol: 0.4 });
        this.tone(v, t + 0.02, { f0: 140, f1: 60, dur: 0.25, vol: 0.4 });
        break;
      case 'stoneGrind': {
        const d = 1.6 * vol;
        this.noise(v, t, { kind: 'brown', type: 'bandpass', f0: 220, f1: 160, q: 0.8, dur: d, vol: 0.9, attack: 0.2 });
        this.noise(v, t, { kind: 'white', type: 'bandpass', f0: 1400, f1: 900, q: 3, dur: d, vol: 0.12, attack: 0.3 });
        this.tone(v, t, { type: 'sawtooth', f0: 45, f1: 38, dur: d, vol: 0.12, attack: 0.3 });
        break;
      }
      case 'woodCreak': {
        const ctx2 = this.ctx;
        const o = ctx2.createOscillator();
        o.type = 'sawtooth';
        const base = 160 * p * r();
        o.frequency.setValueAtTime(base, t);
        o.frequency.linearRampToValueAtTime(base * 1.35, t + 0.25);
        o.frequency.linearRampToValueAtTime(base * 0.9, t + 0.55);
        const f = ctx2.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 900;
        f.Q.value = 6;
        const g = ctx2.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.18, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        // jitter the amplitude like a stick-slip creak
        const lfo = ctx2.createOscillator();
        lfo.frequency.value = 28;
        const lg = ctx2.createGain();
        lg.gain.value = 0.08;
        lfo.connect(lg);
        lg.connect(g.gain);
        o.connect(f);
        f.connect(g);
        g.connect(v.out);
        o.start(t);
        lfo.start(t);
        o.stop(t + 0.65);
        lfo.stop(t + 0.65);
        break;
      }
      case 'woodSnap':
      case 'plankCrack':
        this.noise(v, t, { f0: 3000, f1: 800, q: 0.9, dur: name === 'woodSnap' ? 0.25 : 0.12, vol: name === 'woodSnap' ? 0.8 : 0.45, attack: 0.001 });
        this.tone(v, t, { type: 'square', f0: 300, f1: 80, dur: 0.1, vol: 0.12 });
        if (name === 'woodSnap') this.noise(v, t + 0.05, { kind: 'brown', type: 'lowpass', f0: 300, dur: 0.4, vol: 0.4 });
        break;
      case 'splash':
        this.noise(v, t, { f0: 2400, f1: 500, q: 0.6, dur: 0.6 * vol + 0.2, vol: 0.6, attack: 0.01 });
        this.noise(v, t, { kind: 'brown', type: 'lowpass', f0: 600, dur: 0.4, vol: 0.4 });
        break;
      case 'dartFire':
        this.noise(v, t, { f0: 4000, f1: 1500, q: 2, dur: 0.12, vol: 0.4, attack: 0.002 });
        this.tone(v, t, { type: 'triangle', f0: 900, f1: 300, dur: 0.08, vol: 0.12 });
        break;
      case 'dartHit':
        this.noise(v, t, { f0: 2000, q: 4, dur: 0.05, vol: 0.4 });
        this.tone(v, t, { f0: 600, f1: 200, dur: 0.06, vol: 0.15 });
        break;
      case 'blade':
      case 'swing':
      case 'whoosh':
        this.noise(v, t, { f0: 500, f1: 2600, q: 2.2, dur: 0.35, vol: name === 'blade' ? 0.45 : 0.3, attack: 0.15 });
        break;
      case 'rumble': {
        const d = 3.5 * Math.max(0.5, vol);
        this.noise(v, t, { kind: 'brown', type: 'lowpass', f0: 140, f1: 70, dur: d, vol: 1.0, attack: 0.5 });
        this.tone(v, t, { f0: 38, f1: 30, dur: d, vol: 0.45, attack: 0.6 });
        break;
      }
      case 'crumble':
        for (let i = 0; i < 6; i++) this.noise(v, t + i * 0.05 + Math.random() * 0.05, { f0: 700 + Math.random() * 1800, q: 2, dur: 0.12, vol: 0.25 });
        this.noise(v, t, { kind: 'brown', type: 'lowpass', f0: 400, dur: 0.6, vol: 0.4 });
        break;
      case 'debris':
        this.tone(v, t, { f0: 70, f1: 30, dur: 0.6, vol: 0.8 });
        this.noise(v, t, { kind: 'brown', type: 'lowpass', f0: 900, f1: 200, dur: 0.8, vol: 0.9 });
        for (let i = 0; i < 4; i++) this.noise(v, t + 0.05 + i * 0.07, { f0: 1200 + Math.random() * 1500, q: 2, dur: 0.1, vol: 0.2 });
        break;
      case 'impact':
        this.noise(v, t, { f0: 500 * r(), q: 1.5, dur: 0.1, vol: 0.45 });
        this.tone(v, t, { f0: 160 * r(), f1: 70, dur: 0.12, vol: 0.25 });
        break;
      case 'impactMetal':
        this.bell(v, t, 1200 * r(), 0.5, 0.18, 2.76, 2.5);
        this.noise(v, t, { f0: 2500, q: 2, dur: 0.05, vol: 0.2 });
        break;
      case 'pickup':
        this.noise(v, t, { f0: 1200, f1: 3000, q: 1, dur: 0.12, vol: 0.15, attack: 0.03 });
        break;
      case 'stash':
        this.noise(v, t, { f0: 1600, f1: 700, q: 0.9, dur: 0.25, vol: 0.2, attack: 0.02 });
        this.bell(v, t + 0.08, 2200, 0.3, 0.06, 1.5, 1.2);
        this.bell(v, t + 0.12, 2650, 0.3, 0.05, 1.5, 1.2);
        break;
      case 'cart':
        for (let i = 0; i < 8; i++) this.bell(v, t + i * 0.045 + Math.random() * 0.03, 1800 + Math.random() * 1500, 0.35, 0.07, 1.5, 1.4);
        this.noise(v, t, { kind: 'brown', type: 'lowpass', f0: 400, dur: 0.3, vol: 0.3 });
        break;
      case 'kick':
        this.tone(v, t, { f0: 110, f1: 45, dur: 0.18, vol: 0.6 });
        this.noise(v, t, { f0: 800, q: 1, dur: 0.08, vol: 0.4 });
        break;
      case 'wallBreak':
        this.tone(v, t, { f0: 60, f1: 28, dur: 1.2, vol: 0.9 });
        this.noise(v, t, { kind: 'brown', type: 'lowpass', f0: 1200, f1: 150, dur: 1.6, vol: 1.0 });
        for (let i = 0; i < 10; i++) this.noise(v, t + 0.05 + i * 0.08, { f0: 1500 + Math.random() * 2500, q: 3, dur: 0.08, vol: 0.25 });
        break;
      case 'chime':
        this.bell(v, t, 660, 2.2, 0.25, 3.5, 1.5);
        this.bell(v, t + 0.18, 880, 2.0, 0.2, 3.5, 1.5);
        this.bell(v, t + 0.36, 1320, 2.4, 0.18, 3.5, 1.5);
        break;
      case 'torchLight':
        this.noise(v, t, { f0: 300, f1: 1800, q: 0.7, dur: 0.5, vol: 0.5, attack: 0.08 });
        this.tone(v, t, { f0: 80, f1: 120, dur: 0.3, vol: 0.2 });
        break;
      case 'torchOut':
        this.noise(v, t, { f0: 5000, f1: 1500, q: 0.6, dur: 0.7, vol: 0.4, attack: 0.01, type: 'highpass' });
        break;
      case 'flask':
        for (let i = 0; i < 5; i++) this.tone(v, t + i * 0.08, { f0: 300 + Math.random() * 300, f1: 600 + Math.random() * 400, dur: 0.07, vol: 0.12 });
        break;
      case 'crank':
        this.noise(v, t, { f0: 2200, q: 6, dur: 0.04, vol: 0.4 });
        this.tone(v, t, { type: 'square', f0: 220, f1: 180, dur: 0.05, vol: 0.06 });
        this.noise(v, t, { kind: 'brown', type: 'bandpass', f0: 180, q: 1, dur: 0.3, vol: 0.4 });
        break;
      case 'tick':
        this.noise(v, t, { f0: 2600, q: 8, dur: 0.035, vol: 0.55 });
        this.tone(v, t, { type: 'triangle', f0: 820, f1: 600, dur: 0.05, vol: 0.18 });
        this.tone(v, t, { f0: 140, f1: 90, dur: 0.09, vol: 0.25 });
        break;
      case 'heartbeat':
        this.tone(v, t, { f0: 62, f1: 40, dur: 0.16, vol: 0.9 });
        this.tone(v, t + 0.2, { f0: 55, f1: 38, dur: 0.14, vol: 0.6 });
        break;
      case 'hurt':
        this.noise(v, t, { kind: 'pink', type: 'bandpass', f0: 600, f1: 300, q: 2, dur: 0.3, vol: 0.5, attack: 0.01 });
        this.tone(v, t, { type: 'sawtooth', f0: 180, f1: 110, dur: 0.25, vol: 0.12 });
        break;
      case 'gong':
        this.bell(v, t, 82, 6, 0.6, 1.41, 4);
        this.bell(v, t, 123, 5, 0.3, 2.01, 3);
        this.noise(v, t, { kind: 'brown', type: 'lowpass', f0: 120, dur: 5, vol: 0.6, attack: 0.3 });
        break;
      case 'sentinel': {
        // grinding stone groan
        this.tone(v, t, { type: 'sawtooth', f0: 55 * r(), f1: 42, dur: 1.6, vol: 0.4, attack: 0.3 });
        this.tone(v, t, { type: 'sawtooth', f0: 82 * r(), f1: 61, dur: 1.5, vol: 0.2, attack: 0.3, detune: 15 });
        this.noise(v, t, { kind: 'brown', type: 'bandpass', f0: 300, f1: 180, q: 2, dur: 1.6, vol: 0.6, attack: 0.3 });
        break;
      }
      case 'crawler':
        for (let i = 0; i < 9; i++) this.noise(v, t + i * 0.045 + Math.random() * 0.02, { f0: 2500 + Math.random() * 2500, q: 10, dur: 0.03, vol: 0.4 });
        this.tone(v, t, { type: 'square', f0: 900, f1: 1400, dur: 0.25, vol: 0.03 });
        break;
      case 'shadow':
        this.noise(v, t, { kind: 'pink', type: 'bandpass', f0: 900, f1: 2400, q: 6, dur: 1.4, vol: 0.4, attack: 0.5 });
        this.noise(v, t + 0.3, { kind: 'pink', type: 'bandpass', f0: 2600, f1: 700, q: 7, dur: 1.2, vol: 0.3, attack: 0.4 });
        break;
      case 'caught':
        this.tone(v, t, { type: 'sawtooth', f0: 70, f1: 30, dur: 1.5, vol: 0.6 });
        this.noise(v, t, { kind: 'brown', type: 'lowpass', f0: 800, f1: 100, dur: 1.5, vol: 0.8 });
        this.bell(v, t, 98, 3, 0.4, 1.41, 5);
        break;
      case 'deny':
        this.tone(v, t, { type: 'triangle', f0: 180, f1: 140, dur: 0.18, vol: 0.2 });
        break;
      case 'spikes':
        this.noise(v, t, { f0: 3500, f1: 2000, q: 3, dur: 0.12, vol: 0.5 });
        this.bell(v, t, 1400, 0.2, 0.08, 2.4, 2);
        break;
      case 'gateOpen':
        this.noise(v, t, { kind: 'brown', type: 'bandpass', f0: 260, f1: 140, q: 1, dur: 2.5, vol: 0.9, attack: 0.3 });
        for (let i = 0; i < 14; i++) this.noise(v, t + i * 0.17, { f0: 1900, q: 7, dur: 0.04, vol: 0.25 });
        break;
      case 'thunk':
        this.tone(v, t, { f0: 130, f1: 60, dur: 0.2, vol: 0.5 });
        this.noise(v, t, { f0: 400, q: 1, dur: 0.1, vol: 0.3 });
        break;
      case 'click':
        this.noise(v, t, { f0: 3000, q: 6, dur: 0.03, vol: 0.3 });
        break;
      case 'drip': {
        const f = 900 + Math.random() * 900;
        this.tone(v, t, { f0: f, f1: f * 1.8, dur: 0.08, vol: 0.18 });
        this.tone(v, t + 0.11, { f0: f * 0.7, f1: f * 1.3, dur: 0.05, vol: 0.05 });
        break;
      }
      case 'birds': {
        const base = 2200 + Math.random() * 1600;
        for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
          const tt = t + i * (0.09 + Math.random() * 0.06);
          this.tone(v, tt, { f0: base * (0.9 + Math.random() * 0.3), f1: base * (1.2 + Math.random() * 0.4), dur: 0.07, vol: 0.06 });
        }
        break;
      }
    }
    setTimeout(() => {
      v.out.disconnect();
      v.panner?.disconnect();
    }, big || name === 'sentinel' ? 8000 : 3500);
  }

  /** Continuous sound. */
  loop(kind: 'torch' | 'boulder' | 'grind' | 'wind' | 'river' | 'water', pos?: THREE.Vector3 | null, vol = 1): LoopHandle {
    if (!this.a.ready || !this.a.ctx) return NULL_LOOP;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const v = this.a.voice(kind === 'wind' || kind === 'river' ? 'amb' : 'sfx', pos ?? null, { ref: kind === 'boulder' || kind === 'grind' ? 6 : kind === 'river' ? 10 : 2, rolloff: kind === 'river' ? 0.7 : 1 });
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(vol, t, 0.15);
    g.connect(v.out);
    const srcs: AudioScheduledSourceNode[] = [];
    const add = (src: AudioScheduledSourceNode, node: AudioNode) => {
      srcs.push(src);
      node.connect(g);
    };
    let rateParam: AudioParam | null = null;
    if (kind === 'torch') {
      const s = this.a.noiseSource('crackle', true);
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 500;
      s.connect(f);
      add(s, f);
      const s2 = this.a.noiseSource('brown', true);
      const f2 = ctx.createBiquadFilter();
      f2.type = 'lowpass';
      f2.frequency.value = 220;
      const g2 = ctx.createGain();
      g2.gain.value = 0.25;
      s2.connect(f2);
      f2.connect(g2);
      add(s2, g2);
      startSrc(s, t);
      startSrc(s2, t);
    } else if (kind === 'boulder' || kind === 'grind') {
      const s = this.a.noiseSource('brown', true);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = kind === 'boulder' ? 180 : 320;
      s.connect(f);
      add(s, f);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = kind === 'boulder' ? 30 : 48;
      const og = ctx.createGain();
      og.gain.value = 0.12;
      o.connect(og);
      add(o, og);
      rateParam = o.frequency;
      startSrc(s, t);
      o.start(t);
    } else if (kind === 'wind') {
      const s = this.a.noiseSource('pink', true);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 500;
      f.Q.value = 0.8;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13;
      const lg = ctx.createGain();
      lg.gain.value = 300;
      lfo.connect(lg);
      lg.connect(f.frequency);
      s.connect(f);
      add(s, f);
      srcs.push(lfo);
      startSrc(s, t);
      lfo.start(t);
      rateParam = f.frequency;
    } else {
      const s = this.a.noiseSource(kind === 'river' ? 'pink' : 'white', true);
      const f = ctx.createBiquadFilter();
      f.type = kind === 'river' ? 'lowpass' : 'bandpass';
      f.frequency.value = kind === 'river' ? 900 : 1500;
      f.Q.value = 0.6;
      s.connect(f);
      add(s, f);
      startSrc(s, t);
    }
    let stopped = false;
    return {
      setPos: (p) => {
        if (v.panner) setPannerPos(v.panner, p, ctx.currentTime);
      },
      setGain: (x) => {
        if (!stopped) g.gain.setTargetAtTime(Math.max(0, x), ctx.currentTime, 0.08);
      },
      setRate: (r) => {
        if (rateParam && !stopped) rateParam.setTargetAtTime(r, ctx.currentTime, 0.1);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        const tt = ctx.currentTime;
        g.gain.setTargetAtTime(0, tt, 0.08);
        for (const s of srcs) {
          try {
            s.stop(tt + 0.5);
          } catch {
            /* already stopped */
          }
        }
        setTimeout(() => {
          v.out.disconnect();
          v.panner?.disconnect();
        }, 800);
      },
    };
  }
}
