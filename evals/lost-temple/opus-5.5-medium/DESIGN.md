# The Lost Temple — Design

## Core loop

1. **Dawn.** You arrive in the jungle with a torch, a satchel and ~13 minutes of daylight.
2. **Push deeper.** Each zone is darker, more dangerous and richer than the last. Puzzles and keys found earlier open the next scene.
3. **Grab loot.** Every relic has value *and* weight. More weight = slower walking, faster stamina drain, louder footsteps.
4. **Watch the sundial.** The HUD sundial counts down to darkness. Ticking speeds up and gets louder in the last 2 minutes; at 60 s the screen pulses, the music shifts and the temple rumbles.
5. **Get out.** At zero, darkness falls, the guardians wake deepest-first and sweep toward the great door, which starts closing (75 s final window). Only loot carried across the door threshold counts.
6. **Bank & upgrade.** Banked loot becomes coins for the shop (torch, fuel, rope, satchel, boots). High scores persist.

Death (caught by a guardian, falling into a gorge/chasm, crushed, darts, or trapped inside when the door shuts) loses the run and everything carried.

## Scene graph (7 scenes + escape tunnel, 3 zones)

```
                    ┌──────────────┐
                    │ Outer Cliffs │ (A, optional, wind, vines, open relics)
                    └──────┬───────┘
 ┌────────┐  bridge  ┌─────┴──────┐  great door  ┌──────────────┐ halls gate ┌───────────────────┐
 │ Jungle ├─────────►│ Courtyard  ├─────────────►│ Broken Halls ├───────────►│ Collapsed Sanctum │
 │  (A)   │  gorge   │   (A)      │◄─────────────┤     (B)      │ (block on  │       (B)         │
 └────────┘          └────────────┘   EXIT only  └──────┬───────┘  plate)    └────────┬──────────┘
                     sundial → SUN-DISC                 │ kicked wall                 │ sun-disc seal
                                                        │ (shortcut, from tunnel)     ▼
                                               ┌────────┴────────┐            ┌──────────────────┐
                                               │ Escape Tunnel   │            │ Lower Catacombs  │
                                               │ (C, rising ramp)│            │      (C)         │
                                               └────────▲────────┘            └────────┬─────────┘
                                                        │ escape lever                 │ bronze gate (BRONZE KEY
                                               ┌────────┴────────┐                     │ from flooded chamber)
                                               │   Deep Vault    │◄────────────────────┘
                                               │      (C)        │──── grate ──── Guardian Lair
                                               └─────────────────┘
```

### Unlock dependencies

| Transition | Requirement | Where the key comes from |
|---|---|---|
| Jungle → Courtyard | Cross the collapsing rope bridge (planks drop 0.7 s after you step on them) | — |
| Courtyard → Broken Halls | Great door (open from dawn until it closes after dark) | — |
| Courtyard → Outer Cliffs | Always open (optional) | — |
| Broken Halls → Sanctum | Halls gate: push the stone block onto the pressure plate | Block in the halls |
| Sanctum → Catacombs | Catacomb seal: insert the **Sun-Disc** | Sundial puzzle in the courtyard (rotate the dial ring to match the gnomon's real shadow) |
| Catacombs → Vault | Bronze gate: use the **Bronze Key** | Bottom of the flooded chamber (torch goes out in deep water) |
| Vault → Escape Tunnel | Pull the escape lever in the vault | — |
| Escape Tunnel → Broken Halls | Kick down the cracked wall (only from the tunnel side) | — |
| Catacomb crumbling chasm (way back) | Lower the drawbridge with the lever on the far side | — |

### Shortcuts and escape route
- **Crumbling chasm / drawbridge (catacombs):** the way in is a crumbling floor that collapses behind you. The lever on the far side lowers a drawbridge that stays down.
- **Escape tunnel + kicked wall:** the vault's escape lever opens a long, rising tunnel that bypasses the catacombs and sanctum entirely and ends at a cracked wall in the Broken Halls. Kick it down (E) and it stays open. This is the intended escape route: shorter, but dark, uphill (slow when heavy) and the guardians from the lair use it too once it's open.

## Zones

| Zone | Scenes | Light | Hazards | Loot multiplier |
|---|---|---|---|---|
| A — Outside | Jungle, Courtyard, Outer Cliffs | Full sun + sky | River (slows, douses torch), collapsing rope bridge, gorge, cliff falls, wind gusts | ×1.0 |
| B — Roofless ruins | Broken Halls, Collapsed Sanctum | Sun through the missing roof only | Sun-tiles that crumble when in shadow, unstable ceiling (noise → debris), trapped idol pedestal, swinging blade | ×1.6 |
| C — Fully dungeoned | Catacombs, Deep Vault, Escape Tunnel | **Zero ambient.** Torch + placed sconces only | Crumbling floors, dart corridors, flooded chamber, rolling boulder, swinging blades, trapped pedestals, guardians' lair | ×2.5 |

## Relic table

Value in a scene = `base × zone multiplier`. Rarity drives the weighted random pick for each loot spot (seeded per run). Zone column = where the type may spawn.

| # | Relic | Base value | Weight (kg) | Rarity | Zones | Notes |
|---|---|---|---|---|---|---|
| 1 | Clay Figurine | 40 | 1.0 | common | A B | |
| 2 | Jade Bead Necklace | 60 | 0.4 | common | A B | |
| 3 | Bronze Bell | 80 | 2.5 | common | A B C | |
| 4 | Carved Wooden Mask | 110 | 1.8 | uncommon | A B | |
| 5 | Obsidian Dagger | 120 | 1.2 | uncommon | A B C | |
| 6 | Ancient Scroll | 130 | 0.3 | uncommon | B C | |
| 7 | Silver Chalice | 150 | 2.0 | uncommon | B C | |
| 8 | Feathered Crown | 200 | 1.5 | rare | A B | |
| 9 | Gem-Studded Urn | 240 | 6.0 | uncommon | B C | heavy |
| 10 | Jade Death Mask | 280 | 3.0 | rare | B C | |
| 11 | Ruby Scarab | 320 | 0.8 | rare | C | |
| 12 | Gold Ingot | 360 | 9.0 | uncommon | C | very heavy |
| 13 | Emerald Skull | 480 | 5.0 | rare | C | |
| 14 | Star Sapphire | 600 | 0.6 | epic | C | |
| 15 | Royal Sarcophagus Mask | 750 | 7.0 | epic | C | |
| 16 | Golden Idol (main) | 900 | 8.0 | unique | B (sanctum) | trapped, triggers the collapse sequence |
| 17 | Sun-Disc | 100 | 3.0 | key | A (sundial) | opens the catacomb seal (consumed) |
| 18 | Bronze Key | 50 | 1.0 | key | C (flooded chamber) | opens the vault gate (consumed) |

Trapped pedestals: the main idol and two vault relics. Lifting one starts a 1 s grace window. If the load left on the pedestal is under 75 % of the relic's weight when it runs out, the trap fires. Hold a sandbag / stone / another relic (G) and press E on the pedestal to swap.

## Loot value by zone (expected, default seed)

| Zone | Loot spots | Expected value per spot | Expected zone total | Notes |
|---|---|---|---|---|
| A | 12 (+ sun-disc) | ~95 | ~1,150 | cliffs hold ~45 % of it, out in the open |
| B | 10 + Golden Idol | ~240 | ~2,400 + 1,440 idol | idol alone ≈ all of zone A |
| C | 16 (+ 2 trapped) | ~800 | ~12,800 | far more than you can carry: choose by value/weight |

Base satchel capacity is 20 kg (shop upgrades to 28 / 36 / 45 kg), so the deep vault forces real choices.

## Time

- Compressed day: **13 minutes** from dawn (sun 4° above the horizon) through noon (68°) to sunset (sun at horizon at 0:00 on the clock).
- Thresholds: `> 120 s` normal ticking every 2 s; `≤ 120 s` ticking speeds up (to 4 Hz) and gets louder; `≤ 60 s` critical (edge pulse, music shift, rumbles); `0` dark (guardians wake, door starts closing); `door closed` = run lost if still inside.
- Final window: 75 s for the door to close.

## Guardians

| Type | Speed | Senses | Behaviour |
|---|---|---|---|
| Stone Sentinel | slow (2.6 m/s) | sight cone 70°, range scales with your light (torch radius × 2.2, min 4 m) | relentless; follows torchlight |
| Crawler | fast (6.2 m/s chasing) | hearing only (noise events: running, landing, throws, drops, debris); sight 3 m | investigates noises, sprints on contact |
| Shade | medium (4.4 m/s) | senses you anywhere within 22 m | will not enter any light (torch, sconce, sun). Stalks the edge of your light and lunges when your torch is out or tiny |

States: `DORMANT → WAKING → SWEEP → (INVESTIGATE | CHASE | STALK) → SEARCH → SWEEP …`, `CATCH` ends the run. They spawn in the lair first, then the vault, catacombs, sanctum, halls, at 6 s intervals, and sweep outward toward the great door along the nav graph.
