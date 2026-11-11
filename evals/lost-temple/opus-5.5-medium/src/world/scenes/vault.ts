import * as THREE from 'three';
import { SceneChunk } from '../SceneChunk';
import { materials } from '../textures';
import { mulberry32 } from '../../logic/rng';
import { G } from '../../core/ctx';
import { loot, slab, ceiling, wallX, wallZ, rubble, skeleton, pickup, pillar } from './common';
import { Mover, Lever } from '../../entities/Door';
import { DartTrap } from '../../entities/Traps';
import { Pedestal } from '../../entities/Loot';
import { instanced, mat4 } from '../kit';
import { DAY_LENGTH } from '../../logic/countdown';

const FLOOR = -14;

export class Vault extends SceneChunk {
  id = 'vault' as const;
  zone = 'C' as const;
  name = 'Deep Vault';
  gate!: Mover;
  grate!: Mover;
  escape!: Mover;
  volley!: DartTrap;

  build() {
    const m = materials();
    const W = m.darkStone, F = m.cave;
    const rnd = mulberry32(G.seed ^ 0x7777);
    this.bounds.set(new THREE.Vector3(-46, -20, -430), new THREE.Vector3(20, -6, -375));
    this.areas = [new THREE.Box3(new THREE.Vector3(-46, -20, -430), new THREE.Vector3(19.2, -6, -375.4))];
    this.navRegions = [{ min: new THREE.Vector3(-45, -15, -429), max: new THREE.Vector3(19, -9, -376) }];
    this.neighbours = ['catacombs', 'tunnel'];

    // Main vault hall
    slab(this.b, -18, 18, -375.5, -428, FLOOR, F);
    ceiling(this.b, -19, 19, -375.5, -429, -8, W);
    wallZ(this.b, -375.5, -19, 19, FLOOR, 6, 1, W, [{ a: -2, b: 2, h: 4 }]);
    wallZ(this.b, -428.5, -19, 19, FLOOR, 6, 1, W);
    wallX(this.b, -18.5, -375.5, -428.5, FLOOR, 6, 1, W, [{ a: -400, b: -410, h: 4 }]);
    wallX(this.b, 18.5, -375.5, -428.5, FLOOR, 6, 1, W, [{ a: -418, b: -422, h: 3.5 }]);
    for (const z of [-385, -397, -409, -421]) { pillar(this.b, -10, z, FLOOR, 6, W, 0.8); pillar(this.b, 10, z, FLOOR, 6, W, 0.8); }
    // Raised treasury dais at the back
    this.b.box(30, 0.5, 10, 0, FLOOR + 0.25, -422, m.stone, { cast: false });

    // Bronze gate from the catacombs (needs the Bronze Key)
    const bars = new THREE.Group();
    for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4, 6), m.bronze); b.position.x = -1.8 + i * 0.45; bars.add(b); }
    for (const y of [-1.5, 0, 1.5]) { const h = new THREE.Mesh(new THREE.BoxGeometry(4, 0.12, 0.12), m.bronze); h.position.y = y; bars.add(h); }
    this.gate = new Mover(this, new THREE.Vector3(4, 4, 0.3), { pos: new THREE.Vector3(0, FLOOR + 2, -375.3) }, { pos: new THREE.Vector3(0, FLOOR + 5.9, -375.3) }, m.bronze, 0.5, false, bars);
    this.gate.onArrive = () => G.nav.setBlocked(new THREE.Box3(new THREE.Vector3(-2, -15, -376.5), new THREE.Vector3(2, -10, -374)), false);
    this.interactables.push({
      pos: new THREE.Vector3(0, FLOOR + 1.3, -374.6), radius: 2.5,
      label: () => (G.flags.vaultGateOpen ? null : G.satchel.has('bronzekey') ? 'Unlock the bronze gate' : 'A bronze gate with a heavy lock. (It needs a Bronze Key)'),
      act: () => {
        if (!G.satchel.has('bronzekey')) { G.audio.denied(); G.toast('Locked. Something in the flooded chamber might fit...'); return; }
        G.satchel.takeType('bronzekey');
        G.setFlag('vaultGateOpen');
        this.gate.setOpen(true);
        G.toast('The key turns with a grinding clank. The Deep Vault opens.', 3);
      },
    });

    // Treasure heaps (gold coins, purely decorative; no glow, only torchlight reflects off them)
    const coin = new THREE.CylinderGeometry(0.06, 0.06, 0.012, 8);
    const cm: THREE.Matrix4[] = [];
    for (const [hx, hz, r] of [[-12, -417, 2.2], [12, -417, 2.2], [-6, -390, 1.4], [14, -392, 1.6], [0, -424, 2.8]] as const) {
      for (let i = 0; i < 260; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
        const y = FLOOR + 0.01 + (1 - d / r) * 0.6 * rnd() + (hz < -420 ? 0.5 : 0);
        cm.push(mat4(hx + Math.cos(a) * d, y, hz + Math.sin(a) * d, rnd() * 3, 1, 1, 1, rnd() - 0.5, rnd() - 0.5));
      }
    }
    this.group.add(instanced(coin, m.gold, cm, false));

    // Loot (the richest in the temple)
    const spots: [number, number, number][] = [[-15, FLOOR, -380], [15, FLOOR, -381], [-6, FLOOR, -392], [6, FLOOR, -398], [-15, FLOOR, -404], [15, FLOOR, -406], [-4, FLOOR + 0.5, -424], [4, FLOOR + 0.5, -425]];
    for (const [x, y, z] of spots) loot(this, 'C', x, y + 0.02, z, rnd);
    pickup(this, 'flask', 16, FLOOR + 0.02, -386);

    // Two trapped pedestals with epic relics
    this.volley = new DartTrap(this, 30);
    for (const z of [-414, -419, -424]) {
      this.volley.addLauncher(new THREE.Vector3(-17.9, FLOOR + 1.4, z), new THREE.Vector3(1, 0, 0));
      this.volley.addLauncher(new THREE.Vector3(17.9, FLOOR + 1.4, z), new THREE.Vector3(-1, 0, 0));
    }
    const fire = () => {
      G.toast('Hidden darts! And something in the lair stirs...', 3);
      this.volley.fire();
      setTimeout(() => this.volley.fire(), 600);
      setTimeout(() => this.volley.fire(), 1300);
      // The trap wakes the lair's crawler early.
      const c = G.guardians.list.find((g) => g.home === 'lair' && g.kind === 'crawler' && g.mind.state === 'DORMANT');
      if (c) { c.wakeAt = G.elapsed; this.grate.setOpen(true); }
    };
    new Pedestal(this, 'sarcmask', 'C', new THREE.Vector3(-8, FLOOR + 0.5, -420), fire);
    new Pedestal(this, 'sapphire', 'C', new THREE.Vector3(8, FLOOR + 0.5, -420), fire);
    skeleton(this, -2, FLOOR + 0.5, -418, 0.3);

    // Escape lever and door to the tunnel
    this.escape = new Mover(this, new THREE.Vector3(1, 3.5, 4), { pos: new THREE.Vector3(18.5, FLOOR + 1.75, -420) }, { pos: new THREE.Vector3(18.5, FLOOR + 5.3, -420) }, W, 0.4);
    this.escape.onArrive = () => G.nav.setBlocked(new THREE.Box3(new THREE.Vector3(17.5, -15, -422), new THREE.Vector3(19.5, -10, -418)), false);
    new Lever(this, new THREE.Vector3(17, FLOOR, -415), -Math.PI / 2, 'Pull the lever (open the escape passage)', () => {
      this.escape.setOpen(true);
      G.setFlag('escapeOpen');
      G.toast('A slab grinds upward: a long passage climbs away into the dark. The way out!', 4);
    });
    this.addSconce(17.9, FLOOR + 2, -412, -Math.PI / 2);
    this.addSconce(-17.9, FLOOR + 2, -384, Math.PI / 2);

    // --- Guardians' lair x[-44,-19] z[-388,-422] behind an iron grate ---
    slab(this.b, -45, -18, -388, -422, FLOOR, F);
    ceiling(this.b, -45, -18, -388, -422, -9, W);
    wallX(this.b, -44.5, -388, -422, FLOOR, 5, 1, W);
    wallZ(this.b, -387.5, -45, -19, FLOOR, 5, 1, W);
    wallZ(this.b, -422.5, -45, -19, FLOOR, 5, 1, W);
    const gbars = new THREE.Group();
    for (let i = 0; i < 20; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), m.iron); b.position.z = -4.75 + i * 0.5; gbars.add(b); }
    this.grate = new Mover(this, new THREE.Vector3(0.3, 4, 10), { pos: new THREE.Vector3(-18.5, FLOOR + 2, -405) }, { pos: new THREE.Vector3(-18.5, FLOOR + 5.8, -405) }, m.iron, 0.5, false, gbars);
    this.grate.onArrive = () => G.nav.setBlocked(new THREE.Box3(new THREE.Vector3(-19.5, -15, -410), new THREE.Vector3(-17.5, -10, -400)), this.grate.t < 0.5);
    for (let i = 0; i < 4; i++) this.b.box(2, 3, 1.4, -42, FLOOR + 1.5, -393 - i * 8, W); // stone thrones
    rubble(this, -30, FLOOR, -405, 14, 30, rnd, m.bone);
    for (let i = 0; i < 5; i++) skeleton(this, -25 - rnd() * 15, FLOOR, -392 - rnd() * 26, rnd() * 6);
  }

  setup() {
    // Grate is blocked for guardians until it opens
    G.nav.setBlocked(new THREE.Box3(new THREE.Vector3(-19.5, -15, -410), new THREE.Vector3(-17.5, -10, -400)), true);
    G.nav.setBlocked(new THREE.Box3(new THREE.Vector3(-2, -15, -376.5), new THREE.Vector3(2, -10, -374)), true);
    G.nav.setBlocked(new THREE.Box3(new THREE.Vector3(17.5, -15, -422), new THREE.Vector3(19.5, -10, -418)), true);
  }

  tick(dt: number) {
    void dt;
    if (G.elapsed >= DAY_LENGTH && this.grate.target === 0) {
      this.grate.setOpen(true);
      if (!this.loaded) { this.grate.t = 1; this.grate.onArrive?.(); }
    }
  }
}
