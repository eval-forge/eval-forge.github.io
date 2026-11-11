import { describe, expect, it } from 'vitest';
import {
  CRUMBLE_DELAY, DART_COOLDOWN, DART_HEIGHT, PLANK_CRACK_DELAY, PLANK_DROP_DELAY, PLANK_LIFETIME, addNoise, bladeAngle,
  boulderDamage, dartHits, decayNoise, fallDamage, gustStrength, newDartTrap, newNoiseMeter, newPlank, newPlate, newTile,
  pedestalSwap, scarabDamage, stepDartTrap, stepPlank, stepPlate, stepTile, swapTriggersTrap, NOISE, SAFE_FALL,
} from '../src/core/traps';

describe('rope bridge planks', () => {
  it('stay intact until stepped on', () => {
    const p = newPlank();
    for (let i = 0; i < 100; i++) expect(stepPlank(p, false, 0.1)).toBeNull();
    expect(p.state).toBe('intact');
  });
  it('creak, crack, then drop after a short delay', () => {
    const p = newPlank();
    expect(stepPlank(p, true, 0.016)).toBe('creak');
    const events: string[] = [];
    let t = 0;
    while (p.state !== 'dropped' && t < 5) { const e = stepPlank(p, true, 0.016); if (e) events.push(e); t += 0.016; }
    expect(events).toEqual(['crack', 'drop']);
    expect(t).toBeGreaterThan(PLANK_LIFETIME - 0.05);
    expect(t).toBeLessThan(PLANK_LIFETIME + 0.1);
  });
  it('cannot be saved by stepping off', () => {
    const p = newPlank();
    stepPlank(p, true, 0.016);
    for (let i = 0; i < 200; i++) stepPlank(p, false, 0.016);
    expect(p.state).toBe('dropped');
  });
  it('gives less than two seconds, so you cannot stop on one', () => {
    expect(PLANK_CRACK_DELAY + PLANK_DROP_DELAY).toBeLessThan(2);
  });
});

describe('crumbling floor', () => {
  it('shakes on contact then falls after the delay', () => {
    const t = newTile();
    expect(stepTile(t, false, 1)).toBeNull();
    expect(stepTile(t, true, 0.016)).toBe('shake');
    expect(stepTile(t, false, CRUMBLE_DELAY - 0.1)).toBeNull();
    expect(stepTile(t, false, 0.2)).toBe('fall');
    expect(t.state).toBe('fallen');
    expect(stepTile(t, true, 1)).toBeNull();
  });
});

describe('pressure plates', () => {
  it('press at the mass threshold and release below it', () => {
    const p = newPlate(40);
    expect(stepPlate(p, 10)).toBeNull();
    expect(stepPlate(p, 75)).toBe('pressed');
    expect(stepPlate(p, 80)).toBeNull();
    expect(stepPlate(p, 0)).toBe('released');
  });
  it('a light thrown rock does not press a plate but a stone block does', () => {
    const p = newPlate();
    expect(stepPlate(p, 3)).toBeNull();
    expect(stepPlate(p, 300)).toBe('pressed');
  });
});

describe('trapped pedestals', () => {
  it('fire when the relic is lifted with nothing swapped in', () => {
    expect(pedestalSwap(6, null)).toBe('noCounterweight');
    expect(swapTriggersTrap(pedestalSwap(6, null))).toBe(true);
  });
  it('are safe with a counterweight within 20 percent', () => {
    expect(pedestalSwap(6, 6)).toBe('safe');
    expect(pedestalSwap(6, 4.9)).toBe('safe');
    expect(pedestalSwap(6, 7.1)).toBe('safe');
    expect(swapTriggersTrap('safe')).toBe(false);
  });
  it('fire when the counterweight is too light or too heavy', () => {
    expect(pedestalSwap(6, 3)).toBe('tooLight');
    expect(pedestalSwap(6, 9)).toBe('tooHeavy');
    expect(swapTriggersTrap(pedestalSwap(6, 9))).toBe(true);
  });
});

describe('dart launchers', () => {
  it('fire when the plate is pressed and respect the cooldown', () => {
    const d = newDartTrap();
    expect(stepDartTrap(d, false, 0.016)).toBe(false);
    expect(stepDartTrap(d, true, 0.016)).toBe(true);
    expect(stepDartTrap(d, true, 0.016)).toBe(false);
    expect(stepDartTrap(d, true, DART_COOLDOWN)).toBe(true);
  });
  it('miss a crouching player and hit a standing one', () => {
    expect(dartHits(DART_HEIGHT, 0, 1.75, 0.2)).toBe(true);
    expect(dartHits(DART_HEIGHT, 0, 1.1, 0.2)).toBe(false);
    expect(dartHits(DART_HEIGHT, 0, 1.75, 2)).toBe(false);
  });
});

describe('blades, boulders and falls', () => {
  it('swing blades as a pendulum within their amplitude', () => {
    for (let t = 0; t < 10; t += 0.1) expect(Math.abs(bladeAngle(t, 2.4, 1.1))).toBeLessThanOrEqual(1.1 + 1e-9);
    expect(bladeAngle(0, 2.4, 1.1)).toBeCloseTo(0);
    expect(bladeAngle(0.6, 2.4, 1.1)).toBeCloseTo(1.1);
  });
  it('scale boulder damage with speed', () => {
    expect(boulderDamage(0.5)).toBe(0);
    expect(boulderDamage(4)).toBeGreaterThan(40);
    expect(boulderDamage(20)).toBe(100);
  });
  it('charge nothing for short falls and plenty for long ones', () => {
    expect(fallDamage(SAFE_FALL)).toBe(0);
    expect(fallDamage(2)).toBe(0);
    expect(fallDamage(8)).toBeGreaterThan(30);
    expect(fallDamage(16)).toBeGreaterThanOrEqual(100);
  });
});

describe('sanctum noise', () => {
  it('drops debris when noise crosses thresholds', () => {
    const m = newNoiseMeter();
    let drops = 0;
    for (let i = 0; i < 3; i++) drops += addNoise(m, NOISE.runStep);
    expect(drops).toBe(0);
    for (let i = 0; i < 3; i++) drops += addNoise(m, NOISE.runStep);
    expect(drops).toBeGreaterThan(0);
  });
  it('lets a crouching player cross silently', () => {
    const m = newNoiseMeter();
    let drops = 0;
    for (let i = 0; i < 500; i++) drops += addNoise(m, NOISE.crouchStep);
    expect(drops).toBe(0);
    expect(m.level).toBe(0);
  });
  it('lets a careful walker through but punishes sprinting', () => {
    const run = (step: number, stepsPerSec: number) => {
      const m = newNoiseMeter(); let drops = 0;
      for (let t = 0; t < 12; t += 1 / stepsPerSec) { drops += addNoise(m, step); decayNoise(m, 1 / stepsPerSec); }
      return drops;
    };
    expect(run(NOISE.walkStep, 2)).toBe(0);
    expect(run(NOISE.runStep, 3.2)).toBeGreaterThan(2);
  });
  it('decays back to silence', () => {
    const m = newNoiseMeter();
    addNoise(m, 0.4);
    decayNoise(m, 10);
    expect(m.level).toBe(0);
  });
  it('one hard landing or a kick is enough to shake something loose', () => {
    const m = newNoiseMeter();
    expect(addNoise(m, NOISE.kick)).toBeGreaterThan(0);
  });
});

describe('scarabs and wind', () => {
  it('scarabs only bite in shadow inside their band', () => {
    expect(scarabDamage(true, true, 1)).toBe(0);
    expect(scarabDamage(false, false, 1)).toBe(0);
    expect(scarabDamage(true, false, 1)).toBeGreaterThan(0);
  });
  it('wind is mostly calm with periodic strong gusts', () => {
    let calm = 0, strong = 0, n = 0;
    for (let t = 0; t < 110; t += 0.1) { const g = gustStrength(t); n++; if (g < 0.2) calm++; if (g > 0.75) strong++; expect(g).toBeGreaterThanOrEqual(0); expect(g).toBeLessThanOrEqual(1); }
    expect(calm / n).toBeGreaterThan(0.4);
    expect(strong).toBeGreaterThan(0);
  });
});
