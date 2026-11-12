import * as THREE from 'three';
import type { SceneCtx } from '../core/types';
import { NavMesh, type NavPoly } from '../logic/navmesh';
import { stepGuardian, newMem, stalkPoint, fleePoint, type GMem, type GuardianKind, type Perception, SPAWN_SCHEDULE } from '../logic/guardianFSM';
import { GUARDIAN_SPAWNS, DOOR_INSIDE } from '../world/layout';
import type { V3 } from '../logic/vec';

export interface NoiseEvent { pos: THREE.Vector3; radius: number }

interface Guardian {
  kind: GuardianKind;
  scene: string;
  mem: GMem;
  pos: THREE.Vector3;
  yaw: number;
  path: V3[];
  pathIdx: number;
  repath: number;
  lastTarget: THREE.Vector3 | null;
  mesh: THREE.Group;
  limbs: THREE.Object3D[];
  phase: number;
  los: boolean;
  losT: number;
  callT: number;
  awake: boolean;
  stuckT: number;
}

const v3 = (p: V3) => new THREE.Vector3(p.x, p.y, p.z);

function sentinelMesh(ctx: SceneCtx): { g: THREE.Group; limbs: THREE.Object3D[] } {
  const g = new THREE.Group();
  const stone = ctx.mats.get('carvedDark');
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stone);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };
  box(1.0, 1.2, 0.6, 0, 1.75, 0);
  box(0.7, 0.6, 0.6, 0, 2.6, 0.02);
  box(0.12, 0.08, 0.05, -0.15, 2.65, 0.32);
  box(0.12, 0.08, 0.05, 0.15, 2.65, 0.32);
  box(0.8, 0.3, 0.5, 0, 1.05, 0);
  const limbs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.68, 2.25, 0); g.add(arm);
    box(0.32, 1.3, 0.32, 0, -0.65, 0, arm);
    box(0.4, 0.35, 0.4, 0, -1.4, 0.05, arm);
    limbs.push(arm);
  }
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(s * 0.25, 0.95, 0); g.add(leg);
    box(0.36, 0.95, 0.4, 0, -0.48, 0, leg);
    limbs.push(leg);
  }
  return { g, limbs };
}

function crawlerMesh(ctx: SceneCtx): { g: THREE.Group; limbs: THREE.Object3D[] } {
  const g = new THREE.Group();
  const chitin = ctx.mats.color(0x2e2620, 0.2, 0.45);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 10), chitin);
  body.scale.set(0.85, 0.45, 1.3); body.position.y = 0.55; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), chitin);
  head.position.set(0, 0.55, 0.85); head.scale.set(1, 0.7, 1.1); head.castShadow = true; g.add(head);
  for (const s of [-1, 1]) {
    const mand = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 5), ctx.mats.color(0x8a7a60, 0, 0.5));
    mand.position.set(s * 0.14, 0.45, 1.15); mand.rotation.x = Math.PI / 2; mand.rotation.z = s * 0.4; g.add(mand);
  }
  const limbs: THREE.Object3D[] = [];
  for (let i = 0; i < 6; i++) {
    const s = i < 3 ? -1 : 1;
    const k = i % 3;
    const leg = new THREE.Group();
    leg.position.set(s * 0.4, 0.6, 0.45 - k * 0.45);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.8, 5), chitin);
    upper.position.set(s * 0.32, 0.12, 0); upper.rotation.z = s * -1.1; leg.add(upper);
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.015, 0.8, 5), chitin);
    lower.position.set(s * 0.7, -0.25, 0); lower.rotation.z = s * 0.35; leg.add(lower);
    leg.traverse((o) => (o.castShadow = true));
    g.add(leg);
    limbs.push(leg);
  }
  return { g, limbs };
}

function shadeMesh(ctx: SceneCtx): { g: THREE.Group; limbs: THREE.Object3D[] } {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x07060a, roughness: 1, transparent: true, opacity: 0.88 });
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.1, 10, 4, true), black);
  const pos = cloak.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.9) pos.setY(i, pos.getY(i) + Math.sin(i * 2.3) * 0.15);
  cloak.position.y = 1.05; cloak.castShadow = true; g.add(cloak);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), black);
  head.position.y = 2.15; head.scale.set(0.9, 1.2, 0.9); g.add(head);
  const limbs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.3, 1.8, 0);
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, 1.4, 5), black);
    a.position.y = -0.7; arm.add(a); arm.rotation.z = s * 0.25; g.add(arm); limbs.push(arm);
  }
  return { g, limbs };
}

/** All temple guardians. Dormant during the day; wake at sunset deepest-first. */
export class GuardianSystem {
  list: Guardian[] = [];
  nav: NavMesh;
  caught: (kind: GuardianKind) => void = () => {};
  private canUse: (p: NavPoly) => boolean;

  constructor(private ctx: SceneCtx, nav: NavMesh) {
    this.nav = nav;
    this.canUse = (p) => !p.gate || !!ctx.run().flags[p.gate as keyof ReturnType<SceneCtx['run']>['flags']];
  }

  reset() {
    for (const g of this.list) this.ctx.scene.remove(g.mesh);
    this.list = [];
    for (const s of GUARDIAN_SPAWNS) {
      const m = s.kind === 'sentinel' ? sentinelMesh(this.ctx) : s.kind === 'crawler' ? crawlerMesh(this.ctx) : shadeMesh(this.ctx);
      const snap = this.nav.nearest(s.pos);
      const pos = snap ? v3(snap.point) : s.pos.clone();
      m.g.position.copy(pos);
      m.g.rotation.y = Math.random() * Math.PI * 2;
      // dormant sentinels stand like statues; the others stay hidden until they wake
      m.g.visible = s.kind === 'sentinel';
      this.ctx.scene.add(m.g);
      this.list.push({
        kind: s.kind, scene: s.scene, mem: newMem(), pos, yaw: m.g.rotation.y, path: [], pathIdx: 0, repath: 0, lastTarget: null,
        mesh: m.g, limbs: m.limbs, phase: Math.random() * 6, los: false, losT: Math.random() * 0.2, callT: 3 + Math.random() * 6, awake: false, stuckT: 0,
      });
    }
  }

  nearestActiveDist(p: THREE.Vector3): number {
    let d = Infinity;
    for (const g of this.list) if (g.mem.state !== 'dormant' && g.mem.state !== 'waking') d = Math.min(d, g.pos.distanceTo(p));
    return d;
  }
  activeCount() { return this.list.filter((g) => g.mem.state !== 'dormant').length; }

  update(dt: number, sinceSunset: number, noises: NoiseEvent[], torch: { lit: boolean; radius: number }, playerLit: (p: THREE.Vector3) => boolean, lightAt: (p: THREE.Vector3) => boolean) {
    const ctx = this.ctx;
    const pl = ctx.player;
    const playerPos = pl.feet.clone();
    const eye = pl.eye(new THREE.Vector3());
    const early = !!ctx.run().entities.get('earlyWake');
    for (const g of this.list) {
      const sched = SPAWN_SCHEDULE.find((s) => s.scene === g.scene)!;
      const awake = (sinceSunset >= sched.delay) || (early && g.scene === 'vault' && g.kind === 'sentinel');
      // perception
      const dist = g.pos.distanceTo(playerPos);
      g.losT -= dt;
      if (g.losT <= 0 && g.mem.state !== 'dormant') {
        g.losT = 0.2;
        const head = g.pos.clone().add(new THREE.Vector3(0, g.kind === 'crawler' ? 0.7 : 1.9, 0));
        g.los = dist < 45 && ctx.physics.lineOfSight(head, eye, pl.collider);
      }
      let heard: THREE.Vector3 | null = null, best = 0;
      const mult = g.kind === 'crawler' ? 1.6 : 1;
      for (const n of noises) {
        const d = n.pos.distanceTo(g.pos);
        const r = n.radius * mult;
        if (d < r && r - d > best) { best = r - d; heard = n.pos; }
      }
      const pLit = playerLit(playerPos);
      const selfLit = lightAt(g.pos);
      const per: Perception = {
        awake, dist, los: g.los, playerPos: { x: playerPos.x, y: playerPos.y, z: playerPos.z }, torchLit: torch.lit, torchRadius: torch.radius,
        noise: heard ? { x: heard.x, y: heard.y, z: heard.z } : null, playerLit: pLit, selfLit,
      };
      const prevState = g.mem.state;
      const d = stepGuardian(g.kind, g.mem, per, dt, DOOR_INSIDE);
      g.mem = d.mem;
      if (prevState === 'dormant' && g.mem.state !== 'dormant') {
        g.mesh.visible = true;
        ctx.audio.play(g.kind === 'sentinel' ? 'growl' : g.kind === 'crawler' ? 'chitter' : 'whisper', g.pos, 1);
      }
      if (d.call) ctx.audio.play(g.kind === 'sentinel' ? 'growl' : g.kind === 'crawler' ? 'chitter' : 'whisper', g.pos, 1);
      if (g.mem.state === 'dormant' || g.mem.state === 'waking') {
        if (g.mem.state === 'waking') { g.mesh.position.y = g.pos.y + Math.sin(g.mem.timer * 30) * 0.02; }
        continue;
      }
      g.callT -= dt;
      if (g.callT <= 0) { g.callT = 6 + Math.random() * 8; ctx.audio.play(g.kind === 'sentinel' ? 'growl' : g.kind === 'crawler' ? 'chitter' : 'whisper', g.pos, 0.7); }
      if (d.caught) { this.caught(g.kind); return; }

      // where to go
      let target: THREE.Vector3 | null = g.mem.target ? v3(g.mem.target) : null;
      if (g.kind === 'shade' && g.mem.state === 'stalk') target = v3(stalkPoint(g.pos, playerPos, torch.lit ? torch.radius : 2));
      if (g.kind === 'shade' && g.mem.state === 'flee') target = v3(fleePoint(g.pos, playerPos));
      if (!target) continue;
      g.repath -= dt;
      const moved = !g.lastTarget || g.lastTarget.distanceTo(target) > (g.mem.state === 'chase' ? 1.0 : 3);
      if (g.repath <= 0 || moved || g.pathIdx >= g.path.length) {
        g.repath = g.mem.state === 'chase' ? 0.35 : 1.5;
        g.lastTarget = target.clone();
        const path = this.nav.findPath({ x: g.pos.x, y: g.pos.y, z: g.pos.z }, { x: target.x, y: target.y, z: target.z }, this.canUse);
        g.path = path ?? [];
        g.pathIdx = 1;
      }
      // advance along the path
      let step = d.speed * dt;
      const before = g.pos.clone();
      while (step > 0 && g.pathIdx < g.path.length) {
        const wp = v3(g.path[g.pathIdx]);
        const to = wp.clone().sub(g.pos);
        const len = to.length();
        if (len <= step) { g.pos.copy(wp); step -= len; g.pathIdx++; }
        else {
          const next = g.pos.clone().addScaledVector(to, step / len);
          // a shade will not step into light
          if (g.kind === 'shade' && g.mem.state !== 'flee' && lightAt(next) && !selfLit) break;
          g.pos.copy(next);
          step = 0;
        }
      }
      const h = this.nav.heightAt(g.pos.x, g.pos.y, g.pos.z);
      if (h !== null) g.pos.y = h;
      const mv = g.pos.clone().sub(before);
      const sp = mv.length() / Math.max(dt, 1e-4);
      if (mv.lengthSq() > 1e-6) {
        const want = Math.atan2(mv.x, mv.z);
        let dy = want - g.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        g.yaw += dy * Math.min(1, dt * 8);
      } else if (g.mem.state === 'chase' || g.mem.state === 'stalk') {
        const want = Math.atan2(playerPos.x - g.pos.x, playerPos.z - g.pos.z);
        g.yaw += (want - g.yaw) * Math.min(1, dt * 4);
      }
      g.phase += dt * sp * (g.kind === 'crawler' ? 3.2 : 2.2);
      this.animate(g, sp);
    }
  }

  private animate(g: Guardian, sp: number) {
    g.mesh.position.copy(g.pos);
    g.mesh.rotation.y = g.yaw;
    const a = Math.min(1, sp / 2);
    if (g.kind === 'sentinel') {
      g.limbs[0].rotation.x = Math.sin(g.phase) * 0.5 * a;
      g.limbs[1].rotation.x = -Math.sin(g.phase) * 0.5 * a;
      g.limbs[2].rotation.x = -Math.sin(g.phase) * 0.6 * a;
      g.limbs[3].rotation.x = Math.sin(g.phase) * 0.6 * a;
      g.mesh.position.y += Math.abs(Math.sin(g.phase)) * 0.06 * a;
    } else if (g.kind === 'crawler') {
      g.limbs.forEach((l, i) => { l.rotation.x = Math.sin(g.phase + (i % 2) * Math.PI + i) * 0.6 * a; });
      g.mesh.position.y += Math.sin(g.phase * 2) * 0.03 * a;
    } else {
      g.mesh.position.y += 0.15 + Math.sin(g.phase * 0.5 + performance.now() * 0.002) * 0.08;
      g.limbs.forEach((l, i) => { l.rotation.x = -0.4 * a + Math.sin(performance.now() * 0.003 + i) * 0.1; });
    }
  }

  clear() { for (const g of this.list) this.ctx.scene.remove(g.mesh); this.list = []; }
}
