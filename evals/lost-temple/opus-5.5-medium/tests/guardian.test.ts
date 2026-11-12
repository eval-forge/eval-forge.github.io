import { describe, it, expect } from 'vitest';
import { SPECS, newMind, step, Perception, arrived, wakeDelay, sightRange } from '../src/logic/guardianFSM';

const base: Perception = {
  awake: true, playerPos: [0, 0, 20], playerDist: 20, los: false, inFov: false,
  torchRadius: 0, noise: null, playerLit: false, nextStepLit: false,
};
const door: [number, number, number] = [0, 0, -100];

function run(kind: keyof typeof SPECS, p: Perception, steps: number, m = newMind()) {
  let mind = m;
  let intent;
  for (let i = 0; i < steps; i++) ({ mind, intent } = step(SPECS[kind], mind, p, 0.1, door));
  return { mind, intent: intent! };
}

describe('guardian state machines', () => {
  it('stay dormant until the clock wakes them, then wake and sweep toward the door', () => {
    const { mind } = run('sentinel', { ...base, awake: false }, 50);
    expect(mind.state).toBe('DORMANT');
    let r = run('sentinel', base, 1);
    expect(r.mind.state).toBe('WAKING');
    r = run('sentinel', base, 40);
    expect(r.mind.state).toBe('SWEEP');
    expect(r.intent.moveTo).toEqual(door);
  });
  it('sentinels see torchlight from far away but not darkness', () => {
    const awake = run('sentinel', base, 40).mind;
    const dark = step(SPECS.sentinel, awake, { ...base, los: true, inFov: true, playerDist: 15, torchRadius: 0 }, 0.1, door);
    expect(dark.mind.state).toBe('SWEEP');
    const lit = step(SPECS.sentinel, awake, { ...base, los: true, inFov: true, playerDist: 15, torchRadius: 10 }, 0.1, door);
    expect(lit.mind.state).toBe('CHASE');
    expect(sightRange(SPECS.sentinel, 10)).toBeGreaterThan(sightRange(SPECS.sentinel, 0));
  });
  it('crawlers hunt by sound and investigate then search', () => {
    const awake = run('crawler', base, 20).mind;
    const r = step(SPECS.crawler, awake, { ...base, noise: { pos: [5, 0, 5], loudness: 1, dist: 12 } }, 0.1, door);
    expect(r.mind.state).toBe('INVESTIGATE');
    expect(r.intent.moveTo).toEqual([5, 0, 5]);
    expect(arrived(SPECS.crawler, r.mind).state).toBe('SEARCH');
    // too quiet / too far
    const q = step(SPECS.crawler, awake, { ...base, noise: { pos: [5, 0, 5], loudness: 0.1, dist: 12 } }, 0.1, door);
    expect(q.mind.state).toBe('SWEEP');
  });
  it('the shade stalks you while you are lit and chases when you go dark', () => {
    const awake = run('shade', base, 20).mind;
    const lit = step(SPECS.shade, awake, { ...base, playerDist: 8, playerLit: true, nextStepLit: true }, 0.1, door);
    expect(lit.mind.state).toBe('STALK');
    expect(lit.intent.moveTo).toBeNull();
    const dark = step(SPECS.shade, lit.mind, { ...base, playerDist: 8, playerLit: false }, 0.1, door);
    expect(dark.mind.state).toBe('CHASE');
    // cannot catch a lit player
    const near = step(SPECS.shade, awake, { ...base, playerDist: 0.5, los: true, playerLit: true, nextStepLit: true }, 0.1, door);
    expect(near.intent.caught).toBe(false);
  });
  it('catches the player when close with line of sight', () => {
    const awake = run('crawler', base, 20).mind;
    const r = step(SPECS.crawler, awake, { ...base, playerDist: 0.8, los: true }, 0.1, door);
    expect(r.mind.state).toBe('CATCH');
    expect(r.intent.caught).toBe(true);
  });
  it('loses the player, searches, then resumes sweeping', () => {
    const awake = run('sentinel', base, 40).mind;
    let r = step(SPECS.sentinel, awake, { ...base, los: true, inFov: true, playerDist: 6, torchRadius: 5 }, 0.1, door);
    expect(r.mind.state).toBe('CHASE');
    r = step(SPECS.sentinel, r.mind, base, 0.1, door);
    expect(r.mind.state).toBe('SEARCH');
    const after = run('sentinel', base, 100, r.mind);
    expect(after.mind.state).toBe('SWEEP');
  });
  it('wakes deepest first', () => {
    expect(wakeDelay('lair')).toBeLessThan(wakeDelay('vault'));
    expect(wakeDelay('vault')).toBeLessThan(wakeDelay('catacombs'));
    expect(wakeDelay('catacombs')).toBeLessThan(wakeDelay('halls'));
  });
});
