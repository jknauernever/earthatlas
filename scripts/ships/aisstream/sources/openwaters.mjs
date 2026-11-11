/**
 * Source: Open Waters AIS (https://openwaters.io/api/ais/, catalogued 2026-11-10). One WebSocket to /v1/stream over the
 * recorder's box. Open Waters merges AISHub, volunteer receivers, aisstream.io and government feeds into one deduplicated
 * stream; each event names its upstream in `source`, so rows are recorded as `openwaters/<upstream>` (e.g.
 * openwaters/aishub) and every position keeps its original provenance for inline credits. The event `message` body uses
 * the same field names as aisstream.io's (UserID, Sog, Cog, TrueHeading…), so identity goes through ctx.noteStatic().
 * Positions aisstream.io also delivers directly collapse in the core's one-row-per-MMSI-per-minute rule.
 * License: aggregate ODbL; per-upstream credits (AISHub contributors, Fintraffic/Digitraffic CC BY 4.0, …) per
 * https://openwaters.io/ais/#license. Personal token: 2 streams, 50 msgs/s per stream (excess thinned), 400 sq° of boxes.
 * Needs OPENWATERS_AIS_TOKEN; without it this source doesn't start.
 */
import WebSocket from 'ws'

const URL_ = 'wss://ais.openwaters.io/v1/stream'
const STALE_MS = 120_000
const CONNECT_MS = 30_000
const POSITION = new Set(['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'])
const STATIC = new Set(['ShipStaticData', 'StaticDataReport', 'ExtendedClassBPositionReport'])
// "station:ed25519:…" (a volunteer receiver) → "station"; "aishub" stays "aishub".
const upstreamOf = (s) => (typeof s === 'string' && s ? s.split(':')[0] : 'unknown')

let ws = null, attempt = 0, attemptAt = 0, connectedAt = 0, stopping = false, staleTimer = null

export function start(ctx) {
  const TOKEN = process.env.OPENWATERS_AIS_TOKEN
  if (!TOKEN) { ctx.log('openwaters: no OPENWATERS_AIS_TOKEN, source off'); return }
  const { BOX, log } = ctx
  const h = (ctx.health.openwaters = { connected: false, lastMessageAt: null, reconnects: 0, limits: null, upstreams: {} })
  const SUBSCRIPTION = { type: 'subscribe', bbox: [[BOX.s, BOX.w, BOX.n, BOX.e]] }   // [minLat, minLon, maxLat, maxLon]
  const onMessage = (buf) => {
    let ev
    try { ev = JSON.parse(buf.toString('utf8')) } catch { return }
    if (ev.type === 'welcome') { h.limits = ev.limits || null; log('openwaters: welcome', ev.role, JSON.stringify(ev.limits)); return }
    if (ev.type === 'ack') { log('openwaters: subscribed'); return }
    if (ev.type === 'error') { log('openwaters: error frame', JSON.stringify(ev).slice(0, 200)); return }
    if (ev.type !== 'event' || !ev.time) return
    const t = new Date(ev.time)
    if (Number.isNaN(+t)) return
    ctx.activity('openwaters')
    h.lastMessageAt = new Date().toISOString()
    const up = upstreamOf(ev.source)
    h.upstreams[up] = (h.upstreams[up] || 0) + 1
    const type = ev.msg_type, b = ev.message || {}
    const mmsi = ev.mmsi ?? b.UserID
    if (STATIC.has(type) && mmsi >= 100_000_000 && mmsi <= 999_999_999) ctx.noteStatic(type, b, mmsi)
    if (!POSITION.has(type)) return
    const lat = ev.lat ?? b.Latitude, lon = ev.lon ?? b.Longitude
    if (lat == null || lon == null) return
    ctx.ingest({ source: `openwaters/${up}`, ais: true, mmsi, t, lat, lon, sog: b.Sog ?? null, cog: b.Cog ?? null,
      heading: b.TrueHeading >= 0 && b.TrueHeading <= 359 ? b.TrueHeading : null,
      status: type === 'PositionReport' ? (b.NavigationalStatus ?? null) : null, transceiver: type === 'PositionReport' ? 'A' : 'B' })
  }
  const connect = () => {
    if (stopping) return
    log('openwaters: connecting', attempt ? `(attempt ${attempt + 1})` : '')
    const sock = new WebSocket(URL_, { headers: { Authorization: `Bearer ${TOKEN}` }, perMessageDeflate: true })
    ws = sock; attemptAt = Date.now()
    sock.on('open', () => { connectedAt = Date.now(); h.connected = true; h.lastMessageAt = new Date().toISOString(); sock.send(JSON.stringify(SUBSCRIPTION)) })
    sock.on('message', onMessage)
    sock.on('unexpected-response', (_req, res) => { log('openwaters: http', res.statusCode); sock.terminate() })
    sock.on('error', (e) => log('openwaters: socket error', e.message))
    sock.on('close', (code, reason) => {
      if (ws !== sock) return
      ws = null; h.connected = false
      if (stopping) return
      if (Date.now() - connectedAt > 5 * 60_000) attempt = 0
      const wait = Math.min(60_000, 1000 * 2 ** attempt) * (0.5 + Math.random())   // their limit: 20 connects/min
      attempt++; h.reconnects++
      log(`openwaters: closed ${code} ${reason.toString().slice(0, 80)}; reconnect in ${Math.round(wait / 1000)} s`)
      setTimeout(connect, wait)
    })
  }
  // No process-restart fallback here: aisstream.mjs owns that, and one quiet extra source shouldn't restart the recorder.
  staleTimer = setInterval(() => {
    const last = h.lastMessageAt ? Date.parse(h.lastMessageAt) : Date.now()
    if (ws && ws.readyState === WebSocket.OPEN && Date.now() - last > STALE_MS) { log('openwaters: no data; reconnecting'); ws.terminate() }
    else if (ws && ws.readyState === WebSocket.CONNECTING && Date.now() - attemptAt > CONNECT_MS) { log('openwaters: handshake hung; reconnecting'); ws.terminate() }
  }, 15_000)
  connect()
}

export function stop() {
  stopping = true
  clearInterval(staleTimer)
  try { ws?.close() } catch {}
}
