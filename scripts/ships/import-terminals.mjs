#!/usr/bin/env node
/**
 * Salish Sea terminal list → ships evidence + claims (lib/ships/terminals.js; data in lib/ships/data/salish-terminals*.json).
 * AIS-inferred berths (salish-terminals-ais-berths.json, basis ais_inferred) are stored from the file itself: no fetch.
 * DEV database only unless Josh says otherwise (SHIPS_DATABASE_URL from .env.local). Idempotent: an unchanged source row
 * stores nothing new; terminals / berths / links are upserted; ones no longer listed are kept as withdrawn / retired.
 *
 *   npm run ships:import-terminals -- [--schema <name>] [--save <dir>] [--from <dir>] [--dry-run]
 *     --save <dir>  also write every raw response to <dir> (use a gitignored dir, e.g. scripts/ships/.cache/terminals)
 *     --from <dir>  replay responses saved with --save instead of calling the sources (offline)
 *     --dry-run     validate + fetch + resolve berths, print what would be stored; no database writes
 *
 * Small, targeted requests only (one per source, by id): USACE Docks FeatureServer, WA Ecology MapServer layer 132,
 * BC Ports and Terminals WFS, OpenStreetMap Overpass, GEM's coal-terminal map file (104 KB), and the local Climate TRACE
 * facility bake (scripts/bake-climatetrace/build/features.geojsonl) for refinery sources. Climate TRACE ship ports are
 * imported by ships:import-climatetrace-ports and only linked here.
 */
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { startRun, finishRun } from '../../lib/ships/store.js'
import {
  loadTerminalData, validateTerminalData, requiredKeys, resolveBerths, importTerminals, ensureTerminalSources, parseCsv,
  mapUsaceDock, mapEcologyFacility, mapBcPortTerminal, mapOsmElement,
  USACE_DOCKS_URL, ECOLOGY_FACILITIES_URL, BC_PORTS_TERMINALS_URL, BC_PORTS_TERMINALS_LAYER, OVERPASS_URL, GEM_GCTT_URL, GEM_GGIT_URL, TERMINALS_LIST_SOURCE,
} from '../../lib/ships/terminals.js'

const UA = 'EarthAtlas-ships/1.0 (+https://earthatlas.org/ships; terminal list import)'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const saveDir = opt('save'), fromDir = opt('from'), dry = args.includes('--dry-run')
const CT_FEATURES = 'scripts/bake-climatetrace/build/features.geojsonl'

async function getJson(name, url, init = {}) {
  if (fromDir) return JSON.parse(await readFile(path.join(fromDir, `${name}.json`), 'utf8'))
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } })
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} for ${url}`)
  const body = await res.json()
  if (body?.error) throw new Error(`${name}: ${JSON.stringify(body.error)}`)
  const out = { url, retrieved_at: new Date().toISOString(), body }
  if (saveDir) { await mkdir(saveDir, { recursive: true }); await writeFile(path.join(saveDir, `${name}.json`), JSON.stringify(out)) }
  return out
}
async function getText(name, url) {
  if (fromDir) return JSON.parse(await readFile(path.join(fromDir, `${name}.json`), 'utf8'))
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} for ${url}`)
  const out = { url, retrieved_at: new Date().toISOString(), body: await res.text() }
  if (saveDir) { await mkdir(saveDir, { recursive: true }); await writeFile(path.join(saveDir, `${name}.json`), JSON.stringify(out)) }
  return out
}

const data = await loadTerminalData()
const errs = validateTerminalData(data)
if (errs.length) { console.error(`terminal data invalid:\n  ${errs.join('\n  ')}`); process.exit(1) }
const need = requiredKeys(data)
console.log(`${data.main.terminals.length} terminals; need USACE ${need.usace.length}, Ecology ${need.ecology.size}, BC P&T ${need.bcpt.size}, `
  + `OSM ${need.osm.length}, GEM ${need.gem.length}, CT refineries ${need.ctRefinery.length}, CT ship ports ${need.ctPort.length} (linked only)`)

// USACE Docks: one request by NAV_UNIT_ID.
const usaceQs = new URLSearchParams({ where: `NAV_UNIT_ID IN (${need.usace.map((k) => `'${k.replace(/'/g, "''")}'`).join(',')})`,
  outFields: '*', returnGeometry: 'false', f: 'json' })
const usace = await getJson('usace-docks', `${USACE_DOCKS_URL}?${usaceQs}`)
// WA Ecology layer 132: one request by OBJECTID (names re-checked in lib).
const ecoQs = new URLSearchParams({ where: `OBJECTID IN (${[...need.ecology.keys()].join(',')})`, outFields: '*', returnGeometry: 'true', outSR: '4326', f: 'json' })
const eco = await getJson('wa-ecology-facilities', `${ECOLOGY_FACILITIES_URL}?${ecoQs}`)
// BC Ports and Terminals WFS: one request by SOURCE_DATA_ID.
const bcQs = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', typeName: BC_PORTS_TERMINALS_LAYER,
  outputFormat: 'application/json', srsName: 'EPSG:4326', CQL_FILTER: `SOURCE_DATA_ID IN (${[...need.bcpt.keys()].join(',')})` })
const bcpt = await getJson('bc-ports-terminals', `${BC_PORTS_TERMINALS_URL}?${bcQs}`)
// OpenStreetMap: one Overpass request by element id.
const byType = { node: [], way: [], relation: [] }
for (const k of need.osm) { const [t, id] = k.split('/'); byType[t].push(id) }
const oq = `[out:json][timeout:60];(${Object.entries(byType).filter(([, ids]) => ids.length).map(([t, ids]) => `${t}(id:${ids.join(',')});`).join('')});out center tags;`
const osm = await getJson('osm', OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: oq }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
osm.url = `${OVERPASS_URL}?data=${encodeURIComponent(oq)}`
// GEM GCTT public map file (104 KB), filtered to our terminal ids.
const gemCsv = await getText('gem-gctt', GEM_GCTT_URL)
const gemRows = parseCsv(gemCsv.body).filter((r) => need.gem.includes(r['gem-terminal-id']))
// GEM Global Gas Infrastructure Tracker (LNG terminals): the public map file, downloaded ONCE by hand into the gitignored
// scripts/ships/gem/raw/ (Josh decision 4, 2026-09-28; 7.8 MB). Never re-downloaded here.
const GGIT_FILE = 'scripts/ships/gem/raw/ggit_2024-12-20.geojson'
let gemLng = []
if (need.gemLng.length) {
  let gj
  try { gj = JSON.parse(await readFile(GGIT_FILE, 'utf8')) } catch {
    console.error(`${GGIT_FILE} missing: download it once with\n  curl -o ${GGIT_FILE} ${GEM_GGIT_URL}`); process.exit(1)
  }
  gemLng = (gj.features || []).filter((f) => need.gemLng.includes(f?.properties?.id))
}
// Climate TRACE refineries from the local bake.
const index = JSON.parse(await readFile('public/dev-data/trace/trace-index.json', 'utf8'))
const release = `${index.release} (${index.build})`
const ctRefinery = []
const wantCt = new Set(need.ctRefinery)
const rl = createInterface({ input: createReadStream(CT_FEATURES), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.includes('"sub":"oil-and-gas-refining"')) continue
  const f = JSON.parse(line)
  if (wantCt.has(f.properties?.id)) ctRefinery.push(f)
}

const raw = {
  usace: usace.body.features || [], ecology: eco.body.features || [], bcpt: bcpt.body.features || [],
  osm: { elements: osm.body.elements || [], osmBase: osm.body.osm3s?.timestamp_osm_base ?? null },
  gem: gemRows, gemLng, ctRefinery, release,
  urls: { usace: usace.url, ecology: eco.url, bcpt: bcpt.url, osm: osm.url, gem: gemCsv.url, gemLng: GEM_GGIT_URL, ct: 'https://climatetrace.org/data' },
}
console.log(`fetched: USACE ${raw.usace.length}, Ecology ${raw.ecology.length}, BC P&T ${raw.bcpt.length}, OSM ${raw.osm.elements.length} (base ${raw.osm.osmBase}), `
  + `GEM ${raw.gem.length} rows, CT refineries ${raw.ctRefinery.length} (${release})`)

if (dry) {
  const maps = {
    usace: new Map(raw.usace.map(mapUsaceDock).filter((m) => !m.error).map((m) => [m.key, m.payload])),
    ecology: new Map(raw.ecology.map((f) => mapEcologyFacility(f)).filter((m) => !m.error).map((m) => [m.key, m.payload])),
    bcpt: new Map(raw.bcpt.map((f) => mapBcPortTerminal(f)).filter((m) => !m.error).map((m) => [m.key, m.payload])),
    osm: new Map(raw.osm.elements.map((e) => mapOsmElement(e)).filter((m) => !m.error).map((m) => [m.key, m.payload])),
  }
  let n = 0
  for (const t of data.main.terminals) {
    const r = resolveBerths(t, data.osm.berths, maps, { aisBerths: data.ais?.berths || [] })
    n += r.berths.length
    for (const p of r.problems) console.log(`  ! ${p}`)
  }
  console.log(`dry run: ${n} berths resolve; nothing written`)
  process.exit(0)
}

const pool = shipsPool()
try {
  await withTx(pool, (c) => ensureTerminalSources(c, schema))
  const runId = await withTx(pool, (c) => startRun(c, schema, TERMINALS_LIST_SOURCE.id, { version: data.main.version, from: fromDir ?? null }))
  try {
    const r = await withTx(pool, (c) => importTerminals(c, schema, data, raw, { runId }))
    await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats: r, datasetVersion: data.main.version }))
    console.log(JSON.stringify({ ...r, problems: r.problems.length }))
    for (const p of r.problems) console.log(`  ! ${p}`)
  } catch (e) {
    await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats: {}, error: String(e.message).slice(0, 500) })).catch(() => {})
    throw e
  }
} finally { await pool.end() }
