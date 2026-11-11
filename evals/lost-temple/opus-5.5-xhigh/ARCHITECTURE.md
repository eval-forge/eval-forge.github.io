# The Lost Temple: Architecture

TypeScript + Vite. Three.js renders, Rapier (`@dimforge/rapier3d-compat`, WASM inlined)
simulates. No engine, no external assets: every mesh, texture and sound is generated
at runtime.

## Layers

```
src/
├── main.ts                 boot: init Rapier WASM, create Game, wire UI
├── core/                   tiny shared utilities (no Three, no Rapier)
│   ├── config.ts           every tuning number in one place
│   ├── rng.ts              seeded PRNG (mulberry32) + weighted pick
│   └── events.ts           typed event bus (noise, toast, trap, gate, ...)
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
│   ├── textures.ts         procedural canvas textures (+ normal maps from height)
│   ├── physics.ts          Rapier world, body registry (owner scene, kind, data), queries
│   ├── input.ts            keyboard, mouse, pointer lock, gamepad → one action state
│   └── audio.ts            WebAudio graph, procedural sfx, ambience, music, 3D panners
├── world/
│   ├── layout.ts           THE level: floor polygons, regions, gates, sconces, relic slots,
│   │                       traps, for all 7 scenes in one world coordinate space
│   ├── build.ts            builders: floors, auto-walls from the floor grid, ceilings,
│   │                       ramps, props; returns meshes + colliders tagged by scene
│   ├── SceneManager.ts     streaming: decides the loaded set, runs scene builders as
│   │                       time-sliced generators (≈4 ms/frame), unloads + saves state
│   ├── sky.ts              sky dome shader, sun + moon lights, fog, grading keyframes
│   ├── vegetation.ts       instanced trees, palms, ferns, grass, vines
│   ├── water.ts            animated water surface material + volumes
│   └── scenes/             one module per scene: build(ctx) generator + update(dt)
│       ├── jungle.ts  courtyard.ts  cliffs.ts
│       ├── halls.ts   sanctum.ts
│       └── catacombs.ts  vault.ts
├── entities/
│   ├── Player.ts           Rapier kinematic character controller, run/crouch/jump,
│   │                       stamina, health, vines, mantling, swimming, fall damage
│   ├── Torch.ts            held torch mesh, flame shader, point light w/ shadows, sconces
│   ├── Items.ts            loot + props as rigid bodies, satchel, hands (grab/carry/throw)
│   ├── Interactables.ts    doors, seals, levers, sundial, plates, pedestals, kick-wall
│   ├── Traps.ts            darts, blades, boulder, crumbling floor, sanctum debris, sun-stones
│   ├── Bridge.ts           jointed rope bridge
│   └── Guardians.ts        guardian bodies, animation, perception → brain → navmesh steering
├── game/
│   ├── Game.ts             owns everything; fixed-step physics loop; run lifecycle
│   └── RunState.ts         per-run persistent state (flags, taken slots, stash, carried)
└── ui/
    ├── ui.ts               menus (main, pause, settings, shop, scores, results), toasts
    ├── hud.ts              HUD DOM + the stone sundial clock (canvas)
    ├── mapview.ts          hand-drawn map that fills in as you explore
    └── debug.ts            debug overlay (FPS, bodies, scene, guardians), time warp
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
 │    ├─ traps.fixedUpdate           (darts, blades, boulder, crumble, debris)
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
