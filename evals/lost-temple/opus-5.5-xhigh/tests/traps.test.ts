import { describe, it, expect } from 'vitest';
import {
  PressurePlate, plateLoad, pedestalTriggered, PedestalTrap, FailTimer, DartLauncher, dartHitsPlayer,
  InstabilityMeter, SunStone, sundialGlyph, sundialGlyphAngle, fallDamage, DART_HEIGHT,
} from '../src/logic/traps';
import { sunAt, DAY_SECONDS } from '../src/logic/clock';

describe('pressure plates', () => {
  it('sums loads and fires on threshold', () => {
    expect(plateLoad([10, 20, -5])).toBe(30);
    const p = new PressurePlate(50);
    expect(p.update(30)).toBe(null);
    expect(p.update(55)).toBe('pressed');
    expect(p.update(60)).toBe(null);
    expect(p.update(46)).toBe(null); // hysteresis
    expect(p.update(40)).toBe('released');
  });
  it('latching plates stay down', () => {
    const p = new PressurePlate(250, true);
    expect(p.update(400)).toBe('pressed');
    expect(p.update(0)).toBe(null);
    expect(p.pressed).toBe(true);
  });
  it('the player alone (75 kg) cannot hold the door plate but the stone block can', () => {
    const door = new PressurePlate(250, true);
    expect(door.update(75 + 18)).toBe(null);
    expect(door.update(400)).toBe('pressed');
  });
});

describe('weight-swap pedestals', () => {
  it('fires when the relic is simply lifted', () => {
    expect(pedestalTriggered(4, 0)).toBe(true);
    const t = new PedestalTrap(4);
    expect(t.onRelicLifted(0)).toBe('fire');
    expect(t.onRelicLifted(0)).toBe('safe'); // only once
  });
  it('a swap within 15% is safe and disarms it', () => {
    expect(pedestalTriggered(4, 3.5)).toBe(false);
    expect(pedestalTriggered(4, 4.6)).toBe(false);
    expect(pedestalTriggered(4, 3.3)).toBe(true);
    expect(pedestalTriggered(4, 4.8)).toBe(true);
    const t = new PedestalTrap(7.5);
    expect(t.onRelicLifted(7.0)).toBe('safe');
    expect(t.armed).toBe(false);
  });
});

describe('failing planks and tiles', () => {
  it('crack on touch and fail after the delay even if you leave', () => {
    const f = new FailTimer(0.7);
    expect(f.update(1)).toBe(false); // untouched
    expect(f.touch()).toBe(true);
    expect(f.touch()).toBe(false);
    expect(f.update(0.5)).toBe(false);
    expect(f.progress).toBeCloseTo(0.5 / 0.7);
    expect(f.update(0.25)).toBe(true);
    expect(f.state).toBe('failed');
    expect(f.update(1)).toBe(false);
  });
});

describe('darts', () => {
  it('fire in volleys with a reload', () => {
    const l = new DartLauncher(1.4, 3);
    expect(l.trigger()).toBe(3);
    expect(l.trigger()).toBe(0);
    l.update(1.5);
    expect(l.trigger()).toBe(3);
  });
  it('fly over a crouching player and hit a standing one', () => {
    expect(dartHitsPlayer(DART_HEIGHT, 0, 1.8)).toBe(true);
    expect(dartHitsPlayer(DART_HEIGHT, 0, 1.15)).toBe(false);
  });
});

describe('sanctum instability', () => {
  it('quiet noises never drop debris, loud ones on a shaken ceiling do', () => {
    const m = new InstabilityMeter();
    let rocks = 0;
    for (let i = 0; i < 20; i++) rocks += m.add(0.1);
    expect(rocks).toBe(0);
    const m2 = new InstabilityMeter();
    let r2 = 0;
    for (let i = 0; i < 8; i++) r2 += m2.add(0.8);
    expect(r2).toBeGreaterThan(0);
  });
  it('decays over time', () => {
    const m = new InstabilityMeter(4);
    m.add(1);
    const v = m.value;
    m.update(2);
    expect(m.value).toBeCloseTo(v - 8);
  });
});

describe('sun-stones', () => {
  it('solidify in light and fade with a grace period in shade', () => {
    const s = new SunStone(0.25, 1.0);
    expect(s.update(0.1, true)).toBe('phantom');
    expect(s.update(0.2, true)).toBe('solid');
    expect(s.update(0.1, false)).toBe('fading');
    expect(s.solid).toBe(true);
    expect(s.update(0.5, false)).toBe('fading');
    expect(s.update(0.6, false)).toBe('phantom');
    expect(s.solid).toBe(false);
  });
});

describe('sundial', () => {
  it('shadow points west at dawn, north at noon, east at dusk', () => {
    expect(sundialGlyph(sunAt(0).dir)).toBe(0);
    const noon = sundialGlyph(sunAt(DAY_SECONDS / 2).dir);
    expect(noon === 5 || noon === 6).toBe(true);
    expect(sundialGlyph(sunAt(DAY_SECONDS * 0.995).dir)).toBe(11);
    expect(sundialGlyph([0, -1, 0])).toBe(-1);
  });
  it('glyph moves monotonically through the day', () => {
    let prev = -1;
    for (let t = 0; t < DAY_SECONDS; t += 10) {
      const g = sundialGlyph(sunAt(t).dir);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
  it('glyph angles span the northern half of the dial', () => {
    expect(sundialGlyphAngle(0)).toBeGreaterThan(Math.PI);
    expect(sundialGlyphAngle(11)).toBeLessThan(2 * Math.PI);
  });
});

describe('fall damage', () => {
  it('is zero for short drops and grows with speed', () => {
    expect(fallDamage(8)).toBe(0);
    expect(fallDamage(16)).toBeGreaterThan(fallDamage(13));
  });
});
