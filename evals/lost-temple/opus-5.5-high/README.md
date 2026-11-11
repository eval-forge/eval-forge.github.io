# The Lost Temple

A first-person relic heist in the browser. You get one day of light (13 minutes) to cross the jungle, open the temple, solve your way down into the pitch-black vault, and carry out as much treasure as your satchel and legs can manage. When the sun sets, the guardians wake up deepest-first and sweep toward the great door, and 75 seconds later the door seals. Only what you carry out through the door counts.

Three.js for rendering, Rapier (`@dimforge/rapier3d-compat`) for physics, and nothing else at runtime. Every texture, mesh, and sound is generated procedurally at load time. There are no asset files.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Command | What it does |
|---|---|
| `npm test` | 52 unit tests (economy, traps, countdown, torch, unlocks, guardian FSMs, navmesh) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | typecheck + production build into `dist/` |
| `node scripts/playtest.mjs [url] [outDir]` | headless tour of every scene with stats and screenshots (dev server must be running) |
| `node scripts/progression.mjs [url] [outDir]` | headless critical-path run with 27 scripted checks, from the rope bridge through the vault, the shortcuts and the escape |

Add `?debug=1` to the URL to start with the debug overlay on and to expose `window.__game`. From there you can call `tp('vault')`, `setRemaining(30)`, `give('heart')`, `flag('doorOpened')`, `simulate(5)` and `stats()`.

## Controls

| Input | Action |
|---|---|
| Mouse | Look (click the game to lock the pointer) |
| W A S D / arrows | Move |
| Space | Jump, mantle onto a ledge, jump off vines |
| Shift | Sprint (uses stamina; a heavier satchel drains it faster) |
| C / Ctrl | Crouch (quieter, and shields the torch from wind) |
| W into vines | Climb |
| E | Take a relic into your satchel, use or interact. While holding an object, E on a pedestal relic swaps them. |
| F / left mouse | Grab, carry and drop objects |
| Right mouse | Throw the held object (thrown rocks make noise that distracts guardians) |
| Q | Drop the last relic from your satchel |
| T | Douse or light the torch |
| R | Relight the torch, or light a spare once it's burnt out |
| M | Hand-drawn map. The clock keeps running while it's open. |
| Esc / P | Pause |
| F3 / ` | Debug overlay: FPS, physics bodies, draw calls, scene |
| Gamepad | Sticks move and look, A jump, B crouch, X use, Y torch, RT grab, LT throw, LB drop, RB relight, Start pause, Back map, L3 sprint |

## The way down

1. Cross the rope bridge over the gorge. Planks crack and fall if you stand on them too long.
2. Heave open the great door, then turn the courtyard sundial until the gnomon's shadow falls on the eye. Take the sun-disc that rises on the plinth.
3. In the broken halls, shove the 260 kg stone block onto the plate to hold the sanctum gate open. The sun tiles over the spike pit are only solid while sunlight is on them.
4. Set the sun-disc into the sanctum floor seal to open the stairs into the catacombs. The catacombs are Zone C, with zero ambient light: from here on it's your torch, sconces and spares.
5. Get the obsidian key from the flooded chamber. The water will drown your torch.
6. Unlock the vault. Lower the drawbridge and kick down the cracked wall in the west wing to open the shortcut back out.

Pedestal relics are weight-trapped. Swap in something of similar mass, such as a rock or a sandbag, or take the darts. Taking the golden idol brings the sanctum down and steals a minute of daylight.

See `DESIGN.md` for the full design and `ARCHITECTURE.md` for how the code is laid out. `SELF_REVIEW.md` has the honest scorecard.
