# The Lost Temple: Design

A first-person relic heist against the sun. You arrive at the ruined temple at dawn
with an empty satchel and a torch. The deeper you go, the richer the loot and the
darker it gets. At darkness the guardians wake, the great door starts to grind
shut, and everything you are still carrying inside is forfeit.

## 1. Core loop

```
 arrive at dawn ──► explore / solve ──► grab loot ──► weigh greed vs. clock
        ▲                                                  │
        │                       ┌──── go deeper (more value, more danger, longer way back)
        │                       │
        │                       └──── walk loot out the great door ──► it is "secured" at camp
        │                                                  │
 shop upgrades ◄── results ◄── escape (outside at darkness / leave from camp)
                          ◄── caught by a guardian / killed / sealed inside
```

* **One run = one day.** Dawn (06:00) to darkness (19:00) is compressed into
  **13 minutes** of real time (1 game hour = 60 s). After darkness there is a
  **75 s final window** while the great door closes.
* **Securing loot.** Relics only count once they are carried out through the great
  door. Stepping outside with loot automatically drops it into the camp stash by the
  door. You can go back in for more as many times as the sun allows.
* **Ending a run.**
  * *Escaped*: you are outside when the door finishes closing, or you choose
    "Leave the temple" at the camp. Haul = stash + whatever you carry.
  * *Lost*: caught by a guardian, killed by a trap or fall, or sealed inside when the
    door closes. **Everything you were carrying is lost.** The stash you already
    carried out still pays (that loot made it out the door), but the run is marked
    as lost on the scoreboard.
* **Between runs** your banked money buys gear in the shop. High scores and gear
  persist in `localStorage`.

The tension: every relic is heavier than the last, every scene is further from the
door, and the scenes that pay best are the ones where the sky cannot tell you the time.

## 2. Scene graph and unlock dependencies

Seven scenes in three zones, laid out in one continuous world space so they can be
streamed in and out without loading screens (current scene + direct neighbours stay
loaded; everything else is unloaded and its state saved to the run state).

```
                      ZONE A: OUTSIDE (full sun)
   ┌──────────────┐  rope bridge   ┌───────────────────┐  vine path  ┌──────────────┐
   │ A1 Jungle    │───────────────►│ A2 Temple         │◄───────────►│ A3 Outer     │
   │ approach     │ (one way, it   │ courtyard         │  (optional) │ cliffs       │
   │ (spawn)      │  collapses)    │ sundial, camp     │             │              │
   └──────────────┘                └─────────┬─────────┘             └──────────────┘
                                   GREAT DOOR│ needs: stone block on the door plate
                      ZONE B: ROOFLESS RUINS │ (the only way in and the only way out)
                                   ┌─────────▼─────────┐  kick-wall  ┌──────────────┐
                                   │ B1 Broken halls   │◄ ─ ─ ─ ─ ─ ─│ B2 Collapsed │
                                   │ sun-stone pit,    │  shortcut   │ sanctum      │
                                   │ blade gallery     │────────────►│ main idol    │
                                   └─────────┬─────────┘   archway   └──────▲───────┘
                                   SUN SEAL  │ needs: Sun Disc               │ escape ramp
                      ZONE C: DUNGEON        │ (from the A2 sundial)         │ (one way up)
                                   ┌─────────▼─────────┐  VAULT DOOR ┌──────┴───────┐
                                   │ C1 Lower          │────────────►│ C2 Deep      │
                                   │ catacombs         │ needs: Bone │ vault + lair │
                                   │ darts, crumble,   │ Key (C1     │ drawbridge   │
                                   │ flood, boulder    │ flood pool) │ shortcut     │
                                   └───────────────────┘             └──────────────┘
```

| Gate | Between | Requirement | Persisted as |
|------|---------|-------------|--------------|
| Rope bridge | A1 → A2 | none (planks fall behind you; a fallen tree is the fallback crossing) | broken plank ids |
| Great door | A2 ↔ B1 | push the stone block onto the door plate (weight ≥ 250 kg) | `greatDoorOpen` |
| Cliff path | A2 ↔ A3 | none, but needs vine climbing and ledge jumps | — |
| Sun Seal | B1 → C1 | **Sun Disc**, earned by pressing the sundial glyph under the gnomon's real shadow | `sunSealOpen` |
| Vault door | C1 → C2 | **Bone Key**, lying at the bottom of the flooded chamber in C1 | `vaultDoorOpen` |
| Archway | B1 ↔ B2 | open, but rubble seals it when the Sun Idol collapse sequence finishes | `archwayBlocked` |
| Kick-wall shortcut | B2 → B1 | kick it down from the sanctum side (one way until kicked) | `kickWallBroken` |
| Drawbridge shortcut | C2 → B2 | pull the lever in the vault; lowers the bridge over the chasm | `drawbridgeDown` |

**The escape route is its own design.** The way in is
door → halls → Sun Seal → catacombs → vault door → vault. The way out from the vault
is vault → drawbridge → chasm ramp → sanctum → kick-wall or archway → halls → door.
It passes through scenes you have only seen from the other side and through the
sanctum, which you may have stripped (and destabilised) on the way.

## 3. Scenes

### Zone A: Outside (full sunlight)
* **A1 Jungle approach.** Spawn at dawn. Dense instanced vegetation, a river crossing
  (stepping stones, a log, or wade the deep middle and drown your torch), and a gorge
  spanned by a rope bridge of jointed rigid planks that crack and drop under you. A
  fallen tree across the gorge further west is the slower, narrower fallback.
* **A2 Temple courtyard.** Overgrown plazas, toppled pillars, the camp stash, the
  sundial puzzle and the great door. Push the stone block onto the door plate to raise
  the door. The sundial's gnomon casts a real shadow from the moving sun; press the
  glyph stone the shadow tip touches to raise the Sun Disc. Press a wrong glyph and
  the pillars fire darts.
* **A3 Outer cliffs (optional).** A ledge trail down the cliff face east of the
  courtyard: jumps, vine walls, and wind gusts that shove you toward the drop and can
  blow your torch out. High-value relics in the open. Falling is death (unless you
  bought the rope).

### Zone B: Roofless ruins (partly open to the sky)
* **B1 Broken halls.** The roof has caved in. Sun shafts slide across the floor as the
  day passes (real shadows). A pit cuts the hall in two. The **sun-stones** across it
  are only solid while sunlight hits them (they are only lit from mid-morning to
  mid-afternoon). The other route is the **blade gallery**, a side corridor of
  swinging blades. The Sun Seal is in the west wall.
* **B2 Collapsed sanctum.** Half the ceiling is gone; the rest is unstable. Every
  noise (sprinting, landing, thrown objects, kicking) adds to an instability meter and
  shakes debris loose above the noise. The **Sun Idol** sits under the beam of light
  on a weight-trapped pedestal. Taking it starts the **collapse sequence**: debris
  rains for 25 s, the clock jumps forward 45 s, and the archway back to the halls is
  buried, so you leave through the kick-wall.

### Zone C: Fully dungeoned (no sky at all, zero ambient light)
* **C1 Lower catacombs.** Stairs from the Sun Seal into black. A dart corridor with
  hidden plates (darts fly at chest height, so crouch), a flooded chamber whose
  deepest point holds the Bone Key (water kills your torch), a hall with crumbling
  floor over a bone pit, and a long sloped corridor with a rolling boulder trap.
* **C2 Deep vault.** The richest and heaviest loot, several trapped pedestals, the
  drawbridge lever, and the guardians' lair next door, where dormant statues wait for
  dark.

## 4. Relics

20 relic types. Every placement in the world is a *slot* with a rarity pool; a seeded
RNG picks the type per run, so runs differ. **Value = base × zone multiplier**
(A × 1.0, B × 1.6, C × 2.6), rounded to 5.

| # | Relic | Base value | Weight (kg) | Rarity | Found in |
|---|-------|-----------:|------------:|--------|----------|
| 1 | Painted Clay Bowl | 40 | 1.5 | common | A B C |
| 2 | Bronze Bangle | 60 | 0.4 | common | A B C |
| 3 | Bone Flute | 80 | 0.3 | common | A B C |
| 4 | Obsidian Blade | 90 | 0.8 | common | A B C |
| 5 | Jade Bead Necklace | 120 | 0.3 | common | A B C |
| 6 | Sealed Scroll Case | 150 | 1.0 | uncommon | A B C |
| 7 | Silver Chalice | 180 | 1.8 | uncommon | A B C |
| 8 | Quetzal Feather Crown | 220 | 1.2 | uncommon | A B C |
| 9 | Temple Gold Ingot | 260 | 8.0 | uncommon | B C |
| 10 | Gem-Studded Urn | 300 | 6.0 | uncommon | B C |
| 11 | Gold Eagle Statuette | 380 | 5.5 | rare | A B C |
| 12 | Jade Death Mask | 400 | 3.5 | rare | B C |
| 13 | Golden Sun Mask | 450 | 4.0 | rare | A B C |
| 14 | Serpent Scepter | 500 | 2.5 | rare | B C |
| 15 | Ruby Heart | 650 | 0.9 | epic | B C |
| 16 | Crystal Skull | 700 | 4.5 | epic | C |
| 17 | Golden Jaguar Idol | 900 | 9.0 | epic | C |
| 18 | Chest of Gems | 1100 | 14.0 | legendary | C |
| 19 | Gold Ancestor Statue | 1400 | 18.0 | legendary | C |
| 20 | The Sun Idol (unique, trapped) | 2000 | 7.5 | legendary | B2 only |

Rarity weights when a slot rolls: common 50, uncommon 28, rare 15, epic 6,
legendary 1 (legendary only rolls in C2).

**Trapped relics.** Some pedestals are weight plates. Lift the relic and the plate
compares its load to the relic's weight. If the difference is more than 15%, the trap
fires (darts, blades or, for the Sun Idol, a faster collapse). Hold an object of
similar weight (sandbags, rocks, pots: each shows its weight when you look at it) and
press **E** on the relic to swap it in one motion.

**Weight.** The satchel holds 18 kg (upgradable to 44 kg). Things that don't fit can
be carried in your hands (one item, no sprinting). Speed multiplier
`= 1 − 0.45 · min(1, w / capacity)`; stamina drain multiplier `= 1 + 1.5 · w / capacity`.

## 5. Loot value by zone

| Zone | Slots | Typical relic value | Expected value of the zone* | Trapped |
|------|------:|--------------------:|----------------------------:|--------:|
| A1 Jungle | 4 | 40 – 220 | ≈ 450 | 0 |
| A2 Courtyard | 5 | 40 – 450 | ≈ 650 | 0 |
| A3 Cliffs | 4 | 120 – 450 (rare-weighted) | ≈ 1 100 | 0 |
| B1 Halls | 7 | 65 – 1 040 | ≈ 1 900 | 1 |
| B2 Sanctum | 5 + Sun Idol | 65 – 3 200 | ≈ 4 800 | 2 |
| C1 Catacombs | 8 | 105 – 1 820 | ≈ 3 600 | 1 |
| C2 Vault | 9 | 680 – 3 640 | ≈ 14 000 | 3 |

\* Mean value of the rolled slots, from the rarity weights above. The C2 vault alone is
worth more than everything above ground, and its best pieces weigh 14 – 18 kg.

## 6. Time, sun and the clock

* Sun azimuth sweeps east → south → west; elevation peaks at 72° at 12:30.
  Shadows are real shadow maps from a directional sun.
* Colour grading keyframes: dawn (pink-gold, soft), noon (neutral, bright),
  sunset (red-orange, high contrast), night (desaturated blue, dark).
* **Countdown thresholds** (time left until darkness):
  * `> 120 s`: normal; the HUD sundial ticks once per second, quietly.
  * `≤ 120 s`: the tick speeds up (up to 4 per second) and gets louder.
  * `≤ 60 s`: red pulse on the screen edges, the music shifts to the dusk theme,
    the temple rumbles and the camera shakes.
  * `0`: darkness; the guardians wake (deepest first) and the great door starts
    closing (75 s).
  * Door closed: anyone inside is sealed in (run lost).
* In Zone C there is no sky at all; the HUD sundial and the sounds are the only clock.

## 7. Torch

* Base fuel 300 s of burn. Radius 9 m at > 40 % fuel, shrinking quadratically to 30 %
  of max at empty, then out. Upgrades raise radius, fuel and gust resistance.
* Blown out by: going under water, wind gusts (cliffs, some halls drafts) with a
  chance reduced by torch level, falls harder than 9 m/s impact.
* Relighting: 2.2 s animation; you move at crawl speed and cannot jump or sprint.
* Oil flasks add 90 s. Spare torches can be placed in wall sconces (E), where they
  burn for 10 minutes and light the way out (and keep shades away).
* **Zone C has zero ambient light**: those materials receive no sun, no sky, no
  hemisphere light, fog colour is black, nothing is emissive. Only flames light it.

## 8. Guardians (wake at darkness)

They spawn deepest first: the lair at 0 s, the catacombs at +15 s, the sanctum at
+30 s, the halls at +45 s. With no target they **sweep** toward the great door along
the navmesh. They chase along real navmesh paths (A* over convex floor polygons plus
funnel string-pulling).

| Guardian | Movement | Senses | Weakness |
|----------|----------|--------|----------|
| **Stone Sentinel** | slow (2.4 m/s sweep, 3.6 chase), unstoppable | sight cone 110°, 30 m; sees a lit torch at 40 m; an unlit player only within 6 m | darkness: douse your torch and it loses you |
| **Crawler** | fast (3.5 sweep, 6.6 chase), low | blind; hears noise events (footsteps, landings, impacts, splashes), loudness by distance | silence: crouch-walk, or throw something to lure it away |
| **Shade** | medium (4.8), passes through dark | senses you within 25 m | light: it cannot enter torch radius or sunlight, and it lunges the moment your light fails |

States: `dormant → sweep → investigate → chase → search → sweep` (sentinel, crawler);
`dormant → sweep → stalk → lunge → retreat` (shade). Getting caught ends the run and
everything you carry is lost.

## 9. Meta progression

* **Bank**: every haul is added to the bank.
* **Shop**: Better Torch (3 levels), More Fuel (3), Rope (2: survive a fatal fall,
  then faster climbing), Bigger Satchel (3), Trail Boots (2: stamina).
* **High scores**: top 10 runs by haul, with outcome, time and relics found.
* **Ghost**: your best escaped run is recorded at 5 Hz and replayed as a ghost.

## 10. Controls

| Action | Keyboard / mouse | Gamepad |
|--------|------------------|---------|
| Move / look | WASD / mouse | left / right stick |
| Sprint | Shift | L3 or LB |
| Jump / mantle | Space | A |
| Crouch | C or Ctrl | B |
| Interact / pick up / swap / use key | E | X |
| Grab / release object in hands | F | Y |
| Throw held object | Left mouse | RT |
| Drop last relic from satchel | Q | D-pad down |
| Douse / relight torch | T | RB |
| Place torch in sconce | E (at sconce) | X |
| Kick | E at a cracked wall | X |
| Map | M | View |
| Pause | Esc | Start |
| Debug overlay | F3 | — |
