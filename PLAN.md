# Blacktop Brawl — plan

An original 3D combat motorcycle racer for the browser, in the spirit of 90s
road-brawl racers: point-to-point races on open roads, fighting rivals at speed,
dodging traffic, outrunning cops, and spending winnings on faster bikes.

It is an original game (own name, riders, tracks, art, audio), not a recreation
of any existing title.

## Tech

- **Browser build:** Three.js + Vite, plain ES modules, no other runtime deps.
- **Art:** procedural for now (meshes from primitives, canvas textures, synth audio),
  so there are no asset pipelines to block gameplay work. Real models/audio swap in later.
- **Portability rule:** everything in `src/sim/` is pure game logic with no Three.js or
  DOM imports. Rendering, input, audio and HUD only read sim state. This is what makes
  the later engine port a translation job instead of a rewrite.
- **Track-space physics:** every rider is `(s, d)` = distance along the road and lateral
  offset, plus speed and heading relative to the road. It keeps AI, traffic, and
  bike-to-bike combat simple and robust.

## Phases

| # | Phase | What you can do at the end |
|---|-------|----------------------------|
| 1 | **Ride** | Ride a full procedural course: curves, hills, jumps, chase camera, HUD, timer, engine audio. |
| 2 | **Race + cast** | Race a pack of AI rivals with rubber-banding, live position, results screen. Introduces an original cast of rival bikers drawn as exaggerated caricatures (huge grins, big heads, loud outfits): portraits on the title, pre-race line-up, taunts and results screens, and matching big-headed 3D riders. All characters are new designs, not copies of any existing game's cast. |
| 3 | **Brawl** | Punch, kick, and swing weapons (grab them off rivals); health and stamina; wipeouts and running back to the bike. |
| 4 | **Road hazards** | Two-way traffic, oncoming cars, roadside obstacles, police bikes that chase and bust you. |
| 5 | **Career** | Prize money, bike shop with distinct bikes, 5 themed courses (coast, desert, forest, city, mountains), difficulty tiers, save game. |
| 6 | **Polish** | Particles (dust, sparks, skid marks), post-processing, better rider animation, music, menus, gamepad and touch controls, performance pass. |
| 7 | **Engine port** | Move to a game engine (Godot recommended; Unity/Unreal also viable): port `src/sim/` logic, replace procedural art with real assets, add split-screen/online. |

## Status

- Phase 1: done.
- Phase 2: done. Portraits are hand-drawn SVGs in `public/portraits/`. A painted
  `<id>.png` in the same folder overrides the SVG (prompts in `public/portraits/PROMPTS.md`).
- Phase 3: core combat is in (fist, bat, chain, kick, health, wipeouts, armed rivals that
  pull alongside and swing). Still open: taking weapons off rivals, running back to the bike
  after a wipeout, crashing from hitting the roadside at speed.
- Phase 4: started. Police wait at posts along each course, give chase when you ride past, swing
  a baton, and bust you (race over) if you stop or go down with one on top of you; knock them off
  to end the chase. Still open: two-way traffic, roadside obstacles.
- Phase 5: started. Two courses: Pine Valley (country) and Rivet Town (shops, apartment blocks,
  suburban homes, four police posts). Defined in `src/sim/courses.js`.

- Branch `bike-asset`: real meshes instead of primitives. `tools/build-bike.mjs` bakes and simplifies a
  downloaded glTF bike (313k -> ~42k triangles, wheels split off, paint takes the rider colour) and
  `tools/build-rider.mjs` slims a Mixamo-rigged rider; the rider is posed with two-bone IK driven by the
  existing attack animations. Credits and licences in `public/models/CREDITS.md` - the bike model is
  non-commercial only. `?bike=classic` in the URL switches back to the primitive bikes.

## Phase 1 scope (done when)

- Seeded procedural course about 6.4 km with smoothed curves, rolling hills, jump crests.
- Arcade bike handling: lean into corners, braking needed for tight bends, off-road
  slowdown, airtime over crests.
- Chase camera with speed FOV, roll and shake.
- Lighting with sun shadows, sky, fog, trees/rocks/poles for speed sensation.
- HUD: speed, gear, RPM, progress, timer; countdown, finish screen, best time saved.
- Synth engine and wind audio.

## Controls

| Key | Action |
|-----|--------|
| W / Up | Throttle |
| S / Down | Brake |
| A D / Left Right | Steer |
| J (or Z) | Punch |
| K (or X) | Kick |
| L (or B) | Bat |
| I (or V) | Chain |
| Left / Right on the title screens | Difficulty: Easy, Normal, Hard |
| Up / Down on the title screens | Course: Pine Valley, Rivet Town |
| C | Switch camera: chase, wide, front, side, rider |
| R | Reset to road |
| M | Mute |
| Enter | Start / restart |
