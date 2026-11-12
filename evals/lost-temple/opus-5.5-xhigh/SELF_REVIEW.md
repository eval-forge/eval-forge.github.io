# Self-review

An honest account of what was built, what was checked and how, and what is weak or
untested. "Done" below means implemented **and** exercised by an automated check or a
screenshot I looked at, unless the evidence column says otherwise.

## How it was verified

| Check | What it does | Result |
| ----- | ------------ | ------ |
| `npm test` | 82 vitest unit tests over `src/logic/`: loot economy, trap triggers, countdown thresholds, torch fuel and radius curve, scene unlocks, guardian state machines, navmesh | 82 / 82 pass |
| `npm run typecheck` | `tsc --noEmit`, strict | clean |
| `npm run playtest` | Builds nothing, serves `dist/`, drives the real game in headless Chromium (SwiftShader WebGL): bridge crossing, block push, loot stash, every scene with screenshots and perf samples, Zone C pixel check, last-minute effects, guardian waves, the door sealing, a guardian hunt | all checks pass, 0 console errors (only SwiftShader's "GPU stall due to ReadPixels" driver warning, caused by the pixel check itself) |
| `npm run mechanics` | Plays the progression chain, traps, climbing and ghost replay through the real input and interaction-ray path: the player is placed next to each thing, turned to look at it, and E / F / W / crouch are pressed through the input system. Nothing sets a game flag directly. | 22 / 22 steps pass, 0 console errors |
| `npm install && npm run dev` | Dev server starts and serves the game | checked |

What the automation **cannot** check: real GPU frame rates, pointer lock (needs a user
gesture), whether the audio sounds right (the code paths run without errors, but I
have not listened to it), gamepad input (no pad in a container), and whether it is
*fun*, which needs a human.

## Requirements

### Constraints

| Requirement | Status | Evidence / notes |
| --- | --- | --- |
| TypeScript, Three.js, a real physics engine, no game engine | Done | three 0.187, `@dimforge/rapier3d-compat` 0.21, Vite. No engine. |
| Runs with `npm install && npm run dev`; README with run steps and controls | Done | Checked the dev server serves the game. README has steps, scripts and the full control table. |
| Every asset generated in code | Done | Canvas textures, procedural meshes, WebAudio synthesis. `grep` finds no image, audio, model or font files or URLs (the favicon is an inline SVG data URI; fonts are system serif). |
| 60 FPS on a mid-range laptop with shadows | **Partial (unverified)** | I have no GPU here. Headless SwiftShader renders on the CPU at about 10 FPS in every scene, which says nothing about a GPU. What does carry over: the game's own logic (simulation, physics, streaming, AI, audio, HUD) costs under 1.5 ms per frame in every scene, so the frame budget goes to rendering. Draw calls reach about 930 in the halls with the torch lit (its cube shadow re-renders nearby geometry). I'd expect a mid-range discrete GPU to hold 60 on High and integrated graphics to need Medium or Low, but that is a guess, not a measurement. |

### 1. Scene progression

| Requirement | Status | Evidence / notes |
| --- | --- | --- |
| At least 7 scenes in 3 zones, streamed with no loading screen mid-run | Done | Jungle, courtyard, cliffs (A); halls, sanctum (B); catacombs, vault (C). The current scene and its graph neighbours stay loaded; builders are generators run under a per-frame time budget. The only loading screen is before a run. |
| Jungle: dense vegetation, river crossing, collapsing rope bridge | Done | Instanced trees, palms, ferns, grass; a swimmable river (it puts the torch out); the bridge is verified crossing in the playtest and collapses behind you. |
| Courtyard: plazas, toppled pillars, sundial puzzle on the real sun, the great door as the only way in and out | Done | Mechanics check reads the live sun direction, picks the rim stone the shadow points at, presses it: puzzle solves and the Sun Disc rises. The door opens by pushing a stone block onto its plate (pushed 4.5–7.2 m in checks). |
| Cliffs: optional, ledges, vine climbing, wind, high-value relics in the open | Done | Ledge chain down the cliff face, two vine walls, gusts that push you and can blow the torch out (crouch to brace). Vine climb from the lowest ledge back to the courtyard verified. |
| Halls: caved-in roof, moving sun shafts, paths safe only while sunlit | Done | The sun-stones over the pit are solid only while a real raycast toward the sun is clear. Sampled over a day: 0/5 solid at dawn, 4/5 from about 8:00 left, 5/5 around 4:00, 0/5 again by 2:00 and at night. |
| Sanctum: half roof gone, unstable rest, noise brings debris; idol under a beam | Done | Instability meter fed by noise; 12 loud noises dropped 29 debris bodies in the check. The idol sits under a visible light shaft. |
| Catacombs: crumbling floors, dart corridors, flooded chamber | Done | Crumbling tiles dropped the player into the bone pit (52 hp left after the fall). Dart plate: standing took 14 damage, crouching took 0. Water puts the torch out; the Bone Key is taken from the flooded chamber. |
| Vault: richest, heaviest loot, longest way out, the lair next door | Done | Zone C value multiplier; the heaviest relics (chest of gems 14 kg, ancestor statue 18 kg) only spawn in Zone C, and the vault holds most of them. The lair is where the first wave wakes. |
| Each zone more dangerous and more valuable | Done | Unit-tested zone multipliers; more and deadlier traps deeper down; guardians start deepest. |
| Deeper scenes unlock through puzzles, keys, relics | Done | Sundial → Sun Disc → Sun Seal (halls → catacombs); Bone Key → vault door. All verified through the real interaction path. |
| Shortcuts that open once used (kicked wall, drawbridge); a distinct escape route | Done | Vault lever lowers the drawbridge to the sanctum; the cracked wall can only be kicked from the sanctum side (3 kicks) into the halls. Escape: vault → drawbridge → sanctum → kicked wall → halls → great door. The rope bridge is one-way, so the way out is never the way in reversed. |

### 2. Physics

| Requirement | Status | Evidence / notes |
| --- | --- | --- |
| Rope and plank bridge from jointed rigid bodies; planks crack and drop after a delay | Done | Dynamic plank bodies on spherical joints at both rope lines. Playtest: walked across, 26 planks broke behind the player, the bridge collapsed once they were off it, health 100. Took real tuning: the character controller's own impulses made the chain oscillate and throw the player, so the controller no longer pushes bodies and the plank under you gets your weight applied explicitly. |
| Crumbling floors, rolling boulder, pressure plates, swinging blades, dart traps, pushable blocks | Done | All six verified in the mechanics run: tiles fall, the boulder rolled 13 m after its plate, blades took 68 hp, darts as above, the block pushes onto the door plate. |
| Loot has real weight; carrying more slows you and drains stamina faster | Done | Satchel weight scales speed and stamina drain (unit-tested curve); anything over 2 kg in your hands stops sprinting. Relics are rigid bodies with their real mass. |

### 3. Sun, time and lighting

| Requirement | Status | Evidence / notes |
| --- | --- | --- |
| Real sun across a 12–15 min day with shadows | Done | 13-minute day. Directional light with a player-following shadow camera, driven by the clock. |
| Sunlight only reaches A and B, through openings | Done | Per-material sky mask: Zone C materials take no sun, sky or hemisphere light. Halls light comes through real roof holes (shadow-mapped), visible as moving shafts. |
| Grading: dawn → noon → red-orange sunset → night | Done | Keyframed grade pass (exposure, white balance, saturation, contrast, vignette). Unit-tested keyframes; seen in screenshots. |

### 4. Ticking clock

| Requirement | Status | Evidence / notes |
| --- | --- | --- |
| Always-visible stone sundial on the HUD; audible ticks that speed up and get louder in the last 2 min | Done | Canvas sundial with a gnomon shadow, late (ochre) and critical (red) arcs. Tick interval and gain from `logic/clock.ts` (unit-tested thresholds). |
| At 60 s: edge pulse, music shift, rumble | Done | Screenshot `30-halls-last-minute.png` shows the red edge pulse and the "temple trembles" toast; music mood switches to the critical layer; camera shake + rumble. |
| At 0: darkness, guardians wake, the door starts closing with a short final window | Done | Playtest: waves wake 3 / 5 / 6 / 7 guardians at 0 / 15 / 30 / 45 s after dark; the door seals 75 s after dark (inside = "Sealed inside", haul = only what was stashed). |
| In Zone C only the HUD and sound tell the time | Done | No sky in Zone C by construction (ceilings everywhere, zero sky mask). |

### 5. Torch

| Requirement | Status | Evidence / notes |
| --- | --- | --- |
| Zone C has zero ambient light; true black outside the torch | Done | See "Zone C ambient light" below. |
| Dynamic point light with flicker and real shadows | Done | One shadow-casting point light (cube shadow) with flicker. Its shadow map refreshes every other frame (~30 Hz) to halve the cost. |
| Fuel; radius shrinks as fuel runs low | Done | Unit-tested burn and radius curve; HUD shows seconds and metres. |
| Water, wind gusts or a fall blow it out; relighting is a short vulnerable animation | Done | Water: verified. Wind and falls: chance-based by gust strength and impact speed (unit-tested functions). Relight: verified refused while wet, then a 2.2 s animation at 40% move speed, no sprint, no light. |
| Spare fuel and torches; mount torches in wall sconces | Done | Oil flasks and spare torches in the world and the shop. Mounting a spare in a sconce verified (burns 10 min, lights the way back, and you can relight from it). |
| Guardians drawn to torchlight | Done | Sentinels see a lit torch at 40 m; shades stalk the edge of your light and lunge when it fails (unit-tested state machines). |

### 6. Relics and economy

| Requirement | Status | Evidence / notes |
| --- | --- | --- |
| At least 15 relic types with values, weights, rarities; worth more deeper | Done | 20 types (`logic/economy.ts`), from a 0.3 kg bone flute to an 18 kg gold statue, five rarities, zone multipliers. Unit-tested. |
| Trapped relics; swap in an equal weight or the trap fires | Done | Verified in-game: holding a sandbag of the relic's weight and pressing E swaps it with no darts; grabbing the next trapped relic without a swap fired the darts. Taking the idol without a swap fires its trap (collapse + a 90 s clock jump). |
| Running loot value on the HUD; only loot carried out counts | Done | HUD shows carried, secured and satchel weight. Loot is stashed outside the great door or at camp; dying, being caught or being sealed in loses what you carry (verified for caught and sealed). |

### 7. Guardians

| Requirement | Status | Evidence / notes |
| --- | --- | --- |
| At least 3 types with different movement and senses | Done | Sentinel (slow, sight, drawn to torchlight), crawler (fast, hunts by sound), shade (avoids light, stalks the dark). |
| Spawn deepest first, sweep toward the door | Done | Waves: vault, then catacombs, sanctum, halls (verified order and timing). |
| Real navmesh pathfinding | Done | Convex-polygon navmesh from the level layout, A* plus funnel smoothing, gates that block while closed. Unit-tested; in the playtest hunt a sentinel closed from 29 m to a catch along the navmesh. |
| Caught means you lose the run and what you carry | Done | Verified outcome "Caught"; carried loot is lost, the stash is kept. |

### 8. Player

| Requirement | Status | Evidence / notes |
| --- | --- | --- |
| Pointer-lock first-person controls | Done (not testable headless) | `requestPointerLock` on click; Esc releases and pauses. Automation drives the camera directly. |
| Run, jump, crouch, climb vines and ledges, stamina | Done | Vine climbs verified in the halls pit (8 m, then a mantle over the lip) and on the cliffs. Mantling onto ledges up to 2.2 m uses the same code. Stamina drains when sprinting, climbing (unless you bought rope) and mantling, and faster the more you carry. |
| Grab, carry, drop, throw | Done | F grab/release, LMB throw, Q drop. Held objects are physical bodies on a spring, so they collide. The swap check uses grab-and-carry. |

### 9. Meta progression and UI

| Requirement | Status | Evidence / notes |
| --- | --- | --- |
| Results screen: haul value, time, relics found | Done | Screenshot `32-results.png`: secured, lost, haul, relics carried out, relics found, time, deepest scene, bank, high-score rank. |
| Persistent high scores; shop (better torch, more fuel, rope, bigger satchel); localStorage | Done | `lost-temple-save-v1`, validated on load (a corrupt save resets instead of crashing; unit-tested). |
| Main menu, pause, settings (FOV, sensitivity, volume, graphics quality), HUD, debug overlay (FPS, physics bodies, scene) | Done | Settings also has invert-Y, separate music/SFX volumes and a "show FPS" toggle. F3 debug overlay: FPS, frame ms, bodies, colliders, scene, loaded scenes, draw calls, triangles, guardian states. F4: warp and time-skip panel. |

### 10. Audio

| Requirement | Status | Evidence / notes |
| --- | --- | --- |
| All procedural: jungle ambience, dusk rumbles, ticks, creaking and snapping wood, stone grinding, torch crackle, guardian calls, heartbeat near guardians | Done (not listened to) | All synthesized in `engine/audio.ts` with 3D panners. Every one of these has a code path that runs in the playtests without errors, but a headless browser has no speakers, so I have not heard the mix. |

### Stretch goals

| Goal | Status | Evidence / notes |
| --- | --- | --- |
| Hand-drawn map that fills in as you explore | Done | M opens a parchment map; ground is revealed around where you've been, rooms once you've been near them, landmarks once seen. Screenshot `15-map.png`. |
| Collapse sequence when taking the main idol | Done | Verified: the archway to the halls is blocked by rubble (you must find the other way out), debris falls, the clock jumps 45 s (90 s if you didn't swap). |
| Ghost replay of your best run | Done | Verified: an escaped run's path is saved and a translucent ghost walks it on the next run (moved 12.9 m in 3 s in the check). |
| Gamepad | **Partial** | Standard-mapping gamepad support is implemented (both sticks, every action except refuelling), but I had no pad to test it with. |

### Process

| Requirement | Status | Evidence / notes |
| --- | --- | --- |
| DESIGN.md and ARCHITECTURE.md before code | Done | They are the first commit on the branch, before any code. ARCHITECTURE.md now ends with a section on where the code ended up differing from the plan. |
| Unit tests for economy, traps, countdown, torch curve, unlocks, guardian state machines | Done | One test file each, plus the navmesh. 82 tests. |
| Honest SELF_REVIEW.md | This file | |

## Zone C ambient light

Confirmed zero. Every material gets a per-material sky mask; Zone C materials multiply
sun, sky and hemisphere light by 0, there are no emissive decorations, the fog colour
underground is black, and the colour grade is purely multiplicative, so black stays
black. The only light sources down there are flames (your torch, sconces you light).

Measured, not just argued: the playtest renders a frame in the catacombs and in the vault
with the torch out and reads every pixel back with `gl.readPixels` right after rendering.

| Frame | Non-black pixels | Max channel value |
| --- | --- | --- |
| Catacombs, torch out | 0 of 518,400 | 0 |
| Vault, torch out | 0 of 518,400 | 0 |
| Catacombs, torch lit | ~70% | (lit as expected) |

The HUD is HTML on top of the canvas, so it is not part of the WebGL frame being measured.

## Performance

Measured in headless Chromium with SwiftShader (software WebGL on the CPU), 960×540,
High preset with shadows. **These are not GPU numbers.** FPS here is capped by CPU
rasterization and is about the same everywhere.

* **Whole frame** is the main thread's time per frame including handing WebGL commands to
  the browser. Under SwiftShader that partly blocks on the software rasterizer, so it is
  noisy and pessimistic; two runs are shown.
* **Game logic** is the same frame with rendering skipped: simulation, physics, streaming,
  guardian AI, audio and HUD. This is the part that carries over to a real machine.

| Zone | Scene | FPS (SwiftShader) | Whole frame, ms (run 1 / run 2) | Game logic, ms | Draw calls | Triangles | Bodies / colliders |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | Jungle | 10.0 | 10.4 / 10.1 | 0.86 | 453 | 213k | 50 / 192 |
| A | Courtyard | 11.7 | 9.1 / 9.5 | 1.37 | 594 | 253k | 95 / 385 |
| A | Cliffs | 10.0 | 15.6 / 20.0 | 0.39 | 591 | 240k | 94 / 384 |
| B | Halls | 10.8 | 9.0 / 9.7 | 0.09 | 928 | 94k | 59 / 656 |
| B | Sanctum | 10.8 | 9.0 / 10.5 | 0.04 | 641 | 43k | 54 / 410 |
| C | Catacombs (torch lit) | 11.0 | 4.5 / 6.3 | 0.04 | 47 | 10k | 59 / 522 |
| C | Vault (torch lit) | 11.0 | 5.2 / 3.6 | 0.05 | 91 | 13k | 55 / 512 |

Game logic is measured with no guardians awake; after dark the guardians add navmesh
queries and line-of-sight rays, which I did not time separately. The cliffs' whole-frame
number is the outlier even though its logic is cheap; it renders the cliff, the courtyard
next door and a large distant valley, and it is the scene I'd watch first on a real GPU.

Draw calls include the shadow passes (the sun's shadow map and the torch's six-face
cube map). Zone A is triangle-heavy (instanced vegetation); the halls are the
most draw-call-heavy because the torch is lit indoors among many separate props. Zone C
is cheap because there's no sun shadow pass and almost nothing outside the torch radius.

What I did for frame rate: vegetation is instanced and excluded from the torch's shadow
camera; level geometry is merged into spatial chunks; the light count is fixed (one
shadowed torch light plus a pool of six unshadowed sconce lights), so no shader
recompiles; the torch shadow updates at 30 Hz; physics runs at a fixed 60 Hz with at most
four catch-up steps. A Low preset drops resolution, shadow map sizes, MSAA and
vegetation density.

## Known bugs and limitations

1. **60 FPS is unverified.** See above. The halls with a lit torch (most draw calls) and
   the cliffs (slowest whole frame under SwiftShader) are the most likely places to drop
   frames on integrated graphics.
2. **The full sun-stone path only exists in the afternoon.** All five stones are solid
   only around 4:00 before dark (four of five from about 8:00 to 6:00). That is the
   point of the puzzle, but a player who arrives early has to wait or take the blade
   gallery, and the game only hints at this through the sign by the pit.
3. **Dart corridor plates detect the player by position, not by weight.** A thrown
   object won't set them off, unlike the door plate and the relic pedestals, which do
   sum the real mass on them.
4. **Falling debris is random.** In the idol collapse check the player standing next to
   the pedestal took no damage; on other runs debris does hit. It is dramatic but
   not reliably dangerous.
5. **Bundle size.** The production bundle is about 5.2 MB (1.9 MB gzipped), mostly
   Rapier's inlined WASM, so the first load takes a moment on a slow connection.
6. **Gamepad, pointer lock and audio have not been tried by a human.** The code paths
   run, but nobody has played this with a real mouse, pad or speakers yet.
7. **Bug found and fixed late:** dart volleys were scheduled with wall-clock
   `setTimeout`, so pausing right after tripping a plate cancelled the darts. They now
   run on the simulation clock (the mechanics check caught this).

## Build time and usage

Measured, not estimated, except where it says so.

| | |
| --- | --- |
| Thread started | 2026-11-11 21:27:05 UTC |
| This review written / last code commit | 2026-11-11 23:32 UTC |
| Wall-clock time | about 2 h 05 min (opening the pull request adds a few minutes) |
| Model responses | 298 |
| Output tokens | 622,579 |
| Input tokens (uncached) | 565 |
| Cache reads | 70,732,065 |
| Cache writes (1-hour) | 1,235,348 |
| **Estimated cost at API list prices** | **about $36.50** |

How the cost was worked out: token counts are summed from the `usage` block of every
model response in this session's transcript (deduplicated by response id), priced at the
published Claude Opus 5.5 rates: $4 / M input, $20 / M output, $0.20 / M cache reads,
$8 / M one-hour cache writes. That breaks down as $12.45 output + $14.15 cache reads +
$9.88 cache writes. Caveats: this is an API-price equivalent, not what a subscription is
billed; the `/usage` command's plan-limit percentages are not visible from inside the
session; and the one context-compaction summary in the middle of the session may not be
in the transcript's usage records, so treat the figure as a slight undercount.
