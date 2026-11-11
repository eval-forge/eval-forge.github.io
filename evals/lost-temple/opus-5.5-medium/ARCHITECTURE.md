# The Lost Temple — Architecture

TypeScript + Vite. Three.js for rendering, Rapier (`@dimforge/rapier3d-compat`, WASM) for physics. No engine, no external assets: every mesh, texture and sound is generated in code.

```
src/
  main.ts                 bootstrap: init Rapier, create Game
  logic/                  PURE game rules, no three/rapier imports, unit tested
    rng.ts                seeded PRNG (mulberry32)
    relics.ts             relic catalogue, zone multipliers, weighted rarity picks
    economy.ts            satchel weight, speed/stamina factors, banking, shop prices
    countdown.ts          day timeline, sun path, phases, tick interval/volume
    torch.ts              fuel burn and radius curve, extinguish rules
    traps.ts              pressure plates, trapped-pedestal weight logic, crumble timers
    unlocks.ts            unlock flags and which scene transitions are allowed
    guardianFSM.ts        guardian state machine (pure transition function)
    sundial.ts            gnomon-shadow angle from the sun vector, puzzle check
  core/
    Game.ts               top-level state machine (menu/playing/paused/results), main loop
    Input.ts              keyboard, mouse, pointer lock, gamepad
    Physics.ts            Rapier world wrapper, fixed 60 Hz step, helpers
    Renderer.ts           WebGLRenderer, render target + colour-grading/vignette pass
    Save.ts               localStorage: settings, bank, upgrades, high scores, ghost
    Audio.ts              WebAudio synthesis: ambience, tick, rumble, creaks, guardians, music
  world/
    World.ts              owns scenes, streams them in/out by distance, runs per-scene updates
    SceneChunk.ts         base class: group + static body + dynamic entities, load()/unload()
    Sky.ts                sun direction light, sky dome shader, fog, grading per time & zone
    textures.ts           canvas-generated textures (stone, moss, wood, leaves, dirt, water)
    kit.ts                geometry/material helpers: box+collider, pillars, foliage instancing
    scenes/*.ts           jungle, courtyard, cliffs, halls, sanctum, catacombs, vault, tunnel
  entities/
    Player.ts             kinematic character controller: run/jump/crouch/climb/stamina/health
    Torch.ts              torch point light w/ shadow, flicker, fuel, relight animation, sconces
    Bridge.ts             jointed plank rope bridge with crack-and-drop planks
    Traps.ts              dart launchers, boulders, blades, crumbling tiles, pressure plates
    Loot.ts               relic meshes, pickup, pedestals, carryable props, throwing
    Guardians.ts          guardian agents: visuals, perception, nav path following
    Door.ts               great door (closing at dark), gates, seal, levers
  nav/NavGraph.ts         baked multi-level walkable grid (raycast bake), A*, path smoothing
  ui/
    HUD.ts                sundial clock, stamina, weight, fuel, loot, prompts, edge pulse
    Menus.ts              main / pause / settings / results / shop / high scores
    MapView.ts            hand-drawn map that fills in as you explore
    Debug.ts              FPS, physics bodies, scene, ambient check
  ghost/Ghost.ts          record + replay best run
tests/                    vitest unit tests for logic/
```

## Main loop

`Game.frame()` → input → fixed-step physics (accumulator, 1/60 s, max 4 steps) → `Player.update` → `World.update` (streaming, scene updates, traps, bridges) → `Guardians.update` → `Sky.update(time, zone)` → `Torch.update` → audio → HUD → render.

## Streaming

All scenes live in one continuous world (no teleports). Each `SceneChunk` has an AABB. Each frame (throttled to 4 Hz), chunks whose AABB is within 45 m of the player, plus their declared neighbours, are loaded and everything else is unloaded. Loading adds its `THREE.Group` to the scene and creates its Rapier bodies from stored descriptors. Unloading removes both and saves dynamic state (block positions, which planks fell). Build cost is paid once at startup during the menu (meshes are cached), so in-run loads are just attach/detach and are cheap.

At startup every chunk is loaded once so the nav graph can be baked by raycasting the real colliders, then streaming takes over.

## Lighting rules

- `Sky` owns the sun (`DirectionalLight` with a shadow camera that follows the player), a hemisphere light and the sky dome.
- Each chunk declares its zone. `Sky` computes an exposure factor from the player position: zones A/B = 1, zone C = 0, interpolated only on the stair between sanctum and catacombs.
- In zone C: sun, hemisphere and ambient intensities are set to exactly 0, fog and clear colour are black and no material is emissive. The torch and placed sconces are the only lights. `Debug` shows the summed non-torch light intensity so this can be checked.
- A fixed pool of 4 sconce point lights is pre-allocated so placing torches never triggers shader recompiles.

## Guardians and navigation

`NavGraph` is baked once by scanning each column of a 1 m grid inside each chunk's nav regions with repeated hollow downward raycasts, so every upward-facing surface in the column (ground, stairs, lower levels under ceilings) is a candidate. Walkable cells with 1.7 m headroom and wall clearance become nodes. Neighbours connect if the height step is ≤ 1.25 m (steep stairs at 1 m cells) and no wall ray hits between them. A* with an octile heuristic, then line-of-sight string pulling. Doors and gates toggle node blocking at runtime. Guardians are kinematic agents moved along nav paths (no physics bodies), so they keep working in unloaded chunks and are just hidden there.

## Testability

Everything with rules lives in `src/logic/` as pure functions or small classes without rendering dependencies. Entities call into them, and tests cover them directly.
