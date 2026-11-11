import { describe, expect, it } from 'vitest';
import {
  EDGES, canTraverse, fallNight, newProgress, reachable, sceneRoute, sundialSolved, takeSunDisc, useSerpentKey, useSunDiscOnSeal,
} from '../src/core/unlock';
import { SCENE_ORDER } from '../src/core/types';

describe('scene graph', () => {
  it('has at least seven scenes, all connected to the graph', () => {
    expect(SCENE_ORDER.length).toBeGreaterThanOrEqual(7);
    for (const s of SCENE_ORDER) expect(EDGES.some((e) => e.a === s || e.b === s)).toBe(true);
  });
  it('starts with only the outside reachable', () => {
    const r = reachable('jungle', newProgress());
    expect([...r].sort()).toEqual(['courtyard', 'jungle']);
  });
});

describe('unlock chain', () => {
  it('the Great Door opens when the Sun Disc is lifted from the sundial', () => {
    const p = newProgress();
    expect(canTraverse('courtyard', 'halls', p)).toBe(false);
    takeSunDisc(p);
    expect(canTraverse('courtyard', 'halls', p)).toBe(true);
    expect(reachable('jungle', p).has('cliffs')).toBe(true);
  });
  it('the portcullis needs weight on the plate', () => {
    const p = newProgress(); takeSunDisc(p);
    expect(canTraverse('halls', 'sanctum', p)).toBe(false);
    p.portcullisOpen = true;
    expect(canTraverse('halls', 'sanctum', p)).toBe(true);
  });
  it('the catacomb seal needs the Sun Disc', () => {
    const p = newProgress();
    expect(useSunDiscOnSeal(p)).toBe(false);
    takeSunDisc(p); p.portcullisOpen = true;
    expect(canTraverse('sanctum', 'catacombs', p)).toBe(false);
    expect(useSunDiscOnSeal(p)).toBe(true);
    expect(canTraverse('sanctum', 'catacombs', p)).toBe(true);
    expect(useSunDiscOnSeal(p)).toBe(false);
  });
  it('the vault needs the Serpent Key and an intact bridge', () => {
    const p = newProgress(); takeSunDisc(p); p.portcullisOpen = true; useSunDiscOnSeal(p);
    expect(useSerpentKey(p)).toBe(false);
    expect(canTraverse('catacombs', 'vault', p)).toBe(false);
    p.hasSerpentKey = true;
    expect(useSerpentKey(p)).toBe(true);
    expect(canTraverse('catacombs', 'vault', p)).toBe(true);
    p.chasmBridgeIntact = false;
    expect(canTraverse('catacombs', 'vault', p)).toBe(false);
  });
  it('full progression reaches every scene', () => {
    const p = newProgress(); takeSunDisc(p); p.portcullisOpen = true; useSunDiscOnSeal(p); p.hasSerpentKey = true; useSerpentKey(p);
    expect(reachable('jungle', p).size).toBe(7);
  });
});

describe('shortcuts and the way out', () => {
  const deep = () => {
    const p = newProgress(); takeSunDisc(p); p.portcullisOpen = true; useSunDiscOnSeal(p); p.hasSerpentKey = true; useSerpentKey(p);
    return p;
  };
  it('the rope bridge is one way: the vault has no exit until the drawbridge drops', () => {
    const p = deep();
    p.chasmBridgeIntact = false;
    expect(canTraverse('vault', 'catacombs', p)).toBe(false);
    expect(sceneRoute('vault', 'courtyard', p)).toBeNull();
    p.drawbridgeDown = true;
    expect(canTraverse('vault', 'catacombs', p)).toBe(true);
    expect(sceneRoute('vault', 'courtyard', p)).not.toBeNull();
  });
  it('kicked walls stay open in both directions', () => {
    const p = deep();
    expect(canTraverse('sanctum', 'cliffs', p)).toBe(false);
    expect(canTraverse('catacombs', 'sanctum', p)).toBe(true); // main stair
    p.kickEast = true; p.kickSmuggler = true;
    expect(canTraverse('sanctum', 'cliffs', p)).toBe(true);
    expect(canTraverse('cliffs', 'sanctum', p)).toBe(true);
  });
  it('the idol collapse forces the escape over the cliffs', () => {
    const p = deep();
    p.rubblePlug = true;
    expect(canTraverse('sanctum', 'halls', p)).toBe(false);
    expect(sceneRoute('sanctum', 'courtyard', p)).toBeNull();
    p.kickEast = true;
    expect(sceneRoute('sanctum', 'courtyard', p)).toEqual(['sanctum', 'cliffs', 'halls', 'courtyard']);
  });
  it('the escape route differs from the way in', () => {
    const p = deep();
    const wayIn = sceneRoute('courtyard', 'vault', p)!;
    p.chasmBridgeIntact = false; p.drawbridgeDown = true; p.rubblePlug = true; p.kickEast = true; p.kickSmuggler = true;
    const wayOut = sceneRoute('vault', 'courtyard', p)!;
    expect(wayOut).not.toEqual([...wayIn].reverse());
    expect(wayOut).toContain('cliffs');
  });
});

describe('night', () => {
  it('opens the inner gates for the guardians', () => {
    const p = newProgress(); takeSunDisc(p);
    fallNight(p);
    expect(canTraverse('vault', 'catacombs', p)).toBe(true);
    expect(canTraverse('catacombs', 'sanctum', p)).toBe(true);
    expect(canTraverse('sanctum', 'halls', p)).toBe(true);
    expect(sceneRoute('vault', 'courtyard', p)).not.toBeNull();
  });
  it('a sealed Great Door ends every route out', () => {
    const p = newProgress(); takeSunDisc(p); fallNight(p);
    p.doorSealed = true;
    expect(canTraverse('halls', 'courtyard', p)).toBe(false);
    expect(sceneRoute('vault', 'courtyard', p)).toBeNull();
  });
});

describe('sundial puzzle', () => {
  it('is solved only when the dial lines up with the real shadow', () => {
    expect(sundialSolved(1.0, 1.05)).toBe(true);
    expect(sundialSolved(1.0, 1.6)).toBe(false);
    expect(sundialSolved(0.05, Math.PI * 2 - 0.05)).toBe(true);
    expect(sundialSolved(1.0, null)).toBe(false);
  });
});
