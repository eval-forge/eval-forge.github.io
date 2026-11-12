# Self review

An honest account of what was built, what was checked and how, and what is missing or broken. "Done" means the feature is in the game and something exercised it: a unit test, or one of the headless play tests in `scripts/` driving the real game in Chromium. Where a claim rests on reading the code and nothing ran it, the row says so.

**The big caveat first.** Every play test ran in headless Chromium with SwiftShader (software WebGL) on a 4-core cloud container, at 2 to 5 frames per second, with no audio output, no GPU, and input injected through a debug API rather than a mouse and keyboard. Nobody has played a full run by hand. The tests drive every system in isolation and one scripted heist end to end, but "fun" and "60 FPS on a laptop" are not things this environment could measure.

## Bookkeeping

| | |
|---|---|
| Started | 2026-11-11T21:27:08Z (thread start) |
| Finished | 2026-11-12T02:46:23Z (everything built and verified; committing and opening the PR came after) |
| Wall-clock | 5 h 19 min 15 s |
| Run | Max effort, one session, no sub-agents |
| Token usage | 780 API calls: 1,483 input, 1,349,402 output, 2,827,414 cache-write (1-hour) and 187,418,463 cache-read tokens |
| Cost estimate | About $87.10 at API list prices: $26.99 output, $22.62 cache writes, $37.48 cache reads, $0.01 input |

How the usage was counted: `/usage` is a command of the interactive Claude Code terminal and is not available inside this session, so the numbers come from the session's own transcript (the `usage` block that the API returns on every response, de-duplicated by message id). Prices are this model's published API list rates: $4 per million input tokens, $20 per million output tokens, $0.20 per million cache-read tokens and $8 per million for 1-hour cache writes (all cache writes in this session were 1-hour). Two things can make the real bill differ. The context filled up and was compacted 8 times, and the summarisation calls behind compaction (each reading about 390k tokens of context) are not in the transcript, so the figure is an undercount: by roughly $2 if those calls read from the prompt cache, by up to about $14 if they did not. And the platform may meter differently from list price. Output tokens include thinking.

## Requirements

### Constraints

| Requirement | Status | Evidence and notes |
|---|---|---|
| TypeScript, Three.js, a real physics engine, no game engine | Done | three 0.187, @dimforge/rapier3d-compat 0.21, Vite 8, TypeScript 6. About 16,300 lines of game code in `src/`, plus about 970 lines of unit tests. |
| `npm install && npm run dev`, README with run steps and controls | Done | README covers requirements, commands, every control, gamepad mapping, how a run works, and the test scripts. |
| Every asset generated in code | Done | No asset files in the repository (the favicon is an inline SVG data URI). Textures are drawn on canvases at start-up (`src/render/textures.ts`), meshes are built from primitives and lathes, relic models are procedural (`relicMeshes.ts`), and every sound and the music are synthesised with WebAudio. |
| 60 FPS on a mid-range laptop with shadows on | **Not verified** | No GPU was available. The transferable numbers: game logic costs 2.3 to 3.4 ms of CPU per frame, physics 0.1 to 0.3 ms (one 3 ms spike at the cliffs), scenes draw 290 to 810 calls and 27k to 317k triangles on the default Medium preset (2048 sun shadow map, 512 torch cube shadows). If a 5-second window in the first four minutes of play averages under 45 FPS, the game steps the preset down one level (at most twice) and says so. I expect a mid-range laptop GPU to manage it at 1080p on Medium, but I have not seen it, and the torch's cube shadow (six extra passes) is the most likely place to lose frames. See the FPS table below. |

### 1. Scene progression

| Requirement | Status | Evidence and notes |
|---|---|---|
| At least 7 scenes in 3 zones, streamed with no loading screens mid-run | Done | Jungle, courtyard, cliffs (Zone A); broken halls, collapsed sanctum (Zone B); lower catacombs, deep vault with the lair (Zone C). One continuous world; scenes stream in and out by distance with their build spread over frames (`SceneManager`). `tour.mjs` logs the loaded set at each stop. The only loading fade is when a run starts. |
| Jungle approach: dense vegetation, river crossing, first collapsing rope bridge | Done | Instanced trees, ferns and grass; a river with a current, stepping stones and a fallen log; the gorge bridge (`bridge.mjs walk`: all 22 planks crack and fall behind the walker, who crosses). |
| Courtyard: plazas, toppled pillars, real-sun sundial puzzle, great door as entrance and only exit | Done | `progression.mjs` solves the sundial from the real sun direction (the answer moves during the day), takes the Sun-Disc and opens the seal. `door.mjs` pushes a block onto one plate and stands on the other to raise the door. The run ends by leaving through the door (haul cart outside) or by the door shutting. |
| Outer cliffs: optional, ledges, vines, wind, relics in the open | Done | `climb.mjs` mantles three ledges and climbs two vine faces to the plateau; `hazards.mjs` shows the wind pushing a thief who stands still (7.7 to 8.8 m across runs) and tearing out the torch. |
| Broken halls: moving sun shafts, paths safe only while sunlit | Done | Sun shafts through the broken roof follow the sun. The chasm's 16 sunstone tiles are solid only while a raycast to the sun is clear: `hazards.mjs` sweeps the day and sees 5 different lit patterns (lit from about 11:00 to 4:00 before dark), stands on a lit tile, then moves the sun off it and falls into the chasm. |
| Collapsed sanctum: half the ceiling gone, noise brings debris, idol under a beam of light | Done | `hazards.mjs`: crouch-walking under the cracked half adds no strain; sprinting brings a section down after 9 to 13 s. The Sun Idol sits in a light shaft on a weighted altar; taking it collapses the rest (`traps.mjs`). |
| Lower catacombs: crumbling floors, dart corridors, flooded chamber | Done | `traps.mjs` (a gallery tile breaks under you and drops you on spikes; dart plates fire), `hazards.mjs` (the flooded channel drowns the torch; swim it, climb onto the island, take the Serpent Key), `bridge.mjs flood` (the plank bridge over the channel). |
| Deep vault: richest and heaviest loot, longest way out, lair next door | Done | Zone C relics are worth 2.5x and include the heaviest pieces (gold ingot 12 kg, Heart of the Temple 15 kg). The escape route (aqueduct, boulder ramp, Bone Wing, Bone Stair, halls) is walked by `route.mjs`. The lair is behind a portcullis that opens at darkness. |
| Each zone more dangerous and more valuable | Done | Zone value multipliers 1.0 / 1.6 / 2.5 (unit tested), rarer pools deeper, more and deadlier traps deeper, zero light in Zone C, guardians wake deepest first. |
| Deeper scenes unlock through items found earlier | Done | Sun-Disc (courtyard sundial) opens the sanctum seal and the stairs to Zone C (`progression.mjs`); the Serpent Key (flooded chamber island) opens the serpent door to the vault (`hazards.mjs` picks it up on foot and opens the door). Unlock logic is unit tested. |
| Shortcuts that stay open; an escape route of its own design | Done | The Bone Wall can only be kicked down from the catacomb side and then opens the Bone Stair straight up to the halls; the drawbridge lever is on the far side of the chasm; the aqueduct gate is cranked from inside the vault. All stay open (flags persist for the run and rebuild streamed scenes). The way out (aqueduct, boulder ramp, Bone Wing, Bone Stair, drawbridge) shares almost nothing with the way in (sunstones or blade ledge, sanctum, seal stairs, dart corridor, serpent door). `route.mjs both` walks both. |

### 2. Physics

| Requirement | Status | Evidence and notes |
|---|---|---|
| Rope and plank bridges from jointed rigid bodies; planks crack and drop after a short delay | Done | Planks are rigid bodies joined by pairs of spherical joints; a plank you touch cracks and drops 0.55 s later (sooner when loaded). Two bridges: the gorge (22 planks, `bridge.mjs walk`) and a short plank bridge over the flooded chamber's channel (`bridge.mjs flood`: walked across with the torch still lit while all six planks fell behind; stopping on the second plank dropped the thief into the channel and put the torch out). |
| Crumbling floors, rolling boulder, pressure plates, swinging blades, dart traps, push blocks | Done | `traps.mjs` (17 checks: the urn pedestal swap and trigger, darts, a crumbling tile, dart plates standing and walking, halls and vault blades, the idol collapse, the boulder), `door.mjs` (push block onto a plate), `route.mjs` (the boulder rolls down the aqueduct ramp and smashes). |
| Loot weight slows you and drains stamina faster | Done | Speed falls to 55% at a full satchel, jumps get lower, stamina drain is multiplied by up to 2.2 (unit tested in `economy.test.ts` and used by the player controller). Heavy loot also makes bridge planks drop sooner. |

### 3. Sun, time and lighting

| Requirement | Status | Evidence and notes |
|---|---|---|
| A real sun across a 12 to 15 minute day, casting shadows | Done | 13-minute day plus a 90 s door window. One directional light follows the computed sun path (unit tested in `sun.test.ts`) with a shadow frustum that follows the player. |
| Sunlight only in Zones A and B, through openings, so the angle changes what is lit | Done | Zone B gets the sun through roof holes and cracks; the sunstone sweep above shows the lit areas moving. Zone C has no sun at all (see the darkness section). |
| Colour grading from dawn through noon and a red-orange sunset to night | Done | A full-screen grade pass keyed to the time of day (exposure, contrast, saturation, split toning, vignette). Checked by eye in screenshots during development, not by an automated test. |

### 4. Ticking clock

| Requirement | Status | Evidence and notes |
|---|---|---|
| Always-visible stone sundial on the HUD that ticks, faster and louder in the last 2 minutes | Done | `SundialHUD.ts` draws the dial with the real shadow and a red wedge for darkness. Tick spacing goes from 1.0 s to 0.33 s and volume from 0.35 to 1.0 over the last 120 s (unit tested in `countdown.test.ts`). The tick sound produces signal (`audio.mjs`). |
| At 60 s: edges pulse, music shifts, temple rumbles | Done | `audio.mjs` crosses the 60 s mark and checks the music tension, the red edge pulse and the rumble with camera shake (music tension 0.85, the red edge pulse on, the "temple shudders" rumble with a camera shake, and dusk rumbles building in the ambience). |
| At 0: darkness, guardians wake, the door starts closing, a short window to escape | Done | `darkness.mjs outside` (the door shuts behind you: "You made it out"), `darkness.mjs hall` (the guardians sweeping to the door catch you just inside it), `darkness.mjs inside` (hiding in the catacombs ends caught or entombed). |
| In Zone C only the HUD and sounds tell the time | Done | No sky, no sun and no ambient light underground; the HUD dial and the ticking keep going. |

### 5. Torch

| Requirement | Status | Evidence and notes |
|---|---|---|
| Zone C has zero ambient light; outside the torch radius it is true black | Done | See "Zone C darkness" below: 0 lit pixels in 32 views with the torch out. |
| The torch is a dynamic point light with flicker and real shadows | Done | Point light with cube shadow maps and layered-noise flicker; intensity and radius follow the fuel. |
| Fuel burns, radius shrinks, water, gusts and falls blow it out, relighting is a short vulnerable animation | Done | Fuel and radius curve unit tested (`torch.test.ts`). `hazards.mjs` blows the torch out with water (swimming), a cliff-top gust and a hard landing, refuses to relight while swimming, and relights on dry stone in 2.3 to 2.7 s of game time (no sprinting, jumping or grabbing meanwhile). |
| Find limited fuel and spare torches; place torches in wall sconces | Done | 3 oil flasks and 2 spare torches lie along the way (`supplies.mjs` picks up all five). 20 wall sconces take a spare torch, burn 6 minutes and relight your torch instantly. The shop sells more. |
| Guardians are drawn to torchlight | Done | The stone sentinel sees a lit torch from much further away than a dark thief; the shadow avoids light and strikes when your light is small or out. Unit tested in `guardians.test.ts`. |

### 6. Relics and economy

| Requirement | Status | Evidence and notes |
|---|---|---|
| At least 15 relic types with values, weights and rarities, worth more deeper | Done | 19 types (17 that roll at random plus the Sun Idol and the Heart of the Temple), common to legendary, 0.3 kg to 15 kg, each a distinct procedural model. Value = base x zone multiplier x condition (unit tested). |
| Trapped relics: swap an equal weight or the trap fires | Done | `traps.mjs`: swapping a sandbag of similar mass for the urn leaves the trap armed; lifting the sandbag off again fires darts that hit the thief. Pedestal trigger rules unit tested. |
| Running loot value on the HUD; only loot carried out counts | Done | HUD shows carried and banked value. Loot counts when banked in the haul cart outside the door or carried out when the run ends outside; being caught or killed loses what you carry (settlement unit tested; `heist.mjs` banks a relic and leaves). |

### 7. Guardians

| Requirement | Status | Evidence and notes |
|---|---|---|
| At least 3 types with different movement and senses | Done | Stone sentinel (slow, sight, sees light from far away), crawler (fast, blind, hunts by sound; thrown objects make decoys), shadow (avoids light, stalks at the edge of your light, strikes in the dark). State machines unit tested. |
| Spawn deepest first and sweep toward the door | Done | Lair at 0 s, vault 8 s, catacombs 18 s, sanctum 30 s, halls 45 s after darkness; all sweep toward the great door unless they have a lead on you. Visible in the `darkness.mjs` logs. |
| Real navmesh pathfinding | Done | Navmesh of convex polygons built from the level geometry, stitched across scenes, A* over polygons and a funnel pass (`navmesh.test.ts`). Gates and fallen floors switch polygons off; a shut gate gives a partial path so guardians press against it. |
| Caught means losing the run and everything carried | Done | `darkness.mjs hall` ends "Caught: a crawler caught you in the broken halls"; settlement drops carried loot (unit tested). |

### 8. Player

| Requirement | Status | Evidence and notes |
|---|---|---|
| Pointer-lock first-person controls; run, jump, crouch, climb vines and ledges, stamina | Done (pointer lock untested) | Movement, sprint, crouch, jump, mantle, vine climbing, swimming and stamina are exercised by `climb.mjs`, `hazards.mjs` and the others. Pointer lock itself cannot be acquired in a headless test, so the mouse-look path has only been checked by reading the code. |
| Grab, carry, drop and throw | Done | `climb.mjs` picks up a sandbag and throws it 14 to 22 m; `traps.mjs` carries the urn and the sandbag; up to 25 kg can be lifted. |

### 9. Meta progression and UI

| Requirement | Status | Evidence and notes |
|---|---|---|
| Results screen with haul value, time and relics found | Done | `heist.mjs`, `menus.mjs`, `darkness.mjs`. |
| Persistent high scores and a shop selling gear upgrades, in localStorage | Done | `menus.mjs` buys a satchel upgrade, checks the purse, high-score rows and that settings persist. Shop: bigger satchel, brighter torch, more fuel, rope, boots, spare torches, oil flasks. |
| Main menu, pause, settings (FOV, sensitivity, volume, quality), HUD, debug overlay | Done | `menus.mjs` (settings saved and persisted, Escape pauses and the clock stops, resume, abandon). HUD: sundial, health, stamina, weight, torch fuel, carried and banked value, gear, satchel list. F3 debug overlay: FPS, frame cost, physics bodies and colliders, scenes, draw calls, guardians. |

### 10. Audio

| Requirement | Status | Evidence and notes |
|---|---|---|
| Procedural jungle ambience, dusk rumbles, ticking, creaking and snapping wood, stone grinding, torch crackle, guardian calls, heartbeat | Done (never listened to) | All synthesised in `src/audio/`. `audio.mjs` taps the audio graph with analysers: the ambience and music buses carry signal by day, each of the 19 listed effects puts signal on its own voice (peaks 0.04 to 1.1), the torch, grind, wind and river loops play, and the final-minute cues fire. The container has no speakers, so how any of it sounds, and the mix, are unverified. |

### Stretch goals

| Goal | Status | Evidence and notes |
|---|---|---|
| Hand-drawn map that fills in as you explore | Done | M or Tab. Parchment and ink drawn in code, revealed around where you have been, surface and underground sheets, marks for keys, levers and lit sconces. Checked by eye in screenshots, no automated test. |
| Collapse sequence when the main idol is taken | Done | `traps.mjs`: taking the Sun Idol brings the sanctum ceiling down over about 18 s and rubble blocks the nave. |
| Ghost replay of your best run | Done | `hazards.mjs`: escaping with loot saves the run's track, and the next run shows the ghost at the same places at the same times (escaping with $245 banked saved a 746-sample track; on the next run the ghost was at the recorded halls stop at 5.4 s and within 0.7 m of the sanctum stop at 31.8 s). |
| Gamepad | Done (simulated pad only) | `hazards.mjs` plugs in a simulated standard-mapping pad: the left stick walks, the right stick turns, A jumps, Y works the torch. Never tried with a physical controller. |

### Process

| Requirement | Status | Evidence and notes |
|---|---|---|
| DESIGN.md and ARCHITECTURE.md before any code | Done | Commit `e229831` (21:40 UTC) has only the two documents; the first code commit is `91d0e0b` (21:53 UTC). Both documents were kept up to date as the build changed. |
| Unit tests for the loot economy, trap triggers, countdown thresholds, torch fuel and radius, scene unlocks, guardian state machines | Done | 109 tests in 9 files, all passing (`npm test`): economy 16, guardians 18, torch 14, countdown 12, traps 12, navmesh 10, noise and save 10, unlocks 9, sun 8. |
| Honest SELF_REVIEW.md | This file | |

## Zone C darkness

Zone C (the catacombs and the vault) has no ambient, hemisphere or fill light, no sun, no sky, black background and black fog, and none of its materials are emissive. When the camera is inside a Zone C scene the renderer switches those off; the only lights are fire: your torch, lit sconces, and burning torches you set down.

`scripts/check-dark.mjs` renders 32 views with the torch out (8 positions in the catacombs and vault, 4 directions each, with 70 s left on the clock) and reads every pixel back: **0 lit pixels out of 129,600 in every view, maximum channel value 0.** The same check with the torch lit finds 112,550 lit pixels, so the check can see light when there is some. Confirmed: Zone C has zero ambient light.

## Performance

Measured by `scripts/tour.mjs medium` on the default Medium preset at 480 x 270 in headless Chromium with SwiftShader (software rendering, 4 CPU cores, no GPU). **The FPS column measures the software renderer, not the game, and says nothing about a real GPU.** The CPU columns and the draw-call and triangle counts are what carry over.

| Zone | Scene | FPS (SwiftShader) | Game update, ms | Physics, ms | Draw calls | Triangles | Rigid bodies | Colliders |
|---|---|---|---|---|---|---|---|---|
| A | Jungle | 3.0 | 2.94 | 0.20 | 380 | 283k | 41 | 294 |
| A | Jungle, rope bridge | 1.6 | 2.63 | 0.10 | 405 | 317k | 41 | 294 |
| A | Courtyard | 2.5 | 3.18 | 0.10 | 640 | 255k | 93 | 510 |
| A | Outer cliffs | 2.8 | 3.03 | 3.00 | 287 | 198k | 93 | 510 |
| B | Broken halls | 5.0 | 3.38 | 0.30 | 808 | 125k | 136 | 784 |
| B | Collapsed sanctum | 3.3 | 3.22 | 0.10 | 752 | 49k | 103 | 587 |
| C | Lower catacombs | 3.1 | 2.39 | 0.10 | 720 | 52k | 125 | 564 |
| C | Deep vault | 3.9 | 2.26 | 0.20 | 423 | 27k | 125 | 564 |

The physics figure at the cliffs is a one-off spike (0.2 ms in the previous tour). Rigid bodies and colliders count everything in the scenes streamed in at that stop, not only the named scene. FPS on a real mid-range laptop: unknown.

## Bugs found and fixed in the final pass

Found by the play tests in the last hours, all fixed and re-tested:

- The seal stairwell's walls and solid steps stood on the catacomb floor and sealed off the dart corridor that runs underneath, so there was no walking route to the vault. The stairwell now follows the stair.
- The character controller stalls on kinematic floors, so the lowered drawbridge and the closed seal could not be walked across. Everything walkable is now a fixed body moved each step.
- Dart plates fired from emitters that could not reach the thief; once moved, a plate fired eight darts (160 damage). Plates now fire one volley (a walker takes one or two darts).
- Turning around fast dropped whatever you held. Held objects now drop only after being snagged for a moment.
- A swimmer could not climb out of the flooded chamber's sheer-sided channel at all (a soft lock), and swimming kept the torch lit. Swimmers can now mantle out, and swimming drowns the torch.
- Gamepad look speed depended on the frame rate.
- Guardians could stand still for the rest of the night at a doorway. A path corner sometimes sat just past the edge of the doorway's navmesh rectangle, the straight step toward it left the mesh, and the guardian stopped; in one nightfall test the halls crawler waited 40 s at the inner-halls doorway while the door shut. Guardians now slide along the wall around such corners. The funnel pass that makes those corners is not fixed, only worked around.
- The audio test first measured the wind and river loops on the effects bus (they play on the ambience bus) and every effect on the shared bus, where the tail of the previous sound could pass for the next one. It now taps each sound's own output.
- Two play tests were flaky at 2 to 5 FPS: the sundial test waited on the wall clock instead of the game clock, and the Serpent Key test sometimes stopped just out of reach of the key. Both now wait on the game.
- The catacomb plank bridge described in DESIGN.md had never been built. It now crosses the flooded channel. Its first piers had block steps the character controller would not climb while wading; they are short stairs now.

## Known bugs and limitations

- **60 FPS is unverified** (no GPU here). The torch's cube shadows are the most expensive part; the Low preset drops shadow resolution and vegetation density, and quality steps down on its own when frames are slow.
- **Never played by a person.** All play tests inject input through a debug API. Pointer-lock mouse look has not been exercised, and the difficulty and pacing of a full 13-minute run have not been tuned by playing.
- **Audio never heard.** It produces signal on every bus, but the mix and the sound design are unverified.
- **Guardians are kinematic.** They follow the navmesh (they do not walk through walls) but they pass through loose props and are not pushed by them.
- **Guardians bunch up at shut gates at night.** With the serpent door never opened, the lair's guardians press against it and never leave the vault, and inner guardians gather by closed doors on their way to the great door. The lair's shadow sometimes stays in its lurk state far from you.
- **Lighting flips at the Zone C border.** The camera's scene decides whether the sun and sky exist, so looking up the seal stairs from the catacombs shows the sunlit sanctum as black, and crossing the threshold switches the lighting at once.
- **The cliff wind is harsh.** A gust can push a thief who stands still off a ledge; crouching braces you (wind push drops to 30%).
- **The halls blades cannot be ducked** (they swing at chest height, by design; only the vault blades are head-high). The controls text says so, but players may expect crouching to work everywhere.
- **The sunstone path is only open between roughly 11:00 and 4:00 before dark.** Early and late you need the blade ledge or the drawbridge. This is intended, but nothing in the game says when the tiles will light.
- **A falling ceiling section kills outright** if it lands on you. The section creaks, sheds dust and shows a warning for a second first.
- **The bundle is 5.4 MB** (Rapier's WebAssembly is inlined by the compat build), so the first load takes a few seconds.
- **Escape releases pointer lock** (browser behaviour) and pauses; click to resume.
- **Small windows crowd the HUD.**
- **The route bot can wedge on corners.** When the boulder had not yet cleared the upper aqueduct ramp, the escape path detoured through the dart corridor and the bot got stuck on a corner in the western catacombs; it steers straight at funnel corners where a person would round them. The test now sets the boulder off first, as the escape intends, and walks through cleanly. The detour corner itself was not reworked.
- **The push-block route over the flooded channel is untested.** The block fits the channel and its top sits at floor level, but nobody checked that the gap left beyond it can be jumped while wading. The plank bridge and swimming routes are tested.

## Test inventory

- Unit tests: `npm test` (109 tests, all pass).
- Play tests (`npm run dev`, then `node scripts/<name>.mjs`; all pass on the final build unless noted):
  - `check-dark.mjs`: Zone C pixel readback.
  - `progression.mjs`: sundial with the real sun, Sun-Disc, seal.
  - `door.mjs`: push block and plates raise the great door.
  - `heist.mjs`: stash, bank, leave, results, saved high score.
  - `darkness.mjs outside|hall|inside`: nightfall outside (escaped), just inside the door (caught) and down in the catacombs (caught or entombed).
  - `traps.mjs`: 17 trap checks.
  - `route.mjs both`: the way in and the way out on foot along navmesh paths.
  - `climb.mjs`: ledges, vines, throwing.
  - `bridge.mjs walk|flood`: both bridges.
  - `supplies.mjs`: the five hidden supply caches.
  - `hazards.mjs`: sunstones, noise collapse, the flooded chamber and the Serpent Key, torch blow-outs and relighting, wind, gamepad, ghost.
  - `audio.mjs`: signal on every bus, the listed effects, final-minute cues.
  - `menus.mjs`: menus, outfitter, settings, pause, results, high scores.
  - `tour.mjs`: performance at a stop in every scene.

## Final test run

All of these ran on the final code on 2026-11-12, between 02:20 and 02:45 UTC.

| Check | Result |
|---|---|
| `npm test` | 109 of 109 pass |
| `npm run typecheck`, `npm run build` | Clean; the bundle is 5.4 MB |
| `check-dark.mjs` | All 32 views with the torch out read back 0 lit pixels; with the torch lit, 111,388 |
| `progression.mjs` | Pass: the sundial is solved on the second turn, the Sun-Disc taken and the seal opened |
| `darkness.mjs hall`, `outside`, `inside` | Caught by a crawler; made it out; entombed (each the expected ending) |
| `heist.mjs` | Pass: $90 banked, the results screen shown and the save written |
| `traps.mjs` | 17 of 17 |
| `supplies.mjs` | 5 of 5 |
| `door.mjs` | Pass: the block is pushed onto a plate and the great door opens |
| `bridge.mjs walk` | Crossed, and all 22 planks fell |
| `bridge.mjs flood` | 3 of 3 |
| `menus.mjs` | All pass |
| `hazards.mjs` | 23 of 23 |
| `climb.mjs` | 7 of 7 |
| `route.mjs both` | No snags on the way in or the way out |
| `audio.mjs` | 12 of 12 |
| `tour.mjs medium` | See Performance |
