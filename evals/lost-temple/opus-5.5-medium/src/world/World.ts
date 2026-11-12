import * as THREE from 'three';
import { SceneChunk, Interactable } from './SceneChunk';
import { G } from '../core/ctx';
import type { SceneId } from '../logic/unlocks';

const STREAM_DIST = 42;

export class World {
  chunks: SceneChunk[];
  byId: Record<string, SceneChunk> = {};
  current: SceneChunk;
  private streamTimer = 0;

  constructor(chunks: SceneChunk[]) {
    this.chunks = chunks;
    for (const c of chunks) this.byId[c.id] = c;
    this.current = chunks[0];
  }

  get(id: SceneId) { return this.byId[id]; }

  buildAll() { for (const c of this.chunks) c.ensureBuilt(); }
  loadAll() { for (const c of this.chunks) c.load(); }

  chunkAt(p: THREE.Vector3): SceneChunk | null {
    // Smallest containing area wins (handles nested regions like the stairwell).
    let best: SceneChunk | null = null, bestVol = Infinity;
    for (const c of this.chunks) {
      for (const a of c.areas) {
        if (a.containsPoint(p)) {
          const s = a.getSize(new THREE.Vector3());
          const v = s.x * s.y * s.z;
          if (v < bestVol) { bestVol = v; best = c; }
        }
      }
    }
    return best;
  }

  stream(force = false) {
    const p = G.player.position;
    const want = new Set<SceneChunk>();
    for (const c of this.chunks) if (c.bounds.distanceToPoint(p) < STREAM_DIST) want.add(c);
    want.add(this.current);
    for (const n of this.current.neighbours) want.add(this.byId[n]);
    for (const c of this.chunks) {
      if (want.has(c) && !c.loaded) c.load();
      else if (!want.has(c) && c.loaded && (force || true)) c.unload();
    }
  }

  update(dt: number) {
    const c = this.chunkAt(G.player.position);
    if (c) this.current = c;
    this.streamTimer -= dt;
    if (this.streamTimer <= 0) { this.streamTimer = 0.25; this.stream(); }
    for (const ch of this.chunks) {
      ch.tick(dt);
      if (ch.loaded) ch.update(dt);
    }
  }

  loadedNames(): string[] { return this.chunks.filter((c) => c.loaded).map((c) => c.id); }

  /** Interactable closest to the player's view ray. */
  pickInteractable(eye: THREE.Vector3, dir: THREE.Vector3): Interactable | null {
    let best: Interactable | null = null, bestScore = Infinity;
    const to = new THREE.Vector3();
    for (const c of this.chunks) {
      if (!c.loaded) continue;
      for (const it of c.interactables) {
        to.subVectors(it.pos, eye);
        const d = to.length();
        if (d > it.radius + 0.6) continue;
        const cos = to.dot(dir) / Math.max(1e-4, d);
        if (cos < 0.55 && d > 1.0) continue;
        if (it.label() === null) continue;
        const score = d * (2 - cos);
        if (score < bestScore) { bestScore = score; best = it; }
      }
    }
    return best;
  }

  waterSurfaceAt(p: THREE.Vector3): number | null {
    for (const c of this.chunks) {
      if (!c.loaded) continue;
      for (const w of c.waters) if (w.box.containsPoint(p)) return w.surface;
    }
    return null;
  }

  inClimb(p: THREE.Vector3): boolean {
    for (const c of this.chunks) {
      if (!c.loaded) continue;
      for (const b of c.climbs) if (b.containsPoint(p)) return true;
    }
    return false;
  }

  windAt(p: THREE.Vector3): number {
    return this.current.windAt(p);
  }
}
