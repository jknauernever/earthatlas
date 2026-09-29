#!/usr/bin/env node
/**
 * AIS-inferred berths, step 2 of 2 (lib/ships/aisBerths.js; Josh 2026-09-28): cluster the long stops written by
 * scripts/ships/bake-ais/berth_stops.py and run the footprint guard. Writes a PROPOSAL only; berths are applied by hand-reviewing
 * it into lib/ships/data/salish-terminals-ais-berths.json (then npm run ships:import-terminals).
 *
 *   node scripts/ships/ais-berths.mjs [--stops burrard] [--from <overpass.json>]
 *     reads   scripts/ships/bake-ais/cache/terminal-calls/berth-stops-<stops>.csv (+ .json meta)
 *             scripts/ships/bake-ais/cache/terminal-calls/berths.json (existing berths + radii, from terminal-calls.mjs berths)
 *             lib/ships/data/salish-terminals-ais-berths.json `footprints` (which OSM elements are each terminal's own site / pier)
 *     fetches ONE Overpass request for the stops box (named industrial / port sites and piers, with geometry), saved to
 *             cache/terminal-calls/ais-berths-osm-<stops>.json; --from replays a saved response (offline)
 *     writes  cache/terminal-calls/ais-berths-proposal-<stops>.json: accepted + rejected clusters with the reasons
 * No database access.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AIS_BERTH_RULE, clusterStops, attributeClusters, stitchRings } from '../../lib/ships/aisBerths.js'
import { loadTerminalData, OVERPASS_URL, DATA_DIR, AIS_BERTHS_FILE } from '../../lib/ships/terminals.js'

const UA = 'EarthAtlas-ships/1.0 (+https://earthatlas.org/ships; AIS-inferred berth review)'
const DIR = 'scripts/ships/bake-ais/cache/terminal-calls'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const name = opt('stops') || 'burrard'

const meta = JSON.parse(await readFile(path.join(DIR, `berth-stops-${name}.json`), 'utf8'))
const stops = parseCsv(await readFile(path.join(DIR, `berth-stops-${name}.csv`), 'utf8'))
const bj = JSON.parse(await readFile(path.join(DIR, 'berths.json'), 'utf8'))
const cfg = JSON.parse(await readFile(path.join(DATA_DIR, AIS_BERTHS_FILE), 'utf8'))
const { main } = await loadTerminalData()
const byKey = new Map(main.terminals.map((t) => [t.id, t]))

// One Overpass request: named industrial / port sites and piers in the stops box, plus every footprint element by id.
const { w, s, e, n } = meta.box
const ids = { way: [], relation: [] }
for (const els of Object.values(cfg.footprints)) for (const k of els) { const [t, id] = k.split('/'); ids[t].push(id) }
const bb = `(${s},${w},${n},${e})`
const oq = `[out:json][timeout:60];(way["landuse"="industrial"]["name"]${bb};relation["landuse"="industrial"]["name"]${bb};way["man_made"="pier"]["name"]${bb};`
  + `way["man_made"="pier"]["description"]${bb};${ids.way.length ? `way(id:${ids.way.join(',')});` : ''}${ids.relation.length ? `relation(id:${ids.relation.join(',')});` : ''});out geom;`
let osm
if (opt('from')) osm = JSON.parse(await readFile(opt('from'), 'utf8'))
else {
  const res = await fetch(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: oq }), headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } })
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`)
  osm = { url: `${OVERPASS_URL}?data=${encodeURIComponent(oq)}`, retrieved_at: new Date().toISOString(), body: await res.json() }
  await writeFile(path.join(DIR, `ais-berths-osm-${name}.json`), JSON.stringify(osm))
}
const els = new Map(osm.body.elements.map((x) => [`${x.type}/${x.id}`, x]))
const ringsOf = (x) => {
  if (x.type === 'way') return { rings: [x.geometry.map((p) => [p.lon, p.lat])], open: [] }
  return stitchRings(x.members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry).map((m) => m.geometry.map((p) => [p.lon, p.lat])))
}
const problems = []
const own = new Set(Object.values(cfg.footprints).flat())
const fitTypes = (t) => {
  const tanker = /crude|product|refinery|bunker|fuel|chemical|lng|lpg/.test(t.kind) || (t.ship_fit?.classes || []).some((c) => /tanker/.test(c))
  const bulk = /grain|coal|bulk|cement|scrap|forest/.test(t.kind)
  return [...(bulk ? [[70, 79]] : []), ...(tanker ? [[80, 89]] : [])]
}
const terminals = Object.entries(cfg.footprints).map(([key, list]) => {
  const t = byKey.get(key)
  if (!t) throw new Error(`footprint for unknown terminal ${key}`)
  const rings = []
  for (const k of list) {
    const x = els.get(k)
    if (!x) { problems.push(`${key}: OSM ${k} not returned`); continue }
    const r = ringsOf(x)
    if (r.open.length) problems.push(`${key}: OSM ${k} has ${r.open.length} unclosed outer way chain(s) (used as lines)`)
    rings.push(...r.rings, ...r.open)
  }
  const berths = bj.berths.filter((b) => b.terminal === key && b.basis !== 'ais_inferred').map((b) => ({ key: b.berth, lat: b.lat, lon: b.lon, radius_m: b.radius_m }))
  const names = list.map((k) => els.get(k)?.tags?.name || els.get(k)?.tags?.description || k)
  return { key, footprint: { rings, osm: list, name: `${t.name} (${names.join(' + ')})` }, fitTypes: fitTypes(t), berths }
})
const others = [...els.values()].filter((x) => !own.has(`${x.type}/${x.id}`) && (x.tags?.name || x.tags?.description))
  .map((x) => { const r = ringsOf(x); return { id: `${x.type}/${x.id}`, name: `${x.tags.name || x.tags.description} (OSM ${x.type}/${x.id})`, rings: [...r.rings, ...r.open] } })

const { clusters, dropped } = clusterStops(stops)
const { accepted, rejected } = attributeClusters(clusters, terminals, others)
const out = { made_at: new Date().toISOString(), rule: AIS_BERTH_RULE, stops: { file: `berth-stops-${name}.csv`, ...meta, dropped_spread: dropped },
  osm: { url: osm.url, retrieved_at: osm.retrieved_at, osm_base: osm.body.osm3s?.timestamp_osm_base ?? null, others: others.length },
  problems, accepted, rejected }
await writeFile(path.join(DIR, `ais-berths-proposal-${name}.json`), JSON.stringify(out, null, 1))
console.log(`${stops.length} stops (${dropped} dropped: spread > ${AIS_BERTH_RULE.maxSpreadM} m) → ${clusters.length} clusters; near a listed terminal: `
  + `${accepted.length} accepted, ${rejected.length} rejected; OSM base ${out.osm.osm_base}`)
for (const p of problems) console.log(`  ! ${p}`)
const line = (c) => `${c.terminal} ${c.lat},${c.lon} stops ${c.stops} ships ${c.ships} fit ${Math.round(c.fitShare * 100)}% footprint ${c.footprintM} m; nearest other ${c.nearestOther?.name} ${c.nearestOther?.m} m`
for (const c of accepted) console.log(`  ACCEPT ${line(c)}`)
for (const c of rejected) console.log(`  reject ${line(c)}\n         ${c.why.join('; ')}`)

function parseCsv(text) {
  const [h, ...rows] = text.trim().split('\n')
  const head = h.split(',')
  return rows.map((l) => {
    const f = []; let cur = '', q = false
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false; else cur += ch }
      else if (ch === '"') q = true; else if (ch === ',') { f.push(cur); cur = '' } else cur += ch
    }
    f.push(cur)
    return Object.fromEntries(head.map((k, i) => [k, f[i] === '' ? null : f[i]]))
  })
}
