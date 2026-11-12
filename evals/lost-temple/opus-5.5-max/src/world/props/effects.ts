/**
 * Visual effects tied to the real sun: light shafts through roof openings that lean with the
 * sun and fade when the opening is not in direct sunlight.
 */
import * as THREE from 'three';
import type { SceneCtx, SceneRuntime } from '../SceneDef';
import type { Prop } from '../types';

let shaftGeo: THREE.BufferGeometry | null = null;

/** Four side faces of the unit cube [0,1]^3 (no caps). uv.y runs bottom (0) to top (1). */
function unitShaftGeometry(): THREE.BufferGeometry {
  if (shaftGeo) return shaftGeo;
  const pos: number[] = [];
  const uv: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    // a,b bottom; c,d top
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  };
  quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]);
  quad([1, 0, 1], [0, 0, 1], [0, 1, 1], [1, 1, 1]);
  quad([0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]);
  quad([1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  shaftGeo = g;
  return g;
}

export class SunShaft implements Prop {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private lit = 0;
  private target = 0;
  private checkT = Math.random() * 0.5;
  private probe: THREE.Vector3;
  private moteT = 0;
  constructor(private ctx: SceneCtx, rt: SceneRuntime, public id: string, private hole: [number, number, number, number], private yTop: number, private yFloor: number, private strength = 1) {
    this.mat = ctx.mats.shaft.clone();
    this.mesh = new THREE.Mesh(unitShaftGeometry(), this.mat);
    this.mesh.userData.sharedGeo = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    rt.group.add(this.mesh);
    this.probe = new THREE.Vector3((hole[0] + hole[2]) / 2, yTop - 0.3, (hole[1] + hole[3]) / 2);
    rt.onDispose(() => this.mat.dispose());
  }
  update(dt: number) {
    const d = this.ctx.sunDir;
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.4;
      this.target = this.ctx.sunUp() && d.y > 0.08 && this.ctx.litBySun(this.probe) ? 1 : 0;
    }
    this.lit += (this.target - this.lit) * Math.min(1, dt * 1.5);
    // a low sun makes long, nearly level beams that read as grey smears: fade those out
    const elevK = Math.min(1, Math.max(0, (d.y - 0.16) / 0.4));
    const intensity = this.lit * elevK * 0.32 * this.strength;
    // from inside zone C even a distant sunbeam would be light that is not fire: hide it
    this.mesh.visible = intensity > 0.004 && !this.ctx.cameraDark();
    if (!this.mesh.visible) return;
    this.mat.uniforms.uIntensity.value = intensity;
    this.mat.uniforms.uTime.value = this.ctx.time();
    const len = (this.yTop - this.yFloor) / Math.max(0.3, d.y);
    const [x0, z0, x1, z1] = this.hole;
    // parallelepiped: x across the hole, y along the light (bottom = floor end), z across the hole
    const m = this.mesh.matrix;
    m.set(
      x1 - x0, d.x * len, 0, x0 - d.x * len,
      0, d.y * len, 0, this.yTop - d.y * len,
      0, d.z * len, z1 - z0, z0 - d.z * len,
      0, 0, 0, 1,
    );
    this.mesh.matrixWorldNeedsUpdate = true;
    // dust motes drifting in the light
    this.moteT -= dt;
    if (this.moteT <= 0) {
      this.moteT = 0.12;
      const u = Math.random();
      const p = new THREE.Vector3(x0 + Math.random() * (x1 - x0), this.yTop, z0 + Math.random() * (z1 - z0)).addScaledVector(d, -len * u);
      this.ctx.fx.mote(p, 0.4);
    }
  }
  dispose() {}
}
