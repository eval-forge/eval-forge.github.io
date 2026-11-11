import * as THREE from 'three';
import { G } from '../core/ctx';
import { SPECS, GuardianKind, GuardianMind, newMind, step, arrived, wakeDelay, Perception, V3 } from '../logic/guardianFSM';
import { DAY_LENGTH } from '../logic/countdown';
import { materials } from '../world/textures';

export const GUARDIAN_NAMES: Record<GuardianKind, string> = { sentinel: 'Stone Sentinel', crawler: 'Crawler', shade: 'Shade' };

function sentinelMesh(): THREE.Group {
  const m = materials();
  const mat = m.mossStone;
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.55), mat); torso.position.y = 1.55;
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.35, 0.45), mat); hips.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.5), mat); head.position.y = 2.35;
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.12), mat); brow.position.set(0, 2.45, 0.27);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.05), eyeMat); e.position.set(s * 0.12, 2.36, 0.26); g.add(e); }
  g.add(torso, hips, head, brow);
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.6, 2.0, 0);
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.1, 0.28), mat); a.position.y = -0.55; arm.add(a);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), mat); fist.position.y = -1.15; arm.add(fist);
    arm.name = s < 0 ? 'armL' : 'armR'; g.add(arm);
    const leg = new THREE.Group(); leg.position.set(s * 0.22, 0.85, 0);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.85, 0.32), mat); l.position.y = -0.42; leg.add(l);
    leg.name = s < 0 ? 'legL' : 'legR'; g.add(leg);
  }
  return g;
}

function crawlerMesh(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8ab90, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), mat); body.scale.set(0.8, 0.45, 1.4); body.position.y = 0.45;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat); head.position.set(0, 0.45, 0.6);
  const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 5), mat); jaw.rotation.x = Math.PI / 2; jaw.position.set(0, 0.38, 0.85);
  g.add(body, head, jaw);
  for (let i = 0; i < 6; i++) {
    const s = i % 2 ? 1 : -1, row = Math.floor(i / 2);
    const leg = new THREE.Group(); leg.position.set(s * 0.3, 0.5, -0.35 + row * 0.38);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.8, 4), mat); l.position.set(s * 0.3, -0.2, 0); l.rotation.z = s * 1.0; leg.add(l);
    leg.name = 'leg' + i; g.add(leg);
  }
  return g;
}

function shadeMesh(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x0a0a0d, roughness: 1, transparent: true, opacity: 0.88 });
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.2, 10, 1, true), mat); robe.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), mat); head.position.y = 2.3; head.scale.set(1, 1.3, 1);
  g.add(robe, head);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 1.3, 5), mat);
    arm.position.set(s * 0.45, 1.6, 0.25); arm.rotation.set(-0.9, 0, s * 0.3); arm.name = s < 0 ? 'armL' : 'armR';
    g.add(arm);
  }
  return g;
}

export class Guardian {
  spec: typeof SPECS[GuardianKind];
  mind: GuardianMind = newMind();
  pos: THREE.Vector3;
  yaw = 0;
  mesh: THREE.Group;
  path: THREE.Vector3[] | null = null;
  pathIdx = 0;
  pathTarget: THREE.Vector3 | null = null;
  repathT = 0;
  losT = 0;
  los = false;
  litT = 0;
  playerLit = false;
  nextLit = false;
  callT = 0;
  stepT = 0;
  anim = 0;
  wakeAt: number;
  lastState = 'DORMANT';
  sweepGoal: THREE.Vector3;
  constructor(public kind: GuardianKind, pos: THREE.Vector3, public home: string, yaw = 0) {
    this.spec = SPECS[kind];
    this.pos = pos.clone();
    this.yaw = yaw;
    this.mesh = kind === 'sentinel' ? sentinelMesh() : kind === 'crawler' ? crawlerMesh() : shadeMesh();
    this.mesh.traverse((o) => { o.castShadow = true; });
    this.wakeAt = DAY_LENGTH + wakeDelay(home);
    this.sweepGoal = new THREE.Vector3(0, 0, -180);
  }
  get name() { return GUARDIAN_NAMES[this.kind]; }
}

export class GuardianSystem {
  list: Guardian[] = [];
  group = new THREE.Group();
  nearest = Infinity;
  constructor(scene: THREE.Scene) { scene.add(this.group); }

  add(kind: GuardianKind, pos: THREE.Vector3, home: string, yaw = 0) {
    const g = new Guardian(kind, pos, home, yaw);
    // Pre-dawn pose: dormant guardians are visible as statues/husks where they sleep.
    g.mesh.position.copy(pos);
    g.mesh.rotation.y = yaw;
    this.group.add(g.mesh);
    this.list.push(g);
  }

  awakeCount() { return this.list.filter((g) => g.mind.state !== 'DORMANT').length; }

  update(dt: number) {
    const pp = G.player.position;
    const eye = G.player.eye;
    this.nearest = Infinity;
    // Loudest recent noise
    const noises = G.noises;
    for (const g of this.list) {
      const awake = G.elapsed >= g.wakeAt;
      const head = new THREE.Vector3(g.pos.x, g.pos.y + (g.kind === 'crawler' ? 0.5 : 2.0), g.pos.z);
      const dist = head.distanceTo(eye);
      // Line of sight (throttled)
      g.losT -= dt;
      if (g.losT <= 0) {
        g.losT = 0.15 + Math.random() * 0.1;
        if (dist < 40 && awake) {
          const d = eye.clone().sub(head).normalize();
          const hit = G.physics.ray(head.x, head.y, head.z, d.x, d.y, d.z, dist, G.player.collider);
          g.los = !hit || hit.toi > dist - 0.4;
        } else g.los = false;
      }
      // Lit checks for the shade
      if (g.kind === 'shade' && awake) {
        g.litT -= dt;
        if (g.litT <= 0) {
          g.litT = 0.2;
          g.playerLit = G.torch.pointLit(pp, true) || (G.torch.lit && G.torch.radius > 4);
          const toward = pp.clone().sub(g.pos).setY(0).normalize();
          const nxt = g.pos.clone().addScaledVector(toward, 1.2); nxt.y += 1;
          g.nextLit = G.torch.pointLit(nxt, true);
        }
      }
      const toP = new THREE.Vector3(pp.x - g.pos.x, 0, pp.z - g.pos.z);
      const facing = new THREE.Vector3(Math.sin(g.yaw), 0, Math.cos(g.yaw));
      const inFov = toP.lengthSq() < 0.01 || facing.dot(toP.clone().normalize()) > Math.cos((55 * Math.PI) / 180);
      let noise: Perception['noise'] = null;
      for (const n of noises) {
        const nd = Math.hypot(n.pos[0] - g.pos.x, n.pos[1] - g.pos.y, n.pos[2] - g.pos.z);
        if (!noise || n.loudness / Math.max(1, nd) > noise.loudness / Math.max(1, noise.dist)) noise = { pos: n.pos, loudness: n.loudness, dist: nd };
      }
      const perc: Perception = {
        awake, playerPos: [pp.x, pp.y, pp.z], playerDist: Math.hypot(pp.x - g.pos.x, (G.player.feetY - g.pos.y) * 1.5, pp.z - g.pos.z),
        los: g.los, inFov, torchRadius: G.torch.visibleRadius, noise, playerLit: g.playerLit, nextStepLit: g.nextLit,
      };
      const prevState = g.mind.state;
      const { mind, intent } = step(g.spec, g.mind, perc, dt, [g.sweepGoal.x, g.sweepGoal.y, g.sweepGoal.z] as V3);
      g.mind = mind;
      if (intent.caught && G.running) { G.kill(`Caught by a ${g.name}.`); return; }
      if (mind.state !== prevState) this.onState(g, prevState, mind.state);

      // Movement
      if (intent.moveTo) {
        const target = new THREE.Vector3(...intent.moveTo);
        g.repathT -= dt;
        if (!g.path || g.repathT <= 0 || !g.pathTarget || g.pathTarget.distanceTo(target) > 2.5) {
          g.repathT = mind.state === 'CHASE' ? 0.4 : 1.5;
          g.path = G.nav.findPath(g.pos, target, mind.state === 'CHASE' ? 8000 : 15000);
          g.pathIdx = 0;
          g.pathTarget = target.clone();
          if (g.path && g.path.length > 1) g.pathIdx = 1;
        }
        const reached = this.follow(g, intent.speed, dt);
        if (reached) {
          g.mind = arrived(g.spec, g.mind);
          if (g.mind.state === 'SWEEP' && g.pos.distanceTo(g.sweepGoal) < 4) {
            // Patrol near the door: pick a random nearby point
            g.sweepGoal = new THREE.Vector3(g.sweepGoal.x + (Math.random() - 0.5) * 16, g.sweepGoal.y, -180 - Math.random() * 30);
          }
        }
      } else if (mind.state === 'STALK' || mind.state === 'CHASE') {
        g.yaw = Math.atan2(pp.x - g.pos.x, pp.z - g.pos.z);
      }

      // Animation
      this.animate(g, dt, intent.moveTo ? intent.speed : 0);
      const pd = g.pos.distanceTo(pp);
      if (mind.state !== 'DORMANT' && mind.state !== 'WAKING') this.nearest = Math.min(this.nearest, pd);
      g.mesh.visible = pd < 70;
      // Footsteps
      g.stepT -= dt * (intent.moveTo ? intent.speed : 0);
      if (g.stepT <= 0 && pd < 30) { g.stepT = g.kind === 'sentinel' ? 1.6 : 0.5; G.audio.guardianStep(g.kind, g.pos); }
      g.callT -= dt;
      if (g.callT <= 0 && mind.state !== 'DORMANT' && pd < 45) { g.callT = 6 + Math.random() * 8; G.audio.guardianCall(g.kind, g.pos); }
    }
  }

  private onState(g: Guardian, from: string, to: string) {
    if (to === 'WAKING') { G.audio.guardianCall(g.kind, g.pos); g.callT = 3; }
    if (to === 'CHASE' && from !== 'CHASE') { G.audio.guardianCall(g.kind, g.pos); g.callT = 4; }
  }

  /** Move along the path. Returns true when the final waypoint is reached. */
  private follow(g: Guardian, speed: number, dt: number): boolean {
    if (!g.path || g.path.length === 0) {
      // No route: shuffle toward the target directly if close
      if (g.pathTarget && g.pos.distanceTo(g.pathTarget) < 3) {
        const d = g.pathTarget.clone().sub(g.pos).setY(0);
        if (d.length() > 0.2) { d.normalize(); g.pos.addScaledVector(d, speed * dt); g.yaw = Math.atan2(d.x, d.z); }
      }
      return false;
    }
    let budget = speed * dt;
    while (budget > 0 && g.pathIdx < g.path.length) {
      const wp = g.path[g.pathIdx];
      const d = new THREE.Vector3(wp.x - g.pos.x, 0, wp.z - g.pos.z);
      const len = d.length();
      if (len <= budget) {
        g.pos.x = wp.x; g.pos.z = wp.z; g.pos.y += (wp.y - g.pos.y) * 0.5;
        budget -= len;
        g.pathIdx++;
      } else {
        d.multiplyScalar(1 / len);
        g.pos.x += d.x * budget; g.pos.z += d.z * budget;
        const targetYaw = Math.atan2(d.x, d.z);
        let dy = targetYaw - g.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        g.yaw += dy * Math.min(1, dt * 8);
        budget = 0;
      }
    }
    const h = G.nav.heightAt(g.pos);
    if (h !== null) g.pos.y += (h - g.pos.y) * Math.min(1, dt * 10);
    return g.pathIdx >= g.path.length;
  }

  private animate(g: Guardian, dt: number, speed: number) {
    g.anim += dt * (0.5 + speed * 1.6);
    const m = g.mesh;
    m.position.copy(g.pos);
    m.rotation.y = g.yaw;
    const dormant = g.mind.state === 'DORMANT';
    const waking = g.mind.state === 'WAKING';
    if (g.kind === 'sentinel') {
      const sw = dormant ? 0 : Math.sin(g.anim * 1.6) * Math.min(0.6, speed * 0.25);
      m.getObjectByName('legL')!.rotation.x = sw; m.getObjectByName('legR')!.rotation.x = -sw;
      m.getObjectByName('armL')!.rotation.x = -sw + (g.mind.state === 'CHASE' ? -1.2 : 0); m.getObjectByName('armR')!.rotation.x = sw + (g.mind.state === 'CHASE' ? -1.2 : 0);
      if (waking) m.position.x += (Math.random() - 0.5) * 0.05;
    } else if (g.kind === 'crawler') {
      for (let i = 0; i < 6; i++) { const l = m.getObjectByName('leg' + i)!; l.rotation.x = dormant ? 0 : Math.sin(g.anim * 6 + i * 1.7) * 0.5; }
      m.position.y += dormant ? -0.2 : Math.abs(Math.sin(g.anim * 6)) * 0.05;
    } else {
      m.position.y += dormant ? 0 : 0.15 + Math.sin(g.anim) * 0.1;
      const a = g.mind.state === 'CHASE' ? -1.6 : -0.9;
      m.getObjectByName('armL')!.rotation.x = a + Math.sin(g.anim * 2) * 0.1; m.getObjectByName('armR')!.rotation.x = a - Math.sin(g.anim * 2) * 0.1;
      m.scale.setScalar(dormant ? 0.01 : waking ? 1 - g.mind.timer / g.spec.wakeDuration : 1);
    }
  }
}
