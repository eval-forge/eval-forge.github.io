import { describe, expect, it } from 'vitest';
import {
  CRAWLER_TOUCH, GUARDIANS, SHADE_STRIKE_RADIUS, canHear, canSee, catches, newMind, stepGuardian, wakeDelay,
  type GuardianKind, type Mind, type Percept,
} from '../src/core/guardianFsm';

const base = (over: Partial<Percept> = {}): Percept => ({
  dt: 0.1, wake: true, enraged: false, selfPos: { x: 0, y: 0, z: 0 }, playerPos: { x: 20, y: 0, z: 0 }, dist: 20,
  los: false, facing: false, torchLit: false, lightRadius: 0, inLight: false, lightPos: null, noise: null, arrived: false, ...over,
});

function awake(kind: GuardianKind): Mind {
  const m = newMind(kind);
  stepGuardian(m, base());
  for (let i = 0; i < 80; i++) stepGuardian(m, base());
  expect(m.state).toBe('sweep');
  return m;
}

describe('waking', () => {
  it('stays dormant until the wake signal', () => {
    const m = newMind('sentinel');
    for (let i = 0; i < 50; i++) stepGuardian(m, base({ wake: false, los: true, facing: true, dist: 2 }));
    expect(m.state).toBe('dormant');
    expect(m.speed).toBe(0);
    expect(catches(m, base({ dist: 0.5 }))).toBe(false);
  });
  it('takes its wake time before sweeping', () => {
    const m = newMind('sentinel');
    stepGuardian(m, base());
    expect(m.state).toBe('waking');
    let t = 0;
    while (m.state === 'waking') { stepGuardian(m, base()); t += 0.1; }
    expect(t).toBeGreaterThanOrEqual(GUARDIANS.sentinel.wakeTime - 0.11);
    expect(m.state).toBe('sweep');
    expect(m.goalKind).toBe('sweep');
  });
  it('wakes the deepest scenes first', () => {
    expect(wakeDelay('vault')).toBe(0);
    expect(wakeDelay('catacombs')).toBeGreaterThan(wakeDelay('vault'));
    expect(wakeDelay('sanctum')).toBeGreaterThan(wakeDelay('catacombs'));
    expect(wakeDelay('halls')).toBeGreaterThan(wakeDelay('sanctum'));
  });
  it('advances along its sweep route on arrival', () => {
    const m = awake('sentinel');
    const i = m.sweepIndex;
    stepGuardian(m, base({ arrived: true }));
    expect(m.sweepIndex).toBe(i + 1);
  });
});

describe('the three guardians differ', () => {
  it('in speed', () => {
    expect(GUARDIANS.sentinel.speed.chase!).toBeLessThan(GUARDIANS.shade.speed.chase!);
    expect(GUARDIANS.shade.speed.chase!).toBeLessThan(GUARDIANS.crawler.speed.chase!);
  });
  it('in senses: sentinel sees, crawler hears, shade sees only in the dark', () => {
    const lit = base({ los: true, facing: true, dist: 20, torchLit: true, lightRadius: 11 });
    const dark = base({ los: true, facing: true, dist: 8 });
    expect(canSee('sentinel', lit)).toBe(true);
    expect(canSee('crawler', lit)).toBe(false);
    expect(canSee('shade', lit)).toBe(false);
    expect(canSee('shade', dark)).toBe(true);
    const n = { pos: { x: 5, y: 0, z: 0 }, radius: 14, dist: 12 };
    expect(canHear('crawler', n)).toBe(true);
    expect(canHear('sentinel', n)).toBe(false);
  });
});

describe('stone sentinel', () => {
  it('a lit torch gives you away from much further off', () => {
    expect(canSee('sentinel', base({ los: true, facing: true, dist: 22, torchLit: false }))).toBe(false);
    expect(canSee('sentinel', base({ los: true, facing: true, dist: 22, torchLit: true, lightRadius: 11 }))).toBe(true);
  });
  it('cannot see through walls or behind itself', () => {
    expect(canSee('sentinel', base({ los: false, facing: true, dist: 5 }))).toBe(false);
    expect(canSee('sentinel', base({ los: true, facing: false, dist: 8 }))).toBe(false);
    expect(canSee('sentinel', base({ los: true, facing: false, dist: 2 }))).toBe(true);
  });
  it('chases on sight, then searches where it lost you, then resumes the sweep', () => {
    const m = awake('sentinel');
    const seen = base({ los: true, facing: true, dist: 10, playerPos: { x: 10, y: 0, z: 0 } });
    stepGuardian(m, seen);
    expect(m.state).toBe('chase');
    expect(m.goal).toEqual({ x: 10, y: 0, z: 0 });
    expect(m.speed).toBe(GUARDIANS.sentinel.speed.chase);
    stepGuardian(m, base({ arrived: true }));
    expect(m.state).toBe('search');
    for (let i = 0; i < 60; i++) stepGuardian(m, base());
    expect(m.state).toBe('sweep');
  });
  it('keeps updating its goal while it can see you', () => {
    const m = awake('sentinel');
    stepGuardian(m, base({ los: true, facing: true, dist: 10, playerPos: { x: 10, y: 0, z: 0 } }));
    stepGuardian(m, base({ los: true, facing: true, dist: 9, playerPos: { x: 9, y: 0, z: 3 } }));
    expect(m.goal).toEqual({ x: 9, y: 0, z: 3 });
  });
  it('only investigates loud noises nearby', () => {
    const m = awake('sentinel');
    stepGuardian(m, base({ noise: { pos: { x: 3, y: 0, z: 3 }, radius: 14, dist: 12 } }));
    expect(m.state).toBe('sweep');
    stepGuardian(m, base({ noise: { pos: { x: 3, y: 0, z: 3 }, radius: 22, dist: 5 } }));
    expect(m.state).toBe('investigate');
  });
});

describe('crawler', () => {
  it('ignores a silent player in plain view', () => {
    const m = awake('crawler');
    for (let i = 0; i < 30; i++) stepGuardian(m, base({ los: true, facing: true, dist: 4, torchLit: true, lightRadius: 11 }));
    expect(m.state).toBe('sweep');
  });
  it('runs to a noise, and a thrown rock pulls it off you', () => {
    const m = awake('crawler');
    stepGuardian(m, base({ noise: { pos: { x: 6, y: 0, z: 0 }, radius: 14, dist: 6 } }));
    expect(m.state).toBe('investigate');
    const decoy = { x: -15, y: 0, z: 4 };
    stepGuardian(m, base({ noise: { pos: decoy, radius: 22, dist: 16 } }));
    expect(m.goal).toEqual(decoy);
  });
  it('escalates to a chase when it keeps hearing you close by', () => {
    const m = awake('crawler');
    stepGuardian(m, base({ noise: { pos: { x: 6, y: 0, z: 0 }, radius: 14, dist: 6 } }));
    stepGuardian(m, base({ noise: { pos: { x: 5, y: 0, z: 0 }, radius: 14, dist: 5 } }));
    expect(m.state).toBe('chase');
    expect(m.speed).toBe(GUARDIANS.crawler.speed.chase);
  });
  it('loses you if you go quiet', () => {
    const m = awake('crawler');
    stepGuardian(m, base({ noise: { pos: { x: 6, y: 0, z: 0 }, radius: 14, dist: 6 } }));
    stepGuardian(m, base({ noise: { pos: { x: 5, y: 0, z: 0 }, radius: 14, dist: 5 } }));
    for (let i = 0; i < 30; i++) stepGuardian(m, base({ dist: 6 }));
    expect(m.state).toBe('search');
  });
  it('finds you by touch even when you are silent', () => {
    const m = awake('crawler');
    stepGuardian(m, base({ dist: CRAWLER_TOUCH - 0.1, playerPos: { x: 1.9, y: 0, z: 0 } }));
    expect(m.state).toBe('chase');
  });
});

describe('shade', () => {
  const litNear = (over: Partial<Percept> = {}) => base({ torchLit: true, lightRadius: 11, dist: 20, ...over });
  it('is drawn to torchlight and lurks just outside it', () => {
    const m = awake('shade');
    stepGuardian(m, litNear({ selfPos: { x: 0, y: 0, z: 0 }, playerPos: { x: 20, y: 0, z: 0 } }));
    expect(m.state).toBe('lurk');
    expect(m.goal!.x).toBeCloseTo(20 - 12.5);
  });
  it('flees when the light reaches it', () => {
    const m = awake('shade');
    stepGuardian(m, litNear());
    stepGuardian(m, litNear({ dist: 8, inLight: true, lightPos: { x: 8, y: 0, z: 0 }, playerPos: { x: 8, y: 0, z: 0 } }));
    expect(m.state).toBe('flee');
    expect(m.goal!.x).toBeLessThan(0);
    expect(m.speed).toBe(GUARDIANS.shade.speed.flee);
  });
  it('cannot catch you inside strong light', () => {
    const m = awake('shade');
    stepGuardian(m, litNear());
    expect(catches(m, litNear({ dist: 0.5 }))).toBe(false);
  });
  it('strikes when the torch gutters below the strike radius', () => {
    const m = awake('shade');
    stepGuardian(m, litNear());
    stepGuardian(m, litNear({ lightRadius: SHADE_STRIKE_RADIUS - 0.5, dist: 6 }));
    expect(m.state).toBe('chase');
    expect(catches(m, litNear({ lightRadius: SHADE_STRIKE_RADIUS - 0.5, dist: 0.8 }))).toBe(true);
  });
  it('strikes when the torch goes out', () => {
    const m = awake('shade');
    stepGuardian(m, litNear());
    stepGuardian(m, base({ dist: 12 }));
    expect(m.state).toBe('chase');
  });
  it('backs off again when the torch is relit mid-chase', () => {
    const m = awake('shade');
    stepGuardian(m, base({ los: true, dist: 6 }));
    expect(m.state).toBe('chase');
    stepGuardian(m, litNear({ dist: 5, inLight: true, lightPos: { x: 5, y: 0, z: 0 } }));
    expect(m.state).toBe('flee');
  });
  it('is turned back by a sconce torch', () => {
    const m = awake('shade');
    stepGuardian(m, base({ inLight: true, lightPos: { x: 2, y: 0, z: 0 } }));
    expect(m.state).toBe('flee');
  });
});

describe('catching and enrage', () => {
  it('catches inside catch range once awake', () => {
    const m = awake('sentinel');
    expect(catches(m, base({ dist: 1.0 }))).toBe(true);
    expect(catches(m, base({ dist: 3.0 }))).toBe(false);
  });
  it('when the door seals every guardian knows where you are', () => {
    for (const kind of ['sentinel', 'crawler', 'shade'] as GuardianKind[]) {
      const m = awake(kind);
      const p = base({ enraged: true, playerPos: { x: 7, y: 0, z: 7 }, torchLit: true, lightRadius: 11 });
      stepGuardian(m, p);
      expect(m.state).toBe('chase');
      expect(m.goal).toEqual({ x: 7, y: 0, z: 7 });
      expect(m.speed).toBe(GUARDIANS[kind].speed.enraged);
      expect(catches(m, { ...p, dist: 0.5 })).toBe(true);
    }
  });
});
