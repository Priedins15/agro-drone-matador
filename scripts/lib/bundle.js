// Shared KCL project bundler.
// Flattens the multi-file KCL project into a single, self-contained string
// that can be executed with one `execute_kcl` command on the Zoo Modeling
// WebSocket (the engine does not have our other .kcl files on disk).
//
// Rules implemented:
//   - `import X from "file.kcl"`   -> inline file, rewrite its `export X =` to `X =`
//   - `import a, b from "file.kcl"`-> inline file, strip `export` (names kept)
//   - `import * from "file.kcl"`   -> inline file, strip `export` (names kept)
//   - `import allBodies as Y ...`  -> inline file, rewrite `export allBodies` to `Y`
//   - each dependency is inlined exactly ONCE (dedupe), in dependency order
//   - only the entrypoint keeps its @settings line
//
// Used by scripts/bundle-kcl.mjs (browser bundle) and
// scripts/build_variants.mjs (GLB variant pipeline).

import fs from 'node:fs'
import path from 'node:path'

const IMPORT_RE = /^\s*import\s+(.+?)\s+from\s+["']([^"']+\.kcl)["']\s*$/

export function parseImport(line) {
  const m = line.match(IMPORT_RE)
  if (!m) return null
  return { targets: m[1].trim(), file: m[2] }
}

export function splitImportTargets(targets) {
  // "allBodies as tankSet" -> { allBodies: "tankSet" }
  // "escCase, escTopPlate" -> { escCase: "escCase", escTopPlate: "escTopPlate" }
  // "*"                     -> "*"
  if (targets === '*') return '*'
  const map = {}
  for (const part of targets.split(',')) {
    const t = part.trim()
    if (!t) continue
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/)
    if (m) map[m[1]] = m[2]
    else map[t] = t
  }
  return map
}

export function stripExport(line) {
  // remove "export " keyword from an `export name = ...` line
  return line.replace(/^(\s*)export\s+/, '$1')
}

export function renameExport(line, exportName, newName) {
  // rewrite `export <exportName> = ...` -> `<newName> = ...`
  const re = new RegExp(`^(\\s*)export\\s+${exportName}\\s*=`)
  return line.replace(re, `$1${newName} =`)
}

// Read project sources (all .kcl files in the project root).
export function loadSources(rootDir) {
  const names = fs
    .readdirSync(rootDir)
    .filter((f) => f.endsWith('.kcl'))
    .sort()
  const sources = new Map()
  for (const name of names) {
    sources.set(name, fs.readFileSync(path.join(rootDir, name), 'utf8'))
  }
  return sources
}

// Bundle the project reachable from `entry`.
export function bundleProject(rootDir, entry = 'main.kcl', override = {}) {
  const sources = loadSources(rootDir)
  if (override && typeof override === 'object') {
    for (const [name, code] of Object.entries(override)) {
      if (typeof code === 'string' && sources.has(name)) sources.set(name, code)
    }
  }

  const inlined = new Set() // module files already emitted (canonical name recorded)
  const canonicalName = new Map() // moduleFile -> top-level binding name it was inlined under
  const parts = [] // ordered output chunks
  const emittedAliases = new Set()

  const emitAliasIfNeeded = (moduleFile, binding) => {
    if (binding === '*') return
    const canon = canonicalName.get(moduleFile)
    if (canon === undefined) return
    if (binding === canon) return
    const key = `${moduleFile}::${binding}`
    if (emittedAliases.has(key)) return
    emittedAliases.add(key)
    parts.push(`// alias: ${moduleFile} -> ${binding}`)
    parts.push(`const ${binding} = ${canon}`)
  }

  const inlineModule = (file) => {
    const code = sources.get(file)
    if (code === undefined) {
      throw new Error(`bundle: cannot resolve import target "${file}"`)
    }

    const lines = code.split('\n')
    const out = []
    const subDeps = [] // [file, importLine] discovered here

    for (const raw of lines) {
      const parsed = parseImport(raw)
      if (parsed) {
        subDeps.push(parsed)
        continue
      }
      if (raw.trimStart().startsWith('@settings')) continue // only entry keeps it
      out.push(raw)
    }

    // Dedupe sub-deps, preserving order
    const seenSub = new Set()
    for (const dep of subDeps) {
      const depFile = path.basename(dep.file)
      const key = depFile
      if (seenSub.has(key)) continue
      seenSub.add(key)
      if (inlined.has(depFile)) {
        // already inlined: emit alias lines if bindings differ
        const targets = splitImportTargets(dep.targets)
        if (targets === '*') continue
        for (const [name, binding] of Object.entries(targets)) {
          if (name !== binding) emitAliasIfNeeded(depFile, binding)
        }
        continue
      }
      inlineModule(depFile)
    }

    // Rewrite exports in this module's own body according to its FIRST
    // importer, so its top-level names are correct when it is inlined.
    parts.push(`// ===== ${file} =====`)
    let moduleBinding = undefined
    const usedImporter = moduleFirstImporter.get(file)
    const targets = usedImporter ? splitImportTargets(usedImporter.targets) : '*'

    if (targets === '*') {
      moduleBinding = '*'
      for (const line of out) {
        if (/^export\s+/.test(line)) parts.push(stripExport(line))
        else parts.push(line)
      }
    } else {
      // map of exportName -> binding
      for (const line of out) {
        if (/^export\s+/.test(line)) {
          const em = line.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/)
          const name = em ? em[1] : null
          const binding = name ? targets[name] : undefined
          if (binding) {
            if (!moduleBinding && name === 'allBodies') moduleBinding = binding
            parts.push(renameExport(line, name, binding))
          } else {
            // exported but not imported -> keep as plain binding
            parts.push(stripExport(line))
          }
        } else {
          parts.push(line)
        }
      }
    }

    inlined.add(file)
    canonicalName.set(file, moduleBinding ?? file.replace('.kcl', ''))
  }

  // Precompute which importer is the "first" for each module (DFS order).
  const moduleFirstImporter = new Map()
  const visiting = new Set()
  const visit = (file, importerTargets) => {
    if (inlined.has(file)) return
    visiting.add(file)
    const code = sources.get(file) ?? ''
    for (const raw of code.split('\n')) {
      const parsed = parseImport(raw)
      if (!parsed) continue
      const depFile = path.basename(parsed.file)
      if (visiting.has(depFile)) continue // cycle guard
      if (!moduleFirstImporter.has(depFile)) {
        moduleFirstImporter.set(depFile, parsed)
      }
      visit(depFile)
    }
    visiting.delete(file)
  }
  // entry's imports are the first importers of their targets:
  const entryCode = sources.get(entry) ?? ''
  for (const raw of entryCode.split('\n')) {
    const parsed = parseImport(raw)
    if (!parsed) continue
    const depFile = path.basename(parsed.file)
    if (!moduleFirstImporter.has(depFile)) moduleFirstImporter.set(depFile, parsed)
    visit(depFile)
  }

  // Now inline from entry.
  inlined.clear()
  canonicalName.clear()
  parts.length = 0
  parts.push(`// Bundled by scripts/lib/bundle.js (single-file KCL for Zoo Engine API)`)
  const entryLines = entryCode.split('\n')
  for (const raw of entryLines) {
    const parsed = parseImport(raw)
    if (parsed) {
      const depFile = path.basename(parsed.file)
      if (inlined.has(depFile)) {
        const targets = splitImportTargets(parsed.targets)
        if (targets !== '*') {
          for (const [name, binding] of Object.entries(targets)) {
            if (name !== binding) emitAliasIfNeeded(depFile, binding)
          }
        }
        continue
      }
      inlineModule(depFile)
      continue
    }
    parts.push(raw) // includes the entry @settings + body
  }

  return parts.join('\n')
}
