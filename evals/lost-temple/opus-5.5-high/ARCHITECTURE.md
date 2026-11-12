# The Lost Temple — Architecture

TypeScript + Vite. Three.js renders, Rapier (`@dimforge/rapier3d-compat`, WASM
inlined) simulates. No game engine. Every texture, mesh and sound is generated
at runtime.

## Layers

```
src/
  main.ts               boot: init Rapier, build Game, wire UI
  logic/                PURE game rules. No three, no rapier, no DOM. Unit-tested.
    economy.ts          relic table, zone multipliers, weight effects, shop, haul
    countdown.ts        day length, phase thresholds, tick cadence, sun angles, grading keys
    torch.ts            fuel burn, radius curve, extinguish rules, relight
    traps.ts            pedestal weighing, plank/crumble timers, pressure plates, dart cadence, damage
    unlocks.ts          scene graph, edges + requirements, reachability
    guardianFSM.ts      per-type state machines (pure transition functions)
    navmesh.ts          convex-polygon navmesh, portal graph, A*, funnel (string pulling)
    sundial.ts          shadow azimuth vs ring glyph
    rng.ts              seeded RNG (mulberry32)
    vec.ts              tiny vector helpers for the pure modules
  core/
    Game.ts             owns the loop, run state, wires every system together
    Input.ts            keyboard, mouse, pointer lock, gamepad, rebinding-free action map
    Save.ts             localStorage profile: bank, upgrades, scores, settings, ghost
    RunState.ts         per-run mutable state (inventory, flags, entity persistence)
  world/
    Physics.ts          Rapier world wrapper, collision groups, raycasts
    Textures.ts         canvas texture generators (stone, moss, dirt, wood, bark, leaves...)
    Materials.ts        shared material cache keyed by name
    LevelBuilder.ts     DSL: box/floor/wall/ramp/cylinder -> merged meshes + fixed colliders
    SkyLighting.ts      sky dome shader, sun light, hemisphere, fog, grading, zone exposure
    SceneStreamer.ts    attaches/detaches scenes around the player, persists entity state
    scenes/*.ts         one module per scene: data (floors, nav, sconces) + build()
    layout.ts           scene bounds/zone table, the navmesh source rectangles
  entities/
    Player.ts           kinematic character controller, crouch/climb/mantle/swim, stamina
    Torch.ts            the torch point light + flame, sconce light pool
    Props.ts            grabbable dynamic bodies (relics, rocks, sandbags, blocks), carry/throw
    Traps.ts            runtime traps: rope bridges, crumble tiles, sun tiles, darts, blades, boulder, plates, debris
    Guardians.ts        guardian meshes + movement on the navmesh, driven by logic/guardianFSM
    Ghost.ts            records and replays the best run
  audio/Audio.ts        WebAudio synth: ambience, ticking, creaks, grinding, crackle, calls, heartbeat, music
  ui/                   DOM overlay: HUD (canvas sundial), menus, shop, results, settings, debug, map
```

## Data flow per frame

```
Input ─► Player.update (Rapier KCC) ─► Props / Traps.update ─► Physics.step
   │                                                           │
   └─► Game: countdown.tick ─► SkyLighting.setTime ─► Torch.update ─► Guardians.update(navmesh, FSM)
                                                              │
                     SceneStreamer.update(player pos) ◄───────┘
                                   │
                         HUD.update ─► Audio.update ─► renderer.render
```

* Fixed physics step of 1/60 s with an accumulator (max 4 substeps).
* Pure logic modules hold the rules. Runtime classes only translate physics
  and rendering facts into their inputs (e.g. `Traps` measures the mass on a
  pedestal, `logic/traps.pedestalTriggered` decides).

## Streaming

Each scene module exports a `SceneDef`: id, zone, AABB bounds, neighbours,
and a `build(ctx)` that returns a `SceneInstance` with `attach()`,
`detach()` and `update(dt)`. Static geometry is built once (lazily, during the
first idle frames of a run) and cached. Attaching adds the cached group to the
render scene and creates its fixed colliders and dynamic entities. Detaching
removes them and writes dynamic entity state (positions, fallen planks,
collected relics, opened doors) into `RunState.entities`, so a re-attach
restores exactly what you left. Scenes more than one graph step away from the
current scene are detached after a 4 s grace period.

## Rendering budget

* Static geometry merged per material per scene (a few draw calls each).
* Foliage uses `InstancedMesh`.
* Fixed light count (sun, hemisphere, torch, 4 pooled sconce lights) so
  shaders never recompile; unused lights sit at intensity 0.
* Sun shadow camera follows the player (±45 m box). The torch casts a cube
  shadow (512² on medium).
* Graphics quality changes shadow map sizes, pixel ratio, foliage density and
  torch shadows.

## Navmesh

Temple floors (zones B and C) are authored as convex rectangles and ramps in
`layout.ts`. `logic/navmesh.ts` finds shared edges (portals) between them,
runs A* over polygon centroids/portal midpoints, then string-pulls the
corridor with the simple stupid funnel algorithm. Polygons carry an optional
`gate` flag (for example `drawbridge`), and a predicate decides traversal.
Guardians move kinematically along the path, sampling floor height from the
polygon (ramps interpolate).

## Testing

`npm test` runs Vitest over `tests/`: loot economy, trap triggers, countdown
thresholds, torch fuel/radius curve, scene unlocks and reachability, guardian
state machines, navmesh pathing, and the sundial.

In the browser, `?debug=1` exposes `window.__game` (teleport, set time, give
items) and number keys to jump between scenes. The headless playtest script
(`scripts/playtest.mjs`) drives a run with Playwright and samples FPS per
scene.
