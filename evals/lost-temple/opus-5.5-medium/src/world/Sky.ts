import * as THREE from 'three';
import { Sky as SkyShader } from 'three/examples/jsm/objects/Sky.js';
import { sunDirection, DAY_LENGTH } from '../logic/countdown';
import { G } from '../core/ctx';
import type { Renderer } from '../core/Renderer';

/** Colour-grading keyframes over the day (progress 0 = dawn, 1 = sunset). */
interface Grade { p: number; tint: [number, number, number]; lift: [number, number, number]; sat: number; contrast: number; exposure: number; fog: number; sun: number; sunCol: number; hemi: number }
const GRADES: Grade[] = [
  { p: 0.0, tint: [1.06, 0.92, 0.8], lift: [0.012, 0.008, 0.0], sat: 0.95, contrast: 1.0, exposure: 1.2, fog: 0xd8b898, sun: 2.2, sunCol: 0xffbe88, hemi: 0.95 },
  { p: 0.12, tint: [1.03, 0.97, 0.9], lift: [0.008, 0.005, 0.0], sat: 1.0, contrast: 1.02, exposure: 1.15, fog: 0xcfc8b4, sun: 2.8, sunCol: 0xffdcb4, hemi: 1.05 },
  { p: 0.5, tint: [1.0, 1.0, 0.97], lift: [0, 0, 0], sat: 1.05, contrast: 1.05, exposure: 1.1, fog: 0xbfcfd0, sun: 3.4, sunCol: 0xfff4e0, hemi: 1.15 },
  { p: 0.82, tint: [1.05, 0.95, 0.84], lift: [0.01, 0.0, 0.0], sat: 1.1, contrast: 1.06, exposure: 1.1, fog: 0xd8b894, sun: 2.9, sunCol: 0xffc890, hemi: 0.95 },
  { p: 0.95, tint: [1.22, 0.78, 0.55], lift: [0.03, 0.0, 0.0], sat: 1.25, contrast: 1.1, exposure: 1.05, fog: 0xc8703c, sun: 2.2, sunCol: 0xff7a3a, hemi: 0.6 },
  { p: 1.0, tint: [1.2, 0.66, 0.48], lift: [0.02, 0.0, 0.0], sat: 1.15, contrast: 1.1, exposure: 0.95, fog: 0x80402a, sun: 0.6, sunCol: 0xff5a20, hemi: 0.3 },
  { p: 1.08, tint: [0.6, 0.72, 1.0], lift: [0.0, 0.0, 0.01], sat: 0.55, contrast: 1.05, exposure: 0.9, fog: 0x0a0e1a, sun: 0.0, sunCol: 0x8090c0, hemi: 0.08 },
];

function sampleGrade(p: number): Grade {
  if (p <= GRADES[0].p) return GRADES[0];
  for (let i = 0; i < GRADES.length - 1; i++) {
    const a = GRADES[i], b = GRADES[i + 1];
    if (p <= b.p) {
      const t = (p - a.p) / (b.p - a.p);
      const L = (x: number, y: number) => x + (y - x) * t;
      const L3 = (x: number[], y: number[]) => [L(x[0], y[0]), L(x[1], y[1]), L(x[2], y[2])] as [number, number, number];
      const ca = new THREE.Color(a.fog).lerp(new THREE.Color(b.fog), t);
      const sa = new THREE.Color(a.sunCol).lerp(new THREE.Color(b.sunCol), t);
      return { p, tint: L3(a.tint, b.tint), lift: L3(a.lift, b.lift), sat: L(a.sat, b.sat), contrast: L(a.contrast, b.contrast), exposure: L(a.exposure, b.exposure), fog: ca.getHex(), sun: L(a.sun, b.sun), sunCol: sa.getHex(), hemi: L(a.hemi, b.hemi) };
    }
  }
  return GRADES[GRADES.length - 1];
}

export class Sky {
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4030, 0.8);
  dome: SkyShader;
  stars: THREE.Points;
  sunVec = new THREE.Vector3();
  /** 1 under the sky, 0 underground. */
  exposure = 1;
  /** Sum of all non-torch scene light intensity this frame (debug: must be 0 in zone C). */
  ambientSum = 0;
  dayness = 1;
  private fog: THREE.Fog;

  constructor(private scene: THREE.Scene, private renderer: Renderer) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi);
    this.dome = new SkyShader();
    this.dome.scale.setScalar(3000);
    const u = this.dome.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
    scene.add(this.dome);
    // Stars
    const sg = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (let i = 0; i < 900; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.05, Math.random() - 0.5).normalize().multiplyScalar(1500);
      pts.push(v.x, v.y, v.z);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
    scene.add(this.stars);
    this.fog = new THREE.Fog(0xb8c8c8, 30, 260);
    scene.fog = this.fog;
  }

  setShadowQuality(q: 'low' | 'medium' | 'high') {
    const s = q === 'low' ? 1024 : q === 'medium' ? 2048 : 4096;
    this.sun.shadow.mapSize.set(s, s);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
  }

  /** How exposed a point is to the sky: 1 in zones A/B, 0 in zone C, blended on the stairs down. */
  exposureAt(p: THREE.Vector3): number {
    const zone = G.world.current.zone;
    if (zone !== 'C') return 1;
    // The catacomb stairwell (between the sanctum seal and the catacombs) fades out.
    if (G.world.current.id === 'catacombs' && p.z > -306 && p.y > -10) return Math.max(0, Math.min(1, (p.y + 8) / 7)) * 0.0;
    return 0;
  }

  update(elapsed: number, dt: number) {
    const d = sunDirection(elapsed);
    this.sunVec.set(d[0], d[1], d[2]);
    const p = elapsed / DAY_LENGTH;
    const g = sampleGrade(p);
    const pl = G.player.position;
    const zone = G.world.current.zone;
    const target = zone === 'C' ? 0 : 1;
    // Fast but not instant fade (seamless transition down the stairs). In zone C it reaches exactly 0.
    this.exposure += (target - this.exposure) * Math.min(1, dt * 3);
    if (target === 0 && this.exposure < 0.01) this.exposure = 0;
    if (target === 1 && this.exposure > 0.99) this.exposure = 1;
    const e = this.exposure;

    this.dayness = Math.max(0, Math.min(1, d[1] * 4));
    const sunUp = Math.max(0, Math.min(1, (d[1] + 0.02) * 12));
    this.sun.intensity = g.sun * sunUp * e;
    this.sun.color.setHex(g.sunCol);
    this.hemi.intensity = g.hemi * e * (zone === 'B' ? 0.55 : 1);
    this.hemi.color.setHex(0xbfd8ff).lerp(new THREE.Color(g.fog), 0.4);
    // Shadow camera follows the player, snapped to texels to stop shimmering.
    const texel = 90 / this.sun.shadow.mapSize.x;
    const cx = Math.round(pl.x / texel) * texel, cz = Math.round(pl.z / texel) * texel;
    this.sun.target.position.set(cx, pl.y, cz);
    const sd = Math.max(0.15, d[1]);
    const dir = new THREE.Vector3(d[0], sd, d[2]).normalize();
    this.sun.position.set(cx + dir.x * 120, pl.y + dir.y * 120, cz + dir.z * 120);
    this.sun.target.updateMatrixWorld();
    this.sun.shadow.autoUpdate = this.sun.intensity > 0;
    if (!this.sun.shadow.autoUpdate) this.sun.shadow.needsUpdate = false;

    // Sky dome and stars hidden underground: no skybox bleed.
    const u = this.dome.material.uniforms;
    u.sunPosition.value.copy(this.sunVec).multiplyScalar(1000);
    u.rayleigh.value = 1.2 + (1 - this.dayness) * 2.5;
    this.dome.visible = e > 0;
    const night = Math.max(0, Math.min(1, -d[1] * 6 + 0.1));
    (this.stars.material as THREE.PointsMaterial).opacity = night * e;
    this.stars.visible = e > 0 && night > 0.01;
    this.stars.position.copy(pl);
    this.dome.position.copy(pl);

    // Fog & clear colour
    const fogCol = new THREE.Color(g.fog).multiplyScalar(e);
    this.fog.color.copy(fogCol);
    if (zone === 'C') { this.fog.near = 2; this.fog.far = 60; this.fog.color.setRGB(0, 0, 0); }
    else if (zone === 'B') { this.fog.near = 20; this.fog.far = 160; }
    else { this.fog.near = 30; this.fog.far = 260 * (0.4 + 0.6 * Math.max(0.2, this.dayness)); }
    this.scene.background = e > 0 ? null : new THREE.Color(0, 0, 0);
    if (!this.dome.visible) this.scene.background = this.blackBg;

    // Grading: in zone C keep a warm neutral grade (torch), otherwise follow the time of day.
    const gr = this.renderer.grade.uniforms;
    const mix = e;
    const torchTint: [number, number, number] = [1.05, 0.95, 0.85];
    gr.tint.value.setRGB(g.tint[0] * mix + torchTint[0] * (1 - mix), g.tint[1] * mix + torchTint[1] * (1 - mix), g.tint[2] * mix + torchTint[2] * (1 - mix));
    gr.lift.value.setRGB(g.lift[0] * mix, g.lift[1] * mix, g.lift[2] * mix); // lift is zero underground: black stays black
    gr.saturation.value = g.sat * mix + 0.95 * (1 - mix);
    gr.contrast.value = g.contrast * mix + 1.08 * (1 - mix);
    gr.exposure.value = g.exposure * mix + 1.15 * (1 - mix);

    this.ambientSum = this.sun.intensity + this.hemi.intensity + (this.lift(gr.lift.value));
  }
  private blackBg = new THREE.Color(0, 0, 0);
  private lift(c: THREE.Color) { return c.r + c.g + c.b; }

  /** Is a world point lit by the sun right now (shadow ray against physics colliders)? */
  sunlit(p: THREE.Vector3, exclude?: unknown): boolean {
    if (this.sunVec.y <= 0.02 || this.exposure <= 0) return false;
    const hit = G.physics.ray(p.x, p.y, p.z, this.sunVec.x, this.sunVec.y, this.sunVec.z, 80, exclude as never);
    return !hit;
  }
}
