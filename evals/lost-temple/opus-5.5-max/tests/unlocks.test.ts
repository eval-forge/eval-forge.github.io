import { describe, it, expect } from 'vitest';
import { newUnlockState, reachable, canEnter, useKeyItem, route, CONNECTIONS, ENTRY_ROUTE, ESCAPE_ROUTE, SCENE_IDS, SCENE_INFO, hintsFor } from '../src/logic/unlocks';

describe('scene graph', () => {
  it('has at least seven scenes in three zones', () => {
    expect(SCENE_IDS.length).toBeGreaterThanOrEqual(7);
    const zones = new Set(SCENE_IDS.map((s) => SCENE_INFO[s].zone));
    expect(zones).toEqual(new Set(['A', 'B', 'C']));
  });
  it('starts with only the outside reachable', () => {
    const s = newUnlockState();
    expect([...reachable(s)].sort()).toEqual(['cliffs', 'courtyard', 'jungle']);
    expect(canEnter('halls', s)).toBe(false);
  });
  it('the great door opens the ruins', () => {
    const s = newUnlockState();
    s.flags.add('greatDoorOpen');
    expect(canEnter('halls', s)).toBe(true);
    expect(canEnter('sanctum', s)).toBe(true);
    expect(canEnter('catacombs', s)).toBe(false);
  });
  it('the Sun-Disc opens the catacomb seal, only with the disc', () => {
    const s = newUnlockState();
    s.flags.add('greatDoorOpen');
    expect(useKeyItem(s, 'sunDisc', 'seal')).toMatchObject({ ok: false, reason: 'missingItem' });
    s.items.add('sunDisc');
    expect(useKeyItem(s, 'serpentKey', 'seal')).toMatchObject({ ok: false, reason: 'wrongTarget' });
    expect(useKeyItem(s, 'sunDisc', 'seal')).toMatchObject({ ok: true, flag: 'sealOpen' });
    expect(canEnter('catacombs', s)).toBe(true);
    expect(canEnter('vault', s)).toBe(false);
    expect(useKeyItem(s, 'sunDisc', 'seal')).toMatchObject({ ok: false, reason: 'alreadyOpen' });
  });
  it('the Serpent Key opens the vault', () => {
    const s = newUnlockState();
    s.flags.add('greatDoorOpen');
    s.flags.add('sealOpen');
    s.items.add('serpentKey');
    expect(useKeyItem(s, 'serpentKey', 'vaultDoor').ok).toBe(true);
    expect(route('jungle', 'vault', s)).toEqual(['jungle', 'courtyard', 'halls', 'sanctum', 'catacombs', 'vault']);
  });
  it('closing the door cuts the ruins off', () => {
    const s = newUnlockState();
    s.flags.add('greatDoorOpen');
    s.flags.add('doorShut');
    expect(canEnter('halls', s)).toBe(false);
    expect(hintsFor('halls', s)[0]).toMatch(/closed/);
  });
});

describe('shortcuts and the escape route', () => {
  it('shortcuts shorten the way out once opened', () => {
    const s = newUnlockState();
    for (const f of ['greatDoorOpen', 'sealOpen', 'vaultDoorOpen'] as const) s.flags.add(f);
    const before = route('vault', 'courtyard', s)!;
    s.flags.add('aqueductOpen');
    s.flags.add('boneWallBroken');
    const after = route('vault', 'courtyard', s)!;
    expect(after.length).toBeLessThan(before.length);
    expect(after).not.toContain('sanctum');
  });
  it('rubble in the nave leaves the side aisle open', () => {
    const s = newUnlockState();
    s.flags.add('greatDoorOpen');
    s.flags.add('naveBlocked');
    expect(canEnter('sanctum', s)).toBe(true);
  });
  it('the escape route is its own path, not the way in backwards', () => {
    const shared = ESCAPE_ROUTE.filter((c) => ENTRY_ROUTE.includes(c));
    expect(shared).toEqual(['greatDoor']);
    for (const id of [...ENTRY_ROUTE, ...ESCAPE_ROUTE]) expect(CONNECTIONS.find((c) => c.id === id)).toBeTruthy();
  });
});
