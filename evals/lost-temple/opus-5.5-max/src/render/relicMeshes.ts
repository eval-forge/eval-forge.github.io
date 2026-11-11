/**
 * Procedural models for every relic type, the two key items and the counterweights.
 * Each model is built once per type and cached; instances share geometry.
 */
import * as THREE from 'three';
import type { RelicId } from '../logic/economy';
import type { Materials, MatKey } from './materials';
import { lathe, merge, normalizeGeometry, transformed } from './geometry';

export type ModelId = RelicId | 'sunDisc' | 'serpentKey' | 'sandbag' | 'pot' | 'smallBag';

export interface ModelSpec {
  /** Half extents of the collider box (centred on the body origin). */
  half: [number, number, number];
  parts: { mat: MatKey; geo: THREE.BufferGeometry }[];
}

type P = { mat: MatKey; geo: THREE.BufferGeometry };

function part(mat: MatKey, g: THREE.BufferGeometry, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0], scale: number | [number, number, number] = 1): P {
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(...scale);
  return { mat, geo: normalizeGeometry(transformed(g, pos, new THREE.Euler(...rot), s)) };
}

const sphere = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const cyl = (rt: number, rb: number, h: number, s = 14) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r: number, h: number, s = 8) => new THREE.ConeGeometry(r, h, s);
const torus = (r: number, t: number, s = 18) => new THREE.TorusGeometry(r, t, 8, s);

function specs(): Record<ModelId, () => ModelSpec> {
  return {
    clayIdol: () => ({
      half: [0.1, 0.16, 0.09],
      parts: [
        part('clay', lathe([[0, -0.16], [0.1, -0.15], [0.09, -0.05], [0.07, 0.02], [0.08, 0.06], [0, 0.07]], 12)),
        part('clay', sphere(0.06, 10, 8), [0, 0.11, 0]),
        part('clay', box(0.18, 0.03, 0.05), [0, 0.03, 0]),
      ],
    }),
    coinPouch: () => ({
      half: [0.12, 0.11, 0.12],
      parts: [
        part('burlap', sphere(0.12, 12, 9), [0, -0.02, 0], [0, 0, 0], [1, 0.75, 1]),
        part('burlap', cyl(0.03, 0.05, 0.06, 8), [0, 0.07, 0]),
        part('rope', torus(0.035, 0.008, 10), [0, 0.06, 0], [Math.PI / 2, 0, 0]),
        part('gold', cyl(0.025, 0.025, 0.006, 10), [0.1, -0.09, 0.05], [0.3, 0, 0.2]),
        part('gold', cyl(0.025, 0.025, 0.006, 10), [0.07, -0.095, -0.08], [-0.2, 0, 0.1]),
      ],
    }),
    scrollCase: () => ({
      half: [0.24, 0.05, 0.05],
      parts: [
        part('wood', cyl(0.045, 0.045, 0.4, 12), [0, 0, 0], [0, 0, Math.PI / 2]),
        part('bronze', cyl(0.052, 0.052, 0.05, 12), [0.21, 0, 0], [0, 0, Math.PI / 2]),
        part('bronze', cyl(0.052, 0.052, 0.05, 12), [-0.21, 0, 0], [0, 0, Math.PI / 2]),
        part('bronze', torus(0.048, 0.006, 12), [0, 0, 0], [0, Math.PI / 2, 0]),
      ],
    }),
    jadeFigurine: () => ({
      half: [0.07, 0.13, 0.06],
      parts: [
        part('jade', lathe([[0, -0.13], [0.07, -0.12], [0.065, -0.04], [0.04, 0.03], [0, 0.04]], 10)),
        part('jade', box(0.08, 0.08, 0.07), [0, 0.08, 0]),
        part('jade', box(0.1, 0.02, 0.02), [0, 0.12, 0]),
      ],
    }),
    silverChalice: () => ({
      half: [0.09, 0.14, 0.09],
      parts: [part('silver', lathe([[0, -0.14], [0.08, -0.13], [0.03, -0.11], [0.018, -0.02], [0.03, 0.0], [0.085, 0.07], [0.09, 0.14], [0.08, 0.14], [0.075, 0.075], [0.0, 0.02]], 18))],
    }),
    obsidianDagger: () => ({
      half: [0.2, 0.025, 0.05],
      parts: [
        part('obsidian', cone(0.045, 0.26, 4), [0.07, 0, 0], [0, 0, -Math.PI / 2], [1, 1, 0.25]),
        part('gold', box(0.02, 0.025, 0.1), [-0.06, 0, 0]),
        part('cloth', cyl(0.016, 0.016, 0.1, 8), [-0.12, 0, 0], [0, 0, Math.PI / 2]),
        part('gold', sphere(0.022, 8, 6), [-0.18, 0, 0]),
      ],
    }),
    sunTablet: () => ({
      half: [0.25, 0.04, 0.18],
      parts: [
        part('glyphs', box(0.5, 0.08, 0.36)),
        part('gold', cyl(0.09, 0.09, 0.012, 16), [0, 0.042, 0]),
      ],
    }),
    serpentBracelet: () => ({
      half: [0.08, 0.025, 0.08],
      parts: [
        part('gold', torus(0.065, 0.016, 20), [0, 0, 0], [Math.PI / 2, 0, 0]),
        part('gemRed', sphere(0.018, 8, 6), [0.065, 0.015, 0]),
        part('gold', cone(0.018, 0.04, 6), [-0.065, 0.01, 0.02], [Math.PI / 2, 0, 0]),
      ],
    }),
    goldMask: () => ({
      half: [0.12, 0.15, 0.07],
      parts: [
        part('gold', sphere(0.14, 16, 10, ), [0, 0, 0], [0, 0, 0], [0.85, 1.05, 0.45]),
        part('obsidian', box(0.05, 0.022, 0.03), [-0.045, 0.03, 0.055]),
        part('obsidian', box(0.05, 0.022, 0.03), [0.045, 0.03, 0.055]),
        part('obsidian', box(0.06, 0.016, 0.03), [0, -0.07, 0.055]),
        part('turquoise', box(0.02, 0.06, 0.03), [0, -0.01, 0.06]),
      ],
    }),
    goldenScarab: () => ({
      half: [0.07, 0.04, 0.09],
      parts: [
        part('gold', sphere(0.07, 12, 8), [0, 0, 0], [0, 0, 0], [0.9, 0.5, 1.2]),
        part('gold', sphere(0.035, 10, 6), [0, 0.0, -0.085], [0, 0, 0], [1, 0.6, 0.8]),
        part('gemBlue', sphere(0.025, 8, 6), [0, 0.035, 0.01]),
      ],
    }),
    gemUrn: () => ({
      half: [0.17, 0.24, 0.17],
      parts: [
        part('bronze', lathe([[0, -0.24], [0.1, -0.23], [0.16, -0.12], [0.17, 0.0], [0.12, 0.13], [0.07, 0.18], [0.09, 0.24], [0.0, 0.24]], 18)),
        part('gemRed', sphere(0.025, 8, 6), [0.165, 0.0, 0]),
        part('gemBlue', sphere(0.025, 8, 6), [-0.165, 0.0, 0]),
        part('gemRed', sphere(0.025, 8, 6), [0, 0.0, 0.165]),
        part('gemBlue', sphere(0.025, 8, 6), [0, 0.0, -0.165]),
      ],
    }),
    featheredCrown: () => {
      const parts: P[] = [part('gold', cyl(0.13, 0.12, 0.07, 18, ), [0, -0.06, 0])];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const mat: MatKey = i % 3 === 0 ? 'cloth' : i % 3 === 1 ? 'turquoise' : 'jade';
        parts.push(part(mat, box(0.035, 0.18, 0.008), [Math.cos(a) * 0.12, 0.06, Math.sin(a) * 0.12], [0, -a + Math.PI / 2, 0.12]));
      }
      parts.push(part('gemRed', sphere(0.022, 8, 6), [0, -0.05, 0.13]));
      return { half: [0.15, 0.13, 0.15], parts };
    },
    moonMirror: () => ({
      half: [0.18, 0.2, 0.06],
      parts: [
        part('silver', cyl(0.15, 0.15, 0.02, 24), [0, 0.03, 0], [Math.PI / 2, 0, 0]),
        part('bronze', torus(0.155, 0.018, 24), [0, 0.03, 0]),
        part('bronze', box(0.04, 0.06, 0.04), [0, -0.15, 0]),
        part('bronze', box(0.18, 0.025, 0.1), [0, -0.19, 0]),
      ],
    }),
    goldIngot: () => ({
      half: [0.17, 0.06, 0.08],
      parts: [part('gold', (() => {
        const g = box(0.34, 0.11, 0.16);
        const p = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * 0.82, p.getY(i), p.getZ(i) * 0.72);
        g.computeVertexNormals();
        return g;
      })())],
    }),
    goldenSkull: () => ({
      half: [0.1, 0.12, 0.12],
      parts: [
        part('gold', sphere(0.1, 14, 10), [0, 0.02, 0], [0, 0, 0], [0.9, 1, 1.05]),
        part('gold', box(0.12, 0.06, 0.08), [0, -0.075, 0.045]),
        part('obsidian', sphere(0.026, 8, 6), [-0.038, 0.02, 0.085]),
        part('obsidian', sphere(0.026, 8, 6), [0.038, 0.02, 0.085]),
        part('obsidian', cone(0.016, 0.03, 3), [0, -0.025, 0.1], [Math.PI, 0, 0]),
      ],
    }),
    emeraldEye: () => ({
      half: [0.06, 0.06, 0.06],
      parts: [
        part('jade', new THREE.OctahedronGeometry(0.055, 0), [0, 0, 0], [0, 0.3, 0], [1, 0.8, 1]),
        part('gold', torus(0.045, 0.01, 14), [0, -0.012, 0], [Math.PI / 2, 0, 0]),
      ],
    }),
    condorStatuette: () => ({
      half: [0.3, 0.2, 0.15],
      parts: [
        part('gold', sphere(0.1, 12, 8), [0, 0, 0], [0, 0, 0], [1.4, 0.9, 0.9]),
        part('gold', box(0.26, 0.02, 0.12), [-0.12, 0.08, 0.1], [0.5, 0, 0.3]),
        part('gold', box(0.26, 0.02, 0.12), [-0.12, 0.08, -0.1], [-0.5, 0, 0.3]),
        part('gold', sphere(0.05, 10, 8), [0.15, 0.08, 0]),
        part('bronze', cone(0.02, 0.06, 6), [0.21, 0.07, 0], [0, 0, -Math.PI / 2]),
        part('bronze', box(0.18, 0.04, 0.12), [0, -0.16, 0]),
        part('bronze', cyl(0.015, 0.015, 0.08, 6), [0, -0.1, 0]),
      ],
    }),
    sunIdol: () => {
      const parts: P[] = [
        part('gold', lathe([[0, -0.22], [0.09, -0.21], [0.085, -0.08], [0.06, 0.0], [0.07, 0.05], [0.0, 0.07]], 16)),
        part('gold', sphere(0.065, 14, 10), [0, 0.12, 0]),
        part('gold', box(0.2, 0.04, 0.06), [0, 0.04, 0]),
        part('gemRed', sphere(0.018, 8, 6), [0, 0.13, 0.06]),
      ];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        parts.push(part('gold', cone(0.018, 0.07, 5), [Math.cos(a) * 0.09, 0.12 + Math.sin(a) * 0.09, -0.01], [0, 0, a - Math.PI / 2]));
      }
      return { half: [0.13, 0.22, 0.08], parts };
    },
    templeHeart: () => ({
      half: [0.2, 0.22, 0.2],
      parts: [
        part('gemRed', new THREE.DodecahedronGeometry(0.15, 0), [0, 0, 0], [0.3, 0.2, 0], [1, 1.2, 1]),
        part('gold', torus(0.17, 0.014, 22), [0, 0, 0], [Math.PI / 2, 0, 0]),
        part('gold', torus(0.17, 0.014, 22), [0, 0, 0], [0, 0, 0]),
        part('gold', torus(0.17, 0.014, 22), [0, 0, 0], [0, Math.PI / 2, 0]),
        part('gold', cyl(0.06, 0.1, 0.06, 12), [0, -0.19, 0]),
      ],
    }),
    sunDisc: () => {
      const parts: P[] = [part('gold', cyl(0.16, 0.16, 0.03, 24), [0, 0, 0], [Math.PI / 2, 0, 0]), part('gemRed', sphere(0.03, 8, 6), [0, 0, 0.02])];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        parts.push(part('gold', cone(0.025, 0.07, 4), [Math.cos(a) * 0.19, Math.sin(a) * 0.19, 0], [0, 0, a - Math.PI / 2], [1, 1, 0.4]));
      }
      return { half: [0.22, 0.22, 0.03], parts };
    },
    serpentKey: () => ({
      half: [0.18, 0.05, 0.04],
      parts: [
        part('bronze', cyl(0.014, 0.014, 0.28, 8), [0, 0, 0], [0, 0, Math.PI / 2]),
        part('bronze', torus(0.04, 0.012, 12), [-0.17, 0, 0]),
        part('bronze', box(0.04, 0.05, 0.012), [0.12, -0.03, 0]),
        part('jade', sphere(0.02, 8, 6), [-0.17, 0, 0]),
      ],
    }),
    sandbag: () => ({
      half: [0.2, 0.12, 0.15],
      parts: [part('burlap', sphere(0.2, 12, 8), [0, 0, 0], [0, 0, 0], [1, 0.6, 0.75])],
    }),
    smallBag: () => ({
      half: [0.13, 0.08, 0.1],
      parts: [part('burlap', sphere(0.13, 10, 8), [0, 0, 0], [0, 0, 0], [1, 0.6, 0.75])],
    }),
    pot: () => ({
      half: [0.16, 0.2, 0.16],
      parts: [part('clay', lathe([[0, -0.2], [0.1, -0.19], [0.16, -0.06], [0.15, 0.08], [0.08, 0.16], [0.09, 0.2], [0.0, 0.2]], 14))],
    }),
  };
}

export class RelicModels {
  private cache = new Map<ModelId, { half: [number, number, number]; meshes: { mat: MatKey; geo: THREE.BufferGeometry }[] }>();
  private table = specs();
  constructor(private mats: Materials) {}

  get(id: ModelId) {
    let c = this.cache.get(id);
    if (!c) {
      const s = this.table[id]();
      const byMat = new Map<MatKey, THREE.BufferGeometry[]>();
      for (const p of s.parts) {
        if (!byMat.has(p.mat)) byMat.set(p.mat, []);
        byMat.get(p.mat)!.push(p.geo);
      }
      const meshes = [...byMat.entries()].map(([mat, geos]) => ({ mat, geo: merge(geos) }));
      c = { half: s.half, meshes };
      this.cache.set(id, c);
    }
    return c;
  }

  /** A new object for this model (geometry shared). */
  make(id: ModelId): THREE.Group {
    const c = this.get(id);
    const g = new THREE.Group();
    for (const m of c.meshes) {
      const mesh = new THREE.Mesh(m.geo, this.mats.get(m.mat));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.sharedGeo = true;
      g.add(mesh);
    }
    return g;
  }

  half(id: ModelId): [number, number, number] {
    return this.get(id).half;
  }
}
