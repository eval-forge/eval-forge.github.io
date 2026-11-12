/**
 * Procedural meshes for relics and props. Every relic shape is built from primitives
 * (lathes, tori, boxes) and a material chosen from its colour. Geometries are cached.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RELIC_BY_ID, type RelicShape } from '../logic/economy';
import { standard, surface, tinted, type Exposure } from '../engine/materials';
import { textures } from '../engine/textures';
import type { ItemKind } from '../game/RunState';

const geoCache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    g.computeBoundingBox();
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return g;
}

function lathe(pts: [number, number][], seg = 18): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  for (const p of norm) {
    for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') p.deleteAttribute(k);
    if (!p.getAttribute('uv')) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((p.getAttribute('position').count) * 2), 2));
  }
  const m = mergeGeometries(norm, false)!;
  return m;
}

function t(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1): THREE.BufferGeometry {
  g.scale(s, s, s);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/** Geometry for each relic shape, centred on its bounding box. */
function relicGeometry(shape: RelicShape): THREE.BufferGeometry {
  return cached('relic:' + shape, () => {
    let g: THREE.BufferGeometry;
    switch (shape) {
      case 'bowl':
        g = lathe([[0.001, 0], [0.12, 0.01], [0.2, 0.06], [0.24, 0.14], [0.22, 0.15], [0.17, 0.08], [0.001, 0.05]]);
        break;
      case 'ring':
        g = new THREE.TorusGeometry(0.09, 0.025, 8, 20);
        g.rotateX(Math.PI / 2);
        break;
      case 'flute':
        g = merge([t(new THREE.CylinderGeometry(0.025, 0.03, 0.42, 8), 0, 0, 0, 0, 0, Math.PI / 2), t(new THREE.TorusGeometry(0.03, 0.008, 4, 8), -0.1, 0, 0, 0, Math.PI / 2), t(new THREE.TorusGeometry(0.03, 0.008, 4, 8), 0.08, 0, 0, 0, Math.PI / 2)]);
        break;
      case 'blade': {
        const s = new THREE.Shape();
        s.moveTo(0, 0);
        s.lineTo(0.06, 0.05);
        s.lineTo(0.05, 0.32);
        s.lineTo(0, 0.42);
        s.lineTo(-0.05, 0.32);
        s.lineTo(-0.06, 0.05);
        s.closePath();
        const b = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1 });
        g = merge([t(b, 0, 0, 0, Math.PI / 2), t(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 6), 0, 0, 0.06, Math.PI / 2)]);
        break;
      }
      case 'beads': {
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          parts.push(t(new THREE.IcosahedronGeometry(0.035, 0), Math.cos(a) * 0.15, 0, Math.sin(a) * 0.12));
        }
        g = merge(parts);
        break;
      }
      case 'scroll':
        g = merge([t(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 12), 0, 0, 0, 0, 0, Math.PI / 2), t(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 12), 0.2, 0, 0, 0, 0, Math.PI / 2), t(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 12), -0.2, 0, 0, 0, 0, Math.PI / 2)]);
        break;
      case 'chalice':
        g = lathe([[0.001, 0], [0.11, 0], [0.11, 0.02], [0.03, 0.05], [0.025, 0.18], [0.05, 0.2], [0.12, 0.28], [0.13, 0.36], [0.11, 0.36], [0.001, 0.25]]);
        break;
      case 'crown': {
        const parts: THREE.BufferGeometry[] = [t(new THREE.TorusGeometry(0.15, 0.03, 6, 16), 0, 0, 0, Math.PI / 2)];
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          parts.push(t(new THREE.ConeGeometry(0.035, 0.32, 4), Math.cos(a) * 0.16, 0.17, Math.sin(a) * 0.16, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35));
        }
        g = merge(parts);
        break;
      }
      case 'ingot':
        g = new THREE.BoxGeometry(0.34, 0.12, 0.17);
        break;
      case 'urn':
        g = lathe([[0.001, 0], [0.12, 0], [0.2, 0.12], [0.24, 0.3], [0.18, 0.48], [0.1, 0.55], [0.13, 0.62], [0.11, 0.62], [0.001, 0.58]]);
        break;
      case 'eagle': {
        const body = t(new THREE.ConeGeometry(0.1, 0.38, 6), 0, 0.27, 0);
        const head = t(new THREE.SphereGeometry(0.07, 8, 6), 0, 0.49, 0.02);
        const wingL = t(new THREE.BoxGeometry(0.32, 0.03, 0.12), -0.18, 0.36, 0, 0, 0, 0.5);
        const wingR = t(new THREE.BoxGeometry(0.32, 0.03, 0.12), 0.18, 0.36, 0, 0, 0, -0.5);
        const base = t(new THREE.CylinderGeometry(0.12, 0.14, 0.08, 10), 0, 0.04, 0);
        g = merge([body, head, wingL, wingR, base]);
        break;
      }
      case 'mask': {
        const face = new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
        face.scale(1, 1.25, 0.55);
        face.rotateX(-Math.PI / 2);
        const nose = t(new THREE.ConeGeometry(0.035, 0.12, 4), 0, -0.02, 0.12, -Math.PI / 2 + 0.3);
        g = merge([face, nose]);
        break;
      }
      case 'scepter':
        g = merge([
          t(new THREE.CylinderGeometry(0.025, 0.03, 0.75, 8), 0, 0.37, 0),
          t(new THREE.TorusGeometry(0.06, 0.02, 6, 12, Math.PI * 1.4), 0, 0.78, 0),
          t(new THREE.SphereGeometry(0.05, 8, 6), 0, 0.86, 0),
        ]);
        break;
      case 'heart':
        g = new THREE.OctahedronGeometry(0.12, 1);
        g.scale(1, 1.2, 0.8);
        break;
      case 'skull': {
        const cran = t(new THREE.SphereGeometry(0.16, 14, 10), 0, 0.17, 0);
        const jaw = t(new THREE.BoxGeometry(0.17, 0.08, 0.14), 0, 0.04, 0.06);
        g = merge([cran, jaw]);
        break;
      }
      case 'jaguar': {
        const body = t(new THREE.CapsuleGeometry(0.11, 0.38, 4, 8), 0, 0.28, 0, 0, 0, Math.PI / 2);
        const head = t(new THREE.SphereGeometry(0.11, 10, 8), 0.3, 0.38, 0);
        const legs = [-0.15, 0.15].flatMap((x) => [-0.07, 0.07].map((z) => t(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6), x, 0.11, z)));
        const base = t(new THREE.BoxGeometry(0.6, 0.04, 0.24), 0, 0.02, 0);
        g = merge([body, head, ...legs, base]);
        break;
      }
      case 'chest': {
        const box = t(new THREE.BoxGeometry(0.7, 0.4, 0.45), 0, 0.2, 0);
        const lid = t(new THREE.CylinderGeometry(0.225, 0.225, 0.7, 12, 1, false, 0, Math.PI), 0, 0.4, 0, 0, 0, Math.PI / 2);
        lid.rotateX(0);
        g = merge([box, lid]);
        break;
      }
      case 'statue': {
        const base = t(new THREE.BoxGeometry(0.42, 0.12, 0.42), 0, 0.06, 0);
        const legs = t(new THREE.BoxGeometry(0.26, 0.4, 0.18), 0, 0.32, 0);
        const torso = t(new THREE.BoxGeometry(0.34, 0.38, 0.2), 0, 0.71, 0);
        const head = t(new THREE.BoxGeometry(0.2, 0.22, 0.2), 0, 1.01, 0);
        const hat = t(new THREE.ConeGeometry(0.16, 0.16, 4), 0, 1.2, 0, 0, Math.PI / 4);
        g = merge([base, legs, torso, head, hat]);
        break;
      }
      case 'idol': {
        const base = t(new THREE.CylinderGeometry(0.16, 0.19, 0.1, 12), 0, 0.05, 0);
        const body = t(new THREE.CylinderGeometry(0.1, 0.15, 0.35, 10), 0, 0.27, 0);
        const head = t(new THREE.SphereGeometry(0.12, 12, 8), 0, 0.52, 0);
        const rays: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          rays.push(t(new THREE.ConeGeometry(0.03, 0.14, 4), Math.cos(a) * 0.17, 0.52 + Math.sin(a) * 0.17, -0.02, 0, 0, a - Math.PI / 2));
        }
        g = merge([base, body, head, ...rays]);
        break;
      }
    }
    g.computeBoundingBox();
    const c = g.boundingBox!.getCenter(new THREE.Vector3());
    g.translate(-c.x, -c.y, -c.z);
    g.computeVertexNormals();
    return g;
  });
}

function relicMaterial(defId: string, exp: Exposure): THREE.Material {
  const def = RELIC_BY_ID[defId];
  const metallic = ['ring', 'chalice', 'ingot', 'eagle', 'scepter', 'jaguar', 'statue', 'idol'].includes(def.shape) || def.id === 'sun_mask';
  const glassy = def.shape === 'skull' || def.shape === 'heart';
  if (metallic) return tinted(def.color, exp, 0.3, 1);
  if (glassy) return tinted(def.color, exp, 0.08, 0.1, { transparent: true, opacity: 0.85 });
  if (def.shape === 'chest') return surface('wood', exp);
  return tinted(def.color, exp, 0.6, 0.05);
}

export function relicMesh(defId: string, exp: Exposure): THREE.Mesh {
  const def = RELIC_BY_ID[defId];
  const m = new THREE.Mesh(relicGeometry(def.shape), relicMaterial(defId, exp));
  m.castShadow = true;
  m.receiveShadow = true;
  if (def.shape === 'chest') {
    // gold trim on the chest
    const trim = new THREE.Mesh(cached('chestTrim', () => new THREE.BoxGeometry(0.72, 0.06, 0.47)), surface('gold', exp));
    trim.position.y = 0.0;
    m.add(trim);
  }
  return m;
}

function propGeometry(kind: ItemKind): THREE.BufferGeometry {
  return cached('prop:' + kind, () => {
    let g: THREE.BufferGeometry;
    switch (kind) {
      case 'sandbag': {
        const b = new THREE.SphereGeometry(0.3, 12, 8);
        b.scale(1.3, 0.62, 0.9);
        g = b;
        break;
      }
      case 'rock':
        g = new THREE.DodecahedronGeometry(0.3, 0);
        g.scale(1.1, 0.8, 1);
        break;
      case 'pot':
        g = lathe([[0.001, 0], [0.14, 0], [0.24, 0.16], [0.25, 0.3], [0.16, 0.46], [0.13, 0.5], [0.15, 0.54], [0.12, 0.54], [0.001, 0.5]]);
        break;
      case 'oil':
        g = lathe([[0.001, 0], [0.07, 0], [0.09, 0.08], [0.08, 0.14], [0.03, 0.18], [0.03, 0.24], [0.04, 0.25], [0.001, 0.25]], 10);
        break;
      case 'spareTorch':
        g = merge([t(new THREE.CylinderGeometry(0.035, 0.03, 0.6, 7), 0, 0, 0), t(new THREE.CylinderGeometry(0.06, 0.05, 0.14, 7), 0, 0.3, 0)]);
        g.rotateZ(Math.PI / 2);
        break;
      case 'boneKey':
        g = merge([
          t(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 6), 0, 0, 0, 0, 0, Math.PI / 2),
          t(new THREE.SphereGeometry(0.05, 8, 6), -0.19, 0.02, 0),
          t(new THREE.SphereGeometry(0.05, 8, 6), -0.19, -0.03, 0),
          t(new THREE.BoxGeometry(0.06, 0.08, 0.02), 0.16, -0.04, 0),
        ]);
        break;
      case 'sunDisc':
        g = new THREE.CylinderGeometry(0.28, 0.28, 0.05, 24);
        g.rotateX(Math.PI / 2);
        break;
      default:
        g = new THREE.DodecahedronGeometry(0.25, 0);
    }
    g.computeBoundingBox();
    const c = g.boundingBox!.getCenter(new THREE.Vector3());
    g.translate(-c.x, -c.y, -c.z);
    g.computeVertexNormals();
    return g;
  });
}

export function propMesh(kind: ItemKind, exp: Exposure): THREE.Mesh {
  let mat: THREE.Material;
  switch (kind) {
    case 'sandbag':
      mat = surface('sand', exp);
      break;
    case 'rock':
    case 'debris':
      mat = surface('rock', exp);
      break;
    case 'pot':
      mat = tinted(0xa0583a, exp, 0.85);
      break;
    case 'oil':
      mat = tinted(0x5a7a40, exp, 0.2, 0.1, { transparent: true, opacity: 0.9 });
      break;
    case 'spareTorch':
      mat = surface('wood', exp);
      break;
    case 'boneKey':
      mat = surface('bone', exp);
      break;
    case 'sunDisc':
      mat = surface('gold', exp);
      break;
    default:
      mat = surface('rock', exp);
  }
  const m = new THREE.Mesh(propGeometry(kind), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  if (kind === 'sunDisc') {
    const face = new THREE.Mesh(
      cached('discFace', () => new THREE.CircleGeometry(0.26, 24)),
      standard('discGlyph', exp, { map: textures().glyphs, color: 0x8a6010, transparent: true, alphaTest: 0.3, roughness: 0.4, metalness: 0.8 }),
    );
    face.position.z = 0.027;
    m.add(face);
  }
  return m;
}

/** Half extents of an item's collider. */
export function halfExtents(mesh: THREE.Mesh): THREE.Vector3 {
  const bb = mesh.geometry.boundingBox!;
  const s = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  return s.max(new THREE.Vector3(0.04, 0.04, 0.04));
}
