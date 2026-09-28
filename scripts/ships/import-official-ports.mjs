#!/usr/bin/env node
/**
 * Official port names / status → ships evidence + port aliases (+ DFO-only map ports). lib/ships/officialPorts.js;
 * facts: docs/OFFICIAL_PORT_LISTS.md. Idempotent: an unchanged source stores nothing new and re-decides the same way.
 *
 *   npm run ships:import-official-ports -- [dfo|usace|tc|all] [--schema <name>] [--bbox W,S,E,N | --everywhere]
 *     dfo    DFO Small Craft Harbours (ESRI REST, 3 layers) → match to our map ports; unmatched → 'dfo_sch' ports
 *     usace  USACE/BTS Port Areas (polygons) → the US WPI ports inside each (matching only, not drawn)
 *     tc     lib/ships/data/ca-official-ports.json + the Transport Canada / Justice Laws pages each row cites
 *     all    (default) the three above
 *     --bbox        area for dfo / usace (default: the Salish Sea box -125.5,47,-122,50.5)
 *     --everywhere  no area limit (all 939 DFO harbours; all 370 US Port Areas and every US WPI port)
 * Writes to SHIPS_DATABASE_URL (dev via .env.local). Production needs Josh's go-ahead.
 */
import { readFile } from 'node:fs/promises'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import {
  ensureOfficialSources, importDfo, importUsace, importHandTable, esriQueryUrl,
  DFO_URL, DFO_LAYERS, USACE_URL, SALISH_BBOX,
} from '../../lib/ships/officialPorts.js'

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const what = args.find((a) => ['dfo', 'usace', 'tc', 'all'].includes(a)) || 'all'
const schema = opt('schema') || DEFAULT_SCHEMA
const bbox = args.includes('--everywhere') ? null : (opt('bbox')?.split(',').map(Number) || SALISH_BBOX)
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; EarthAtlas-ships/0.1; +https://earthatlas.org)' }
const today = new Date().toISOString().slice(0, 10)

async function getJson(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  const j = await r.json()
  if (j?.error) throw new Error(`ESRI ${j.error.code}: ${j.error.message} (${url})`)
  return j
}
/** Every feature of one ESRI layer query, paged. → { features, urls } */
async function esriAll(base, { count, orderBy }) {
  const features = [], urls = []
  for (let offset = 0; offset < 100000; offset += count) {
    const url = esriQueryUrl(base, { bbox, offset, count, orderBy })
    const j = await getJson(url)
    urls.push(url)
    features.push(...(j.features || []))
    if (!j.exceededTransferLimit && (j.features || []).length < count) break
  }
  return { features, urls }
}

console.log(`official ports: ${what} → schema "${schema}" on ${new URL(process.env.SHIPS_DATABASE_URL).host}; area ${bbox ? bbox.join(',') : 'everywhere'}`)
const pool = shipsPool()
try {
  await ensureOfficialSources(pool, schema)
  if (what === 'tc' || what === 'all') {
    const table = JSON.parse(await readFile('lib/ships/data/ca-official-ports.json', 'utf8'))
    const pages = new Map()
    for (const u of [...new Set(table.rows.flatMap((r) => r.sources))]) {
      const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(60000) })
      if (!r.ok) { console.warn(`  page ${u}: HTTP ${r.status} (rows citing it stay candidates)`); continue }
      pages.set(u, await r.text())
    }
    const r = await withTx(pool, (c) => importHandTable(c, schema, table, pages, { datasetVersion: today }))
    console.log('tc:', JSON.stringify(r))
  }
  if (what === 'dfo' || what === 'all') {
    const items = []
    for (const layer of DFO_LAYERS) {
      const { features } = await esriAll(`${DFO_URL}/${layer.id}`, { count: 1000, orderBy: 'OBJECTID' })
      for (const f of features) items.push({ feature: f, layer })
      console.log(`  DFO layer ${layer.id} ${layer.name}: ${features.length}`)
    }
    const r = await withTx(pool, (c) => importDfo(c, schema, items, { bbox, retrievalUrl: `${DFO_URL}/{0,1,2}/query`, datasetVersion: today }))
    console.log('dfo:', JSON.stringify({ ...r, decisions: undefined }))
    for (const d of r.decisions) console.log(`  ${d.decision.padEnd(9)} ${String(d.number).padEnd(5)} ${d.name}${d.port_id ? ` → port ${d.port_id}` : ''}${d.distance_km != null ? ` (${d.distance_km} km)` : ''}${d.candidates?.length ? ` · candidates: ${d.candidates.map((x) => `${x.name} ${x.km} km (${x.reason || ''})`).join('; ')}` : ''}`)
  }
  if (what === 'usace' || what === 'all') {
    const { features, urls } = await esriAll(USACE_URL, { count: 100, orderBy: 'PORTIDPK' })
    console.log(`  USACE Port Areas: ${features.length}`)
    const r = await withTx(pool, (c) => importUsace(c, schema, features, { bbox, retrievalUrl: urls[0], datasetVersion: today }))
    console.log('usace:', JSON.stringify({ ...r, decisions: undefined }))
    for (const d of r.decisions) console.log(`  ${(d.status || 'outside').padEnd(9)} ${d.name}${d.areas.length ? ` → ${d.areas.join(', ')}` : ''}`)
  }
} finally { await pool.end() }
