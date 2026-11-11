import { describe, expect, it } from 'vitest';
import {
  CrackTimer, DAMAGE, DartTrigger, LETHAL_FALL_SPEED, NoiseMeter, OneShot, PEDESTAL_GRACE, PEDESTAL_TOLERANCE,
  PedestalSensor, PressurePlate, SAFE_FALL_SPEED, allPressed, bladeAngle, bladeAngularVelocity, bladeInLane,
  fallDamage, swapIsSafe,
} from '../src/core/traps';
import { NOISE_SHAKE } from '../src/core/noise';

const step = (fn: (dt: number) => boolean, seconds: number, dt = 1 / 60): boolean => {
  let fired = false;
  for (let t = 0; t < seconds; t += dt) fired = fn(dt) || fired;
  return fired;
};

describe('trapped pedestal', () => {
  it('stays quiet while the relic sits on it', () => {
    const p = new PedestalSensor(4);
    expect(step((dt) => p.update(dt), 5)).toBe(false);
    expect(p.fired).toBe(false);
  });

  it('fires if the relic is lifted with nothing swapped in', () => {
    const p = new PedestalSensor(4);
    p.setWeight(0);
    expect(step((dt) => p.update(dt), PEDESTAL_GRACE - 0.1)).toBe(false);
    expect(step((dt) => p.update(dt), 0.2)).toBe(true);
    expect(p.fired).toBe(true);
  });

  it('fires only once', () => {
    const p = new PedestalSensor(4);
    p.setWeight(0);
    let count = 0;
    for (let i = 0; i < 600; i++) if (p.update(1 / 60)) count++;
    expect(count).toBe(1);
  });

  it('does not fire if an object of equal weight is swapped in', () => {
    const p = new PedestalSensor(4);
    p.setWeight(4);
    expect(step((dt) => p.update(dt), 5)).toBe(false);
  });

  it('accepts a swap within the tolerance and rejects one outside it', () => {
    expect(swapIsSafe(4, 4 * (1 + PEDESTAL_TOLERANCE))).toBe(true);
    expect(swapIsSafe(4, 4 * (1 - PEDESTAL_TOLERANCE))).toBe(true);
    expect(swapIsSafe(4, 4 * (1 + PEDESTAL_TOLERANCE) + 0.05)).toBe(false);
    expect(swapIsSafe(4, 2)).toBe(false);
    expect(swapIsSafe(8, 0)).toBe(false);

    const light = new PedestalSensor(8);
    light.setWeight(4);
    expect(step((dt) => light.update(dt), 1)).toBe(true);
    const heavy = new PedestalSensor(2);
    heavy.setWeight(6);
    expect(step((dt) => heavy.update(dt), 1)).toBe(true);
  });

  it('forgives a swap completed inside the grace period', () => {
    const p = new PedestalSensor(3);
    p.setWeight(0);
    step((dt) => p.update(dt), PEDESTAL_GRACE * 0.6);
    p.setWeight(3.2);
    expect(step((dt) => p.update(dt), 3)).toBe(false);
  });

  it('fires later if the counterweight is taken away again', () => {
    const p = new PedestalSensor(3);
    p.setWeight(3);
    step((dt) => p.update(dt), 2);
    p.setWeight(0);
    expect(step((dt) => p.update(dt), 1)).toBe(true);
  });

  it('can be disarmed', () => {
    const p = new PedestalSensor(3);
    p.disarm();
    p.setWeight(0);
    expect(step((dt) => p.update(dt), 2)).toBe(false);
  });
});

describe('pressure plate', () => {
  it('ignores loads under the threshold', () => {
    const p = new PressurePlate(150);
    expect(p.update(80, 0.1)).toBeNull();
    expect(p.pressed).toBe(false);
  });

  it('presses at the threshold and reports it once', () => {
    const p = new PressurePlate(150);
    expect(p.update(150, 0.1)).toBe('pressed');
    expect(p.update(400, 0.1)).toBeNull();
    expect(p.pressed).toBe(true);
  });

  it('releases after a short delay when the load leaves', () => {
    const p = new PressurePlate(60, false, 0.25);
    p.update(80, 0.1);
    expect(p.update(0, 0.1)).toBeNull();
    expect(p.pressed).toBe(true);
    expect(p.update(0, 0.2)).toBe('released');
    expect(p.pressed).toBe(false);
  });

  it('a brief hop does not release it', () => {
    const p = new PressurePlate(60, false, 0.25);
    p.update(80, 0.1);
    p.update(0, 0.1);
    p.update(80, 0.1);
    expect(p.update(0, 0.2)).toBeNull();
    expect(p.pressed).toBe(true);
  });

  it('latching plates never release', () => {
    const p = new PressurePlate(60, true);
    p.update(80, 0.1);
    for (let i = 0; i < 100; i++) expect(p.update(0, 0.1)).toBeNull();
    expect(p.pressed).toBe(true);
  });

  it('a door needs every plate down', () => {
    const a = new PressurePlate(150);
    const b = new PressurePlate(150);
    expect(allPressed([a, b])).toBe(false);
    a.update(400, 0.1);
    expect(allPressed([a, b])).toBe(false);
    b.update(400, 0.1);
    expect(allPressed([a, b])).toBe(true);
    expect(allPressed([])).toBe(false);
  });

  it('the player alone cannot hold a block plate, a stone block can', () => {
    const p = new PressurePlate(150);
    expect(p.update(80 + 20, 1)).toBeNull();
    expect(p.update(400, 1)).toBe('pressed');
  });
});

describe('cracking planks and crumbling floors', () => {
  it('stays intact until stepped on', () => {
    const c = new CrackTimer(0.8);
    for (let i = 0; i < 100; i++) expect(c.update(0, 0.1)).toBeNull();
    expect(c.state).toBe('intact');
    expect(c.progress).toBe(0);
  });

  it('cracks when loaded, then breaks after the delay', () => {
    const c = new CrackTimer(0.8);
    expect(c.update(80, 1 / 60)).toBe('cracked');
    expect(c.state).toBe('cracking');
    let broke = false;
    let t = 0;
    while (!broke && t < 2) {
      broke = c.update(80, 1 / 60) === 'broke';
      t += 1 / 60;
    }
    expect(broke).toBe(true);
    expect(t).toBeGreaterThan(0.75);
    expect(t).toBeLessThan(0.9);
    expect(c.state).toBe('broken');
  });

  it('keeps breaking even if you step off: you cannot stop on it, and you cannot save it', () => {
    const c = new CrackTimer(0.5);
    c.update(80, 0.01);
    let ev: string | null = null;
    for (let i = 0; i < 60 && !ev; i++) ev = c.update(0, 0.01);
    expect(ev).toBe('broke');
  });

  it('ignores light loads such as a thrown rock', () => {
    const c = new CrackTimer(0.5, 30);
    expect(c.update(4, 1)).toBeNull();
    expect(c.state).toBe('intact');
  });

  it('reports progress and stays broken', () => {
    const c = new CrackTimer(1);
    c.update(80, 0.01);
    c.update(80, 0.5);
    expect(c.progress).toBeCloseTo(0.5, 1);
    c.update(80, 0.6);
    expect(c.progress).toBe(1);
    expect(c.update(80, 1)).toBeNull();
  });

  it('can be restored as already broken', () => {
    const c = new CrackTimer(1);
    c.forceBroken();
    expect(c.state).toBe('broken');
    expect(c.update(80, 1)).toBeNull();
  });
});

describe('dart trap', () => {
  it('fires nothing until triggered', () => {
    const d = new DartTrigger();
    expect(d.update(1)).toBe(0);
  });

  it('gives a beat of warning, then fires the full set of volleys', () => {
    const d = new DartTrigger(3, 0.35, 2.5, 0.25);
    expect(d.trigger()).toBe(true);
    expect(d.update(0.2)).toBe(0);
    let total = 0;
    for (let i = 0; i < 200; i++) total += d.update(0.01);
    expect(total).toBe(3);
    expect(d.totalFired).toBe(3);
  });

  it('cannot be re-triggered during the volley or the cooldown', () => {
    const d = new DartTrigger(3, 0.35, 2.5, 0.25);
    d.trigger();
    expect(d.trigger()).toBe(false);
    for (let i = 0; i < 150; i++) d.update(0.01);
    expect(d.trigger()).toBe(false);
    for (let i = 0; i < 300; i++) d.update(0.01);
    expect(d.busy).toBe(false);
    expect(d.trigger()).toBe(true);
  });

  it('launches several volleys in one long step rather than losing them', () => {
    const d = new DartTrigger(3, 0.35, 2.5, 0.25);
    d.trigger();
    expect(d.update(5)).toBe(3);
  });
});

describe('unstable ceiling (noise meter)', () => {
  it('quiet movement never brings debris down', () => {
    const m = new NoiseMeter();
    let drops = 0;
    for (let i = 0; i < 600; i++) {
      if (i % 30 === 0) m.add(NOISE_SHAKE.stepCrouch);
      if (i % 30 === 15) m.add(NOISE_SHAKE.stepWalk);
      drops += m.update(1 / 60);
    }
    expect(drops).toBe(0);
  });

  it('sprinting does', () => {
    const m = new NoiseMeter();
    let drops = 0;
    for (let i = 0; i < 600; i++) {
      if (i % 18 === 0) m.add(NOISE_SHAKE.stepSprint);
      drops += m.update(1 / 60);
    }
    expect(drops).toBeGreaterThan(0);
  });

  it('one loud impact plus a landing is enough', () => {
    const m = new NoiseMeter();
    m.add(NOISE_SHAKE.impact);
    m.add(NOISE_SHAKE.land);
    m.add(NOISE_SHAKE.trap);
    expect(m.update(1 / 60)).toBeGreaterThanOrEqual(1);
  });

  it('settles back down in silence', () => {
    const m = new NoiseMeter();
    m.add(0.8);
    expect(m.strain).toBeCloseTo(0.8, 5);
    for (let i = 0; i < 600; i++) m.update(1 / 60);
    expect(m.level).toBe(0);
  });

  it('each drop relieves some strain', () => {
    const m = new NoiseMeter(1, 0, 0.55);
    m.add(1.2);
    expect(m.update(0.01)).toBe(1);
    expect(m.level).toBeCloseTo(0.65, 5);
  });

  it('collapse mode drops debris on an accelerating timer regardless of noise', () => {
    const m = new NoiseMeter();
    m.startCollapse();
    let first10 = 0;
    for (let i = 0; i < 600; i++) first10 += m.update(1 / 60);
    let next10 = 0;
    for (let i = 0; i < 600; i++) next10 += m.update(1 / 60);
    expect(first10).toBeGreaterThan(8);
    expect(next10).toBeGreaterThan(first10);
    expect(m.strain).toBe(1);
    expect(NoiseMeter.collapseInterval(100)).toBeCloseTo(0.18, 5);
  });
});

describe('swinging blade', () => {
  it('swings symmetrically with the given period', () => {
    expect(bladeAngle(0, 1, 2)).toBeCloseTo(1, 6);
    expect(bladeAngle(1, 1, 2)).toBeCloseTo(-1, 6);
    expect(bladeAngle(2, 1, 2)).toBeCloseTo(1, 6);
    expect(bladeAngle(0.5, 1, 2)).toBeCloseTo(0, 6);
  });

  it('is fastest at the bottom and still at the top', () => {
    expect(Math.abs(bladeAngularVelocity(0.5, 1, 2))).toBeCloseTo(Math.PI, 5);
    expect(bladeAngularVelocity(0, 1, 2)).toBeCloseTo(0, 6);
  });

  it('only blocks the walkway near the bottom of the swing', () => {
    expect(bladeInLane(bladeAngle(0.5, 1.1, 2))).toBe(true);
    expect(bladeInLane(bladeAngle(0, 1.1, 2))).toBe(false);
    let inLane = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) if (bladeInLane(bladeAngle((i / n) * 2, 1.1, 2))) inLane++;
    // There is a real gap to run through: the lane is clear most of the time.
    expect(inLane / n).toBeLessThan(0.35);
    expect(inLane / n).toBeGreaterThan(0.1);
  });
});

describe('one-shot releases and damage numbers', () => {
  it('a boulder chock releases once, after its delay', () => {
    const o = new OneShot(0.5);
    expect(o.update(1)).toBe(false);
    expect(o.trigger()).toBe(true);
    expect(o.trigger()).toBe(false);
    expect(o.update(0.3)).toBe(false);
    expect(o.update(0.3)).toBe(true);
    expect(o.update(1)).toBe(false);
    expect(o.trigger()).toBe(false);
  });

  it('short drops are free, long falls kill', () => {
    expect(fallDamage(SAFE_FALL_SPEED - 1)).toBe(0);
    expect(fallDamage(SAFE_FALL_SPEED + 2)).toBeGreaterThan(0);
    expect(fallDamage(LETHAL_FALL_SPEED)).toBe(100);
    expect(fallDamage(18)).toBeGreaterThan(fallDamage(15));
  });

  it('a boulder is lethal, a single dart is not', () => {
    expect(DAMAGE.boulder).toBeGreaterThanOrEqual(100);
    expect(DAMAGE.dart).toBeLessThan(50);
    expect(DAMAGE.blade).toBeLessThan(100);
  });
});
