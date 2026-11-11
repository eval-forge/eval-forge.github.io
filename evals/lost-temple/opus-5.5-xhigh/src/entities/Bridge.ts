/**
 * The rope bridge over the gorge: a chain of dynamic plank bodies linked by spherical
 * joints at both rope lines and anchored to fixed posts. Each plank cracks the first time
 * you step on it and drops after a short delay (its rope link stays, so the rest of the
 * bridge holds); once you reach the far side the north ropes snap and the whole thing
 * swings down into the gorge.
 */
import * as THREE from 'three';
import { RAPIER, G_DYNAMIC, G_DEBRIS, GROUP, groups } from '../engine/physics';
import { surface, type Exposure } from '../engine/materials';
import { FailTimer } from '../logic/traps';
import { BRIDGE } from '../world/layout';
import { mesh } from '../world/build';
import type { SceneHandle } from '../world/SceneManager';
import type { Game } from '../game/Game';

const N = 26;
const HALF_W = BRIDGE.width / 2;

interface Plank {
  i: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  timer: FailTimer;
  dropped: boolean;
}

export function buildBridge(game: Game, h: SceneHandle) {
  const run = game.run;
  const exp: Exposure = 'outdoor';
  const span = BRIDGE.zSouth - BRIDGE.zNorth;
  const spacing = span / N;
  const wood = surface('wood', exp);
  const ropeMat = surface('rope', exp);
  const world = game.physics.world;

  // posts at both ends
  for (const z of [BRIDGE.zSouth + 0.3, BRIDGE.zNorth - 0.3]) {
    for (const sx of [-1, 1]) {
      const post = mesh(new THREE.CylinderGeometry(0.14, 0.17, 2.6, 8), wood, sx * (HALF_W + 0.25), 0.9, z);
      h.group.add(post);
      h.owner.staticCylinder(sx * (HALF_W + 0.25), 0.9, z, 1.3, 0.17);
    }
  }

  // sloped landing boards at both ends: you always have a solid step off the sagging deck.
  // They only collide with the player, so the planks hang freely underneath.
  const LAND = 1.5;
  const DROP = 0.42;
  const tilt = Math.atan2(DROP, LAND);
  for (const end of [-1, 1] as const) {
    const zEdge = end < 0 ? BRIDGE.zNorth : BRIDGE.zSouth;
    const cz = zEdge - end * (LAND / 2) * Math.cos(tilt);
    const cy = BRIDGE.y - DROP / 2 - 0.05;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), end < 0 ? tilt : -tilt);
    const board = mesh(new THREE.BoxGeometry(BRIDGE.width + 0.2, 0.1, LAND + 0.1), wood, 0, cy, cz);
    board.quaternion.copy(q);
    h.group.add(board);
    const c = h.owner.collider(
      RAPIER.ColliderDesc.cuboid((BRIDGE.width + 0.2) / 2, 0.05, (LAND + 0.1) / 2)
        .setTranslation(0, cy, cz)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCollisionGroups(groups(GROUP.STATIC, GROUP.PLAYER)),
      undefined,
      { kind: 'static', surface: 'wood' },
    );
    void c;
  }

  if (run.bridgeCollapsed) {
    // only frayed rope ends remain
    for (const sx of [-1, 1]) {
      const r = mesh(new THREE.CylinderGeometry(0.03, 0.03, 9, 5), ropeMat, sx * HALF_W, -4.4, BRIDGE.zSouth + 0.1, true, false);
      h.group.add(r);
    }
    return;
  }

  const anchorS = h.owner.body(RAPIER.RigidBodyDesc.fixed().setTranslation(0, BRIDGE.y - 0.06, BRIDGE.zSouth));
  const anchorN = h.owner.body(RAPIER.RigidBodyDesc.fixed().setTranslation(0, BRIDGE.y - 0.06, BRIDGE.zNorth));
  const planks: Plank[] = [];
  const plankGeo = new THREE.BoxGeometry(BRIDGE.width, 0.09, spacing * 0.82);
  for (let i = 0; i < N; i++) {
    const z = BRIDGE.zSouth - (i + 0.5) * spacing;
    const body = h.owner.body(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, BRIDGE.y - 0.06, z).setLinearDamping(1.2).setAngularDamping(3).setCanSleep(false));
    const collider = h.owner.collider(
      RAPIER.ColliderDesc.cuboid(HALF_W, 0.045, spacing * 0.41).setMass(9).setFriction(1).setCollisionGroups(G_DYNAMIC),
      body,
      { kind: 'plank', surface: 'wood' },
    );
    const m = mesh(plankGeo, wood, 0, 0, z);
    m.rotation.y = (Math.random() - 0.5) * 0.04;
    h.group.add(m);
    const p: Plank = { i, body, collider, mesh: m, timer: new FailTimer(0.55 + Math.random() * 0.5), dropped: false };
    game.physics.tag(collider, { kind: 'plank', surface: 'wood', ref: p });
    planks.push(p);
  }
  const joints: RAPIER.ImpulseJoint[] = [];
  const northJoints: RAPIER.ImpulseJoint[] = [];
  const link = (a: RAPIER.RigidBody, aZ: number, b: RAPIER.RigidBody, bZ: number, list: RAPIER.ImpulseJoint[]) => {
    for (const sx of [-1, 1]) {
      const jd = RAPIER.JointData.spherical({ x: sx * HALF_W, y: 0, z: aZ }, { x: sx * HALF_W, y: 0, z: bZ });
      list.push(world.createImpulseJoint(jd, a, b, true));
    }
  };
  link(anchorS, 0, planks[0].body, spacing / 2, joints);
  for (let i = 0; i < N - 1; i++) link(planks[i].body, -spacing / 2, planks[i + 1].body, spacing / 2, joints);
  link(planks[N - 1].body, -spacing / 2, anchorN, 0, northJoints);

  // rope visuals: deck ropes + hand ropes, rebuilt from plank transforms every frame
  const segGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 5);
  segGeo.rotateX(Math.PI / 2);
  const ropes = new THREE.InstancedMesh(segGeo, ropeMat, (N + 1) * 4 + N * 2);
  ropes.castShadow = true;
  ropes.frustumCulled = false;
  h.group.add(ropes);

  const dropPlank = (p: Plank) => {
    if (p.dropped) return;
    p.dropped = true;
    run.brokenPlanks.add(p.i);
    p.collider.setEnabled(false);
    p.mesh.visible = false;
    // the plank itself tumbles into the gorge
    const t = p.body.translation();
    const q = p.body.rotation();
    const fb = h.owner.body(RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x, t.y - 0.05, t.z).setRotation(q).setAngvel({ x: Math.random() * 3, y: 0, z: Math.random() * 2 - 1 }));
    h.owner.collider(RAPIER.ColliderDesc.cuboid(HALF_W * 0.9, 0.045, spacing * 0.4).setMass(6).setCollisionGroups(G_DEBRIS), fb, { kind: 'debris' });
    const fm = mesh(plankGeo, wood, t.x, t.y, t.z);
    h.group.add(fm);
    h.update.push(() => {
      const ft = fb.translation();
      const fq = fb.rotation();
      fm.position.set(ft.x, ft.y, ft.z);
      fm.quaternion.set(fq.x, fq.y, fq.z, fq.w);
    });
    game.audio.snap(t);
    game.noise(t.x, t.y, t.z, 0.4);
  };

  for (const i of run.brokenPlanks) if (planks[i]) dropPlank(planks[i]);

  let collapseT = -1;
  let crossed = false;
  let crossT = -1;
  const collapse = () => {
    if (collapseT >= 0) return;
    collapseT = 0;
    for (const j of northJoints) world.removeImpulseJoint(j, true);
    northJoints.length = 0;
    game.audio.snap(new THREE.Vector3(0, 0, BRIDGE.zNorth));
    game.audio.creak(new THREE.Vector3(0, 0, BRIDGE.zNorth + 4), 1.4);
    game.toast('Behind you, the bridge ropes snap. No way back that way.', 'warn');
    for (const p of planks) p.body.wakeUp();
  };

  // footfalls: crack the plank you're on
  const onPlank = (p: Plank) => {
    if (p.dropped) return;
    // the player's weight (about half of it, spread by the ropes) presses the plank down
    p.body.applyImpulse({ x: 0, y: -70 * 9.8 * 0.5 * (1 / 60), z: 0 }, true);
    if (p.timer.touch()) {
      game.audio.creak(p.body.translation(), 0.7);
      game.noise(0, 0, p.body.translation().z, 0.15);
    }
  };
  h.dispose.push(game.onStand((tag) => {
    if (tag.kind === 'plank' && tag.ref) onPlank(tag.ref as Plank);
  }));

  h.fixed.push((dt) => {
    for (const p of planks) {
      if (p.dropped) continue;
      if (p.timer.update(dt)) dropPlank(p);
    }
    const pz = game.player.pos.z;
    const px = game.player.pos.x;
    if (!crossed && pz < BRIDGE.zNorth - 1.5 && Math.abs(px) < 6 && game.player.grounded) {
      crossed = true;
      crossT = 0.7;
    }
    if (crossT > 0) {
      crossT -= dt;
      if (crossT <= 0) collapse();
    }
    // most of the deck gone and nobody on it: the rest gives way
    const onBridge = Math.abs(px) < 3 && pz < BRIDGE.zSouth + 0.5 && pz > BRIDGE.zNorth - 0.5;
    if (collapseT < 0 && run.brokenPlanks.size > N * 0.6 && !onBridge) collapse();
    if (collapseT >= 0) {
      collapseT += dt;
      if (collapseT > 9 && !run.bridgeCollapsed) run.bridgeCollapsed = true;
    }
  });

  // per frame: plank meshes + rope segments
  const m4 = new THREE.Matrix4();
  const pts: THREE.Vector3[][] = [[], [], [], []];
  const tmpQ = new THREE.Quaternion();
  h.update.push(() => {
    for (const l of pts) l.length = 0;
    const s0 = anchorS.translation();
    for (const sx of [-1, 1]) {
      pts[sx < 0 ? 0 : 1].push(new THREE.Vector3(s0.x + sx * HALF_W, s0.y, s0.z));
      pts[sx < 0 ? 2 : 3].push(new THREE.Vector3(s0.x + sx * (HALF_W + 0.25), s0.y + 1.1, s0.z + 0.3));
    }
    for (const p of planks) {
      const t = p.body.translation();
      const q = p.body.rotation();
      tmpQ.set(q.x, q.y, q.z, q.w);
      if (!p.dropped) {
        p.mesh.position.set(t.x, t.y, t.z);
        p.mesh.quaternion.copy(tmpQ);
      }
      for (const sx of [-1, 1]) {
        const e = new THREE.Vector3(sx * HALF_W, 0, 0).applyQuaternion(tmpQ).add(t as any);
        pts[sx < 0 ? 0 : 1].push(e);
        const hr = new THREE.Vector3(sx * (HALF_W + 0.1), 1.0, 0).applyQuaternion(tmpQ).add(t as any);
        pts[sx < 0 ? 2 : 3].push(hr);
      }
    }
    if (northJoints.length) {
      const n0 = anchorN.translation();
      for (const sx of [-1, 1]) {
        pts[sx < 0 ? 0 : 1].push(new THREE.Vector3(n0.x + sx * HALF_W, n0.y, n0.z));
        pts[sx < 0 ? 2 : 3].push(new THREE.Vector3(n0.x + sx * (HALF_W + 0.25), n0.y + 1.1, n0.z - 0.3));
      }
    }
    let k = 0;
    const seg = (a: THREE.Vector3, b: THREE.Vector3) => {
      const len = a.distanceTo(b);
      if (len < 1e-3) return;
      m4.lookAt(a, b, THREE.Object3D.DEFAULT_UP);
      m4.scale(new THREE.Vector3(1, 1, len));
      m4.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      ropes.setMatrixAt(k++, m4);
    };
    for (const l of pts) for (let i = 0; i < l.length - 1; i++) seg(l[i], l[i + 1]);
    // vertical strands between deck and hand ropes
    for (let i = 1; i < pts[0].length - 1; i += 2) {
      seg(pts[0][i], pts[2][i]);
      seg(pts[1][i], pts[3][i]);
    }
    ropes.count = k;
    ropes.instanceMatrix.needsUpdate = true;
  });
}
