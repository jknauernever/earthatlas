// NOAA Marine Protected Areas Inventory → one PMTiles file for the /ships
// "Protected areas" layer.
//
//   node scripts/ships/bake-mpa/bake.mjs            download (if not cached) + bake
//   node scripts/ships/bake-mpa/bake.mjs --refresh  re-download first
//
// Source: NOAA National MPA Center, MPA Inventory (v2024 at the time of writing),
// the hosted feature service linked from
// https://marineprotectedareas.noaa.gov/dataanalysis/mpainventory/ . US federal
// government work, public domain. The 2007 shapefile on the older
// helpful_resources/inventory.html page is superseded by this.
//
// The raw GeoJSON pages are kept exactly as received in raw/ (the evidence); the
// bake only trims stray whitespace/CR from text values and blanks " " values.
// Output: build/mpa-<version>.pmtiles, source layer "mpa".

import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVICE = 'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/NOAA_MPA_Inventory_2023/FeatureServer'
const LAYER = `${SERVICE}/0`
const RAW = join(HERE, 'raw'), BUILD = join(HERE, 'build')
const PAGE = 25 // some sites have >100k vertices; small pages keep each response well under the service's limits

// Attributes carried into the tiles (everything a popup shows or the map styles by).
const KEEP = ['Site_ID', 'Site_Name', 'Gov_Level', 'State', 'Prot_Lvl', 'Mgmt_Agen', 'Pri_Con_Fo', 'Cons_Focus', 'Fish_Rstr',
  'Permanence', 'Constancy', 'Estab_Yr', 'Anchor', 'Vessel', 'IUCNcat', 'Design', 'URL', 'WDPA_Cd', 'AreaKm', 'AreaMar', 'AreaNT']

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'EarthAtlas MPA bake (earthatlas.org)' } })
    const j = r.ok ? await r.json().catch(() => null) : null
    if (j && !j.error) return j
    if (attempt >= 4) throw new Error(`${url}: HTTP ${r.status} ${JSON.stringify(j?.error || '')}`)
    await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt))
  }
}

async function download() {
  rmSync(RAW, { recursive: true, force: true })
  mkdirSync(RAW, { recursive: true })
  const item = await getJson(`${LAYER}?f=json`)
  const svc = await getJson(`${SERVICE}?f=json`)
  const { objectIds } = await getJson(`${LAYER}/query?where=1%3D1&returnIdsOnly=true&f=json`)
  objectIds.sort((a, b) => a - b)
  writeFileSync(join(RAW, 'layer.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), service: SERVICE, serviceInfo: svc, layerInfo: item }, null, 1))
  for (let i = 0; i < objectIds.length; i += PAGE) {
    const ids = objectIds.slice(i, i + PAGE).join(',')
    const fc = await getJson(`${LAYER}/query?objectIds=${ids}&outFields=*&outSR=4326&f=geojson`)
    writeFileSync(join(RAW, `page-${String(i / PAGE).padStart(3, '0')}.geojson`), JSON.stringify(fc))
    process.stdout.write(`\r  downloaded ${Math.min(i + PAGE, objectIds.length)}/${objectIds.length}`)
  }
  process.stdout.write('\n')
}

const clean = (v) => {
  if (typeof v !== 'string') return v ?? null
  const s = v.replace(/[\r\n]+/g, ' ').trim()
  return s === '' ? null : s
}

async function main() {
  if (process.argv.includes('--refresh') || !existsSync(join(RAW, 'layer.json'))) await download()
  const meta = JSON.parse(readFileSync(join(RAW, 'layer.json'), 'utf8'))
  const version = (meta.layerInfo.editingInfo?.dataLastEditDate
    ? new Date(meta.layerInfo.editingInfo.dataLastEditDate).toISOString().slice(0, 10) : 'unknown')
  const features = []
  for (const f of readdirSync(RAW).filter((n) => n.endsWith('.geojson')).sort()) {
    for (const ft of JSON.parse(readFileSync(join(RAW, f), 'utf8')).features) {
      if (!ft.geometry) continue
      const p = {}
      for (const k of KEEP) { const v = clean(ft.properties[k]); if (v != null) p[k] = v }
      features.push({ type: 'Feature', id: ft.properties.FID, properties: p, geometry: ft.geometry })
    }
  }
  mkdirSync(BUILD, { recursive: true })
  const gj = join(BUILD, 'mpa.geojson'), out = join(BUILD, `mpa-${version}.pmtiles`)
  writeFileSync(gj, JSON.stringify({ type: 'FeatureCollection', features }))
  console.log(`  ${features.length} sites, data last edited ${version}`)
  // Polygons are never dropped (a protected area must not vanish when zoomed out); tippecanoe
  // simplifies instead, and coalesces only if a tile would still be too big.
  execFileSync('tippecanoe', ['-q', '-o', out, '--force', '-l', 'mpa', '-Z0', '-z12', '--detect-shared-borders',
    '--no-tiny-polygon-reduction', '--coalesce-densest-as-needed', '--extend-zooms-if-still-dropping', gj], { stdio: 'inherit' })
  console.log(`  → ${out}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
