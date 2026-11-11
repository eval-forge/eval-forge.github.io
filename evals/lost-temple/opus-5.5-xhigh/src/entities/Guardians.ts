/**
 * Guardian bodies: statues by day, hunters after dark. Each frame: perception (line of
 * sight raycasts, light levels, noises) → brain (logic/guardians) → navmesh path follow.
 * They live on the global navmesh, independent of scene streaming.
 */
import * as THREE from 'three';
import { RAPIER, Owner, G_GUARDIAN, Q_SOLID } from '../engine/physics';
import { surface, tinted, setExposure } from '../engine/materials';
import { exposureAt } from '../world/query';
import { GUARDIAN_SPAWNS, DOOR } from '../world/layout';
import { makeBrain, wavesDue, SPAWN_WAVES, TUNING, type Brain, type GuardianKind, type NoiseEvent, type Intent } from '../logic/guardians';
import { gateOpen, type GateId } from '../logic/unlocks';
import { DAY_SECONDS } from '../logic/clock';
import type { NavMesh, Vec3 } from '../logic/navmesh';
import type { Game } from '../game/Game';

interface Guardian {
  id: number;
  kind: GuardianKind;
  brain: Brain;
  root: THREE.Group;
  parts: { legs: THREE.Object3D[]; arms: THREE.Object3D[]; body: THREE.Object3D };
  body: RAPIER.RigidBody;
  pos: THREE.Vector3; // feet
  facing: THREE.Vector2;
  path: Vec3[];
  pathTarget: Vec3 | null;
  repathT: number;
  walk: number;
  callT: number;
  expT: number;
  intent: Intent | null;
  height: number;
  wave: number;
  stuckT: number;
}

const stone = (exp: 'outdoor' | 'ruins' | 'dungeon') => surface('templeWall', exp);

function buildSentinel(): Guardian['parts'] & { root: THREE.Group; height: number } {
  const root = new THREE.Group();
  const mat = stone('ruins');
  const dark = tinted(0x4a4238, 'ruins', 0.9);
  const eyes = tinted(0xd8b040, 'ruins', 0.15, 1);
  const body = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 0.65), mat);
  torso.position.y = 1.75;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.2, 0.7), dark);
  belt.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.6, 0.58), mat);
  head.position.y = 2.55;
  const crest = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.6, 4), dark);
  crest.position.set(0, 3.0, -0.05);
  crest.rotation.y = Math.PI / 4;
  const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), eyes);
  e1.position.set(-0.15, 2.6, -0.3);
  const e2 = e1.clone();
  e2.position.x = 0.15;
  body.add(torso, belt, head, crest, e1, e2);
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.3, 1.15, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.15, 0.42), mat);
    leg.position.y = -0.57;
    pivot.add(leg);
    legs.push(pivot);
    root.add(pivot);
  }
  const arms: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.72, 2.15, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, 0.32), mat);
    arm.position.y = -0.5;
    pivot.add(arm);
    if (sx > 0) {
      const club = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.2, 0.22), dark);
      club.position.set(0, -1.2, -0.3);
      club.rotation.x = 0.6;
      pivot.add(club);
    }
    arms.push(pivot);
    body.add(pivot);
  }
  root.add(body);
  return { root, legs, arms, body, height: 3.1 };
}

function buildCrawler(): Guardian['parts'] & { root: THREE.Group; height: number } {
  const root = new THREE.Group();
  const mat = tinted(0x3c3428, 'ruins', 0.7, 0.1);
  const bone = surface('bone', 'ruins');
  const body = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.0, 4, 8), mat);
  torso.rotation.x = Math.PI / 2;
  torso.position.y = 0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), bone);
  head.scale.set(1, 0.7, 1.2);
  head.position.set(0, 0.6, -0.85);
  const m1 = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 4), bone);
  m1.rotation.x = -Math.PI / 2;
  m1.position.set(-0.12, 0.5, -1.15);
  const m2 = m1.clone();
  m2.position.x = 0.12;
  for (let i = 0; i < 5; i++) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.22), bone);
    plate.position.set(0, 0.88, -0.4 + i * 0.22);
    body.add(plate);
  }
  body.add(torso, head, m1, m2);
  const legs: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.3, 0.55, -0.45 + i * 0.45);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 0.07), mat);
      upper.position.x = sx * 0.3;
      upper.rotation.z = sx * 0.5;
      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.6, 0.07), bone);
      lower.position.set(sx * 0.62, -0.3, 0);
      pivot.add(upper, lower);
      legs.push(pivot);
      body.add(pivot);
    }
  }
  root.add(body);
  return { root, legs, arms: [], body, height: 1.1 };
}

function buildShade(): Guardian['parts'] & { root: THREE.Group; height: number } {
  const root = new THREE.Group();
  const cloth = tinted(0x0c0a10, 'ruins', 1, 0, { transparent: true, opacity: 0.88 });
  const glint = tinted(0xe0e0e8, 'ruins', 0.05, 1);
  const body = new THREE.Group();
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.3, 9, 1, true), cloth);
  robe.position.y = 1.25;
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.65), cloth);
  hood.position.y = 2.35;
  const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), glint);
  e1.position.set(-0.09, 2.3, -0.24);
  const e2 = e1.clone();
  e2.position.x = 0.09;
  body.add(robe, hood, e1, e2);
  const arms: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.32, 2.0, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 1.4, 5), cloth);
    arm.position.y = -0.7;
    pivot.add(arm);
    arms.push(pivot);
    body.add(pivot);
  }
  root.add(body);
  return { root, legs: [], arms, body, height: 2.5 };
}

export class Guardians {
  list: Guardian[] = [];
  noises: NoiseEvent[] = [];
  owner: Owner;
  group = new THREE.Group();
  private prevAfterDark = -Infinity;
  private heartT = 0;

  constructor(private game: Game, private nav: NavMesh) {
    this.owner = new Owner(game.physics, 'guardians');
    game.scene.add(this.group);
  }

  /** Place every guardian as a dormant statue. */
  reset() {
    this.clear();
    let id = 0;
    SPAWN_WAVES.forEach((wave, wi) => {
      const spots = GUARDIAN_SPAWNS[wave.scene];
      wave.kinds.forEach((kind, i) => {
        const s = spots[i % spots.length];
        const built = kind === 'sentinel' ? buildSentinel() : kind === 'crawler' ? buildCrawler() : buildShade();
        const sweep: Vec3 = { x: DOOR.inside.x, y: DOOR.inside.y, z: DOOR.inside.z - 2 };
        const brain = makeBrain(kind, sweep, this.game.run.rng);
        const r = kind === 'crawler' ? 0.55 : 0.5;
        const hh = Math.max(0.05, built.height / 2 - r);
        const body = this.owner.body(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(s.x, s.y + built.height / 2, s.z));
        this.owner.collider(RAPIER.ColliderDesc.capsule(hh, r).setCollisionGroups(G_GUARDIAN), body, { kind: 'guardian' });
        built.root.position.set(s.x, s.y, s.z);
        // face the door-ish direction
        const yaw = Math.atan2(-(DOOR.x - s.x), -(DOOR.z - s.z));
        built.root.rotation.y = yaw;
        this.group.add(built.root);
        const exp = exposureAt(s.x, s.y + 0.5, s.z);
        setExposure(built.root, exp);
        this.list.push({
          id: id++,
          kind,
          brain,
          root: built.root,
          parts: { legs: built.legs, arms: built.arms, body: built.body },
          body,
          pos: new THREE.Vector3(s.x, s.y, s.z),
          facing: new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw)),
          path: [],
          pathTarget: null,
          repathT: 0,
          walk: 0,
          callT: 0,
          expT: 0,
          intent: null,
          height: built.height,
          wave: wi,
          stuckT: 0,
        });
      });
    });
    this.prevAfterDark = -Infinity;
  }

  clear() {
    for (const g of this.list) this.group.remove(g.root);
    this.list = [];
    this.owner.dispose();
    this.noises = [];
    this.game.audio.setHeartbeat(0, 0);
  }

  noise(n: NoiseEvent) {
    this.noises.push(n);
    if (this.noises.length > 32) this.noises.shift();
  }

  awakeCount() {
    return this.list.filter((g) => g.brain.state !== 'dormant').length;
  }

  /** Called every frame with the clock: wake waves as darkness deepens. */
  checkWaves(elapsed: number) {
    const after = elapsed - DAY_SECONDS;
    // first call after dark (possibly after a time skip): everything due so far fires
    const prev = this.prevAfterDark === -Infinity ? -0.0001 : this.prevAfterDark;
    if (after >= 0) {
      for (const w of wavesDue(prev, after)) {
        const wi = SPAWN_WAVES.indexOf(w);
        for (const g of this.list) {
          if (g.wave !== wi) continue;
          g.brain.wake(Math.random() * 1.5);
          this.game.audio.stoneGrind(g.pos, 2.5, 0.5);
          this.game.fx.dust(g.pos.clone().add(new THREE.Vector3(0, g.height * 0.6, 0)), 1.2);
        }
        if (wi === 0) this.game.toast('Deep below, stone grinds against stone. The guardians wake.', 'danger');
      }
    }
    this.prevAfterDark = after;
  }

  fixedUpdate(dt: number) {
    const game = this.game;
    const pl = game.player;
    const flags = game.run.flags;
    const isOpen = (gate: string) => gateOpen(gate as GateId, flags);
    const playerFeet = pl.feet();
    const chest = new THREE.Vector3(pl.pos.x, pl.feetY + pl.height * 0.7, pl.pos.z);
    const torchLit = game.run.torch.lit;
    const outdoorLight = game.exposure === 'outdoor' ? (game.sky.sunUp ? 1 : 0.25) : game.exposure === 'ruins' && game.sky.sunUp ? 0.6 : 0;
    const playerLight = Math.max(outdoorLight, game.torch.lightAt(chest), torchLit ? 1 : 0);
    const noises = this.noises;
    this.noises = [];
    let nearest = Infinity;
    for (const g of this.list) {
      if (g.brain.state === 'dormant') continue;
      const d = g.pos.distanceTo(playerFeet);
      let los = false;
      if (d < 45 && !pl.dead) {
        const eye = g.pos.clone().add(new THREE.Vector3(0, g.height * 0.85, 0));
        los = game.physics.clearLine(eye, chest, Q_SOLID);
      }
      const selfLight = game.torch.lightAt(g.pos.clone().add(new THREE.Vector3(0, 1, 0)));
      const arrived = g.pathTarget ? Math.hypot(g.pathTarget.x - g.pos.x, g.pathTarget.z - g.pos.z) < 1.0 : true;
      const intent = g.brain.update({
        dt,
        self: { x: g.pos.x, y: g.pos.y, z: g.pos.z },
        facing: { x: g.facing.x, z: g.facing.y },
        player: { x: playerFeet.x, y: playerFeet.y, z: playerFeet.z },
        los,
        playerTorchLit: torchLit,
        playerLight,
        lightAtSelf: selfLight,
        noises,
        arrived,
      });
      g.intent = intent;
      if (intent.call && g.callT <= 0) {
        g.callT = 4 + Math.random() * 3;
        const at = g.pos.clone().add(new THREE.Vector3(0, g.height * 0.8, 0));
        if (intent.call === 'roar') game.audio.roar(at);
        else if (intent.call === 'screech') game.audio.screech(at);
        else if (intent.call === 'whisper') game.audio.whisper(at);
        else game.audio.stoneGrind(at, 1.5, 0.4);
      }
      g.callT -= dt;
      this.move(g, intent, dt, isOpen);
      if (intent.attack && g.pos.distanceTo(playerFeet) <= TUNING[g.kind].catchRadius + 0.3 && !pl.dead) {
        game.caught(g.kind);
      }
      nearest = Math.min(nearest, d);
    }
    // heartbeat near guardians
    this.heartT -= dt;
    if (this.heartT <= 0) {
      this.heartT = 0.25;
      if (nearest < 28) {
        const k = 1 - nearest / 28;
        game.audio.setHeartbeat(1.1 + k * 1.9, 0.25 + k * 0.75);
      } else game.audio.setHeartbeat(0, 0);
    }
  }

  private move(g: Guardian, intent: Intent, dt: number, isOpen: (gate: string) => boolean) {
    const game = this.game;
    if (!intent.moveTo || intent.speed <= 0) {
      g.walk *= 0.9;
      return;
    }
    g.repathT -= dt;
    const tgt = intent.moveTo;
    const moved = !g.pathTarget || Math.hypot(tgt.x - g.pathTarget.x, tgt.z - g.pathTarget.z) > 1.5;
    if (g.repathT <= 0 || moved || !g.path.length) {
      g.repathT = 0.7 + Math.random() * 0.3;
      let path = this.nav.findPath({ x: g.pos.x, y: g.pos.y, z: g.pos.z }, tgt, isOpen, 0.5);
      if (!path) {
        const cp = this.nav.closestPoint(tgt, 6);
        if (cp) path = this.nav.findPath({ x: g.pos.x, y: g.pos.y, z: g.pos.z }, cp.point, isOpen, 0.5);
      }
      g.path = path ?? [];
      g.pathTarget = { ...tgt };
    }
    if (!g.path.length) {
      g.walk *= 0.9;
      return;
    }
    const wp = g.path[0];
    const dx = wp.x - g.pos.x;
    const dz = wp.z - g.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35) {
      g.path.shift();
      return;
    }
    const step = Math.min(dist, intent.speed * dt);
    const nx = g.pos.x + (dx / dist) * step;
    const nz = g.pos.z + (dz / dist) * step;
    if (intent.avoidLight) {
      const lt = game.torch.lightAt(new THREE.Vector3(nx, g.pos.y + 1, nz));
      if (lt > 0.18) {
        // hover at the edge of the light
        g.walk *= 0.9;
        return;
      }
    }
    const ny = this.nav.heightAtPoint(nx, g.pos.y, nz);
    const prev = g.pos.clone();
    g.pos.set(nx, Number.isFinite(ny) ? ny : g.pos.y, nz);
    // turn toward travel direction
    const want = new THREE.Vector2(dx / dist, dz / dist);
    g.facing.lerp(want, Math.min(1, dt * 6)).normalize();
    g.walk += step * (g.kind === 'crawler' ? 5 : 2.6);
    if (prev.distanceTo(g.pos) < 1e-3) g.stuckT += dt;
    else g.stuckT = 0;
    g.body.setNextKinematicTranslation({ x: g.pos.x, y: g.pos.y + g.height / 2, z: g.pos.z });
  }

  update(dt: number, time: number) {
    for (const g of this.list) {
      g.root.position.copy(g.pos);
      g.root.rotation.y = Math.atan2(-g.facing.x, -g.facing.y);
      const st = g.brain.state;
      const active = st !== 'dormant';
      const sw = Math.sin(g.walk);
      if (g.kind === 'sentinel') {
        g.parts.legs[0].rotation.x = sw * 0.45;
        g.parts.legs[1].rotation.x = -sw * 0.45;
        g.parts.arms[0].rotation.x = -sw * 0.35;
        g.parts.arms[1].rotation.x = st === 'chase' ? -1.2 + Math.sin(time * 6) * 0.4 : sw * 0.35;
        g.parts.body.position.y = Math.abs(Math.cos(g.walk)) * 0.06;
      } else if (g.kind === 'crawler') {
        g.parts.legs.forEach((l, i) => {
          l.rotation.y = Math.sin(g.walk + i * 1.7) * 0.5;
          l.rotation.z = Math.max(0, Math.cos(g.walk + i * 1.7)) * 0.3 * (i % 2 ? 1 : -1);
        });
        g.parts.body.position.y = Math.abs(Math.sin(g.walk * 2)) * 0.04;
      } else {
        g.parts.body.position.y = active ? 0.25 + Math.sin(time * 1.7 + g.id) * 0.12 : 0;
        g.parts.arms.forEach((a, i) => (a.rotation.x = (st === 'lunge' ? -1.3 : -0.2) + Math.sin(time * 2 + i) * 0.15));
        g.parts.body.rotation.z = Math.sin(time * 1.1 + g.id) * 0.05;
      }
      g.expT -= dt;
      if (g.expT <= 0) {
        g.expT = 0.5;
        setExposure(g.root, exposureAt(g.pos.x, g.pos.y + 0.5, g.pos.z));
      }
    }
  }

  debugStates(): string {
    return this.list.map((g) => `${g.kind[0].toUpperCase()}:${g.brain.state}`).join(' ');
  }
}
