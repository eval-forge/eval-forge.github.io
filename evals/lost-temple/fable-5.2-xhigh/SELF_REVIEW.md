# Self review

The short version: the whole game is here and a bot can play a full heist from
the jungle camp to the vault and back out through the great door. Every
numbered requirement has working code behind it. What I cannot give you is the
one number the brief asks for by name, the frame rate on a mid-range laptop,
because this was built on a machine with no GPU and no human ever touched the
controls. That gap, and everything else I know to be weak, is spelled out
below.

## What "checked" means in this document

Everything was built and tested inside a cloud container: 4 virtual CPUs, no
GPU, headless Chromium drawing through SwiftShader (a software renderer).

Checked by machine, against the production build:

- `npm run typecheck` (strict), `npm test` (226 unit tests), `npm run build`.
- `playtest/playthrough.cjs`: a bot plays a legitimate heist with ordinary
  inputs (walk, look, jump, crouch, interact) from camp to vault and out.
- `playtest/scenarios.cjs`: 26 single-system checks (listed at the end).
- `playtest/tour.cjs`: 34 screenshots across all seven scenes and four times
  of day, which I looked at.
- `playtest/perf.cjs`: draw calls, triangles, body counts, CPU cost per step.

Not checked, by anyone:

- **No human has played this.** Feel, difficulty, pacing and readability of the
  puzzles are my best guess, tuned through a bot.
- **Nobody has heard it.** The audio is verified to start, to run every layer
  without errors and to stay within its voice budget. The mix has never
  reached an ear.
- **No real GPU frame rate.** See Performance.
- **No real gamepad.** The gamepad path was driven through a faked
  `navigator.getGamepads`.
- **No browser other than headless Chromium.** Firefox and Safari are untested.

## Requirement by requirement

Status is one of **Done**, **Partial**, **Missing**. "Done" means the code
exists and a script exercised it; the caveats column is where it falls short of
what you probably pictured.

### Stack and delivery

| Requirement | Status | Evidence and caveats |
|---|---|---|
| TypeScript web app, Three.js, a real physics engine, no game engine | Done | Three.js 0.180, Rapier 0.19 (WASM), Vite, strict TypeScript. |
| `npm install` then `npm run dev` | Done | Also `npm test`, `npm run typecheck`, `npm run build`, `npm run preview`. |
| README with run steps and controls | Done | `README.md`. |
| Every asset generated in code | Done | The repository holds no image, model, font or sound file. Textures are drawn on canvases, meshes are built from primitives, sound is Web Audio synthesis. |
| 60 FPS on a mid-range laptop with shadows on | **Unverified** | No GPU was available. Draw calls and triangle counts are higher than my own design budget in several views. See Performance. Treat this as not demonstrated. |

### 1. World

| Requirement | Status | Evidence and caveats |
|---|---|---|
| At least 7 streamed scenes in 3 zones | Done | Seven: jungle, courtyard, cliffs (A); broken halls, sanctum (B); catacombs, vault (C). Scenes build in 5 ms slices per frame and unload behind you; relics taken, blocks pushed and floors crumbled survive an unload (scenario `memory`). |
| Zone A: jungle approach, courtyard with sundial puzzle, great door as entrance and only exit, optional cliffs | Done | The sundial puzzle reads the real sun: the ring must be turned to the gnomon's actual shadow. The cliffs are optional and windy. |
| Zone B: roofless halls with moving sun shafts and sun-safe paths; sanctum with noise-triggered debris and the main idol under a beam | Done | The nave floor is deadly in shade (scarabs) and safe in sun; the test is a ray from the player to the real sun against the real beams. Measured: 3 s standing in a sun patch costs nothing, 3 s in shade costs 32 health, and early in the morning there is no sun patch in the nave at all. Sanctum: creeping keeps the strain at 0, sprinting and jumping drops chunks. |
| Zone C: catacombs with crumbling floor, dart corridors, flooded chamber; vault with the richest loot and the lair | Done | |
| Areas unlock through puzzles, keys and relics | Done | Sundial gives the Sun Disc, the Sun Disc breaks the catacomb seal, two pushed blocks on two plates open the sanctum, the Serpent Key opens the vault gate, a lever opens the escape stair. |
| Shortcuts | Done | Blade corridor past the nave, a kick-down wall, a terrace and a drawbridge into the courtyard. |
| The level has its own escape route | Done | Vault lever, stair up to the sanctum, cracked wall, terrace, drawbridge, courtyard, door. The bot uses it. Until the last hour of the build the drawbridge could pin you to its deck; see "Bugs the bots found". |

### 2. Physics

| Requirement | Status | Evidence and caveats |
|---|---|---|
| Jointed rope and plank bridges that crack and drop | Done | The jungle bridge is 12 plank bodies on 13 revolute joints. It sags under the player, planks crack then break away as free bodies, and the near anchor lets go after a full crossing (scenario `bridge`). Caveat: each segment is one rigid body (plank and its rail posts together), and the hand ropes are drawn, not simulated. |
| Crumbling floors | Done | Tiles crack on load and fall as dynamic bodies; the hole stays (scenarios `crumble`, `memory`). |
| Rolling boulders | Partial | There is exactly **one** boulder trap (the halls' east gallery). It is a real dynamic body that rolls 36 m down a ramp at up to 9.6 m/s and kills what it meets. The brief says "boulders". Damage is applied by distance and speed, not by contact impulse. |
| Pressure plates | Done | Weight-threshold plates: light ones arm the dart corridor, heavy ones (only a pushed block will do) open the sanctum. Trapped pedestals weigh what sits on them. |
| Swinging blades | Done | Kinematic pendulums with a hit test; two in the blade corridor. |
| Dart traps | Partial | They fire, travel, hit walls and hurt. The darts are swept ray-marched projectiles, **not rigid bodies**. |
| Pushable blocks | Done | Dynamic bodies moved by setting their velocity while you lean on them, not by raw contact forces. That choice was for controllability; it reads as pushing. |
| Loot weight slows you and drains stamina | Done | 12 kg carried: 15.7 m against 19.8 m in a 3 s sprint, and stamina drains about 1.7 times faster (scenario `weight`). |

### 3. Sun and time of day

| Requirement | Status | Evidence and caveats |
|---|---|---|
| A real sun that moves, 12 to 15 minute day | Done | 13 minutes (780 s). One directional light follows an arc tilted 28 degrees south. |
| Shadows | Done | Sun shadow map 2048 (1024 on low) over a 92 m box that follows the player, so shadows beyond about 46 m are absent. The moon casts them at night, except where the torch is already doing so. |
| Sunlight only in Zones A and B | Done | Zone C materials are compiled without directional or hemisphere light at all. See Zone C darkness for the one visible caveat. |
| Colour grading from dawn to noon to sunset to night | Done | A keyed colour script drives sun, sky, fog and a full-screen grade pass. |

### 4. The countdown

| Requirement | Status | Evidence and caveats |
|---|---|---|
| Always-visible stone sundial HUD | Done | Top centre, in every zone. |
| Ticking speeds up in the last 2 minutes | Done | |
| At 60 s: edges pulse, music shifts, rumble | Done | Pulse on from 57 s (scenario `night`); the score crossfades to a driving layer; low audio rumble plus camera shake. There is no gamepad vibration. |
| At zero: darkness, guardians wake, door closes with a short final window | Done | Guardians wake deepest first over 46 s; the door closes over 60 s; you can still slide under it crouched until the gap is too small (scenario `door`). |
| In Zone C only the HUD and sound tell the time | Done | No sky, no sun-driven light, no grading cue below ground. |

### 5. Torch

| Requirement | Status | Evidence and caveats |
|---|---|---|
| Zone C has zero ambient: true black without the torch | Done | Measured, see below. |
| Dynamic point light with flicker and real shadows | Done | One shadow-casting point light (cube shadow map 512, 256 on low). The flame casts shadows in Zone C, on the stairs down to it, and in Zone B after dark. Under open sky (Zone A always, Zone B by day) it lights but does not cast: the sun or the moon casts the shadows there. That was a deliberate cut made at the end to halve the heaviest frame. |
| Fuel and shrinking radius | Done | 210 s of fuel; radius 13 m until 35 % fuel, then shrinking to 3.7 m at 3 %. |
| Water, wind and falls douse it | Done | Flooded chamber, cliff gusts (2.4 to 4.1 s of exposure, depending on the run), a 6.5 m fall (scenarios `torch`, `wind`, `fall`). |
| Relighting leaves you vulnerable | Done | 1.6 s in the dark with hands busy. A known rough edge: jump is ignored during the strike. |
| Limited fuel and spares | Done | Oil flasks and spare torches, both buyable. |
| Sconces | Done | A spare torch can be mounted to light a room for good. Caveat: sconce lights cast **no shadows**, so their light can bleed through thin walls. |
| Guardians are drawn to light | Done | In the guardian rules (unit-tested) and visible in the sweep. |

### 6. Relics

| Requirement | Status | Evidence and caveats |
|---|---|---|
| At least 15 relic types | Done | 18, plus two key items. |
| Deeper means more valuable | Done | Three tiers by zone, with a depth multiplier. |
| Trapped pedestals, equal-weight swap | Done | Taking a relic bare fires the trap; a rock within tolerance of the relic's weight keeps it asleep (scenario `pedestal`). |
| Loot HUD | Done | Value, weight, slots, key items. |
| Only loot carried out counts | Done | Caught or entombed: the haul is lost (scenarios `caught`, `night`). |

### 7. Guardians

| Requirement | Status | Evidence and caveats |
|---|---|---|
| At least 3 types | Done | Stone Sentinel (slow, sees a lit torch from far off), Crawler (blind, fast, hunts by sound), Shade (afraid of your light, waits at its edge for it to fail). |
| Sweep from the deepest room to the door | Done | 11 guardians wake in five waves, vault first (scenario `sweep`). |
| Real navmesh pathfinding | Done | A polygon navmesh generated from the layout, A* and funnel smoothing, unit-tested. Caveat: the mesh is **static**. A resting boulder, pushed blocks and fallen debris are not carved out of it, so a guardian can try to walk through one and will slide around it on steering alone. |
| Caught means the run and the loot are lost | Done | |
| | | Only sentinels have physics colliders. Crawlers and shades are moved along the navmesh and cannot be blocked by a thrown prop. |

### 8. Player

| Requirement | Status | Evidence and caveats |
|---|---|---|
| Pointer-lock first person: run, jump, crouch, stamina | Done | Rapier kinematic character controller. |
| Climb vines and ledges | Done | Vines from y -2.6 to 0; mantle onto a 1.6 m block (scenario `climb`). |
| Grab, carry, drop, throw | Done | Scenario `carry`: carried 6 m, thrown at 11.7 m/s, impact makes noise guardians hear. |

### 9. Game shell

| Requirement | Status | Evidence and caveats |
|---|---|---|
| Results screen, persistent high scores | Done | |
| Shop: better torch, more fuel, rope, bigger satchel | Done | Plus spare torches and soft soles. |
| localStorage persistence | Done | Survives a reload (scenario `menus`). |
| Main menu, pause, settings (FOV, sensitivity, volume, graphics quality) | Done | Losing pointer lock pauses. Also music volume and invert Y. |
| HUD | Done | |
| Debug overlay: FPS, physics body count, current scene | Done | F3. Also frame time, worst frame, colliders, joints, physics step time, loaded scenes, draw calls, triangles and the quality preset. |

### 10. Audio

| Requirement | Status | Evidence and caveats |
|---|---|---|
| All procedural | Done | Web Audio oscillators and filtered noise only. |
| Jungle ambience, dusk rumbles, ticking, creaking and snapping wood, stone grinding, torch crackle, guardian calls, heartbeat near guardians | Done, **unheard** | Every one of these exists and plays without errors through a simulated dusk, nightfall and dungeon run (peak 23 or 24 voices). Whether it sounds good, or even balanced, is unknown. |

### Stretch goals

| Goal | Status | Evidence and caveats |
|---|---|---|
| Map that fills in | Done | M or Tab. |
| Collapse sequence on the main idol | Done | Lifting the Dawn Idol buries the door you came through within 6 s (scenario `collapse`). |
| Ghost replay of your best run | Done | Scenario `ghost`. |
| Gamepad | Done, on a fake pad | Scenario `gamepad`. |

### Process

| Requirement | Status | Evidence and caveats |
|---|---|---|
| DESIGN.md and ARCHITECTURE.md before code | Done | They are the first commit on the branch, 24 minutes before any code. ARCHITECTURE.md now ends with an "as built" section listing where the code left the plan. |
| Unit tests | Done | 226, over the pure rules in `src/core` and the level layout data. Nothing in `src/engine`, `src/world/entities` or `src/game` has unit tests; those are covered only by the browser scripts. |
| This file | Done | |

## Known bugs and rough edges

Things I know are wrong or weak, most serious first.

1. **Frame rate is unproven**, and the frames are not light: roughly 200 to
   700 draw calls by day and underground once the shadow passes are counted,
   against the 250 my own architecture document budgeted, and about 1,000 in
   the worst view I found (the courtyard at night with all eleven guardians
   out and the torch lit). That view used to cost 1,220; limiting which light
   casts shadows where took the two extra shadow passes out, and the rest is
   guardians: each one is 17 to 20 separate meshes, drawn once in the main
   pass and once in the moon's shadow pass. I did not merge them.
2. **Possible memory growth while the pointer is locked.** In headless
   Chromium the renderer process grew from about 200 MB to over 1 GB during a
   long pointer-locked session, while the JavaScript heap, the Three.js
   resource counts and the DOM stayed flat, and a blank page with pointer lock
   and a synthetic mouse move per frame also grew. I believe it is an artefact
   of the headless harness, but I could not prove that without a real browser.
   If the tab's memory climbs during normal play, this is the first suspect.
3. **Streaming hitch.** The frame in which a scene finishes building and its
   buffers upload cost up to 19 ms of scene-manager time on this CPU (26 ms in
   an earlier run). On a slower laptop that is a visible stutter at zone
   doorways.
4. **The character controller cannot be trusted on kinematic bodies.** Rapier's
   controller takes a separate "riding a moving platform" path when the floor
   is kinematic, and on the drawbridge deck that path threw away a third to a
   half of all moves I probed, which is how the bot got rooted mid-bridge (see
   "Bugs the bots found"). The deck is now static once it is down, and that
   was the only kinematic body you walk on. What is left: the deck is still
   kinematic for the 3.3 s it takes to swing down, so stepping onto it early
   may stick until it lands, and the great door slab and the sliding doors
   are kinematic bodies you can press against. The `door` scenario passes and
   I saw no stall there, but I did not probe them the way I probed the deck.
5. **Light bleeds through walls in two cases.** Sconces have no shadow maps at
   all. The hand torch has none under open sky (Zone A, and Zone B by day), so
   there its glow passes through a thin wall or a pillar. By day the sun
   drowns it; in the courtyard at night it is visible if you look for it.
6. **Daylight is visible through the doorways between Zone B and Zone C.**
   Standing at the top of the catacomb stair you can see the lit hall above.
   Zone C surfaces are still never lit by it, but it is not the hard cut to
   black a purist would want.
7. **Guardians ignore moved obstacles in their pathing** (static navmesh).
8. **Jump is ignored while striking the torch.**
9. **Early-morning nave.** For the first couple of minutes the whole nave is in
   shade and therefore lethal. That is by design (it pushes you to the blade
   corridor, which is what the bot does), but nothing explains it beyond the
   scarabs themselves, the damage message and the sound. A new player will
   probably die there once.
10. **The sundial is hard to read in low sun.** Below 9 degrees of sun elevation
    it refuses outright (and says so). Just above that the shadow is long and
    faint. During this review I found the gnomon's shadow was too thin to read
    at all against the dial's stonework; the gnomon is now a thick obelisk over
    a plain pale face and the morning light has more contrast. I have only seen
    the result in software-rendered screenshots.
11. **The night look was retuned in the last hour** (moonlight strength, grade
    contrast) and has only been judged from software-rendered screenshots.
12. **Balance is a guess.** The bot finishes a three-relic heist in about a
    third of the day. A human will be slower, but I do not know by how much,
    and I do not know whether the shop prices make sense.
13. **Visual quality is modest.** Low-poly trees, flat-shaded rock, canvas
    textures. It is coherent, not pretty.

## Performance

**I could not measure a real frame rate.** The container has no GPU; Chromium
renders through SwiftShader on 4 virtual CPUs, where the game runs at 1 to 4
frames per second. Those numbers say nothing about a laptop. What I can report
honestly is the work each frame asks for.

Measured with `node playtest/perf.cjs` against the production build, 1280x720,
one build before the final one. The only change since is the drawbridge deck's
body type, which draws nothing.
"Calls" and "tris" include the shadow passes. "Sim ms/step" is the full
fixed-step game update (physics, player, traps, guardians) averaged over 240
steps, on this container's CPU. "Step ms" is the worst single Rapier step seen
in the sampling window.

Medium preset (the default):

| View | Draw calls | Triangles | Physics bodies | Worst step ms | Sim ms/step | Software frame ms |
|---|---:|---:|---:|---:|---:|---:|
| A jungle, morning | 259 | 169,244 | 31 | 0.40 | 0.58 | 1,013 |
| A courtyard, noon | 611 | 167,890 | 67 | 0.10 | 0.28 | 456 |
| A cliffs | 366 | 97,818 | 67 | 0.20 | 0.22 | 494 |
| B broken halls | 603 | 78,386 | 95 | 0.10 | 0.24 | 744 |
| B sanctum | 706 | 56,262 | 104 | 0.20 | 0.83 | 531 |
| C catacombs, torch lit | 195 | 111,406 | 90 | 0.20 | 0.16 | 689 |
| C vault, torch lit | 321 | 42,948 | 97 | 0.60 | 0.14 | 594 |
| A courtyard, night, all 11 guardians out, torch lit | 1,008 | 141,956 | 135 | 1.60 | 0.81 | 455 |

The last column is the software renderer's frame time (1 to 2 frames per
second). It is in the table only so nobody thinks I hid it; it measures
SwiftShader, not the game.

Main-thread time for one rendered frame (game update plus submitting the draw
calls, not counting the software rasteriser's own threads), median and range
over the sampling window, same container:

| View | Median ms | Range ms |
|---|---:|---:|
| A jungle | 7.2 | 2.9 to 13.3 |
| A courtyard | 5.3 | 4.0 to 8.6 |
| A cliffs | 6.6 | 3.7 to 8.7 |
| B broken halls | 7.5 | 6.4 to 18.0 |
| B sanctum | 7.7 | 5.5 to 10.4 |
| C catacombs | 6.1 | 4.5 to 44.2 |
| C vault | 7.8 | 5.0 to 9.9 |
| A courtyard, night, guardians out | 14.1 | 8.8 to 46.1 |

Two more draw-call figures, measured by hand and not in the script's output:
the halls with the torch lit by day, about 625; the halls after dark with the
torch casting shadows, about 730 on a fresh load with no guardian in view. I
did not measure the halls with guardians in frame; going by the courtyard,
expect a few hundred more.

Scene building (all at once; in play it is sliced into 5 ms pieces per frame):

    jungle 73, courtyard 37, cliffs 21, halls 44, sanctum 18, catacombs 64, vault 33 (milliseconds)

Walking the whole route, the worst single frame spent in the scene manager was 18.9 ms. The frame in which each scene finished and uploaded cost: courtyard 3.9, cliffs 13.9, halls 13.7, sanctum 2.6, catacombs 18.7, vault 8.4 ms.

Reading this honestly:

- CPU-side simulation is cheap: well under 1 ms per 60 Hz step everywhere, so
  the simulation is not what will cost you frames.
- Draw calls are the risk. 200 to 700 per frame is fine for a discrete GPU and
  probably fine for a recent integrated one, but I would not promise 60 FPS on
  an older integrated chip at "high", and the 1,000-call night courtyard is
  exactly when the game is at its most frantic. The default is "medium" (pixel ratio
  capped at 1, 2x MSAA, hard shadow filtering); "low" drops MSAA, halves the
  shadow maps and renders at 0.8 scale. Draw calls at low and high are within
  a few of the medium figures; only pixels, MSAA and shadow resolution change.
- Main-thread time per frame (second table) sits at 5 to 8 ms on this
  container by day and underground, and at 14 ms in the night courtyard, all
  while a software rasteriser is eating the other cores. The first leaves room
  inside a 16.7 ms frame; the second leaves almost none. It is a cloud CPU,
  not a laptop, and none of it says anything about GPU time.
- The F3 overlay shows live FPS, frame time, draw calls and triangles, and
  `__lt.perf()` in the console samples real frames, so checking my guess on
  real hardware takes a minute. Running `LT_GPU=1 node playtest/perf.cjs` on a
  machine with a GPU prints this same table with real frame times.

My estimate, labelled as an estimate: 60 FPS at medium on a 2021-or-later
laptop with a discrete or recent integrated GPU, with the courtyard after
dark, once the guardians are out, the likeliest place to dip below it. I have no GPU measurement behind
that sentence.

## Zone C darkness

Confirmed by measurement: **with the torch out, Zone C renders pure black.**

`__lt.darknessProbe()` douses the torch, hides flame sprites and sconce
lights, draws the frame and reads every pixel back. Scenario `darkness` runs
it from 12 positions through the catacombs and vault, 12 view directions each,
at noon and at night: the brightest pixel in all 288 frames is 0 out of 255.
With the torch lit in the same place the brightest pixel is about 250 and
between a third and a half of the screen is lit.

How: every Zone C material is compiled with the directional and hemisphere
light counts forced to zero and no ambient term, the fog is black, and the
grade pass has no lift below ground. The only light sources that exist down
there are the hand torch, mounted sconces and a few emissive flame sprites.

The caveat, repeated from above: from the two doorways that join Zone B and
Zone C you can see sunlit Zone B geometry through the opening. The probe
positions are inside Zone C proper, not in those doorways.

## Where the code left the design documents

- `game/interact.ts` and `game/events.ts` from the architecture plan were never
  built. Interaction and event plumbing live in `game/game.ts`, which is the
  largest file (about 970 lines) and does too much.
- Draw-call budget of 250: exceeded, as above.
- "The torch always casts shadows" became "the torch casts shadows where the
  sky does not" (see the torch table).
- Darts as rigid bodies: became ray-marched projectiles.
- A dynamic navmesh with carved obstacles: stayed static.
- One boulder, not several.
- Default graphics quality is "medium", not "high", and the quality presets cap
  the device pixel ratio instead of multiplying it. Before that change a HiDPI
  laptop would have rendered three to four times the pixels by default.

## Bugs the bots found, now fixed

Kept as a record of what the test scripts were worth:

- The boulder jammed under a roof beam 7 m into its run, and later deflected
  off a pillar into the doorway. Beams and pillars moved.
- You could keep standing on a plank that had broken away, and on the invisible
  ghost of a crumbled floor after re-entering a scene. Rapier's character
  controller still collides with disabled colliders; they now also lose their
  collision groups.
- Starting a run while the menu backdrop was mid-build left a second, invisible
  rope bridge in the physics world.
- The FPS counter read 10 when the real frame rate was 3 (it used the clamped
  simulation step, not the real frame interval).
- The blade pendulums did not swing where they were drawn; the player stalled
  on shallow slopes; a thrown rock rolled for 20 m.
- **The drawbridge on the escape route could root you to its deck.** About one
  bot crossing in eleven stopped dead on the lowered deck and stayed there
  until a jump (4 stalls in 43 crossings: 2 in 17 full playthroughs, 2 in 26
  replays of that leg). The cause took a probe to find: the lowered deck was still a
  kinematic body, and the character controller refused 41 to 64 of 128 probed
  moves on it against 0 of 128 on ordinary floor. The deck now becomes a
  static body the moment it lands. After the fix: 0 of 128 refused, 40 of 40
  replays of the leg clean, and the same stretch takes 3.8 s instead of 7.4
  to 8.2 s, so the deck had been dragging on every crossing, not only the
  ones that stalled. Found and fixed in the last hour; scenario `drawbridge`
  now guards it.

And three that only screenshots found, in the last hour:

- The sundial's gnomon was a 10 cm pole. Its shadow was one or two shadow-map
  texels wide and vanished into the dial's stone joints, which made the puzzle
  that gates Zone C unreadable by eye. The bot never noticed because it reads
  game state. It is now an obelisk over a plain pale face.
- Night without a torch rendered pure black outdoors. The night grade's
  contrast pivots on mid grey and was crushing all of the moonlight to zero.
  With contrast at 1 the courtyard and the door are readable by moonlight.
- The night courtyard with the torch lit cost twice the draw calls of any
  other view (moon pass, six torch faces and the main pass together). It now
  costs about 1,000 instead of 1,220, which is better and still the heaviest
  frame in the game.

## The scripted checks, for reference

`node playtest/scenarios.cjs` against the production build of the final
commit: **26 scenarios, 106 checks, 0 failures, 0 console errors.**

| Scenario | What it showed |
|---|---|
| `darkness` | 12 Zone C positions x 12 view directions x 2 times of day with the torch out: brightest pixel 0 of 255. Torch lit in the ossuary: brightest 248, 36 to 44 % of pixels lit depending on the run. |
| `night` | Edge pulse on at 57 s left; guardians awake 3, 5, 7, 9, 11 in waves; door gap 5.16 m down to 0.39 m; staying inside ends the run entombed. |
| `sweep` | Guardians of more than one type path from the depths through the catacombs and halls into the courtyard. |
| `caught` | A guardian reaches a player who stands still in 8 s; haul banked 0 of 2,995 carried. |
| `door` | A 1.53 m gap stops a standing player; crouching under it escapes with the loot. |
| `pedestal` | Bare take sinks the pedestal and fires darts (3 hits of 20); a 2.0 kg rock swapped for the 1.8 kg censer keeps the trap asleep. |
| `torch` | 1.58 s to strike; fuel burns 1 per second of 210; dies at empty; R refuels from a flask or spare; swimming douses it. |
| `wind` | A cliff gust blows it out. |
| `fall` | A 6.5 m fall costs 40 health and the flame. |
| `crumble` | Stopping on the crumbling floor drops you to the level below; a sprint gets across. |
| `boulder` | Rolls z -60.2 to -23.8, top speed 9.6 m/s, comes to rest; a sidestepping player is untouched; standing in its path is fatal. |
| `bridge` | 12 planks on 13 revolute joints; sags 0.25 to 0.63 m under load; a plank cracks, breaks and tumbles as a free body; a sprint sheds all 12 planks and the near anchor lets go; the cliff bridge has sound and rotten planks. |
| `puzzle` | Leaning on a block slides it; one plate alone does nothing; both blocks on both plates open the sanctum and the player walks through. |
| `ceiling` | Creeping: strain 0. Sprinting and jumping: 3 chunks down, peak strain 0.65. |
| `climb` | Vines from y -2.58 to 0.02; a jump at a chest-high ledge becomes a mantle. |
| `drawbridge` | The raised deck blocks the canal; the winch lowers it level; once down it is a static body; 24 crossings, walking and sprinting, without a stall. |
| `sconce` | Mounting a spare torch spends it and lights the room with the hand torch out (brightest pixel 0 to 252). |
| `memory` | Scenes unload behind the player; a taken relic does not respawn; a pushed block stays put; 10 crumbled tiles stay crumbled and the hole is real. |
| `collapse` | Taking the Dawn Idol (4,000 coins) buries the door back to the halls. |
| `weight` | 12 kg: 15.6 m against 19.8 m in a 3 s sprint; stamina left 38 against 64. |
| `streaming` | 6 different loaded-scene sets along the route; no jungle in the vault, no vault at camp. |
| `menus` | Main menu, results, outfitter purchase, save survives a reload, high scores, 7 settings controls, FOV slider drives the camera, pause stops the clock, debug overlay, map. |
| `carry` | A rock carried 6 m, thrown at 11.7 m/s to land 15.9 m away, makes noise on impact, can be picked up again. |
| `ghost` | An escape records a ghost; the next run shows it walking the same path. |
| `gamepad` | (Faked pad.) Left stick walks, right stick looks, Y strikes the torch, A jumps, Start pauses. |
| `input` | A real click starts audio and captures the mouse; W walks; a mouse move turns the view; F strikes the torch; losing pointer lock pauses; Resume recaptures; a simulated dusk, nightfall and dungeon run peaks at 23 or 24 voices with no audio errors. |

`node playtest/playthrough.cjs`: **6 runs of 6 passed** against the same build: 58
steps each, the heist finished at game time 256 to 257 s with three relics
banked (4,560 coins, 7.2 kg), results screen, high score and save written, 0
console errors.

That is the record after the drawbridge fix. Before it, this script failed 2
runs in 17, both times stalled on the drawbridge deck. Since the fix: these 6
playthroughs, 40 replays of the escape leg and the 24 crossings in the
`drawbridge` scenario, with no stall. `playtest/smoke.cjs` also passes against
`play/` served from a nested path by a plain static file server.

What these scripts are not: they drive the game through `window.__lt` and
simulated time. The player walks with the same controller and the same input
actions a human uses, but nothing here tells you whether it is fun.

## Eval bookkeeping

| | |
|---|---|
| Start | 2026-11-11T21:27:15Z |
| Finish | 2026-11-12T02:27:37Z, when this file was completed for the final commit. The pull request was opened straight after. |
| Wall clock | 5 h 00 min |

It was one continuous stretch with nobody to wait on. One worker restart (a
headless test run ran the container out of memory) cost a few minutes inside
that total.

Token usage, tallied at 02:27Z from the session's transcript file on disk and
de-duplicated by response id (526 model responses, one model throughout, no
sub-agents):

| | Tokens | List price per million | Cost |
|---|---:|---:|---:|
| Input, uncached | 1,000 | $8 | $0.01 |
| Output | 1,144,385 | $40 | $45.78 |
| Cache writes (1-hour) | 2,437,248 | $16 | $39.00 |
| Cache reads | 126,126,239 | $0.20 | $25.23 |
| **Estimated total** | | | **$110.00** |

What that number is and is not:

- **I could not get the `/usage` figures.** `/usage` is a command of the
  interactive client; nothing inside this session can run it, and the
  session's own metadata carries no token or cost data.
- So this is my own tally, priced at the published list rates for the model
  this entry ran on. It is an estimate, not a bill.
- It is low by whatever was spent outside the transcript. The conversation
  was summarised at least three times when its context filled up, and those
  summarisation calls are not logged in the file I counted. It also stops a
  few minutes short of the end (opening the pull request and the final
  report). My guess is that the true figure is a few dollars higher; the
  usage tracker on the requester's side is the authority, not this table.
