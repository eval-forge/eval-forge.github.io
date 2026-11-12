import * as THREE from 'three';
import { carve, type NavRect } from '../../core/navmesh';
import { Rng } from '../../core/rng';
import type { RoofOpening } from '../../core/sunlight';
import { useSunDiscOnSeal } from '../../core/unlock';
import type { SceneBuilder, SetPiece } from '../../engine/builder';
import { CG, RAPIER } from '../../engine/physics';
import type { Game } from '../../game/Game';
import { bonePile, pillar, rubblePile, statue } from '../props';
import { DebrisField, KickWall, LightShaft, SlideDoor } from '../setpieces';
import type { Interactable, SceneDef } from '../types';
import { flask, sconce, spareTorch, spawnRocks, white } from './common';

const IDOL_HOLE: RoofOpening = { x1: -1.7, x2: 1.7, z1: -73.8, z2: -70.4, y: 11.3 };

/** The heap that chokes the doorway back to the halls after the idol collapse. Guardians tear it out at dark. */
class RubblePlug implements SetPiece {
  private body: RAPIER.RigidBody | null = null;
  private mesh: THREE.Group | null = null;

  constructor(private game: Game, private b: SceneBuilder) {
    if (game.run.progress.rubblePlug) this.raise();
  }

  raise(): void {
    if (this.body) return;
    const { game } = this;
    this.body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 2.4, -55));
    game.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(2.7, 2.4, 1).setCollisionGroups(CG.STATIC), this.body);
    this.mesh = new THREE.Group();
    const rng = new Rng(99);
    const mat = game.mats.get('rubble');
    for (let i = 0; i < 46; i++) {
      const s = rng.range(0.5, 1.3);
      const g = white(new THREE.BoxGeometry(s, s * rng.range(0.5, 0.9), s * rng.range(0.6, 1.1)), rng.range(0.6, 1));
      const m = new THREE.Mesh(g, mat);
      const y = rng.range(0.2, 4.6);
      m.position.set(rng.range(-2.5, 2.5) * (1 - y / 9), y, -55 + rng.range(-0.9, 0.9));
      m.rotation.set(rng.range(-0.6, 0.6), rng.range(0, 3), rng.range(-0.6, 0.6));
      m.castShadow = true; m.receiveShadow = true;
      this.mesh.add(m);
    }
    this.b.add(this.mesh);
  }

  private clear(): void {
    if (!this.body) return;
    this.game.physics.removeBody(this.body); this.body = null;
    this.mesh?.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    this.mesh?.removeFromParent(); this.mesh = null;
  }

  onNight(): void {
    if (!this.body) return;
    this.clear();
    this.game.run.progress.rubblePlug = false;
    this.game.audio.play('rubble', { pos: { x: 0, y: 1, z: -55 }, vol: 1 });
  }

  dispose(): void { this.clear(); }
}

const floor: NavRect[] = carve([{ x1: -13, z1: -86, x2: 13, z2: -54, y: 0 }],
  [{ x1: -3, z1: -80, x2: 3, z2: -74 }, { x1: -10.5, z1: -82.5, x2: -9.5, z2: -81.5 }, { x1: 9.5, z1: -83.5, x2: 10.5, z2: -82.5 }], 0.25);

export const sanctum: SceneDef = {
  id: 'sanctum',
  bounds: [{ x1: -25, x2: 15, z1: -112.5, z2: -52, y1: -9 }],
  nav: [
    ...floor,
    { x1: -2, z1: -88, x2: 2, z2: -86, y: 0, tag: 'seal' },
    { x1: -2, z1: -90, x2: 2, z2: -88, y: 0 },
    { x1: -2, z1: -110, x2: 2, z2: -90, y: -10, y2: 0, slope: 'z' },
    { x1: -2, z1: -112, x2: 2, z2: -110, y: -10 },
    { x1: 13, z1: -65, x2: 15, z2: -62, y: 0, tag: 'kickEast' },
    { x1: -15, z1: -66, x2: -13, z2: -63, y: 0, tag: 'kickSmuggler' },
    { x1: -19.5, z1: -66, x2: -15, z2: -63, y: 0 },
    { x1: -19.5, z1: -63, x2: -17, z2: -55, y: 0, y2: -4, slope: 'z' },
    { x1: -23, z1: -55, x2: -17, z2: -52, y: -4 },
    { x1: -23, z1: -65, x2: -20.5, z2: -55, y: -10, y2: -4, slope: 'z' },
    { x1: -23, z1: -67, x2: -20.5, z2: -65, y: -10 },
  ],
  loot: [
    { id: 's1', scene: 'sanctum', pos: [0, 0.6, -77], fixed: 'jaguarIdol', trap: 'collapse' },
    { id: 's2', scene: 'sanctum', pos: [-10, 0, -82], trap: 'sanctumDebris' },
    { id: 's3', scene: 'sanctum', pos: [10, 0, -83], pedestal: true },
    { id: 's4', scene: 'sanctum', pos: [9.5, 0, -57.5] },
    { id: 's5', scene: 'sanctum', pos: [-10.5, 0, -70.5], rich: true },
  ],
  guardians: [
    { kind: 'sentinel', pos: [-11, 0, -59.5], yaw: Math.PI / 2, sweep: [[0, 0, -70], [0, 0, -56], [0, 0, -40], [-6, 0, -20], [0, 0, -12]] },
  ],
  map: [
    { x1: -13, z1: -86, x2: 13, z2: -54, kind: 'room' }, { x1: -3, z1: -80, x2: 3, z2: -74, kind: 'path' },
    { x1: -2, z1: -112, x2: 2, z2: -86, kind: 'path' }, { x1: -23, z1: -67, x2: -15, z2: -52, kind: 'path' },
  ],

  *build(game, b) {
    const { run } = game;
    // --- Shell -----------------------------------------------------------------------------
    b.box('floor', -15, -1, -88, 15, 0, -54);
    b.room('stoneMoss', -13, -86, 13, -54, 0, 11, 2, [
      { side: 'n', a1: -2, a2: 2, h: 4 }, { side: 'e', a1: -65, a2: -62, h: 3.2 }, { side: 'w', a1: -66, a2: -63, h: 3.2 },
    ], {}, 's');
    // Wall above the halls' lower roofline, so the open half reads as a ruin and not a gap.
    b.box('stoneMoss', -15, 8.6, -54.6, -4, 11, -54, { collide: false }); b.box('stoneMoss', 6, 8.6, -54.6, 15, 10.2, -54, { collide: false });
    yield;
    // The surviving half of the roof, with the hole that lights the idol.
    for (const r of carve([{ x1: -15, z1: -88, x2: 15, z2: -66, y: 11 }], [IDOL_HOLE])) b.box('roof', r.x1, 11, r.z1, r.x2, 11.7, r.z2, { collide: false });
    b.box('roof', -15, 11, -66, -6, 11.7, -61.5, { collide: false, tint: 0.85 }); b.box('roof', 7, 11, -66, 15, 11.7, -63, { collide: false, tint: 0.85 });
    b.piece(new LightShaft(game, b, IDOL_HOLE, 0.6));
    for (const [x, z] of [[-8, -83], [8, -83], [-8, -69], [8, -69]] as const) pillar(b, 'stoneMoss', x, z, 0, 11, 0.7);
    pillar(b, 'stoneMoss', -8, -59, 0, 4.2, 0.7); pillar(b, 'stoneMoss', 8, -60, 0, 2.6, 0.7);
    yield;
    rubblePile(b, 6, 0, -58, 2.2, 1.4, 31); rubblePile(b, -5.5, 0, -62.5, 1.8, 1.1, 32); rubblePile(b, 11.5, 0, -66.5, 1.2, 0.8, 33);
    bonePile(b, -11.5, 0, -75, 7); bonePile(b, 4.5, 0, -84.5, 8);
    statue(b, 'stone', -5.5, 0, -84.3, 0, 1.25); statue(b, 'stone', 5.5, 0, -84.3, 0, 1.25);
    // Dais.
    b.box('glyph', -3, 0, -80, 3, 0.3, -74); b.box('glyph', -2, 0.3, -79, 2, 0.6, -75);
    yield;

    // --- The unstable ceiling ---------------------------------------------------------------
    const debris = b.piece(new DebrisField(game, b, -12.5, -85.5, 12.5, -66.5, 11));
    const plug = b.piece(new RubblePlug(game, b));
    game.sanctumDebris = debris;
    b.piece({ dispose: () => { if (game.sanctumDebris === debris) game.sanctumDebris = null; } });
    game.relics.traps.set('sanctumDebris', () => debris.drop(5, game.player.pos));
    game.relics.traps.set('collapse', () => {
      game.toast('The whole ceiling is coming down. RUN.');
      debris.collapse(6);
      debris.onCollapsed = () => {
        if (run.progress.night) return;
        run.progress.rubblePlug = true;
        plug.raise();
        game.audio.play('rubble', { pos: { x: 0, y: 1, z: -55 }, vol: 1 });
        game.toast('Rubble has choked the way back to the halls. Find another way out.');
      };
    });

    // --- Sun seal and the descent ------------------------------------------------------------
    const seal = b.piece(new SlideDoor(game, b, { x: 0, y: 2, z: -87, sx: 4, sy: 4, sz: 0.6, open: [0, -4.1, 0], mat: 'glyph', speed: 0.35 }));
    const sealOpen = () => run.progress.sealOpen || run.progress.night;
    seal.snap(sealOpen() ? 1 : 0);
    b.piece({ fixedUpdate: () => seal.setOpen(sealOpen()) });
    b.cyl('gold', 0, 2.1, -86.68, 0.34, 0.06, { rot: [Math.PI / 2, 0, 0], segs: 18, collide: false, shadow: false });
    const socket: Interactable = {
      pos: new THREE.Vector3(0, 1.7, -86.2), range: 3.2, priority: 1,
      prompt: () => (sealOpen() ? null : run.progress.hasSunDisc ? 'Set the Sun Disc into the seal' : 'A round socket, rayed like a sun. Something belongs here.'),
      act: () => {
        if (useSunDiscOnSeal(run.progress)) { game.audio.play('gong', { vol: 0.8 }); game.toast('The seal sinks into the floor. Cold air rises from below. Light your torch (F).'); }
        else game.toast('The seal will not move without its sun.');
      },
    };
    game.addInteractable(socket);
    b.piece({ dispose: () => game.removeInteractable(socket) });
    yield;

    const fade = { gate: 'fade' as const };
    b.box('floor', -2, -1, -90, 2, 0, -88, fade);
    b.stairs('floor', 'z', -90, -110, -2, 2, 0, -10, fade);
    b.box('cryptFloor', -2, -11, -112, 2, -10, -110, fade);
    b.box('stone', -4, -11, -112, -2, 4.7, -88, fade); b.box('stone', 2, -11, -112, 4, 4.7, -88, fade);
    b.box('stone', -4, 4, -90, 4, 4.7, -88, fade);
    for (let i = 0; i < 5; i++) {
      const z1 = -94 - 4 * i - (i === 4 ? 2 : 0), z2 = -90 - 4 * i, top = 4 - 2 * i;
      b.box('stone', -4, top, z1, 4, top + 0.7, z2, fade);
      if (i < 4) b.box('stone', -4, top - 1.3, z1 - 0.3, 4, top + 0.7, z1, fade);
    }
    b.box('stone', -2, -6.6, -112.3, 2, -3.3, -112, fade);
    yield;

    // --- Shortcuts ---------------------------------------------------------------------------
    b.piece(new KickWall(game, b, 'kickE', 13, 0, -65, 15, 3.2, -62, 'kickEast', 'kickEast'));
    b.piece(new KickWall(game, b, 'kickW', -15, 0, -66, -13, 3.2, -63, 'kickSmuggler', 'kickSmuggler'));
    // Smugglers' stair: from behind the west wall down to the flooded chamber.
    b.box('floor', -19.5, -1, -66, -15, 0, -63, fade);
    b.stairs('floor', 'z', -63, -55, -19.5, -17, 0, -4, fade);
    b.box('floor', -23, -5, -55, -17, -4, -52, fade);
    b.stairs('floor', 'z', -55, -65, -23, -20.5, -4, -10, fade);
    b.box('cryptFloor', -23, -11, -67, -20.5, -10, -65, fade);
    b.box('stone', -24.6, -11, -67.6, -23, 4, -51, fade);                      // west
    b.box('stone', -20.5, -11, -66, -19.5, 4, -55, fade);                      // spine between the flights
    b.box('stone', -17, -11, -63, -15, 4, -51, fade);                          // east of the upper flight
    b.box('stone', -23, -11, -52, -17, 4, -51, fade);                          // south end
    b.box('stone', -20.5, -11, -67.6, -15, 4, -66, fade);                      // north end above the tunnel
    b.box('stone', -23, -6.5, -67.6, -20.5, 4, -65, fade);                     // lintel over the tunnel
    b.box('stone', -24.6, 3.3, -67.6, -15, 4, -51, { ...fade, collide: false });
    yield;

    if (!run.spawnedProps.has('sanctum')) game.props.spawn('sack', 'sandbag', 6.1, 4.2, 0.5, -72.5);
    spawnRocks(game, 'sanctum', [[-4.5, 0, -57, 2.4], [7, 0, -72, 4.4], [-11.5, 0, -84, 1.8], [11, 0, -79, 3.4]]);
    flask(game, b, 's-flask', -12.2, 0.02, -56.2); spareTorch(game, b, 's-torch', 12, 0.08, -85.2);
    sconce(game, b, 's-s1', -3.2, 2.2, -85.95, 0, 1); sconce(game, b, 's-s2', -1.95, -3.2, -100, 1, 0);
  },
};
