import * as THREE from 'three';

/**
 * WebGL renderer that draws the scene into an HDR render target, then applies a
 * full-screen grading pass: exposure, ACES tone mapping, tint/lift, saturation,
 * contrast, vignette and the red "time's running out" edge pulse.
 */
export class Renderer {
  gl: THREE.WebGLRenderer;
  rt: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  grade: THREE.ShaderMaterial;
  pixelRatio = 1;
  lastCalls = 0;
  lastTris = 0;

  constructor(public canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
    this.grade = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        exposure: { value: 1 },
        tint: { value: new THREE.Color(1, 1, 1) },
        lift: { value: new THREE.Color(0, 0, 0) },
        saturation: { value: 1 },
        contrast: { value: 1 },
        vignette: { value: 0.35 },
        pulse: { value: 0 },
        damage: { value: 0 },
        time: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float exposure; uniform vec3 tint; uniform vec3 lift;
        uniform float saturation; uniform float contrast; uniform float vignette; uniform float pulse; uniform float damage; uniform float time;
        varying vec2 vUv;
        vec3 aces(vec3 x){ const float a=2.51; const float b=0.03; const float c=2.43; const float d=0.59; const float e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
        vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb * exposure;
          c *= tint;
          c = aces(c);
          float l = dot(c, vec3(0.2126,0.7152,0.0722));
          c = mix(vec3(l), c, saturation);
          c = (c - 0.5) * contrast + 0.5;
          c = c + lift * (1.0 - c);
          c = clamp(c, 0.0, 1.0);
          vec2 q = vUv - 0.5;
          float r = length(q * vec2(1.0, 0.8));
          c *= 1.0 - vignette * smoothstep(0.3, 0.85, r);
          float edge = smoothstep(0.35, 0.75, r);
          c = mix(c, vec3(0.7, 0.05, 0.02), edge * pulse * 0.6);
          c = mix(c, vec3(0.6, 0.0, 0.0), edge * damage * 0.7);
          // subtle film grain so true black stays black (grain is multiplicative)
          float g = fract(sin(dot(vUv * (time + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
          c *= 0.97 + 0.06 * g;
          gl_FragColor = vec4(toSRGB(c), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.grade);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  setQuality(q: 'low' | 'medium' | 'high') {
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = q === 'low' ? Math.min(dpr, 0.75) : q === 'medium' ? Math.min(dpr, 1) : Math.min(dpr, 1.5);
    this.rt.samples = q === 'low' ? 0 : 4;
    this.gl.shadowMap.type = q === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.gl.shadowMap.needsUpdate = true;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.rt.setSize(Math.floor(w * this.pixelRatio), Math.floor(h * this.pixelRatio));
  }

  render(scene: THREE.Scene, cam: THREE.Camera) {
    this.gl.setRenderTarget(this.rt);
    this.gl.render(scene, cam);
    this.lastCalls = this.gl.info.render.calls;
    this.lastTris = this.gl.info.render.triangles;
    this.gl.setRenderTarget(null);
    this.gl.render(this.quadScene, this.quadCam);
  }
}
