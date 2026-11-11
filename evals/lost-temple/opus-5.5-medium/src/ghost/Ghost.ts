import * as THREE from 'three';
import { Save } from '../core/Save';

/** Records the current run and replays the best escaped run as a translucent figure. */
export class Ghost {
  rec: number[] = [];
  private recT = 0;
  mesh: THREE.Group;
  private data: number[] | null;
  constructor(scene: THREE.Scene) {
    this.data = Save.data.bestGhost;
    this.mesh = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.18, depthWrite: false, fog: true });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 1.1, 4, 8), mat);
    body.position.y = 0.9;
    this.mesh.add(body);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  record(t: number, p: THREE.Vector3, dt: number) {
    this.recT -= dt;
    if (this.recT > 0) return;
    this.recT = 0.25;
    this.rec.push(Math.round(t * 10) / 10, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10);
  }
  update(t: number, zoneC: boolean) {
    const d = this.data;
    if (!d || d.length < 8) { this.mesh.visible = false; return; }
    // find segment
    let i = 0;
    while (i + 4 < d.length && d[i + 4] < t) i += 4;
    if (i + 4 >= d.length) { this.mesh.visible = false; return; }
    const t0 = d[i], t1 = d[i + 4];
    const u = Math.max(0, Math.min(1, (t - t0) / Math.max(0.01, t1 - t0)));
    this.mesh.position.set(d[i + 1] + (d[i + 5] - d[i + 1]) * u, d[i + 2] + (d[i + 6] - d[i + 2]) * u - 0.9, d[i + 3] + (d[i + 7] - d[i + 3]) * u);
    // Hidden in zone C (it would be a light-free but visible shape; keep the dark truly dark)
    this.mesh.visible = !zoneC;
  }
  saveIfBest(value: number) {
    if (value > Save.data.bestGhostValue) {
      Save.data.bestGhost = this.rec.slice(0, 40000);
      Save.data.bestGhostValue = value;
      Save.saveData();
    }
  }
}
