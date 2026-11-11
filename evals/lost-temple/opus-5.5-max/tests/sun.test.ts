import { describe, it, expect } from 'vitest';
import { sunDirection, sunElevation, SUNSET_ELAPSED, gnomonShadowAngle, sundialAligned, sundialSolutionStep, gradeAt, sunIntensity } from '../src/logic/sun';
import { DAY_LENGTH } from '../src/logic/countdown';

describe('sun path', () => {
  it('rises in the east, peaks in the south, sets in the west 60 s before darkness', () => {
    const dawn = sunDirection(0);
    expect(dawn[0]).toBeGreaterThan(0.9);
    expect(sunElevation(0)).toBeGreaterThan(0);
    const noon = sunDirection(SUNSET_ELAPSED / 2);
    expect(noon[1]).toBeGreaterThan(0.85);
    expect(noon[2]).toBeGreaterThan(0);
    expect(sunElevation(SUNSET_ELAPSED)).toBeCloseTo(0, 5);
    expect(DAY_LENGTH - SUNSET_ELAPSED).toBe(60);
    expect(sunElevation(DAY_LENGTH)).toBeLessThan(0);
  });
  it('is a unit vector', () => {
    for (const t of [0, 100, 400, 779]) {
      const d = sunDirection(t);
      expect(Math.hypot(...d)).toBeCloseTo(1, 6);
    }
  });
  it('sunlight fades out at night', () => {
    expect(sunIntensity(sunElevation(DAY_LENGTH))).toBe(0);
    expect(sunIntensity(sunElevation(300))).toBeGreaterThan(2);
  });
});

describe('sundial', () => {
  it('shadow points away from the sun', () => {
    const a = gnomonShadowAngle(sunDirection(200))!;
    const d = sunDirection(200);
    expect(Math.cos(a) * d[0] + Math.sin(a) * d[2]).toBeLessThan(0);
  });
  it('has no shadow when the sun is down', () => {
    expect(gnomonShadowAngle(sunDirection(DAY_LENGTH + 10))).toBeNull();
    expect(sundialAligned(0, sunDirection(DAY_LENGTH + 10))).toBe(false);
  });
  it('the solving step changes as the sun moves and always aligns', () => {
    const steps = new Set<number>();
    for (let t = 30; t < SUNSET_ELAPSED - 30; t += 30) {
      const d = sunDirection(t);
      const k = sundialSolutionStep(d)!;
      expect(sundialAligned(k, d)).toBe(true);
      steps.add(k);
    }
    expect(steps.size).toBeGreaterThanOrEqual(5);
  });
  it('only one or two ring steps align at a time', () => {
    const d = sunDirection(250);
    let n = 0;
    for (let k = 0; k < 12; k++) if (sundialAligned(k, d)) n++;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(2);
  });
});

describe('grading', () => {
  it('sunset is warmer than noon and night is darker and bluer', () => {
    const noon = gradeAt(0.5);
    const sunset = gradeAt(0.9);
    const night = gradeAt(1.05);
    expect(sunset.highlightTint[0] - sunset.highlightTint[2]).toBeGreaterThan(noon.highlightTint[0] - noon.highlightTint[2]);
    expect(night.exposure).toBeLessThan(noon.exposure);
    expect(night.highlightTint[2]).toBeGreaterThan(night.highlightTint[0]);
  });
});
