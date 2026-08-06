import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { ZooEngineClient } from './zoo-engine-client.js'
import { PARAMS, applyParams, currentValuesFrom, runChecks, PROP_TIP_RADIUS_MM } from './params.js'
import { KCL_BUNDLE } from './kcl-bundle.js'

// ---------------- element refs ----------------
const $ = (id) => document.getElementById(id)
const el = {
  viewport: $('viewport'),
  overlay: $('overlay'),
  overlayText: $('overlay-text'),
  overlayActions: $('overlay-actions'),
  status: $('status'),
  metrics: $('metrics'),
  sliders: $('sliders'),
  checks: $('checks'),
  variants: $('variants'),
  variantsBlock: $('variants-block'),
  token: $('token'),
  connect: $('connect'),
  modeLive: $('mode-live'),
  modeOffline: $('mode-offline'),
  dlGlb: $('dl-glb'),
  dlStep: $('dl-step'),
  dlStl: $('dl-stl'),
  log: $('log'),
}

const TOKEN_KEY = 'matador-zoo-api-token'
let mode = 'offline'
let engine = null
let currentGroup = null
let lastIds = []
let lastBytes = null
let offlineVariants = []
let offlineIndex = -1
let currentValues = {}
let renderQueued = false
let scene = null
let camera = null
let controls = null

// ---------------- viewer ----------------
function initViewer() {
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0d1117)

  camera = new THREE.PerspectiveCamera(45, el.viewport.clientWidth / el.viewport.clientHeight, 1, 20000)
  camera.position.set(1400, 900, 1600)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(el.viewport.clientWidth, el.viewport.clientHeight)
  el.viewport.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.target.set(0, 0, 0)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x223044, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 1.4)
  key.position.set(1200, 1800, 900)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x6ea5bd, 0.5)
  rim.position.set(-1200, 300, -1000)
  scene.add(rim)

  const grid = new THREE.GridHelper(4000, 40, 0x2b3442, 0x1b2330)
  scene.add(grid)

  window.addEventListener('resize', () => {
    camera.aspect = el.viewport.clientWidth / el.viewport.clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(el.viewport.clientWidth, el.viewport.clientHeight)
  })

  renderer.setAnimationLoop(() => {
    controls.update()
    renderer.render(scene, camera)
  })
}

function loadGLB(bytes) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    loader.parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
      (gltf) => resolve(gltf.scene),
      (err) => reject(err)
    )
  })
}

function setModel(group) {
  if (currentGroup) scene.remove(currentGroup)
  currentGroup = group
  if (!group) return
  scene.add(group)

  const box = new THREE.Box3().setFromObject(group)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  controls.target.copy(center)
  camera.position.copy(center).add(new THREE.Vector3(size.length() * 0.9, size.length() * 0.55, size.length() * 0.9))
  camera.near = size.length() / 1000
  camera.far = size.length() * 20
  camera.updateProjectionMatrix()
}

// ---------------- logging / status ----------------
function log(msg) {
  const t = new Date().toLocaleTimeString()
  el.log.textContent += `[${t}] ${msg}\n`
  el.log.scrollTop = el.log.scrollHeight
}

function setStatus(text, cls = '') {
  el.status.textContent = text
  el.status.className = 'status' + (cls ? ' ' + cls : '')
}

function renderChecks(values) {
  const checks = runChecks(values)
  el.checks.innerHTML = ''
  for (const c of checks) {
    const li = document.createElement('li')
    li.className = c.level
    li.textContent = c.text
    el.checks.appendChild(li)
  }
  // summary metrics in the status bar
  const { motorX, motorY, armTubeOuterDiameter: od, armTubeInnerDiameter: id } = values
  el.metrics.textContent =
    `${motorX}×${motorY} mm · boom ${od}/${id} mm · prop ∅${(2 * PROP_TIP_RADIUS_MM).toFixed(0)} mm`
}

// ---------------- sliders ----------------
function buildSliders() {
  el.sliders.innerHTML = ''
  currentValues = {}
  for (const def of PARAMS) {
    currentValues[def.name] = def.default
    const row = document.createElement('div')
    row.className = 'slider-row'
    const label = document.createElement('label')
    label.innerHTML = `${def.label} <small>${def.desc}</small>`
    const input = document.createElement('input')
    input.type = 'range'
    input.min = def.min
    input.max = def.max
    input.step = def.step
    input.value = def.default
    input.title = def.desc
    input.addEventListener('input', () => {
      currentValues[def.name] = Number(input.value)
      val.textContent = formatVal(def, currentValues[def.name])
      if (mode === 'live' && engine) scheduleRender()
      renderChecks(currentValues)
      updateSliderClamps()
    })
    const val = document.createElement('span')
    val.className = 'val'
    val.textContent = formatVal(def, def.default)
    row.append(label, input, val)
    el.sliders.appendChild(row)
  }
}

function formatVal(def, v) {
  const digits = def.step < 1 ? 1 : 0
  return `${Number(v).toFixed(digits)}${def.unit}`
}

// keep Boom ID below Boom OD and prop constraints sensible
function updateSliderClamps() {
  const rows = [...el.sliders.querySelectorAll('.slider-row')]
  const getInput = (name) => rows
    .map((r) => r.querySelector('label'))
    .map((l, i) => [PARAMS[i], rows[i].querySelector('input')])
    .find(([p]) => p.name === name)?.[1]
  const odInput = getInput('armTubeOuterDiameter')
  const idInput = getInput('armTubeInnerDiameter')
  if (odInput && idInput) {
    idInput.max = Math.max(24, Math.min(36, Number(odInput.value) - 4))
    if (Number(idInput.value) > Number(idInput.max)) {
      idInput.value = idInput.max
      currentValues.armTubeInnerDiameter = Number(idInput.max)
    }
  }
}

// ---------------- live engine mode ----------------
let renderTimer = null
function scheduleRender() {
  if (renderQueued) return
  renderQueued = true
  clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    renderQueued = false
    liveRender().catch((err) => {
      setStatus('render failed', 'err')
      log(`render failed: ${err.message}`)
    })
  }, 450)
}

async function liveRender() {
  setStatus('executing KCL…', 'busy')
  log('execute_kcl (bundled project)')
  const code = applyParams(KCL_BUNDLE, currentValues)
  await engine.executeKcl(code)
  lastIds = await engine.getSolidIds()
  log(`scene_get_entity_ids -> ${lastIds.length} solid bodies`)
  setStatus('exporting GLB…', 'busy')
  lastBytes = await engine.exportGltf(lastIds)
  log(`export gltf -> ${lastBytes.byteLength} bytes`)
  const model = await loadGLB(lastBytes)
  setModel(model)
  setStatus('rendering live (engine) ✓', 'ok')
  enableExports(true)
}

async function connectLive() {
  const token = el.token.value.trim()
  if (!token) {
    setStatus('enter a token first', 'err')
    return
  }
  localStorage.setItem(TOKEN_KEY, token)
  engine = new ZooEngineClient(token)
  try {
    setStatus('connecting to Engine API…', 'busy')
    await engine.connect()
    log('Modeling WebSocket connected')
    setMode('live')
    el.overlay.classList.add('hidden')
    buildSliders()
    updateSliderClamps()
    await liveRender()
  } catch (err) {
    setStatus('connect failed', 'err')
    log(`connect failed: ${err.message}`)
    log('tip: you can still use Offline variants, or run npm run build:variants.')
  }
}

// ---------------- offline variants mode ----------------
async function loadOfflineVariants() {
  try {
    const res = await fetch('models/index.json', { cache: 'no-store' })
    if (!res.ok) throw new Error('no manifest')
    offlineVariants = (await res.json()).variants || []
  } catch {
    offlineVariants = []
  }
  el.variants.innerHTML = ''
  if (!offlineVariants.length) {
    el.variants.innerHTML = '<p class="hint">No pre-built variants found. Run <code>npm run build:variants</code> (requires a Zoo API token), or use <strong>Live engine</strong> mode.</p>'
    return
  }
  offlineVariants.forEach((v, i) => {
    const btn = document.createElement('button')
    btn.className = 'variant-btn'
    btn.textContent = v.label || v.id
    btn.addEventListener('click', () => selectVariant(i, btn))
    el.variants.appendChild(btn)
  })
  el.overlayActions.innerHTML = ''
  if (!mode || mode === 'offline') {
    selectVariant(0)
  }
}

async function selectVariant(i, btn) {
  offlineIndex = i
  for (const b of el.variants.querySelectorAll('.variant-btn')) b.classList.remove('active')
  if (btn) btn.classList.add('active')
  const v = offlineVariants[i]
  setStatus('loading variant…', 'busy')
  try {
    const res = await fetch(`models/${v.file}`, { cache: 'no-store' })
    if (!res.ok) throw new Error('failed to fetch ' + v.file)
    const bytes = new Uint8Array(await res.arrayBuffer())
    lastBytes = bytes
    const model = await loadGLB(bytes)
    setModel(model)
    currentValues = currentValuesFrom(v.params || {})
    renderChecks(currentValues)
    setStatus(`offline variant: ${v.label}`, 'ok')
    log(`loaded ${v.file} (${bytes.byteLength} bytes)`)
    enableExports(true)
  } catch (err) {
    setStatus('variant load failed', 'err')
    log(`variant load failed: ${err.message}`)
  }
}

// ---------------- exports ----------------
function enableExports(any) {
  el.dlGlb.disabled = !any
  el.dlStep.disabled = mode !== 'live'
  el.dlStl.disabled = mode !== 'live'
}

function download(name, bytes, mime) {
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

async function handleDownload(fmt) {
  try {
    if (mode === 'live' && engine && lastIds.length) {
      setStatus(`exporting ${fmt}…`, 'busy')
      const bytes =
        fmt === 'step' ? await engine.exportStep(lastIds) : fmt === 'stl' ? await engine.exportStl(lastIds) : await engine.exportGltf(lastIds)
      download(`matador-${fmt}.${fmt === 'gltf' ? 'glb' : fmt}`, bytes, fmt === 'glb' || fmt === 'gltf' ? 'model/gltf-binary' : 'application/octet-stream')
      log(`exported ${fmt} (${bytes.byteLength} bytes)`)
      setStatus(`exported ${fmt} ✓`, 'ok')
    } else if (lastBytes) {
      download(`matador-variant.glb`, lastBytes, 'model/gltf-binary')
      log(`downloaded current GLB`)
    }
  } catch (err) {
    setStatus('export failed', 'err')
    log(`export failed: ${err.message}`)
  }
}

// ---------------- mode switching ----------------
function setMode(m) {
  mode = m
  el.modeLive.classList.toggle('active', m === 'live')
  el.modeOffline.classList.toggle('active', m === 'offline')
  el.variantsBlock.style.display = m === 'offline' ? '' : 'none'
  enableExports(!!(lastBytes || (m === 'live' && engine)))
}

// ---------------- boot ----------------
function boot() {
  initViewer()
  buildSliders()
  renderChecks(currentValues)

  const saved = localStorage.getItem(TOKEN_KEY) || ''
  if (saved) el.token.value = saved

  el.connect.addEventListener('click', connectLive)
  el.token.addEventListener('keydown', (e) => e.key === 'Enter' && connectLive())

  el.modeLive.addEventListener('click', () => {
    if (engine) setMode('live')
    else connectLive()
  })
  el.modeOffline.addEventListener('click', () => {
    setMode('offline')
    el.overlay.classList.remove('hidden')
    if (offlineIndex >= 0) selectVariant(offlineIndex)
  })

  el.dlGlb.addEventListener('click', () => handleDownload('gltf'))
  el.dlStep.addEventListener('click', () => handleDownload('step'))
  el.dlStl.addEventListener('click', () => handleDownload('stl'))

  // overlay CTA
  const cta = document.createElement('button')
  cta.className = 'btn btn-primary'
  cta.textContent = 'Connect with token →'
  cta.addEventListener('click', connectLive)
  el.overlayActions.appendChild(cta)

  // auto-load offline variants (works with no credentials at all)
  loadOfflineVariants().then(() => {
    if (offlineVariants.length) {
      setMode('offline')
      el.overlay.classList.add('hidden')
    } else {
      setMode('offline')
    }
  })
}

boot()
