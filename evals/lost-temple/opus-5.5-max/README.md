# The Lost Temple

A first-person relic heist against the setting sun. You arrive at the jungle edge at dawn, cross the river and the gorge, open the great door, and work inward and downward through a ruined temple: sunlit halls, a sanctum that collapses when you make noise, pitch-black catacombs and the deep vault. Everything you carry slows you down. Loot only counts once it is in the haul cart outside the great door. At darkness the guardians wake, deepest first, and the door starts to close.

TypeScript, Three.js and Rapier (real rigid-body physics). No game engine and no asset files: every mesh, texture, sound and the music are generated in code when the game starts.

## Run it

Needs Node 20.19 or newer (Vite 8's requirement) and a browser with WebGL 2 and WebAssembly (current Chrome, Edge or Firefox).

```bash
npm install
npm run dev
```

Then open http://localhost:5173 and click **Begin the heist**. Click the game view to capture the mouse.

Other commands:

```bash
npm test           # unit tests (Vitest) for the pure game logic
npm run build      # type-check and production build into dist/
npm run preview    # serve the production build
```

## Controls

| Key | Action |
|---|---|
| WASD, mouse | move, look |
| Shift | sprint (uses stamina) |
| C or Ctrl | crouch: quieter, ducks under the head-high blades in the vault (the halls blades swing at chest height: time them) |
| Space | jump; mantle onto a ledge you can reach |
| walk into vines or a rope | climb (Space hops off) |
| E | interact: levers, sockets, sconces, the sundial ring, the haul cart; stash the relic you are looking at or holding |
| F or left click | grab a loose object; click again to throw it |
| Q or right click | drop what you hold |
| G | take the selected relic back out of the satchel (into your hands) |
| [ ] or mouse wheel | choose a satchel item |
| T | light the torch (about 2 seconds of striking a flint, during which you are slow and cannot grab) or snuff it |
| R | pour an oil flask into the torch |
| V | kick: breaks cracked walls, shoves loose things |
| M or Tab | the hand-drawn map |
| Esc or P | pause (the clock stops) |
| F3 | debug overlay: FPS, frame cost, physics bodies, scenes, draw calls, guardians |

A gamepad works too (standard mapping): sticks to move and look, A jump, B crouch, X interact, Y torch, RT grab and throw, LT drop, bumpers or d-pad choose a satchel item, stick clicks sprint and kick, View opens the map, Menu pauses.

## How a run works

- **The clock.** The day lasts 13 minutes. The sundial in the top-left corner always shows the time left, also underground where there is no sky. The ticking speeds up and gets louder in the last two minutes; in the last minute the screen edges pulse red, the music changes and the temple rumbles. At darkness the guardians wake and the great door takes 90 seconds to close. Be outside when it shuts or you are entombed.
- **Getting in.** The great door opens when both plates in front of it are held down: stand on one and push a stone block onto the other. The sundial in the courtyard is solved with the real sun: turn the ring until the carved Eye lies in the gnomon's shadow. It gives you the Sun-Disc, which opens the seal in the sanctum floor and the stairs down into the catacombs.
- **Loot.** 19 relic types (common to legendary, plus two unique idols) with value, weight and rarity; deeper is richer. Some sit on weighted pedestals: lift one without leaving something of similar weight behind and the trap fires. Your satchel has a weight limit and the weight slows you and drains stamina. Carry relics to the haul cart (E) to bank them. Being caught or killed loses whatever you carry; banked loot is safe.
- **Light.** The catacombs and the vault have no light at all except fire. Your torch burns fuel, its radius shrinks as fuel runs low, and water, strong gusts and hard falls put it out. Relighting takes time and leaves you exposed. You start with one spare torch and one oil flask (more from the Outfitter), and more lie along the way: oil flasks in the broken halls, the ossuary and the vault antechamber, spare torches in the sanctum and at the foot of the seal stairs (E picks them up). E sets a spare torch in a wall sconce, which burns for six minutes and relights your own torch instantly. Light draws the stone sentinels; the shadow guardian will not step into it.
- **Guardians.** The stone sentinel is slow and hunts by sight (it sees your torch from far away). The crawler is blind, fast and hunts by sound: walk or crouch, and throw things to make decoy noises. The shadow avoids light and strikes when your light is small or out.
- **Between runs.** Money from banked loot buys upgrades at the Outfitter: a bigger satchel, a brighter torch, more fuel, rope, boots, spare torches and oil flasks. High scores and the ghost of your best run are kept in your browser (localStorage).

## Documents

- [DESIGN.md](DESIGN.md): the game design (scenes, progression, physics, light, guardians, numbers).
- [ARCHITECTURE.md](ARCHITECTURE.md): code structure, main loop, streaming, rendering and test hooks.
- [SELF_REVIEW.md](SELF_REVIEW.md): every requirement marked done, partial or missing, known bugs, measured performance.

## Test hooks

Open the game with `?debug` to get `window.lostTemple` (teleport, time control, input injection, pixel readback). The `scripts/` folder holds the Playwright play tests used during development, for example:

```bash
npm run dev &
node scripts/check-dark.mjs       # asserts Zone C renders pure black with the torch out
node scripts/progression.mjs      # solve the sundial with the real sun, set the Sun-Disc, open the seal stairs
node scripts/door.mjs             # push a block onto one plate, stand on the other, the great door rises
node scripts/heist.mjs            # stash a relic, bank it, leave, check results and save
node scripts/darkness.mjs hall    # wait in the entrance hall at nightfall and get caught
node scripts/darkness.mjs outside # be outside at nightfall: escaped, door shut behind you
node scripts/darkness.mjs inside  # hide in the catacombs at nightfall: caught or entombed
node scripts/traps.mjs            # pedestal swap, darts, crumbling tiles, blades, idol collapse, boulder
node scripts/route.mjs both       # walk the way in and the way out along the navmesh, report snags
node scripts/climb.mjs            # mantle the cliff ledges, climb the vines, throw a sandbag
node scripts/bridge.mjs walk      # walk the rope bridge while the planks crack and drop
node scripts/bridge.mjs flood     # the catacomb plank bridge: cross it lit, then stop on it and fall in
node scripts/hazards.mjs          # sunstones, noise collapse, flooded chamber, torch blow-outs, wind, gamepad, ghost
node scripts/audio.mjs            # signal on every mixer bus, every listed effect, the final-minute cues
node scripts/supplies.mjs         # pick up every hidden oil flask and spare torch
node scripts/menus.mjs            # outfitter purchase, settings, pause, abandon, results, high scores
node scripts/tour.mjs medium      # FPS, frame cost, draw calls and triangles at a stop in every scene
```

Set `LT_SHOTS=<folder>` to choose where the screenshots go (default `shots/`).

Playwright is not a dependency of the game; the scripts use a local or global install (`npm i -g playwright`).
