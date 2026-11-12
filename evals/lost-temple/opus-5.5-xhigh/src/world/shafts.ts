/**
 * Visible sun shafts through roof holes (zone B only). Each shaft is a prism extruded
 * from the hole along the live sun direction, drawn additively with a vertical fade.
 * The lit patches on the floor are the real shadow-mapped sun; this is just the haze.
 */
import * as THREE from 'three';
import type { Game } from '../game/Game';

const vert = /* glsl */ `
  attribute float aFade;
  varying float vFade;
  void main() {
    vFade = aFade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const frag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying float vFade;
  void main() {
    float a = uStrength * (0.25 + 0.75 * vFade) * vFade;
    gl_FragColor = vec4(uColor * a, a);
  }`;

export class SunShaft {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  private mat: THREE.ShaderMaterial;
  constructor(group: THREE.Group, private r: { x0: number; x1: number; z0: number; z1: number }, private roofY: number, private floorY: number, private strength = 0.05) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(8 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array([1, 1, 1, 1, 0, 0, 0, 0]), 1));
    // sides of the prism (top 0-3, bottom 4-7)
    g.setIndex([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uColor: { value: new THREE.Color(1, 0.9, 0.7) }, uStrength: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    group.add(this.mesh);
  }

  update(game: Game) {
    const d = game.sky.sunDir;
    const up = game.sky.sunUp && d.y > 0.12;
    this.mesh.visible = up && game.sky.skyFactor > 0.02;
    if (!this.mesh.visible) return;
    const L = (this.roofY - this.floorY) / d.y;
    const ox = -d.x * L;
    const oz = -d.z * L;
    const { x0, x1, z0, z1 } = this.r;
    const top = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
    for (let i = 0; i < 4; i++) {
      this.pos.set([top[i][0], this.roofY, top[i][1]], i * 3);
      this.pos.set([top[i][0] + ox, this.floorY, top[i][1] + oz], (i + 4) * 3);
    }
    this.mesh.geometry.getAttribute('position').needsUpdate = true;
    const g = game.sky.grade;
    this.mat.uniforms.uColor.value.setRGB(g.sunColor[0], g.sunColor[1], g.sunColor[2]);
    this.mat.uniforms.uStrength.value = this.strength * Math.min(1, g.sunIntensity / 2.5) * game.sky.skyFactor;
  }
}
