/**
 * Owns the guardians: places the sleepers (three in the lair, one posing as a vault statue),
 * spawns the rest on the schedule after darkness (deepest first, all sweeping toward the great
 * door), gathers perception for each brain at 10 Hz (line of sight by raycast, the player's
 * light, noises, lit sconces) and moves them every frame. Being caught ends the run.
 */
import * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import { G, groups } from '../config';
import type { Materials } from '../render/materials';
import type { Sfx } from '../audio/Sfx';
import { SPAWN_SCHEDULE, GUARDIAN_STATS, type GuardianKind, type HeardNoise, type Perception, type SeenLight, type V3 } from '../logic/guardians';
import type { NavMesh, NavPoly } from '../logic/navmesh';
import type { NoiseEvent } from '../logic/noise';
import { Guardian } from './Guardian';
import { SCENES, sceneAt, isDarkScene } from '../world/scenes';
import { vaultStatuePose } from '../world/scenes/vault';
import type { Player } from './Player';

export const SWEEP_TARGET: V3 = [0, 0, -5];

export interface DirectorHost {
  physics: Physics;
  nav: NavMesh;
  mats: Materials;
  root: THREE.Object3D;
  sfx: Sfx;
  seed: number;
  player(): Player;
  /** Radius of the player's own torch light (0 when out). */
  playerLightRadius(): number;
  /** Player stands in some other light (a lit sconce, or sun/moon outdoors). */
  playerInLight(): boolean;
  /** Is the static world around this point loaded (so line-of-sight rays mean something)? */
  isLoadedAt(p: THREE.Vector3): boolean;
  torchFlame(): THREE.Vector3 | null;
  litSconces(): { id: string; pos: THREE.Vector3; radius: number }[];
  douseSconce(id: string): void;
  openLair(): void;
  caught(g: Guardian): void;
  toast(text: string, kind?: 'info' | 'good' | 'bad' | 'key' | 'warn'): void;
  shake(amount: number): void;
}

const CATCH: Record<GuardianKind, number> = {
  sentinel: GUARDIAN_STATS.sentinel.catchRadius,
  crawler: GUARDIAN_STATS.crawler.catchRadius,
  shadow: GUARDIAN_STATS.shadow.catchRadius,
};

export class GuardianDirector {
  guardians: Guardian[] = [];
  private spawned = new Set<string>();
  private noises: NoiseEvent[] = [];
  private thinkT = 0;
  private rng: () => number;
  nearestDist = Infinity;
  chase = 0;
  enabled = true;

  constructor(private h: DirectorHost) {
    let s = (h.seed * 9301 + 49297) >>> 0;
    this.rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /** Sleepers that are in place from the start of the run. */
  setup() {
    for (const e of SPAWN_SCHEDULE) {
      if (e.spawn.startsWith('lair') || e.spawn === 'vaultStatue') this.spawn(e.kind, e.spawn);
    }
  }

  private spawnPose(id: string): { pos: THREE.Vector3; yaw: number } | null {
    if (id === 'vaultStatue') {
      const p = vaultStatuePose(this.h.seed);
      return { pos: new THREE.Vector3(...p.pos), yaw: p.rotY };
    }
    for (const def of Object.values(SCENES)) {
      const sp = def.spawns?.[id];
      if (sp) return { pos: new THREE.Vector3(...sp), yaw: this.rng() * Math.PI * 2 };
    }
    return null;
  }

  /** Where a spawn point is, without touching the random stream. */
  private spawnPoint(id: string): THREE.Vector3 | null {
    if (id === 'vaultStatue') return new THREE.Vector3(...vaultStatuePose(this.h.seed).pos);
    for (const def of Object.values(SCENES)) {
      const sp = def.spawns?.[id];
      if (sp) return new THREE.Vector3(...sp);
    }
    return null;
  }

  spawn(kind: GuardianKind, id: string): Guardian | null {
    if (this.spawned.has(id)) return null;
    const pose = this.spawnPose(id);
    if (!pose) return null;
    this.spawned.add(id);
    const g = new Guardian(kind, id, pose.pos, pose.yaw, this.h.mats, this.h.physics, this.h.root);
    this.guardians.push(g);
    this.restyle(g, true);
    return g;
  }

  /** Wake a sleeper right now (the vault statue when the Heart is stolen, noisy thieves in the lair). */
  wakeEarly(id: string) {
    const g = this.guardians.find((x) => x.spawn === id);
    if (!g || g.awake) return;
    g.awake = true;
    if (id.startsWith('lair')) this.h.openLair();
  }

  noise(ev: NoiseEvent) {
    this.noises.push(ev);
    if (this.noises.length > 64) this.noises.shift();
    // sleepers in the lair stir at loud noises close by
    if (ev.loudness < 0.3) return;
    for (const g of this.guardians) {
      if (g.awake || !g.spawn.startsWith('lair')) continue;
      const d = Math.hypot(ev.x - g.pos.x, ev.y - g.pos.y, ev.z - g.pos.z);
      if (d < ev.loudness * 6.5) {
        for (const o of this.guardians) if (o.spawn.startsWith('lair')) o.awake = true;
        this.h.openLair();
        this.h.toast('Something heavy shifts behind the portcullis.', 'bad');
        break;
      }
    }
  }

  /** Lit polygons cost a lot for the shadow (it paths around your light). */
  private lightCost(): ((p: NavPoly) => number) | null {
    const lights: { x: number; z: number; r: number }[] = [];
    const f = this.h.torchFlame();
    const tr = this.h.playerLightRadius();
    if (f && tr > 0) lights.push({ x: f.x, z: f.z, r: tr * 0.8 });
    for (const s of this.h.litSconces()) lights.push({ x: s.pos.x, z: s.pos.z, r: s.radius * 0.8 });
    if (!lights.length) return null;
    return (p: NavPoly) => {
      for (const l of lights) if (Math.hypot(p.cx - l.x, p.cz - l.z) < l.r) return 40;
      return 1;
    };
  }

  private lightAt(p: THREE.Vector3): number {
    let best = 0;
    const f = this.h.torchFlame();
    const tr = this.h.playerLightRadius();
    if (f && tr > 0) best = Math.max(best, 1 - p.distanceTo(f) / tr);
    for (const s of this.h.litSconces()) best = Math.max(best, 1 - p.distanceTo(s.pos) / s.radius);
    return Math.max(0, Math.min(1, best));
  }

  private perceive(g: Guardian, dt: number): Perception {
    const pl = this.h.player();
    const feet = pl.feet;
    const head = new THREE.Vector3(feet.x, feet.y + pl.eyeHeight, feet.z);
    const dist = g.pos.distanceTo(feet);
    let los = false;
    if (dist < 45 && this.h.isLoadedAt(g.pos)) los = this.h.physics.lineOfSight(g.eye, head, groups(G.GUARDIAN, G.STATIC));
    const fx = Math.sin(g.yaw);
    const fz = Math.cos(g.yaw);
    const dx = feet.x - g.pos.x;
    const dz = feet.z - g.pos.z;
    const dl = Math.hypot(dx, dz) || 1;
    const angle = Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / dl)));
    const noises: HeardNoise[] = this.noises.map((n) => ({ x: n.x, y: n.y, z: n.z, loudness: n.loudness, byPlayer: n.byPlayer, dist: Math.hypot(n.x - g.pos.x, (n.y - g.pos.y) * 1.5, n.z - g.pos.z) }));
    const lit: SeenLight[] = this.h.litSconces().map((s) => ({ id: s.id, x: s.pos.x, y: s.pos.y, z: s.pos.z, dist: s.pos.distanceTo(g.pos) }));
    return {
      dt,
      awake: g.awake,
      pos: [g.pos.x, g.pos.y, g.pos.z],
      player: [feet.x, feet.y, feet.z],
      playerDist: dist,
      playerLOS: los,
      playerAngle: angle,
      playerLightRadius: this.h.playerLightRadius(),
      playerInLight: this.h.playerInLight(),
      noises,
      lightAtSelf: this.lightAt(g.eye),
      litSconces: lit,
      sweepTarget: SWEEP_TARGET,
      rand: this.rng,
    };
  }

  private restyle(g: Guardian, force = false) {
    const dark = isDarkScene(sceneAt(g.pos, null));
    if (dark !== g.dark || force) {
      g.dark = dark;
      this.h.mats.applyDark(g.rig.root, dark);
    }
  }

  /** `sinceDark` is seconds since darkness fell, or null while it is still day. */
  update(dt: number, sinceDark: number | null) {
    if (!this.enabled) return;
    if (sinceDark !== null) {
      for (const e of SPAWN_SCHEDULE) {
        if (sinceDark < e.at) continue;
        if (!this.spawned.has(e.spawn)) {
          // never pop out of the wall right next to the thief: hold the spawn while the player is
          // close to it (up to 25 s late, after which the dead rise behind you anyway)
          const sp = this.spawnPoint(e.spawn);
          const pp = this.h.player().pos;
          if (sp && sinceDark < e.at + 25 && Math.hypot(sp.x - pp.x, sp.z - pp.z) < 14 && Math.abs(sp.y - pp.y) < 6) continue;
          const g = this.spawn(e.kind, e.spawn);
          if (g) g.awake = true;
        } else {
          const g = this.guardians.find((x) => x.spawn === e.spawn);
          if (g && !g.awake) g.awake = true;
        }
      }
    }
    const pl = this.h.player();
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      const tdt = 0.1 - this.thinkT;
      this.thinkT = 0.1;
      for (const g of this.guardians) {
        const d = g.think(this.perceive(g, tdt));
        if (d.cue === 'wake') this.h.sfx.play(g.kind, g.eye, 1.3, 0.8);
        else if (d.cue === 'alert') this.h.sfx.play(g.kind, g.eye, 1.5, 1.1);
        else if (d.cue === 'strike') this.h.sfx.play('shadow', g.eye, 1.6, 1.3);
        if (d.smashSconce) {
          this.h.douseSconce(d.smashSconce);
          this.h.sfx.play('impact', g.eye, 1.2);
        }
      }
      this.noises = [];
    }
    const avoid = this.lightCost();
    let nearest = Infinity;
    let chase = 0;
    const feet = pl.feet;
    for (const g of this.guardians) {
      g.move(dt, this.h.nav, g.kind === 'shadow' ? avoid : null, this.guardians);
      this.restyle(g);
      if (!g.active) continue;
      const d = g.pos.distanceTo(feet);
      nearest = Math.min(nearest, d);
      const st = g.decision?.state;
      if ((st === 'chase' || st === 'hunt' || st === 'strike') && d < 30) chase = 1;
      // sounds: footfalls, periodic calls
      if (g.kind === 'sentinel' && g.takeStride(1.5)) {
        this.h.sfx.play('step_stone', g.pos, 1.3, 0.45);
        if (d < 10) this.h.shake(0.06 * (1 - d / 10));
      } else if (g.kind === 'crawler' && g.takeStride(0.6)) this.h.sfx.play('step_bone', g.pos, 0.5, 1.4);
      g.callT -= dt;
      if (g.callT <= 0) {
        g.callT = (g.kind === 'crawler' ? 3 : 6) + this.rng() * 5;
        if (d < 40) this.h.sfx.play(g.kind, g.eye, 0.7, 0.9 + this.rng() * 0.2);
      }
      // the catch
      const canCatch = g.kind === 'shadow' ? st === 'strike' : true;
      if (canCatch && pl.mode !== 'dead' && Math.hypot(g.pos.x - feet.x, g.pos.z - feet.z) <= CATCH[g.kind] && Math.abs(g.pos.y - feet.y) < 1.8) {
        this.h.caught(g);
        return;
      }
    }
    this.nearestDist = nearest;
    this.chase = chase;
  }

  dispose() {
    for (const g of this.guardians) g.dispose();
    this.guardians = [];
    this.spawned.clear();
    this.noises = [];
  }
}
