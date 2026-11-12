import * as THREE from 'three';
import { carve, type NavRect } from '../../core/navmesh';
import { DMG } from '../../core/traps';
import { useSerpentKey } from '../../core/unlock';
import type { SceneBuilder, SetPiece } from '../../engine/builder';
import { CG, RAPIER } from '../../engine/physics';
import type { Game } from '../../game/Game';
import { bonePile, keyMesh, pillar } from '../props';
import { CrumbleFloor, DartLauncher, HazardZone, Pickup, PressurePlate, RopeBridge, SlideDoor, addVines, addWater, dartRow, type TileDef } from '../setpieces';
import type { Interactable, SceneDef } from '../types';
import { KillZone, chamber, flask, sconce, spareTorch, spawnRocks } from './common';

const Y = -10, CEIL = -5.5;

// --- Crumbling gallery -----------------------------------------------------------------------
// 10 columns (c0 is nearest the stair chamber) by 4 rows of 2 m tiles over a spike pit.
const SOLID = new Set(['0:1', '1:1', '1:0', '2:0', '3:0', '3:1', '3:2', '4:2', '4:3', '5:3', '6:3', '6:2', '7:2', '7:1', '8:1', '9:1', '9:2']);
const ABSENT = new Set(['0:2']);
const tileRect = (c: number, r: number) => ({ x1: -11 - 2 * c, x2: -9 - 2 * c, z1: -124 + 2 * r, z2: -122 + 2 * r });
const solidTiles: NavRect[] = [...SOLID].map((k) => { const [c, r] = k.split(':').map(Number); return { ...tileRect(c, r), y: Y }; });
const crumbleTiles: TileDef[] = [];
for (let c = 0; c < 10; c++) for (let r = 0; r < 4; r++) if (!SOLID.has(`${c}:${r}`) && !ABSENT.has(`${c}:${r}`)) crumbleTiles.push(tileRect(c, r));

const J_PILLARS: [number, number][] = [[-38, -98], [-30, -98], [-38, -92], [-30, -92]];
const junction = carve([{ x1: -42, z1: -101, x2: -26, z2: -89, y: Y }],
  [...J_PILLARS.map(([x, z]) => ({ x1: x - 0.75, z1: z - 0.75, x2: x + 0.75, z2: z + 0.75 })), { x1: -28.5, z1: -95.5, x2: -27.5, z2: -94.5 }], 0.25);
const RAMP_N: NavRect = { x1: -36, z1: -87, x2: -32, z2: -83, y: Y, y2: -12.2, slope: 'z' };
const RAMP_S: NavRect = { x1: -23, z1: -71, x2: -20.5, z2: -67, y: -12.2, y2: Y, slope: 'z' };
const flooded = carve([{ x1: -42, z1: -87, x2: -18, z2: -67, y: -12.2 }], [RAMP_N, RAMP_S, { x1: -30, z1: -79, x2: -25, z2: -74 }]);

/** A stone deck hinged on the vault side of a chasm. Raised until the lever is pulled (or night falls). */
class Drawbridge implements SetPiece {
  private body: RAPIER.RigidBody;
  private mesh: THREE.Mesh;
  private angle: number;
  private grindT = 0;

  constructor(private game: Game, b: SceneBuilder, private px: number, private py: number, private pz: number, private len: number, width: number) {
    this.angle = this.down ? 0 : 1.42;
    this.body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    game.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(len / 2, 0.15, width / 2).setCollisionGroups(CG.STATIC), this.body);
    const g = new THREE.BoxGeometry(len, 0.3, width);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.9), 3));
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 1.2);
    this.mesh = new THREE.Mesh(g, game.mats.get('wood', b.gate));
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    b.add(this.mesh); b.track(g);
    this.apply(true);
  }

  private get down(): boolean { const p = this.game.run.progress; return p.drawbridgeDown || p.night; }

  private apply(teleport = false): void {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    const pos = { x: this.px + (c * this.len) / 2, y: this.py - 0.15 + (s * this.len) / 2, z: this.pz };
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.angle);
    const rot = { x: q.x, y: q.y, z: q.z, w: q.w };
    if (teleport) { this.body.setTranslation(pos, true); this.body.setRotation(rot, true); }
    else { this.body.setNextKinematicTranslation(pos); this.body.setNextKinematicRotation(rot); }
    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.quaternion.copy(q);
  }

  fixedUpdate(dt: number): void {
    const want = this.down ? 0 : 1.42;
    if (Math.abs(want - this.angle) < 1e-4) return;
    const d = want - this.angle;
    this.angle += Math.sign(d) * Math.min(Math.abs(d), 0.5 * dt);
    this.apply();
    this.grindT -= dt;
    if (this.grindT <= 0) { this.grindT = 0.45; this.game.audio.play('creak', { pos: this.mesh.position, vol: 1, range: 40 }); }
    if (Math.abs(want - this.angle) < 1e-4) { this.game.audio.play('thud', { pos: this.mesh.position, vol: 1, range: 40 }); this.game.shake(0.3); }
  }

  dispose(): void { this.game.physics.removeBody(this.body); }
}

export const catacombs: SceneDef = {
  id: 'catacombs',
  bounds: [{ x1: -59, x2: 12, z1: -130, z2: -45, y1: -60, y2: -9 }],
  nav: [
    { x1: -2, z1: -114, x2: 2, z2: -112, y: Y }, { x1: -7, z1: -126, x2: 7, z2: -114, y: Y }, { x1: -9, z1: -121.5, x2: -7, z2: -118.5, y: Y },
    ...solidTiles,
    { x1: -31, z1: -121.5, x2: -29, z2: -118.5, y: Y }, { x1: -36, z1: -123, x2: -31, z2: -117, y: Y }, { x1: -38, z1: -121.5, x2: -36, z2: -118.5, y: Y },
    { x1: -50, z1: -123, x2: -38, z2: -117, y: Y }, { x1: -56, z1: -121.5, x2: -50, z2: -118.5, y: Y, tag: 'drawbridge' }, { x1: -58, z1: -123, x2: -56, z2: -117, y: Y },
    { x1: -35, z1: -117, x2: -32, z2: -115, y: Y }, { x1: -35, z1: -115, x2: -32, z2: -103, y: Y }, { x1: -35, z1: -103, x2: -32, z2: -101, y: Y },
    ...junction,
    { x1: -36, z1: -89, x2: -32, z2: -87, y: Y }, RAMP_N, ...flooded, RAMP_S,
    { x1: -44, z1: -96.5, x2: -42, z2: -93.5, y: Y }, { x1: -46, z1: -101, x2: -44, z2: -89, y: Y },
    { x1: -56, z1: -96, x2: -46, z2: -94, y: Y, tag: 'chasmBridge' }, { x1: -58, z1: -101, x2: -56, z2: -89, y: Y },
  ],
  loot: [
    { id: 'k1', scene: 'catacombs', pos: [5.4, Y, -124.4] },
    { id: 'k2', scene: 'catacombs', pos: [-35, Y, -117.8] },
    { id: 'k3', scene: 'catacombs', pos: [-28, Y, -95], trap: 'junctionDarts' },
    { id: 'k4', scene: 'catacombs', pos: [-40.6, Y, -99.6] },
    { id: 'k5', scene: 'catacombs', pos: [-40.5, Y, -69.5], rich: true },
    { id: 'k6', scene: 'catacombs', pos: [-39.4, Y, -122], pedestal: true },
    { id: 'k7', scene: 'catacombs', pos: [-45, Y, -100] },
    { id: 'k8', scene: 'catacombs', pos: [-20, -15, -123], rich: true },
  ],
  guardians: [
    { kind: 'crawler', pos: [-27.5, Y, -99.5], yaw: 0, sweep: [[-33.5, Y, -109], [-33.5, Y, -120], [0, Y, -120], [0, 0, -70], [-10, 0, -40], [0, 0, -12]] },
    { kind: 'shade', pos: [-40.8, Y, -90.5], yaw: 0, sweep: [[-34, Y, -95], [-33.5, Y, -120], [0, Y, -120], [8, 0, -75], [5, 0, -30], [0, 0, -12]] },
  ],
  map: [
    { x1: -7, z1: -126, x2: 7, z2: -114, kind: 'room' }, { x1: -29, z1: -124, x2: -9, z2: -116, kind: 'pit' },
    { x1: -36, z1: -123, x2: -31, z2: -117, kind: 'room' }, { x1: -58, z1: -123, x2: -38, z2: -117, kind: 'room' },
    { x1: -56, z1: -121.5, x2: -50, z2: -118.5, kind: 'bridge' }, { x1: -35, z1: -115, x2: -32, z2: -103, kind: 'path' },
    { x1: -42, z1: -101, x2: -26, z2: -89, kind: 'room' }, { x1: -42, z1: -87, x2: -18, z2: -67, kind: 'water' },
    { x1: -58, z1: -101, x2: -44, z2: -89, kind: 'pit' }, { x1: -56, z1: -96, x2: -46, z2: -94, kind: 'bridge' },
  ],

  *build(game, b) {
    const { run } = game;
    const W = 'crypt', F = 'cryptFloor';
    // --- C1: foot of the stair ----------------------------------------------------------------
    chamber(b, W, F, -7, -126, 7, -114, Y, CEIL, 2, [{ side: 's', a1: -2, a2: 2, h: 3.5 }, { side: 'w', a1: -121.5, a2: -118.5, h: 3.2 }]);
    pillar(b, W, -4.5, -123.5, Y, 4.5, 0.5); pillar(b, W, 4.5, -116.5, Y, 4.5, 0.5);
    bonePile(b, -5.5, Y, -115.2, 41); bonePile(b, 2.5, Y, -124.8, 42);
    sconce(game, b, 'k-s1', 6.95, Y + 2.2, -120, -1, 0);
    yield;

    // --- Crumbling gallery ----------------------------------------------------------------------
    b.box(F, -29, -16, -124, -9, -15, -116);
    b.box(W, -29, -16, -126, -9, CEIL, -124); b.box(W, -29, -16, -116, -9, CEIL, -114);
    b.box(W, -9, -16, -124, -7, Y, -116);                                         // pit wall under the C1 doorway
    b.room(W, -29, -124, -9, -116, -15, CEIL, 2, [{ side: 'w', a1: -121.5, a2: -118.5, h: 3.2, y: Y }], {}, 'nse');
    b.box(F, -31, Y - 1, -121.5, -29, Y, -118.5);
    b.box(W, -31, CEIL, -126, -9, CEIL + 0.7, -114, { tint: 0.8 });
    for (const t of solidTiles) {
      b.box('glyph', t.x1 + 0.03, Y - 0.35, t.z1 + 0.03, t.x2 - 0.03, Y, t.z2 - 0.03, { tint: 0.8 });
      b.box(W, t.x1 + 0.55, -15, t.z1 + 0.55, t.x2 - 0.55, Y - 0.35, t.z2 - 0.55, { collide: false, tint: 0.7 });
    }
    b.piece(new CrumbleFloor(game, b, 'gallery', crumbleTiles, Y, F));
    b.piece(new HazardZone(game, -29, -124, -9, -116, -15.6, -14, DMG.spikes, 'the spike pit'));
    b.piece(addVines(game, b, { x1: -9.7, x2: -9, z1: -120, z2: -118.2, y1: -15, y2: Y, nx: -1, nz: 0 }));
    const spikeM: THREE.Matrix4[] = [];
    for (let x = -28.4; x < -9.3; x += 1.15) for (let z = -123.5; z < -116.3; z += 1.2) {
      if (x > -11.4 && z > -120.6 && z < -117.6) continue;                         // clear landing under the vines
      if (Math.abs(x + 20) < 1 && Math.abs(z + 123) < 1) continue;                 // and around the relic
      spikeM.push(new THREE.Matrix4().makeTranslation(x + Math.sin(z * 7) * 0.2, -14.55, z + Math.sin(x * 5) * 0.2));
    }
    b.instances(new THREE.ConeGeometry(0.11, 0.9, 5), game.mats.solid(0x3a3a40, 0.5, 0.4, 0, 'dark'), spikeM, false, false);
    yield;

    // --- R2 and the drawbridge room -------------------------------------------------------------
    chamber(b, W, F, -36, -123, -31, -117, Y, CEIL, 2, [{ side: 'w', a1: -121.5, a2: -118.5, h: 3.2 }, { side: 's', a1: -35, a2: -32, h: 3.2 }], 'e');
    sconce(game, b, 'k-s2', -33.5, Y + 2.2, -122.95, 0, 1);
    flask(game, b, 'k-flask', -31.6, Y + 0.02, -117.6);
    const DBC = -3.5;
    b.box(F, -50, -45, -123, -38, Y, -117); b.box(F, -58, -45, -123, -56, Y, -117);
    b.box(W, -60, -45, -125, -38, DBC, -123); b.box(W, -60, -45, -117, -38, DBC, -115);
    b.box(W, -38, CEIL, -125, -36, DBC, -115);
    b.box(W, -60, DBC, -125, -36, DBC + 0.7, -115, { tint: 0.8 });
    // Shared wall with the vault's lever room.
    b.box(W, -60, -45, -123, -58, Y, -117); b.box(W, -60, Y, -123, -58, DBC, -121.5); b.box(W, -60, Y, -118.5, -58, DBC, -117); b.box(W, -60, Y + 3.2, -121.5, -58, DBC, -118.5);
    b.box(F, -60, Y - 1, -121.5, -58, Y + 0.012, -118.5, { collide: false });
    b.piece(new Drawbridge(game, b, -56, Y, -120, 6, 3));
    b.piece(new KillZone(game, -57, -124, -49, -116, -28, 'the chasm'));
    sconce(game, b, 'k-s3', -44, Y + 2.2, -122.95, 0, 1);
    yield;

    // --- Dart corridor -------------------------------------------------------------------------
    chamber(b, W, F, -35, -115, -32, -103, Y, CEIL, 2, [], 'ns');
    const volley = (id: string, zs: number[]) => b.piece(new DartLauncher(game, b, id, dartRow(-32.05, Y, zs, -1, 2.9)));
    const d1 = volley('d1', [-113.1, -112.5, -112, -111.5, -110.9]);
    const d2 = volley('d2', [-109.5, -109, -108.5, -108, -107.5]);
    const d3 = volley('d3', [-106.1, -105.5, -105, -104.5, -103.9]);
    b.piece(new PressurePlate(game, b, 'dp1', -35, -112.5, -32, -111.5, Y, (p) => { d1.pressed = p; }));
    b.piece(new PressurePlate(game, b, 'dp2', -35, -109, -33.3, -108, Y, (p) => { d2.pressed = p; }));
    b.piece(new PressurePlate(game, b, 'dp3', -35, -105.5, -32, -104.5, Y, (p) => { d3.pressed = p; }));
    bonePile(b, -34.4, Y, -110.2, 43); bonePile(b, -32.6, Y, -106.6, 44);
    yield;

    // --- Junction -------------------------------------------------------------------------------
    chamber(b, W, F, -42, -101, -26, -89, Y, CEIL, 2,
      [{ side: 'n', a1: -35, a2: -32, h: 3.2 }, { side: 's', a1: -36, a2: -32, h: 3.2 }, { side: 'w', a1: -96.5, a2: -93.5, h: 3.2 }]);
    for (const [x, z] of J_PILLARS) pillar(b, W, x, z, Y, 4.5, 0.5);
    bonePile(b, -27, Y, -90, 45); bonePile(b, -41, Y, -96.5, 46); bonePile(b, -36.5, Y, -99.8, 47);
    const jd = b.piece(new DartLauncher(game, b, 'junctionDarts', dartRow(-26.05, Y, [-96.2, -95.6, -95, -94.4, -93.8], -1, 9)));
    game.relics.traps.set('junctionDarts', () => jd.fire());
    sconce(game, b, 'k-s4', -41.95, Y + 2.2, -99, 1, 0); sconce(game, b, 'k-s5', -29, Y + 2.2, -89.05, 0, -1);
    spareTorch(game, b, 'k-torch', -26.6, Y + 0.08, -100.2);
    spawnRocks(game, 'catacombs', [[-39, Y, -91, 2.2], [-31, Y, -100, 0.8], [3, Y, -116, 1.6], [-34, Y, -121.5, 4.0], [-45, Y, -91, 2.6], [-41, Y, -119, 1.2]]);
    yield;

    // --- Flooded chamber ------------------------------------------------------------------------
    chamber(b, W, F, -42, -87, -18, -67, -12.2, CEIL, 2, [{ side: 's', a1: -23, a2: -20.5, h: 3.2, y: Y }], 'n');
    b.box(W, -24, -13, -89, -16, CEIL, -87); b.box(W, -44, -13, -89, -24, Y, -87);
    b.box(F, -37, -13, -87, -31, Y, -85);                                          // north landing
    b.box('glyph', -30, -13, -79, -25, -10.1, -74);                                // key island
    b.box(F, -23.5, -13, -68.5, -20, Y, -67);                                      // south landing
    b.box(F, -41.5, -13, -70.5, -39.5, Y, -68.5);                                  // far platform
    // Causeways just under the surface. Step off and the water takes your torch.
    const causeway: [number, number][] = [
      [-34, -84.3], [-34, -82.8], [-32.5, -82.8], [-31, -82.8], [-29.5, -82.8], [-28, -82.8], [-28, -81.3], [-28, -79.8],
      [-24.2, -75], [-22.7, -75], [-22.7, -73.5], [-22.7, -72], [-22.7, -70.5], [-22.7, -69.2],
    ];
    // The blocks touching the island and the two landings stand a little proud, as steps.
    for (const [x, z] of causeway) {
      const island = (x === -28 && z === -79.8) || (x === -24.2 && z === -75);
      const landing = z === -84.3 || z === -69.2;
      b.box(W, x - 0.65, -12.4, z - 0.65, x + 0.65, island ? -10.42 : landing ? -10.38 : -10.75, z + 0.65, { tint: 1.25 });
    }
    b.piece(addWater(game, b, { x1: -42, x2: -18, z1: -87, z2: -67, surfaceY: -10.5, minY: -12.8, flowX: 0, flowZ: 0 }));
    const key = keyMesh(game.mats); key.position.set(-27.5, -9.95, -76.5); key.scale.setScalar(1.6);
    b.piece(new Pickup(game, b, 'serpentKey', key, 'Take the Serpent Key', () => { run.progress.hasSerpentKey = true; game.toast('The Serpent Key. It fits the vault door past the chasm.'); }));
    b.box('glyph', -27.9, -10.1, -76.9, -27.1, -10.0, -76.1, { collide: false });
    sconce(game, b, 'k-s6', -34, Y + 2.2, -86.95, 0, 1);
    for (const [x, z] of [[-37, -72], [-30, -70], [-24, -80], [-38, -80]] as const) pillar(b, W, x, z, -12.2, 6.7, 0.5);
    yield;

    // --- Chasm and the vault door ---------------------------------------------------------------
    b.box(F, -46, -45, -101, -44, Y, -89); b.box(F, -58, -45, -101, -56, Y, -89);
    b.box(W, -60, -45, -103, -42, CEIL, -101); b.box(W, -60, -45, -89, -44, CEIL, -87);
    b.box(W, -60, CEIL, -103, -42, CEIL + 0.7, -87, { tint: 0.8 });
    b.box(W, -60, -45, -101, -58, Y, -89); b.box(W, -60, Y, -101, -58, CEIL, -96.5); b.box(W, -60, Y, -93.5, -58, CEIL, -89); b.box(W, -60, Y + 3.5, -96.5, -58, CEIL, -93.5);
    b.box(F, -60, Y - 1, -96.5, -58, Y + 0.012, -93.5, { collide: false });
    b.piece(new RopeBridge(game, b, 'chasmBridge', -46, Y, -95, -56, Y, -95, 2.0, () => {
      if (run.progress.chasmBridgeIntact) { run.progress.chasmBridgeIntact = false; game.toast('The chasm bridge is gone.'); }
    }));
    b.piece(new KillZone(game, -57, -102, -45, -88, -28, 'the chasm'));
    const vdoor = b.piece(new SlideDoor(game, b, { x: -59, y: Y + 1.75, z: -95, sx: 1.2, sy: 3.5, sz: 3, open: [0, -3.6, 0], mat: 'gold', speed: 0.4 }));
    const vOpen = () => run.progress.vaultOpen || run.progress.night;
    vdoor.snap(vOpen() ? 1 : 0);
    b.piece({ fixedUpdate: () => vdoor.setOpen(vOpen()) });
    const lock: Interactable = {
      pos: new THREE.Vector3(-58, Y + 1.5, -95), range: 3, priority: 1,
      prompt: () => (vOpen() ? null : run.progress.hasSerpentKey ? 'Turn the Serpent Key in the vault door' : 'A serpent-shaped keyhole. The vault is locked.'),
      act: () => {
        if (useSerpentKey(run.progress)) { game.audio.play('lever'); game.toast('The vault door sinks. Whatever sleeps in there, do not wake it.'); }
        else game.toast('Locked. The key is somewhere in these catacombs.');
      },
    };
    game.addInteractable(lock);
    b.piece({ dispose: () => game.removeInteractable(lock) });
    sconce(game, b, 'k-s7', -44.05, Y + 2.2, -91, -1, 0);
  },
};
