/**
 * Sky dome, sun/moon light with a player-following shadow camera, hemisphere fill, fog
 * and colour grading, all driven by the day clock.
 */
import * as THREE from 'three';
import { gradeAt, sunAt, type Grade } from '../logic/clock';
import { skyUniforms } from '../engine/materials';

const SkyShader = {
  uniforms: {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uNight: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uTop;
    uniform vec3 uHorizon;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform float uNight;
    uniform float uTime;
    varying vec3 vDir;
    float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
    void main() {
      vec3 d = normalize(vDir);
      float h = max(d.y, -0.2);
      vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.05, 0.6, h), 0.7));
      // below the horizon: haze
      col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.2, d.y));
      float sd = max(dot(d, normalize(uSunDir)), 0.0);
      // glow + disc
      col += uSunColor * (pow(sd, 8.0) * 0.35 + pow(sd, 64.0) * 0.6) * (1.0 - uNight * 0.6);
      col += uSunColor * smoothstep(0.9993, 0.9997, sd) * (uNight > 0.5 ? 1.2 : 6.0);
      // stars
      if (uNight > 0.0 && d.y > 0.0) {
        vec3 g = floor(d * 220.0);
        float s = hash(g);
        float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 40.0);
        col += vec3(step(0.9965, s) * tw * uNight * smoothstep(0.0, 0.25, d.y));
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Sky {
  readonly dome: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  grade!: Grade;
  sunDir = new THREE.Vector3(0, 1, 0);
  /** 0..1, how much sky light reaches the player's current scene (0 underground). */
  skyFactor = 1;
  private target = 1;
  private mat: THREE.ShaderMaterial;

  constructor(private scene: THREE.Scene, shadowSize: number) {
    this.mat = new THREE.ShaderMaterial({ ...SkyShader, uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms), side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const cam = this.sun.shadow.camera;
    cam.left = -45;
    cam.right = 45;
    cam.top = 45;
    cam.bottom = -45;
    cam.near = 1;
    cam.far = 220;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd8f0, 0x5a5040, 0.7);
    scene.add(this.hemi);

    this.fog = new THREE.FogExp2(0xc0d0d4, 0.005);
    scene.fog = this.fog;
    scene.background = new THREE.Color(0x000000);
  }

  setShadowSize(n: number) {
    this.sun.shadow.mapSize.set(n, n);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      (this.sun.shadow as any).map = null;
    }
  }

  /** `underground` = the player is in a zone C scene. */
  update(dt: number, elapsed: number, focus: THREE.Vector3, underground: boolean, time: number) {
    this.target = underground ? 0 : 1;
    const k = 1 - Math.exp(-dt * 3);
    this.skyFactor += (this.target - this.skyFactor) * k;
    if (Math.abs(this.skyFactor - this.target) < 0.002) this.skyFactor = this.target;

    const s = sunAt(elapsed);
    const g = gradeAt(elapsed);
    this.grade = g;
    this.sunDir.set(s.dir[0], s.dir[1], s.dir[2]).normalize();

    // light follows the player so shadows stay crisp where it matters
    const snap = 2;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + this.sunDir.x * 110, focus.y + this.sunDir.y * 110, fz + this.sunDir.z * 110);
    this.sun.color.setRGB(g.sunColor[0], g.sunColor[1], g.sunColor[2]);
    const elev = Math.max(0, s.elevationDeg);
    const horizonFade = s.isMoon ? 1 : Math.min(1, elev / 6);
    this.sun.intensity = g.sunIntensity * horizonFade * this.skyFactor;
    this.sun.shadow.autoUpdate = this.skyFactor > 0.001;

    this.hemi.color.setRGB(g.hemiSky[0], g.hemiSky[1], g.hemiSky[2]);
    this.hemi.groundColor.setRGB(g.hemiGround[0], g.hemiGround[1], g.hemiGround[2]);
    this.hemi.intensity = g.hemiIntensity * this.skyFactor;

    // fog: black underground so it never adds light
    const fogCol = new THREE.Color(g.fog[0], g.fog[1], g.fog[2]).multiplyScalar(this.skyFactor);
    this.fog.color.copy(fogCol);
    this.fog.density = underground ? 0.0 : g.fogDensity;
    (this.scene.background as THREE.Color).copy(fogCol);

    const u = this.mat.uniforms;
    u.uTop.value.setRGB(g.skyTop[0], g.skyTop[1], g.skyTop[2]);
    u.uHorizon.value.setRGB(g.skyHorizon[0], g.skyHorizon[1], g.skyHorizon[2]);
    u.uSunDir.value.copy(this.sunDir);
    u.uSunColor.value.setRGB(g.sunColor[0], g.sunColor[1], g.sunColor[2]);
    u.uNight.value = s.isMoon ? 1 : Math.max(0, Math.min(1, (elapsed / 780 - 0.97) * 30));
    u.uTime.value = time;
    this.dome.position.copy(focus);
    this.dome.visible = this.skyFactor > 0.01;

    // zone B ambient tracks the day too (ruins get dimmer, never brighter than outside)
    skyUniforms('ruins').ambient.value = 0.45;
  }

  /** Is the sun (not moon) up and bright enough to make sun-stones solid? */
  get sunUp(): boolean {
    return this.sunDir.y > 0.05 && this.grade && this.grade.sunIntensity > 0.5 && this.mat.uniforms.uNight.value < 0.5;
  }
}
