import { describe, it, expect } from 'vitest';
import { SentinelBrain, CrawlerBrain, ShadowBrain, type Perception, SPAWN_SCHEDULE, heartbeat, createBrain } from '../src/logic/guardians';

function P(o: Partial<Perception> = {}): Perception {
  return {
    dt: 0.1, awake: true, pos: [0, 0, 0], player: [20, 0, 0], playerDist: 20, playerLOS: true, playerAngle: 0,
    playerLightRadius: 11, playerInLight: false, noises: [], lightAtSelf: 0, litSconces: [], sweepTarget: [0, 0, 50],
    rand: () => 0.5, ...o,
  };
}
function wake(b: { update(p: Perception): unknown; state: string }, steps = 40) {
  for (let i = 0; i < steps && (b.state === 'dormant' || b.state === 'waking'); i++) b.update(P({ playerLOS: false, playerDist: 100 }));
}

describe('sentinel', () => {
  it('stays dormant until darkness, then wakes and sweeps toward the door', () => {
    const b = new SentinelBrain();
    expect(b.update(P({ awake: false })).state).toBe('dormant');
    expect(b.update(P({ playerLOS: false })).cue).toBe('wake');
    for (let i = 0; i < 30; i++) b.update(P({ playerLOS: false }));
    const d = b.update(P({ playerLOS: false }));
    expect(d.state).toBe('sweep');
    expect(d.target).toEqual([0, 0, 50]);
    expect(d.speed).toBeLessThan(2);
  });
  it('spots a torch from far away but not a dark player', () => {
    const b = new SentinelBrain();
    wake(b);
    expect(b.update(P({ playerDist: 25, player: [25, 0, 0], playerLightRadius: 11 })).state).toBe('chase');
    const c = new SentinelBrain();
    wake(c);
    expect(c.update(P({ playerDist: 25, player: [25, 0, 0], playerLightRadius: 0 })).state).toBe('sweep');
  });
  it('needs line of sight and a facing cone', () => {
    const b = new SentinelBrain();
    wake(b);
    expect(b.update(P({ playerDist: 10, playerLOS: false })).state).toBe('sweep');
    expect(b.update(P({ playerDist: 10, playerAngle: Math.PI * 0.9 })).state).toBe('sweep');
    expect(b.update(P({ playerDist: 10, playerAngle: 0.2 })).state).toBe('chase');
  });
  it('loses the player, searches, then goes back to sweeping', () => {
    const b = new SentinelBrain();
    wake(b);
    b.update(P({ playerDist: 10 }));
    let d = b.update(P({ playerDist: 10, playerLOS: false }));
    expect(d.state).toBe('chase');
    for (let i = 0; i < 45; i++) d = b.update(P({ playerDist: 10, playerLOS: false }));
    expect(d.state).toBe('search');
    for (let i = 0; i < 80; i++) d = b.update(P({ playerDist: 30, playerLOS: false }));
    expect(d.state).toBe('sweep');
  });
  it('investigates loud noises and lit sconces, ignores quiet ones', () => {
    const b = new SentinelBrain();
    wake(b);
    expect(b.update(P({ playerLOS: false, noises: [{ x: 5, y: 0, z: 5, loudness: 0.3, dist: 7, byPlayer: true }] })).state).toBe('sweep');
    expect(b.update(P({ playerLOS: false, noises: [{ x: 5, y: 0, z: 5, loudness: 1.2, dist: 7, byPlayer: false }] })).state).toBe('investigate');
    const c = new SentinelBrain();
    wake(c);
    const d = c.update(P({ playerLOS: false, litSconces: [{ id: 's1', x: 3, y: 0, z: 0, dist: 3 }] }));
    expect(d.state).toBe('investigate');
    let smashed: string | null = null;
    for (let i = 0; i < 5 && !smashed; i++) smashed = c.update(P({ pos: [3, 0, 0], playerLOS: false, litSconces: [{ id: 's1', x: 3, y: 0, z: 0, dist: 0.1 }] })).smashSconce;
    expect(smashed).toBe('s1');
  });
  it('catches within reach', () => {
    const b = new SentinelBrain();
    wake(b);
    expect(b.update(P({ playerDist: 1.2 })).catchPlayer).toBe(true);
  });
});

describe('crawler', () => {
  it('is blind: ignores a lit player who makes no sound', () => {
    const b = new CrawlerBrain();
    wake(b);
    expect(b.update(P({ playerDist: 6, playerLightRadius: 11 })).state).toBe('roam');
  });
  it('rushes toward footsteps and hunts the player', () => {
    const b = new CrawlerBrain();
    wake(b);
    const d = b.update(P({ noises: [{ x: 10, y: 0, z: 0, loudness: 0.95, dist: 10, byPlayer: true }] }));
    expect(d.state).toBe('hunt');
    expect(d.target).toEqual([10, 0, 0]);
    expect(d.speed).toBeGreaterThan(6);
    expect(d.cue).toBe('alert');
  });
  it('a thrown decoy pulls it away', () => {
    const b = new CrawlerBrain();
    wake(b);
    const d = b.update(P({ noises: [{ x: -8, y: 0, z: 3, loudness: 0.8, dist: 8.5, byPlayer: false }] }));
    expect(d.state).toBe('investigate');
    expect(d.target).toEqual([-8, 0, 3]);
  });
  it('crouch-walking is too quiet to hear from range', () => {
    const b = new CrawlerBrain();
    wake(b);
    expect(b.update(P({ noises: [{ x: 6, y: 0, z: 0, loudness: 0.05, dist: 6, byPlayer: true }] })).state).toBe('roam');
  });
  it('gives up after reaching the noise and searching', () => {
    const b = new CrawlerBrain();
    wake(b);
    b.update(P({ noises: [{ x: 1, y: 0, z: 0, loudness: 1, dist: 1, byPlayer: false }] }));
    let d = b.update(P({ pos: [1, 0, 0] }));
    expect(d.state).toBe('search');
    for (let i = 0; i < 60; i++) d = b.update(P({ pos: [1, 0, 0] }));
    expect(d.state).toBe('roam');
  });
  it('catches what it touches', () => {
    const b = new CrawlerBrain();
    wake(b);
    expect(b.update(P({ playerDist: 1 })).catchPlayer).toBe(true);
  });
});

describe('shadow', () => {
  it('circles at the edge of the light while the torch burns', () => {
    const b = new ShadowBrain();
    b.update(P({ awake: true, playerDist: 30 }));
    const d = b.update(P({ playerDist: 12, playerLightRadius: 11 }));
    expect(d.state).toBe('stalk');
    expect(d.avoidLight).toBe(true);
    const r = Math.hypot(d.target![0] - 20, d.target![2]);
    expect(r).toBeCloseTo(12.5, 1);
    expect(d.catchPlayer).toBe(false);
  });
  it('strikes when the torch goes out or gutters', () => {
    const b = new ShadowBrain();
    b.update(P({ playerDist: 30 }));
    b.update(P({ playerDist: 12 }));
    const d = b.update(P({ playerDist: 12, playerLightRadius: 0 }));
    expect(d.state).toBe('strike');
    expect(d.speed).toBeGreaterThan(7);
    expect(b.update(P({ playerDist: 0.8, playerLightRadius: 2.5 })).catchPlayer).toBe(true);
  });
  it('flees when light finds it', () => {
    const b = new ShadowBrain();
    b.update(P({ playerDist: 30 }));
    b.update(P({ playerDist: 12 }));
    b.update(P({ playerDist: 6, playerLightRadius: 0 }));
    const d = b.update(P({ playerDist: 6, playerLightRadius: 11 }));
    expect(d.state).toBe('flee');
    const e = new ShadowBrain();
    e.update(P({ playerDist: 30 }));
    expect(e.update(P({ playerDist: 30, lightAtSelf: 0.9 })).state).toBe('flee');
  });
  it('a sconce light protects the player', () => {
    const b = new ShadowBrain();
    b.update(P({ playerDist: 30 }));
    expect(b.update(P({ playerDist: 10, playerLightRadius: 0, playerInLight: true })).state).toBe('stalk');
  });
});

describe('spawning and heartbeat', () => {
  it('spawns deepest first and covers all three types', () => {
    const order = SPAWN_SCHEDULE.map((s) => s.at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(SPAWN_SCHEDULE[0].spawn).toMatch(/lair/);
    expect(new Set(SPAWN_SCHEDULE.map((s) => s.kind))).toEqual(new Set(['sentinel', 'crawler', 'shadow']));
    for (const k of ['sentinel', 'crawler', 'shadow'] as const) expect(createBrain(k).kind).toBe(k);
  });
  it('heartbeat quickens as a guardian closes in', () => {
    expect(heartbeat(30).bpm).toBe(0);
    expect(heartbeat(4).bpm).toBeGreaterThan(heartbeat(15).bpm);
    expect(heartbeat(2).volume).toBeCloseTo(1);
  });
});
