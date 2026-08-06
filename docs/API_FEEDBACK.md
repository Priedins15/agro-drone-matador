# Zoo API Feedback & Bug Notes

> **About this document**
> One of the judging criteria for the Zoo API Makeathon asks for *"Information on how to improve Zoo's APIs."* This file is our structured engineering feedback, written while building **Agrofloat** in Zoo Design Studio (KCL 2.0, `kclVersion = 2.0`). Every item below is grounded in a real pattern we hit in this repository, includes a minimal reproduction, and ends with a concrete suggestion and the workaround we shipped. We also include a short "what worked great" list so the Zoo team can see the strengths worth doubling down on.

---

## TL;DR

| # | Area | Severity | One-line ask |
|---|------|----------|--------------|
| 1 | Experimental gate | Medium | Promote `appearance`, `pattern*3d`, `mirror3d`, `loft` to stable, or tell us *exactly* which feature triggers the gate |
| 2 | Symbolic drift | Medium | LSP diagnostic + "extract parameter" refactor for repeated derived literals |
| 3 | Transform ergonomics | Low | Clearer `global` semantics and a first-class `box()`/`cylinder()` |
| 4 | No geometry loops | High | Arrays + `map`/`for` over solids; 2D grid patterns; would cut ~40% of assembly boilerplate |
| 5 | `mirror3d` ergonomics | Low | Pipe-able `mirror`, document handedness vs `scale(-1)` |
| 6 | Assembly verification | High | An interference/clearance query between bodies |
| 7 | Import semantics | Low | Document `import * from` vs named module imports |
| 8 | Export format clarity | Medium | Clarify `export` vs `export3d` and GLB vs glTF on the Modeling WebSocket |
| 9 | Studio project checkpoints | Low | Save and jump back to named stages of a project |
| 10 | Chat rewind / undo | Medium | Step backwards through Agent chat design turns |
| 11 | Open & fork from GitHub | Medium | Load a git project straight into Studio, fork in a click |
| 12 | Materials & physics polish | Low | Richer colors/textures/materials plus lightweight simulation |

---

## 1. Core CAD operations still sit behind `experimentalFeatures = allow`

**Observation.** Twelve of the 26 KCL files in this project need `@settings(defaultLengthUnit = mm, kclVersion = 2.0, experimentalFeatures = allow)` to use operations that we would argue are core CAD:

- `appearance(...)` (PBR materials)
- `patternLinear3d` / `patternCircular3d`
- `mirror3d`
- `loft(..., bezApproximateRational = true)`

When `experimentalFeatures` is omitted, these fail at parse/execute time. It is not obvious *which* feature triggered the requirement, so we ended up adding the flag file-by-file until the model stopped erroring.

**Minimal reproduction.**
```kcl
// fails without experimentalFeatures = allow
@settings(defaultLengthUnit = mm, kclVersion = 2.0)
b = box(10, 10, 10) |> appearance(color = "#ff0000")
```

**Why it matters.** These are not exotic API surfaces — they are the bread-and-butter of every mechanical design in this repo. A "production" CAD language shouldn't require an experimental escape hatch for its most common material and pattern operations. It also makes projects fragile: if the experimental surface changes, stable-looking files break.

**Suggested improvement.**
1. Promote `appearance`, `patternLinear3d`, `patternCircular3d`, `mirror3d`, and `loft` to stable KCL.
2. If some must stay experimental, emit a *specific* diagnostic when the gate is missing (e.g. `error[K0482]: 'appearance' is experimental; add experimentalFeatures = allow`), so users stop guessing.
3. Consider a per-project (not per-file) settings inheritance from `project.toml`.

**Workaround we shipped.** Every file that needs the flag declares it explicitly in its own `@settings` block, and we documented which features force it in `docs/PARAMETERS.md`.

---

## 2. No safety net against "derived constant" drift (magic numbers)

**Observation.** The arm sweep angle appears as a literal in six files:

```kcl
// parameters.kcl
export armYaw = 29.688deg

// quadArmAssembly.kcl, chassisAssembly.kcl, quadEscAssembly.kcl,
// armClampPlacement.kcl, sprayPlumbing.kcl
rotate(axis = Z, angle = 150.312deg, ...)   // == 180deg - armYaw
```

`150.312deg` is *derived* from `armYaw` (`180deg − 29.688deg`), but KCL gave us no reason to notice that relationship. If someone edits `armYaw`, the rear-arm geometry silently drifts out of sync — this is a real correctness trap in a parametric language, and it took a `grep` to find all five copies.

**Minimal reproduction.**
```kcl
export yaw = 20deg
// everywhere in the project: rotate(axis = Z, angle = 160deg)  // should be 180deg - yaw
```

**Suggested improvement.**
1. An LSP diagnostic that flags repeated numeric literals in the same file/project when a `const`/`export` with a matching value exists (or a "extract parameter" quick-fix).
2. Better: treat angle arithmetic as first-class so `180deg - armYaw` is obviously idiomatic (it works today, but nothing encourages it).
3. A project-wide "unused/undefined parameter" and "equivalent literal" linter as part of `zoo kcl check` / the Studio linter.

**Workaround we shipped.** We added `export rearArmYaw = 180deg - armYaw` to `parameters.kcl` and replaced every literal. Now editing `armYaw` updates all five rear-arm assemblies.

---

## 3. Transform ergonomics: `global = true` everywhere, no box/cylinder primitives

**Observation.** Nearly every transform in the codebase is written `translate(x=…, y=…, z=…, global = true)`. The `global` flag exists because a `scale(...)` earlier in the same pipe can change the reference frame, but in this project the flag is *always* needed and easy to get wrong (omit it once and a part lands in a local frame). Separately, we built every rectangular solid as `clone(unitBlock) |> scale(x=…, y=…, z=…)`, because KCL has no `box(width, depth, height)`/`cylinder(d, h)` constructor — see `unitBlock.kcl`, `unitCylinder.kcl`, `tankCradle.kcl`, `batteryPack.kcl`.

**Minimal reproduction.**
```kcl
// no "box" primitive exists; this is the only way to make a plate:
clone(unitBlock) |> scale(x = 100, y = 50, z = 10)
```

**Suggested improvement.**
1. First-class `box(w, d, h)` and `cylinder(d, h)` (and maybe `sphere(d)`) so designs stop relying on a `unitBlock` trick.
2. Make transform semantics explicit by default: either default `global = true`, or introduce `translateAbs`/`translateLocal` with the reference frame spelled out, and warn when a local/global ambiguity exists.

**Workaround we shipped.** We keep three one-line primitives (`unitBlock.kcl`, `unitCylinder.kcl`, `unitSphere.kcl`) and always pass `global = true`, which we documented as a convention in `docs/USER_GUIDE.md`.

---

## 4. No loops/arrays over geometry → massive copy-paste boilerplate

**Observation.** KCL has no array-of-solids with `map`/`for`, so symmetry is expressed by repeating a pattern by hand:

- `tankCradle.kcl` (756 lines) spends ~300 lines declaring 8 bolt "seed + head" pairs (each a `unitCylinder` scaled, rotated, translated, then `patternLinear3d`) because there is no `patternRectangular3d` and no way to loop over a list of hole positions.
- `quadMotorAssembly.kcl` (548 lines) repeats the same ~12 component instantiations four times (front-right / front-left / rear-right / rear-left), differing only by sign — a textbook loop body.
- `sprayPlumbing.kcl` repeats four identical hose/riser/junction shapes with sign flips.

**Minimal reproduction.**
```kcl
// desired: four bolts, one per corner
// today: the corner list must be unrolled by hand
```

**Suggested improvement.**
1. Arrays of solids plus `map`/`fold`/`for` over transforms: `[(-1,-1),(1,-1),(-1,1),(1,1)].map(...)`.
2. `patternRectangular3d(instance, columns, rows, spacingX, spacingY)` to complement `patternLinear3d`/`patternCircular3d`.
3. A library-friendly helper convention: allow a function `(x, y, z) => solid` to be passed to a transform-listing pattern.

**Workaround we shipped.** We rely on `patternLinear3d`/`patternCircular3d` and accept the boilerplate, but we keep the seed geometry in small modules (`escModule.kcl`, `motorModule.kcl`) so each repetition is at least a single `clone(...)`.

---

## 5. `mirror3d` is not pipe-able and its handedness is undocumented

**Observation.** In `tankCradle.kcl` we needed four corner receivers in four orientations. The code ends up with *three different techniques* because `mirror3d` can't be chained into a pipe and its relation to `scale(-1)` is unclear:

```kcl
frontRightCornerReceiver = mirror3d([cornerReceiver], across = YZ) |> translate(...)
rearLeftCornerReceiver   = mirror3d([cornerReceiver], across = XZ) |> translate(...)
rearRightCornerReceiver  = clone(cornerReceiver) |> rotate(axis = Z, angle = 180deg, global = true) |> translate(...)
```

**Minimal reproduction.**
```kcl
// cannot write:
cornerReceiver |> mirror3d(across = YZ)
```

**Suggested improvement.**
1. Make `mirror3d` a transform that composes in a pipeline (`|> mirror(across = [YZ])`) like `rotate`/`translate`.
2. Document that `scale(x = -1, …)` produces left-handed/mirrored geometry and is **not** equivalent to `mirror3d`, and add an LSP warning when a negative scale is applied to a solid.

**Workaround we shipped.** We keep `mirror3d` as a standalone call on the seed solid and use rotate/clone for the remaining quadrants.

---

## 6. No built-in interference / clearance check between bodies

**Observation.** Agrofloat is a 21-subsystem assembly positioned entirely by hand-authored coordinates in `main.kcl`. The riskiest class of bugs is two parts interpenetrating (e.g. propeller discs vs tank, nozzle risers vs landing skids). We verified by eyeball in the Studio viewport, because the Engine API exposes no query that returns *which* body pairs intersect.

**Minimal reproduction.** (n/a — the API surface does not exist today)

**Suggested improvement.**
1. An `analyze`/`query` engine command like `scene_get_interferences` returning pairs of solid ids and intersection volume — hugely valuable for assemblies built from code.
2. At minimum, document `closest_point`-style queries as the sanctioned way to do clearance checks today, with a worked example.

**Workaround we shipped.** We added `*InterfaceReview.kcl` files (`tankInterfaceReview.kcl`, `cameraInterfaceReview.kcl`, `explodedCentralReview.kcl`) that isolate subsystem boundaries, and we use the configurator's explode view to visually inspect clearances.

---

## 7. Import semantics are easy to trip over

**Observation.** KCL supports two module import shapes and it is not always clear which to use when:

```kcl
import allBodies as tankSet from "chemicalTank.kcl"   // named binding
import * from "parameters.kcl"                         // star / wildcard
import escCase, escTopPlate, … from "escModule.kcl"    // named sub-exports
```

All three appear in this project. There is no lint that warns if a star import shadows a name, and the "import then hide()" idiom (`hide(clampSource)`) is required to keep subassembly seeds out of the final export — a pattern that is easy to get subtly wrong.

**Suggested improvement.** A stable, documented module system with: consistent `import` forms, shadowing diagnostics, and a first-class way to declare "these bindings are internal, not exported."

**Workaround we shipped.** `main.kcl` imports each subsystem's `allBodies` with an explicit alias, and every module ends with `hide(...)` for its private seeds. Documented in `docs/USER_GUIDE.md`.

---

## 8. Export format naming on the Modeling WebSocket needs clarity

**Observation.** Building the live configurator, we had to produce a browser-renderable mesh from the Modeling WebSocket. The Engine has both an `export` command (files like `step`, `stl`, `obj`, `gltf`, `fbx`) and the viewer's `export3d` path, and the docs are not explicit about which format strings return a `.glb` container vs a `.gltf` JSON tree. Binary responses are MsgPack-encoded (`{ contents: number[] }`), which also isn't obvious from the REST-style docs.

**Suggested improvement.**
1. Add a single, authoritative table: format string → file extension → (binary | JSON) → example client decode.
2. Clarify when to use `export` vs `export3d`, and whether `gltf` returns a GLB (binary) or a glTF JSON + buffers.

**Workaround we shipped.** We decode with `@msgpack/msgpack` and consume `format: { type: "gltf" }` output as a GLB for three.js; the exact decode path is documented in `configurator/README.md` and in `scripts/build_variants.mjs`.

---

## What we'd love to see next (feature wishes)

We genuinely enjoy working in Zoo Design Studio and with the Zoo APIs. These are ideas we would be excited to have, and we want to say up front that we love the platform. Building Agrofloat this way felt closer to having a conversation with the model than writing CAD by hand, and everything below would make that even better.

### 9. Save and return to stages of the project

It would be great to checkpoint a design at different points and jump back to any earlier stage. Right now a large project keeps only its current state, so exploring a risky change means losing the path back. Named snapshots, side-by-side comparison, and branching from a past stage would make experimentation feel safe and fun.

### 10. Rewind the chat

The Agent chat is a huge productivity boost. Adding "undo" and "rewind" to the conversation would let us step backwards through the design turns, revert a change made via chat, and restart from a clean point without re-typing the earlier steps. This would make the iterative design loop feel even more like working with a great teammate.

### 11. Open and fork projects straight from GitHub

We would love to load a git-hosted project directly into Studio so it opens and is usable as-is, then fork and remix it in a couple of clicks. That would make sharing parametric designs and building on the community's work seamless, and it fits the open-source spirit of the makeathon perfectly.

### 12. Richer look and feel, plus physics

The PBR `appearance` support is already impressive. Going further with ready-made material and texture libraries, environment lighting presets, and real-time previews would make renders pop even more. Lightweight physics or simulation inside the Engine (center-of-gravity checks, simple flight stability) would turn a great CAD tool into a full design-review tool, which would be a big win for projects like ours.

---

## What worked great (please keep / build on)

- **`export` + `import` across files with typed aliases** made the 21-subsystem split possible and readable.
- **`patternLinear3d`/`patternCircular3d`** turned a one-off component into a believable assembly (ESC fins ×8, motor coils ×12, vents ×12).
- **`loft(..., bezApproximateRational = true)`** produced the organic tank shell and prop blades without any mesh editing.
- **PBR `appearance`** (color + metalness + roughness + opacity) is genuinely great for communication — it is what makes the renders and the configurator legible.
- **The unit system** (`mm`, `deg`) keeps dimensional intent explicit and caught real mistakes during design.
- **`flatten` + `hide`** gave us a clean way to compose modules without polluting the final scene.

---

*Filed as part of the Zoo API Makeathon submission. Reproducible against the `*.kcl` files in this repository.*
