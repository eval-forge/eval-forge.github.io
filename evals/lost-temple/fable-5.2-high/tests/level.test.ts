import { describe, expect, it } from 'vitest';
import { lootValueByZone, placeLoot, RELICS } from '../src/core/economy';
import { NavMesh } from '../src/core/navmesh';
import { SCENE_INFO, SCENE_ORDER, type SceneId } from '../src/core/types';
import { SCENES } from '../src/world/scenes';

/** These tests run on the level data the game actually ships, not on fixtures. */

const allSpots = SCENE_ORDER.flatMap((id) => SCENES[id].loot);
const allNav = SCENE_ORDER.flatMap((id) => SCENES[id].nav);
const TAGS = ['portcullis', 'seal', 'vaultDoor', 'drawbridge', 'chasmBridge', 'kickEast', 'kickSmuggler'];
const DOOR = { x: 0, y: 0, z: -12 };

function nightMesh(): NavMesh {
  const nav = new NavMesh(allNav);
  for (const t of TAGS) nav.setTagEnabled(t, true);
  return nav;
}

describe('the shipped level: loot', () => {
  it('has seven scenes in three zones', () => {
    expect(SCENE_ORDER.length).toBe(7);
    expect(new Set(SCENE_ORDER.map((id) => SCENE_INFO[id].zone))).toEqual(new Set(['A', 'B', 'C']));
  });

  it('gives every scene loot and uses unique spot ids', () => {
    for (const id of SCENE_ORDER) expect(SCENES[id].loot.length, id).toBeGreaterThan(0);
    expect(new Set(allSpots.map((s) => s.id)).size).toBe(allSpots.length);
    for (const id of SCENE_ORDER) for (const s of SCENES[id].loot) expect(s.scene).toBe(id);
  });

  it('is worth more the deeper the zone, for many seeds', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const placed = placeLoot(allSpots, seed);
      const total = lootValueByZone(placed);
      const count = { A: 0, B: 0, C: 0 };
      for (const p of placed) count[SCENE_INFO[p.spot.scene].zone]++;
      expect(total.A, `seed ${seed}`).toBeLessThan(total.B);
      expect(total.B, `seed ${seed}`).toBeLessThan(total.C);
      expect(total.A / count.A).toBeLessThan(total.B / count.B);
      expect(total.B / count.B).toBeLessThan(total.C / count.C);
    }
  });

  it('can place every one of the relic types somewhere over a handful of runs', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) for (const p of placeLoot(allSpots, seed)) seen.add(p.relic.id);
    expect(RELICS.length).toBeGreaterThanOrEqual(15);
    // Story relics (the idol and so on) are fixed; everything else must be reachable by the dice.
    for (const r of RELICS) expect(seen.has(r.id), r.id).toBe(true);
  });

  it('puts the main idol in the sanctum behind the collapse trap', () => {
    const idol = SCENES.sanctum.loot.find((s) => s.fixed === 'jaguarIdol');
    expect(idol?.trap).toBe('collapse');
  });
});

describe('the shipped level: navmesh', () => {
  it('has guardians in zone B and C scenes only, deepest scene holding the most', () => {
    expect(SCENES.jungle.guardians.length + SCENES.courtyard.guardians.length + SCENES.cliffs.guardians.length).toBe(0);
    expect(SCENES.vault.guardians.length).toBeGreaterThanOrEqual(SCENES.catacombs.guardians.length);
    const kinds = new Set(SCENE_ORDER.flatMap((id) => SCENES[id].guardians.map((g) => g.kind)));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it('gives every guardian a walkable route from its lair to the Great Door at night', () => {
    const nav = nightMesh();
    for (const id of SCENE_ORDER) for (const g of SCENES[id].guardians) {
      const from = { x: g.pos[0], y: g.pos[1], z: g.pos[2] };
      const res = nav.findPath(from, DOOR);
      expect(res, `${id} ${g.kind} from ${g.pos}`).not.toBeNull();
      expect(res!.length).toBeGreaterThan(5);
    }
  });

  it('can reach every sweep waypoint in order', () => {
    const nav = nightMesh();
    for (const id of SCENE_ORDER) for (const g of SCENES[id].guardians) {
      let at = { x: g.pos[0], y: g.pos[1], z: g.pos[2] };
      for (const w of g.sweep) {
        const to = nav.clampPoint(w[0], w[1], w[2]);
        expect(to, `${id} ${g.kind} waypoint ${w}`).not.toBeNull();
        expect(nav.findPath(at, to!), `${id} ${g.kind} ${JSON.stringify(at)} -> ${w}`).not.toBeNull();
        at = to!;
      }
    }
  });

  it('can path between any two points of the halls floor', () => {
    const nav = nightMesh();
    const pts: [number, number][] = [[11, -10.5], [4, -20], [12, -50], [-12, -50], [0, -47], [-9, -30], [9, -30], [0, -14], [-13, -9], [13, -51], [0, -23], [6, -33]];
    for (const a of pts) for (const b of pts) {
      if (a === b) continue;
      expect(nav.findPath({ x: a[0], y: 0, z: a[1] }, { x: b[0], y: 0, z: b[1] }), `${a} -> ${b}`).not.toBeNull();
    }
  });

  it('keeps the vault shut off from the catacombs by day until the door or drawbridge opens', () => {
    const nav = new NavMesh(allNav);
    for (const t of TAGS) nav.setTagEnabled(t, false);
    nav.setTagEnabled('chasmBridge', true);
    const lair = { x: -73, y: -10, z: -79 }, junction = { x: -34, y: -10, z: -95 };
    expect(nav.findPath(lair, junction)).toBeNull();
    nav.setTagEnabled('vaultDoor', true);
    expect(nav.findPath(lair, junction)).not.toBeNull();
    nav.setTagEnabled('vaultDoor', false); nav.setTagEnabled('chasmBridge', false);
    nav.setTagEnabled('drawbridge', true);
    expect(nav.findPath(lair, junction)).not.toBeNull();
  });

  it('routes round a broken chasm bridge by the drawbridge', () => {
    const nav = nightMesh();
    const lair = { x: -73, y: -10, z: -79 };
    const withBridge = nav.findPath(lair, DOOR)!.length;
    nav.setTagEnabled('chasmBridge', false);
    const without = nav.findPath(lair, DOOR);
    expect(without).not.toBeNull();
    expect(without!.length).toBeGreaterThan(withBridge);
  });
});
