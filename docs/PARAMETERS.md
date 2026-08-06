# Parameter Reference

Every tunable in **Matador** lives in a single file: [`parameters.kcl`](../parameters.kcl). There are no magic numbers anywhere else in the project — a number you can't find here was either derived from one of these (`rearArmYaw = 180deg - armYaw`) or belongs to a part's own geometry (kept inside its module file).

Units: **millimeters** for lengths, **degrees** for angles, **hex strings** for colors.

---

## Dimensions

| Parameter | Value | Used by | Meaning |
|---|---|---|---|
| `motorX` | `570mm` | `quadMotorAssembly.kcl` | Motor datum X from aircraft center. Together with `motorY` sets the X4 rotor footprint. Also the primary "scale the drone up/down" knob. |
| `motorY` | `325mm` | `quadMotorAssembly.kcl` | Motor datum Y (fore/aft). |
| `motorZ` | `55mm` | `quadMotorAssembly.kcl` | Motor datum Z (height above chassis datum). |
| `propellerZ` | `110mm` | `quadPropellerAssembly.kcl` | Prop disc plane height — clears the boom/motor stack. |
| `armYaw` | `29.688deg` | arms, clamps, ESCs, hoses, nozzles | Sweep of the front arms from the longitudinal axis. |
| `rearArmYaw` | `180deg - armYaw` | arms, clamps, ESCs, hoses | **Derived.** Rear-arm sweep; keeps symmetric geometry in sync with `armYaw`. |
| `armTubeLength` | `512mm` | `armTube.kcl` | Carbon boom length. |
| `armTubeOuterDiameter` | `38mm` | `armTube.kcl`, clamps | Boom OD (standard carbon stock). |
| `armTubeInnerDiameter` | `32mm` | `armTube.kcl` | Boom ID → 3 mm wall. |
| `armCenterX` | `347.982mm` | `quadArmAssembly.kcl` | Boom root-to-chassis datum X. |
| `armCenterY` | `198.411mm` | `quadArmAssembly.kcl` | Boom root-to-chassis datum Y. |
| `innerClampX` / `innerClampY` | `125.963` / `71.821mm` | `armClampPlacement.kcl` | Inboard split-collar station. |
| `outerClampX` / `outerClampY` | `542.945` / `309.574mm` | `armClampPlacement.kcl` | Outboard split-collar station. |
| `escX` / `escY` | `412.638` / `235.276mm` | `quadEscAssembly.kcl` | ESC mount station per arm. |
| `armZ` | `16mm` | arms, clamps | Boom centerline height. |
| `nozzleX` | `535mm` | `sprayPlumbing.kcl`, `quadNozzleAssembly.kcl` | Nozzle riser station X. |
| `nozzleY` | `305mm` | `sprayPlumbing.kcl`, `quadNozzleAssembly.kcl` | Nozzle riser station Y. |
| `nozzleZ` | `-90mm` | `sprayPlumbing.kcl` | Nozzle height below datum (keeps tips clear of landing gear). |

## Appearance palette

| Parameter | Value | Where it shows |
|---|---|---|
| `shellWhite` | `#f1f3f2` | Fuselage shells, tank shell |
| `shellShadow` | `#c9ced0` | Fuselage shading |
| `carbonBlack` | `#171b1e` | Arm tubes, chassis plates |
| `hardwareBlack` | `#252b2f` | Clamps, bolts, motor housings, ESC cases |
| `hardwareSteel` | `#aab1b6` | Bolts, bearings, shafts, fittings |
| `aluminumDark` | `#515a60` | Rails, spines, brackets, pump plate |
| `copperColor` | `#b96b32` | Motor windings / leads |
| `hoseBlack` | `#111719` | Spray hoses and trunks |
| `tankWhite` | `#e9eeee` | Tank, filler neck |
| `tankBlue` | `#6ea5bd` | Tank outlet, level tube, pump head, manifold |
| `lensBlue` | `#1c4963` | Camera lens |
| `pcbGreen` | `#2b5a45` | Flight controller / nav boards |
| `warningOrange` | `#e57d2d` | Regulator, nozzle tip holder/deflector, power connector |

## Editing rules of thumb

1. **Change a dimension in `parameters.kcl`, never inline.** Every subsystem imports it, so one edit propagates project-wide.
2. **If you add a parameter**, keep the group order: dimensions first (motor → arms → payload → nozzles), then appearance.
3. **If you add an appearance color**, reference it by name everywhere so the palette stays centralized.
4. **Derived values** (like `rearArmYaw`) belong here too — see `API_FEEDBACK.md §2` for why.

> `@settings(defaultLengthUnit = mm, kclVersion = 2.0, experimentalFeatures = allow)` — the `experimentalFeatures = allow` flag is required by the subset of files that use `appearance`, `pattern*3d`, `mirror3d`, or `loft`. See `API_FEEDBACK.md §1`.
