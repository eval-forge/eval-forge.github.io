export interface V2 { x: number; z: number }
export interface V3 { x: number; y: number; z: number }

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const dist2 = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist3 = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** 2D cross product of (b-a) x (c-a) on the xz plane. */
export const triArea2 = (a: V2, b: V2, c: V2) => (c.x - a.x) * (b.z - a.z) - (b.x - a.x) * (c.z - a.z);
/** Smallest signed difference between two angles (radians), in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
