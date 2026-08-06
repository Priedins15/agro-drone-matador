// Parameter definitions for the Matador configurator.
//
// Each entry describes one line in the bundled KCL (e.g. `motorX = 570mm`).
// The configurator writes the slider value back into the bundle and re-executes
// it through the Zoo Engine API, so any parameter that exists in parameters.kcl
// could be surfaced here — these are the ones that matter visually/structurally.

export const PARAMS = [
  {
    name: 'motorX',
    label: 'Rotor pitch X',
    unit: 'mm',
    min: 400,
    max: 760,
    step: 10,
    default: 570,
    desc: 'Lateral motor spacing. Sets the X4 footprint; the primary "scale the drone" knob.',
  },
  {
    name: 'motorY',
    label: 'Rotor pitch Y',
    unit: 'mm',
    min: 220,
    max: 430,
    step: 10,
    default: 325,
    desc: 'Longitudinal motor spacing. Drives front/rear prop-tip clearance.',
  },
  {
    name: 'armTubeOuterDiameter',
    label: 'Boom OD',
    unit: 'mm',
    min: 30,
    max: 46,
    step: 1,
    default: 38,
    desc: 'Carbon boom outer diameter (stock tube).',
  },
  {
    name: 'armTubeInnerDiameter',
    label: 'Boom ID',
    unit: 'mm',
    min: 24,
    max: 36,
    step: 1,
    default: 32,
    desc: 'Carbon boom bore. Wall = (OD - ID) / 2; keep ID < OD.',
  },
  {
    name: 'armYaw',
    label: 'Arm sweep',
    unit: 'deg',
    min: 20,
    max: 40,
    step: 0.1,
    default: 29.688,
    desc: 'Front-arm sweep from the longitudinal axis. rearArmYaw = 180 - armYaw follows automatically.',
  },
  {
    name: 'propellerZ',
    label: 'Prop height',
    unit: 'mm',
    min: 80,
    max: 160,
    step: 5,
    default: 110,
    desc: 'Prop disc plane height above the motor datum.',
  },
  {
    name: 'nozzleZ',
    label: 'Nozzle height',
    unit: 'mm',
    min: -150,
    max: -40,
    step: 5,
    default: -90,
    desc: 'Spray nozzle height below datum; keep clear of landing gear.',
  },
]

// Reference geometry derived from the KCL (prop loft end section at r=335 mm).
export const PROP_TIP_RADIUS_MM = 335 // per blade, from the prop axis

// Write a set of {name: value} overrides into a bundled KCL string.
// Lines look like `motorX = 570mm` (the `export` keyword is stripped during bundling).
export function applyParams(bundle, values) {
  let code = bundle
  for (const [name, value] of Object.entries(values)) {
    const unit = PARAMS.find((p) => p.name === name)?.unit
    if (!unit) continue
    const re = new RegExp(`(^\\s*${name}\\s*=\\s*)(\\d+(?:\\.\\d+)?)(mm|deg)`, 'm')
    if (!re.test(code)) continue
    code = code.replace(re, `$1${value}${unit}`)
  }
  return code
}

export function currentValuesFrom(p) {
  const out = {}
  for (const def of PARAMS) out[def.name] = Number(p[def.name] ?? def.default)
  return out
}

// Simple cross-disciplinary design checks computed from the current parameters.
// Returns a list of { level: 'ok'|'warn'|'err', text }.
export function runChecks(values) {
  const checks = []
  const { motorX, motorY, armTubeOuterDiameter: od, armTubeInnerDiameter: id, armYaw } = values

  const wall = (od - id) / 2
  checks.push({
    level: wall >= 1.5 ? 'ok' : 'err',
    text: `Boom wall = ${wall.toFixed(1)} mm ${wall >= 1.5 ? '(carbon tube stock)' : '— too thin for a 512 mm boom'}`,
  })

  const minAdjacent = 2 * Math.min(motorX, motorY)
  const clearance = minAdjacent - 2 * PROP_TIP_RADIUS_MM
  checks.push({
    level: clearance >= 20 ? 'ok' : clearance >= 0 ? 'warn' : 'err',
    text: `Prop tip clearance ≈ ${clearance.toFixed(0)} mm between adjacent rotors (prop ∅${(2 * PROP_TIP_RADIUS_MM).toFixed(0)} mm)`,
  })

  checks.push({
    level: motorX >= motorY ? 'ok' : 'warn',
    text: `Footprint ${motorX}×${motorY} mm ${motorX >= motorY ? '(X-quad, wide first)' : '— unusual for a quad'}`,
  })

  const diag = Math.sqrt(motorX ** 2 + motorY ** 2)
  checks.push({
    level: diag > 2 * PROP_TIP_RADIUS_MM ? 'ok' : 'err',
    text: `Diagonal rotor spacing ${diag.toFixed(0)} mm vs prop disc ∅${(2 * PROP_TIP_RADIUS_MM).toFixed(0)} mm`,
  })

  checks.push({
    level: armYaw >= 15 && armYaw <= 45 ? 'ok' : 'warn',
    text: `Arm sweep ${armYaw}° (typical ag-quad range 15–45°)`,
  })

  return checks
}
