# The Lost Temple

A first-person relic heist in the browser. Get into a jungle temple, take what you can
carry, and get it back out through the great door before the sun goes down. At
darkness the guardians wake, deepest first, and the door closes 75 seconds later.

Three.js for rendering and Rapier (WASM) for physics. No game engine and no asset
files: every mesh, texture, sound and the music are generated at runtime.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

| Command            | What it does                                                                 |
| ------------------ | ---------------------------------------------------------------------------- |
| `npm run build`    | Type-check, then build to `dist/`                                            |
| `npm run preview`  | Serve the production build                                                   |
| `npm test`         | Unit tests (vitest) for the pure game rules in `src/logic/`                  |
| `npm run playtest` | Headless Chromium run of the built game: screenshots, perf samples and the Zone C pixel-black check. Run `npm run build` first. Output goes to `playtest-output/`. |
| `npm run mechanics` | Headless run of the puzzle / key / shortcut chain, traps, climbing and ghost replay through the real input and interaction path (22 steps, pass/fail each). Run `npm run build` first. |

The two headless scripts need Playwright, which is not a dependency so that players don't
download a browser on `npm install`. To run them: `npm i --no-save playwright && npx playwright install chromium`.

Needs a browser with WebGL2. Click the game to capture the mouse (pointer lock);
Esc releases it and pauses.

## Controls

| Action                                         | Keyboard / mouse                  | Gamepad          |
| ---------------------------------------------- | --------------------------------- | ---------------- |
| Move / look                                    | WASD / mouse                      | Left / right stick |
| Sprint                                         | Shift                             | LB or L3         |
| Jump / mantle a ledge                          | Space                             | A                |
| Crouch (dodge darts, sneak, brace in wind)     | C or Ctrl                         | B                |
| Climb vines                                    | Walk into them, Space at the top  | Stick            |
| Interact / take / swap / use key / kick        | E (some actions: hold E)          | X                |
| Grab / release an object in your hands         | F or right mouse                  | Y                |
| Throw the held object                          | Left mouse                        | RT               |
| Drop last relic from satchel (or drop held)    | Q                                 | D-pad down       |
| Douse / relight torch (or light a spare)       | T                                 | RB               |
| Refuel the torch with an oil flask             | R                                 |                  |
| Mount a spare torch in a sconce                | E at a sconce                     | X                |
| Map                                            | M                                 | View             |
| Pause                                          | Esc                               | Start            |
| Debug overlay / warp and time panel            | F3 / F4                           |                  |

## How a run works

* **The day is 13 minutes.** The sun really moves: it lights the jungle, courtyard,
  cliffs and the halls (through roof holes), and casts real shadows. The stone sundial
  on the HUD shows the time. In the last two minutes its ticks speed up and get louder;
  at 60 seconds the screen edge pulses, the music changes and the ground rumbles.
* **Darkness** at 0:00. The guardians wake deepest-first (vault, then catacombs, then
  sanctum and halls) and sweep toward the door along the navmesh. The great door grinds
  shut 75 seconds later. Outside means you escaped; inside means you are sealed in.
* **Only loot you carry out counts.** It is stashed automatically once you're through
  the great door or back at camp. Heavy loot slows you, stops you sprinting and drains
  stamina. Getting caught by a guardian ends the run and loses what you're carrying.
* **Zone C (catacombs and vault) has no ambient light at all.** Outside your torch
  radius it is pure black, and only the HUD and the sound tell you the time. The torch
  burns fuel and its radius shrinks as it does. Water, wind and hard falls blow it out,
  and relighting takes a few seconds during which you can't do anything else. Guardians
  are drawn to torchlight.
* **Trapped relics** sit on weight plates. Hold something of similar weight (F) and
  press E on the relic to swap it. Get the weight wrong and the trap fires.
* **The Sun Idol** in the sanctum sits under a beam of light. Taking it brings the
  sanctum ceiling down and jumps the clock forward.
* Between runs, spend your banked haul at the **outfitter** (better torch, more fuel,
  rope that catches a fatal fall, bigger satchel). High scores and the best run's ghost
  are saved in `localStorage`.

## The world

| Zone | Scene      | What's there                                                                 |
| ---- | ---------- | ---------------------------------------------------------------------------- |
| A    | Jungle     | Camp, the river, the gorge and a jointed rope bridge whose planks crack and drop |
| A    | Courtyard  | The great door (the only way in and out, opened by pushing a stone block onto its plate) and a sundial puzzle: press the glyph the gnomon's real shadow points at |
| A    | Cliffs     | Optional: ledges, vines, wind gusts, high-value relics                         |
| B    | Halls      | Moving sun shafts: the sun-stones over the pit are only solid while sunlight reaches them. Blade gallery, and the Sun Seal down to Zone C |
| B    | Sanctum    | Unstable ceiling (noise brings down debris) and the Sun Idol                   |
| C    | Catacombs  | Crumbling floors, dart corridors, a rolling boulder, a flooded chamber         |
| C    | Vault      | The heaviest, richest loot, the longest way out and the guardians' lair        |

Shortcuts open on the way: a cracked wall you can kick through and a drawbridge you
lower with a lever in the vault, the short way back out over the chasm. 20 relic types, from clay bowls to a gold ancestor statue.

## Documents

* [DESIGN.md](DESIGN.md): the game design.
* [ARCHITECTURE.md](ARCHITECTURE.md): code layout, frame loop, streaming, lighting model.
* [SELF_REVIEW.md](SELF_REVIEW.md): what works, what doesn't, measured performance.
