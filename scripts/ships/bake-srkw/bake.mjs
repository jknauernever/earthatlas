// NOAA Fisheries critical habitat for Southern Resident killer whales → one PMTiles file for the /ships
// "Orca critical habitat" layer (Josh 2026-10-19). Same pipeline as scripts/ships/bake-mpa/bake.mjs.
//
//   node scripts/ships/bake-srkw/bake.mjs            download (if not cached) + bake
//   node scripts/ships/bake-srkw/bake.mjs --refresh  re-download first
//
// Source: NOAA Fisheries West Coast Region, "WhaleKiller_SouthernResidentDPS_20210802" (ArcGIS item
// fe1e0f42587f437b93e6168929f03593): the 2006 designation (71 FR 69054: Haro Strait and San Juan Islands summer core
// area, Puget Sound, Strait of Juan de Fuca) and the 2021 revision (86 FR 41668: six coastal areas, Washington to
// Point Sur). 11 polygons. US federal government work. NOAA's own notes, kept with the data: these shapes are not the
// legal definition (50 CFR 226.206 is); the 2006 inland areas still contain the military areas the rule excludes
// (not clipped out), while the 2021 coastal areas have the Quinault Range and its 10 km buffer clipped out.
//
// Canada (Josh 2026-11-06): Fisheries and Oceans Canada critical habitat under the Species at Risk Act for the Southern
// Resident (SOR/2018-278) and Northern Resident (SOR/2018-279) populations, from DFO's open-data service (open.canada.ca
// dataset db177a8c-5d7d-49eb-8290-31e6a45d786c, Open Government Licence – Canada). Tagged ag='dfo'; NOAA shapes carry no ag.
//
// The raw GeoJSON is kept exactly as received in raw/ (the evidence). Output: build/srkw-<version>.pmtiles, layer "srkw";
// version = the newer of NOAA's and DFO's data dates (both go in src/ships/trackSource.json as noaaAsOf / dfoAsOf).
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVICE = 'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/WhaleKiller_SouthernResidentDPS_20210802/FeatureServer'
const LAYER = `${SERVICE}/65`
const RAW = join(HERE, 'raw'), BUILD = join(HERE, 'build')
const DFO_LAYER = 'https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/open_data_donnees_ouvertes/dfo_sara_critical_habitat/MapServer/0'
const DFO_ID = 'db177a8c-5d7d-49eb-8290-31e6a45d786c'
const DFO_KEEP = { POP_E: 'POP', SARASTAT_E: 'SARASTAT', CH_STATUS_E: 'CH_STATUS', Area_Km2: 'AREASqKm', PROFILE_E: 'PROFILE' }
const KEEP = ['ID', 'UNIT', 'LISTENTITY', 'LISTSTATUS', 'CHSTATUS', 'PUBDATE', 'EFFECTDATE', 'AREASqKm', 'NOTES']

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'EarthAtlas SRKW critical habitat bake (earthatlas.org)' } })
    const j = r.ok ? await r.json().catch(() => null) : null
    if (j && !j.error) return j
    if (attempt >= 4) throw new Error(`${url}: HTTP ${r.status} ${JSON.stringify(j?.error || '')}`)
    await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt))
  }
}

async function download() {
  rmSync(RAW, { recursive: true, force: true })
  mkdirSync(RAW, { recursive: true })
  const svc = await getJson(`${SERVICE}?f=json`)
  const layer = await getJson(`${LAYER}?f=json`)
  const item = await getJson(`https://www.arcgis.com/sharing/rest/content/items/${svc.serviceItemId}?f=json`)
  writeFileSync(join(RAW, 'layer.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), service: SERVICE, serviceInfo: svc, layerInfo: layer, item }, null, 1))
  const fc = await getJson(`${LAYER}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`)
  writeFileSync(join(RAW, 'features.geojson'), JSON.stringify(fc))
  console.log(`  downloaded ${fc.features.length} polygons`)
  await downloadDfo()
}

async function downloadDfo() {
  const pkg = await getJson(`https://open.canada.ca/data/api/action/package_show?id=${DFO_ID}`)
  writeFileSync(join(RAW, 'dfo-meta.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), layer: DFO_LAYER, package: pkg.result }, null, 1))
  const fc = await getJson(`${DFO_LAYER}/query?where=${encodeURIComponent("COMMON_E = 'Killer Whale'")}&outFields=*&outSR=4326&f=geojson`)
  writeFileSync(join(RAW, 'dfo.geojson'), JSON.stringify(fc))
  console.log(`  downloaded ${fc.features.length} DFO polygons`)
}

async function main() {
  if (process.argv.includes('--refresh') || !existsSync(join(RAW, 'layer.json'))) await download()
  else if (!existsSync(join(RAW, 'dfo.geojson'))) await downloadDfo()
  const meta = JSON.parse(readFileSync(join(RAW, 'layer.json'), 'utf8'))
  const edited = meta.layerInfo.editingInfo?.dataLastEditDate || meta.layerInfo.editingInfo?.lastEditDate
  const noaaAsOf = edited ? new Date(edited).toISOString().slice(0, 10) : 'unknown'
  const dfoAsOf = String(JSON.parse(readFileSync(join(RAW, 'dfo-meta.json'), 'utf8')).package.date_modified || 'unknown').slice(0, 10)
  const version = [noaaAsOf, dfoAsOf].sort().pop()
  const features = []
  for (const ft of JSON.parse(readFileSync(join(RAW, 'features.geojson'), 'utf8')).features) {
    if (!ft.geometry) continue
    const p = {}
    for (const k of KEEP) if (ft.properties[k] != null && ft.properties[k] !== '') p[k] = typeof ft.properties[k] === 'string' ? ft.properties[k].trim() : ft.properties[k]
    features.push({ type: 'Feature', id: ft.properties.OBJECTID, properties: p, geometry: ft.geometry })
  }
  for (const ft of JSON.parse(readFileSync(join(RAW, 'dfo.geojson'), 'utf8')).features) {
    if (!ft.geometry) continue
    const p = { ag: 'dfo' }
    for (const [k, to] of Object.entries(DFO_KEEP)) if (ft.properties[k] != null && ft.properties[k] !== '') p[to] = typeof ft.properties[k] === 'string' ? ft.properties[k].trim() : ft.properties[k]
    if (p.AREASqKm != null) p.AREASqKm = Math.round(p.AREASqKm)
    features.push({ type: 'Feature', id: 100000 + ft.properties.OBJECTID, properties: p, geometry: ft.geometry })
  }
  mkdirSync(BUILD, { recursive: true })
  const gj = join(BUILD, 'srkw.geojson'), out = join(BUILD, `srkw-${version}.pmtiles`)
  writeFileSync(gj, JSON.stringify({ type: 'FeatureCollection', features }))
  console.log(`  ${features.length} polygons; NOAA data ${noaaAsOf}, DFO data ${dfoAsOf} → version ${version}`)
  // Polygons are never dropped (critical habitat must not vanish when zoomed out); tippecanoe simplifies instead.
  execFileSync('tippecanoe', ['-q', '-o', out, '--force', '-l', 'srkw', '-Z0', '-z12', '--detect-shared-borders',
    '--no-tiny-polygon-reduction', '--coalesce-densest-as-needed', '--extend-zooms-if-still-dropping', gj], { stdio: 'inherit' })
  console.log(`  → ${out}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
