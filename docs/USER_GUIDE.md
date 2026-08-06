# User Guide

Setup, behavior, use-cases, and troubleshooting for the **Matador** agricultural spray drone project.

---

## 1. What you need

- **Zoo Design Studio** (free tier is enough) — [zoo.dev/design-studio](https://zoo.dev/design-studio)
- A Zoo account
- Optionally: a **Zoo API token** from your [account developer tab](https://zoo.dev/account) if you want to use the live Engine API configurator or generate GLB variants (token stays on your machine — never commit it)

## 2. Getting started (5 minutes)

```sh
git clone https://github.com/Priedins15/agro-drone-matador.git
cd agrofloat
```

1. In Zoo Design Studio, open the **agrofloat** folder as a project (select `project.toml`).
2. Open **`main.kcl`** — it is the entry point (`default_file = "main.kcl"` in `project.toml`).
3. **Run** the file. The full `agriculturalDroneAssembly` is generated: fuselage, four arms with motors/ESCs/props, tank + pump + spray plumbing + nozzles, avionics, and landing gear.
4. Rotate/zoom in the 3D viewport to inspect. Use the **Explode** command or open `explodedCentralReview.kcl` for a pulled-apart view of the payload stack.

> Tip: want to inspect one subsystem in isolation? Open its file directly (e.g. `chemicalTank.kcl`) and run it — every subsystem is independently executable because each exports its own `allBodies`.

## 3. How the model behaves

### 3.1 The assembly graph

`main.kcl` is a pure composition script. It imports 21 subsystem files, applies placement transforms, and flattens everything into one export:

```
main.kcl
├── upperFuselageShell.kcl      clamshell upper
├── lowerFuselageShell.kcl      clamshell lower
├── chassisAssembly.kcl         plates, spine, beams, standoffs, rails
├── quadArmAssembly.kcl         arm tubes (carbon)
├── armClampPlacement.kcl       split-collar clamps ×8
├── quadMotorAssembly.kcl       motors ×4 (detailed: bell, coils, bearings…)
├── quadEscAssembly.kcl         ESCs ×4 (finned cases, phase leads)
├── quadPropellerAssembly.kcl   props ×4 (lofted blades + hub)
├── chemicalTank.kcl            ~4 L lofted tank + filler neck + outlet
├── tankCap.kcl                 sealed cap
├── tankCradle.kcl              cradle frame, pads, receivers, bolts
├── pumpModule.kcl              diaphragm pump + filter + regulator
├── quadNozzleAssembly.kcl      anti-drip nozzles ×4
├── sprayPlumbing.kcl           tank→pump→manifold→arm→nozzle lines
├── navigationModule.kcl        GNSS/RTK + IMU
├── cameraModule.kcl            forward camera
├── controllerStack.kcl         flight controller
├── batteryPack.kcl             12S tray, cells, fuse, connector
├── landingGearAssembly.kcl     skids + crossbar
└── chassisFastenerAssembly.kcl chassis hardware
```

### 3.2 Parameters drive everything

Open **`parameters.kcl`**. Two groups:

- **Dimensions** (`motorX`, `armYaw`, `armTubeLength`, `nozzleX`, …) — change a number, re-run `main.kcl`, and every subsystem that imported it updates. Example: raise `armTubeOuterDiameter` from `38mm` to `42mm` and the clamps, tubes, and mounts all resize together.
- **Appearance** (`shellWhite`, `tankBlue`, `hardwareBlack`, …) — shared material palette. Change `tankBlue` once and the tank, pump, and level tube all follow.

Derived parameters (e.g. `rearArmYaw = 180deg - armYaw`) keep symmetric geometry in sync — edit `armYaw` and both front and rear arm rotations stay consistent.

### 3.3 Module conventions (reading any file)

Every subsystem file follows the same shape, which is what makes the project easy to read:

```
1. @settings(...)                 units + KCL version (+ experimentalFeatures when needed)
2. import ...                     dependencies (unit primitives + parameters)
3. seed geometry                  one component drawn once
4. clone/pattern/transform        spread it to its datums
5. export allBodies = [...]       the public surface
6. hide(privateSeed)              keep seeds out of the final export
```

`unitBlock.kcl`, `unitCylinder.kcl`, `unitSphere.kcl` are the three project-wide primitives; everything else is scaled/cloned from them.

## 4. Use-cases

**A. Education / CAD learning.** The project is a complete, commented multi-file KCL example: module imports, parametric exports, sketch-and-loft (`chemicalTank.kcl`, `propellerAssembly.kcl`), boolean operations (`sprayNozzle.kcl`), and patterns. Good reference for people learning Zoo Design Studio.

**B. Parametric prototyping for ag-tech.** Change rotor pitch, arm tube diameter, or tank size to match a specific crop or field and regenerate the whole airframe. Use the [configurator](../configurator/) to sweep parameters interactively without touching KCL.

**C. Payload integration studies.** Because the spray path is fully modeled, you can repurpose the airframe to carry other payloads (granular spreader, sensor pod, seed broadcaster) by swapping `pumpModule.kcl` / `sprayPlumbing.kcl` / `quadNozzleAssembly.kcl`.

**D. Manufacturing reference.** Every part is dimensioned with real stock sizes (38/32 mm carbon tube, Ø5.8 mm bolt holes, Ø10 mm hose). Exported STL/STEP from Zoo Design Studio can go to a CNC router or 3D printer for a physical mockup.

**E. A live Zoo Engine API demo.** The [configurator](../configurator/) executes the actual KCL through the Zoo Engine API and renders the result in the browser — a compact example of wrapping Zoo APIs (execute KCL → export GLB → render).

## 5. Working with the configurator

See [`configurator/README.md`](../configurator/README.md) for full details. In short:

- **Live mode** — paste your Zoo API token (stored only in your browser's `localStorage`), load the bundled KCL, and the app executes it through the Modeling WebSocket and renders the GLB. Drag the sliders to mutate `parameters.kcl` values and re-render live. Download STL/STEP/GLB of the current configuration.
- **Offline mode** — no token required; the app swaps between pre-generated GLB variants produced by `scripts/build_variants.mjs` (run once, commit the `models/` output).

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "experimentalFeatures" error on run | File uses `appearance`/`pattern*3d`/`mirror3d`/`loft` without the flag | Add `experimentalFeatures = allow` to its `@settings` (see `API_FEEDBACK.md §1`) |
| A subsystem imports fail | Relative import path wrong or a `* from "parameters.kcl"` line missing | Check the `import` lines at the top; keep all files in the same folder |
| Part lands in the wrong place | A `translate`/`rotate` is missing `global = true` | Add `global = true` (project convention) |
| Rear arms don't match front arms after editing `armYaw` | Magic angle not derived | Use `rearArmYaw` (see `API_FEEDBACK.md §2`) |
| Configurator shows "no models" | Offline GLBs not generated yet | Run `npm run build:variants` with `ZOO_API_TOKEN` set, or use Live mode |
| Something looks mirrored oddly | `mirror3d` vs `scale(-1)` handedness | Use `mirror3d` for mirrors; see `API_FEEDBACK.md §5` |

## 7. Contributing

1. **Parameters first.** If your change affects a dimension, add/update it in `parameters.kcl`, not inline.
2. **One subsystem per file.** Keep `main.kcl` as pure composition.
3. **Follow the conventions** in §3.3 (seeds → clones → `export allBodies` → `hide`).
4. **Re-run `main.kcl`** and eyeball clearance (we recommend the Explode view) after structural changes.
5. Run `node scripts/bundle-kcl.mjs` after adding/renaming KCL files so the configurator's live mode stays in sync.

## 8. Related docs

- [`DESIGN_NOTES.md`](./DESIGN_NOTES.md) — the engineering intent behind every dimension
- [`PARAMETERS.md`](./PARAMETERS.md) — full parameter reference
- [`API_FEEDBACK.md`](./API_FEEDBACK.md) — how to improve the Zoo APIs
