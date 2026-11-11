/** Scene 2: Temple Courtyard. The great door, the sundial, the canal, and the terrace shortcut. */
import * as THREE from 'three';
import { DOOR_CROUCH_GAP, DOOR_OPEN_HEIGHT } from '../../core/clock';
import { GROUPS, RAPIER } from '../../engine/physics';
import type { Game } from '../../game/game';
import { CROUCH_HEIGHT, STAND_HEIGHT } from '../../game/player';
import { Drawbridge, Lever, Sundial, slabMesh } from '../entities/doors';
import { Water } from '../entities/env';
import { KeyPickup } from '../entities/relics';
import { DartTrap } from '../entities/traps';
import type { SceneKit } from '../kit';
import { COURT } from '../layout/courtyard';
import type { Entity } from '../registry';
import { canopyGeometry, crossCardGeometry, fallenPillar, instanced, leafTint, mural, rock, supply, type Scatter } from './common';

const WALL = 'templeStone';

/** The only way in and the only way out. It follows the clock: nothing else can move it. */
class GreatDoor implements Entity {
  private readonly body: RAPIER.RigidBody;
  private readonly mesh: THREE.Group;
  private grindT = 0;
  private shut = false;
  private readonly at = { x: 0, y: 2, z: 41 };

  constructor(
    private readonly game: Game,
    parent: THREE.Object3D,
  ) {
    const w = game.physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, this.yOf(), 41));
    const c = w.createCollider(RAPIER.ColliderDesc.cuboid(2.75, 2.75, 0.4).setCollisionGroups(GROUPS.world), this.body);
    game.physics.setMeta(c, { kind: 'greatDoor', surface: 'stone' });
    this.mesh = new THREE.Group();
    this.mesh.add(slabMesh(game, 5.5, 5.5, 0.8, 'templeStone', false));
    // A bronze sun on both faces, so you know what it answers to.
    for (const s of [-1, 1]) {
      const disc = game.mats.mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.08, 24), 'bronze', false);
      disc.rotation.x = Math.PI / 2;
      disc.position.set(0, 0.3, s * 0.42);
      this.mesh.add(disc);
      for (let i = 0; i < 8; i++) {
        const ray = game.mats.mesh(new THREE.BoxGeometry(0.14, 0.7, 0.06), 'bronze', false);
        const a = (i / 8) * Math.PI * 2;
        ray.position.set(Math.sin(a) * 1.6, 0.3 + Math.cos(a) * 1.6, s * 0.42);
        ray.rotation.z = -a;
        this.mesh.add(ray);
      }
    }
    this.mesh.traverse((o) => {
      (o as THREE.Mesh).castShadow = true;
    });
    parent.add(this.mesh);
    this.shut = game.run.clock.doorClosed;
    this.frame();
  }

  private yOf(): number {
    return this.game.run.clock.doorGap + 2.75;
  }

  step(dt: number): void {
    const game = this.game;
    const clock = game.run.clock;
    const gap = clock.doorGap;
    this.body.setNextKinematicTranslation({ x: 0, y: gap + 2.75, z: 41 });
    if (clock.isDark && !this.shut) {
      this.grindT -= dt;
      if (this.grindT <= 0) {
        this.grindT = 2.3;
        game.sfx('grindLong', this.at, 1, 0.7, 90);
      }
      if (clock.doorClosed) {
        this.shut = true;
        game.sfx('doorSlam', this.at, 1, 1, 120);
        game.shake(0.9);
        game.particles.emit('dust', { x: 0, y: 0.2, z: 41 }, 40, { spread: 2.6 });
      }
    }
    // Nobody is ground into the threshold: if the slab reaches you, it shoulders you out one side or the other.
    const pl = game.player;
    if (pl.alive && gap < DOOR_OPEN_HEIGHT - 0.01 && Math.abs(pl.pos.x) < 3.05 && pl.pos.z > 40.25 && pl.pos.z < 41.75 && pl.pos.y < 3) {
      const need = (pl.crouching ? CROUCH_HEIGHT : STAND_HEIGHT) + 0.02;
      if (gap < need && (pl.crouching || gap < DOOR_CROUCH_GAP)) {
        const out = pl.pos.z >= 41;
        pl.teleport(pl.pos.x, 0.02, out ? 42.2 : 39.8, pl.yaw);
        game.toast(out ? 'The slab shoulders you out into the open.' : 'The slab forces you back inside.', out ? 'good' : 'bad');
      }
    }
  }

  frame(): void {
    this.mesh.position.set(0, this.yOf(), 41);
  }

  dispose(): void {
    this.game.physics.removeBody(this.body);
    this.mesh.removeFromParent();
    this.mesh.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

export function* buildCourtyard(k: SceneKit): Generator<void> {
  const game = k.game;
  const C = COURT;
  const H = C.wallH;
  const veg = game.renderer.quality.vegetation;

  k.floorsFromLayout();
  yield;

  // ------------------------------------------------------------ south wall
  k.box(-32, -1, 40, -4.6, H, 42, WALL);
  k.box(4.6, -1, 40, 32, H, 42, WALL);
  // Gate tower: two piers, and a hollow lintel the slab rides up into.
  k.box(-4.6, -1, 40, -2.6, 11.4, 42, WALL, { tint: 1.05 });
  k.box(2.6, -1, 40, 4.6, 11.4, 42, WALL, { tint: 1.05 });
  k.box(-2.6, DOOR_OPEN_HEIGHT, 40, 2.6, 11.4, 40.5, WALL);
  k.box(-2.6, DOOR_OPEN_HEIGHT, 41.5, 2.6, 11.4, 42, WALL);
  k.box(-5, 11.4, 39.7, 5, 12.1, 42.3, WALL, { tint: 1.1 });
  k.add(new GreatDoor(game, k.group));
  mural(k, 'doorIn', ['sun', 'arrow', 'moon', 'door', 'skull'], 5.6, 2.2, 39.98, 0, -1, { dark: false, accent: 'door' });
  mural(k, 'doorIn2', ['eye', 'hand', 'flame'], -5.4, 2.2, 39.98, 0, -1, { dark: false });

  // ------------------------------------------------------------- east wall
  const al = C.alcove;
  k.box(30, -1, -22, 32, H, 4, WALL);
  k.box(30, 4.2, 4, 32, H, 8, WALL); // lintel over the cliff gate
  k.box(30, -1, 8, 32, H, al.z0, WALL);
  k.box(al.x1, -1, al.z0, 32, H, al.z1, WALL); // alcove back wall
  k.box(30, 3.1, al.z0, al.x1, H, al.z1, WALL); // alcove ceiling
  k.box(30, -1, al.z1, 32, H, 42, WALL);
  k.box(29.7, 0, 3.4, 30, 4.7, 4, 'mossStone', { solid: false });
  k.box(29.7, 0, 8, 30, 4.7, 8.6, 'mossStone', { solid: false });
  // The censer's pedestal is wired to the wall behind it.
  const courtDarts = k.add(
    new DartTrap(game, k.group, [0.75, 1.6, 2.45].map((o) => ({ x: al.x1 - 0.06, y: 1.32, z: al.z0 + o })), { x: -1, y: 0, z: 0 }, 16, false),
  );
  for (const o of [0.75, 1.6, 2.45]) k.box(al.x1 - 0.05, 1.24, al.z0 + o - 0.08, al.x1 - 0.01, 1.4, al.z0 + o + 0.08, 'char', { solid: false });
  k.trap('courtDarts', () => courtDarts.trigger());
  mural(k, 'alcove', ['hand', 'block', 'arrow', 'skull'], 29.98, 2.1, al.z1 + 1.6, -1, 0, { dark: false, accent: 'block' });
  yield;

  // -------------------------------------------------- west wall and canal
  const cn = C.canal;
  const br = C.bridge;
  k.box(-32, -4, -22, -30, H, br.z0, WALL, { shade: [0.6, 1] });
  k.box(-32, -4, br.z1, -30, H, 42, WALL, { shade: [0.6, 1] });
  k.box(-32, 4.6, br.z0, -30, H, br.z1, WALL); // lintel over the drawbridge gap
  k.box(-32, -4, br.z0, -30, -0.6, br.z1, WALL); // wall base under the landing
  k.box(-32, -4, -36, -27, 8.7, -22, WALL, { shade: [0.6, 1] }); // temple flank
  // Plaza retaining wall and the kerb along the canal.
  k.box(-23, -4, cn.z0, -22.6, -0.6, 32, 'mossStone', { shade: [0.55, 0.95] });
  k.box(-23.35, -4, cn.z0, -23, 0.35, br.z0, 'mossStone', { shade: [0.55, 1] });
  k.box(-23.35, -4, br.z1, -23, 0.35, cn.z1, 'mossStone', { shade: [0.55, 1] });
  k.box(-30, -4, -20, -23, -0.6, cn.z0, 'mossStone', { shade: [0.55, 0.95] });
  k.add(new Water(game, k.group, 'courtyard', -30, cn.z0, -23.35, cn.z1 + 2.6, cn.water, { x: 0, y: 0, z: 0 }, false));
  k.add(new Drawbridge(game, k.group, -30, 0, br.z0, br.z1, 7, () => game.hasFlag('drawbridge'), false));
  yield;

  // ---------------------------------------------------------- temple facade
  const FH = 10.6;
  k.box(-32, -1, -22, -3, FH, -20, WALL, { tint: 1.04 });
  k.box(3, -1, -22, 32, FH, -20, WALL, { tint: 1.04 });
  k.box(-3, 6.2, -22, 3, FH, -20, WALL, { tint: 1.04 });
  k.box(-4.2, FH, -22.4, 4.2, FH + 1.4, -19.6, WALL, { tint: 1.1 });
  for (const s of [-1, 1]) {
    k.box(s * 3 - 0.5, 0, -20, s * 3 + 0.5, 6.6, -19.5, 'mossStone', { solid: false });
    // Cheek walls beside the temple steps.
    k.box(s * 3.9 - 0.9, 0, -20, s * 3.9 + 0.9, 1.5, -16, WALL);
  }
  mural(k, 'dialHint', ['sun', 'serpent', 'eye', 'door'], -9, 2.6, -19.98, 0, 1, { dark: false, accent: 'serpent', height: 1.3 });
  mural(k, 'depths', ['flame', 'wave', 'key', 'skull'], 9, 2.6, -19.98, 0, 1, { dark: false, accent: 'key', height: 1.3 });
  supply(k, 'portalFlask', 'flask', 5.6, 0, -18.6, false);

  // ----------------------------------------------------------------- dial
  const s = C.sundial;
  k.cyl(s.x, 0, s.z, s.r, 0.25, 'flagstone', { seg: 28, tint: 1.08 });
  const spawnDisc = (dial: Sundial): void => {
    if (game.hasFlag('sunDisc')) return;
    k.add(new KeyPickup(game, k, 'sun_disc', dial.keyPos, false, () => game.setFlag('sunDisc')));
  };
  const dial: Sundial = k.add(new Sundial(game, k, s.x, s.z, 0.25, () => spawnDisc(dial)));
  if (game.run.get('sundial.solved', false)) spawnDisc(dial);
  k.box(s.x + 4.4, 0, s.z - 0.6, s.x + 5.0, 1.1, s.z + 0.6, 'mossStone');
  mural(k, 'dialPlaque', ['sun', 'arrow', 'serpent'], s.x + 4.38, 0.72, s.z, -1, 0, { dark: false, height: 0.5, accent: 'serpent' });
  yield;

  // ---------------------------------------------- fountain, pillars, rubble
  const f = C.fountain;
  k.cyl(f.x, 0, f.z, f.r, 0.62, 'mossStone', { seg: 18 });
  k.cyl(f.x, 0.62, f.z, 0.55, 1.5, 'templeStone', { seg: 10, rTop: 0.4 });
  k.cyl(f.x, 2.12, f.z, 0.5, 0.25, 'mossStone', { seg: 12, rTop: 1.2, solid: false });
  {
    const g = new THREE.CircleGeometry(f.r - 0.55, 24);
    g.rotateX(-Math.PI / 2);
    const pool = game.mats.mesh(g, 'water', false);
    pool.position.set(f.x, 0.64, f.z);
    pool.receiveShadow = true;
    k.group.add(pool);
    const rim = new THREE.TorusGeometry(f.r - 0.3, 0.3, 6, 24);
    rim.rotateX(Math.PI / 2);
    const m = new THREE.Matrix4().makeTranslation(f.x, 0.62, f.z);
    k.geo(rim, 'mossStone', m);
    rim.dispose();
  }
  fallenPillar(k, 5.6, 29.2, 13.2, 25.6, 0.7, 0);
  fallenPillar(k, -13.1, -6.0, -5.4, -9.8, 0.7, 0);
  k.propsFromLayout({ dungeon: false });
  for (const [x, z, r] of [[14.5, 24.6, 0.7], [4.6, 30.4, 0.5], [-4.2, -10.6, 0.6], [23.4, 15.2, 0.8], [-17.6, 7.4, 0.7], [12.9, -4.6, 0.6]] as const) {
    rock(k, x, 0, z, r, { mat: 'pillar', solid: r > 0.65 });
  }
  k.prop('rockA', 'rock', 2, 26.5, 0.3, 19);
  k.prop('rockB', 'rock', 1.5, 24.2, 0.3, 25.2);
  k.prop('potA', 'pot', 2.5, -15, 0.3, 30);
  k.prop('rubbleA', 'rubble', 5, 14.4, 0.3, 22.8);
  yield;

  // ---------------------------------------------------------------- terrace
  k.box(-52, -4, -34, -40, 1.19, -12, 'terrain', { shade: [0.6, 1], color: [0.62, 0.8, 0.5], surface: 'grass' });
  k.box(-40, -4, -34, -32, 1.19, -12, 'terrain', { shade: [0.6, 1], color: [0.62, 0.8, 0.5], surface: 'grass' });
  k.box(-52, -4, -12, -50, 1.19, -8, 'terrain', { shade: [0.6, 1], color: [0.62, 0.8, 0.5], surface: 'grass' });
  k.box(-54, -4, -34, -52, 6.5, -6, WALL, { shade: [0.6, 1] });
  k.box(-54, -4, -8, -30, 6.5, -6, WALL, { shade: [0.6, 1] });
  k.add(
    new Lever(game, k, { x: -33.3, y: 0, z: -8.7 }, Math.PI, 'Turn the winch: lower the drawbridge', () => game.hasFlag('drawbridge'), () => {
      game.setFlag('drawbridge');
      game.toast('The drawbridge drops. A way out that stays open.', 'good');
    }, false),
  );
  supply(k, 'terraceSpare', 'spare', -47.2, 1.2, -18, false);
  mural(k, 'terrace', ['door', 'arrow', 'wave', 'arrow', 'sun'], -41, 3.2, -33.98, 0, 1, { dark: false });
  yield;

  // ----------------------------------------------------------- overgrowth
  const rng = k.rng;
  const blocked = (x: number, z: number): boolean =>
    Math.hypot(x - s.x, z - s.z) < s.r + 1.2 || Math.hypot(x - f.x, z - f.z) < f.r + 0.6 || (Math.abs(x) < 4 && (z > 34 || z < -12));
  const trunks: Scatter[] = [];
  const crowns: Scatter[] = [];
  for (const [x, z, sc] of [[26.5, 36.5, 1.1], [-19.5, 37, 0.95], [27, -15.5, 1], [-20.5, -15, 0.9], [18, 20.5, 0.8], [-44, -26, 1.1], [-36.5, -17, 0.85]] as const) {
    const y = x < -32 ? 1.19 : 0;
    trunks.push({ x, y: y - 0.2, z, s: sc, rot: rng.next() * 6.28, hue: rng.next() });
    crowns.push({ x, y: y + 6.1 * sc, z, s: 3.2 * sc, rot: rng.next() * 6.28, hue: rng.next() });
    crowns.push({ x: x + 1.3, y: y + 5 * sc, z: z - 0.9, s: 2.2 * sc, rot: rng.next() * 6.28, hue: rng.next() });
    k.collider(RAPIER.ColliderDesc.cylinder(3, 0.36 * sc).setTranslation(x, y + 3, z), { surface: 'wood' });
    k.cyl(x, y, z, 1.1 * sc, 0.3, 'mossStone', { seg: 8, solid: false });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.42, 6.5, 7, 1);
  trunkGeo.translate(0, 3.25, 0);
  instanced(k, trunkGeo, game.mats.get('bark'), trunks, { cast: true, tilt: 0.06 });
  instanced(k, canopyGeometry(), game.mats.get('foliage'), crowns, { cast: true, color: leafTint });
  const cards: Scatter[] = [];
  const tufts: Scatter[] = [];
  const n = Math.round(420 * veg);
  for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
    const terrace = rng.chance(0.22);
    let x: number;
    let z: number;
    let y = 0;
    if (terrace) {
      x = rng.range(-51.5, -32.5);
      z = rng.range(-33.5, -12.5);
      y = 1.19;
      if (x > -50 && x < -46) continue; // the worn path
    } else {
      // Hug the walls and the bases of things: the middle of the plaza stays readable.
      const edge = rng.chance(0.65);
      x = edge ? (rng.chance(0.5) ? rng.range(-22.5, -19) : rng.range(26, 29.6)) : rng.range(-22, 29);
      z = edge && rng.chance(0.4) ? rng.range(36, 39.6) : rng.range(-15.5, 39.5);
      if (blocked(x, z)) continue;
    }
    if (rng.chance(0.3)) cards.push({ x, y: y - 0.05, z, s: rng.range(0.7, 1.4), rot: rng.next() * 6.28, hue: rng.next() });
    else tufts.push({ x, y: y - 0.04, z, s: rng.range(0.35, 0.7), rot: rng.next() * 6.28, hue: rng.next() });
    i++;
  }
  const cardMat = game.mats.get('leafCard');
  instanced(k, crossCardGeometry(1.5, 1.5), cardMat, cards, { color: leafTint });
  instanced(k, crossCardGeometry(1.2, 0.9), cardMat, tufts, { color: leafTint });

  // Creepers hanging over the walls (decoration only: the climbable ones are on the cliffs).
  const vine = game.mats.get('vineCard');
  const vg = new THREE.PlaneGeometry(1, 1);
  vg.translate(0, -0.5, 0);
  const hang: THREE.Matrix4[] = [];
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const e4 = new THREE.Euler();
  const place = (x: number, z: number, yaw: number, w: number, h: number, top: number): void => {
    hang.push(m4.compose(new THREE.Vector3(x, top, z), q4.setFromEuler(e4.set(0, yaw, 0)), new THREE.Vector3(w, h, 1)).clone());
  };
  for (let i = 0; i < Math.round(26 * veg); i++) {
    const side = i % 4;
    const t = rng.range(-18, 38);
    const h = rng.range(2.2, 5.5);
    const w = rng.range(1.6, 3.2);
    if (side === 0) place(29.94, t, -Math.PI / 2, w, h, H + 0.1);
    else if (side === 1) place(clampX(t), 39.94, Math.PI, w, h, H + 0.1);
    else if (side === 2) place(clampX(t), -19.94, 0, w, h, FH - rng.range(0, 3));
    else place(-29.94 + 0.0, t < -12 || t > -8 ? t : 20, Math.PI / 2, w, h, H + 0.1);
  }
  const vines = new THREE.InstancedMesh(vg, vine, hang.length);
  hang.forEach((mm, i) => vines.setMatrixAt(i, mm));
  vines.receiveShadow = true;
  k.group.add(vines);
}

/** Keep hanging creepers off the door and portal openings. */
function clampX(t: number): number {
  const x = t * 0.8 - 6;
  return Math.abs(x) < 6 ? (x < 0 ? x - 7 : x + 7) : x;
}
