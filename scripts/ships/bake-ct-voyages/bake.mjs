#!/usr/bin/env node
/**
 * Climate TRACE ship voyages (Salish Sea pull, BigQuery `shipping_voyages`, 2024–2025; see memory
 * project_climatetrace and docs/SHIP_POLLUTION_SOURCES.md §2) → per-ship packs for the ship card's Emissions tab.
 *
 * Input:  scripts/bake-shiptraffic/cache/climatetrace/voyages-2024-2025.csv (gitignored, 299 MB, as pulled)
 * Output: scripts/ships/bake-ct-voyages/build/
 *           ct-voyages-mmsi-v1.pack   ships identified by MMSI (asset_identifier gfw-mmsi-N)
 *           ct-voyages-imo-v1.pack    ships identified by IMO (gfw-imo-N, om-imo-N)
 *           manifest.json             counts, input sha256, pull window, field list
 * Pack layout = the /ships track packs (api/ship-tracks.js packFor): 'SHTP', uint32 N, (N+1) uint32 offsets,
 * N gzip'd NDJSON shards; shard = key % N; one line per ship, starting {"key":<n>, so a reader can match
 * the prefix without parsing every line.
 *
 * Line: {"key":367589590,"id":"gfw-mmsi-367589590","name":"polarexpress","type":"passenger",
 *        "v":[[kind,start,end,from,to,fromIso,toIso,sector,co2e100,co2e20,co2,ch4,n2o,sox,nox,pm25,co], …]}
 *   kind 't' = trip (LINESTRING, port → port), 's' = port stay (POINT); sector 'd' domestic / 'i' international.
 *   Every value is Climate TRACE's own, rounded to 6 significant figures; nothing is recomputed.
 *
 *   node scripts/ships/bake-ct-voyages/bake.mjs [--limit N]   (N = rows, for a quick test)
 */
import { createReadStream, mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { once } from 'node:events'

const IN = 'scripts/bake-shiptraffic/cache/climatetrace/voyages-2024-2025.csv'
const OUT = 'scripts/ships/bake-ct-voyages/build'
const SHARDS = 1024
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || null

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
const ships = new Map() // `${kind}:${key}` → { key, id, name, type, v: [] }
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
  if (!s) ships.set(k, s = { key: Number(m[2]), id: o.asset_identifier, name: o.asset_name || null, type: o.type || null, v: [] })
  const sector = o.original_inventory_sector === 'international-shipping' ? 'i' : o.original_inventory_sector === 'domestic-shipping' ? 'd' : null
  s.v.push([o.wkt.startsWith('POINT') ? 's' : 't', o.start_date, o.end_date, o.other2 || null, o.other3 || null, o.other4 || null, o.other5 || null, sector,
    r6(o.total_CO2e_100yrGWP), r6(o.total_CO2e_20yrGWP), r6(o.CO2_emissions), r6(o.CH4_emissions), r6(o.N2O_emissions),
    r6(o.SOX_emissions), r6(o.NOX_emissions), r6(o.PM2_5_emissions), r6(o.CO_emissions)])
  const d = o.start_date.slice(0, 10)
  if (!window.from || d < window.from) window.from = d
  if (!window.to || d > window.to) window.to = d
  if (++n % 100000 === 0) console.log(`  ${n.toLocaleString()} rows, ${ships.size.toLocaleString()} ships`)
  if (limit && n >= limit) break
}
console.log(`${n.toLocaleString()} rows → ${ships.size.toLocaleString()} ships (${bad} rows skipped)`)

mkdirSync(OUT, { recursive: true })
async function writePack(kind) {
  const shards = Array.from({ length: SHARDS }, () => [])
  for (const [k, s] of ships) {
    if (!k.startsWith(`${kind}:`)) continue
    s.v.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    shards[s.key % SHARDS].push(JSON.stringify({ key: s.key, id: s.id, name: s.name, type: s.type, v: s.v }))
  }
  const blobs = shards.map((lines) => (lines.length ? gzipSync(Buffer.from(lines.join('\n') + '\n')) : Buffer.alloc(0)))
  const offsets = [0]; for (const b of blobs) offsets.push(offsets[offsets.length - 1] + b.length)
  const file = `${OUT}/ct-voyages-${kind}-v1.pack`
  const ws = createWriteStream(file)
  const head = Buffer.alloc(8 + 4 * (SHARDS + 1)); head.write('SHTP', 0, 'ascii'); head.writeUInt32LE(SHARDS, 4)
  offsets.forEach((o, i) => head.writeUInt32LE(o, 8 + 4 * i))
  ws.write(head); for (const b of blobs) ws.write(b); ws.end(); await once(ws, 'finish')
  const count = shards.reduce((a, l) => a + l.length, 0)
  console.log(`${file}: ${count.toLocaleString()} ships, ${(head.length + offsets[SHARDS]).toLocaleString()} bytes`)
  return { file: file.split('/').pop(), ships: count, bytes: head.length + offsets[SHARDS] }
}
const packs = { mmsi: await writePack('mmsi'), imo: await writePack('imo') }
writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  version: 'ct-voyages-v1', source: 'Climate TRACE shipping_voyages (BigQuery trace-data-383422.climate_trace), release v5.10.0',
  pulled: '2026-09-23', area: 'Salish Sea', startDates: window, rows: n, skipped: bad, input: { file: IN, sha256: rows.sha256 ?? null },
  shards: SHARDS, packs,
  fields: ['kind(t trip|s stay)', 'start', 'end', 'from', 'to', 'fromIso', 'toIso', 'sector(d|i)', 'co2e_100yr', 'co2e_20yr', 'co2', 'ch4', 'n2o', 'sox', 'nox', 'pm2_5', 'co'],
}, null, 1))
console.log('done')
