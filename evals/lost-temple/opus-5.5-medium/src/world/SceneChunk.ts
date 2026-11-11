import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Builder } from './kit';
import { G } from '../core/ctx';
import { R } from '../core/Physics';
import type { SceneId } from '../logic/unlocks';
import type { Zone } from '../logic/relics';

export interface Entity {
  load(): void;
  unload(): void;
  update?(dt: number): void;
}

export interface Interactable {
  pos: THREE.Vector3;
  radius: number;
  /** Prompt text, or null if not currently usable. */
  label(): string | null;
  act(): void;
}

export interface WaterVolume { box: THREE.Box3; surface: number }

export interface NavRegion { min: THREE.Vector3; max: THREE.Vector3 }

export interface Sconce { pos: THREE.Vector3; lit: boolean; fuel: number; mesh: THREE.Object3D; flame: THREE.Object3D; lightIndex: number }

export abstract class SceneChunk {
  abstract id: SceneId;
  abstract zone: Zone;
  abstract name: string;
  group = new THREE.Group();
  b = new Builder(this.group);
  bounds = new THREE.Box3();
  /** Precise volumes used to decide which scene the player is in. Defaults to bounds. */
  areas: THREE.Box3[] = [];
  navRegions: NavRegion[] = [];
  entities: Entity[] = [];
  interactables: Interactable[] = [];
  waters: WaterVolume[] = [];
  climbs: THREE.Box3[] = [];
  sconces: Sconce[] = [];
  /** Lethal fall height (y below which you die). */
  killY = -25;
  body: RAPIER.RigidBody | null = null;
  loaded = false;
  built = false;
  /** Neighbours that load along with this one. */
  neighbours: SceneId[] = [];

  abstract build(): void;

  ensureBuilt() {
    if (this.built) return;
    this.build();
    this.b.finish();
    if (this.areas.length === 0) this.areas.push(this.bounds.clone());
    this.group.name = this.id;
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.dynamic) { o.matrixAutoUpdate = false; o.updateMatrix(); } });
    this.built = true;
  }

  load() {
    if (this.loaded) return;
    this.ensureBuilt();
    G.scene.add(this.group);
    const body = G.physics.world.createRigidBody(R.RigidBodyDesc.fixed());
    for (const d of this.b.statics) {
      let cd: RAPIER.ColliderDesc;
      if (d.shape === 'box') cd = R.ColliderDesc.cuboid(d.hx, d.hy, d.hz).setTranslation(d.pos.x, d.pos.y, d.pos.z).setRotation(d.quat);
      else if (d.shape === 'cyl') cd = R.ColliderDesc.cylinder(d.hh, d.r).setTranslation(d.pos.x, d.pos.y, d.pos.z).setRotation(d.quat);
      else if (d.shape === 'ball') cd = R.ColliderDesc.ball(d.r).setTranslation(d.pos.x, d.pos.y, d.pos.z);
      else cd = R.ColliderDesc.trimesh(d.vertices, d.indices);
      cd.setFriction(0.8);
      const c = G.physics.world.createCollider(cd, body);
      G.physics.tag(c, { kind: 'static', ref: this });
    }
    this.body = body;
    for (const e of this.entities) e.load();
    this.loaded = true;
  }

  unload() {
    if (!this.loaded) return;
    for (const e of this.entities) e.unload();
    G.physics.removeBody(this.body);
    this.body = null;
    G.scene.remove(this.group);
    this.loaded = false;
  }

  update(dt: number) {
    for (const e of this.entities) e.update?.(dt);
  }

  /** Called every frame even when unloaded (for timers that must keep running). */
  tick(_dt: number) {}

  /** Wind gust strength 0..1 at a point (cliffs override). */
  windAt(_p: THREE.Vector3): number { return 0; }

  contains(p: THREE.Vector3): boolean {
    return this.areas.some((a) => a.containsPoint(p));
  }

  addSconce(x: number, y: number, z: number, facing: number) {
    const m = new THREE.Group();
    const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.45, 6), (this as unknown as { _iron?: THREE.Material })._iron ?? new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.9, roughness: 0.5 }));
    bracket.rotation.x = 0.4;
    m.add(bracket);
    const flame = new THREE.Group();
    flame.visible = false;
    m.add(flame);
    m.position.set(x, y, z);
    m.rotation.y = facing;
    this.group.add(m);
    const s: Sconce = { pos: new THREE.Vector3(x, y + 0.35, z), lit: false, fuel: 0, mesh: m, flame, lightIndex: -1 };
    this.sconces.push(s);
    this.interactables.push({
      pos: s.pos, radius: 2.2,
      label: () => (s.lit ? null : G.torch.spares > 0 ? 'Place a spare torch in the sconce' : null),
      act: () => G.torch.placeInSconce(s),
    });
  }
}
