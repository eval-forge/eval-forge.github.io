# The Lost Temple: Design

Written before any code. Where the build ended up differing, `SELF_REVIEW.md` says so.

## 1. Core loop

1. **Arrive at dawn.** You start in the jungle with an unlit torch, an empty satchel and a 13 minute day (780 s of game time from sunrise to sunset).
2. **Push deeper.** Each scene is richer and nastier than the last. Deeper scenes are gated by things you found earlier.
3. **Get greedy.** Every relic adds value and weight. Weight slows you down and burns stamina, so the walk out gets longer the better the run is going.
4. **Watch the sundial.** The HUD sundial counts down to darkness. Underground it is your only sense of time, along with the ticking.
5. **Get out.** Only loot carried out through the Great Door counts. Stepping out through the door ends the run and banks the haul.
6. **Or don't.** At sunset the guardians wake deepest first and sweep toward the door, the inner gates grind open for them, and the Great Door starts closing (60 s window). Getting caught, dying to a trap or being sealed inside loses everything you carried.
7. **Spend.** Banked value becomes gold for the shop (torch, fuel, rope, satchel), then you go again and try to beat the high-score table.

The tension knob is simple: value per minute rises with depth, and so does the time needed to walk it back out.

### Lose and win conditions

| Outcome | Trigger | Loot kept |
| --- | --- | --- |
| Escaped | Cross the Great Door threshold outward after having been inside | Everything in the satchel |
| Caught | A guardian reaches you | Nothing |
| Killed | Health reaches 0 (traps, falls, scarabs) | Nothing |
| Entombed | Great Door fully closed with you inside, 90 s later | Nothing |

## 2. Scene graph

Seven scenes in three zones. World is one continuous space; scenes stream in and out around the player (current scene plus graph neighbours stay loaded), so there are no loading screens during a run.

```
                         ZONE A (outside, full sun)
  [1 Jungle approach] --> [2 Temple courtyard] ==Great Door==> ...
                                                                \
                         ZONE B (roofless ruins)                 v
        [5 Outer cliffs] <--vine breach-- [3 Broken halls] --portcullis--> [4 Collapsed sanctum]
        (Zone A light,        |                                             |   |        |
         reached from B)      +<------------- kick-down wall --------------+   |        |
                                                                               |        |
                         ZONE C (no sky)                              sun-disc seal   kick-down wall
                                                                               v        ^
                                                              [6 Lower catacombs] --smugglers' stair
                                                                   |         ^
                                                         rope bridge +     drawbridge
                                                         serpent key       (lowered from vault side)
                                                                   v         |
                                                                [7 Deep vault] (+ guardians' lair)
```

### Unlock dependencies

| Edge | Requirement | Where the requirement comes from |
| --- | --- | --- |
| Jungle → Courtyard | none (cross river, cross rope bridge or climb out of the gorge) | n/a |
| Courtyard → Broken halls (Great Door) | Solve the sundial puzzle and lift the **Sun Disc** out of it; lifting the disc releases the door counterweight | Courtyard sundial. Dial ring must be rotated so the real gnomon shadow falls on the sun glyph. The right answer changes as the sun moves. |
| Broken halls → Sanctum (portcullis) | A pushable stone block parked on the hall pressure plate | Block is in the halls; has to be pushed across a scarab band while its lane is sunlit |
| Broken halls → Outer cliffs (breach) | none, but needs a vine climb | n/a (optional scene) |
| Sanctum → Catacombs (sun seal) | **Sun Disc** | Courtyard |
| Sanctum ↔ Outer cliffs (east wall) | Kick the cracked wall down (either side). Stays open. | Shortcut |
| Catacombs → Deep vault (vault door) | **Serpent Key** | Island altar in the catacombs' flooded chamber |
| Vault → Catacombs (drawbridge) | Pull the lever on the vault side. Stays down. | Shortcut, and the only way back: the rope bridge drops behind you |
| Catacombs → Sanctum (smugglers' stair) | Kick the cracked wall at the top (stair side or sanctum side). Stays open. | Shortcut that skips the crumbled gallery and dart corridor |

At sunset the portcullis, sun seal, vault door and drawbridge all grind open by themselves so the guardians can sweep to the door (and so the player can never be soft-locked behind a gate at night).

### Way in versus way out

- **In:** Door → halls (sunlit lanes) → portcullis → sanctum → seal → stairs → crumbling gallery → dart corridor → flooded chamber (key) → rope bridge → vault.
- **Out:** vault blade hall → lever → drawbridge → smugglers' stair → kick wall into sanctum → (if the idol collapse has plugged the south doorway, or it's night and the halls' scarab bands have no sunlit lanes left) kick wall to the cliffs → cliff ledges in the wind → breach → front of the halls → Great Door.

The crumbling gallery and both rope bridges destroy themselves behind you, so the entry route physically cannot be replayed backwards.

## 3. Scenes in detail

### Zone A: outside

**1. Jungle approach.** Trimesh terrain, dense instanced vegetation. A river with a current (wading is slow and pushes you downstream; stepping stones and a log are the dry line). Then a gorge with the first rope-and-plank bridge. Planks crack and drop, so you run it. Falling is survivable here on purpose: you land in the gorge stream, find a consolation relic and climb vines back out on the temple side. It costs about 40 s, which is the lesson.

**2. Temple courtyard.** Overgrown plaza, toppled pillars, a side shrine with low-value relics, fuel and a spare torch. The sundial puzzle sits in the middle; the Great Door is in the temple facade on the north side.

**5. Outer cliffs (optional).** Ledges on the temple's east flank over a canyon. Vine climbs, jumps, a short plank bridge, periodic wind gusts that shove you and blow out a lit torch. Falling off is death. Relics here are rare types sitting in the open.

### Zone B: roofless ruins

**3. Broken halls.** Long hall, roof at 8 m with slots broken out of it. Bands of the floor are infested with **shade scarabs** that only swarm where the floor is in shadow. Sun patches from the roof slots sweep west to east through the day, so the safe lane through each band moves, and after sunset there is none. Sunlit test is analytic (project each roof opening along the sun direction) so the gameplay matches the rendered shadows.

**4. Collapsed sanctum.** South half open to the sky, north half under an unstable slab. A **noise meter** fills when you run, jump, land or throw things; crossing thresholds drops ceiling debris (rigid bodies) near you. The Golden Jaguar idol sits on a trapped pedestal under a beam of light. Taking it without a matching counterweight starts the collapse: debris rains and the south doorway is plugged with rubble. Dormant stone sentinels stand in the alcoves all day.

### Zone C: fully dungeoned

**6. Lower catacombs.** Entry crypt, a gallery whose floor tiles crumble shortly after you step on them (pit below hurts, with a climb out on the far side), a dart corridor (pressure plates fire darts at chest height; crouching or avoiding plates is safe), the flooded chamber (deep water douses the torch; submerged stepping pillars lead to the island altar with the Serpent Key), then a chasm with the second rope bridge to the vault door.

**7. Deep vault.** Treasure hall with the heaviest loot, a rolling-boulder ramp triggered by a pressure plate, a swinging-blade hall on the way to the drawbridge lever, and the guardians' lair as a side chamber where the deepest guardians sleep in plain sight.

## 4. Systems

### Time and sun
- Day length 780 s. `t = 0` dawn, `t = 390` noon, `t = 780` sunset.
- Sun direction: `θ = π·t/T`, `dir = (cos θ, sin θ·cos 25°, sin θ·sin 25°)`: rises east (+X), peaks 65° up toward the south (+Z), sets west.
- One shadow-casting directional light follows the player. Zones A and B get it; Zone C gets nothing.
- Grading keyframes: dawn (pink/gold, low exposure), noon (white, high), sunset (red-orange), night (blue-black with dim moonlight in A/B only).

### Countdown thresholds
| Time left | Event |
| --- | --- |
| always | Sundial HUD, one tick per second |
| ≤ 120 s | Tick interval shrinks from 1.0 s to 0.25 s and volume rises |
| ≤ 60 s | Screen-edge pulse, music switches to the urgent theme, temple rumble + camera shake |
| 0 | Darkness, guardians wake by depth, inner gates open, Great Door starts closing (60 s) |
| −60 s | Door sealed. Guardians enrage. |
| −150 s | Entombed. |

### Torch
- Fuel is `0..1`. Base burn time 240 s (upgrades: 320 s, 420 s). Base max radius 11 m (13, 15).
- Radius curve: full radius while fuel ≥ 0.35; below that `r = rMax·(0.35 + 0.65·(f/0.35)^0.7)`; at 0 the torch is out.
- Goes out from: deep water (depth > 0.9 m), a strong wind gust, a fall over 4 m, or empty fuel.
- Relighting: 2.2 s animation, no sprinting, light stays off until it finishes.
- Spare torches: carried count. Use one to replace a dead torch (full fuel) or leave one in a wall sconce as a fixed light.
- Fuel flasks refill 45%.
- Zone C ambient light is exactly 0. No emissive set dressing down there.

### Player
Capsule on Rapier's kinematic character controller. Walk 3.6 m/s, run 6.2 m/s (stamina), crouch 1.8 m/s, jump ≈ 1 m, mantle ledges up to 1.7 m, climb vines. Health 100. Carry one physical object in hand (grab, drop, throw); relics go in the satchel.

Encumbrance, with `r = load / capacity`:
- speed factor `1 − 0.55·r^1.3`
- stamina drain factor `1 + 1.5·r`
- pickups that would exceed capacity are refused.

Satchel capacity 12 kg (upgrades: 18, 26).

### Physics set pieces
- **Rope bridges:** plank rigid bodies chained with spherical joints (two per link), anchored to posts. Stepped-on planks crack after 0.8 s and their joints are cut 0.5 s later.
- **Crumbling floor:** tiles turn dynamic 0.7 s after first contact.
- **Pressure plates:** fire on the player or any body over a mass threshold.
- **Pushable blocks:** heavy dynamic cuboids with locked rotation, pushed by the character controller.
- **Swinging blades:** kinematic pendulums, 40 damage.
- **Rolling boulder:** dynamic sphere released down a ramp, damage scales with its speed.
- **Darts:** fast kinematic projectiles from wall slots, 15 damage each.
- **Trapped pedestals:** lifting the relic fires the linked trap unless you swap in a held object within ±20% of the relic's weight.

### Guardians
| Type | Speed | Senses | Relationship to light |
| --- | --- | --- | --- |
| Stone Sentinel | 2.3 m/s, never stops | Line of sight, 14 m | Sees a lit torch from 30 m |
| Crawler | 6.6 m/s | Blind. Hears running, landing, thrown objects, traps | Ignores it |
| Shade | 4.2 m/s | Senses torchlight within 40 m, sees you in the dark within 9 m | Cannot enter a light radius. Lurks at the edge and strikes when the light shrinks or dies |

Shared state machine: `dormant → waking → sweep → investigate → chase → search → sweep`. The Shade adds `lurk` and `flee`. Movement is A* over a polygon navmesh with funnel string-pulling. Wake order is by depth: lair at 0 s, catacombs at 15 s, sanctum at 30 s, halls at 45 s. Each one sweeps a route that ends at the Great Door.

## 5. Relic table

`value = base value × depth multiplier of the scene it was found in`.

| # | Relic | Base value | Weight (kg) | Rarity | Shallowest zone |
| --- | --- | --- | --- | --- | --- |
| 1 | Clay Votive Figurine | 40 | 0.4 | common | A |
| 2 | Bronze Coin Pouch | 60 | 0.6 | common | A |
| 3 | Carved Bone Flute | 80 | 0.3 | common | A |
| 4 | Jade Frog | 120 | 0.8 | uncommon | A |
| 5 | Feathered Serpent Mask | 180 | 1.2 | uncommon | A |
| 6 | Storm Opal | 420 | 0.5 | rare | A (cliffs only) |
| 7 | Painted Codex Scroll | 150 | 0.2 | uncommon | B |
| 8 | Silver Sun Mirror | 220 | 1.5 | uncommon | B |
| 9 | Turquoise Mosaic Skull | 300 | 1.8 | rare | B |
| 10 | Gem-studded Urn | 380 | 3.5 | rare | B |
| 11 | Golden Jaguar Idol (main idol) | 900 | 6.0 | unique | B (sanctum) |
| 12 | Obsidian Dagger | 260 | 0.7 | uncommon | C |
| 13 | Jade Burial Mask | 520 | 2.2 | rare | C |
| 14 | Ruby-eyed Serpent | 640 | 4.0 | rare | C |
| 15 | Crystal Skull | 800 | 2.5 | epic | C |
| 16 | King's Sceptre | 950 | 3.0 | epic | C |
| 17 | Gold Ingot | 700 | 7.0 | rare | C (vault) |
| 18 | Golden Sun Calendar | 1100 | 9.0 | epic | C (vault) |
| 19 | Crown of the Sun King | 1600 | 4.5 | legendary | C (vault) |

Rarity roll weights when a loot spot is filled: common 10, uncommon 6, rare 3, epic 1.5, legendary 0.5. Unique relics are placed by hand.

## 6. Loot value by zone

| Scene | Zone | Depth multiplier | Loot spots | Target total value |
| --- | --- | --- | --- | --- |
| Jungle approach | A | 1.0 | 3 | ~250 |
| Temple courtyard | A | 1.0 | 5 | ~450 |
| Outer cliffs | A | 1.3 | 4 | ~1,400 |
| Broken halls | B | 1.6 | 6 | ~2,000 |
| Collapsed sanctum | B | 1.8 | 5 + idol | ~3,300 |
| Lower catacombs | C | 2.4 | 8 | ~7,500 |
| Deep vault | C | 3.2 | 9 | ~20,000 |

Zone totals rise strictly A < B < C, and a unit test holds the placement table to that. A full clear weighs far more than any satchel can hold, so every run is a choice about what to leave.

## 7. Meta progression

Gold = sum of banked haul values. Shop:

| Upgrade | Levels | Effect |
| --- | --- | --- |
| Torch | 3 | Radius 11 → 13 → 15 m, burn time 240 → 320 → 420 s |
| Fuel | 3 | Start with 0 → 1 → 2 fuel flasks |
| Rope | 1 | Carry one rope; tie it off at the anchor ring on the outer cliffs to make a climbable line (planned as two levels, cut to one because only one anchor was built) |
| Satchel | 3 | Capacity 12 → 18 → 26 kg |

High-score table keeps the ten best escapes by haul value. Settings, shop levels, gold, scores and the best-run ghost are saved to `localStorage`.

## 8. Stretch goals planned

- Hand-drawn map that inks in as you explore (M).
- Idol collapse sequence (above).
- Ghost of the best run.
- Gamepad support.
