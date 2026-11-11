/**
 * WebAudio core: one context, a master compressor, three buses (music, sfx, ambience),
 * shared noise buffers, and positional voices with an HRTF panner. Everything is synthesized.
 */
import * as THREE from 'three';

export interface Voice {
  out: GainNode;
  panner: PannerNode | null;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  music!: GainNode;
  sfx!: GainNode;
  amb!: GainNode;
  /** Reverb send for interior spaces. */
  reverb!: ConvolverNode;
  reverbSend!: GainNode;
  white!: AudioBuffer;
  brown!: AudioBuffer;
  pink!: AudioBuffer;
  crackle!: AudioBuffer;
  private vol = { master: 0.8, music: 0.6, sfx: 0.9 };
  private listenerPos = new THREE.Vector3();
  ready = false;

  /** Must be called from a user gesture. */
  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
  }

  private init() {
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.music = ctx.createGain();
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.amb.connect(this.master);
    this.white = this.makeNoise('white', 2);
    this.brown = this.makeNoise('brown', 4);
    this.pink = this.makeNoise('pink', 4);
    this.crackle = this.makeCrackle(3);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.6, 2.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.0;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.sfx);
    const l = ctx.listener as any;
    if (l.positionX) {
      l.positionX.value = 0;
      l.positionY.value = 0;
      l.positionZ.value = 0;
    }
    this.applyVolumes();
    this.ready = true;
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.vol = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.music.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(this.vol.sfx * 0.7, t, 0.05);
  }

  /** Muffle everything (pause menu). */
  setPaused(p: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(p ? this.vol.master * 0.25 : this.vol.master, t, 0.08);
  }

  setReverb(amount: number) {
    if (!this.ctx) return;
    this.reverbSend.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.4);
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  updateListener(cam: THREE.Camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener as any;
    const p = cam.getWorldPosition(this.listenerPos);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const t = this.ctx.currentTime;
    if (l.positionX) {
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
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  distanceTo(p: THREE.Vector3): number {
    return this.listenerPos.distanceTo(p);
  }

  /** A voice routed to a bus, optionally positioned in 3D. */
  voice(bus: 'sfx' | 'amb' | 'music', pos?: THREE.Vector3 | null, opts: { ref?: number; rolloff?: number; max?: number; reverb?: boolean } = {}): Voice {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    const dest = bus === 'sfx' ? this.sfx : bus === 'amb' ? this.amb : this.music;
    let panner: PannerNode | null = null;
    if (pos) {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = opts.ref ?? 2.5;
      panner.rolloffFactor = opts.rolloff ?? 1.1;
      panner.maxDistance = opts.max ?? 80;
      setPannerPos(panner, pos, ctx.currentTime);
      out.connect(panner);
      panner.connect(dest);
      if (opts.reverb !== false) panner.connect(this.reverbSend);
    } else {
      out.connect(dest);
      if (opts.reverb) out.connect(this.reverbSend);
    }
    return { out, panner };
  }

  noiseSource(kind: 'white' | 'brown' | 'pink' | 'crackle', loop = false, offset = Math.random()): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = kind === 'white' ? this.white : kind === 'brown' ? this.brown : kind === 'pink' ? this.pink : this.crackle;
    src.loop = loop;
    (src as any)._offset = offset * src.buffer.duration;
    return src;
  }

  private makeNoise(kind: 'white' | 'brown' | 'pink', seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  /** Fire crackle: sparse sharp pops over a soft hiss. */
  private makeCrackle(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.08;
      d[i] = lp * 0.25;
    }
    const pops = Math.floor(seconds * 22);
    for (let k = 0; k < pops; k++) {
      const at = Math.floor(Math.random() * (n - 800));
      const len = 40 + Math.floor(Math.random() * 500);
      const amp = 0.3 + Math.random() * 0.7;
      for (let j = 0; j < len; j++) d[at + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / (len * 0.25));
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }
}

export function setPannerPos(p: PannerNode, v: THREE.Vector3, t: number) {
  if ((p as any).positionX) {
    p.positionX.setTargetAtTime(v.x, t, 0.02);
    p.positionY.setTargetAtTime(v.y, t, 0.02);
    p.positionZ.setTargetAtTime(v.z, t, 0.02);
  } else (p as any).setPosition(v.x, v.y, v.z);
}

/** Start a buffer source at its stored random offset. */
export function startSrc(src: AudioBufferSourceNode, when: number, dur?: number) {
  const off = (src as any)._offset ?? 0;
  if (dur !== undefined) src.start(when, off, dur);
  else src.start(when, off);
}
