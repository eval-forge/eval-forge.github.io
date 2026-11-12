# Self review: The Lost Temple (Opus 5.5, high effort)

## Run facts

| | |
|---|---|
| Start (UTC) | 2026-11-11T21:27:02Z (session created 21:27:03Z) |
| Finish (UTC) | 2026-11-11T22:48:59Z (final commit) |
| Wall clock | 1 h 21 min 57 s |
| Model / effort | Opus 5.5, high |
| Token usage | 130 API responses: 250 uncached input, 646,574 cache-write input, 31,114,354 cache-read input, 369,648 output tokens |
| Cost estimate | About **$17 to $19** at Opus 5.5 API list prices ($4/M input, $20/M output, $0.20/M cache read, $5/M or $8/M cache write for 5 m or 1 h TTL). |

How usage was measured: the `/usage` command isn't available inside this cloud session, and the session API returns no token or cost fields. The numbers above are summed from the per-response `usage` blocks in this session's own transcript, de-duplicated by message ID. They cover this session only (no subagents were used). The dollar figure is an estimate at list price, not a bill. Subscription usage isn't billed per token.

## Verification actually done

- **Unit tests:** `npm test` passes 52/52 across 7 files (economy, traps, countdown, torch, unlocks with sundial, guardian FSMs, navmesh).
- **Build:** `npm run typecheck` and `npm run build` are clean.
- **`scripts/playtest.mjs`:** headless Chromium (SwiftShader) tour of all 7 scenes. It produced screenshots and stats, raised no console errors, and covered:
  - walking from camp into the river;
  - night in the vault: 3 guardians awake after 3 s, 5 after 33 s, and the run ends "caught".
- **`scripts/progression.mjs`:** 27/27 scripted checks pass. It drives real input through the simulation in this order:
  - **Approach:** rope bridge crossing, great door, walking through it into the halls.
  - **Sun-disc:** sundial solved, sun-disc taken.
  - **Into the temple:** block shoved onto the plate (sanctum gate held), sun-disc set into the seal, descending the stairs into the catacombs.
  - **Flooded chamber and vault:** wading drowns the torch, obsidian key, relight, vault door unlocked and entered.
  - **Shortcuts:** drawbridge lever and crossing, cracked wall kicked open from the west-wing side.
  - **Payoff:** map opened, unswapped crown pedestal fires darts, escape through the door banks the haul.
- **Menus by real DOM clicks:**
  - shop purchase (bank 5000 → 4300, satchel capacity 12 → 18 on the next run);
  - FOV setting applied;
  - pause with P, then abandon to the results screen;
  - scores screen.
- **Ad hoc checks:** the boulder plate launches the boulder (60 damage). Taking the idol starts the collapse, costs 63 s of daylight, and is survivable if you keep your health up.

### Bugs found by playtesting and fixed

- **Rope bridge:** the far end sat inside the cliff lip, so the player got stuck and the plank dropped them into the gorge.
- **Great door:** there was no floor under the threshold, so walking through the open door dropped you to y = −70.
- **Escape prompt:** "Leave the temple" was offered before the door was even open, which ended a run on its first E press.
- **Darts:** they flew in fixed lanes and could miss a player standing between them. They now lean toward the player within a cone, and there's a 0.35 s grace between small hits so a volley can't stack-kill.
- **Push-block puzzle:** rubble blocked the block's lane. The plate was also narrow enough that shoving the block to the wall pushed it off again.
- **Levers:** they were never registered as interactables, so the drawbridge and gate-jam levers did nothing.
- **Drawbridge:** the character controller stuck on the lowered (kinematic) drawbridge. It now becomes a fixed body once down.
- **Torch view model:** it was enormous and overexposed by its own light.

## Requirement scorecard

| Requirement | Status | Details |
|---|---|---|
| Three.js + real physics engine, no game engine | Done | Three 0.180 + Rapier 0.19 (compat). |
| `npm install && npm run dev`, README with controls | Done | |
| All assets procedural | Done | Canvas/noise textures, generated geometry and instancing, WebAudio synthesis. There are no asset files. |
| 60 FPS with shadows | **Unverified** | See the FPS section. No GPU is available here, so I can't claim it. |
| 7 scenes / 3 zones, seamless streaming | Done | Jungle, courtyard and cliffs (A); halls and sanctum (B); catacombs and vault (C). The current scene plus its graph neighbours are attached; others detach after 4 s. Statics are prebuilt once at boot (a single initial load), with no loading screens during play. |
| Puzzle/key unlocks, shortcuts that stay open, distinct escape route | Done | Sundial → sun-disc → seal; block on plate; obsidian key; drawbridge and cracked-wall shortcuts (one-way, persistent for the run). The escape route is vault → drawbridge → servants' passage → west wing → kicked wall → great door. |
| Jointed rope/plank bridges with cracking planks | Done | Planks hang on Rapier rope joints, crack after 0.45 s of load and drop at 0.9 s. |
| Crumbling floors, boulder, pressure plates, blades, darts, pushable blocks | Done | All present and exercised at least once headless. Blades were only visually checked. |
| Loot weight slows you and drains stamina | Done | Speed × (1 − 0.4·L^1.3), stamina drain × (1 + 1.6·L). |
| Real sun across a compressed 13-minute day, colour grading | Done | A directional sun moves on an arc with four graded palettes (dawn, noon, sunset, night) and a sky shader. Shadows snap to texels. |
| HUD sundial countdown, faster tick in the last 2 min | Done | |
| At 60 s: edge pulse, music shift, rumble | Done | |
| At 0: guardians wake, door closes | Done | Guardians wake deepest-first on a schedule. The door slides shut over 75 s; inside when it seals means "sealed". |
| Zone C has zero ambient light | **Done, verified** | In the catacombs and vault, hemisphere intensity is 0.000, sun intensity 0.000, the sky is hidden, fog is black, and nothing uses emissive materials. `playtest.mjs` asserts this and prints `ZONE C ZERO AMBIENT: true`. Exposure is pinned to 0 for any zone-C scene, not just faded. |
| Torch: shadowed point light, fuel, radius curve | Done | Full radius above 50% fuel, then down to 30% of the radius as fuel runs out. |
| Water, wind and falls put the torch out; relight animation; sconces and spares | Done | Relighting takes 2.5 s with a raise-and-strike animation and slows you while it plays. Spares can light sconces, which burn for 5 minutes and persist across streaming. |
| 15+ relic types, trapped pedestals with weight swap, only carried-out loot counts | Done | 17 relics plus 2 key items. Pedestals allow ±15% with a 0.6 s grace, and E while holding an object performs the swap. Banking only happens on "escaped". |
| 3 guardian types, navmesh pathfinding, deepest-first spawning, sweep toward the door | Done | Sentinel (sight, torch-sensitive), crawler (hearing), shade (avoids light; can't catch a lit player). Hand-authored convex navmesh with A* and a funnel. |
| Pointer lock, crouch, climb vines and ledges, stamina, grab/carry/drop/throw | Done | |
| Results, persistent high scores, shop, localStorage | Done | |
| Main, pause and settings menus (FOV, sensitivity, volumes, quality) | Done | Quality changes shadow resolution and render scale immediately. Texture resolution applies after a reload. |
| Debug overlay (FPS, physics bodies, scene) | Done | Toggle with F3 or `, or start with `?debug=1`. |
| Procedural audio | Done | Ambience layers, drone music that shifts at critical/night, about 35 synthesized one-shots, and positional panning. |
| DESIGN.md + ARCHITECTURE.md before code | Done | They were the first commit, together with the pure logic and tests. |
| Unit tests for economy, traps, countdown, torch, unlocks, guardian FSMs | Done | Plus navmesh. |
| Stretch: hand-drawn map | Done | Wobbly-ink sheets for the surface and the underground, revealed as you explore. |
| Stretch: idol collapse sequence | Done | Falling masonry for 22 s and −60 s of daylight. |
| Stretch: ghost replay | Partial | Records and saves the best escaped run and replays it as a translucent figure. It's hidden underground so it doesn't light the dark. Visual playback hasn't been eyeballed in a real run. |
| Stretch: gamepad | Partial | The standard mapping is implemented, but untested: there's no gamepad here. |

## FPS per zone

I can't give honest 60 FPS numbers. This container has no GPU, and headless Chromium renders with SwiftShader on the CPU. At 960×540 on low quality that's 2–12 FPS everywhere, which says nothing about a real GPU. What I can report is the render load per scene. These come from the in-game counters at 1280×720, medium quality, with shadows on:

| Scene | Zone | Draw calls | Triangles | Physics bodies |
|---|---|---|---|---|
| Jungle | A | 168 | 40k | 41 |
| Courtyard | A | 175 | 22k | 116 |
| Cliffs | A | 75 | 6k | 38 |
| Broken halls | B | 309 | 51k | 108 |
| Sanctum | B | 180 | 31k | 97 |
| Catacombs | C | 220 | 27k | 116 |
| Deep vault | C | 57 | 2k | 55 |

These budgets are modest for a desktop GPU: static geometry is merged per material per 24 m cell, and the light count is fixed so shaders never recompile. The expensive part is the torch's point-light cube shadow. Its update is skipped in daylight, and the sun's shadow update is skipped underground. Still, treat 60 FPS as *expected but unmeasured*. Run with `?debug=1` on real hardware to check.

## Known bugs and rough edges

- **Sun-disc plinth:** the plinth has no collider, so the sun-disc drops from the plinth to the floor. It's still easy to pick up.
- **Start-of-run hitch:** starting a run detaches and re-attaches scenes synchronously. On a real GPU it should be brief.
- **Paths never played by hand:** headless tests teleport between checkpoints. Nobody has played the full route by hand with mouse and keyboard. The jumps on the cliff ledges and the climb out of the gorge are the least exercised.
- **Guardian line of sight in detached scenes:** guardians walking through detached scenes do line-of-sight checks without those scenes' colliders, so they can "see" through walls there. It only matters far from the player.
- **Sundial:** it can solve itself if the sun happens to line up with the current ring step. That's rare, and harmless.
- **Asset handling:** texture quality is fixed at load. The JS bundle is about 2.9 MB (1 MB gzipped), mostly Rapier's WASM inlined by the compat build.
- **Gamepad:** look sensitivity is untuned, because there was no hardware to test with.
