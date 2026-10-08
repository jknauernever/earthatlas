#!/usr/bin/env node
/**
 * Climate TRACE ship voyages (Salish Sea pull, BigQuery `shipping_voyages`, 2024–2025; see memory
 * project_climatetrace and docs/SHIP_POLLUTION_SOURCES.md §2) → per-ship packs for the ship card's Emissions tab.
 *
 * Input:  scripts/bake-shiptraffic/cache/climatetrace/voyages-2024-2025-v5_11_0-n4975.csv (gitignored, pulled 2026-09-29,
 *         release label v5_11_0, polygon north edge 49.75° N so Vancouver, Roberts Bank, Howe Sound and Nanaimo are in).
 *         History: v1 = voyages-2024-2025.csv (v5.10.0, 2026-09-23, north edge 49.0); v2 = voyages-2024-2025-v5_11_0.csv
 *         (v5_11_0, north edge 49.0; never uploaded).
 *         Pull (same slice both times; always capped):
 *           bq query --use_legacy_sql=false --maximum_bytes_billed=26000000000 --format=csv --max_rows=5000000 "SELECT start_date,
 *             end_date, asset_identifier, asset_name, type, iso3_country, ST_ASTEXT(location) AS wkt, capacity, capacity_factor,
 *             activity, CO2_emissions, CH4_emissions, N2O_emissions, SOX_emissions, NOX_emissions, VOCS_emissions, PM2_5_emissions,
 *             PM10_emissions, CO_emissions, total_CO2e_100yrGWP, total_CO2e_20yrGWP, other1, …, other12, original_inventory_sector,
 *             model_number FROM `trace-data-383422.climate_trace.shipping_voyages` WHERE start_date >= '2024-01-01' AND
 *             start_date < '2026-01-01' AND ST_INTERSECTS(location, ST_GEOGFROMTEXT('POLYGON((-124.85 47.0, -122.05 47.0,
 *             -122.05 49.75, -124.85 49.75, -124.85 47.0))'))"        (25.2 GB scanned)
 * Output: scripts/ships/bake-ct-voyages/build/
 *           ct-voyages-mmsi-v3.pack   ships identified by MMSI (asset_identifier gfw-mmsi-N)
 *           ct-voyages-imo-v3.pack    ships identified by IMO (gfw-imo-N, om-imo-N)
 *           ct-stays-v3.ndjson        every port stay (Climate TRACE's other8 = false) with its position(s), port name / id
 *                                     and gases: the input of scripts/ships/import-ct-stays.mjs (stays → our terminals)
 *           manifest.json             counts, input sha256, pull window, field list
 * Pack layout = the /ships track packs (api/ship-tracks.js packFor): 'SHTP', uint32 N, (N+1) uint32 offsets,
 * N gzip'd NDJSON shards; shard = key % N; one line per ship, starting {"key":<n>, so a reader can match
 * the prefix without parsing every line.
 *
 * Line: {"key":367589590,"id":"gfw-mmsi-367589590","name":"polarexpress","type":"passenger","o11":null,"o12":null,
 *        "v":[[kind,start,end,from,to,fromIso,toIso,sector,co2e100,co2e20,co2,ch4,n2o,sox,nox,pm25,co,lon,lat,fromPort,toPort], …]}
 *   kind 't' = trip, 's' = port stay (Climate TRACE's other8 flag; v1 used geometry); sector 'd' domestic / 'i' international.
 *   lon/lat = the stay's POINT (null for trips); fromPort/toPort = Climate TRACE's port ids (other6 / other7).
 *   o11 / o12 = the ship's raw other11 / other12 (one value per ship in every row; null when absent or when rows disagree,
 *   counted in the manifest). What they mean: lib/ships/ctVoyages.js (CT_SHIP_FIELDS). id's prefix = who tracked the ship
 *   (ctVoyages.js trackerOf: om- = OceanMind, gfw- = Global Fishing Watch).
 *   Every value is Climate TRACE's own, rounded to 6 significant figures; nothing is recomputed.
 *
 *   node scripts/ships/bake-ct-voyages/bake.mjs [--limit N] [--in <csv>] [--out <dir>] [--version V --release R --pulled YYYY-MM-DD]
 *   (N = rows, for a quick test). Since 2026-10-08 production bakes run monthly in GitHub Actions
 *   (.github/workflows/ct-voyages-bake.yml: pull.sql from Jan 2024 on → this bake → publish.mjs); the hand-run steps above are history.
 */
import { createReadStream, mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { once } from 'node:events'
import { oneValuePerShip } from '../../../lib/ships/ctVoyages.js'

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null)
// Defaults = the hand-run v3 bake; the automated bake (ct-voyages-bake.yml, publish.mjs) passes its own.
const VERSION = arg('--version') || 'v3'
const RELEASE = arg('--release') || 'v5_11_0'
const PULLED = arg('--pulled') || '2026-09-29'
const IN = arg('--in') || 'scripts/bake-shiptraffic/cache/climatetrace/voyages-2024-2025-v5_11_0-n4975.csv'
const OUT = arg('--out') || 'scripts/ships/bake-ct-voyages/build'
const SHARDS = 1024
const limit = Number(arg('--limit')) || null

// CSV with quoted fields (commas, doubled quotes, and newlines inside quotes).
async function* rows(path) {
  let field = '', rec = [], inQ = false, prev = ''
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 })) {
    hash.update(chunk)
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]
      if (inQ) {
        if (ch === '"') { if (chunk[i + 1] === '"') { field += '"'; i++ } else inQ = false }
        else field += ch
      } else if (ch === '"') inQ = true
      else if (ch === ',') { rec.push(field); field = '' }
      else if (ch === '\n') { rec.push(field.endsWith('\r') ? field.slice(0, -1) : field); field = ''; yield rec; rec = [] }
      else field += ch
      prev = ch
    }
  }
  if (field || rec.length) { rec.push(field); yield rec }
  rows.sha256 = hash.digest('hex')
}

const r6 = (s) => { if (s === '' || s == null) return null; const n = Number(s); return Number.isFinite(n) ? Number(n.toPrecision(6)) : null }
const ships = new Map() // `${kind}:${key}` → { key, id, name, type, v: [], raw: [[other11, other12], …] }
const stays = [] // every port stay (other8 = false), for the terminal matcher
let header = null, n = 0, bad = 0
const window = { from: null, to: null }
for await (const r of rows(IN)) {
  if (!header) { header = r; continue }
  if (r.length < header.length) { bad++; continue }
  const o = Object.fromEntries(header.map((h, i) => [h, r[i]]))
  const m = /^(gfw-mmsi|gfw-imo|om-imo)-(\d+)$/.exec(o.asset_identifier)
  if (!m) { bad++; continue }
  const kind = m[1] === 'gfw-mmsi' ? 'mmsi' : 'imo'
  const k = `${kind}:${m[2]}`
  let s = ships.get(k)
  if (!s) ships.set(k, s = { key: Number(m[2]), id: o.asset_identifier, name: o.asset_name || null, type: o.type || null, v: [], raw: [] })
  const sector = o.original_inventory_sector === 'international-shipping' ? 'i' : o.original_inventory_sector === 'domestic-shipping' ? 'd' : null
  const pt = /^POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/.exec(o.wkt)
  // kind: Climate TRACE's own trip flag (other8: true = trip, false = port stay); v1 went by geometry (POINT = stay), which
  // filed ~70k stays drawn as short LINESTRINGs as trips (e.g. "Birch Bay → Birch Bay"). Geometry only when the flag is absent.
  const row = [o.other8 === 'false' ? 's' : o.other8 === 'true' ? 't' : o.wkt.startsWith('POINT') ? 's' : 't', o.start_date, o.end_date, o.other2 || null, o.other3 || null, o.other4 || null, o.other5 || null, sector,
    r6(o.total_CO2e_100yrGWP), r6(o.total_CO2e_20yrGWP), r6(o.CO2_emissions), r6(o.CH4_emissions), r6(o.N2O_emissions),
    r6(o.SOX_emissions), r6(o.NOX_emissions), r6(o.PM2_5_emissions), r6(o.CO_emissions),
    pt ? Number(Number(pt[1]).toFixed(6)) : null, pt ? Number(Number(pt[2]).toFixed(6)) : null, o.other6 || null, o.other7 || null]
  s.v.push(row)
  s.raw.push([o.other11, o.other12])
  // Port stays for the terminal matcher: Climate TRACE's own stay flag (other8 = false), with every position the row has
  // (a POINT, or the two ends of a short LINESTRING).
  if (o.other8 === 'false') {
    const at = [...o.wkt.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map((x) => [Number(Number(x[1]).toFixed(6)), Number(Number(x[2]).toFixed(6))])
    stays.push({ id: o.asset_identifier, name: o.asset_name || null, type: o.type || null, at, port: o.other2 || null, portId: o.other6 || null,
      start: o.start_date, end: o.end_date, sector, co2e: row[8], co2e20: row[9], co2: row[10], ch4: row[11], n2o: row[12], sox: row[13], nox: row[14], pm25: row[15], co: row[16] })
  }
  const d = o.start_date.slice(0, 10)
  if (!window.from || d < window.from) window.from = d
  if (!window.to || d > window.to) window.to = d
  if (++n % 100000 === 0) console.log(`  ${n.toLocaleString()} rows, ${ships.size.toLocaleString()} ships`)
  if (limit && n >= limit) break
}
console.log(`${n.toLocaleString()} rows → ${ships.size.toLocaleString()} ships (${bad} rows skipped)`)
// One other11 / other12 value per ship (they are per-ship facts); ships whose rows disagree keep null and are counted.
const facts = { withO11: 0, withO12: 0, conflictO11: 0, conflictO12: 0, byPrefix: {} }
for (const s of ships.values()) {
  const f = oneValuePerShip(s.raw)
  s.o11 = f.o11; s.o12 = f.o12; delete s.raw
  const px = s.id.replace(/-\d+$/, '')
  const b = facts.byPrefix[px] || (facts.byPrefix[px] = { ships: 0, withO11: 0, withO12: 0 })
  b.ships++
  if (f.o11 != null) { facts.withO11++; b.withO11++ }
  if (f.o12 != null) { facts.withO12++; b.withO12++ }
  if (f.conflicts.includes('o11')) facts.conflictO11++
  if (f.conflicts.includes('o12')) facts.conflictO12++
}
console.log('per-ship other11/other12:', JSON.stringify(facts))

mkdirSync(OUT, { recursive: true })
async function writePack(kind) {
  const shards = Array.from({ length: SHARDS }, () => [])
  for (const [k, s] of ships) {
    if (!k.startsWith(`${kind}:`)) continue
    s.v.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    shards[s.key % SHARDS].push(JSON.stringify({ key: s.key, id: s.id, name: s.name, type: s.type, o11: s.o11, o12: s.o12, v: s.v }))
  }
  const blobs = shards.map((lines) => (lines.length ? gzipSync(Buffer.from(lines.join('\n') + '\n')) : Buffer.alloc(0)))
  const offsets = [0]; for (const b of blobs) offsets.push(offsets[offsets.length - 1] + b.length)
  const file = `${OUT}/ct-voyages-${kind}-${VERSION}.pack`
  const ws = createWriteStream(file)
  const head = Buffer.alloc(8 + 4 * (SHARDS + 1)); head.write('SHTP', 0, 'ascii'); head.writeUInt32LE(SHARDS, 4)
  offsets.forEach((o, i) => head.writeUInt32LE(o, 8 + 4 * i))
  ws.write(head); for (const b of blobs) ws.write(b); ws.end(); await once(ws, 'finish')
  const count = shards.reduce((a, l) => a + l.length, 0)
  console.log(`${file}: ${count.toLocaleString()} ships, ${(head.length + offsets[SHARDS]).toLocaleString()} bytes`)
  return { file: file.split('/').pop(), ships: count, bytes: head.length + offsets[SHARDS] }
}
const packs = { mmsi: await writePack('mmsi'), imo: await writePack('imo') }
// Port stays with their positions (one line each), for scripts/ships/import-ct-stays.mjs.
stays.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
writeFileSync(`${OUT}/ct-stays-${VERSION}.ndjson`, stays.map((s) => JSON.stringify(s)).join('\n') + '\n')
console.log(`${OUT}/ct-stays-${VERSION}.ndjson: ${stays.length.toLocaleString()} port stays`)
writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  version: `ct-voyages-${VERSION}`, source: `Climate TRACE shipping_voyages (BigQuery trace-data-383422.climate_trace), release label ${RELEASE}`,
  release: RELEASE, pulled: PULLED, area: 'Salish Sea (polygon -124.85..-122.05 W, 47.0..49.75 N)', startDates: window, rows: n, skipped: bad,
  input: { file: IN, sha256: rows.sha256 ?? null }, shards: SHARDS, packs, stays: stays.length, shipFacts: facts,
  fields: ['kind(t trip|s stay, other8)', 'start', 'end', 'from', 'to', 'fromIso', 'toIso', 'sector(d|i)', 'co2e_100yr', 'co2e_20yr', 'co2', 'ch4', 'n2o', 'sox', 'nox', 'pm2_5', 'co',
    'lon(stay)', 'lat(stay)', 'fromPort(other6)', 'toPort(other7)'],
  shipFields: { o11: 'raw other11 (one value per ship)', o12: 'raw other12 (one value per ship)' },
}, null, 1))
console.log('done')
