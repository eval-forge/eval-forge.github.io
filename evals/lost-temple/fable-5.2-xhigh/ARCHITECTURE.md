# The Lost Temple — Architecture

> Written before any code, as the plan to build against. Deviations are listed
> in `SELF_REVIEW.md`.

## Stack

| Concern    | Choice                                                            |
|------------|-------------------------------------------------------------------|
| Language   | TypeScript (strict)                                               |
| Build/dev  | Vite (`npm run dev`, `npm run build`)                             |
| Rendering  | Three.js (WebGL2 renderer, one custom post pass)                  |
| Physics    | Rapier 3D (`@dimforge/rapier3d-compat`, WASM inlined)             |
| Tests      | Vitest (node environment, no browser needed)                      |
| UI         | Plain DOM + CSS over the canvas; one 2D canvas for the sundial and one for the map |
| Audio      | WebAudio, every sound synthesised                                 |
| Assets     | None on disk. Geometry, canvas textures, shaders and sound are all generated in code |

No game engine. No external models, images or audio.

## Layering

```
src/
  core/      pure game rules. No three, no rapier, no DOM. Everything here is unit-tested.
  engine/    thin wrappers over three / rapier / WebAudio / input devices.
  world/     level data and level construction (layout = pure data, scenes = builders, entities = live objects).
  game/      the run: player, torch, guardians, interaction, orchestration.
  ui/        HUD, menus, shop, map, debug overlay.
  main.ts    boot.
tests/       vitest suites for core/ and the pure layout data.
```

The rule that keeps this testable: **decisions live in `core/`, effects live
everywhere else.** A trap's "should I fire?" is a pure class in `core/traps.ts`;
the entity in `world/entities` only feeds it inputs (mass on the plate, dt) and
plays the consequences (spawn darts, play sound).

### `core/` (pure)

| Module          | Responsibility                                                                 |
|-----------------|---------------------------------------------------------------------------------|
| `rng.ts`        | Seeded PRNG (mulberry32), value noise, helpers                                  |
| `clock.ts`      | `DayClock`: time left, phase, tick interval/volume, one-shot threshold events, door closing |
| `sun.ts`        | Sun direction for a day fraction, light/sky/grade keyframes, sundial shadow angle |
| `economy.ts`    | Relic table, depth multipliers, loot roll, `Satchel`, load curves, shop catalogue |
| `torch.ts`      | `TorchModel`: fuel, radius/intensity curve, lit / out / relighting state machine |
| `traps.ts`      | `PedestalSensor`, `PressurePlate`, `CrackTimer`, `DartTrigger`, `NoiseMeter`, `PendulumClock` |
| `unlock.ts`     | Scene graph, edge requirements, reachability, progression solver                |
| `navmesh.ts`    | Rect navmesh: carving, portals, gates, A*, funnel, point location               |
| `guardianFsm.ts`| The three guardian brains as pure state machines over a `Percepts` struct       |
| `noise.ts`      | Loudness table for player/prop sound events                                     |
| `save.ts`       | Meta progression (coins, gear, scores, settings, ghost) over a storage interface|
| `ghost.ts`      | Run path recorder / sampler                                                     |

### `engine/`

| Module          | Responsibility                                                                 |
|-----------------|---------------------------------------------------------------------------------|
| `renderer.ts`   | WebGLRenderer, HDR target + grade pass (exposure, tint, saturation, vignette, danger pulse, tone map), quality presets |
| `physics.ts`    | Rapier world, fixed-step, collision groups, ray/shape queries, collider → entity registry, contact events |
| `input.ts`      | Keyboard, mouse (pointer lock), gamepad → one `Actions` snapshot per frame      |
| `audio.ts`      | AudioContext graph, synthesised one-shots and loops, positional helpers, music  |
| `textures.ts`   | Canvas-generated albedo/normal/roughness textures                               |
| `materials.ts`  | Material library. Each surface exists as an *outdoor* and a *dungeon* variant   |
| `sky.ts`        | Sky dome shader (gradient, sun, moon, stars, clouds)                            |
| `lighting.ts`   | Sun light + shadow frustum follow, hemisphere, torch light, fixed sconce-light pool, per-zone exposure |
| `particles.ts`  | One pooled point-sprite system (dust, sparks, splashes, embers)                 |

### `world/`

- `layout/*.ts` — **pure data per scene**: walkable floor rects and ramps (with
  material tags), nav obstacles, gates, relic spots, guardian spawns, sweep
  waypoints, bounds, kill planes. Imported by tests and by the builders.
- `kit.ts` — `SceneKit`, the builder API scenes are written in: `floor`, `wall`,
  `box`, `ramp`, `pillar`, `roof`, `vine`, `water`, `sconce`, `relic`,
  `pedestal`, `plate`, `block`, `blade`, `darts`, `boulder`, `crumble`,
  `bridge`, `prop`, `trigger`… Static boxes are batched: one merged mesh per
  material and one fixed body with many colliders per scene.
- `scenes/*.ts` — one builder per scene, written as a generator
  (`*build(kit)`) that yields between chunks so construction is time-sliced.
- `entities/*.ts` — live objects with `update(dt)`, optional `interact()`,
  `save()` and `dispose()`.
- `sceneManager.ts` — streaming (below).

### `game/`

- `game.ts` — top-level state machine: `menu → playing ⇄ paused → results`.
  Owns the `Run` (clock, satchel, torch, flags, per-scene state, RNG seed).
- `player.ts` — character controller, stamina/health, crouch, climb, mantle,
  water, carrying.
- `guardians.ts` — guardian agents: FSM + nav agent + procedural mesh + voice.
- `interact.ts` — camera ray → entity → prompt / action.
- `torchRig.ts` — hand torch mesh, flame, ties `TorchModel` to the light.

## Frame loop

```
frame(dtReal):
  input.poll()
  if playing:
    accumulator += dtReal (clamped)
    while accumulator >= 1/60:            # fixed step
      clock.advance(h)                    # emits threshold events
      player.fixedUpdate(h)               # KCC move, stamina, climbing, water
      entities.fixedUpdate(h)             # traps, bridges, doors
      guardians.fixedUpdate(h)            # percepts → FSM → nav steering
      physics.step(h)                     # Rapier
      physics.drainEvents()               # impacts → noise, damage
    sceneManager.update(player.position)  # streaming, time-sliced builds
    lighting.update(clock, zone, torch)   # sun, shadows, torch flicker, sconce pool
    audio.update(listener, clock, threat)
  renderer.render(scene, camera, gradeParams)
  hud.update() / debug.update()
```

Rendering interpolates nothing fancy: the camera reads the post-step player
position; at 60 Hz physics and 60 Hz display this is one-to-one.

## Scene streaming

- All seven scenes share one world coordinate space and meet at doorways and
  corridors, so walking between them is the transition.
- The manager finds the scene whose bounds contain the player, then wants that
  scene plus its graph neighbours loaded. Anything else is unloaded after a
  short hysteresis.
- Loading runs the scene's generator for at most a few milliseconds per frame.
  If the player somehow arrives before it is finished, it is completed
  synchronously (never observed in normal play; neighbours finish long before
  you can walk to them).
- Unloading calls `save()` on entities (block positions, broken planks, taken
  relics, lit sconces go into `run.sceneState[id]`), then removes meshes,
  bodies and colliders. Materials and textures are global and never rebuilt.
- **The navmesh is not streamed.** It is built once per run from the pure
  layouts of all scenes, so guardians keep moving through scenes that are not
  loaded. Guardians are kinematic agents, not dynamic bodies.

## Lighting model and the Zone C guarantee

Lights in the scene are constant in number so shaders never recompile mid-run:
1 directional (sun, later moon) with a 2048 shadow map that follows the player,
1 hemisphere, 1 shadow-casting point light (torch), and a fixed pool of sconce
point lights assigned to the nearest lit sconces.

Three.js lights are global, so "no sunlight underground" cannot be done by
placement alone. Instead `materials.ts` builds every dungeon material with an
`onBeforeCompile` patch that rewrites `lights_fragment_begin`: the directional
and hemisphere loops are compiled out and ambient irradiance is forced to
zero. A dungeon surface can only ever be lit by point lights. On top of that,
when the player is in Zone C the sky dome is hidden, the clear colour and fog
are black, the grade pass applies no lift, and nothing in Zone C uses
`emissive`. A debug hook (`__lt.darknessProbe()`) renders the current view with
the torch forced off and reports the brightest pixel, which is how the
SELF_REVIEW claim is checked.

Zone B gets its moving light shafts for free from real roof geometry casting
real shadows; additive "shaft" prisms sheared along the sun direction sell the
volume. Gameplay asks the same question the renderer does: `isSunlit(p)` is a
Rapier ray from `p` toward the sun.

## Navigation

`core/navmesh.ts` takes the layouts' floor rects (flat or sloped), subtracts
obstacle footprints grown by the agent radius, finds shared-edge portals
(height-matched), and tags gate rects. Queries: nearest rect, A* over rects
through portal midpoints, then the funnel algorithm over the portal chain with
portals shrunk by the agent radius. Gates are toggled by door state. Guardians
replan a few times per second and steer along the corridor.

## Data flow for a relic pickup (example)

```
E pressed → interact ray hits pedestal collider → PedestalEntity.interact()
  → run.satchel.add(relic)            (core/economy: capacity check, weight, value)
  → sensor.onWeight(newMass)          (core/traps: tolerance + grace)
      → fired? entity triggers linked trap entity (darts / boulder / collapse)
  → run.sceneState.taken.add(spotId)
  → events: 'noise' (crawlers), 'relicTaken' (HUD toast, audio chime)
```

A small typed event bus (`game/events.ts`) carries cross-cutting events:
`noise`, `damage`, `relicTaken`, `flag`, `toast`, `clock:*`.

## Persistence

`core/save.ts` serialises one JSON blob under `lostTemple.v1` in localStorage:
`{ coins, gear, settings, scores[10], ghost }`. It is written through a
`StorageLike` interface so tests use an in-memory fake.

## Performance budget (target: 60 FPS, shadows on, mid-range laptop)

| Budget item              | Plan                                                             |
|--------------------------|------------------------------------------------------------------|
| Draw calls               | < 250 visible; static geometry merged per material per scene; vegetation and scarabs instanced |
| Triangles                | < 400 k in view                                                  |
| Shadow passes            | 1 × 2048 sun map; torch cube map 512 only while lit; sconces cast none |
| Physics                  | < 600 bodies awake-capable; static world is one fixed body per scene; sleeping enabled |
| Shader stability         | constant light counts, materials created once, warm-up compile on the menu |
| GC                       | scratch vectors reused in hot loops; pooled particles and darts  |
| Quality presets          | low / medium / high: shadow map size, torch shadows, pixel ratio cap, vegetation density |

## Testing

`npm test` runs Vitest on `core/` and the layouts:

- economy: values by depth, satchel capacity, load curves, loot roll by zone
- traps: pedestal weight swap, plates, crack timers, dart trigger, noise meter
- clock: thresholds, tick curve, one-shot events, door window
- torch: fuel burn, radius curve, extinguish/relight state machine
- unlock: reachability per flag set, full-progression solver
- guardians: every transition of the three state machines
- navmesh: carving, portals, gates, A*, funnel; the real layouts connect the
  lair to the great door

Browser-level checks (traversal, darkness probe, frame timing) are scripted
with Playwright through a `window.__lt` debug API and reported in
`SELF_REVIEW.md`; they are not part of `npm test`.

## As built

This document was written before the code. Where the code ended up somewhere
else:

- **`game/interact.ts` and `game/events.ts` do not exist.** The camera ray,
  prompts, toasts, damage and flag plumbing live in `game/game.ts`. There is a
  `game/run.ts` (the per-run state bag) and a `game/debugApi.ts` (`window.__lt`)
  that the plan did not list.
- **Draw calls are well over the 250 budget.** Static geometry is batched per
  material and per spatial cell as planned, but entities, the sun shadow pass
  and the torch's six cube faces bring a typical frame to 200 to 700 calls and
  the worst one (courtyard at night, all guardians out) to about 1,000. The
  torch therefore casts shadows only where the sky does not: underground, on
  the stairs down, and in the roofless halls after dark.
- **Darts are swept ray-marched projectiles**, not pooled rigid bodies.
- **The navmesh is static.** Gates open and close portals; pushed blocks, the
  resting boulder and fallen debris are not carved.
- **Rapier's character controller collides with disabled colliders**, so
  anything that "breaks" (planks, crumbled tiles) also drops its collision
  groups.
- **The same controller stalls on kinematic floors** (it runs a separate
  moving-platform path there), so the drawbridge deck switches from kinematic
  to fixed the moment it is down.
- **Half-built scenes are disposed**, not kept: when the scene being built
  falls out of the wanted set, or a run restarts, its partial meshes and bodies
  are thrown away.
- **Quality presets cap the device pixel ratio** (0.8 / 1 / 1.5) rather than
  scale it, and the default preset is medium.
- **Frame loop:** the simulation step is clamped to 0.1 s per frame, the FPS
  counter is fed the real interval.

`SELF_REVIEW.md` has the measured numbers and the list of known problems.
