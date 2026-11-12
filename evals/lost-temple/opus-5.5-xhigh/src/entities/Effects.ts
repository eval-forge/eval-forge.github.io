/**
 * Shared transient effects: darts (swept projectiles), falling debris (dynamic bodies
 * that hurt), dust puffs and relight sparks. Dust and darts use sky-masked materials so
 * nothing here glows in Zone C.
 */
import * as THREE from 'three';
import { RAPIER, Owner, G_DEBRIS, Q_SOLID } from '../engine/physics';
import { tinted, setExposure, surface } from '../engine/materials';
import { exposureAt } from '../world/query';
import { DAMAGE } from '../logic/traps';
import { RADIUS } from './Player';
import type { Game } from '../game/Game';
import type { Exposure } from '../engine/materials';

interface Dart {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  stuck: boolean;
  mesh: THREE.Group;
}

interface Debris {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  life: number;
  hit: boolean;
  big: boolean;
}

interface Puff {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  slot: number;
  exp: Exposure;
}

const MAX_PUFFS = 160;

export class Effects {
  darts: Dart[] = [];
  debris: Debris[] = [];
  /** Actions scheduled in simulation time (dart volleys), so pausing delays them instead of cancelling them. */
  private timers: { t: number; fn: () => void }[] = [];
  owner: Owner;
  private puffs: Puff[] = [];
  private dustMeshes: Record<'lit' | 'dark', THREE.InstancedMesh>;
  private free: Record<'lit' | 'dark', number[]> = { lit: [], dark: [] };
  private sparks: THREE.Points;
  private sparkData: { p: THREE.Vector3; v: THREE.Vector3; life: number }[] = [];
  private dartGeo: THREE.BufferGeometry;
  private m4 = new THREE.Matrix4();
  shake = 0;

  constructor(private game: Game) {
    this.owner = new Owner(game.physics, 'fx');
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    const mk = (exp: Exposure) => {
      const m = new THREE.InstancedMesh(geo, tinted(0x9a8a70, exp, 1, 0, { transparent: true, opacity: 0.35 }), MAX_PUFFS);
      m.count = MAX_PUFFS;
      m.frustumCulled = false;
      for (let i = 0; i < MAX_PUFFS; i++) m.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      game.scene.add(m);
      return m;
    };
    this.dustMeshes = { lit: mk('ruins'), dark: mk('dungeon') };
    for (let i = MAX_PUFFS - 1; i >= 0; i--) {
      this.free.lit.push(i);
      this.free.dark.push(i);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffb040, size: 0.035, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparks.frustumCulled = false;
    game.scene.add(this.sparks);
    const shaft = new THREE.CylinderGeometry(0.008, 0.008, 0.32, 4);
    shaft.rotateX(Math.PI / 2);
    this.dartGeo = shaft;
  }

  // ------------------------------------------------------------ darts

  dart(from: THREE.Vector3, dir: THREE.Vector3, speed = 26) {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(this.dartGeo, tinted(0x3a2a1a, 'ruins', 0.7));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.06, 4).rotateX(-Math.PI / 2).translate(0, 0, -0.18), surface('iron', 'ruins'));
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.08).rotateX(Math.PI / 2).translate(0, 0, 0.15), tinted(0xb02020, 'ruins', 0.9, 0, { side: THREE.DoubleSide }));
    g.add(shaft, tip, fl);
    g.position.copy(from);
    g.lookAt(from.clone().add(dir));
    setExposure(g, exposureAt(from.x, from.y, from.z));
    this.game.scene.add(g);
    this.darts.push({ pos: from.clone(), vel: dir.clone().normalize().multiplyScalar(speed), life: 4, stuck: false, mesh: g });
    this.game.audio.dartWhoosh(from);
  }

  /** Run `fn` after `seconds` of simulated time (fixed steps), not wall-clock time. */
  after(seconds: number, fn: () => void) {
    this.timers.push({ t: seconds, fn });
  }

  /** Fire a volley from several points at the player's chest height. */
  volleyAt(sources: THREE.Vector3[], target: THREE.Vector3, delayStep = 0.12) {
    sources.forEach((s, i) => {
      this.after(i * delayStep, () => {
        const dir = target.clone().sub(s);
        dir.y = 0; // horizontal: crouch to dodge
        if (dir.lengthSq() < 0.01) return;
        this.dart(s, dir.normalize());
      });
    });
  }

  private updateTimers(dt: number) {
    if (!this.timers.length) return;
    const due: (() => void)[] = [];
    this.timers = this.timers.filter((tm) => {
      tm.t -= dt;
      if (tm.t > 0) return true;
      due.push(tm.fn);
      return false;
    });
    for (const fn of due) fn();
  }

  private updateDarts(dt: number) {
    const pl = this.game.player;
    for (let i = this.darts.length - 1; i >= 0; i--) {
      const d = this.darts[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.game.scene.remove(d.mesh);
        this.darts.splice(i, 1);
        continue;
      }
      if (d.stuck) continue;
      const step = d.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const hit = this.game.physics.ray(d.pos, step.clone().normalize(), len, Q_SOLID);
      // player hit test: segment vs capsule axis
      if (!pl.dead) {
        const a0 = new THREE.Vector3(pl.pos.x, pl.feetY + RADIUS, pl.pos.z);
        const a1 = new THREE.Vector3(pl.pos.x, pl.feetY + pl.height - RADIUS, pl.pos.z);
        const dist = segSegDist(d.pos, d.pos.clone().add(step), a0, a1);
        if (dist < RADIUS + 0.04 && (!hit || hit.toi > d.pos.distanceTo(pl.pos) - 0.5)) {
          pl.damage(DAMAGE.dart, 'dart');
          this.game.audio.dartHit(d.pos);
          this.game.hurtFlash(0.6);
          this.game.scene.remove(d.mesh);
          this.darts.splice(i, 1);
          continue;
        }
      }
      if (hit) {
        d.pos.copy(hit.point);
        d.stuck = true;
        d.life = 6;
        this.game.audio.dartHit(hit.point);
      } else d.pos.add(step);
      d.mesh.position.copy(d.pos);
    }
  }

  // ------------------------------------------------------------ debris

  rock(pos: THREE.Vector3, size: number, vel?: THREE.Vector3): Debris {
    const geo = new THREE.DodecahedronGeometry(size, 0);
    geo.scale(1, 0.75 + Math.random() * 0.3, 1);
    const mesh = new THREE.Mesh(geo, surface('rock', exposureAt(pos.x, pos.y, pos.z)));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const body = this.owner.body(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setAngvel({ x: Math.random() * 4 - 2, y: Math.random() * 4 - 2, z: Math.random() * 4 - 2 }).setCcdEnabled(true));
    this.owner.collider(RAPIER.ColliderDesc.ball(size * 0.85).setMass(size * size * size * 2200).setFriction(0.9).setRestitution(0.15).setCollisionGroups(G_DEBRIS), body, { kind: 'debris' });
    if (vel) body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    this.game.scene.add(mesh);
    const d: Debris = { body, mesh, life: 20 + Math.random() * 6, hit: false, big: size > 0.45 };
    this.debris.push(d);
    if (this.debris.length > 60) this.removeDebris(this.debris[0]);
    return d;
  }

  private removeDebris(d: Debris) {
    const i = this.debris.indexOf(d);
    if (i >= 0) this.debris.splice(i, 1);
    this.owner.removeBody(d.body);
    this.game.scene.remove(d.mesh);
    d.mesh.geometry.dispose();
  }

  private updateDebris(dt: number) {
    const pl = this.game.player;
    for (const d of [...this.debris]) {
      d.life -= dt;
      const p = d.body.translation();
      if (d.life <= 0 || p.y < -70) {
        this.removeDebris(d);
        continue;
      }
      d.mesh.position.set(p.x, p.y, p.z);
      const q = d.body.rotation();
      d.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      if (!d.hit && !pl.dead) {
        const v = d.body.linvel();
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > 4) {
          const head = pl.eye();
          const dx = p.x - head.x;
          const dz = p.z - head.z;
          const dy = p.y - (pl.feetY + pl.height * 0.6);
          if (Math.hypot(dx, dz) < 0.8 && Math.abs(dy) < pl.height * 0.6) {
            d.hit = true;
            const dmg = Math.min(DAMAGE.debrisMax, Math.round(sp * (d.big ? 2.2 : 1.2)));
            pl.damage(dmg, 'debris');
            this.game.hurtFlash(0.7);
            this.game.audio.crunch(p, 0.6);
          }
        } else if (sp < 0.5 && d.life < 18) d.hit = true;
      }
    }
  }

  /** Remove debris lying in a region (scene unload). */
  clearDebrisIn(test: (x: number, y: number, z: number) => boolean) {
    for (const d of [...this.debris]) {
      const p = d.body.translation();
      if (test(p.x, p.y, p.z)) this.removeDebris(d);
    }
  }

  // ------------------------------------------------------------ dust & sparks

  dust(at: THREE.Vector3, amount = 1, _color = 0x9a8a70) {
    const exp = exposureAt(at.x, at.y, at.z);
    const n = Math.round(6 + amount * 10);
    for (let i = 0; i < n; i++) {
      const key = exp === 'dungeon' ? 'dark' : 'lit';
      const slot = this.free[key].pop();
      if (slot === undefined) return;
      const max = 1.2 + Math.random() * 1.6;
      this.puffs.push({
        pos: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * amount, Math.random() * 0.4, (Math.random() - 0.5) * amount)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.6, Math.random() * 0.8 + 0.2, (Math.random() - 0.5) * 1.6),
        life: max,
        max,
        size: (0.2 + Math.random() * 0.35) * (0.6 + amount * 0.5),
        slot,
        exp,
      });
    }
  }

  spark(at: THREE.Vector3, n = 8) {
    for (let i = 0; i < n; i++) {
      if (this.sparkData.length >= 64) this.sparkData.shift();
      this.sparkData.push({ p: at.clone(), v: new THREE.Vector3((Math.random() - 0.5) * 2.5, Math.random() * 2, (Math.random() - 0.5) * 2.5), life: 0.25 + Math.random() * 0.3 });
    }
  }

  private updatePuffs(dt: number) {
    const touched = { lit: false, dark: false };
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      const key = p.exp === 'dungeon' ? 'dark' : 'lit';
      const mesh = this.dustMeshes[key];
      touched[key] = true;
      if (p.life <= 0) {
        mesh.setMatrixAt(p.slot, this.m4.makeScale(0, 0, 0));
        this.free[key].push(p.slot);
        this.puffs.splice(i, 1);
        continue;
      }
      p.vel.multiplyScalar(Math.exp(-1.5 * dt));
      p.pos.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      const s = p.size * (1.6 - k * 0.8) * Math.min(1, k * 3);
      this.m4.makeScale(s, s, s).setPosition(p.pos);
      mesh.setMatrixAt(p.slot, this.m4);
    }
    if (touched.lit) this.dustMeshes.lit.instanceMatrix.needsUpdate = true;
    if (touched.dark) this.dustMeshes.dark.instanceMatrix.needsUpdate = true;

    const arr = (this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = this.sparkData.length - 1; i >= 0; i--) {
      const s = this.sparkData[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparkData.splice(i, 1);
        continue;
      }
      s.v.y -= 6 * dt;
      s.p.addScaledVector(s.v, dt);
    }
    for (let i = 0; i < 64; i++) {
      const s = this.sparkData[i];
      if (s) arr.set([s.p.x, s.p.y, s.p.z], i * 3);
      else arr.set([0, -9999, 0], i * 3);
    }
    this.sparks.geometry.getAttribute('position').needsUpdate = true;
  }

  fixedUpdate(dt: number) {
    this.updateTimers(dt);
    this.updateDarts(dt);
    this.updateDebris(dt);
  }

  update(dt: number) {
    this.updatePuffs(dt);
    this.shake = Math.max(0, this.shake - dt * 1.8);
  }

  clear() {
    this.timers = [];
    for (const d of this.darts) this.game.scene.remove(d.mesh);
    this.darts = [];
    for (const d of [...this.debris]) this.removeDebris(d);
    for (const p of this.puffs) {
      const key = p.exp === 'dungeon' ? 'dark' : 'lit';
      this.dustMeshes[key].setMatrixAt(p.slot, this.m4.makeScale(0, 0, 0));
      this.free[key].push(p.slot);
    }
    this.puffs = [];
    this.dustMeshes.lit.instanceMatrix.needsUpdate = true;
    this.dustMeshes.dark.instanceMatrix.needsUpdate = true;
    this.sparkData = [];
    this.owner.dispose();
  }
}

/** Distance between segments p1-q1 and p2-q2. */
export function segSegDist(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s: number;
  let t: number;
  if (a <= 1e-9 && e <= 1e-9) return r.length();
  if (a <= 1e-9) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= 1e-9) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s);
  const c2 = p2.clone().addScaledVector(d2, t);
  return c1.distanceTo(c2);
}
