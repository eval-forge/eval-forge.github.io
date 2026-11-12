import * as THREE from 'three';
import type { SceneBuilder, SetPiece } from '../../engine/builder';
import type { MatName } from '../../engine/materials';
import type { Game } from '../../game/Game';
import { flaskMesh, torchMesh } from '../props';
import { Pickup, Sconce } from '../setpieces';

export interface Opening { side: 'n' | 's' | 'e' | 'w'; a1: number; a2: number; h: number; y?: number; }

/**
 * A closed room: floor slab, four walls (built outward by t) with door openings, and a ceiling.
 * Each opening also gets a strip of floor through the wall thickness so doorways are walkable.
 */
export function chamber(b: SceneBuilder, wall: MatName, floor: MatName, x1: number, z1: number, x2: number, z2: number,
  yFloor: number, yCeil: number, t: number, openings: Opening[] = [], skip = '', ceiling = true): void {
  b.box(floor, x1, yFloor - 1, z1, x2, yFloor, z2);
  b.room(wall, x1, z1, x2, z2, yFloor, yCeil, t, openings, {}, skip);
  for (const o of openings) {
    if (skip.includes(o.side)) continue;
    const y = o.y ?? yFloor;
    if (o.side === 'n') b.box(floor, o.a1, y - 1, z1 - t, o.a2, y, z1);
    else if (o.side === 's') b.box(floor, o.a1, y - 1, z2, o.a2, y, z2 + t);
    else if (o.side === 'w') b.box(floor, x1 - t, y - 1, o.a1, x1, y, o.a2);
    else b.box(floor, x2, y - 1, o.a1, x2 + t, y, o.a2);
  }
  if (ceiling) b.box(wall, x1 - t, yCeil, z1 - t, x2 + t, yCeil + 0.7, z2 + t, { tint: 0.8 });
}

/** Kills anything that falls below a height inside a rectangle. */
export class KillZone implements SetPiece {
  constructor(private game: Game, private x1: number, private z1: number, private x2: number, private z2: number, private y: number, private cause: string) {}
  fixedUpdate(): void {
    const p = this.game.player;
    if (!p.dead && p.pos.y < this.y && p.pos.x > this.x1 && p.pos.x < this.x2 && p.pos.z > this.z1 && p.pos.z < this.z2) p.damage(9999, this.cause);
  }
}

/** Scatter loose stones of given weights once per run. */
export function spawnRocks(game: Game, scene: string, rocks: [number, number, number, number][]): void {
  if (game.run.spawnedProps.has(scene as any)) return;
  for (const [x, y, z, w] of rocks) game.props.rock(x, y + 0.25, z, w);
}

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Standalone meshes that use the merged level materials need a white vertex colour attribute. */
export function white<T extends THREE.BufferGeometry>(g: T, k = 1): T {
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(k), 3));
  return g;
}

export function flask(game: Game, b: SceneBuilder, id: string, x: number, y: number, z: number): void {
  const m = flaskMesh(game.mats); m.position.set(x, y, z);
  b.piece(new Pickup(game, b, id, m, 'Take the oil flask', () => { game.run.torch.flasks++; game.toast('Oil flask. Press R to top up the torch.'); }));
}

export function spareTorch(game: Game, b: SceneBuilder, id: string, x: number, y: number, z: number): void {
  const m = torchMesh(game.mats); m.position.set(x, y, z);
  b.piece(new Pickup(game, b, id, m, 'Take the spare torch', () => { game.run.torch.spares++; game.toast('Spare torch. Leave it in a sconce, or press T to swap.'); }));
}

export function sconce(game: Game, b: SceneBuilder, id: string, x: number, y: number, z: number, nx: number, nz: number): void {
  b.piece(new Sconce(game, b, id, x, y, z, nx, nz));
}
