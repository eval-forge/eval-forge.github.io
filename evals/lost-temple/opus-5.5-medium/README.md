# The Lost Temple

A first-person relic-heist game for the browser. Arrive at a jungle temple at dawn, work your way down from the sunlit ruins into pitch-black catacombs, grab as much loot as you can carry, and get back out through the great door before darkness falls and the guardians wake.

Built with **Three.js** (rendering) and **Rapier** (`@dimforge/rapier3d-compat`, physics). Every mesh, texture and sound is generated in code. There are no asset files.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173), click **Enter the jungle**, then click the game to capture the mouse.

Other scripts:

```bash
npm test          # unit tests (vitest)
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build
```

## Controls

| Key | Action |
|---|---|
| WASD / mouse | Move / look |
| Shift | Run (uses stamina) |
| Space | Jump. Press again in the air in front of a ledge to mantle up |
| C or Ctrl | Crouch (quieter; ducks under dart volleys) |
| W at vines | Climb |
| E | Interact: take relic, turn the sundial ring, pull levers, place torches in sconces, swap on pedestals, kick the cracked wall, leave the temple |
| G / right mouse | Grab or drop an object (pots, sandbags, stone heads, dropped relics) |
| Left mouse | Throw the held object (makes noise: distracts crawlers) |
| Q | Drop the last relic from your satchel |
| F | Torch on/off · **R** relight · **T** pour an oil flask |
| Tab (hold) | Satchel contents |
| M | Hand-drawn map (fills in as you explore) |
| F3 | Debug overlay (FPS, physics bodies, scene, ambient-light check) |
| Esc / P | Pause |

Gamepad (standard mapping): left stick move, right stick look, A jump, B crouch, X interact, Y torch, LB relight, LT grab, RT throw, RB run, D-pad up oil / down drop, Back map, Start pause.

## How a run goes

1. **Jungle**: wade the river (deep water drowns your torch), cross the collapsing rope bridge without stopping.
2. **Courtyard**: turn the bronze ring of the sundial until it points where the gnomon's real shadow falls. It releases the **Sun-Disc**. The optional **Outer Cliffs** to the east have exposed relics, vines, wind and a second rope bridge.
3. **Broken Halls**: the sun tiles over the pit only hold while sunlit. Push the stone block onto the plate to raise the inner gate.
4. **Collapsed Sanctum**: keep quiet or the ceiling comes down. The Golden Idol sits in a beam of light on a trapped pedestal. Carry a sandbag (G) and press E on the pedestal to swap. Taking it starts the collapse. The Sun-Disc opens the catacomb seal.
5. **Lower Catacombs** (no light but yours): dart corridor (crouch), crumbling chasm (lever on the far side lowers a drawbridge shortcut), boulder ramp, flooded chamber with the **Bronze Key**, swinging blades.
6. **Deep Vault**: the richest loot, two trapped pedestals, the guardians' lair behind a grate, and a lever that opens the **escape tunnel**: a long rising passage that ends at a cracked wall in the Broken Halls (kick it down).
7. Get out of the great door. At 0:00 darkness falls, the guardians wake deepest-first and sweep toward the door, and the door closes over 75 seconds. Only loot carried out counts.

Escaped loot is banked as gold for the **Outfitter** (better torch, oil flasks, bigger satchel, climbing rope, boots). High scores, settings, upgrades and your best run's ghost are saved in `localStorage`.

## Docs

- [DESIGN.md](DESIGN.md): core loop, scene graph and unlocks, relic table, loot by zone
- [ARCHITECTURE.md](ARCHITECTURE.md): code structure
- [SELF_REVIEW.md](SELF_REVIEW.md): honest requirement-by-requirement status, known bugs, performance
