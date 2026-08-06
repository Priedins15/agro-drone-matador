// Matador GLB variant pipeline.
// Uses the Zoo Engine API (Modeling WebSocket) to execute the bundled KCL for a
// sweep of parameter combinations and export each result as a GLB, so the
// configurator's offline mode has pre-built models to swap between.
//
//   export ZOO_API_TOKEN="<token>"
//   npm install
//   npm run build:variants
//
// Output:
//   configurator/models/<variant>.glb
//   configurator/models/index.json
//
// Token is read only from the ZOO_API_TOKEN environment variable — never
// hard-coded, never committed.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode } from '@msgpack/msgpack'
import { bundleProject } from './lib/bundle.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const modelsDir = path.join(root, 'configurator', 'models')

const BASE_URL = 'wss://api.zoo.dev/ws/modeling/commands'
const token = process.env.ZOO_API_TOKEN
if (!token) {
  console.error('Set ZOO_API_TOKEN first, e.g.  export ZOO_API_TOKEN="<your token>"')
  process.exit(1)
}

// ---- variant sweep ---------------------------------------------------------
// Each variant overrides parameters.kcl values, then the whole project is
// re-bundled and re-executed. Keep the grid small (each row = one Engine call).
const variants = [
  { id: 'standard', label: 'Standard (570 mm rotor pitch)', params: {} },
  { id: 'compact', label: 'Compact (450 mm rotor pitch)', params: { motorX: 450, motorY: 260 } },
  { id: 'longrange', label: 'Long-range (690 mm rotor pitch)', params: { motorX: 690, motorY: 395 } },
  { id: 'heavyboom', label: 'Heavy boom (Ø42 mm arm tube)', params: { armTubeOuterDiameter: 42, armTubeInnerDiameter: 36 } },
  { id: 'lightboom', label: 'Light boom (Ø34 mm arm tube)', params: { armTubeOuterDiameter: 34, armTubeInnerDiameter: 28 } },
]

// How to override a value inside the bundled code. Values appear as
// `motorX = 570mm` (the export keyword is stripped during bundling).
function applyParams(bundled, params) {
  let code = bundled
  for (const [name, value] of Object.entries(params)) {
    const re = new RegExp(`(^\\s*${name}\\s*=\\s*)(\\d+(?:\\.\\d+)?)(mm|deg)`, 'm')
    if (!re.test(code)) {
      console.warn(`  ! parameter "${name}" not found in bundle; skipping`)
      continue
    }
    code = code.replace(re, `$1${value}$3`)
  }
  return code
}

function parseResponse(raw) {
  // Modeling responses come back as JSON text or binary (MsgPack for exports).
  if (typeof raw === 'string') return JSON.parse(raw)
  const bytes = new Uint8Array(raw)
  try {
    const text = new TextDecoder().decode(bytes)
    return JSON.parse(text)
  } catch {
    return decode(bytes)
  }
}

async function sendCommand(ws, cmd, cmdId = crypto.randomUUID()) {
  const request = { type: 'modeling_cmd_req', cmd_id: cmdId, cmd }
  ws.send(JSON.stringify(request))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${cmd.type}`)), 120_000)
    const onMsg = (event) => {
      let msg
      try {
        msg = parseResponse(event.data)
      } catch (err) {
        console.error('  ! unparseable message:', err.message)
        return
      }
      if (!msg || typeof msg !== 'object' || !('resp' in msg)) return
      if (msg.request_id && msg.request_id !== cmdId) return
      clearTimeout(timer)
      ws.removeEventListener('message', onMsg)
      resolve(msg)
    }
    ws.addEventListener('message', onMsg)
  })
}

async function executeAndExportGltb(code) {
  const ws = new WebSocket(`${BASE_URL}?fps=30&webrtc=false&show_grid=false`)
  ws.binaryType = 'arraybuffer'

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true })
  })

  // Authenticate (browsers/Node cannot set headers on a WebSocket, so Zoo
  // accepts an explicit auth frame right after connect).
  ws.send(JSON.stringify({ type: 'headers', headers: { Authorization: `Bearer ${token}` } }))

  const exec = await sendCommand(ws, {
    type: 'execute_kcl',
    code,
    project_settings: {
      length_unit: 'mm',
      angle_unit: 'degrees',
      base_unit: 'mm',
      import_export_units: 'mm',
    },
  })
  const execData = exec.resp?.data?.modeling_response ?? exec.resp?.data ?? exec.resp
  if (exec.resp?.type === 'error' || execData?.type === 'error') {
    throw new Error('KCL execution failed: ' + JSON.stringify(execData).slice(0, 500))
  }

  const scene = await sendCommand(ws, {
    type: 'scene_get_entity_ids',
    filter: ['solid3d'],
    skip: 0,
    take: 1000,
  })
  const ids = scene.resp?.data?.modeling_response?.data?.entity_ids ?? []
  if (!ids.length) throw new Error('no solid3d entities returned')

  const exported = await sendCommand(ws, {
    type: 'export',
    entity_ids: ids,
    format: { type: 'gltf', storage: 'embedded' },
  })
  const files = exported.resp?.data?.files ?? []
  if (!files.length) throw new Error('export returned no files')

  // file contents arrive as a byte array (numbers) inside the MsgPack payload
  const contents = files[0].contents
  const bytes = Uint8Array.from(contents)
  ws.close()
  return bytes
}

// ---- run -------------------------------------------------------------------
console.log('Bundling KCL project…')
const baseBundle = bundleProject(root, 'main.kcl')
fs.mkdirSync(modelsDir, { recursive: true })

const manifest = { generatedAt: new Date().toISOString(), variants: [] }

for (const v of variants) {
  console.log(`\n[${v.id}] ${v.label}`)
  const code = applyParams(baseBundle, v.params)
  const outFile = path.join(modelsDir, `${v.id}.glb`)
  try {
    const glb = await executeAndExportGltb(code)
    fs.writeFileSync(outFile, glb)
    console.log(`  wrote ${path.relative(root, outFile)} (${glb.byteLength} bytes)`)
    manifest.variants.push({ id: v.id, label: v.label, params: v.params, file: `${v.id}.glb` })
  } catch (err) {
    console.error(`  FAILED: ${err.message}`)
  }
}

fs.writeFileSync(
  path.join(modelsDir, 'index.json'),
  JSON.stringify(manifest, null, 2)
)
console.log(`\nwrote ${path.join('configurator', 'models', 'index.json')}`)
