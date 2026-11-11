# Self-review: The Lost Temple

An honest account of what was built, what is partial and what is missing. "Verified" means I drove it in headless Chromium through the `window.__lt` debug API: teleport, simulated key input at a fixed 60 Hz, state reads and screenshots. Those runs did not use a mouse or a human.

## Time and cost

| | |
|---|---|
| Start | 2026-11-11T21:26:59Z (thread spawned) |
| Finish | 2026-11-11T22:32:00Z |
| Wall clock | 1h 5m 1s (measured at the final commit; PR creation adds a minute or two) |
| Model / effort | the medium-effort run of this eval |
| Tokens (from the session transcript) | 305,255 output; 285 uncached input; 523,793 cache writes; 31,450,598 cache reads (148 model calls) |
| Cost estimate (API list price) | about $15.02 (output $6.11 + cache reads $6.29 + cache writes $2.62 + input $0.00) |

`/usage` is a CLI slash command and I cannot run it from inside the session, so the token numbers above are summed from the per-message `usage` fields in the session transcript. The cost uses API list prices for this model: $4/M input, $20/M output, $0.20/M cache read and $5/M cache write (5-minute cache at 1.25x input, assumed). If you are on a subscription plan, what you actually pay is different. The figure is the API-equivalent cost.

## Requirement checklist

### Tech and process

| Requirement | Status |
|---|---|
| TypeScript, Three.js and Rapier, with no engine | Done |
| All assets procedural (canvas textures, merged geometry, WebAudio synthesis) | Done. There are no asset files |
| `npm install && npm run dev` | Done. `npm run build` also type-checks |
| README with run steps and controls | Done |
| DESIGN.md and ARCHITECTURE.md written before code | Done. They were committed first, along with the logic modules and tests |
| Unit tests for loot economy, traps, countdown, torch curve, unlocks and the guardian FSM | Done. 51 vitest tests in 6 files, all passing. The sundial math is also covered |
| 60 FPS target | **Unverified.** See the performance section below |

### World

| Requirement | Status |
|---|---|
| 7+ scenes in 3 zones | Done. There are 8 scenes. Zone A: Jungle, Courtyard, Outer Cliffs. Zone B: Broken Halls, Collapsed Sanctum. Zone C: Lower Catacombs, Deep Vault, Escape Tunnel |
| Seamless streaming | Done. Chunks load and unload by distance and neighbour lists, with no loading screens. The world is built once per run and the colliders of far chunks are unloaded |
| Unlocks and shortcuts | Done. Sundial → Sun-Disc → seal. Block on plate → halls gate. Bronze Key → vault gate. Lever → drawbridge shortcut. Escape lever → tunnel → kick the cracked wall into the halls. All verified |
| Separate escape route | Done. The tunnel from the vault to the halls has been walked end to end and the wall kick verified |

### Physics

| Requirement | Status |
|---|---|
| Jointed rope bridges with cracking planks | Done. Spherical and rope joints. Planks crack and drop (verified) |
| Crumbling floors | Done. Sun-tiles in the halls and a crumbling chasm in the catacombs (walked across, verified) |
| Boulders | Done. There is a pressure-plate boulder on the catacomb ramp and an idol-trap boulder in the sanctum, which was verified |
| Pressure plates, blades and darts | Done. Darts hit when standing and miss when crouched (verified). The vault volley fires (verified), but I did not confirm a hit in that test. Blades swing. A blade hit was not specifically verified |
| Pushable blocks | Done. Sokoban-style axis push onto the plate opens the gate (verified) |
| Loot weight | Done. Speed, stamina drain and jump scale with satchel weight. Capacity depends on the satchel upgrade |

### Time and light

| Requirement | Status |
|---|---|
| Moving sun over a 13-minute day with grading | Done. The sun arcs east to west over 780 s, with time-of-day grading presets and an HDR grading shader |
| Sundial HUD countdown; ticking speeds up and gets louder in the last 2 min | Done |
| At 60 s: edge pulse, music shift and rumble | Done |
| At 0: darkness, guardians wake, door closes | Done. The door closes over 75 s. I verified escaping through it at dusk and the "sealed inside" death after it shuts |
| Torch is the only light in zone C (zero ambient) | **Done, confirmed.** In zone C the sun and hemisphere intensities are exactly 0 (not just small), and fog and background are black. The debug overlay reads "Non-torch light 0 ✔" there. Sconces count as torch light because you light them with the torch |
| Fuel and radius, extinguish, relight, spares, sconces | Done. Deep water put the torch out (verified). Falls and wind can also put it out. R relights, oil flasks refuel, spare torches can be picked up, and sconces can be lit |

### Loot

| Requirement | Status |
|---|---|
| 15+ relics | Done. 18 relic types with zone multipliers |
| Trapped pedestals with weight swap | Done. The sandbag swap is safe (verified). An unswapped idol fires the boulder and collapse (verified). The vault pedestals fire the volley, wake the lair crawler and open the grate (verified) |
| HUD loot value; only escaped loot counts | Done. Verified on the results screen |

### Guardians

| Requirement | Status |
|---|---|
| 3 types | Done. Sentinel (slow, sight), crawler (fast, hearing), shade (only sees you when you're lit) |
| Navmesh pathfinding | Done. A multi-level 1 m grid is baked by raycasting the real colliders, then A* with string pulling. Gates and doors block nodes until they open |
| Wake deepest-first and sweep toward the door | Done. I verified the wake order and that a vault sentinel climbs the catacomb stairs, spots the player in the sanctum, chases and catches them |

### Player, UI and meta

| Requirement | Status |
|---|---|
| Pointer lock, run, jump, crouch, climb, stamina | Done. Mantle is included |
| Grab, carry and throw | Done |
| Results screen, localStorage high scores, shop | Done. The results screen and high score are verified. The shop's purchase logic is unit-tested, but I did not click through the UI in the browser |
| Menus, settings, HUD, debug overlay | Done |
| Procedural audio | Done. It's all WebAudio synthesis, and I couldn't listen to it headless |

### Stretch goals

| Requirement | Status |
|---|---|
| Map | Done. A hand-drawn style map that fills in as you explore |
| Idol collapse | Done. 28 s collapse with falling debris |
| Ghost replay | Done. The best run's ghost replays in later runs and is hidden in zone C |
| Gamepad | Done (standard mapping). Not tested with real hardware |

## Performance (honest version)

I could not measure real 60 FPS. The only GPU I had was SwiftShader, which renders on the CPU in headless Chromium. Those numbers say nothing about a real graphics card, but they do show the CPU cost. Measured on low quality, 800×450:

| Zone / scene | Headless FPS | Update ms | Render submit ms | Draw calls |
|---|---|---|---|---|
| A Jungle | 0.6–0.8 | 4.3–4.7 | 7–9 | 91 |
| A Courtyard | 0.7–1.7 | 5.7–11.9 | 8–9 | 134 |
| B Broken Halls | 1.4–1.8 | 6.2–11.5 | 134–208 (SwiftShader shadow pass) | 164–169 |
| B Sanctum | 1.3–1.6 | 8.2–10.6 | 50–53 | 153–166 |
| C Catacombs | 2.9 | 7.0 | 14.8 | 157 |
| C Vault | 3.9 | 5.2 | 7.1 | 39 |

On real hardware, most of the frame goes to game update (physics, guardians, streaming), which takes about 5–10 ms of CPU per frame. Draw calls stay at 40–170 and triangle counts at about 20–60k. That fits within a 16.6 ms frame on a normal desktop GPU, but **I have not measured it**. The worst case is likely the halls at dusk, with the shadow-casting sun plus many pillars. The Low quality preset turns shadows and pixel ratio down.

## Known bugs and limitations

- **Guardians walk across fallen floor.** The navmesh is baked once, with crumbling tiles and bridge planks counted as walkable. Guardians are moved kinematically along paths, not simulated, so they can walk over gaps where tiles have dropped.
- **Navmesh has junk nodes on some roofs.** The multi-level column scan also creates nodes on top of tunnel and stair roofs. These aren't connected to anything real and in practice nothing paths to them, but nearest-node lookups could snap to them in odd spots.
- **Guardian movement isn't physical.** Guardians follow paths kinematically. They don't push props, and props don't block them.
- **Kinematic → fixed switching.** Rapier's character controller got stuck on resting kinematic bodies (drawbridge, crumble tiles). Movers now switch to fixed bodies when at rest. That fixed the snag, but a mover that starts moving under the player doesn't carry them smoothly on its first frame.
- **Bundle size.** The bundle is 2.7 MB unminified-ish (950 KB gzip), mostly Rapier WASM inlined by the compat build.
- **Several features were only checked headless:** audio was never heard, gamepad was never tested with a real pad, the pointer-lock feel was never played with a real mouse, and the shop UI was never clicked.
- **Game-feel balance is untested.** The 13-minute day, trap timings and loot values follow DESIGN.md, but no human has played a full run to tune them.

### Bugs found and fixed during playtesting

- A 3 m hole under the great door, between the plaza and the halls floor, that dropped you into the void. Found by walking out at dusk.
- The player snagged on the lowered drawbridge and on crumbling tiles (the kinematic-body issue above).
- The catacomb navmesh was nearly empty because the scan started inside the ceiling slab. Stairs were also disconnected because the step limit was below the stair rise per cell. Before the fix, guardians in zone C could not leave.
- Other fixes: the block-push drift, a stair lintel that blocked the player, the reversed ramp rotation, the tunnel overlapping the sanctum wall, and the purple dawn grading.
