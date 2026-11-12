# The Lost Temple: Architecture

Written before any code. Stack: TypeScript, Vite, Three.js for rendering, Rapier (`@dimforge/rapier3d-compat`) for physics, Vitest for tests. No game engine. No asset files: geometry is built in code, textures are drawn on canvases, audio is synthesised with WebAudio.

## Layering

```
src/
  core/      Pure rules. No three.js, no Rapier, no DOM. Everything here is unit tested.
  engine/    Thin wrappers over the browser and libraries (physics, input, audio, textures, sky, level builder).
  world/     Scene definitions, streaming, set pieces (bridges, traps, doors).
  entities/  Player, torch, relics, guardians: the things that move.
  ui/        HTML/CSS overlays: HUD, menus, shop, map, debug.
  game/      The orchestrator that owns the loop and the run state.
tests/       Vitest specs against core/.
```

The rule that keeps this honest: `core/` never imports from anywhere else, and the runtime layers call into `core/` for every decision that the spec asks to be tested. The runtime only supplies inputs (positions, timers, contacts) and applies outputs (spawn, damage, open).

## core/ (pure logic)

| Module | Owns |
| --- | --- |
| `economy.ts` | Relic table, rarity weights, depth multipliers, loot spot roll, satchel load, encumbrance curves, shop catalogue and pricing, haul totals |
| `clock.ts` | Day timeline, time left, phase, tick interval and volume, threshold events (120 s, 60 s, 0, door sealed, entombed), door-closing fraction |
| `sun.ts` | Sun direction from time, elevation, colour grading keyframes and interpolation, per-zone ambient factor (Zone C is 0) |
| `sunlight.ts` | Analytic "is this floor point sunlit" from roof openings and sun direction |
| `torch.ts` | Fuel burn, radius curve, lit/relighting/out state machine, extinguish causes, spare torches and flasks |
| `unlock.ts` | Scene graph, edge requirements, `canTraverse`, reachable set, shortcut state |
| `traps.ts` | Pressure plate rule, pedestal weight swap rule, plank and crumble timers, dart volley rule, noise meter and debris thresholds, damage numbers |
| `guardianFsm.ts` | State machines for sentinel, crawler and shade as pure `step(state, percept) → state` functions, wake schedule |
| `navmesh.ts` | Rectangle-polygon navmesh: build, obstacle carving, adjacency portals, A*, funnel, point location |
| `save.ts` | Save-data shape, defaults, migration, high-score insertion (storage is injected, so tests use a fake) |
| `rng.ts` | Seeded PRNG |

## engine/

- **`physics.ts`**: loads Rapier, owns the `World`, fixed 60 Hz step with an accumulator, raycast helpers, and a body ↔ mesh sync list for dynamic bodies.
- **`builder.ts`**: the level kit. A `SceneBuilder` collects boxes, ramps and cylinders. For each it records a static collider, appends vertices to a per-material merged geometry (world-scaled UVs so textures tile evenly) and optionally registers a nav rectangle. `finish()` returns a `BuiltScene` with a handful of merged meshes, one fixed rigid body holding all static colliders, and a dispose function. This is what keeps draw calls low enough for 60 FPS.
- **`textures.ts` / `materials.ts`**: canvas-drawn stone, moss, dirt, grass, bark, leaf, wood, gold, water and so on, with bump maps derived from the same canvas. One shared material set.
- **`sky.ts`**: sky dome shader, sun/moon directional light with a shadow frustum that follows the player, hemisphere light, fog. Reads `core/sun.ts` every frame and applies grading. Multiplies ambient and sun by the zone factor so Zone C is black.
- **`input.ts`**: keyboard, mouse (pointer lock), gamepad, merged into one action state.
- **`audio.ts`**: a synth toolbox (noise buffers, envelopes, filters) and the named sounds: ambience beds, tick, creak, snap, grind, crackle, guardian calls, heartbeat, plus a small generative music sequencer with three moods.

## world/

- **`World.ts`**: streaming. Holds the seven `SceneDef`s. Each frame it works out which scene the player is in (bounds test), keeps that scene and its graph neighbours loaded, and unloads the rest. Builds are time-sliced: a scene's `build()` is a generator that yields between chunks, and the world gives it a few milliseconds per frame, so crossing a boundary never stalls the frame. Persistent facts (which relics are taken, which planks fell, which walls are kicked) live in `RunState`, not in the scene objects, so a scene can be thrown away and rebuilt correctly.
- **`scenes/*.ts`**: one file per scene. Each exports a `SceneDef`: id, zone, bounds, neighbours, nav rectangles, loot spots and the `build()` generator.
- **`setpieces.ts`**: runtime classes for rope bridge, crumbling tiles, pressure plates, pushable blocks, blades, dart launchers, boulder, sliding doors, drawbridge, kick walls, debris, vines, water volumes, scarab bands. Each has `update(dt)` and `dispose()`, and each defers its rule to `core/traps.ts`.
- **`props.ts`**: procedural meshes for relics, rocks, pedestals, sconces, vegetation, pillars.

The global navmesh is built once from every scene's nav rectangles at run start and is independent of streaming, so guardians keep pathing through scenes that are not currently rendered.

## entities/

- **`Player.ts`**: capsule + Rapier kinematic character controller. Handles walk/run/crouch/jump, mantling, vine climbing, water, wind, stamina, health, fall damage, interaction targeting, carrying and throwing. Emits noise events.
- **`TorchRig.ts`**: the hand torch mesh, the shadow-casting point light, flicker, and the fixed pool of sconce lights. Drives `core/torch.ts`.
- **`Relics.ts`**: world relics, pedestals, dropped relic bodies, the satchel.
- **`Guardians.ts`**: one class per guardian instance holding its mesh, its `core/guardianFsm` state and its current navmesh path. Builds the percept each tick (line of sight via physics raycast, heard noises, light levels) and moves along the path.

## game/

- **`Game.ts`**: owns renderer, camera, physics, world, entities, UI. State machine: `menu → playing ⇄ paused → results → menu`. The frame is: input → fixed physics steps (player, set pieces, guardians) → clock and events → streaming → sky and torch → render → HUD.
- **`RunState.ts`**: everything about the current run: time, satchel, keys, opened shortcuts, taken relics, stats, ghost recording.

## ui/

Plain DOM over the canvas. `hud.ts` (canvas-drawn sundial, bars, loot value, prompts, vignette pulse), `menus.ts` (main, pause, settings, shop, scores, results), `map.ts` (sketched map that reveals visited cells), `debug.ts` (FPS, body count, scene, draw calls, ambient value).

## Lighting budget

To avoid shader recompiles mid-run the light set is fixed for the whole session:

- 1 directional (sun or moon), shadow map 2048 (1024 on low).
- 1 hemisphere (intensity scaled to 0 in Zone C).
- 1 torch point light with a cube shadow map (512), shadows paused while unlit.
- 4 pooled point lights without shadows, assigned to the nearest lit sconces.

## Performance plan

- Static geometry merged per material per scene (target under 80 draw calls in view).
- Vegetation, scarabs, darts and debris are instanced.
- Only the current scene and its neighbours exist in the renderer and in the physics world.
- Fixed physics step, small dynamic body count (bodies that fall out of the world are removed).
- Quality setting scales shadow map size, pixel ratio, vegetation density and torch shadows.

## Testing

`npm test` runs Vitest over `core/`: loot economy, trap triggers, countdown thresholds, torch fuel and radius curve, scene unlock logic, guardian state machines, plus navmesh pathing, sunlight projection, sun/ambient and save data. A debug hook on `window.__lt` (teleport, set time, grant items) is used for browser smoke tests driven by Playwright.
