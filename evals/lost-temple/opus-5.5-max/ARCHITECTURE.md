# The Lost Temple: architecture

TypeScript, Vite, Three.js (WebGLRenderer) for rendering, Rapier (`@dimforge/rapier3d-compat`, WASM inlined) for physics, Vitest for unit tests. No game engine, no external assets: every mesh, texture and sound is generated in code at startup.

## Layers

```
            +--------------------------------------------------------------+
            |  ui/      menus, HUD, sundial, map, debug overlay (DOM+canvas)|
            +--------------------------------------------------------------+
            |  game/    Game (loop, run lifecycle), RunState, Director      |
            +-----------+-------------+--------------+-------------+-------+
            | entities/ | world/      | render/      | audio/      | input |
            | Player    | SceneManager| Renderer     | AudioEngine |       |
            | Torch     | LevelBuilder| Sky, Grading | Sfx, Music  |       |
            | Guardian  | scenes/*    | textures     | Ambience    |       |
            | Ghost     | props/*     | materials    |             |       |
            +-----------+-------------+--------------+-------------+-------+
            |  physics/  Rapier wrapper: bodies, groups, queries, events    |
            +--------------------------------------------------------------+
            |  logic/   PURE TypeScript, no three / rapier / DOM imports     |
            |  economy, countdown, sun, torch, traps, unlocks, guardians,   |
            |  navmesh, noise, player stats, save schema                    |
            +--------------------------------------------------------------+
```

The rule that keeps this testable: **everything in `src/logic/` is plain data and functions.** The game layer feeds it numbers (mass on a plate, fuel, distance to the player, noise events) and reads back decisions (fire the trap, new radius, guardian state and move target). Unit tests import only `src/logic/`.

## Directory layout

```
src/
  main.ts               boot: init Rapier, build renderer, UI, show main menu
  config.ts             tuning constants shared by logic and game layer
  logic/
    economy.ts          relic table, zone multipliers, satchel, banking, shop, scoring
    countdown.ts        day clock, phases, tick schedule, 60 s / 0 s / door thresholds
    sun.ts              sun direction from day time, sundial shadow angle, grading keys
    torch.ts            fuel burn, radius curve, extinguish rules, relight timer
    traps.ts            pressure plate, weighted pedestal, crumble timer, plank timer
    unlocks.ts          scene graph, requirements, shortcuts, reachability
    guardians.ts        sentinel / crawler / shadow state machines
    navmesh.ts          convex polygon navmesh, portals, A*, funnel, point location
    navbuild.ts         rasterize walkable rects minus obstacles, greedy-merge to polygons
    noise.ts            noise events, hearing, sanctum ceiling strain
    playerStats.ts      stamina, load factor, fall damage
    save.ts             save schema, defaults, migration, high-score insert
    rng.ts              seeded RNG (mulberry32)
  core/
    Input.ts            keyboard, mouse, pointer lock, gamepad -> action state
    Events.ts           typed event bus
  physics/
    Physics.ts          world, fixed step, groups, raycasts, shape queries, event drain
  render/
    Renderer.ts         WebGLRenderer, HDR MSAA target, final pass, quality presets
    PostShader.ts       tone map + grading + vignette + edge pulse + grain
    Sky.ts              sky dome shader (sun disc, horizon glow, stars)
    Lighting.ts         sun, hemisphere, fixed pool of point lights
    textures.ts         canvas textures (stone, moss, wood, bark, leaves, gold, water...)
    materials.ts        shared materials, zone-C-safe (no emissive)
    geometry.ts         box UV helper, rocks, lathe shapes, merge helpers
    relicMeshes.ts      procedural model for each relic type
    vegetation.ts       instanced trees, ferns, grass with wind sway
    particles.ts        dust, sparks, splashes (pooled points)
  world/
    SceneManager.ts     streaming: which scenes are loaded, time-sliced builds, unload
    LevelBuilder.ts     DSL: floor, wall, box, ramp, stairs, pillar, vine, water... ->
                        merged meshes per chunk and material, colliders, nav input
    WorldState.ts       persistent per-run state of props (survives unload/reload)
    scenes/             jungle, courtyard, cliffs, halls, sanctum, catacombs, vault
    props/              Bridge, PressurePlate, Door, PushBlock, Boulder, Blade,
                        DartTrap, CrumbleTile, Pedestal, Relic, Sconce, Sundial,
                        SunstoneTile, Drawbridge, BreakableWall, Seal, Crank, Ceiling
  entities/
    Player.ts           kinematic character controller, climb, mantle, carry, interact
    Torch.ts            view model, flame, light assignment, flicker
    Guardian.ts         mesh + nav agent + logic state machine + kinematic collider
    GuardianDirector.ts spawn schedule after darkness, perception queries
    Ghost.ts            best-run recording and playback
  audio/
    AudioEngine.ts      context, buses (music, sfx, ambience), spatial voices
    Sfx.ts              every procedural sound effect
    Music.ts            procedural music with calm, tense, and chase layers
    Ambience.ts         per-zone beds
  game/
    Game.ts             owns everything; main loop; run start/end; debug API
    RunState.ts         time, health, stamina, satchel, keys, flags, stats
  ui/
    UI.ts               main menu, pause, settings, shop, high scores, results
    HUD.ts              bars, loot, prompts, toasts, edge pulse
    SundialHUD.ts       the stone sundial canvas
    MapView.ts          the hand-drawn map
    DebugOverlay.ts     FPS, bodies, scene, draw calls, guardians
    styles.css
tests/                  vitest unit tests for src/logic
scripts/                headless playtest scripts (Playwright), not part of the game
```

## Main loop

`Game.frame(now)` runs on `requestAnimationFrame`:

1. `Input.poll()` (keyboard, mouse deltas, gamepad).
2. Fixed-step simulation at 60 Hz with an accumulator (at most 4 steps per frame):
   1. `Player.fixedUpdate` runs the Rapier character controller, climbing, mantling, platform carry, carry-object spring.
   2. Props `fixedUpdate` (pressure plate loads, bridge forces, blade kinematics, boulders).
   3. Guardians `fixedUpdate` (nav following, set kinematic targets).
   4. `Physics.step()` then drain collision and contact-force events (impacts become sounds and noise events).
3. Variable-step update: day clock, sun and sky, grading, torch flicker and fuel, scene streaming, director (spawns, perception), audio (listener, ambience mix, ticking), HUD (DOM writes throttled to 10 Hz), map reveal, ghost.
4. Render: scene into a half-float MSAA target, then one full-screen pass does tone mapping and grading to the canvas. The camera position is interpolated between the last two physics steps so motion stays smooth at any refresh rate.

## Scene streaming

- Every scene is a `SceneDef { id, zone, bounds, neighbours, build* }` in world coordinates. All seven scenes share one Three.js scene graph and one Rapier world; a loaded scene owns a `Group`, a fixed body with its static colliders, and its props.
- The `SceneManager` keeps **the scene the player is in plus its neighbours** loaded. Leaving a scene's neighbourhood starts a 4 s grace timer, then it is disposed (geometry, colliders, bodies, sounds).
- `build` is a generator. The manager advances pending builds with a budget of about 4 ms per frame, so the next scene appears over a few frames while you walk towards it. Only the first two scenes are built during the start-of-run loading screen.
- Props save their state (taken relics, fallen planks, opened doors, moved blocks) into `WorldState` when they change or unload, and read it when they are built again. Nothing resets when you walk back.
- The navmesh does **not** stream. It is built for the whole world when the run starts (pure data, about 10 ms), so guardians can path through scenes that are not loaded.

## Level building

Scenes are written with `LevelBuilder`, a small DSL:

```ts
b.floor(x0, z0, x1, z1, y, 'stoneFloor');           // mesh + collider + walkable nav area
b.wall(x0, z0, x1, z1, y0, y1, 'stoneBlock');        // mesh + collider + nav obstacle
b.ramp(x0, z0, x1, z1, y0, y1, 'z', { steps: true }); // visual steps, smooth collider, sloped nav polygon
b.pillar(x, z, y, h, r, { broken: true });
b.vine(x, z, y0, y1, normal);                         // climb volume + mesh
b.navGate('vaultDoor', x0, z0, x1, z1, y);            // nav polygon that can be closed
```

At `finish()` all static boxes are merged into one mesh per (16 m chunk, material) so frustum culling and shadow-camera culling still work, then one Rapier fixed body gets a cuboid collider per box (plus trimesh colliders for terrain). The same boxes feed `navbuild`: walkable tops are rasterized at 0.5 m, obstacles dilated by the agent radius are cut out, and the remaining cells are greedily merged into rectangles (max 6 m per side, so light checks stay local). Ramps are added as sloped quads. Adjacency comes from shared edges with matching height.

## Physics

- One Rapier world, gravity -12 m/s^2 (the player uses its own -20 m/s^2 for snappier jumps).
- Collision groups: `STATIC`, `PLAYER`, `PROP`, `DEBRIS`, `GUARDIAN`, `SENSOR`, `HAZARD`, `DART`. Hazards (boulder, blades, falling debris, darts) do not physically collide with the player capsule; their damage is applied by distance and speed checks, so a kinematic player never stops a 3 tonne boulder.
- The player is a kinematic capsule driven by Rapier's `KinematicCharacterController` (autostep, snap to ground, slope limit). When standing on a dynamic body the player adds that body's velocity (platform carry) and pushes down with its weight. Rope-bridge planks are the exception: the player rides them down but does not inherit their horizontal sway, and pushes with 40% of its weight, otherwise the steep last planks behave like a treadmill.
- Anything the player walks on is a fixed or dynamic body, never a kinematic one: the character controller stalls on kinematic floors (found by the route playtest on the lowered drawbridge and the closed seal). Doors, slabs and the drawbridge are therefore fixed bodies that are teleported (`setTranslation` / `setRotation`) while they move. Only blades and guardians are kinematic, and the player never stands on those.
- A held object follows a velocity-limited spring to a point in front of the camera. It is dropped only when it stays more than 2.6 m behind that point for 0.35 s (snagged behind a wall), so a fast 180 degree turn does not drop it.
- Sensors (plates, pedestals) are queried with `intersectionsWithShape` and sum `mass()` of resting dynamic bodies.

## Lighting and the zero-ambient rule

- Lights are a fixed set so shader programs never change mid-run: one directional sun (shadow-casting), one hemisphere light, and a pool of 4 point lights (the player's torch with cube shadows, plus 3 for the nearest placed sconce torches).
- Zone is decided by the camera position. In Zone C: sun intensity 0 and its shadow map stops updating, hemisphere 0, sky dome hidden, background and fog black, all Zone C materials have no emissive term, grading lift is 0 and film grain is multiplied by luminance. Only torches light anything.
- `scripts/check-dark.mjs` renders a frame in the catacombs with the torch snuffed and asserts every pixel of the WebGL canvas is exactly 0.

## Guardians

`logic/guardians.ts` has one state machine per type with a common shape:

```ts
update(brain, perception, dt) -> { state, moveTarget, speed, catch }
```

`perception` is gathered by `GuardianDirector` each tick: distance and line of sight to the player (physics raycast), the player's light radius, noise events heard this tick, light level at the guardian, lit sconces nearby. `Guardian.ts` asks the navmesh for a path to `moveTarget`, follows it with steering and separation, and moves a kinematic capsule. The shadow uses an A* cost function that makes lit polygons impassable.

## Audio

One `AudioContext`, master compressor, three buses (music, sfx, ambience). Positional sounds use `PannerNode` (HRTF) with the listener on the camera. Every sound is synthesized (oscillators, noise buffers, filters, envelopes); nothing is loaded.

## Graphics quality

Three presets (`config.ts`): low (0.75 pixel ratio, 1024 sun shadows, 256 torch cube shadows, no MSAA, sparser vegetation), medium (native resolution capped at 1x, 2048/512 shadows, 2x MSAA) and high (up to 1.5x pixel ratio, 4x MSAA, full vegetation). Medium is the default. If the first four minutes of play average under 45 FPS over a 5 second window, the preset steps down (at most twice per session) and a toast says so.

## Persistence

`localStorage` key `lostTemple.save.v1`: settings, money, purchased upgrades, high-score table (top 10), best-run ghost track (quantized). `logic/save.ts` validates and migrates the blob, so a corrupt save falls back to defaults.

## Debugging and test hooks

- `F3` overlay: FPS, frame ms, physics bodies and colliders, current and loaded scenes, draw calls, triangles, guardian states.
- `F3` also shows the CPU cost of the update half of the frame and of the render call, measured separately.
- `?debug` in the URL exposes `window.lostTemple`: `start(seed)`, `state()`, `teleport(scene | [x,y,z], yaw)`, `setTime(secondsLeft)`, `advance(s)`, `speed(k)` (game seconds per real second, for slow software-rendered test browsers), `look`, `move`, `press`/`release` (inject input actions), `give(item)`, `flag(f)`, `light()`, `snuff()`, `god()`, `noGuardians()`, `quality(q)`, `cpu()` and `litPixels()` (reads the WebGL canvas back and counts non-black pixels).
- `?headless` (or a HeadlessChrome user agent) skips pointer-lock pauses and the adaptive quality drop.
- Playwright scripts in `scripts/` (run against `npm run dev`): `smoke`, `tour` (every scene: frame cost, draw calls, triangles, bodies), `heist` (stash, bank, leave, results, save), `progression` (sundial to Sun-Disc to seal), `door` (push block plus plate), `bridge` (rope bridge crossing), `darkness inside|outside|hall` (guardian wake, sweep, catch, door shut), `menus` (click-through of every screen), `check-dark` (Zone C zero-light assertion), `traps` (pedestal swap and darts, crumbling pit, dart plates, blades standing and crouched, idol collapse, boulder; damage is recorded instead of applied), `route` (walks the way in and the whole escape route on foot along navmesh paths and reports every spot the thief gets stuck), `climb` (three mantles and two vine climbs up the cliffs, then a throw), `supplies` (takes every oil flask and spare torch cache), `bridge flood` (the catacomb plank bridge, crossed and failed), `hazards` (sunstones through the day, noise collapse, the flooded chamber and Serpent Key, torch blow-outs and relighting, wind, a simulated gamepad, the ghost replay) and `audio` (analysers on the mixer buses: ambience, music, every listed effect and loop, the final-minute cues).

## Tests

`npm test` runs Vitest on `tests/`: loot economy, trap triggers, countdown thresholds, torch fuel and radius curve, scene unlock logic, guardian state machines, plus navmesh pathfinding, noise, sun and save schema.
