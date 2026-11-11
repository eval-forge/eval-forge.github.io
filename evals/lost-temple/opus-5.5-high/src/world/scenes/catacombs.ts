import * as THREE from 'three';
import type { SceneDef } from '../SceneBase';
import { box3, looseRelics } from '../SceneBase';
import { room, ALL, rubble, skullPile, ossuaryWall, statue } from '../decor';
import { CrumbleFloor, DartTraps, PressurePlate, Blade, Gate, type TileSpec } from '../../entities/Traps';

const Y = -12;
const CRUMBLE: TileSpec[] = [];
for (let r = 0; r < 9; r++) for (let c = 0; c < 2; c++) CRUMBLE.push({ x: -5 + c * 2, z: -135 - r * 2, y: Y, sx: 2, sz: 2 });

const sc = (id: string, x: number, y: number, z: number, nx: number, nz: number) => ({ id, pos: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(nx, 0, nz) });

export const catacombs: SceneDef = {
  id: 'catacombs',
  name: 'Lower catacombs',
  zone: 'C',
  bounds: [box3(-40, -32, -191, 42, -5, -50)],
  exposure: () => ({ outdoor: 0, ambient: 0 }),
  sconces: [
    sc('c_la', -12.7, -10, -115, 1, 0),
    sc('c_os1', -17.7, -10, -126, 1, 0),
    sc('c_os2', 1.7, -10, -122, -1, 0),
    sc('c_jn1', 5.7, -10, -153, -1, 0),
    sc('c_jn2', -9.7, -10, -162, 1, 0),
    sc('c_da', 24, -10, -159.7, 0, 1),
    sc('c_re1', -37.7, -10, -158, 1, 0),
    sc('c_re2', -32, -10, -167.7, 0, 1),
    sc('c_ps1', -28.7, -10, -125, 1, 0),
    sc('c_ps2', -25.3, -10, -95, -1, 0),
    sc('c_va', 2.7, -10, -170, -1, 0),
  ],
  build(b) {
    const W = 'dungeon', F = 'dungeonFloor';
    // landing under the sanctum stairs
    room(b, -13, -118, -7, -112, Y, 4, W, F, [['s', ...ALL], ['n', ...ALL]]);
    // ossuary
    room(b, -18, -134, 2, -118, Y, 5, W, F, [['s', -13, -7], ['n', -6, -2]]);
    ossuaryWall(b, -18, -118.1, -14, -118.1, Y, 5, 1);
    ossuaryWall(b, -17.9, -133, -17.9, -119, Y, 6, 2);
    ossuaryWall(b, 1.9, -133, 1.9, -119, Y, 6, 3);
    skullPile(b, -14, -130, Y, 3); skullPile(b, -1, -121, Y, 4);
    for (let i = 0; i < 4; i++) b.box(-11 + i * 3.5, Y + 0.45, -127, 2.0, 0.9, 0.9, 'carvedDark');
    // crumbling corridor over the bone pit
    b.floor(-6, -152, -2, -134, Y - 5, F);
    b.wallX(-6.5, -152, -134, Y - 5, Y + 4, W);
    b.wallX(-1.5, -152, -134, Y - 5, Y + 4, W);
    b.ceiling(-7, -152, -1, -134, Y + 4, W);
    b.aabb(-6, Y - 5, -134.6, -2, Y - 0.35, -134, W);
    b.aabb(-6, Y - 5, -152, -2, Y - 0.35, -151.4, W);
    skullPile(b, -4, -140, Y - 5, 5); skullPile(b, -3, -147, Y - 5, 6);
    b.climb(-6, Y - 5, -135.4, -2, Y + 0.6, -134.6, [0, 0, -1]);
    b.climb(-6, Y - 5, -151.4, -2, Y + 0.6, -150.6, [0, 0, 1]);
    // junction
    room(b, -10, -164, 6, -152, Y, 5, W, F, [['s', -6, -2], ['e', -160, -156], ['w', -160, -156], ['n', -3, 3]]);
    statue(b, -8, -153.5, Y, 0, 'carvedDark', 1);
    statue(b, 4, -153.5, Y, 0, 'carvedDark', 1);
    // dart corridor
    room(b, 6, -160, 26, -156, Y, 4, W, F, [['w', ...ALL], ['e', ...ALL]]);
    // flooded chamber
    room(b, 26, -172, 40, -146, Y - 1.4, 6.4, W, null, [['w', -160, -156]]);
    b.floor(28, -172, 40, -146, Y - 1.4, F);
    b.floor(26, -172, 28, -160, Y - 1.4, F);
    b.floor(26, -156, 28, -146, Y - 1.4, F);
    b.ramp(26, -160, 28, -156, 'x', Y, Y - 1.4, F);
    b.aabb(34, Y - 1.4, -161, 38, Y + 0.2, -155, F);
    b.water(26, -172, 40, -146, Y - 1.4, Y - 0.05);
    rubble(b, 29, -171, 39, -148, Y - 1.4, 14, 91, 'dungeon', 0.8);
    // blade corridor
    room(b, -24.6, -160, -10, -156, Y, 4.5, W, F, [['e', ...ALL], ['w', ...ALL]]);
    // reliquary
    room(b, -38, -168, -24.6, -148, Y, 5, W, F, [['e', -160, -156], ['s', -29, -25], ['n', -29, -25]]);
    for (const z of [-165, -151]) b.box(-34, Y + 0.5, z, 2.4, 1, 1.2, 'carvedDark');
    ossuaryWall(b, -37.9, -167, -37.9, -149, Y, 4, 7);
    // servants' passage (long, gently lit by nothing at all)
    room(b, -29, -148, -25, -70, Y, 3.5, W, F, [['n', ...ALL], ['s', ...ALL]]);
    for (const z of [-140, -118, -100, -82]) b.aabb(-29.9, Y, z - 1, -29, Y + 2.2, z + 1, 'dungeonFloor', { collide: false });
    skullPile(b, -27, -132, Y, 8); skullPile(b, -26, -90, Y, 9);
    // ramp from the reliquary down to the vault's west ledge (y -12 → -20)
    b.ramp(-29, -168, -25, -190, 'z', Y, -20, F);
    b.wallX(-29.5, -190, -167.5, -21, Y + 4, W);
    b.wallX(-24.5, -190, -167.5, -21, Y + 4, W);
    b.ceiling(-30, -190, -24, -168, Y + 4, W);
    // vault approach + door
    room(b, -3, -176, 3, -164, Y, 4, W, F, [['s', ...ALL], ['n', -3, 3]]);
    b.aabb(-3.5, Y + 4, -177, 3.5, Y + 4.4, -175.5, 'carvedDark', { collide: false });
    // ramp down to the vault (y -12 → -20)
    b.ramp(-3, -176, 3, -188, 'z', Y, -20, F);
    b.wallX(-3.5, -188, -176, -21, Y + 4, W);
    b.wallX(3.5, -188, -176, -21, Y + 4, W);
    b.ceiling(-4, -188, 4, -176.5, Y + 4, W);
  },
  props(seed) {
    return [
      ...looseRelics('catacombs', seed, [[-15, Y + 0.5, -130], [0, Y + 0.5, -120], [4, Y + 0.5, -162], [31, Y - 1, -168], [-36, Y + 0.5, -165], [-36, Y + 0.5, -150], [-33, Y + 1.3, -151], [-28.4, Y + 0.5, -110], [-25.6, Y + 0.5, -85]]),
      { id: 'c_key', kind: 'relic', relicId: 'obsidiankey', pos: [36, Y + 0.6, -158], origin: 'catacombs' },
      { id: 'c_spare', kind: 'spare', pos: [-17, Y + 0.5, -133], origin: 'catacombs' },
      { id: 'c_oil', kind: 'oil', pos: [-9, Y + 0.5, -163], origin: 'catacombs' },
      { id: 'c_spare2', kind: 'spare', pos: [-26, Y + 0.5, -166], origin: 'catacombs' },
      { id: 'c_oil2', kind: 'oil', pos: [-37, Y + 0.5, -156], origin: 'catacombs' },
      { id: 'c_oil3', kind: 'oil', pos: [-27, Y + 0.5, -76], origin: 'catacombs' },
    ];
  },
  spawn(ctx, rt) {
    const run = ctx.run();
    rt.add(new CrumbleFloor(ctx, 'c_crumble', CRUMBLE));
    // dart corridor: two plates, launchers in both side walls
    const darts = rt.add(new DartTraps(ctx));
    const aL = [darts.add(new THREE.Vector3(12, Y + 1.0, -160.4), new THREE.Vector3(0, 0, 1)), darts.add(new THREE.Vector3(12.8, Y + 1.6, -155.6), new THREE.Vector3(0, 0, -1))];
    const aR = [darts.add(new THREE.Vector3(19, Y + 1.2, -155.6), new THREE.Vector3(0, 0, -1)), darts.add(new THREE.Vector3(19.8, Y + 0.7, -160.4), new THREE.Vector3(0, 0, 1))];
    const p1 = rt.add(new PressurePlate(ctx, 12.4, -158, Y, 1.8, 4, 40, () => darts.fire(aL), () => {}, 'carvedDark'));
    const p2 = rt.add(new PressurePlate(ctx, 19.4, -158, Y, 1.8, 4, 40, () => darts.fire(aR), () => {}, 'carvedDark'));
    rt.every(() => { if (p1.state.pressed) darts.fire(aL); if (p2.state.pressed) darts.fire(aR); });
    // blades
    rt.add(new Blade(ctx, new THREE.Vector3(-14, Y + 4.3, -158), 3.5, 'x', 0.75, 2.2, 0));
    rt.add(new Blade(ctx, new THREE.Vector3(-18.3, Y + 4.3, -158), 3.5, 'x', 0.75, 2.2, 1.6));
    rt.add(new Blade(ctx, new THREE.Vector3(-22.3, Y + 4.3, -158), 3.5, 'x', 0.75, 2.2, 3.1));
    // vault door
    const door = rt.add(new Gate(ctx, 'vaultDoor', new THREE.Vector3(0, Y + 2, -176), new THREE.Vector3(6, 4, 1), 4.1, 1.0, 'carvedDark'));
    if (run.flags.vaultOpen && door.target === 0 && !run.entities.get('vaultSlammed')) door.set(1);
    (ctx as any).vaultDoor = door;
    rt.onDetach(() => { (ctx as any).vaultDoor = null; });
    rt.interact({
      pos: new THREE.Vector3(0, Y + 1, -175), radius: 2.8,
      prompt: () => {
        if (door.open > 0.5 || door.target > 0) return null;
        if (run.entities.get('vaultSlammed')) return 'The vault door has slammed shut. Find another way.';
        return run.has('obsidiankey') ? 'E: unlock the vault door with the obsidian key' : 'A heavy door with an obsidian keyhole. (Needs the obsidian key)';
      },
      act: () => {
        if (!run.has('obsidiankey') || run.entities.get('vaultSlammed')) { ctx.audio.play('deny'); return; }
        ctx.setFlag('vaultOpen');
        door.set(1);
        ctx.message('The vault door grinds open.');
        ctx.noise(door.pos, 25);
      },
    });
  },
};
