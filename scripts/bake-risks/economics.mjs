#!/usr/bin/env node
// /risks/reports/land-value data: every parcel a flood scenario or erosion zone reaches, with the Assessor's values and how much
// of the lot each one covers, plus county totals (all parcels) for context. Input: build/parcel-exposure.csv (parcel-exposure.mjs)
// and build/buildings.geojsonl (bake.mjs: distance to the erosion lines), and the Assessor's parcels. Output: public/risks-data/economics.json.
//
//   node --max-old-space-size=4096 scripts/bake-risks/economics.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PARCELS = process.env.RISKS_PARCELS || resolve(HERE, '../../../salish-sea-propmapper/public/data/Tax_Parcels.geojson')
const OUT = resolve(HERE, '../../public/risks-data/economics.json')

// Island from the Assessor's district number (1x San Juan, 2x Orcas, 3x Lopez, 4x Shaw; the outer islands by district name).
const ISLANDS = ['San Juan', 'Orcas', 'Lopez', 'Shaw', 'Stuart', 'Waldron', 'Decatur', 'Blakely', 'Henry', 'Center', 'Crane', 'Other islands']
function islandOf(district) {
  const d = String(district || ''), n = parseInt(d, 10)
  if (n >= 10 && n < 20) return 'San Juan'
  if (n >= 20 && n < 30) return 'Orcas'
  if (n >= 30 && n < 40) return 'Lopez'
  if (n >= 40 && n < 50) return 'Shaw'
  const named = ISLANDS.find((i) => d.includes(i))
  return named || 'Other islands'
}
// Land use from the Assessor's use code (Washington's standard land-use codes: first digit, then a few by their first two).
const USES = ['Homes and cabins', 'Undeveloped land', 'Open space, farm and forest', 'Parks and recreation', 'Businesses', 'Public services and transportation', 'Water areas']
function useOf(code) {
  const c = String(code || '').trim(), two = c.slice(0, 2)
  if (c[0] === '1') return 'Homes and cabins'
  if (two === '91' || two === '99') return 'Undeveloped land'
  if (two === '93') return 'Water areas'
  if (c[0] === '8' || ['94', '95', '97'].includes(two)) return 'Open space, farm and forest'
  if (c[0] === '7') return 'Parks and recreation'
  if (c[0] === '4' || two === '67' || two === '68') return 'Public services and transportation'
  if (c[0] === '9') return 'Open space, farm and forest'
  return 'Businesses'
}
const num = (v) => { const n = parseInt(String(v ?? '').trim(), 10); return Number.isFinite(n) ? n : 0 }
const consOf = (desc) => /CONS\.?\s*E/i.test(desc || '')

// CSV (ogr2ogr: quoted where needed, no embedded newlines)
function parseCsv(text) {
  const lines = text.trim().split('\n'), split = (l) => {
    const out = []; let cur = '', q = false
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = '' } else cur += ch }
    out.push(cur); return out
  }
  const head = split(lines[0])
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])))
}

const features = JSON.parse(readFileSync(PARCELS, 'utf8')).features
const all = features.map((f) => f.properties)
// Areas within the islands: the Assessor's districts ("21 Orcas - Eastsound"), in district-number order
const DISTRICTS = [...new Set(all.map((p) => String(p.District_N || '').trim()).filter(Boolean))].sort()
// Each lot's building footprints (bake.mjs): pin → [total sq ft, flooded sq ft by scenario ×4]; flooded footprints' centers for the map
const r6 = (v) => Math.round(v * 1e6) / 1e6
const centroid = (g) => { const r = (g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.coordinates[0]).slice(0, -1); return [r6(r.reduce((a, c) => a + c[0], 0) / r.length), r6(r.reduce((a, c) => a + c[1], 0) / r.length)] }
const footprint = new Map()
const hits = []
for (const l of readFileSync(resolve(HERE, 'build/buildings.geojsonl'), 'utf8').trim().split('\n')) {
  const f = JSON.parse(l), b = f.properties, pin = String(b.pin || '').trim()
  if (!footprint.has(pin)) footprint.set(pin, [0, 0, 0, 0, 0])
  const fp = footprint.get(pin), sq = b.sqft || 0
  fp[0] += sq
  for (let k = 1; k <= 4; k++) if (b.first && b.first <= k) fp[k] += sq
  if (b.first) { const r = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates[0][0] : f.geometry.coordinates[0]; hits.push([...centroid({ type: 'Polygon', coordinates: [r] }), b.first]) }
}
const bldgShare = (pin) => { const fp = footprint.get(String(pin).trim()); return [1, 2, 3, 4].map((k) => (fp && fp[0] ? Math.round((fp[k] / fp[0]) * 100) : 0)) }

const rows = parseCsv(readFileSync(resolve(HERE, 'build/parcel-exposure.csv'), 'utf8'))
// Each parcel: [island, use, flags (1 conservation easement, 2 tax-exempt), land $, building $, appraised $, lot m², flood band m² ×4, erosion ring m² ×2, district,
//              % of the lot's building footprint area flooded in each scenario ×4 (cumulative)]
const parcels = rows.map((r) => [
  ISLANDS.indexOf(islandOf(r.district)), USES.indexOf(useOf(r.use_code)), (consOf(r.use_desc) ? 1 : 0) | (r.tax_status.trim() === 'EX' ? 2 : 0),
  num(r.land_value), num(r.bldg_value), num(r.appraised), Math.round(+r.parcel_m2),
  ...['fl1', 'fl2', 'fl3', 'fl4', 'er2060', 'er2100'].map((k) => Math.round(+r[k] || 0)),
  DISTRICTS.indexOf(String(r.district).trim()), ...bldgShare(r.pin),
])

// County totals, every parcel: by island and by use, for "share of …" context.
const totals = { parcels: 0, land: 0, appraised: 0, island: ISLANDS.map(() => [0, 0, 0]), use: USES.map(() => [0, 0, 0]), district: DISTRICTS.map(() => [0, 0, 0]) }
for (const p of all) {
  const land = num(p.Land_Value), app = num(p.Appraised_)
  totals.parcels++; totals.land += land; totals.appraised += app
  for (const [arr, i] of [[totals.island, ISLANDS.indexOf(islandOf(p.District_N))], [totals.use, USES.indexOf(useOf(p.Use_Code))],
    [totals.district, DISTRICTS.indexOf(String(p.District_N || '').trim())]]) {
    if (i < 0) continue
    arr[i][0]++; arr[i][1] += land; arr[i][2] += app
  }
}

// Buildings within 100 ft of a projected erosion line (bake.mjs measures them: e2060 / e2100, metres), with their lot's
// Assessor values: [island, use, flags, metres to the 2060 line or -1 if farther, metres to the 2100 line, lot id, lot appraised $, district]
const byPin = new Map(all.map((p) => [String(p.PIN).trim(), p]))
const lotIds = new Map()
const nearErosion = []
for (const l of readFileSync(resolve(HERE, 'build/buildings.geojsonl'), 'utf8').trim().split('\n')) {
  const b = JSON.parse(l).properties
  if (b.e2100 == null) continue
  const lot = byPin.get(String(b.pin || '').trim())
  if (!lot) continue
  if (!lotIds.has(lot.PIN)) lotIds.set(lot.PIN, lotIds.size)
  nearErosion.push([ISLANDS.indexOf(islandOf(lot.District_N)), USES.indexOf(useOf(lot.Use_Code)), (consOf(lot.Descriptio) ? 1 : 0) | (String(lot.Tax_Status).trim() === 'EX' ? 2 : 0),
    b.e2060 ?? -1, b.e2100, lotIds.get(lot.PIN), num(lot.Appraised_), DISTRICTS.indexOf(String(lot.District_N || '').trim())])
}

writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString().slice(0, 10), islands: ISLANDS, uses: USES, districts: DISTRICTS, districtIsland: DISTRICTS.map((d) => ISLANDS.indexOf(islandOf(d))), totals, parcels, nearErosion }))
// The /risks map's "in this view" totals: public/risks-data/inview.json.
//   parcels: [lng, lat (mean of the lot's outer-ring vertices), land $, building $, lot m², flood band m² ×4, % of the lot's
//             building footprint area flooded in each scenario ×4 (cumulative)]
//   buildings: [lng, lat, first] for every flooded footprint (bake.mjs's "hits")
const geomByPin = new Map(features.map((f) => [String(f.properties.PIN).trim(), f.geometry]))
const inview = { parcels: [], buildings: hits }
for (const r of rows) {
  const g = geomByPin.get(String(r.pin).trim())
  if (!g) continue
  inview.parcels.push([...centroid(g), num(r.land_value), num(r.bldg_value), Math.round(+r.parcel_m2), ...['fl1', 'fl2', 'fl3', 'fl4'].map((k) => Math.round(+r[k] || 0)),
    ...bldgShare(r.pin)])
}
writeFileSync(resolve(HERE, '../../public/risks-data/inview.json'), JSON.stringify(inview))
console.log(`inview.json: ${inview.parcels.length} parcels, ${hits.length} flooded buildings`)
console.log(`buildings within 100 ft of the 2100 erosion line: ${nearErosion.length} on ${lotIds.size} lots`)
console.log(`wrote ${OUT}: ${parcels.length} parcels reached; county ${totals.parcels} parcels, land $${(totals.land / 1e9).toFixed(2)}B`)
