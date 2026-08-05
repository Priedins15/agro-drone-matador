// Zoo Engine API client (Modeling WebSocket).
//
// Talks directly to the Zoo Engine API from the browser:
//   - connect:  wss://api.zoo.dev/ws/modeling/commands (auth via headers frame)
//   - execute_kcl (single-file bundle — see scripts/lib/bundle.js)
//   - scene_get_entity_ids -> solid3d ids
//   - export (gltf / step / stl) -> binary bytes
//
// Protocol notes (see docs/API_FEEDBACK.md §8):
//   Requests are JSON per the documented WebSocketRequest schema.
//   Most responses are JSON text; export responses are binary MsgPack.
//   We decode JSON first, then MsgPack.

import { decode } from 'https://cdn.jsdelivr.net/npm/@msgpack/msgpack@3.0.0/+esm'

const BASE = 'wss://api.zoo.dev/ws/modeling/commands'

const uuid = () => crypto.randomUUID()

function parseMessage(event) {
  const data = event.data
  if (typeof data === 'string') return JSON.parse(data)
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const text = new TextDecoder().decode(bytes)
  try {
    return JSON.parse(text)
  } catch {
    // binary payload: MsgPack-encoded WebSocketResponse
    return decode(bytes)
  }
}

export class ZooEngineClient {
  constructor(token) {
    this.token = token
    this.ws = null
    this.pending = new Map() // cmd_id -> {resolve, reject, timer}
    this.connected = false
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.connected) return resolve()
      this.ws = new WebSocket(`${BASE}?fps=30&webrtc=false&show_grid=false&post_effect=ssao`)
      this.ws.binaryType = 'arraybuffer'
      this.ws.addEventListener('open', () => {
        // Browsers cannot set headers on a WebSocket; Zoo accepts an explicit
        // auth frame right after connect.
        this.ws.send(JSON.stringify({ type: 'headers', headers: { Authorization: `Bearer ${this.token}` } }))
        this.connected = true
        resolve()
      })
      this.ws.addEventListener('error', () => reject(new Error('could not open Modeling WebSocket (check your token / network)')))
      this.ws.addEventListener('close', () => {
        this.connected = false
        this.flushPending(new Error('websocket closed'))
      })
      this.ws.addEventListener('message', (ev) => {
        let msg
        try {
          msg = parseMessage(ev)
        } catch {
          return
        }
        if (!msg || typeof msg !== 'object' || !('resp' in msg)) return
        const id = msg.request_id
        if (id && this.pending.has(id)) {
          const p = this.pending.get(id)
          this.pending.delete(id)
          clearTimeout(p.timer)
          p.resolve(msg)
        }
      })
    })
  }

  flushPending(err) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  close() {
    if (this.ws) this.ws.close()
  }

  _send(cmd, timeoutMs = 180_000) {
    return this.connect().then(() => {
      const cmdId = uuid()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(cmdId)
          reject(new Error(`engine timeout waiting for ${cmd.type}`))
        }, timeoutMs)
        this.pending.set(cmdId, { resolve, reject, timer })
        try {
          this.ws.send(JSON.stringify({ type: 'modeling_cmd_req', cmd_id: cmdId, cmd }))
        } catch (err) {
          clearTimeout(timer)
          this.pending.delete(cmdId)
          reject(err)
        }
      })
    })
  }

  // error guard: resolve the modeled command out of a response, or throw
  _data(msg) {
    const resp = msg?.resp ?? {}
    if (resp.type === 'error') {
      const e = resp.data?.error?.kind ?? 'engine_error'
      const m = resp.data?.error?.message ?? JSON.stringify(resp.data).slice(0, 300)
      throw new Error(`${e}: ${m}`)
    }
    // execute/scene commands wrap results under data.modeling_response
    const modeling = resp?.data?.modeling_response ?? resp?.data
    if (modeling?.type === 'error') {
      const m = JSON.stringify(modeling.data).slice(0, 500)
      throw new Error(`engine error: ${m}`)
    }
    return { resp, modeling }
  }

  async executeKcl(code) {
    const msg = await this._send({
      type: 'execute_kcl',
      code,
      project_settings: {
        length_unit: 'mm',
        angle_unit: 'degrees',
        base_unit: 'mm',
        import_export_units: 'mm',
      },
    })
    return this._data(msg)
  }

  async getSolidIds() {
    const msg = await this._send({ type: 'scene_get_entity_ids', filter: ['solid3d'], skip: 0, take: 2000 })
    const { modeling, resp } = this._data(msg)
    const ids = modeling?.data?.entity_ids ?? modeling?.entity_ids ?? resp?.data?.entity_ids ?? []
    return Array.isArray(ids) ? ids.flat() : []
  }

  async export(ids, format) {
    const msg = await this._send({ type: 'export', entity_ids: ids, format })
    const { modeling, resp } = this._data(msg)
    const files = modeling?.data?.files ?? resp?.data?.files ?? modeling?.files ?? []
    if (!files.length) throw new Error('export returned no files')
    const contents = files[0].contents
    const arr = contents instanceof Uint8Array ? contents : Uint8Array.from(contents ?? [])
    return arr
  }

  async exportGltf(ids) {
    return this.export(ids, { type: 'gltf', storage: 'embedded' })
  }
  async exportStep(ids) {
    return this.export(ids, { type: 'step', units: 'mm' })
  }
  async exportStl(ids) {
    return this.export(ids, { type: 'stl', units: 'mm' })
  }
}
