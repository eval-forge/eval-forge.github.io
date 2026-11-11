/** Procedural sky dome: gradient, sun disc and glow, stars at night, drifting cloud wisps. */
import * as THREE from 'three';

const VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform float uSunStrength;
uniform float uNight;
uniform float uTime;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  float a = fract(sin(dot(i, vec2(127.1,311.7)))*43758.5); float b = fract(sin(dot(i+vec2(1,0), vec2(127.1,311.7)))*43758.5);
  float c = fract(sin(dot(i+vec2(0,1), vec2(127.1,311.7)))*43758.5); float d = fract(sin(dot(i+vec2(1,1), vec2(127.1,311.7)))*43758.5);
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uHorizon, uGround, clamp(-h * 4.0, 0.0, 1.0));
  float sd = max(dot(d, uSunDir), 0.0);
  // glow around the sun, stronger near the horizon
  float horizonBoost = 1.0 + 2.5 * (1.0 - clamp(uSunDir.y * 3.0, 0.0, 1.0));
  col += uSunColor * pow(sd, 8.0) * 0.35 * uSunStrength * horizonBoost;
  col += uSunColor * pow(sd, 64.0) * 0.6 * uSunStrength;
  col += uSunColor * smoothstep(0.9993, 0.9997, sd) * 30.0 * uSunStrength;
  // cloud wisps
  if (h > 0.02) {
    vec2 uv = d.xz / (h + 0.15) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
    float c = noise(uv * 2.0) * 0.6 + noise(uv * 5.0) * 0.4;
    c = smoothstep(0.55, 0.85, c) * smoothstep(0.02, 0.25, h);
    vec3 cloudCol = mix(uHorizon * 1.1, uSunColor * 0.9 + uZenith * 0.3, 0.4) * (1.0 - uNight * 0.85);
    col = mix(col, cloudCol, c * 0.55);
  }
  // stars
  if (uNight > 0.01 && h > 0.0) {
    vec3 p = floor(d * 380.0);
    float s = hash(p);
    float star = step(0.9975, s) * (0.5 + 0.5 * sin(uTime * 2.0 + s * 50.0));
    col += vec3(star) * uNight * 0.9 * smoothstep(0.0, 0.2, h);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSunStrength: { value: 1 },
        uNight: { value: 0 },
        uTime: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }
}
