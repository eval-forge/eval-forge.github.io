/**
 * Instanced jungle: canopy trees, palms, ferns, grass tufts and hanging leaves, all with a
 * vertex-shader wind sway. Placement is deterministic per scene.
 */
import * as THREE from 'three';
import type { Materials } from './materials';
import { normalizeGeometry, merge, transformed, lathe } from './geometry';
import { Rng } from '../logic/rng';

const SWAY_UNIFORMS = { uTime: { value: 0 }, uWind: { value: 1 } };

function swayMaterial(base: THREE.MeshStandardMaterial, amount: number, key: string): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = SWAY_UNIFORMS.uTime;
    shader.uniforms.uWind = SWAY_UNIFORMS.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wp0 = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
          wp0 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          #endif
          float h = max(0.0, position.y);
          float ph = wp0.x * 0.37 + wp0.z * 0.23;
          float s = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25;
          float k = ${amount.toFixed(4)} * h * h * uWind;
          transformed.x += s * k;
          transformed.z += cos(uTime * 1.1 + ph) * k * 0.5;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'sway-' + key;
  return m;
}

interface Kind {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  cast: boolean;
}

export class Vegetation {
  kinds: Record<'trunk' | 'canopy' | 'palmTrunk' | 'palmFronds' | 'fern' | 'grass' | 'bush', Kind>;

  constructor(mats: Materials) {
    const leaf = mats.get('leaf') as THREE.MeshStandardMaterial;
    const leafDark = mats.get('leafDark') as THREE.MeshStandardMaterial;
    const grass = mats.get('grass') as THREE.MeshStandardMaterial;
    const bark = mats.get('bark');

    // canopy tree trunk: tapered with flared roots
    const trunk = lathe([[0.75, 0], [0.5, 0.4], [0.36, 1.2], [0.3, 6], [0.24, 11], [0.18, 13.5], [0.0, 13.6]], 9, 0.5);
    const roots: THREE.BufferGeometry[] = [normalizeGeometry(trunk)];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const r = new THREE.BoxGeometry(0.16, 1.4, 1.3);
      roots.push(normalizeGeometry(transformed(r, [Math.cos(a) * 0.55, 0.55, Math.sin(a) * 0.55], new THREE.Euler(0, -a, 0))));
    }
    // a few branches
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      const b = new THREE.CylinderGeometry(0.06, 0.12, 3.5, 5);
      roots.push(normalizeGeometry(transformed(b, [Math.cos(a) * 1.0, 11 + i * 0.6, Math.sin(a) * 1.0], new THREE.Euler(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9))));
    }
    const trunkGeo = merge(roots);

    // canopy: clusters of squashed blobs plus leaf cards
    const blobs: THREE.BufferGeometry[] = [];
    const rr = new Rng(7);
    for (let i = 0; i < 6; i++) {
      const a = rr.next() * Math.PI * 2;
      const d = 1 + rr.next() * 2.4;
      const g = new THREE.IcosahedronGeometry(2.2 + rr.next() * 1.2, 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const s = 1 + (rr.next() - 0.5) * 0.35;
        p.setXYZ(k, p.getX(k) * s, p.getY(k) * s * 0.55, p.getZ(k) * s);
      }
      g.computeVertexNormals();
      const c = new THREE.Color().setHSL(0.27 + rr.next() * 0.06, 0.5, 0.35 + rr.next() * 0.15);
      blobs.push(normalizeGeometry(transformed(g, [Math.cos(a) * d, 12.5 + rr.next() * 2, Math.sin(a) * d]), c));
    }
    const canopyGeo = merge(blobs);

    // palm
    const palmParts: THREE.BufferGeometry[] = [];
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const y = i * 0.9;
      const bend = Math.pow(i / segs, 2) * 1.6;
      const g = new THREE.CylinderGeometry(0.17 - i * 0.008, 0.2 - i * 0.008, 0.95, 7);
      palmParts.push(normalizeGeometry(transformed(g, [bend, y + 0.45, 0], new THREE.Euler(0, 0, -0.18 * (i / segs)))));
    }
    const palmTrunk = merge(palmParts);
    const fronds: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const frond = new THREE.PlaneGeometry(0.9, 3.6, 1, 4);
      const p = frond.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const v = (p.getY(k) + 1.8) / 3.6;
        p.setXYZ(k, p.getX(k) * (1 - v * 0.7), p.getY(k), -v * v * 1.6);
      }
      frond.computeVertexNormals();
      fronds.push(normalizeGeometry(transformed(frond, [1.6 + Math.cos(a) * 1.6, 7.3 - 0.4, Math.sin(a) * 1.6], new THREE.Euler(-Math.PI / 2 + 0.5, -a + Math.PI / 2, 0, 'YXZ')), new THREE.Color().setHSL(0.28, 0.55, 0.38)));
    }
    const palmFronds = merge(fronds);

    // fern: arching fronds
    const fern: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rr.next() * 0.4;
      const f = new THREE.PlaneGeometry(0.45, 1.3, 1, 3);
      const p = f.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const v = (p.getY(k) + 0.65) / 1.3;
        p.setXYZ(k, p.getX(k) * (1 - v * 0.6), v * 0.75 - v * v * 0.35, v * 1.1);
      }
      f.computeVertexNormals();
      fern.push(normalizeGeometry(transformed(f, [0, 0.05, 0], new THREE.Euler(0, a, 0)), new THREE.Color().setHSL(0.26 + rr.next() * 0.05, 0.6, 0.32)));
    }
    const fernGeo = merge(fern);

    // grass tuft: crossed blades with vertex colour gradient (dark root, light tip)
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const a = rr.next() * Math.PI;
      const h = 0.35 + rr.next() * 0.45;
      const g = new THREE.BufferGeometry();
      const w = 0.05;
      const lean = (rr.next() - 0.5) * 0.25;
      const ox = (rr.next() - 0.5) * 0.3;
      const oz = (rr.next() - 0.5) * 0.3;
      const verts = new Float32Array([-w, 0, 0, w, 0, 0, lean, h, 0]);
      g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0.3, 1, 0, 0.3, 1, 0, 0.3, 1]), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
      const c0 = new THREE.Color(0.12, 0.2, 0.05);
      const c1 = new THREE.Color().setHSL(0.2 + rr.next() * 0.07, 0.55, 0.42);
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([c0.r, c0.g, c0.b, c0.r, c0.g, c0.b, c1.r, c1.g, c1.b]), 3));
      blades.push(transformed(g, [ox, 0, oz], new THREE.Euler(0, a, 0)));
    }
    const grassGeo = merge(blades);

    const bushParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.IcosahedronGeometry(0.6 + rr.next() * 0.3, 1);
      g.scale(1, 0.7, 1);
      bushParts.push(normalizeGeometry(transformed(g, [(rr.next() - 0.5) * 1.0, 0.45 + rr.next() * 0.3, (rr.next() - 0.5) * 1.0]), new THREE.Color().setHSL(0.27, 0.45, 0.3 + rr.next() * 0.1)));
    }
    const bushGeo = merge(bushParts);

    this.kinds = {
      trunk: { geo: trunkGeo, mat: bark, cast: true },
      canopy: { geo: canopyGeo, mat: swayMaterial(leaf, 0.0012, 'canopy'), cast: true },
      palmTrunk: { geo: palmTrunk, mat: bark, cast: true },
      palmFronds: { geo: palmFronds, mat: swayMaterial(leaf, 0.004, 'palm'), cast: true },
      fern: { geo: fernGeo, mat: swayMaterial(leafDark, 0.12, 'fern'), cast: false },
      grass: { geo: grassGeo, mat: swayMaterial(grass, 0.5, 'grass'), cast: false },
      bush: { geo: bushGeo, mat: swayMaterial(leafDark, 0.05, 'bush'), cast: true },
    };
  }

  static update(t: number, wind: number) {
    SWAY_UNIFORMS.uTime.value = t;
    SWAY_UNIFORMS.uWind.value = wind;
  }

  /** Build instanced meshes for a list of placements. */
  instances(kind: keyof Vegetation['kinds'], placements: { x: number; y: number; z: number; s: number; r: number }[]): THREE.InstancedMesh | null {
    if (placements.length === 0) return null;
    const k = this.kinds[kind];
    const im = new THREE.InstancedMesh(k.geo, k.mat, placements.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      q.setFromEuler(e.set(0, p.r, 0));
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = k.cast;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.userData.sharedGeo = true;
    return im;
  }

  /** Scatter placements over an area with a rejection test. */
  static scatter(rng: Rng, n: number, x0: number, z0: number, x1: number, z1: number, height: (x: number, z: number) => number | null, minS: number, maxS: number) {
    const out: { x: number; y: number; z: number; s: number; r: number }[] = [];
    let tries = 0;
    while (out.length < n && tries++ < n * 8) {
      const x = x0 + rng.next() * (x1 - x0);
      const z = z0 + rng.next() * (z1 - z0);
      const y = height(x, z);
      if (y === null) continue;
      out.push({ x, y, z, s: minS + rng.next() * (maxS - minS), r: rng.next() * Math.PI * 2 });
    }
    return out;
  }
}
