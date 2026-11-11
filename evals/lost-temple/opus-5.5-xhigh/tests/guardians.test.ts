import { describe, it, expect } from 'vitest';
import { SentinelBrain, CrawlerBrain, ShadeBrain, Percept, wavesDue, SPAWN_WAVES, makeBrain } from '../src/logic/guardians';
import { Rng } from '../src/core/rng';

const door = { x: 0, y: 0, z: -2 };

function percept(over: Partial<Percept> = {}): Percept {
  return {
    dt: 0.1,
    self: { x: 0, y: 0, z: -50 },
    facing: { x: 0, z: 1 },
    player: { x: 0, y: 0, z: -10 },
    los: true,
    playerTorchLit: false,
    playerLight: 0,
    lightAtSelf: 0,
    noises: [],
    arrived: false,
    ...over,
  };
}

function wakeUp(b: { wake: (d?: number) => void; update: (p: Percept) => any }) {
  b.wake(0);
  for (let i = 0; i < 40; i++) b.update(percept({ los: false, player: { x: 500, y: 0, z: 500 } }));
}

describe('spawn waves', () => {
  it('spawn deepest first and each wave fires once', () => {
    expect(SPAWN_WAVES[0].scene).toBe('vault');
    expect(wavesDue(-0.1, 0).map((w) => w.scene)).toEqual(['vault']);
    expect(wavesDue(0, 14.9)).toEqual([]);
    expect(wavesDue(14.9, 15.1).map((w) => w.scene)).toEqual(['catacombs']);
    expect(wavesDue(-1, 100).length).toBe(SPAWN_WAVES.length);
  });
});

describe('Stone Sentinel', () => {
  it('stays dormant until woken, then wakes and sweeps toward the door', () => {
    const b = new SentinelBrain(door, new Rng(1));
    expect(b.update(percept({ playerTorchLit: true })).state).toBe('dormant');
    b.wake(1);
    expect(b.update(percept({ los: false })).state).toBe('waking');
    wakeUp(b);
    const i = b.update(percept({ los: false, player: { x: 500, y: 0, z: 500 } }));
    expect(i.state).toBe('sweep');
    expect(i.moveTo).toEqual(door);
  });
  it('is drawn to torchlight from 40 m even behind it, but not to an unlit player', () => {
    const b = new SentinelBrain(door, new Rng(1));
    wakeUp(b);
    const behind = { x: 0, y: 0, z: -85 }; // 35 m behind it
    expect(b.update(percept({ player: behind, playerTorchLit: false })).state).toBe('sweep');
    const i = b.update(percept({ player: behind, playerTorchLit: true }));
    expect(i.state).toBe('chase');
    expect(i.call).toBe('roar');
  });
  it('loses you when you douse the torch and break line of sight, then searches and gives up', () => {
    const b = new SentinelBrain(door, new Rng(1));
    wakeUp(b);
    b.update(percept({ player: { x: 0, y: 0, z: -20 }, playerTorchLit: true }));
    expect(b.state).toBe('chase');
    for (let i = 0; i < 25; i++) b.update(percept({ los: false }));
    expect(b.state).toBe('search');
    for (let i = 0; i < 80; i++) b.update(percept({ los: false, arrived: true }));
    // gave up: back to sweeping toward the door (and guarding it once there)
    expect(['sweep', 'guard']).toContain(b.state);
  });
  it('catches you within reach', () => {
    const b = new SentinelBrain(door, new Rng(1));
    wakeUp(b);
    const i = b.update(percept({ player: { x: 0, y: 0, z: -49 }, playerTorchLit: true }));
    expect(i.attack).toBe(true);
  });
});

describe('Crawler', () => {
  it('ignores a silent player at range and investigates distant noises', () => {
    const b = new CrawlerBrain(door, new Rng(2));
    wakeUp(b);
    expect(b.update(percept()).state).toBe('sweep');
    const i = b.update(percept({ noises: [{ x: 0, y: 0, z: -30, loudness: 0.9 }] }));
    expect(i.state).toBe('investigate');
    expect(i.moveTo).toEqual({ x: 0, y: 0, z: -30 });
  });
  it('chases close noises and loses you when you go quiet', () => {
    const b = new CrawlerBrain(door, new Rng(2));
    wakeUp(b);
    const i = b.update(percept({ noises: [{ x: 0, y: 0, z: -44, loudness: 0.4 }] }));
    expect(i.state).toBe('chase');
    expect(i.call).toBe('screech');
    for (let k = 0; k < 35; k++) b.update(percept());
    expect(b.state).toBe('search');
  });
  it('is fooled by a thrown decoy: it goes where the noise is, not where you are', () => {
    const b = new CrawlerBrain(door, new Rng(2));
    wakeUp(b);
    const i = b.update(percept({ player: { x: 5, y: 0, z: -47 }, noises: [{ x: -8, y: 0, z: -50, loudness: 0.8 }] }));
    expect(i.moveTo).toEqual({ x: -8, y: 0, z: -50 });
  });
  it('feels you if you brush past it', () => {
    const b = new CrawlerBrain(door, new Rng(2));
    wakeUp(b);
    const i = b.update(percept({ player: { x: 0.5, y: 0, z: -49.5 } }));
    expect(i.state).toBe('chase');
    expect(i.attack).toBe(true);
  });
  it('quiet noises far away are not heard', () => {
    const b = new CrawlerBrain(door, new Rng(2));
    wakeUp(b);
    expect(b.hear(percept({ noises: [{ x: 0, y: 0, z: -10, loudness: 0.1 }] }))).toBeNull();
  });
});

describe('Shade', () => {
  it('stalks while you hold a light and lunges the moment it fails', () => {
    const b = new ShadeBrain(door, new Rng(3));
    wakeUp(b);
    const near = { x: 0, y: 0, z: -42 };
    let i = b.update(percept({ player: near, playerTorchLit: true, playerLight: 0.9 }));
    expect(i.state).toBe('stalk');
    expect(i.avoidLight).toBe(true);
    i = b.update(percept({ player: near, playerTorchLit: true, playerLight: 0.9 }));
    expect(i.state).toBe('stalk');
    expect(i.attack).toBe(false);
    i = b.update(percept({ player: near, playerTorchLit: false, playerLight: 0.05 }));
    expect(i.state).toBe('lunge');
    expect(i.speed).toBeGreaterThan(6);
  });
  it('retreats when light falls on it', () => {
    const b = new ShadeBrain(door, new Rng(3));
    wakeUp(b);
    b.update(percept({ player: { x: 0, y: 0, z: -45 } }));
    const i = b.update(percept({ player: { x: 0, y: 0, z: -45 }, lightAtSelf: 0.8 }));
    expect(i.state).toBe('retreat');
    expect(i.moveTo!.z).toBeLessThan(-50); // away from the player
  });
  it('only catches you in the dark', () => {
    const b = new ShadeBrain(door, new Rng(3));
    wakeUp(b);
    const adj = { x: 0, y: 0, z: -49 };
    b.update(percept({ player: adj, playerLight: 0.05 }));
    expect(b.update(percept({ player: adj, playerLight: 0.05 })).attack).toBe(true);
    const b2 = makeBrain('shade', door, new Rng(3));
    wakeUp(b2);
    b2.update(percept({ player: adj, playerLight: 0.9 }));
    expect(b2.update(percept({ player: adj, playerLight: 0.9 })).attack).toBe(false);
  });
});
