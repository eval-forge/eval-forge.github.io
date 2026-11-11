/**
 * Loot and props as Rapier rigid bodies with their real mass. Items exist physically only
 * while their scene is loaded; their transform is written back to the RunState when the
 * scene streams out. Also: the satchel (E), hands (F grab, LMB throw), dropping (Q) and
 * the weight-swap on trapped pedestals.
 */
import * as THREE from 'three';
import { RAPIER, Owner, G_DYNAMIC, G_HELD } from '../engine/physics';
import { relicMesh, propMesh, halfExtents } from './meshes';
import { setExposure } from '../engine/materials';
import { exposureAt } from '../world/query';
import { sceneAt } from '../world/layout';
import { RELIC_BY_ID, handsSpeedMultiplier } from '../logic/economy';
import type { ItemState, ItemKind } from '../game/RunState';
import type { Game } from '../game/Game';
import type { SceneId } from '../logic/unlocks';

export interface LiveItem {
  st: ItemState;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  half: THREE.Vector3;
  prevSpeed: number;
  checkT: number;
  thrownT: number;
}

const PEDESTAL_DROP = 0.15; // slot y is this far above the pedestal top

export function itemLabel(st: ItemState): string {
  switch (st.kind) {
    case 'relic': {
      const d = RELIC_BY_ID[st.relic!.defId];
      return `${d.name}  ·  $${st.relic!.value}  ·  ${st.weight.toFixed(1)} kg`;
    }
    case 'sandbag':
      return `Sandbag  ·  ${st.weight.toFixed(1)} kg`;
    case 'rock':
      return `Rock  ·  ${st.weight.toFixed(1)} kg`;
    case 'pot':
      return `Clay pot  ·  ${st.weight.toFixed(1)} kg`;
    case 'oil':
      return 'Oil flask (+90 s of torch fuel)';
    case 'spareTorch':
      return 'Spare torch';
    case 'boneKey':
      return 'The Bone Key';
    case 'sunDisc':
      return 'The Sun Disc';
    default:
      return 'Rubble';
  }
}

export class Items {
  live = new Map<string, LiveItem>();
  owner: Owner;
  group = new THREE.Group();
  private tmp = new THREE.Vector3();

  constructor(private game: Game) {
    this.owner = new Owner(game.physics, 'items');
    game.scene.add(this.group);
  }

  get held(): LiveItem | null {
    const uid = this.game.run.handUid;
    return uid ? this.live.get(uid) ?? null : null;
  }

  handWeight(): number {
    return this.held ? this.held.st.weight : 0;
  }

  handSpeedMult(): number {
    return handsSpeedMultiplier(this.handWeight());
  }

  // ------------------------------------------------------------ streaming

  loadScene(id: SceneId) {
    for (const st of this.game.run.items.values()) {
      if (st.gone || st.scene !== id || this.live.has(st.uid)) continue;
      this.spawn(st);
    }
  }

  unloadScene(id: SceneId) {
    for (const li of [...this.live.values()]) {
      if (li.st.scene === id && li.st.uid !== this.game.run.handUid) this.despawn(li, true);
    }
  }

  clear() {
    for (const li of [...this.live.values()]) this.despawn(li, false);
    this.owner.dispose();
  }

  spawn(st: ItemState): LiveItem {
    const exp = exposureAt(st.pos[0], st.pos[1], st.pos[2]);
    const mesh = st.kind === 'relic' ? relicMesh(st.relic!.defId, exp) : propMesh(st.kind, exp);
    mesh.userData.exposure = exp;
    const half = halfExtents(mesh);
    // pedestal relics rest exactly on the pedestal top the first time they spawn
    if (st.pedestal && !st.uid.startsWith('drop')) {
      const slotY = (st as any).slotY ?? st.pos[1];
      (st as any).slotY = slotY;
      st.pos[1] = slotY - PEDESTAL_DROP + half.y + 0.005;
    }
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(st.pos[0], st.pos[1], st.pos[2])
      .setRotation({ x: st.quat[0], y: st.quat[1], z: st.quat[2], w: st.quat[3] })
      .setLinearDamping(0.15)
      .setAngularDamping(0.6)
      .setCcdEnabled(st.weight < 3);
    const body = this.owner.body(desc);
    const cd = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setMass(Math.max(0.2, st.weight))
      .setFriction(0.8)
      .setRestitution(0.08)
      .setCollisionGroups(G_DYNAMIC);
    const collider = this.owner.collider(cd, body, { kind: 'item', ref: st.uid, surface: 'stone' });
    if (st.pedestal || st.kind === 'relic') body.sleep();
    mesh.position.set(st.pos[0], st.pos[1], st.pos[2]);
    mesh.quaternion.set(st.quat[0], st.quat[1], st.quat[2], st.quat[3]);
    this.group.add(mesh);
    const li: LiveItem = { st, body, collider, mesh, half, prevSpeed: 0, checkT: Math.random() * 0.5, thrownT: 0 };
    this.live.set(st.uid, li);
    return li;
  }

  private save(li: LiveItem) {
    const p = li.body.translation();
    const q = li.body.rotation();
    li.st.pos = [p.x, p.y, p.z];
    li.st.quat = [q.x, q.y, q.z, q.w];
  }

  despawn(li: LiveItem, save: boolean) {
    if (save) this.save(li);
    this.owner.removeBody(li.body);
    this.group.remove(li.mesh);
    this.live.delete(li.st.uid);
  }

  /** Remove from the world (into the satchel, consumed, stashed). */
  private take(li: LiveItem) {
    if (this.game.run.handUid === li.st.uid) this.game.run.handUid = null;
    this.despawn(li, true);
    li.st.gone = true;
  }

  // ------------------------------------------------------------ pedestal lifting

  private liftFromPedestal(li: LiveItem, extraLoad = 0, excludeHandles: number[] = []) {
    const ped = li.st.pedestal;
    if (!ped) return;
    li.st.pedestal = undefined;
    const slotY = (li.st as any).slotY ?? li.st.pos[1];
    const top = slotY - PEDESTAL_DROP;
    const ex = new Set<number>([li.body.handle, ...excludeHandles]);
    const { mass } = this.game.physics.massInBox(new THREE.Vector3(li.st.pos[0], top + 0.3, li.st.pos[2]), new THREE.Vector3(0.5, 0.28, 0.5), ex);
    this.game.onPedestalLift(ped, li.st.weight, mass + extraLoad);
  }

  // ------------------------------------------------------------ player actions

  /** E on an item. */
  interact(uid: string) {
    const g = this.game;
    const run = g.run;
    const li = this.live.get(uid);
    if (!li) return;
    const st = li.st;
    switch (st.kind) {
      case 'oil':
        run.oil++;
        g.audio.pickup();
        g.toast('Oil flask (R to refuel the torch)');
        this.take(li);
        return;
      case 'spareTorch':
        run.spares++;
        g.audio.pickup();
        g.toast('Spare torch (T relights with a fresh one when yours burns out; E on a sconce to mount it)');
        this.take(li);
        return;
      case 'boneKey':
        run.flags.hasBoneKey = true;
        g.audio.pickup();
        g.toast('You found the Bone Key. It must open something deep below.', 'good');
        this.take(li);
        return;
      case 'sunDisc':
        run.flags.hasSunDisc = true;
        g.audio.pickup();
        g.toast('The Sun Disc. A round recess in the halls must want it.', 'good');
        this.take(li);
        return;
      case 'relic': {
        const held = this.held;
        // weight swap: put what's in your hands on the pedestal in one motion
        if (st.pedestal && held && held !== li) {
          this.swap(li, held);
          return;
        }
        if (!run.satchel.canAdd(st.relic!)) {
          g.audio.denied();
          const free = Math.max(0, run.satchel.capacity - run.satchel.weight());
          g.toast(`Too heavy for the satchel (${free.toFixed(1)} kg free). Grab it with F and carry it out in your hands.`, 'warn');
          return;
        }
        if (st.pedestal) this.liftFromPedestal(li);
        run.satchel.add(st.relic!);
        this.noteFound(st);
        g.audio.pickup();
        g.toast(`${RELIC_BY_ID[st.relic!.defId].name}  +$${st.relic!.value}`, 'good');
        this.take(li);
        return;
      }
      default:
        // heavy props: E behaves like grab
        this.grab(uid);
    }
  }

  private noteFound(st: ItemState) {
    if (!(st as any).found) {
      (st as any).found = true;
      this.game.run.relicsFound++;
    }
  }

  private swap(relic: LiveItem, held: LiveItem) {
    const g = this.game;
    const slotY = (relic.st as any).slotY ?? relic.st.pos[1];
    const top = slotY - PEDESTAL_DROP;
    const p = relic.body.translation();
    // release the held object onto the pedestal
    this.releaseHeld(false);
    held.body.setTranslation({ x: p.x, y: top + held.half.y + 0.02, z: p.z }, true);
    held.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    held.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    held.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.liftFromPedestal(relic, held.st.weight, [held.body.handle]);
    g.audio.thud(p, 0.3);
    if (g.run.satchel.canAdd(relic.st.relic!)) {
      g.run.satchel.add(relic.st.relic!);
      this.noteFound(relic.st);
      g.toast(`Swapped. ${RELIC_BY_ID[relic.st.relic!.defId].name}  +$${relic.st.relic!.value}`, 'good');
      this.take(relic);
    } else {
      this.noteFound(relic.st);
      this.grab(relic.st.uid);
      g.toast('Swapped. Too heavy for the satchel: carrying it in your hands.', 'good');
    }
  }

  /** F: grab into hands (or release if already holding). */
  grab(uid: string | null) {
    const g = this.game;
    if (this.held) {
      this.releaseHeld(true);
      return;
    }
    if (!uid) return;
    const li = this.live.get(uid);
    if (!li) return;
    if (li.st.kind === 'oil' || li.st.kind === 'spareTorch' || li.st.kind === 'boneKey' || li.st.kind === 'sunDisc') {
      this.interact(uid);
      return;
    }
    if (li.st.weight > 30) {
      g.toast('Far too heavy to lift.', 'warn');
      return;
    }
    if (li.st.pedestal) this.liftFromPedestal(li);
    if (li.st.kind === 'relic') this.noteFound(li.st);
    g.run.handUid = uid;
    li.body.wakeUp();
    li.body.setGravityScale(0, true);
    li.collider.setCollisionGroups(G_HELD);
    li.body.setAngularDamping(4);
    g.audio.pickup();
  }

  releaseHeld(keepMomentum: boolean) {
    const li = this.held;
    if (!li) return;
    this.game.run.handUid = null;
    li.body.setGravityScale(1, true);
    li.collider.setCollisionGroups(G_DYNAMIC);
    li.body.setAngularDamping(0.6);
    if (!keepMomentum) {
      li.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** LMB: throw what's in the hands. */
  throwHeld() {
    const li = this.held;
    if (!li) return;
    const g = this.game;
    const dir = g.player.lookDir();
    this.releaseHeld(false);
    const speed = Math.min(15, 26 / Math.sqrt(li.st.weight + 0.8));
    const pv = g.player.vel;
    li.body.setLinvel({ x: dir.x * speed + pv.x * 0.5, y: dir.y * speed + 1.5, z: dir.z * speed + pv.z * 0.5 }, true);
    li.body.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 }, true);
    li.thrownT = 3;
    g.audio.bladeWhoosh(li.body.translation());
  }

  /** Q: drop the last relic from the satchel in front of you. */
  dropFromSatchel() {
    const g = this.game;
    const r = g.run.satchel.removeLast();
    if (!r) {
      g.toast('The satchel is empty.');
      return;
    }
    const st = g.run.items.get(r.uid);
    const eye = g.player.eye();
    const f = g.player.lookDir();
    const pos: [number, number, number] = [eye.x + f.x * 0.7, eye.y - 0.3, eye.z + f.z * 0.7];
    let item: ItemState;
    if (st) {
      st.gone = false;
      st.pos = pos;
      st.quat = [0, 0, 0, 1];
      st.pedestal = undefined;
      st.scene = sceneAt(pos[0], pos[1], pos[2]) ?? g.scenes.current;
      item = st;
    } else {
      item = g.run.addItem({ uid: r.uid, kind: 'relic', relic: r, weight: r.weight, scene: g.scenes.current, pos, quat: [0, 0, 0, 1] });
    }
    const li = this.spawn(item);
    li.body.wakeUp();
    li.body.setLinvel({ x: f.x * 2, y: 0.5, z: f.z * 2 }, true);
    g.toast(`Dropped ${RELIC_BY_ID[r.defId].name} (−${r.weight.toFixed(1)} kg)`);
  }

  /** Spawn a fresh item in the world (Sun Disc, dropped things...). */
  create(kind: ItemKind, uid: string, pos: THREE.Vector3, weight: number): LiveItem {
    const st = this.game.run.addItem({ uid, kind, weight, scene: sceneAt(pos.x, pos.y, pos.z) ?? this.game.scenes.current, pos: [pos.x, pos.y, pos.z], quat: [0, 0, 0, 1] });
    return this.spawn(st);
  }

  /** Stash everything carried (called at the camp). Returns the value secured. */
  stashCarried(): { n: number; value: number } {
    const run = this.game.run;
    let n = 0;
    let value = 0;
    for (const r of run.satchel.clear()) {
      run.stash.push(r);
      n++;
      value += r.value;
    }
    const h = this.held;
    if (h && h.st.kind === 'relic') {
      run.stash.push(h.st.relic!);
      n++;
      value += h.st.relic!.value;
      this.take(h);
    }
    return { n, value };
  }

  // ------------------------------------------------------------ simulation

  fixedUpdate(dt: number) {
    const g = this.game;
    const held = this.held;
    if (held) {
      const eye = g.player.eye(this.tmp);
      const dir = g.player.lookDir();
      const dist = 1.15 + Math.min(0.6, held.half.length());
      const target = eye.clone().addScaledVector(dir, dist);
      target.y -= 0.18;
      const p = held.body.translation();
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const dz = target.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 2.6) {
        this.releaseHeld(false);
      } else {
        const k = 14 / Math.max(1, Math.sqrt(held.st.weight) * 0.6);
        let vx = dx * k;
        let vy = dy * k;
        let vz = dz * k;
        const vl = Math.hypot(vx, vy, vz);
        if (vl > 14) {
          vx *= 14 / vl;
          vy *= 14 / vl;
          vz *= 14 / vl;
        }
        held.body.setLinvel({ x: vx, y: vy, z: vz }, true);
        const av = held.body.angvel();
        held.body.setAngvel({ x: av.x * 0.85, y: av.y * 0.85, z: av.z * 0.85 }, true);
      }
    }
    for (const li of this.live.values()) {
      if (li.body.isSleeping()) {
        li.prevSpeed = 0;
        continue;
      }
      const v = li.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (li.thrownT > 0) li.thrownT -= dt;
      const dv = li.prevSpeed - speed;
      if (dv > 3.5 && li !== held) this.impact(li, dv);
      li.prevSpeed = speed;
      const p = li.body.translation();
      if (p.y < -70) {
        // fell out of the world
        this.take(li);
        if (li.st.kind === 'relic') g.toast(`${RELIC_BY_ID[li.st.relic!.defId].name} is lost to the abyss.`, 'warn');
      }
    }
  }

  private impact(li: LiveItem, dv: number) {
    const g = this.game;
    const p = li.body.translation();
    const heavy = Math.min(1, li.st.weight / 8);
    const loud = Math.min(1, (dv / 12) * (0.5 + heavy * 0.8));
    if (li.st.kind === 'pot' && dv > 6) {
      g.audio.shatter(p);
      g.noise(p.x, p.y, p.z, Math.max(0.75, loud));
      g.fx.dust(new THREE.Vector3(p.x, p.y, p.z), 0.6, 0xa0583a);
      this.take(li);
      return;
    }
    const def = li.st.relic ? RELIC_BY_ID[li.st.relic.defId] : null;
    const metal = def && ['ring', 'chalice', 'ingot', 'eagle', 'scepter', 'jaguar', 'statue', 'idol'].includes(def.shape);
    if (metal) g.audio.clink(p, Math.min(0.8, loud + 0.1));
    else g.audio.thud(p, Math.min(0.9, loud + 0.1));
    if (loud > 0.12) g.noise(p.x, p.y, p.z, loud);
  }

  update(dt: number) {
    for (const li of this.live.values()) {
      const p = li.body.translation();
      const q = li.body.rotation();
      li.mesh.position.set(p.x, p.y, p.z);
      li.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      li.checkT -= dt;
      if (li.checkT <= 0) {
        li.checkT = 0.4;
        setExposure(li.mesh, exposureAt(p.x, p.y, p.z));
        const s = sceneAt(p.x, p.y, p.z);
        if (s && s !== li.st.scene) {
          li.st.scene = s;
          // moved into a scene that isn't loaded (shouldn't happen often): freeze it there
          if (!this.game.scenes.isLoaded(s) && li.st.uid !== this.game.run.handUid) this.despawn(li, true);
        }
      }
    }
  }
}
