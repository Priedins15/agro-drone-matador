# Engineering Design Notes

> **About this document**
> Matador is deliberately cross-disciplinary: it is a *fluidics + structures + propulsion + avionics* problem expressed as parametric CAD. This document explains the engineering intent behind the model so that the design is readable by people who are not CAD experts, and so that every dimension in `parameters.kcl` has a "why." It pairs with `docs/PARAMETERS.md` (the dimension reference) and `docs/API_FEEDBACK.md` (Zoo API notes).

---

## 1. The design in one paragraph

Matador is a reference-matched **agricultural spray quadcopter**: an X4 multirotor with a clamshell fuselage, four carbon-fiber arm tubes carrying motor/ESC/prop clusters, and a payload stack made of a ~4 L chemical tank, a diaphragm pump, and four anti-drip spray nozzles on arm-mounted risers. Everything is defined by ~25 shared parameters in `parameters.kcl`; the twenty-one subsystem files each build one coherent group, and `main.kcl` composes them into a single `agriculturalDroneAssembly`.

```
                        ~760 mm prop disc (2-blade, lofted)
                      ▲
                     ╱ ╲
      ╭──────╮       ╱   ╲            motor datum z = 55 mm
      │  FC  │      ╱     ╲           prop datum  z = 110 mm
      │  nav │     ╱  arm  ╲  armYaw = 29.688°
      │  cam │    ╱  tube  ╲         rear arm at 180° − armYaw
      │  bat │   ╱  38/32   ╲
      ╰──────╯  ╱  (OD/ID)   ╲
       chassis ╱              ╲
   ──tank 4 L──────────────────╱────  spray pump + manifold
      cradle ██ pump ██ plumbing ██  nozzles at yaw-aligned arms
      landing gear skids below
```

## 2. Why a *parametric* drone, and why this platform

1. **Ag-drones are bought off-the-shelf and can't be tuned.** Field requirements vary wildly (vineyard row spacing, orchard canopy height, rice-paddy area). A fully parametric model lets an operator resize rotor pitch (`motorX`), boom width, or tank volume without redesigning anything.
2. **A quadcopter is the right reference for a makeathon-scale build.** Quad X-layouts give yaw/roll/pitch control with four independent thrust vectors, the simplest flight controller math, and symmetric load paths — which also maps cleanly to KCL's pattern/clone idioms.
3. **The payload is the differentiator.** Most open drone designs stop at the airframe. Matador includes the entire *spray path* — tank → filter → pump → manifold → trunk lines → arm risers → nozzles — which is where the actual agronomy happens.

## 3. Propulsion & aerodynamics (sizing logic)

**Rotor datum & geometry** (`parameters.kcl`):

| Parameter | Value | Engineering intent |
|---|---|---|
| `motorX` / `motorY` | 570 / 325 mm | Motor-to-motor spacing along the body axes; sets the X4 footprint |
| `armYaw` | 29.688° | Arm sweep from the longitudinal axis; `rearArmYaw = 180° − armYaw` |
| `propellerZ` | 110 mm | Prop disc plane sits above the motor datum for clearance over the boom |
| `armTubeLength` / OD / ID | 512 / 38 / 32 mm | 3 mm wall carbon tube — the classic strength/weight sweet spot for this class |

**Thrust → weight logic.** A sprayer this size targets roughly **2:1 thrust-to-weight** (the usual hover-safe margin for crop drones, which need aggressive maneuver margins near obstacles and wind). With four motors and a prop disc of ≈ 760 mm, per-motor thrust in the 4–7 kgf class is the sensible envelope — the `motorX` sweep in the configurator exists precisely to trade footprint against prop-tip clearance and thrust moment arm.

**Prop-tip clearance is the single most important "gotcha."** With blades lofted to a 335 mm radius (≈ 760 mm disc), adjacent prop discs only have room if the rotor pitch is large enough. We kept `motorX`/`motorY` as *tunable* parameters instead of hard-coding them precisely so this collision can be checked and avoided in the configurator — and it is exactly the kind of check we ask Zoo for as a first-class API in `API_FEEDBACK.md §6`.

## 4. Structures & materials (load paths)

**Load path.** Flight loads enter through four motor mount plates → arm-end clamps (`armClampPlacement.kcl`, split collars) → carbon tubes (`armTube.kcl`) → chassis root beams (`chassisAssembly.kcl`, `frontRightBeam` etc.) → central plates → equipment rails. The clamshell (`upperFuselageShell`/`lowerFuselageShell`) is aero-*shaped*, not primary structure — all structural duty is the plate/beam/tube spine.

| Element | Material (appearance) | Why |
|---|---|---|
| Arm tubes | Carbon (`carbonBlack`, metalness 34 / rough 46) | High stiffness-to-weight, fatigue-proof, standard 38/32 mm stock |
| Arm clamps / bolts | Steel hardware (`hardwareSteel`, metalness ~90) | Split-collar clamp needs a durable thread/landing interface |
| Central plates + rails | 6061-ish aluminum (`aluminumDark`, metalness ~78) | Easy to machine, good bracket base |
| Chassis beams | Black hardware (`hardwareBlack`, metalness 72) | Inboard structural spine |

**Landing & ground handling.** `landingGearAssembly.kcl` (skids + crossbar) keeps the spray nozzles (which hang at `nozzleZ ≈ −90 mm`) clear of the ground when parked, and the tank cradle pads (`tankCradle.kcl` — 4 rubber-ish pads, roughness 90+) give the tank a compliant, vibration-isolated seat.

## 5. Fluidics — the spray path (the agronomy)

The payload is a complete closed loop, modeled part-by-part:

```
TANK (≈4 L lofted shell)
  └─ outlet fitting (28 mm OD / 12 mm bore) ── pickup cross-line (Ø10) ── pickup riser
       └─ PUMP MODULE (diaphragm-type): filter bowl (Ø38) → pump head → regulator (Ø23)
            └─ discharge riser ── manifold (76×58×34) ── pressure sensor
                 ├─ left/right side trunks (Ø10) ── feed risers ── top connectors
                 └─ arm feeds (Ø7, yaw-rotated to follow each arm) ── nozzle risers
                      └─ NOZZLES (4×): inlet barb (Ø14) → valve body (Ø30) → strainer (Ø42)
                           → tip holder (Ø28) → orifice plate (Ø1.8) → deflector (30×6×4)
```

**Design intent at each station:**

- **Tank.** Five lofted circular profiles (48 → 78 → 105 → 92 → 55 mm radius over 250 mm height), cross-section squeezed ×0.88/×1.05 to make an ellipsoidal cross-section that sheds slosh and nests against the cradle. Wall ≈ 10% of radius (inner shell scaled 0.90). A ~4 L class volume is right for a 10–15 min spray sortie on a sub-25 kg drone.
- **Filter → pump → regulator.** A cleanable pre-filter before the diaphragm pump, then a pressure regulator (Ø23, `warningOrange`), because **flow is a function of pressure, and pressure is what a drone's battery voltage makes unreliable.** Regulating pressure is what holds spray quality constant across the discharge curve.
- **Manifold + pressure sensor.** One manifold distributes to the four arms; the sensor gives the flight controller a closed-loop signal so the pump duty can be trimmed in flight.
- **Nozzle.** The 1.8 mm orifice plate + flat deflector (30×6×4) is a classic *flat-fan* pattern — the right droplet spectrum for herbicide/insecticide without excessive drift. The Ø42 strainer and anti-drip valve body are what keep a sprayer from dribbling between bursts.

**Numbers worth remembering (all readable from the KCL):**

| Fluidics fact | Value | Where |
|---|---|---|
| Tank height / mid radius | 250 mm / 105 mm | `chemicalTank.kcl` |
| Tank volume (estimate) | ≈ 4 L | loft profile sweep ×0.88/×1.05 |
| Outlet bore | Ø12 mm | `chemicalTank.kcl` |
| Hose ID (trunks/arm feeds) | Ø10 / Ø7 mm | `sprayPlumbing.kcl` |
| Nozzle orifice | Ø1.8 mm | `sprayNozzle.kcl` |
| Nozzle stations | 4, yaw-aligned | `quadNozzleAssembly.kcl` |

## 6. Avionics & power

- **Battery.** 2×6 = 12 cylindrical cells (Ø26×60, `patternLinear3d` ×6 on each of two rows) in a 216×122 mm tray — a 12S-class pack layout for a high-voltage spray platform. Fused at the tray (`mainFuse`), with a `powerConnector` on the tray edge for fast field swaps.
- **Controller stack.** `controllerStack.kcl` carries the flight controller; `navigationModule.kcl` (GNSS/RTK + IMU stack) and `cameraModule.kcl` (forward FPV/vision) sit at the front datum.
- **ESCs.** One per arm (`quadEscAssembly.kcl`), each a detailed finned case + 3 phase leads + caps, rotated to the same corrected arm axis as its motor — a nice example of the "one component, patterned to four datums" idiom.

**Center-of-gravity intent.** The heavy battery sits centrally over the chassis (`mainBattery` at y=70, z=25); the tank hangs low-center (`chemicalTank` translated to z = −180 mm). Weight is kept close to the vertical CG axis, which is the difference between a stable sprayer and a tumbling one. `main.kcl` is where all of this is composed, so it doubles as a CG review sheet.

## 7. How to read the model (readability map)

1. Start at **`main.kcl`** — it is the table of contents. Every subsystem is one `import … as …Set` + one placement line.
2. Jump to **`parameters.kcl`** — every tunable lives here (dimensions first, then appearance). No magic numbers anywhere else (see the `rearArmYaw` fix in `API_FEEDBACK.md §2`).
3. Pick a subsystem — each file is ordered **source geometry → derived clones → export `allBodies` → `hide(...)` of private seeds**.
4. Patterns: `unitBlock`/`unitCylinder`/`unitSphere` are the three primitive seeds used project-wide (`unitBlock.kcl` etc.). `patternLinear3d`/`patternCircular3d` turn seeds into believable hardware.

**Conventions used everywhere:**

- Lengths in `mm`, angles in `deg` (enforced by the project `@settings`).
- `global = true` on every transform (documented in `USER_GUIDE.md`).
- Private seed geometry ends in `Seed` and is always `hide(...)`-d.
- Subsystem entrypoints export a single `allBodies`.

## 8. Limitations & honest scope

- This is a **design reference, not a flight-ready airframe.** No structural FEA, no rotor-blade aerodynamics, no electrical schematics. The propulsion numbers are sizing logic, not test data.
- Prop-tip clearance vs rotor pitch must be checked per-configuration (we surface it in the configurator and ask for an API to automate it).
- Tank volume is an estimate from the loft profile, not a measured model.

These limitations are the reason the project is structured the way it is: parameter-driven, composable, and scriptable — so the next person can add the FEA, the motor spreadsheet, or the field-data tuning pass on top without redesigning the tree.
