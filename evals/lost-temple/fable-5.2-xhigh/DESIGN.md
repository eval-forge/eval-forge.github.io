# The Lost Temple — Design

> Written before any code. Where the shipped game ended up differing from this
> plan, the difference is called out in `SELF_REVIEW.md` rather than quietly
> edited away here.

## 1. Pitch

You are a treasure hunter who reaches a ruined jungle temple at dawn. A
compressed day (13 minutes) is all you get. Go as deep as you dare, fill your
satchel, and walk back out through the great door before the sun is gone. At
sunset the temple's guardians wake, deepest first, and sweep outward toward the
door, which starts grinding shut. Everything you carry slows you down. Greed
against the clock is the whole game.

## 2. Core loop

```
            ┌──────────────────────── meta loop ─────────────────────────┐
            │                                                            │
 Main menu ─┴─> Shop (spend banked coins on gear) ─> Start run at dawn   │
                                                         │               │
   ┌──────────────────────── run loop ───────────────────┘               │
   │                                                                     │
   │  explore scene ─> solve puzzle / dodge trap ─> lift relic           │
   │        ^                                          │                 │
   │        │           (heavier satchel: slower,      │                 │
   │        │            stamina drains faster)        v                 │
   │        └──── "one more room?" <── check sundial: how long is left?  │
   │                                   │                                 │
   │                                   v                                 │
   │              turn back: escape route, shortcuts you opened          │
   │                                   │                                 │
   └──> out the great door = bank haul ┴ caught / killed / entombed = 0 ─┘
```

Moment to moment the player is always trading three currencies:

| Currency  | Spent by                                   | Refilled by                     |
|-----------|--------------------------------------------|---------------------------------|
| Daylight  | everything (it only ever goes down)        | nothing                         |
| Stamina   | sprinting, jumping, climbing, heavy loads  | resting / walking               |
| Torch fuel| every second the torch is lit underground  | fuel flasks, spare torches      |

and one risk dial, **weight**: each relic adds kilograms, which lowers move
speed and raises stamina drain, which makes the walk out longer, which costs
daylight.

### Run timeline (780 s day)

| Time left | What happens                                                                 |
|-----------|-------------------------------------------------------------------------------|
| 13:00     | Dawn. Player starts at the jungle camp. Pink-gold grade, long shadows.        |
| ~11:30    | Typical arrival in the courtyard. Sun high enough for the sundial puzzle.     |
| 6:30      | Solar noon. Central nave of the Broken Halls is fully sunlit (safe).          |
| 2:00      | Clock tick starts accelerating and getting louder.                            |
| 1:00      | Screen edges pulse red, music switches to the danger layer, temple rumbles.   |
| 0:00      | Darkness. All seals break open, guardians wake (deepest first), door closes.  |
| −0:60     | Great door fully shut. Anyone still inside is entombed (run lost).            |

The great door is a descending stone slab: the gap shrinks linearly for 60 s,
so the last ~10 s can only be passed crouching.

## 3. World and scene graph

Seven scenes in three zones, all in one continuous world space. Scenes stream
in and out around the player; there are no loading screens during a run.

| # | Scene             | Zone | Depth mult | Sky            | Role                                               |
|---|-------------------|------|-----------:|----------------|----------------------------------------------------|
| 1 | Jungle Approach   | A    | ×1.0       | open           | Tutorial stretch: river, first collapsing bridge    |
| 2 | Temple Courtyard  | A    | ×1.0       | open           | Hub: great door, sundial puzzle, shortcuts land here|
| 3 | Outer Cliffs      | A    | ×1.5       | open           | Optional: ledges, vines, wind, exposed relics       |
| 4 | Broken Halls      | B    | ×1.6       | roof holes     | Sun-shaft paths, block puzzle, blades, boulder      |
| 5 | Collapsed Sanctum | B    | ×2.0       | half roof      | Main idol under a light beam, noise drops debris    |
| 6 | Lower Catacombs   | C    | ×2.6       | none           | Crumbling floors, darts, flooded chamber            |
| 7 | Deep Vault        | C    | ×3.4       | none           | Heaviest loot, guardians' lair, escape stair        |

### Graph and unlock dependencies

```
 [1 Jungle Approach]
        │  great door (open at dawn; the only way out; closes after dark)
        v
 [2 Temple Courtyard] ──── cliff gate (always open) ────> [3 Outer Cliffs]
   │   ^      ^                                               (dead end, optional)
   │   │      └──── DRAWBRIDGE: lowered by winch on the terrace side ────┐
   │   │                                                                 │
   │ temple portal (always open)                                         │
   v                                                                     │
 [4 Broken Halls] ── SANCTUM DOOR: both pressure plates held ──> [5 Collapsed Sanctum]
   │                  (push the two stone blocks onto them)        ^     │
   │                                                               │     └─ KICK WALL: only
   │ CATACOMB SEAL: needs the SUN DISC                             │        from sanctum side,
   │ (prize of the courtyard sundial puzzle)                       │        leads to terrace
   v                                                               │
 [6 Lower Catacombs] ── VAULT GATE: needs the SERPENT KEY ──> [7 Deep Vault]
                         (on the altar island of the           │
                          flooded chamber)                     └─ ESCAPE STAIR: lever on the
                                                                  vault side opens it; rises
                                                                  into the back of the sanctum
```

| Edge                         | Requirement                                   | Stays open? | Way in or way out |
|------------------------------|-----------------------------------------------|-------------|-------------------|
| Jungle → Courtyard           | none (great door open until dark + 60 s)      | until dark  | in / final exit   |
| Courtyard ↔ Cliffs           | none                                          | always      | optional          |
| Courtyard ↔ Halls            | none                                          | always      | in                |
| Halls ↔ Sanctum              | both plates weighted (blocks stay put)        | yes         | in                |
| Halls → Catacombs            | Sun Disc placed in the seal                   | yes         | in                |
| Catacombs → Vault            | Serpent Key                                   | yes         | in                |
| Vault → Sanctum              | escape-stair lever (vault side only)          | yes         | **out**           |
| Sanctum → Terrace            | kick the cracked wall (sanctum side only)     | yes         | **out**           |
| Terrace → Courtyard          | drawbridge winch (terrace side only)          | yes         | **out**           |

**The escape route is its own design.** The way in is
Courtyard → Halls → Catacombs → Vault. The way out is
Vault → escape stair → Sanctum → kicked wall → terrace → drawbridge → Courtyard → door.
It is shorter than backtracking but runs straight through the unstable sanctum
with a heavy satchel. The vault's plank bridge sheds every plank you stepped
on, so going back the way you came means jumping gaps over a pit.

Once opened, shortcuts are permanent for the run and work both ways, so a fast
player can dive a second time through the sanctum.

At darkness every seal in the temple breaks open (catacomb seal, sanctum door,
vault gate, lair gate) so the guardians can always reach the door. Kick wall,
escape stair and drawbridge only help them if the player opened them.

### Scene by scene

**1 Jungle Approach.** Heightfield terrain, dense instanced vegetation. A river
with a current (stepping stones, or wade and get pushed downstream). A gorge
crossed by the first rope bridge: jointed rigid bodies, each plank cracks and
drops shortly after you step on it, and the whole span snaps loose once you are
across. A handful of cheap relics teach "E to take" and the weight meter.

**2 Temple Courtyard.** Walled plaza, overgrown flagstones, toppled pillars, dry
fountain. Centre: the **sundial puzzle**. A bronze gnomon casts a real shadow;
the player rotates a stone ring until its serpent glyph sits under the shadow.
The target angle is computed from the actual sun direction, so the answer
drifts as the day goes on and the puzzle cannot be solved once the gnomon is in
shade or the sun is down. Reward: the Sun Disc. West side: a stagnant canal
that the terrace drawbridge crosses once lowered. Two sentinel statues flank
the temple portal (they wake last).

**3 Outer Cliffs (optional).** A cliff face over the sea. Ledges, a jump, vine
climbs, a narrow traverse hit by telegraphed wind gusts (crouch or get shoved,
and lose your flame), and a second small plank bridge to a rock spire.
Tier-2 relics sit in plain sight with a ×1.5 multiplier: fast money early if
you have the nerve.

**4 Broken Halls.** Hypostyle hall, roof mostly gone. Three ways north:
- *Central nave*: shortest, but shade scarabs swarm anywhere the sun does not
  touch. Roof beams throw moving shadow bands; the nave is wide open around
  noon and impassable early and late. "Sunlit" is a physics raycast toward the
  sun, the same test the shadows visibly obey.
- *West gallery*: the two-block pressure-plate puzzle for the sanctum door, then
  a corridor of three swinging blades.
- *East gallery*: a ramp with a trapped relic at the top that releases a rolling
  boulder down the only way out.
The catacomb seal is in the north cross hall.

**5 Collapsed Sanctum.** A big square chamber, east half of the ceiling gone, the
rest cracked. Loud actions (sprinting, landing, thrown objects) fill a noise
meter; past the threshold, ceiling blocks fall near the source. The **Dawn
Idol** stands on a dais in a beam of light on a weight-sensing pedestal. Swap
in something of equal weight and nothing happens. Lift it bare and the whole
ceiling starts coming down in a timed **collapse sequence**: the hall door is
buried and the kick wall becomes the only way out.

**6 Lower Catacombs.** Reached by an L-shaped stair so no daylight has line of
sight in. Ossuary hall, then three branches: a crumbling-floor corridor over a
pit to the bone chapel (good loot), a pressure-plate dart corridor to the vault
gate, and the flooded chamber (wadeable shallows, deep holes that put the torch
out, the Serpent Key on a dry altar). A crypt holds a dormant crawler.

**7 Deep Vault.** Stair down, then a chasm with the second plank bridge. The
treasure hall holds the heaviest relics on trapped pedestals. Behind bars to
the west is the guardians' lair: you can see them standing there all day.
South: the lever-operated escape stair up into the sanctum.

## 4. Systems

### Sun, time, lighting
- Day fraction `f = t / 780`. Sun direction
  `(cos πf, sin πf · cos 28°, sin πf · sin 28°)`: rises due east, culminates at
  62° leaning south, sets due west. After `f = 1` a dim moon takes over.
- One shadow-casting directional light follows the sun. Zone B roofs are real
  shadow casters, so the lit patches on the floor move with the sun.
- Colour grading is a post pass keyed on `f`: dawn (rose-gold, lifted shadows),
  noon (neutral, high contrast), sunset (red-orange), night (cold, crushed).
- **Zone C has zero ambient light.** Every Zone C surface uses a "dungeon"
  material whose shader has the directional, hemisphere and ambient terms
  compiled out. Only point lights reach it: the player's torch and torches the
  player put in sconces. No emissive materials, no fog colour, black clear
  colour, sky hidden. Guardians have no glowing eyes. Particles in Zone C are
  tinted by torch distance instead of being self-lit.

### Ticking clock
- HUD stone sundial: a shadow hand sweeps the dial and the lit sector shrinks.
- Tick sound once per second; from 2:00 the interval shortens (1.0 s → 0.3 s)
  and the volume rises.
- 1:00: red edge pulse, music switches to the danger layer, rumble + camera shake.
- 0:00: darkness, seals break, guardian waves, door starts closing (60 s).
- Underground there is no sky: the HUD dial and the sounds are the only clock.

### Torch
| Property        | Base  | Details                                                  |
|-----------------|-------|----------------------------------------------------------|
| Fuel            | 210 s | burns only while lit; upgrades 300 / 420 s               |
| Full radius     | 13 m  | upgrades 16 / 19 m                                       |
| Radius curve    |       | full above 35 % fuel, smoothstep down to 3.5 m at empty  |
| Put out by      |       | water over 1.4 m, wind gusts (unless crouched), hard falls|
| Relight         | 1.6 s | flint animation: slowed, cannot sprint/jump/interact     |
| Fuel flask      | +90 s | `R` to pour                                              |
| Spare torch     | full  | `R` to swap when no flask, or `E` on a sconce to mount it |

Sconce torches burn for the rest of the run and repel shades. The torch is a
shadow-casting point light with flicker. Light is safety from the shade and a
beacon for the sentinel.

### Player
Pointer-lock first person on a kinematic character controller: walk 4.2 m/s,
sprint 6.8, crouch 2.0, jump, crouch, vine climbing, ledge mantling, wading and
swimming. Stamina 100 (sprint 12/s, jump 10, climb 9/s, regen 18/s after 0.8 s).
Health 100 (darts 20, blades 45, scarabs 12/s, boulder/long fall lethal).

Load: `ratio = carried kg / satchel kg`. `speed × (1 − 0.45·ratio^1.5)`,
`stamina drain × (1 + 1.2·ratio)`, `jump × (1 − 0.15·ratio)`.

Props (rocks, skulls, pots, sandbags) can be grabbed, carried, dropped and
thrown. Thrown props make noise where they land (distracts crawlers, shakes the
sanctum), hold pressure plates, and are the counterweights for trapped
pedestals.

### Traps and physics set pieces
| Piece            | Implementation                                                        |
|------------------|-----------------------------------------------------------------------|
| Plank bridges    | rope frame segments chained with revolute joints + planks on fixed joints; stepping on a plank starts a crack timer, then its joint is removed |
| Crumbling floor  | fixed tiles that turn dynamic 0.5 s after being stood on              |
| Rolling boulder  | dynamic sphere held by a kinematic chock, released by its trigger      |
| Pressure plates  | mass-summing sensors (player, blocks, props) with a threshold          |
| Swinging blades  | dynamic pendulums on revolute joints, re-energised at the bottom       |
| Dart traps       | plate-triggered volleys of fast CCD projectiles                        |
| Pushable blocks  | heavy rotation-locked dynamic boxes pushed by the character controller |
| Trapped pedestals| weight sensor: expected kg ± 25 %, 0.35 s grace, else fire linked trap |
| Falling debris   | dynamic blocks dropped by the sanctum noise meter / collapse sequence  |

### Guardians (after dark)
| Type     | Speed          | Senses                                                         | Counterplay                            |
|----------|----------------|----------------------------------------------------------------|----------------------------------------|
| Sentinel | 2.6 m/s, tireless | Sight cone 22 m (7 m if you are unlit); sees a lit torch at 40 m | Break line of sight, douse the torch   |
| Crawler  | 6.0 m/s        | Blind. Hears footsteps, landings, impacts, traps               | Crouch-walk, throw rocks as decoys     |
| Shade    | 4.4 m/s        | Sees in the dark at 30 m. Cannot enter torch or sconce light   | Keep the flame alive, light sconces    |

Shared state machine: Dormant → Waking → Sweep → Investigate → Chase → Search
→ Sweep, plus Repelled for the shade. Spawn waves by depth: vault lair at 0 s,
catacomb crypt 12 s, sanctum 24 s, halls 34 s, courtyard statues 46 s. With no
target they sweep along scene waypoints toward the great door. Movement is
A* + funnel over a rectangle navmesh generated from the level layout, with
gates that follow door state. Contact means the run is lost.

## 5. Relics and economy

`value found = round to 5 ( base value × depth multiplier of the scene )`.

| #  | Relic                     | Base value | Weight kg | Rarity    | Tier (where it can roll)     |
|----|---------------------------|-----------:|----------:|-----------|------------------------------|
| 1  | Clay Offering Bowl        | 40         | 1.0       | common    | 1 (anywhere)                 |
| 2  | Bronze Coin Stack         | 60         | 0.6       | common    | 1                            |
| 3  | Carved Bone Flute         | 90         | 0.3       | common    | 1                            |
| 4  | Obsidian Dagger           | 130        | 0.8       | common    | 1                            |
| 5  | Painted Scroll            | 170        | 0.2       | uncommon  | 1                            |
| 6  | Silver Censer             | 240        | 1.8       | uncommon  | 1                            |
| 7  | Jade Mask                 | 320        | 2.5       | uncommon  | 2 (cliffs, Zone B, Zone C)   |
| 8  | Turquoise Serpent         | 420        | 1.5       | rare      | 2                            |
| 9  | Sun-God Idol              | 480        | 4.0       | uncommon  | 2                            |
| 10 | Ruby Scarab               | 560        | 0.4       | rare      | 2                            |
| 11 | Gem-Studded Urn           | 620        | 6.0       | rare      | 2                            |
| 12 | Golden Death Mask         | 700        | 3.0       | uncommon  | 3 (Zone C only)              |
| 13 | Crystal Skull             | 850        | 2.2       | rare      | 3                            |
| 14 | Moonstone Orb             | 1000       | 1.2       | rare      | 3                            |
| 15 | Crown of the Serpent King | 1300       | 3.5       | epic      | 3                            |
| 16 | Golden Jaguar             | 1700       | 12.0      | epic      | 3                            |
| 17 | Emperor's Coffer          | 2400       | 16.0      | legendary | 3 (vault, fixed spot)        |
| 18 | The Dawn Idol             | 2000       | 8.0       | unique    | sanctum dais only (trapped)  |

Key items (no sale value, consumed by their lock): **Sun Disc** (1.5 kg),
**Serpent Key** (0.5 kg).

Loot is rolled per run from a seed: every relic spot has a tier, and the roll
weights rarity (common 10, uncommon 6, rare 3, epic 1.5, legendary 0.5) and
favours relics whose tier matches the spot.

### Loot value by zone (expected, before the satchel limit)

| Scene             | Spots | Tier pool | Mult | Expected total | Zone total   |
|-------------------|------:|-----------|-----:|---------------:|--------------|
| Jungle Approach   | 4     | 1         | ×1.0 | ~400           |              |
| Temple Courtyard  | 6     | 1         | ×1.0 | ~700           |              |
| Outer Cliffs      | 4     | 2         | ×1.5 | ~2,600         | **A ≈ 3,700**|
| Broken Halls      | 7     | 1–2       | ×1.6 | ~3,400         |              |
| Collapsed Sanctum | 5 + idol | 2      | ×2.0 | ~8,400         | **B ≈ 11,800**|
| Lower Catacombs   | 8     | 2–3       | ×2.6 | ~13,000        |              |
| Deep Vault        | 8 + coffer | 3    | ×3.4 | ~40,000        | **C ≈ 53,000**|

The satchel (20 kg base) is the real cap: a strong first-gear run banks
2–6 k, a fully upgraded deep run 15 k+. Only loot carried out through the
great door is banked. Death, capture or being sealed in forfeits the satchel.

### Shop (between runs, bought with banked coins)

| Gear          | Tier 1            | Tier 2             | Effect                               |
|---------------|-------------------|--------------------|--------------------------------------|
| Bright torch  | 400               | 1,200              | radius 13 → 16 → 19 m                |
| Oil reservoir | 300               | 900                | fuel 210 → 300 → 420 s               |
| Satchel       | 500               | 1,500              | capacity 20 → 28 → 36 kg             |
| Rope          | 350               | 800                | 1 → 2 rope uses per run at anchor points (extra shortcuts) |
| Spare torches | 250               | 600                | start with 1 → 2 → 3 spares          |
| Soft soles    | 700               | —                  | footstep noise −40 %                 |

Saved in `localStorage`: coins, gear tiers, settings, top-10 high scores, and
the best run's recorded path (ghost).

## 6. UI

- **HUD**: stone sundial clock, stamina bar, health, weight (kg / capacity),
  torch fuel, running loot value, interaction prompt, held-object readout,
  objective hint, toast log.
- **Menus**: main (start, shop, high scores, settings, controls), pause,
  settings (FOV, sensitivity, volume, graphics quality), results (haul value,
  time, relics found, outcome).
- **Debug overlay (F3)**: FPS, frame ms, physics body count, current scene,
  loaded scenes, draw calls, triangles, position, time left.
- **Map (M)**: hand-drawn parchment map that fills in as you explore.

## 7. Audio (all WebAudio synthesis)

Jungle ambience (wind, birds, insects, river), dusk rumbles, clock tick,
wood creak and snap, stone grinding, torch crackle, per-type guardian calls,
proximity heartbeat, footsteps by surface, splashes, darts, relic chimes, and
a generative music bed with a calm layer and a danger layer.

## 8. Stretch goals planned

1. Fill-in map (M). 2. Idol collapse sequence. 3. Ghost of the best run.
4. Gamepad support.

## 9. Controls

| Action                  | Keyboard / mouse      | Gamepad            |
|-------------------------|-----------------------|--------------------|
| Move / look             | WASD / mouse          | left / right stick |
| Sprint                  | Shift                 | LT or L3           |
| Jump, mantle, climb off | Space                 | A                  |
| Crouch                  | C (toggle), Ctrl (hold)| B                 |
| Interact / take / grab  | E                     | X                  |
| Throw held object       | Left mouse            | RT                 |
| Drop held object        | Right mouse or G      | RB                 |
| Drop last relic         | Q                     | LB                 |
| Torch light / douse     | F                     | Y                  |
| Refuel / spare torch    | R                     | D-pad up           |
| Map                     | M or Tab              | Back               |
| Pause                   | Esc                   | Start              |
| Debug overlay           | F3                    | —                  |
