// /risks: download San Juan County's ESA 2024 sea-level-rise layers (public ArcGIS feature services, no auth) into
// scripts/bake-risks/raw/ as GeoJSON in EPSG:4326. Idempotent: a file already on disk is skipped (pass --force to
// re-fetch). Every layer fits one query (each scenario layer is ONE multipolygon). Building footprints come from
// Salish Sea Explorer's copy (see bake.mjs), not from here.
//
//   node scripts/bake-risks/fetch.mjs [--force] [--only=<name>,…]
//
// Then: node scripts/bake-risks/bake.mjs   (flood bands + footprints → PMTiles; small layers → public/risks-data/)

import { mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RAW = resolve(HERE, 'raw')
const BASE = 'https://services.arcgis.com/PNkCg7xWnaf90qde/arcgis/rest/services'

export const LAYERS = [
  // ESA 2024 inundation scenarios (Sea_Level_Rise_WFL1): one multipolygon each, ~45–55 MB of GeoJSON
  { name: 'slr-5ft-100yr', svc: 'Sea_Level_Rise_WFL1', id: 3 },
  { name: 'slr-5ft-1yr', svc: 'Sea_Level_Rise_WFL1', id: 4 },
  { name: 'slr-2ft-100yr', svc: 'Sea_Level_Rise_WFL1', id: 5 },
  { name: 'slr-2ft-1yr', svc: 'Sea_Level_Rise_WFL1', id: 6 },
  // Roads the assessment found flooding (Vulnerability_Assessment_Map), by island
  { name: 'roads-sji', svc: 'Vulnerability_Assessment_Map', id: 214 },
  { name: 'roads-lopez', svc: 'Vulnerability_Assessment_Map', id: 215 },
  { name: 'roads-decatur', svc: 'Vulnerability_Assessment_Map', id: 216 },
  { name: 'roads-blakely', svc: 'Vulnerability_Assessment_Map', id: 217 },
  { name: 'roads-shaw', svc: 'Vulnerability_Assessment_Map', id: 218 },
  { name: 'roads-orcas', svc: 'Vulnerability_Assessment_Map', id: 219 },
  { name: 'roads-other', svc: 'Vulnerability_Assessment_Map', id: 220 },
  // ESA projected erosion zones, 2060 and 2100 (one multipolygon each): bands inland of the shoreline
  { name: 'erosion-zones', svc: 'ESA_SLR_Road_Erosion_Boundaries', id: 0 },
  // Erosion vulnerability points (6)
  { name: 'erosion-points', svc: 'Erosion_Vulnerability_Points', id: 8 },
  // Island outlines (NOAA shoreline, 451): the bake trims the 1-year flood layer to land with them
  { name: 'shoreline', svc: 'Vulnerability_Assessment_Map', id: 208 },
]

export const layerUrl = (l) => `${BASE}/${l.svc}/FeatureServer/${l.id}`

async function main() {
  const force = process.argv.includes('--force')
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean)
  mkdirSync(RAW, { recursive: true })
  for (const l of LAYERS) {
    if (only.length && !only.includes(l.name)) continue
    const out = resolve(RAW, `${l.name}.geojson`)
    if (existsSync(out) && !force) { console.log(`skip ${l.name} (on disk)`); continue }
    const url = `${layerUrl(l)}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`
    const t0 = Date.now()
    const r = await fetch(url)
    if (!r.ok) throw new Error(`${l.name}: HTTP ${r.status}`)
    const text = await r.text()
    const j = JSON.parse(text)
    if (j.error) throw new Error(`${l.name}: ${JSON.stringify(j.error)}`)
    if (j.properties?.exceededTransferLimit || j.exceededTransferLimit) throw new Error(`${l.name}: exceeded transfer limit; add paging`)
    writeFileSync(out, text)
    console.log(`${l.name}: ${j.features.length} features, ${(statSync(out).size / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1) })
