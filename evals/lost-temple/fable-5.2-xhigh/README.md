# The Lost Temple

A first-person relic heist against the setting sun. You have one thirteen-minute
day to get into a jungle temple, take what you can carry, and be back outside
the great door before dark. After dark the guardians wake, deepest first, the
door starts coming down, and anything still in your satchel stays with you.

Three.js for rendering, Rapier for physics, TypeScript, Vite. No game engine and
no asset files: every mesh, texture, shader and sound is generated in code.

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints (http://localhost:5173/). Click **Enter the temple**,
then click the view to capture the mouse.

Other scripts:

| Command             | What it does                                     |
|---------------------|--------------------------------------------------|
| `npm test`          | 226 unit tests over the pure game rules (Vitest) |
| `npm run typecheck` | `tsc --noEmit`, strict                           |
| `npm run build`     | typecheck, then a production build into `dist/`  |
| `npm run preview`   | serve the production build                       |

Needs Node 20 or newer and a browser with WebGL2.

`play/` holds a prebuilt copy of the game (the output of
`npx vite build --outDir play`). It uses relative paths, so any static file
server can host it from any sub-folder, GitHub Pages included: serve this
directory and open `play/`. It has to come from a server; browsers will not
load it from a `file://` path.

Graphics quality starts at **medium**. Settings has low and high, and F3 shows
the live frame rate, draw calls and physics body count.

## Controls

| Action                           | Keyboard and mouse             | Gamepad                  |
|----------------------------------|--------------------------------|--------------------------|
| Move / look                      | W A S D / mouse                | Left stick / right stick |
| Sprint                           | Shift                          | LT or L3                 |
| Jump, mantle, let go of a climb  | Space                          | A                        |
| Crouch                           | C (toggle) or Ctrl (hold)      | B                        |
| Interact, take, grab, swap       | E (hold E on the sundial ring) | X                        |
| Throw what you carry             | Left mouse                     | RT                       |
| Drop what you carry              | Right mouse or G               | RB                       |
| Drop last relic                  | Q                              | LB                       |
| Torch: strike / douse            | F                              | Y                        |
| Refuel torch (oil, then a spare) | R                              | D-pad up                 |
| Map                              | M or Tab                       | Back                     |
| Pause                            | Esc or P                       | Start                    |
| Debug overlay                    | F3                             |                          |

Climbing: walk into vines to climb them, jump at a ledge to pull yourself up.

## How a run goes

1. **Jungle approach** (full sun). Follow the trail, cross the river on the
   stones, cross the rope bridge without stopping. It tears loose behind you.
2. **Temple courtyard**. The great door is the way in and the only way out.
   The stone sundial reads the real sun: turn its ring to where the shadow
   falls and it gives up the Sun Disc. The outer cliffs to the east are
   optional, windy and worth it.
3. **Broken halls** (roofless). Sun shafts crawl across the floor all day and
   the shade is not empty. A block puzzle opens the sanctum, a blade corridor
   skips the nave, and the Sun Disc breaks the seal to the catacombs.
4. **Collapsed sanctum**. Noise brings the ceiling down. The Dawn Idol sits
   under a sunbeam; taking it starts a collapse that buries the way you came.
5. **Lower catacombs** (no sky). Your torch is the only light there is.
   Crumbling floor, a dart corridor, a flooded chamber that will put the torch
   out, and the Serpent Key.
6. **Deep vault**. The richest relics, and the lair. A lever here opens the
   escape stair, the game's own way back up: sanctum, a cracked wall, a terrace
   and a drawbridge into the courtyard.
7. **The door**. Only relics you carry through it are banked.

The sundial at the top of the screen is the countdown. The ticking speeds up in
the last two minutes, the screen edges pulse in the last one, and at zero it is
dark, the guardians are loose and the door takes sixty seconds to close.

Coins from a run buy gear from the Outfitter in the main menu: a better torch,
oil, a rope, a bigger satchel, spare torches, soft soles. Progress, settings,
high scores and your best run's ghost are kept in `localStorage`.

## Project layout

```
src/core/     pure rules: clock, sun, economy, torch, traps, unlocks, navmesh, guardian brains, save
src/engine/   renderer and grade pass, physics wrapper, lighting, materials, textures, sky, audio, input
src/world/    level layout data, scene builders, entities (traps, relics, doors, props), streaming
src/game/     the run: player controller, torch rig, guardians, orchestration, debug API
src/ui/       HUD, menus, shop, map, debug overlay
tests/        Vitest suites for everything in core/ and the layout data
playtest/     Playwright scripts that drive the real game in a headless browser
```

`DESIGN.md` is the game design, `ARCHITECTURE.md` the technical plan (both
written before the code), and `SELF_REVIEW.md` the honest account of what
works, what does not, and what was measured.

## Playtest scripts (optional)

These drive the real game through `window.__lt`, a small scripting surface the
game installs for exactly this. They need Playwright, which is deliberately not
a dependency of the game:

```bash
npm install --no-save playwright && npx playwright install chromium
npm run dev                          # in another terminal
node playtest/smoke.cjs              # boots, starts a run, walks, checks for errors
node playtest/playthrough.cjs        # a bot plays a whole heist with ordinary inputs
node playtest/scenarios.cjs [name]   # single-system checks: darkness probe, nightfall, traps, torch, menus...
node playtest/tour.cjs [filter]      # screenshots of every scene into playtest/shots/
node playtest/perf.cjs               # draw calls, triangles and step cost per zone (LT_GPU=1 to use a real GPU)
```

`LT_URL` points them at another server (for example a `vite preview` of a
production build). They run Chromium on its software renderer, so they check
behaviour, not frame rate, unless you run `perf.cjs` with `LT_GPU=1` on a
machine that has one.

The same API is handy in the browser console: `__lt.state()`,
`__lt.teleport(x, y, z)`, `__lt.setTime(seconds)`, `__lt.give('jade_mask')`,
`__lt.darknessProbe()`, `__lt.perf()`.
