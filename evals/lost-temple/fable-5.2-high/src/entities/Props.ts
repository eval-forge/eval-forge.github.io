import * as THREE from 'three';
import { RELIC_BY_ID, type CarriedRelic } from '../core/economy';
import { NOISE } from '../core/traps';
import type { SceneId } from '../core/types';
import { CG, RAPIER } from '../engine/physics';
import type { Game } from '../game/Game';
import type { Bounds, Interactable } from '../world/types';
import { makeRelicMesh } from '../world/props';

export type PropKind = 'rock' | 'relic' | 'sack';

export interface Prop {
  kind: PropKind;
  name: string;
  /** kg. This is also the rigid body's mass. */
  weight: number;
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  held: boolean;
  thrown: boolean;
  relic?: CarriedRelic;
  inter: Interactable;
  prevSpeed: number;
}

interface Stashed { kind: PropKind; name: string; weight: number; relic?: CarriedRelic; x: number; y: number; z: number; }

/**
 * Loose physical objects you can pick up, carry, drop and throw: stones, sandbags and relics that
 * have been dropped out of the satchel. Props belonging to a scene that streams out are stashed
 * and put back when it streams in again.
 */
export class Props {
  list: Prop[] = [];
  private stash = new Map<SceneId, Stashed[]>();
  private group = new THREE.Group();

  constructor(private game: Game) { game.scene.add(this.group); }

  reset(): void {
    for (const p of [...this.list]) this.remove(p);
    this.stash.clear();
  }

  private radiusFor(weight: number): number { return Math.max(0.1, 0.105 * Math.cbrt(weight) + 0.03); }

  spawn(kind: PropKind, name: string, weight: number, x: number, y: number, z: number, relic?: CarriedRelic): Prop {
    const { game } = this;
    const r = this.radiusFor(weight);
    const body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.25).setAngularDamping(1.2).setCcdEnabled(true));
    game.physics.world.createCollider(RAPIER.ColliderDesc.ball(r).setMass(weight).setFriction(1.1).setRestitution(0.12).setCollisionGroups(CG.SMALL), body);
    let mesh: THREE.Object3D;
    if (kind === 'relic' && relic) {
      mesh = makeRelicMesh(RELIC_BY_ID[relic.relicId], game.mats);
    } else if (kind === 'sack') {
      const g = new THREE.SphereGeometry(r, 8, 6); g.scale(1, 0.8, 1);
      mesh = new THREE.Mesh(g, game.mats.solid(0x9a8458, 1));
    } else {
      const g = new THREE.IcosahedronGeometry(r, 1);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const k = 0.85 + ((Math.sin(pos.getX(i) * 31 + weight * 7) + Math.sin(pos.getY(i) * 27) + Math.sin(pos.getZ(i) * 23)) / 3) * 0.16;
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.85, pos.getZ(i) * k);
      }
      g.computeVertexNormals();
      mesh = new THREE.Mesh(g, game.mats.solid(0x7c766a, 1));
    }
    mesh.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    game.physics.addSync(body, mesh);
    const prop: Prop = {
      kind, name, weight, body, mesh, held: false, thrown: false, relic, prevSpeed: 0,
      inter: {
        pos: mesh.position, range: 2.7, priority: kind === 'relic' ? 0 : 4,
        prompt: () => {
          if (prop.held) return null;
          if (kind === 'relic' && relic) return `Take ${name}  ·  ${relic.value} gold  ·  ${weight.toFixed(1)} kg`;
          return game.player.held ? null : `Pick up ${name} (${weight.toFixed(1)} kg)`;
        },
        act: () => {
          if (kind === 'relic' && relic) {
            if (game.relics.stow(relic)) this.remove(prop);
          } else game.player.grab(prop);
        },
      },
    };
    game.addInteractable(prop.inter);
    this.list.push(prop);
    return prop;
  }

  rock(x: number, y: number, z: number, weight: number): Prop { return this.spawn('rock', 'stone', weight, x, y, z); }

  remove(p: Prop): void {
    const { game } = this;
    if (game.player.held === p) game.player.held = null;
    game.removeInteractable(p.inter);
    game.physics.removeBody(p.body);
    p.mesh.removeFromParent();
    p.mesh.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
  }

  fixedUpdate(): void {
    const { game } = this;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const v = p.body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      // A thrown object that suddenly loses speed has hit something: that makes a noise guardians hear.
      if (p.thrown && p.prevSpeed - sp > 2.5) {
        const t = p.body.translation();
        game.audio.play('clack', { pos: t, vol: Math.min(1, 0.4 + p.weight * 0.1) });
        game.emitNoise(t, 16 + Math.min(10, p.weight * 2), NOISE.throwImpact);
        if (sp < 1.5) p.thrown = false;
      }
      p.prevSpeed = sp;
      if (p.body.translation().y < -70) this.remove(p);
    }
  }

  /** A scene is streaming out: put away every prop resting inside it. */
  stashScene(id: SceneId, bounds: Bounds[]): void {
    const out = this.stash.get(id) ?? [];
    for (const p of [...this.list]) {
      if (p.held) continue;
      const t = p.body.translation();
      if (bounds.some((b) => t.x >= b.x1 && t.x <= b.x2 && t.z >= b.z1 && t.z <= b.z2 && t.y >= (b.y1 ?? -Infinity) && t.y <= (b.y2 ?? Infinity))) {
        out.push({ kind: p.kind, name: p.name, weight: p.weight, relic: p.relic, x: t.x, y: t.y, z: t.z });
        this.remove(p);
      }
    }
    this.stash.set(id, out);
  }

  restoreScene(id: SceneId): void {
    const list = this.stash.get(id);
    if (!list) return;
    for (const s of list) this.spawn(s.kind, s.name, s.weight, s.x, s.y + 0.05, s.z, s.relic);
    this.stash.delete(id);
  }
}
