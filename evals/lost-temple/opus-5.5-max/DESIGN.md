# The Lost Temple: design

A first-person relic heist against the clock. You arrive at dawn, work inward and downward through a ruined temple, and try to carry out as much loot as you can before darkness. At darkness the guardians wake and the great door starts to close.

This document is the design contract. `ARCHITECTURE.md` describes how the code is laid out. Numbers here are the starting tuning values; the code keeps them in one place (`src/logic/*` and `src/config.ts`) so they match.

---

## 1. Core loop

**Inside one run (about 13 to 15 minutes):**

1. **Approach.** Cross the jungle, the river and the gorge (collapsing rope bridge, or the slow fallen-tree detour).
2. **Open the temple.** Push a stone block onto one pressure plate and stand on (or block) the other to raise the great door. Solve the sundial to win the Sun-Disc.
3. **Go deeper.** Every zone is more dangerous and pays more. Each descent needs something from the zone above (Sun-Disc opens the catacomb seal, Serpent Key opens the vault).
4. **Grab loot.** Relics have value and weight. Weight slows you and burns stamina. Some relics sit on weighted pedestals: lift them without a counterweight and the trap fires.
5. **Bank or push on.** Loot only counts once it has been carried out through the great door (it is dropped into the haul cart outside). You may make several trips.
6. **Watch the sundial.** The HUD sundial is the only clock. In the last two minutes the ticking speeds up; at 60 seconds the edges of the screen pulse, the music turns and the temple rumbles.
7. **Darkness.** At zero, the guardians wake deepest first and sweep toward the door, and the door begins a 90 second close. Get out, or lose everything you are carrying.

**Between runs:** results screen, high-score table, then a shop where banked money buys gear (bigger satchel, better torch, more fuel, rope, boots, spares). Progress is saved to `localStorage`.

**The tension:** greed against the clock, light against stealth. Your torch is the only light underground, but light draws guardians. Every relic slows you down on the way out.

---

## 2. World and scene graph

Seven scenes in three zones, all in one continuous world space. Scenes are streamed in and out around the player (current scene plus its neighbours), with no loading screen after the run starts. Scene builds are time-sliced across frames so the next room is ready before you reach its doorway.

```
                         (north, -Z)

   Zone C  y=-24   [ Guardians' Lair ]==portcullis (opens at darkness, or early if you wake the sleepers)==[ DEEP VAULT ]
                                                                        |  vault door (Serpent Key)
                                                                        |  aqueduct gate (crank, escape route)
   Zone C  y=-14                     [ LOWER CATACOMBS ] <--------------+
                                      |  west: entry from seal stairs
                                      |  east: escape wing, Bone Wall (kick down) ----+
                                      |                                               |
   Zone B  y=1      [ COLLAPSED SANCTUM ]--seal (Sun-Disc)--stairs down                |
                          |  main nave (blocked by rubble after the idol collapse)     |
                          |  side aisle (crumbling floor)                              |
                    [ BROKEN HALLS ] <---------- Bone Stair (shortcut) ----------------+
                          |  chasm: sunstone tiles (sunlit only) or blade ledge
                          |  drawbridge (lowered from the inner side = shortcut)
                          |  great door (pressure plates; closes at darkness)
   Zone A  y=0      [ TEMPLE COURTYARD ]------east path------[ OUTER CLIFFS ] (optional)
                          |  sundial puzzle -> Sun-Disc           vines, ledges, wind,
                          |  haul cart (banking)                  Eagle's Nest (needs rope)
                    [ JUNGLE APPROACH ]
                          river crossing, gorge (rope bridge / fallen tree)
                         (south, +Z)  start at dawn
```

### Unlock dependencies

| Scene | Zone | Entered from | Requirement | Found here |
|---|---|---|---|---|
| Jungle approach | A | start | none | commons, the gorge |
| Temple courtyard | A | jungle | cross the gorge (bridge or fallen tree) | Sun-Disc (sundial), haul cart, great door plates |
| Outer cliffs | A | courtyard | none (optional). Eagle's Nest needs 1 rope | high-value relics in the open |
| Broken halls | B | courtyard | `greatDoorOpen` (two pressure plates loaded) | drawbridge lever, Bone Stair exit |
| Collapsed sanctum | B | halls | cross the chasm (sunlit sunstone tiles, blade ledge, or lowered drawbridge) | Sun Idol (main idol), catacomb seal |
| Lower catacombs | C | sanctum | `sealOpen` (needs Sun-Disc) | Serpent Key (flooded chamber), Bone Wall |
| Deep vault | C | catacombs | `vaultDoorOpen` (needs Serpent Key) | richest loot, Heart of the Temple, aqueduct gate |

### Shortcuts (open once you have used them)

| Shortcut | How it opens | What it saves |
|---|---|---|
| Drawbridge | Pull the lever on the inner side of the chasm | Entrance hall to inner halls without the sunstone tiles or the blades |
| Bone Wall | Kick the cracked wall from the catacomb side (three kicks) | Catacombs east wing straight up the Bone Stair into the inner halls |
| Aqueduct gate | Crank it open from inside the vault | Vault to catacombs east wing, the escape route |

### The escape route is its own path

**Way in:** door, entrance hall, chasm (tiles or blade ledge), inner halls, sanctum, seal stairs, catacombs west, flooded chamber, dart corridor, vault ramp, vault door.

**Way out:** vault, aqueduct gate (crank, noisy), aqueduct incline (rolling boulder), catacombs east wing, Bone Wall (kick), Bone Stair, inner halls, drawbridge (lower it), entrance hall, great door. It shares only the last two rooms with the way in.

### Scene details

**Jungle approach (A).** Dense instanced trees, ferns and grass on a noise-shaped terrain. A river crossing with stepping stones, a fallen log and a current that pushes you downstream when wading. The gorge is crossed by a rope bridge of jointed planks that crack and fall about half a second after you step on them. Falling in means the river carries you back to the south rim (damage, lost time, torch out). A slow fallen-tree crossing further west is the fallback.

**Temple courtyard (A).** Overgrown plazas, toppled pillar drums (some loose and pushable), the great door in a 20 m facade, two pressure plates in front of it, two pushable stone blocks, the haul cart, and the sundial. Sundial puzzle: rotate the dial ring (30 degree steps) until the Eye glyph sits under the real shadow of the gnomon, computed from the actual sun direction. Because the sun moves, the right answer changes during the day. The dial only counts once a hand has turned the ring (the shadow drifting over the Eye on its own does nothing, but setting the Eye ahead of the shadow and waiting does). Solving it raises the Sun-Disc.

**Outer cliffs (A, optional).** A cliff face above a 60 m drop. Ledges you mantle onto, vines you climb, wind gusts that shove you and can blow out a torch. Rare relics sit in the open on ledges. The Eagle's Nest at the top needs a rope (shop item) thrown over its beam.

**Broken halls (B).** The roof has caved in, so the real sun throws moving shafts of light across the floor. The chasm room is crossed on sunstone tiles that are solid only while the sun hits them (tested by raycasting from each tile toward the sun through the broken roof), or along a narrow ledge past swinging blades. The drawbridge lever is on the far side. At darkness the temple drops the drawbridge itself so its guardians can reach the great door. A sealed niche on the inner side is the top of the Bone Stair.

**Collapsed sanctum (B).** The west half of the ceiling is gone; the east half is cracked and unstable. Noise (running, landings, thrown objects, traps) builds strain on nearby ceiling sections; past a threshold a section creaks, drops dust, then collapses into falling rock bodies. The Sun Idol sits on a weighted altar under a beam of light. Taking it starts the collapse sequence (stretch goal): the remaining ceiling falls over about 20 seconds and rubble blocks the main nave, so you leave by the side aisle or downward. The catacomb seal (Sun-Disc socket) in the sanctum floor slides aside and opens a long, steep stair that runs south under the sanctum down to Zone C. While it is shut it is just part of the floor.

**Lower catacombs (C).** No sky at all. Narrow bone-lined corridors, crumbling floor tiles over a spike pit, a dart corridor with pressure plates, and a flooded chamber whose deep channel puts your torch out (the Serpent Key is on an island beyond it: cross the short plank bridge at the west end before it drops, or swim the channel, climb out and relight on dry stone, or push a stone block into the channel as a stepping stone). The east wing holds the cracked Bone Wall and the top of the aqueduct.

**Deep vault (C).** Reached by a long ramp past more darts. The vault door needs the Serpent Key. Inside: the heaviest, richest relics, trapped pedestals, swinging blades around the inner dais, the Heart of the Temple, dormant guardian statues along the walls, and a portcullis into the guardians' lair. The aqueduct gate (escape route) is cranked open from inside.

---

## 3. Physics

All on Rapier. The player is a kinematic character controller (capsule); everything else is real rigid bodies.

| Element | Implementation |
|---|---|
| Rope bridge | Chain of 22 plank bodies joined by pairs of spherical joints (one per rope side), anchored at the lips of the two rims. The player's weight plus load is applied as a force on the plank underfoot, so the bridge sags more when you carry more. A stepped-on plank cracks, shakes, and after `0.55 s x (1 - 0.4 x load fraction)` its collider is dropped and a free falling plank body replaces it while the rope node stays, so the rest of the bridge keeps hanging. |
| Plank bridge | Short catacomb version over the flooded chamber's deep channel: six planks on short ropes between two stone piers, same crack-and-drop rule. Keep walking and you reach the far pier with the torch still lit; stop on it and it drops you into the channel, torch and all. |
| Crumbling floor | Fixed tiles that crack on contact (player or heavy prop) and become dynamic after 0.8 s. |
| Rolling boulder | 1.4 m dynamic sphere (3000 kg) released by a pressure plate on the aqueduct incline. Crushes on contact above 3 m/s. |
| Pressure plates | Sensor volumes that sum the mass of resting dynamic bodies plus the player (body mass 75 kg plus carried load). Hysteresis so they do not chatter. |
| Swinging blades | Kinematic pendulums driven by `angle = A sin(wt + phase)`; they knock props around and hurt the player on contact. The blades over the halls ledge swing at chest height, so you time them; the ones around the vault dais swing at head height, so you crouch under them. |
| Dart traps | Wall emitters shoot small CCD-enabled dynamic darts (24 m/s, low gravity) that stick where they hit. 20 damage each. A floor plate fires one volley across itself from emitters 0.35 m either side of its centre line and then rests for 2.2 s, so standing on one costs three or four darts and walking over one costs one or two. Pedestal traps and tripwires fire two volleys. |
| Push blocks | Heavy dynamic boxes with locked rotation; the player pushes them by walking into them (force scaled by player strength). |
| Weighted pedestals | Sensor measures the mass resting on top. Lifting the relic drops the mass; if the remaining mass differs from the armed mass by more than 20% for 0.3 s, the trap fires. Swap in something of similar weight to stay safe. |
| Loot weight | Satchel weight slows walking (down to 55% when full), lowers jumps, and multiplies stamina drain by `1 + 1.2 x load fraction`. |
| Debris | Falling ceiling rocks are dynamic bodies; they hurt on impact speed and settle into obstacles. |

---

## 4. Sun, time and lighting

- **Day length:** 780 s (13 minutes) from dawn to darkness. The door then takes 90 s to close, so a full run lasts up to 14.5 minutes.
- **Sun path:** angle `theta` runs from `0.05 pi` (just after dawn, east) to `1.079 pi` (darkness, below the western horizon). Direction is `(cos theta, sin theta cos 25deg, sin theta sin 25deg)`, so the sun crosses the southern sky and peaks at 65 degrees. Sunset (`theta = pi`) lands exactly at 60 seconds remaining.
- **Shadows:** one directional light with a shadow frustum that follows the player (texel-snapped to avoid shimmer).
- **Where sun reaches:** Zones A and B only. In Zone B it enters through roof holes and cracks, so the lit areas move during the day. Zone C has no sky, no sun, no fill light.
- **Grading by phase:** dawn (cool shadows, pink highlights), morning, noon (neutral and bright), afternoon (warm), sunset (red-orange, high contrast), dusk, night (blue, dark). Done in one post-processing pass with exposure, contrast, saturation, split toning and vignette. Lift is never applied, so black stays black.

| Phase | Day fraction |
|---|---|
| Dawn | 0.00 to 0.08 |
| Morning | 0.08 to 0.40 |
| Noon | 0.40 to 0.60 |
| Afternoon | 0.60 to 0.85 |
| Sunset | 0.85 to 0.95 |
| Dusk | 0.95 to 1.00 |
| Night | after 1.00 |

---

## 5. Ticking clock

- **HUD sundial:** a stone dial drawn on a canvas. A gnomon shadow sweeps with the real sun, a red wedge marks darkness, and the remaining time is carved underneath (mm:ss).
- **Ticks:** one tick per second at low volume. In the last 120 s the interval shrinks from 1.0 s to 0.33 s and the volume rises from 0.35 to 1.0.
- **60 s left:** screen edges pulse red (faster as time runs out), the music switches to its tense layer, a big rumble shakes the camera, and dust falls in the ruins.
- **0 s (darkness):** night grading, guardians start waking (deepest first), the great door starts closing (90 s). When it shuts, anyone inside is entombed and the run is lost.
- **Underground:** no sky in Zone C, so the HUD dial and the sounds are the only clocks.

---

## 6. Torch

| Property | Base | Notes |
|---|---|---|
| Fuel capacity | 100 units | upgrades +40% and +80% |
| Burn rate | 1 unit / 3 s | about 5 minutes per full torch |
| Max radius | 11 m | upgrades +25% and +50% |
| Min radius | 2.5 m | just before the fuel runs out |
| Radius curve | full above 45% fuel, then `rMin + (rMax - rMin) x (1 - (1 - f/0.45)^2)` | at 0 fuel the torch dies |
| Relight | 2.2 s | cannot sprint, jump or grab while relighting; needs fuel |
| Blown out by | water above torch height, wind gusts (chance scales with gust strength and 1 - gust resistance), landings above 9 m/s | |
| Spare torches | start with 1, two more to find | lighting a spare gives a full torch. Spares lie by the sanctum's west wall, near its sconce, and at the foot of the seal stairs. |
| Oil flasks | start with 1, three more to find | +50 fuel each. Flasks lie in the broken halls, the ossuary and the vault antechamber. |
| Sconces | place a spare torch in any wall sconce | burns 6 minutes, radius 7 m, relight your own torch from it instantly |

The torch is a point light with real cube shadows and a flicker made of layered noise. In Zone C, nothing else emits light: no emissive materials, no ambient or hemisphere light, black background and black fog. Outside the torch radius the frame is true black (checked by an automated pixel readback test).

---

## 7. Relics and economy

### Relic table

| # | Relic | Base value | Weight (kg) | Rarity | Spawns in |
|---|---|---|---|---|---|
| 1 | Clay Votive Idol | 60 | 1.5 | Common | A, B |
| 2 | Bronze Coin Pouch | 90 | 2.0 | Common | A, B, C |
| 3 | Carved Scroll Case | 110 | 1.0 | Common | A, B |
| 4 | Jade Figurine | 220 | 1.2 | Uncommon | A, B, C |
| 5 | Silver Chalice | 240 | 1.8 | Uncommon | A, B |
| 6 | Obsidian Dagger | 180 | 0.8 | Uncommon | B, C |
| 7 | Sun Tablet | 320 | 7.5 | Uncommon | B, C |
| 8 | Serpent Bracelet | 380 | 0.4 | Uncommon | B, C |
| 9 | Gold-Leaf Mask | 420 | 2.5 | Uncommon | B, C |
| 10 | Golden Scarab | 520 | 0.6 | Rare | B, C |
| 11 | Gem-Studded Urn | 640 | 6.0 | Rare | B, C |
| 12 | Feathered Crown | 760 | 2.2 | Rare | A (cliffs), C |
| 13 | Moon Mirror | 820 | 3.5 | Rare | C |
| 14 | Gold Ingot | 900 | 12.0 | Rare | C |
| 15 | Golden Skull | 1100 | 4.5 | Rare | C |
| 16 | Emerald Eye | 1400 | 0.3 | Legendary | C |
| 17 | Condor Statuette | 1500 | 9.0 | Legendary | A (Eagle's Nest), C |
| 18 | Sun Idol (main idol) | 2400 | 8.0 | Unique | B (sanctum altar) |
| 19 | Heart of the Temple | 4000 | 15.0 | Unique | C (vault dais) |

**Value of one relic** = `base x zone multiplier x condition`, where condition is rolled per run between 0.85 and 1.15, and the zone multiplier is **A x1.0, B x1.6, C x2.5**. The same relic type is worth more the deeper you find it.

Rarity weights for random spawn points: Common 50, Uncommon 30, Rare 15, Legendary 5 (only types allowed in that zone are rolled). Fixed spawns (Sun Idol, Heart, Eagle's Nest condor) are always the same type.

### Loot value by zone (expected, average condition)

| Zone | Scenes | Spawn points | Expected total | Best single grab |
|---|---|---|---|---|
| A, outside | jungle 3, courtyard 5, cliffs 6 | 14 | about 4,500 (of which cliffs about 3,300) | Condor Statuette 1,500 |
| B, ruins | halls 8, sanctum 6 + Sun Idol | 15 | about 12,000 | Sun Idol 3,840 |
| C, dungeon | catacombs 9, vault 11 + Heart | 21 | about 45,000 | Heart of the Temple 10,000 |

With a 20 kg starting satchel you cannot take everything from even one room in the vault, which is the point: pick by value per kilogram, or come back with a bigger satchel.

### Banking and losing

- Carried loot shows on the HUD as **Carried**; loot dropped into the haul cart outside the door is **Banked**.
- Escaping (door closes with you outside, or you choose to leave at the cart): banked loot is your haul.
- Caught by a guardian, killed by a trap, or entombed: the run is lost and everything you carry is gone. Loot already banked is kept, because it already left the temple.

### Shop (between runs, paid from banked hauls)

| Item | Levels and prices | Effect |
|---|---|---|
| Satchel | 1,500 / 4,000 / 9,000 | capacity 20 to 30 / 42 / 56 kg |
| Torch | 1,200 / 4,500 | radius +25% / +50%, gust resistance 30% / 60% |
| Fuel reservoir | 1,000 / 3,000 | fuel capacity +40% / +80% |
| Rope coils | 700 / 1,800 / 3,500 | carry 1 / 2 / 3 ropes per run |
| Boots | 2,000 / 5,000 | stamina +25% / +50% |
| Spare torches | 600 / 1,600 | start with +1 / +2 spare torches |
| Oil flasks | 500 / 1,400 | start with +1 / +2 flasks |

---

## 8. Guardians

They wake at darkness, deepest first, and sweep outward toward the door along the navmesh. Catching you ends the run.

| Type | Movement | Senses | Behaviour |
|---|---|---|---|
| Stone Sentinel | slow: 1.7 m/s sweep, 2.9 m/s chase | sight, boosted by your light: range `9 + 2.2 x torch radius` (max 35 m) in a 120 degree cone with line of sight; hears only loud noise | Dormant, Waking, Sweep, Investigate (also walks to and smashes lit sconces), Chase, Search |
| Crawler | fast: 2.4 m/s roam, 6.3 m/s rush | blind, hunts by sound: hears a noise if `loudness x 28 m` exceeds the distance | Dormant, Waking, Roam, Investigate, Hunt, Search. Throwing an object makes a decoy noise. |
| Shadow | 3.0 m/s lurk, 7.2 m/s strike | senses light: path costs avoid lit polygons, never enters light | Dormant, Lurk, Stalk (circles at your light radius + 1.5 m), Strike (when your light is under 3.5 m or out), Flee (if light reaches it) |

**Spawn schedule after darkness:** lair (sentinel, crawler, shadow) at 0 s; vault statues (sentinel) at 8 s; catacombs (crawler, shadow) at 18 s; sanctum (sentinel) at 30 s; halls (crawler) at 45 s. They all sweep toward the great door unless they have a lead on you. The lair sleepers and the vault statue are in the level (dormant) from the start; a scheduled spawn waits (up to 25 s) while you stand within 14 m of its spawn point, so nothing rises out of the wall in your face.

**Pathfinding:** a navmesh of convex polygons per scene, stitched across scene borders, A* over polygons, then the funnel algorithm to pull the path tight. Closed doors, fallen floors and rubble disable polygons. Guardians repath every 0.35 s while chasing (0.9 s otherwise). When a gate is shut between a guardian and its goal, A* returns a partial path to the reachable spot nearest the goal, so guardians press up against closed doors instead of standing still.

**Heartbeat:** when any awake guardian is within 18 m, a heartbeat plays, faster and louder as it gets closer.

---

## 9. Player

| Action | Default | Numbers |
|---|---|---|
| Walk / sprint / crouch | WASD, Shift, C | 4.2 / 6.6 / 2.0 m/s, multiplied by the load factor |
| Jump | Space | 6.4 m/s (less when loaded), costs 12 stamina |
| Climb | walk into a vine or rope | 2.2 m/s, 10 stamina/s |
| Mantle | Space at a ledge you can reach | 0.45 s pull-up |
| Grab / throw | left mouse: grab, left again: throw; right mouse: drop | up to 25 kg can be lifted |
| Interact | E | stash relic, swap onto a trapped pedestal, levers, sockets, sconces, crank, sundial ring |
| Pull a relic out of the satchel | G (mouse wheel picks which) | it goes into your hands, so you can throw it as a decoy or use it as a counterweight |
| Torch | T light or snuff, R use oil flask | |
| Kick | V | breaks cracked walls, knocks props |
| Map | M | |
| Pause | Esc | |
| Debug overlay | F3 | |

Stamina: 100, regenerates 22 per second after 0.8 s of rest. Health: 100, regenerates slowly after 6 s without damage. Fall damage above 11 m/s landing speed.

---

## 10. Audio (all synthesized with WebAudio)

Jungle ambience by day (filtered-noise insects, FM birdsong, river), wind on the cliffs, dripping and low air in the dungeon, deep rumbles at dusk, the clock tick, wood creak and snap, stone grind, torch crackle, guardian calls (grinding groan, chittering clicks, breathy whisper), a heartbeat near guardians, footsteps by surface, and procedural music that turns tense in the last minute.

---

## 11. Stretch goals (all planned)

- **Hand-drawn map** (M): parchment and ink drawn in code, revealed in a radius around where you have been, one sheet for the surface and one for underground.
- **Idol collapse:** taking the Sun Idol brings the sanctum ceiling down and blocks the main nave.
- **Ghost replay:** your best escaped run is recorded and replayed as a translucent, non-emissive figure. It is lit like everything else, so in Zone C you only see it in fire light.
- **Gamepad:** standard mapping, sticks to move and look.
