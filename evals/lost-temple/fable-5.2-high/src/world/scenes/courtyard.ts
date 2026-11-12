import * as THREE from 'three';
import { doorClosedFraction } from '../../core/clock';
import { Rng } from '../../core/rng';
import { gnomonShadowDir } from '../../core/sun';
import { sundialSolved, takeSunDisc } from '../../core/unlock';
import type { SceneBuilder, SetPiece } from '../../engine/builder';
import { RAPIER } from '../../engine/physics';
import type { Game } from '../../game/Game';
import { canopyGeometry, crossCard, pillar, rubblePile, statue, sunDiscMesh, toppledPillar } from '../props';
import { PressurePlate, PushBlock, SlideDoor } from '../setpieces';
import type { Interactable, SceneDef } from '../types';
import { chamber, flask, spareTorch, spawnRocks, white } from './common';

const DIAL_STEP = (15 * Math.PI) / 180;

/**
 * The sundial puzzle. A bronze ring carries one sun glyph; turn the ring until the glyph lies in
 * the gnomon's real shadow (which moves all day) and the dial gives up the Sun Disc that was
 * holding the Great Door shut.
 */
class Sundial implements SetPiece {
  private ring = new THREE.Group();
  private disc: THREE.Object3D | null = null;
  private turn: Interactable;
  private take: Interactable | null = null;
  private hold = 0;

  constructor(private game: Game, private b: SceneBuilder, private x: number, private z: number) {
    const { mats, run } = game;
    b.cyl('glyph', x, 0.2, z, 2.5, 0.4, { segs: 24 });
    b.cyl('stone', x, 0.43, z, 1.35, 0.06, { segs: 20, collide: false });
    b.cyl('iron', x, 1.3, z, 0.06, 1.8, { segs: 6 });
    b.cyl('gold', x, 2.25, z, 0.11, 0.16, { segs: 8, collide: false });
    // Hour marks.
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      b.obox('stone', x + Math.cos(a) * 2.25, 0.42, z + Math.sin(a) * 2.25, 0.3, 0.05, 0.07, [0, -a, 0], { collide: false, shadow: false, tint: 0.55 });
    }
    const ringGeo = white(new THREE.RingGeometry(1.5, 2.0, 40));
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, mats.solid(0x8a6a34, 0.5, 0.4));
    ring.receiveShadow = true;
    const glyph = new THREE.Group();
    const gold = mats.solid(0xf0c040, 0.3, 0.45);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16), gold);
    glyph.add(core);
    for (let i = 0; i < 8; i++) {
      const ray = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.05), gold);
      const a = (i / 8) * Math.PI * 2;
      ray.position.set(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3); ray.rotation.y = -a;
      glyph.add(ray);
    }
    glyph.position.set(1.75, 0.04, 0);
    this.ring.add(ring, glyph);
    this.ring.position.set(x, 0.47, z);
    this.ring.rotation.y = -run.dialAngle;
    b.add(this.ring);
    b.track(ringGeo);

    this.turn = {
      pos: new THREE.Vector3(x, 0.9, z), range: 4.2, priority: 2,
      prompt: () => (run.dialSolved ? null : "Turn the dial  ·  put the sun glyph in the gnomon's shadow"),
      act: () => {
        run.dialAngle = (run.dialAngle + DIAL_STEP) % (Math.PI * 2);
        game.audio.play('grind', { pos: this.ring.position, vol: 0.6 });
        this.hold = 0;
      },
    };
    game.addInteractable(this.turn);
    if (run.dialSolved && !run.progress.hasSunDisc) this.reveal(false);
  }

  private reveal(fanfare: boolean): void {
    const { game, x, z } = this;
    this.disc = sunDiscMesh(game.mats);
    this.disc.position.set(x, 0.75, z + 0.85);
    this.disc.rotation.x = -0.9;
    this.b.add(this.disc);
    this.take = {
      pos: this.disc.position.clone(), range: 3.4, priority: 0,
      prompt: () => 'Lift the Sun Disc',
      act: () => {
        takeSunDisc(game.run.progress);
        game.removeInteractable(this.take!); this.take = null;
        this.disc?.removeFromParent(); this.disc = null;
        game.audio.play('relic'); game.audio.play('door');
        game.shake(0.4);
        game.toast('The Sun Disc comes free. Behind you, the Great Door grinds open.');
      },
    };
    game.addInteractable(this.take);
    if (fanfare) { game.audio.play('gong', { vol: 0.9 }); game.toast('The dial sinks a finger-width. A golden disc rises beside the gnomon.'); }
  }

  fixedUpdate(dt: number): void {
    const { run } = this.game;
    if (run.dialSolved) return;
    const sh = gnomonShadowDir(run.time);
    const ok = sundialSolved(run.dialAngle, sh ? Math.atan2(sh.z, sh.x) : null);
    this.hold = ok ? this.hold + dt : 0;
    if (this.hold > 0.5) { run.dialSolved = true; this.reveal(true); }
  }

  update(dt: number): void {
    const want = -this.game.run.dialAngle;
    let d = want - this.ring.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.ring.rotation.y += d * Math.min(1, dt * 7);
    if (this.disc) this.disc.rotation.z += dt * 0.8;
  }

  dispose(): void {
    this.game.removeInteractable(this.turn);
    if (this.take) this.game.removeInteractable(this.take);
  }
}

export const courtyard: SceneDef = {
  id: 'courtyard',
  bounds: [{ x1: -40, x2: 40, z1: -7, z2: 41 }],
  nav: [],
  loot: [
    { id: 'c1', scene: 'courtyard', pos: [-15, 0.6, 24], pedestal: true },
    { id: 'c2', scene: 'courtyard', pos: [-19, 0.6, 8] },
    { id: 'c3', scene: 'courtyard', pos: [19.6, 0.12, 12], pedestal: true, rich: true },
    { id: 'c4', scene: 'courtyard', pos: [21, 0, 35] },
    { id: 'c5', scene: 'courtyard', pos: [-11, 0, -3.6] },
  ],
  guardians: [],
  map: [
    { x1: -24, z1: -6, x2: 24, z2: 40, kind: 'room' }, { x1: -22, z1: 4, x2: -8, z2: 30, kind: 'path' },
    { x1: 15, z1: 9, x2: 21, z2: 15, kind: 'room' }, { x1: -2.4, z1: 15.6, x2: 2.4, z2: 20.4, kind: 'pit' },
  ],

  *build(game, b) {
    const { run } = game;
    // --- Ground and walls ------------------------------------------------------------------
    b.box('stoneMoss', -24, -1, -6, 24, 0, 40);
    b.room('stoneMoss', -24, -6, 24, 40, 0, 6, 2, [{ side: 's', a1: -3, a2: 3, h: 4.6 }], {}, 'n');
    b.box('floor', -3, -1, 40, 3, 0, 42);
    b.box('glyph', -4.2, 0, 39.6, -3, 5.6, 42.4, { collide: false }); b.box('glyph', 3, 0, 39.6, 4.2, 5.6, 42.4, { collide: false });
    b.box('glyph', -4.6, 5.6, 39.4, 4.6, 6.6, 42.6, { collide: false });
    // Earth showing through the paving.
    for (const [x1, z1, x2, z2] of [[-23, 30.5, -9, 39], [8, 24, 23, 39], [-23, -5, -4, 3], [5, -5, 23, 6], [-6, 23, 6, 29]] as const) {
      b.box('grass', x1, -0.5, z1, x2, 0.035, z2, { collide: false });
    }
    yield;

    // --- Temple facade and the Great Door ---------------------------------------------------
    b.box('stone', -26, 0, -8, -2, 14, -6); b.box('stone', 2, 0, -8, 26, 14, -6); b.box('stone', -2, 5, -8, 2, 14, -6);
    b.box('floor', -2, -1, -8, 2, 0, -6);
    b.box('glyph', -3.3, 0, -6, -2, 6.4, -5.3); b.box('glyph', 2, 0, -6, 3.3, 6.4, -5.3);
    b.box('glyph', -9, 5.4, -6.2, 9, 6.6, -5.5, { collide: false });
    b.box('stone', -21, 14, -9.5, 21, 18.5, -6.6, { collide: false, tint: 0.92 });
    b.box('stone', -14, 18.5, -10.5, 14, 23, -7.4, { collide: false, tint: 0.86 });
    b.box('glyph', -6, 23, -11, 6, 26, -8.4, { collide: false });
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      b.box('stoneMoss', sx * (9 + i * 5) - 1, 0, -6, sx * (9 + i * 5) + 1, 9.5, -5.2, { collide: false, tint: 0.9 });
    }
    const door = b.piece(new SlideDoor(game, b, { x: 0, y: 2.5, z: -7, sx: 4, sy: 5, sz: 0.8, open: [0, 4.95, 0], mat: 'glyph', speed: 0.22 }));
    const doorTarget = () => (run.progress.doorOpen ? 1 - doorClosedFraction(run.time) : 0);
    door.snap(doorTarget());
    b.piece({ fixedUpdate: () => { door.target = doorTarget(); } });
    yield;

    // --- Sundial ---------------------------------------------------------------------------
    b.piece(new Sundial(game, b, 0, 18));
    b.box('glyph', 3.4, 0, 21.2, 4.3, 1.7, 21.6);
    const stele: Interactable = {
      pos: new THREE.Vector3(3.85, 1.2, 21.7), range: 3,
      prompt: () => 'Read the stele',
      act: () => game.toast('"When the golden sun lies in the shadow of the needle, the mountain will open."'),
    };
    game.addInteractable(stele);
    b.piece({ dispose: () => game.removeInteractable(stele) });

    // --- West plaza ------------------------------------------------------------------------
    b.box('floor', -22, 0, 4, -8, 0.3, 30); b.box('floor', -21.4, 0.3, 4.6, -8.6, 0.6, 29.4);
    for (const [x, z] of [[-20, 6], [-20, 28], [-10, 28]] as const) pillar(b, 'stoneMoss', x, z, 0.6, 5.4);
    pillar(b, 'stoneMoss', -10, 6, 0.6, 2.2);
    toppledPillar(b, 'stoneMoss', -13.5, 0.6, 12.5, 0.9, 5.2);
    rubblePile(b, -17, 0.6, 17, 1.4, 0.9, 11);
    statue(b, 'stoneMoss', -7, 0, 33, Math.PI, 1.15); statue(b, 'stoneMoss', 7, 0, 33, Math.PI, 1.15);
    statue(b, 'stone', -5.6, 0, -3, Math.PI, 1.3); statue(b, 'stone', 5.6, 0, -3, Math.PI, 1.3);
    toppledPillar(b, 'stoneMoss', 17.5, 0, 30.5, 0.35, 6.4);
    rubblePile(b, 12, 0, 3, 1.6, 1.0, 17);
    yield;

    // --- East shrine: a gate held open by weight on a plate ---------------------------------
    chamber(b, 'stoneMoss', 'floor', 15, 9, 21, 15, 0.12, 4, 1, [{ side: 'w', a1: 11, a2: 13, h: 3 }]);
    const gate = b.piece(new SlideDoor(game, b, { x: 14.5, y: 1.62, z: 12, sx: 0.5, sy: 3, sz: 2, open: [0, -3.05, 0], mat: 'iron', speed: 1.2 }));
    b.piece(new PressurePlate(game, b, 'shrinePlate', 8.9, 16.4, 11.1, 18.6, 0, (p) => gate.setOpen(p)));
    b.piece(new PushBlock(game, b, 'shrineBlock', 10, 0, 23));
    flask(game, b, 'c-flask', 16.2, 0.14, 14.2); spareTorch(game, b, 'c-torch', 16.3, 0.2, 9.9);
    spawnRocks(game, 'courtyard', [[4.5, 0, 30, 1.2], [-4, 0, 9, 2.0], [12.5, 0, 26, 3.4], [-12, 0.6, 20, 4.6], [6.5, 0, 2.5, 6.0], [-5, 0, 36, 0.6]]);
    yield;

    // --- Overgrowth ------------------------------------------------------------------------
    const rng = new Rng(808);
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    const trunkM: THREE.Matrix4[] = [], canopyM: THREE.Matrix4[] = [];
    for (const [x, z] of [[-21, 34], [21, 20], [-21.5, 0], [14, 36.5], [22, -2], [-12, 36]] as const) {
      const h = rng.range(6, 9), r = rng.range(0.35, 0.5);
      trunkM.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h / 2 - 0.2, z), q.identity(), new THREE.Vector3(r, h, r)));
      const s = rng.range(1.5, 2.1);
      canopyM.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h, z), q.setFromEuler(e.set(0, rng.range(0, 6), 0)), new THREE.Vector3(s, s, s)));
      b.collider(RAPIER.ColliderDesc.cylinder(h / 2, r * 1.1).setTranslation(x, h / 2, z));
    }
    b.instances(white(new THREE.CylinderGeometry(0.8, 1.2, 1, 7, 1)), game.mats.get('bark'), trunkM);
    b.instances(canopyGeometry(5), game.mats.canopy(), canopyM);
    const cards = (count: number, w: number, h: number, kind: 'bush' | 'fern' | 'grass', hug: boolean) => {
      const ms: THREE.Matrix4[] = [];
      for (let n = 0; n < count; n++) {
        let x = rng.range(-23.3, 23.3), z = rng.range(-5, 39.3);
        if (hug) { if (rng.chance(0.5)) x = rng.pick([-23, 23]) + rng.range(-0.5, 0.5); else z = rng.pick([-4.9, 39]) + rng.range(-0.4, 0.4); }
        if (Math.abs(x) < 3 && (z < 0 || z > 36)) continue;                 // keep the doorways clear
        if (Math.hypot(x, z - 18) < 3.2) continue;                          // and the dial
        if (x > 14 && x < 22 && z > 8 && z < 16) continue;                  // and the shrine
        const y = x > -22 && x < -8 && z > 4 && z < 30 ? 0.6 : 0.02;
        const s = rng.range(0.7, 1.4);
        ms.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(0, rng.range(0, 3.1), 0)), new THREE.Vector3(s, s, s)));
      }
      b.instances(crossCard(w, h), game.mats.card(kind), ms, kind === 'bush', true);
    };
    cards(46, 2.2, 1.6, 'bush', true);
    cards(60, 1.4, 0.9, 'fern', false);
    cards(420, 0.9, 0.5, 'grass', false);
  },
};
