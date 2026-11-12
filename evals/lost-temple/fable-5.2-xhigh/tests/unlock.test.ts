import { describe, expect, it } from 'vitest';
import { SCENES, SCENE_ORDER } from '../src/core/scenes';
import {
  ALL_GATES, EDGES, UNLOCKABLES, gateOpen, reachable, route, routeMetres, solveProgression, type Flag,
} from '../src/core/unlock';

const flags = (...f: Flag[]): Set<Flag> => new Set(f);

describe('scene graph', () => {
  it('has at least 7 scenes in 3 zones', () => {
    expect(SCENE_ORDER.length).toBeGreaterThanOrEqual(7);
    expect(new Set(SCENE_ORDER.map((s) => SCENES[s].zone)).size).toBe(3);
    expect(SCENE_ORDER.filter((s) => SCENES[s].zone === 'A').length).toBe(3);
    expect(SCENE_ORDER.filter((s) => SCENES[s].zone === 'B').length).toBe(2);
    expect(SCENE_ORDER.filter((s) => SCENES[s].zone === 'C').length).toBe(2);
  });

  it('Zone C never sees the sky; Zone B only partly', () => {
    for (const s of SCENE_ORDER) {
      const m = SCENES[s];
      if (m.zone === 'C') expect(m.sky).toBe('none');
      if (m.zone === 'B') expect(m.sky).toBe('partial');
      if (m.zone === 'A') expect(m.sky).toBe('open');
    }
  });

  it('streaming neighbours are symmetric', () => {
    for (const s of SCENE_ORDER) for (const n of SCENES[s].neighbours) expect(SCENES[n].neighbours).toContain(s);
  });
});

describe('what is open at the start', () => {
  const start = reachable('jungle', flags());

  it('the outside and the Broken Halls are open', () => {
    expect(start.has('courtyard')).toBe(true);
    expect(start.has('cliffs')).toBe(true);
    expect(start.has('halls')).toBe(true);
  });

  it('everything deeper is locked', () => {
    expect(start.has('sanctum')).toBe(false);
    expect(start.has('catacombs')).toBe(false);
    expect(start.has('vault')).toBe(false);
    expect(start.has('terrace')).toBe(false);
  });
});

describe('unlock rules', () => {
  it('the sun disc alone does nothing until it is set in the seal', () => {
    expect(reachable('jungle', flags('sunDisc')).has('catacombs')).toBe(false);
    expect(reachable('jungle', flags('sunDisc', 'sealOpen')).has('catacombs')).toBe(true);
  });

  it('the vault needs the seal and the serpent key gate', () => {
    expect(reachable('jungle', flags('sealOpen')).has('vault')).toBe(false);
    expect(reachable('jungle', flags('sealOpen', 'serpentKey')).has('vault')).toBe(false);
    expect(reachable('jungle', flags('sealOpen', 'vaultGate')).has('vault')).toBe(true);
    expect(reachable('jungle', flags('vaultGate')).has('vault')).toBe(false);
  });

  it('the sanctum opens with the block puzzle', () => {
    expect(reachable('jungle', flags('sanctumDoor')).has('sanctum')).toBe(true);
  });

  it('the kicked wall reaches the terrace, the drawbridge finishes the shortcut', () => {
    const f = flags('sanctumDoor', 'wallKicked');
    expect(reachable('sanctum', f).has('terrace')).toBe(true);
    expect(route('terrace', 'courtyard', f)).toEqual(['terrace', 'sanctum', 'halls', 'courtyard']);
    f.add('drawbridge');
    expect(route('terrace', 'courtyard', f)).toEqual(['terrace', 'courtyard']);
  });

  it('the drawbridge cannot be crossed from the courtyard until it is lowered', () => {
    expect(reachable('courtyard', flags()).has('terrace')).toBe(false);
    expect(reachable('courtyard', flags('drawbridge')).has('terrace')).toBe(true);
    // ...but the kicked wall still stands in the way of the sanctum.
    expect(reachable('courtyard', flags('drawbridge')).has('sanctum')).toBe(false);
  });

  it('the escape stair links vault and sanctum only once the lever is pulled', () => {
    const before = flags('sealOpen', 'vaultGate');
    expect(route('vault', 'sanctum', before)).toBeNull();
    before.add('escapeStair');
    expect(route('vault', 'sanctum', before)).toEqual(['vault', 'sanctum']);
  });

  it('shortcuts stay open and work both ways', () => {
    const f = flags('sealOpen', 'vaultGate', 'escapeStair', 'wallKicked', 'drawbridge');
    expect(route('courtyard', 'vault', f)).toEqual(['courtyard', 'terrace', 'sanctum', 'vault']);
    expect(route('vault', 'courtyard', f)).toEqual(['vault', 'sanctum', 'terrace', 'courtyard']);
  });
});

describe('the escape route is its own design', () => {
  it('the way out of the vault does not retrace the way in', () => {
    const wayIn = route('courtyard', 'vault', flags('sealOpen', 'vaultGate'))!;
    expect(wayIn).toEqual(['courtyard', 'halls', 'catacombs', 'vault']);
    const wayOut = route('vault', 'courtyard', flags('sealOpen', 'vaultGate', 'escapeStair', 'wallKicked', 'drawbridge'))!;
    const inMid = new Set(wayIn.slice(1, -1));
    for (const node of wayOut.slice(1, -1)) expect(inMid.has(node)).toBe(false);
  });

  it('is shorter than backtracking the way in', () => {
    const all = flags('sealOpen', 'vaultGate', 'escapeStair', 'wallKicked', 'drawbridge');
    const out = routeMetres(route('vault', 'courtyard', all)!);
    const back = routeMetres(route('vault', 'courtyard', flags('sealOpen', 'vaultGate'))!);
    expect(out).toBeLessThan(back);
  });

  it('is made of edges marked as the out route', () => {
    const out = EDGES.filter((e) => e.role === 'out');
    expect(out.map((e) => e.gate)).toEqual(['escapeStair', 'kickWall', 'drawbridge']);
  });
});

describe('progression has no deadlock', () => {
  const result = solveProgression();

  it('every scene becomes reachable', () => {
    for (const s of SCENE_ORDER) expect(result.reachable.has(s)).toBe(true);
    expect(result.reachable.has('terrace')).toBe(true);
  });

  it('every unlockable can be earned', () => {
    expect(result.order.length).toBe(UNLOCKABLES.length);
  });

  it('keys come before their locks', () => {
    const at = (f: Flag): number => result.order.indexOf(f);
    expect(at('sunDisc')).toBeLessThan(at('sealOpen'));
    expect(at('sealOpen')).toBeLessThan(at('serpentKey'));
    expect(at('serpentKey')).toBeLessThan(at('vaultGate'));
    expect(at('vaultGate')).toBeLessThan(at('escapeStair'));
    expect(at('wallKicked')).toBeLessThan(at('drawbridge'));
  });

  it('the vault can be reached without ever opening the sanctum door', () => {
    const f = flags('sunDisc', 'sealOpen', 'serpentKey', 'vaultGate');
    expect(reachable('jungle', f).has('vault')).toBe(true);
    expect(reachable('jungle', f).has('sanctum')).toBe(false);
  });
});

describe('darkness and collapse', () => {
  it('at dark every seal breaks so guardians can reach the door', () => {
    const f = flags('sealsBroken');
    for (const g of ['seal', 'sanctumDoor', 'vaultGate', 'lairGate'] as const) expect(gateOpen(g, f)).toBe(true);
    expect(route('vault', 'courtyard', f)).toEqual(['vault', 'catacombs', 'halls', 'courtyard']);
  });

  it('player-made shortcuts do not open by themselves at dark', () => {
    const f = flags('sealsBroken');
    for (const g of ['escapeStair', 'kickWall', 'drawbridge'] as const) expect(gateOpen(g, f)).toBe(false);
  });

  it('the lair is shut all day', () => {
    expect(gateOpen('lairGate', flags('sealOpen', 'vaultGate', 'escapeStair'))).toBe(false);
  });

  it('a collapse buries the sanctum door, leaving the kicked wall as the way out', () => {
    const f = flags('sanctumDoor', 'doorBuried');
    expect(gateOpen('sanctumDoor', f)).toBe(false);
    expect(route('sanctum', 'courtyard', f)).toBeNull();
    f.add('wallKicked');
    f.add('drawbridge');
    expect(route('sanctum', 'courtyard', f)).toEqual(['sanctum', 'terrace', 'courtyard']);
  });

  it('knows every gate', () => {
    for (const g of ALL_GATES) expect(typeof gateOpen(g, flags())).toBe('boolean');
  });
});
