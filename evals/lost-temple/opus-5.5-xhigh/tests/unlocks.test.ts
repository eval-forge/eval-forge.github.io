import { describe, it, expect } from 'vitest';
import { defaultFlags, tryUnlock, reachableScenes, gateOpen, streamingSet, SCENES, canReachExit, applyCollapse, SCENE_ORDER } from '../src/logic/unlocks';

describe('scene graph', () => {
  it('has 7 scenes in 3 zones with symmetric neighbour lists', () => {
    expect(SCENE_ORDER.length).toBe(7);
    expect(new Set(Object.values(SCENES).map((s) => s.zone))).toEqual(new Set(['A', 'B', 'C']));
    for (const s of Object.values(SCENES)) for (const n of s.neighbors) expect(SCENES[n].neighbors).toContain(s.id);
  });
  it('streams the current scene and its neighbours', () => {
    expect(streamingSet('halls')).toEqual(new Set(['halls', 'courtyard', 'sanctum', 'catacombs']));
  });
});

describe('unlock chain', () => {
  it('at dawn only the outside is reachable', () => {
    const r = reachableScenes(defaultFlags(), 'jungle');
    expect(r).toEqual(new Set(['jungle', 'courtyard', 'cliffs']));
  });
  it('the rope bridge is one way', () => {
    expect(reachableScenes(defaultFlags(), 'courtyard').has('jungle')).toBe(false);
  });
  it('great door → sun seal needs the Sun Disc → vault needs the Bone Key', () => {
    let f = defaultFlags();
    const door = tryUnlock('greatDoor', f, 'courtyard');
    expect(door.ok).toBe(true);
    if (door.ok) f = door.flags;
    expect(reachableScenes(f, 'courtyard').has('halls')).toBe(true);
    expect(reachableScenes(f, 'courtyard').has('catacombs')).toBe(false);

    const noDisc = tryUnlock('sunSeal', f, 'halls');
    expect(noDisc.ok).toBe(false);
    f = { ...f, hasSunDisc: true };
    const seal = tryUnlock('sunSeal', f, 'halls');
    expect(seal.ok).toBe(true);
    if (seal.ok) f = seal.flags;
    expect(f.hasSunDisc).toBe(false); // consumed
    expect(reachableScenes(f, 'courtyard').has('catacombs')).toBe(true);
    expect(reachableScenes(f, 'courtyard').has('vault')).toBe(false);

    expect(tryUnlock('vaultDoor', f, 'catacombs').ok).toBe(false);
    f = { ...f, hasBoneKey: true };
    const vault = tryUnlock('vaultDoor', f, 'catacombs');
    expect(vault.ok).toBe(true);
    if (vault.ok) f = vault.flags;
    expect(reachableScenes(f, 'courtyard').has('vault')).toBe(true);
  });
  it('shortcuts only open from their own side', () => {
    const f = { ...defaultFlags(), greatDoorOpen: true };
    expect(tryUnlock('kickWall', f, 'halls').ok).toBe(false);
    expect(tryUnlock('kickWall', f, 'sanctum').ok).toBe(true);
    expect(tryUnlock('drawbridge', f, 'sanctum').ok).toBe(false);
    expect(tryUnlock('drawbridge', f, 'vault').ok).toBe(true);
  });
  it('the drawbridge gives the vault its own escape route', () => {
    let f = { ...defaultFlags(), greatDoorOpen: true, sunSealOpen: true, vaultDoorOpen: true };
    // the catacomb route is cut (pretend): vault still reaches the exit via the drawbridge once lowered
    const r = tryUnlock('drawbridge', f, 'vault');
    if (r.ok) f = r.flags;
    expect(gateOpen('drawbridge', f)).toBe(true);
    expect(reachableScenes(f, 'vault').has('sanctum')).toBe(true);
    expect(canReachExit(f, 'vault')).toBe(true);
  });
  it('the idol collapse buries the archway; the kick-wall is then the only way out of the sanctum', () => {
    let f = applyCollapse({ ...defaultFlags(), greatDoorOpen: true });
    expect(gateOpen('archway', f)).toBe(false);
    expect(canReachExit(f, 'sanctum')).toBe(false);
    const k = tryUnlock('kickWall', f, 'sanctum');
    expect(k.ok).toBe(true);
    if (k.ok) f = k.flags;
    expect(canReachExit(f, 'sanctum')).toBe(true);
  });
  it('once the great door closes nobody gets out', () => {
    const f = { ...defaultFlags(), greatDoorOpen: true, greatDoorClosed: true };
    expect(canReachExit(f, 'halls')).toBe(false);
    expect(tryUnlock('greatDoor', f, 'courtyard').ok).toBe(false);
  });
});
