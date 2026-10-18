/**
 * aisstream.io recorder for /ships (docs/AISSTREAM_RECORDER_PLAN.md, docs/AISSTREAM.md).
 *
 * Holds ONE aisstream WebSocket over the salish-v6 box and writes NOAA MarineCadastre-shaped position rows:
 *   DATA_DIR/raw/YYYY-MM-DD/HH.ndjson.gz        one hour of rows (the current hour is HH.ndjson, appended every few seconds)
 *   DATA_DIR/raw/YYYY-MM-DD/HH.coverage.json    per-minute message counts (0 = not receiving that minute) + hour stats
 *   DATA_DIR/points/YYYY-MM-DD.parquet          after the UTC day ends: compact.py → same columns/types as
 *                                               scripts/ships/bake-ais/cache/points/salish-v6/YYYY-MM-DD.parquet
 *   DATA_DIR/points/index.json                  per-day coverage (recorded minutes, rows, vessels)
 *   DATA_DIR/identity.json                      last static data per MMSI (msg 5 / 19 / 24), so restarts keep names
 *   DATA_DIR/tracks/YYYY-MM-DD/*.pack           /ships track packs (daypack.py): today's rebuilt each hour as tracks-HHMM.pack
 *                                               (a new name each time, so no cached copy is ever read against a newer index),
 *                                               the finished day once as tracks.pack; index in DATA_DIR/tracks/index.json, uploaded
 *                                               with the packs to TRACKS_PREFIX for api/ship-tracks.js
 *   DATA_DIR/live.json                          every 60 s: each ship's latest position (last 24 h) + a 30-min trail for
 *                                               ships reported in the last 30 min; uploaded to LIVE_PATH for /whalewatch's LIVE
 *
 * Rules (NOAA-like): at most one row per MMSI per UTC minute (the first); 9-digit MMSIs only; valid, non-0,0 positions
 * inside the box; static fields come from the latest static message seen for that MMSI; heading 511 → null.
 *
 * Uploads (optional): when CRON_SECRET is set, finished day Parquet files, index.json and status.json go to Blob under
 * BLOB_PREFIX through api/cron/ships-upload-token.js (one-file tokens; the recorder never holds the Blob write token).
 * Uploads retry on every daily check, so days recorded before the endpoint allowed this prefix upload later.
 *
 * Env: AISSTREAM_API_KEY (required), DATA_DIR (./data), CRON_SECRET, UPLOAD_TOKEN_URL, BLOB_PREFIX,
 *      ROTATE_SECONDS (3600; a smaller value only for local tests), RAW_KEEP_DAYS (30), PYTHON (python3)
 * Run:  AISSTREAM_API_KEY=… node recorder.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KEY = process.env.AISSTREAM_API_KEY
if (!KEY) { console.error('AISSTREAM_API_KEY is required'); process.exit(1) }
const DATA = path.resolve(process.env.DATA_DIR || path.join(HERE, 'data'))
const CRON_SECRET = process.env.CRON_SECRET || ''
const TOKEN_URL = process.env.UPLOAD_TOKEN_URL || 'https://earthatlas.org/api/cron/ships-upload-token'
const BLOB_PREFIX = process.env.BLOB_PREFIX || 'ships/bake-inputs/salish-v6/aisstream'
const ROTATE_S = Number(process.env.ROTATE_SECONDS || 3600)
const RAW_KEEP_DAYS = Number(process.env.RAW_KEEP_DAYS || 30)
const PYTHON = process.env.PYTHON || 'python3'
const TRACKS_PREFIX = process.env.TRACKS_PREFIX || 'ships/tracks/aisstream-v1'
const LIVE_PATH = process.env.LIVE_PATH || 'ships/live/salish-v6.json'
const LIVE_EVERY_MS = 60_000, LIVE_KEEP_S = 24 * 3600, TRAIL_S = 30 * 60
// salish-v6 (scripts/ships/bake-ais/region.py): W -126.2 S 47.0 E -122.05 N 49.6. aisstream corners are [lat, lon].
const BOX = { w: -126.2, s: 47.0, e: -122.05, n: 49.6 }
const SUBSCRIPTION = {
  APIKey: KEY,
  BoundingBoxes: [[[BOX.s, BOX.w], [BOX.n, BOX.e]]],
  FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData', 'StaticDataReport'],
}
const STALE_MS = 120_000 // outages are silent: the socket stays open with no data (docs/AISSTREAM.md)
const FLUSH_MS = 5_000

const log = (...a) => console.log(new Date().toISOString(), ...a)
fs.mkdirSync(path.join(DATA, 'raw'), { recursive: true })
fs.mkdirSync(path.join(DATA, 'points'), { recursive: true })

// ── Identity (latest static data per MMSI) ────────────────────────────────────
const IDENTITY_FILE = path.join(DATA, 'identity.json')
const identity = new Map()
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8')))) identity.set(Number(k), v) } catch {}
function saveIdentity() {
  fs.writeFileSync(IDENTITY_FILE + '.tmp', JSON.stringify(Object.fromEntries(identity)))
  fs.renameSync(IDENTITY_FILE + '.tmp', IDENTITY_FILE)
}
const str = (s) => (typeof s === 'string' && s.replace(/@+$/g, '').trim()) || null // AIS pads text with spaces / '@'
const dims = (d) => (d && d.A + d.B > 0 ? { length: d.A + d.B, width: d.C + d.D > 0 ? d.C + d.D : null } : {})
function noteStatic(type, b, mmsi) {
  const id = identity.get(mmsi) || {}
  if (type === 'ShipStaticData') {
    Object.assign(id, { vessel_name: str(b.Name), imo: b.ImoNumber > 0 ? `IMO${b.ImoNumber}` : null, call_sign: str(b.CallSign),
      vessel_type: b.Type || null, draft: b.MaximumStaticDraught > 0 ? b.MaximumStaticDraught : null, ...dims(b.Dimension) })
  } else if (type === 'StaticDataReport') {
    if (!b.PartNumber && b.ReportA?.Valid) id.vessel_name = str(b.ReportA.Name) || id.vessel_name || null
    if (b.PartNumber && b.ReportB?.Valid) Object.assign(id, { vessel_type: b.ReportB.ShipType || id.vessel_type || null, call_sign: str(b.ReportB.CallSign) || id.call_sign || null, ...dims(b.ReportB.Dimension) })
  } else if (type === 'ExtendedClassBPositionReport') {
    Object.assign(id, { vessel_name: str(b.Name) || id.vessel_name || null, vessel_type: b.Type || id.vessel_type || null, ...dims(b.Dimension) })
  }
  id.seen = Date.now()
  identity.set(mmsi, id)
}

// ── Hour files ────────────────────────────────────────────────────────────────
// Files are keyed by RECEIVE time (UTC), so a late message never reopens a closed file. A row stamped just before
// midnight can land in the next day's 00 file; compact.py reads that file too and keeps rows by base_date_time.
// In test mode (ROTATE_SECONDS < 3600) the "hour" is a ROTATE_SECONDS slot of the day, named by its 4-digit index.
const slotKey = (d) => {
  const day = d.toISOString().slice(0, 10)
  if (ROTATE_S >= 3600) return { day, hh: d.toISOString().slice(11, 13) }
  const secs = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()
  return { day, hh: String(Math.floor(secs / ROTATE_S)).padStart(4, '0') }
}
let cur = null // { day, hh, rows: [], coverage }
const seenMinute = new Map() // mmsi → 'YYYY-MM-DD HH:MM' of its last kept row
const newCoverage = () => ({ minutesMsgs: Array(60).fill(0), msgs: 0, rows: 0, dupDropped: 0, invalidDropped: 0, reconnects: 0, firstMsg: null, lastMsg: null })
const hourDir = (day) => path.join(DATA, 'raw', day)
function writeCoverage(c = cur) {
  if (!c) return
  fs.mkdirSync(hourDir(c.day), { recursive: true })
  fs.writeFileSync(path.join(hourDir(c.day), `${c.hh}.coverage.json`), JSON.stringify(c.coverage))
}
function flush() {
  if (!cur) return
  fs.mkdirSync(hourDir(cur.day), { recursive: true })
  if (cur.rows.length) fs.appendFileSync(path.join(hourDir(cur.day), `${cur.hh}.ndjson`), cur.rows.join('\n') + '\n')
  cur.rows = []
  writeCoverage()
}
function closeHour(c) {
  // NDJSON → gzip, then drop the plain file. Safe to call on a leftover file after a crash.
  const plain = path.join(hourDir(c.day), `${c.hh}.ndjson`)
  if (fs.existsSync(plain)) {
    // An hour reopened after a restart already has a .gz: keep its rows ahead of the new ones.
    const prev = fs.existsSync(plain + '.gz') ? zlib.gunzipSync(fs.readFileSync(plain + '.gz')) : Buffer.alloc(0)
    fs.writeFileSync(plain + '.gz.tmp', zlib.gzipSync(Buffer.concat([prev, fs.readFileSync(plain)])))
    fs.renameSync(plain + '.gz.tmp', plain + '.gz')
    fs.unlinkSync(plain)
  }
}
function rollTo(day, hh) {
  if (cur && cur.day === day && cur.hh === hh) return
  if (cur) { flush(); closeHour(cur); saveIdentity(); saveLatest() }
  // Resume an hour's coverage if we restarted inside it.
  let coverage = newCoverage()
  try { coverage = { ...coverage, ...JSON.parse(fs.readFileSync(path.join(hourDir(day), `${hh}.coverage.json`), 'utf8')) } } catch {}
  cur = { day, hh, rows: [], coverage }
}
// Leftover plain files from a crash (any hour that isn't the one we're about to write) get gzipped at start.
for (const day of fs.readdirSync(path.join(DATA, 'raw'))) {
  for (const f of fs.readdirSync(hourDir(day))) if (f.endsWith('.ndjson')) {
    const now = slotKey(new Date())
    const hh = f.replace('.ndjson', '')
    if (!(day === now.day && hh === now.hh)) closeHour({ day, hh })
  }
}

// ── Messages → rows ───────────────────────────────────────────────────────────
// Latest position per MMSI for the live snapshot (last LIVE_KEEP_S), with its last TRAIL_S of kept rows.
const latest = new Map()
const LATEST_FILE = path.join(DATA, 'latest.json')   // saved hourly and on exit, so a restart keeps the live view
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(LATEST_FILE, 'utf8')))) latest.set(Number(k), v) } catch {}
function saveLatest() {
  fs.writeFileSync(LATEST_FILE + '.tmp', JSON.stringify(Object.fromEntries(latest)))
  fs.renameSync(LATEST_FILE + '.tmp', LATEST_FILE)
}
const round5 = (x) => Math.round(x * 1e5) / 1e5
const POSITION = new Set(['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'])
function parseTime(s) { // "2026-10-17 23:55:51.313911604 +0000 UTC"
  const [d, t] = s.split(' ')
  return new Date(`${d}T${t.slice(0, 12)}Z`)
}
function onMessage(buf) {
  let j
  try { j = JSON.parse(buf.toString('utf8')) } catch { return }
  const type = j.MessageType
  if (type === 'SubscriptionConfirmation') { log('subscribed; compression', j.Message?.CompressionEnabled); return }
  const b = j.Message?.[type]
  const md = j.MetaData
  if (!b || !md?.time_utc) return
  const t = parseTime(md.time_utc)
  if (Number.isNaN(+t)) return
  const now = new Date()
  const { day, hh } = slotKey(now)
  rollTo(day, hh)
  const c = cur.coverage
  const nowIso = now.toISOString()
  c.msgs++; c.firstMsg ||= nowIso; c.lastMsg = nowIso
  const secOfDay = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()
  c.minutesMsgs[ROTATE_S >= 3600 ? now.getUTCMinutes() : Math.min(59, Math.floor(((secOfDay % ROTATE_S) * 60) / ROTATE_S))]++
  lastMessageAt = Date.now()
  const mmsi = b.UserID
  if (!(mmsi >= 100_000_000 && mmsi <= 999_999_999)) { c.invalidDropped++; return }
  if (type !== 'PositionReport' && type !== 'StandardClassBPositionReport') noteStatic(type, b, mmsi)
  if (!POSITION.has(type)) return
  const lat = b.Latitude, lon = b.Longitude
  if (!(lat >= BOX.s && lat <= BOX.n && lon >= BOX.w && lon <= BOX.e) || (lat === 0 && lon === 0)) { c.invalidDropped++; return }
  const minute = t.toISOString().slice(0, 16)
  if (seenMinute.get(mmsi) === minute) { c.dupDropped++; return }
  seenMinute.set(mmsi, minute)
  const id = identity.get(mmsi) || {}
  const row = {
    mmsi,
    base_date_time: t.toISOString().slice(0, 19).replace('T', ' '),
    longitude: lon, latitude: lat,
    sog: b.Sog ?? null, cog: b.Cog ?? null,
    heading: b.TrueHeading >= 0 && b.TrueHeading <= 359 ? b.TrueHeading : null,
    vessel_name: id.vessel_name ?? null, imo: id.imo ?? null, call_sign: id.call_sign ?? null,
    vessel_type: id.vessel_type ?? null,
    status: type === 'PositionReport' ? b.NavigationalStatus : null,
    length: id.length ?? null, width: id.width ?? null, draft: id.draft ?? null,
    cargo: null,
    transceiver: type === 'PositionReport' ? 'A' : 'B',
  }
  cur.rows.push(JSON.stringify(row))
  c.rows++
  const ts = Math.floor(+t / 1000)
  const prev = latest.get(mmsi)
  const trail = prev && ts - prev.t <= TRAIL_S ? prev.trail : []
  trail.push([round5(lon), round5(lat), ts])
  while (trail.length && ts - trail[0][2] > TRAIL_S) trail.shift()
  latest.set(mmsi, { t: ts, lon: round5(lon), lat: round5(lat), sog: row.sog, cog: row.cog, heading: row.heading, status: row.status, cls: row.transceiver, trail })
}

// ── Connection with backoff + stale detection ─────────────────────────────────
let ws = null, lastMessageAt = 0, attempt = 0, connectedAt = 0, stopping = false
function connect() {
  if (stopping) return
  log('connecting', attempt ? `(attempt ${attempt + 1})` : '')
  const sock = new WebSocket('wss://stream.aisstream.io/v0/stream', { perMessageDeflate: true })
  ws = sock
  sock.on('open', () => { connectedAt = Date.now(); lastMessageAt = Date.now(); sock.send(JSON.stringify(SUBSCRIPTION)) })
  sock.on('message', onMessage)
  sock.on('unexpected-response', (_req, res) => log('http', res.statusCode))
  sock.on('error', (e) => log('socket error', e.message))
  sock.on('close', (code, reason) => {
    if (ws !== sock) return
    ws = null
    if (stopping) return
    if (Date.now() - connectedAt > 5 * 60_000) attempt = 0 // a healthy stretch resets the backoff
    const wait = Math.min(60_000, 1000 * 2 ** attempt) * (0.5 + Math.random())
    attempt++
    if (cur) cur.coverage.reconnects++
    log(`closed ${code} ${reason.toString().slice(0, 80)}; reconnect in ${Math.round(wait / 1000)} s`)
    setTimeout(connect, wait)
  })
}
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMessageAt > STALE_MS) {
    log(`no data for ${Math.round((Date.now() - lastMessageAt) / 1000)} s; reconnecting`)
    ws.terminate()
  }
}, 15_000)

// ── Flush, status, daily compaction + uploads ────────────────────────────────
setInterval(flush, FLUSH_MS)
setInterval(() => {
  // Close the hour on the clock too, so a quiet stretch doesn't leave last hour's file open.
  const now = slotKey(new Date())
  if (cur && (cur.day < now.day || (cur.day === now.day && cur.hh < now.hh))) { flush(); closeHour(cur); saveIdentity(); cur = null }
  // Forget per-minute dedupe keys older than 2 minutes (the map would otherwise grow without bound).
  const keep = new Date(Date.now() - 120_000).toISOString().slice(0, 16)
  for (const [k, m] of seenMinute) if (m < keep) seenMinute.delete(k)
}, 30_000)

function status() {
  const s = { updated: new Date().toISOString(), connected: !!(ws && ws.readyState === WebSocket.OPEN), lastMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
    currentHour: cur ? { day: cur.day, hh: cur.hh, msgs: cur.coverage.msgs, rows: cur.coverage.rows, minutesReceiving: cur.coverage.minutesMsgs.filter(Boolean).length } : null,
    identities: identity.size, box: BOX }
  fs.writeFileSync(path.join(DATA, 'status.json'), JSON.stringify(s, null, 1))
  return s
}
setInterval(() => { const s = status(); log('status', JSON.stringify(s.currentHour), 'identities', s.identities) }, 10 * 60_000)

async function tokenFor(pathname) {
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { authorization: `Bearer ${CRON_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify({ pathname }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.token) throw new Error(`upload token for ${pathname}: ${r.status} ${j.error || ''}`)
  return j.token
}
async function upload(pathname, body, contentType) {
  const { put } = await import('@vercel/blob/client')
  return (await put(pathname, body, { access: 'public', token: await tokenFor(pathname), contentType })).url
}
const run = (cmd, args) => new Promise((ok, fail) => execFile(cmd, args, { maxBuffer: 1 << 20 }, (e, out, err) => (e ? fail(new Error(`${e.message}\n${err}`)) : ok(out))))

// ── Live snapshot (every 60 s) ────────────────────────────────────────────────
// Compact: ships = [mmsi, t, lon, lat, sog, cog, heading, status, cls, name, vessel_type, length]; trails = { mmsi: [[lon, lat, t], …] }.
let liveToken = null, liveTokenAt = 0
function liveSnapshot() {
  const now = Math.floor(Date.now() / 1000)
  const ships = [], trails = {}
  for (const [mmsi, p] of latest) {
    if (now - p.t > LIVE_KEEP_S) { latest.delete(mmsi); continue }
    const id = identity.get(mmsi) || {}
    ships.push([mmsi, p.t, p.lon, p.lat, p.sog, p.cog, p.heading, p.status, p.cls, id.vessel_name ?? null, id.vessel_type ?? null, id.length ?? null])
    // Trails only for ships under way (≥ 1 kn at their last report): /whalewatch draws trails only for moving boats.
    const tr = (p.sog ?? 0) >= 1 ? p.trail.filter((q) => now - q[2] <= TRAIL_S) : []
    if (tr.length >= 2) trails[mmsi] = tr
  }
  return { version: 'aisstream-live-v1', source: 'aisstream.io', sourceUrl: 'https://aisstream.io', box: BOX,
    generated: new Date().toISOString(), lastMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
    connected: !!(ws && ws.readyState === WebSocket.OPEN),
    fields: ['mmsi', 't', 'lon', 'lat', 'sog', 'cog', 'heading', 'status', 'cls', 'name', 'vessel_type', 'length'], ships, trails }
}
let liveBusy = false, lastLiveError = '', liveErrorRepeats = 0
async function publishLive() {
  if (liveBusy) return
  liveBusy = true
  try {
    const body = JSON.stringify(liveSnapshot())
    fs.writeFileSync(path.join(DATA, 'live.json.tmp'), body)
    fs.renameSync(path.join(DATA, 'live.json.tmp'), path.join(DATA, 'live.json'))
    if (CRON_SECRET) {
      // One token per hour (tokens last 2 h), not one per upload.
      if (!liveToken || Date.now() - liveTokenAt > 60 * 60_000) { liveToken = await tokenFor(LIVE_PATH); liveTokenAt = Date.now() }
      const { put } = await import('@vercel/blob/client')
      await put(LIVE_PATH, body, { access: 'public', token: liveToken, contentType: 'application/json' })   // overwrite + 60 s cache are set on the token (api/cron/ships-upload-token.js)
      if (lastLiveError) log('live publish ok again')
      lastLiveError = ''; liveErrorRepeats = 0
    }
  } catch (e) {
    liveToken = null
    const msg = e.message.slice(0, 160)
    if (msg !== lastLiveError || ++liveErrorRepeats % 60 === 0) log('live publish failed', msg, liveErrorRepeats > 1 ? `(x${liveErrorRepeats})` : '')
    if (msg !== lastLiveError) liveErrorRepeats = 1
    lastLiveError = msg
    liveBusy = false
    return
  }
  liveBusy = false
}
setInterval(publishLive, LIVE_EVERY_MS)

// ── Track packs: today's every hour, a finished day once ─────────────────────
let packBusy = false
async function buildPack(day, final) {
  const name = final ? 'tracks.pack' : `tracks-${new Date().toISOString().slice(11, 16).replace(':', '')}.pack`
  const out = await run(PYTHON, [path.join(HERE, 'daypack.py'), DATA, day, final ? 'final' : 'partial', name])
  log('pack', day, out.trim().slice(0, 200))
  if (!CRON_SECRET) return
  const idxPath = path.join(DATA, 'tracks', 'index.json')
  const url = await upload(`${TRACKS_PREFIX}/${day}/${name}`, fs.readFileSync(path.join(DATA, 'tracks', day, name)), 'application/octet-stream')
  const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'))
  idx.days[day].pack = url
  fs.writeFileSync(idxPath, JSON.stringify(idx, null, 1))
  await upload(`${TRACKS_PREFIX}/index.json`, JSON.stringify(idx), 'application/json')
  // Older hourly packs of this day stay on the volume only as long as needed: keep the newest file.
  for (const f of fs.readdirSync(path.join(DATA, 'tracks', day))) if (f !== name && f.endsWith('.pack')) fs.rmSync(path.join(DATA, 'tracks', day, f), { force: true })
}
async function packToday() {
  if (packBusy) return
  packBusy = true
  try { await buildPack(new Date().toISOString().slice(0, 10), false) } catch (e) { log('pack failed', e.message.slice(0, 300)) }
  packBusy = false
}
let lastPackHour = null
setInterval(() => { const h = new Date().toISOString().slice(0, 13); if (h !== lastPackHour && new Date().getUTCMinutes() >= 2) { lastPackHour = h; packToday() } }, 60_000)

let dailyBusy = false
async function daily() {
  if (dailyBusy) return
  dailyBusy = true
  try {
    const today = new Date().toISOString().slice(0, 10)
    const pointsDir = path.join(DATA, 'points')
    // 1. compact every finished day that has raw hours but no Parquet yet
    for (const day of fs.readdirSync(path.join(DATA, 'raw')).sort()) {
      if (day >= today || fs.existsSync(path.join(pointsDir, `${day}.parquet`))) continue
      // Wait until the next day's first file is closed (it can hold this day's last rows).
      if (Date.now() - Date.parse(`${day}T00:00:00Z`) < (24 * 3600 + Math.max(ROTATE_S, 60) + 300) * 1000) continue
      const out = await run(PYTHON, [path.join(HERE, 'compact.py'), DATA, day])
      log('compacted', day, out.trim())
    }
    // 1b. final track pack for every compacted day whose pack is missing, not final, or not uploaded yet (retries daily)
    let tIdx = {}
    try { tIdx = JSON.parse(fs.readFileSync(path.join(DATA, 'tracks', 'index.json'), 'utf8')).days || {} } catch {}
    for (const f of fs.readdirSync(pointsDir).filter((f) => f.endsWith('.parquet')).sort()) {
      const day = f.slice(0, 10)
      const e = tIdx[day]
      if (e?.final && (e.pack || !CRON_SECRET)) continue
      try { await buildPack(day, true) } catch (err) { log('final pack failed', day, err.message.slice(0, 300)) }
    }
    // 2. upload days not yet uploaded, then index.json
    if (CRON_SECRET) {
      let uploadedAny = false
      for (const f of fs.readdirSync(pointsDir).filter((f) => f.endsWith('.parquet')).sort()) {
        const day = f.slice(0, 10)
        if (fs.existsSync(path.join(pointsDir, `${day}.uploaded`))) continue
        try {
          const url = await upload(`${BLOB_PREFIX}/points/${f}`, fs.readFileSync(path.join(pointsDir, f)), 'application/vnd.apache.parquet')
          fs.writeFileSync(path.join(pointsDir, `${day}.uploaded`), url)
          log('uploaded', url); uploadedAny = true
        } catch (e) { log('upload failed', f, e.message.slice(0, 200)); break }
      }
      const idx = path.join(pointsDir, 'index.json')
      if (uploadedAny && fs.existsSync(idx)) await upload(`${BLOB_PREFIX}/index.json`, fs.readFileSync(idx), 'application/json').catch((e) => log('index upload failed', e.message.slice(0, 200)))
    }
    // 3. raw retention: drop raw days older than RAW_KEEP_DAYS that already have a Parquet
    const cutoff = new Date(Date.now() - RAW_KEEP_DAYS * 86400_000).toISOString().slice(0, 10)
    for (const day of fs.readdirSync(path.join(DATA, 'raw'))) {
      if (day < cutoff && fs.existsSync(path.join(pointsDir, `${day}.parquet`))) fs.rmSync(hourDir(day), { recursive: true, force: true })
    }
  } catch (e) { log('daily failed', e.message.slice(0, 300)) }
  dailyBusy = false
}
setInterval(daily, 10 * 60_000)
setInterval(() => { if (CRON_SECRET) upload(`${BLOB_PREFIX}/status.json`, JSON.stringify(status()), 'application/json').catch((e) => log('status upload failed', e.message.slice(0, 120))) }, 60 * 60_000)

function shutdown(sig) {
  if (stopping) return
  stopping = true
  log(sig, 'flushing and exiting')
  try { flush(); saveIdentity(); saveLatest(); status() } catch (e) { log('shutdown error', e.message) }
  try { ws?.close() } catch {}
  setTimeout(() => process.exit(0), 500)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

log('recorder starting; data', DATA, 'box', JSON.stringify(BOX), 'uploads', CRON_SECRET ? BLOB_PREFIX : 'off', 'identities', identity.size)
connect()
setTimeout(daily, 30_000)
