import * as THREE from 'three';
import { isSunlit, sunPatch, type RoofOpening } from '../core/sunlight';
import { sunDirection } from '../core/sun';
import {
  DART_HEIGHT, DART_SPEED, DMG, NOISE, bladeAngle, boulderDamage, dartHits, newDartTrap, newPlank, newPlate, newTile,
  scarabDamage, stepDartTrap, stepPlank, stepPlate, stepTile, type DartTrap as DartState, type Plank, type Plate, type Tile,
} from '../core/traps';
import type { Progress } from '../core/unlock';
import type { SceneBuilder, SetPiece } from '../engine/builder';
import type { Gate, MatName } from '../engine/materials';
import { CG, G, RAPIER, groups } from '../engine/physics';
import type { Game } from '../game/Game';
import type { Climbable, Interactable, WaterVolume, WindZone } from './types';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), ZAXIS = new THREE.Vector3(0, 0, 1);

/** Matrix for a unit box stretched between two points. */
function segmentMatrix(a: THREE.Vector3, b: THREE.Vector3, thick: number, out: THREE.Matrix4): THREE.Matrix4 {
  _a.subVectors(b, a);
  const len = _a.length() || 0.001;
  _q.setFromUnitVectors(ZAXIS, _a.divideScalar(len));
  _b.addVectors(a, b).multiplyScalar(0.5);
  return out.compose(_b, _q, _s.set(thick, thick, len));
}

function boxMesh(game: Game, mat: MatName, sx: number, sy: number, sz: number, gate: Gate): THREE.Mesh {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const ts = game.mats.scaleOf(mat);
  const uv = g.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, (uv.getX(k) * dims[f][0]) / ts, (uv.getY(k) * dims[f][1]) / ts);
  }
  // Merged level materials use vertex colours; give standalone meshes white ones.
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  const m = new THREE.Mesh(g, game.mats.get(mat, gate));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function tintMesh(mesh: THREE.Mesh, k: number): void {
  const c = mesh.geometry.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < c.count; i++) c.setXYZ(i, k, k, k);
  c.needsUpdate = true;
}

// =============================================================================================
// Rope bridge: planks are rigid bodies chained with spherical joints and hung between two anchors.
// =============================================================================================

interface PlankRt {
  /** The link in the chain. It outlives the plank: the ropes still hang when the wood has gone. */
  body: RAPIER.RigidBody; col: RAPIER.Collider;
  mesh: THREE.Mesh | null; debris: RAPIER.RigidBody | null;
  st: Plank; loaded: boolean; removeAt: number; index: number;
}

const NO_COLLIDE = groups(0, 0);

export class RopeBridge implements SetPiece {
  private planks: PlankRt[] = [];
  private ropes: THREE.InstancedMesh;
  private right = new THREE.Vector3();
  private a = new THREE.Vector3(); private b = new THREE.Vector3();
  private halfW: number;
  private time = 0;

  constructor(private game: Game, private sb: SceneBuilder, readonly id: string,
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, width = 2.0, private onBroken?: () => void) {
    const { physics, run } = game;
    // ay and by are the level of the ground at each end; the deck hangs with its top flush to it.
    this.a.set(ax, ay - 0.06, az); this.b.set(bx, by - 0.06, bz);
    const d = new THREE.Vector3().subVectors(this.b, this.a);
    const L = d.length(); d.normalize();
    const n = Math.max(3, Math.round(L / 0.95));
    const spacing = L / n, depth = spacing - 0.1;
    const yaw = Math.atan2(d.x, d.z);
    const rot = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    this.right.set(d.z, 0, -d.x);
    this.halfW = width / 2;
    const gate = sb.gate;
    for (let i = 0; i < n; i++) {
      const gone = run.fallen.has(`${id}:${i}`);
      const c = new THREE.Vector3().copy(this.a).addScaledVector(d, (i + 0.5) * spacing);
      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(c.x, c.y, c.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }).setLinearDamping(0.9).setAngularDamping(2.5));
      const col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, 0.06, depth / 2).setMass(9)
        .setFriction(1).setCollisionGroups(gone ? NO_COLLIDE : CG.SOLID), body);
      let mesh: THREE.Mesh | null = null;
      if (!gone) {
        mesh = boxMesh(game, 'wood', width, 0.12, depth, gate);
        sb.add(mesh);
        physics.addSync(body, mesh);
      }
      const p: PlankRt = { body, col, mesh, debris: null, st: newPlank(), loaded: false, removeAt: 0, index: i };
      if (gone) p.st.state = 'dropped';
      else game.groundTriggers.set(col.handle, () => { p.loaded = true; });
      this.planks.push(p);
    }
    const side = this.halfW - 0.12;
    const link = (b1: RAPIER.RigidBody, a1: THREE.Vector3, b2: RAPIER.RigidBody, a2: THREE.Vector3) => {
      const jd = RAPIER.JointData.spherical({ x: a1.x, y: a1.y, z: a1.z }, { x: a2.x, y: a2.y, z: a2.z });
      physics.world.createImpulseJoint(jd, b1, b2, true);
    };
    for (let i = 0; i <= n; i++) {
      const prev = i > 0 ? this.planks[i - 1] : null, cur = i < n ? this.planks[i] : null;
      for (const s of [-1, 1]) {
        if (i === 0 && cur) {
          const w = new THREE.Vector3().copy(this.a).addScaledVector(this.right, s * side);
          link(sb.body, w, cur.body, new THREE.Vector3(s * side, 0, -spacing / 2));
        } else if (i === n && prev) {
          const w = new THREE.Vector3().copy(this.b).addScaledVector(this.right, s * side);
          link(prev.body, new THREE.Vector3(s * side, 0, spacing / 2), sb.body, w);
        } else if (prev && cur) {
          link(prev.body, new THREE.Vector3(s * side, 0, spacing / 2), cur.body, new THREE.Vector3(s * side, 0, -spacing / 2));
        }
      }
    }
    const rg = new THREE.BoxGeometry(1, 1, 1);
    this.ropes = new THREE.InstancedMesh(rg, game.mats.get('rope', gate), (n + 1) * 2);
    this.ropes.castShadow = true;
    this.ropes.frustumCulled = false;
    sb.add(this.ropes);
    sb.track(rg);
    // Anchor posts.
    for (const end of [this.a, this.b]) for (const s of [-1, 1]) {
      const p = new THREE.Vector3().copy(end).addScaledVector(this.right, s * (this.halfW + 0.1));
      sb.box('wood', p.x - 0.12, p.y - 0.6, p.z - 0.12, p.x + 0.12, p.y + 1.1, p.z + 0.12, { collide: false });
    }
  }

  get fallenCount(): number { return this.planks.filter((p) => p.st.state === 'dropped').length; }

  fixedUpdate(dt: number): void {
    this.time += dt;
    const { game } = this;
    const { physics } = game;
    for (const p of this.planks) {
      if (p.st.state === 'dropped') {
        if (p.debris && this.time > p.removeAt) {
          physics.removeBody(p.debris); p.debris = null;
          if (p.mesh) { p.mesh.removeFromParent(); p.mesh.geometry.dispose(); p.mesh = null; }
        }
        continue;
      }
      const ev = stepPlank(p.st, p.loaded, dt);
      // The player's weight bears down on the plank, so the span dips and sways underfoot.
      if (p.loaded) p.body.applyImpulse({ x: 0, y: -160 * dt, z: 0 }, true);
      p.loaded = false;
      if (ev === 'creak') game.audio.play('creak', { pos: p.body.translation() });
      else if (ev === 'crack') {
        game.audio.play('snap', { pos: p.body.translation() });
        if (p.mesh) tintMesh(p.mesh, 0.5);
        p.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * 3, y: 0, z: (Math.random() - 0.5) * 3 }, true);
      } else if (ev === 'drop') {
        // The wood falls away as its own body. The link stays in the chain, so the ropes hold.
        const t = p.body.translation(), r = p.body.rotation(), v = p.body.linvel();
        const he = (p.col.shape as RAPIER.Cuboid).halfExtents;
        p.col.setCollisionGroups(NO_COLLIDE);
        game.groundTriggers.delete(p.col.handle);
        const debris = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x, t.y, t.z).setRotation(r).setLinvel(v.x, v.y - 1, v.z));
        physics.world.createCollider(RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z).setMass(9).setCollisionGroups(CG.SMALL), debris);
        debris.applyTorqueImpulse({ x: (Math.random() - 0.5) * 8, y: 0, z: (Math.random() - 0.5) * 8 }, true);
        p.debris = debris;
        if (p.mesh) { physics.removeSync(p.body); physics.addSync(debris, p.mesh); }
        p.removeAt = this.time + 4;
        game.run.fallen.add(`${this.id}:${p.index}`);
        game.audio.play('plankFall', { pos: t });
        game.emitNoise(new THREE.Vector3(t.x, t.y, t.z), 16);
        if (this.fallenCount >= 3) this.onBroken?.();
      }
    }
  }

  update(): void {
    // Ropes run along both edges of the chain, across any gaps where planks have gone.
    let k = 0;
    const n = this.planks.length;
    for (const s of [-1, 1]) {
      let prev = _edge(this.a, this.right, s * this.halfW, new THREE.Vector3());
      for (let i = 0; i <= n; i++) {
        let cur: THREE.Vector3;
        if (i === n) cur = _edge(this.b, this.right, s * this.halfW, new THREE.Vector3());
        else {
          const body = this.planks[i].body, t = body.translation(), r = body.rotation();
          cur = new THREE.Vector3(s * this.halfW, 0.02, 0).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(_v.set(t.x, t.y, t.z));
        }
        this.ropes.setMatrixAt(k++, segmentMatrix(prev, cur, 0.07, _m));
        prev = cur;
      }
    }
    this.ropes.count = k;
    this.ropes.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const p of this.planks) {
      this.game.groundTriggers.delete(p.col.handle);
      this.game.physics.removeBody(p.body);
      if (p.debris) this.game.physics.removeBody(p.debris);
      p.mesh?.geometry.dispose();
    }
    this.planks.length = 0;
  }
}

function _edge(p: THREE.Vector3, right: THREE.Vector3, off: number, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(p).addScaledVector(right, off).setY(p.y + 0.02);
}

// =============================================================================================
// Crumbling floor
// =============================================================================================

export interface TileDef { x1: number; z1: number; x2: number; z2: number; solid?: boolean; }

interface TileRt { body: RAPIER.RigidBody; col: RAPIER.Collider; mesh: THREE.Mesh; st: Tile; loaded: boolean; removeAt: number; index: number; base: THREE.Vector3; }

export class CrumbleFloor implements SetPiece {
  private tiles: TileRt[] = [];
  private time = 0;

  constructor(private game: Game, sb: SceneBuilder, readonly id: string, defs: TileDef[], y: number, mat: MatName = 'cryptFloor') {
    const th = 0.35;
    defs.forEach((d, i) => {
      if (d.solid) { sb.box(mat, d.x1 + 0.03, y - th, d.z1 + 0.03, d.x2 - 0.03, y, d.z2 - 0.03, { tint: 0.82 }); return; }
      if (game.run.fallen.has(`${id}:${i}`)) return;
      const cx = (d.x1 + d.x2) / 2, cz = (d.z1 + d.z2) / 2, sx = d.x2 - d.x1 - 0.06, sz = d.z2 - d.z1 - 0.06;
      const body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, y - th / 2, cz));
      const col = game.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, th / 2, sz / 2).setMass(60).setCollisionGroups(CG.STATIC), body);
      const mesh = boxMesh(game, mat, sx, th, sz, sb.gate);
      mesh.position.set(cx, y - th / 2, cz);
      sb.add(mesh);
      const t: TileRt = { body, col, mesh, st: newTile(), loaded: false, removeAt: 0, index: i, base: mesh.position.clone() };
      this.tiles.push(t);
      game.groundTriggers.set(col.handle, () => { t.loaded = true; });
    });
  }

  fixedUpdate(dt: number): void {
    this.time += dt;
    const { game } = this;
    for (let k = this.tiles.length - 1; k >= 0; k--) {
      const t = this.tiles[k];
      if (t.st.state === 'fallen') {
        if (this.time > t.removeAt) { game.physics.removeBody(t.body); t.mesh.removeFromParent(); t.mesh.geometry.dispose(); this.tiles.splice(k, 1); }
        continue;
      }
      const ev = stepTile(t.st, t.loaded, dt);
      t.loaded = false;
      if (t.st.state === 'shaking') {
        t.mesh.position.set(t.base.x + (Math.random() - 0.5) * 0.05, t.base.y - Math.random() * 0.03, t.base.z + (Math.random() - 0.5) * 0.05);
      }
      if (ev === 'shake') { game.audio.play('crumble', { pos: t.base, vol: 0.7 }); game.emitNoise(t.base, 10); }
      else if (ev === 'fall') {
        game.groundTriggers.delete(t.col.handle);
        t.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        t.col.setCollisionGroups(CG.SMALL);
        t.body.setAngvel({ x: (Math.random() - 0.5) * 3, y: 0, z: (Math.random() - 0.5) * 3 }, true);
        game.physics.addSync(t.body, t.mesh);
        t.removeAt = this.time + 3.5;
        game.run.fallen.add(`${this.id}:${t.index}`);
        game.nav.setTagEnabled(`${this.id}:${t.index}`, false);
        game.audio.play('rubble', { pos: t.base });
        game.emitNoise(t.base, 20, NOISE.trap * 0.5);
      }
    }
  }

  dispose(): void {
    for (const t of this.tiles) { this.game.groundTriggers.delete(t.col.handle); this.game.physics.removeBody(t.body); t.mesh.geometry.dispose(); }
    this.tiles.length = 0;
  }
}

// =============================================================================================
// Pushable stone block
// =============================================================================================

export class PushBlock implements SetPiece {
  body: RAPIER.RigidBody;
  col: RAPIER.Collider;
  mesh: THREE.Mesh;
  private pushT = 0;
  private grindT = 0;

  constructor(private game: Game, sb: SceneBuilder, readonly id: string, x: number, y: number, z: number, readonly size = 1.3, readonly mass = 260) {
    const saved = game.run.blockPos.get(id);
    const p = saved ?? { x, y: y + size / 2, z };
    this.body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).lockRotations().setLinearDamping(6));
    this.col = game.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2).setMass(mass).setFriction(0.9).setCollisionGroups(CG.SOLID), this.body);
    this.mesh = boxMesh(game, 'glyph', size, size, size, sb.gate);
    sb.add(this.mesh);
    game.physics.addSync(this.body, this.mesh);
    game.pushables.set(this.col.handle, this);
  }

  /** Called by the player while walking into the block. Slides along the dominant axis. */
  push(dx: number, dz: number, strength: number): void {
    const ax = Math.abs(dx) > Math.abs(dz);
    const v = this.body.linvel();
    const speed = 1.7 * strength;
    this.body.setLinvel({ x: ax ? Math.sign(dx) * speed : 0, y: v.y, z: ax ? 0 : Math.sign(dz) * speed }, true);
    this.pushT = 0.12;
  }

  get pos(): { x: number; y: number; z: number } { return this.body.translation(); }

  fixedUpdate(dt: number): void {
    this.pushT -= dt;
    const v = this.body.linvel();
    const sp = Math.hypot(v.x, v.z);
    if (this.pushT > 0 && sp > 0.3) {
      this.grindT -= dt;
      if (this.grindT <= 0) { this.grindT = 0.45; this.game.audio.play('grind', { pos: this.mesh.position, vol: 0.6 }); this.game.emitNoise(this.mesh.position, 12, 0.02); }
    }
  }

  dispose(): void {
    const t = this.body.translation();
    this.game.run.blockPos.set(this.id, { x: t.x, y: t.y, z: t.z });
    this.game.pushables.delete(this.col.handle);
    this.game.physics.removeBody(this.body);
    this.mesh.geometry.dispose();
  }
}

// =============================================================================================
// Pressure plate
// =============================================================================================

export class PressurePlate implements SetPiece {
  readonly st: Plate;
  private mesh: THREE.Mesh;
  private baseY: number;

  constructor(private game: Game, sb: SceneBuilder, readonly id: string, private x1: number, private z1: number, private x2: number, private z2: number,
    private y: number, private onChange: (pressed: boolean) => void, threshold?: number) {
    this.st = newPlate(threshold);
    this.mesh = boxMesh(game, 'glyph', x2 - x1, 0.12, z2 - z1, sb.gate);
    this.baseY = y + 0.02;
    this.mesh.position.set((x1 + x2) / 2, this.baseY, (z1 + z2) / 2);
    this.mesh.castShadow = false;
    sb.add(this.mesh);
  }

  private inside(x: number, y: number, z: number, pad = 0): boolean {
    return x > this.x1 - pad && x < this.x2 + pad && z > this.z1 - pad && z < this.z2 + pad && Math.abs(y - this.y) < 0.6;
  }

  fixedUpdate(): void {
    const { game } = this;
    let mass = 0;
    const p = game.player;
    if (p.grounded && this.inside(p.pos.x, p.pos.y, p.pos.z)) mass += 75 + game.run.satchel.weight;
    for (const blk of game.pushables.values()) {
      const t = blk.pos;
      if (this.inside(t.x, t.y - blk.size / 2, t.z, 0.2)) mass += blk.mass;
    }
    for (const pr of game.props.list) {
      if (pr.held) continue;
      const t = pr.body.translation();
      if (this.inside(t.x, t.y - 0.2, t.z)) mass += pr.weight;
    }
    const ev = stepPlate(this.st, mass);
    if (ev) {
      this.mesh.position.y = this.baseY - (ev === 'pressed' ? 0.07 : 0);
      game.audio.play('click', { pos: this.mesh.position });
      this.onChange(ev === 'pressed');
    }
  }

  get pressed(): boolean { return this.st.pressed; }
  dispose(): void { this.mesh.geometry.dispose(); }
}

// =============================================================================================
// Sliding stone door (Great Door, portcullis, seals, gates): a kinematic body.
// =============================================================================================

export interface DoorOpts {
  x: number; y: number; z: number; sx: number; sy: number; sz: number;
  /** Offset from the closed position when fully open. */
  open: [number, number, number];
  mat?: MatName;
  /** Fraction per second. */
  speed?: number;
  /** Starting open fraction. */
  initial?: number;
  quiet?: boolean;
}

export class SlideDoor implements SetPiece {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  fraction: number;
  target: number;
  speed: number;
  private grindT = 0;

  constructor(private game: Game, sb: SceneBuilder, private o: DoorOpts) {
    this.fraction = this.target = o.initial ?? 0;
    this.speed = o.speed ?? 0.5;
    this.body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    game.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(o.sx / 2, o.sy / 2, o.sz / 2).setCollisionGroups(CG.STATIC), this.body);
    this.mesh = boxMesh(game, o.mat ?? 'glyph', o.sx, o.sy, o.sz, sb.gate);
    sb.add(this.mesh);
    this.apply(true);
  }

  private apply(teleport = false): void {
    const { o } = this, f = this.fraction;
    const x = o.x + o.open[0] * f, y = o.y + o.open[1] * f, z = o.z + o.open[2] * f;
    if (teleport) this.body.setTranslation({ x, y, z }, true);
    else this.body.setNextKinematicTranslation({ x, y, z });
    this.mesh.position.set(x, y, z);
  }

  setOpen(open: boolean): void { this.target = open ? 1 : 0; }
  /** Jump straight to a fraction with no animation (used when a scene streams back in). */
  snap(f: number): void { this.fraction = this.target = f; this.apply(true); }
  get isOpen(): boolean { return this.fraction > 0.95; }
  get moving(): boolean { return Math.abs(this.fraction - this.target) > 1e-4; }

  fixedUpdate(dt: number): void {
    if (!this.moving) return;
    const d = this.target - this.fraction;
    const step = Math.sign(d) * Math.min(Math.abs(d), this.speed * dt);
    this.fraction += step;
    this.apply();
    if (!this.o.quiet) {
      this.grindT -= dt;
      if (this.grindT <= 0) { this.grindT = 0.5; this.game.audio.play('grind', { pos: this.mesh.position, vol: 0.9 }); }
      if (!this.moving) this.game.audio.play('thud', { pos: this.mesh.position });
    }
  }

  dispose(): void { this.game.physics.removeBody(this.body); this.mesh.geometry.dispose(); }
}

// =============================================================================================
// Kick-down wall (shortcut)
// =============================================================================================

export class KickWall implements SetPiece {
  private body: RAPIER.RigidBody | null = null;
  private mesh: THREE.Group | null = null;
  private chunks: { body: RAPIER.RigidBody; mesh: THREE.Mesh; die: number }[] = [];
  private inter: Interactable | null = null;
  private time = 0;
  private center = new THREE.Vector3();

  constructor(private game: Game, private sb: SceneBuilder, readonly id: string, private x1: number, private y1: number, private z1: number,
    private x2: number, private y2: number, private z2: number, private flag: keyof Progress & ('kickEast' | 'kickSmuggler'), private navTag: string) {
    this.center.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    if (game.run.progress[flag]) { game.nav.setTagEnabled(navTag, true); return; }
    game.nav.setTagEnabled(navTag, false);
    const sx = x2 - x1, sy = y2 - y1, sz = z2 - z1;
    this.body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(this.center.x, this.center.y, this.center.z));
    game.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setCollisionGroups(CG.STATIC), this.body);
    this.mesh = new THREE.Group();
    const main = boxMesh(game, 'rubble', sx, sy, sz, sb.gate);
    this.mesh.add(main);
    // Cracks: thin dark slashes proud of both faces so the wall reads as breakable.
    const thinX = sx < sz;
    const crackMat = game.mats.solid(0x0c0a08, 1, 0, 0, sb.gate);
    for (let i = 0; i < 7; i++) {
      const len = 0.6 + Math.random() * 1.3;
      const g = new THREE.BoxGeometry(thinX ? sx + 0.06 : 0.05, len, thinX ? 0.05 : sz + 0.06);
      const c = new THREE.Mesh(g, crackMat);
      const along = (Math.random() - 0.5) * (thinX ? sz : sx) * 0.8;
      c.position.set(thinX ? 0 : along, (Math.random() - 0.5) * sy * 0.7, thinX ? along : 0);
      c.rotation[thinX ? 'x' : 'z'] = (Math.random() - 0.5) * 1.6;
      this.mesh.add(c);
    }
    this.mesh.position.copy(this.center);
    sb.add(this.mesh);
    this.inter = {
      pos: this.center.clone().setY(y1 + 1.3), range: 3.2, priority: 2, solid: true,
      prompt: () => 'Kick down the cracked wall',
      act: () => this.breakOpen(true),
    };
    game.addInteractable(this.inter);
  }

  breakOpen(byPlayer: boolean): void {
    if (!this.body) return;
    const { game } = this;
    game.physics.removeBody(this.body); this.body = null;
    this.mesh?.removeFromParent(); this.mesh = null;
    if (this.inter) { game.removeInteractable(this.inter); this.inter = null; }
    game.run.progress[this.flag] = true;
    game.nav.setTagEnabled(this.navTag, true);
    // Burst outward, away from whoever kicked it.
    const away = new THREE.Vector3().subVectors(this.center, game.player.pos).setY(0).normalize();
    for (let i = 0; i < 10; i++) {
      const s = 0.35 + Math.random() * 0.45;
      const p = new THREE.Vector3(this.x1 + Math.random() * (this.x2 - this.x1), this.y1 + Math.random() * (this.y2 - this.y1), this.z1 + Math.random() * (this.z2 - this.z1));
      const body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z)
        .setLinvel(away.x * (3 + Math.random() * 4), 1 + Math.random() * 3, away.z * (3 + Math.random() * 4)).setAngvel({ x: Math.random() * 6, y: Math.random() * 6, z: Math.random() * 6 }));
      game.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(s / 2, s / 2, s / 2).setMass(12).setCollisionGroups(CG.SMALL), body);
      const mesh = boxMesh(game, 'rubble', s, s, s, this.sb.gate);
      this.sb.add(mesh);
      game.physics.addSync(body, mesh);
      this.chunks.push({ body, mesh, die: this.time + 7 + Math.random() * 2 });
    }
    game.audio.play('kick', { pos: this.center });
    game.audio.play('rubble', { pos: this.center, vol: 1 });
    game.shake(0.5);
    if (byPlayer) { game.emitNoise(this.center, 34, NOISE.kick); game.toast('Shortcut opened'); }
  }

  onNight(): void { this.breakOpen(false); }

  fixedUpdate(dt: number): void {
    this.time += dt;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      if (this.time > c.die) { this.game.physics.removeBody(c.body); c.mesh.removeFromParent(); c.mesh.geometry.dispose(); this.chunks.splice(i, 1); }
    }
  }

  dispose(): void {
    if (this.body) this.game.physics.removeBody(this.body);
    if (this.inter) this.game.removeInteractable(this.inter);
    for (const c of this.chunks) { this.game.physics.removeBody(c.body); c.mesh.geometry.dispose(); }
  }
}

// =============================================================================================
// Swinging blade
// =============================================================================================

export class Blade implements SetPiece {
  private pivot = new THREE.Group();
  private tip = new THREE.Vector3();
  private cooldown = 0;
  private lastSign = 0;

  constructor(private game: Game, sb: SceneBuilder, private px: number, private py: number, private pz: number, private length: number,
    private swingAxis: 'x' | 'z', private period: number, private phase: number, private amp = 1.05) {
    const iron = game.mats.solid(0x55555c, 0.45, 0.85, 0, sb.gate);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, length - 0.5, 0.1), iron);
    arm.position.y = -(length - 0.5) / 2;
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 20, 1, false, Math.PI * 0.5, Math.PI), game.mats.solid(0x9a9aa2, 0.3, 0.9, 0, sb.gate));
    blade.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    blade.position.y = -length + 0.75;
    for (const m of [arm, blade]) { m.castShadow = true; this.pivot.add(m); }
    if (swingAxis === 'z') this.pivot.rotation.y = Math.PI / 2;
    this.pivot.position.set(px, py, pz);
    sb.add(this.pivot);
    sb.track(arm.geometry); sb.track(blade.geometry);
  }

  fixedUpdate(dt: number): void {
    const { game } = this;
    const a = bladeAngle(game.run.time, this.period, this.amp, this.phase);
    // rotation.z swings the hanging arm toward +local X; a parent yaw of 90 degrees maps local X to world -Z.
    const off = Math.sin(a) * this.length;
    this.tip.set(this.px + (this.swingAxis === 'x' ? off : 0), this.py - Math.cos(a) * this.length + 0.4, this.pz - (this.swingAxis === 'z' ? off : 0));
    const sign = Math.sign(a);
    if (sign !== this.lastSign && this.lastSign !== 0) game.audio.play('blade', { pos: this.tip, vol: 0.8 });
    this.lastSign = sign;
    this.cooldown -= dt;
    const p = game.player;
    if (this.cooldown <= 0 && !p.dead) {
      const dx = p.pos.x - this.tip.x, dz = p.pos.z - this.tip.z;
      const along = this.swingAxis === 'x' ? Math.abs(dz) : Math.abs(dx);   // distance along the corridor
      const across = this.swingAxis === 'x' ? Math.abs(dx) : Math.abs(dz);
      if (along < 0.45 && across < 0.95 && this.tip.y - 0.9 < p.pos.y + p.height && this.tip.y + 0.3 > p.pos.y) {
        this.cooldown = 1.0;
        const vel = Math.cos((2 * Math.PI * game.run.time) / this.period + this.phase);
        const push = Math.sign(vel) * 7;
        p.knock(this.swingAxis === 'x' ? push : 0, 3, this.swingAxis === 'z' ? -push : 0);
        p.damage(DMG.blade, 'a swinging blade');
      }
    }
  }

  update(): void {
    this.pivot.rotation.z = bladeAngle(this.game.run.time, this.period, this.amp, this.phase);
  }
}

// =============================================================================================
// Dart launcher
// =============================================================================================

export interface DartEmitter { x: number; y: number; z: number; dx: number; dz: number; range: number; }

interface DartRt { mesh: THREE.Mesh; x: number; y: number; z: number; dx: number; dz: number; left: number; delay: number; }

export class DartLauncher implements SetPiece {
  readonly st: DartState = newDartTrap();
  pressed = false;
  private darts: DartRt[] = [];
  private geo = new THREE.CylinderGeometry(0.025, 0.012, 0.55, 5);
  private mat: THREE.Material;
  private center = new THREE.Vector3();

  constructor(private game: Game, private sb: SceneBuilder, readonly id: string, private emitters: DartEmitter[]) {
    this.geo.rotateX(Math.PI / 2);
    this.mat = game.mats.solid(0x2a2420, 0.6, 0.3, 0, sb.gate);
    sb.track(this.geo);
    for (const e of emitters) {
      // The slot the dart comes out of.
      sb.box('iron', e.x - 0.09 - Math.abs(e.dz) * 0.03, e.y - 0.07, e.z - 0.09 - Math.abs(e.dx) * 0.03, e.x + 0.09 + Math.abs(e.dz) * 0.03, e.y + 0.07, e.z + 0.09 + Math.abs(e.dx) * 0.03, { collide: false, shadow: false, tint: 0.3 });
      this.center.add(new THREE.Vector3(e.x, e.y, e.z));
    }
    this.center.divideScalar(Math.max(1, emitters.length));
  }

  /** Loose a volley. Each emitter fires after a tiny stagger so it reads as a ripple. */
  fire(): void {
    const { game } = this;
    this.emitters.forEach((e, i) => {
      const mesh = new THREE.Mesh(this.geo, this.mat);
      mesh.visible = false;
      mesh.rotation.y = Math.atan2(e.dx, e.dz);
      this.sb.add(mesh);
      this.darts.push({ mesh, x: e.x, y: e.y, z: e.z, dx: e.dx, dz: e.dz, left: e.range, delay: 0.18 + i * 0.03 });
    });
    game.audio.play('click', { pos: this.center });
    game.emitNoise(this.center, 18, NOISE.trap * 0.4);
  }

  fixedUpdate(dt: number): void {
    const { game } = this;
    if (stepDartTrap(this.st, this.pressed, dt)) this.fire();
    const p = game.player;
    for (let i = this.darts.length - 1; i >= 0; i--) {
      const d = this.darts[i];
      if (d.delay > 0) {
        d.delay -= dt;
        if (d.delay <= 0) { d.mesh.visible = true; game.audio.play('dart', { pos: d.mesh.position.set(d.x, d.y, d.z), vol: 0.7 }); }
        continue;
      }
      const step = DART_SPEED * dt;
      d.x += d.dx * step; d.z += d.dz * step; d.left -= step;
      d.mesh.position.set(d.x, d.y, d.z);
      const hd = Math.hypot(p.pos.x - d.x, p.pos.z - d.z);
      let done = d.left <= 0;
      if (!p.dead && dartHits(d.y, p.pos.y, p.pos.y + p.height, hd, 0.45)) { p.damage(DMG.dart, 'a dart trap'); done = true; }
      else if (done) game.audio.play('dartHit', { pos: d.mesh.position, vol: 0.5 });
      if (done) { d.mesh.removeFromParent(); this.darts.splice(i, 1); }
    }
  }

  dispose(): void { for (const d of this.darts) d.mesh.removeFromParent(); this.darts.length = 0; }
}

/** Convenience: emitters firing across a corridor from one wall, at chest height over floorY. */
export function dartRow(wallX: number, floorY: number, zs: number[], dir: 1 | -1, range: number): DartEmitter[] {
  return zs.map((z) => ({ x: wallX, y: floorY + DART_HEIGHT, z, dx: dir, dz: 0, range }));
}
export function dartRowZ(wallZ: number, floorY: number, xs: number[], dir: 1 | -1, range: number): DartEmitter[] {
  return xs.map((x) => ({ x, y: floorY + DART_HEIGHT, z: wallZ, dx: 0, dz: dir, range }));
}

// =============================================================================================
// Rolling boulder
// =============================================================================================

export const BOULDER_GROUP = groups(16, G.STATIC | G.SOLID | G.SMALL);

export class Boulder implements SetPiece {
  private body: RAPIER.RigidBody | null = null;
  private col: RAPIER.Collider | null = null;
  private mesh: THREE.Mesh | null = null;
  released = false;
  private restT = 0;
  private hitCd = 0;
  private rumbleT = 0;
  private age = 0;
  private spent = false;

  constructor(private game: Game, sb: SceneBuilder, readonly id: string, x: number, y: number, z: number, private radius: number, private kick: [number, number, number]) {
    if (game.run.flags.has(`boulder:${id}`)) return;
    this.body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    this.col = game.physics.world.createCollider(RAPIER.ColliderDesc.ball(radius).setDensity(2.2).setFriction(0.9).setRestitution(0.1).setCollisionGroups(CG.STATIC), this.body);
    const g = new THREE.IcosahedronGeometry(radius, 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = 1 + (Math.sin(pos.getX(i) * 5.1) + Math.sin(pos.getY(i) * 4.3 + 1) + Math.sin(pos.getZ(i) * 6.7 + 2)) * 0.018;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 3).fill(0.9), 3));
    this.mesh = new THREE.Mesh(g, game.mats.get('rock', sb.gate));
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.position.set(x, y, z);
    sb.add(this.mesh);
    sb.track(g);
  }

  release(): void {
    if (this.released || !this.body || !this.col) return;
    this.released = true;
    this.game.run.flags.add(`boulder:${this.id}`);
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.col.setCollisionGroups(BOULDER_GROUP);
    this.body.setLinvel({ x: this.kick[0], y: this.kick[1], z: this.kick[2] }, true);
    this.game.physics.addSync(this.body, this.mesh!);
    this.game.audio.play('thud', { pos: this.mesh!.position, vol: 1 });
    this.game.shake(0.6);
    this.game.toast('Something heavy is moving...');
  }

  fixedUpdate(dt: number): void {
    if (!this.released || !this.body || this.restT > 2) return;
    const { game } = this;
    const v = this.body.linvel(), t = this.body.translation();
    const speed = Math.hypot(v.x, v.y, v.z);
    // It has done its run after a few seconds: let it grind to a halt instead of rolling about.
    this.age += dt;
    if (this.age > 5 && !this.spent) { this.spent = true; this.body.setLinearDamping(1.4); this.body.setAngularDamping(1.4); }
    this.rumbleT -= dt;
    if (speed > 0.8 && this.rumbleT <= 0) {
      this.rumbleT = 0.28;
      game.audio.play('rumble', { pos: t, vol: Math.min(1, speed / 7) });
      game.emitNoise(t, 30, 0.05);
      game.shake(Math.min(0.35, speed * 0.03) * Math.max(0, 1 - Math.hypot(t.x - game.player.pos.x, t.z - game.player.pos.z) / 22));
    }
    this.hitCd -= dt;
    const p = game.player;
    if (!p.dead && this.hitCd <= 0) {
      const cy = p.pos.y + p.height / 2;
      const d = Math.hypot(t.x - p.pos.x, t.y - cy, t.z - p.pos.z);
      const dmg = boulderDamage(speed);
      if (d < this.radius + 0.55 && dmg > 0) {
        this.hitCd = 0.8;
        p.knock(v.x * 0.8, 4, v.z * 0.8);
        p.damage(dmg, 'the rolling boulder');
      }
    }
    if (speed < 0.3) {
      this.restT += dt;
      // Once it has stopped it breaks up, so it can never wall anyone in. The pieces are just rocks.
      if (this.restT > 1.2) {
        game.physics.removeBody(this.body); this.body = null; this.col = null;
        this.mesh?.removeFromParent();
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          game.props.rock(t.x + Math.cos(a) * 0.7, t.y - this.radius + 0.5 + (i % 2) * 0.4, t.z + Math.sin(a) * 0.7, 3 + i);
        }
        game.audio.play('rubble', { pos: t, vol: 1 });
        game.shake(0.3);
        this.restT = 3;
        return;
      }
    } else this.restT = 0;
    if (t.y < -80) { game.physics.removeBody(this.body); this.body = null; this.mesh?.removeFromParent(); }
  }

  dispose(): void { if (this.body) this.game.physics.removeBody(this.body); }
}

// =============================================================================================
// Falling debris (sanctum ceiling)
// =============================================================================================

interface Chunk { body: RAPIER.RigidBody; mesh: THREE.Mesh; die: number; live: boolean; }

export class DebrisField implements SetPiece {
  private chunks: Chunk[] = [];
  private queue: { at: number; x: number; z: number }[] = [];
  private time = 0;
  private collapseUntil = 0;
  private collapseT = 0;
  private dust: THREE.Points;
  private dustPos: Float32Array;
  private dustLife: Float32Array;
  private dustN = 60;
  private dustI = 0;
  onCollapsed: (() => void) | null = null;

  constructor(private game: Game, private sb: SceneBuilder, private x1: number, private z1: number, private x2: number, private z2: number, private ceilY: number) {
    this.dustPos = new Float32Array(this.dustN * 3).fill(-999);
    this.dustLife = new Float32Array(this.dustN);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ map: game.mats.texture('dust'), size: 1.3, transparent: true, opacity: 0.5, depthWrite: false, color: 0xb0a590 }));
    this.dust.frustumCulled = false;
    sb.add(this.dust);
    sb.track(g);
  }

  /** Shed n chunks. The first comes down near `near` so noise has consequences. */
  drop(n: number, near: { x: number; z: number }): void {
    for (let i = 0; i < n; i++) {
      const spread = i === 0 ? 1.4 : 5;
      const x = Math.min(this.x2 - 0.6, Math.max(this.x1 + 0.6, near.x + (Math.random() - 0.5) * 2 * spread));
      const z = Math.min(this.z2 - 0.6, Math.max(this.z1 + 0.6, near.z + (Math.random() - 0.5) * 2 * spread));
      this.queue.push({ at: this.time + 0.25 + i * 0.22 + Math.random() * 0.2, x, z });
    }
    this.game.audio.play('crumble', { pos: { x: near.x, y: this.ceilY, z: near.z }, vol: 0.9 });
  }

  inside(x: number, z: number): boolean { return x > this.x1 && x < this.x2 && z > this.z1 && z < this.z2; }

  /** The whole unstable roof lets go. */
  collapse(duration = 6): void {
    if (this.collapseUntil) return;
    this.collapseUntil = this.time + duration;
    this.game.shake(1.2);
    this.game.audio.play('collapse', { vol: 1 });
  }

  private puff(x: number, y: number, z: number): void {
    for (let k = 0; k < 4; k++) {
      const i = this.dustI = (this.dustI + 1) % this.dustN;
      this.dustPos[i * 3] = x + (Math.random() - 0.5) * 0.8; this.dustPos[i * 3 + 1] = y - Math.random() * 0.5; this.dustPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.8;
      this.dustLife[i] = 1.6;
    }
  }

  private spawn(x: number, z: number): void {
    const { game } = this;
    const s = 0.4 + Math.random() * 0.5;
    const y = this.ceilY - 0.6;
    const body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setAngvel({ x: Math.random() * 4, y: Math.random() * 4, z: Math.random() * 4 }));
    game.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(s / 2, s / 2, s / 2).setMass(25).setRestitution(0.15).setCollisionGroups(CG.SMALL), body);
    const mesh = boxMesh(game, 'rubble', s, s, s, this.sb.gate);
    this.sb.add(mesh);
    game.physics.addSync(body, mesh);
    this.chunks.push({ body, mesh, die: this.time + 7, live: true });
    this.puff(x, y, z);
    if (this.chunks.length > 26) this.kill(0);
  }

  private kill(i: number): void {
    const c = this.chunks[i];
    this.game.physics.removeBody(c.body); c.mesh.removeFromParent(); c.mesh.geometry.dispose();
    this.chunks.splice(i, 1);
  }

  fixedUpdate(dt: number): void {
    this.time += dt;
    const { game } = this;
    if (this.collapseUntil) {
      if (this.time < this.collapseUntil) {
        this.collapseT -= dt;
        if (this.collapseT <= 0) {
          this.collapseT = 0.16;
          this.spawn(this.x1 + 0.8 + Math.random() * (this.x2 - this.x1 - 1.6), this.z1 + 0.8 + Math.random() * (this.z2 - this.z1 - 1.6));
          game.shake(0.35);
        }
      } else if (this.onCollapsed) { const f = this.onCollapsed; this.onCollapsed = null; f(); }
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.time >= this.queue[i].at) { this.spawn(this.queue[i].x, this.queue[i].z); this.queue.splice(i, 1); }
    }
    const p = game.player;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      if (this.time > c.die) { this.kill(i); continue; }
      if (!c.live) continue;
      const t = c.body.translation(), v = c.body.linvel();
      if (v.y > -3 && t.y < this.ceilY - 2) {
        // It has landed.
        c.live = false;
        game.audio.play('thud', { pos: t, vol: 0.6 });
        game.emitNoise(t, 14);
        continue;
      }
      if (!p.dead && t.y < p.pos.y + p.height + 0.3 && t.y > p.pos.y && Math.hypot(t.x - p.pos.x, t.z - p.pos.z) < 0.65) {
        c.live = false;
        p.damage(DMG.debris, 'falling masonry');
      }
    }
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.dustN; i++) {
      if (this.dustLife[i] > 0) {
        this.dustLife[i] -= dt;
        this.dustPos[i * 3 + 1] -= dt * 1.2;
        if (this.dustLife[i] <= 0) this.dustPos[i * 3 + 1] = -999;
        any = true;
      }
    }
    if (any) {
      (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      // The dust is unlit, so dim it by hand with the sky or it glows at night.
      const k = Math.min(1, 0.06 + this.game.sky.ambientIntensity / 1.8);
      (this.dust.material as THREE.PointsMaterial).color.setRGB(0.69 * k, 0.65 * k, 0.56 * k);
    }
  }

  dispose(): void { while (this.chunks.length) this.kill(0); }
}

// =============================================================================================
// Vines, water, wind: volumes the player reads
// =============================================================================================

/** Climbable vines hanging on a wall. The card is drawn just proud of the wall face. */
export function addVines(game: Game, sb: SceneBuilder, c: Climbable, visual = true): SetPiece {
  game.climbables.push(c);
  if (visual) {
    const h = c.y2 - c.y1;
    const w = c.nx !== 0 ? c.z2 - c.z1 : c.x2 - c.x1;
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 2.2, (uv.getY(i) * h) / 2.2);
    const m = new THREE.Mesh(g, game.mats.card('vine', sb.gate));
    // The wall face is the side of the volume the normal points away from.
    const fx = c.nx > 0 ? c.x1 : c.nx < 0 ? c.x2 : (c.x1 + c.x2) / 2;
    const fz = c.nz > 0 ? c.z1 : c.nz < 0 ? c.z2 : (c.z1 + c.z2) / 2;
    m.position.set(fx + c.nx * 0.07, (c.y1 + c.y2) / 2, fz + c.nz * 0.07);
    m.rotation.y = Math.atan2(c.nx, c.nz);
    m.receiveShadow = true;
    sb.add(m);
    sb.track(g);
  }
  return { dispose: () => { const i = game.climbables.indexOf(c); if (i >= 0) game.climbables.splice(i, 1); } };
}

export function addWater(game: Game, sb: SceneBuilder, w: WaterVolume, visual = true): SetPiece {
  game.waters.push(w);
  let mesh: THREE.Mesh | null = null;
  if (visual) {
    const sx = w.x2 - w.x1, sz = w.z2 - w.z1;
    const g = new THREE.PlaneGeometry(sx, sz, 1, 1);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * sx) / 6, (uv.getY(i) * sz) / 6);
    mesh = new THREE.Mesh(g, game.mats.water(sb.gate));
    mesh.position.set((w.x1 + w.x2) / 2, w.surfaceY, (w.z1 + w.z2) / 2);
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    sb.add(mesh);
    sb.track(g);
  }
  return { dispose: () => { const i = game.waters.indexOf(w); if (i >= 0) game.waters.splice(i, 1); } };
}

export function addWind(game: Game, w: WindZone): SetPiece {
  game.winds.push(w);
  return { dispose: () => { const i = game.winds.indexOf(w); if (i >= 0) game.winds.splice(i, 1); } };
}

// =============================================================================================
// Shade scarabs: swarm wherever the floor is in shadow
// =============================================================================================

export class ScarabBand implements SetPiece {
  private im: THREE.InstancedMesh;
  private n: number;
  private px: Float32Array; private pz: Float32Array; private ang: Float32Array;
  private biteT = 0;
  private acc = 0;
  private warned = false;

  constructor(private game: Game, sb: SceneBuilder, private x1: number, private z1: number, private x2: number, private z2: number,
    private y: number, private openings: RoofOpening[]) {
    this.n = game.quality.scarabs;
    const g = new THREE.SphereGeometry(0.09, 6, 4);
    g.scale(1, 0.45, 1.5);
    this.im = new THREE.InstancedMesh(g, game.mats.solid(0x14100c, 0.25, 0.7), this.n);
    this.im.frustumCulled = false;
    this.im.castShadow = false;
    sb.add(this.im);
    sb.track(g);
    this.px = new Float32Array(this.n); this.pz = new Float32Array(this.n); this.ang = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.px[i] = x1 + Math.random() * (x2 - x1); this.pz[i] = z1 + Math.random() * (z2 - z1); this.ang[i] = Math.random() * Math.PI * 2;
    }
  }

  /** Is this floor point both inside the band and in shadow right now? */
  dangerous(x: number, z: number): boolean {
    if (x < this.x1 || x > this.x2 || z < this.z1 || z > this.z2) return false;
    return !isSunlit(x, this.y, z, this.openings, sunDirection(this.game.run.time));
  }

  update(dt: number): void {
    const { game } = this;
    const sun = sunDirection(game.run.time);
    const p = game.player;
    const inBand = p.pos.x > this.x1 && p.pos.x < this.x2 && p.pos.z > this.z1 && p.pos.z < this.z2 && p.pos.y - this.y < 0.7;
    const lit = isSunlit(p.pos.x, this.y, p.pos.z, this.openings, sun);
    const hunted = inBand && !lit;
    const near = Math.abs(p.pos.z - (this.z1 + this.z2) / 2) < (this.z2 - this.z1) / 2 + 9 && Math.abs(p.pos.y - this.y) < 6;
    if (near) {
      for (let i = 0; i < this.n; i++) {
        let a = this.ang[i];
        if (hunted) {
          const want = Math.atan2(p.pos.x - this.px[i], p.pos.z - this.pz[i]);
          let d = want - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
          a += d * Math.min(1, dt * 5);
        } else a += (Math.random() - 0.5) * dt * 6;
        const sp = hunted ? 4.5 : 1.1;
        let nx = this.px[i] + Math.sin(a) * sp * dt, nz = this.pz[i] + Math.cos(a) * sp * dt;
        if (nx < this.x1 || nx > this.x2) { a = -a; nx = this.px[i]; }
        if (nz < this.z1 || nz > this.z2) { a = Math.PI - a; nz = this.pz[i]; }
        // They will not walk into a sun patch.
        if (isSunlit(nx, this.y, nz, this.openings, sun)) {
          if (isSunlit(this.px[i], this.y, this.pz[i], this.openings, sun)) { nx = this.px[i] + Math.sin(a) * 3 * dt; nz = this.pz[i] + Math.cos(a) * 3 * dt; }
          else { a += Math.PI * (0.6 + Math.random() * 0.8); nx = this.px[i]; nz = this.pz[i]; }
        }
        this.px[i] = Math.min(this.x2, Math.max(this.x1, nx)); this.pz[i] = Math.min(this.z2, Math.max(this.z1, nz)); this.ang[i] = a;
        const hidden = isSunlit(this.px[i], this.y, this.pz[i], this.openings, sun);
        _q.setFromAxisAngle(UP, a);
        _m.compose(_a.set(this.px[i], this.y + 0.04, this.pz[i]), _q, _s.setScalar(hidden ? 0.0001 : 1));
        this.im.setMatrixAt(i, _m);
      }
      this.im.instanceMatrix.needsUpdate = true;
    }
    this.im.visible = near;
    const dmg = scarabDamage(inBand, lit, dt);
    if (dmg > 0 && !p.dead) {
      this.acc += dmg;
      this.biteT -= dt;
      if (this.biteT <= 0) {
        this.biteT = 0.3;
        game.audio.play('scarab', { vol: 0.8 });
        p.damage(this.acc, 'the scarab swarm');
        this.acc = 0;
        if (!this.warned) { this.warned = true; game.toast('Scarabs swarm in the shade. Stay in the sunlight.'); }
      }
    } else if (near && Math.random() < dt * 1.5) {
      game.audio.play('scarab', { pos: { x: (this.x1 + this.x2) / 2, y: this.y, z: (this.z1 + this.z2) / 2 }, vol: 0.25 });
    }
  }
}

// =============================================================================================
// God ray through a roof opening
// =============================================================================================

export class LightShaft implements SetPiece {
  private mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;

  constructor(private game: Game, sb: SceneBuilder, private o: RoofOpening, private floorY: number) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(8 * 3), 3);
    g.setAttribute('position', this.pos);
    // 4 side quads between the top ring (0..3) and the bottom ring (4..7).
    const idx: number[] = [];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; idx.push(i, j, 4 + j, i, 4 + j, 4 + i); }
    g.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    sb.add(this.mesh);
    sb.track(g); sb.track(mat);
  }

  update(): void {
    const sun = sunDirection(this.game.run.time);
    const patch = sunPatch(this.o, this.floorY, sun);
    const m = this.mesh.material as THREE.MeshBasicMaterial;
    if (!patch || sun.y < 0.12) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const o = this.o;
    const top = [[o.x1, o.z1], [o.x2, o.z1], [o.x2, o.z2], [o.x1, o.z2]];
    const bot = [[patch.x1, patch.z1], [patch.x2, patch.z1], [patch.x2, patch.z2], [patch.x1, patch.z2]];
    for (let i = 0; i < 4; i++) {
      this.pos.setXYZ(i, top[i][0], o.y, top[i][1]);
      this.pos.setXYZ(4 + i, bot[i][0], this.floorY, bot[i][1]);
    }
    this.pos.needsUpdate = true;
    const g = this.game.sky.grade;
    m.color.setRGB(g.sunColor[0], g.sunColor[1], g.sunColor[2]);
    m.opacity = 0.028 * g.sunIntensity * Math.min(1, (sun.y - 0.12) * 5);
  }
}

// =============================================================================================
// Small interactive props
// =============================================================================================

/** A wall bracket. Leave a spare torch in it to light the way back. */
export class Sconce implements SetPiece {
  private inter: Interactable;
  private flame: THREE.Sprite | null = null;
  readonly lightPos: THREE.Vector3;

  constructor(private game: Game, private sb: SceneBuilder, readonly id: string, x: number, y: number, z: number, nx: number, nz: number) {
    sb.box('iron', x - 0.07 - Math.abs(nz) * 0.05, y - 0.25, z - 0.07 - Math.abs(nx) * 0.05, x + 0.07 + Math.abs(nz) * 0.05, y, z + 0.07 + Math.abs(nx) * 0.05, { collide: false, shadow: false });
    this.lightPos = new THREE.Vector3(x + nx * 0.35, y + 0.35, z + nz * 0.35);
    sb.obox('iron', x + nx * 0.2, y - 0.02, z + nz * 0.2, 0.12, 0.06, 0.12, null, { collide: false, shadow: false });
    this.inter = {
      pos: new THREE.Vector3(x + nx * 0.2, y, z + nz * 0.2), range: 2.6,
      prompt: () => (this.lit ? null : game.run.torch.spares > 0 ? `Place a spare torch in the sconce (${game.run.torch.spares} left)` : 'Empty sconce (no spare torch)'),
      act: () => this.place(),
    };
    game.addInteractable(this.inter);
    if (game.run.sconces.has(id)) this.light();
  }

  get lit(): boolean { return !!this.flame; }

  private place(): void {
    const { game } = this;
    if (this.lit) return;
    if (!game.torch.placeSpare()) { game.toast('No spare torch to leave here'); return; }
    game.run.sconces.add(this.id);
    this.light();
    game.audio.play('ignite', { pos: this.lightPos });
    game.toast('Torch left burning');
  }

  private light(): void {
    const { game } = this;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.5, 6), game.mats.solid(0x5a3a22, 0.9, 0, 0, this.sb.gate));
    stick.position.copy(this.lightPos).y -= 0.35;
    this.sb.add(stick); this.sb.track(stick.geometry);
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: game.mats.texture('flame'), transparent: true, depthWrite: false, fog: false }));
    this.flame.position.copy(this.lightPos);
    this.flame.scale.set(0.34, 0.5, 1);
    this.sb.add(this.flame); this.sb.track(this.flame.material);
    game.torch.addSconce(this.lightPos);
  }

  update(): void {
    if (this.flame) { const t = this.game.run.time; this.flame.scale.set(0.32 + Math.sin(t * 17 + this.lightPos.x) * 0.03, 0.5 + Math.sin(t * 23 + this.lightPos.z) * 0.06, 1); }
  }

  dispose(): void {
    this.game.removeInteractable(this.inter);
    if (this.flame) this.game.torch.removeSconce(this.lightPos);
  }
}

/** Something lying around that you pick up with E: fuel, torches, keys. */
export class Pickup implements SetPiece {
  private inter: Interactable | null = null;

  constructor(private game: Game, sb: SceneBuilder, readonly id: string, private obj: THREE.Object3D, label: string, onTake: () => boolean | void, range = 2.6) {
    if (game.run.pickups.has(id)) return;
    sb.add(obj);
    this.inter = {
      pos: obj.position.clone().add(new THREE.Vector3(0, 0.15, 0)), range, priority: 1,
      prompt: () => label,
      act: () => {
        if (onTake() === false) return;
        game.run.pickups.add(id);
        obj.removeFromParent();
        game.removeInteractable(this.inter!);
        this.inter = null;
        game.audio.play('pickup');
      },
    };
    game.addInteractable(this.inter);
  }

  update(): void { /* static */ }
  dispose(): void { if (this.inter) this.game.removeInteractable(this.inter); }
}

export class Lever implements SetPiece {
  private inter: Interactable;
  private arm: THREE.Mesh;
  pulled: boolean;

  constructor(private game: Game, sb: SceneBuilder, x: number, y: number, z: number, label: string, pulled: boolean, onPull: () => void) {
    this.pulled = pulled;
    sb.box('iron', x - 0.2, y, z - 0.2, x + 0.2, y + 0.5, z + 0.2, { shadow: false });
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), game.mats.solid(0x7a5a30, 0.6, 0.2, 0, sb.gate));
    this.arm.geometry.translate(0, 0.45, 0);
    this.arm.position.set(x, y + 0.45, z);
    this.arm.rotation.x = pulled ? 0.8 : -0.8;
    sb.add(this.arm); sb.track(this.arm.geometry);
    this.inter = {
      pos: new THREE.Vector3(x, y + 1, z), range: 2.6, priority: 1,
      prompt: () => (this.pulled ? null : label),
      act: () => { if (this.pulled) return; this.pulled = true; game.audio.play('lever', { pos: this.arm.position }); onPull(); },
    };
    game.addInteractable(this.inter);
  }

  update(dt: number): void {
    const want = this.pulled ? 0.8 : -0.8;
    this.arm.rotation.x += (want - this.arm.rotation.x) * Math.min(1, dt * 8);
  }

  dispose(): void { this.game.removeInteractable(this.inter); }
}

/** Iron ring where a carried rope can be dropped to make a climbable line. */
export class RopeAnchor implements SetPiece {
  private inter: Interactable;
  private vines: SetPiece | null = null;
  private line: Climbable | null = null;

  constructor(private game: Game, private sb: SceneBuilder, readonly id: string, private x: number, private yTop: number, private z: number,
    private yBottom: number, private nx: number, private nz: number) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 12), game.mats.solid(0x3a3a40, 0.5, 0.8, 0, sb.gate));
    ring.position.set(x, yTop + 0.1, z); ring.rotation.x = Math.PI / 2;
    sb.add(ring); sb.track(ring.geometry);
    this.inter = {
      pos: new THREE.Vector3(x, yTop + 0.3, z), range: 2.8,
      prompt: () => (this.vines ? (game.player.pos.y > yTop - 0.5 && !game.player.climbing ? 'Climb down the rope' : null)
        : game.run.ropes > 0 ? `Tie off a rope here (${game.run.ropes} left)` : 'Iron ring (needs a rope from the shop)'),
      act: () => {
        if (this.vines) {
          // From the ledge above there is nothing to push against, so the ring puts you on the rope.
          if (this.line && game.player.pos.y > yTop - 0.5) game.player.startClimb(this.line, x + nx * 0.42, yTop - 0.75, z + nz * 0.42);
          return;
        }
        if (game.run.ropes <= 0) { game.toast('You need a climbing rope. The shop sells them.'); return; }
        game.run.ropes--;
        game.run.flags.add(`rope:${id}`);
        this.drop();
        game.audio.play('pickup');
        game.toast('Rope dropped');
      },
    };
    game.addInteractable(this.inter);
    if (game.run.flags.has(`rope:${id}`)) this.drop();
  }

  private drop(): void {
    const { game, x, z, nx, nz } = this;
    const h = this.yTop - this.yBottom;
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, h, 6), game.mats.get('rope', this.sb.gate));
    rope.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(rope.geometry.attributes.position.count * 3).fill(1), 3));
    rope.position.set(x + nx * 0.25, this.yBottom + h / 2, z + nz * 0.25);
    this.sb.add(rope); this.sb.track(rope.geometry);
    this.line = {
      x1: x - 0.6 + Math.min(0, nx) * 0.2, x2: x + 0.6 + Math.max(0, nx) * 0.7, z1: z - 0.6 + Math.min(0, nz) * 0.2, z2: z + 0.6 + Math.max(0, nz) * 0.7,
      y1: this.yBottom, y2: this.yTop + 0.2, nx, nz,
    };
    this.vines = addVines(game, this.sb, this.line, false);
  }

  dispose(): void { this.game.removeInteractable(this.inter); this.vines?.dispose?.(); }
}

/** Rectangle that hurts once on entry (spike pits). */
export class HazardZone implements SetPiece {
  private wasIn = false;
  constructor(private game: Game, private x1: number, private z1: number, private x2: number, private z2: number, private y1: number, private y2: number,
    private dmg: number, private cause: string) {}
  fixedUpdate(): void {
    const p = this.game.player;
    const inside = p.pos.x > this.x1 && p.pos.x < this.x2 && p.pos.z > this.z1 && p.pos.z < this.z2 && p.pos.y > this.y1 && p.pos.y < this.y2 && p.grounded;
    if (inside && !this.wasIn && !p.dead) p.damage(this.dmg, this.cause);
    this.wasIn = inside;
  }
}
