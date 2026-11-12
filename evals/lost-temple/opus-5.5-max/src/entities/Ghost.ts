/**
 * The best run so far, replayed as a pale figure walking the same route at the same pace.
 * It is lit like everything else (no glow), so in zone C it only shows in torchlight.
 */
import * as THREE from 'three';
import type { Materials } from '../render/materials';
import { lathe, normalizeGeometry } from '../render/geometry';
import { samplePose, type GhostTrack } from '../logic/save';

export class Ghost {
  obj = new THREE.Group();
  constructor(mats: Materials, root: THREE.Object3D, private track: GhostTrack) {
    const mat = mats.get('ghost');
    const body = new THREE.Mesh(normalizeGeometry(lathe([[0, 0], [0.28, 0.05], [0.3, 0.6], [0.25, 1.2], [0.2, 1.4], [0, 1.45]], 12)), mat);
    const head = new THREE.Mesh(normalizeGeometry(new THREE.SphereGeometry(0.15, 12, 9)), mat);
    head.position.y = 1.62;
    this.obj.add(body, head);
    this.obj.visible = false;
    this.obj.name = 'ghost';
    root.add(this.obj);
  }

  update(t: number, show: boolean) {
    const p = show ? samplePose(this.track, t) : null;
    if (!p) {
      this.obj.visible = false;
      return;
    }
    this.obj.visible = true;
    this.obj.position.set(p.x, p.y, p.z);
    this.obj.rotation.y = p.yaw;
  }

  dispose() {
    this.obj.removeFromParent();
  }
}
