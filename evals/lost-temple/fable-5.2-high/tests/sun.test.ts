import { describe, expect, it } from 'vitest';
import { DAY_LENGTH } from '../src/core/clock';
import { DARK_DEPTH, gnomonShadowDir, gradeAt, isNight, skyExposure, sunDirection, sunElevation } from '../src/core/sun';
import { isSunlit, sunPatch } from '../src/core/sunlight';
import { defaultSave, loadSave, writeSave, addScore, bankRun, SAVE_KEY, MAX_SCORES, type Score } from '../src/core/save';

describe('sun path', () => {
  it('rises in the east, peaks at noon, sets in the west', () => {
    const dawn = sunDirection(0), noon = sunDirection(DAY_LENGTH / 2), dusk = sunDirection(DAY_LENGTH);
    expect(dawn.x).toBeGreaterThan(0.98); expect(dawn.y).toBeGreaterThan(0.05); expect(dawn.y).toBeLessThan(0.2);
    expect(noon.y).toBeGreaterThan(0.85); expect(Math.abs(noon.x)).toBeLessThan(0.1);
    expect(dusk.x).toBeCloseTo(-1); expect(dusk.y).toBeCloseTo(0);
  });
  it('is a unit vector and goes below the horizon at night', () => {
    for (let t = 0; t < DAY_LENGTH * 1.3; t += 13) {
      const d = sunDirection(t);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
    }
    expect(sunElevation(DAY_LENGTH + 30)).toBeLessThan(0);
    expect(isNight(DAY_LENGTH + 1)).toBe(true);
    expect(isNight(DAY_LENGTH - 1)).toBe(false);
  });
  it('casts the gnomon shadow away from the sun, moving through the day', () => {
    const am = gnomonShadowDir(DAY_LENGTH * 0.2)!, pm = gnomonShadowDir(DAY_LENGTH * 0.8)!;
    expect(am.x).toBeLessThan(0);
    expect(pm.x).toBeGreaterThan(0);
    expect(gnomonShadowDir(DAY_LENGTH + 50)).toBeNull();
  });
});

describe('colour grading', () => {
  it('shifts from dawn to noon to a red-orange sunset to night', () => {
    const dawn = gradeAt(0), noon = gradeAt(DAY_LENGTH / 2), sunset = gradeAt(DAY_LENGTH * 0.96), night = gradeAt(DAY_LENGTH * 1.1);
    expect(noon.sunIntensity).toBeGreaterThan(dawn.sunIntensity);
    expect(noon.sunColor[2]).toBeGreaterThan(0.8);
    expect(sunset.sunColor[0]).toBeGreaterThan(sunset.sunColor[2] * 3);
    expect(sunset.tint[0]).toBeGreaterThan(sunset.tint[2]);
    expect(night.ambIntensity).toBeLessThan(noon.ambIntensity * 0.3);
    expect(night.tint[2]).toBeGreaterThan(night.tint[0]);
  });
  it('interpolates smoothly', () => {
    let prev = gradeAt(0).sunIntensity;
    for (let t = 1; t < DAY_LENGTH * 1.1; t += 1) {
      const v = gradeAt(t).sunIntensity;
      expect(Math.abs(v - prev)).toBeLessThan(0.1);
      prev = v;
    }
  });
});

describe('sky exposure by zone', () => {
  it('Zone C has exactly zero ambient and zero sun at any depth', () => {
    for (const y of [5, 0, -5, -10, -20]) expect(skyExposure('C', y)).toEqual({ ambient: 0, sun: 0 });
  });
  it('Zone A is fully exposed and Zone B is dimmer', () => {
    expect(skyExposure('A', 0)).toEqual({ ambient: 1, sun: 1 });
    expect(skyExposure('B', 0).ambient).toBeLessThan(1);
    expect(skyExposure('B', 0).sun).toBe(1);
  });
  it('light fades to nothing down the stair before the catacombs', () => {
    expect(skyExposure('B', -4).ambient).toBeLessThan(skyExposure('B', 0).ambient);
    expect(skyExposure('B', DARK_DEPTH)).toEqual({ ambient: 0, sun: 0 });
    expect(skyExposure('B', DARK_DEPTH - 1)).toEqual({ ambient: 0, sun: 0 });
  });
});

describe('sunlit lanes', () => {
  const slot = { x1: -2, z1: -20, x2: 2, z2: -10, y: 8 };
  it('is lit straight under an opening at noon-ish and dark elsewhere', () => {
    const up = { x: 0, y: 1, z: 0 };
    expect(isSunlit(0, 0, -15, [slot], up)).toBe(true);
    expect(isSunlit(6, 0, -15, [slot], up)).toBe(false);
  });
  it('moves the lit patch as the sun moves: morning west, afternoon east', () => {
    const am = sunPatch(slot, 0, sunDirection(DAY_LENGTH * 0.3))!, pm = sunPatch(slot, 0, sunDirection(DAY_LENGTH * 0.7))!;
    expect(am.x1).toBeLessThan(slot.x1);
    expect(pm.x1).toBeGreaterThan(slot.x1);
    const sun = sunDirection(DAY_LENGTH * 0.3);
    const cx = (am.x1 + am.x2) / 2, cz = (am.z1 + am.z2) / 2;
    expect(isSunlit(cx, 0, cz, [slot], sun)).toBe(true);
  });
  it('nothing is sunlit after sunset', () => {
    expect(isSunlit(0, 0, -15, [slot], sunDirection(DAY_LENGTH + 20))).toBe(false);
    expect(sunPatch(slot, 0, sunDirection(DAY_LENGTH + 20))).toBeNull();
  });
});

describe('save data', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
  const score = (value: number, time = 500): Score => ({ value, time, relics: 3, outcome: 'escaped', date: '2026-01-01' });
  it('round-trips through storage', () => {
    const s = mem(); const d = defaultSave();
    d.gold = 1234; d.upgrades.torch = 2; d.settings.fov = 90; bankRun(d, score(800));
    writeSave(s, d);
    const back = loadSave(s);
    expect(back.gold).toBe(1234 + 800);
    expect(back.upgrades.torch).toBe(2);
    expect(back.settings.fov).toBe(90);
    expect(back.scores.length).toBe(1);
  });
  it('survives missing or corrupt data', () => {
    const s = mem();
    expect(loadSave(s).gold).toBe(0);
    s.setItem(SAVE_KEY, '{not json');
    expect(loadSave(s).gold).toBe(0);
    s.setItem(SAVE_KEY, JSON.stringify({ gold: 'lots', settings: { fov: 9999 } }));
    const d = loadSave(s);
    expect(d.gold).toBe(0);
    expect(d.settings.fov).toBe(110);
    expect(loadSave(null).gold).toBe(0);
  });
  it('keeps the top ten escapes sorted by value', () => {
    const d = defaultSave();
    for (let i = 0; i < 15; i++) addScore(d, score(i * 100));
    expect(d.scores.length).toBe(MAX_SCORES);
    expect(d.scores[0].value).toBe(1400);
    expect(addScore(d, score(50))).toBe(-1);
    expect(addScore(d, score(99999))).toBe(0);
  });
  it('banks gold only for escapes', () => {
    const d = defaultSave();
    expect(bankRun(d, { ...score(900), outcome: 'caught' })).toBe(-1);
    expect(d.gold).toBe(0);
    expect(d.runs).toBe(1);
    bankRun(d, score(900));
    expect(d.gold).toBe(900);
  });
});
