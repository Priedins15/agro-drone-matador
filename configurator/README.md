# Agrofloat Configurator

A browser-based 3D configurator for the Agrofloat agricultural spray drone. It has
two modes:

| Mode | How it works | Needs a token? |
| --- | --- | --- |
| **Live engine** | Sends the bundled KCL project to the Zoo Engine API over its Modeling WebSocket, re-runs it on every slider change, and loads the exported GLB into a Three.js viewer. Exports the *current* scene as GLB / STEP / STL. | Yes |
| **Offline variants** | Loads pre-built GLB models generated ahead of time by `scripts/build_variants.mjs`. No network, no token. | No |

## Run it

```bash
# from the repo root — any static server works
npx serve .          # or: python -m http.server 8000
# then open http://localhost:3000 (or http://localhost:8000)
```

`configurator/` must be served from the repo root (or another directory that also
serves `node_modules`/CDN imports — the app imports Three.js and `@msgpack/msgpack`
from `cdn.jsdelivr.net` via an import map, so a plain static server is enough).

## Live mode

1. Open the configurator.
2. Paste a **Zoo API token** into the field and press **Connect** (or hit Enter).
3. Drag the sliders — every change re-executes the bundled KCL on the Engine and
   swaps the GLB. The **Design check** panel evaluates the resulting geometry in
   real time (boom wall thickness, prop-tip clearance, footprint).
4. Use **Export** to download the current scene as GLB, STEP, or STL.

Token safety: your token is only ever stored in the browser's `localStorage`
(key `agrofloat-zoo-api-token`) and is only sent to `api.zoo.dev`. It is never
hard-coded and never committed to the repository.

## Offline mode

Pre-built variants live in `configurator/models/` and are described by
`configurator/models/index.json`. If the folder is empty, run:

```bash
export ZOO_API_TOKEN="<your token>"
npm install
npm run build:variants
```

This executes the bundled KCL for a small sweep of parameter sets (standard,
compact, long-range, heavy boom, light boom) and writes one GLB per variant plus
`index.json`. Each exported GLB stays a static file — no Engine round-trip needed
to view it.

> If you regenerate models, the configurator automatically picks up the new
> manifest (fetched with `cache: 'no-store'`).

## How the live mode reaches the Zoo Engine

Everything goes through one Modeling WebSocket
(`wss://api.zoo.dev/ws/modeling/commands`):

1. **Authenticate** — browsers can't set WebSocket headers, so Zoo accepts an
   explicit `{type: 'headers', headers: {Authorization: 'Bearer <token>'}}`
   frame right after `open`.
2. **`execute_kcl`** — the whole KCL project is pre-bundled into a single string
   (`configurator/js/kcl-bundle.js`) by `scripts/bundle-kcl.mjs`, then sent as
   `{type:'modeling_cmd_req', cmd_id:<uuid>, cmd:{type:'execute_kcl', code, project_settings:{...}}}`.
3. **`scene_get_entity_ids`** — filter `['solid3d']` to collect the solid bodies.
4. **`export`** — `{type:'gltf', storage:'embedded'}` returns a binary MsgPack
   payload whose `files[0].contents` byte array is the GLB.

The exact command/response shapes, plus notes on the quirks we hit, are documented
in [`docs/API_FEEDBACK.md`](../docs/API_FEEDBACK.md).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell, import map (Three.js + msgpack from CDN) |
| `css/style.css` | Dark viewer layout |
| `js/app.js` | Orchestration: viewer, sliders, live/offline switching, exports |
| `js/params.js` | Slider definitions, KCL param injection, design checks |
| `js/zoo-engine-client.js` | WebSocket client for the Zoo Engine API |
| `js/kcl-bundle.js` | **Generated** single-file KCL (run `npm run bundle:kcl`) |
| `models/*.glb`, `models/index.json` | **Generated** offline variants (run `npm run build:variants`) |
