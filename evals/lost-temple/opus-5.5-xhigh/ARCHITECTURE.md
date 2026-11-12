# The Lost Temple: Architecture

TypeScript + Vite. Three.js renders, Rapier (`@dimforge/rapier3d-compat`, WASM inlined)
simulates. No engine, no external assets: every mesh, texture and sound is generated
at runtime.

## Layers

```
src/
├── main.ts                 boot: create Game (inits Rapier WASM), show the main menu
├── core/                   tiny shared utilities (no Three, no Rapier)
│   ├── rng.ts              seeded PRNG (mulberry32) + weighted pick
│   └── events.ts           typed event bus
├── logic/                  PURE game rules: no DOM, no Three, no Rapier. Unit-tested.
│   ├── economy.ts          relic table, zone value, satchel, haul, rolls per slot
│   ├── clock.ts            day clock, countdown phases/thresholds, sun position, grading keys
│   ├── torch.ts            fuel burn, radius curve, blow-out chances, relight timer
│   ├── traps.ts            pressure plate, weight-swap pedestal, crumble/plank timers, dart timing
│   ├── unlocks.ts          scene graph, gates, requirements, shortcut rules, streaming set
│   ├── guardians.ts        guardian brains (sentinel / crawler / shade state machines)
│   ├── navmesh.ts          convex-polygon navmesh, A*, funnel string-pulling, gates
│   └── meta.ts             save format, high scores, shop, ghost compression
├── engine/                 thin wrappers over browser + libraries
│   ├── renderer.ts         WebGLRenderer, quality presets, composer + grading pass
│   ├── materials.ts        material factory; patches shaders with a per-material
│   │                       "sky mask" so Zone C receives no sun/sky/hemisphere light
│   ├── textures.ts         procedural canvas textures (+ normal maps from height, parchment)
│   ├── physics.ts          Rapier world, collision groups, body registry, queries
│   ├── input.ts            keyboard, mouse, pointer lock, gamepad → one action state
│   └── audio.ts            WebAudio graph, procedural sfx, ambience, music, 3D panners
├── world/
│   ├── layout.ts           THE level: floor rectangles, regions, gates, sconces, relic slots,
│   │                       traps, for all 7 scenes in one world coordinate space
│   ├── query.ts            point queries over the layout: floor at, scene at, exposure at;
│   │                       builds the global navmesh from the floor list
│   ├── build.ts            builders: walls/floors/ceilings from the floor grid, merged
│   │                       (spatially chunked) meshes + colliders tagged by scene
│   ├── terrain.ts          outdoor height function → mesh + Rapier heightfield; ruin props
│   ├── nature.ts           instanced trees, palms, ferns, grass, vines, water surfaces
│   ├── shafts.ts           visible sun shafts through the hall roof holes
│   ├── SceneManager.ts     streaming: decides the loaded set, runs scene builders as
│   │                       time-sliced generators, unloads + saves state
│   ├── sky.ts              sky dome shader, sun + moon lights, fog, grading keyframes
│   └── scenes/             one module per scene: build(ctx) generator + per-frame hooks;
│       ├── jungle.ts  courtyard.ts  cliffs.ts        each scene also owns its own traps
│       ├── halls.ts   sanctum.ts                     and mechanisms (sundial, sun-stones,
│       └── catacombs.ts  vault.ts                    boulder, blades, flood, drawbridge…)
├── entities/
│   ├── Player.ts           Rapier kinematic character controller, run/crouch/jump,
│   │                       stamina, health, vines, mantling, swimming, fall damage, pushing
│   ├── Torch.ts            held torch mesh, flame shader, point light w/ shadows, sconce pool
│   ├── Items.ts            loot + props as rigid bodies, satchel, hands (grab/carry/throw)
│   ├── Interactables.ts    pedestals (weight-plate traps), sconces, shared door/lever helpers
│   ├── Effects.ts          darts (swept rays), falling debris bodies, dust, sparks
│   ├── Bridge.ts           jointed rope bridge
│   ├── Guardians.ts        guardian bodies, perception → brain → navmesh steering
│   └── meshes.ts           procedural relic and prop meshes (lathes, tori, boxes)
├── game/
│   ├── Game.ts             owns everything; fixed-step physics loop; run lifecycle,
│   │                       interaction, clock consequences, ghost replay, debug hooks
│   └── RunState.ts         per-run persistent state (flags, item transforms, stash, carried)
└── ui/
    ├── menus.ts            main, pause, settings, shop, scores, controls, results, loading
    ├── hud.ts              HUD DOM + the stone sundial clock (canvas)
    ├── mapview.ts          parchment map that fills in as you explore
    ├── debug.ts            debug overlay (F3) and warp / time-skip panel (F4)
    └── styles.css          all UI styling (system serif fonts, no external assets)
scripts/playtest.mjs        headless Chromium playtest (screenshots, perf, Zone C black check)
tests/*.test.ts             vitest suites for logic/
```

### Why the split

`logic/` is the game's rulebook: plain functions and small classes over plain data.
Everything that decides an outcome (what a relic is worth, whether a plate fires, when
the clock crosses a threshold, how bright the torch is, which scene unlocks, what a
guardian does next, how it gets there) lives there, so it can be tested in Node
without WebGL or WASM. `entities/` and `world/` translate between those rules and the
renderer and physics engine.

## Frame

```
requestAnimationFrame
 ├─ input.poll()                     (keyboard/mouse/gamepad → actions)
 ├─ accumulate dt; while (acc ≥ 1/60): fixedStep(1/60)
 │    ├─ player.fixedUpdate          (KCC move, collisions → pushes, plank/tile contacts)
 │    ├─ items.fixedUpdate           (held object spring, plates query loads)
 │    ├─ fx.fixedUpdate + scene.fixed (darts, debris, blades, boulder, crumble, plates)
 │    ├─ guardians.fixedUpdate       (perception → brain → navmesh path follow)
 │    └─ physics.world.step()
 ├─ runClock.update(dt)              (logic/clock: phase changes fire events)
 ├─ sky.update(clock)                (sun dir, colours, fog, grading uniforms)
 ├─ torch.update(dt)                 (fuel, radius, flicker, relight)
 ├─ sceneManager.update(player.pos)  (stream with a per-frame time budget)
 ├─ audio.update(listener, state)
 ├─ hud.update(); debug.update()
 └─ renderer.render()                (composer: scene → grade → output)
```

Physics runs at a fixed 60 Hz with an accumulator (max 4 steps per frame), so the
rope bridge and boulder behave the same at any frame rate.

## World and streaming

All scenes share one world coordinate space (−z is north). `layout.ts` describes the
interior zones as axis-aligned floor rectangles (plus ramps) with floor height and
ceiling height. From this one description we derive:

1. **Geometry and colliders**: floors, ceilings (Zone C everywhere, Zone B partially),
   and walls, generated on a 1 m grid wherever a floor cell borders a non-floor cell,
   then merged into long runs (few draw calls, few colliders).
2. **The navmesh**: each floor rectangle becomes a convex polygon. Shared edges become
   portals. Portals that cross a gate (door, seal, drawbridge, rubble) carry a gate id
   and are only traversable while the gate is open.
3. **Scene regions**: which scene the player is in and which scene owns each
   generated piece.

`SceneManager` keeps the current scene and its graph neighbours loaded. A scene's
`build()` is a generator that yields every few meshes; the manager resumes it until
its per-frame budget runs out, so scenes appear before you reach them without a hitch.
Unloading removes meshes and bodies and writes anything dynamic (loose items, pushed
blocks, broken planks) into `RunState`, which the next `build()` reads back.

Guardians do not need their scene loaded: they live on the global navmesh and only
use physics raycasts (line of sight) when they are near the player.

## Lighting model

* Sun: one `DirectionalLight` with a shadow camera that follows the player.
  When the player is deep in Zone C its shadow map stops updating and its intensity is
  zero (no shader recompiles: light counts never change).
* Moon / sky: a `HemisphereLight` for outdoor fill.
* Torch: one shadow-casting `PointLight` (cube shadow, far = torch radius).
* Sconces and world flames: a fixed pool of 6 non-shadow `PointLight`s assigned each
  frame to the nearest lit sconces. A fixed pool means a fixed shader light count.
* **Sky mask.** Every material comes from `materials.ts`, which patches the lighting
  chunk so directional light and ambient/hemisphere irradiance are multiplied by
  per-material uniforms. Zone C materials use 0 for both, so only point lights
  (flames) can light them. Fog turns black underground.
* Colour grading is a final shader pass (exposure, white balance, saturation,
  contrast, vignette) driven by `logic/clock.ts` keyframes. It is purely
  multiplicative, so black stays black. The low-time edge pulse is a HUD overlay.

## Physics

* Player: `KinematicCharacterController` with a capsule (shortened when crouching),
  autostep, snap-to-ground, max slope 50°. Pushes blocks by setting their velocity
  along the dominant axis of contact.
* Rope bridge: dynamic plank cuboids chained with spherical joints at both rope lines,
  anchored to fixed posts. A plank cracks on first contact and its joints are removed
  after a delay.
* Loot and props: dynamic bodies with their real mass. In hands they float to a
  target point with a velocity spring (gravity off), so they still collide.
* Traps: plates and pedestals use shape-intersection queries to sum the mass on them;
  boulders and debris are dynamic; blades are kinematic; darts are swept raycasts.

## Persistence

`localStorage` key `lost-temple-save-v1` stores `{ bank, upgrades, highScores,
settings, ghost }`. `logic/meta.ts` validates and migrates it, so a corrupt save is
replaced with defaults instead of crashing.

## Tests

`vitest` runs `tests/*.test.ts` against `logic/`: loot economy, trap triggers,
countdown thresholds, torch fuel and radius curve, scene unlock logic, guardian
state machines, and the navmesh (paths respect gates and walls).

A Playwright script (`scripts/playtest.mjs`) boots the built game in headless
Chromium, teleports through every scene, takes screenshots, samples frame times,
and checks that a Zone C frame with the torch out is pure black.

## Deviations from the first draft of this document

This file was written before the code. What changed while building:

* `core/config.ts` was never created; tuning numbers live next to the rule that uses
  them in `logic/*` (and are tested there).
* `vegetation.ts` and `water.ts` were merged into `world/nature.ts`.
* There is no `entities/Traps.ts`: each scene module builds and runs its own traps
  (`halls.ts` has the blades, `catacombs.ts` the boulder, crumbling floor and darts,
  and so on), with the shared projectile/debris code in `entities/Effects.ts`.
* `ui/ui.ts` became `ui/menus.ts`.
* Added `world/query.ts`, `world/terrain.ts`, `world/shafts.ts`, `entities/meshes.ts`.
* Vegetation instances live on render layer 1, which the torch's cube shadow camera
  does not see (the sun's shadow camera does). Without that, the torch shadow pass
  re-rendered every fern six times per frame.
* The torch shadow map refreshes every other frame (about 30 Hz), which is invisible
  with the flicker and halves the cost of the biggest shadow pass.
* The character controller does not push dynamic bodies itself
  (`setApplyImpulsesToDynamicBodies(false)`); the bridge applies the player's weight
  to the plank under them explicitly, and blocks are pushed by setting their velocity.
  The built-in impulses made the rope bridge oscillate and throw the player.
