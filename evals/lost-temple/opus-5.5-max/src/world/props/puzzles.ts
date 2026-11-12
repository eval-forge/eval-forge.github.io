/**
 * Sun puzzles: the courtyard sundial (turn the ring until the Eye sits in the gnomon's real
 * shadow) and the halls' sunstone tiles (solid only while direct sunlight reaches them).
 */
import * as THREE from 'three';
import { RAPIER } from '../../physics/Physics';
import { GROUP_STATIC } from './constants';
import { SUNDIAL_STEP, SUNDIAL_STEPS, SUNDIAL_EYE_BASE, sundialAligned, gnomonShadowAngle } from '../../logic/sun';
import type { SceneCtx, SceneRuntime } from '../SceneDef';
import type { Prop } from '../types';
import { boxMesh, cylMesh, fixedBody, smooth01 } from './util';
import { lathe, normalizeGeometry } from '../../render/geometry';

export class Sundial implements Prop {
  ring: THREE.Group;
  step: number;
  private shown: number;
  private anim = 1;
  private from = 0;
  private alignedFor = 0;
  solved: boolean;
  disc: THREE.Group;
  private discRise = 0;
  private taken: boolean;
  private checkT = 0;
  private hinted = false;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, private center: THREE.Vector3) {
    this.step = (ctx.run.get('sundial:step') as number | undefined) ?? 3;
    this.shown = this.step;
    this.solved = ctx.run.flag('sundialSolved');
    this.taken = !!ctx.run.get('sundial:taken');
    const c = center;
    // dial face with hour marks
    const face = cylMesh(ctx.mats, 'glyphs', 2.3, 2.3, 0.08, 40);
    face.position.set(c.x, c.y + 0.04, c.z);
    rt.group.add(face);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const mark = boxMesh(ctx.mats, 'bronze', k % 2 ? 0.05 : 0.08, 0.03, k % 2 ? 0.25 : 0.45, 1);
      mark.position.set(c.x + Math.cos(a) * 1.9, c.y + 0.09, c.z + Math.sin(a) * 1.9);
      mark.rotation.y = -a + Math.PI / 2;
      rt.group.add(mark);
    }
    // gnomon: a tall pin that throws the real sun shadow
    const gnomon = cylMesh(ctx.mats, 'bronze', 0.05, 0.09, 1.7, 8);
    gnomon.position.set(c.x, c.y + 0.85, c.z);
    rt.group.add(gnomon);
    const cap = new THREE.Mesh(normalizeGeometry(new THREE.SphereGeometry(0.13, 10, 8)), ctx.mats.get('gold'));
    cap.position.set(c.x, c.y + 1.72, c.z);
    cap.castShadow = true;
    rt.group.add(cap);
    // rotating ring with the carved Eye
    this.ring = new THREE.Group();
    const ringGeo = normalizeGeometry(lathe([[2.35, 0], [2.95, 0], [2.95, 0.16], [2.35, 0.16], [2.35, 0]], 48, 0.5));
    const ringMesh = new THREE.Mesh(ringGeo, ctx.mats.get('sandstone'));
    ringMesh.castShadow = true;
    ringMesh.receiveShadow = true;
    this.ring.add(ringMesh);
    for (let k = 0; k < SUNDIAL_STEPS; k++) {
      const a = SUNDIAL_EYE_BASE + k * SUNDIAL_STEP;
      const notch = boxMesh(ctx.mats, 'obsidian', 0.06, 0.04, 0.3, 1);
      notch.position.set(Math.cos(a) * 2.65, 0.17, Math.sin(a) * 2.65);
      notch.rotation.y = -a + Math.PI / 2;
      this.ring.add(notch);
    }
    // the Eye (gold almond with an obsidian pupil) at ring angle EYE_BASE
    const eye = new THREE.Mesh(normalizeGeometry(new THREE.SphereGeometry(0.22, 14, 8)), ctx.mats.get('gold'));
    eye.scale.set(1.6, 0.35, 0.8);
    const ea = SUNDIAL_EYE_BASE;
    eye.position.set(Math.cos(ea) * 2.65, 0.19, Math.sin(ea) * 2.65);
    eye.rotation.y = -ea + Math.PI / 2;
    this.ring.add(eye);
    const pupil = new THREE.Mesh(normalizeGeometry(new THREE.SphereGeometry(0.08, 10, 8)), ctx.mats.get('obsidian'));
    pupil.position.set(Math.cos(ea) * 2.65, 0.25, Math.sin(ea) * 2.65);
    pupil.scale.set(1, 0.5, 1);
    this.ring.add(pupil);
    this.ring.position.set(c.x, c.y, c.z);
    this.ring.rotation.y = -this.shown * SUNDIAL_STEP;
    rt.group.add(this.ring);
    // Sun-Disc rises from a slot in the plinth's north face
    this.disc = ctx.models.make('sunDisc');
    this.disc.position.set(c.x, c.y - 0.6, c.z - 3.45);
    this.disc.visible = this.solved && !this.taken;
    if (this.solved) this.discRise = 1;
    rt.group.add(this.disc);
    rt.addInteract({
      kind: 'interact',
      id: id + ':ring',
      position: new THREE.Vector3(c.x, c.y + 0.4, c.z),
      reach: 4.2,
      prompt: () => {
        if (this.solved) return null;
        if (!ctx.sunUp()) return 'The sundial is useless without the sun.';
        return `E  Turn the dial ring (the Eye must sit in the gnomon's shadow)`;
      },
      interact: () => {
        if (this.solved || this.anim < 1) return;
        if (!this.hinted) {
          this.hinted = true;
          ctx.toast("Turn the ring until the carved Eye lies in the gnomon's shadow.", 'info');
        }
        this.from = this.shown;
        this.step = (this.step + 1) % SUNDIAL_STEPS;
        this.anim = 0;
        this.alignedFor = 0;
        ctx.run.set('sundial:step', this.step);
        ctx.run.set('sundial:turned', true);
        ctx.sfx.play('stoneGrind', this.ring.position, 0.5);
        ctx.noise(this.ring.position.clone(), 0.5, 'machine', true);
      },
    });
    rt.addInteract({
      kind: 'interact',
      id: id + ':disc',
      position: new THREE.Vector3(c.x, c.y + 0.3, c.z - 3.5),
      reach: 2.6,
      prompt: () => (this.solved && !this.taken && this.discRise > 0.95 ? 'E  Take the Sun-Disc' : null),
      interact: () => {
        if (!this.solved || this.taken) return;
        this.taken = true;
        this.disc.visible = false;
        ctx.run.set('sundial:taken', true);
        ctx.run.unlock.items.add('sunDisc');
        ctx.sfx.play('chime', this.disc.position, 0.8);
        ctx.toast('You have the Sun-Disc. The seal in the sanctum takes it.', 'key');
      },
    });
  }
  update(dt: number) {
    if (this.anim < 1) {
      this.anim = Math.min(1, this.anim + dt / 0.6);
      let target = this.step;
      if (target < this.from) target += SUNDIAL_STEPS;
      this.shown = this.from + (target - this.from) * smooth01(this.anim);
      this.ring.rotation.y = -this.shown * SUNDIAL_STEP;
      if (this.anim >= 1) this.shown = this.step;
    }
    if (this.solved) {
      if (this.discRise < 1 && !this.taken) {
        this.discRise = Math.min(1, this.discRise + dt / 2.5);
        this.disc.visible = true;
      }
      this.disc.position.y = this.center.y - 0.6 + smooth01(this.discRise) * 1.4;
      this.disc.rotation.y += dt * 0.6;
      return;
    }
    this.checkT -= dt;
    if (this.checkT > 0 || this.anim < 1) return;
    this.checkT = 0.2;
    const d = this.ctx.sunDir;
    const sun: [number, number, number] = [d.x, d.y, d.z];
    // only once a hand has turned the ring: the shadow drifting over the Eye on its own does
    // not count (setting the Eye where the shadow is going to be, and waiting, does)
    const turned = !!this.ctx.run.get('sundial:turned');
    if (turned && this.ctx.sunUp() && sundialAligned(this.step, sun)) {
      this.alignedFor += 0.2;
      if (this.alignedFor >= 1.0) this.solve();
    } else this.alignedFor = 0;
  }
  private solve() {
    this.solved = true;
    this.ctx.setFlag('sundialSolved');
    this.ctx.sfx.play('chime', this.ring.position, 1);
    this.ctx.sfx.play('stoneGrind', this.ring.position, 1);
    this.ctx.toast('The Eye drinks the shadow. Something rises from the plinth.', 'good');
    this.ctx.mapMark(this.center.x, this.center.z, 'sundial');
  }
  /** For the debug overlay: angle of the real shadow right now. */
  shadowAngle(): number | null {
    const d = this.ctx.sunDir;
    return gnomonShadowAngle([d.x, d.y, d.z]);
  }
  dispose() {}
}

// ---------------------------------------------------------------------------

interface Stone {
  body: RAPIER.RigidBody;
  col: RAPIER.Collider;
  mesh: THREE.Mesh;
  center: THREE.Vector3;
  lit: boolean;
  /** Seconds left before a tile that lost the sun goes intangible. */
  fading: number;
}

export class SunstoneTiles implements Prop {
  stones: Stone[] = [];
  private k = 0;
  private flick = 0;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, centers: [number, number][], private y: number, private size = 1.9) {
    for (const [x, z] of centers) {
      const body = rt.trackBody(fixedBody(ctx.physics, x, y - 0.15, z));
      const col = ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, 0.15, size / 2).setCollisionGroups(GROUP_STATIC), body);
      ctx.physics.setOwner(col, { kind: 'sunstone', surface: 'stone' });
      col.setEnabled(false);
      const mesh = new THREE.Mesh(normalizeGeometry(new THREE.BoxGeometry(size, 0.3, size)), ctx.mats.sunstoneDim);
      mesh.position.set(x, y - 0.15, z);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      rt.group.add(mesh);
      this.stones.push({ body, col, mesh, center: new THREE.Vector3(x, y + 0.25, z), lit: false, fading: 0 });
    }
  }
  private evaluate(s: Stone) {
    const lit = this.ctx.sunUp() && this.ctx.litBySun(s.center);
    if (lit && !s.lit) {
      // do not solidify around the player
      const p = this.ctx.player().pos;
      const inside = Math.abs(p.x - s.center.x) < this.size / 2 + 0.3 && Math.abs(p.z - s.center.z) < this.size / 2 + 0.3 && Math.abs(p.y - this.y) < 1.2;
      if (inside) return;
      s.lit = true;
      s.fading = 0;
      s.col.setEnabled(true);
      s.mesh.material = this.ctx.mats.sunstoneLit;
      s.mesh.castShadow = true;
    } else if (!lit && s.lit && s.fading <= 0) {
      s.fading = 0.7;
    } else if (lit && s.fading > 0) {
      s.fading = 0;
      s.mesh.material = this.ctx.mats.sunstoneLit;
    }
  }
  fixedUpdate(dt: number) {
    // evaluate a few stones per step (raycasts)
    const n = this.stones.length;
    for (let i = 0; i < 3 && n > 0; i++) {
      this.evaluate(this.stones[this.k % n]);
      this.k++;
    }
    this.flick += dt;
    for (const s of this.stones) {
      if (s.fading > 0) {
        s.fading -= dt;
        s.mesh.material = Math.sin(this.flick * 40) > 0 ? this.ctx.mats.sunstoneLit : this.ctx.mats.sunstoneDim;
        if (s.fading <= 0) {
          s.lit = false;
          s.col.setEnabled(false);
          s.mesh.material = this.ctx.mats.sunstoneDim;
          s.mesh.castShadow = false;
          const pl = this.ctx.player();
          if (pl.pos.distanceTo(s.center) < 10) this.ctx.sfx.play('torchOut', s.center, 0.4);
        }
      }
    }
  }
  dispose() {}
}
