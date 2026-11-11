/**
 * Environmental beds that crossfade with where the player is: jungle by day (insects, birds,
 * river), crickets at night, wind on the cliffs, room tone indoors, low air and drips in the
 * dungeon, plus distant rumbles that grow toward dusk.
 */
import * as THREE from 'three';
import { AudioEngine, startSrc } from './AudioEngine';
import type { Sfx } from './Sfx';

export type AmbEnv = 'jungle' | 'courtyard' | 'cliffs' | 'interior' | 'dungeon';

interface Bed {
  gain: GainNode;
  target: number;
}

export class Ambience {
  private beds = new Map<string, Bed>();
  private started = false;
  private nextBird = 2;
  private nextDrip = 1;
  private nextRumble = 20;
  private nextCreak = 8;
  env: AmbEnv = 'jungle';
  night = 0;
  dusk = 0;
  windStrength = 0;

  constructor(private a: AudioEngine, private sfx: Sfx) {}

  private start() {
    if (this.started || !this.a.ready || !this.a.ctx) return;
    this.started = true;
    const ctx = this.a.ctx;
    const t = ctx.currentTime;
    const mk = (name: string, build: (out: GainNode) => void) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.a.amb);
      build(g);
      this.beds.set(name, { gain: g, target: 0 });
    };
    mk('insects', (out) => {
      const s = this.a.noiseSource('white', true);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 5200;
      f.Q.value = 5;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 23;
      const lg = ctx.createGain();
      lg.gain.value = 0.45;
      lfo.connect(lg);
      lg.connect(am.gain);
      const slow = ctx.createOscillator();
      slow.frequency.value = 0.07;
      const sg = ctx.createGain();
      sg.gain.value = 0.2;
      slow.connect(sg);
      sg.connect(am.gain);
      s.connect(f);
      f.connect(am);
      am.connect(out);
      startSrc(s, t);
      lfo.start(t);
      slow.start(t);
    });
    mk('crickets', (out) => {
      const o = ctx.createOscillator();
      o.frequency.value = 4300;
      const am = ctx.createGain();
      am.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 7.5;
      const lg = ctx.createGain();
      lg.gain.value = 0.06;
      lfo.connect(lg);
      lg.connect(am.gain);
      o.connect(am);
      am.connect(out);
      o.start(t);
      lfo.start(t);
      const o2 = ctx.createOscillator();
      o2.frequency.value = 3900;
      const am2 = ctx.createGain();
      am2.gain.value = 0;
      const lfo2 = ctx.createOscillator();
      lfo2.type = 'square';
      lfo2.frequency.value = 5.3;
      const lg2 = ctx.createGain();
      lg2.gain.value = 0.04;
      lfo2.connect(lg2);
      lg2.connect(am2.gain);
      o2.connect(am2);
      am2.connect(out);
      o2.start(t);
      lfo2.start(t);
    });
    mk('river', (out) => {
      const s = this.a.noiseSource('pink', true);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      s.connect(f);
      f.connect(out);
      startSrc(s, t);
    });
    mk('wind', (out) => {
      const s = this.a.noiseSource('pink', true);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 420;
      f.Q.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.11;
      const lg = ctx.createGain();
      lg.gain.value = 260;
      lfo.connect(lg);
      lg.connect(f.frequency);
      s.connect(f);
      f.connect(out);
      startSrc(s, t);
      lfo.start(t);
    });
    mk('room', (out) => {
      const s = this.a.noiseSource('brown', true);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 160;
      s.connect(f);
      f.connect(out);
      startSrc(s, t);
    });
    mk('deep', (out) => {
      const s = this.a.noiseSource('brown', true);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 85;
      const o = ctx.createOscillator();
      o.frequency.value = 41;
      const og = ctx.createGain();
      og.gain.value = 0.18;
      o.connect(og);
      og.connect(out);
      s.connect(f);
      f.connect(out);
      startSrc(s, t);
      o.start(t);
    });
  }

  update(dt: number, listener: THREE.Vector3, riverDist: number) {
    this.start();
    if (!this.started || !this.a.ctx) return;
    const ctx = this.a.ctx;
    const day = 1 - this.night;
    const e = this.env;
    const outdoors = e === 'jungle' || e === 'courtyard' || e === 'cliffs';
    const set = (k: string, v: number) => {
      const b = this.beds.get(k);
      if (b) b.target = v;
    };
    set('insects', outdoors ? (e === 'jungle' ? 0.16 : e === 'courtyard' ? 0.09 : 0.03) * day : 0);
    set('crickets', outdoors ? (e === 'cliffs' ? 0.4 : 1) * this.night : 0);
    set('river', outdoors ? Math.max(0, 1 - riverDist / 70) * 0.5 : 0);
    set('wind', e === 'cliffs' ? 0.35 + this.windStrength * 0.6 : outdoors ? 0.05 : e === 'interior' ? 0.04 : 0);
    set('room', e === 'interior' ? 0.25 : 0);
    set('deep', e === 'dungeon' ? 0.5 : e === 'interior' ? 0.08 : 0);
    for (const b of this.beds.values()) b.gain.gain.setTargetAtTime(b.target, ctx.currentTime, 0.8);

    // occasional events
    this.nextBird -= dt;
    this.nextDrip -= dt;
    this.nextRumble -= dt;
    this.nextCreak -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = 2 + Math.random() * 5;
      if (outdoors && day > 0.5) {
        const p = listener.clone().add(new THREE.Vector3((Math.random() - 0.5) * 50, 6 + Math.random() * 10, (Math.random() - 0.5) * 50));
        this.sfx.play('birds', p, e === 'jungle' ? 0.9 : 0.5);
      }
    }
    if (this.nextDrip <= 0) {
      this.nextDrip = 0.8 + Math.random() * 3;
      if (e === 'dungeon' || (e === 'interior' && Math.random() < 0.3)) {
        const p = listener.clone().add(new THREE.Vector3((Math.random() - 0.5) * 16, 2, (Math.random() - 0.5) * 16));
        this.sfx.play('drip', p, 0.7);
      }
    }
    if (this.nextCreak <= 0) {
      this.nextCreak = 6 + Math.random() * 10;
      if (e === 'interior' || e === 'dungeon') {
        const p = listener.clone().add(new THREE.Vector3((Math.random() - 0.5) * 20, 4, (Math.random() - 0.5) * 20));
        this.sfx.play(Math.random() < 0.5 ? 'crumble' : 'woodCreak', p, 0.25, 0.6);
      }
    }
    if (this.nextRumble <= 0) {
      this.nextRumble = 30 - this.dusk * 22 + Math.random() * 15;
      if (this.dusk > 0.1 || e === 'dungeon') {
        const p = listener.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, -10, (Math.random() - 0.5) * 60));
        this.sfx.play('rumble', p, 0.4 + this.dusk * 0.6);
      }
    }
  }

  stopAll() {
    if (!this.a.ctx) return;
    for (const b of this.beds.values()) {
      b.target = 0;
      b.gain.gain.setTargetAtTime(0, this.a.ctx.currentTime, 0.3);
    }
  }
}
