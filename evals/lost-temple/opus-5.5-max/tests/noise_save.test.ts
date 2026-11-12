import { describe, it, expect } from 'vitest';
import { footstepLoudness, hears, CeilingStrain, landingLoudness } from '../src/logic/noise';
import { parseSave, defaultSave, insertHighScore, serializeSave, GhostRecorder, samplePose } from '../src/logic/save';
import { loadSpeedFactor, staminaDrainMultiplier, Stamina, jumpVelocity } from '../src/logic/playerStats';

describe('noise', () => {
  it('sprinting is loud, crouching is nearly silent', () => {
    expect(footstepLoudness('sprint', 0)).toBeGreaterThan(footstepLoudness('walk', 0));
    expect(footstepLoudness('crouch', 0)).toBeLessThan(0.1);
    expect(footstepLoudness('walk', 1)).toBeGreaterThan(footstepLoudness('walk', 0));
  });
  it('hearing range scales with loudness', () => {
    const ev = { x: 10, y: 0, z: 0, loudness: 0.5, source: 'footstep' as const, byPlayer: true };
    expect(hears(ev, 0, 0, 0, 28)).toBe(true);
    expect(hears({ ...ev, loudness: 0.05 }, 0, 0, 0, 28)).toBe(false);
    expect(landingLoudness(16)).toBeGreaterThan(landingLoudness(4));
  });
  it('noise strains the ceiling until a section warns, then collapses', () => {
    const c = new CeilingStrain([{ x: 0, z: 0, threshold: 2 }, { x: 40, z: 0, threshold: 2 }]);
    c.addNoise({ x: 1, z: 0, loudness: 1.5 });
    expect(c.update(0.1).warnings.length).toBe(0);
    c.addNoise({ x: 1, z: 0, loudness: 1.5 });
    const u = c.update(0.1);
    expect(u.warnings.map((s) => s.id)).toEqual([0]);
    const v = c.update(1.1);
    expect(v.collapses.map((s) => s.id)).toEqual([0]);
    expect(c.sections[1].state).toBe('stable'); // far section untouched
  });
  it('strain decays over time', () => {
    const c = new CeilingStrain([{ x: 0, z: 0, threshold: 2 }]);
    c.addNoise({ x: 0, z: 0, loudness: 1.5 });
    c.update(20);
    expect(c.sections[0].strain).toBeLessThan(1);
  });
});

describe('player stats', () => {
  it('weight slows you and drains stamina faster', () => {
    expect(loadSpeedFactor(0)).toBe(1);
    expect(loadSpeedFactor(1)).toBeCloseTo(0.55);
    expect(loadSpeedFactor(0.5)).toBeLessThan(1);
    expect(staminaDrainMultiplier(1)).toBeCloseTo(2.2);
    expect(jumpVelocity(1)).toBeLessThan(jumpVelocity(0));
  });
  it('stamina drains, exhausts, and recovers after a delay', () => {
    const s = new Stamina(100);
    s.drain(50, 2);
    expect(s.value).toBe(0);
    expect(s.canSprint()).toBe(false);
    s.update(0.5, 0);
    expect(s.value).toBe(0);
    s.update(2, 0);
    expect(s.value).toBeGreaterThan(25);
    expect(s.canSprint()).toBe(true);
  });
});

describe('save data', () => {
  it('falls back to defaults on garbage', () => {
    expect(parseSave('not json')).toEqual(defaultSave());
    expect(parseSave(null)).toEqual(defaultSave());
    expect(parseSave('42')).toEqual(defaultSave());
  });
  it('round-trips and clamps values', () => {
    const s = defaultSave();
    s.money = 1234;
    s.upgrades.satchel = 2;
    s.settings.fov = 500;
    const back = parseSave(serializeSave(s));
    expect(back.money).toBe(1234);
    expect(back.upgrades.satchel).toBe(2);
    expect(back.settings.fov).toBe(110);
  });
  it('keeps the high-score table sorted and capped', () => {
    let list: any[] = [];
    for (let i = 0; i < 12; i++) list = insertHighScore(list, { haul: i * 100, status: 'escaped', time: 600, relics: i, date: '' }).list;
    expect(list.length).toBe(10);
    expect(list[0].haul).toBe(1100);
    const r = insertHighScore(list, { haul: 50, status: 'caught', time: 1, relics: 0, date: '' });
    expect(r.rank).toBe(-1);
  });
  it('records and replays a ghost track', () => {
    const g = new GhostRecorder(0.2);
    for (let i = 0; i < 50; i++) g.update(0.1, i * 0.5, 1, 0, 0.1);
    const t = g.track(500);
    const pose = samplePose(t, 1.0)!;
    expect(pose.x).toBeGreaterThan(3);
    expect(pose.y).toBeCloseTo(1);
    const back = parseSave(serializeSave({ ...defaultSave(), ghost: t }));
    expect(back.ghost?.data.length).toBe(t.data.length);
  });
});
