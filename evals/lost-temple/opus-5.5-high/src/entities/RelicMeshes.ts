import * as THREE from 'three';
import type { Materials } from '../world/Materials';
import { RELIC_BY_ID } from '../logic/economy';

const lathe = (pts: [number, number][], seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

/** Build a procedural relic mesh. Returns group + approximate half extents for the collider. */
export function relicMesh(relicId: string, mats: Materials): { obj: THREE.Group; half: THREE.Vector3 } {
  const r = RELIC_BY_ID[relicId];
  const g = new THREE.Group();
  const col = r.color;
  const gold = mats.color(0xd8a838, 0.55, 0.32);
  const main = mats.color(col, r.rarity === 'common' ? 0.05 : 0.45, r.rarity === 'common' ? 0.8 : 0.35);
  const dark = mats.color(0x2a2018, 0.1, 0.8);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  let half = new THREE.Vector3(0.12, 0.12, 0.12);
  switch (r.shape) {
    case 'figurine':
      add(new THREE.CylinderGeometry(0.05, 0.08, 0.18, 8), main, 0, -0.03, 0);
      add(new THREE.SphereGeometry(0.055, 10, 8), main, 0, 0.1, 0);
      half.set(0.08, 0.13, 0.08); break;
    case 'ring':
      add(new THREE.TorusGeometry(0.08, 0.022, 8, 20), main, 0, 0, 0, Math.PI / 2);
      half.set(0.1, 0.03, 0.1); break;
    case 'beads':
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; add(new THREE.SphereGeometry(0.022, 8, 6), main, Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1); }
      half.set(0.12, 0.03, 0.12); break;
    case 'bowl':
      add(lathe([[0.04, -0.06], [0.11, -0.04], [0.15, 0.04], [0.14, 0.05], [0.1, -0.02], [0.0, -0.03]]), main);
      half.set(0.15, 0.06, 0.15); break;
    case 'flute':
      add(new THREE.CylinderGeometry(0.018, 0.022, 0.32, 8), main, 0, 0, 0, 0, 0, Math.PI / 2);
      half.set(0.16, 0.03, 0.03); break;
    case 'dagger':
      add(new THREE.BoxGeometry(0.22, 0.012, 0.05), main, 0.06, 0, 0);
      add(new THREE.BoxGeometry(0.1, 0.03, 0.03), gold, -0.1, 0, 0);
      half.set(0.17, 0.03, 0.04); break;
    case 'scroll':
      add(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 12), main, 0, 0, 0, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6), dark, 0, 0, 0, 0, 0, Math.PI / 2);
      half.set(0.16, 0.045, 0.045); break;
    case 'mirror':
      add(new THREE.CylinderGeometry(0.12, 0.12, 0.015, 20), main, 0, 0, 0);
      add(new THREE.BoxGeometry(0.03, 0.015, 0.12), gold, 0, 0, 0.17);
      half.set(0.13, 0.03, 0.23); break;
    case 'mask': {
      const m = add(new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), main, 0, 0, 0, -Math.PI / 2);
      m.scale.set(1, 1, 0.5);
      add(new THREE.ConeGeometry(0.05, 0.08, 6), main, -0.12, 0.13, 0.02);
      add(new THREE.ConeGeometry(0.05, 0.08, 6), main, 0.12, 0.13, 0.02);
      add(new THREE.SphereGeometry(0.025, 8, 6), dark, -0.06, 0.03, 0.08);
      add(new THREE.SphereGeometry(0.025, 8, 6), dark, 0.06, 0.03, 0.08);
      half.set(0.18, 0.18, 0.1); break;
    }
    case 'urn':
      add(lathe([[0.0, -0.2], [0.12, -0.2], [0.18, -0.05], [0.16, 0.1], [0.08, 0.18], [0.1, 0.22], [0.0, 0.22]], 18), main);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(new THREE.OctahedronGeometry(0.025), mats.color([0xe02040, 0x20c060, 0x3060f0][i % 3], 0.2, 0.15), Math.cos(a) * 0.175, -0.02, Math.sin(a) * 0.175); }
      half.set(0.19, 0.22, 0.19); break;
    case 'serpent':
      add(new THREE.TorusKnotGeometry(0.1, 0.03, 48, 8, 2, 3), main);
      half.set(0.15, 0.15, 0.1); break;
    case 'chalice':
      add(lathe([[0.0, -0.14], [0.09, -0.14], [0.03, -0.1], [0.025, 0.02], [0.1, 0.06], [0.11, 0.14], [0.0, 0.08]], 18), gold);
      half.set(0.11, 0.14, 0.11); break;
    case 'crown':
      add(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 20, 1, true), gold, 0, 0, 0);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(new THREE.ConeGeometry(0.025, 0.09, 6), gold, Math.cos(a) * 0.13, 0.08, Math.sin(a) * 0.13); add(new THREE.OctahedronGeometry(0.018), mats.color(0xff6020, 0.2, 0.2), Math.cos(a) * 0.135, 0.0, Math.sin(a) * 0.135); }
      half.set(0.15, 0.1, 0.15); break;
    case 'skull':
      add(new THREE.SphereGeometry(0.12, 14, 10), main, 0, 0.03, 0);
      add(new THREE.BoxGeometry(0.12, 0.06, 0.1), main, 0, -0.08, 0.03);
      add(new THREE.SphereGeometry(0.03, 8, 6), dark, -0.045, 0.03, 0.1);
      add(new THREE.SphereGeometry(0.03, 8, 6), dark, 0.045, 0.03, 0.1);
      half.set(0.13, 0.15, 0.13); break;
    case 'tablet':
      add(new THREE.BoxGeometry(0.3, 0.4, 0.06), main);
      half.set(0.15, 0.2, 0.03); break;
    case 'idol':
      add(lathe([[0.0, -0.22], [0.13, -0.22], [0.1, -0.1], [0.12, 0.05], [0.08, 0.12], [0.0, 0.12]], 16), gold);
      add(new THREE.BoxGeometry(0.16, 0.14, 0.13), gold, 0, 0.19, 0);
      add(new THREE.BoxGeometry(0.03, 0.03, 0.02), dark, -0.04, 0.2, 0.066);
      add(new THREE.BoxGeometry(0.03, 0.03, 0.02), dark, 0.04, 0.2, 0.066);
      half.set(0.13, 0.27, 0.12); break;
    case 'heart':
      add(new THREE.IcosahedronGeometry(0.17, 0), mats.color(0xd01838, 0.3, 0.12), 0, 0.06, 0);
      add(new THREE.CylinderGeometry(0.12, 0.15, 0.08, 8), gold, 0, -0.15, 0);
      half.set(0.17, 0.23, 0.17); break;
    case 'disc':
      add(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 24), gold, 0, 0, 0, Math.PI / 2);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; add(new THREE.ConeGeometry(0.03, 0.08, 4), gold, Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0, 0, 0, a - Math.PI / 2); }
      half.set(0.26, 0.26, 0.04); break;
    case 'key':
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), main, 0, 0, 0, 0, 0, Math.PI / 2);
      add(new THREE.TorusGeometry(0.05, 0.015, 6, 12), main, -0.18, 0, 0);
      add(new THREE.BoxGeometry(0.03, 0.07, 0.02), main, 0.12, -0.04, 0);
      half.set(0.24, 0.06, 0.05); break;
  }
  return { obj: g, half };
}

/** Plain props: rocks, sandbags, stone blocks, oil flasks, spare torches. */
export function propMesh(kind: string, size: THREE.Vector3, mats: Materials): THREE.Object3D {
  let mesh: THREE.Mesh;
  switch (kind) {
    case 'rock': {
      const g = new THREE.DodecahedronGeometry(1, 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) { const k = 0.85 + ((Math.sin(i * 12.9898) * 43758.5) % 1 + 1) % 1 * 0.3; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
      g.computeVertexNormals();
      mesh = new THREE.Mesh(g, mats.get('rock'));
      mesh.scale.copy(size);
      break;
    }
    case 'sandbag': {
      const g = new THREE.SphereGeometry(1, 12, 8);
      mesh = new THREE.Mesh(g, mats.color(0x9a8058, 0, 1));
      mesh.scale.set(size.x, size.y, size.z);
      break;
    }
    case 'block':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x * 2, size.y * 2, size.z * 2), mats.get('carved'));
      break;
    case 'oil': {
      mesh = new THREE.Mesh(new THREE.LatheGeometry([[0, -0.1], [0.06, -0.1], [0.07, 0.0], [0.03, 0.07], [0.025, 0.11], [0, 0.11]].map(([a, b]) => new THREE.Vector2(a, b)), 12), mats.color(0x7a4a2a, 0.1, 0.5));
      break;
    }
    case 'spare': {
      const g = new THREE.Group();
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.6, 8), mats.get('bark'));
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.12, 8), mats.get('cloth'));
      w.position.y = 0.26;
      g.add(s, w);
      g.rotation.z = Math.PI / 2;
      const outer = new THREE.Group();
      outer.add(g);
      outer.traverse((o) => { o.castShadow = true; });
      return outer;
    }
    default:
      mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x * 2, size.y * 2, size.z * 2), mats.get('sandstone'));
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
