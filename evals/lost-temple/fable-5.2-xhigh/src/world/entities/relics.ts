/** Relic models (all built from primitives), pickups, trapped pedestals, key items and supplies. */
import * as THREE from 'three';
import { KEY_ITEMS, RELIC_BY_ID, relicValue, type KeyItemId, type RelicId } from '../../core/economy';
import type { Vec3Like } from '../../core/scenes';
import { PedestalSensor } from '../../core/traps';
import { GROUPS, RAPIER, type Interactable } from '../../engine/physics';
import type { Game } from '../../game/game';
import type { DroppedRelic } from '../../game/run';
import type { LoadedScene } from '../kit';
import type { RelicSpotDef } from '../layout/types';
import type { Entity } from '../registry';

type Part = [geo: THREE.BufferGeometry, mat: string, x: number, y: number, z: number, rx?: number, ry?: number, rz?: number];

function parts(game: Game, dark: boolean, list: Part[]): THREE.Group {
  const g = new THREE.Group();
  for (const [geo, mat, x, y, z, rx, ry, rz] of list) {
    const m = game.mats.mesh(geo, mat, dark);
    m.position.set(x, y, z);
    m.rotation.set(rx ?? 0, ry ?? 0, rz ?? 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

const lathe = (profile: [number, number][], seg = 14): THREE.BufferGeometry =>
  new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const sph = (r: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry => {
  const g = new THREE.SphereGeometry(r, 14, 10);
  g.scale(sx, sy, sz);
  return g;
};
const cyl = (r: number, h: number, rTop = r, seg = 12): THREE.BufferGeometry => new THREE.CylinderGeometry(rTop, r, h, seg);
const box = (x: number, y: number, z: number): THREE.BufferGeometry => new THREE.BoxGeometry(x, y, z);

/** Build the model for a relic. Origin is the point it rests on. */
export function relicModel(game: Game, id: RelicId | KeyItemId, dark: boolean): THREE.Group {
  const P = (list: Part[]): THREE.Group => parts(game, dark, list);
  switch (id) {
    case 'clay_bowl':
      return P([[lathe([[0.05, 0], [0.09, 0.02], [0.17, 0.1], [0.18, 0.12], [0.15, 0.1], [0.06, 0.03]]), 'clay', 0, 0, 0]]);
    case 'coin_stack':
      return P([
        [cyl(0.07, 0.05), 'bronze', 0, 0.025, 0],
        [cyl(0.07, 0.04), 'bronze', 0.015, 0.07, 0.01],
        [cyl(0.07, 0.03), 'bronze', -0.01, 0.105, -0.012],
        [cyl(0.07, 0.015), 'bronze', 0.13, 0.008, 0.05, 0, 0, 0.1],
      ]);
    case 'bone_flute':
      return P([
        [cyl(0.02, 0.36, 0.017, 8), 'bone', 0, 0.025, 0, 0, 0, Math.PI / 2],
        [cyl(0.027, 0.03, 0.027, 8), 'bone', -0.17, 0.025, 0, 0, 0, Math.PI / 2],
      ]);
    case 'obsidian_dagger':
      return P([
        [new THREE.ConeGeometry(0.045, 0.3, 4), 'obsidian', 0.1, 0.03, 0, 0, 0, -Math.PI / 2],
        [cyl(0.02, 0.13, 0.02, 8), 'wood', -0.11, 0.03, 0, 0, 0, Math.PI / 2],
        [box(0.02, 0.03, 0.11), 'bronze', -0.045, 0.03, 0],
      ]);
    case 'painted_scroll':
      return P([
        [cyl(0.04, 0.3, 0.04, 10), 'paper', 0, 0.045, 0, 0, 0, Math.PI / 2],
        [cyl(0.015, 0.4, 0.015, 6), 'wood', 0, 0.045, 0, 0, 0, Math.PI / 2],
      ]);
    case 'silver_censer':
      return P([
        [sph(0.12, 1, 0.85, 1), 'silver', 0, 0.16, 0],
        [cyl(0.07, 0.06, 0.04), 'silver', 0, 0.03, 0],
        [new THREE.ConeGeometry(0.07, 0.12, 10), 'silver', 0, 0.3, 0],
        [new THREE.TorusGeometry(0.035, 0.008, 6, 12), 'silver', 0, 0.38, 0],
      ]);
    case 'jade_mask':
      return P([
        [sph(0.17, 0.85, 1.05, 0.4), 'jade', 0, 0.2, 0, -0.35],
        [sph(0.03, 1.4, 0.8, 0.5), 'bone', -0.06, 0.235, 0.055, -0.35],
        [sph(0.03, 1.4, 0.8, 0.5), 'bone', 0.06, 0.235, 0.055, -0.35],
        [box(0.1, 0.02, 0.03), 'obsidian', 0, 0.13, 0.075, -0.35],
      ]);
    case 'turquoise_serpent':
      return P([
        [new THREE.TorusGeometry(0.11, 0.03, 8, 16, Math.PI * 1.5), 'turquoise', 0, 0.035, 0, Math.PI / 2],
        [sph(0.045, 1, 0.8, 1.3), 'turquoise', 0.11, 0.045, 0.02],
        [sph(0.045, 1, 0.8, 1.3), 'turquoise', -0.02, 0.045, -0.11, 0, Math.PI / 2],
        [sph(0.012), 'ruby', 0.13, 0.065, 0.045],
      ]);
    case 'sun_idol':
      return P([
        [box(0.18, 0.2, 0.14), 'gold', 0, 0.1, 0],
        [sph(0.09), 'gold', 0, 0.28, 0],
        [cyl(0.15, 0.02, 0.15, 16), 'gold', 0, 0.29, -0.05, Math.PI / 2],
        [box(0.26, 0.05, 0.1), 'gold', 0, 0.16, 0.03],
      ]);
    case 'ruby_scarab':
      return P([
        [sph(0.07, 0.8, 0.5, 1.15), 'ruby', 0, 0.04, 0],
        [new THREE.TorusGeometry(0.068, 0.012, 6, 14), 'gold', 0, 0.025, 0, Math.PI / 2],
        [sph(0.03, 1, 0.7, 1), 'gold', 0, 0.04, 0.085],
      ]);
    case 'gem_urn':
      return P([
        [lathe([[0.08, 0], [0.12, 0.03], [0.2, 0.18], [0.19, 0.3], [0.1, 0.4], [0.09, 0.46], [0.13, 0.48]]), 'bronze', 0, 0, 0],
        [sph(0.028), 'ruby', 0.195, 0.22, 0],
        [sph(0.028), 'turquoise', -0.195, 0.22, 0],
        [sph(0.028), 'jade', 0, 0.22, 0.195],
        [sph(0.028), 'ruby', 0, 0.22, -0.195],
        [cyl(0.11, 0.035, 0.11), 'gold', 0, 0.5, 0],
      ]);
    case 'gold_mask':
      return P([
        [sph(0.2, 0.85, 1.1, 0.42), 'gold', 0, 0.25, 0, -0.3],
        [sph(0.035, 1.5, 0.7, 0.5), 'obsidian', -0.07, 0.29, 0.07, -0.3],
        [sph(0.035, 1.5, 0.7, 0.5), 'obsidian', 0.07, 0.29, 0.07, -0.3],
        [box(0.3, 0.05, 0.03), 'gold', 0, 0.46, -0.06, -0.3],
        [new THREE.ConeGeometry(0.03, 0.09, 4), 'gold', 0, 0.21, 0.09, 1.2],
      ]);
    case 'crystal_skull':
      return P([
        [sph(0.13, 0.9, 1, 1.1), 'crystal', 0, 0.2, 0],
        [box(0.15, 0.08, 0.14), 'crystal', 0, 0.07, 0.03],
        [sph(0.03), 'obsidian', -0.05, 0.2, 0.115],
        [sph(0.03), 'obsidian', 0.05, 0.2, 0.115],
      ]);
    case 'moonstone_orb':
      return P([
        [sph(0.11), 'moonstone', 0, 0.16, 0],
        [new THREE.TorusGeometry(0.075, 0.018, 8, 16), 'silver', 0, 0.045, 0, Math.PI / 2],
        [cyl(0.09, 0.03, 0.07), 'silver', 0, 0.015, 0],
      ]);
    case 'royal_crown': {
      const list: Part[] = [[new THREE.CylinderGeometry(0.14, 0.13, 0.1, 16, 1, true), 'gold', 0, 0.05, 0]];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        list.push([new THREE.ConeGeometry(0.025, i % 2 ? 0.1 : 0.16, 5), 'gold', Math.cos(a) * 0.135, 0.15, Math.sin(a) * 0.135]);
      }
      list.push([sph(0.03), 'ruby', 0, 0.06, 0.14], [sph(0.022), 'jade', 0.14, 0.06, 0], [sph(0.022), 'jade', -0.14, 0.06, 0]);
      return P(list);
    }
    case 'gold_jaguar':
      return P([
        [box(0.5, 0.2, 0.2), 'gold', 0, 0.3, 0],
        [box(0.18, 0.18, 0.18), 'gold', 0.33, 0.38, 0],
        [box(0.07, 0.2, 0.07), 'gold', 0.19, 0.1, 0.07],
        [box(0.07, 0.2, 0.07), 'gold', 0.19, 0.1, -0.07],
        [box(0.07, 0.2, 0.07), 'gold', -0.19, 0.1, 0.07],
        [box(0.07, 0.2, 0.07), 'gold', -0.19, 0.1, -0.07],
        [cyl(0.02, 0.3, 0.012, 6), 'gold', -0.36, 0.38, 0, 0, 0, 0.9],
        [sph(0.02), 'jade', 0.425, 0.41, 0.05],
        [sph(0.02), 'jade', 0.425, 0.41, -0.05],
        [new THREE.ConeGeometry(0.03, 0.06, 4), 'gold', 0.3, 0.5, 0.06],
        [new THREE.ConeGeometry(0.03, 0.06, 4), 'gold', 0.3, 0.5, -0.06],
      ]);
    case 'emperor_coffer':
      return P([
        [box(0.9, 0.4, 0.5), 'wood', 0, 0.2, 0],
        [cyl(0.25, 0.9, 0.25, 12), 'wood', 0, 0.4, 0, 0, 0, Math.PI / 2],
        [box(0.07, 0.44, 0.54), 'gold', -0.3, 0.22, 0],
        [box(0.07, 0.44, 0.54), 'gold', 0.3, 0.22, 0],
        [box(0.94, 0.05, 0.54), 'gold', 0, 0.4, 0],
        [box(0.12, 0.14, 0.04), 'gold', 0, 0.32, 0.26],
        [sph(0.03), 'ruby', 0, 0.33, 0.285],
      ]);
    case 'dawn_idol':
      return P([
        [cyl(0.13, 0.08, 0.11), 'gold', 0, 0.04, 0],
        [box(0.2, 0.3, 0.14), 'gold', 0, 0.23, 0],
        [sph(0.1, 1, 1.1, 1), 'gold', 0, 0.47, 0],
        [cyl(0.24, 0.02, 0.24, 20), 'gold', 0, 0.5, -0.07, Math.PI / 2],
        [sph(0.035), 'ruby', 0, 0.26, 0.075],
        [box(0.34, 0.06, 0.08), 'gold', 0, 0.3, 0],
        [sph(0.018), 'obsidian', -0.035, 0.49, 0.09],
        [sph(0.018), 'obsidian', 0.035, 0.49, 0.09],
      ]);
    case 'sun_disc': {
      const list: Part[] = [[cyl(0.2, 0.035, 0.2, 20), 'gold', 0, 0.02, 0], [cyl(0.08, 0.05, 0.08, 12), 'bronze', 0, 0.03, 0]];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        list.push([new THREE.ConeGeometry(0.035, 0.1, 4), 'gold', Math.cos(a) * 0.24, 0.02, Math.sin(a) * 0.24, 0, -a, -Math.PI / 2]);
      }
      return P(list);
    }
    case 'serpent_key':
      return P([
        [new THREE.TorusGeometry(0.06, 0.016, 6, 14), 'bronze', -0.1, 0.02, 0, Math.PI / 2],
        [cyl(0.014, 0.22, 0.014, 6), 'bronze', 0.05, 0.02, 0, 0, 0, Math.PI / 2],
        [box(0.03, 0.02, 0.06), 'bronze', 0.14, 0.02, 0.03],
        [box(0.03, 0.02, 0.045), 'bronze', 0.09, 0.02, 0.025],
      ]);
  }
}

export const MOUNT_HEIGHT = { floor: 0, pedestal: 0.95, plinth: 0.6 } as const;

function disposeModel(model: THREE.Object3D): void {
  model.removeFromParent();
  model.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}

/** A relic sitting at its spot. Pedestal mounts may be wired to a trap. */
export class RelicPickup implements Entity, Interactable {
  private model: THREE.Group | null;
  private collider: RAPIER.Collider | null;
  private readonly sensor: PedestalSensor | null;
  private readonly top: Vec3Like;
  private readonly value: number;

  constructor(
    private readonly game: Game,
    private readonly scene: LoadedScene,
    private readonly spot: RelicSpotDef,
    private readonly relic: RelicId,
    dark: boolean,
  ) {
    const def = RELIC_BY_ID[relic];
    this.value = relicValue(relic, spot.scene);
    this.top = { x: spot.pos.x, y: spot.pos.y + MOUNT_HEIGHT[spot.mount], z: spot.pos.z };
    const taken = game.run.taken.has(spot.id);
    this.sensor = spot.mount === 'pedestal' ? new PedestalSensor(def.weight) : null;
    this.buildMount(dark);
    if (taken) {
      this.sensor?.disarm();
      this.model = null;
      this.collider = null;
      return;
    }
    this.model = relicModel(game, relic, dark);
    this.model.position.set(this.top.x, this.top.y, this.top.z);
    this.model.rotation.y = (spot.pos.x * 1.7 + spot.pos.z * 0.9) % (Math.PI * 2);
    scene.group.add(this.model);
    const r = relic === 'emperor_coffer' ? 0.55 : relic === 'gold_jaguar' ? 0.4 : 0.3;
    this.collider = game.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(r).setTranslation(this.top.x, this.top.y + r * 0.7, this.top.z).setCollisionGroups(GROUPS.interact),
      scene.body,
    );
    game.physics.setMeta(this.collider, { interact: this, kind: 'relic' });
  }

  prompt(): string | null {
    if (!this.model) return null;
    const def = RELIC_BY_ID[this.relic];
    const s = this.game.run.satchel;
    const info = `${def.name} · ${def.weight} kg · ${this.value} coins`;
    if (!s.canFit(def.weight)) return `${info}\nToo heavy: ${s.free.toFixed(1)} kg free in the satchel`;
    const held = this.game.player.held;
    if (this.sensor && held) return `Swap for your ${held.name} (${held.mass.toFixed(1)} kg): ${info}`;
    return `Take ${info}${this.sensor ? '\nIt rests on a weighted pedestal' : ''}`;
  }

  interact(): void {
    if (!this.model) return;
    const game = this.game;
    const def = RELIC_BY_ID[this.relic];
    const item = game.run.satchel.add(this.relic, this.spot.scene, this.spot.id);
    if (!item) {
      game.toast(`Satchel too full for the ${def.name}. Q drops your last relic.`, 'bad');
      game.sfx('deny');
      return;
    }
    game.run.taken.add(this.spot.id);
    game.run.relicsLifted++;
    disposeModel(this.model);
    this.model = null;
    game.physics.removeCollider(this.collider);
    this.collider = null;
    const big = def.base >= 1000;
    game.sfx(big ? 'relicBig' : 'relic', this.top);
    game.noise('relic', this.top);
    game.toast(`${def.name}  +${item.value}`, 'good');
    game.onRelicTaken(this.relic);
    if (this.sensor) {
      const held = game.player.held;
      if (held) {
        this.sensor.setWeight(held.mass);
        game.player.held = null;
        held.setHeld(false);
        held.consume(this.top);
        if (!this.sensor.balanced) game.toast(`The ${held.name} is the wrong weight...`, 'bad');
      } else {
        this.sensor.setWeight(0);
      }
    }
  }

  /** Pedestals and plinths are their own small meshes so a triggered pedestal can sink into the floor. */
  private buildMount(dark: boolean): void {
    const { spot, game, scene } = this;
    if (spot.mount === 'floor') return;
    const h = MOUNT_HEIGHT[spot.mount];
    const g = new THREE.Group();
    if (spot.mount === 'pedestal') {
      const col = game.mats.mesh(new THREE.BoxGeometry(0.62, h - 0.08, 0.62), dark ? 'dungeonWall' : 'templeStone', dark);
      col.position.y = (h - 0.08) / 2;
      const foot = game.mats.mesh(new THREE.BoxGeometry(0.84, 0.16, 0.84), dark ? 'dungeonWall' : 'templeStone', dark);
      foot.position.y = 0.08;
      const plate = game.mats.mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.08, 14), 'bronze', dark);
      plate.position.y = h - 0.04;
      g.add(col, foot, plate);
    } else {
      const drum = game.mats.mesh(new THREE.CylinderGeometry(0.36, 0.42, h, 12), dark ? 'dungeonWall' : 'mossStone', dark);
      drum.position.y = h / 2;
      g.add(drum);
    }
    g.traverse((o) => {
      (o as THREE.Mesh).castShadow = true;
      (o as THREE.Mesh).receiveShadow = true;
    });
    g.position.set(spot.pos.x, spot.pos.y, spot.pos.z);
    scene.group.add(g);
    this.mount = g;
    if (game.run.get(`sunk:${spot.id}`, false)) {
      this.sink = 1;
      g.position.y = spot.pos.y - h + 0.06;
      return;
    }
    this.mountCollider = game.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.36, h / 2, 0.36).setTranslation(spot.pos.x, spot.pos.y + h / 2, spot.pos.z).setCollisionGroups(GROUPS.world),
      scene.body,
    );
    game.physics.setMeta(this.mountCollider, { surface: 'stone', kind: 'pedestal' });
  }

  private mount: THREE.Group | null = null;
  private mountCollider: RAPIER.Collider | null = null;
  private sink = 0;
  private sinking = false;

  step(dt: number): void {
    if (!this.sensor || !this.sensor.update(dt)) return;
    const fire = this.spot.trap ? this.scene.traps.get(this.spot.trap) : undefined;
    this.game.sfx('plate', this.top, 1, 0.7);
    if (fire) {
      this.game.toast('The pedestal sinks. Something answers.', 'bad');
      this.game.noise('trap', this.top);
      this.sinking = true;
      this.game.run.set(`sunk:${this.spot.id}`, true);
      this.game.physics.removeCollider(this.mountCollider);
      this.mountCollider = null;
      this.game.sfx('grind', this.top, 1, 0.8);
      fire(this.top);
    }
  }

  frame(dt: number): void {
    if (!this.sinking || !this.mount) return;
    this.sink = Math.min(1, this.sink + dt * 1.1);
    this.mount.position.y = this.spot.pos.y - (MOUNT_HEIGHT[this.spot.mount] - 0.06) * this.sink;
    if (this.sink >= 1) this.sinking = false;
  }

  dispose(): void {
    if (this.model) disposeModel(this.model);
    this.model = null;
    if (this.mount) disposeModel(this.mount);
    this.mount = null;
  }
}

/** A relic the player threw down (Q). It keeps the value it was found at. */
export class DroppedRelicEnt implements Entity, Interactable {
  private readonly model: THREE.Group;
  private readonly body: RAPIER.RigidBody;
  private gone = false;

  constructor(
    private readonly game: Game,
    private readonly scene: LoadedScene,
    private readonly rec: DroppedRelic,
    dark: boolean,
  ) {
    this.model = relicModel(game, rec.item.relic, dark);
    scene.group.add(this.model);
    const w = game.physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(rec.pos.x, rec.pos.y + 0.3, rec.pos.z).setLinearDamping(0.6).setAngularDamping(3).lockRotations(),
    );
    const c = w.createCollider(
      RAPIER.ColliderDesc.ball(0.2).setMass(rec.item.weight).setFriction(1).setCollisionGroups(GROUPS.debris),
      this.body,
    );
    game.physics.setMeta(c, { interact: this, kind: 'relic' });
  }

  prompt(): string | null {
    const def = RELIC_BY_ID[this.rec.item.relic];
    return `Take back ${def.name} · ${def.weight} kg · ${this.rec.item.value} coins`;
  }

  interact(): void {
    if (this.gone) return;
    const game = this.game;
    if (!game.run.satchel.addCarried(this.rec.item)) {
      game.toast('Satchel too full.', 'bad');
      game.sfx('deny');
      return;
    }
    game.run.undrop(this.rec.id);
    game.sfx('relic', this.model.position, 0.7);
    this.gone = true;
    game.scenes.removeEntity(this.scene, this);
    this.dispose();
  }

  frame(): void {
    const t = this.body.translation();
    this.model.position.set(t.x, t.y - 0.2, t.z);
  }

  dispose(): void {
    if (!this.gone) {
      const t = this.body.translation();
      this.rec.pos = { x: t.x, y: t.y - 0.2, z: t.z };
    }
    this.game.physics.removeBody(this.body);
    disposeModel(this.model);
  }
}

/** Sun Disc / Serpent Key. */
export class KeyPickup implements Entity, Interactable {
  private model: THREE.Group | null = null;
  private collider: RAPIER.Collider | null = null;

  constructor(
    private readonly game: Game,
    private readonly scene: LoadedScene,
    private readonly id: KeyItemId,
    private readonly at: Vec3Like,
    dark: boolean,
    private readonly onTake: () => void,
  ) {
    this.model = relicModel(game, id, dark);
    this.model.position.set(at.x, at.y, at.z);
    scene.group.add(this.model);
    this.collider = game.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(0.32).setTranslation(at.x, at.y + 0.1, at.z).setCollisionGroups(GROUPS.interact),
      scene.body,
    );
    game.physics.setMeta(this.collider, { interact: this, kind: 'key' });
  }

  prompt(): string | null {
    return this.model ? `Take the ${KEY_ITEMS[this.id].name}` : null;
  }

  interact(): void {
    if (!this.model) return;
    this.game.run.satchel.addKey(this.id);
    this.game.sfx('key', this.at);
    this.game.toast(`${KEY_ITEMS[this.id].name}: ${KEY_ITEMS[this.id].blurb}`, 'good');
    disposeModel(this.model);
    this.model = null;
    this.game.physics.removeCollider(this.collider);
    this.collider = null;
    this.onTake();
  }

  frame(dt: number): void {
    if (this.model) this.model.rotation.y += dt * 0.6;
  }

  dispose(): void {
    if (this.model) disposeModel(this.model);
    this.model = null;
  }
}

/** A fuel flask or a spare torch lying around. */
export class Supply implements Entity, Interactable {
  private model: THREE.Group | null = null;
  private collider: RAPIER.Collider | null = null;

  constructor(
    private readonly game: Game,
    private readonly scene: LoadedScene,
    private readonly id: string,
    private readonly kind: 'flask' | 'spare',
    private readonly at: Vec3Like,
    dark: boolean,
  ) {
    if (game.run.taken.has(`supply:${id}`)) return;
    const list: Part[] =
      kind === 'flask'
        ? [
            [lathe([[0.0, 0], [0.07, 0.01], [0.08, 0.12], [0.03, 0.18], [0.03, 0.22]], 10), 'clay', 0, 0, 0],
            [cyl(0.032, 0.03, 0.032, 8), 'wood', 0, 0.235, 0],
          ]
        : [
            [cyl(0.025, 0.5, 0.02, 8), 'wood', 0, 0.03, 0, 0, 0, Math.PI / 2],
            [cyl(0.045, 0.14, 0.04, 8), 'cloth', 0.22, 0.03, 0, 0, 0, Math.PI / 2],
          ];
    this.model = parts(game, dark, list);
    this.model.position.set(at.x, at.y, at.z);
    scene.group.add(this.model);
    this.collider = game.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(0.28).setTranslation(at.x, at.y + 0.12, at.z).setCollisionGroups(GROUPS.interact),
      scene.body,
    );
    game.physics.setMeta(this.collider, { interact: this, kind: 'supply' });
  }

  prompt(): string | null {
    if (!this.model) return null;
    return this.kind === 'flask' ? 'Take the oil flask (+90 s of flame, R to pour)' : 'Take the spare torch';
  }

  interact(): void {
    if (!this.model) return;
    const t = this.game.run.torch;
    if (this.kind === 'flask') t.flasks++;
    else t.spares++;
    this.game.run.taken.add(`supply:${this.id}`);
    this.game.sfx('key', this.at, 0.6, 0.8);
    this.game.toast(this.kind === 'flask' ? 'Oil flask taken.' : 'Spare torch taken.', 'good');
    disposeModel(this.model);
    this.model = null;
    this.game.physics.removeCollider(this.collider);
    this.collider = null;
  }

  dispose(): void {
    if (this.model) disposeModel(this.model);
    this.model = null;
  }
}
