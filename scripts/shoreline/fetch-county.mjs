// Downloads the three San Juan County GIS layers /shoreline's property popup is built from, as GeoJSON (WGS84):
//   parcels    OpenData/Parcels/MapServer/1      Assessor tax parcels (same fields as SSE's Tax_Parcels.geojson)
//   buildings  Polaris/Buildings/MapServer/3     building footprints
//   addresses  Polaris/Buildings/MapServer/0     E911 address points (FULLADDR, BLDGTYPE, MSAG, … by PIN)
// County map services reject resultRecordCount, so each layer is read as its object ids, then in id chunks.
//
//   node scripts/shoreline/fetch-county.mjs                 every feature (≈19k parcels, ≈31k buildings, ≈23k addresses)
//   node scripts/shoreline/fetch-county.mjs --pins 351356303000,152232005000   only those parcels + their buildings/addresses
//
// Writes data/shoreline/raw/{parcels,buildings,addresses}.geojson (gitignored) and a fetch.json with counts + dates.

import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = 'https://gis.sanjuancountywa.gov/arcgis/rest/services'
export const COUNTY_LAYERS = {
  parcels: `${BASE}/OpenData/Parcels/MapServer/1`,
  buildings: `${BASE}/Polaris/Buildings/MapServer/3`,
  addresses: `${BASE}/Polaris/Buildings/MapServer/0`,
}
const OUT = 'data/shoreline/raw'
const CHUNK = 500

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const pins = arg('--pins')?.split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s))
const where = pins ? `PIN IN (${pins.map((p) => `'${p}'`).join(',')})` : '1=1'

let calls = 0
async function get(url, params) {
  calls++
  const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ f: 'json', ...params }) })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const j = await res.json()
  if (j.error) throw new Error(`${url}: ${JSON.stringify(j.error)}`)
  return j
}

async function fetchLayer(url, filter = { where }) {
  const { objectIds } = await get(`${url}/query`, { ...filter, returnIdsOnly: 'true' })
  const ids = (objectIds || []).sort((a, b) => a - b)
  const features = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const fc = await get(`${url}/query`, { objectIds: ids.slice(i, i + CHUNK).join(','), outFields: '*', outSR: '4326', f: 'geojson' })
    if (fc.properties?.exceededTransferLimit) throw new Error(`${url}: transfer limit — lower CHUNK`)
    features.push(...fc.features)
  }
  if (features.length !== ids.length) throw new Error(`${url}: got ${features.length} of ${ids.length}`)
  return { type: 'FeatureCollection', features }
}

function bboxOf(fc, pad) {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  const walk = (c) => (typeof c[0] === 'number'
    ? (b[0] = Math.min(b[0], c[0]), b[1] = Math.min(b[1], c[1]), b[2] = Math.max(b[2], c[0]), b[3] = Math.max(b[3], c[1]))
    : c.forEach(walk))
  fc.features.forEach((f) => f.geometry && walk(f.geometry.coordinates))
  return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]
}

mkdirSync(OUT, { recursive: true })
const meta = { fetchedAt: new Date().toISOString(), where, layers: {} }
// Buildings carry no reliable PIN (SSE joined them to parcels by distance), so a --pins run takes the buildings
// inside the picked parcels' bounding box (+ ~60 ft).
let bbox = null
for (const [name, url] of Object.entries(COUNTY_LAYERS)) {
  const filter = pins && name === 'buildings'
    ? { where: '1=1', geometry: bbox.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' }
    : { where }
  const fc = await fetchLayer(url, filter)
  if (name === 'parcels') bbox = bboxOf(fc, 0.0002)
  writeFileSync(`${OUT}/${name}.geojson`, JSON.stringify(fc))
  meta.layers[name] = { url, count: fc.features.length }
  console.log(`${name}: ${fc.features.length}`)
}
meta.calls = calls
writeFileSync(`${OUT}/fetch.json`, JSON.stringify(meta, null, 2))
console.log(`${calls} requests → ${OUT}`)
