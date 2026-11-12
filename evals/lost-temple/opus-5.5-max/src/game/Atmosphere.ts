/**
 * Sun, moon, sky dome, hemisphere fill, fog and grading, driven by the day clock and by where
 * the camera is. Zone A gets the full sky; Zone B interiors keep the real sun (it falls through
 * the broken roof with shadows) but only a dim sky fill; Zone C gets nothing at all: no sun, no
 * fill, no sky, black background and fog. Only fire lights Zone C.
 */
import * as THREE from 'three';
import type { Lighting } from '../render/Lighting';
import type { Sky } from '../render/Sky';
import type { Renderer } from '../render/Renderer';
import type { SceneEnv } from '../world/SceneDef';
import { sunDirection, sunElevation, sunColor, sunIntensity, skyAt, gradeAt, MOON_DIR } from '../logic/sun';

const BLACK = new THREE.Color(0, 0, 0);

export class Atmosphere {
  /** Unit vector toward the sun; shared with the scene context (puzzles read it). */
  sunDir = new THREE.Vector3(0, 1, 0);
  elevation = 0;
  sunIntensity = 0;
  night = 0;
  private lightDir = new THREE.Vector3();
  private fog: THREE.Fog;
  private bg = new THREE.Color();
  private moonDir = new THREE.Vector3(...MOON_DIR);

  constructor(private scene: THREE.Scene, private lighting: Lighting, private sky: Sky, private renderer: Renderer) {
    this.fog = new THREE.Fog(0x000000, 60, 320);
    scene.fog = this.fog;
    scene.background = this.bg;
    scene.add(sky.mesh);
  }

  /** True while the real sun is above the horizon (and it is not yet dark). */
  sunUp(isDark: boolean): boolean {
    return !isDark && this.elevation > 0.02;
  }

  update(elapsed: number, dayFrac: number, env: SceneEnv, focus: THREE.Vector3, time: number) {
    const d = sunDirection(elapsed);
    this.sunDir.set(d[0], d[1], d[2]);
    const elev = sunElevation(elapsed);
    this.elevation = elev;
    const sunI = sunIntensity(elev);
    this.sunIntensity = sunI;
    const deg = (elev * 180) / Math.PI;
    this.night = Math.min(1, Math.max(0, (2 - deg) / 12));
    const L = this.lighting;
    const grade = gradeAt(dayFrac);

    if (env === 'dark') {
      // Zone C: the only light is fire.
      L.setSunEnabled(false);
      L.hemi.intensity = 0;
      this.sky.mesh.visible = false;
      this.bg.copy(BLACK);
      this.fog.color.copy(BLACK);
      this.fog.near = 12;
      this.fog.far = 48;
      this.renderer.setGrade(grade, { grain: 0.07, exposureMul: 1.05 });
      return;
    }

    // sun by day, moon at night (moonlight is faint and blue)
    const moonI = 0.32 * this.night;
    let intensity: number;
    if (sunI >= moonI) {
      this.lightDir.copy(this.sunDir);
      const c = sunColor(elev);
      L.sun.color.setRGB(c[0], c[1], c[2]);
      intensity = sunI;
    } else {
      this.lightDir.copy(this.moonDir);
      L.sun.color.setRGB(0.55, 0.66, 1.0);
      intensity = moonI;
    }
    if (intensity < 0.005) {
      L.setSunEnabled(false);
    } else {
      L.setSunEnabled(true);
      L.sun.intensity = intensity;
      L.aimSun(this.lightDir, focus);
    }

    const sk = skyAt(elev);
    L.hemi.color.setRGB(sk.hemiSky[0], sk.hemiSky[1], sk.hemiSky[2]);
    L.hemi.groundColor.setRGB(sk.hemiGround[0], sk.hemiGround[1], sk.hemiGround[2]);
    // interiors: the sky only leaks in through holes, so the fill is dim and the sun shafts read
    L.hemi.intensity = sk.hemiIntensity * (env === 'interior' ? 0.2 : 1);

    const u = this.sky.mat.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    (u.uZenith.value as THREE.Color).setRGB(sk.zenith[0], sk.zenith[1], sk.zenith[2]);
    (u.uHorizon.value as THREE.Color).setRGB(sk.horizon[0], sk.horizon[1], sk.horizon[2]);
    (u.uGround.value as THREE.Color).setRGB(sk.ground[0], sk.ground[1], sk.ground[2]);
    const sc = sunColor(elev);
    (u.uSunColor.value as THREE.Color).setRGB(sc[0], sc[1], sc[2]);
    u.uSunStrength.value = Math.min(1, Math.max(0, (deg + 3) / 6));
    u.uNight.value = this.night;
    u.uTime.value = time;
    this.sky.mesh.visible = true;
    this.sky.mesh.position.copy(focus);

    this.fog.color.setRGB(sk.fog[0], sk.fog[1], sk.fog[2]);
    this.bg.copy(this.fog.color);
    if (env === 'interior') {
      this.fog.near = 30;
      this.fog.far = 150;
    } else {
      this.fog.near = 45;
      this.fog.far = 340;
    }
    this.renderer.setGrade(grade, { grain: 0.035, exposureMul: env === 'interior' ? 1.3 : 1 });
  }
}
