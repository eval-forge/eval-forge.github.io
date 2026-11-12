/** Small seeded RNG (mulberry32) so runs are reproducible and logic is testable. */
export type RandomFn = () => number;

export function mulberry32(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private fn: RandomFn;
  constructor(seed: number) {
    this.fn = mulberry32(seed);
  }
  next(): number {
    return this.fn();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.fn();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number): boolean {
    return this.fn() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.fn() * arr.length) % arr.length];
  }
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return items[0];
    let r = this.fn() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
  fork(salt: string): Rng {
    return new Rng((Math.floor(this.fn() * 4294967296) ^ hashString(salt)) >>> 0);
  }
}
