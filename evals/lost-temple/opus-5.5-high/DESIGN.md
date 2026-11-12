# The Lost Temple — Design

Written before any game code, then kept in sync with what actually shipped.

## 1. Core loop

```
 Main menu ──► Shop (spend banked loot on gear) ──► Start run (dawn, 13:00 to sunset)
      ▲                                                     │
      │                         explore ─► find relic ─► decide: carry it (slower,
      │                            ▲                     more stamina drain) or leave it
      │                            └──── solve puzzle / key ─► unlock deeper scene
      │                                                     │
      │                     sunset: guardians wake, door starts closing (75 s)
      │                                                     │
 Results screen ◄── escaped through the great door (haul banked)  /  caught, killed, sealed in (haul lost)
```

The tension is greed against the clock. Every relic slows you down, deeper
relics are worth more, and the sun keeps moving whether you are ready or not.
In the dark lower levels the HUD sundial and the ticking are the only clock.

A run lasts at most 13 minutes of daylight plus a 75-second escape window.

## 2. Scene graph and unlock dependencies

Seven scenes in three zones. All of them live in one continuous world space and
are streamed in and out by the `SceneStreamer` (current scene plus its graph
neighbours are attached; everything else is detached), so there are no loading
screens during a run.

```
ZONE A (outside, full sun)        ZONE B (roofless ruins)              ZONE C (no sky, torch only)

 [Jungle approach] ──► [Temple courtyard] ══great door══► [Broken halls] ──gate──► [Collapsed sanctum]
   river, rope bridge    sundial puzzle            ▲      sun-tiles, boulder      main idol, debris
                          │   (gives SUN-DISC)      │      block+plate puzzle            │
                          ▼                         │                              catacomb seal
                    [Outer cliffs] (optional)       │ kicked-down wall           (needs SUN-DISC)
                     vines, ledges, wind,           │ (one-way, opened from              ▼
                     2nd rope bridge                │  the west wing)          [Lower catacombs]
                                                    │                     crumble floor, darts,
                                          servants' passage ◄── reliquary ◄─ blade corridor, flooded
                                                    ▲                          chamber (OBSIDIAN KEY)
                                                    │                                │
                                           drawbridge (lowered               vault door
                                           from the vault side)            (needs OBSIDIAN KEY)
                                                    ▲                                ▼
                                                    └──────────────────── [Deep vault] + guardian lair
```

| Edge | Requirement | Type |
| --- | --- | --- |
| Jungle → Courtyard | cross the collapsing rope bridge (or climb out of the gorge on vines) | free |
| Courtyard → Cliffs | none (optional scene) | free |
| Courtyard → Broken halls | heave the great door open (E) | free, the only exit |
| Broken halls → Sanctum | gate held open by a pressure plate: push the stone block onto it | puzzle |
| Sanctum → Catacombs | catacomb seal needs the **sun-disc** from the courtyard sundial | key relic |
| Catacombs → Deep vault | vault door needs the **obsidian key** from the flooded chamber | key relic |
| Deep vault → Servants' passage | drawbridge lowered by a lever on the vault side | shortcut (opens once used) |
| Catacombs (reliquary) → Servants' passage | none | free |
| Servants' passage → Broken halls | cracked wall kicked down from the west-wing side | shortcut (opens once used) |

**Sundial puzzle.** The courtyard sundial's ring carries an eye glyph. The ring
rotates in 30° steps (E on the lever). The gnomon's shadow is cast by the real
sun (the same direction vector that drives the shadow-casting light). When the
eye glyph sits under the shadow (±15°) the sun-disc rises out of the plinth.
Because the sun moves about 14° per minute, the correct ring position changes
through the day.

**Escape route.** The way in is halls → sanctum → seal stairs → ossuary →
crumbling corridor → junction → dart corridor → flooded chamber (key) → vault
approach → vault. The way out is designed separately: vault → lower the
drawbridge → ramp up to the reliquary → servants' passage (long, gently rising
tunnel) → stairs into the sealed west wing → kick down the cracked wall →
vestibule → great door. It never re-uses the entry corridors, and both
shortcuts stay open for the rest of the run.

### World layout (metres; y up, north is −z)

| Scene | Zone | Bounds (x, y, z) | Key features |
| --- | --- | --- | --- |
| Jungle approach | A | x −30..30, z 95..205, y −20..30 | trimesh terrain, river z 152..162, gorge z 110..126 (16 m deep) with rope bridge, vines |
| Temple courtyard | A | x −45..45, z 10..95 | plazas, toppled pillars, sundial at (0, 0, 50), great door at z 8 |
| Outer cliffs | A | x 45..115, z 0..95 | plateau, abyss x > 70, ledges at y 0 and 7, vines, rope bridge to a spire, rock arch, wind |
| Broken halls | B | x −30..30, z −62..6 | vestibule, sun-tile pit room, boulder aisle, north hall (block + plate), sealed west wing |
| Collapsed sanctum | B | x −25..25, z −112..−62 | west half open to sky, east half unstable roof, idol under an oculus, catacomb seal |
| Lower catacombs | C | x −40..40, y −30..−5, z −200..−40 | floor y −12: ossuary, crumbling corridor, darts, flooded chamber, blades, reliquary, servants' passage |
| Deep vault | C | x −30..36, y −45..−14, z −218..−182 | floor y −20: trapped pedestals, Heart of the Temple, guardian lair, drawbridge |

## 3. Relic table

17 relic types plus two key items. `base` is the zone-A value. Weight is in kg.

| # | Relic | Base value | Weight | Rarity | Where it can appear |
| --- | --- | ---: | ---: | --- | --- |
| 1 | Clay Figurine | 40 | 0.8 | common | A, B |
| 2 | Bronze Bangle | 55 | 0.3 | common | A, B |
| 3 | Jade Bead Necklace | 80 | 0.4 | common | A, B, C |
| 4 | Painted Bowl | 65 | 1.2 | common | A, B |
| 5 | Bone Flute | 110 | 0.3 | uncommon | A, B, C |
| 6 | Obsidian Dagger | 140 | 1.0 | uncommon | B, C |
| 7 | Ritual Scroll | 170 | 0.5 | uncommon | B, C |
| 8 | Silver Mirror | 210 | 1.5 | uncommon | A, B, C |
| 9 | Jaguar Mask | 380 | 2.5 | rare | A (cliffs), B, C |
| 10 | Gem-studded Urn | 520 | 5.0 | rare | B, C |
| 11 | Feathered Serpent Idol | 460 | 3.0 | rare | B, C |
| 12 | Gold Chalice | 480 | 2.0 | rare | A (cliffs), C |
| 13 | Sun Crown | 850 | 3.5 | epic | C |
| 14 | Ruby Skull | 1050 | 4.5 | epic | C (lair) |
| 15 | Emerald Tablet | 950 | 6.0 | epic | C |
| 16 | Golden Idol | 2400 | 7.0 | legendary | sanctum altar only (trapped, triggers the collapse) |
| 17 | Heart of the Temple | 4000 | 9.0 | legendary | vault dais only (trapped) |
| — | Sun-disc | key | 2.0 | key | courtyard sundial |
| — | Obsidian Key | key | 0.5 | key | flooded chamber island |

Loose relic spawns are rolled from a seeded per-run RNG using rarity weights
that shift deeper: zone A `common 60 / uncommon 30 / rare 10`, zone B
`40 / 35 / 20 / epic 5`, zone C `15 / 30 / 35 / epic 20`. Fixed placements
(trapped pedestals, cliffs' open-air relics, the two legendaries) are authored.

**Trapped pedestals** weigh what is on them. Lifting a relic triggers the
pedestal's trap (darts, gate slam, or floor collapse) unless the mass on the
pedestal stays within ±15% of the original. Hold an object (rock, sandbag,
urn) and press E on a trapped relic to swap them in one move.

## 4. Loot value by zone

`value = round(base × zoneMultiplier × sceneBonus)`

| Zone | Scene | Multiplier | Example: Jaguar Mask | Example: Sun Crown |
| --- | --- | ---: | ---: | ---: |
| A | Jungle, Courtyard | 1.00 | 380 | — |
| A | Outer cliffs (exposed bonus) | 1.25 | 475 | — |
| B | Broken halls | 1.75 | 665 | — |
| B | Collapsed sanctum | 1.75 × 1.15 | 765 | — |
| C | Lower catacombs | 3.00 | 1140 | 2550 |
| C | Deep vault + lair | 3.00 × 1.25 | 1425 | 3188 |

Only loot carried out through the great door counts. Getting caught, killed,
or sealed in loses everything carried.

## 5. Carrying, stamina and gear

* Satchel capacity: 12 kg base (shop: 18 / 25 / 34 kg).
* Load `L = carried / capacity`. Speed ×`(1 − 0.4·L^1.3)`, stamina drain ×`(1 + 1.6·L)`.
* Stamina 100 (125 with boots): sprint 18/s, jump 12, regen 22/s after 0.8 s.
* Health 100. Darts 12, blade 35, boulder 60, debris 20, falls over 6 m
  (10 m with rope) 12 per metre, spikes and the abyss kill outright.

| Shop item | Tiers and price | Effect |
| --- | --- | --- |
| Better torch | 600, 1500 | radius 8 → 10 → 12 m |
| Fuel reservoir | 500, 1200 | torch fuel 180 → 260 → 340 s |
| Rope | 800 | safe fall height +4 m, climb speed +40%, torch survives falls |
| Bigger satchel | 700, 1600, 3200 | 12 → 18 → 25 → 34 kg |
| Spare torch | 300 each (max 3) | extra spare torches at the start |
| Trail boots | 900 | stamina 100 → 125 |

## 6. Clock, sun and light

* Countdown 13:00 (780 s) from dawn to sunset. Sun azimuth goes east → south →
  west and elevation `−2° + 72°·sin(π·(0.04 + 0.92·f))`.
* Thresholds: `> 120 s` calm tick (1/s, quiet) · `≤ 120 s` urgent (interval
  1 s → 0.35 s, louder) · `≤ 60 s` critical (edge pulse, music shift, rumble)
  · `0` night (guardians wake, door starts closing, 75 s window) · door shut:
  anyone inside is sealed in.
* Grading: dawn pink-orange → white noon → red-orange sunset → blue-black night.
* Zone C: sun, hemisphere light and sky are forced to exactly 0 / hidden, the
  fog and background are black, and no Zone C material is emissive. Light
  comes only from the player's torch and torches the player puts in sconces.

## 7. Torch

* Fuel burns 1/s while lit. `radius(f) = R` for `f ≥ 0.5`, else
  `R·(0.3 + 0.7·(f/0.5)^0.7)`, out at 0. Flicker ±6% on top.
* Put out by: water above torch height (1.3 m standing, 0.8 m crouched), a wind
  gust on the cliffs (60% unless crouched), or a fall over 4 m (unless rope).
* Relighting takes 2.5 s, you move at 30% speed, and it fails in water.
* Oil flasks add 60 s. Spare torches can go in a wall sconce (burns 300 s,
  radius 7 m) or replace an empty torch (+120 s).

## 8. Guardians

| Type | Speed | Senses | Behaviour |
| --- | --- | --- | --- |
| Stone Sentinel | 2.3 m/s | sight; sees a lit torch from `3 × radius + 6 m` with line of sight, 4 m otherwise | slow, relentless chase, loses you after 8 s without contact |
| Crawler | 6.2 m/s | hearing only (blind): footsteps, landings, impacts, thrown objects | rushes to the last heard noise, searches, then sweeps on |
| Shade | 4.2 m/s | senses you in darkness within 18 m | never enters light (your torch radius, sconces, sunlight); stalks at the edge of your light and strikes when it fails |

States: `dormant → waking → sweep → investigate / chase / stalk → search → sweep`.
Spawn order at sunset (deepest first): lair (t+0 s: one of each), catacombs
(t+10 s), sanctum (t+20 s), halls (t+30 s). The sweep target is the great
door. All movement uses A* over a polygon navmesh with funnel smoothing. A
guardian within 1.1 m of you catches you: run over, haul lost.

## 9. Meta

High-score table (top 10), banked loot, gear upgrades, settings and the best
run's ghost all persist in `localStorage`.
