/** All sound is synthesised with WebAudio. No audio files. */
type V3 = { x: number; y: number; z: number };

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  amb!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private jungleBed!: GainNode;
  private caveBed!: GainNode;
  private windBed!: GainNode;
  private rumbleBed!: GainNode;
  private crackleGain!: GainNode;
  private musicMode: 'day' | 'tense' | 'dark' | 'off' = 'off';
  private nextNote = 0;
  private noteIdx = 0;
  private nextBird = 0;
  private nextDrip = 0;
  private nextCrackle = 0;
  private hbNext = 0;
  volume = 0.8;
  musicVolume = 0.5;
  torchLit = false;

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = this.musicVolume * 0.5; this.music.connect(this.master);
    this.amb = c.createGain(); this.amb.connect(this.master);

    const len = c.sampleRate * 2;
    this.white = c.createBuffer(1, len, c.sampleRate);
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
    // Ambience beds
    this.jungleBed = this.bed(this.brown, 'bandpass', 900, 0.4, 0.0);
    const insects = this.bed(this.white, 'bandpass', 6200, 8, 0.0, this.jungleBed);
    const lfo = c.createOscillator(); lfo.frequency.value = 7; const lg = c.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg).connect(insects.gain); lfo.start();
    insects.gain.value = 0.25;
    this.caveBed = this.bed(this.brown, 'lowpass', 140, 1, 0.0);
    const drone = c.createOscillator(); drone.type = 'sine'; drone.frequency.value = 41;
    const dg = c.createGain(); dg.gain.value = 0.25; drone.connect(dg).connect(this.caveBed); drone.start();
    this.windBed = this.bed(this.brown, 'bandpass', 500, 0.7, 0.0);
    this.rumbleBed = this.bed(this.brown, 'lowpass', 70, 1, 0.0);
    this.crackleGain = c.createGain(); this.crackleGain.gain.value = 0; this.crackleGain.connect(this.sfx);
  }

  private bed(buf: AudioBuffer, type: BiquadFilterType, freq: number, q: number, gain: number, dest?: AudioNode): GainNode {
    const c = this.ctx!;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(dest ?? this.amb);
    src.start();
    return g;
  }

  setVolume(v: number, m: number) {
    this.volume = v; this.musicVolume = m;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    this.music.gain.setTargetAtTime(m * 0.5, this.ctx.currentTime, 0.05);
  }

  setListener(pos: V3, fwd: V3) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(pos.x, t); l.positionY.setValueAtTime(pos.y, t); l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t); l.forwardY.setValueAtTime(fwd.y, t); l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      (l as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(pos.x, pos.y, pos.z);
    }
  }

  /** Output node: positional if a position is given. */
  private out(pos?: V3, refDist = 4): AudioNode {
    if (!pos) return this.sfx;
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = refDist; p.rolloffFactor = 1.2; p.maxDistance = 80;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(this.sfx);
    return p;
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private noise(dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, pos?: V3, attack = 0.005, buf?: AudioBuffer, rate = 1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = buf ?? this.white; s.playbackRate.value = rate;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    this.env(g, t, attack, peak, dur);
    s.connect(f).connect(g).connect(this.out(pos));
    s.start(t, Math.random() * 1.5); s.stop(t + attack + dur + 0.05);
    return f;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, pos?: V3, attack = 0.005, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, attack, peak, dur);
    o.connect(g).connect(this.out(pos));
    o.start(t); o.stop(t + attack + dur + 0.05);
  }

  // ---------- one-shots ----------
  private tickTock = false;
  tick(vol: number) {
    if (!this.ctx) return;
    this.tickTock = !this.tickTock;
    const f = this.tickTock ? 2400 : 1800;
    this.noise(0.03, 'bandpass', f, 6, 0.6 * vol);
    this.tone('square', f * 0.5, f * 0.45, 0.04, 0.12 * vol);
    this.tone('sine', 120, 60, 0.08, 0.3 * vol);
  }
  rumble(strength = 1, dur = 3) {
    if (!this.ctx) return;
    this.noise(dur, 'lowpass', 90, 1, 1.2 * strength, undefined, 0.6, this.brown, 0.5);
    this.tone('sine', 38, 28, dur, 0.4 * strength, undefined, 0.5);
  }
  creak(pos?: V3) {
    if (!this.ctx) return;
    const f = this.noise(0.5, 'bandpass', 300, 12, 0.6, pos, 0.05);
    f?.frequency.exponentialRampToValueAtTime(700, this.ctx.currentTime + 0.45);
    this.tone('sawtooth', 140 + Math.random() * 60, 90, 0.45, 0.08, pos, 0.05);
  }
  snap(pos?: V3) {
    this.noise(0.12, 'highpass', 1200, 1, 1.0, pos);
    this.tone('triangle', 400, 80, 0.15, 0.4, pos);
  }
  grind(dur = 1.2, pos?: V3) {
    if (!this.ctx) return;
    const f = this.noise(dur, 'bandpass', 260, 3, 0.9, pos, 0.1, this.brown, 1.4);
    if (f) { const l = this.ctx.createOscillator(); l.frequency.value = 9; const lg = this.ctx.createGain(); lg.gain.value = 120; l.connect(lg).connect(f.frequency); l.start(); l.stop(this.ctx.currentTime + dur + 0.2); }
  }
  thud(pos?: V3, strength = 1) {
    this.tone('sine', 90, 35, 0.35, 0.8 * strength, pos);
    this.noise(0.2, 'lowpass', 400, 1, 0.5 * strength, pos, 0.002, this.brown);
  }
  footstep(surface: 'stone' | 'dirt' | 'wood' | 'water', loud: number) {
    if (surface === 'water') this.noise(0.25, 'bandpass', 900, 1.5, 0.35 * loud, undefined, 0.02);
    else if (surface === 'wood') { this.tone('triangle', 180, 120, 0.08, 0.2 * loud); this.noise(0.05, 'bandpass', 900, 2, 0.15 * loud); }
    else if (surface === 'dirt') this.noise(0.08, 'lowpass', 700, 1, 0.25 * loud, undefined, 0.004, this.brown);
    else this.noise(0.06, 'bandpass', 1800, 1.5, 0.22 * loud);
  }
  splash(pos?: V3) { this.noise(0.6, 'bandpass', 1100, 0.8, 0.8, pos, 0.01); }
  hiss() { this.noise(0.8, 'highpass', 3000, 0.5, 0.5, undefined, 0.01); }
  whoosh(pos?: V3) {
    if (!this.ctx) return;
    const f = this.noise(0.3, 'bandpass', 800, 4, 0.5, pos, 0.02);
    f?.frequency.exponentialRampToValueAtTime(3000, this.ctx.currentTime + 0.25);
  }
  dartFire(pos?: V3) { this.noise(0.05, 'highpass', 2000, 1, 0.6, pos); this.whoosh(pos); }
  pickup(value: number) {
    const base = value > 500 ? 660 : value > 200 ? 523 : 440;
    this.tone('triangle', base, base, 0.12, 0.25);
    this.tone('triangle', base * 1.5, base * 1.5, 0.2, 0.2, undefined, 0.005, 0.08);
  }
  denied() { this.tone('square', 160, 120, 0.15, 0.12); }
  hurt() { this.tone('sawtooth', 220, 90, 0.25, 0.3); this.noise(0.2, 'lowpass', 600, 1, 0.4); }
  ignite() { this.noise(0.5, 'bandpass', 2500, 0.7, 0.6, undefined, 0.05); this.tone('sine', 80, 160, 0.4, 0.2); }
  lever(pos?: V3) { this.tone('square', 90, 60, 0.15, 0.3, pos); this.grind(0.6, pos); }
  doorBoom() { this.thud(undefined, 2); this.rumble(1.4, 4); }
  wind(strength: number) { if (this.ctx) this.windBed.gain.setTargetAtTime(strength * 0.8, this.ctx.currentTime, 0.3); }

  guardianCall(kind: 'sentinel' | 'crawler' | 'shade', pos: V3) {
    if (!this.ctx) return;
    if (kind === 'sentinel') {
      this.tone('sawtooth', 70, 48, 1.4, 0.5, pos, 0.2);
      this.tone('sawtooth', 105, 70, 1.4, 0.25, pos, 0.25);
      this.noise(1.2, 'bandpass', 300, 2, 0.5, pos, 0.2, this.brown);
    } else if (kind === 'crawler') {
      for (let i = 0; i < 6; i++) this.tone('square', 900 + Math.random() * 600, 500, 0.05, 0.18, pos, 0.002, i * 0.07);
      this.noise(0.4, 'bandpass', 3500, 3, 0.3, pos);
    } else {
      const f = this.noise(1.6, 'bandpass', 1400, 5, 0.6, pos, 0.4);
      f?.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 1.6);
      this.tone('sine', 300, 200, 1.6, 0.1, pos, 0.5);
    }
  }
  guardianStep(kind: 'sentinel' | 'crawler' | 'shade', pos: V3) {
    if (kind === 'sentinel') this.thud(pos, 0.6);
    else if (kind === 'crawler') this.noise(0.04, 'highpass', 3000, 1, 0.25, pos);
  }

  // ---------- continuous ----------
  update(dt: number, s: { outdoor: number; underground: number; wind: number; dayness: number; danger: number; heartbeat: number; phase: string; torchLit: boolean }) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    this.jungleBed.gain.setTargetAtTime(0.35 * s.outdoor * (0.4 + 0.6 * s.dayness), t, 0.5);
    this.caveBed.gain.setTargetAtTime(0.5 * s.underground, t, 0.5);
    this.windBed.gain.setTargetAtTime(0.15 * s.outdoor + s.wind * 0.8, t, 0.3);
    const rumbleTarget = s.phase === 'critical' ? 0.35 : s.phase === 'dark' ? 0.6 : s.phase === 'urgent' ? 0.1 : 0;
    this.rumbleBed.gain.setTargetAtTime(rumbleTarget, t, 1);

    // Birds by day outside
    if (t > this.nextBird) {
      this.nextBird = t + 1.5 + Math.random() * 4;
      if (s.outdoor > 0.5 && s.dayness > 0.2) {
        const f = 1800 + Math.random() * 2200;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) this.tone('sine', f, f * (0.7 + Math.random() * 0.6), 0.09, 0.06 * s.outdoor, undefined, 0.01, i * 0.12);
      }
    }
    if (t > this.nextDrip) {
      this.nextDrip = t + 1 + Math.random() * 3;
      if (s.underground > 0.5) this.tone('sine', 1400 + Math.random() * 900, 600, 0.12, 0.05, undefined, 0.002);
    }
    // Torch crackle
    if (s.torchLit && t > this.nextCrackle) {
      this.nextCrackle = t + 0.04 + Math.random() * 0.25;
      this.noise(0.02 + Math.random() * 0.03, 'bandpass', 1500 + Math.random() * 3000, 2, 0.05 + Math.random() * 0.12);
      if (Math.random() < 0.08) this.noise(0.4, 'lowpass', 500, 1, 0.08, undefined, 0.1, this.brown);
    }
    // Heartbeat when guardians are near
    if (s.heartbeat > 0.05 && t > this.hbNext) {
      const rate = 0.5 + 0.9 * s.heartbeat; // beats per second
      this.hbNext = t + 1 / rate;
      this.tone('sine', 55, 40, 0.12, 0.7 * s.heartbeat);
      this.tone('sine', 50, 38, 0.12, 0.5 * s.heartbeat, undefined, 0.005, 0.22);
    }
    this.updateMusic(s.phase, s.underground);
  }

  private updateMusic(phase: string, underground: number) {
    if (!this.ctx) return;
    const mode = phase === 'critical' ? 'tense' : phase === 'dark' || phase === 'sealed' ? 'dark' : 'day';
    this.musicMode = mode;
    const t = this.ctx.currentTime;
    if (t < this.nextNote) return;
    // Pentatonic by day; phrygian + faster pulse when tense; low pulses in the dark.
    const day = [0, 2, 4, 7, 9, 12, 9, 7];
    const tense = [0, 1, 5, 7, 8, 7, 1, 0];
    const root = underground > 0.5 ? 110 : 147;
    let beat = 0.6;
    if (mode === 'day') {
      const st = day[this.noteIdx % day.length];
      if (Math.random() < 0.7) this.pluck(root * Math.pow(2, st / 12), 0.08);
      if (this.noteIdx % 8 === 0) this.pad(root / 2, 4.8, 0.06);
    } else if (mode === 'tense') {
      beat = 0.3;
      const st = tense[this.noteIdx % tense.length];
      this.pluck(root * Math.pow(2, st / 12), 0.1);
      if (this.noteIdx % 2 === 0) this.tone('sine', 55, 45, 0.2, 0.25);
      if (this.noteIdx % 16 === 0) this.pad(root / 2 * Math.pow(2, 1 / 12), 4.8, 0.08);
    } else {
      beat = 0.45;
      if (this.noteIdx % 2 === 0) this.tone('sine', 49, 40, 0.3, 0.35);
      if (this.noteIdx % 8 === 0) this.pad(73.4, 3.6, 0.1);
    }
    this.noteIdx++;
    this.nextNote = t + beat;
  }

  private pluck(f: number, vol: number) {
    const c = this.ctx!, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.01;
    const g = c.createGain(); this.env(g, t, 0.005, vol, 0.9);
    o.connect(g); o2.connect(g); g.connect(this.music);
    o.start(t); o2.start(t); o.stop(t + 1); o2.stop(t + 1);
  }
  private pad(f: number, dur: number, vol: number) {
    const c = this.ctx!, t = c.currentTime;
    const g = c.createGain(); this.env(g, t, dur * 0.4, vol, dur * 0.6);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    for (const m of [1, 1.5, 2.005]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * m;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.1);
    }
    lp.connect(g).connect(this.music);
  }
}
