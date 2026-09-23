#!/usr/bin/env node
// Climate TRACE facility bake — every facility-level emissions source in a
// release, as (1) one PMTiles of points carrying each source's monthly series
// and (2) per-source detail records sharded by id. See docs/CLIMATETRACE_API.md
// for the upstream study this is built from.
//
//   node scripts/bake-climatetrace/bake.mjs download [gas]        # fetch sector_packages/<gas>/*.zip
//   node scripts/bake-climatetrace/bake.mjs extract <zip> [sub]   # one sector zip (or one subsector) → build/sub/
//   node scripts/bake-climatetrace/bake.mjs extract-all [gas]     # every zip, in parallel child processes
//   node scripts/bake-climatetrace/bake.mjs assemble [gas]        # rank → minzoom → PMTiles + detail shards + index
//   node scripts/bake-climatetrace/bake.mjs dev                   # copy the index into public/dev-data/trace/
//   node scripts/bake-climatetrace/publish.mjs check|publish      # compare with / publish to production (see there)
//
// WHAT COUNTS AS A FACILITY: a subsector whose emissions_sources rows carry no
// `geometry_ref` (a real lat/lon, not an admin-area or urban-area aggregate).
// Detected from the data, not hard-coded — 31 subsectors in v5.10.0, ~750k
// sources. Area aggregates (cropland, buildings, roads, forests…) are skipped,
// and so are the area rows inside mixed subsectors (domestic wastewater);
// they need the geometries.gpkg polygons and are a separate bake.
//
// OIL & GAS PRODUCTION / TRANSPORT are basin-scale estimates placed at a basin
// centroid (see docs). They're kept, flagged `b=1`, so renderers can draw them
// as regions rather than as a single site.
//
// OUTPUTS (build/, gitignored — publish with publish.mjs):
//   trace-facilities.pmtiles  layer "facilities"; props per feature:
//     id, n (name), sec, sub, c (ISO3), at (asset type), b (basin flag),
//     m0 (index of first month in the series), m (monthly tonnes CO2e,
//     3 chars per month — see encodeMonth), y (latest
//     full-year total), r (global rank by y), o (top owner), q (emissions
//     confidence: very low…high), k (capacity with units)
//   trace-detail.pack         16,384 shards (id % 16384) in one file, layout in
//     api/trace-detail.js; each shard is NDJSON, format 2 (encodeDetail;
//     decode with traceData.js), exact values: monthly
//     emissions + activity, capacity, factors, subsector extras (otherN),
//     latest confidence ratings, ownership chains
//   trace-index.json          release, gas, months[], per-subsector counts,
//     per-sector monthly totals, citation

import { spawn, execFileSync } from 'node:child_process'
import readline from 'node:readline'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, copyFileSync, statSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const RAW = resolve(HERE, 'raw')
const BUILD = resolve(HERE, 'build')
const SUB_DIR = resolve(BUILD, 'sub')
const DETAIL_DIR = resolve(BUILD, 'detail')
const DEV_DIR = resolve(REPO, 'public', 'dev-data', 'trace')

export const SHARDS = 16384 // ~45 sources / ~25 KB per shard after encodeDetail

// ─── Detail record codec (format 2) ──────────────────────────────────────────
// Cattle operations are ~80% of all sources, and their records were mostly
// repetition: the same otherN definition sentences, the same units, and herd
// counts that never change month to month. Format 2 moves every repeated
// string into the index (per-subsector definitions + default units), run-
// length-encodes the series, and packs confidence ratings into a short code.
// traceData.js decodeDetail() restores the original shape exactly.
export const CONF_FIELDS = ['source_type', 'capacity', 'capacity_factor', 'activity', 'emissions_factor', 'emissions_quantity']
export const CONF_CODES = { 'very low': '1', low: '2', medium: '3', high: '4', 'very high': '5' }
const UNIT_KEYS = ['au', 'cu', 'efu']

/** Series → array where a run of ≥3 identical values becomes [value, count]. */
export function rleSeries(arr) {
  const out = []
  for (let i = 0; i < arr.length;) {
    let j = i + 1
    while (j < arr.length && arr[j] === arr[i]) j++
    if (j - i >= 3) out.push([arr[i], j - i]); else for (let k = i; k < j; k++) out.push(arr[k])
    i = j
  }
  return out
}

function encodeDetail(d, dict) {
  const sd = dict[d.sub]
  const out = { id: d.id, n: d.n, sub: d.sub, c: d.c }
  if (d.at) out.at = d.at
  out.lat = Math.round(d.lat * 1e5) / 1e5
  out.lon = Math.round(d.lon * 1e5) / 1e5
  if (d.b) out.b = 1
  out.m0 = d.m0
  out.e = rleSeries(d.e)
  if (d.act) out.act = rleSeries(d.act)
  for (const k of ['cap', 'cf', 'ef']) if (d[k] != null) out[k] = d[k]
  for (const k of UNIT_KEYS) if (d[k] && d[k] !== sd.units[k]) out[k] = d[k]
  if (d.o?.length) {
    const vals = sd.odefs.map((def) => d.o.find(([x]) => x === def)?.[1] ?? null)
    while (vals.length && vals[vals.length - 1] == null) vals.pop()
    if (vals.length) out.o = vals
  }
  if (d.conf) out.conf = CONF_FIELDS.map((f) => CONF_CODES[d.conf[f]] || '0').join('')
  if (d.own) out.own = d.own
  if (d.md && d.md !== sd.md) out.md = d.md
  return out
}
const START_YEAR = 2021 // first month in every Climate TRACE v5 series
const MAX_MONTHS = 12 * 8 // 2021 → 2028; raise when the series grows past it

// V8 keeps every substring of a parsed CSV line as a SLICE that pins the whole
// line. Holding a few fields per source × 285k cattle operations pinned
// gigabytes (the first bake OOM'd at 6 GB). Everything kept past the row is
// either interned (repeating labels/units/definitions) or flat-copied.
const flat = (s) => (s ? Buffer.from(s, 'utf8').toString('utf8') : s)
const POOL = new Map()
const intern = (s) => {
  if (!s) return s
  let v = POOL.get(s)
  if (v === undefined) { v = flat(s); POOL.set(v, v) }
  return v
}
const SECTOR_PACKAGES = ['power', 'manufacturing', 'mineral_extraction', 'fossil_fuel_operations', 'fluorinated_gases', 'waste', 'transportation', 'buildings', 'agriculture', 'forestry_and_land_use']
const BASIN_SUBSECTORS = new Set(['oil-and-gas-production', 'oil-and-gas-transport'])

// Zoom ladder by global rank (largest emitters first): a world view shows the
// biggest sources, smaller ones arrive as you zoom in. Ranks are cumulative.
const MINZOOM_LADDER = [[700, 0], [2000, 1], [5000, 2], [12000, 3], [30000, 4], [70000, 5], [160000, 6], [Infinity, 7]]

// Monthly series codec for the tiles: 3 base-36 chars per month, 3 significant
// figures (the precision a model estimate honestly carries; exact values stay
// in the detail shards). '---' = not reported, '000' = zero. Otherwise
// code = 1 + (e + 3) * 900 + (m - 100) for v ≈ m × 10^e, m ∈ [100, 999];
// floor 0.1 t (smaller values encode as 0.1). Decoder: traceData.js.
export function encodeMonth(v) {
  if (v == null || !Number.isFinite(v)) return '---'
  if (v <= 0) return '000'
  let e = Math.floor(Math.log10(v)) - 2
  let m = Math.round(v / 10 ** e)
  if (m >= 1000) { m = 100; e += 1 }
  if (e < -3) { e = -3; m = 100 }
  return (1 + (e + 3) * 900 + (m - 100)).toString(36).padStart(3, '0')
}

// ─── CSV ────────────────────────────────────────────────────────────────────
// RFC 4180. Some free-text fields (facility names, otherN definitions) embed
// newlines inside quotes, so physical lines are joined until the quotes
// balance before parsing — the first bake dropped those rows (e.g. 7
// landfills, 37 textile mills). The column-count check in extract still
// counts any row that comes out malformed (`bad` in each summary).
function parseLine(line) {
  if (line.indexOf('"') < 0) return line.split(',')
  const out = []
  let f = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { f += '"'; i++ } else q = false } else f += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(f); f = '' } else f += ch
  }
  out.push(f)
  return out
}

async function* csvRows(zip, entry) {
  const p = spawn('unzip', ['-p', zip, entry], { stdio: ['ignore', 'pipe', 'inherit'] })
  const rl = readline.createInterface({ input: p.stdout, crlfDelay: Infinity })
  let header = null
  let pending = null
  const quotes = (s) => { let n = 0; for (let i = s.indexOf('"'); i >= 0; i = s.indexOf('"', i + 1)) n++; return n }
  let pendingQuotes = 0
  for await (const raw of rl) {
    let line = raw
    if (pending != null) {
      line = pending + '\n' + raw
      pendingQuotes += quotes(raw)
    } else {
      if (!line) continue
      pendingQuotes = quotes(line)
    }
    if (pendingQuotes % 2) { pending = line; continue } // inside a quoted field — keep reading
    pending = null
    const r = parseLine(line)
    if (!header) { header = r; yield { header }; continue }
    yield { r }
  }
}

const zipEntries = (zip) => execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: 1 << 24 }).split('\n').filter(Boolean)
const num = (s) => (s === '' || s == null ? null : Number(s))
const sig = (v) => (v == null || !Number.isFinite(v) ? null : Math.abs(v) >= 1000 ? Math.round(v) : Number(v.toPrecision(5)))
const monthIdx = (iso) => (Number(iso.slice(0, 4)) - START_YEAR) * 12 + Number(iso.slice(5, 7)) - 1
const monthId = (i) => `${START_YEAR + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`

// ─── download ───────────────────────────────────────────────────────────────
export const packageUrl = (gas, s, release = 'latest') =>
  `https://downloads.climatetrace.org/${release}/sector_packages/${gas}/${s}.zip`

/** Upstream identity of every package (etag, else last-modified) — how the
 * scheduled Action tells a new Climate TRACE release from one we have. */
export async function upstreamStamps(gas = 'co2e_100yr') {
  const out = {}
  for (const s of SECTOR_PACKAGES) {
    const r = await fetch(packageUrl(gas, s), { method: 'HEAD' })
    if (!r.ok) throw new Error(`HEAD ${s} ${r.status}`)
    out[s] = r.headers.get('etag') || r.headers.get('last-modified')
  }
  return out
}

async function download(gas = 'co2e_100yr') {
  const dir = resolve(RAW, gas)
  mkdirSync(dir, { recursive: true })
  const stamps = await upstreamStamps(gas)
  for (const s of SECTOR_PACKAGES) {
    const url = packageUrl(gas, s)
    console.log(`↓ ${url}`)
    rmSync(resolve(dir, `${s}.zip`), { force: true }) // never resume onto an older release's bytes
    execFileSync('curl', ['-sfL', '--retry', '4', '-o', resolve(dir, `${s}.zip`), url], { stdio: 'inherit' })
  }
  writeFileSync(resolve(dir, 'stamps.json'), JSON.stringify(stamps, null, 1))
}

// ─── extract ────────────────────────────────────────────────────────────────
// Returns the facility subsectors in a zip (sampled: first 2000 rows carry no
// geometry_ref) with their source/ownership/confidence entry names.
async function facilitySubsectors(zip) {
  const entries = zipEntries(zip)
  const out = []
  for (const e of entries) {
    const m = e.match(/^DATA\/(.+)_emissions_sources_(v[\d_]+)\.csv$/)
    if (!m) continue
    const [, sub, ver] = m
    let header = null, n = 0, area = 0
    const p = spawn('sh', ['-c', `unzip -p "${zip}" "${e}" | head -2001`])
    const rl = readline.createInterface({ input: p.stdout })
    for await (const line of rl) {
      const r = parseLine(line)
      if (!header) { header = r; continue }
      n++; if (r[header.indexOf('geometry_ref')]) area++
    }
    if (n && area === 0) {
      const own = `DATA/${sub}_emissions_sources_ownership_${ver}.csv`
      const conf = `DATA/${sub}_emissions_sources_confidence_${ver}.csv`
      out.push({ sub, ver, sources: e, ownership: entries.includes(own) ? own : null, confidence: entries.includes(conf) ? conf : null })
    }
  }
  return out
}

async function extractSubsector(zip, s) {
  const t0 = Date.now()
  const src = new Map() // id → accumulator
  let H = null, bad = 0, rows = 0, gas = null, skippedArea = 0
  for await (const { header, r } of csvRows(zip, s.sources)) {
    if (header) { H = Object.fromEntries(header.map((k, i) => [k, i])); continue }
    if (r.length !== Object.keys(H).length) { bad++; continue }
    if (r[H.geometry_ref]) { skippedArea++; continue } // row-level guard for mixed subsectors
    rows++
    gas ||= r[H.gas]
    const id = Number(r[H.source_id])
    let a = src.get(id)
    if (!a) {
      a = {
        id, n: flat(r[H.source_name]), sec: intern(r[H.sector]), sub: intern(r[H.subsector]), c: intern(r[H.iso3_country]), at: intern(r[H.source_type]),
        lat: Number(r[H.lat]), lon: Number(r[H.lon]),
        e: new Float32Array(MAX_MONTHS).fill(NaN), act: new Float32Array(MAX_MONTHS).fill(NaN),
        lastT: '', cr: intern(r[H.created_date]), md: intern(r[H.modified_date]),
      }
      src.set(id, a)
    }
    const mi = monthIdx(r[H.start_time])
    if (mi < 0 || mi >= MAX_MONTHS) continue
    const q = num(r[H.emissions_quantity])
    if (q != null) a.e[mi] = q
    const act = num(r[H.activity])
    if (act != null) a.act[mi] = act
    if (r[H.start_time] >= a.lastT) {
      // Latest row wins for the slow-changing descriptors.
      a.lastT = intern(r[H.start_time])
      a.au = intern(r[H.activity_units]); a.cap = num(r[H.capacity]); a.cu = intern(r[H.capacity_units])
      a.cf = num(r[H.capacity_factor]); a.ef = num(r[H.emissions_factor]); a.efu = intern(r[H.emissions_factor_units])
      const o = []
      for (let k = 1; k <= 10; k++) {
        const v = r[H[`other${k}`]], d = r[H[`other${k}_def`]]
        if (v !== '' && v != null && d) o.push([intern(d), intern(v)])
      }
      a.o = o
      a.md = intern(r[H.modified_date]) || a.md
    }
  }

  // Ownership chains (by source_id; a source can have several parents).
  const own = new Map()
  if (s.ownership) {
    let OH = null
    for await (const { header, r } of csvRows(zip, s.ownership)) {
      if (header) { OH = Object.fromEntries(header.map((k, i) => [k, i])); continue }
      const id = Number(r[OH.source_id])
      if (!src.has(id)) continue
      const list = own.get(id) || []
      list.push({
        p: intern(r[OH.parent_name]?.trim()) || null, pid: intern(r[OH.parent_entity_id]) || null, pt: intern(r[OH.parent_entity_type]) || null,
        lei: intern(r[OH.parent_lei]) || null, hq: intern(r[OH.parent_headquarter_country]) || null,
        sh: num(r[OH.overall_share_percent]), path: flat(r[OH.ownership_path]?.trim()) || null,
        imm: intern(r[OH.immediate_source_owner]?.trim()) || null, op: intern(r[OH.source_operator]?.trim()) || null,
      })
      own.set(id, list)
    }
  }

  // Confidence: keep the latest month's ratings per source.
  const conf = new Map()
  if (s.confidence) {
    let CH = null
    const fields = ['source_type', 'capacity', 'capacity_factor', 'activity', 'emissions_factor', 'emissions_quantity']
    for await (const { header, r } of csvRows(zip, s.confidence)) {
      if (header) { CH = Object.fromEntries(header.map((k, i) => [k, i])); continue }
      const id = Number(r[CH.source_id])
      if (!src.has(id)) continue
      const t = r[CH.start_time]
      const prev = conf.get(id)
      if (prev && prev.t >= t) continue
      const rec = { t: intern(t) }
      for (const f of fields) if (CH[f] != null && r[CH[f]]) rec[f] = intern(r[CH[f]])
      conf.set(id, rec)
    }
  }

  // Flush: tile-feature stub + detail record per source.
  mkdirSync(SUB_DIR, { recursive: true })
  const fOut = createWriteStream(resolve(SUB_DIR, `${s.sub}.features.ndjson`))
  const dOut = createWriteStream(resolve(SUB_DIR, `${s.sub}.detail.ndjson`))
  let maxMonth = -1
  for (const a of src.values()) {
    let first = -1, last = -1
    for (let i = 0; i < MAX_MONTHS; i++) if (!Number.isNaN(a.e[i])) { if (first < 0) first = i; last = i }
    if (first < 0 || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue
    maxMonth = Math.max(maxMonth, last)
    const e = [], act = []
    for (let i = first; i <= last; i++) {
      e.push(sig(Number.isNaN(a.e[i]) ? null : a.e[i]))
      act.push(sig(Number.isNaN(a.act[i]) ? null : a.act[i]))
    }
    const c = conf.get(a.id)
    if (c) delete c.t
    const detail = {
      id: a.id, n: a.n, sec: a.sec, sub: a.sub, c: a.c, at: a.at, lat: a.lat, lon: a.lon,
      ...(BASIN_SUBSECTORS.has(a.sub) ? { b: 1 } : {}),
      m0: first, e,
      ...(act.some((v) => v != null && v !== 0) ? { act, au: a.au } : {}),
      ...(a.cap ? { cap: a.cap, cu: a.cu } : {}),
      ...(a.cf ? { cf: sig(a.cf) } : {}),
      ...(a.ef ? { ef: sig(a.ef), efu: a.efu } : {}),
      ...(a.o?.length ? { o: a.o } : {}),
      ...(c && Object.keys(c).length ? { conf: c } : {}),
      ...(own.get(a.id)?.length ? { own: own.get(a.id).slice(0, 8) } : {}),
      md: a.md,
    }
    dOut.write(JSON.stringify(detail) + '\n')
    fOut.write(JSON.stringify({ id: a.id, n: a.n, sec: a.sec, sub: a.sub, c: a.c, at: a.at, lat: a.lat, lon: a.lon, b: BASIN_SUBSECTORS.has(a.sub) ? 1 : 0, m0: first, e }) + '\n')
  }
  await Promise.all([new Promise((r) => fOut.end(r)), new Promise((r) => dOut.end(r))])
  const summary = { sub: s.sub, sec: [...src.values()][0]?.sec, gas, ver: s.ver, sources: src.size, rows, bad, skippedArea, ownership: own.size, confidence: conf.size, lastMonth: maxMonth >= 0 ? monthId(maxMonth) : null, secs: Math.round((Date.now() - t0) / 1000) }
  writeFileSync(resolve(SUB_DIR, `${s.sub}.summary.json`), JSON.stringify(summary, null, 1))
  console.log(JSON.stringify(summary))
  return summary
}

async function extract(zip, only) {
  const subs = (await facilitySubsectors(zip)).filter((s) => !only || s.sub === only)
  if (!subs.length) console.log(`${basename(zip)}: no facility subsectors`)
  for (const s of subs) await extractSubsector(zip, s)
}

async function extractAll(gas = 'co2e_100yr') {
  const dir = resolve(RAW, gas)
  const zips = readdirSync(dir).filter((f) => f.endsWith('.zip')).map((f) => resolve(dir, f))
  // One child per facility subsector, 6 at a time; the two cattle files
  // (15 + 27 GB of CSV) are the long poles, so they start first.
  const jobs = []
  for (const zip of zips) for (const s of await facilitySubsectors(zip)) jobs.push({ zip, sub: s.sub, size: sizeOf(zip, s.sources) })
  jobs.sort((a, b) => b.size - a.size)
  console.log(`${jobs.length} facility subsectors`)
  let i = 0
  const run = async () => {
    while (i < jobs.length) {
      const j = jobs[i++]
      await new Promise((res, rej) => {
        const p = spawn(process.execPath, [`--max-old-space-size=${process.env.TRACE_HEAP_MB || 8000}`, fileURLToPath(import.meta.url), 'extract', j.zip, j.sub], { stdio: 'inherit' })
        p.on('exit', (code) => (code ? rej(new Error(`${j.sub} exited ${code}`)) : res()))
      })
    }
  }
  await Promise.all(Array.from({ length: Number(process.env.TRACE_JOBS) || 6 }, run))
}
const sizeOf = (zip, entry) => Number(execFileSync('unzip', ['-Zl', zip, entry], { encoding: 'utf8' }).trim().split(/\s+/)[3]) || 0

// ─── assemble ───────────────────────────────────────────────────────────────
async function* ndjson(path) {
  const rl = readline.createInterface({ input: (await import('node:fs')).createReadStream(path), crlfDelay: Infinity })
  for await (const line of rl) if (line) yield JSON.parse(line)
}

async function assemble(gas = 'co2e_100yr') {
  const summaries = readdirSync(SUB_DIR).filter((f) => f.endsWith('.summary.json')).map((f) => JSON.parse(readFileSync(resolve(SUB_DIR, f), 'utf8')))
  const subs = summaries.map((s) => s.sub).sort()
  const ver = summaries[0]?.ver
  const lastMonth = summaries.map((s) => s.lastMonth).filter(Boolean).sort().pop()
  const nMonths = monthIdx(`${lastMonth}-01`) + 1
  // Latest COMPLETE year (all 12 months published) — the annual figure used for ranking.
  const fullYear = (nMonths % 12 === 0) ? START_YEAR + nMonths / 12 - 1 : START_YEAR + Math.floor(nMonths / 12) - 1
  const yStart = (fullYear - START_YEAR) * 12

  // Pass 0: popup essentials from the detail records, carried in the tiles so
  // a click can answer without a second fetch — top owner (largest share),
  // the emissions-quantity confidence rating, and capacity with its units.
  // Also builds the format-2 detail dictionary: each subsector's otherN
  // definitions (first-seen order) and its most common units / modified date.
  const extras = new Map()
  const dict = {}
  const mode = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  for (const sub of subs) {
    const odefs = [], seenDefs = new Set()
    const tallies = { au: new Map(), cu: new Map(), efu: new Map(), md: new Map() }
    for await (const d of ndjson(resolve(SUB_DIR, `${sub}.detail.ndjson`))) {
      for (const [def] of d.o || []) if (!seenDefs.has(def)) { seenDefs.add(def); odefs.push(def) }
      for (const k of Object.keys(tallies)) if (d[k]) tallies[k].set(d[k], (tallies[k].get(d[k]) || 0) + 1)
      const top = d.own?.slice().sort((a, b) => (b.sh ?? 0) - (a.sh ?? 0))[0]
      const x = {}
      if (top?.p) x.o = top.p
      if (d.conf?.emissions_quantity) x.q = d.conf.emissions_quantity
      if (d.cap && d.cu) x.k = `${sig(d.cap).toLocaleString('en-US')} ${d.cu}`
      if (Object.keys(x).length) extras.set(d.id, x)
    }
    dict[sub] = { odefs, units: { au: mode(tallies.au), cu: mode(tallies.cu), efu: mode(tallies.efu) }, md: mode(tallies.md) }
  }

  // Pass 1: annual totals → global rank.
  const totals = []
  const sectorMonthly = {}
  for (const sub of subs) {
    for await (const f of ndjson(resolve(SUB_DIR, `${sub}.features.ndjson`))) {
      let y = 0
      for (let i = 0; i < f.e.length; i++) {
        const mi = f.m0 + i, v = f.e[i]
        if (v == null) continue
        if (mi >= yStart && mi < yStart + 12) y += v
        const sm = (sectorMonthly[f.sec] ||= new Array(nMonths).fill(0))
        if (mi < nMonths) sm[mi] += v
      }
      totals.push([y, f.id])
    }
  }
  totals.sort((a, b) => b[0] - a[0])
  const rank = new Map(totals.map(([, id], i) => [id, i + 1]))
  const minzoomFor = (r) => MINZOOM_LADDER.find(([lim]) => r <= lim)[1]

  // Pass 2: tile features (GeoJSON, tippecanoe minzoom per feature).
  const featPath = resolve(BUILD, 'features.geojsonl')
  const fOut = createWriteStream(featPath)
  for (const sub of subs) {
    for await (const f of ndjson(resolve(SUB_DIR, `${sub}.features.ndjson`))) {
      const r = rank.get(f.id)
      let y = 0
      for (let i = 0; i < f.e.length; i++) { const mi = f.m0 + i; if (f.e[i] != null && mi >= yStart && mi < yStart + 12) y += f.e[i] }
      const props = {
        id: f.id, n: f.n, sec: f.sec, sub: f.sub, c: f.c, ...(f.at ? { at: f.at } : {}), ...(f.b ? { b: 1 } : {}),
        m0: f.m0, m: f.e.map(encodeMonth).join(''), y: Math.round(y), r,
        ...extras.get(f.id),
      }
      fOut.write(JSON.stringify({ type: 'Feature', tippecanoe: { minzoom: minzoomFor(r) }, geometry: { type: 'Point', coordinates: [f.lon, f.lat] }, properties: props }) + '\n')
    }
  }
  await new Promise((r) => fOut.end(r))

  const pm = resolve(BUILD, 'trace-facilities.pmtiles')
  rmSync(pm, { force: true })
  console.log('tippecanoe …')
  execFileSync('tippecanoe', [
    '-o', pm, '-l', 'facilities', '-P',
    '-Z0', '-z8', // points: Mapbox overzooms z8 fine (~40 m precision)
    '-r1', // the minzoom ladder decides density, not tippecanoe's rate
    '--no-feature-limit',
    '--drop-densest-as-needed', '--maximum-tile-bytes=700000', // safety valve for dense feedlot regions
    '-n', 'Climate TRACE facilities', '-A', 'Climate TRACE (climatetrace.org), CC BY 4.0',
    '--force', '--quiet',
    featPath,
  ], { stdio: 'inherit' })

  // Detail shards: one NDJSON per (id % SHARDS), flushed in bounded batches.
  rmSync(DETAIL_DIR, { recursive: true, force: true })
  mkdirSync(DETAIL_DIR, { recursive: true })
  let buf = new Map(), bufBytes = 0
  const flush = () => {
    for (const [k, lines] of buf) appendFileSync(resolve(DETAIL_DIR, `${k}.ndjson`), lines.join(''))
    buf = new Map(); bufBytes = 0
  }
  for (const sub of subs) {
    const rl = readline.createInterface({ input: (await import('node:fs')).createReadStream(resolve(SUB_DIR, `${sub}.detail.ndjson`)) })
    for await (const line of rl) {
      if (!line) continue
      const id = Number(line.slice(6, line.indexOf(',')))
      const rec = encodeDetail(JSON.parse(line), dict)
      rec.r = rank.get(id)
      const s = JSON.stringify(rec) + '\n'
      const k = id % SHARDS
      if (!buf.has(k)) buf.set(k, [])
      buf.get(k).push(s)
      bufBytes += s.length
      if (bufBytes > 300e6) flush()
    }
  }
  flush()

  // Pack every shard into ONE file (layout documented in api/trace-detail.js)
  // so a release publishes as three uploads instead of 16,384.
  const packPath = resolve(BUILD, 'trace-detail.pack')
  const packOut = createWriteStream(packPath)
  const offsets = Buffer.alloc((SHARDS + 1) * 4)
  const head = Buffer.alloc(8)
  head.write('TRDP', 0, 'ascii')
  head.writeUInt32LE(SHARDS, 4)
  const shardFile = (k) => resolve(DETAIL_DIR, `${k}.ndjson`)
  let pos = 0
  for (let k = 0; k < SHARDS; k++) {
    offsets.writeUInt32LE(pos, k * 4)
    if (existsSync(shardFile(k))) pos += statSync(shardFile(k)).size
  }
  offsets.writeUInt32LE(pos, SHARDS * 4)
  if (pos >= 2 ** 32) throw new Error('detail pack exceeds uint32 offsets')
  const write = (b) => (packOut.write(b) ? null : new Promise((r) => packOut.once('drain', r)))
  await write(head)
  await write(offsets)
  for (let k = 0; k < SHARDS; k++) if (existsSync(shardFile(k))) await write(readFileSync(shardFile(k)))
  await new Promise((r) => packOut.end(r))
  rmSync(DETAIL_DIR, { recursive: true, force: true })

  // ISO3 → country name, from the same release's API definitions.
  let countries = {}
  try {
    const r = await fetch('https://api.climatetrace.org/v7/definitions/countries')
    if (r.ok) countries = Object.fromEntries((await r.json()).map((c) => [c.id, c.name]))
  } catch { console.warn('  (country names unavailable — popups fall back to ISO3 codes)') }

  const release = ver ? ver.replace(/_/g, '.') : null
  const stampsPath = resolve(RAW, gas, 'stamps.json')
  const index = {
    version: 1,
    kind: 'trace-facilities',
    // Published folder: release + bake date AND time (UTC, YYYYMMDDHHmm) —
    // immutable once uploaded, and never shared by two bakes (a same-day
    // rerun overwriting a folder could leave CDN-cached byte ranges of the
    // old file next to the new one).
    build: `${release}-${new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '')}`,
    sourceStamps: existsSync(stampsPath) ? JSON.parse(readFileSync(stampsPath, 'utf8')) : null,
    summaries: summaries.map(({ sub, sources, bad }) => ({ sub, sources, bad })),
    countries,
    release,
    gas,
    months: Array.from({ length: nMonths }, (_, i) => monthId(i)),
    fullYear,
    shards: SHARDS,
    detailFormat: 2,
    detailDict: dict,
    confFields: CONF_FIELDS,
    count: totals.length,
    subsectors: Object.fromEntries(summaries.sort((a, b) => b.sources - a.sources).map((s) => [s.sub, { sector: s.sec, sources: s.sources, lastMonth: s.lastMonth, ownership: s.ownership }])),
    sectorMonthly: Object.fromEntries(Object.entries(sectorMonthly).map(([k, v]) => [k, v.map(Math.round)])),
    minzoomLadder: MINZOOM_LADDER.map(([r, z]) => [Number.isFinite(r) ? r : null, z]),
    generated_ms: Date.now(),
    fetched_ms: Date.now(),
    source: `Climate TRACE Emissions Inventory ${ver ? ver.replace(/_/g, '.') : ''} (https://climatetrace.org), CC BY 4.0 — facility-level sources, ${gas}, monthly`,
  }
  writeFileSync(resolve(BUILD, 'trace-index.json'), JSON.stringify(index))
  const pmMB = (statSync(pm).size / 1e6).toFixed(1)
  const packMB = (statSync(packPath).size / 1e6).toFixed(1)
  console.log(`✓ ${index.build}: ${totals.length.toLocaleString()} sources · ${nMonths} months (→ ${lastMonth}) · full year ${fullYear} · PMTiles ${pmMB} MB · detail pack ${packMB} MB (${SHARDS} shards)`)
}

// Dev: the index is served statically; tiles and detail come from the local
// build through the dev middlewares (api/_trace-store.js reads build/).
function dev() {
  rmSync(DEV_DIR, { recursive: true, force: true })
  mkdirSync(DEV_DIR, { recursive: true })
  copyFileSync(resolve(BUILD, 'trace-index.json'), resolve(DEV_DIR, 'trace-index.json'))
  console.log(`✓ dev index → ${DEV_DIR}`)
}

// ─── cli ────────────────────────────────────────────────────────────────────
// (only when run directly — publish.mjs imports the helpers above)
const [cmd, a1, a2] = process.argv[1] === fileURLToPath(import.meta.url) ? process.argv.slice(2) : ['__imported__']
if (cmd === '__imported__') { /* library use */ }
else if (cmd === 'download') await download(a1)
else if (cmd === 'extract') await extract(resolve(a1), a2)
else if (cmd === 'extract-all') await extractAll(a1)
else if (cmd === 'assemble') await assemble(a1)
else if (cmd === 'dev') dev()
else {
  console.error('usage: bake.mjs download|extract|extract-all|assemble|dev (see header)')
  process.exit(1)
}
