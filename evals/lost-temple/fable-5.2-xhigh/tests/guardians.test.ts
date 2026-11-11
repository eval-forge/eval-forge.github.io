import { describe, expect, it } from 'vitest';
import {
  GUARDIAN_SPECS, createBrain, detects, think, wake, type Brain, type Decision, type GuardianType, type Percepts,
} from '../src/core/guardianFsm';

const P = (o: Partial<Percepts> = {}): Percepts => ({
  dt: 0.1,
  selfPos: { x: 0, y: 0, z: 0 },
  playerPos: { x: 50, y: 0, z: 0 },
  dist: 50,
  lineOfSight: false,
  angleToPlayer: 0,
  playerLit: false,
  playerSafeRadius: 0,
  selfInLight: false,
  heard: null,
  arrived: false,
  playerPresent: true,
  ...o,
});

/** A guardian that has finished waking and is sweeping. */
function awake(type: GuardianType): Brain {
  const b = createBrain(type);
  wake(b);
  let d: Decision = think(b, P());
  for (let i = 0; i < 100 && d.state === 'waking'; i++) d = think(b, P());
  expect(b.state).toBe('sweep');
  return b;
}

const run = (b: Brain, p: Percepts, seconds: number): Decision => {
  let d = think(b, p);
  for (let t = p.dt; t < seconds; t += p.dt) d = think(b, p);
  return d;
};

describe('guardian roster', () => {
  it('has three types with different movement and senses', () => {
    const types = Object.keys(GUARDIAN_SPECS);
    expect(types.length).toBeGreaterThanOrEqual(3);
    const s = GUARDIAN_SPECS.sentinel;
    const c = GUARDIAN_SPECS.crawler;
    const h = GUARDIAN_SPECS.shade;
    expect(new Set([s.chaseSpeed, c.chaseSpeed, h.chaseSpeed]).size).toBe(3);
    expect(c.chaseSpeed).toBeGreaterThan(h.chaseSpeed);
    expect(h.chaseSpeed).toBeGreaterThan(s.chaseSpeed);
    expect(c.sightLit).toBe(0); // blind
    expect(c.hearing).toBeGreaterThan(s.hearing);
    expect(h.fearsLight).toBe(true);
    expect(s.fearsLight).toBe(false);
  });
});

describe('dormant and waking', () => {
  it('a dormant guardian does nothing, whatever it could perceive', () => {
    for (const type of ['sentinel', 'crawler', 'shade'] as const) {
      const b = createBrain(type);
      const d = think(b, P({ dist: 0.5, lineOfSight: true, heard: { pos: { x: 1, y: 0, z: 0 }, loudness: 1 } }));
      expect(d.state).toBe('dormant');
      expect(d.caught).toBe(false);
      expect(d.move.kind).toBe('none');
    }
  });

  it('takes its wake time to come alive, then calls out and sweeps', () => {
    const b = createBrain('sentinel');
    expect(wake(b)).toBe(true);
    expect(wake(b)).toBe(false);
    let d = think(b, P());
    expect(d.state).toBe('waking');
    expect(d.speed).toBe(0);
    let t = 0.1;
    let call: string | null = null;
    while (d.state === 'waking' && t < 10) {
      d = think(b, P());
      t += 0.1;
      call = call ?? d.call;
    }
    expect(t).toBeGreaterThanOrEqual(GUARDIAN_SPECS.sentinel.wakeTime);
    expect(d.state).toBe('sweep');
    expect(d.move.kind).toBe('sweep');
    expect(call).toBe('wake');
  });

  it('cannot catch anyone while still waking', () => {
    const b = createBrain('crawler');
    wake(b);
    expect(think(b, P({ dist: 0.5, lineOfSight: true })).caught).toBe(false);
  });
});

describe('stone sentinel (sight)', () => {
  const spec = GUARDIAN_SPECS.sentinel;

  it('sees a lit player inside its cone and range', () => {
    expect(detects(spec, P({ dist: 20, lineOfSight: true, angleToPlayer: 0.3, playerLit: true }))).toBe(true);
  });

  it('needs line of sight', () => {
    expect(detects(spec, P({ dist: 10, lineOfSight: false, playerLit: true }))).toBe(false);
  });

  it('sees an unlit player only up close', () => {
    expect(detects(spec, P({ dist: 12, lineOfSight: true, playerLit: false }))).toBe(false);
    expect(detects(spec, P({ dist: 6, lineOfSight: true, playerLit: false }))).toBe(true);
  });

  it('does not see behind itself unless the torch gives you away', () => {
    expect(detects(spec, P({ dist: 6, lineOfSight: true, angleToPlayer: 2.5, playerLit: false }))).toBe(false);
    expect(detects(spec, P({ dist: 30, lineOfSight: true, angleToPlayer: 2.5, playerLit: true }))).toBe(true);
  });

  it('is drawn to torchlight from far beyond its normal sight', () => {
    expect(detects(spec, P({ dist: 38, lineOfSight: true, angleToPlayer: 0.2, playerLit: true }))).toBe(true);
    expect(detects(spec, P({ dist: 38, lineOfSight: true, angleToPlayer: 0.2, playerLit: false }))).toBe(false);
    expect(detects(spec, P({ dist: 45, lineOfSight: true, playerLit: true }))).toBe(false);
  });

  it('sweep -> chase on sight, with an alert call', () => {
    const b = awake('sentinel');
    const d = think(b, P({ dist: 15, lineOfSight: true, playerLit: true, playerPos: { x: 15, y: 0, z: 0 } }));
    expect(d.state).toBe('chase');
    expect(d.call).toBe('alert');
    expect(d.speed).toBe(spec.chaseSpeed);
    expect(d.move).toEqual({ kind: 'point', pos: { x: 15, y: 0, z: 0 } });
  });

  it('chase -> search after losing sight, heading for the last known position', () => {
    const b = awake('sentinel');
    think(b, P({ dist: 15, lineOfSight: true, playerLit: true, playerPos: { x: 15, y: 0, z: 3 } }));
    let d = run(b, P({ dist: 15, lineOfSight: false }), spec.loseTime - 0.3);
    expect(d.state).toBe('chase');
    expect(d.move).toEqual({ kind: 'point', pos: { x: 15, y: 0, z: 3 } });
    d = run(b, P({ dist: 15, lineOfSight: false }), 0.6);
    expect(d.state).toBe('search');
    expect(d.move).toEqual({ kind: 'point', pos: { x: 15, y: 0, z: 3 } });
  });

  it('search -> sweep after lingering at the spot', () => {
    const b = awake('sentinel');
    think(b, P({ dist: 15, lineOfSight: true, playerLit: true }));
    run(b, P(), spec.loseTime + 0.2);
    expect(b.state).toBe('search');
    let d = run(b, P({ arrived: true }), spec.lingerTime - 0.5);
    expect(d.state).toBe('search');
    expect(d.speed).toBe(0);
    d = run(b, P({ arrived: true }), 1);
    expect(d.state).toBe('sweep');
  });

  it('search -> chase if it spots you again', () => {
    const b = awake('sentinel');
    think(b, P({ dist: 15, lineOfSight: true, playerLit: true }));
    run(b, P(), spec.loseTime + 0.2);
    const d = think(b, P({ dist: 5, lineOfSight: true }));
    expect(d.state).toBe('chase');
  });

  it('investigates a loud noise but ignores a faint one', () => {
    const b = awake('sentinel');
    let d = think(b, P({ heard: { pos: { x: 9, y: 0, z: 9 }, loudness: 0.2 } }));
    expect(d.state).toBe('sweep');
    d = think(b, P({ heard: { pos: { x: 9, y: 0, z: 9 }, loudness: 0.7 } }));
    expect(d.state).toBe('investigate');
    expect(d.move).toEqual({ kind: 'point', pos: { x: 9, y: 0, z: 9 } });
    d = run(b, P({ arrived: true }), spec.lingerTime + 0.3);
    expect(d.state).toBe('sweep');
  });

  it('catches on contact', () => {
    const b = awake('sentinel');
    const d = think(b, P({ dist: 1.2, lineOfSight: true }));
    expect(d.caught).toBe(true);
  });

  it('does not catch through a wall', () => {
    const b = awake('sentinel');
    expect(think(b, P({ dist: 1.2, lineOfSight: false })).caught).toBe(false);
  });

  it('ignores a player who is gone', () => {
    const b = awake('sentinel');
    const d = think(b, P({ dist: 1, lineOfSight: true, playerPresent: false }));
    expect(d.caught).toBe(false);
    expect(d.state).toBe('sweep');
  });
});

describe('crawler (sound)', () => {
  const spec = GUARDIAN_SPECS.crawler;

  it('cannot see: a silent player in plain view is not detected at range', () => {
    expect(detects(spec, P({ dist: 6, lineOfSight: true, playerLit: true }))).toBe(false);
    const b = awake('crawler');
    expect(think(b, P({ dist: 6, lineOfSight: true, playerLit: true })).state).toBe('sweep');
  });

  it('charges a loud noise at full speed', () => {
    const b = awake('crawler');
    const d = think(b, P({ heard: { pos: { x: 12, y: 0, z: -4 }, loudness: 0.8 } }));
    expect(d.state).toBe('chase');
    expect(d.speed).toBe(spec.chaseSpeed);
    expect(d.move).toEqual({ kind: 'point', pos: { x: 12, y: 0, z: -4 } });
    expect(d.call).toBe('alert');
  });

  it('creeps toward a faint noise', () => {
    const b = awake('crawler');
    const d = think(b, P({ heard: { pos: { x: 3, y: 0, z: 0 }, loudness: 0.1 } }));
    expect(d.state).toBe('investigate');
    expect(d.speed).toBe(spec.investigateSpeed);
  });

  it('retargets to each new noise (a thrown rock is a decoy)', () => {
    const b = awake('crawler');
    think(b, P({ heard: { pos: { x: 12, y: 0, z: 0 }, loudness: 0.8 } }));
    const d = think(b, P({ heard: { pos: { x: -20, y: 0, z: 5 }, loudness: 0.9 } }));
    expect(d.state).toBe('chase');
    expect(d.move).toEqual({ kind: 'point', pos: { x: -20, y: 0, z: 5 } });
  });

  it('keeps heading for the last noise in silence, then listens, then gives up', () => {
    const b = awake('crawler');
    think(b, P({ heard: { pos: { x: 12, y: 0, z: 0 }, loudness: 0.8 } }));
    let d = run(b, P(), 2);
    expect(d.state).toBe('chase');
    expect(d.move).toEqual({ kind: 'point', pos: { x: 12, y: 0, z: 0 } });
    d = think(b, P({ arrived: true }));
    expect(d.state).toBe('search');
    d = run(b, P({ arrived: true }), spec.lingerTime + 0.3);
    expect(d.state).toBe('sweep');
  });

  it('a crouching player beside it goes unnoticed until they touch', () => {
    const b = awake('crawler');
    expect(think(b, P({ dist: 3, lineOfSight: true })).state).toBe('sweep');
    expect(think(b, P({ dist: 1.1, lineOfSight: true })).caught).toBe(true);
  });
});

describe('shade (fears light)', () => {
  const spec = GUARDIAN_SPECS.shade;

  it('sees in the dark at long range, in every direction', () => {
    expect(detects(spec, P({ dist: 28, lineOfSight: true, angleToPlayer: 3, playerLit: false }))).toBe(true);
  });

  it('chases an unlit player', () => {
    const b = awake('shade');
    const d = think(b, P({ dist: 20, lineOfSight: true, playerPos: { x: 20, y: 0, z: 0 } }));
    expect(d.state).toBe('chase');
    expect(d.speed).toBe(spec.chaseSpeed);
  });

  it('is held at the edge of torchlight', () => {
    const b = awake('shade');
    const d = think(b, P({ dist: 14, lineOfSight: true, playerLit: true, playerSafeRadius: 10, playerPos: { x: 14, y: 0, z: 0 } }));
    expect(d.state).toBe('repelled');
    expect(d.move.kind).toBe('holdEdge');
    if (d.move.kind === 'holdEdge') {
      expect(d.move.radius).toBeGreaterThan(10);
      expect(d.move.around).toEqual({ x: 14, y: 0, z: 0 });
    }
    expect(d.call).toBe('hiss');
  });

  it('can never catch a player whose torch is lit', () => {
    const b = awake('shade');
    for (const dist of [0.5, 1, 1.3, 2]) {
      const d = think(b, P({ dist, lineOfSight: true, playerLit: true, playerSafeRadius: 2.8 }));
      expect(d.caught).toBe(false);
    }
  });

  it('rushes in the moment the flame dies', () => {
    const b = awake('shade');
    think(b, P({ dist: 12, lineOfSight: true, playerLit: true, playerSafeRadius: 10 }));
    expect(b.state).toBe('repelled');
    const d = think(b, P({ dist: 12, lineOfSight: true, playerLit: false, playerSafeRadius: 0 }));
    expect(d.state).toBe('chase');
    expect(think(b, P({ dist: 1.2, lineOfSight: true })).caught).toBe(true);
  });

  it('flees light it is standing in (a lit sconce)', () => {
    const b = awake('shade');
    const d = think(b, P({ selfInLight: true }));
    expect(d.state).toBe('repelled');
    expect(d.move.kind).toBe('fleeLight');
  });

  it('goes to look where you were if it loses you while repelled', () => {
    const b = awake('shade');
    think(b, P({ dist: 12, lineOfSight: true, playerLit: true, playerSafeRadius: 10, playerPos: { x: 12, y: 0, z: 0 } }));
    const d = think(b, P({ dist: 12, lineOfSight: false }));
    expect(d.state).toBe('search');
    expect(d.move).toEqual({ kind: 'point', pos: { x: 12, y: 0, z: 0 } });
  });
});

describe('light is safety and a beacon at once', () => {
  it('the same lit torch that holds off a shade pulls in a sentinel', () => {
    const lit = P({ dist: 30, lineOfSight: true, angleToPlayer: 2, playerLit: true, playerSafeRadius: 10 });
    const shade = awake('shade');
    const sentinel = awake('sentinel');
    expect(think(shade, lit).state).toBe('repelled');
    expect(think(sentinel, lit).state).toBe('chase');
    const dark = P({ dist: 30, lineOfSight: true, angleToPlayer: 2, playerLit: false });
    const shade2 = awake('shade');
    const sentinel2 = awake('sentinel');
    expect(think(shade2, dark).state).toBe('chase');
    expect(think(sentinel2, dark).state).toBe('sweep');
  });
});
