import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G } from '../core/ctx';
import { R } from '../core/Physics';
import { RELIC_BY_ID, RelicType, Zone, relicValue } from '../logic/relics';
import { makeCarried, CarriedRelic } from '../logic/economy';
import { TrappedPedestal } from '../logic/traps';
import type { SceneChunk, Entity, Interactable } from '../world/SceneChunk';
import { materials } from '../world/textures';
import { PAD } from '../core/Input';

const relicMatCache = new Map<number, THREE.MeshStandardMaterial>();
function relicMat(color: number, metal = 0.6): THREE.MeshStandardMaterial {
  const k = color * 10 + Math.round(metal * 10);
  let m = relicMatCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: 0.35 }); relicMatCache.set(k, m); }
  return m;
}

/** Procedural relic model, roughly 20-50 cm. */
export function relicMesh(t: RelicType): THREE.Group {
  const g = new THREE.Group();
  const m = relicMat(t.color, ['gold', 'bronze'].some((x) => t.name.toLowerCase().includes(x)) || ['idol', 'ingot', 'bell', 'disc', 'key', 'crown', 'chalice'].includes(t.shape) ? 0.85 : 0.25);
  const add = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, mat: THREE.Material = m) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = true; g.add(mesh); return mesh;
  };
  switch (t.shape) {
    case 'figurine': add(new THREE.CylinderGeometry(0.06, 0.09, 0.22, 8), 0, 0.11); add(new THREE.SphereGeometry(0.065, 8, 6), 0, 0.27); break;
    case 'necklace': add(new THREE.TorusGeometry(0.11, 0.022, 6, 16), 0, 0.025, 0, Math.PI / 2); break;
    case 'bell': add(new THREE.CylinderGeometry(0.05, 0.13, 0.2, 12, 1, true), 0, 0.1); add(new THREE.SphereGeometry(0.05, 8, 6), 0, 0.22); break;
    case 'mask': add(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI), 0, 0.17, 0, 0, 0, 0); add(new THREE.BoxGeometry(0.05, 0.03, 0.03), -0.06, 0.2, 0.15, 0, 0, 0, relicMat(0x111111, 0)); add(new THREE.BoxGeometry(0.05, 0.03, 0.03), 0.06, 0.2, 0.15, 0, 0, 0, relicMat(0x111111, 0)); break;
    case 'dagger': add(new THREE.ConeGeometry(0.03, 0.28, 4), 0, 0.03, 0, 0, 0, Math.PI / 2); add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), -0.18, 0.03, 0, 0, 0, Math.PI / 2, relicMat(0x5a3a1e, 0)); break;
    case 'scroll': add(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 10), 0, 0.04, 0, 0, 0, Math.PI / 2); add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10), 0.16, 0.04, 0, 0, 0, Math.PI / 2, relicMat(0x7a4a22, 0)); break;
    case 'chalice': add(new THREE.CylinderGeometry(0.09, 0.03, 0.12, 12), 0, 0.22); add(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6), 0, 0.1); add(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12), 0, 0.01); break;
    case 'crown': {
      add(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 16, 1, true), 0, 0.04);
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; add(new THREE.ConeGeometry(0.02, 0.18, 4), Math.cos(a) * 0.13, 0.15, Math.sin(a) * 0.13, 0, 0, 0, relicMat([0x1a8a4a, 0xc02020, 0x2050c0][i % 3], 0)); }
      break;
    }
    case 'urn': add(new THREE.SphereGeometry(0.2, 12, 10), 0, 0.22); add(new THREE.CylinderGeometry(0.08, 0.12, 0.12, 12), 0, 0.44); for (let i = 0; i < 5; i++) add(new THREE.OctahedronGeometry(0.035), Math.cos(i * 1.3) * 0.2, 0.24, Math.sin(i * 1.3) * 0.2, 0, 0, 0, relicMat([0xe02040, 0x20e080, 0x4060ff][i % 3], 0.2)); break;
    case 'scarab': add(new THREE.SphereGeometry(0.09, 10, 8), 0, 0.05).scale.set(1, 0.6, 1.4); break;
    case 'ingot': add(new THREE.BoxGeometry(0.3, 0.1, 0.14), 0, 0.05); break;
    case 'skull': add(new THREE.SphereGeometry(0.13, 12, 10), 0, 0.15); add(new THREE.BoxGeometry(0.14, 0.08, 0.12), 0, 0.05, 0.04); break;
    case 'gem': add(new THREE.OctahedronGeometry(0.1), 0, 0.12).scale.set(1, 1.4, 1); break;
    case 'idol': add(new THREE.CylinderGeometry(0.11, 0.14, 0.3, 10), 0, 0.15); add(new THREE.SphereGeometry(0.12, 12, 10), 0, 0.38); add(new THREE.BoxGeometry(0.34, 0.06, 0.08), 0, 0.22); break;
    case 'disc': add(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 24), 0, 0.2, 0, Math.PI / 2); for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; add(new THREE.ConeGeometry(0.03, 0.08, 4), Math.cos(a) * 0.24, 0.2 + Math.sin(a) * 0.24, 0, 0, 0, a - Math.PI / 2); } break;
    case 'key': add(new THREE.TorusGeometry(0.06, 0.018, 6, 12), -0.12, 0.03, 0, Math.PI / 2); add(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 6), 0.03, 0.03, 0, 0, 0, Math.PI / 2); add(new THREE.BoxGeometry(0.04, 0.02, 0.06), 0.12, 0.03, 0.03); break;
  }
  return g;
}

/** A relic lying in the world at a fixed spot. Take it with E. */
export class RelicSpot implements Entity {
  mesh: THREE.Group;
  taken = false;
  type: RelicType;
  value: number;
  onTake?: () => void;
  interact: Interactable;
  constructor(public chunk: SceneChunk, typeId: string, public zone: Zone, public pos: THREE.Vector3, rotY = 0) {
    this.type = RELIC_BY_ID[typeId];
    this.value = relicValue(this.type, zone);
    this.mesh = relicMesh(this.type);
    this.mesh.position.copy(pos);
    this.mesh.rotation.y = rotY;
    this.mesh.userData.dynamic = true;
    chunk.group.add(this.mesh);
    this.interact = {
      pos: pos.clone().add(new THREE.Vector3(0, 0.15, 0)), radius: 2.3,
      label: () => this.taken || this.blocked() ? null : `Take ${this.type.name} — ${this.value} gold, ${this.type.weight} kg`,
      act: () => this.take(),
    };
    chunk.interactables.push(this.interact);
    chunk.entities.push(this);
  }
  blocked() { return false; }
  take(): CarriedRelic | null {
    if (this.taken) return null;
    const item = makeCarried(this.type.id, this.zone);
    if (!G.satchel.add(item)) { G.toast(`Satchel too heavy for the ${this.type.name} (${G.satchel.weight.toFixed(1)}/${G.satchel.capacity} kg). Drop something with Q.`); G.audio.denied(); return null; }
    this.taken = true;
    this.mesh.visible = false;
    G.relicsFound++;
    G.audio.pickup(this.value);
    G.toast(`+ ${this.type.name} (${this.value})`);
    G.noise([this.pos.x, this.pos.y, this.pos.z], 0.15);
    this.onTake?.();
    return item;
  }
  load() {}
  unload() {}
}

/** A carryable dynamic object: sandbags, stone heads, pots, dropped relics. */
export class Prop implements Entity {
  body: RAPIER.RigidBody | null = null;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  quat = new THREE.Quaternion();
  held = false;
  relic: CarriedRelic | null = null;
  pushing = 0;
  private lastSpeed = 0;
  interact: Interactable;
  constructor(public chunk: SceneChunk, public name: string, public weight: number, mesh: THREE.Object3D, pos: THREE.Vector3, public half: THREE.Vector3, relic: CarriedRelic | null = null) {
    this.mesh = mesh;
    this.mesh.userData.dynamic = true;
    this.mesh.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    this.pos = pos.clone();
    this.relic = relic;
    this.mesh.position.copy(pos);
    chunk.group.add(mesh);
    chunk.entities.push(this);
    this.interact = {
      pos: this.pos, radius: 2.2,
      label: () => {
        if (this.held || !this.body) return null;
        if (this.relic) return `Pick up ${this.name} — ${this.relic.value} gold, ${this.weight} kg  (G to carry in hands)`;
        return `G: carry ${this.name} (${this.weight} kg)`;
      },
      act: () => { if (this.relic) this.pickupRelic(); else G.carry.grab(this); },
    };
    chunk.interactables.push(this.interact);
  }

  pickupRelic() {
    if (!this.relic) return;
    if (!G.satchel.add(this.relic)) { G.toast('Your satchel is too heavy.'); G.audio.denied(); return; }
    G.audio.pickup(this.relic.value);
    this.destroy();
  }

  destroy() {
    this.unload();
    this.chunk.group.remove(this.mesh);
    this.chunk.entities = this.chunk.entities.filter((e) => e !== this);
    this.chunk.interactables = this.chunk.interactables.filter((i) => i !== this.interact);
  }

  load() {
    if (this.body) return;
    const bd = R.RigidBodyDesc.dynamic().setTranslation(this.pos.x, this.pos.y, this.pos.z).setRotation(this.quat).setLinearDamping(0.1).setAngularDamping(0.4).setCcdEnabled(true);
    this.body = G.physics.world.createRigidBody(bd);
    const vol = 8 * this.half.x * this.half.y * this.half.z;
    const c = G.physics.world.createCollider(R.ColliderDesc.cuboid(this.half.x, this.half.y, this.half.z).setDensity(this.weight / vol).setFriction(0.9).setRestitution(0.05), this.body);
    G.physics.tag(c, { kind: 'prop', ref: this });
  }
  unload() {
    if (this.held) return; // carried across chunks
    if (!this.body) return;
    const t = this.body.translation(), r = this.body.rotation();
    this.pos.set(t.x, t.y, t.z); this.quat.set(r.x, r.y, r.z, r.w);
    G.physics.removeBody(this.body);
    this.body = null;
  }
  update(_dt: number) {
    if (!this.body) return;
    const t = this.body.translation(), r = this.body.rotation();
    this.pos.set(t.x, t.y, t.z);
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    const v = this.body.linvel();
    const sp = Math.hypot(v.x, v.y, v.z);
    if (!this.held && this.lastSpeed > 4 && sp < this.lastSpeed * 0.5) {
      G.audio.thud(this.pos, Math.min(1, this.weight / 6 + 0.2));
      G.noise([t.x, t.y, t.z], Math.min(1, 0.35 + this.weight / 10));
    }
    this.lastSpeed = sp;
    if (t.y < this.chunk.killY - 20) { this.body.setTranslation({ x: t.x, y: this.chunk.killY - 20, z: t.z }, false); this.body.sleep(); }
  }
}

/** Grab, carry, drop and throw props. */
export class Carry {
  held: Prop | null = null;
  get heldWeight() { return this.held ? this.held.weight : 0; }

  grab(p: Prop) {
    if (this.held) this.drop();
    if (!p.body) return;
    if (p.weight > 30) { G.toast('Too heavy to lift. Push it instead.'); return; }
    this.held = p;
    p.held = true;
    p.body.setGravityScale(0, true);
    p.body.setAngularDamping(6);
  }

  drop(throwIt = false) {
    const p = this.held;
    if (!p) return;
    this.held = null;
    p.held = false;
    if (p.body) {
      p.body.setGravityScale(1, true);
      p.body.setAngularDamping(0.4);
      if (throwIt) {
        const f = G.player.forward;
        const sp = Math.max(4, 14 - p.weight * 1.1);
        p.body.setLinvel({ x: f.x * sp, y: f.y * sp + 2, z: f.z * sp }, true);
        G.audio.whoosh();
        G.noise([p.pos.x, p.pos.y, p.pos.z], 0.3);
      } else {
        p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    // Hand ownership to whichever chunk it is in now
    const c = G.world.chunkAt(p.pos) ?? p.chunk;
    if (c !== p.chunk) {
      p.chunk.entities = p.chunk.entities.filter((e) => e !== p);
      p.chunk.interactables = p.chunk.interactables.filter((i) => i !== p.interact);
      p.chunk.group.remove(p.mesh);
      p.chunk = c;
      c.entities.push(p); c.interactables.push(p.interact); c.group.add(p.mesh);
      if (!c.loaded) p.unload();
    }
  }

  /** Look for a prop to grab with G. */
  target(): Prop | null {
    const eye = G.player.eye, f = G.player.forward;
    let best: Prop | null = null, bestD = 3;
    for (const c of G.world.chunks) {
      if (!c.loaded) continue;
      for (const e of c.entities) {
        if (!(e instanceof Prop) || e.held || !e.body) continue;
        const to = e.pos.clone().sub(eye);
        const d = to.length();
        if (d > 2.6) continue;
        if (to.normalize().dot(f) < 0.7) continue;
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    return best;
  }

  /** Physics-rate: pull the held prop toward the hold point. */
  step() {
    const p = this.held;
    if (!p || !p.body) return;
    const eye = G.player.eye, f = G.player.forward;
    const target = eye.clone().addScaledVector(f, 1.3 + Math.max(p.half.x, p.half.z));
    const t = p.body.translation();
    const dx = target.x - t.x, dy = target.y - t.y, dz = target.z - t.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 3.5) { this.drop(); return; }
    const k = 14;
    p.body.setLinvel({ x: dx * k, y: dy * k, z: dz * k }, true);
  }

  update() {
    const inp = G.input;
    if (inp.hit('KeyG') || inp.mousePressed.has(2) || inp.padHit(PAD.LT)) {
      if (this.held) this.drop();
      else {
        const t = this.target();
        if (t) this.grab(t);
      }
    }
    if ((inp.mousePressed.has(0) || inp.padHit(PAD.RT)) && this.held) this.drop(true);
  }
}

/** Drop the most recently picked relic from the satchel as a physical prop. */
export function dropRelicFromSatchel() {
  const it = G.satchel.items[G.satchel.items.length - 1];
  if (!it) { G.toast('Your satchel is empty.'); return; }
  const type = RELIC_BY_ID[it.typeId];
  if (type.rarity === 'key') {
    // Keys are never lost to the floor; rotate to the next item instead.
    const other = [...G.satchel.items].reverse().find((x) => RELIC_BY_ID[x.typeId].rarity !== 'key');
    if (!other) { G.toast("You hold on to the key."); return; }
    G.satchel.remove(other.uid);
    G.satchel.items.push(other);
    return dropRelicFromSatchel();
  }
  G.satchel.remove(it.uid);
  const chunk = G.world.current;
  const eye = G.player.eye, f = G.player.forward;
  const pos = eye.clone().addScaledVector(new THREE.Vector3(f.x, 0, f.z).normalize(), 0.9);
  pos.y -= 0.4;
  const mesh = relicMesh(type);
  const holder = new THREE.Group();
  mesh.position.y = -0.12;
  holder.add(mesh);
  const prop = new Prop(chunk, type.name, type.weight, holder, pos, new THREE.Vector3(0.15, 0.12, 0.15), it);
  if (chunk.loaded) prop.load();
  G.noise([pos.x, pos.y, pos.z], Math.min(1, 0.15 + type.weight / 15));
  G.toast(`Dropped ${type.name}.`);
}

/** Make simple prop meshes. */
export function sandbagMesh(): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), materials().cloth);
  m.scale.set(1, 0.6, 0.8);
  return m;
}
export function stoneHeadMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.36), materials().stone);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.08), materials().stone);
  nose.position.set(0, 0, 0.2);
  g.add(head, nose);
  return g;
}
export function potMesh(): THREE.Object3D {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.12 + Math.sin(t * Math.PI) * 0.12, t * 0.45 - 0.225)); }
  return new THREE.Mesh(new THREE.LatheGeometry(pts, 12), new THREE.MeshStandardMaterial({ color: 0x9a5a34, roughness: 0.9 }));
}

/**
 * Trapped pedestal holding a relic. Swap a carried object of similar weight to take it safely;
 * otherwise the trap fires after a short grace period.
 */
export class Pedestal implements Entity {
  logic: TrappedPedestal;
  relicMesh: THREE.Group;
  taken = false;
  type: RelicType;
  value: number;
  top: THREE.Vector3;
  interact: Interactable;
  constructor(public chunk: SceneChunk, typeId: string, public zone: Zone, pos: THREE.Vector3, public onFire: () => void, public onTake?: () => void, height = 1.1) {
    this.type = RELIC_BY_ID[typeId];
    this.value = relicValue(this.type, zone);
    this.logic = new TrappedPedestal(this.type.weight);
    const mats = materials();
    chunk.b.cyl(0.55, height, pos.x, pos.y + height / 2, pos.z, mats.darkStone, { segs: 8 });
    chunk.b.box(1.0, 0.12, 1.0, pos.x, pos.y + height + 0.06, pos.z, mats.stone);
    this.top = new THREE.Vector3(pos.x, pos.y + height + 0.12, pos.z);
    this.relicMesh = relicMesh(this.type);
    this.relicMesh.position.copy(this.top);
    this.relicMesh.userData.dynamic = true;
    chunk.group.add(this.relicMesh);
    this.interact = {
      pos: this.top.clone().add(new THREE.Vector3(0, 0.2, 0)), radius: 2.4,
      label: () => {
        if (this.taken) return null;
        const h = G.carry.held;
        if (h) return `Swap your ${h.name} (${h.weight} kg) for the ${this.type.name} — ${this.value} gold, ${this.type.weight} kg`;
        return `Take ${this.type.name} — ${this.value} gold, ${this.type.weight} kg  (the pedestal looks pressure-sensitive...)`;
      },
      act: () => this.take(),
    };
    chunk.interactables.push(this.interact);
    chunk.entities.push(this);
  }

  take() {
    if (this.taken) return;
    const item = makeCarried(this.type.id, this.zone);
    if (!G.satchel.add(item)) { G.toast('Your satchel is too heavy for it.'); G.audio.denied(); return; }
    this.taken = true;
    this.relicMesh.visible = false;
    G.relicsFound++;
    G.audio.pickup(this.value);
    G.audio.grind(0.5, this.top);
    const h = G.carry.held;
    if (h && h.body) {
      G.carry.drop();
      h.body.setTranslation({ x: this.top.x, y: this.top.y + h.half.y + 0.02, z: this.top.z }, true);
      h.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      h.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      G.toast(`You swap in the ${h.name}... ` + (TrappedPedestal.swapIsSafe(this.type.weight, h.weight) ? 'the pedestal holds.' : 'it rises slightly. Too light!'));
    } else {
      G.toast(`You lift the ${this.type.name}... the pedestal clicks.`);
    }
    this.onTake?.();
  }

  load() {}
  unload() {}

  update(dt: number) {
    if (this.logic.state === 'fired' || this.logic.state === 'safe') return;
    let load = 0;
    for (const e of this.chunk.entities) {
      if (e instanceof Prop && !e.held && e.body) {
        const dx = e.pos.x - this.top.x, dz = e.pos.z - this.top.z, dy = e.pos.y - this.top.y;
        if (Math.hypot(dx, dz) < 0.6 && dy > -0.1 && dy < 0.8) load += e.weight;
      }
    }
    const r = this.logic.update(dt, load, !this.taken);
    if (r === 'fire') { G.audio.snap(this.top); this.onFire(); }
  }
}
