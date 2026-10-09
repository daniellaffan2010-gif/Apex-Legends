# Refactor notes

The refactor source is `legacy/original.html`, a byte-for-byte copy of
`apex-rivals-26.html`. `legacy/original-export.html` is a copy of the offline
export `Apex Rivals 26.html`. Neither original in the project root was edited.

## What changed while moving the code (mechanical only)

- **Live bindings.** ES imports are read-only, so values written from other
  modules got a setter in the module that owns them: `setS` and `setPaused`
  (game/session.js), `setB3` and `setTEXBUDGET` (render2d/props.js). Only the
  assignment syntax changed, for example `S = null` became `setS(null)`.
- **`"use strict"`** was dropped from the 8 script blocks. Modules are always
  strict, and all 8 original blocks were strict already.
- **three.js** is imported as `import * as THREE from 'three'` (the npm
  package `three@0.128.0`, byte-identical to the cdnjs r128 build) in each
  module that uses it. Nothing relies on a global `THREE`.
- **Fonts.** The Google Fonts `<link>` became `src/fonts.css` with
  `@fontsource` 5.3.0 files, so the build makes no requests. They are the same
  families, weights and unicode ranges, but the font file versions may differ
  slightly from what Google serves.
- **Sounds.** `apex-rivals-26.html` points at `sounds/gun.mp3` and
  `sounds/radio.mp3`, but there is no `sounds/` folder, so those two clips
  never played in that file. Only the export had them, as data URIs. The two
  files in `src/audio/samples/` were decoded from the export, so the new build
  behaves like the export here, not like the bare source file.
- **No doctype.** The original has none and runs in quirks mode. `index.html`
  keeps it that way on purpose. Adding `<!doctype html>` could shift layout.
- **Script timing.** The original's game scripts all come after the markup,
  so running them as one deferred module gives the same order.

## Checks done (outside the browser)

- Line-level comparison of all original script lines against `src/`. The only
  differences are the setters, the `"use strict"` lines, the track objects
  becoming named `const`s, and the sound URLs. No numbers changed.
- `src/styles.css` is identical to the original `<style>` block.
- The `index.html` markup matches the original apart from the
  `<html>/<head>/<body>` wrappers and the font links.
- Earlier commits: byte-for-byte reassembly of the script lines, 160 top-level
  values deep-equal to the original (elevation, camber and banking sampled at
  201 points per track), and a Node smoke boot.
- `npm run build` gives a single `dist/index.html` (about 3.1 MB). The only
  URLs in it are comments inside three.js.

## Not done here: browser testing

These could not be run from the coding session. The sandbox stops local dev
servers, and the Chrome extension isn't available on this machine. Please
check:

1. `npm run dev`: the title screen loads and the console shows no errors.
2. Quick race on each of the 12 tracks: the scene loads and the default
   camera matches `legacy/original-export.html` (open it side by side).
3. The car drives (arrow keys), the HUD speed rises, and AI cars race.
4. Pit stop: press `P`, drive into the pit lane, the pit menu appears, and
   "Go" and "Skip" both work.
5. Championship, time trial, standings, pause/restart/quit, and the `#carview`
   page.
6. 2D fallback: open the game in a browser with WebGL turned off and
   confirm the 2D canvas renderer runs.
7. `npm run build`, then double-click `dist/index.html` with the network
   off.

## Left alone

- `Racing Game/`: a stray nested git repo (only `.gitattributes`), ignored in
  `.gitignore`.
- `.claude/` (Claude Code's local settings, untracked) and `src/.claude/` (an
  empty folder Claude Code created, which git ignores).
- `harness.js` is in `.gitignore` for the old browser test rig, which is
  copied in only while testing.
- No gameplay bugs were found during the move, and none were fixed.

## Changes after the refactor (deliberate)

- **Zandvoort camera:** `zoomK:1.3` added to `src/tracks/zandvoort.js`. The
  original framed it too far out because the track is narrow (13.4 m) and had
  no close-up factor. It now uses the same per-track `zoomK` mechanism as
  Monaco (1.45) and Las Vegas (0.8).

# Suzuka: the real circuit, and how the game's layout compares

Researched 2026-10-03 for the Suzuka greenery work. Nothing in the layout,
elevation, banking or pit settings was changed because of what follows. Every
mismatch below is waiting for a decision.

## What the real circuit is

Sources: Wikipedia (*Suzuka International Racing Course*), OpenStreetMap
raceway ways (queried through Overpass, chained into one lap), SRTM 30 m and
ASTER 30 m heights through OpenTopoData, and the Mie Prefecture tea pages.

- **Layout.** 5.807 km, 18 turns, run clockwise. It is a figure of eight: the
  1.2 km back straight runs over the first part of the lap on an overpass. The
  OSM ways chain into a 5,796 m loop, so the map agrees to within 0.2 %.
- **Corners, in order** (OSM names in brackets where the sponsor name differs):
  Turn 1 and Turn 2 (First / Second Turn), the S Curves (Esses), the Gyaku
  (reverse-bank) Curve, Dunlop Curve (mapped as "NIPPO Corner"), Degner 1 and
  Degner 2, under the bridge, the Hairpin (NISSIN Brake Hairpin), the long
  right (200R), Spoon Curve (two left apexes), the West/back straight, over the
  bridge, 130R (left), the Casio Triangle chicane (mapped as "Hitachi Astemo
  Chicane"), the last right, then the main straight.
- **The crossover.** The OSM way just before 130R carries `bridge=yes,
  layer=1`, so the back straight goes over. The road underneath is the link
  from Degner 2 to the Hairpin.
- **Pits and park.** The pit lane runs along the right-hand side of the main
  straight, the same side Turn 1 turns towards. The Ferris wheel ("Circuit
  Wheel", サーキットホイール) stands about 140 m to the left of the start of the
  main straight, inside the Motopia amusement park. Motopia covers the area
  north-east of the main straight, behind the main grandstand, across the
  track from the pits.
- **Height.** F1 teams quote about 40 m of elevation change. The SRTM samples
  along the lap agree. They are noisy because SRTM measures the top of the
  trees, so read these as ±5 m:
  - main straight about 50 m, falling to Turn 1 and Turn 2 (about 20 m)
  - the low point is Turn 2 and the entry to the Esses, about 16–20 m
  - the first sector **climbs** through the Esses to Dunlop (about 40 m) and
    Degner (about 45 m)
  - the Hairpin is about level with Degner (about 44 m)
  - it climbs again through 200R to Spoon, the highest part of the lap (about
    55–60 m)
  - the back section **drops** gently along the back straight and through 130R
    (about 47–50 m), and the chicane and main straight are about 50 m
- **Surroundings.** OSM around the circuit is mostly `landuse=forest` and
  `natural=wood` (about 130 polygons), with 54 scrub patches. Ponds sit in the
  infield and around Motopia, there are drains east of the first sector, and
  streams run in the valleys to the south. Farmland lies further out to the
  east, west and north, with a few orchards to the south-east. Suzuka City is
  an Ise-cha (kabuse tea) growing area at the foot of the Suzuka mountain
  range to the west, with Ise Bay to the east.
- **Sakura.** Since 2024 the Japanese GP has been held in early April, and the
  cherry blossom season is part of the race's look.

## Not confirmed

- **Tree species.** OSM does not say what grows in the woods. Planted sugi
  (cedar) and hinoki (cypress), with secondary broadleaf and bamboo, is typical
  of Mie lowland hills, but I could not confirm it for the circuit grounds.
- **The Ferris wheel's height and diameter.** I found no published figure. It
  is built at about 50 m.
- **Run-off surfaces.** Where the real circuit has gravel and where it has
  asphalt, corner by corner, was not confirmed from a primary source. Wikipedia
  only gives Dunlop's run-off growing from 12 m to 25 m.
- **Paddies and tea fields.** Their exact positions round the circuit were not
  confirmed (OSM farmland is not tagged with crops). Where they are placed in
  the game is invented.
- **Streams and ditches.** Their exact courses were not used either. The pond
  and ditch in the game are placed by eye.

## The layout: rebuilt from the survey (fixed 2026-10-03, on request)

Suzuka used to be built from the turtle DSL. Against the OSM centreline it was
274 m RMS off, and it had five problems:
1. **Mirrored.** The DSL's turtle treats y as pointing up, but the game draws y
   pointing south, so the lap ran counter-clockwise on screen. This still
   applies to every other DSL-built circuit.
2. **Two wrong crossings.** Degner went over 200R, and 130R went over the
   stretch after Turn 2.
3. **Proportions.** Every radius was stretched ×1.516, for example "130R" at
   199 m.
4. **Heights.** A 26 m range, with the Hairpin at the bottom of the lap.
5. **Set dressing.** The grandstand and the wheel were on the pit side.

It is now built like Silverstone and Zandvoort, from a survey baked into
`src/tracks/survey/suzuka.js`:

- **Path.** The OSM raceway ways chained into one lap: 731 points, x east and
  y south, clockwise, starting at the line. Long map segments are split to
  10 m, so the spline cannot overshoot; the 242 m run under the bridge to the
  Hairpin had made a cusp at Degner 2. Built with `smooth:3`, the lap comes out
  at 5,808 m (real: 5,807 m). Lined up against the OSM centreline it is now
  **2.4 m RMS** off, with no rotation and no mirroring.
- **Heights.** The GSI 5 m laser DEM (bare earth), every 25 m: 231 samples,
  17.1–57.8 m above sea level, used as 0–40.7 m over the lowest point.
  - The main straight falls about 38 m from the chicane to Turn 1, the lowest
    point.
  - The Esses climb to Dunlop and Degner.
  - The Hairpin is level with Degner.
  - Spoon is the top of the lap.
  - The back straight drops gently through 130R.
- **One crossing**, at lap 0.808–0.831. The back straight goes over the
  Degner→Hairpin link (49.6 m against 43.5 m in the DEM, with the builder's
  usual bump to 8.5 m clearance), and the 3D world gives it an open span on
  piers.
- **Pits** on the right, as mapped: in just after the chicane (0.9227), out at
  Turn 1 (0.077). The box is the default. Width and gap are unchanged.
- **Corners**, by lap fraction from the line:
  - Turn 1 0.077–0.102, Turn 2 0.107–0.129
  - S Curves 0.154–0.219, Gyaku 0.226–0.253, Dunlop 0.263–0.327
  - Degner 1 0.364, Degner 2 0.390
  - Hairpin 0.468–0.481, Spoon 0.622–0.670, West straight 0.670–0.816
  - 130R 0.823–0.861, chicane 0.897–0.917
- **Gravel zones and grandstands** were re-keyed to those corners and the
  outside of each.
  - Stands are asked for at 30 m off the centreline. The scene placer needs
    half width + 20 m, so at the old 24 m every stand had been pushed out to
    50–70 m.
  - The main stand is 200 m wide (it was 240), so it clears the final curve.
  - The chicane stand moved to the 130R exit, where it fits.
- **The Ferris wheel** stands where OSM maps it, 88 m left of the main straight
  at lap 0.959 (within 2 m).
- **Not surveyed.** The start line is put half way along the pit lane. OSM
  has no line node, so this is a guess.
- **Lap feel.** An AI car laps the real circuit in about 103.5 s, against about
  95 s on the old DSL layout. The real corners are tighter than the stretched
  ones were.
- **Best laps.** Stored best laps for Suzuka were set on the old layout.

# Suzuka greenery (2026-10-03)

## What was built

The world lives in `src/render3d/worlds/suzuka.js`. Everything it decides is in
`suzuka-plan.js`, which is pure JS (no three.js, no DOM), so the plan and its
clearance audit run in Node.

- **Ground.** A vertex-coloured terrain grid at 8 m, split into 90 tiles so it
  can be culled. Near the circuit, the height comes from the road itself,
  interpolated along each segment (not snapped to the nearest node). Further
  out it eases into an inverse-distance blend of the lap's heights, then rolling
  hills (low-frequency noise growing with distance) and a gentle rise away from
  the track. It is smoothed three times; the verges stay exact. Where two
  different parts of the lap are close, the lower road keeps its ground out
  past one grid diagonal, so no ground triangle can climb onto its verge. That
  happens at the crossing and where 200R runs beside the West straight. A
  segment of the same stretch of road (within 14 nodes) never counts.
- **Ground colour.**
  - open grass in two greens, with mown fresh green near the track
  - darker forest floor wherever trees were actually planted
  - canopy colour further out, past where trees are thinned out
  - mossy banks on slopes, bare earth or a concrete cut where it is very steep
  - worn dirt and gravel patches
  - paddock grey behind the pits
  - paddy bunds and tea-field soil
  - a world-space grain over all of it
- **Verges.** Mown stripes over the plain run-off and the 6 m grass strip past
  it, plus a 2 m tarmac apron behind the kerbs.
- **Trees.** Each species is low-poly and coloured per vertex: darker
  underneath, lighter on top, with a lighter trunk.
  - sugi (4 tiers) and hinoki (3 rounder tiers) make up most of the forest
  - broadleaf (3 lumps, 3 tint families)
  - sakura (a forked trunk and a wide pink-white cloud)
  - momiji (red, orange or spring green)
  - bamboo clumps on banks and forest edges

  Every instance varies in height, width and rotation. It gets a tint from its
  species' range, and leans slightly downhill on a slope. One shared material
  takes the tint only where the vertex mask says so, so trunks keep their
  colour, and adds a gentle wind sway.
- **Forest structure.** Groves and clearings come from low-frequency noise.
  - Belts thicken behind the barriers and thin toward the track.
  - Taller conifer plantations stand on higher ground, with mixed broadleaf
    lower down.
  - The back section (lap 0.62–0.87, Spoon to 130R) starts closer and denser.
  - Where things are on the lap comes from `zones` in the track definition.
  - Density falls to 62 % past 230 m from the barrier, 30 % past 430 m and none
    past 600 m. Past 230 m the trees use a cheaper model with no shadow. The
    overhead camera never sees much more than about 450 m off the track.
- **Sakura** are planted only in clusters:
  - behind the main grandstands and on into the park
  - an avenue down the back straight
  - round every other grandstand
  - pairs along the park paths
- **Lower planting.** Azalea runs along the fences in front of the crowds,
  down the main straight and through the back section, in pink, white and
  red. There are shrubs on the verges, wild flowers in clearings and
  flowering hedges along the park paths.
- **Farmland, 170–520 m out.** About 40 flooded paddies, each levelled into
  its own terrace, and tea fields of rounded rows laid along the contour.
- **Water.** A pond in the first sector's infield, and a drainage ditch out of
  it behind the verge. The pond sits at the low point, so a stream had nowhere
  to run.
- **The park (Motopia-style, made-up).** It sits across the main straight from
  the pits, behind the main grandstands, round the Ferris wheel at its mapped
  spot.
  - pavilions with dark hip roofs and deep eaves, kiosks and a carousel
  - gravel paths linking them to the grandstands
  - paper lanterns, and nobori banners in plain colours with no text
  - a 52 m Ferris wheel facing the camera, turning once every 5 minutes, with
    gondolas that hang level. It fades out of the way like the other big props.
- **Bridges and walls.** Where a road stands clear of the ground is decided
  from the ground actually under it, not from the track's bridge flag.
  - Over the other road's tarmac, it gets an open span: slab, fascia, a red
    band, parapet, pier caps and columns. That is only the real crossing.
  - Elsewhere it gets a retaining wall down each side to the ground: the
    crossing's approaches, 200R above the West straight, and short low walls by
    Turn 2 and the Hairpin.
- **Camera towers** (scaffold, platform, hut) stand among the trees outside
  the Esses, Dunlop, Degner, Hairpin, Spoon, 130R and the chicane, where they
  fit.
- **Gravel traps** (`runoffZones`) sit on the outside of Turn 1 and 2 (asphalt
  then gravel), Dunlop, Degner 1 and 2, Spoon, and 130R (asphalt then gravel).
  Widths are unchanged, so the barriers did not move.
- **Atmosphere.** A warmer sun (`#FFEBCF`, 1.12), a warmer green hemisphere
  ground colour, and a blue-grey haze. The fog now starts 60 m in front of the
  camera's target distance instead of 120 m behind it, and builds over 2,550 m
  instead of 1,700 m. That is about 9 % haze at the top of the frame and none
  at the bottom.
- **Petals.** 700 cherry petals (one draw) drift round the groves nearest the
  car. They are off on "Lite".
- **Quality setting.** The existing *Full detail / Lite* option (`CFG.detail`)
  now also controls Suzuka's planting. Lite has about 56 % of the trees, half
  the tea, no wild flowers and no petals.

## Changes outside the Suzuka files

- `src/tracks/build.js`: a new run-off surface code, `plain` (6). `surfAt`
  returns `"runoff"` for it.
- `src/car/physics.js`: `"runoff"` maps to `SURF.runoff`. Suzuka's grip
  everywhere outside the five gravel zones is therefore exactly what it was;
  only the gravel zones are new. No other circuit uses `plain`.
- `src/render3d/build.js`:
  - Suzuka brings its own ground (no generic plane, land patches or hillside
    walls), and its `only2d` props are skipped in 3D.
  - Plain run-off gets a tarmac apron.
  - It calls `SUZUKA.build`.
- `src/render3d/frame.js`: calls `SUZUKA.frame`. A world may set `fogNear` and
  `fogSpanK` (both reset on every build). The camera code is untouched.
- `src/tracks/suzuka.js`: now the surveyed path, heights and pits
  (`path`, `elev`, `smooth:3`, `pit`).
  - `world:"suzuka"`, `runoffSurf:"plain"`, the gravel zones and `zones`
  - the old prop trees, Ferris wheel and funfair are `only2d`, so the 2D
    fallback still has them
  - the scene is re-keyed to the real corners
  - the old DSL is kept as `layoutDSL`, unused
- `src/tracks/survey/suzuka.js`: new, the baked lap and heights.

## Checks (Node, no browser), on the surveyed lap

- **Clearance audit** (`auditSuzuka`), exact distance to every segment of the
  lap: of 44,300 plants (Lite: about 25,000), **0** are on the track, **0** in
  the run-off, **0** within 2.5 m past a barrier, **0** in a footprint
  (grandstands, marshal posts, pylons, billboards, arches, pit building,
  garages, park, wheel, towers, pond) and **0** within 3 m of the racing line.
  The closest is a shrub 3.9 m past the armco.
- **Ground against the road ribbons**, 30,710 samples across every node, read
  triangle by triangle as the mesh draws it: **0** where the ground comes
  through a ribbon, **0** where a verge floats unsupported.
- **Gravel zones**: all five are on the outside of their corners. None is on
  the bridge.
- **An AI car** (headless, same `driveAI` and `Car.step` as the game) did three
  laps: 103.4 s, 103.6 s and 104.0 s, with 0 s off the road and 0 s in gravel.
  It never stalled or wrecked, and its lowest speed was 21 m/s (the Hairpin).
- **Build time**: the plan takes about 0.4–0.5 s and the whole Suzuka world
  about 0.5–0.6 s.
- **Every other circuit builds exactly as before.** Same mesh, instanced-chunk,
  instance, triangle and shadow-caster counts as `main`, all 11 of them.
- `npm run build` gives one `dist/index.html` (3.17 MB).
- **Scene census.** Draws and triangles that fall in a 340 × 260 m window round
  each named corner, roughly the default view. World matrices are updated
  first; an earlier version of this table was wrong without that. For
  instanced meshes, only the instances inside the window are counted.
  "Before" is `main`, on the old layout at its own corner positions; "after" is
  the surveyed lap.

| View | before | after, Full detail | after, Lite |
|---|---|---|---|
| Main straight | 196 / 73k | 156 / 80k | 147 / 69k |
| Esses | 131 / 77k | 149 / 106k | 139 / 82k |
| Degner | 116 / 76k | 166 / 123k | 159 / 89k |
| Hairpin | 119 / 70k | 112 / 128k | 102 / 91k |
| Spoon | 96 / 70k | 135 / 156k | 124 / 112k |
| 130R | 144 / 73k | 200 / 122k | 196 / 95k |
| Casio | 159 / 75k | 153 / 66k | 144 / 57k |

The "before" figures include the old single ground plane (45k triangles),
which was always drawn whole. Part of the extra draws at Degner and 130R are
the generic armco posts, one mesh each, as on every armco circuit: on the real
lap there is more road in those windows.

## Not done here: browser testing

These could not be run from the coding session. The sandbox stops local dev
servers, and the Chrome extension isn't available on this machine. Please
check:

1. `npm run dev`: the title screen loads and the console shows no errors.
2. Quick race on each of the 12 tracks: the scene loads and the default
   camera matches `legacy/original-export.html` (open it side by side).
3. The car drives (arrow keys), the HUD speed rises, and AI cars race.
4. Pit stop: press `P`, drive into the pit lane, the pit menu appears, and
   "Go" and "Skip" both work.
5. Championship, time trial, standings, pause/restart/quit, and the `#carview`
   page.
6. 2D fallback: open the game in a browser with WebGL turned off and
   confirm the 2D canvas renderer runs.
7. `npm run build`, then double-click `dist/index.html` with the network
   off.

## Left alone

- `Racing Game/`: a stray nested git repo (only `.gitattributes`), ignored in
  `.gitignore`.
- `.claude/` (Claude Code's local settings, untracked) and `src/.claude/` (an
  empty folder Claude Code created, which git ignores).
- `harness.js` is in `.gitignore` for the old browser test rig, which is
  copied in only while testing.
- No gameplay bugs were found during the move, and none were fixed.

## Changes after the refactor (deliberate)

- **Zandvoort camera:** `zoomK:1.3` added to `src/tracks/zandvoort.js`. The
  original framed it too far out because the track is narrow (13.4 m) and had
  no close-up factor. It now uses the same per-track `zoomK` mechanism as
  Monaco (1.45) and Las Vegas (0.8).

# Suzuka: the real circuit, and how the game's layout compares

Researched 2026-10-03 for the Suzuka greenery work. Nothing in the layout,
elevation, banking or pit settings was changed because of what follows. Every
mismatch below is waiting for a decision.

## What the real circuit is

Sources: Wikipedia (*Suzuka International Racing Course*), OpenStreetMap
raceway ways (queried through Overpass, chained into one lap), SRTM 30 m and
ASTER 30 m heights through OpenTopoData, and the Mie Prefecture tea pages.

- **Layout.** 5.807 km, 18 turns, run clockwise. It is a figure of eight: the
  1.2 km back straight runs over the first part of the lap on an overpass. The
  OSM ways chain into a 5,796 m loop, so the map agrees to within 0.2 %.
- **Corners, in order** (OSM names in brackets where the sponsor name differs):
  Turn 1 and Turn 2 (First / Second Turn), the S Curves (Esses), the Gyaku
  (reverse-bank) Curve, Dunlop Curve (mapped as "NIPPO Corner"), Degner 1 and
  Degner 2, under the bridge, the Hairpin (NISSIN Brake Hairpin), the long
  right (200R), Spoon Curve (two left apexes), the West/back straight, over the
  bridge, 130R (left), the Casio Triangle chicane (mapped as "Hitachi Astemo
  Chicane"), the last right, then the main straight.
- **The crossover.** The OSM way just before 130R carries `bridge=yes,
  layer=1`, so the back straight goes over. The road underneath is the link
  from Degner 2 to the Hairpin.
- **Pits and park.** The pit lane runs along the right-hand side of the main
  straight, the same side Turn 1 turns towards. The Ferris wheel ("Circuit
  Wheel", サーキットホイール) stands about 140 m to the left of the start of the
  main straight, inside the Motopia amusement park. Motopia covers the area
  north-east of the main straight, behind the main grandstand, across the
  track from the pits.
- **Height.** F1 teams quote about 40 m of elevation change. The SRTM samples
  along the lap agree. They are noisy because SRTM measures the top of the
  trees, so read these as ±5 m:
  - main straight about 50 m, falling to Turn 1 and Turn 2 (about 20 m)
  - the low point is Turn 2 and the entry to the Esses, about 16–20 m
  - the first sector **climbs** through the Esses to Dunlop (about 40 m) and
    Degner (about 45 m)
  - the Hairpin is about level with Degner (about 44 m)
  - it climbs again through 200R to Spoon, the highest part of the lap (about
    55–60 m)
  - the back section **drops** gently along the back straight and through 130R
    (about 47–50 m), and the chicane and main straight are about 50 m
- **Surroundings.** OSM around the circuit is mostly `landuse=forest` and
  `natural=wood` (about 130 polygons), with 54 scrub patches. Ponds sit in the
  infield and around Motopia, there are drains east of the first sector, and
  streams run in the valleys to the south. Farmland lies further out to the
  east, west and north, with a few orchards to the south-east. Suzuka City is
  an Ise-cha (kabuse tea) growing area at the foot of the Suzuka mountain
  range to the west, with Ise Bay to the east.
- **Sakura.** Since 2024 the Japanese GP has been held in early April, and the
  cherry blossom season is part of the race's look.

## Not confirmed

- **Tree species.** OSM does not say what grows in the woods. Planted sugi
  (cedar) and hinoki (cypress), with secondary broadleaf and bamboo, is typical
  of Mie lowland hills, but I could not confirm it for the circuit grounds.
- **The Ferris wheel's height and diameter.** I found no published figure. It
  is built at about 50 m.
- **Run-off surfaces.** Where the real circuit has gravel and where it has
  asphalt, corner by corner, was not confirmed from a primary source. Wikipedia
  only gives Dunlop's run-off growing from 12 m to 25 m.
- **Paddies and tea fields.** Their exact positions round the circuit were not
  confirmed (OSM farmland is not tagged with crops). Where they are placed in
  the game is invented.
- **Streams and ditches.** Their exact courses were not used either. The pond
  and ditch in the game are placed by eye.

## The layout: rebuilt from the survey (fixed 2026-10-03, on request)

Suzuka used to be built from the turtle DSL. Against the OSM centreline it was
274 m RMS off, and it had five problems:
1. **Mirrored.** The DSL's turtle treats y as pointing up, but the game draws y
   pointing south, so the lap ran counter-clockwise on screen. This still
   applies to every other DSL-built circuit.
2. **Two wrong crossings.** Degner went over 200R, and 130R went over the
   stretch after Turn 2.
3. **Proportions.** Every radius was stretched ×1.516, for example "130R" at
   199 m.
4. **Heights.** A 26 m range, with the Hairpin at the bottom of the lap.
5. **Set dressing.** The grandstand and the wheel were on the pit side.

It is now built like Silverstone and Zandvoort, from a survey baked into
`src/tracks/survey/suzuka.js`:

- **Path.** The OSM raceway ways chained into one lap: 731 points, x east and
  y south, clockwise, starting at the line. Long map segments are split to
  10 m, so the spline cannot overshoot; the 242 m run under the bridge to the
  Hairpin had made a cusp at Degner 2. Built with `smooth:3`, the lap comes out
  at 5,808 m (real: 5,807 m). Lined up against the OSM centreline it is now
  **2.4 m RMS** off, with no rotation and no mirroring.
- **Heights.** The GSI 5 m laser DEM (bare earth), every 25 m: 231 samples,
  17.1–57.8 m above sea level, used as 0–40.7 m over the lowest point.
  - The main straight falls about 38 m from the chicane to Turn 1, the lowest
    point.
  - The Esses climb to Dunlop and Degner.
  - The Hairpin is level with Degner.
  - Spoon is the top of the lap.
  - The back straight drops gently through 130R.
- **One crossing**, at lap 0.808–0.831. The back straight goes over the
  Degner→Hairpin link (49.6 m against 43.5 m in the DEM, with the builder's
  usual bump to 8.5 m clearance), and the 3D world gives it an open span on
  piers.
- **Pits** on the right, as mapped: in just after the chicane (0.9227), out at
  Turn 1 (0.077). The box is the default. Width and gap are unchanged.
- **Corners**, by lap fraction from the line:
  - Turn 1 0.077–0.102, Turn 2 0.107–0.129
  - S Curves 0.154–0.219, Gyaku 0.226–0.253, Dunlop 0.263–0.327
  - Degner 1 0.364, Degner 2 0.390
  - Hairpin 0.468–0.481, Spoon 0.622–0.670, West straight 0.670–0.816
  - 130R 0.823–0.861, chicane 0.897–0.917
- **Gravel zones and grandstands** were re-keyed to those corners and the
  outside of each.
  - Stands are asked for at 30 m off the centreline. The scene placer needs
    half width + 20 m, so at the old 24 m every stand had been pushed out to
    50–70 m.
  - The main stand is 200 m wide (it was 240), so it clears the final curve.
  - The chicane stand moved to the 130R exit, where it fits.
- **The Ferris wheel** stands where OSM maps it, 88 m left of the main straight
  at lap 0.959 (within 2 m).
- **Not surveyed.** The start line is put half way along the pit lane. OSM
  has no line node, so this is a guess.
- **Lap feel.** An AI car laps the real circuit in about 103.5 s, against about
  95 s on the old DSL layout. The real corners are tighter than the stretched
  ones were.
- **Best laps.** Stored best laps for Suzuka were set on the old layout.

# Suzuka greenery (2026-10-03)

## What was built

The world lives in `src/render3d/worlds/suzuka.js`. Everything it decides is in
`suzuka-plan.js`, which is pure JS (no three.js, no DOM), so the plan and its
clearance audit run in Node.

- **Ground.** A vertex-coloured terrain grid at 8 m, split into 90 tiles so it
  can be culled. Near the circuit, the height comes from the road itself,
  interpolated along each segment (not snapped to the nearest node). Further
  out it eases into an inverse-distance blend of the lap's heights, then rolling
  hills (low-frequency noise growing with distance) and a gentle rise away from
  the track. It is smoothed three times; the verges stay exact. Where two
  different parts of the lap are close, the lower road keeps its ground out
  past one grid diagonal, so no ground triangle can climb onto its verge. That
  happens at the crossing and where 200R runs beside the West straight. A
  segment of the same stretch of road (within 14 nodes) never counts.
- **Ground colour.**
  - open grass in two greens, with mown fresh green near the track
  - darker forest floor wherever trees were actually planted
  - canopy colour further out, past where trees are thinned out
  - mossy banks on slopes, bare earth or a concrete cut where it is very steep
  - worn dirt and gravel patches
  - paddock grey behind the pits
  - paddy bunds and tea-field soil
  - a world-space grain over all of it
- **Verges.** Mown stripes over the plain run-off and the 6 m grass strip past
  it, plus a 2 m tarmac apron behind the kerbs.
- **Trees.** Each species is low-poly and coloured per vertex: darker
  underneath, lighter on top, with a lighter trunk.
  - sugi (4 tiers) and hinoki (3 rounder tiers) make up most of the forest
  - broadleaf (3 lumps, 3 tint families)
  - sakura (a forked trunk and a wide pink-white cloud)
  - momiji (red, orange or spring green)
  - bamboo clumps on banks and forest edges

  Every instance varies in height, width and rotation. It gets a tint from its
  species' range, and leans slightly downhill on a slope. One shared material
  takes the tint only where the vertex mask says so, so trunks keep their
  colour, and adds a gentle wind sway.
- **Forest structure.** Groves and clearings come from low-frequency noise.
  - Belts thicken behind the barriers and thin toward the track.
  - Taller conifer plantations stand on higher ground, with mixed broadleaf
    lower down.
  - The back section (lap 0.62–0.87, Spoon to 130R) starts closer and denser.
  - Where things are on the lap comes from `zones` in the track definition.
  - Density falls to 62 % past 230 m from the barrier, 30 % past 430 m and none
    past 600 m. Past 230 m the trees use a cheaper model with no shadow. The
    overhead camera never sees much more than about 450 m off the track.
- **Sakura** are planted only in clusters:
  - behind the main grandstands and on into the park
  - an avenue down the back straight
  - round every other grandstand
  - pairs along the park paths
- **Lower planting.** Azalea runs along the fences in front of the crowds,
  down the main straight and through the back section, in pink, white and
  red. There are shrubs on the verges, wild flowers in clearings and
  flowering hedges along the park paths.
- **Farmland, 170–520 m out.** About 40 flooded paddies, each levelled into
  its own terrace, and tea fields of rounded rows laid along the contour.
- **Water.** A pond in the first sector's infield, and a drainage ditch out of
  it behind the verge. The pond sits at the low point, so a stream had nowhere
  to run.
- **The park (Motopia-style, made-up).** It sits across the main straight from
  the pits, behind the main grandstands, round the Ferris wheel at its mapped
  spot.
  - pavilions with dark hip roofs and deep eaves, kiosks and a carousel
  - gravel paths linking them to the grandstands
  - paper lanterns, and nobori banners in plain colours with no text
  - a 52 m Ferris wheel facing the camera, turning once every 5 minutes, with
    gondolas that hang level. It fades out of the way like the other big props.
- **Bridges and walls.** Where a road stands clear of the ground is decided
  from the ground actually under it, not from the track's bridge flag.
  - Over the other road's tarmac, it gets an open span: slab, fascia, a red
    band, parapet, pier caps and columns. That is only the real crossing.
  - Elsewhere it gets a retaining wall down each side to the ground: the
    crossing's approaches, 200R above the West straight, and short low walls by
    Turn 2 and the Hairpin.
- **Camera towers** (scaffold, platform, hut) stand among the trees outside
  the Esses, Dunlop, Degner, Hairpin, Spoon, 130R and the chicane, where they
  fit.
- **Gravel traps** (`runoffZones`) sit on the outside of Turn 1 and 2 (asphalt
  then gravel), Dunlop, Degner 1 and 2, Spoon, and 130R (asphalt then gravel).
  Widths are unchanged, so the barriers did not move.
- **Atmosphere.** A warmer sun (`#FFEBCF`, 1.12), a warmer green hemisphere
  ground colour, and a blue-grey haze. The fog now starts 60 m in front of the
  camera's target distance instead of 120 m behind it, and builds over 2,550 m
  instead of 1,700 m. That is about 9 % haze at the top of the frame and none
  at the bottom.
- **Petals.** 700 cherry petals (one draw) drift round the groves nearest the
  car. They are off on "Lite".
- **Quality setting.** The existing *Full detail / Lite* option (`CFG.detail`)
  now also controls Suzuka's planting. Lite has about 56 % of the trees, half
  the tea, no wild flowers and no petals.

## Changes outside the Suzuka files

- `src/tracks/build.js`: a new run-off surface code, `plain` (6). `surfAt`
  returns `"runoff"` for it.
- `src/car/physics.js`: `"runoff"` maps to `SURF.runoff`. Suzuka's grip
  everywhere outside the five gravel zones is therefore exactly what it was;
  only the gravel zones are new. No other circuit uses `plain`.
- `src/render3d/build.js`:
  - Suzuka brings its own ground (no generic plane, land patches or hillside
    walls), and its `only2d` props are skipped in 3D.
  - Plain run-off gets a tarmac apron.
  - It calls `SUZUKA.build`.
- `src/render3d/frame.js`: calls `SUZUKA.frame`. A world may set `fogNear` and
  `fogSpanK` (both reset on every build). The camera code is untouched.
- `src/tracks/suzuka.js`: now the surveyed path, heights and pits
  (`path`, `elev`, `smooth:3`, `pit`).
  - `world:"suzuka"`, `runoffSurf:"plain"`, the gravel zones and `zones`
  - the old prop trees, Ferris wheel and funfair are `only2d`, so the 2D
    fallback still has them
  - the scene is re-keyed to the real corners
  - the old DSL is kept as `layoutDSL`, unused
- `src/tracks/survey/suzuka.js`: new, the baked lap and heights.

## Checks (Node, no browser)

- **Clearance audit** (`auditSuzuka`), exact distance to every segment of the
  lap: of 42,452 plants (Lite: 23,853), **0** are on the track, **0** in the
  run-off, **0** within 2.5 m past a barrier, **0** in a footprint (grandstands,
  marshal posts, pylons, billboards, arches, pit building, garages, park,
  towers, pond) and **0** within 3 m of the racing line. The closest is an
  azalea 3.95 m past the armco.
- **Ground against the road ribbons**, 30,710 samples across every node:
  ground is above a ribbon at 9 samples, worst 0.48 m, at the outer edge of the
  grass verge by the Hairpin. Unsupported floating verge (more than 1.4 m over
  the ground with no wall or span under it) at 2 samples.
- **Build time**: the plan takes about 0.4–0.5 s and the whole Suzuka world
  about 0.5–0.6 s.
- **Every other circuit builds exactly as before.** Same mesh, instanced-chunk,
  instance, triangle and shadow-caster counts as `main`, all 11 of them.
- **Scene census.** Draws and triangles that fall in a 340 × 260 m window round
  each point, roughly the default view. For instanced meshes, only the
  instances inside the window are counted.

| View | before | after, Full detail | after, Lite |
|---|---|---|---|
| Main straight | 170 / 73k | 204 / 62k | 200 / 61k |
| Esses | 97 / 76k | 110 / 149k | 102 / 103k |
| Degner | 91 / 76k | 96 / 103k | 87 / 76k |
| Hairpin | 83 / 70k | 114 / 97k | 99 / 71k |
| Spoon | 71 / 70k | 93 / 196k | 87 / 139k |
| 130R | 101 / 73k | 131 / 175k | 117 / 128k |
| Casio | 129 / 75k | 103 / 74k | 90 / 62k |

"Before" includes the old single ground plane (45k triangles), which was always
drawn whole.

## Not done

- **Not checked in a browser.** No screenshots, no frame time, no visual
  check: neither the sandbox nor the Chrome extension was available this
  session. This is the next step.
- **No distant ridgelines.** The game's only 3D camera is the fixed 35°
  orthographic overhead one; the TV camera is never switched on. A camera
  like that never shows the horizon, so ridgelines 2–6 km out could never be
  on screen. The "hills" are the terrain the camera does see, which rises and
  rolls away from the track.
- **Materials are `MeshStandardMaterial`, not Lambert.** That is what the whole
  renderer uses (its lighting was calibrated for it). The plants use flat
  shading and vertex colours to keep the stylised look.

# Rain in 3D, and the camera zooming out (2026-10-03)

- **Rain never showed in 3D.** The 2D painter draws rain (a dark wash and
  streaks), but in 3D the only sign of rain was the haze closing in. New:
  `src/render3d/weather.js`, for every circuit. In the wet it draws:
  - falling streaks round the camera, one draw call; up to 4,000 drops, as many
    and as bright as the track is wet
  - a dimmer sun and sky fill
  - a darker, glossier road and darker ground (Silverstone and Zandvoort keep
    their own versions of this)
  - on Suzuka, darker grass, verges and leaves
- **Spray drew as orange sparks.** The 3D renderer drew every particle as one,
  including the wheel spray and tyre smoke. Those now draw as soft puffs in
  their own colours. Nothing changes in the dry.
  - **Checked headless** on Suzuka, Monza and Silverstone, with the real
    `G3.build` and `G3.frame`, dry then wet at 85 %: 3,470 drops in view, the
    sun 1.12 → 0.72, the road ×0.68 and roughness 0.94 → 0.47, spray as puffs.
    **Not yet seen in a browser.**
- **The camera zoomed right out.** The zoom is worked out from the 2D view's
  size (`R.W`, `R.H`). With 3D running, that canvas is hidden and measures
  0 × 0, so any resize after boot (window, fullscreen, browser zoom, dev tools)
  pinned the camera at its widest (4.4 px/m, about 182 m of track top to
  bottom).
  - `R.resize` now measures the game area the canvas sits in.
  - The camera code re-measures if it ever sees a zero size.
  - In a 1280 × 800 window the zoom is back to 14 when slow and 9.3 at 80 m/s
    (about 86 m top to bottom), as designed.

## Crashes and cutscenes

- `src/car/damage.js`: contact geometry (where on the car a hit landed), the dent
  list on `car.dents`, and the `S.fx` queue physics uses to tell the 3D side what
  happened. `physics.js` does the spins (wall brush, over the grip limit) and the
  part loss; `Car.startSpin` is the one place a spin begins.
- `src/render3d/crash.js`: crumples a car's body from its dents (own copy of the
  geometry, cut finer, vertices pushed in and darkened) and runs the flying
  debris. `cine.js`: the slow-motion crash camera, the DNF scene (driver climbs
  out) and the podium scene. `person.js`: the jointed driver model.
- Slow motion is `S.slow`; the session passes `update(dt * S.slow, dt)`.
- These were checked in Node (physics scenarios, mesh and cutscene code with a
  stubbed DOM) but not seen on screen: headless Chrome cannot run the 3D here.

# Track upgrade: Step 0 audit (awaiting approval, nothing in `src/` has been changed)

How the numbers were made: every track was built with the real `buildTrack()` in Node and measured from the
centreline (`T.x/T.y/T.z`). Winding is the signed area plus the net heading change, printed by code, not judged
from a picture. No screenshots were taken: headless Chrome cannot run this game's 3D in the coding sandbox, so
the "weak points" below come from reading the track definition files and need your eye to confirm.

## 0a. Direction and elevation audit

### The direction bug is one bug, not eleven

`turtle()` in `src/tracks/build.js` turns the letter `R` into a NEGATIVE heading change
(`c.t === "R" ? -1 : 1`), but in the physics a right-hand turn is a POSITIVE one (`steer` right gives
`yaw > 0`, `h += yaw`; the 3D car is `rotation.y = -h`, which turns clockwise on screen as `h` grows).
So every circuit built from a `layout:` string is drawn as its own mirror image. The letters themselves are
right: the first corners in the layout strings match the real first corners (Monza R-L chicane, Spa La Source
right hairpin, Vegas T1 left hairpin, COTA T1 left hairpin, Interlagos Senna S left-right). The surveyed
tracks (`path:` from OpenStreetMap: Monaco, Silverstone, Zandvoort, Suzuka) are not affected and are correct.

Calibration: the three surveyed tracks with a known real direction (Monaco, Silverstone, Zandvoort, all
clockwise) have positive net turn, so positive = clockwise on screen, which agrees with the physics reading.

| Track | Real direction (source) | Game winding (area / net turn) | Game direction | Verdict |
|---|---|---|---|---|
| Monaco | clockwise ([Wikipedia list of F1 circuits](https://en.wikipedia.org/wiki/List_of_Formula_One_circuits)) | +110136 / +360 | clockwise | correct (surveyed) |
| Singapore | anti-clockwise (same list) | +1242212 / +360 | clockwise | WRONG (mirrored) |
| Las Vegas | anti-clockwise (same list) | +1998649 / +360 | clockwise | WRONG (mirrored) |
| Baku | anti-clockwise (same list; I expected clockwise from memory, the list says otherwise, I used the list) | +1643286 / +360 | clockwise | WRONG (mirrored) |
| Silverstone | clockwise (not in the Wikipedia table; widely known; matches the OSM survey) | +823589 / +360 | clockwise | correct (surveyed) |
| Spa | clockwise (same list) | -1110045 / -360 | anti-clockwise | WRONG (mirrored) |
| Monza | clockwise (same list) | -867586 / -360 | anti-clockwise | WRONG (mirrored) |
| Zandvoort | clockwise (same list) | +226179 / +360 | clockwise | correct (surveyed) |
| Suzuka | figure-of-eight, main loop clockwise (not in the table; the list notes the crossover) | +123102 / 0 | figure-of-eight, one crossing | correct (surveyed; first-corner order to be re-checked in step G) |
| Interlagos | anti-clockwise (same list) | +899685 / +360 | clockwise | WRONG (mirrored) |
| COTA | anti-clockwise (same list) | +1470453 / +360 | clockwise | WRONG (mirrored) |
| Mexico City | clockwise (same list; one search summary said anti-clockwise, the table itself says clockwise, I used the table) | -401258 / -360 | anti-clockwise | WRONG (mirrored) |

So 8 of 12 are wrong and all 8 are the layout-string tracks. Proposed fix, to be made ONCE in `turtle()`
and `buildTrack()`: flip the sign. This IS a mirror, and I want you to confirm that is what you want, because
your brief says not to just mirror. The reason it is right here: the corner letters are already in the real
order and the real handedness, only the renderer flipped them, so mirroring puts the game on the real circuit.
Reversing the driving order instead would run the real circuit backwards, which is also wrong.

Everything that stores a side as a raw sign has to flip in the same commit, otherwise pit lanes, run-off and
scenery end up on the wrong side after the flip: `pit` side, `runoffZones` (`ls/rs/lt/rt`), `side:1/-1`
entries in `scene` (not the `"in"/"out"` ones, those are relative and follow the corner), banking sign, and
the `side:-1` pit buildings. Elevation is a function of lap fraction `u`, which a mirror does not change, so
no elevation profile needs re-ordering because of the flip.

### Elevation

Current profiles are `def.elev(u)` functions of lap fraction. Measured vs real:

| Track | Real range (source) | Game range (min..max, start) | Max gradient | Verdict |
|---|---|---|---|---|
| Monaco | "over 40 m", highest Casino Square, lowest tunnel exit ([search summary of F1 and guide pages](https://www.formula1.com/en/latest/features/2016/10/highs-and-lows---which-f1-track-has-the-most-elevation-changes-.html), page itself not readable) | 42 m (2..44, start 3.5) | 11.6% | roughly right, surveyed DEM |
| Singapore | 5 m ([f1-fansite](https://www.f1-fansite.com/f1-circuits/singapore-circuit/)) | 4.3 m | 7.7% | right range, but 7.7% is steep for a flat city: the Anderson Bridge bump is probably too sharp |
| Las Vegas | 5 m ([f1-fansite](https://www.f1-fansite.com/f1%20circuits/las-vegas-strip-circuit-layout-records/)) | 4 m | 0.4% | right, but it is a plain 2-cycle sine (not real shape) |
| Baku | about 27 m: highest 2.1 m, lowest 24.7 m below sea level ([Wikipedia](https://en.wikipedia.org/wiki/Baku_City_Circuit) via search; the location of the high point is reported as Turn 13 there, which I doubt: the old-town climb is mid-lap) | 30 m, start is the low point | 4.7% | close; peak position to verify |
| Silverstone | 11 m / 37 ft ([lapmeta and others](https://lapmeta.com/es/track/variation/421)) | 14.1 m | 2.8% | 3 m high; seam of 0.14 m at the start line, must wrap exactly |
| Spa | 102 m, Eau Rouge about 17% / 41 m ([F1 article via search](https://www.formula1.com/en/latest/article/highs-and-lows-which-f1-track-has-the-most-elevation-changes-.7I9JEcBw3R2AqXbnJ6hyvc)) | 58 m (12..70) | 16.7% | WRONG: 44 m too flat; sources disagree on where the highest point is (Les Combes vs Malmedy), both sit past mid-lap |
| Monza | 10 m ([f1-fansite](https://www.f1-fansite.com/f1-circuits/autodromo-nazionale-monza/)) | 4 m | 0.7% | too flat, and it is an artificial 3-cycle sine |
| Zandvoort | sources disagree: a lap-gain figure of 32 m appears on lapmeta-style pages, which is probably cumulative climb, not the range; I found no clean range figure | 11.6 m, start 8.8 | 6.1% | unknown, flagged; banked corners are implemented already |
| Suzuka | 40.4 m ([f1-fansite](https://www.f1-fansite.com/f1-circuits/suzuka-circuit/)) | 40.3 m | 9.9% | correct; seam of 0.19 m at the start line |
| Interlagos | 43 m, highest at the start/T1 area, lowest in the lake section ([f1-fansite](https://www.f1-fansite.com/?p=6731)) | 44 m (-10..34), start is the high point | 16.2% | range right; the low point sits at u=0.55, I could not confirm that against a source |
| COTA | 133 ft = 40.5 m; T1 climb 85 ft = 26 m, 11-16% depending on source ([Jalopnik guide, others](https://jalopnik.com/circuit-of-the-americas-a-turn-by-turn-guide-5856083)) | 36 m (2..38) | 15.1% | 4.5 m short; right shape |
| Mexico City | 8 m ([f1-fansite](https://www.f1-fansite.com/?p=78657)); the site is at 2285 m altitude | 2.4 m | 0.4% | too flat, artificial 2-cycle sine |

Seams (height at lap end minus height at start): Silverstone 0.14 m, Suzuka 0.19 m, everything else under
0.05 m. The brief asks for exact wrap, so those two get fixed in the shared elevation system.

Visual exaggeration: there is none today. I suggest one global constant `ELEV_VISUAL = 1.25` (set to 1.0 for
pure real figures), and I will show real and displayed values side by side per track so you can change it.
Where I could not find a reliable profile (Zandvoort range, Interlagos low point, Baku peak position) I will
mark the profile as an estimate in the notes.

## 0b. Weak points (from the definition files, not from screenshots)

- Monaco, Silverstone, Zandvoort, Suzuka, Las Vegas: have their own `worlds/*.js` files, hand-built scenery and
  landmarks. Earlier prompts cover them. Weak: Monaco is by far the heaviest file (2028 lines); Vegas has the
  Strip but a plain sine elevation; Silverstone and Suzuka have the start-line height seam.
- Singapore: 33 scene entries, landmarks are boxes (`mbs`, `artscience`, `merlion` etc. from a kit), no
  working water (Marina Bay is the signature), skyline thin, no Ferris wheel, no Anderson Bridge shape.
- Baku: 30 entries, one tall landmark (`flame`), Old City wall is repeated boxes, no Caspian sea along the
  Boulevard, no real castle-section squeeze visuals, palms are generic.
- Spa: 21 entries, only chalets and a pit building: nothing like the Ardennes; no forest density, no Eau Rouge /
  Raidillon walls and valley, no La Source hairpin hotel, elevation 44 m too flat.
- Monza: 26 entries, trees and grandstands as boxes, banking ruins present (`banking` entries) but small,
  royal-park feel missing, elevation is a sine.
- Interlagos: 25 entries, almost no landmarks (only the pit building), favela facade setting but no hillside
  homes, no lake, no Senna S tyre-wall character; run-off set to 11 everywhere.
- COTA: 23 entries, tower and amphitheatre present, the rest is generic; Texas scrub, flat horizon, no S-curves
  homage visuals.
- Mexico City: 24 entries, grandstands in the Foro Sol area are plain boxes, a baseball stadium box is the only
  landmark, no mountains on the horizon, no volcano haze.
- Across all generic tracks: run-off is one number per track (no per-corner tarmac/gravel/grass mix, except
  Vegas and the surveyed worlds), banking only on Zandvoort, pit lane settings are shared constants
  (`pitbuilding` at u about 0.98 on the same side everywhere), adverts are the same billboard type.

## 0c. Personality sheets (for approval)

Palettes are distinct by design: no two share a dominant hue pair. Times of day are my proposals from the
usual race slots; where I am unsure of a real race time it says so. All names, signs and adverts are fictional.

### Spa (Belgian ardennes)
1. Identity: a deep, damp, evergreen valley where the track plunges and climbs through pine forest.
2. Palette: forest green #1F4A2E, deep spruce #12301F, wet slate #5C6670, lichen yellow-green #8AA23A, mist white #D7DEDC.
3. Light: overcast-bright with a break of low sun; cool white light, soft shadows, sky grey-blue to pale. Real race is mid-afternoon; weather is the point.
4. Atmosphere: low valley mist, fog tint cool grey-green, fog starts close (near 60 m), faint drifting drizzle haze.
5. Signature: Eau Rouge/Raidillon dip and wall of trees, La Source hairpin hotel, long forest straight (Kemmel), Pouhon sweepers, Bus Stop chicane.
6. Crowd: camping-style stands in rain jackets, orange and yellow flags, packed at Eau Rouge and La Source, ponchos animated as a slow wave.
7. Adverts: a waffle brand ("Waffle Wizard: Dough Not Slow"), a chocolate trap ("Cocoa Brakes"), a very long forest-themed tyre pun.
8. Surface/kerbs: darker, rougher asphalt, red-white kerbs, wide grey tarmac run-off at La Source, gravel at Les Combes, armco and tyre walls.
9. Details: cow field, wooden bridge, a mist bank at the valley floor, birds over the forest, camper vans, a hot air balloon.
10. Signature moment: the full-throttle compression through Eau Rouge into the Raidillon crest, camera-less: the height change itself.

### Interlagos (Sao Paulo, Brazil)
1. Identity: a hillside bowl of colourful houses, tropical green and loud local crowd.
2. Palette: sunburnt orange #E8892C, lagoon teal #2FA39B, favela pastel #E7C7A3 and #D9657A, tropical green #3F8F3A, terracotta roof #B5532F.
3. Light: late-afternoon golden hour, warm sun low from one side, medium shadows, humid pale-gold sky. Real race slot is around 14:00-15:00 local, but weather is often changeable; golden hour is a stylistic choice, flagged.
4. Atmosphere: warm haze, orange-tinted fog far away, a hint of thunderheads on the horizon.
5. Signature: Senna S, the lake bowl, a stepped hillside of houses, the Subida dos Boxes climb, the long grandstand wall at the final corner.
6. Crowd: green-yellow-blue shirts, big fictional flag banners, drums, packed and bouncing, strong colour.
7. Adverts: "Café Turbo: wake up in third gear", a fictional insurance firm "Seguro Sobre Rodas, we cover the lap", coconut water "Coco Boost".
8. Surface/kerbs: bumpy warm-grey asphalt, red-white kerbs with sand-yellow edges, grass and tarmac run-off, low armco.
9. Details: hanging laundry, a kite, parrots, a lake with a floating stage, a helicopter, a football on the grass.
10. Signature moment: the downhill plunge out of Senna S into Descida do Lago, with the whole bowl of crowd laid out in front.

### COTA (Austin, Texas)
1. Identity: big-sky Texas ranchland with an observation tower and a hairpin on a hill.
2. Palette: dry grass tan #C8B26A, Texas limestone #E6DCC3, sky blue #4C8FD8, cedar green #4C6B3A, sunset red #D9552B.
3. Light: bright afternoon, high-ish sun, hard shadows, clear deep blue sky with thin cirrus. Real race is early-afternoon; bright midday is correct.
4. Atmosphere: very clear, light dust haze, heat shimmer on the straights, almost no fog.
5. Signature: the observation tower, the uphill Turn 1 hairpin, the esses homage, the Turn 12 stadium bend, the amphitheatre.
6. Crowd: cowboy hats, fictional red-white-blue-and-star flags, big stands, packed at T1.
7. Adverts: "Brisket Boost", a fictional pickup truck "Big Hoss: Fits A Horse", boot shop "Spin Out Boots".
8. Surface/kerbs: pale tan-grey asphalt, red-white kerbs, wide tarmac run-offs, short grass beyond.
9. Details: a cattle herd, a windmill, a longhorn statue, hot-air balloon, a train on the far edge, flags straight out in the wind.
10. Signature moment: the blind climb to Turn 1 with the tower at the top and the whole circuit behind you.

### Monza (Italian royal park)
1. Identity: a speed temple in an ancient park, trees on both sides and a banked ruin from the old track.
2. Palette: park green #3F6B3A, gravel #B8A582, brick red #B34A2C, old stone #A59E8E, sky pale #D6E4EC.
3. Light: warm early-September afternoon, medium sun, soft shadows through the trees, pale blue-white sky. Real race is mid-afternoon; fine.
4. Atmosphere: gentle haze through the trees, warm fog tint, floating pollen specks.
5. Signature: the avenue of tall trees, old banking ruins, the Parabolica sweep, the Lesmo trees, the main-straight grandstands.
6. Crowd: sea of red scarves and flags, packed at the Parabolica exit, flare smoke red.
7. Adverts: "Pasta Power: carbs for corners", fictional espresso "Doppio Boost", a clock firm "Tempo, always on time".
8. Surface/kerbs: grippy dark asphalt, red-white big kerbs, wide gravel run-off, armco.
9. Details: a grand villa, a pigeon flock, cyclists on the park path, hot-air balloon, church bell tower, a vineyard strip.
10. Signature moment: the long full-throttle flat run down the straight with the grandstand wall and then a heavy braking into the first chicane.

### Mexico City (Autodromo Hermanos Rodriguez)
1. Identity: a loud stadium in a mountain-ringed city bowl at high altitude.
2. Palette: marigold #F0A21C, volcanic grey #6A6A72, hot pink #D8467C, jade green #2F8A6A, sky haze #C7D3DD.
3. Light: bright midday at altitude, hard clean light, thin blue sky; at 2285 m the sky is deeper. Real race is early-afternoon; flagged as a choice.
4. Atmosphere: thin smog band at the horizon, volcano haze, almost no fog near the track.
5. Signature: the Foro Sol stadium section, the long main straight, the Peraltada curve remnant, a mountain skyline.
6. Crowd: green-white-red scarves, fictional lucha-mask flags, party lights, dancing, packed in the stadium.
7. Adverts: "Taco Torque", a fictional soft drink "Jarrito Jolt", "Altitude Attitude" an oxygen bar.
8. Surface/kerbs: light grey high-grip asphalt, red-white kerbs, tarmac and grass run-off.
9. Details: confetti, a mariachi stage, a papel picado string, a hot-air balloon, flower beds, a cable car.
10. Signature moment: sweeping through the stadium, where the crowd is on all sides of the car.

### Baku (Azerbaijan)
1. Identity: a medieval walled old town squeezed against a modern skyline and the Caspian shore.
2. Palette: sandstone #D8C39A, Caspian blue #2F7FB8, flame orange #E8742A, tiled turquoise #2FA7A0, carpet red #A8322F.
3. Light: bright late-afternoon (real race is mid-to-late afternoon local), warm light from the west, medium-soft shadows, pale warm sky.
4. Atmosphere: sea haze, warm tint, light wind lifting flags and dust.
5. Signature: castle section squeeze, flame-shaped towers, the old city walls, the sea-front boulevard, the long main straight.
6. Crowd: red-green-blue flags, packed in the castle section stands, flag waves.
7. Adverts: "Pomegranate Pit Stop", "Carpet Cleaners: We Wash Your Racing Line", a fictional tea "Samovar Sprint".
8. Surface/kerbs: dusty warm asphalt, low red-white kerbs, minimal run-off, walls close.
9. Details: a minaret, flags on the rooftops, a gull flock, a tanker on the horizon, a pomegranate market stall, a tram.
10. Signature moment: the narrow squeeze through the castle section between the old city walls and a barrier.

### Singapore (Marina Bay)
1. Identity: a hot neon night under a glass-and-steel skyline and a bay.
2. Palette: neon magenta #D8307A, electric cyan #2FD0E0, deep navy #0B1230, gold #E8B33A, glass teal #1F6E80.
3. Light: full night under floodlights, magenta and cyan accents, no sun, sky deep indigo with city glow. Real race is at night, correct.
4. Atmosphere: humid hazy glow around lights, warm-tinted fog, thin spray after rain, light bloom.
5. Signature: the bay with the Ferris wheel, a boat-shaped triple tower, a lotus museum, a fictional lion statue, a light-up bridge.
6. Crowd: tropical shirts and glow sticks, big night stands, flags in lights.
7. Adverts: "Chilli Crab Cola", a fictional bank "Merlion & Sons Savings", "Humidity Hair Gel".
8. Surface/kerbs: dark wet-looking asphalt, bright red-white kerbs under the lights, concrete walls.
9. Details: a Ferris wheel, passing boats on the bay, a light show, fireworks, a footbridge, drones.
10. Signature moment: the sweep along the lit bay with the skyline mirrored in the water.

### Las Vegas (night strip)
1. Identity: a glittering neon desert night on the Strip. Already built; kept as is.
2. Palette: neon pink #E8307A, gold #E8B33A, electric blue #2F7FE8, desert black #0A0A12, fountain white #EAF4FF.
3. Light: late-night race, full darkness with neon, cool desert sky; real race is late evening, correct.
4. Atmosphere: warm glow haze, dry cold night air, no fog.
5. Signature: the Strip hotels, the sphere, the fountains, the casino signs, a 2-km straight.
6. Crowd: fancy-dress crowd, LED-lit stands, glowing wristbands.
7. Adverts: "Lucky Seven Lawyers", a buffet "All You Can Lap", a wedding chapel "Pit Stop & I Do".
8. Surface/kerbs: dark smooth asphalt, red-white kerbs, tarmac and wall run-off.
9. Details: fountains, a helicopter, a limousine, a ferris wheel, neon billboards.
10. Signature moment: the long flat-out blast under the lit skyline.
Existing world is kept. Left for later: a real elevation shape instead of a 2-cycle sine.

### Monaco (harbour town)
1. Identity: glamorous harbour town on a hill. Already built; kept.
2. Palette: Mediterranean blue #2F78B8, creamy stucco #E8D5B0, terracotta #B8542F, harbour white #F2F2F0, olive #6A8A4A.
3. Light: bright late-afternoon sun, golden warm light from the side, crisp medium shadows; the real race slot is mid-afternoon.
4. Atmosphere: light sea haze, warm tint, a thin fog far off.
5. Signature: harbour, casino, tunnel, hairpin hotel, swimming pool, Rascasse.
6. Crowd: balcony crowd, flags, yacht-top crowd.
7. Adverts: existing, to be checked for brand names.
8. Surface/kerbs: tight walls, red-white kerbs, no run-off.
9. Details: yachts, a cable car, cruise ship, helicopter, rooftop bars.
10. Signature moment: the tunnel exit into the harbour chicane.
Existing world kept.

### Silverstone (English airfield)
1. Identity: a flat English airfield under big changeable skies. Already built; kept.
2. Palette: lawn green #5A8A3A, concrete grey #8A8F96, hay yellow #C9B35A, overcast white #E0E3E6, brick red #A8452F.
3. Light: overcast soft light, thin sun break, very soft shadows. Real race is mid-afternoon.
4. Atmosphere: grey cloud mass, damp haze, light drizzle possible.
5. Signature: Maggotts-Becketts-Chapel, the Wing, the hangar straight, the airfield look.
6. Crowd: camping crowd with union-flag style banners (fictional), umbrellas.
7. Adverts: existing, to be checked.
8. Surface/kerbs: grey asphalt, red-white kerbs, wide tarmac and gravel.
9. Details: a vintage plane, a helicopter, tents, a hay bale stack.
10. Signature moment: Maggotts-Becketts flick through.
Existing world kept. Seam to fix.

### Zandvoort (Dutch dunes)
1. Identity: windswept sandy dunes and the North Sea with banked corners. Already built; kept.
2. Palette: dune sand #E3D2A0, sea blue #4C86A8, grass tuft #6F8F4A, orange accents #F08A1E, cloud white #EEF1F4.
3. Light: bright coastal sun with breeze, medium shadows, pale blue sky with scattered clouds.
4. Atmosphere: sea mist at the horizon, drifting sand, a light salty haze.
5. Signature: banked Tarzan and Arie Luyendyk, dunes, the sea view, the orange crowd.
6. Crowd: orange-covered stands, flares, packed.
7. Adverts: existing, to be checked.
8. Surface/kerbs: grey asphalt, red-white kerbs, sand run-off.
9. Details: a windmill, a beach hut, kites, a seaplane, a wind turbine row.
10. Signature moment: the banked final corner onto the straight.
Existing world kept.

### Suzuka (Japan)
1. Identity: a wooded hillside figure-of-eight with an amusement park. Already built; kept.
2. Palette: maple red #C9442F, cedar green #2F5A3A, mist grey #AEB8BC, pagoda red #B8362A, wet black asphalt #2A2E34.
3. Light: overcast-to-dusk soft light, low sun, long shadows. Real race is mid-afternoon.
4. Atmosphere: hill mist, cool tint, light drizzle.
5. Signature: the figure-of-eight crossover, the esses, the Ferris wheel, 130R.
6. Crowd: bright costumes, banners, dense.
7. Adverts: existing, to be checked.
8. Surface/kerbs: dark asphalt, red-white kerbs, gravel traps.
9. Details: a pagoda, a Ferris wheel, a monorail, cherry blossom.
10. Signature moment: passing under the crossover bridge.
Existing world kept. Seam to fix.

## Proposed order

1. Central direction fix (one commit, all eight mirrored tracks together, plus pit/run-off/scene side swaps), verified by printed winding.
2. Shared foundations (Step 1 of the brief), reusing what exists (the `bankZ`, `runoffZones`, `pit` and `G3.tileSplit` code is already there).
3. Tracks, weakest first: Spa, Interlagos, COTA, Monza, Mexico City, Baku, Singapore.
4. Then Vegas, Monaco, Silverstone, Zandvoort, Suzuka: direction and elevation-seam checks only unless you want more.

## Things I need from you

- OK to fix direction as a one-time sign flip in the layout parser (a mirror, justified above)?
- OK to add `ELEV_VISUAL = 1.25`, or do you want 1.0?
- OK on the track order and the personality sheets, or edits?
- Zandvoort and Interlagos elevation: I could not confirm those two from a clean source, accept estimates flagged as estimates?

## Track atmosphere hook
`def.atmo = { near, k, tint }` (src/render3d/build.js) sets per-track haze: near = fog start offset, k = visible-distance scale, tint = fog and sky colour. First user: Spa (mist, denser conifer). Spa visuals are a first pass only (no landmark kit or adverts yet); not seen in a browser.

---

# COTA (Austin) overhaul — research, mismatches, decisions

## Research (Part 1). Sources and how sure I am

| Fact | Value I found | Source | Confidence |
|---|---|---|---|
| Lap and corners | 3.4 mi / 5.513 km, 20 turns, counter-clockwise | [Jalopnik turn-by-turn guide](https://jalopnik.com/circuit-of-the-americas-a-turn-by-turn-guide-5856083), SI guide | high |
| Elevation range | 133 ft (about 40.5 m), highest to lowest point | same Jalopnik guide; F1/Pirelli pages repeat it | high for the range; **where the lowest point is, I did not find**. I kept it on the back straight / T12 as before (estimate) |
| T1 climb | about 85 ft (26 m) and about 11 % at the steep part; T1 is the highest point of the track | Jalopnik / search summaries of Racer and Pirelli; "11 percent" appears in one summary only | medium. Sources differ between 11 % and 16 % in older notes (see section 0a). I used 11 % on the steepest stretch |
| T1 | blind, uphill braking zone into a left-hand hairpin ("Big Red") | Jalopnik, NASCAR turn guide | high |
| Esses | T3 left, T4 right, T5 left (then T6), compared with Maggotts-Becketts-Chapel at Silverstone | NASCAR turn-by-turn analysis | high |
| T11 | left-hand hairpin ("Bobby Pin"), no big elevation change | NASCAR guide | high |
| Back straight | **0.63 mile = 1.01 km** in the NASCAR guide; the game's version is longer (see mismatches) | NASCAR guide; other pages quote about 1.2 km | sources disagree, I show both |
| T12 | sharp left, big stadium grandstand, good view of most of the track | NASCAR guide | high |
| T19-T20 | T19 a left after a long right, "flick downhill"; T20 is a 90-degree left onto the front straight | NASCAR guide | medium (T19 direction wording is odd in the source) |
| Pit lane | entry at T20, **exit goes directly into the apex of T1**; pit entry on the left (inside of T20) | Jalopnik, a search summary of track-map pages | medium-high. I found no box count or lane length; I did not guess them |
| Tower | **on the outside of the track near turns 16-18**, 251 ft (76.5 m) at its highest, observation deck 22 stories up, external double-helix stair of 419 steps, glass floor panel | [official COTA tower page](https://circuitoftheamericas.com/blog/2024/2/20/all-about-the-cota-tower/) | high for height/place. A search summary also said "inside of the right-hand corner", which contradicts "outside"; I used the official wording |
| Amphitheatre | in the infield, opened 2012; capacity 14,000 (Wikipedia, via search) vs a 20,000 plan quoted before it opened (Jalopnik) | [Wikipedia](https://en.wikipedia.org/wiki/Germania_Insurance_Amphitheater) | capacity disagrees; its exact spot in the infield I did **not** confirm |
| Run-off | Recent changes: asphalt verges at T6, T13, T14, T15 narrowed by 1.5 m and replaced with turf; gravel-style insert on one exit (a summary says "Turn 11", but T11 is the hairpin, so I do not trust the number); T2-T10 and T12-T16 resurfaced | [The Drive](https://www.thedrive.com/news/cota-adds-gravel-to-crack-down-on-f1-track-limits-violations), F1technical | medium. **I found no published full run-off map.** The mix of tarmac, gravel and grass in `cota.js` is my reading (flagged "guess" per zone) |
| Two service tunnels under the track for transporters | yes | Jalopnik | high (not modelled) |

Not confirmed at all: exact grandstand capacities, hospitality box layout, where the paddock buildings stand relative to the pit lane, the Ferris wheel (fan zone) position.

## Mismatches against the game (measured by `scripts/cota-audit.mjs`, not by eye)

1. Direction: **already correct** — the `turtle()` handedness fix landed after the 0a audit above, so COTA now winds anticlockwise (net turn -360). Nothing to reverse, and no mirror was applied.
2. Tower side: the game had it on the inside (`side:"in"`); the official page says outside. Moved.
3. Pit zone: the game's pit lane ran from lap 0.86 to 0.10 (the shared default), 1.3 km, entry well before T20. Real: entry at T20, exit into the T1 apex. Set to 0.885 -> 0.075.
4. Elevation: shape was cosine-eased between 10 points (flat at every knot, so the climb stopped and started). Range was already right (0 to 40.5 m). Replaced by a closed spline with continuous gradient.
5. Run-off: one untyped 18 m everywhere. Replaced by per-corner zones.
6. Layout questions I did **not** change (asked in the report): see the report.

## Results (Parts 2 to 5)

All numbers below are printed by code in this repo, not read off a picture:
`node scripts/cota-audit.mjs` (track), `node scripts/cota-audit-world.mjs` (plan), `node scripts/cota-world3d.mjs`
(the real world build in Node with clearance and clipping audits) and `node scripts/census.mjs <track> [detail]`
(the real `G3.build` with a stubbed DOM: draw calls and triangles for any circuit).

### Direction and elevation, before and after

| | Before (main 700b822) | After |
|---|---|---|
| Winding | net turn -360 deg, signed area -1,470,452: anticlockwise | identical (it was already right; see "Mismatches" 1) |
| Lap length | 5515.8 m (real 5513 m) | 5515.8 m |
| Height range | 0.00 to 40.47 m = 133 ft | 0.00 to 40.43 m = 133 ft (real 133 ft) |
| Lowest / highest at | u 0.618 / u 0.075 | u 0.599 / u 0.080 (the crest of Turn 1) |
| Steepest gradient | -10.2 % (the Esses drop); gradient dropped to zero at every control point | 11.6 % climbing to Turn 1 (u 0.063), continuous everywhere |
| Lap seam | height -0.013 m, gradient 0.18 % then 0.43 % | height -0.065 m (= one node of the 0.9 % gradient), gradient 0.93 % then 0.90 % |

Heights now (m): start line 14.5, Turn 1 crest 40.4, Turn 1 exit 36.6, Esses T3 15.8, T5 10.2, end of Esses 10.3,
Turn 11 hairpin 4.0, end of back straight (T12) 0.0, T16-18 5.0, final corner T20 7.4.

**Visual exaggeration:** one shared constant `ELEV_VISUAL` in `src/tracks/shared.js`, applied in `buildTrack` for every
circuit. It is **1.0**, so displayed = real for every track. At 1.0 the climb is 26 m over 436 m (6 % on average,
11.6 % at its steepest, flattening into a crest exactly under the Turn 1 hairpin), which is what hides the corner.
Set it to something like 1.25 to exaggerate every circuit at once; I did not, because nobody asked for the other
eleven tracks to change.

The profile is `elevSpline` in `src/tracks/shared.js`: a closed piecewise cubic with Fritsch-Carlson slopes, so
there is no overshoot between control points and height and slope both wrap at the line. Track, terrain, barriers,
kerbs, scenery, the pit lane and the car's ride height all read `T.z`, so they cannot disagree.

### What is built (world/cota.js, planned by cota-plan.js, geometry in cota-kit.js)

Terrain: 12 m height grid (16 m in Lite), rolling hills plus a hazy ridgeline at the back, interpolated (never
snapped to nodes); vertex colours: dusty gold, sage, sandy and bare patches, scrub, red-brown earth round the
run-off edges and car parks, white limestone on slopes and as outcrops, a dry creek bed, three ponds. Plants,
all instanced with two detail levels (full near the circuit, one blob far off): live oak, cedar elm, mesquite,
juniper, prickly pear, yucca, dry grass, bluebonnet and paintbrush patches. Every plant is tested against the
circuit (barrier line + a margin that grows with the crown), the fence, and every footprint.

Structures (merged into 300 m chunks, vertex colours, `MeshLambertMaterial`): ten tiered stands that follow the
circuit's own curve (main straight with roof, the Turn 1 hill with a tall stand and a grass bank above it, two at
the Esses, Turn 11, a roofed one at Turn 12, a deep roofed bowl at Turn 19, one inside Turn 20, one at Turn 16);
catch fencing in front of each; pit building (garages, striped awnings, set-back floor, glass hospitality deck,
timing tower); start/finish gantry; the observation tower; the amphitheatre; hospitality cabins and transporters;
tents; food trucks; warehouses; car parks with parked cars; TV towers; marshal posts; flag poles; fence and
service roads; big screens; paddock sign; water towers and radio masts on the horizon.

Life: crowds with cowboy hats (about 9,800 fans, some waving an arm), flags and bunting that ripple, a Ferris wheel
in the fan zone, three hot-air balloons, a plane and a helicopter circling, colour-cycling bulbs and a firework burst
over the tower, a sky dome with a warm horizon haze and high thin clouds, a warm low sun (`sunH 0.62`, so shadows are long).

### Performance (real `G3.build`, no GPU, so draw calls and triangles; frame time could not be measured, see below)

| Circuit | Draw calls if all drawn | Triangles if all drawn | Triangles within 450 m of Turn 1 / Esses / back straight |
|---|---|---|---|
| COTA before | 1,229 | 92,431 | 72,645 / 71,130 / 68,953 |
| COTA after (full detail) | 1,022 | 1,353,889 | 373,008 / 383,064 / 362,893 |
| COTA after (Lite) | 966 | 538,528 | 186,141 / 169,159 / not printed |
| Suzuka | 1,899 | 3,127,023 | 553,057 / 586,636 / 1,175,605 |
| Silverstone | 5,980 | 1,893,312 | 213,623 / 211,035 / 190,612 |
| Zandvoort | 6,258 | 3,801,558 | 575,693 / 822,707 / 504,443 |

So COTA went from the lightest scene in the game to the lightest of the detailed ones: fewer draw calls than before
(the old scene was about 1,200 separate baked meshes; this one is 294 instanced chunks and 40 merged structure chunks,
each with its own culling bounds), and about 15 times the triangles, still below Suzuka, Silverstone and Zandvoort.
Plan time in Node is about 450 ms (Lite 250 ms), build total about 550 ms; the browser will be slower.

### Not done, not verified, or only partly done (honest list)

- **No screenshots and no frame times.** Browsers cannot run on this machine (Qustodio kills them), so the visual
  check is yours. Everything above is geometry I measured in Node. Shaders were not compiled by a GPU: I expanded the
  patched Lambert vertex shader text and read it, and the same tint-mask pattern is used by Suzuka's world, which
  has also not been seen in a browser yet.
- No headless AI/pit lap sim: `session.js` is tied to the UI. The pit zone is data (`in 0.885`, `out 0.075`) read by
  the same code every circuit uses; the elevation is gentler than before (max gradient 11.6 % vs the old 15 % in the
  earlier 36 m version), and the direction, start line and lap counting did not change at all.
- Barriers: still one type (Armco) plus the new catch fencing in front of stands. Tyre walls and concrete walls where
  the real circuit has them: I could not find where, so I did not invent them.
- Kerb widths, light gantries along the straights and drainage ditches: not changed or added.
- Pit box positions and lane length: not found. The lane runs from T20 to the T1 apex (1,050 m in the game, which is
  probably longer than the real lane); garages are centred on the building by the start line (my assumption).
- Run-off mix: my reading, flagged per zone in `cota.js`; the real figures I found were only the turf trims at
  T6/T13-15 and a gravel insert on one exit.
- The amphitheatre's exact position in the infield and its capacity (14,000 vs 20,000).
- The main-straight stand's side: opposite the pits (right), which is my reading.

### Layout questions (I did not change these)

1. Back straight: the game has 1,169 m between T11 and T12; the NASCAR guide says 0.63 mile = 1,014 m, other pages
   say about 1.2 km. Which do you want?
2. Turns 19 and 20: the game has a 455 m straight between them (the layout's `S344` scaled). I believe the real
   corners are much closer together than that. I have not confirmed the real distance.
3. The pit lane is 1,050 m long (T20 apex to T1 apex). Real length unknown.
4. The other seven layout-string circuits were audited as "mirrored" in 0a above, but the turtle fix has since landed
   (COTA's winding was already right when I measured). Worth re-running the audit for the rest.

### Visual checklist for you (npm run dev, then the circuit "Austin")

1. Start line, look up the straight: the climb should hide Turn 1; at the crest the stands, the bank above them and
   the open sky appear. Fans on the bank should wave.
2. Esses: should roll downhill, with two stands on the outside; nothing floating or buried at the treads.
3. Back straight: a long low run with TV towers on the right, wide tarmac either side, fence and gravel service road.
4. Turn 11 hairpin and Turn 12: stand on the outside; check nothing is inside the tarmac run-off.
5. Final stadium at Turn 19 and the stand inside Turn 20; the tower should be on the outside of the T16-18 sweep, its
   bulbs cycling colour and a burst of sparks over it every ~4 s.
6. Pits: garages in front of the new pit building, striped awnings, timing tower, paddock sign over the entrance.
7. Console: look for `cota ...` warnings (the world is built inside try/catch, so a bug shows as a warning and a
   plain circuit, not a crash). `window.__cota.audit()` reruns the clearance audit; `window.__cota.stats` shows counts.

---

# DNF climb-out: direction, size and look

- **Direction.** The old exit was written in car-local axes: out of the side facing the track, then a walk of up to 12 m along the car's nose. The car can finish pointing anywhere, so the driver could walk through the barrier or out into the run-off wall. Now the exit side and the walk are chosen in the world (`CINE.dnfInit` in `render3d/cine.js`): both standing spots beside the car are tested for room to the barrier line (capped at 6 m, ties go to the side facing away from the track), then the walk goes along the track edge (against the traffic if there is room, with a little outward drift) or straight away from the car, whichever clears the car's own footprint and has the most room. Each frame the position is pulled back inside the barrier and he faces the way he walks.
- **Check.** `node scripts/dnf-test.mjs [track]` runs the real `dnfInit`/`dnfTick` for 400 car positions and headings (some pressed against the barrier). COTA: old logic ended past the barrier in 65 of 400 runs (worst 9.4 m), new in 0, and 0 frames inside the car. Monaco: old 137 of 400 (worst 17.2 m), new 0.
- **Size.** The standing driver was 2.01 m with the helmet, about 1.2 times the car (the car is scaled 0.92). In the DNF scene he is now scaled 0.84 (1.69 m with helmet), which puts the seated helmet at height 0.73 m, x 0.36, against the cockpit's own helmet at 0.72 m, x 0.32 (`node scripts/driver-size.mjs`). The podium drivers are untouched.
- **Look.** `render3d/person.js`: rounded tapering limbs, a waist that narrows into the chest, shoulder pads, cuffs, belt, collar and zip; gloves with a thumb; boots with a sole; a head with hair, ears, nose, eyes and brows; a helmet with a dark visor band, chin bar, stripe in the team's colour and a rear fin. Joints did not move, so every pose still works. About 1,900 triangles per driver.
- Not seen in a browser (see above): the walk path, the camera positions (unchanged, relative to the exit side) and the new look need your eyes. If a camera shot ends up behind the barrier on a tight spot, tell me which circuit and corner.

---

# DNF, take 2: the recovery truck

The first version posed the driver in the crashed car's own frame, so when the wreck sat tilted or in the air he stood on thin air. Now:

- **Crane and truck** (`render3d/recovery.js`): a flatbed with a crane parks beside the wreck (`planTruck`: a ring of candidate spots, facing along the track either way; valid when everything it covers is inside the barrier, it does not overlap the car's real, possibly tilted, footprint, and the crane can reach). The hook goes out over the wreck, the slings take up, the car is lifted level, swung over the bed and lowered with a little pendulum and settle, then the hook goes back up. The boom is pointed at the hook by IK every frame.
- **Driver on the bed** (`render3d/cine.js`, `dnfKeys`): everything after the landing is in the car's frame on a level bed, so nothing can float. Sequence: slumped in the seat, sits up, both hands on the halo rails, pulls himself up, feet onto the sidepods, crouches holding on, stands on the car, turns and hops off, lands, takes off the helmet, throws it out over the side of the truck, hands on head, walks down the bed to the rear tyre, turns and sits with his back against it. About 20 s in total (6.2 s lift, 13.8 s driver).
- **Hands and feet** by two-bone IK (`P.ikAngles` in `person.js`) blended with the hand-made pose by a weight per key; planted feet are kept flat.
- `frame.js` skips posing the player's car while the cutscene owns it (`S.cine.carFree`); the car goes back where it was when the cutscene ends.
- **Check:** `node scripts/dnf-test.mjs [track]` runs the real code for 300 wrecks per track (rolled, on their side, airborne, against the barrier). Austin: truck inside the barrier in 300/300 (worst room 5.3 m), never overlapping the car, car lands within 6 mm of the bed centre and 0.25 deg of level, soles within 7 mm of the bed (never above it), hands within 6 cm of the halo rails, hips never inside the car after the hop. Monaco: same, with soles up to 3.6 cm low for one moment as he turns on the sloping bed.
- **Not seen in a browser.** The truck is boxes and cylinders in the game's flat-shaded style; the camera shots are rewritten for the new scene (they are the cutscene's own shots, relative to the truck and car; no gameplay camera changed). The foot targets on the sidepods (height 0.51 m) come from the car's `POD` table, the rails from `CAR_SPEC`; if his feet look a little off the bodywork, those two numbers in `dnfKeys` are the knobs.

# Spa-Francorchamps: research, and how the game compares (2026-10-03)

How this was done: the real lap is the OpenStreetMap `highway=raceway` ways chained into one loop
(Overpass, 30 ways, 6,972 m against the official 7,004 m), with heights sampled every 20 m along it
from two terrain models through OpenTopoData: EU-DEM 25 m and SRTM 30 m. Both are surface models,
so trees and banks add a few metres of noise; I used their mean, median-filtered and smoothed. The
game lap is the existing layout string, measured with the real `buildTrack()` in Node. Nothing was
seen in a browser (see the end of this section).

Sources:
[F1, Highs and lows](https://www.formula1.com/en/latest/article/highs-and-lows-which-f1-track-has-the-most-elevation-changes-.7I9JEcBw3R2AqXbnJ6hyvc) ·
[Wikipedia, Circuit de Spa-Francorchamps](https://en.wikipedia.org/wiki/Circuit_de_Spa-Francorchamps) ·
[RacingNews365, 2022 changes](https://racingnews365.com/the-extensive-changes-made-to-spa-ahead-of-the-2022-f1-belgian-gp/amp) ·
[Motorsport.com, gravel traps return](https://au.motorsport.com/f1/news/spa-80million-euro-revamp-gravel-traps/4888501/) ·
[Motor Sport, winter overhaul](https://motorsportmagazine.com/archive/article/march-2022/11/spas-winter-overhaul-revealed) ·
[RaceFans, pit entry](https://www.racefans.net/?p=4430) ·
[Spa-Francorchamps, trackside hotel](https://www.spa-francorchamps.be/en/news/575_circuit-de-spa-francorchamps-unveils-an-unprecedented-premium-trackside-accommodation-offering-with-) ·
[Le Shuttle, Stavelot abbey](https://www.leshuttle.com/uk-en/discover/traveller-guides/everything-you-need-to-know-about-circuit-de-spa-francorchamps) ·
OpenStreetMap (raceways, pit lane, buildings, grandstands, villages, streams) · OpenTopoData (EU-DEM 25 m, SRTM 30 m).

## Confirmed

- **Layout.** 7.004 km, 19 turns, driven **clockwise** (Wikipedia; the OSM lap's signed area is
  positive with y pointing south, the same sign as the surveyed clockwise circuits).
- **Corner order** (from the OSM geometry, apex by apex): La Source (right hairpin, 145°) · the run
  down past the old pits · Eau Rouge (left) · Raidillon (right, then a left over the crest) · Kemmel
  straight (one gentle right kink) · Les Combes (right-left) · Malmedy (right) · Rivage (right
  hairpin, 178°) · a left (OSM calls the sections round here "Bruxelles" and "Speaker's Corner"; its
  tags are one corner out of step, the hairpin is tagged Bruxelles) · Pouhon (double-apex left,
  148°) · Fagnes (right-left) · Campus (right, 94°) · Courbe Paul Frère (right, 117°, the old
  Stavelot) · Blanchimont (two fast lefts) · Bus Stop (right-left chicane). Your list matches; it
  leaves out the left after Rivage and treats Campus and Stavelot as one area, which is fair.
- **Height range: 102.2 m** (F1 and Wikipedia agree). The terrain models give 105–107 m raw and
  105.5 m smoothed; the extra is tree and bank noise, so the game uses the published 102.2 m.
- **Highest and lowest points.** Sources disagreed (Les Combes, or Malmedy). F1 says Malmedy, and
  both terrain models agree: the top is at Malmedy (OSM lap 2.34 km), and the bottom is at Courbe
  Paul Frère (4.74 km), as F1 says ("downhill all the way to Turn 15"). **Used: Malmedy.**
- **La Source to Eau Rouge** drops about 35 m (DEM). **Raidillon** climbs about 35-40 m. Published
  gradient: F1 says 17 % and 40 m; Wikipedia says "in excess of 18 %". The terrain models only show
  13 % over a 40 m baseline (they smooth out short, steep pieces). **Used: a peak of 17.9 %**, between
  the two published figures.
- **Kemmel straight climbs** the whole way to Les Combes (about 35 m more), and **sector 2 falls**
  from Malmedy through Rivage and Pouhon (Pouhon itself is steeply downhill, about 13 % before it).
  Fagnes and Campus are low; Blanchimont climbs back; the start straight climbs to La Source.
- **Pit lane** (OSM, plus RaceFans): on the **right** of the start straight (the pit building and
  paddock side), entry **inside the Bus Stop chicane**, exit **just after La Source**, joining on
  the right on the way down to Eau Rouge. The main F1 grandstand faces the pits across the straight
  (OSM "Tribune F1", left side).
- **Run-off.** In 2022, gravel traps went in at **La Source, Raidillon, Les Combes, Stavelot and
  Blanchimont**, Raidillon's run-off was widened both sides with the barrier moved back, and Les
  Combes's asphalt became gravel (Wikipedia, RacingNews365, Motorsport.com). Motor Sport says a
  gravel trap was being added at the **Bus Stop** too.
- **The stream.** The Eau Rouge stream crosses under the track at the bottom of the dip (Wikipedia;
  OSM streams).
- **Around La Source / Eau Rouge** (OSM): Francorchamps village, with its church (Saint-Georges),
  about 1 km outside La Source; the "Hôtel de la Source" about 300 m outside the hairpin; the
  historic **Hôtel de l'Eau Rouge** on the right at the bottom of Eau Rouge, and Villa t'Stertevens
  (both being restored, Spa-Francorchamps news); grandstands "Silver 1" and "Endurance" on the left
  of the run down to Eau Rouge, the **Raidillon grandstand** on the left at the top of the climb;
  campsites (Camping 35, P3) outside La Source.
- **Further out** (OSM): Malmedy town 3.6 km east, Stavelot 4.4 km south-west, the hamlets of
  Burnenville and Masta outside the Malmedy-to-Stavelot side of the lap (the old circuit ran
  through them), Camping de l'Eau Rouge near Stavelot.

## Not confirmed

- **Cambers and banking.** I found no published figures for the camber at La Source, Pouhon or
  Blanchimont, or for Eau Rouge beyond "compression" (1.7 g, F1/f1technical). Wikipedia calls one
  of the Les Combes corners "slightly banked" and the bypass of Stavelot "banked", with no numbers.
  **The game adds no banking at Spa**; the compression comes from the height profile alone.
- **"Old monastery at La Source".** I could not find one. The historic buildings there are the
  Hôtel de l'Eau Rouge and Villa t'Stertevens; the famous abbey is in **Stavelot, about 8 km away**.
  The game uses a fictional old stone hotel at La Source and a generic abbey with a spire on the
  horizon towards Stavelot.
- **Old pits.** The pre-1979 pits stood on the run from La Source down to Eau Rouge; I could not
  confirm what is still standing there. The game has a low, generic old pit row on that stretch.
- **Old Masta road.** Its exact course was not used. The game shows a small public road leaving
  the outside of Les Combes towards Burnenville and one arriving at Paul Frère from Stavelot.
- **Run-off corner by corner.** Beyond the five 2022 gravel traps (and the Bus Stop one), which
  corners have tarmac and which grass is my reading, not a survey.
- **Grandstands at Les Combes, Pouhon, Blanchimont, Stavelot.** OSM did not map them as buildings;
  the game places generic stands and spectator banks there.
- **The start line position.** OSM has no node for it. The game keeps its own (about 200 m before
  La Source's apex).

## The game against the real circuit (before this work)

Measured on the game lap (1001 nodes, 7,007 m):

| | Game before | Real |
|---|---|---|
| Direction | clockwise (net turn +360°, area +1.11 M) | clockwise |
| Height range | 102 m | 102.2 m |
| Highest point | Les Combes (u 0.40) | Malmedy |
| Lowest point | u 0.745 (Paul Frère) | Paul Frère |
| La Source → Eau Rouge drop | 27 m | about 35 m |
| Raidillon steepest | 16.7 % | 17 % / over 18 % |
| Heights between the extremes | estimates (5 points, eased) | DEM |
| Pit entry / exit | 0.86 (in Blanchimont) / 0.10 (bottom of Eau Rouge), the defaults | Bus Stop / after La Source |
| Run-off | 18 m of plain tarmac everywhere | gravel at 5-6 corners, tarmac and grass elsewhere |

**Layout mismatches** (listed for you to decide; none changed):
1. **Shape.** Lined up with the best scale and rotation, the game lap is **167-213 m RMS** off the
   OSM centreline (max 313-352 m).
2. **Kemmel straight is about 680 m too long.** Raidillon crest to Les Combes apex: game 1,806 m,
   real about 1,125 m. Everything after it sits later in the lap (Les Combes at u 0.374 against a
   real 0.29-0.31).
3. **Sector 2 is squeezed.** Les Combes to Pouhon: game 1,078 m, real 1,425 m. The heights are fitted
   corner to corner, so the drop into Pouhon is steeper in the game than it really is (capped at 12 %).
4. **Bus Stop to La Source is short**: game 455 m, real about 660 m.
5. **Courbe Paul Frère turns 27°** in the game; the real corner turns 117°. Campus and Paul Frère
   are drawn as one long 107° right plus a kink.
6. **Blanchimont is one 47° left** in the game; the real one is two lefts (38° and 45°).
7. **Corner angles** elsewhere: Pouhon 111° (real 148°), Rivage 161° (178°), Eau Rouge-Raidillon
   L27/R38/L19 (real L18/R50/L25).
8. **Corner radii.** The layout string adds up to 4,597 m and is stretched ×1.52 to 7,004 m, so every
   radius is 1.52× too large (La Source about 21 m).
9. **The Bus Stop sits 95 m from the foot of Eau Rouge**, 20 m higher. At the real circuit they are
   several hundred metres apart. The 3D ground between them is a long even slope (about 35 %).

The fix for 1-9 would be the one Suzuka got: build Spa from the surveyed OSM path (already chained,
6,972 m, clockwise). That changes where every corner is, so I have not done it.

## Part 2: direction and heights (done 2026-10-03)

- **Direction**: already clockwise before this work (the handedness fix of `0eeb4ae`), still clockwise.
  Net turn +360°, signed area +1,110,045 m² (+ is clockwise with y pointing south; calibrated on the
  surveyed clockwise circuits). Nothing had to be reversed, so the start line, grid, lap counting, AI,
  kerbs and the sides of everything are as they were.
- **Heights**: `src/tracks/survey/spa.js`. The real heights along the real lap, pinned corner by corner
  to the game's corners (17 apex pairs), the grade capped at 18.5 % on Raidillon and 12 % elsewhere
  (needed where a game section is shorter than the real one), scaled to the published 102.2 m, and
  stored as 400 samples round the lap, eased between. The table is periodic, so the end of the lap
  meets the start exactly (seam 0.0000 m).
- **One global height factor**: `ELEV_VISUAL` in `src/tracks/shared.js`, **1.0**, so displayed = real.
  (The COTA work added the same constant at the same time; there is one copy.) The physics reads the
  slope, so a factor above 1 would change how every circuit drives; I left it at 1.

| | before | after (real = displayed, ×1.0) |
|---|---|---|
| Winding | clockwise | clockwise |
| Lap | 7,007 m | 7,007 m |
| Min / max | 0.0 (u 0.745) / 102.0 (u 0.400, Les Combes) | 0.0 (u 0.742, Paul Frère) / 102.1 (u 0.398, Malmedy) |
| Start line | 45.0 | 51.0 |
| La Source | 38.5 (lower than the line) | 60.2 (the straight climbs to it, as it really does) |
| Eau Rouge (bottom) | 18.1 | 26.0 (34 m under La Source) |
| Top of Raidillon | 35.6 | 45.4 |
| Les Combes | 100.9 | 95.0 |
| Pouhon | 71.3 | 37.1 (well down the hill, as it is) |
| Steepest | 17.8 % | 17.9 % (Raidillon) |
| Pit lane | in 0.86, out 0.10 (defaults) | right side, in 0.967 (Bus Stop), out 0.048 (after La Source), box 0.999 |

Checks: an AI car laps in 94-96 s, takes the pit lane on lap 2 (in at the Bus Stop, stops at the box,
rejoins after La Source; +8.5 s), lap counting works, the car stays within 0.2 m of the road surface.
The other eleven circuits build exactly as before (every node's x, z and speed compared).

# Spa world (2026-10-03)

Files: `src/render3d/worlds/spa-plan.js` (pure numbers: terrain, land cover, placement, audit, runs
in Node), `spa-kit.js` (building and plant geometry), `spa.js` (the three.js world and its animation),
data in `src/tracks/survey/spa.js`. Hooked into `render3d/build.js` (own ground, build call, advert
set) and `frame.js` (per-frame step, and the existing cut-away dither is now on for Spa as well as
Monaco). Check with `node scripts/spa-audit.mjs [detail]` and `node scripts/census.mjs spa`.

## How the real place gets onto the game's lap

The game's lap is not the real shape, so the real valley is carried across in **lap coordinates**:
a point at lap distance s, offset o beside the game's track is matched to the point at the
corner-pinned real distance and the same offset beside the real track. Past 330-430 m that gives
way to one overall fit (scale 0.79, turn -104°) for the far hills.

- **Ground**: EU-DEM 25 m sampled every 40 m round the real lap and every 30 m across it out to
  ±480 m (5,742 samples), plus a 12 km square at 250 m for the hills. Heights are used relative to
  the real track beside them, so the road always meets its own verge. The model reads only about
  0.4 m higher in forest than in the open at forest edges, so it is used as bare ground.
- **Banks and cuttings**: past the verge the ground eases into the real lie of the land over 46 m,
  never rising faster than 55 % or falling faster than 95 % from the verge (so the overhead camera
  sees over it). Where two parts of the lap run close, the ground slopes evenly from one barrier to
  the other.
- **Land cover**: OpenStreetMap forest, meadow, scrub, houses, farmyards, car parks, campsites and
  water rasterised at 25 m (53 % forest, 39 % meadow). Trees, fields, villages and car parks go where
  the real ones are relative to each corner.
- **Water and roads**: the real Eau Rouge, Hockai, Rohon and other streams, the roads and the
  forest tracks, carried across the same way. The streams run in carved channels that never flow
  uphill. The Eau Rouge crosses the game's track at node 95 (u 0.095), the foot of the dip, where a
  stone culvert with an arch stands either side.

## What is built

- **Forest**: Norway spruce (the bulk), Scots pine, beech, oak and birch, in drifting groves; 7 % of
  the broadleaves already turning. Clearings, tree lines along field edges, the odd tree in a meadow;
  thinner right by the barrier, taller up the hills. 37,047 full trees within 360 m of the barrier,
  12,350 cheaper ones beyond; 9,642 ferns and bracken, 2,077 shrubs, 3,228 wildflower patches, 73
  hedge runs along lanes, hay bales, cows and sheep in the fields.
- **Buildings** (all with slate gable roofs, windows, doors, chimneys or setbacks; no plain boxes):
  171 houses and 39 farms with barns where OpenStreetMap has houses and farmyards; the village church
  where Francorchamps's is mapped; an abbey with a spire on the horizon towards Stavelot; a fictional
  stone hotel with a bell turret at La Source ("Hotel du Virage"); the old hotel on the right at the
  foot of Eau Rouge ("Hotel du Ruisseau"); a low old pit row on the run down to it; hospitality
  chalets at the top of Raidillon.
- **Circuit**: the pit building (garages in team colours, a glazed hospitality floor and balcony, a
  roof terrace), a paddock with team trucks and a hospitality unit, a covered main stand across from
  the pits, nine more stands and ten crowded grass banks where the real ones are (13,400 spectators,
  about one in six waving a flag), 20 marshal posts, 7 TV towers, the start-light gantry (it lights
  with the session's count and goes out at the start), tyre walls along every gravel trap (3,842
  stacks), catch fencing at Eau Rouge-Raidillon, Pouhon and Blanchimont, 329 advert panels, a big
  "PADDOCK" sign from plain shapes.
- **Adverts**: a Spa set in `hoardings.js`, all invented: Cocoa Brakes, Waffle Wizard ("Dough not
  slow"), Double Frites ("Fried twice, like Pouhon"), Abbey Ale, Peloton Potatoes, Drizzle Insurance
  ("It's sunny at Les Combes. Not here"), Speculoos Slicks, Damp Socks Depot and others.
- **Campsites**: 751 tents, frame tents, camper vans and flagpoles on the mapped campsites and the
  meadows behind La Source, Les Combes and Blanchimont (which fields is my choice). 1,782 parked
  cars in the mapped car parks near the circuit.
- **Atmosphere**: soft overcast light (sun 1.0, cool), cloud shadows drifting over everything, which
  close over in the rain; cool green-grey haze; mist sheets drifting in the Eau Rouge valley; the far
  hills and three rings of hazy blue-green ridgelines for the shots that look out.
- **Details**: chimney smoke from about one house in six, three hot-air balloons drifting round, a
  cyclist riding a lane near the circuit, flags waving on the stands and campsites, fans waving on
  the banks, cows and sheep in the fields.
- **Detail setting**: Lite uses a 12 m ground grid, about 60 % of the trees, no undergrowth or mist.

## Checks (Node; no browser here)

- **Clearance** (`auditSpa`, against every segment of the centreline): 49,397 trees, closest canopy
  2.02 m past the barrier line, none over it; houses at least 115 m away; stands, banks, pits and
  posts at least 0.61 m clear; tents and cars 9.95 m. Lite: trees 2.11 m. The pits are measured to
  the wall the cars feel on their own straight and to the barriers everywhere else.
- **Clipping**: no ground vertex inside the barrier line rises above the lowest road ribbon (4,962
  checked); behind the Armco the ground rises at most 3.5 m over the road (a cutting at Raidillon).
- **Frame**: the world's own frame step ran 600 frames (start lights, smoke, balloons, cyclist, mist)
  with no errors.
- **Build**: `npm run build` gives one 3.7 MB HTML file.

## Performance

Measured through the real `G3.build` in Node, counting what the game's overhead camera (same maths as
`frame.js`, slow-speed zoom, 1280 × 800) and the shadow camera would draw, with three.js's own frustum
test. Frame times could not be measured: no browser here.

| | draw calls per frame | triangles per frame | build |
|---|---|---|---|
| Spa before | 83-240 (418 on the grid with 20 cars) | 80-150k | 0.16 s |
| Spa after | 140-220 (436 on the grid) | 270-590k | 1.5 s (1.2 s of it the plan) |
| Spa after, Lite | 165-197 | 250-360k | 0.7 s |
| Suzuka | 135-170 | 210-660k | 0.6 s |
| COTA | 106-131 | 160-265k | 0.6 s |

On the coarser `scripts/census.mjs` measure (everything within 450 m) Spa is heavier than Suzuka:
about 600 draw calls and 1.3 M triangles, against about 420 and 0.57 M. The one real browser reading
before this work: old Spa at La Source, 90 calls, 79k triangles, 2.3 ms GPU, 1.5 ms CPU per render.

What keeps it there: everything repeated is instanced in 200 m chunks with their own bounds; buildings
merge into one mesh per chunk; tree trunks and cones are open-ended (their caps are never seen from
above, which halves a spruce); only trees within 60 m of the barrier cast shadows; trees beyond 360 m
are a cheaper shape; undergrowth only within 70 m.

## Not done / owed

- **Seen in a browser**: nothing in this section. The visual checklist is below.
- **Materials**: the brief says MeshLambertMaterial; the game moved to MeshStandardMaterial for every
  surface (see `G3.mat`). The Spa world uses vertex-coloured, flat-shaded Standard materials like
  Suzuka, which looks the same as Lambert at this roughness.
- **Banking**: none, for want of figures (see Not confirmed).

## Visual checklist (please)

Drive a time trial at Spa (`npm run dev`) and look at:
1. **La Source**: the hairpin's gravel and tarmac, the stand outside it, the stone hotel with its
   turret, the pit lane running inside the hairpin and out after it (the lane follows the track's
   inside here; tell me if it looks wrong).
2. **Eau Rouge and Raidillon**: the dip and climb, the stream and the culvert at the bottom, the mist,
   the catch fencing, the red-seated stand and the chalets at the top, the banks of fans.
3. **Kemmel**: the long climb through the spruce, adverts on the Armco.
4. **Les Combes, Pouhon, Blanchimont, Bus Stop**: gravel traps and tyre walls, stands and banks.
5. **The pits**: garages facing the lane with no Armco in between, the paddock, the main stand.
6. **Anything clipping** through the track, barriers, stands or buildings, trees over the run-off,
   trees hiding the car (they should dither away as the car passes behind them).
7. **Frame rate** at Eau Rouge and Blanchimont, Full and Lite.
8. **Rain**: the grass and trees should darken and the cloud shadows close over.

---

# Singapore (Marina Bay) night overhaul: research, mismatches, decisions

## Research (Part 1). Sources and how sure I am

| Fact | Value I found | Source | Confidence |
|---|---|---|---|
| Length and corners | **4.940 km (2023-24) or 4.927 km (2025 onwards)**, 19 turns; the 2023 change turned the old Turns 16-19 ("Float" section) into one 397.9 m straight on Raffles Avenue, 23 -> 19 corners. Wikipedia itself says both 4.928 km (text) and 4.940 km (lap-record table); other pages say 4.928. The game says 4,940 m (2023-24) and I kept it. | [Wikipedia](https://en.wikipedia.org/wiki/Marina_Bay_Street_Circuit), [GrandPrix247](https://www.grandprix247.com/formula-1-news/singapore-grand-prix-organizers-revise-track-layout-for-2023) | sources disagree by 12 m; I show both |
| Direction | anticlockwise (the Wikipedia list of circuits, as used in the 0a audit above) | [list of F1 circuits](https://en.wikipedia.org/wiki/List_of_Formula_One_circuits) | high |
| Corner order | T1 tight left (Sheares), T2 a curve right, T3 tight left hairpin, T4 a kink, **T5 right onto the longest straight**, T7 (Memorial) slow left, best overtaking spot, T8 tight right, T9 medium left, T10 a mid-speed left "sling" where the Singapore Sling used to be (chicane removed 2013), then the Anderson Bridge, **T13 tight left hairpin** (tightest on the lap), T14 right with DRS, T15 flat-out left kink, T16/17 a tight chicane, T18/19 a flat-out double-apex left to finish | [SI track guide](https://www.si.com/onsi/f1/guides/singapore-grand-prix-marina-bay-circuit-track-guide), Wikipedia | medium (T11/12 and where the bridge sits between them I could not confirm) |
| Bridges | Benjamin Sheares Bridge (T1 is named after it), Anderson Bridge (built 1910), Esplanade Bridge | Wikipedia | high |
| Elevation | **5 m total** ("total elevation change of 5 meters"); no gradients found for the bridge ramps | [f1-fansite](https://www.f1-fansite.com/f1-circuits/singapore-circuit/) via search | medium: one number, no profile. I used it as the range and put it on the bridges rather than inventing hills |
| Pit lane | on "an empty plot of land off Republic Boulevard and beside the Singapore Flyer"; entry begins at the **penultimate corner** (T22 in the original layout, which is the first apex of today's final double-apex left); entry was judged "difficult and incredibly dangerous" and modified. **I found no pit-exit position, no box count and no box positions.** The side (left/infield) is my assumption. | Wikipedia | medium for the entry, none for the rest |
| Lighting | about **1,500 to 1,600** floodlight projectors (sources: "nearly 1,500", "approximately 1600 custom-made floodlights", "around 1,600"), 108,423 m of cable, 240 steel pylons (one source), 3.18 MW, ~3,000 lux average, aluminium trusses 10 m up | [Singapore GP 2008 lighting page](https://singaporegp.sg/news/2008/live-demonstration-of-the-2008-formula-1a-singtel-singapore-grand-prix-lighting-system/), [The Peak](https://www.thepeakmagazine.com.sg/lifestyle/f1-lights-signify), Wikipedia | sources disagree (1,500 vs 1,600); the game uses glow instead of lights, so the number only sets spacing |
| Run-off | street circuit, concrete walls, tight run-off. I found no map of the few escape roads. | racefans / Wikipedia | low |
| Visible surroundings | the Singapore Flyer, Supreme Court and Parliament, Esplanade Drive past the Merlion Park, the Anderson Bridge are named on track guides. I did **not** confirm which skyline buildings, the domed arts centre or the Padang are visible from which corner. | track guides | low |
| Night race, storms | night race under floodlights, hot and humid; "at least one safety car in every Grand Prix until 2024" | Wikipedia | high |

## Mismatches against the game (measured by `scripts/track-audit.mjs singapore`, not by eye)

1. **Direction: already correct** (net turn -360, signed area -1,242,211: anticlockwise). Nothing to reverse, nothing mirrored.
2. **Length:** game 4,943.5 m; real 4,940 (2023-24) / 4,927 (2025+).
3. **Corners:** the game's layout string finds 15 corner runs against 19 real turns. Its first three corners (L82, R76, L78) match T1-T3, but there is no T4 kink or T5 right: the game goes straight from T3 into a 584 m straight, where the real circuit has a kink and a right-hander first. I did not change the layout (rule). The last four corners (R, L, L, L = T15/T16-17/T18-19) look right.
4. **Elevation:** the old profile was `1.5 * sin(3 cycles) + a 3 m bump at u 0.664`: a fake three-cycle wave, range 4.28 m, with the "bridge" bump on the T13 hairpin itself. Real: nearly flat, 5 m total.
5. **Pit lane:** the game's zone ran from u 0.860 to 0.101 (the shared default): 1,190 m, entry well before the last corners. Real: entry at the first apex of the final double-apex left.
6. **Landmark positions** (tower complex, domes, wheel, Fullerton-style hotel, Merlion-style statue) are placed by lap fraction from the old scene list, not by geography; the game's circuit is the layout string's shape, not the surveyed one.

## Results (Parts 2 to 5): `node scripts/track-audit.mjs singapore`, `singapore-audit.mjs`, `singapore-world3d.mjs`, `census.mjs singapore`

### Direction and elevation, before and after

| | Before | After |
|---|---|---|
| Winding | net turn -360 deg, signed area -1,242,211: anticlockwise | identical (already right; nothing reversed, nothing mirrored) |
| Lap length | 4,943.5 m (real 4,940 m in 2023-24, 4,927 m from 2025) | 4,943.5 m |
| Height range | -1.50 to 2.78 m = 4.28 m, a fake three-cycle sine plus a 3 m bump on the T13 hairpin; steepest 7.7 % | -0.20 to 4.72 m = **4.92 m** (real: about 5 m); steepest **3.9 %**, on the Anderson-bridge ramp |
| Seam | 0.04 m | 0.000 m, gradient 0.00 % either side |

Heights now (m): start line 0.00, Esplanade bridge crown (u 0.435) 1.39, low point before the bridge (u 0.572) -0.20, Anderson bridge crown (u 0.616) 4.72, end of lap (u 0.99) 0.01. `ELEV_VISUAL` stays 1.0: displayed = real everywhere. The profile is flat except for two bridges because the only real figure I found is "5 m in all", with no profile; **which straight carries which bridge is my reading** of the corner order (see the mismatches).

### What was built (`worlds/singapore.js`, planned by `singapore-plan.js`, parts in `singapore-kit.js` and `singapore-bld.js`)

- **City:** about 1,430 buildings (offices with podiums, setbacks and crowns; slim towers; apartment blocks with balcony ledges; hotels with lit awnings; slabs; shophouse rows with tiled roofs and five-foot-way columns; colonial buildings with colonnades and pediments), taller the further they stand from the track (never within 30 m + 0.8 x height of the barrier, so the overhead lens still sees the road). Landmarks, all generic: a three-tower complex leaning together under a **boat-shaped sky deck** with a lit pool, a **twelve-sided ring of glass offices**, a **stepped art-deco tower** with a gold crown, two **spiked domes** for the arts centre, a **fish-tailed lion statue** with a lit spout, a colonial hotel, a lawn with a pavilion and clubhouse, an **observation wheel** that turns (with cycling LED bulbs), two bridges and five footbridges, a floating stand on the bay.
- **Windows:** three small shared canvas textures (apartment grid, office band, slim tower) on unlit materials; a facade is two triangles, each building has its own offset and tint. Roof beacons blink in turn.
- **Water:** the bay is the inside of the loop beyond a promenade, with channels under both bridges. A fake reflection (238 of the tall buildings mirrored under the surface, dark) shows through a glossy translucent sheet, and drifting glints slide across it. Boats and ferries circle on it; three ships lie at anchor.
- **Night light, no real lights:** floodlight pylons with additive glow sprites, street lamps with sprites, a **light pool painted along the road** under every lamp and a faint streaked cyan sheen for damp asphalt (two additive strips), emissive neon edges, LED screens, bloom from the base pipeline (`grade` tuned calmer than Las Vegas: strength 0.58, exposure 1.16), a violet-teal haze.
- **Sky and show:** a deep blue-violet dome with a warm city haze and stars; a rare storm cloud with a lightning bolt and a flash; a light show of sweeping beams from the tops of the tall landmarks on a 60 s cycle; fireworks over the bay every ~22 s; a helicopter with strobes.
- **Track:** tiered stands with scaffold, a lit front edge, fans and catch fencing (with a roof on two); the pit building (garages' glass, striped awnings, a timing tower) and a paddock sign over the entrance; tyre walls behind the concrete on the outside of every corner; TV towers; flag poles; food stalls with strings of bulbs; adverts (see the SINGAPORE set in `hoardings.js`, e.g. "QUEUE & CO. Because the rice is worth it").

### Performance (real `G3.build`, no GPU: draw calls and triangles; frame time could not be measured)

| | Draw calls if all drawn | Triangles if all drawn | Within 450 m of the start / Esses / back straight (draw calls; triangles) |
|---|---|---|---|
| Singapore before | 1,125 | 86,699 | 276; 71,847 / 250; 69,675 / 288; 69,892 |
| Singapore after (full) | 941 | 566,288 | 271; 197,288 / 230; 188,578 / 211; 170,700 |
| Singapore after (Lite) | 920 | 382,792 | 260; 134,684 / not printed |
| COTA | 1,029 | 1,357,491 | for comparison |
| Suzuka | 1,899 | 3,127,023 | |
| Silverstone | 5,980 | 1,893,312 | |

Fewer draw calls than before and about 6.5 times the triangles, still well under every other detailed track (about 190k within 450 m of any spot, against COTA's 375k and Suzuka's 550k+). Plan time in Node about 70 ms, world build about 210 ms.

### Not done, not verified, or only partly done (honest list)

- **No screenshots and no frame times** (browsers cannot run on this machine). I checked geometry in Node: 0 buildings within 12 m of a barrier, 0 buildings on water, 0 tall buildings near the track, 0 trees or lamps in the road, 0 ground-above-tread hits on 2,508 stand cells, footbridge columns clear of the barrier, and the animation (storm, beams, fireworks, boats, wheel) runs 4,000 frames without error. The tint-mask instancing shader is the one COTA already uses; shaders are not compiled by a GPU here.
- **Landmarks are not at their real places.** The game's circuit is the layout string's shape, not the surveyed one, so the wheel, domes, tower complex, colonial hotel and statue sit at the lap fractions the old scene list used.
- **Not done:** heat shimmer and mist beyond the fog tint; hanging planters (there are kerbside planters); people on balconies; the lit bridges are two fixed colours, not colour-cycling; kerb widths unchanged (the base's kerbs); real escape roads (none found).
- **Pit lane:** entry at the first apex of the last double-apex left (Wikipedia); exit, box positions and the side are not in anything I found. The lane is 707 m in the game (u 0.915 to 0.058).
- **Floodlight count:** sources say about 1,500 to 1,600; the game has 141 pylons and about 300 street lamps because glow is a sprite, not a projector.

### Layout questions (I did not change these)

1. The layout has 15 corner runs against 19 real turns. Its T1-T3 match (left, right, left), but T4 (a kink) and T5 (a right onto the longest straight) are missing: it goes straight from T3 into a 584 m straight. Do you want the layout string extended to the real 19?
2. Which straight carries the Anderson Bridge? I put it on the 273 m straight before the T13 hairpin (u 0.585-0.646) and a smaller Esplanade bridge on the 469 m straight before it. If you know it differently, it is one list in `singapore.js` (`BR` in the plan) and the elevation points in `singapore.js` (the track definition).
3. Length: 4,940 m (2023-24) or 4,927 m (2025+)? The game uses 4,940.

### Visual checklist (npm run dev, circuit "Singapore")

1. The first corners and the pit straight: the stand opposite the pits, the lit pit building with its striped awnings, the paddock sign, floodlight pylons with glows, light pools under each lamp on the road.
2. The waterfront and the bay: dark glossy water, the mirrored skyline, drifting glints, boats; the observation wheel turning and the three-tower complex with its deck across the bay.
3. The bridge (u about 0.6): the lit arches, the water on both sides and the rise of about 4.7 m.
4. T13 hairpin stand; the Memorial corner (T7) stand; the footbridges over the straights with fans on them.
5. Look up: stars, the warm haze at the horizon, red roof beacons blinking, light-show beams and fireworks (give it a minute), and now and then a flash from the storm cloud.
6. Console: look for `singapore ...` warnings; the world is built inside try/catch, so a bug shows as a warning and a plainer circuit. `window.__singapore.audit()` reruns the clearance audit.

# Interlagos (São Paulo): research, and how the game compares (2026-10-04)

How this was done: the real lap is the OpenStreetMap `highway=raceway` ways chained into one loop (25 ways,
4,295 m against the official 4,309 m). Heights every 20 m along it from SRTM 30 m and ASTER 30 m through
OpenTopoData (EU-DEM does not cover Brazil). ASTER is noisy here (74 m range, 27 % "grades"), so SRTM is
used. The game lap is the existing layout string, measured with the real `buildTrack()` in Node. Nothing
was seen in a browser.

Sources: [F1, Major ups and downs](https://www.formula1.com/en/latest/features/2016/10/highs-and-lows---which-f1-track-has-the-most-elevation-changes-.html) ·
[f1-fansite](https://www.f1-fansite.com/?p=6731) · [Mercedes, corner names](https://www.mercedesamgf1.com/news/how-the-interlagos-corners-got-their-names) ·
[Motorpasión](https://www.motorpasion.com/formula1/asi-es-el-circuito-de-interlagos) · [Pit Debrief, 2024 resurfacing](https://www.pitdebrief.com/?p=32376) ·
[Rio Times, 2026 guide](https://www.riotimesonline.com/sao-paulo-grand-prix-2026-f1-interlagos-guide/) · [Verdict, weather](https://www.verdict.co.uk/brazil-grand-prix-weather/) ·
OpenStreetMap · OpenTopoData (SRTM 30 m, ASTER 30 m).

## Confirmed

- **Layout**: 4.309 km, 15 turns, **anticlockwise** (the OSM lap's signed area is negative with y south).
- **Corners in order** (OSM geometry, apex by apex): Senna S (T1 left 114°, T2 right 77°), Curva do Sol (left
  102°), Reta Oposta, Descida do Lago (T4 left 95°, T5 left 62°), Ferradura (right, 134°), Laranjinha (right,
  134°), Pinheirinho (left 171°), Bico de Pato (right hairpin 178°), Mergulho (left 104°), Junção (left 100°,
  then two small lefts at "Café"), Subida dos Boxes (left 49°), Arquibancadas (left 26°), the pit straight.
  (OSM's names are one corner out of step round Ferradura and Laranjinha, as at Spa.)
- **Height range: 43 m** (F1 and f1-fansite; SRTM smoothed along the lap: 43.0 m). **Highest** on the rise
  before Turn 1 (SRTM: 4,240 m round from the Senna S entry, just before the line); **lowest at Turn 5**,
  the bottom of the Descida do Lago (F1 says the same). The pit straight climbs about 33 m from Junção (F1:
  "1.2 km at full throttle from Turn 12 with 33 m of climb"; SRTM: Junção 9.9 m to the line 42.9 m).
- **Profile** (SRTM, metres over the lowest point): line 42.9, T1 40.6, T2 34.7, Curva do Sol 30.7,
  **Reta Oposta 16.7: the back straight goes DOWN**, Descida do Lago T4 5.8 and T5 0.1, then **up to
  Ferradura 24.7** (the steepest bit of the lap, 13.6 % over 40 m), Laranjinha 25.1, Pinheirinho 16.3, Bico de
  Pato 29.6, a drop through Mergulho (11.6) to Junção (9.9), and the long climb to the line. Your brief
  expected a climb along the back straight; the data says it falls about 14 m, so the game follows the data.
- **Pit lane** (OSM, plus Motorpasión): on the **left**. In on the left on the run up the pit straight
  (OSM: 3,599 m round, between Subida dos Boxes and Arquibancadas), boxes along the straight, then the exit
  road runs about 20-25 m left of the track inside the Senna S and joins on the left **at the start of the
  Reta Oposta**. The mapped lane is 1,372 m long.
- **Stands**: OSM maps grandstands on the outside of the pit straight and round the Senna S, across from
  the pits.
- **The lake**: OSM has the lake (2.8 ha) **outside** the lap, about 140 m beyond the Descida do Lago ("a lake
  situated behind the confines of the track", Mercedes), and a small wetland (0.7 ha) in the infield near
  Ferradura. There is no big infield lake today. The kart track (Kartódromo Ayrton Senna) is outside, beside
  the Reta Oposta. Within 2.4 km, 8 % of the land is water: the edges of the reservoirs.
- **Surroundings**: dense housing on every side (OSM: the neighbourhoods Interlagos, Cidade Dutra, Vila
  Autódromo, Socorro and others; 1,751 streets within 2.3 km; 962 mapped swimming pools), many football
  pitches, schools, parks, a bus garage and a landfill. Housing itself is mostly not mapped as land use, so
  the world treats unmapped land outside the circuit as built-up.
- **Race**: 6-8 November 2026, race Sunday at 14:00 local; the rainy season (October to March), thunderstorms
  common, wet races in 1996, 2001, 2003, 2004, 2008, 2012. Track fully resurfaced for 2024; drivers called it
  bumpy.

## Not confirmed

- **Run-off corner by corner**: no source found. The game uses tarmac in the Senna S and at Bico de Pato,
  gravel at the Descida do Lago and Junção, grass elsewhere: my reading, flagged in the track file.
- **Kerb colours**: the game's yellow and green are kept; I did not confirm the real ones.
- **Gradients**: the 13.6 % figure is from SRTM over 40 m; I found no published gradient.
- **What is visible from the track**: I could not confirm sight lines (to the reservoirs, the skyline);
  the world places the city and the hills by the data, not by reported views.
- **Pit-lane speed-limit zone**: the game drives the whole lane at the limiter; I could not confirm where
  the real limit ends on the long exit road.

## The game against the real circuit (before this work)

| | Game before | Real |
|---|---|---|
| Direction | anticlockwise (net turn -360°) | anticlockwise |
| Lap | 4,311 m | 4,309 m |
| Height range | 44 m, an estimate | 43 m |
| Highest / lowest | the line / u 0.549 (Pinheirinho area) | before T1 / Turn 5 |
| Back straight | falling 4 m | falling 14 m |
| Out of the lake | almost flat (−10 to −6 m) | up 25 m to Ferradura |
| Pit lane | left, the defaults: in 0.86, out 0.10 | left, in before the pit straight, out on the Reta Oposta |

**Layout mismatches** (for you to decide; none changed):
1. **Shape**: lined up with the best scale and turn, the game lap is **213 m RMS** off the real one (max 382
   m), and at **scale 0.56**: the game lap covers almost twice the real area, because its corners turn too
   little and it sprawls.
2. **Corners turn too little**: Turn 1 83° (real 114°), Turn 2 58° (77°), Curva do Sol 71° (102°),
   Pinheirinho 94° (171°), Bico de Pato 99° (178°), Mergulho 79° (104°), Junção 93° (100° plus 43° of Café).
3. **Sections**: T5 to Ferradura 363 m (real 575 m), Mergulho to Junção 343 m (255 m), Bico de Pato to
   Mergulho 154 m (240 m), the line to Turn 1 280 m (75 m from the last kink), T2 to Curva do Sol 147 m (90 m).
4. **Ferradura and Laranjinha** are two right-handers of 49° and 59°; the real ones turn 134° each.

As with Spa, the fix would be to build Interlagos from the surveyed OSM path (chained, 4,295 m,
anticlockwise). I have not done it.

## Part 2: direction and heights (done)

- **Direction**: already anticlockwise; nothing reversed.
- **Heights**: `src/tracks/survey/interlagos.js`, the SRTM profile pinned corner by corner (13 apex pairs),
  the grade capped at 14 % (carried across as it is, one squeezed section would reach 21.8 %), the range
  43.0 m (no scaling needed), 400 samples, periodic (seam 0.0000 m). `ELEV_VISUAL` stays 1.0.

| | before | after (real = displayed) |
|---|---|---|
| Min / max | -10.0 (u 0.549) / 34.0 (the line) | 0.0 (u 0.343, Turn 5) / 42.9 (u 0.977, just before the line) |
| Start line | 34.0 | 42.5 |
| Senna S (T1 / T2) | 29.8 / 22.3 | 39.9 / 34.3 |
| The lake (T4 / T5) | -0.5 / -4.0 | 5.6 / 0.3 |
| Bottom of the hairpin (Bico de Pato) | -7.2 | 29.3 |
| Junção | -3.6 | 10.1 |
| Top of the pit straight | 33.6 | 42.9 |
| Steepest | 16.2 % | 13.9 % (out of the lake) |

- **Pit lane**: in 0.853, out 0.218 (the real points), box 0.955. An AI car laps in 66.7 s, pits, and the
  stop costs about **46 s** over two laps (in at 0.853, out across the line at 0.218); with the old default
  lane it cost about 29 s. The real lane is long; whether the game should shorten it is a question for you.

# Interlagos world (2026-10-04)

Files: `src/render3d/worlds/ilg-plan.js` (pure numbers, runs in Node, `auditIlg`), `ilg-kit.js` (plants, houses,
towers, sheds, stalls, pitches, screens, helicopters, kites, birds, drums), `ilg.js` (the world; it inherits
Spa's machinery with `Object.create(SPA)` and adds its own), data in `src/tracks/survey/interlagos.js`. Hooked
into `render3d/build.js`, `frame.js` (per-frame step; the cut-away dither is on here too) and `hoardings.js`
(the set). Spa's `barriers` and `mist` now take their zones and seeds from the world (`fenceZones`, `adRuns`,
`mistSeeds`), and `KIT.stand` takes a seat colour; Spa builds exactly as before. Check with
`node scripts/interlagos-audit.mjs [detail]` and `node scripts/census.mjs interlagos`.

## How the real place gets onto the game's lap

The same as Spa: SRTM 30 m every 40 m round the real lap and every 30 m across it to ±480 m (3,531 samples),
a 12 km square at 250 m for the hills, OpenStreetMap land cover at 20 m. All of it carried onto the game's lap
in lap coordinates, and by one overall fit far out (scale 0.56, turn 55°). SRTM sees roofs and trees, so the
ground is smoothed six times past the verge. Unmapped land is the city; inside the circuit's grounds (the
infield, and 60 m past the barriers) it is grass.

## What is built

- **The bowl**: the real lie of the land, which already rises on the outside of most corners (up to +16 m
  at 150 m outside Ferradura, +13 m outside the Reta Oposta) and drops to the lake.
- **Water**: every mapped lake and wetland near the circuit gets a flat surface at its lowest shore, the
  ground scooped out under it, reeds round the edge (2,376 clumps). The real lake (2.8 ha) sits behind the
  Descida do Lago, 224 m out, 5 m below the road; the infield wetland is a reedy pond 81 m inside the same
  corner. The big lakes get a small island with palms, and the one nearest the circuit gets a jetty with a
  boat. **Invented**: the islands and the jetty (the brief asked for them; OSM maps neither).
- **Planting** (3,937 trees near the circuit, 215 far): Atlantic-forest broadleaves, palms, flowering ipês
  (yellow, purple, pink), eucalyptus on the slopes, banana by the houses; shrubs, tall grass by the fences,
  flowers in the grounds. Woods where OSM maps them; groves and tree lines on the grounds; street trees in the city.
- **The city**: 9,000 houses (the nearest; Lite 4,000) on built-up land, in rows along the real streets, in
  three kinds (flat slab with a blue water tank and a satellite dish; terracotta roof; rooftop terrace with a
  tank and washing on a line), 1-3 floors, walls in twelve colours; 16 tower blocks further out (a quarter with
  a rooftop helipad); 64 warehouses on industrial land; 2 football pitches where OSM maps them, each with a
  game of five-a-side on; 856 parked cars and buses in the car parks and along the streets; a ring of 420 pale
  blocks on the horizon for the skyline.
- **Circuit**: pit building (9 modules, 450 m, along the straight only) and paddock on the left; a covered
  220 m main stand in green seats across from the pits; covered stands round the Senna S (yellow seats);
  14 grassy banks round the bowl; 18,400 spectators in yellow, green and blue, one in five waving a flag;
  flags on every stand and bank; a samba drum group on every third bank; green and yellow smoke flares and
  confetti over the main stand; two big screens; food stalls; marshal posts, TV towers, start-light gantry,
  paddock sign, catch fencing on the outside of the Senna S, Junção and along the main stand; tyre walls at the
  gravel; 210 advert panels; darker patches in the asphalt (drawing only).
- **Adverts**: an Interlagos set, all invented: Cafezinho Turbo ("Small cup. Big power unit"), Marginal Jam Co.
  ("We sell the traffic you sat in"), Churrasco Pit Stop, Suco do Lago ("Not from the lake"), Umbrella Urgente
  ("Sun at 2, storm at 2:05"), Heli-Táxi Já, Chuva Chegando, and others.
- **Sky and light**: a low, golden sun (1.25, warm) under a blue-grey storm fill, a warm wet haze, cloud
  shadows racing over everything, the grass going glossy and the lake darker in the rain, mist over the lake.
  For the shots that look out (crash, DNF, podium cameras): a dome with a heavy storm side and a golden break
  on the sun's side, and towering clouds round the horizon.
- **Details**: three helicopters circling (rotors turning), kites over the houses, parrot flocks and toucans
  round the trees by the circuit, herons over the lake, three hot-air balloons, the football games, drummers,
  flares and confetti.
- **Detail setting**: Lite uses a 12 m grid, fewer trees and houses, no low plants, mist or confetti.

## Checks (Node; no browser here)

- Lap: anticlockwise, 4,311 m, 0-42.9 m, seam 0.0000 m (`scripts/interlagos-audit.mjs`).
- Clearance against every segment of the centreline: 4,152 trees, closest canopy 2.0 m past the barrier line,
  none over it; houses, towers, sheds and pitches at least 22 m away; stands, banks, pits and posts at least
  0.69 m clear; parked cars 10.7 m. Lite: the same.
- Clipping: no ground vertex inside the barrier line above the lowest road ribbon (3,028 checked); behind the
  Armco the ground is at most 0.1 m above the road.
- Frame: 600 frames of the world's own step (start lights, flares, confetti, helicopters, kites, birds,
  balloons, mist) with no errors. AI lap and pit stop as in Part 2.
- `npm run build`: one 4.1 MB HTML file.

## Performance

Through the real `G3.build` in Node, counting what the overhead camera (frame.js maths, slow-speed zoom,
1280 × 800) and the shadow camera would draw, with three.js's frustum test. Frame times: no browser here.

| | draw calls per frame | triangles per frame | build |
|---|---|---|---|
| Interlagos before | 95-128 | 63-64k | 0.11 s |
| Interlagos after | 163-213 | 180-425k | 0.8 s (0.57 s of it the plan) |
| Spa | 140-220 | 270-590k | 1.5 s |
| Suzuka | 135-170 | 210-660k | 0.6 s |

Draw calls are a little above Suzuka's, mostly the houses (nine shapes, by kind and floors, per 200 m chunk).

## Not done / owed

- **Seen in a browser**: nothing. Visual checklist below.
- **Materials**: Standard with vertex colours, like the other worlds (the game moved off Lambert).
- **Pit loss**: about 46 s with the real 1,372 m lane (29 s before); see Part 2.

## Visual checklist (please)

1. **The plunge into the Senna S** from the line: the main stand on the right, the Senna S stands and the
   bowl of banks below, the screens.
2. **The back straight and the lake**: the lake behind the Descida do Lago with its island and jetty, the
   herons, the mist; the reedy pond in the infield.
3. **Ferradura to Bico de Pato**: the banks of fans, the drummers, the trees and flowers.
4. **Junção and the climb**: the city on the hills, the kites, the helicopters.
5. **The pits**: garages along the straight with no Armco between them and the lane; the pit exit running
   inside the Senna S and joining on the back straight.
6. **Anything clipping**, houses too close, trees hiding the car (they should dither away), frame rate Full
   and Lite, and the look in the rain.

---

## Singapore: the first build hid the road (fixed)

The first Singapore build put 1,434 buildings up to 280 m tall around the circuit, and under the game's overhead lens you could not see the track. The lens is **fixed**: 35.264 deg up, from the south-east (camera at +x, +y of the car; `frame.js`: `el = 35.264, az = 45 deg`). A building of height h hides about **1.414 x h** of ground behind it along the north-west diagonal, so a 100 m tower hides 141 m of road. My "taller means further back" rule used a distance from the barrier in every direction, which is nothing like that.

- **Measured before and after** (`node scripts/singapore-world3d.mjs`, the "view from the overhead lens" line: it casts the real sight line from road points all round the lap): **38.4 % of road points were hidden** (272 of 708); now **0 of 708**.
- **Height cap** (`maxH` in `singapore-plan.js`): every building's height is capped to whatever keeps the road out of its shadow, by marching the view diagonal from its footprint over the ground grid's distance-to-barrier. A building that would be shorter than 8 m is not built (so the strip just south-east of the track is open ground, planting and street furniture, not buildings); one that ends up under 24 m becomes a low block; landmarks search other positions until they can be 92 % of their height. Landmarks that had to move or shrink are listed by the audit.
- **Streets between blocks:** footprints now keep a 12 m street (before, 4 m), the lattice is wider and sparser: 914 buildings (was 1,434), tallest 221 m (was 280). The audit now really checks overlaps (0) and narrow streets (0).
- **Cutaway:** the overhead lens's see-through shader (`G3.cutMat`, as at Monaco, Spa and Interlagos) is now on every Singapore building material, so anything that does stand between the lens and the car dissolves in a disc around it.
- **Flat glowing slabs removed:** the coloured plates on roofs (crowns, hotel tops, art-deco tiers, the heliport pad, the dome base) were unlit full slabs, which from above read as huge coloured squares. They are now thin glowing outlines, and only 30 % of heliport roofs get one.
- Anyone building another city world (Interlagos has houses and towers too): run the same view test against it.

---

# Baku (City Circuit) overhaul: research, mismatches, decisions

## Research (Part 1). Sources and how sure I am

| Fact | Value I found | Source | Confidence |
|---|---|---|---|
| Length, corners | **6.003 km**, 20 turns (8 right, 12 left per one summary) | [Wikipedia](https://en.wikipedia.org/wiki/Baku_City_Circuit), [Mercedes F1 race page](https://www.mercedesamgf1.com/races/azerbaijan-grand-prix-2025) | high |
| Direction | **anticlockwise** (Wikipedia infobox, F1 guide, a track guide) | same | high |
| Corner order | Sector 1 is a quartet of ~90-degree corners; **T1 a 90-degree left** ("second gear", braking point hard to spot) and T3 another 90-degree left; **T8 and T9 the castle chicane**, "the tightest corner of the season"; Sector 2 is the castle (about T8-T12) round the Old City wall; **T16 starts a 2 km+ flat-out run** to the pit straight | [F1 circuit guide via search](https://www.formula1.com/en/latest/article/circuit-guide-everything-you-need-to-know-about-the-baku-city-circuit.320UGBNQu2ALdgAtax1gRn), [RealSport101](https://realsport101.com/article/f1-2019-azerbaijan-grand-prix-track-guide) | medium for individual turn numbers |
| Main straight | "**2.2 km** stretch along Neftchilar Avenue back to the start"; Wikipedia also says the lap loops Government House then goes "west along a 1 km straight" to the Maiden Tower. A guide says "flat-out for over two kilometres from T16 to the pit straight". | Wikipedia, F1 guide | medium (2.2 km vs about 2 km) |
| Width | 13 m at its widest, **7.6 m** (25 ft) at the narrowest, in the uphill castle section between the walls | Wikipedia, RacingNews365 | high |
| Elevation | highest point **2.1 m above sea level at Turn 13**, lowest **24.7 m below sea level on the start-finish straight**: range **26.8 m**; the castle section climbs ("a narrow uphill stretch") then drops | [F1 highs and lows](https://www.formula1.com/en/latest/features/2016/10/highs-and-lows---which-f1-track-has-the-most-elevation-changes-.html), Wikipedia, Ferrari | medium: the two end figures only, no profile in between |
| Pit lane | "down the very long straight **past the pits and paddock** before Turn 1": the pits are on the main straight between T20 and T1. No box count, no box positions, no side, no lane length; walls near pit entry/exit were rebuilt with vehicle openings and crash gates (2016 changes) | FIA/Planet F1/Wikipedia | low |
| Run-off | walls "around the circuit have been realigned, including in the run-off at Turn 1"; a street circuit with concrete walls and almost no run-off. I found no map of escape roads. | Planet F1 | low |
| Surroundings | starts adjacent to **Azadliq Square**, loops **Government House**, passes the **Palace of the Shirvanshahs** and **Maiden Tower** (12th century, once on the shore), circles the UNESCO Old City walls, runs along the **Caspian promenade** | Wikipedia, F1 | high for the names; **which of them (and the Flame Towers, the carpet museum, the wave-shaped cultural centre) are visible from which corner I did not confirm** |
| Race conditions | **15:00 local** start, around 26 C, dry and sunny, wind from the north-east on race day (a headwind on the main straight) | RacingNews365, Sky | medium (one year's forecast) |

## Mismatches against the game (`node scripts/track-audit.mjs baku`, not by eye)

1. **Direction: correct** (net turn -360, area -1,643,286: anticlockwise). Nothing reversed, nothing mirrored. (The old 0a table's "Baku: WRONG (mirrored)" was fixed by the turtle change.)
2. **Length:** 6,004.7 m (real 6,003 m). Corners found: 20 (real 20).
3. **Main straight:** the game has 616 m from the line to T1 and 684 m from the last corner to the line, so **about 1.3 km** from the last corner to T1; the real straight is **about 2.2 km**. Real first straight after Government House is about 1 km; the game's first straight is 616 m. Layout questions below.
4. **Elevation range:** game 29.99 m (0 to 30 m), real 26.8 m, so 3 m too much; shape is plausible (lowest on the start straight, climbing through the castle, peak at u 0.58, falling away) but the real high point is "Turn 13" and the game's peak sits at u 0.58 (its T11 to T12); the old profile was cosine-eased with flat knots. Fixed: scaled to 26.8 m and a closed spline with the peak moved onto the T13 hairpin.
5. **Pit lane:** the game's zone ran from u 0.860 to 0.100 (the shared default), 1,442 m, entry well before the last corner.
6. The 2016 FIA wall and pit-entry changes are not visible in the layout string.

## Results (Parts 2 to 5): `node scripts/track-audit.mjs baku`, `baku-audit.mjs`, `baku-world3d.mjs`, `census.mjs baku`

### Direction and elevation, before and after

| | Before | After |
|---|---|---|
| Winding | net turn -360 deg, signed area -1,643,286: anticlockwise | identical (already right; nothing reversed, nothing mirrored) |
| Lap length | 6,004.7 m (real 6,003 m) | 6,004.7 m |
| Height range | 0 to 29.99 m = 29.99 m (real 26.8 m), cosine-eased between flat knots, peak at u 0.58 | 0 to 26.79 m = **26.79 m** (real 26.8 m), a closed spline with continuous gradient, peak on the **T13 hairpin** (u 0.618) as sourced |
| Steepest gradient | 4.7 % | 3.8 % (the climb into the castle section, u 0.514) |
| Seam | 0.000 m | 0.000 m, gradient 0.00 % either side |

Heights now (m above the start line): start 0.00, castle approach (u 0.50) 15.0, peak 26.79 (u 0.618). The real figures are absolute: the start straight is 24.7 m below sea level and T13 is 2.1 m above it, so the Caspian (about 28 m below the ocean) sits about 3.3 m under the start straight, which is where the sea sheet is. `ELEV_VISUAL` stays 1.0 (displayed = real). The shape between the two sourced ends is mine.

### What was built (`worlds/baku.js`, planned by `baku-plan.js`, parts in `baku-kit.js`)

- **The Caspian** along the seafront half of the lap (on the outside; the old land blobs put it there too, which is **my reading**, see below): a turquoise glossy sheet that runs to the horizon, sun glitter crawling over it, boats and ferries drifting, yachts moored along a pier, gulls wheeling (instanced, flapping).
- **The boulevard:** a lawn with five fountains (animated spray), palms, kerbside flower beds, kites in the air, strollers, a turning observation wheel.
- **The Old City:** a crenellated sandstone wall with round towers running beside the castle section on the infield side (about 150 segments), a stout round tower with a buttress and a stepped crown (a generic "maiden tower"), old low flat-roofed houses packed behind with water tanks and the odd little minaret.
- **The city:** about 1,860 buildings in four facade types from three shared textures (sandstone with windows and shutters, blue glass, concrete panels): stone mid-rises with cornices and tiled roofs, soviet-style slabs, glass towers with setbacks and crowns, hotels with striped awnings. Landmarks, all generic: a long symmetric government building with a colonnade and a central tower, a carpet-shaped museum (a rolled half-cylinder in stripes), a white wave-shaped cultural building, three leaning flame-shaped towers (190 m, glass below and a warm bright crown).
- **Track:** tiered stands with scaffold, fans and catch fencing (roofed at the main straight and T13), a pit building with a striped awning and timing tower, a paddock sign, five footbridges with fans, TV towers, flags that ripple in the north-east wind, tyre walls behind the concrete on the outside of the corners, food stalls, big screens, adverts (the BAKU set in `hoardings.js`: "TEA & TIME: Pour one. Overtake later.", "MANHOLE MASTERS: Bolted down since last time", "SEVEN POINT SIX: Narrow-street realty. Cosy is a metre.").
- **Sky:** a sunny gradient dome with a warm sun glow and drifting clouds, and a pale haze off the sea.

### The overhead lens (the lesson from Singapore, built in from the start)

The lens is fixed (35.264 deg up, from the south-east), so a building of height h hides 1.414 h of ground behind it. Every building's height is capped to keep the road out of that shadow (`maxH`), 12 m streets (6 to 8 m in the old town) keep the blocks apart, and the cutaway shader (`G3.cutMat`) is on every building material. The wall and towers use an exact version of the same test against the real road distance: where the wall stands south-east of the road it drops to a 1.2 m parapet, elsewhere it rises to 9 m.

`node scripts/baku-world3d.mjs`, the sight-line test from road points all round the lap: **2 of 858 road points hidden (0.2 %)**, both behind the round tower, which is a landmark standing 30 m from the road on purpose (the cutaway dissolves it near the car). The plan's audit: 0 buildings with road in their shadow, 0 overlaps, 0 narrow streets, 0 on water, 0 trees or lamps in the road, 0 wall segments in the road, 2 wall segments with a marginal shadow on the run-off.

### Performance (real `G3.build`, no GPU: draw calls and triangles; frame time could not be measured)

| | Draw calls if all drawn | Triangles if all drawn | Within 450 m of the start / Esses / back straight (draw calls; triangles) |
|---|---|---|---|
| Baku before | 1,021 | 91,669 | 248; 74,064 / 212; 73,059 / 204; 72,277 |
| Baku after (full) | 896 | 506,321 | 190; 153,186 / 154; 137,270 / 146; 131,274 |
| Baku after (Lite) | 860 | 363,356 | 177; 107,358 / not printed |
| Singapore | 941 | 566,288 | for comparison |
| COTA | 1,029 | 1,357,491 | |

Fewer draw calls than before and about 5.5 times the triangles, still well under every other detailed track. Plan time in Node about 250 ms, world build about 430 ms.

### Not done, not verified, or only partly done (honest list)

- **No screenshots and no frame times** (browsers cannot run on this machine). Checked in Node: the plan's clearance and lens audits, the sight-line test, 4,000 frames of animation without error, and the real `G3.build` runs without warnings. The tint-mask instancing shader is the one COTA and Singapore use; shaders are not compiled by a GPU here.
- **Which side the sea is on:** I kept the old definition's (the outside of the seafront half of the lap). I did not confirm it against the real geography, and the game's circuit is the layout string's shape, not the surveyed one.
- **Landmark positions** (government building, carpet museum, wave building, flame towers, the old walls, the round tower) are by lap fraction, not geography; which of them are really visible from which corner I did not confirm.
- **Run-off:** a street circuit with walls; I found no escape roads and added none. The tyre walls at the corners are decoration behind the concrete; I do not know where the real ones are.
- **Pit lane:** between the last corner and Turn 1 on the main straight (sourced); the exit, box positions and side are not in anything I found (left/infield is my assumption); the lane is 660 m in the game (u 0.94 to 0.05).
- Not done: night or dusk, heat shimmer, hanging laundry, people on balconies, a real map of the walls (the wall is a continuous run along the castle section on the infield side).

### Layout questions (I did not change these)

1. **The main straight is about 1.3 km in the game, 2.2 km in reality** (from the last corner to Turn 1: 684 m before the line plus 616 m after it, against "2.2 km along Neftchilar Avenue"). The real straight after Government House is about 1 km (the game's first straight is 616 m). Do you want the final straight lengthened to about 2.2 km (and the lap shortened elsewhere, or the lap length left at 6,003 m by trimming the infield)?
2. The castle section's real width is 7.6 m; the game's track is 14.3 m wide everywhere (`width`). Do you want it to narrow there? It would change the racing, so I did not.
3. Which side is the sea on along the seafront? (see above)

### Visual checklist (npm run dev, circuit "Baku")

1. The start straight and the seafront: the turquoise sea with its glitter on the outside, the boulevard lawn, fountains spraying, the wheel turning, palms in the wind, the pier with yachts, the stand opposite the pits.
2. The climb into the castle section: the sandstone wall on the left with its towers, the old houses behind, the round tower, the walls closing in. The wall should drop to a low parapet wherever it would hide the road.
3. The T13 hairpin stand at the crest, then the drop. The city behind should read as sandstone streets and slabs with glass towers further out, never covering the road.
4. Look up: sun glow, drifting clouds, gulls over the shore, kites over the boulevard, the flame-shaped towers on the skyline.
5. The pits: striped awning, timing tower, paddock sign.
6. Console: look for `baku ...` warnings; the world builds inside try/catch, so a bug shows as a warning and a plainer circuit. `window.__baku.audit()` reruns the clearance and lens audit.

# Mexico City (Autódromo Hermanos Rodríguez) (2026-10-04)

How this was done: the OpenStreetMap raceway ways chained into one lap (4,306 m against the official
4,304 m), heights every 20 m from SRTM 30 m and ASTER 30 m (OpenTopoData), OSM land cover, grandstands,
stadiums and the pit lane. The game lap is the existing layout string, measured with `buildTrack()` in
Node. Nothing was seen in a browser (the user checks visually).

Sources: [oversteer48](https://oversteer48.com/autodromo-hermanos-rodriguez-circuit-layouts/) ·
[f1-fansite](https://www.f1-fansite.com/f1%20circuits/autodromo-hermanos-rodriguez-layout-records/) ·
[Wikipedia](https://en.wikipedia.org/wiki/Aut%C3%B3dromo_Hermanos_Rodr%C3%ADguez) ·
[Wikipedia, Estadio GNP Seguros](https://en.wikipedia.org/wiki/Estadio_GNP_Seguros) ·
[Rio Times, 2026 guide](https://www.riotimesonline.com/mexico-city-grand-prix-2026-f1-guide/) ·
[f1technical](https://f1technical.net/news/25717) · OpenStreetMap · OpenTopoData.

## Confirmed

- **Layout**: 4.304 km, 17 turns, **clockwise**; the 2015 layout that leaves the old Peraltada and runs
  through the Foro Sol (OSM: "Estadio GNP Seguros", 299 × 262 m). The old Peraltada road is still mapped
  beside the new one.
- **Corners** (OSM geometry): T1 right 89°, T2 left 70°, T3 right 93°, the back straight, T4 left 95°, T5
  right 114°, T6 right 133°, the esses (left 67°, right 38°, left 61°, right 68°, left 47°), T12, the stadium
  (right 79°, left 136°, right 58°), the Peraltada (right 76°, right 106°), the 1.2 km main straight.
- **Height**: 8 m from top to bottom (oversteer48, f1-fansite). Altitude: several articles say 2,285 m, others
  2,240 m; SRTM puts the ground at about 2,225-2,245 m along the lap, so **about 2,230-2,240 m**.
- **Pit lane** (OSM): on the **right**. In from the inside of the Peraltada, about 800 m along the right of
  the main straight past the garages, out onto the straight well before Turn 1 (f1technical: the pit exit is
  between the pits and Turn 1).
- **Surroundings** (OSM): the Magdalena Mixhuca sports city (the 1968 Olympic park) round the circuit; the
  Palacio de los Deportes (a copper-clad dome) about 300 m outside the Peraltada; the baseball stadium
  (Estadio Alfredo Harp Helú) in the infield near Turn 1; the athletics stadium (Estadio Jesús Martínez
  "Palillo") outside the start of the main straight; the Olympic velodrome and a smaller one; grandstands
  along the outside of the main straight and round the Foro Sol; a helipad in the paddock; the city round
  it, mostly unmapped as land use (2,880 streets within 3 km).
- **Crowds**: 110,000; the Foro Sol stands hold over 30,000 (Grada 14 and 15).
- **Race**: 30 October to 1 November 2026, race Sunday 14:00 local; the Day of the Dead weekend.

## Not confirmed

- **The shape of the height profile**: SRTM and ASTER disagree along the lap (19.8 m and 28 m of "range",
  17 % "grades" on an old lakebed) because of trees and stands. Only their long trend is used (a 150 m Gaussian
  of the two averaged), scaled to the published 8 m. The range is published; **the shape is low-confidence**
  (highest round the Peraltada and the start of the main straight, lowest in the esses).
- **Run-off corner by corner**: my reading (tarmac at Turns 1-5 and round the stadium, gravel outside the
  Peraltada and the esses).
- **The 1968 rowing canal** is in Xochimilco, not here; left out.
- **The volcanoes**: Popocatépetl and Iztaccíhuatl are placed in their real directions on the horizon; how
  often they show through the haze is not confirmed.

## The game against the real circuit (none of these changed)

1. **Shape**: 293 m RMS off the real lap after the best fit (max 636 m), the furthest of any circuit so far.
2. **Main straight to Turn 1**: 1,695 m against 1,425 m (from the last Peraltada apex).
3. **Corners**: Turn 1 131° (real 89°); the esses run left-right-left-left-right (real left-right-left-right-
   left); a 52° kink on the back straight that is not real; no counterpart of the real T6 right (133°); an
   extra small left in the stadium.
4. **Section lengths**: T9 to T11 196 m (real 285 m), T11 to the stadium 392 m (575 m), Peraltada T16 to T17
   175 m (56 m), T2 to T3 63 m (85 m).
5. As at Spa and Interlagos, building from the surveyed OSM path (chained, 4,306 m, clockwise) would fix 1-4.

## Part 2: direction and heights

Already clockwise; nothing reversed. `ELEV_VISUAL` stays 1.0 (real = displayed).

| | before | after |
|---|---|---|
| Min / max | 0.0 (u 0.80) / 8.0 (u 0.35, T1-T3) | 0.0 (u 0.61, the esses) / 8.0 (u 0.915, Peraltada exit) |
| Start line | 4.0 | 4.9 |
| T1 / T3 | 7.8 / 8.0 | 0.8 / 1.3 |
| Into the stadium / T13 | 0.1 / 0.0 | 2.8 / 3.9 |
| Peraltada / T17 | 0.8 / 2.0 | 7.2 / 7.8 |
| Steepest | 0.7 % | 2.3 % |
| Pit lane | right, defaults in 0.86, out 0.10 | right, in 0.885 (Peraltada), out 0.081, box 0.976 |

Seam 0.0000 m. An AI car laps in 70.7 s and pits; a stop costs about 25 s (32 s before).

# Mexico City world

Files: `worlds/mex-plan.js` (plan and `auditMex`), `mex-kit.js` (landmarks, trees, papel picado, flag),
`mex.js` (`MEX = Object.create(ILG)`: it inherits Interlagos's world, and so Spa's), data in
`tracks/survey/mexico.js`. Interlagos's crowd, flag and water-tank colours and a stand's crowd density are
now overridable (Interlagos builds as before). Check with `node scripts/mexico-audit.mjs` and
`node scripts/census.mjs mexico`.

## The autódromo

- **The Foro Sol**: a full bowl round the stadium section: 37 tall covered stands, each facing the middle
  and stepped back until it clears every barrier, seats in green, white and red; in the middle the baseball
  diamond (outfield, dirt infield, bases, mound) and the podium (three steps under an arch in green, white
  and red), since the race ends here; flares in the stands; confetti over the podium.
- **Main straight**: five covered stands on the outside where they are mapped, the pits and paddock on the
  right, the paddock sign, a screen, food stalls, papel picado along the backs of the stands.
- **Turn 1**: a big covered stand and two more round Turns 2 and 3; banks round the esses.
- **The paddock helipad** where it is mapped, with a helicopter parked on it, rotor turning.
- **The sports city's landmarks**, where the real ones map to: the **Palacio de los Deportes** (a low dome of
  copper panels, each its own shade, a few gone green, on a glazed plinth), the **baseball stadium** (a
  horseshoe under a white canopy; its real place falls on the game's sprawling infield, so it moved outside
  Turn 3), the **athletics stadium** (an oval with a red track), the **Olympic velodrome** (banked oval) and a
  smaller **roofed velodrome**.
- **The old Peraltada**: the bypassed banked road drawn as faded asphalt with ghost kerbs.
- **Day of the Dead fan zone** behind the main stands: two giant catrinas under a marigold arch, a mariachi
  stage with its band, a 60 m monumental flag (green, white and red bands, no emblem) waving, papel picado.
- **Crowds**: 36,500 spectators in green, white, red, rosa mexicano and marigold.
- **Adverts**, all invented: Taco Torque ("Al pastor, spun at 300 km/h"), Altitude Attitude ("Oxygen bar.
  Breathe for two laps"), Periférico Parking, Salsa Verde Velocity ("Mild, medium, Peraltada"), Churro
  Chicane, Lucha Libre Legal ("We fight your tickets in a mask"), Thin Air Tyres, and others.

## Round it

- **Planting**: the sports city's lawns and groves of ash, eucalyptus, weeping pirul, Mexican cypress and a
  few palms (3,263 near the circuit); marigold, white and pink flowers.
- **The city**: 9,000 low concrete houses with black water tanks and rebar on the flat roofs, walls in rosa
  mexicano, ochre, cobalt, terracotta and more; apartment blocks with helipads; warehouses; 40 football
  pitches with games on; 1,345 parked cars and buses.
- **Sky and light**: thin, clear, hard light (sun 1.35), a blue fill, brown haze low over the city, few slow
  cloud shadows. For the shots that look out: a deep blue dome with a smog band, fair-weather clouds, the
  city's towers to the west, and Popocatépetl and Iztaccíhuatl, snow-capped, in their real directions.
- **Details**: helicopters (one parked), grackles round the trees, pigeons over the dome, balloons, flares,
  confetti, the mariachi band, the football games, the waving flag and papel picado.

## Checks (Node)

- Lap: clockwise, 4,307 m, 0-8.0 m, seam 0.0000 m.
- Clearance (every centreline segment): 3,615 trees, closest canopy 2.2 m past the barrier line, none over;
  houses at least 4.1 m clear; stands, banks, pits, posts and landmarks at least 0.54 m; cars 10.2 m. One bank
  and one screen were not built for want of room.
- Clipping: no ground inside the barrier line above the road ribbons (3,282 vertices); behind the Armco the
  ground is at most 2.3 m above the road.
- Instance colours: no material shared by instanced meshes with and without colour (the Interlagos trap).
- The real game loop in Node (`startSession('race')`, AI, contacts): 145 s of racing and 85 s of crashing
  into walls, 3D all the way; 1,500 frames of `G3.frame` with lights, a field and rain: no throws.
- `npm run build`: one 4.6 MB file.

## Performance (Node estimate of what the overhead camera draws)

| | draw calls per frame | triangles per frame | build |
|---|---|---|---|
| Mexico before | 96-166 | about 64k | 0.3 s |
| Mexico after | 135-222 | 180-506k (the stadium is the heaviest) | about 2 s |
| Interlagos | 163-213 | 180-425k | 0.8 s |
| Suzuka | 135-170 | 210-660k | 0.6 s |

## Visual checklist (please)

1. **The Foro Sol**: the bowl of stands round the lap, the diamond and podium, the flares and confetti.
2. **The main straight**: the covered stands, the pits on the right, the papel picado, the fan zone with the
   catrinas, the mariachi stage and the big flag behind the stands.
3. **The Peraltada**: the old banked road beside it, the copper dome outside.
4. **Turns 1 to 3** and the baseball stadium beyond; **the esses** and their banks.
5. **Anything clipping**, stands too close to the track, trees hiding the car, the frame rate in the stadium
   (the heaviest place), and whether 3D ever switches off (the reason now shows on screen).

---

# Monza (Autodromo Nazionale) overhaul: research, mismatches, decisions

## Research (Part 1). Sources and how sure I am

| Fact | Value I found | Source | Confidence |
|---|---|---|---|
| Length, corners | **5.793 km**, 11 turns | [Wikipedia](https://en.wikipedia.org/wiki/Monza_Circuit), [f1-fansite](https://www.f1-fansite.com/f1-circuits/autodromo-nazionale-monza/) | high |
| Direction | **clockwise** | f1-fansite, others | high |
| Corner order | Variante del Rettifilo (the first chicane), Curva Grande, Variante della Roggia, the two Curve di Lesmo, Variante Ascari, Curva Parabolica (Alboreto) | Wikipedia | high |
| Main straight | **1.12 km** | Wikipedia | high |
| Elevation | **about 10 m** change in all (F1's "highs and lows" list); no profile and no high/low locations found | [F1 highs and lows](https://www.formula1.com/en/latest/features/2016/10/highs-and-lows---which-f1-track-has-the-most-elevation-changes-.html), f1-fansite | medium for the range, none for the shape |
| Banking | the **Pista di Alta Velocita**, a 4.25 km oval with banked curves (Curva Nord and Sud); the banking is **about 30 deg** (Wikipedia) or "21 degrees, 80 per cent gradient at its steepest" (an F1 history piece): **sources disagree**; unused since 1969, decayed. It loops in and around the road circuit: it is **seen in the background as cars exit the Parabolica, and on the flyover bridge they pass under on the way to the Variante Ascari** | Wikipedia, [F1 on Italian banking](https://www.formula1.com/en/latest/features/2015/9/high-risk--high-interest---a-brief-history-of-italian-banking.html) | medium |
| Pit lane | entry **at the end of the Parabolica**, exit **on the Rettifilo straight** after the line; one briefing quotes a lane of **418 m**; grandstands on the inside of the Parabolica exit near the pit entry. The side (the pits are on the infield side, the right, on a clockwise lap) and box positions: not confirmed | GT4 briefing PDFs via search, enterf1 | medium for entry/exit, low for the rest |
| Setting | the **royal park** of Monza (a walled woodland); capacity 118,865 | Wikipedia | high |
| Race | the Italian GP is run in early September in the afternoon, hot; I did not confirm the start time this time (15:00 is my recollection) | - | low |
| Run-off | I found no per-corner map; the layout string's single 14 m run-off is the game's only data | - | low |

## Mismatches against the game (`node scripts/track-audit.mjs monza`, not by eye)

1. **Direction: correct** (net turn +360, area +867,585: clockwise). Nothing reversed.
2. **Length:** 5,794.3 m (real 5,793). The layout string reads in the real order (R-L Rettifilo, R Curva Grande, L-R Roggia, R Lesmo 1, R Lesmo 2, a long gentle left Serraglio, L-R-L Ascari, the back straight, R Parabolica), 11 turns hidden in 9 corner runs.
3. **Main straight:** 658 m after the line + 553 m before it = 1.21 km (real 1.12 km): close.
4. **Elevation:** the old profile was a three-point cosine curve (start 2 m, 10 m at u 0.45, 0 m at u 0.92), range 10.00 m (real about 10 m) but with a flat spot at every knot. Where the high and low really are I could not find; I kept the old estimate. New: a closed spline with the flyover underpass dip.
5. **Pit lane:** the game's zone ran from u 0.860 to 0.100 (the shared default), **1,393 m**; real: about 418 m, from the end of the Parabolica to the Rettifilo.
6. The old scene put its two "banking" props at u 0.17-0.27 and 0.72-0.83, as raised slabs on the outside. The real banking is seen from the Parabolica exit and the Ascari flyover; positions by lap fraction only.

## Results (Parts 2 to 5): `node scripts/track-audit.mjs monza`, `monza-audit.mjs`, `monza-world3d.mjs`, `census.mjs monza`

### Direction and elevation, before and after

| | Before | After |
|---|---|---|
| Winding | net turn +360 deg, signed area +867,585: clockwise | identical (already right; nothing reversed, nothing mirrored) |
| Lap length | 5,794.3 m (real 5,793 m) | 5,794.3 m |
| Height range | 0 to 10.00 m = 10.00 m (real about 10 m), cosine-eased between three flat knots; steepest 0.7 % | 0 to 10.00 m = **10.00 m**, a closed spline with continuous gradient; steepest **1.4 %** (the fall off the Lesmo high point, u 0.594) |
| Seam | 0.002 m | 0.004 m, gradient 0.05 % then 0.02 % |
| Pit lane | u 0.860 to 0.100 (the shared default): 1,393 m | in 0.972, out 0.045: **420 m** (real: about 418 m); the entry at the end of the Parabolica, the exit on the Rettifilo straight |

Heights now (m): start line 2.00, highest 10.00 at u 0.452 (Lesmo / Serraglio, an estimate: no source gives the high or low points), the flyover underpass dip 4.28 at u 0.62 (my addition), lowest 0.00 at u 0.919 (through the Parabolica, an estimate). `ELEV_VISUAL` stays 1.0.

### What was built (`worlds/monza.js`, planned by `monza-plan.js`, parts in `monza-kit.js`; stands, pit building and footbridges use Baku's builder)

- **The royal park:** about 10,400 trees in groves and clearings: oaks, plane trees, beeches and umbrella pines (8,870 + 1,442), each with a near copy (a few lobes) and a far copy (one blob), plus shrubs, up to 30 m tall; a lawn-and-wood ground with three ponds and nine gravel avenues, a low stone **park wall** with gate pillars in three runs.
- **The old banking:** three stretches of decayed concrete slope (13 m high over 26 m, with joints, moss and a broken parapet) on the outside of the lap, and the **flyover** the road passes under before the Ascari chicane (a deck on four piers with parapets and earth ramps); fans stand on it.
- **The royal villa:** a long neoclassical palace (a central block with pediment, columns, a cupola, two wings) in the trees, 24 m, as far from the road as it needs to be.
- **Track:** eight stands with scaffold, catch fencing and crowds, a huge roofed one across from the pits (18 rows), one on the inside of the Parabolica exit (as sourced), the pit building and a paddock of 16 white marquees with transporters, four steel footbridges with fans on them, TV towers, tyre walls, big screens, tricolour flags (green, white, red bands: a flag, not a logo) rippling in the wind, and adverts (the MONZA set: "ESPRESSO ESCAPE: Doppio. Flat out.", "BANKING BANK: We still hold the ruins", "TEMPLE OF SPEED TOURS: Please remove your hat in Turn 1").
- **Life:** about 5,500 fans, red above all, some waving; red smoke flares rising from four stands; a campers' village of 85 tents; 383 parked cars; food stalls; pigeons over the trees; a blimp over the circuit; a sunny sky with drifting clouds (Baku's sky).

### The overhead lens (built in from the start, as at Baku)

The lens is fixed (35.264 deg up, from the south-east): anything of height h hides 1.414 h of ground behind it. Here the trees are what could hide the road, so every tree's height is capped by the plan's `maxH` (a tall wood on the north-west side of the road, a low one on the south-east side), and the cutaway shader is on every building and tree material.

`node scripts/monza-world3d.mjs`, the sight-line test from road points all round the lap (trees modelled as crowns from 30 % of their height up, with the banking and the flyover): **3 of 828 road points hidden (0.4 %), all under the flyover bridge**, which is a bridge over the road by design. The plan's audit: **0 of 10,312 trees hiding the road**, 0 too close to the barrier, 0 buildings overlapping or too close, 0 lamps, wall segments or tents in the road. 8,000 of the trees are taller than 20 m; the tallest is 30 m.

### Performance (real `G3.build`, no GPU: draw calls and triangles; frame time could not be measured)

| | Draw calls if all drawn | Triangles if all drawn | Within 450 m of the start / Esses / back straight (draw calls; triangles) |
|---|---|---|---|
| Monza before | 1,460 | 131,717 | 447; 86,337 / 335; 82,046 / 394; 82,525 |
| Monza after (full) | 1,021 | 724,090 | 336; 235,357 / 246; 196,457 / 275; 215,004 |
| Monza after (Lite) | 984 | 345,470 | 312; 119,817 / not printed |
| Baku | 896 | 506,321 | for comparison |
| COTA | 1,029 | 1,357,491 | |

Fewer draw calls than before (the old scene was 1,460 separate baked meshes) and about 5.5 times the triangles, still under COTA, Suzuka, Silverstone and Zandvoort. Plan time in Node about 230 ms, build about 330 ms.

### Not done, not verified, or only partly done (honest list)

- **No screenshots and no frame times** (browsers cannot run on this machine). Checked in Node: the plan's clearance and lens audits, the sight-line test, 4,000 frames of animation without error, the instance-colour scan (0 shared materials), and `G3.build` without warnings. The tint-mask shader is the one COTA, Singapore and Baku use; shaders are not compiled by a GPU here.
- **Where the banking is:** its three stretches sit at lap fractions (u 0.13-0.17 and 0.69-0.79 from the old scene list, and 0.87-0.92 beyond the Parabolica exit as the source says it is seen there) on the outside; the flyover at u 0.628 before Ascari. The game's circuit is the layout string's shape, not the surveyed one, so none of this is geography. Banking angle: 30 deg (Wikipedia) vs 21 deg (an F1 history piece): I used a 13 m rise over 26 m (27 deg), between the two.
- **Run-off:** the game has a single 14 m run-off all round; I found no per-corner map of the real gravel and asphalt, so I changed nothing.
- **Pit lane:** entry and exit as sourced; the side (the infield, the right) and the box positions are not confirmed. The lane is 420 m (one briefing says 418 m).
- Not done: night or rain, heat shimmer, the Parco's other buildings (the golf club, the old mill), the Lambro river (a pond or two instead), the Curva Sud's actual position.

### Layout questions (I did not change these)

1. The game's main straight is 1.21 km (658 m after the line + 553 m before it) against 1.12 km real. Close; do you want it trimmed to 1.12 km?
2. The first chicane, Roggia and Ascari read correctly in the layout string. The game's Serraglio is a single gentle left (L20/400) which is right.
3. The pits are on the right (infield) of the straight; I did not confirm it.

### Visual checklist (npm run dev, circuit "Monza")

1. The start straight: the huge roofed stand on the left, the pit building and paddock marquees on the right, tricolour flags rippling, a blimp in the sky, tifosi in red, flares.
2. The trees: a tall dark woodland close to the road on the north-west side of every stretch, lower woods on the south-east side so the road is never hidden. The road should always be visible; if a tree ever covers the car, the cutaway should thin it.
3. Beyond the Parabolica exit and on the way to Ascari: the grey, mossy banking slopes beside the road, and the flyover the road passes under before the chicane.
4. The Parabolica stand on the inside of the exit; the Lesmo and Ascari stands.
5. A clearing with ponds, gravel avenues leading into the woods, the park wall with its gate pillars, the royal villa far among the trees, the campers' tents.
6. Console: look for `monza ...` warnings; the world builds inside try/catch, so a bug shows as a warning and a plainer circuit. `window.__monza.audit()` reruns the clearance and lens audit.

## Stewards, AI mistakes, harder spins

- **Where:** `src/game/penalties.js` (all of it), hooks in `session.js` (grid drops in `startSession`, `PEN.launch` at lights out, `PEN.contact` in the contact loop, `PEN.tick` after `positions()`, `PEN.classify` in `endSession`), `car/pit.js` (the player's penalty visit), `car/physics.js` (`pitStep` for AI penalty visits, player spin thresholds), `ai/driver.js` (AI spins), HUD line `#h-pen`, results "+Ns" and a "Stewards' decisions" list. Test: `node --import ./scripts/asset-register.mjs scripts/penalty-test.mjs [track] [races]`.
- **Penalties:** warning, reprimand (third = drive-through), 5 s, 10 s, drive-through, 10 s stop-and-go, disqualification (black flag; ends the player's race), grid-place drops for a few AI cars before the start, deleted laps in qualifying. Penalty points are counted (12 = a message about a one-race ban).
- **What triggers them:** track limits (3 warnings, black-and-white flag on the 3rd, 5 s each after; qualifying deletes the lap), leaving the track and gaining a place (5 s), collisions (fault = the car behind, or the one that drove into the other; light contact is noted or reprimanded, 6+ = 5 s, 10+ = 10 s, 15+ = drive-through, 22+ = stop-go, or DSQ for a repeat offender), jumping the start (revs pinned at the lights; 2.5 % per AI car), pit-lane speeding, unsafe release, ignoring blue flags (player only). AI cars also get random incidents (forcing off, illegal defending, dangerous driving, ...): about 1-4 penalties per 3-lap race.
- **Serving:** a drive-through or stop-go is served in the pit lane within 3 laps (press P; the pit menu does not open, there is no service). Unserved, or unservable (last lap) = +20 s / +30 s. AI cars are sent in by the pit wall as a visit of their own and serve it through `pitStep`. Time is added in `classify()`, which re-orders only the penalised cars; results show the adjusted gap and "+Ns".
- **Messages:** the player gets a big message and a radio line; AI penalties arrive as queued "STEWARDS · ABBR Name — penalty · reason" toasts.
- **AI mistakes:** `driveAI` now has real spins as well as lock-ups and wide moments (about 2-3 per 3-lap dry race; more in the wet, on worn tyres or with damage). Some lock-ups and slides end in a spin.
- **Player spins:** the grip-limit threshold is higher (1.38 instead of 1.28), the loss timer needs 1.0 s (was 0.8) and recovers faster, the wall spin needs 4.5 m/s into the wall (was 3.5).
- **Not done / assumptions:** no safety car in the game, so no SC penalties; the player's grid is chosen in setup, so only AI cars get grid drops; AI cars get no blue-flag penalties; a black flag on an AI car only marks it DSQ in the results.

### Visual checklist
1. Take a 5 s penalty (cut a corner onto the grass four times, or ram a car): big message, radio line, a yellow chip under the lap time ("+5 s"), "+5s" next to your gap in the results.
2. Get a drive-through (hard shunt): red pulsing chip; press P, enter the lane, hold the limiter, the pit menu should NOT open; "PENALTY SERVED" at the exit.
3. Watch for "STEWARDS · ..." toasts about AI cars, and an AI car spinning (toast "X spins!" when it is near you).
4. Spinning should now need a clearly bigger mistake: kerbs and a flick at speed should no longer bite you straight away.

## Safety car

- **Where:** `src/game/safetycar.js` (state machine, the car's rail, triggers, player limiter, overtaking check), `src/render3d/safetycar.js` (the model: green/white GT coupe with a flashing amber bar, placed from `S.sc.car`), 2D fallback box in `render2d/world.js`, minimap dot, HUD banner `#h-sc`, setup option "Safety car on/off" (`CFG.sc`, default on), hooks in `session.js` (`SC.init`, `SC.tick` after `PEN.tick`, `SC.limitPlayer` after `playerInput`), `ai/driver.js` (queue behaviour), `penalties.js` (no random AI incidents or blue flags under it). Test: `node --import ./scripts/asset-register.mjs scripts/safetycar-test.mjs [track] [races]`.
- **When:** a car stopped on the track (a retirement), or a random "Debris on the track" call (45 % of races, 75 % in heavy rain, never before 14 s, never with fewer than 2 laps to go after the leader's current one).
- **Phases:** `out` (the car is deployed from the pit exit if that is 260-1700 m ahead of the leader, else onto the road 300 m ahead of him; it runs at about 60 % of the road's limit, 20-52 m/s, and slows to wait for a leader more than 230 m back) → `in` after 1-2 leader laps (lights off, it leads the field to the pit entry and down the lane) → green flag when the leader crosses the line, with the car already in the lane.
- **Field:** every AI car runs at about 66 % of its line speed until it catches the queue (88 % once the car is in), follows the car in front at 1.7 x the usual gap, does not overtake, and makes no mistakes. Around 60 % of the AI cars that have not stopped (or are on worn tyres) are called in for a cheap stop.
- **You:** a limiter stops you closing on the car in front faster than a gentle gap-closing speed and switches the boost off; overtaking anyone, or the safety car, before the green flag is a drive-through ("Overtaking ... under the safety car") through the steward system. The pit lane is open throughout. Messages: big banner + radio lines on deployment, "in this lap" and green flag, a yellow "SAFETY CAR · NO OVERTAKING" chip under the lap time.
- **Not done:** no unlapping of lapped cars, no red flags or virtual safety car, no wreck clean-up (a stopped car stays where it is), the pit lane is not closed at deployment, the safety car cannot be called by the player.

### Visual checklist
1. Race with "Safety car on". Within a race or two you should see "SAFETY CAR · Debris on the track" or "<driver> is stopped on the track": big banner, radio message, yellow pulsing chip under the lap time.
2. A green and white coupe with a flashing amber bar ahead of the leader (or coming out of the pit exit); the field bunching up behind it, nobody passing.
3. Press P: the pit stop should cost little time relative to the field.
4. "SAFETY CAR IN THIS LAP": the bar goes dark and the car goes into the pit lane; green flag message as the leader crosses the line.
5. Pass someone behind the safety car to check the drive-through penalty message.

## Wreck recovery (AI crashes)

- **What:** an AI car that retires (a crash or a failure) stays exactly where it came to rest: nobody drives it any more (`driveAI` is skipped for dnf cars, retire() clears stale pit flags). From the moment it is out (still tumbling too) it is a solid obstacle: AI cars steer round it, the safety car goes round it, and anyone who drives into it is stopped (AI cars are damaged but not put out by it; you get the full hit). A recovery job (`src/game/recovery.js`, on the race clock) then runs: yellow flag 4 s → the truck drives up and parks beside it (off the road if there is room, `planTruck`) 6 s → the crane lifts it onto the bed 7.4 s → the truck drives away with it 6 s → the marshals sweep up the debris 8 s. Then the track is clear and the car is gone (`c.recovered`; it stays in the results as a DNF).
- **Safety car:** comes out for every AI car that stops on the circuit: no lap, clock or cool-down gates (the random "debris" call keeps its gates and now also sends the marshals out to sweep). It stays out until every recovery is done, then "in this lap". A second crash while it is out keeps it out; a crash during "in this lap" brings it back out. If the track is not clear on the last lap the race finishes behind it ("FINISH UNDER THE SAFETY CAR").
- **3D:** `src/render3d/wreckrecovery.js` reuses the cutscene's recovery truck (`G3.recoveryTruck`) and crane curve (`CINE.dnfCar`), three marshals in orange (one waving a yellow flag upstream, two with brooms who walk to each piece of crash debris and sweep it away). Hidden during your own retirement cutscene. 2D fallback: a box truck with the car on its bed.
- **Gaps:** when a wreck and a parked truck leave no room between them, `REC.passLine` finds the gap that clears both; if there is none, cars and the safety car stop short and wait.
- **Test:** `node --import ./scripts/asset-register.mjs scripts/recovery-test.mjs [track]` (mid-race crash, last-lap crash, a crash during "in this lap", the safety car round a car on its line, pit-message and gap-finder regressions, and the whole 3D recovery stepped through every phase). Passes on Monza, Singapore, Baku and Spa.
- **Reviewed:** an adversarial review (4 reviewers, 2 refuters per finding) confirmed 12 findings, all fixed: retired AI cars running the player's pit code, stale pit flags hiding a wreck, passing a spinning car counted as an overtake, the wreck/truck gap, the safety car's dodge leaving the road, a world rebuild losing the car's pose, recoveries visible during your own DNF cutscene, slings drawn at the origin, marshals jumping back, the 2D truck driving off empty.
- **Not done:** the AI driver does not climb out (the car is lifted with him in it); the truck appears 45 m away and drives in rather than coming from a service road; a wreck in the pit lane is left where it is.

### Visual checklist
1. Race with damage on; watch for an AI crash (or ram one). The car should stop and stay put, a "SAFETY CAR · <driver> has crashed" banner, the field queuing behind the safety car and going round the wreck.
2. At the wreck: an orange marshal waving a yellow flag before it, the yellow recovery truck arriving and parking beside it, the crane lifting the car onto the bed, the truck driving away, two marshals sweeping the bits of car off the track.
3. The safety car stays out until all that is done, then "SAFETY CAR IN THIS LAP" and the green flag.
4. Drive into a wreck yourself: you should stop and take damage, not pass through.

## AI no longer reset after a spin

- **Before:** when an AI spin ended the car snapped back onto its rail, facing down the track, and drove off; on its rail it could never touch a wall, so damage hardly ever reached it.
- **Now:** the spin end sets `c.aiFree`; the car stays on the full car physics (the player's) and `freeDrive` in `src/ai/driver.js` drives it back: turns round if facing the wrong way, reverses off a wall it is nosed into, waits off the road (at most 8 s) for a car that would arrive within 3 s, and rejoins the rail only when on the road, pointing down it and moving (`hBlend` eases the nose in aiStep). Stuck for 30 s with under 40 m of progress = retired ("Beached in the gravel" / "Stuck — could not rejoin"). A car that loses a wheel pulls off and retires (`limp`). Off its rail it hits walls, takes the full damage model (dents, wings, wheels, retirements), and a retirement brings out the recovery and safety car.
- **Physics fix (all cars):** grass drag fades at a crawl (it used to exceed the engine from a standstill, so a car stopped on grass, yours too, could never pull away).
- **Spin causes** are tagged in `c.lastSpinWhy` (mistake, contact, grip, wall, wreck).
- **Test:** `node --import ./scripts/asset-register.mjs scripts/ai-free-test.mjs [track] [spins]`: 24 forced spins per track on Monza, Singapore, Spa, Baku: all drove back (median ~3 s) or retired from real crashes, none stuck, 0° heading jump on rejoining; plus natural-race damage counts.
- **Merged before the adversarial review finished** (at the user's request); its findings are still to be applied.

### Visual checklist
1. Watch an AI car spin: it should stop where it ends up, turn itself round, wait for traffic and drive back on, not snap back.
2. On a street circuit, AI cars should hit walls, lose wings and wheels, and sometimes retire.
3. Stop your own car on the grass: it should crawl off with the throttle on.

## Cockpit camera (driver's eye)

- **What:** press **C** (or the **CAM** touch pad) to switch between the overhead view and the cockpit. The choice is remembered (`localStorage ar26_view`). The game had one overhead lens and no chase cameras; no TV/broadcast angles were added. (The pause screen's old "T: Broadcast cameras" line is for a feature that is never switched on.)
- **Lens:** `G3.camFP` (perspective, near 0.15 m, far 8 km for the sky domes) and `G3.cockpitCam` in `src/render3d/frame.js`, knobs in `FP`. The eye is on the centre line at the back of the visor, under the halo hoop (`CAR_SPEC.X(1.40)`, `Z(0.80)`), looking 5 degrees down. Position is bolted to the car model; orientation follows the car's yaw, pitch, road camber and banking in full and half the chassis lean (`FP.ROLL`), slerped with a 35 ms time constant; a jump over 20 m or 0.6 rad snaps. FOV is fixed (about 88 degrees across at 16:9, never under 78 across on narrower screens) plus at most 3 degrees with speed.
- **Feel:** the head looks up to 5 degrees into corners (`FP.APEX`, 70 ms of yaw ahead, off during a spin); a millimetre buzz that grows with speed, a rattle on kerbs (`kerbShake`) and a knock on contact (`S.shake`), all on smooth waves of the race clock so a paused game holds still.
- **Cockpit (`src/render3d/cockpit.js`, player only, built the first time the view is used):** the player's body is swapped for `CARGEO.cockpit`, which has the top open between the bulkhead and the headrest (a face whose colour is `null` is left out of the loft), no solid halo pillar and no visor strip. Under it: the well (floor, walls, seat back), a padded rim, the bulkhead and column, the driver's legs and knee pads. The halo's centre pillar is drawn see-through (30 %): two eyes look past a real one, a single lens cannot.
- **Steering wheel:** a carbon plate with rubber grips, gloves and thumbs, eight coloured buttons, four rotaries with index marks, two thumb toggles, paddles peeking over the top, and a quick-release hub on the column; tilted 24 degrees to face the eye. A live display on a 256 x 160 canvas (repainted 12 times a second): gear in the middle, speed (or LIMITER in the pit lane), running lap time, position and lap, the tyre compound's colour, an ERS bar that turns green with OVERRIDE; under it fifteen shift lights (green, red, blue, all blue and flashing at the limiter) from the same rev curve as the HUD tacho (`rpmOfCar`, moved to `car/physics.js`). It turns clockwise for a right turn, about 75 degrees at full input at a crawl down to 30 at 300 km/h; forearms run from elbows inside the cockpit to the gloves and are re-aimed every frame.
- **Tyres (all cars):** two pale lettering blocks in each sidewall's compound band and faint scuffs across the tread, so you can see them turn; the visible turn per frame is capped at 0.3 rad (under the strobe limit of the scuffs), so at speed they always roll forwards instead of standing still or running backwards.
- **HUD:** with `body.fpv` the car diagram moves from bottom centre (where the wheel is) up the left side.
- **World:** fog as the cutscene lenses use it (near 220 m); the shadow box is centred 45 m up the road; rain 22 m ahead; occluder fading, the overhead cutaway and the Monaco tunnel fade are off in the cockpit. Crash/DNF/podium cutscenes still take over; a retired car goes back to the overhead view.
- **Tests:** `node --import ./scripts/asset-register.mjs scripts/cockpit-test.mjs [track] [detail]` (eye, heading, FOV, banking roll, half-lean, smoothing lag, teleport snap, a 5.5 rad/s spin followed with no snaps and no corner look, tyre roll under the strobe limit, wheel direction and speed-scaled lock, pause, cutscene hand-back, a lap of frames, and an ASCII picture by ray-casting). Passes on all 12 circuits. `scripts/cockpit-render.mjs <track> <node> <out.png> [steer] [width]` draws the view to a PNG with a small software rasteriser (flat shading, fog; textures and the wheel's display come out as flat tones), for checking the cockpit without a browser.
- **Not measured:** GPU cost. The cockpit adds 7 meshes and a small texture upload 12 times a second; the view sees much further than the overhead lens.

### Visual checklist
1. Press C on the grid: the halo across the top with a faint see-through pillar, the nose and front suspension above the wheel, the front tyres at the edges with pale marks on their sidewalls, the wheel at the bottom with the display, buttons and gloves.
2. Drive: the display shows gear, speed and lap time, and the shift lights climb and flash blue at the top of each gear; the tyre marks roll forwards at any speed.
3. Steer: the wheel and the forearms turn the right way, a lot in hairpins and a little at speed.
4. Spin the car (e.g. lift mid-corner on the grass): the view should whirl with the car and settle wherever it stops, without jumps.
5. Kerbs should rattle the view a little; a crash knocks it; standing still and paused, it should be dead steady.
6. Check the frame rate in the cockpit against the overhead view on Monaco, Silverstone and Singapore.
7. Press C again: the overhead view with the normal car (helmet back, solid halo).
