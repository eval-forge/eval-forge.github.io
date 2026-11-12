# Self review

Written at the end of the build, against the original prompt. The short version: a full run is playable from the trailhead at dawn to escaping or dying at dark, every numbered requirement has something real behind it, and the two things I could not check are the two a person would notice first: **frame rate on a real GPU** and **how it sounds**. Nobody has played this with their hands. Everything below that says "verified" was verified by scripts driving a real Chromium, not by a human.

## How this was tested, and what that does and does not prove

- **Unit tests:** 150 Vitest tests over the pure rules in `src/core` (loot economy, trap triggers, countdown thresholds, torch fuel and radius curve, unlock logic, guardian state machines, sun and sunlight, navmesh) plus 11 tests that run against the shipped level data (seven scenes, three zones, loot value rising A < B < C over 40 seeds, every guardian spawn can path to the door, the vault is sealed until its door or the drawbridge opens, and so on). `npm test` passes, `tsc --noEmit` is clean, `npm run build` succeeds.
- **Scripted playtests in headless Chromium (Playwright):** the game exposes `window.__lt`, and `game.simulate(seconds)` advances the real 60 Hz game loop (input, physics, player, torch, world) without rendering. Scripts press real key codes and walk the player along the route. The complete-run script uses **no teleports and no god mode**: trailhead, stepping stones, rope bridge, sundial, Great Door, push block and portcullis, sanctum pedestal swap, sun seal, crumbling gallery, dart corridor, flooded chamber, Serpent Key, chasm bridge, vault door, sceptre, blade corridor, drawbridge lever, and back out. It ends `escaped` at t = 242 s with 3,904 gold banked, and it still does after the last code change.
- **Feature checks with teleports** for things off the main route: idol collapse and the kicked east wall, the cliffs loop (crouched traverse, vines, second bridge, Storm Opal), boulder trap, crown darts, all four endings, night sweep, menus, shop, settings, map, debug overlay, pause, torch dousing by water, wind and a fall, burnout, spare torch, oil flask, sconce placement, rope anchor, ghost.
- **Real input path:** clicking "Begin the expedition" takes pointer lock, a `mousemove` with `movementX/Y` turns the view the right way, W moves, Esc releases the lock and pauses.
- **What this cannot show:** the container has no GPU. Chromium renders through SwiftShader at 1 to 2 FPS, so I have looked at about forty still screenshots, never at the game in motion. Animation feel, camera feel, mouse sensitivity, whether traps read fairly at speed, whether the pacing is fun: all unjudged by a person. Audio was never heard.

## Requirement by requirement

Status is **Done**, **Partial** or **Missing**. "Verified" means a script observed it in the running game.

### Hard constraints

| Requirement | Status | Detail |
| --- | --- | --- |
| TypeScript web app, Three.js, real physics engine, no game engine | Done | Three.js 0.170, Rapier 0.14 (`@dimforge/rapier3d-compat`), Vite, TypeScript strict. |
| Runs from `npm install && npm run dev` | Done | Verified from a clean install in the container. |
| README with run steps and controls | Done | `README.md`. |
| Every asset generated in code | Done | No image, model or audio files in the repo. Canvas textures, procedural geometry, WebAudio synthesis. |
| 60 FPS on a mid-range laptop with shadows on | **Not verified** | See "Frame rate" below. I have complexity numbers, not a frame rate. Treat this as unproven. |

### 1. Scene progression

| Requirement | Status | Detail |
| --- | --- | --- |
| Seven or more scenes, streamed in and out, no loading screens | Done | Seven scenes: jungle, courtyard, cliffs, halls, sanctum, catacombs, vault. `World` builds neighbours with generators spread over frames and disposes scenes two links away. Verified walking the whole chain; the debug overlay shows the loaded set. There is one loading screen at boot only. Not verified: whether scene builds cause a visible hitch on real hardware. |
| Zone A: jungle approach with vegetation, river crossing, collapsing rope bridge | Done | Stepping stones across a river with current, then a jointed rope bridge over a gorge whose planks crack and drop behind you. Verified on foot. |
| Zone A: courtyard, sundial puzzle from the real sun position, great door as entrance and only exit | Done | The dial's gnomon shadow comes from the live sun direction; you turn the ring until the noon mark sits where the sun will put the shadow at noon. Solved on foot in 3 turns. The door is the only way a run can end in an escape. |
| Zone A: outer cliffs, optional, ledges, vines, wind, high-value relics | Done | Reached by kicking through a cracked wall or through a breach in the halls. Gusts push you (crouch to hold on) and blow the torch out. Verified crouched traverse, vine climb, mantle, bridge, Storm Opal. Standing up in a gust will throw you off; that is intended but may feel harsh. |
| Zone B: broken halls, sun shafts that move through the day, paths only safe while sunlit | Done | Roof openings are real geometry, so the sun's shadow map puts moving light on the floor. Scarab bands hurt only where the floor is in shadow, computed from the same openings and sun direction (`core/sunlight.ts`, unit tested). Verified at noon: standing under a roof slot for 3 s costs nothing, 4.5 m to the side costs 40 HP, and the same safe spot is in shade (and hurts) at t = 120 s and t = 660 s. |
| Zone B: collapsed sanctum, unstable ceiling, noise brings debris, idol under a light beam | Done | Running, landing and thrown objects fill a noise meter; crossing thresholds drops debris near you. Verified: walking stays at ~0, sprinting four lengths took it to 0.97 and cost 30 HP. |
| Zone C: lower catacombs with crumbling floors, dart corridors, flooded chamber | Done | Verified all three on foot, plus the chasm bridge. |
| Zone C: deep vault, richest and heaviest loot, longest way out, guardians' lair next door | Done | Lair is the next room. The chasm bridge drops planks as you cross, so the way home is the blade corridor, the lever and the drawbridge. |
| Each zone more dangerous and more valuable | Done | Value: tested on level data over 40 seeds. Danger: by design (A: falls and water, B: scarabs, debris, C: darts, blades, boulder, darkness). |
| Deeper scenes unlock via puzzles, keys, relics found earlier | Done | Sundial gives the Sun Disc, the disc opens the Great Door and later the sun seal; block and plate open the portcullis; the Serpent Key opens the vault. `core/unlock.ts`, unit tested. |
| Shortcuts open once used | Done | Two kick-through walls, the drawbridge, and the sun seal stay open for the run. They are per run, not saved between runs. |
| Escape route is its own design | Done | The vault's way out differs from the way in, and taking the idol collapses the sanctum's main passage (see stretch goals), forcing the east wall and cliffs or the smuggler's wall. |

### 2. Physics

| Requirement | Status | Detail |
| --- | --- | --- |
| Rope and plank bridges from jointed rigid bodies, planks crack and drop after a delay | Done | Each plank position is a dynamic body chained with spherical joints to fixed anchors; stepped-on planks crack, then fall as separate debris bodies while the rope line holds. Three bridges. Verified. The deck sags and bounces a little; I have only seen it in stills. |
| Crumbling floors | Done | Tiles go dynamic 0.7 s after contact. Verified, including the safe path. |
| Rolling-boulder trap | Done | Pressure plate on the vault ramp releases a 1.5 m dynamic sphere; alcoves to dodge into. It breaks into throwable rocks once it comes to rest so it cannot wall you in. Verified. |
| Pressure plates | Done | Fire on the player or any body over a mass threshold. Used for the portcullis (needs the block), darts and the boulder. |
| Swinging blades | Done | Kinematic pendulums, 40 damage. Verified timing a run through three of them. |
| Dart traps | Done | Wall launchers with projectile bodies. Verified. |
| Pushable stone blocks | Done | Dynamic cuboid with locked rotation pushed by the character controller. Verified on foot. Only one block puzzle exists. |
| Loot has real weight: slower, stamina drains faster | Done | `speed = 1 − 0.55·r^1.3`, `drain = 1 + 1.5·r` for load ratio r; pickups over capacity are refused. Unit tested and visible in play. |

### 3. Sun, time and lighting

| Requirement | Status | Detail |
| --- | --- | --- |
| Real sun crossing the sky over a 12 to 15 minute day, with shadows | Done | 13 minute day (780 s). One shadow-casting directional light follows the camera with a texel-snapped frustum. |
| Sunlight reaches A and B only through openings, so sun angle changes what is lit | Done | Roofs and walls are shadow casters; ambient is scaled by a per-zone exposure. |
| Colour grading dawn, noon, red-orange sunset, night | Done | Keyframed grade (sky, fog, sun colour, ambient, exposure) in `core/sun.ts`. Checked in screenshots at several times of day. |

### 4. The ticking clock

| Requirement | Status | Detail |
| --- | --- | --- |
| Always-visible countdown drawn as a stone sundial | Done | Canvas dial with a moving shadow hand plus a digital readout under it. |
| Ticking that speeds up and gets louder in the last 2 minutes | Done | Verified by event counts: 10 ticks per 10 s normally, 13 at 90 s left, 18 at 55 s, 30 at 20 s. Volume ramp is in code and unheard. |
| At 60 s: screen edges pulse, music shifts, temple rumbles | Done | Verified: edge overlay opacity pulsing, music mood switches to `urgent`, rumble events and camera shake. |
| At zero: darkness, guardians wake, door begins closing with a short final window | Done | Door closes over 60 s on a cubic curve: walk under it for about 51 s, duck under until about 55 s. Verified escaping at t = 829 and being sealed in after. |
| In Zone C the HUD sundial and sounds are the only sense of time | Done | No sky, no ambient, no light leaks below the seal. |

### 5. The torch

| Requirement | Status | Detail |
| --- | --- | --- |
| Zone C has zero ambient light, true black outside the torch | Done | See the dedicated section below. Measured, not assumed. |
| Dynamic point light with flicker and real shadows | Done | One PointLight with a cube shadow map (512 on high), flicker from layered noise. |
| Fuel burns, radius shrinks when low | Done | 240 s base burn. Full radius above 35% fuel, then a curve down. Verified 11 m at full, 8.67 m at 20%. |
| Water, wind gusts and falls blow it out | Done | All three verified in the running game. |
| Relighting is a short vulnerable animation | Partial | 2.2 s during which the light is off and you cannot sprint. The "animation" is the torch dipping out of view and a strike sound. There is no flint-and-hands animation. |
| Limited fuel and spare torches, placeable in wall sconces | Done | Oil flasks (+45%), spare torches (T), 17 sconces. Verified placing one. Sconce lights come from a pool of 4, so only the 4 nearest lit sconces actually shine. |
| Guardians drawn to torchlight | Done | Sentinels see a lit torch from 30 m, shades sense it from 40 m but cannot enter the light and wait at its edge. Unit tested in the FSM. The shade's lurk and strike behaviour was not watched in the running game. |

### 6. Relics and economy

| Requirement | Status | Detail |
| --- | --- | --- |
| At least 15 relic types with different values, weights, rarities | Done | 19 types, five rarities, 0.2 kg to 9 kg, 40 to 1,600 base value. 41 relic spots per run, seeded. |
| Worth more the deeper they are found | Done | Value is base × the scene's depth multiplier. Tested. |
| Some trapped unless swapped with an equal-weight object | Done | Gold-ringed pedestals. Holding a rock within ±20% of the relic's weight swaps it in. Verified both the swap and the trap (crown darts, −30 HP). The idol is a special case: its trap is the collapse and cannot be defused. |
| Running loot value on the HUD | Done | |
| Only loot carried out of the door counts | Done | Verified: caught, killed and entombed all bank 0. |

### 7. Guardians

| Requirement | Status | Detail |
| --- | --- | --- |
| At least 3 types with different movement and senses | Done | Stone Sentinel (slow, relentless, sight), Crawler (fast, blind, hearing), Shade (drawn to torchlight, repelled by it). Seven guardians in total. |
| Spawn in the deepest scenes first and sweep outward | Done | Verified wake times: vault +2 s, catacombs about +17 s, sanctum about +32 s, halls about +47 s, each sweeping a route that ends at the door. |
| Real navmesh pathfinding | Done | Rectangle-polygon navmesh with portals, A* and funnel string-pulling, tags for doors and bridges, obstacle carving. Unit tested, and every spawn-to-door path is tested on the level data. |
| Getting caught loses the run and everything carried | Done | Verified. |
| | Caveat | Guardians are simple shapes built from boxes and cylinders with a bob or leg-swing. I never saw one move in real time. They are dormant for the whole day by design, so the first 13 minutes have traps but no pursuers. |

### 8. Player

| Requirement | Status | Detail |
| --- | --- | --- |
| Pointer-lock first-person | Done | Verified the real lock flow. |
| Run, jump, crouch, stamina | Done | |
| Climb vines and ledges | Done | Vines, mantling up to 1.7 m, and a purchasable rope. |
| Grab, carry, drop, throw | Done | Rocks and bones; used for pedestal swaps, pressure plates and making noise. |

### 9. Meta and UI

| Requirement | Status | Detail |
| --- | --- | --- |
| Results screen (haul, time, relics found) | Done | Also deepest find, damage taken, traps sprung, rank, relic list. |
| Persistent high-score table | Done | Top ten in `localStorage`. |
| Shop with gear upgrades | Partial | Torch (2 upgrades), oil flasks (2), satchel (2) and rope. **Rope is one level, not the two in the original design**, because only one anchor ring was built (outer cliffs, down to a shelf with a rich relic). Verified buying and that the loadout changes. |
| Saved in localStorage | Done | Settings, gold, upgrades, scores, best-run ghost under `lost-temple-save-v1`. |
| Main menu, pause, settings (FOV, sensitivity, volume, quality) | Done | Verified quality "low" really drops the shadow map to 1024 and pixel ratio to 1. Shadows stay on at every level. |
| HUD: sundial, stamina, weight, torch fuel, loot value | Done | Plus health, objective line, noise meter in the sanctum. |
| Debug overlay: FPS, physics body count, current scene | Done | F3. Also draw calls, triangles, light levels, guardians awake. |

### 10. Audio

All of it is synthesised with WebAudio at runtime. **None of it has been listened to.** I can show the right sounds are triggered at the right moments (there are play counters), not that they sound like what they are meant to be, or that the mix is tolerable.

| Requirement | Status | Detail |
| --- | --- | --- |
| Jungle ambience by day | Done, unheard | Filtered-noise beds plus random bird and insect chirps; drips underground. |
| Deep rumbles at dusk | Done, unheard | Triggered from 60 s left and after dark. |
| Clock ticking | Done, unheard | Tick rate verified by counters. |
| Creaking and snapping wood, stone grinding | Done, unheard | Bridges, block, doors. |
| Torch crackling | Done, unheard | |
| Guardian calls | Done, unheard | One call per type; counters show them firing at night. |
| Heartbeat when guardians are near | Done, unheard | Rate and volume scale with distance to the nearest awake guardian. |
| Music | Extra, unheard | A sparse generated score with three moods (explore, urgent, night). This is the part most likely to be annoying. |

### Stretch goals

| Goal | Status | Detail |
| --- | --- | --- |
| Hand-drawn map that fills in as you explore | Done | M or Tab. Parchment canvas, rooms ink in when entered, brown ink above ground and blue below. |
| Collapse sequence on taking the main idol | Done | Debris storm, shake, the main passage is plugged with rubble. Verified with the escape through the east wall. |
| Ghost replay of the best run | Partial | Position is sampled every 0.5 s on a banked run and replayed as a translucent figure plus a map marker. Verified only with synthetic data that the figure appears at the right place. No animation, no orientation. |
| Gamepad support | Partial | Written against the standard mapping. **Never tested**; there is no gamepad in a headless browser. |

## Zone C ambient light: confirmed zero

Checked in the running game, not just in code:

- With the torch out in the catacombs and in the vault, the rendered framebuffer was read back and **every pixel was exactly (0, 0, 0)**; `sky.ambientIntensity` was exactly 0.
- How: the hemisphere light and sun are set to intensity 0 the moment the player is in Zone C (it snaps, it does not ease), the sky dome is hidden, the background and fog are black. Zone C materials are compiled with a "dark" gate so they ignore sky lighting even if a neighbouring roofless scene is still loaded. Nothing in Zone C is emissive. The held torch's own stick and unlit sconces use hand-driven unlit colours that go to black there.
- The only lights that can exist in Zone C are the torch in your hand and spare torches you put in sconces yourself.
- One honest footnote: the HUD is still drawn, obviously, and the debris dust in the sanctum (Zone B, not C) is an unlit sprite that I dim by hand with the sky level.

## Frame rate

**I could not measure FPS on real hardware.** This container renders with SwiftShader (CPU rasteriser), where the game runs at 1 to 2 FPS, which says nothing about a laptop GPU. What I can give is the load, measured at 960×540 on the "high" preset:

| Zone | Scene | Draw calls | Triangles | Physics bodies | Sim cost per 60 Hz step |
| --- | --- | --- | --- | --- | --- |
| A | Jungle approach | 117 to 170 | 64k to 66k | 28 | 0.83 ms |
| A | Temple courtyard | 148 to 232 | 18k to 70k | 35 | 0.43 ms |
| A | Outer cliffs | 39 to 231 | 10k to 26k | 28 to 55 | 0.29 ms |
| B | Broken halls | 138 to 301 | 16k to 35k | 38 | 0.38 ms (0.66 at night, guardians awake) |
| B | Collapsed sanctum | 143 to 336 | 14k to 24k | 70 to 80 | 0.38 ms (0.53 at night) |
| C | Lower catacombs | 18 to 336 | 6k to 23k | 60 to 78 | 0.31 ms (0.46 at night) |
| C | Deep vault | 29 to 258 | 3k to 17k | 51 to 60 | 0.30 ms (0.29 at night) |

Ranges cover different viewpoints and how many neighbouring scenes were loaded. "Sim cost" is wall time for one fixed step of physics plus game logic in headless Chromium on the container's CPU, so simulation uses about 5% of a 16.7 ms frame at worst. Draw calls include the shadow passes.

My expectation, stated as a guess: these numbers are small (at most about 340 draw calls and 70k triangles, one 2048 shadow map, one 512 point-light cube map, seven lights at most: sun, hemisphere, torch and four sconces) and should hold 60 FPS on integrated graphics from the last few years. The risks I would look at first if it does not: the high preset's pixel ratio of 2 on a high-DPI screen (drop to medium), the torch's cube shadow map (six passes) while the sun's map is also live in Zone B, alpha-tested vegetation overdraw in the jungle, and hitches when a scene streams in. Until someone runs it and reads the F3 overlay, the 60 FPS requirement is **unverified**.

## Known bugs and rough edges

1. Not play-tested by a person. Balance (trap damage, stamina, torch burn rate, how tight 13 minutes is) is tuned by reasoning and scripts. The scripted full run takes about 4 minutes while grabbing only 3 relics, so a human run that explores should fit, but I do not know how it feels.
2. The wind on the cliffs is strong. Standing in a full gust pushes you off a ledge in under a second. There is a warning toast and crouching nearly cancels it.
3. Scarabs do 14 HP per second in shadow. In the early morning the halls are mostly shadow and crossing costs 10 to 27 HP on the direct line; at night they are effectively lethal. That may be over-tuned.
4. You cannot drown. Deep water puts the torch out and the river current carries you, but there is no breath meter.
5. The swap for a dead torch (T) gives you a fresh unlit torch; you still have to press F to light it. It reads as two steps where one was probably expected.
6. After the door starts closing the clock stops ticking (the HUD switches to a door countdown). A door tick would have been better.
7. `window.__lt` (teleport, god mode, set time) ships in production builds. It is a cheat console.
8. The production bundle is one 2.7 MB JS file because the Rapier compat build inlines its WASM.
9. Shortcuts and opened doors last for the run, not across runs.
10. Guardians, statues and props are plain primitive geometry. Readable, not pretty.
11. The debug overlay covers part of the objective text while open.
12. Only four sconce lights can shine at once (nearest four).
13. Falling past vines or a rope now grabs them automatically. That was added late so you can get onto a rope from above, and it has only been tested on the cliffs.
14. Unknown unknowns in motion: anything that only shows up at 60 FPS (shadow shimmer, camera jitter on the bridge, z-fighting, popping when scenes stream) I had no way to see.

## Deviations from DESIGN.md

- Rope upgrade is one level instead of two (one anchor in the level).
- The Great Door closes on a cubic curve instead of linearly, so the final window is usable for most of its 60 seconds.
- The boulder breaks into rocks after it stops, which was not planned.
- Rapier's built-in autostep was not reliable with a capsule on low lips, so the player has a custom step-up and lip-hop on top of the character controller.

## Eval bookkeeping

| | |
| --- | --- |
| Start (UTC) | 2026-11-11T21:27:12Z |
| Finish (UTC) | 2026-11-11T23:48:19Z |
| Wall-clock total | 2 h 21 min 7 s |
| Entry | `evals/lost-temple/fable-5.2-high` |

**Token usage and cost.** I could not run `/usage`; it is an interactive command of the terminal app and is not available from inside the session. The session API reports no token or cost totals either. What I can see is this session's own transcript log, which records the usage block of every model response, so the numbers below are summed from that (246 responses, taken when this file was finalised; the last few calls to push and open the PR are not included):

| Token type | Tokens | Rate (USD per million) | Cost |
| --- | --- | --- | --- |
| Input (uncached) | 466 | 8.00 | $0.00 |
| Output (includes thinking) | 614,039 | 40.00 | $24.56 |
| Cache write (1 hour) | 1,206,014 | 16.00 | $19.30 |
| Cache read | 58,849,638 | 0.20 | $11.77 |
| **Total** | | | **$55.63** |

The dollar figure is an **estimate at public API list prices**, computed by me. It is not a bill, and a subscription session is not charged per token this way. It also excludes one context-compaction summary call that happened mid-session if that call was not written to the log. No subagents were used.
