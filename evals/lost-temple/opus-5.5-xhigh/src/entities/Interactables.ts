/**
 * Things you press E on that aren't loose items: pedestals (with weight-plate traps),
 * wall sconces, and helpers shared by the scene-specific mechanisms (doors, seals, levers).
 */
import * as THREE from 'three';
import { surface, tinted, type Exposure } from '../engine/materials';
import { mesh } from '../world/build';
import { RAPIER, G_STATIC } from '../engine/physics';
import { PedestalTrap, DART_HEIGHT } from '../logic/traps';
import { SCONCE_BURN } from '../logic/torch';
import { TorchSystem, type FlameSource } from './Torch';
import type { SceneHandle } from '../world/SceneManager';
import type { Game } from '../game/Game';

export interface Interactable {
  /** Prompt text, or null when there's nothing to do right now. */
  prompt(game: Game): string | null;
  use(game: Game): void;
  /** Seconds E must be held (default: a tap). */
  hold?: number;
}

/** Register an interaction volume (hit only by the interaction ray). */
export function addInteract(h: SceneHandle, c: THREE.Vector3, half: THREE.Vector3, it: Interactable) {
  h.owner.interactBox(c.x, c.y, c.z, half.x, half.y, half.z, it);
}

// ------------------------------------------------------------ pedestals

export type PedestalKind = 'darts' | 'blades' | 'collapse' | 'boulder';

export interface PedestalInfo {
  id: string;
  pos: THREE.Vector3; // top centre
  trap?: PedestalKind;
  logic: PedestalTrap | null;
  /** Where the trap's darts come from. */
  dartSources: THREE.Vector3[];
}

/** A carved stone pedestal; the top is at `top`. Returns its info (registered on the game). */
export function buildPedestal(game: Game, h: SceneHandle, id: string, x: number, floorY: number, top: number, z: number, exp: Exposure, trap?: PedestalKind, dartSources: THREE.Vector3[] = []): PedestalInfo {
  const height = top - floorY;
  const mat = surface(exp === 'dungeon' ? 'dungeonWall' : 'templeWall', exp);
  const col = mesh(new THREE.CylinderGeometry(0.42, 0.5, height - 0.16, 10), mat, x, floorY + (height - 0.16) / 2, z);
  const cap = mesh(new THREE.BoxGeometry(1.0, 0.16, 1.0), mat, x, top - 0.08, z);
  const plate = mesh(new THREE.BoxGeometry(0.7, 0.03, 0.7), trap ? surface('iron', exp) : mat, x, top + 0.005, z, false, true);
  h.group.add(col, cap, plate);
  h.owner.staticCylinder(x, floorY + height / 2, z, height / 2, 0.5);
  h.owner.staticBox(x, top - 0.08, z, 0.5, 0.08, 0.5);
  let info = game.pedestals.get(id);
  if (!info) {
    const st = game.run.items.get(id);
    const w = st?.weight ?? 1;
    info = { id, pos: new THREE.Vector3(x, top, z), trap, logic: trap ? new PedestalTrap(w) : null, dartSources };
    if (game.run.pedestalFired.has(id) && info.logic) {
      info.logic.armed = false;
      info.logic.fired = true;
    }
    game.pedestals.set(id, info);
  } else info.dartSources = dartSources;
  return info;
}

/** Dart sources in the walls around a pedestal at chest height, aimed later at the player. */
export function wallDartSources(cx: number, floorY: number, cz: number, pts: [number, number][]): THREE.Vector3[] {
  return pts.map(([x, z]) => new THREE.Vector3(cx + x, floorY + DART_HEIGHT, cz + z));
}

// ------------------------------------------------------------ sconces

export interface SconceDef {
  id: string;
  x: number;
  y: number; // floor height
  z: number;
  nx: number;
  nz: number;
  exp: Exposure;
}

/** Wall sconce: E with a spare torch mounts a burning torch for 10 minutes. */
export function buildSconce(game: Game, h: SceneHandle, d: SconceDef) {
  const y = d.y + 2.0;
  const px = d.x + d.nx * 0.18;
  const pz = d.z + d.nz * 0.18;
  const bracket = mesh(new THREE.BoxGeometry(0.14, 0.32, 0.14), surface('iron', d.exp), d.x + d.nx * 0.07, y - 0.25, d.z + d.nz * 0.07, true, true);
  const cup = mesh(new THREE.CylinderGeometry(0.12, 0.07, 0.14, 8), surface('iron', d.exp), px, y - 0.05, pz);
  const stick = mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.5, 6), surface('wood', d.exp), px, y + 0.12, pz);
  const head = mesh(new THREE.CylinderGeometry(0.055, 0.04, 0.12, 6), tinted(0x2a2018, d.exp, 1), px, y + 0.4, pz);
  const flame = game.torch.makeFlame(1.1);
  flame.position.set(px, y + 0.68, pz);
  h.group.add(bracket, cup, stick, head, flame);
  const run = game.run;
  const lit = () => (run.sconces.get(d.id) ?? 0) > 0;
  const update = () => {
    const on = lit();
    stick.visible = on || run.sconces.has(d.id);
    head.visible = stick.visible;
  };
  update();
  const src: FlameSource = {
    id: 'sconce:' + d.id,
    pos: new THREE.Vector3(px, y + 0.55, pz),
    lit,
    strength: () => TorchSystem.sconceStrength(run.sconces.get(d.id) ?? 0),
    radius: 11,
    flame,
  };
  game.torch.addSource(src);
  h.dispose.push(() => game.torch.removeSource(src.id));
  h.update.push(update);
  const it: Interactable = {
    prompt: (g) => {
      if (lit()) return g.run.torch.lit ? null : 'E  Light your torch from the sconce';
      if (g.run.spares > 0) return `E  Mount a spare torch (${g.run.spares} left, burns 10 min)`;
      return 'Empty sconce (needs a spare torch)';
    },
    use: (g) => {
      if (lit()) {
        if (!g.run.torch.lit) g.torch.toggle();
        return;
      }
      if (g.run.spares <= 0) {
        g.audio.denied();
        return;
      }
      g.run.spares--;
      g.run.sconces.set(d.id, SCONCE_BURN);
      g.audio.torchIgnite();
      g.toast('The sconce burns. It will light your way back.');
    },
  };
  addInteract(h, new THREE.Vector3(px, y + 0.2, pz), new THREE.Vector3(0.3, 0.5, 0.3), it);
}

/** Pick sconce spots along the walls of some floors, at least `spacing` apart. */
export function pickSconces(edges: { scene: string; x: number; y: number; z: number; nx: number; nz: number; exp: Exposure; floorId: string }[], scene: string, spacing: number, skip: Set<string> = new Set()): SconceDef[] {
  const out: SconceDef[] = [];
  const cands = edges.filter((e) => e.scene === scene && !skip.has(e.floorId));
  for (const e of cands) {
    if (out.some((o) => Math.hypot(o.x - e.x, o.z - e.z) < spacing && Math.abs(o.y - e.y) < 3)) continue;
    out.push({ id: `${scene}:${Math.round(e.x * 10)}:${Math.round(e.z * 10)}`, x: e.x, y: e.y, z: e.z, nx: e.nx, nz: e.nz, exp: e.exp });
  }
  return out;
}

// ------------------------------------------------------------ sliding stone (doors, seals)

/** A kinematic slab that slides between two positions. */
export class SlidingStone {
  t = 0; // 0 closed, 1 open
  target = 0;
  body: RAPIER.RigidBody;
  private stopGrind: (() => void) | null = null;
  constructor(
    private game: Game,
    h: SceneHandle,
    public mesh: THREE.Object3D,
    private closed: THREE.Vector3,
    private open: THREE.Vector3,
    half: THREE.Vector3,
    public speed = 0.25,
    tagKind: 'door' | 'static' = 'door',
  ) {
    this.body = h.owner.body(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(closed.x, closed.y, closed.z));
    h.owner.collider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setCollisionGroups(G_STATIC), this.body, { kind: tagKind });
    mesh.position.copy(closed);
    h.group.add(mesh);
    h.update.push((dt) => this.update(dt));
    h.dispose.push(() => this.stopGrind?.());
  }

  set(t: number) {
    this.t = this.target = t;
    this.apply();
  }

  private apply() {
    const p = this.closed.clone().lerp(this.open, this.t);
    this.mesh.position.copy(p);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
  }

  update(dt: number) {
    if (Math.abs(this.target - this.t) < 1e-4) {
      if (this.stopGrind) {
        this.stopGrind();
        this.stopGrind = null;
        this.game.audio.thud(this.mesh.position, 0.8);
      }
      return;
    }
    if (!this.stopGrind) this.stopGrind = this.game.audio.grindLoop(this.mesh.position, 0.5);
    const d = Math.sign(this.target - this.t) * this.speed * dt;
    this.t = Math.abs(d) >= Math.abs(this.target - this.t) ? this.target : this.t + d;
    this.apply();
    this.game.fx.shake = Math.max(this.game.fx.shake, 0.08);
  }
}
