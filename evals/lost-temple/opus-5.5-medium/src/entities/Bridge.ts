import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G } from '../core/ctx';
import { R } from '../core/Physics';
import { Crumbler } from '../logic/traps';
import type { SceneChunk, Entity } from '../world/SceneChunk';
import { materials } from '../world/textures';

/**
 * Rope bridge made of jointed rigid planks. Each plank cracks when stepped on and
 * drops out after a short delay. Neighbouring intact planks get re-linked with rope
 * joints so the bridge sags but stays connected.
 */
export class Bridge implements Entity {
  planks: { body: RAPIER.RigidBody | null; mesh: THREE.Mesh; crumb: Crumbler; rest: THREE.Vector3; fallenAt: number }[] = [];
  private anchorA: RAPIER.RigidBody | null = null;
  private anchorB: RAPIER.RigidBody | null = null;
  private joints: RAPIER.ImpulseJoint[] = [];
  private dir: THREE.Vector3;
  private side: THREE.Vector3;
  private len: number;
  private ropes: THREE.InstancedMesh;
  private plankLen: number;
  private gap: number;
  private creakT = 0;

  constructor(public chunk: SceneChunk, public a: THREE.Vector3, public b: THREE.Vector3, public width = 1.6, n = 18, public delay = 0.7) {
    this.dir = b.clone().sub(a);
    this.len = this.dir.length();
    this.dir.normalize();
    this.side = new THREE.Vector3(0, 1, 0).cross(this.dir).normalize();
    this.gap = 0.12;
    this.plankLen = this.len / n - this.gap;
    const mats = materials();
    const geo = new THREE.BoxGeometry(this.width, 0.08, this.plankLen);
    for (let i = 0; i < n; i++) {
      const rest = a.clone().addScaledVector(this.dir, (i + 0.5) * (this.len / n));
      // slight sag at rest
      rest.y -= Math.sin(((i + 0.5) / n) * Math.PI) * 0.25;
      const mesh = new THREE.Mesh(geo, mats.wood);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.dynamic = true;
      mesh.position.copy(rest);
      mesh.lookAt(rest.clone().add(this.dir));
      chunk.group.add(mesh);
      this.planks.push({ body: null, mesh, crumb: new Crumbler(delay + (i % 3) * 0.06), rest, fallenAt: -1 });
    }
    // Posts & handrails (static)
    for (const end of [a, b]) for (const s of [-1, 1]) {
      const p = end.clone().addScaledVector(this.side, s * (this.width / 2 + 0.15));
      chunk.b.cyl(0.12, 2.4, p.x, p.y - 0.2, p.z, mats.wood, { segs: 8 });
    }
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const p = a.clone().lerp(b, t).addScaledVector(this.side, s * (this.width / 2 + 0.15));
        p.y += 0.95 - Math.sin(t * Math.PI) * 0.45;
        pts.push(p);
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.03, 5), mats.rope);
      tube.castShadow = true;
      chunk.group.add(tube);
    }
    // Rope segments between planks (updated every frame)
    this.ropes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 4), mats.rope, (n + 1) * 2 + n * 2);
    this.ropes.castShadow = true;
    this.ropes.frustumCulled = false;
    this.ropes.userData.dynamic = true;
    chunk.group.add(this.ropes);
    chunk.entities.push(this);
  }

  private edge(i: number, end: -1 | 1, s: -1 | 1): THREE.Vector3 {
    const p = this.planks[i];
    const local = new THREE.Vector3(s * this.width / 2 * 0.9, 0, end * this.plankLen / 2);
    return local.applyQuaternion(p.mesh.quaternion).add(p.mesh.position);
  }

  load() {
    const w = G.physics.world;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.dir);
    this.anchorA = w.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(this.a.x, this.a.y, this.a.z));
    this.anchorB = w.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(this.b.x, this.b.y, this.b.z));
    for (let i = 0; i < this.planks.length; i++) {
      const p = this.planks[i];
      if (p.crumb.state === 'fallen') { p.mesh.visible = false; continue; }
      p.crumb.state = 'solid';
      const body = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p.rest.x, p.rest.y, p.rest.z).setRotation(q).setLinearDamping(0.6).setAngularDamping(2.5).setCanSleep(true));
      const c = w.createCollider(R.ColliderDesc.cuboid(this.width / 2, 0.04, this.plankLen / 2).setDensity(180).setFriction(1.0), body);
      G.physics.tag(c, { kind: 'plank', ref: { bridge: this, index: i } });
      p.body = body;
    }
    this.relink();
  }

  /** (Re)create joints between consecutive intact planks and the anchors. */
  private relink() {
    const w = G.physics.world;
    for (const j of this.joints) if (w.impulseJoints.contains(j.handle)) w.removeImpulseJoint(j, true);
    this.joints = [];
    const intact = this.planks.map((p, i) => ({ p, i })).filter((x) => x.p.body && x.p.crumb.state !== 'fallen');
    const hl = this.plankLen / 2;
    let prevBody = this.anchorA!, prevIdx = -1;
    const link = (b1: RAPIER.RigidBody, b2: RAPIER.RigidBody, i1: number, i2: number, isAnchor1: boolean, isAnchor2: boolean) => {
      const missing = i2 - i1 - 1; // planks lost between them
      for (const s of [-1, 1]) {
        const off = s * this.width / 2 * 0.9;
        const a1 = isAnchor1 ? { x: this.side.x * off, y: 0, z: this.side.z * off } : { x: off, y: 0, z: hl };
        const a2 = isAnchor2 ? { x: this.side.x * off, y: 0, z: this.side.z * off } : { x: off, y: 0, z: -hl };
        let jd: RAPIER.JointData;
        if (missing <= 0) jd = R.JointData.spherical(a1, a2);
        else jd = R.JointData.rope((this.plankLen + this.gap) * missing + this.gap + 0.05, a1, a2);
        this.joints.push(w.createImpulseJoint(jd, b1, b2, true));
      }
    };
    for (const { p, i } of intact) {
      link(prevBody, p.body!, prevIdx, i, prevIdx === -1, false);
      prevBody = p.body!; prevIdx = i;
    }
    link(prevBody, this.anchorB!, prevIdx, this.planks.length, prevIdx === -1, true);
  }

  unload() {
    const w = G.physics.world;
    for (const j of this.joints) if (w.impulseJoints.contains(j.handle)) w.removeImpulseJoint(j, false);
    this.joints = [];
    for (const p of this.planks) { if (p.body) G.physics.removeBody(p.body); p.body = null; }
    G.physics.removeBody(this.anchorA); G.physics.removeBody(this.anchorB);
    this.anchorA = this.anchorB = null;
  }

  /** Player stepped on plank i. */
  stepOn(i: number) {
    const p = this.planks[i];
    if (p.crumb.state === 'solid') {
      p.crumb.step();
      G.audio.creak(p.mesh.position);
      G.noise([p.mesh.position.x, p.mesh.position.y, p.mesh.position.z], 0.3);
    }
  }

  update(dt: number) {
    // Which plank is the player on?
    const gt = G.player.groundTag;
    if (gt?.kind === 'plank') {
      const r = gt.ref as { bridge: Bridge; index: number };
      if (r.bridge === this) this.stepOn(r.index);
    }
    let changed = false;
    for (let i = 0; i < this.planks.length; i++) {
      const p = this.planks[i];
      const ev = p.crumb.update(dt);
      if (ev === 'fall') {
        changed = true;
        G.audio.snap(p.mesh.position);
        if (p.body) {
          // Let it tumble into the gorge: detach, keep it simulated for a few seconds
          p.fallenAt = G.time;
        }
      }
      if (p.body) {
        const t = p.body.translation(), r = p.body.rotation();
        p.mesh.position.set(t.x, t.y, t.z);
        p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        // Wobble the cracking plank a bit
        if (p.crumb.state === 'cracking') p.mesh.position.y += Math.sin(G.time * 60) * 0.01;
        if (p.crumb.state === 'fallen' && G.time - p.fallenAt > 4) { G.physics.removeBody(p.body); p.body = null; p.mesh.visible = false; }
      }
    }
    if (changed) {
      // Remove joints touching fallen planks by relinking intact ones.
      this.relink();
    }
    // Ambient creaks while someone is on it
    this.creakT -= dt;
    if (gt?.kind === 'plank' && this.creakT <= 0) { this.creakT = 0.8 + Math.random(); G.audio.creak(G.player.position); }
    this.updateRopes();
  }

  private updateRopes() {
    const m = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    const seg = (p0: THREE.Vector3, p1: THREE.Vector3) => {
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const d = p1.clone().sub(p0);
      const l = d.length();
      if (l < 1e-3 || l > 6) return;
      const q = new THREE.Quaternion().setFromUnitVectors(up, d.normalize());
      m.compose(mid, q, new THREE.Vector3(1, l, 1));
      this.ropes.setMatrixAt(k++, m);
    };
    const n = this.planks.length;
    for (const s of [-1, 1] as const) {
      let prev = this.a.clone().addScaledVector(this.side, s * this.width / 2 * 0.9);
      for (let i = 0; i < n; i++) {
        const p = this.planks[i];
        if (!p.mesh.visible || p.crumb.state === 'fallen') continue;
        seg(prev, this.edge(i, -1, s));
        prev = this.edge(i, 1, s);
      }
      seg(prev, this.b.clone().addScaledVector(this.side, s * this.width / 2 * 0.9));
      // vertical hangers from handrail to each intact plank
      for (let i = 0; i < n; i++) {
        const p = this.planks[i];
        if (!p.mesh.visible || p.crumb.state === 'fallen') continue;
        const e = this.edge(i, 0 as unknown as 1, s);
        const t = (i + 0.5) / n;
        const rail = this.a.clone().lerp(this.b, t).addScaledVector(this.side, s * (this.width / 2 + 0.15));
        rail.y += 0.95 - Math.sin(t * Math.PI) * 0.45;
        seg(e, rail);
      }
    }
    this.ropes.count = k;
    this.ropes.instanceMatrix.needsUpdate = true;
  }
}
