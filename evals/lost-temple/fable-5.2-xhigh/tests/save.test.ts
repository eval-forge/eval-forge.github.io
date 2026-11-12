import { describe, expect, it } from 'vitest';
import { GhostRecorder, ghostDuration, sampleGhost } from '../src/core/ghost';
import { loudestHeard, loudnessAt, noiseRadius, type Noise } from '../src/core/noise';
import { MAX_SCORES, MetaStore, SAVE_KEY, compareScores, parseSave, type ScoreEntry, type StorageLike } from '../src/core/save';

class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

const entry = (haul: number, outcome: ScoreEntry['outcome'] = 'escaped', time = 300): ScoreEntry => ({
  haul, carried: haul, time, relics: 3, outcome, date: '2026-11-11', deepest: 'Broken Halls',
});

describe('meta save', () => {
  it('starts empty with base gear', () => {
    const m = new MetaStore(new FakeStorage());
    expect(m.data.coins).toBe(0);
    expect(m.data.scores).toEqual([]);
    expect(m.data.gear.torch).toBe(0);
  });

  it('banks coins only for an escape', () => {
    const m = new MetaStore(new FakeStorage());
    m.recordRun(entry(1200));
    expect(m.data.coins).toBe(1200);
    m.recordRun({ ...entry(0, 'caught'), carried: 5000 });
    expect(m.data.coins).toBe(1200);
    expect(m.data.runs).toBe(2);
    expect(m.data.escapes).toBe(1);
  });

  it('persists across reloads', () => {
    const s = new FakeStorage();
    const a = new MetaStore(s);
    a.recordRun(entry(900));
    a.buy('fuel');
    a.updateSettings({ fov: 95, quality: 'low' });
    const b = new MetaStore(s);
    expect(b.data.coins).toBe(600);
    expect(b.data.gear.fuel).toBe(1);
    expect(b.data.settings.fov).toBe(95);
    expect(b.data.settings.quality).toBe('low');
    expect(b.data.scores.length).toBe(1);
    expect(s.map.has(SAVE_KEY)).toBe(true);
  });

  it('keeps a sorted top-10 table', () => {
    const m = new MetaStore(new FakeStorage());
    for (let i = 0; i < 14; i++) m.recordRun(entry(i * 100));
    expect(m.data.scores.length).toBe(MAX_SCORES);
    expect(m.data.scores[0].haul).toBe(1300);
    for (let i = 1; i < m.data.scores.length; i++) expect(compareScores(m.data.scores[i - 1], m.data.scores[i])).toBeLessThanOrEqual(0);
  });

  it('reports the rank of a new run, or -1 if it missed the table', () => {
    const m = new MetaStore(new FakeStorage());
    for (let i = 1; i <= 10; i++) m.recordRun(entry(i * 1000));
    expect(m.recordRun(entry(20000))).toBe(0);
    expect(m.recordRun(entry(1))).toBe(-1);
  });

  it('ties break on faster time', () => {
    expect(compareScores(entry(500, 'escaped', 200), entry(500, 'escaped', 400))).toBeLessThan(0);
  });

  it('cannot buy what it cannot afford', () => {
    const m = new MetaStore(new FakeStorage());
    expect(m.buy('satchel')).toBe(false);
    m.recordRun(entry(500));
    expect(m.buy('satchel')).toBe(true);
    expect(m.data.coins).toBe(0);
  });

  it('survives corrupt or hostile storage', () => {
    expect(parseSave('not json').coins).toBe(0);
    expect(parseSave('{"v":7}').coins).toBe(0);
    const p = parseSave(JSON.stringify({ v: 1, coins: -50, gear: { torch: 99, fuel: 'x' }, settings: { fov: 9999, quality: 'ultra' } }));
    expect(p.coins).toBe(0);
    expect(p.gear.torch).toBe(5);
    expect(p.gear.fuel).toBe(0);
    expect(p.settings.fov).toBe(110);
    expect(p.settings.quality).toBe('medium');
  });

  it('works with no storage at all', () => {
    const m = new MetaStore(null);
    m.recordRun(entry(100));
    expect(m.data.coins).toBe(100);
  });

  it('stores the ghost of the best escape', () => {
    const m = new MetaStore(new FakeStorage());
    m.recordRun(entry(500), { step: 0.5, samples: [0, 0, 0, 100, 0, 0], haul: 500 });
    expect(m.data.ghost?.haul).toBe(500);
    m.recordRun(entry(200), { step: 0.5, samples: [0, 0, 0], haul: 200 });
    expect(m.data.ghost?.haul).toBe(500);
    m.recordRun(entry(900), { step: 0.5, samples: [0, 0, 0], haul: 900 });
    expect(m.data.ghost?.haul).toBe(900);
  });
});

describe('ghost recording', () => {
  it('samples on a fixed step and plays back interpolated', () => {
    const rec = new GhostRecorder(0.5);
    for (let i = 0; i <= 600; i++) rec.update(1 / 60, { x: i / 60, y: 1, z: 0 });
    const data = rec.finish(100);
    expect(rec.length).toBeGreaterThanOrEqual(20);
    expect(ghostDuration(data)).toBeGreaterThan(9);
    const p = sampleGhost(data, 4.25)!;
    expect(p.x).toBeCloseTo(4.25, 1);
    expect(p.y).toBeCloseTo(1, 2);
    expect(sampleGhost(data, 1000)).toBeNull();
    expect(sampleGhost(data, -1)).toBeNull();
  });
});

describe('noise', () => {
  const at = (x: number, radius: number): Noise => ({ pos: { x, y: 0, z: 0 }, radius, kind: 'impact', t: 0 });

  it('is loudest at the source and silent past its radius', () => {
    const n = at(0, 10);
    expect(loudnessAt(n, { x: 0, y: 0, z: 0 })).toBe(1);
    expect(loudnessAt(n, { x: 5, y: 0, z: 0 })).toBeCloseTo(0.5, 6);
    expect(loudnessAt(n, { x: 10, y: 0, z: 0 })).toBe(0);
  });

  it('keen ears hear further', () => {
    const n = at(0, 10);
    expect(loudnessAt(n, { x: 11, y: 0, z: 0 }, 1.25)).toBeGreaterThan(0);
    expect(loudnessAt(n, { x: 6, y: 0, z: 0 }, 0.45)).toBe(0);
  });

  it('sprinting is far louder than walking, crouching is nearly silent', () => {
    expect(noiseRadius('stepSprint')).toBeGreaterThan(noiseRadius('stepWalk') * 2);
    expect(noiseRadius('stepCrouch')).toBeLessThan(noiseRadius('stepWalk') / 3);
  });

  it('soft soles quieten footsteps but not thrown rocks', () => {
    expect(noiseRadius('stepWalk', 1, 0.6)).toBeCloseTo(noiseRadius('stepWalk') * 0.6, 6);
    expect(noiseRadius('impact', 1, 0.6)).toBe(noiseRadius('impact'));
  });

  it('picks the loudest audible noise', () => {
    const heard = loudestHeard([at(30, 10), at(4, 10), at(8, 10)], { x: 0, y: 0, z: 0 });
    expect(heard?.noise.pos.x).toBe(4);
    expect(loudestHeard([at(30, 10)], { x: 0, y: 0, z: 0 })).toBeNull();
  });
});
