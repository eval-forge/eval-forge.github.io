/**
 * Zone C: the lower catacombs. No ambient light at all: only your torch and the sconces you
 * light. Stairs from the sanctum seal lead to an ossuary, a gallery whose floor crumbles over
 * a spike pit, a flooded chamber where the Serpent Key waits on an island past a channel deep
 * enough to drown your torch (cross on planks that drop out under you, swim it, or push a block
 * in), a dart corridor, and the ramp down to the serpent door of the
 * vault. The Bone Wing hides the start of the Bone Stair behind a cracked wall that can only
 * be kicked from this side: once broken, it is a shortcut straight up to the broken halls.
 */
import * as THREE from 'three';
import type { SceneDef, SceneCtx, SceneRuntime } from '../SceneDef';
import { box3 } from '../SceneDef';
import type { LevelBuilder } from '../LevelBuilder';
import { useKeyItem } from '../../logic/unlocks';
import { room, rampY, rampCeiling, rampWalls, boneNiches } from './common';
import { CrumbleTiles, DartTrap, Tripwire, RopeBridge } from '../props/traps';
import { PushBlock, Sconce, SlidingSlab, KeyPickup, BreakableWall, SupplyCache } from '../props/mechanisms';

export const F = -14;
export const V = -24;

/** Gallery tiles over the spike pit: 2 across, 5 along. */
const GALLERY_TILES: [number, number, number, number][] = [];
for (let i = 0; i < 5; i++) for (let k = 0; k < 2; k++) GALLERY_TILES.push([4 + k * 2, -92 + i * 2, 6 + k * 2, -90 + i * 2]);

/** Dart corridor plates (staggered). */
const DART_PLATES = [-9, -12.5, -16, -19.5, -23, -26.5].map((x, i) => ({ x, z: i % 2 ? -99.8 : -98.2 }));

export const catacombs: SceneDef = {
  id: 'catacombs',
  zone: 'C',
  env: 'dark',
  boxes: [
    box3(-36, -30, -121, 40, -4, -36),
    box3(-36, -30, -131, -21, -4, -121),
    // the seal stairwell below the sanctum floor, and the Bone Stair
    box3(-19, -16, -104, -15, -0.5, -76),
    box3(25, -16, -86, 31, 3.5, -58.5),
  ],
  spawns: {
    catacombs1: [6, F, -69],
    catacombs2: [-17, F, -70],
  },
  mapRects: [
    [-19, -104, -15, -76],
    [-24, -76, -10, -64],
    [-10, -72, -2, -68],
    [-2, -78, 14, -60],
    [4, -96, 8, -78],
    [-6, -116, 22, -96],
    [-30, -101, -6, -97],
    [-30, -121, -26, -101],
    [-34, -129, -22, -121],
    [22.5, -100, 36, -86],
    [26, -86, 30, -58],
  ],
  respawn: [-17, F + 0.1, -70],
  layout(b: LevelBuilder) {
    // ---- the seal stairwell ----
    // The stairs pass high over the dart corridor (z -101..-97), so the steps and the stairwell
    // walls follow the ramp in 2 m bands instead of standing on the catacomb floor.
    b.ramp(-19, -104, -15, -76, 0, F, 'z', 'dungeonFloor', { steps: true, gate: 'seal', stepDepth: 1.2 });
    for (let z = -104; z < -76 - 1e-3; z += 2) {
      const y0 = rampY(z + 2, -104, 0, -76, F) - 1.2;
      const y1 = Math.min(-0.6, rampY(z, -104, 0, -76, F) + 4.8);
      b.wallZ(z, z + 2, -19.5, -19, y0, y1, 'dungeon', [], { nav: 'none' });
      b.wallZ(z, z + 2, -15, -14.5, y0, y1, 'dungeon', [], { nav: 'none' });
    }
    for (let z = -93; z < -76 - 1e-3; z += 2) {
      const y = rampY(z, -104, 0, -76, F) + 3.6;
      b.box(-17, y + 0.4, z + 1, 5, 0.8, 2, 'dungeon', { nav: 'none' });
    }

    // ---- stair foot ----
    room(b, -24, -76, -10, -64, F, 5, { n: [[-19, -15, 4]], e: [[-72, -68, 3.5]], wall: 'dungeon', floor: 'dungeonFloor' });
    boneNiches(b, -23.5, -10.5, -64, F, -1);
    b.box(-22.6, F + 0.45, -66, 1.2, 0.9, 2.4, 'dungeon');
    // ---- corridor to the ossuary ----
    room(b, -10, -72, -2, -68, F, 3.5, { w: 'open', e: 'open', wall: 'dungeon', floor: 'dungeonFloor' });
    // ---- ossuary ----
    room(b, -2, -78, 14, -60, F, 5, { n: [[4, 8, 4]], w: [[-72, -68, 3.5]], wall: 'dungeon', floor: 'dungeonFloor' });
    boneNiches(b, -1.5, 13.5, -60, F, -1);
    boneNiches(b, -1.5, 3.5, -78, F, 1);
    boneNiches(b, 8.5, 13.5, -78, F, 1);
    for (const x of [1.5, 10.5]) {
      b.box(x, F + 0.45, -64, 2.4, 0.9, 1.2, 'dungeon');
      b.box(x, F + 0.95, -64, 2.5, 0.12, 1.3, 'dungeon', { nav: 'none' });
    }
    if (!b.navOnly) for (let i = 0; i < 10; i++) b.rock(-1 + b.rng.next() * 14, F + 0.1, -77 + b.rng.next() * 3, 0.15 + b.rng.next() * 0.15, 'bone', { collider: false });

    // ---- gallery over the spike pit ----
    room(b, 4, -96, 8, -78, F, 4, { n: 'none', s: 'none', wall: 'dungeon', floor: null });
    b.floor(4, -82, 8, -78, F, 'dungeonFloor');
    b.floor(4, -96, 8, -92, F, 'dungeonFloor');
    b.floor(4, -92, 8, -82, F - 3.5, 'dungeonFloor', { nav: 'none', thick: 0.6 });
    b.wallZ(-92, -82, 3.5, 4, F - 4.1, F, 'dungeon', [], { nav: 'none' });
    b.wallZ(-92, -82, 8, 8.5, F - 4.1, F, 'dungeon', [], { nav: 'none' });
    b.wallX(4, 8, -92.2, -92, F - 4.1, F, 'dungeon', [], { nav: 'none' });
    b.wallX(4, 8, -82, -81.8, F - 4.1, F, 'dungeon', [], { nav: 'none' });
    b.spikes(4, -89, 6, -85, F - 3.5);
    // rubble steps to climb out at either end of the pit
    b.box(7, F - 2.85, -91.4, 2, 1.3, 1.2, 'dungeon', { nav: 'none' });
    b.box(7, F - 2.85, -82.6, 2, 1.3, 1.2, 'dungeon', { nav: 'none' });
    for (const [x0, z0, x1, z1] of GALLERY_TILES) b.navWalk(x0, z0, x1, z1, F);

    // ---- flooded chamber ----
    room(b, -6, -116, 22, -96, F, 6, { floor: null, s: [[4, 8, 4]], w: [[-101, -97, 3.5]], e: 'none', wall: 'dungeon' });
    b.floor(-6, -104.5, 22, -96, F, 'dungeonFloor', { thick: 2.4 });
    b.floor(-6, -116, 22, -108.5, F, 'dungeonFloor', { thick: 2.4 });
    b.floor(-6, -108.5, 22, -104.5, F - 1.8, 'dungeonFloor', { nav: 'none', thick: 0.6 });
    b.water(-6, -116, 22, -96, F - 2, F + 0.6);
    // stone piers either side of the channel at the west end, carrying the plank bridge, each
    // reached by a short stair out of the shallows (a sloped collider: the character controller
    // does not reliably step up separate blocks while wading)
    b.box(-4, F + 0.45, -103.5, 2.4, 0.9, 2, 'dungeon');
    b.box(-4, F + 0.45, -109.5, 2.4, 0.9, 2, 'dungeon');
    b.ramp(-5.2, -102.5, -2.8, -100.5, F + 0.9, F, 'z', 'dungeon', { steps: true });
    b.ramp(-5.2, -112.5, -2.8, -110.5, F, F + 0.9, 'z', 'dungeon', { steps: true });
    // island and the key pedestal
    b.box(9, F + 0.4, -111.75, 10, 0.8, 6.5, 'dungeon', { nav: 'none' });
    b.box(9, F + 1.25, -112, 0.6, 0.9, 0.6, 'dungeon', { nav: 'none' });
    // drowned columns
    for (const [x, z] of [[-2, -100], [16, -100], [-2, -112], [18, -112]] as const) b.cylinder(x, z, F, 6, 0.55, 'dungeon', { seg: 10 });
    // wall shared with the Bone Wing
    b.wallZ(-116.5, -85.5, 22, 22.5, F, F + 6, 'dungeon', [[-100, -96, 3.5]]);
    b.floor(22, -100, 22.5, -96, F, 'dungeonFloor');

    // ---- dart corridor ----
    room(b, -30, -101, -6, -97, F, 3.5, { n: [[-30, -26, 3.5]], e: 'open', wall: 'dungeon', floor: 'dungeonFloor' });
    b.floor(-6.5, -101, -6, -97, F, 'dungeonFloor');
    for (let x = -28; x < -7; x += 3) b.box(x, F + 2.6, -97.1, 0.6, 0.6, 0.15, 'glyphsDark', { nav: 'none', collider: false });

    // ---- ramp down to the vault ----
    b.ramp(-30, -121, -26, -101, V, F, 'z', 'dungeonFloor', { steps: true });
    rampWalls(b, -30, -26, -121, V, -101, F, 3.6);
    rampCeiling(b, -30, -26, -121, V, -101, F, 3.6, 'dungeon');

    // ---- antechamber and the serpent door ----
    room(b, -34, -129, -22, -121, V, 5, { s: [[-30, -26, 3.6]], e: 'none', wall: 'dungeon', floor: 'dungeonFloor' });
    b.wallZ(-129.5, -120.5, -22, -20.5, V, V + 5, 'dungeon', [[-127, -123, 3.6]]);
    b.floor(-22.5, -127, -20, -123, V, 'dungeonFloor', { nav: 'none' });
    b.navWalk(-22.5, -127, -20, -123, V, 'vaultDoor');
    // carved serpents either side of the door
    for (const z of [-127.6, -122.4]) b.box(-22.1, V + 1.8, z, 0.2, 3.2, 0.7, 'glyphsDark', { nav: 'none', collider: false });
    b.box(-22.15, V + 1.3, -128.4, 0.3, 0.5, 0.5, 'dungeon', { nav: 'none' });

    // ---- Bone Wing ----
    room(b, 22.5, -100, 36, -86, F, 5, { w: 'none', n: [[27, 31, 4]], s: 'none', wall: 'dungeon', floor: 'dungeonFloor' });
    b.wallX(22, 36.5, -86, -85.5, F, F + 5, 'dungeon', [[26, 30, 3.2]]);
    boneNiches(b, 23, 26.5, -100, F, 1);
    boneNiches(b, 31.5, 35.5, -100, F, 1);
    b.box(33.5, F + 0.45, -89, 2.4, 0.9, 1.2, 'dungeon');

    // ---- Bone Stair up to the halls (gated until the wall is kicked down) ----
    b.ramp(26, -86, 30, -58, F, 0, 'z', 'dungeonFloor', { steps: true, gate: 'boneWall' });
    rampWalls(b, 26, 30, -86, F, -58, 0, 3.4);
    rampCeiling(b, 26, 30, -86, F, -58, 0, 3.4, 'dungeon');
  },
  *props(ctx: SceneCtx, rt: SceneRuntime) {
    const run = ctx.run;
    const R = ctx.relics;
    // flooded chamber water surface
    const water = new THREE.Mesh(new THREE.PlaneGeometry(28, 20), ctx.mats.waterDark);
    water.rotation.x = -Math.PI / 2;
    water.position.set(8, F + 0.6, -106);
    water.receiveShadow = true;
    rt.group.add(water);

    // gallery crumble tiles
    rt.addProp(
      new CrumbleTiles(ctx, rt, 'gallery', GALLERY_TILES, F, 'dungeonFloor', (i) => {
        const [x0, z0, x1, z1] = GALLERY_TILES[i];
        ctx.nav.setRect(x0, z0, x1, z1, F, false, 0.5);
      }),
    );
    for (const i of (run.get('crumble:gallery') as number[] | undefined) ?? []) {
      const [x0, z0, x1, z1] = GALLERY_TILES[i];
      ctx.nav.setRect(x0, z0, x1, z1, F, false, 0.5);
    }
    yield;

    // the plank bridge over the channel: six planks on ropes that crack and drop like the gorge
    // bridge's, so you cross without stopping or go into the water, torch and all
    rt.addProp(new RopeBridge(ctx, rt, 'floodPlanks', new THREE.Vector3(-4, F + 0.84, -104.5), new THREE.Vector3(-4, F + 0.84, -108.5), 1.8, 6, 0.12));

    // push block that can fill the channel, and the Serpent Key on the island
    rt.addProp(new PushBlock(ctx, rt, 'floodBlock', [1, F, -101], [1.8, 1.8, 1.8], 900, 'dungeon'));
    rt.addProp(new KeyPickup(ctx, rt, 'serpentKey', 'serpentKey', [9, F + 1.7, -112], 'Serpent Key'));

    // dart corridor
    const emitters: { pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
    const plates = DART_PLATES.map((p) => {
      const ids: number[] = [];
      for (const dx of [-0.35, 0.35]) {
        ids.push(emitters.length);
        emitters.push({ pos: new THREE.Vector3(p.x + dx, F + (dx < 0 ? 1.1 : 1.45), -100.92), dir: new THREE.Vector3(0, 0, 1) });
        ids.push(emitters.length);
        emitters.push({ pos: new THREE.Vector3(p.x + dx, F + (dx < 0 ? 1.3 : 0.95), -97.08), dir: new THREE.Vector3(0, 0, -1) });
      }
      return { x: p.x, z: p.z, y: F, size: 1.6, emitters: ids };
    });
    rt.addProp(new DartTrap(ctx, rt, 'dartCorridor', plates, emitters));

    // tripwire on the vault ramp, with darts from the side walls just below it
    const wireZ = -108;
    const wy = rampY(wireZ, -121, V, -101, F) + 0.28;
    const ey1 = rampY(-109.3, -121, V, -101, F);
    const ey2 = rampY(-110.5, -121, V, -101, F);
    const rampDarts = rt.addProp(
      new DartTrap(ctx, rt, 'rampDarts', [], [
        { pos: new THREE.Vector3(-29.92, ey1 + 1.0, -109.3), dir: new THREE.Vector3(1, 0, 0) },
        { pos: new THREE.Vector3(-26.08, ey1 + 1.4, -109.3), dir: new THREE.Vector3(-1, 0, 0) },
        { pos: new THREE.Vector3(-29.92, ey2 + 1.35, -110.5), dir: new THREE.Vector3(1, 0, 0) },
        { pos: new THREE.Vector3(-26.08, ey2 + 0.95, -110.5), dir: new THREE.Vector3(-1, 0, 0) },
      ]),
    );
    rt.addProp(new Tripwire(ctx, rt, 'rampWire', new THREE.Vector3(-29.95, wy, wireZ), new THREE.Vector3(-26.05, wy, wireZ), () => rampDarts.fire()));
    yield;

    // the serpent door and its socket
    rt.addProp(
      new SlidingSlab(ctx, rt, {
        id: 'serpentDoor',
        pos: [-21.25, V + 1.8, -125],
        size: [1.5, 3.6, 4],
        openOffset: [0, 3.65, 0],
        mat: 'dungeon',
        duration: 3.5,
        flag: 'vaultDoorOpen',
        navGate: 'vaultDoor',
      }),
    );
    const key = ctx.models.make('serpentKey');
    key.position.set(-22.45, V + 1.3, -128.4);
    key.rotation.set(0, Math.PI / 2, Math.PI / 2);
    key.visible = run.flag('vaultDoorOpen');
    rt.group.add(key);
    rt.addInteract({
      kind: 'interact',
      id: 'serpentSocket',
      position: new THREE.Vector3(-22.4, V + 1.3, -128.2),
      reach: 2.4,
      prompt: () => {
        if (run.flag('vaultDoorOpen')) return null;
        if (run.unlock.items.has('serpentKey')) return 'E  Turn the Serpent Key in the lock';
        return 'A keyhole shaped like a coiled serpent. The key must be somewhere in these catacombs.';
      },
      interact: () => {
        const r = useKeyItem(run.unlock, 'serpentKey', 'vaultDoor');
        if (!r.ok) {
          ctx.sfx.play('deny');
          return;
        }
        key.visible = true;
        ctx.sfx.play('click', key.position, 1);
        ctx.toast('The serpent door grinds open. The vault lies beyond.', 'good');
        ctx.mapMark(-21, -125, 'serpent door');
      },
    });

    // the Bone Wall: kick it from the Bone Wing side to open the stair to the halls
    rt.addProp(new BreakableWall(ctx, rt, 'boneWall', new THREE.Vector3(28, F + 1.6, -85.75), new THREE.Vector3(4, 3.2, 0.5), new THREE.Vector3(0, 0, -1), 'boneWallBroken', 'boneWall'));
    yield;

    // sconces
    const sconces: [string, [number, number, number], number][] = [
      ['footSconceA', [-23.75, F + 2.4, -72], Math.PI / 2],
      ['footSconceB', [-12, F + 2.4, -64.25], Math.PI],
      ['ossSconceA', [13.75, F + 2.4, -66], -Math.PI / 2],
      ['ossSconceB', [-1.75, F + 2.4, -62], Math.PI / 2],
      ['floodSconceA', [-1, F + 2.6, -96.25], Math.PI],
      ['floodSconceB', [-5.75, F + 2.6, -110], Math.PI / 2],
      ['dartSconce', [-18, F + 2.2, -97.25], Math.PI],
      ['anteSconce', [-33.75, V + 2.4, -125], Math.PI / 2],
      ['boneSconce', [35.75, F + 2.4, -93], -Math.PI / 2],
    ];
    for (const [id, pos, rot] of sconces) rt.addProp(new Sconce(ctx, rt, id, pos, rot));

    // relics: everything down here is worth more
    rt.addProp(new SupplyCache(ctx, rt, 'footTorch', 'torch', [-12, F, -73.5], 2.2));
    rt.addProp(new SupplyCache(ctx, rt, 'ossuaryOil', 'oil', [8.5, F, -72], -0.6));
    rt.addProp(new SupplyCache(ctx, rt, 'anteOil', 'oil', [-31, V, -122.6], 0.9));
    R.relicSpawn('k1', 'catacombs', 'C', [-22.6, F + 0.9, -66]);
    R.relicSpawn('k2', 'catacombs', 'C', [10.5, F + 1.0, -64]);
    R.relicSpawn('k3', 'catacombs', 'C', [-1.2, F + 1.75, -77.7], { maxRarity: 'rare' });
    R.relicSpawn('k4', 'catacombs', 'C', [6, F, -94.5]);
    R.relicSpawn('k5', 'catacombs', 'C', [11.5, F + 0.8, -114], { minRarity: 'rare' });
    R.relicSpawn('k6', 'catacombs', 'C', [-4, F, -114], { minRarity: 'uncommon' });
    R.relicSpawn('k7', 'catacombs', 'C', [-18, F, -99]);
    R.relicSpawn('k8', 'catacombs', 'C', [-32.5, V, -127.5], { minRarity: 'uncommon' });
    R.relicSpawn('k9', 'catacombs', 'C', [33.5, F + 0.9, -89]);
  },
};
