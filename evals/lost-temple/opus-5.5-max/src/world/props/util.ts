/** Small helpers shared by props. */
import * as THREE from 'three';
import { RAPIER, type Physics } from '../../physics/Physics';
import type { Materials, MatKey } from '../../render/materials';
import { uvBox, uvCylinder, normalizeGeometry } from '../../render/geometry';
import { G, groups } from '../../config';
import type { Player } from '../../entities/Player';

export function boxMesh(mats: Materials, mat: MatKey, sx: number, sy: number, sz: number, tex = 0.5, tint?: number): THREE.Mesh {
  const g = normalizeGeometry(uvBox(sx, sy, sz, tex), tint !== undefined ? new THREE.Color(tint) : undefined);
  const m = new THREE.Mesh(g, mats.get(mat));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function cylMesh(mats: Materials, mat: MatKey, rTop: number, rBot: number, h: number, seg = 14, tint?: number): THREE.Mesh {
  const g = normalizeGeometry(uvCylinder(rTop, rBot, h, seg), tint !== undefined ? new THREE.Color(tint) : undefined);
  const m = new THREE.Mesh(g, mats.get(mat));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Sum of the masses of dynamic bodies overlapping a box (props, debris; not held objects). */
export function massInBox(physics: Physics, center: THREE.Vector3, half: THREE.Vector3): number {
  const seen = new Set<number>();
  let m = 0;
  physics.overlapBox(center, half, null, groups(G.SENSOR, G.PROP | G.DEBRIS), (c) => {
    const b = c.parent();
    if (!b || !b.isDynamic() || seen.has(b.handle)) return;
    seen.add(b.handle);
    m += b.mass();
  });
  return m;
}

/** Is the player's feet inside an XZ rectangle and near height y? */
export function playerOn(p: Player, x0: number, z0: number, x1: number, z1: number, y: number, dy = 0.5): boolean {
  const f = p.pos;
  const feet = p.feetY;
  return f.x >= x0 && f.x <= x1 && f.z >= z0 && f.z <= z1 && Math.abs(feet - y) < dy && p.grounded;
}

/** Closest distance between segment AB and segment CD. */
export function segSegDist(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): number {
  const d1 = new THREE.Vector3().subVectors(b, a);
  const d2 = new THREE.Vector3().subVectors(d, c);
  const r = new THREE.Vector3().subVectors(a, c);
  const aa = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;
  if (aa <= 1e-9 && e <= 1e-9) return a.distanceTo(c);
  if (aa <= 1e-9) {
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const cc = d1.dot(r);
    if (e <= 1e-9) {
      s = THREE.MathUtils.clamp(-cc / aa, 0, 1);
    } else {
      const bb = d1.dot(d2);
      const denom = aa * e - bb * bb;
      s = denom !== 0 ? THREE.MathUtils.clamp((bb * f - cc * e) / denom, 0, 1) : 0;
      t = (bb * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-cc / aa, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((bb - cc) / aa, 0, 1);
      }
    }
  }
  const p1 = a.clone().addScaledVector(d1, s);
  const p2 = c.clone().addScaledVector(d2, t);
  return p1.distanceTo(p2);
}

/** Player capsule as a segment (bottom and top sphere centres). */
export function playerSegment(p: Player): [THREE.Vector3, THREE.Vector3] {
  const h = p.halfHeight;
  return [new THREE.Vector3(p.pos.x, p.pos.y - h, p.pos.z), new THREE.Vector3(p.pos.x, p.pos.y + h, p.pos.z)];
}

export function fixedBody(physics: Physics, x: number, y: number, z: number, q?: THREE.Quaternion): RAPIER.RigidBody {
  const d = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
  if (q) d.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  return physics.world.createRigidBody(d);
}

export function kinematicBody(physics: Physics, x: number, y: number, z: number): RAPIER.RigidBody {
  return physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
}

export function setBodyPose(b: RAPIER.RigidBody, p: THREE.Vector3, q?: THREE.Quaternion) {
  b.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
  if (q) b.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
}

export function smooth01(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
