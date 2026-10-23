/**
 * aisstream.io recorder for /ships (docs/AISSTREAM_RECORDER_PLAN.md, docs/AISSTREAM.md).
 *
 * EarthAtlas's one intake for live ship positions (Josh 2026-10-18: "one place" for every live location stream). Each
 * source is a module in sources/ (aisstream.mjs: one aisstream.io WebSocket; wsf.mjs: Washington State Ferries' vessel
 * positions, polled) that turns its feed into the same observation and hands it to ingest(). From there, one pipeline for
 * all sources: at most one row per MMSI per UTC minute (whichever source it came from), the newest position per MMSI for
 * the live snapshot, one trail per MMSI, and the source on every row. Over the salish-v6 box it writes
 * NOAA MarineCadastre-shaped position rows (plus a `source` column):
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
 *   DATA_DIR/live.json                          every 60 s: each ship's latest position (last 24 h) + a 60-min trail for
 *                                               ships reported in the last 30 min; uploaded to LIVE_PATH for /whalewatch's LIVE
 *
 * Rules (NOAA-like): at most one row per MMSI per UTC minute (the first); 9-digit MMSIs only; valid, non-0,0 positions
 * inside the box; static fields come from the latest static message seen for that MMSI; heading 511 → null.
 *
 * Uploads (optional): when CRON_SECRET is set, finished day Parquet files, index.json and status.json go to Blob under
 * BLOB_PREFIX through api/cron/ships-upload-token.js (one-file tokens; the recorder never holds the Blob write token).
 * Uploads retry on every daily check, so days recorded before the endpoint allowed this prefix upload later.
 *
 * Env: AISSTREAM_API_KEY, WSDOT_ACCESS_CODE (each source starts only with its key), DATA_DIR (./data), CRON_SECRET, UPLOAD_TOKEN_URL, BLOB_PREFIX,
 *      ROTATE_SECONDS (3600; a smaller value only for local tests), RAW_KEEP_DAYS (30), PYTHON (python3)
 * Run:  AISSTREAM_API_KEY=… node recorder.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as aisstream from './sources/aisstream.mjs'
import * as wsf from './sources/wsf.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.resolve(process.env.DATA_DIR || path.join(HERE, 'data'))
const CRON_SECRET = process.env.CRON_SECRET || ''
const TOKEN_URL = process.env.UPLOAD_TOKEN_URL || 'https://earthatlas.org/api/cron/ships-upload-token'
const BLOB_PREFIX = process.env.BLOB_PREFIX || 'ships/bake-inputs/salish-v6/aisstream'
const ROTATE_S = Number(process.env.ROTATE_SECONDS || 3600)
const RAW_KEEP_DAYS = Number(process.env.RAW_KEEP_DAYS || 30)
const PYTHON = process.env.PYTHON || 'python3'
const TRACKS_PREFIX = process.env.TRACKS_PREFIX || 'ships/tracks/aisstream-v1'
const LIVE_PATH = process.env.LIVE_PATH || 'ships/live/salish-v6.json'
const LIVE_EVERY_MS = 60_000, LIVE_KEEP_S = 24 * 3600, TRAIL_S = 60 * 60   // 60 min (Josh 2026-10-23): boats aisstream.io hears only every 10–20 min still get a line
// salish-v6 (scripts/ships/bake-ais/region.py): W -126.2 S 47.0 E -122.05 N 49.6. aisstream corners are [lat, lon].
const BOX = { w: -126.2, s: 47.0, e: -122.05, n: 49.6 }
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
// Every vessel-minute already recorded in the last few minutes ('mmsi|YYYY-MM-DDTHH:MM'). A set, not just each ship's last
// minute: sources arrive out of order (WSF positions are ~30 s old on arrival, so one can land after AIS's next minute).
const seenMinute = new Set()
const newCoverage = () => ({ minutesMsgs: Array(60).fill(0), msgs: 0, rows: 0, dupDropped: 0, invalidDropped: 0, reconnects: 0, firstMsg: null, lastMsg: null, sources: {} })
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
  if (cur) { flush(); closeHour(cur); saveIdentity(); saveLatest(); saveSourceMmsis() }
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
// Extras a source attaches to a ship's newest position (e.g. a ferry's route, destination and ETA), for the live snapshot.
const extras = new Map()
// Every MMSI each source has ever reported (saved with latest.json), so a vessel keeps its identity on the map — e.g. a WSF
// ferry stays a ferry even when its newest position came from AIS (Josh 2026-10-18: ferries flipped color between sources).
const SOURCE_MMSIS_FILE = path.join(DATA, 'source-mmsis.json')
const sourceMmsis = {}
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(SOURCE_MMSIS_FILE, 'utf8')))) sourceMmsis[k] = new Set(v) } catch {}
function saveSourceMmsis() {
  fs.writeFileSync(SOURCE_MMSIS_FILE + '.tmp', JSON.stringify(Object.fromEntries(Object.entries(sourceMmsis).map(([k, v]) => [k, [...v]]))))
  fs.renameSync(SOURCE_MMSIS_FILE + '.tmp', SOURCE_MMSIS_FILE)
}
const health = {}   // source name → { …its own state } for status.json and the live snapshot

/** Count one message from a source (feeds the hour's coverage: a minute counts as recorded when any source delivered). */
function activity(source) {
  const now = new Date()
  const { day, hh } = slotKey(now)
  rollTo(day, hh)
  const c = cur.coverage
  const nowIso = now.toISOString()
  c.msgs++; c.firstMsg ||= nowIso; c.lastMsg = nowIso
  const secOfDay = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()
  c.minutesMsgs[ROTATE_S >= 3600 ? now.getUTCMinutes() : Math.min(59, Math.floor(((secOfDay % ROTATE_S) * 60) / ROTATE_S))]++
  const sc = (c.sources[source] ||= { msgs: 0, rows: 0 })
  sc.msgs++
}

/**
 * One position from any source: { source, mmsi, t: Date, lat, lon, sog, cog, heading, status, transceiver, extras? }.
 * The newest position per MMSI (any source) becomes its live position; at most one row per MMSI per minute is recorded.
 */
function ingest(o) {
  if (!cur) activity(o.source)
  const c = cur.coverage
  const { mmsi, lat, lon, t } = o
  if (!(mmsi >= 100_000_000 && mmsi <= 999_999_999) || Number.isNaN(+t)) { c.invalidDropped++; return }
  if (!(lat >= BOX.s && lat <= BOX.n && lon >= BOX.w && lon <= BOX.e) || (lat === 0 && lon === 0)) { c.invalidDropped++; return }
  if (o.source !== 'aisstream') (sourceMmsis[o.source] ||= new Set()).add(mmsi)
  const ts = Math.floor(+t / 1000)
  const prev = latest.get(mmsi)
  const minute = t.toISOString().slice(0, 16)
  const key = `${mmsi}|${minute}`
  const keep = !seenMinute.has(key)
  // Live: the newest observation wins, whichever source; its trail gets the minute's recorded position.
  if (!prev || ts >= prev.t) {
    const trail = prev && ts - prev.t <= TRAIL_S ? prev.trail : []
    if (keep) {
      trail.push([round5(lon), round5(lat), ts])
      while (trail.length && ts - trail[0][2] > TRAIL_S) trail.shift()
    }
    latest.set(mmsi, { t: ts, lon: round5(lon), lat: round5(lat), sog: o.sog ?? null, cog: o.cog ?? null, heading: o.heading ?? null,
      status: o.status ?? null, cls: o.transceiver ?? null, src: o.source, trail })
    if (o.extras) extras.set(mmsi, { ...o.extras, t: ts })
    else if (extras.get(mmsi)?.t < ts - 600) extras.delete(mmsi)
  }
  if (!keep) { c.dupDropped++; return }
  seenMinute.add(key)
  const id = identity.get(mmsi) || {}
  const row = {
    mmsi,
    base_date_time: t.toISOString().slice(0, 19).replace('T', ' '),
    longitude: lon, latitude: lat,
    sog: o.sog ?? null, cog: o.cog ?? null, heading: o.heading ?? null,
    vessel_name: id.vessel_name ?? null, imo: id.imo ?? null, call_sign: id.call_sign ?? null,
    vessel_type: id.vessel_type ?? null,
    status: o.status ?? null,
    length: id.length ?? null, width: id.width ?? null, draft: id.draft ?? null,
    cargo: null,
    transceiver: o.transceiver ?? null,
    source: o.source,
  }
  cur.rows.push(JSON.stringify(row))
  c.rows++
  c.sources[o.source] ||= { msgs: 0, rows: 0 }
  c.sources[o.source].rows++
}
/** A source's identity facts for an MMSI; only fills fields the AIS static messages haven't. */
function noteIdentity(mmsi, fields) {
  const id = identity.get(mmsi) || {}
  for (const [k, v] of Object.entries(fields)) if (v != null && id[k] == null) id[k] = v
  identity.set(mmsi, id)
}
const ctx = { BOX, log, ingest, activity, noteStatic, noteIdentity, health, onReconnect: () => { if (cur) cur.coverage.reconnects++ } }

// ── Flush, status, daily compaction + uploads ────────────────────────────────
setInterval(flush, FLUSH_MS)
setInterval(() => {
  // Close the hour on the clock too, so a quiet stretch doesn't leave last hour's file open.
  const now = slotKey(new Date())
  if (cur && (cur.day < now.day || (cur.day === now.day && cur.hh < now.hh))) { flush(); closeHour(cur); saveIdentity(); cur = null }
  // Forget vessel-minutes older than 5 minutes (the set would otherwise grow without bound).
  const keepFrom = new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 16)   // 5 minutes covers any source's lag
  for (const k of seenMinute) if (k.slice(k.indexOf('|') + 1) < keepFrom) seenMinute.delete(k)
}, 30_000)

function status() {
  const s = { updated: new Date().toISOString(), sources: health,
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
  const ships = [], trails = {}, ext = {}
  for (const [mmsi, p] of latest) {
    if (now - p.t > LIVE_KEEP_S) { latest.delete(mmsi); continue }
    const id = identity.get(mmsi) || {}
    ships.push([mmsi, p.t, p.lon, p.lat, p.sog, p.cog, p.heading, p.status, p.cls, id.vessel_name ?? null, id.vessel_type ?? null, id.length ?? null, p.src || 'aisstream'])
    const ex = extras.get(mmsi)
    if (ex && p.t - ex.t <= 600) ext[mmsi] = ex   // a ferry's route/ETA stays shown for 10 min, even if AIS has the newer fix
    // Trails only for ships under way (≥ 1 kn at their last report): /whalewatch draws trails only for moving boats.
    const tr = (p.sog ?? 0) >= 1 ? p.trail.filter((q) => now - q[2] <= TRAIL_S) : []
    if (tr.length >= 2) trails[mmsi] = tr
  }
  // lastMessageAt / connected stay aisstream's (the data watchdog reads them); every source's state is in `sources`.
  const ais = health.aisstream || {}
  return { version: 'live-v2', source: 'aisstream.io + Washington State Ferries', box: BOX,
    sourceUrls: { aisstream: 'https://aisstream.io', wsf: 'https://wsdot.wa.gov/travel/washington-state-ferries' },
    generated: new Date().toISOString(), lastMessageAt: ais.lastMessageAt || null, connected: !!ais.connected, sources: health,
    fields: ['mmsi', 't', 'lon', 'lat', 'sog', 'cog', 'heading', 'status', 'cls', 'name', 'vessel_type', 'length', 'src'], ships, trails, extras: ext,
    // vessels by source fleet (every MMSI a non-AIS source has reported), whatever source has the newest position
    fleets: Object.fromEntries(Object.entries(sourceMmsis).map(([k, v]) => [k, [...v]])) }
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

let stopping = false
function shutdown(sig) {
  if (stopping) return
  stopping = true
  log(sig, 'flushing and exiting')
  try { flush(); saveIdentity(); saveLatest(); saveSourceMmsis(); status() } catch (e) { log('shutdown error', e.message) }
  aisstream.stop?.(); wsf.stop?.()
  setTimeout(() => process.exit(0), 500)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

log('recorder starting; data', DATA, 'box', JSON.stringify(BOX), 'uploads', CRON_SECRET ? BLOB_PREFIX : 'off', 'identities', identity.size)
aisstream.start(ctx)
wsf.start(ctx)
setTimeout(daily, 30_000)
