import { describe, it, expect } from 'vitest';
import { stepGuardian, newMem, type Perception, WAKE_TIME, sentinelSightRange, stalkPoint, spawnDue, SPAWN_SCHEDULE } from '../src/logic/guardianFSM';

const door = { x: 0, y: 0, z: 0 };
const base = (o: Partial<Perception> = {}): Perception => ({
  awake: true, dist: 30, los: false, playerPos: { x: 10, y: 0, z: 10 }, torchLit: true, torchRadius: 8,
  noise: null, playerLit: true, selfLit: false, ...o,
});
function wake(kind: any) {
  let d = stepGuardian(kind, newMem(), base(), 0.1, door);
  expect(d.mem.state).toBe('waking');
  d = stepGuardian(kind, d.mem, base(), WAKE_TIME + 0.01, door);
  expect(d.mem.state).toBe('sweep');
  return d.mem;
}

describe('guardian state machines', () => {
  it('stay dormant until their spawn time', () => {
    const d = stepGuardian('sentinel', newMem(), base({ awake: false, dist: 0.5 }), 1, door);
    expect(d.mem.state).toBe('dormant');
    expect(d.caught).toBe(false);
  });

  it('sentinel sees a lit torch from far away, an unlit player only up close', () => {
    expect(sentinelSightRange(true, 8)).toBe(30);
    expect(sentinelSightRange(false, 8)).toBe(4);
    let m = wake('sentinel');
    let d = stepGuardian('sentinel', m, base({ dist: 25, los: true, torchLit: true }), 0.1, door);
    expect(d.mem.state).toBe('chase');
    m = wake('sentinel');
    d = stepGuardian('sentinel', m, base({ dist: 25, los: true, torchLit: false }), 0.1, door);
    expect(d.mem.state).toBe('sweep');
    d = stepGuardian('sentinel', m, base({ dist: 25, los: false, torchLit: true }), 0.1, door);
    expect(d.mem.state).toBe('sweep');
  });

  it('sentinel gives up after losing contact, searches, then sweeps to the door', () => {
    let m = wake('sentinel');
    m = stepGuardian('sentinel', m, base({ dist: 10, los: true }), 0.1, door).mem;
    expect(m.state).toBe('chase');
    for (let i = 0; i < 90; i++) m = stepGuardian('sentinel', m, base({ dist: 40 }), 0.1, door).mem;
    expect(m.state).toBe('search');
    for (let i = 0; i < 70; i++) m = stepGuardian('sentinel', m, base({ dist: 40 }), 0.1, door).mem;
    expect(m.state).toBe('sweep');
    expect(m.target).toEqual(door);
  });

  it('crawler is blind but hunts by sound', () => {
    let m = wake('crawler');
    let d = stepGuardian('crawler', m, base({ dist: 15, los: true, torchLit: false }), 0.1, door);
    expect(d.mem.state).toBe('sweep'); // sees nothing
    const noise = { x: 3, y: 0, z: 4 };
    d = stepGuardian('crawler', m, base({ dist: 15, noise, torchLit: false }), 0.1, door);
    expect(d.mem.state).toBe('investigate');
    expect(d.mem.target).toEqual(noise);
    expect(d.speed).toBeGreaterThan(4);
    d = stepGuardian('crawler', d.mem, base({ dist: 2, torchLit: false }), 0.1, door);
    expect(d.mem.state).toBe('chase');
  });

  it('shade stalks lit players, rushes when the light goes out, flees light', () => {
    let m = wake('shade');
    let d = stepGuardian('shade', m, base({ dist: 12, playerLit: true }), 0.1, door);
    expect(d.mem.state).toBe('stalk');
    d = stepGuardian('shade', d.mem, base({ dist: 12, playerLit: false, torchLit: false }), 0.1, door);
    expect(d.mem.state).toBe('chase');
    d = stepGuardian('shade', d.mem, base({ dist: 5, selfLit: true }), 0.1, door);
    expect(d.mem.state).toBe('flee');
    // cannot catch a player standing in torchlight
    const c = stepGuardian('shade', { ...d.mem, state: 'chase' }, base({ dist: 0.5, playerLit: true, torchLit: true }), 0.1, door);
    expect(c.caught).toBe(false);
    const c2 = stepGuardian('shade', { ...d.mem, state: 'chase' }, base({ dist: 0.5, playerLit: false, torchLit: false }), 0.1, door);
    expect(c2.caught).toBe(true);
  });

  it('catching happens within 1.1 m for sentinels and crawlers', () => {
    const m = wake('sentinel');
    expect(stepGuardian('sentinel', m, base({ dist: 1.0 }), 0.1, door).caught).toBe(true);
    expect(stepGuardian('sentinel', m, base({ dist: 1.5 }), 0.1, door).caught).toBe(false);
  });

  it('stalk point sits just outside the light radius', () => {
    const p = stalkPoint({ x: 20, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 8);
    expect(p.x).toBeCloseTo(9.5);
  });

  it('spawns deepest first', () => {
    const order = [...SPAWN_SCHEDULE].sort((a, b) => a.delay - b.delay).map((s) => s.scene);
    expect(order).toEqual(['vault', 'catacombs', 'sanctum', 'halls']);
    expect(spawnDue('vault', 0)).toBe(true);
    expect(spawnDue('halls', 10)).toBe(false);
  });
});
