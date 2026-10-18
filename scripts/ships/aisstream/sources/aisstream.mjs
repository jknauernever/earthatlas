/**
 * Source: aisstream.io (docs/AISSTREAM.md). One WebSocket over the recorder's box; decoded AIS messages → ctx.ingest()
 * observations (positions) and ctx.noteStatic() (identity: msg 5 / 19 / 24). Reconnects with backoff and jitter; outages
 * are silent (the socket stays open with no data), so 120 s without a message forces a reconnect.
 * Needs AISSTREAM_API_KEY; without it this source doesn't start.
 */
import WebSocket from 'ws'

const STALE_MS = 120_000
const POSITION = new Set(['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'])
const parseTime = (s) => { const [d, t] = s.split(' '); return new Date(`${d}T${t.slice(0, 12)}Z`) }   // "2026-10-17 23:55:51.313911604 +0000 UTC"

let ws = null, attempt = 0, connectedAt = 0, stopping = false, staleTimer = null

export function start(ctx) {
  const KEY = process.env.AISSTREAM_API_KEY
  if (!KEY) { ctx.log('aisstream: no AISSTREAM_API_KEY, source off'); return }
  const { BOX, log } = ctx
  const h = (ctx.health.aisstream = { connected: false, lastMessageAt: null, reconnects: 0 })
  const SUBSCRIPTION = {
    APIKey: KEY,
    BoundingBoxes: [[[BOX.s, BOX.w], [BOX.n, BOX.e]]],
    FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData', 'StaticDataReport'],
  }
  const onMessage = (buf) => {
    let j
    try { j = JSON.parse(buf.toString('utf8')) } catch { return }
    const type = j.MessageType
    if (type === 'SubscriptionConfirmation') { log('aisstream: subscribed; compression', j.Message?.CompressionEnabled); return }
    const b = j.Message?.[type]
    const md = j.MetaData
    if (!b || !md?.time_utc) return
    const t = parseTime(md.time_utc)
    if (Number.isNaN(+t)) return
    ctx.activity('aisstream')
    h.lastMessageAt = new Date().toISOString()
    const mmsi = b.UserID
    if (type !== 'PositionReport' && type !== 'StandardClassBPositionReport' && mmsi >= 100_000_000 && mmsi <= 999_999_999) ctx.noteStatic(type, b, mmsi)
    if (!POSITION.has(type)) return
    ctx.ingest({ source: 'aisstream', mmsi, t, lat: b.Latitude, lon: b.Longitude, sog: b.Sog ?? null, cog: b.Cog ?? null,
      heading: b.TrueHeading >= 0 && b.TrueHeading <= 359 ? b.TrueHeading : null,
      status: type === 'PositionReport' ? b.NavigationalStatus : null, transceiver: type === 'PositionReport' ? 'A' : 'B' })
  }
  const connect = () => {
    if (stopping) return
    log('aisstream: connecting', attempt ? `(attempt ${attempt + 1})` : '')
    const sock = new WebSocket('wss://stream.aisstream.io/v0/stream', { perMessageDeflate: true })
    ws = sock
    sock.on('open', () => { connectedAt = Date.now(); h.connected = true; h.lastMessageAt = new Date().toISOString(); sock.send(JSON.stringify(SUBSCRIPTION)) })
    sock.on('message', onMessage)
    sock.on('unexpected-response', (_req, res) => log('aisstream: http', res.statusCode))
    sock.on('error', (e) => log('aisstream: socket error', e.message))
    sock.on('close', (code, reason) => {
      if (ws !== sock) return
      ws = null; h.connected = false
      if (stopping) return
      if (Date.now() - connectedAt > 5 * 60_000) attempt = 0 // a healthy stretch resets the backoff
      const wait = Math.min(60_000, 1000 * 2 ** attempt) * (0.5 + Math.random())
      attempt++; h.reconnects++
      ctx.onReconnect()
      log(`aisstream: closed ${code} ${reason.toString().slice(0, 80)}; reconnect in ${Math.round(wait / 1000)} s`)
      setTimeout(connect, wait)
    })
  }
  staleTimer = setInterval(() => {
    const last = h.lastMessageAt ? Date.parse(h.lastMessageAt) : 0
    if (ws && ws.readyState === WebSocket.OPEN && Date.now() - last > STALE_MS) {
      log(`aisstream: no data for ${Math.round((Date.now() - last) / 1000)} s; reconnecting`)
      ws.terminate()
    }
  }, 15_000)
  connect()
}

export function stop() {
  stopping = true
  clearInterval(staleTimer)
  try { ws?.close() } catch {}
}
