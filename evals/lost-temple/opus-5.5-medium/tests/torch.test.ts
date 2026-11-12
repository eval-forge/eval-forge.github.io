import { describe, it, expect } from 'vitest';
import { torchStats, torchRadius, burn, extinguishCheck, SHRINK_START } from '../src/logic/torch';

describe('torch fuel and radius curve', () => {
  const s = torchStats(0);
  it('keeps full radius until fuel drops below the shrink threshold', () => {
    expect(torchRadius(s.capacity, s)).toBe(s.maxRadius);
    expect(torchRadius(s.capacity * SHRINK_START, s)).toBe(s.maxRadius);
  });
  it('shrinks monotonically to the minimum, then goes out at zero', () => {
    let prev = Infinity;
    for (let f = s.capacity * SHRINK_START; f > 0; f -= 1) {
      const r = torchRadius(f, s);
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      expect(r).toBeGreaterThanOrEqual(s.minRadius);
      prev = r;
    }
    expect(torchRadius(0, s)).toBe(0);
  });
  it('burns only while lit and never below zero', () => {
    expect(burn(10, 1, s, false)).toBe(10);
    expect(burn(10, 1, s, true)).toBeCloseTo(10 - s.burnRate);
    expect(burn(0.5, 5, s, true)).toBe(0);
  });
  it('upgrades give bigger, longer-lasting torches', () => {
    const t3 = torchStats(3);
    expect(t3.maxRadius).toBeGreaterThan(s.maxRadius);
    expect(t3.capacity / t3.burnRate).toBeGreaterThan(s.capacity / s.burnRate);
  });
  it('is blown out by water, hard falls and strong wind', () => {
    const base = { waterDepthAtTorch: 0, windGust: 0, fallSpeed: 0, crouchingInWater: false };
    expect(extinguishCheck(base, 0)).toBeNull();
    expect(extinguishCheck({ ...base, waterDepthAtTorch: 0.1 }, 0.9)).toBe('water');
    expect(extinguishCheck({ ...base, fallSpeed: 12 }, 0.9)).toBe('fall');
    expect(extinguishCheck({ ...base, fallSpeed: 5 }, 0.0)).toBeNull();
    expect(extinguishCheck({ ...base, windGust: 1 }, 0.1)).toBe('wind');
    expect(extinguishCheck({ ...base, windGust: 0.5 }, 0.0)).toBeNull();
  });
});
