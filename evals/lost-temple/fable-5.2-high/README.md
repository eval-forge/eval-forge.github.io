# The Lost Temple

A first-person relic heist in the browser. You reach a ruined temple at dawn, work your way from sunlit jungle through roofless halls into pitch-black catacombs, fill a satchel, and get back out of the Great Door before the sun goes down. At sunset the guardians wake in the deepest rooms and sweep toward the door.

Three.js for rendering, Rapier for physics, TypeScript, Vite. Every texture, mesh and sound is generated in code. There are no asset files.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (http://localhost:5173 by default) and click **Begin the expedition**. Needs Node 18 or newer and a browser with WebGL 2.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | 150 unit tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Typecheck, then a static build in `dist/` (relative paths, so it can be hosted from any folder) |
| `npm run preview` | Serve the built `dist/` |

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click the page to lock the pointer) |
| Shift | Run (burns stamina) |
| Space | Jump, mantle ledges, kick off vines |
| C or Ctrl | Crouch: quiet, and steady in wind |
| E | Interact: take, turn, pull, kick, place a torch in a sconce, tie off a rope |
| F | Light or stow the torch |
| R | Pour an oil flask into the torch |
| T | Swap to a spare torch |
| G | Drop the last relic out of the satchel |
| Left click | Throw what you are holding |
| Right click or Q | Put it down |
| M or Tab | Map |
| Esc or P | Pause |
| F3 | Debug overlay (FPS, physics bodies, scene, draw calls, light levels) |

A gamepad also works: left stick moves, right stick looks, A jumps, X interacts, Y is the torch. It was written against the standard mapping but has not been tested on real hardware (see SELF_REVIEW.md).

## How a run goes

- The day lasts 13 minutes. The stone sundial at the top of the screen is the clock, and underground it is the only one.
- **Zone A, open sky:** the jungle trail (river stones, a rope bridge that drops planks behind you), the courtyard (turn the sundial so its shadow falls where the real sun would put it at noon, take the Sun Disc, open the Great Door) and the optional outer cliffs (wind, vines, a second bridge, rich relics in the open).
- **Zone B, roofless:** the broken halls (scarabs swarm wherever the floor is in shadow, and the sunlit lanes move through the day; a push block and pressure plate open the portcullis) and the collapsed sanctum (running makes noise, noise brings the ceiling down; the idol sits under a beam of light).
- **Zone C, no sky:** the lower catacombs (crumbling gallery, dart corridor, flooded chamber, a chasm bridge) and the deep vault (blade corridor, the heaviest loot, the guardians' lair next door). There is no light down here except the torch you carry and any spare torch you leave in a wall sconce.
- Deeper relics are worth more and weigh more. Weight slows you down and drains stamina faster.
- Relics on gold-ringed pedestals are trapped. Carry a stone of about the same weight and it is swapped in when you lift the relic.
- At sunset darkness falls, the guardians wake deepest first, and the Great Door starts to come down. You have under a minute to get under it. Only what you carry out of the door is banked. Getting caught loses everything in the satchel.
- Banked gold buys gear from the Outfitter in the main menu: a better torch, oil flasks, climbing rope, a bigger satchel.

## Layout

```
src/core      Pure rules with no three.js or DOM: clock, sun, torch, economy, traps, unlocks, guardian FSM, navmesh
src/engine    Physics wrapper, level builder, procedural textures and materials, sky, input, audio
src/world     Scene streaming, the seven scenes, physics set pieces
src/entities  Player, torch rig, props, relics, guardians
src/ui        HUD, menus, map, debug overlay
src/game      Game loop and per-run state
tests         Vitest suites for src/core and for the shipped level data
```

`DESIGN.md` and `ARCHITECTURE.md` were written before the code. `SELF_REVIEW.md` is the honest audit: what is done, what is partial, what was never verified, known bugs, and the eval timing and usage numbers.

## Test hook

The page exposes `window.__lt` in the console for scripted playtests (in every build, so yes, it is also a cheat console): `start(seed)`, `teleport(x, y, z)`, `setTime(seconds)`, `simulate(seconds)`, `god(on)`, `look(yaw, pitch)`, `press(code)`, `release(code)` and `game`. It is not needed to play.
