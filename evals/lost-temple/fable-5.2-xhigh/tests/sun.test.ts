import { describe, expect, it } from 'vitest';
import {
  SUNDIAL_TOLERANCE, celestial, shadowAzimuth, shadowLength, skyLook, sunDirection, sunElevation, sundialAligned,
  sundialReadable,
} from '../src/core/sun';

describe('sun', () => {
  it('rises in the east, peaks leaning south, sets in the west', () => {
    const dawn = sunDirection(0);
    const noon = sunDirection(0.5);
    const dusk = sunDirection(1);
    expect(dawn.x).toBeCloseTo(1, 5);
    expect(dawn.y).toBeCloseTo(0, 5);
    expect(noon.x).toBeCloseTo(0, 5);
    expect(noon.y).toBeGreaterThan(0.85);
    expect(noon.z).toBeGreaterThan(0.4);
    expect(dusk.x).toBeCloseTo(-1, 5);
  });

  it('is always a unit vector', () => {
    for (let f = 0; f <= 1; f += 0.05) {
      const d = sunDirection(f);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
    }
  });

  it('elevation is symmetric about noon and highest there', () => {
    expect(sunElevation(0.3)).toBeCloseTo(sunElevation(0.7), 6);
    expect(sunElevation(0.5)).toBeGreaterThan(sunElevation(0.4));
    expect((sunElevation(0.5) * 180) / Math.PI).toBeCloseTo(62, 0);
  });

  it('shadows point away from the sun and sweep west to east through the day', () => {
    // Morning sun in the east: shadow points west (-X) => azimuth near -PI/2.
    expect(shadowAzimuth(0.05)).toBeLessThan(-1.2);
    // Noon: sun to the south, shadow points north (-Z) => |azimuth| near PI.
    expect(Math.abs(shadowAzimuth(0.5))).toBeGreaterThan(3.1);
    // Evening: shadow points east (+X).
    expect(shadowAzimuth(0.95)).toBeGreaterThan(1.2);
  });

  it('shadows are shortest at noon and unbounded at the horizon', () => {
    expect(shadowLength(0.5, 3)).toBeLessThan(shadowLength(0.2, 3));
    expect(shadowLength(0, 3)).toBe(Infinity);
    expect(shadowLength(1, 3)).toBe(Infinity);
  });

  it('switches to the moon after dark', () => {
    expect(celestial(0.5).isMoon).toBe(false);
    expect(celestial(0.5).sunUp).toBe(true);
    const night = celestial(1.05);
    expect(night.isMoon).toBe(true);
    expect(night.sunUp).toBe(false);
    expect(night.dir.y).toBeGreaterThan(0.5);
  });
});

describe('sundial puzzle', () => {
  it('is solved only when the ring matches the real shadow', () => {
    const f = 0.3;
    const a = shadowAzimuth(f);
    expect(sundialAligned(a, f)).toBe(true);
    expect(sundialAligned(a + SUNDIAL_TOLERANCE * 0.9, f)).toBe(true);
    expect(sundialAligned(a + SUNDIAL_TOLERANCE * 1.5, f)).toBe(false);
    expect(sundialAligned(a + Math.PI, f)).toBe(false);
  });

  it('wraps angles', () => {
    const f = 0.5;
    const a = shadowAzimuth(f);
    expect(sundialAligned(a + Math.PI * 2, f)).toBe(true);
    expect(sundialAligned(a - Math.PI * 2, f)).toBe(true);
  });

  it('the answer drifts as the sun moves', () => {
    const early = shadowAzimuth(0.25);
    expect(sundialAligned(early, 0.25)).toBe(true);
    expect(sundialAligned(early, 0.45)).toBe(false);
  });

  it('cannot be read at first light, at last light, or at night', () => {
    expect(sundialReadable(0.005)).toBe(false);
    expect(sundialReadable(0.995)).toBe(false);
    expect(sundialReadable(1.1)).toBe(false);
    expect(sundialReadable(0.2)).toBe(true);
    expect(sundialAligned(shadowAzimuth(0.999), 0.999)).toBe(false);
    expect(sundialAligned(0, 1.2)).toBe(false);
  });
});

describe('colour script', () => {
  const lum = (c: { r: number; g: number; b: number }): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

  it('is brightest at noon and darkest at night', () => {
    const noon = skyLook(0.5);
    const dawn = skyLook(0.0);
    const night = skyLook(1.1);
    expect(noon.sunIntensity).toBeGreaterThan(dawn.sunIntensity);
    expect(noon.sunIntensity).toBeGreaterThan(night.sunIntensity * 5);
    expect(noon.hemiIntensity).toBeGreaterThan(night.hemiIntensity * 4);
    expect(lum(noon.skyTop)).toBeGreaterThan(lum(night.skyTop) * 5);
  });

  it('grades sunset red-orange and night cold', () => {
    const sunset = skyLook(0.93);
    expect(sunset.tint.r).toBeGreaterThan(sunset.tint.g);
    expect(sunset.tint.g).toBeGreaterThan(sunset.tint.b);
    expect(sunset.sunColor.r).toBeGreaterThan(sunset.sunColor.b * 2);
    const night = skyLook(1.2);
    expect(night.tint.b).toBeGreaterThan(night.tint.r);
    expect(night.saturation).toBeLessThan(skyLook(0.5).saturation);
  });

  it('interpolates continuously', () => {
    let prev = skyLook(0);
    for (let f = 0.01; f <= 1.1; f += 0.01) {
      const cur = skyLook(f);
      expect(Math.abs(cur.sunIntensity - prev.sunIntensity)).toBeLessThan(0.45);
      expect(Math.abs(cur.tint.r - prev.tint.r)).toBeLessThan(0.08);
      prev = cur;
    }
  });

  it('shows stars only around night', () => {
    expect(skyLook(0.5).stars).toBe(0);
    expect(skyLook(1.2).stars).toBe(1);
  });
});
