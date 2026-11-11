/**
 * All sound is synthesised with WebAudio: oscillators, filtered noise and envelopes. No samples.
 */

export interface PlayOpts {
  pos?: { x: number; y: number; z: number };
  vol?: number;
  rate?: number;
  /** Distance at which a positional sound is silent. */
  range?: number;
}

export interface AmbienceState {
  zone: 'A' | 'B' | 'C';
  night: boolean;
  /** 0..1 dread in the last minute and after dark. */
  dread: number;
  wind: number;
  torchLit: boolean;
  inWater: boolean;
  /** Distance to the nearest awake guardian. */
  guardianDist: number;
  mood: 'explore' | 'urgent' | 'night' | 'silent';
  paused: boolean;
}

type Synth = (a: AudioSys, out: AudioNode, t: number, v: number, r: number) => void;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private lx = 0; private ly = 0; private lz = 0; private rx = 1; private rz = 0;
  private beds: Record<string, { gain: GainNode; target: number }> = {};
  private volume = 0.8;
  private nextBird = 2;
  private nextDrip = 3;
  private beatT = 0;
  private beat = 0;
  private heartT = 0;
  private mood: AmbienceState['mood'] = 'silent';
  /** Count of sounds started, for tests. */
  played: Record<string, number> = {};

  /** Must be called from a user gesture. Safe to call repeatedly. */
  resume(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
      const c = this.ctx!;
      this.master = c.createGain(); this.master.gain.value = this.volume;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 5;
      this.master.connect(comp); comp.connect(c.destination);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.amb = c.createGain(); this.amb.gain.value = 0.9; this.amb.connect(this.master);
      this.music = c.createGain(); this.music.gain.value = 0.5; this.music.connect(this.master);
      this.white = this.noiseBuffer(false); this.brown = this.noiseBuffer(true);
      this.makeBeds();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setListener(x: number, y: number, z: number, yaw: number): void {
    this.lx = x; this.ly = y; this.lz = z;
    this.rx = Math.cos(yaw); this.rz = -Math.sin(yaw);
  }

  private noiseBuffer(brown: boolean): AudioBuffer {
    const c = this.ctx!;
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  // --- building blocks ---------------------------------------------------------------------

  /** Oscillator with an attack/decay envelope and optional pitch slide. */
  tone(out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, attack = 0.005): OscillatorNode {
    const c = this.ctx!;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }

  /** Filtered noise burst with an envelope and optional filter sweep. */
  noise(out: AudioNode, t: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1, brown = false, attack = 0.004): void {
    const c = this.ctx!;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = brown ? this.brown : this.white;
    s.loop = true;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(10, f0), t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
  }

  private bed(name: string, brown: boolean, type: BiquadFilterType, freq: number, q: number, lfoHz = 0, lfoDepth = 0): void {
    const c = this.ctx!;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = brown ? this.brown : this.white; s.loop = true;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.value = 0;
    s.connect(f);
    if (lfoHz > 0) {
      const am = c.createGain(); am.gain.value = 1 - lfoDepth;
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = lfoHz; lg.gain.value = lfoDepth;
      lfo.connect(lg); lg.connect(am.gain); lfo.start();
      f.connect(am); am.connect(g);
    } else f.connect(g);
    g.connect(this.amb);
    s.start();
    this.beds[name] = { gain: g, target: 0 };
  }

  private makeBeds(): void {
    this.bed('insects', false, 'bandpass', 5200, 6, 31, 0.5);
    this.bed('leaves', false, 'lowpass', 700, 0.5, 0.13, 0.4);
    this.bed('crickets', false, 'bandpass', 4100, 14, 9, 0.9);
    this.bed('wind', false, 'bandpass', 420, 0.8, 0.31, 0.3);
    this.bed('cave', true, 'lowpass', 110, 0.7, 0.07, 0.3);
    this.bed('rumble', true, 'lowpass', 70, 0.9, 2.3, 0.35);
    this.bed('torch', false, 'bandpass', 900, 0.7, 7.3, 0.25);
    this.bed('water', false, 'bandpass', 1100, 0.6, 0.9, 0.3);
  }

  // --- one-shots ---------------------------------------------------------------------------

  play(name: string, o: PlayOpts = {}): void {
    this.played[name] = (this.played[name] ?? 0) + 1;
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const fn = SOUNDS[name];
    if (!fn) return;
    let vol = o.vol ?? 1;
    let out: AudioNode = this.sfx;
    if (o.pos) {
      const dx = o.pos.x - this.lx, dy = o.pos.y - this.ly, dz = o.pos.z - this.lz;
      const d = Math.hypot(dx, dy, dz);
      const range = o.range ?? 30;
      if (d > range) return;
      const k = 1 - d / range;
      vol *= k * k;
      if (vol < 0.004) return;
      const pan = c.createStereoPanner();
      pan.pan.value = d > 0.3 ? Math.max(-1, Math.min(1, (dx * this.rx + dz * this.rz) / d)) * 0.8 : 0;
      // Far-off sounds lose their top end.
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200 + 14000 * k * k;
      pan.connect(lp); lp.connect(this.sfx);
      out = pan;
    }
    fn(this, out, c.currentTime + 0.001, vol, o.rate ?? 1);
  }

  // --- continuous: ambience, heartbeat, music ------------------------------------------------

  update(dt: number, s: AmbienceState): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const t = c.currentTime;
    const day = !s.night;
    const set = (name: string, v: number) => { const b = this.beds[name]; if (b && Math.abs(b.target - v) > 0.002) { b.target = v; b.gain.gain.setTargetAtTime(v, t, 0.6); } };
    const out = s.zone === 'A' ? 1 : s.zone === 'B' ? 0.35 : 0;
    const quiet = s.paused ? 0 : 1;
    set('insects', quiet * out * (day ? 0.05 : 0));
    set('leaves', quiet * out * 0.1);
    set('crickets', quiet * out * (s.night ? 0.05 : 0));
    set('wind', quiet * Math.min(0.5, s.wind * 0.5 + (s.zone === 'B' ? 0.03 : 0)));
    set('cave', quiet * (s.zone === 'C' ? 0.5 : s.zone === 'B' ? 0.12 : 0));
    set('rumble', quiet * s.dread * 0.75);
    set('torch', quiet * (s.torchLit ? 0.05 : 0));
    set('water', quiet * (s.inWater ? 0.12 : 0));
    if (s.paused) return;

    // Birds by day outside.
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = rnd(1.2, 5);
      if (day && out > 0) {
        const base = rnd(1800, 3600), n = Math.floor(rnd(2, 6)), g = c.createGain();
        g.gain.value = out * rnd(0.04, 0.1);
        const pan = c.createStereoPanner(); pan.pan.value = rnd(-0.9, 0.9);
        g.connect(pan); pan.connect(this.amb);
        for (let i = 0; i < n; i++) this.tone(g, t + i * rnd(0.09, 0.16), 'sine', base * rnd(0.9, 1.2), base * rnd(1.1, 1.5), rnd(0.05, 0.12), 1);
      }
    }
    // Drips underground.
    this.nextDrip -= dt;
    if (this.nextDrip <= 0) {
      this.nextDrip = rnd(1.5, 6);
      if (s.zone === 'C') {
        const pan = c.createStereoPanner(); pan.pan.value = rnd(-1, 1); pan.connect(this.amb);
        const f = rnd(900, 1700);
        this.tone(pan, t, 'sine', f, f * 0.6, 0.09, 0.07);
        this.tone(pan, t + 0.19, 'sine', f, f * 0.6, 0.09, 0.025);
        this.tone(pan, t + 0.38, 'sine', f, f * 0.6, 0.09, 0.01);
      }
    }
    // Heartbeat when a guardian is close.
    if (s.guardianDist < 26) {
      const near = 1 - s.guardianDist / 26;
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 1.05 - near * 0.62;
        const v = 0.25 + near * 0.75;
        this.tone(this.sfx, t, 'sine', 62, 38, 0.16, v, 0.01);
        this.tone(this.sfx, t + 0.17, 'sine', 54, 34, 0.2, v * 0.75, 0.01);
        this.played.heartbeat = (this.played.heartbeat ?? 0) + 1;
      }
    }
    this.stepMusic(dt, s);
  }

  private stepMusic(dt: number, s: AmbienceState): void {
    const c = this.ctx!;
    if (s.mood !== this.mood) { this.mood = s.mood; this.beat = 0; this.beatT = 0; this.played[`music:${s.mood}`] = (this.played[`music:${s.mood}`] ?? 0) + 1; }
    if (this.mood === 'silent') return;
    this.beatT -= dt;
    if (this.beatT > 0) return;
    const t = c.currentTime + 0.03;
    const b = this.beat++;
    const D = 146.83;
    const penta = [1, 1.2, 1.335, 1.5, 1.8, 2, 2.4];
    const deep = s.zone === 'C';
    if (this.mood === 'explore') {
      // Sparse pentatonic plucks over a soft drone. Darker and thinner underground.
      this.beatT = 0.5;
      if (b % 16 === 0) { this.tone(this.music, t, 'sine', D / 2, D / 2, 7.5, deep ? 0.05 : 0.07, 2); this.tone(this.music, t, 'sine', (D / 2) * 1.5, (D / 2) * 1.5, 7.5, 0.03, 2.5); }
      if (Math.random() < (deep ? 0.14 : 0.3)) {
        const f = D * penta[Math.floor(Math.random() * penta.length)] * (deep ? 0.5 : Math.random() < 0.3 ? 2 : 1);
        this.tone(this.music, t, 'triangle', f, f, 1.6, deep ? 0.05 : 0.08, 0.01);
        this.tone(this.music, t, 'sine', f * 2, f * 2, 0.6, 0.025, 0.005);
      }
    } else if (this.mood === 'urgent') {
      // Driving ostinato with a drum on every beat.
      this.beatT = 0.2;
      const seq = [1, 1, 1.2, 1, 1.5, 1, 1.335, 1.2];
      const f = D * seq[b % 8];
      this.tone(this.music, t, 'sawtooth', f, f, 0.16, 0.07, 0.004);
      this.tone(this.music, t, 'triangle', f / 2, f / 2, 0.18, 0.1, 0.004);
      if (b % 2 === 0) this.tone(this.music, t, 'sine', 110, 45, 0.18, 0.3, 0.003);
      if (b % 8 === 6) this.noise(this.music, t, 0.08, 0.12, 'highpass', 5000);
      if (b % 32 === 0) this.tone(this.music, t, 'sawtooth', D / 4, D / 4, 6, 0.06, 0.5);
    } else {
      // Night: low dissonant drone and the odd minor-second stab.
      this.beatT = 0.8;
      if (b % 8 === 0) { this.tone(this.music, t, 'sawtooth', D / 4, D / 4, 6.8, 0.07, 1.5); this.tone(this.music, t, 'sine', (D / 4) * 1.059, (D / 4) * 1.059, 6.8, 0.08, 2); }
      if (b % 4 === 2 && Math.random() < 0.6) {
        const f = D * [1, 1.059, 1.414, 1.5][Math.floor(Math.random() * 4)];
        this.tone(this.music, t, 'triangle', f, f * 0.985, 2.4, 0.06, 0.4);
      }
      if (b % 2 === 0) this.tone(this.music, t, 'sine', 80, 40, 0.3, 0.14, 0.005);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Sound recipes
// ---------------------------------------------------------------------------------------------

const SOUNDS: Record<string, Synth> = {
  step: (a, o, t, v, r) => { a.noise(o, t, 0.07, v * 0.5, 'lowpass', rnd(500, 900) * r, 200 * r, 1); a.tone(o, t, 'sine', 90 * r, 55, 0.06, v * 0.25); },
  land: (a, o, t, v) => { a.noise(o, t, 0.2, v * 0.6, 'lowpass', 500, 120); a.tone(o, t, 'sine', 85, 38, 0.2, v * 0.7); },
  jump: (a, o, t, v) => a.noise(o, t, 0.1, v * 0.3, 'bandpass', 900, 1600, 0.8),
  rustle: (a, o, t, v) => { a.noise(o, t, 0.14, v * 0.35, 'bandpass', rnd(2500, 3800), 1800, 0.8); a.noise(o, t + 0.06, 0.1, v * 0.2, 'bandpass', 3200, 2000, 1); },
  hurt: (a, o, t, v) => { a.tone(o, t, 'sawtooth', 210, 95, 0.28, v * 0.35); a.noise(o, t, 0.16, v * 0.4, 'bandpass', 900, 400, 1); },
  pickup: (a, o, t, v) => { a.tone(o, t, 'sine', 780, 780, 0.12, v * 0.22); a.tone(o, t + 0.07, 'sine', 1170, 1170, 0.18, v * 0.22); },
  relic: (a, o, t, v) => { [1046, 1318, 1568, 2093].forEach((f, i) => { a.tone(o, t + i * 0.07, 'sine', f, f, 0.6, v * 0.16, 0.003); a.tone(o, t + i * 0.07, 'triangle', f * 2.01, f * 2.01, 0.25, v * 0.04, 0.003); }); },
  deny: (a, o, t, v) => { a.tone(o, t, 'square', 150, 110, 0.14, v * 0.12); },
  creak: (a, o, t, v) => {
    // Creaking wood: a rasping saw through a narrow band, pitch wandering.
    const c = a.ctx!; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = rnd(500, 800); f.Q.value = 7; f.connect(o);
    const osc = a.tone(f, t, 'sawtooth', rnd(70, 95), rnd(105, 150), 0.45, v * 0.9, 0.05);
    osc.frequency.setValueAtTime(rnd(70, 95), t + 0.2);
  },
  snap: (a, o, t, v) => { a.noise(o, t, 0.05, v * 0.9, 'highpass', 1800); a.tone(o, t, 'triangle', 420, 90, 0.09, v * 0.6, 0.001); a.noise(o, t + 0.03, 0.12, v * 0.3, 'bandpass', 900, 500, 2); },
  plankFall: (a, o, t, v) => { a.noise(o, t, 0.5, v * 0.3, 'bandpass', 1400, 300, 1.2, false, 0.05); a.tone(o, t + 0.5, 'triangle', 240, 110, 0.07, v * 0.25); },
  crumble: (a, o, t, v) => { for (let i = 0; i < 7; i++) a.noise(o, t + i * rnd(0.05, 0.09), rnd(0.05, 0.14), v * rnd(0.2, 0.5), 'lowpass', rnd(500, 1400), 200, 1, true); },
  rubble: (a, o, t, v) => { a.noise(o, t, 0.9, v * 0.8, 'lowpass', 600, 90, 0.8, true, 0.01); for (let i = 0; i < 6; i++) a.tone(o, t + rnd(0.05, 0.7), 'triangle', rnd(300, 700), rnd(100, 200), 0.05, v * 0.25, 0.001); },
  // Stone grinding on stone: low rough noise with a slow shudder.
  grind: (a, o, t, v) => {
    const c = a.ctx!; const g = c.createGain(); g.gain.value = 0.6; g.connect(o);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = rnd(11, 17); lg.gain.value = 0.4; lfo.connect(lg); lg.connect(g.gain); lfo.start(t); lfo.stop(t + 0.7);
    a.noise(g, t, 0.62, v * 1.1, 'bandpass', rnd(150, 230), rnd(120, 180), 1.6, true, 0.06);
    a.noise(g, t, 0.62, v * 0.18, 'bandpass', 1400, 900, 2, false, 0.06);
  },
  thud: (a, o, t, v) => { a.tone(o, t, 'sine', 70, 32, 0.4, v * 0.9, 0.004); a.noise(o, t, 0.2, v * 0.5, 'lowpass', 260, 80, 1, true); },
  stomp: (a, o, t, v) => { a.tone(o, t, 'sine', 55, 28, 0.5, v, 0.004); a.noise(o, t, 0.3, v * 0.6, 'lowpass', 200, 60, 1, true); a.noise(o, t, 0.08, v * 0.2, 'bandpass', 1200, 600, 1); },
  click: (a, o, t, v) => { a.tone(o, t, 'square', 1300, 700, 0.03, v * 0.15, 0.001); a.noise(o, t, 0.04, v * 0.3, 'bandpass', 2400, 1200, 2); a.tone(o, t + 0.03, 'sine', 120, 70, 0.12, v * 0.4); },
  kick: (a, o, t, v) => { a.tone(o, t, 'sine', 95, 35, 0.3, v, 0.002); a.noise(o, t, 0.12, v * 0.7, 'lowpass', 900, 200); },
  blade: (a, o, t, v) => a.noise(o, t, 0.34, v * 0.5, 'bandpass', 3200, 380, 2.2, false, 0.09),
  dart: (a, o, t, v) => { a.noise(o, t, 0.12, v * 0.5, 'highpass', 3500, 6000); a.tone(o, t, 'sine', 1800, 900, 0.1, v * 0.08); },
  dartHit: (a, o, t, v) => { a.tone(o, t, 'triangle', 1900, 900, 0.035, v * 0.3, 0.001); a.noise(o, t, 0.03, v * 0.3, 'highpass', 3000); },
  rumble: (a, o, t, v) => a.noise(o, t, 0.5, v * 1.3, 'lowpass', 110, 60, 0.8, true, 0.08),
  collapse: (a, o, t, v) => { a.noise(o, t, 5.5, v * 1.4, 'lowpass', 160, 50, 0.8, true, 0.3); for (let i = 0; i < 14; i++) a.noise(o, t + rnd(0, 5), rnd(0.1, 0.4), v * rnd(0.3, 0.7), 'lowpass', rnd(300, 900), 100, 1, true); },
  scarab: (a, o, t, v) => { for (let i = 0; i < 6; i++) a.noise(o, t + i * rnd(0.018, 0.04), 0.012, v * rnd(0.2, 0.5), 'bandpass', rnd(4500, 7500), 5000, 9); },
  skitter: (a, o, t, v) => { for (let i = 0; i < 5; i++) a.noise(o, t + i * 0.035, 0.015, v * 0.5, 'bandpass', rnd(2200, 3600), 2500, 6); },
  strike: (a, o, t, v) => { a.noise(o, t, 0.09, v * 0.5, 'highpass', 2600); a.noise(o, t + 0.5, 0.08, v * 0.5, 'highpass', 2600); a.noise(o, t + 1.1, 0.1, v * 0.6, 'highpass', 2200); },
  ignite: (a, o, t, v) => { a.noise(o, t, 0.6, v * 0.6, 'bandpass', 400, 1900, 0.7, false, 0.08); a.noise(o, t, 0.25, v * 0.2, 'highpass', 4000); },
  douse: (a, o, t, v) => a.noise(o, t, 0.5, v * 0.5, 'highpass', 2800, 5200, 0.7, false, 0.01),
  crackle: (a, o, t, v) => a.noise(o, t, rnd(0.008, 0.03), v * 0.5, 'bandpass', rnd(1500, 4500), 2000, 3, false, 0.001),
  flask: (a, o, t, v) => { for (let i = 0; i < 3; i++) a.tone(o, t + i * 0.13, 'sine', 330 - i * 30, 200, 0.1, v * 0.3, 0.01); },
  lever: (a, o, t, v) => { a.tone(o, t, 'sawtooth', 120, 80, 0.25, v * 0.2); a.noise(o, t + 0.22, 0.06, v * 0.6, 'bandpass', 1600, 800, 2); a.tone(o, t + 0.24, 'sine', 90, 50, 0.2, v * 0.6); },
  splash: (a, o, t, v) => { a.noise(o, t, 0.35, v * 0.6, 'bandpass', 1500, 500, 0.8, false, 0.01); a.noise(o, t + 0.05, 0.25, v * 0.25, 'highpass', 3000); },
  throw: (a, o, t, v) => a.noise(o, t, 0.16, v * 0.4, 'bandpass', 700, 1800, 1.2, false, 0.04),
  clack: (a, o, t, v) => { a.tone(o, t, 'triangle', rnd(480, 640), 190, 0.06, v * 0.6, 0.001); a.noise(o, t, 0.05, v * 0.5, 'bandpass', 1800, 900, 1.5); },
  tick: (a, o, t, v, r) => { a.tone(o, t, 'sine', 1150 * r, 1100 * r, 0.035, v * 0.5, 0.001); a.noise(o, t, 0.018, v * 0.4, 'bandpass', 2600 * r, 2000, 5); a.tone(o, t, 'triangle', 380 * r, 360 * r, 0.05, v * 0.25, 0.001); },
  trap: (a, o, t, v) => { a.tone(o, t, 'sine', 110, 108, 2.2, v * 0.5, 0.005); a.tone(o, t, 'sine', 164, 160, 1.6, v * 0.3, 0.005); a.tone(o, t, 'triangle', 331, 325, 0.9, v * 0.12, 0.005); a.noise(o, t, 0.1, v * 0.4, 'lowpass', 600, 200); },
  door: (a, o, t, v) => { a.tone(o, t, 'sine', 48, 26, 1.4, v, 0.005); a.noise(o, t, 0.8, v * 0.8, 'lowpass', 220, 60, 1, true); },
  gong: (a, o, t, v) => { [73, 110, 147, 220.5].forEach((f, i) => a.tone(o, t, i % 2 ? 'triangle' : 'sine', f, f * 0.99, 5 - i, v * (0.5 - i * 0.1), 0.01)); a.noise(o, t, 0.5, v * 0.3, 'lowpass', 400, 100, 1, true); },
  // Sentinel: a deep stone groan.
  sentinelCall: (a, o, t, v, r) => {
    const c = a.ctx!; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 3; f.connect(o);
    const osc = a.tone(f, t, 'sawtooth', 58 * r, 46 * r, 1.8, v * 0.9, 0.3);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 5; lg.gain.value = 5; lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t + 1.9);
    a.tone(f, t, 'square', 87 * r, 70 * r, 1.6, v * 0.25, 0.4);
    a.noise(o, t, 1.4, v * 0.25, 'bandpass', 180, 120, 2, true, 0.3);
  },
  // Crawler: chitter then a rising screech.
  crawlerCall: (a, o, t, v, r) => {
    for (let i = 0; i < 9; i++) a.noise(o, t + i * 0.045, 0.018, v * 0.5, 'bandpass', rnd(2000, 3200) * r, 2400, 8);
    const c = a.ctx!; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 4; f.connect(o);
    a.tone(f, t + 0.42, 'sawtooth', 520 * r, 1500 * r, 0.32, v * 0.5, 0.03);
  },
  // Shade: a breath that is not quite a voice.
  shadeCall: (a, o, t, v, r) => {
    a.noise(o, t, 2.0, v * 0.5, 'bandpass', 700 * r, 1300 * r, 5, false, 0.9);
    a.tone(o, t, 'sine', 207 * r, 196 * r, 2.0, v * 0.08, 0.8);
    a.tone(o, t, 'sine', 220 * r, 207 * r, 2.0, v * 0.08, 0.9);
  },
  caught: (a, o, t, v) => { [78, 83, 117, 124].forEach((f) => a.tone(o, t, 'sawtooth', f, f * 0.7, 1.6, v * 0.3, 0.01)); a.noise(o, t, 1.2, v * 0.7, 'lowpass', 1800, 100, 1); },
  win: (a, o, t, v) => { [523, 659, 784, 1046, 1318].forEach((f, i) => { a.tone(o, t + i * 0.13, 'triangle', f, f, 0.9, v * 0.2, 0.01); a.tone(o, t + i * 0.13, 'sine', f / 2, f / 2, 0.9, v * 0.12, 0.01); }); },
  lose: (a, o, t, v) => { [392, 370, 311, 233, 147].forEach((f, i) => a.tone(o, t + i * 0.22, 'triangle', f, f * 0.98, 1.1, v * 0.2, 0.02)); },
  ui: (a, o, t, v) => a.tone(o, t, 'sine', 660, 880, 0.06, v * 0.15),
  buy: (a, o, t, v) => { [880, 1108, 1318].forEach((f, i) => a.tone(o, t + i * 0.06, 'sine', f, f, 0.25, v * 0.18)); },
};

export const SOUND_NAMES = Object.keys(SOUNDS);
