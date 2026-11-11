import * as THREE from 'three';
import type { SceneDef } from '../SceneBase';
import { box3, looseRelics } from '../SceneBase';
import { pillar, rubble, statue, fallenPillar, hangingVines } from '../decor';
import { Gate, Pedestal, DartTraps, Debris, Lever } from '../../entities/Traps';
import { clamp } from '../../logic/vec';

export const ALTAR = new THREE.Vector3(12, 1.2, -92);
export const SANCTUM_COVER = { min: new THREE.Vector3(0, -1, -112), max: new THREE.Vector3(25, 14, -62), ceiling: 14 };

export const sanctum: SceneDef = {
  id: 'sanctum',
  name: 'Collapsed sanctum',
  zone: 'B',
  bounds: [box3(-26, -4, -113, 26, 40, -63)],
  exposure: (p) => {
    if (p.x > -13.2 && p.x < -6.8 && p.z < -97.5 && p.y < 0.2) return { outdoor: clamp(1 + p.y / 4, 0, 1), ambient: 0.4 };
    return { outdoor: 1, ambient: p.x > 0 ? 0.35 : 0.6 };
  },
  sconces: [
    { id: 's_1', pos: new THREE.Vector3(24.7, 2.3, -75), normal: new THREE.Vector3(-1, 0, 0) },
    { id: 's_2', pos: new THREE.Vector3(24.7, 2.3, -100), normal: new THREE.Vector3(-1, 0, 0) },
    { id: 's_3', pos: new THREE.Vector3(-13.7, -6, -105), normal: new THREE.Vector3(1, 0, 0) },
  ],
  build(b) {
    b.floor(-25, -112, -13, -62, 0, 'flag');
    b.floor(-7, -112, 25, -62, 0, 'flag');
    b.floor(-13, -98, -7, -62, 0, 'flag');
    b.wallX(-25.5, -113, -62, 0, 14, 'mossy');
    b.wallX(25.5, -113, -62, 0, 15, 'sandstone');
    b.wallZ(-112.5, -26, 26, 0, 15, 'carved');
    // east half roof (unstable), with an oculus over the altar
    const R = 14;
    b.ceiling(0, -112, 25, -93.5, R, 'sandstone', 1.5);
    b.ceiling(0, -90.5, 25, -62, R, 'sandstone', 1.5);
    b.ceiling(0, -93.5, 10.5, -90.5, R, 'sandstone', 1.5);
    b.ceiling(13.5, -93.5, 25, -90.5, R, 'sandstone', 1.5);
    // jagged broken edge of the roof + beams across the open half
    for (let z = -110; z < -62; z += 6) b.box(-0.5 - (z % 12 === 0 ? 2 : 0.8), R + 0.4, z + 2, 2.5, 1.2, 3, 'sandstone', { rotY: z * 0.3 });
    for (const z of [-75, -95]) b.aabb(-25, R, z - 0.5, 0, R + 1, z + 0.5, 'sandstone');
    // fallen roof slabs in the open west half
    b.box(-18, 0.6, -70, 7, 1.2, 4, 'sandstone', { rotY: 0.3, rotZ: 0.15 });
    b.box(-20, 0.8, -88, 5, 1.6, 5, 'sandstone', { rotY: -0.4, rotX: 0.12 });
    rubble(b, -24, -110, -15, -95, 0, 25, 81, 'mossy', 1.2);
    rubble(b, -6, -80, 0, -66, 0, 12, 82, 'sandstone', 0.9);
    fallenPillar(b, -4, -108, 0, 8, 0.2, 0.9, 'mossy');
    for (const z of [-70, -82, -104]) { pillar(b, 4, z, 0, R, 0.9, 'sandstone'); pillar(b, 21, z, 0, R, 0.9, 'sandstone'); }
    // altar dais
    b.aabb(7, 0, -97, 17, 0.6, -87, 'carved');
    b.aabb(8.5, 0.6, -95.5, 15.5, 1.2, -88.5, 'carved');
    b.ramp(10.5, -87, 13.5, -84, 'z', 0.6, 0, 'carved');
    statue(b, 7.5, -98.5, 1.2 - 1.2, Math.PI, 'sandstone', 1.6);
    statue(b, 16.5, -98.5, 0, Math.PI, 'sandstone', 1.6);
    hangingVines(b, -24, -110, -2, -64, 14, 20, 15);
    // catacomb stairwell under the seal (0 at z -98 → -12 at z -112)
    b.ramp(-13, -98, -7, -112, 'z', 0, -12, 'dungeon');
    b.aabb(-14, -13, -112, -13, 0, -98, 'dungeon');
    b.aabb(-7, -13, -112, -6, 0, -98, 'dungeon');
    b.aabb(-14, -13, -98.5, -6, -1, -97.9, 'dungeon', { collide: false });
  },
  props(seed) {
    return [
      ...looseRelics('sanctum', seed, [[-20, 2.0, -88], [20, 0.5, -108], [-22, 0.5, -64], [22, 0.5, -66]]),
      { id: 's_idol', kind: 'relic', relicId: 'idol', pos: [12, 2.6, -92], origin: 'sanctum', sleeping: true },
      { id: 's_bag', kind: 'sandbag', pos: [3, 0.5, -66], origin: 'sanctum', mass: 7.3, size: [0.32, 0.2, 0.26] },
      { id: 's_rock', kind: 'rock', pos: [-3, 0.5, -84], origin: 'sanctum', mass: 6.6, size: [0.21, 0.18, 0.21] },
      { id: 's_rock2', kind: 'rock', pos: [18, 0.5, -76], origin: 'sanctum', mass: 4.0, size: [0.18, 0.15, 0.18] },
      { id: 's_oil', kind: 'oil', pos: [-10, 0.5, -95], origin: 'sanctum' },
    ];
  },
  spawn(ctx, rt) {
    const run = ctx.run();
    // ---- debris: noise under the unstable roof brings masonry down
    const debris = rt.add(new Debris(ctx, [SANCTUM_COVER]));
    (ctx as any).sanctumDebris = debris;
    rt.onDetach(() => { (ctx as any).sanctumDebris = null; });

    // ---- the idol pedestal: weight trap + the collapse when the idol leaves
    const darts = rt.add(new DartTraps(ctx));
    for (const z of [-89, -92, -95]) {
      darts.add(new THREE.Vector3(24.9, 3.0, z), new THREE.Vector3(-1, -0.08, 0));
      darts.add(new THREE.Vector3(0.2, 3.0, z + 1), new THREE.Vector3(1, -0.08, 0));
    }
    let volleys = 0, vt = 0;
    rt.add(new Pedestal(ctx, 's_ped', new THREE.Vector3(ALTAR.x, ALTAR.y + 1.1, ALTAR.z), () => {
      ctx.message('The pedestal sinks. Darts!');
      volleys = 5;
    }));
    rt.every((dt) => {
      if (volleys > 0) { vt -= dt; if (vt <= 0) { vt = 0.4; volleys--; darts.fire(); } }
      // collapse sequence when the idol leaves the altar
      if (!run.flags.idolTaken && (run.has('idol') || run.entities.get('prop:s_idol')?.removed || idolGone())) {
        ctx.setFlag('idolTaken');
        debris.collapse = 22;
        run.dayPenalty += 60;
        ctx.audio.play('collapse', ALTAR, 1);
        ctx.shake(0.8);
        ctx.message('The sanctum is coming down! The temple\'s fury hastens the night (-1:00).', 5);
      }
    });
    const idolGone = () => {
      const p = ctx.props.props.get('s_idol');
      if (!p) return false;
      const t = p.body.translation();
      return Math.hypot(t.x - ALTAR.x, t.z - ALTAR.z) > 1.5;
    };

    // ---- light beam through the oculus onto the idol
    const beamGeo = new THREE.CylinderGeometry(1.4, 1.9, 14, 20, 1, true);
    beamGeo.translate(0, -7, 0);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(ALTAR.x, 14, ALTAR.z);
    rt.object(beam);
    rt.every(() => {
      const night = ctx.isNight();
      const sunUp = Math.max(0, Math.sin(Math.min(Math.PI / 2, (ctx.remaining() / 780) * Math.PI)));
      beamMat.opacity = night ? 0 : 0.05 + 0.1 * sunUp;
    });

    // ---- catacomb seal: needs the sun-disc
    const seal = rt.add(new Gate(ctx, 'catSeal', new THREE.Vector3(-10, -0.2, -105), new THREE.Vector3(6, 0.4, 14), 14.6, 2.2, 'carved', true, new THREE.Vector3(0, 0, -1)));
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.05, 24), ctx.mats.get('bronze'));
    disc.position.set(-10, 0.03, -103);
    if (!run.flags.sealOpen) rt.object(disc);
    rt.interact({
      pos: new THREE.Vector3(-10, 0.5, -103), radius: 3,
      prompt: () => {
        if (run.flags.sealOpen) return null;
        return run.has('sundisc') ? 'E: set the sun-disc into the seal' : 'A sealed stone with a sun-shaped socket. (Needs the sun-disc)';
      },
      act: () => {
        if (run.flags.sealOpen || !run.has('sundisc')) { ctx.audio.play('deny'); return; }
        const i = run.carried.findIndex((c) => c.relicId === 'sundisc');
        run.carried.splice(i, 1);
        ctx.setFlag('sealOpen');
        seal.set(1);
        ctx.scene.remove(disc);
        ctx.audio.play('door', seal.pos, 1);
        ctx.shake(0.3);
        ctx.message('The seal slides away. Stairs lead down into the dark.');
      },
    });
    if (run.flags.sealOpen) seal.set(1);

    // ---- lever to jam the sanctum gate open (escape safety)
    rt.add(new Lever(ctx, 's_jam', new THREE.Vector3(5, 0, -64.5), Math.PI, 'jam the gate open', () => {
      run.entities.set('gateJammed', true);
      ctx.setFlag('sanctumGateHeld');
      ctx.message('The gate is wedged open for good.');
    }));
  },
};
